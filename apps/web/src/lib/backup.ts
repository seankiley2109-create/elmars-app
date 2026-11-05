import { NOT_A_BACKUP, useHQ, validateImport } from '../store';
import { toDateStr } from './dates';
import { isTauri } from './platform';
import { base64ToBlob, blobToBase64, delAssetBlob, getAssetBlob, putAssetBlob } from './assets';
import type { Asset, HQData } from '../types';

const SIZE_WARN_BYTES = 50 * 1024 * 1024;

/** Re-exported so the pieces of "a backup" are all found here. */
export { NOT_A_BACKUP };

/** `Elmar's App backup 2026-11-03.json`, dated by the local day. */
export function backupFileName(d: Date = new Date()): string {
  return `Elmar's App backup ${toDateStr(d)}.json`;
}

/** "3 projects, 1 task, 12 notes, 2 events and 4 attached files": plain counts for the restore question. */
export function backupSummary(c: {
  projects: number;
  tasks: number;
  notes: number;
  events: number;
  files?: number;
}): string {
  const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  const parts = [n(c.projects, 'project'), n(c.tasks, 'task'), n(c.notes, 'note')];
  if (c.files === undefined) return `${parts.join(', ')} and ${n(c.events, 'event')}`;
  return `${parts.join(', ')}, ${n(c.events, 'event')} and ${n(c.files, 'attached file')}`;
}

export type ParsedBackup = { ok: true; raw: unknown; incoming: HQData } | { ok: false; error: string };

/** Read a picked file's text as a backup of this app, or say plainly why it isn't one. */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file couldn't be read as a backup. Nothing was changed." };
  }
  const incoming = validateImport(raw);
  return incoming ? { ok: true, raw, incoming } : { ok: false, error: NOT_A_BACKUP };
}

/**
 * The full document as JSON text, inlining asset blobs as base64 under `assetsData`. `missing` names
 * the attached files whose bytes could not be read, so the caller can say so. Returns null if he
 * backed out at the large-backup question.
 */
async function backupText(): Promise<{ text: string; missing: string[] } | null> {
  const doc = useHQ.getState().exportData();

  const totalAssetBytes = doc.assets.reduce((sum, a) => sum + a.size, 0);
  if (totalAssetBytes > SIZE_WARN_BYTES) {
    const question = `Attached files add up to ${(totalAssetBytes / 1024 / 1024).toFixed(0)} MB, so the backup will be large. Continue?`;
    let go: boolean;
    if (isTauri()) {
      // the web view's own confirm is not available in the Mac app
      const { ask } = await import('@tauri-apps/plugin-dialog');
      go = await ask(question, { title: "Elmar's App", kind: 'info' });
    } else {
      go = window.confirm(question);
    }
    if (!go) return null;
  }

  const assetsData: Record<string, string> = {};
  const missing: string[] = [];
  for (const a of doc.assets) {
    try {
      const blob = await getAssetBlob(a.id, a.mime);
      if (blob) assetsData[a.id] = await blobToBase64(blob);
      else missing.push(a.name);
    } catch {
      missing.push(a.name);
    }
  }
  return { text: JSON.stringify({ ...doc, assetsData }, null, 2), missing };
}

export type SaveResult =
  | { kind: 'saved'; how: 'file' | 'download'; missing: string[] }
  | { kind: 'cancelled' }
  | { kind: 'failed'; error: string };

export const CANT_SAVE = "Couldn't save the backup.";
export const CANT_SAVE_THERE = "Couldn't save the backup there. Try another place, like Documents or Desktop.";

/**
 * Save a backup file. In the Mac app he chooses where in a save dialog; in a browser it downloads.
 * The "last backup" date is only recorded once the file really exists. Never throws: whatever goes
 * wrong comes back as `failed` with words to show.
 */
