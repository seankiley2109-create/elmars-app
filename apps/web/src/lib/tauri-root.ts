import { IcloudPendingError, isTempName, tempNameFor, type FsPort } from './fs-port';
import { ASSETS_DIR, isManagedPath } from './vault-fs';

export { IcloudPendingError };

/**
 * A FileSystemDirectoryHandle stand-in over a real folder, so `vault-fs.ts`, `vault-storage.ts` and
 * `assets.ts` run unchanged inside the Tauri app, where the File System Access API does not exist.
 *
 * It implements exactly the surface `mem-fs.ts` implements, which is exactly what the vault code calls:
 * `kind`, `name`, `getDirectoryHandle`, `getFileHandle`, `removeEntry`, `entries` and `keys`; file
 * handles give `getFile` and `createWritable`. Anything else on the real interface is absent.
 *
 * Like a browser, a missing entry rejects with a DOMException named `NotFoundError` and the wrong kind
 * (a file where a folder is asked for, or the reverse) with `TypeMismatchError`. The vault code relies on
 * both to skip what is not its business, so the check is made here, by asking the port, rather than by
 * guessing from whatever error the fs plugin happens to throw.
 *
 * iCloud Drive may have moved a file's bytes off the Mac, leaving `.<name>.icloud` beside where it was.
 * Such a file is never treated as gone: `entries()` fetches it and lists it under its real name, and
 * a file it cannot fetch in time makes the listing reject with `IcloudPendingError` (see `entries`).
 */
export function createTauriRoot(rootPath: string, fs: FsPort): FileSystemDirectoryHandle {
  const root = rootPath.replace(/[\\/]+$/, '');
  const ctx: Ctx = { fs, progress: { done: 0, total: 0 }, failFast: false, gaveUp: false };
  return new TauriDir(ctx, basename(root), root, '') as unknown as FileSystemDirectoryHandle;
}

/**
 * The same folder, but reads never wait for iCloud: a file only iCloud holds is reported as still
 * there (`IcloudPendingError`) at once, without asking for it. For the refocus check, which runs in
 * the same queue as saves and must never hold them up; it is simply skipped, as for any failed read.
 * Any other handle is returned as is.
 */
export function failFastRoot(handle: FileSystemDirectoryHandle): FileSystemDirectoryHandle {
  const dir = handle as unknown as TauriDir;
  return dir instanceof TauriDir ? (dir.failFast() as unknown as FileSystemDirectoryHandle) : handle;
}

const basename = (p: string): string => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);

const notFound = (path: string) => new DOMException(`Not found: ${path}`, 'NotFoundError');
const wrongKind = (path: string, want: 'file' | 'folder') =>
  new DOMException(`Not a ${want}: ${path}`, 'TypeMismatchError');

/** iCloud's stand-in for a file it has moved off this Mac: `.<name>.icloud`. */
export const isICloudPlaceholder = (name: string): boolean => /^\.(.+)\.icloud$/.test(name);
/** `.a.md.icloud` → `a.md`; null for any other name. */
export const icloudRealName = (name: string): string | null => /^\.(.+)\.icloud$/.exec(name)?.[1] ?? null;

/** Files fetched from iCloud at once. Each may wait up to ICLOUD_TIMEOUT_MS, so a hundred evicted notes take minutes, not half an hour. */
export const ICLOUD_CONCURRENCY = 4;

export interface IcloudProgress {
  done: number;
  total: number;
}
const progressListeners = new Set<(p: IcloudProgress) => void>();

/** Hear how many files have come down from iCloud so far, for the loading screens. Returns unsubscribe. */
export function onIcloudProgress(cb: (p: IcloudProgress) => void): () => void {
  progressListeners.add(cb);
  return () => progressListeners.delete(cb);
}

/** Shared by every handle under one root: the port, and that root's download count. */
interface Ctx {
  fs: FsPort;
  progress: IcloudProgress;
  /** Never ask iCloud; anything not on disk is pending at once (`failFastRoot`). */
  failFast: boolean;
  /**
   * A listing's fetch already timed out (most likely offline): later listings under this root stop
   * waiting and report pending at once, so the downloading screen shows within one timeout, not
   * minutes. Listings only; a save still fetches the one file it needs. "Try again" makes a new root.
   */
  gaveUp: boolean;
}

/** Fetch one file for a save or a lookup. False (pending), never a throw, when it does not come. */
const fetchOne = (ctx: Ctx, path: string): Promise<boolean> =>
  ctx.failFast ? Promise.resolve(false) : ctx.fs.ensureDownloaded(path).catch(() => false);

const report = (ctx: Ctx): void => {
  const p = { ...ctx.progress };
  for (const cb of progressListeners) cb(p);
};

/**
 * Fetch these files from iCloud, a few at a time. Resolves, per path, whether it arrived. Never
 * rejects: a fetch that errors (brctl missing, refused) counts as not arrived, never as gone.
 */
