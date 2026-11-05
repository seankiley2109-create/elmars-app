/**
 * Thin File System Access API helpers over a vault directory.
 *
 * Everything here is deliberately restricted to *managed* paths (see `isManagedPath`). The storage
 * adapter deletes any tracked path that a save no longer produces, so if this walker ever returned
 * `.git/config` or an attachment, that logic would delete the user's own repo or files. The allowlist is
 * the safety property — not an optimisation.
 */
import { isSafeId } from '@hq/core/validate';
import { IcloudPendingError } from './fs-port';

/**
 * Directories the serializer owns outright. Anything else in the vault is none of our business.
 *
 * **This list must cover every directory a codec writes.** Nothing in the type system connects the
 * two, and the gap is silent in the worst way: a codec writes files the walker never reads back, so
 * the collection loads empty and its links dangle. `vault-fs.test.ts` pins it by serializing the
 * full fixture and asserting every path it produces is managed — add a codec, add it here.
 */
const MANAGED_DIRS = ['config', 'projects', 'notes', 'tasks', 'events', '.activity'] as const;

/** Managed files at the vault root. */
const MANAGED_ROOT_FILES: readonly string[] = [];

/** Asset bytes live here. Written by lib/assets.ts, never by the serializer — so never tracked. */
export const ASSETS_DIR = 'assets';

export function isManagedPath(path: string): boolean {
  if (MANAGED_ROOT_FILES.includes(path)) return true;
  const top = path.split('/')[0];
  return (MANAGED_DIRS as readonly string[]).includes(top);
}

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

async function getDir(
  root: FileSystemDirectoryHandle,
  segments: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle | undefined> {
  let dir = root;
  for (const seg of segments) {
    try {
      dir = await dir.getDirectoryHandle(seg, { create });
    } catch {
      return undefined; // missing and not creating
    }
  }
  return dir;
}

/**
 * Files still in iCloud (the Mac app) are collected, not fatal on the spot: the walk carries on so
 * the count he is shown covers every folder, then `readManagedFiles` rejects with all of them.
 */
async function walk(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: Map<string, string>,
  pending: string[],
): Promise<void> {
  try {
    for await (const [name, handle] of dir.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') {
        await walk(handle as FileSystemDirectoryHandle, path, out, pending);
      } else {
        out.set(path, await (await (handle as FileSystemFileHandle).getFile()).text());
      }
    }
  } catch (err) {
    // thrown once a folder's listing is done, so everything else in it has been read
    if (err instanceof IcloudPendingError) pending.push(...err.paths);
    else throw err;
  }
}

/**
 * Read every managed file in the vault. Unmanaged trees (.git, .obsidian, assets/) are not touched.
 * Rejects with `IcloudPendingError` if any managed file is still in iCloud: a partial read must never
 * be loaded, because the next save would delete whatever it lacked.
 */
export async function readManagedFiles(root: FileSystemDirectoryHandle): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const pending: string[] = [];

  for (const name of MANAGED_ROOT_FILES) {
    try {
      const fh = await root.getFileHandle(name);
      out.set(name, await (await fh.getFile()).text());
    } catch (err) {
      if (err instanceof IcloudPendingError) pending.push(...err.paths);
      /* otherwise absent — an empty collection, not an error */
    }
  }

  for (const name of MANAGED_DIRS) {
    const dir = await getDir(root, [name], false);
    if (dir) await walk(dir, name, out, pending);
  }
  if (pending.length) throw new IcloudPendingError(pending.sort());
  return out;
}

/** Everything in the vault, managed or not, for the browser. Skips trees that are none of our business. */
const HIDDEN = ['.git', 'node_modules', '.obsidian'];

export async function readVaultTree(root: FileSystemDirectoryHandle): Promise<string[]> {
  const out: string[] = [];
  const walkAll = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    for await (const [name, handle] of dir.entries()) {
      if (HIDDEN.includes(name)) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') await walkAll(handle as FileSystemDirectoryHandle, path);
      else out.push(path);
    }
  };
  await walkAll(root, '');
  return out.sort();
}

