import { useEffect, useState } from 'react';
import { useHQ, useVaultBackend } from '../store';
import { useVaultAssets } from './assets';
import { supportsFileSystemAccess } from './vault-fs';
import {
  getSavedHandle,
  hasPermission,
  pickVaultDirectory,
  rememberSkipped,
  requestPermission,
  saveHandle,
  wasSkipped,
} from './vault-handle';
import { notifySaveFailed, notifyVaultReloaded } from './vault-events';
import { askToRestart, createVaultStorage, flushOnExit, flushOnQuit, readyToQuit, type VaultStorage } from './vault-storage';
import { isTauri, onAppFocus } from './platform';
import { IcloudPendingError, tauriFsPort, type FsPort } from './fs-port';
import { createTauriRoot, failFastRoot, sweepTempFiles } from './tauri-root';

export type VaultState =
  | { kind: 'checking' }
  | { kind: 'needs-permission'; dir: FileSystemDirectoryHandle } // handle saved, permission lapsed
  | { kind: 'needs-folder' } // browser: nothing saved yet
  | { kind: 'needs-folder'; suggested: string; missing?: boolean } // Tauri: first run; `missing`: the saved folder is gone
  | { kind: 'ready' }
  | { kind: 'load-error'; path?: string } // the folder is there but could not be read; nothing was written
  | { kind: 'icloud-pending'; count: number } // some notes are still in iCloud; nothing loaded or written
  | { kind: 'fallback' }; // no File System Access API — IndexedDB, as before

/** Tauri: the notes folder's absolute path. The web view's localStorage survives relaunches. */
export const VAULT_PATH_KEY = 'elmar.vaultPath';

const APP_FOLDER = "Elmar's App";

/**
 * Where the notes folder goes unless he picks another: iCloud Drive when the Mac has it, because that
 * keeps a copy off the laptop with no effort; otherwise his home folder.
 */
export async function defaultVaultPath(fs: FsPort = tauriFsPort): Promise<string> {
  const { homeDir, join } = await import('@tauri-apps/api/path');
  const home = await homeDir();
  const icloud = await join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
  return join((await fs.exists(icloud)) ? icloud : home, APP_FOLDER);
}

/**
 * React.StrictMode double-invokes effects in dev, and a second rehydrate() would double-read and
 * double-write the vault. One promise per session, shared.
 */
let booted: Promise<VaultState> | null = null;

/**
 * Notice edits made to the vault outside HQ — which is the entire point of the vault: Claude works
 * the same files, and coming back to the tab should just show its work.
 *
 * The browser has no file watcher (the File System Access API gives read/write, not notification),
 * so coming back to the app is the trigger: tab visibility in a browser, window focus in Tauri. Disk
 * wins; blast radius is the whole document but the diff means unchanged files are not touched.
 */
function watchVault(storage: Pick<VaultStorage, 'syncFromDisk'>): () => void {
  return onAppFocus(() => {
    // syncFromDisk flushes first, which retries a failed save (and its failure re-shows the toast),
    // and returns null without reloading while any edit is still unsaved.
    void storage
      .syncFromDisk()
      .then((result) => {
        if (!result) return; // nothing changed — the common case
        useHQ.setState(result.doc);
        notifyVaultReloaded(result.changed);
      })
      .catch(() => {
        // folder moved, deleted, or permission lapsed while we were away. Leave state alone rather
        // than blanking the app on a read we cannot trust.
      });
  });
}

/**
 * Point HQ at a vault folder: document, blobs, flush-on-leave, watch-on-return. Does not hydrate.
 *
 * The single place this wiring lives. The migration needs the same four things but supplies its own
 * state, so it calls this rather than repeating the list — which is how `watchVault` got missed there
 * in the first place.
 */
let attached: FileSystemDirectoryHandle | null = null;

/** The open vault folder, or null when HQ is running on browser storage. */
export const vaultDir = (): FileSystemDirectoryHandle | null => attached;

/** The storage in use. Quitting and the focus watcher always act on this one. */
let activeStorage: VaultStorage | null = null;

/**
 * Stands in for whichever storage is current. The close handler and the focus watcher are registered
 * once, against this, rather than once per `connectVault`: after "Choose another folder…" an old
 * storage's handler would otherwise destroy the window on its own schedule while the new one is still
 * writing, and an old watcher would reload from the wrong folder.
 */
const current = {
  flush: (): Promise<void> => activeStorage?.flush() ?? Promise.resolve(),
  hasUnsaved: (): boolean => activeStorage?.hasUnsaved() ?? false,
  syncFromDisk: (): ReturnType<VaultStorage['syncFromDisk']> => activeStorage?.syncFromDisk() ?? Promise.resolve(null),
};
let lifecycleInstalled = false;

