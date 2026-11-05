/**
 * The handful of file operations the notes folder needs, by absolute path.
 *
 * `tauri-root.ts` builds a FileSystemDirectoryHandle stand-in on top of this, so the vault code written
 * for the browser runs unchanged on the real file system. Paths use `/` to join; on Windows the root
 * itself may contain `\`, which the Rust side accepts mixed.
 */
export interface FsPort {
  readDir(p: string): Promise<{ name: string; isDirectory: boolean }[]>;
  readFile(p: string): Promise<Uint8Array>;
  writeFile(p: string, d: Uint8Array): Promise<void>;
  /** Recursive: creates every missing parent, and is a no-op when the folder already exists. */
  mkdir(p: string): Promise<void>;
  remove(p: string): Promise<void>;
  /** Replaces `to` if it exists. Within one folder this is atomic: readers see the old file or the new one. */
  rename(from: string, to: string): Promise<void>;
  exists(p: string): Promise<boolean>;
  /** What is at `p`, or null when nothing is. */
  stat(p: string): Promise<{ isDirectory: boolean; isFile: boolean } | null>;
  /**
   * Make sure the file's bytes are on this Mac, fetching them from iCloud if they were evicted (only
   * `.<name>.icloud` is left beside where the file was). Resolves true once the file is there, false
   * when it is not: no such file, or iCloud did not deliver it in time. Never use false to mean "gone"
   * without first checking for the placeholder.
   */
  ensureDownloaded(p: string): Promise<boolean>;
}

/** How long the Mac app waits for one file to come down from iCloud. Several are fetched at once. */
export const ICLOUD_TIMEOUT_MS = 20000;

/**
 * Some files the app manages are still in iCloud and did not arrive in time. Thrown instead of loading
 * without them: a document missing those notes would, on its next save, delete them for good.
 * `paths` are relative to the notes folder, as the vault code names files (`notes/a.md`).
 */
export class IcloudPendingError extends Error {
  readonly paths: string[];
  constructor(paths: string[]) {
    super(`Still in iCloud: ${paths.join(', ')}`);
    this.name = 'IcloudPendingError';
    this.paths = paths;
  }
}

/**
 * Atomic writes go to `<name>.tmp-<8 of a-z0-9>` beside the file, then rename over it. Exactly that
 * shape and nothing looser, so a file of his that merely contains ".tmp-" is never mistaken for ours.
 * Such names are hidden from listings and, inside the managed folders only, swept on the next load if
 * a crash left one behind.
 */
const TEMP_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const isTempName = (name: string): boolean => /^.+\.tmp-[a-z0-9]{8}$/.test(name);
export const tempNameFor = (path: string): string => {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => TEMP_ALPHABET[b % 36]).join('');
  return `${path}.tmp-${random}`;
};

/** Loaded on first use, so nothing outside the Tauri web view ever imports the plugin. */
const plugin = () => import('@tauri-apps/plugin-fs');

export const tauriFsPort: FsPort = {
  async readDir(p) {
    const entries = await (await plugin()).readDir(p);
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory }));
  },
  async readFile(p) {
    return (await plugin()).readFile(p);
  },
  async writeFile(p, d) {
    await (await plugin()).writeFile(p, d);
  },
  async mkdir(p) {
    // create_dir_all underneath: a no-op when the folder is already there
    await (await plugin()).mkdir(p, { recursive: true });
  },
  async remove(p) {
    await (await plugin()).remove(p);
  },
  async rename(from, to) {
    // std::fs::rename: replaces the target on macOS (rename(2)) and Windows (MOVEFILE_REPLACE_EXISTING)
    await (await plugin()).rename(from, to);
  },
  async exists(p) {
    return (await plugin()).exists(p);
  },
  async stat(p) {
    const fs = await plugin();
    try {
      const info = await fs.stat(p);
      return { isDirectory: info.isDirectory, isFile: info.isFile };
    } catch (err) {
      // only ask on failure: "not there" is an answer, anything else (a refused path) is an error
      if (!(await fs.exists(p))) return null;
      throw err;
    }
  },
  async ensureDownloaded(p) {
    // Rust, not the fs plugin: it looks at the placeholder on the real disk and runs `brctl download`
    // (the JS scope only lets the page ask whether a placeholder exists). See src-tauri/src/icloud.rs.
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<boolean>('ensure_downloaded', { path: p, timeout_ms: ICLOUD_TIMEOUT_MS });
  },
};

const parentOf = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf('/')));
const nameOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

/**
 * An in-memory file system for tests. It behaves like a real disk where it matters: writing into a
 * folder that does not exist fails, and a missing path rejects.
 *
 * `writes` lists the files that received new content under their own name: a direct write, or the
 * rename that lands an atomic write. Temp files are not listed, so "one edit writes one file" still
 * reads the way it should. `removals` likewise leaves out temp files.
 */
export class MemFsPort implements FsPort {
  files = new Map<string, Uint8Array>();
  dirs = new Set<string>();
  writes: string[] = [];
  removals: string[] = [];

  private isDir(p: string): boolean {
    return p === '' || this.dirs.has(p);
  }

  async readDir(p: string) {
    if (!this.isDir(p)) throw new Error(`No such folder: ${p}`);
    const prefix = `${p}/`;
    const out: { name: string; isDirectory: boolean }[] = [];
    for (const d of this.dirs) {
      if (d.startsWith(prefix) && !d.slice(prefix.length).includes('/')) {
        out.push({ name: d.slice(prefix.length), isDirectory: true });
      }
    }
    for (const f of this.files.keys()) {
      if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/')) {
        out.push({ name: f.slice(prefix.length), isDirectory: false });
      }
    }
    return out;
  }

  async readFile(p: string) {
    const bytes = this.files.get(p);
    if (!bytes) throw new Error(`No such file: ${p}`);
    return bytes.slice();
  }

  async writeFile(p: string, d: Uint8Array) {
    if (!this.isDir(parentOf(p))) throw new Error(`No such folder: ${parentOf(p)}`);
    if (this.dirs.has(p)) throw new Error(`Is a folder: ${p}`);
    this.files.set(p, d.slice());
    if (!isTempName(nameOf(p))) this.writes.push(p);
  }

  async mkdir(p: string) {
    if (this.files.has(p)) throw new Error(`Is a file: ${p}`);
    for (let at = p; at !== ''; at = parentOf(at)) this.dirs.add(at);
  }

  async remove(p: string) {
    if (this.files.delete(p)) {
      if (!isTempName(nameOf(p))) this.removals.push(p);
      return;
    }
    if (!this.dirs.has(p)) throw new Error(`No such file or folder: ${p}`);
    if ((await this.readDir(p)).length > 0) throw new Error(`Folder not empty: ${p}`);
    this.dirs.delete(p);
    this.removals.push(p);
  }

  async rename(from: string, to: string) {
    const bytes = this.files.get(from);
    if (!bytes) throw new Error(`No such file: ${from}`);
    if (!this.isDir(parentOf(to))) throw new Error(`No such folder: ${parentOf(to)}`);
    if (this.dirs.has(to)) throw new Error(`Is a folder: ${to}`);
    this.files.delete(from);
    this.files.set(to, bytes);
    this.writes.push(to);
  }

  async exists(p: string) {
    return this.files.has(p) || this.dirs.has(p);
  }

  async stat(p: string) {
    if (this.files.has(p)) return { isDirectory: false, isFile: true };
    if (this.dirs.has(p)) return { isDirectory: true, isFile: false };
    return null;
  }

  async ensureDownloaded(p: string) {
    return this.exists(p);
  }
}
