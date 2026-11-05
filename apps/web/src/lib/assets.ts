import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { readAsset, removeAsset, writeAsset } from './vault-fs';

/**
 * Blobs live outside the main hq-data document so the zustand doc stays small — and therefore outside
 * `StateStorage` entirely. This is a second, independent adapter: nothing here flows through
 * `createJSONStorage`, so pointing the store at a vault does not move the bytes with it.
 */

interface AssetBackend {
  put(id: string, blob: Blob, name: string): Promise<void>;
  get(id: string, mime?: string): Promise<Blob | undefined>;
  del(id: string): Promise<void>;
}

const key = (id: string) => `asset:${id}`;

const idbBackend: AssetBackend = {
  put: (id, blob) => idbSet(key(id), blob),
  get: (id) => idbGet<Blob>(key(id)),
  del: (id) => idbDel(key(id)),
};

const vaultBackend = (root: FileSystemDirectoryHandle): AssetBackend => ({
  put: (id, blob, name) => writeAsset(root, id, blob, name),
  get: (id, mime) => readAsset(root, id, mime),
  del: (id) => removeAsset(root, id),
});

let backend: AssetBackend = idbBackend;

/** Point attachments at a vault. Mirrors `useVaultBackend` in store.ts. */
export function useVaultAssets(root: FileSystemDirectoryHandle): void {
  backend = vaultBackend(root);
}

export const putAssetBlob = (id: string, blob: Blob, name: string): Promise<void> => backend.put(id, blob, name);

/**
 * `mime` is optional but should be passed when the caller has the `Asset`: in a vault the bytes come
 * back as a `File` whose type the browser guesses from the extension, and that guess is empty for
 * anything it does not recognise. `Asset.mime` is the authoritative value.
 */
export const getAssetBlob = (id: string, mime?: string): Promise<Blob | undefined> => backend.get(id, mime);

export const delAssetBlob = (id: string): Promise<void> => backend.del(id);

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlob(b64: string, mime: string): Blob {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