async function downloadAll(ctx: Ctx, paths: string[]): Promise<boolean[]> {
  const arrived = paths.map(() => false);
  if (ctx.failFast || ctx.gaveUp) return arrived;
  ctx.progress.total += paths.length;
  report(ctx);
  let next = 0;
  const worker = async (): Promise<void> => {
    // after one timeout, the rest are not even asked for: they are pending, and he sees so now
    while (next < paths.length && !ctx.gaveUp) {
      const i = next++;
      arrived[i] = await ctx.fs.ensureDownloaded(paths[i]).catch(() => false);
      if (!arrived[i]) ctx.gaveUp = true;
      ctx.progress.done++;
      report(ctx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(ICLOUD_CONCURRENCY, paths.length) }, worker));
  if (next < paths.length) {
    // the ones never asked for are settled too (as pending), so the count reads as finished
    ctx.progress.done += paths.length - next;
    report(ctx);
  }
  return arrived;
}

/**
 * Which names a listing shows. Hidden names are skipped (`.DS_Store`, `.git`, …): on macOS the fs scope
 * refuses any path with a component starting with `.`, so touching one would fail the whole load. The
 * exceptions are the hidden folders the app manages (`.activity`) and iCloud placeholders, which the
 * scope allows explicitly (see capabilities/default.json). Temp files from atomic writes are never data.
 */
function listed(name: string): boolean {
  if (isTempName(name)) return false;
  if (!name.startsWith('.')) return true;
  return isManagedPath(name) || isICloudPlaceholder(name);
}

const MIME: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  json: 'application/json',
  jsonl: 'application/jsonl',
  html: 'text/html',
  htm: 'text/html',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  zip: 'application/zip',
  enex: 'application/xml',
};

/** As a browser does for a picked file: guessed from the extension. Asset.mime still wins in readAsset. */
export function mimeFor(name: string): string {
  const dot = name.lastIndexOf('.');
  return (dot > 0 && MIME[name.slice(dot + 1).toLowerCase()]) || 'application/octet-stream';
}

type Chunk = string | Blob | ArrayBuffer | ArrayBufferView;

async function toBytes(data: Chunk): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  throw new TypeError('Unsupported data for write');
}

class TauriFile {
  readonly kind = 'file' as const;
  constructor(
    private fs: FsPort,
    readonly name: string,
    private path: string,
  ) {}

  async getFile(): Promise<File> {
    let read: Uint8Array;
    try {
      read = await this.fs.readFile(this.path);
    } catch (err) {
      // only ask on failure: one round trip per file in the common case, and a vault has hundreds
      if (!(await this.fs.exists(this.path))) throw notFound(this.path);
      throw err;
    }
    // Copy into a fresh ArrayBuffer-backed array: File wants plain BlobParts.
    return new File([new Uint8Array(read)], this.name, { type: mimeFor(this.name) });
  }

  /**
   * Buffers every `write`; on `close`, writes the whole file to a temp name beside it and renames it
   * over the target. A crash or a full disk mid-write leaves the old file intact (plus, at worst, a
   * temp file that is never read and is swept on the next load), never a half-written note.
   */
  async createWritable() {
    const chunks: Uint8Array[] = [];
    return {
      write: async (data: Chunk) => {
        chunks.push(await toBytes(data));
      },
      close: async () => {
        const size = chunks.reduce((n, c) => n + c.byteLength, 0);
        const out = new Uint8Array(size);
        let at = 0;
        for (const c of chunks) {
          out.set(c, at);
          at += c.byteLength;
        }
        const temp = tempNameFor(this.path);
        try {
          await this.fs.writeFile(temp, out);
          await this.fs.rename(temp, this.path);
        } catch (err) {
          await this.fs.remove(temp).catch(() => {}); // may never have been created
          throw err;
        }
      },
      abort: async () => {
        chunks.length = 0;
      },
    };
  }
}

class TauriDir {
  readonly kind = 'directory' as const;
  private fs: FsPort;
  constructor(
    private ctx: Ctx,
    readonly name: string,
    private path: string,
    /** Relative to the root, as the vault code names paths: '' for the root, `notes/trip` below it. */
    private rel: string,
  ) {
    this.fs = ctx.fs;
  }

  private child(name: string): string {
    return `${this.path}/${name}`;
  }
  private relChild(name: string): string {
    return this.rel ? `${this.rel}/${name}` : name;
  }
  private dir(name: string): TauriDir {
    return new TauriDir(this.ctx, name, this.child(name), this.relChild(name));
  }
  private file(name: string): TauriFile {
    return new TauriFile(this.fs, name, this.child(name));
  }

  /** This folder, reading without ever waiting for iCloud. See `failFastRoot`. */
  failFast(): TauriDir {
    const ctx: Ctx = { ...this.ctx, progress: { done: 0, total: 0 }, failFast: true };
    return new TauriDir(ctx, this.name, this.path, this.rel);
  }

  /**
   * `name` is not on disk. If only iCloud holds it, fetch it: true once it is here; otherwise reject
   * with `IcloudPendingError`, so the caller never treats it as missing (and a save never writes beside
   * the placeholder or leaves one behind to bring a deleted note back). False when there is no
   * placeholder either: it really is not there.
   */
  private async fetchIfEvicted(name: string): Promise<boolean> {
    if (!(await this.fs.exists(this.child(`.${name}.icloud`)))) return false;
    if (await fetchOne(this.ctx, this.child(name))) return true;
    throw new IcloudPendingError([this.relChild(name)]);
  }

