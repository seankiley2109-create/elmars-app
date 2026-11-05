import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';

/**
 * The directory handle itself still lives in IndexedDB — it is the one thing that cannot live in the
 * vault. IndexedDB stores handles by structured clone, so it survives a reload; the *permission*
 * does not, which is why Chrome asks for the folder once per browser session.
 */
const HANDLE_KEY = 'hq-vault-dir';

/** Remembers "continue without a vault". Without it, the boot screen re-asks on every reload. */
const SKIPPED_KEY = 'hq-vault-skipped';

/** `queryPermission`/`requestPermission` are not in lib.dom yet. */
type Permissioned = FileSystemDirectoryHandle & {
  queryPermission(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
};

export const getSavedHandle = (): Promise<FileSystemDirectoryHandle | undefined> =>
  idbGet<FileSystemDirectoryHandle>(HANDLE_KEY);

export const saveHandle = (dir: FileSystemDirectoryHandle): Promise<void> => idbSet(HANDLE_KEY, dir);

export const forgetHandle = (): Promise<void> => idbDel(HANDLE_KEY);

export const wasSkipped = async (): Promise<boolean> => (await idbGet<boolean>(SKIPPED_KEY)) === true;

export const rememberSkipped = (): Promise<void> => idbSet(SKIPPED_KEY, true);

/** True if we already hold readwrite. Never prompts — safe to call outside a user gesture. */
export async function hasPermission(dir: FileSystemDirectoryHandle): Promise<boolean> {
  const h = dir as Permissioned;
  if (typeof h.queryPermission !== 'function') return true;
  return (await h.queryPermission({ mode: 'readwrite' })) === 'granted';
}

/** Prompts. Must be called from a user gesture or the browser rejects it. */
export async function requestPermission(dir: FileSystemDirectoryHandle): Promise<boolean> {
  const h = dir as Permissioned;
  if (typeof h.requestPermission !== 'function') return true;
  return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Prompts for a folder. Returns undefined if the user cancelled. */
export async function pickVaultDirectory(): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    return await window.showDirectoryPicker({ id: 'hq-vault', mode: 'readwrite' });
  } catch {
    return undefined; // AbortError — the user closed the picker
  }
}
