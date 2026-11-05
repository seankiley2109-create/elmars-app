import { get as idbGet, set as idbSet } from 'idb-keyval';
import { canonical, deserialize, docEquals, serialize, type VaultDoc } from '@hq/store-fs';
import { useHQ } from '../store';
import { getAssetBlob } from './assets';
import { connectVault } from './vault-boot';
import { readManagedFiles, writeAsset, writeFile } from './vault-fs';
import { pickVaultDirectory, saveHandle } from './vault-handle';

/** Manual snapshot of the browser-storage document, taken by the move-to-a-folder button. */
const PRE_FOLDER_BACKUP_KEY = 'elmar-data-pre-folder-backup';

export type MigrateResult =
  | { ok: true; files: number; assets: number; folder: string }
  | { ok: false; error: string };

/**
 * Move the current document into a folder and switch HQ over to it.
 *
 * The order matters: verify the round trip *in memory* before writing anything. A vault that silently
 * dropped a field is worse than a failed migration, and at this point IndexedDB is still the only copy.
 */
export async function migrateToVault(): Promise<MigrateResult> {
  const dir = await pickVaultDirectory();
  if (!dir) return { ok: false, error: 'No folder chosen.' };

  const existing = await readManagedFiles(dir);
  if (existing.size > 0) {
    return { ok: false, error: 'That folder already has app data in it. Choose an empty folder.' };
  }

  const state = useHQ.getState();
  const { version: _version, ...rest } = state.exportData();
  const doc = rest as VaultDoc;

  // the gate: prove nothing is lost before this becomes the only copy.
  // docEquals, not JSON.stringify: deserialize rebuilds objects in codec field order, so stringify
  // would report loss on every identical document and this gate would never let a migration through.
  if (!docEquals(deserialize(serialize(doc)), canonical(doc))) {
    return { ok: false, error: 'Safety check failed: the folder would not save everything. Nothing was written.' };
  }

  // keep the pre-vault document reachable until the vault has been in use for a week
  const raw = await idbGet<string>('elmar-data');
  if (raw && !(await idbGet(PRE_FOLDER_BACKUP_KEY))) await idbSet(PRE_FOLDER_BACKUP_KEY, raw);

  const files = serialize(doc);
  for (const [path, content] of files) await writeFile(dir, path, content);

  // Blob bytes never travel with the document — exportData emits Asset metadata only. Same loop as
  // lib/backup.ts:26-30.
  let assets = 0;
  for (const a of doc.assets) {
    const blob = await getAssetBlob(a.id, a.mime);
    if (blob) {
      await writeAsset(dir, a.id, blob, a.name);
      assets++;
    }
  }

  await saveHandle(dir);

  // Switch over, then push the remapped document through the new backend.
  //
  // prime() first: we wrote those files directly rather than through setItem, so the differ has never
  // seen them. Without it the setState below looks like ~60 brand-new paths and rewrites the entire
  // vault it just finished writing.
  const storage = connectVault(dir);
  await storage.prime();
  useHQ.setState(doc);

  return { ok: true, files: files.size, assets, folder: dir.name };
}
