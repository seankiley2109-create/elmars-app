import { beforeEach, describe, expect, it, vi } from 'vitest';
import './jsdom-blob';

/** saveBackup in the Mac app (dialog + fs, all faked) and the words after it. */

const t = vi.hoisted(() => ({
  tauri: true,
  blobs: new Map<string, Blob>(),
  broken: new Set<string>(),
  save: vi.fn<(o: unknown) => Promise<string | null>>(),
  ask: vi.fn<(m: string, o: unknown) => Promise<boolean>>(),
  writeFile: vi.fn<(p: string, bytes: Uint8Array) => Promise<void>>(),
}));

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));
vi.mock('./platform', () => ({ isTauri: () => t.tauri, onAppFocus: () => () => {} }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: t.save, ask: t.ask }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: t.writeFile }));
vi.mock('./assets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./assets')>()),
  getAssetBlob: async (id: string) => {
    if (t.broken.has(id)) throw new Error('unreadable');
    return t.blobs.get(id);
  },
  delAssetBlob: async () => {},
}));

import { useHQ } from '../store';
import { CANT_SAVE, CANT_SAVE_THERE, describeSave, saveBackup } from './backup';

const S = () => useHQ.getState();
const asset = (id: string, name: string, size = 10) => ({ id, name, mime: 'text/plain', size, createdAt: '2026-11-03' });

beforeEach(() => {
  S().clearAll();
  S().completeOnboarding('Elmar');
  t.tauri = true;
  t.blobs.clear();
  t.broken.clear();
  t.save.mockReset().mockResolvedValue('/Users/elmar/Documents/b.json');
  t.ask.mockReset().mockResolvedValue(true);
  t.writeFile.mockReset().mockResolvedValue(undefined);
});

describe('saving a backup in the Mac app', () => {
  it('asks where, writes the JSON as UTF-8 bytes with the attached files inside, and stamps the date', async () => {
    t.blobs.set('a1', new Blob(['hello'], { type: 'text/plain' }));
    useHQ.setState({ assets: [asset('a1', 'hello.txt')] });

    const r = await saveBackup();

    expect(r).toEqual({ kind: 'saved', how: 'file', missing: [] });
    expect(t.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: expect.stringMatching(/^Elmar's App backup \d{4}-\d{2}-\d{2}\.json$/) }));
    const [path, bytes] = t.writeFile.mock.calls[0];
    expect(path).toBe('/Users/elmar/Documents/b.json');
    const doc = JSON.parse(new TextDecoder().decode(bytes));
    expect(doc.version).toBe(1);
    expect(atob(doc.assetsData.a1)).toBe('hello');
    expect(S().settings.lastExportAt).toBeDefined();
    expect(describeSave(r)).toEqual({ tone: 'ok', text: 'Backup saved. Keep it somewhere safe.' });
  });

  it('writes nothing and stamps nothing when he closes the dialog', async () => {
    t.save.mockResolvedValue(null);
    expect(await saveBackup()).toEqual({ kind: 'cancelled' });
    expect(t.writeFile).not.toHaveBeenCalled();
    expect(S().settings.lastExportAt).toBeUndefined();
  });

  it('a place the app may not write says so plainly, and does not stamp the date', async () => {
    t.writeFile.mockRejectedValue(new Error('forbidden path'));
    const r = await saveBackup();
    expect(r).toEqual({ kind: 'failed', error: "Couldn't save the backup there. Try another place, like Documents or Desktop." });
    expect(r.kind === 'failed' && r.error).toBe(CANT_SAVE_THERE);
    expect(S().settings.lastExportAt).toBeUndefined();
  });

  it('any other failure, even before the dialog, becomes a message and never throws', async () => {
    t.save.mockRejectedValue(new Error('dialog broke'));
    expect(await saveBackup()).toEqual({ kind: 'failed', error: CANT_SAVE });
    expect(CANT_SAVE).toBe("Couldn't save the backup.");

    t.save.mockResolvedValue('/x.json');
    useHQ.setState({ assets: [asset('big', 'big.bin', 60 * 1024 * 1024)] });
    t.ask.mockRejectedValue(new Error('no dialog'));
    expect(await saveBackup()).toEqual({ kind: 'failed', error: CANT_SAVE });
  });

  it('asks about a very large backup with the app dialog, and stops if he says no', async () => {
    useHQ.setState({ assets: [asset('big', 'big.bin', 60 * 1024 * 1024)] });
    t.blobs.set('big', new Blob(['x']));
    t.ask.mockResolvedValue(false);
    expect(await saveBackup()).toEqual({ kind: 'cancelled' });
    expect(t.ask).toHaveBeenCalledWith(expect.stringContaining('60 MB'), expect.anything());
    expect(t.save).not.toHaveBeenCalled();

    t.ask.mockResolvedValue(true);
    expect((await saveBackup()).kind).toBe('saved');
  });

  it('counts attached files it could not read, whether missing or unreadable, and says which', async () => {
    t.blobs.set('ok', new Blob(['fine']));
    t.broken.add('b2');
    useHQ.setState({
      assets: [asset('ok', 'fine.txt'), asset('b1', 'lost.pdf'), asset('b2', 'locked.png'), asset('b3', 'gone.jpg')],
    });

    const r = await saveBackup();
    expect(r).toEqual({ kind: 'saved', how: 'file', missing: ['lost.pdf', 'locked.png', 'gone.jpg'] });
    expect(describeSave(r)).toEqual({
      tone: 'warn',
      text: "Backup saved, but 3 attached files couldn't be included (lost.pdf, locked.png, gone.jpg).",
    });
  });

  it('names no files past five, and says "file" for one', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(describeSave({ kind: 'saved', how: 'file', missing: six }).text).toBe(
      "Backup saved, but 6 attached files couldn't be included.",
    );
    expect(describeSave({ kind: 'saved', how: 'download', missing: ['x.pdf'] }).text).toBe(
      "Backup downloaded, but 1 attached file couldn't be included (x.pdf).",
    );
  });
});