/**
 * Before an update restarts the app: the same save, and the same decision, as quitting (`readyToQuit`).
 * Open editors hand over, the folder is written, and if the last change still isn't on disk he is
 * asked first. True to go ahead.
 */
export function saveBeforeRestart(): Promise<boolean> {
  return readyToQuit(activeStorage, { confirmQuit: askToRestart });
}

export function connectVault(dir: FileSystemDirectoryHandle): VaultStorage {
  // a failed save keeps the edit and retries; the toast says so rather than failing silently
  // the refocus read never waits for iCloud: it shares the queue with saves (see failFastRoot)
  const storage = createVaultStorage(dir, { onSaveError: notifySaveFailed, syncRoot: failFastRoot(dir) });
  activeStorage = storage;
  useVaultBackend(storage);
  useVaultAssets(dir);
  if (!lifecycleInstalled) {
    lifecycleInstalled = true;
    void flushOnQuit(current); // Tauri: hold the window's close for the last write; browser: flushOnUnload
    watchVault(current);
  }
  attached = dir;
  return storage;
}

/**
 * Connect and load. If loading fails, the store still hydrates (zustand reports the error and carries
 * on with its empty default), but the storage has stopped writing, so his folder is untouched; the
 * caller shows the load-error screen, or, when the only problem is notes still in iCloud, the
 * downloading screen (same safety: nothing was loaded, so nothing can be overwritten or deleted).
 */
async function attach(dir: FileSystemDirectoryHandle, path?: string): Promise<VaultState> {
  const storage = connectVault(dir);
  await useHQ.persist.rehydrate();
  if (!storage.loadFailed()) return { kind: 'ready' };
  const err = storage.loadError();
  if (err instanceof IcloudPendingError) return { kind: 'icloud-pending', count: err.paths.length };
  return { kind: 'load-error', path };
}

const OUTSIDE_HOME = 'Choose a folder inside your home folder.';
const HIDDEN_FOLDER = 'That folder is hidden. Choose one you can see in Finder.';
/** Every reason a folder can be refused, as he reads it. Exported for the copy test. */
export const FOLDER_REFUSALS = [OUTSIDE_HOME, HIDDEN_FOLDER] as const;

/**
 * Why a folder cannot hold his notes, in his words, or null when it can. It must be inside his home
 * folder (that is all the app is allowed to touch) and no part of it may be hidden (the Mac refuses
 * the app any path through a name starting with "."). Exported for tests.
 */
export function folderProblem(path: string, home: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  let p = norm(path);
  let h = norm(home);
  if (/^[a-z]:\//i.test(h)) {
    // Windows paths ignore case
    p = p.toLowerCase();
    h = h.toLowerCase();
  }
  if (!p.startsWith(`${h}/`)) return OUTSIDE_HOME;
  if (p.slice(h.length + 1).split('/').some((part) => part.startsWith('.'))) return HIDDEN_FOLDER;
  return null;
}

/**
 * The Mac app: the notes folder is a path on the real file system, reached through Tauri's fs plugin
 * behind a FileSystemDirectoryHandle stand-in, so everything from `connectVault` on is the browser code.
 *
 * Every way this can fail ends on a screen he can act on, never on the spinner:
 * - a saved folder that is gone (moved, renamed, iCloud signed out) is suggested again, not silently
 *   recreated empty;
 * - one the app may not even check (outside its scope) is replaced by the default suggestion;
 * - one that is there but cannot be read shows load-error, and nothing is written to it.
 */
async function bootTauri(): Promise<VaultState> {
  // Quitting the app (Cmd+Q) skips the window's close event: Rust holds the exit and asks for this.
  // Registered first and once, so Rust is answered at once on any screen, even before a folder is open.
  await flushOnExit(() => activeStorage).catch(() => {});

  const saved = localStorage.getItem(VAULT_PATH_KEY);
  if (saved) {
    let there: boolean | null;
    try {
      there = await tauriFsPort.exists(saved);
    } catch {
      there = null; // refused: not a folder the app may use
    }
    if (there) {
      await sweepTempFiles(saved, tauriFsPort).catch(() => []);
      return attach(createTauriRoot(saved, tauriFsPort), saved);
    }
    // gone (moved, renamed, iCloud signed out): say so, and never offer to make it again, empty
    if (there === false) return { kind: 'needs-folder', suggested: saved, missing: true };
  }
  let suggested = '';
  try {
    suggested = await defaultVaultPath();
  } catch {
    /* FirstRun still offers "Choose another folder…" */
  }
  return { kind: 'needs-folder', suggested };
}

/**
 * Tauri, from a click: check the folder, make it if needed, remember it, and open it. A folder the app
 * cannot use is refused with a plain reason before anything is made or saved.
 */