  /** The listing, hidden and temp names already dropped. Placeholders are kept, by their own name. */
  private async listing(): Promise<{ name: string; isDirectory: boolean }[]> {
    if (!(await this.fs.exists(this.path))) throw notFound(this.path);
    return (await this.fs.readDir(this.path)).filter((e) => listed(e.name));
  }

  /** The real names of files only iCloud holds now: a placeholder, a listable name, and no file beside it. */
  private static evicted(listing: { name: string; isDirectory: boolean }[]): string[] {
    const here = new Set(listing.filter((e) => !isICloudPlaceholder(e.name)).map((e) => e.name));
    const out = new Set<string>();
    for (const e of listing) {
      const real = icloudRealName(e.name);
      if (real !== null && !e.isDirectory && listed(real) && !here.has(real)) out.add(real);
    }
    return [...out];
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<TauriDir> {
    const path = this.child(name);
    const at = await this.fs.stat(path);
    if (at?.isFile) throw wrongKind(path, 'folder');
    if (!at) {
      if (!opts?.create) throw notFound(path);
      await this.fs.mkdir(path);
    }
    return this.dir(name);
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<TauriFile> {
    const path = this.child(name);
    const at = await this.fs.stat(path);
    if (at?.isDirectory) throw wrongKind(path, 'file');
    // Not here may mean "only in iCloud": fetch it rather than call it missing, and before writing
    // over it, so the new file never lands beside a placeholder. Only asked when the file is absent,
    // so a file that is here costs nothing extra.
    if (!at && !(await this.fetchIfEvicted(name)) && !opts?.create) throw notFound(path);
    // With `create`, a browser makes an empty file at once. Here the file appears when its writable
    // closes, which is the next thing the vault code always does: one write per save, not two, and
    // iCloud never syncs an empty note in between.
    return this.file(name);
  }

  async removeEntry(name: string): Promise<void> {
    const path = this.child(name);
    // A file only iCloud holds is fetched, then removed: removing just the placeholder is not allowed
    // here, and leaving it would bring the note back on the next load.
    if (!(await this.fs.exists(path)) && !(await this.fetchIfEvicted(name))) throw notFound(path);
    await this.fs.remove(path);
  }

  /**
   * Every entry, with each file only iCloud holds fetched first (a few at a time, starting at once, so
   * the files already here are read meanwhile) and listed under its real name.
   *
   * A file that does not arrive is not listed and not forgotten: once everything else is listed, this
   * rejects with `IcloudPendingError` naming all such files in this folder. The vault code then loads
   * nothing at all, rather than a document without them that its next save would delete them from.
   */
  async *entries(): AsyncIterableIterator<[string, TauriDir | TauriFile]> {
    const listing = await this.listing();
    const evicted = TauriDir.evicted(listing);
    const fetched = evicted.length ? downloadAll(this.ctx, evicted.map((n) => this.child(n))) : Promise.resolve([]);
    for (const e of listing) {
      if (isICloudPlaceholder(e.name)) continue;
      yield [e.name, e.isDirectory ? this.dir(e.name) : this.file(e.name)];
    }
    const arrived = await fetched;
    const pending: string[] = [];
    for (const [i, name] of evicted.entries()) {
      if (arrived[i]) yield [name, this.file(name)];
      else pending.push(this.relChild(name));
    }
    if (pending.length) throw new IcloudPendingError(pending);
  }

  /**
   * Names only, so nothing is fetched: a file only iCloud holds is listed under its real name, and
   * `getFileHandle` fetches it if it is then asked for. Finding one picture never downloads the rest.
   */
  async *keys(): AsyncIterableIterator<string> {
    const listing = await this.listing();
    for (const e of listing) if (!isICloudPlaceholder(e.name)) yield e.name;
    for (const name of TauriDir.evicted(listing)) yield name;
  }
}

/**
 * Remove temp files a crash left behind mid-save. Run before loading.
 *
 * Only inside the folders the app writes to (the managed folders and `assets/`), and only files in the
 * exact temp shape the app generates: "only managed paths are ever deleted" holds here too. His own
 * folders are never even listed, which also keeps boot quick when the notes folder holds big ones.
 * Returns the paths removed. Best effort: one that cannot be removed is left for next time.
 */
export async function sweepTempFiles(rootPath: string, fs: FsPort): Promise<string[]> {
  const root = rootPath.replace(/[\\/]+$/, '');
  const removed: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readDir(dir)) {
      const path = `${dir}/${e.name}`;
      if (!e.isDirectory && isTempName(e.name)) {
        await fs.remove(path).then(
          () => removed.push(path),
          () => {},
        );
      } else if (e.isDirectory && listed(e.name)) {
        await walk(path);
      }
    }
  };
  for (const e of await fs.readDir(root)) {
    if (e.isDirectory && (isManagedPath(e.name) || e.name === ASSETS_DIR)) await walk(`${root}/${e.name}`);
  }
  return removed;
}