export async function saveBackup(): Promise<SaveResult> {
  try {
    const built = await backupText();
    if (built === null) return { kind: 'cancelled' };
    const { text, missing } = built;

    if (isTauri()) {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const path = await save({ defaultPath: backupFileName(), filters: [{ name: 'Backup', extensions: ['json'] }] });
      if (!path) return { kind: 'cancelled' };
      try {
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        await writeFile(path, new TextEncoder().encode(text));
      } catch {
        // a path outside the fs scope is refused here; say where to look rather than why
        return { kind: 'failed', error: CANT_SAVE_THERE };
      }
      useHQ.getState().markExported();
      return { kind: 'saved', how: 'file', missing };
    }

    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName();
    a.click();
    URL.revokeObjectURL(url);
    useHQ.getState().markExported();
    return { kind: 'saved', how: 'download', missing };
  } catch {
    return { kind: 'failed', error: CANT_SAVE };
  }
}

/** The status line after a save: what happened, and which attached files (if any) did not make it in. */
export function describeSave(r: SaveResult): { tone: 'ok' | 'warn'; text: string } {
  if (r.kind === 'failed') return { tone: 'warn', text: r.error };
  if (r.kind === 'cancelled') return { tone: 'warn', text: 'No backup was saved.' };
  const done = r.how === 'file' ? 'Backup saved' : 'Backup downloaded';
  if (r.missing.length === 0) return { tone: 'ok', text: `${done}. Keep it somewhere safe.` };
  const n = r.missing.length;
  const names = n <= 5 ? ` (${r.missing.join(', ')})` : '';
  return {
    tone: 'warn',
    text: `${done}, but ${n} attached ${n === 1 ? 'file' : 'files'} couldn't be included${names}.`,
  };
}

/** Put inlined asset blobs from a backup into the current backend. Returns the names it could not restore. */
export async function restoreAssetBlobs(raw: unknown): Promise<string[]> {
  if (typeof raw !== 'object' || raw === null) return [];
  const doc = raw as { assets?: Asset[]; assetsData?: Record<string, string> };
  if (!Array.isArray(doc.assets)) return [];
  const failed: string[] = [];
  for (const a of doc.assets) {
    const b64 = doc.assetsData?.[a.id];
    if (typeof b64 !== 'string' || b64.length === 0) {
      // the backup carries no bytes for this file; fine if it is already here, otherwise say so
      const here = await getAssetBlob(a.id, a.mime).catch(() => undefined);
      if (!here) failed.push(a.name);
      continue;
    }
    try {
      await putAssetBlob(a.id, base64ToBlob(b64, a.mime), a.name);
    } catch {
      failed.push(a.name);
    }
  }
  return failed;
}

/** The status line after a restore. `failed` names the attached files whose bytes could not be put back. */
export function describeRestore(r: RestoreResult): { tone: 'ok' | 'warn'; text: string } {
  if (!r.ok) return { tone: 'warn', text: r.error };
  if (r.failed.length === 0) return { tone: 'ok', text: 'Backup restored. Everything is back where it was.' };
  const n = r.failed.length;
  const names = n <= 5 ? ` (${r.failed.join(', ')})` : '';
  return {
    tone: 'warn',
    text: `Backup restored, but ${n} attached ${n === 1 ? 'file' : 'files'} couldn't be brought back${names}.`,
  };
}

export type RestoreResult = { ok: true; failed: string[] } | { ok: false; error: string };

/**
 * Replace everything with a backup. The document is swapped first, then blobs of attached files that
 * are not in the backup are removed (and waited for), and only then are the backup's blobs written, so
 * a delete can never land on a file the restore just wrote. Files that are in both are never deleted.
 */
export async function restoreBackup(raw: unknown): Promise<RestoreResult> {
  const state = useHQ.getState();
  const incoming = validateImport(raw);
  if (!incoming) return { ok: false, error: NOT_A_BACKUP };
  const keep = new Set(incoming.assets.map((a) => a.id));
  const stale = state.assets.filter((a) => !keep.has(a.id)).map((a) => a.id);

  const result = state.importData(raw);
  if (!result.ok) return result;
  await Promise.allSettled(stale.map((id) => delAssetBlob(id)));
  return { ok: true, failed: await restoreAssetBlobs(raw) };
}