/** Read one file for preview. Returns undefined for anything that isn't readable text. */
export async function readVaultFile(root: FileSystemDirectoryHandle, path: string): Promise<string | undefined> {
  const segments = path.split('/');
  const name = segments.pop()!;
  const dir = await getDir(root, segments, false);
  if (!dir) return undefined;
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    return await file.text();
  } catch {
    return undefined;
  }
}

export async function writeFile(root: FileSystemDirectoryHandle, path: string, content: string): Promise<void> {
  const segments = path.split('/');
  const file = segments.pop()!;
  const dir = await getDir(root, segments, true);
  if (!dir) throw new Error(`Cannot create directory for ${path}`);
  const handle = await dir.getFileHandle(file, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function removeFile(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  if (!isManagedPath(path)) throw new Error(`Refusing to delete unmanaged path: ${path}`);
  const segments = path.split('/');
  const file = segments.pop()!;
  const dir = await getDir(root, segments, false);
  if (!dir) return;
  try {
    await dir.removeEntry(file);
  } catch (err) {
    // Already gone is fine. Anything else (a note still in iCloud, a refused path) fails the save,
    // which keeps the edit and retries it, rather than pretending the file was removed.
    if (!(err instanceof DOMException && err.name === 'NotFoundError')) throw err;
  }
}

/* ------------------------------------------------------------------ assets */

/** `<id>__<name>` — the id is the identity; the name is there so the folder is browsable. */
const safeName = (name: string): string => name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);

/**
 * The file name for an asset, always one plain name inside assets/. An id that is not one the app
 * makes (a crafted backup's `../../x`) is refused, so nothing can be written outside that folder.
 */
export function assetFileName(id: string, name: string): string {
  if (!isSafeId(id)) throw new Error(`Refusing an unsafe attachment id: ${JSON.stringify(id)}`);
  const file = `${id}__${safeName(name)}`;
  if (file.includes('/') || file.includes('\\') || file === '.' || file === '..') throw new Error(`Refusing an unsafe attachment name: ${file}`);
  return file;
}

export async function writeAsset(root: FileSystemDirectoryHandle, id: string, blob: Blob, name: string): Promise<void> {
  assetFileName(id, name); // refuse before anything is touched
  await removeAsset(root, id); // the name may have changed; never leave two files for one id
  const dir = await root.getDirectoryHandle(ASSETS_DIR, { create: true });
  const handle = await dir.getFileHandle(assetFileName(id, name), { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function findAsset(
  root: FileSystemDirectoryHandle,
  id: string,
): Promise<{ dir: FileSystemDirectoryHandle; name: string } | undefined> {
  if (!isSafeId(id)) return undefined;
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await root.getDirectoryHandle(ASSETS_DIR);
  } catch {
    return undefined;
  }
  for await (const name of dir.keys()) {
    if (name.startsWith(`${id}__`)) return { dir, name };
  }
  return undefined;
}

/** The asset's file name in assets/ as it is on disk, or undefined when it is not there. */
export async function assetNameOnDisk(root: FileSystemDirectoryHandle, id: string): Promise<string | undefined> {
  return (await findAsset(root, id))?.name;
}

export async function readAsset(root: FileSystemDirectoryHandle, id: string, mime?: string): Promise<Blob | undefined> {
  const hit = await findAsset(root, id);
  if (!hit) return undefined;
  const file = await (await hit.dir.getFileHandle(hit.name)).getFile();
  // the browser guesses File.type from the extension; Asset.mime is authoritative when we have it
  if (mime && file.type !== mime) return new Blob([await file.arrayBuffer()], { type: mime });
  return file;
}

export async function removeAsset(root: FileSystemDirectoryHandle, id: string): Promise<void> {
  const hit = await findAsset(root, id);
  if (hit) await hit.dir.removeEntry(hit.name).catch(() => {});
}