export async function openFolderAt(path: string): Promise<VaultState> {
  const { homeDir } = await import('@tauri-apps/api/path');
  const problem = folderProblem(path, await homeDir());
  if (problem) throw new Error(problem);
  await tauriFsPort.mkdir(path);
  localStorage.setItem(VAULT_PATH_KEY, path);
  await sweepTempFiles(path, tauriFsPort).catch(() => []);
  const state = await attach(createTauriRoot(path, tauriFsPort), path);
  booted = Promise.resolve(state);
  return state;
}

/**
 * Tauri, from a click: "Look again" for a saved folder that was not there. Opens it if it is back
 * (iCloud signed in again, the drive plugged in); otherwise the same screen again. Never makes it.
 */
export async function lookAgain(path: string): Promise<VaultState> {
  let there = false;
  try {
    there = await tauriFsPort.exists(path);
  } catch {
    there = false;
  }
  if (!there) return { kind: 'needs-folder', suggested: path, missing: true };
  await sweepTempFiles(path, tauriFsPort).catch(() => []);
  const state = await attach(createTauriRoot(path, tauriFsPort), path);
  booted = Promise.resolve(state);
  return state;
}

/** "Try again" on the load-error screen: start over cleanly, as on launch. */
export function retryLoad(): void {
  window.location.reload();
}

/**
 * "Try again" on the still-downloading screen: load the same folder again, in place, so the screen can
 * show the download progress. A fresh storage replaces the one that refused to load; if notes are
 * still missing, this resolves to the same screen with a new count and, again, nothing is written.
 */
export async function retryIcloud(): Promise<VaultState> {
  const path = localStorage.getItem(VAULT_PATH_KEY);
  if (!path) {
    retryLoad(); // cannot happen after a Tauri boot; start over rather than guess
    return { kind: 'checking' };
  }
  const state = await attach(createTauriRoot(path, tauriFsPort), path);
  booted = Promise.resolve(state);
  return state;
}

/** Tauri, from a click: the system folder picker. Resolves null if he cancels. */
export async function chooseFolder(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ directory: true, multiple: false, title: 'Choose a folder for your notes' });
  return typeof picked === 'string' ? picked : null;
}

async function boot(): Promise<VaultState> {
  if (isTauri()) return bootTauri();

  // Not Chromium: stay on IndexedDB. Nothing breaks, the vault is simply unavailable.
  if (!supportsFileSystemAccess()) {
    await useHQ.persist.rehydrate();
    return { kind: 'fallback' };
  }

  const dir = await getSavedHandle();
  if (!dir) {
    // "continue without a vault" is a decision, not a per-reload question
    if (await wasSkipped()) {
      await useHQ.persist.rehydrate();
      return { kind: 'fallback' };
    }
    return { kind: 'needs-folder' };
  }

  // queryPermission never prompts, so this is safe outside a gesture. Chrome drops the grant once
  // per browser session — one click, first thing in the morning.
  if (!(await hasPermission(dir))) return { kind: 'needs-permission', dir };

  return attach(dir);
}

/** Resume from a saved handle, or report what the UI must ask for. Runs at most once per session. */
export function bootVault(): Promise<VaultState> {
  booted ??= boot();
  return booted;
}

/** From a click: grant permission to the already-saved folder. */
export async function grantVault(dir: FileSystemDirectoryHandle): Promise<VaultState> {
  if (!(await requestPermission(dir))) return { kind: 'needs-permission', dir };
  const state = await attach(dir);
  booted = Promise.resolve(state);
  return state;
}

/** From a click: choose a folder and open it as the vault. */
export async function openVault(): Promise<VaultState> {
  const dir = await pickVaultDirectory();
  if (!dir) return { kind: 'needs-folder' };
  await saveHandle(dir);
  const state = await attach(dir);
  booted = Promise.resolve(state);
  return state;
}

/** Continue on IndexedDB without a vault — the escape hatch if the folder is unavailable. */
export async function skipVault(): Promise<VaultState> {
  await rememberSkipped();
  await useHQ.persist.rehydrate();
  booted = Promise.resolve({ kind: 'fallback' });
  return { kind: 'fallback' };
}

export function useVaultBoot(): [VaultState, (next: VaultState) => void] {
  const [state, setState] = useState<VaultState>({ kind: 'checking' });
  useEffect(() => {
    let alive = true;
    // never leave the spinner up: a boot that throws is a folder we could not open
    void bootVault().then(
      (s) => alive && setState(s),
      () => alive && setState({ kind: 'load-error' }),
    );
    return () => {
      alive = false;
    };
  }, []);
  return [state, setState];
}
