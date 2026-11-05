import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './jsdom-blob';

const t = vi.hoisted(() => ({
  tauri: true,
  root: null as FileSystemDirectoryHandle | null,
  openPath: vi.fn(async (_p: string) => {}),
  blob: new Blob(['bytes'], { type: 'application/pdf' }) as Blob | undefined,
}));

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));
vi.mock('./platform', () => ({ isTauri: () => t.tauri, onAppFocus: () => () => {} }));
vi.mock('./vault-boot', () => ({ VAULT_PATH_KEY: 'elmar.vaultPath', vaultDir: () => t.root }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: (p: string) => t.openPath(p) }));
vi.mock('./assets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./assets')>()),
  getAssetBlob: async () => t.blob,
}));

import { MemFs } from './mem-fs';
import { useNotices } from './notice';
import { CANT_FIND_FILE, CANT_OPEN_FILE, CANT_SAVE_COPY_THERE, openAsset, saveAssetCopy, type FileHost } from './open-file';
import { ORIGINAL_NAME } from './evernote/import';
import type { Asset } from '../types';

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: '4b0c7a6e-1d2f-4c3b-9a8e-123456789abc',
  name: 'quote.pdf',
  mime: 'application/pdf',
  size: 5,
  createdAt: '2026-11-03T00:00:00.000Z',
  ...over,
});

function fakeHost(over: Partial<FileHost> = {}) {
  const calls = { opened: [] as string[], written: [] as { path: string; bytes: Uint8Array }[] };
  const host: FileHost = {
    pathOf: async (a) => `/Users/elmar/Notes/assets/${a.id}__${a.name}`,
    openPath: async (p) => {
      calls.opened.push(p);
    },
    chooseSavePath: async (name) => `/Users/elmar/Desktop/${name}`,
    writeFile: async (path, bytes) => {
      calls.written.push({ path, bytes });
    },
    ...over,
  };
  return { host, calls };
}

const notices = () => useNotices.getState().notices.map((n) => n.text);

beforeEach(() => {
  useNotices.setState({ notices: [] });
  t.tauri = true;
  t.blob = new Blob(['bytes'], { type: 'application/pdf' });
  t.openPath.mockClear();
});
afterEach(() => localStorage.clear());

describe('opening an attached file in the Mac app', () => {
  it('opens the file where it is, in the notes folder', async () => {
    const { host, calls } = fakeHost();
    await openAsset(asset(), host);
    expect(calls.opened).toEqual(['/Users/elmar/Notes/assets/4b0c7a6e-1d2f-4c3b-9a8e-123456789abc__quote.pdf']);
    expect(notices()).toEqual([]);
  });

  it('a file that is not there says so plainly', async () => {
    const { host, calls } = fakeHost({ pathOf: async () => undefined });
    await openAsset(asset(), host);
    expect(calls.opened).toEqual([]);
    expect(notices()).toEqual([CANT_FIND_FILE]);
  });

  it('a file the Mac cannot open says so plainly', async () => {
    const { host } = fakeHost({
      openPath: async () => {
        throw new Error('denied');
      },
    });
    await openAsset(asset(), host);
    expect(notices()).toEqual([CANT_OPEN_FILE]);
  });

  it('finds the real file name on disk, "Original from Evernote" included', async () => {
    const fs = new MemFs();
    const id = '9f1e2d3c-4b5a-4678-9abc-def012345678';
    fs.set(`assets/${id}__Original_from_Evernote.html`, '<html></html>');
    fs.set('assets/other__x.png', 'x');
    t.root = fs.root();
    localStorage.setItem('elmar.vaultPath', '/Users/elmar/Notes/');
    await openAsset(asset({ id, name: ORIGINAL_NAME, mime: 'text/html' })); // the real Mac app wiring
    expect(t.openPath).toHaveBeenCalledWith(`/Users/elmar/Notes/assets/${id}__Original_from_Evernote.html`);
  });

  it('the real wiring says so when the bytes are not in assets/', async () => {
    t.root = new MemFs().root();
    localStorage.setItem('elmar.vaultPath', '/Users/elmar/Notes');
    await openAsset(asset());
    expect(t.openPath).not.toHaveBeenCalled();
    expect(notices()).toEqual([CANT_FIND_FILE]);
  });
});

describe('saving a copy of an attached file', () => {
  it('writes the bytes where he chose', async () => {
    const { host, calls } = fakeHost();
    await saveAssetCopy(asset(), host);
    expect(calls.written).toHaveLength(1);
    expect(calls.written[0].path).toBe('/Users/elmar/Desktop/quote.pdf');
    expect(new TextDecoder().decode(calls.written[0].bytes)).toBe('bytes');
  });

  it('cancelling the dialog writes nothing and says nothing', async () => {
    const { host, calls } = fakeHost({ chooseSavePath: async () => null });
    await saveAssetCopy(asset(), host);
    expect(calls.written).toEqual([]);
    expect(notices()).toEqual([]);
  });

  it('a place it may not write says where to try instead', async () => {
    const { host } = fakeHost({
      writeFile: async () => {
        throw new Error('forbidden path');
      },
    });
    await saveAssetCopy(asset(), host);
    expect(notices()).toEqual([CANT_SAVE_COPY_THERE]);
  });

  it('missing bytes say so before asking where', async () => {
    t.blob = undefined;
    const chooseSavePath = vi.fn(async () => '/x');
    const { host } = fakeHost({ chooseSavePath });
    await saveAssetCopy(asset(), host);
    expect(chooseSavePath).not.toHaveBeenCalled();
    expect(notices()).toEqual([CANT_FIND_FILE]);
  });
});
