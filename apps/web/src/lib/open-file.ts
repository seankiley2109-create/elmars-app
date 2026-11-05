import { getAssetBlob } from './assets';
import { isTauri } from './platform';
import { showNotice } from './notice';
import { VAULT_PATH_KEY, vaultDir } from './vault-boot';
import { ASSETS_DIR, assetNameOnDisk } from './vault-fs';
import type { Asset } from '../types';

/*
 * Opening an attached file, and saving a copy of it elsewhere.
 *
 * In the Mac app the web view cannot download (an <a download> click is simply dropped), so a file is
 * opened where it already is, in the notes folder's assets/ folder, with the Mac's default app for it;
 * "Save a copy…" asks where and writes the bytes there. In a browser both hand the file over as a
 * download, as before.
 */

export const CANT_FIND_FILE = "That file couldn't be found.";
export const CANT_OPEN_FILE = "That file couldn't be opened.";
export const CANT_SAVE_COPY = "Couldn't save a copy of that file.";
export const CANT_SAVE_COPY_THERE = "Couldn't save the copy there. Try another place, like Documents or Desktop.";

/** What opening and saving need from the Mac app. Tests pass fakes. */
export interface FileHost {
  /** The file's absolute path in the notes folder, or undefined when it is not there. */
  pathOf(asset: Asset): Promise<string | undefined>;
  openPath(path: string): Promise<void>;
  /** The save dialog: the chosen path, or null if he cancelled. */
  chooseSavePath(defaultName: string): Promise<string | null>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
}

const tauriHost: FileHost = {
  async pathOf(asset) {
    const root = vaultDir();
    const folder = localStorage.getItem(VAULT_PATH_KEY);
    if (!root || !folder) return undefined;
    const name = await assetNameOnDisk(root, asset.id);
    return name ? `${folder.replace(/[\\/]+$/, '')}/${ASSETS_DIR}/${name}` : undefined;
  },
  async openPath(path) {
    const { openPath } = await import('@tauri-apps/plugin-opener');
    await openPath(path);
  },
  async chooseSavePath(defaultName) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    return save({ defaultPath: defaultName });
  },
  async writeFile(path, bytes) {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(path, bytes);
  },
};

/** The browser: hand the bytes over as a download. */
async function download(asset: Asset): Promise<void> {
  const blob = await getAssetBlob(asset.id, asset.mime).catch(() => undefined);
  if (!blob) {
    showNotice({ text: CANT_FIND_FILE });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = asset.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Open an attached file with the Mac's default app for it (a browser downloads it). Never throws. */
export async function openAsset(asset: Asset, host: FileHost | null = isTauri() ? tauriHost : null): Promise<void> {
  if (!host) return download(asset);
  const path = await host.pathOf(asset).catch(() => undefined);
  if (!path) {
    showNotice({ text: CANT_FIND_FILE });
    return;
  }
  try {
    await host.openPath(path);
  } catch {
    showNotice({ text: CANT_OPEN_FILE });
  }
}

/** Ask where, then write a copy of an attached file there (a browser downloads it). Never throws. */
export async function saveAssetCopy(asset: Asset, host: FileHost | null = isTauri() ? tauriHost : null): Promise<void> {
  if (!host) return download(asset);
  const blob = await getAssetBlob(asset.id, asset.mime).catch(() => undefined);
  if (!blob) {
    showNotice({ text: CANT_FIND_FILE });
    return;
  }
  let path: string | null;
  try {
    path = await host.chooseSavePath(asset.name);
  } catch {
    showNotice({ text: CANT_SAVE_COPY });
    return;
  }
  if (!path) return; // he cancelled
  try {
    await host.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  } catch {
    // a place outside the app's reach is refused here; say where to look rather than why
    showNotice({ text: CANT_SAVE_COPY_THERE });
  }
}
