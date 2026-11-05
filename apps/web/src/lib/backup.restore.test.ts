import { beforeEach, describe, expect, it, vi } from 'vitest';
import './jsdom-blob';

/** Restoring a backup against an in-memory attachment store that logs every call in order. */

const t = vi.hoisted(() => ({
  store: new Map<string, string>(),
  log: [] as string[],
  failPut: new Set<string>(),
  slowDelete: false,
}));

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));
vi.mock('./assets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./assets')>()),
  putAssetBlob: async (id: string, blob: Blob) => {
    if (t.failPut.has(id)) throw new Error('disk full');
    t.log.push(`put ${id}`);
    t.store.set(id, await blob.text());
  },
  getAssetBlob: async (id: string) => (t.store.has(id) ? new Blob([t.store.get(id)!]) : undefined),
  delAssetBlob: async (id: string) => {
    if (t.slowDelete) await new Promise((r) => setTimeout(r, 20));
    t.log.push(`del ${id}`);
    t.store.delete(id);
  },
}));

import { useHQ } from '../store';
import { describeRestore, restoreBackup } from './backup';

const S = () => useHQ.getState();
const asset = (id: string, name: string) => ({ id, name, mime: 'text/plain', size: 3, createdAt: '2026-11-03' });
const b64 = (s: string) => btoa(s);

beforeEach(() => {
  S().clearAll();
  S().completeOnboarding('Elmar');
  t.store.clear();
  t.log.length = 0;
  t.failPut.clear();
  t.slowDelete = false;
});

describe('restoring a backup', () => {
  it('puts the attached files back (the bytes are in the backend afterwards)', async () => {
    const raw = { ...S().exportData(), assets: [asset('a1', 'one.txt')], assetsData: { a1: b64('one') } };
    expect(await restoreBackup(raw)).toEqual({ ok: true, failed: [] });
    expect(t.store.get('a1')).toBe('one');
    expect(S().assets.map((a) => a.id)).toEqual(['a1']);
  });

  it('never deletes a file that is also in the backup, and finishes every delete before the first write', async () => {
    useHQ.setState({ assets: [asset('old', 'old.txt'), asset('both', 'both.txt')] });
    t.store.set('old', 'OLD');
    t.store.set('both', 'BOTH-OLD');
    t.slowDelete = true;

    const raw = {
      ...S().exportData(),
      assets: [asset('both', 'both.txt'), asset('new', 'new.txt')],
      assetsData: { both: b64('BOTH-NEW'), new: b64('NEW') },
    };
    const r = await restoreBackup(raw);

    expect(r).toEqual({ ok: true, failed: [] });
    expect(t.log).not.toContain('del both');
    expect(t.log.filter((l) => l.startsWith('del'))).toEqual(['del old']);
    expect(t.log.indexOf('del old')).toBeLessThan(t.log.indexOf('put both'));
    expect(t.store.has('old')).toBe(false);
    expect(t.store.get('both')).toBe('BOTH-NEW');
    expect(t.store.get('new')).toBe('NEW');
  });

  it('says which attached files could not be put back, and keeps one that is already here', async () => {
    useHQ.setState({ assets: [asset('here', 'here.txt')] });
    t.store.set('here', 'HERE');
    t.failPut.add('bad');
    const raw = {
      ...S().exportData(),
      assets: [asset('here', 'here.txt'), asset('bad', 'bad.txt'), asset('nodata', 'nodata.txt')],
      assetsData: { bad: b64('x') },
    };
    const r = await restoreBackup(raw);
    expect(r).toEqual({ ok: true, failed: ['bad.txt', 'nodata.txt'] });
    expect(t.store.get('here')).toBe('HERE');
    expect(describeRestore(r)).toEqual({
      tone: 'warn',
      text: "Backup restored, but 2 attached files couldn't be brought back (bad.txt, nodata.txt).",
    });
  });

  it('refuses a file that is not a backup, without touching anything', async () => {
    useHQ.setState({ assets: [asset('keep', 'keep.txt')] });
    t.store.set('keep', 'K');
    const r = await restoreBackup({ ...S().exportData(), version: 6 });
    expect(r).toEqual({ ok: false, error: "This isn't a backup from Elmar's App." });
    expect(t.log).toEqual([]);
    expect(S().assets).toHaveLength(1);
  });
});
