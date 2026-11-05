import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './jsdom-blob';
import type { FsPort, MemFsPort } from './fs-port';

/**
 * The Tauri boot path, end to end over an in-memory disk: what happens when the saved folder cannot be
 * checked, cannot be read, or should never have been chosen. The rule throughout: never write over
 * his folder, never sit on a spinner.
 */

// These tests import the real boot modules dynamically; on a loaded machine that takes longer than 5 s.
vi.setConfig({ testTimeout: 20_000 });

const h = { port: null as unknown as FsPort };

/** What the app registered on the (fake) window: close handlers and focus watchers. */
const w = vi.hoisted(() => ({
  closeHandlers: [] as ((e: { preventDefault(): void }) => unknown)[],
  focusWatchers: 0,
  onDestroy: (() => {}) as () => void,
}));

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));
vi.mock('./platform', () => ({
  isTauri: () => true,
  onAppFocus: () => {
    w.focusWatchers++;
    return () => {};
  },
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: async () => true, open: async () => null }));
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: async () => '/Users/elmar',
  join: async (...parts: string[]) => parts.join('/'),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (h: (e: { preventDefault(): void }) => unknown) => {
      w.closeHandlers.push(h);
      return () => {};
    },
    destroy: async () => w.onDestroy(),
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => {} }));
const FOLDER = "/Users/elmar/Library/Mobile Documents/com~apple~CloudDocs/Elmar's App";

/**
 * A fresh vault-boot (its boot runs once per module) whose `tauriFsPort` is this test's port. Mocked
 * per test with doMock, so a late debounced save from an earlier test lands on that test's port, never
 * on this one.
 */
async function freshBoot(port: MemFsPort) {
  vi.resetModules();
  h.port = port;
  vi.doMock('./fs-port', async () => ({
    ...(await vi.importActual<typeof import('./fs-port')>('./fs-port')),
    tauriFsPort: port as FsPort,
  }));
  return import('./vault-boot');
}

async function memPort() {
  return (await vi.importActual<typeof import('./fs-port')>('./fs-port')).MemFsPort;
}

beforeEach(() => {
  localStorage.clear();
  w.closeHandlers = [];
  w.focusWatchers = 0;
  w.onDestroy = () => {};
});
afterEach(() => localStorage.clear());

describe('Tauri boot', () => {
  it('a folder that cannot be read shows load-error and nothing is ever written to it', async () => {
    const MemFsPort = await memPort();
    class UnreadablePort extends MemFsPort {
      override async readDir(): Promise<{ name: string; isDirectory: boolean }[]> {
        throw 'forbidden path';
      }
    }
    const port = new UnreadablePort();
    await port.mkdir(`${FOLDER}/config`);
    await port.writeFile(`${FOLDER}/config/settings.yaml`, new TextEncoder().encode('userName: Elmar\n'));
    port.writes = [];
    localStorage.setItem('elmar.vaultPath', FOLDER);

    const boot = await freshBoot(port);
    const state = await boot.bootVault();
    expect(state).toEqual({ kind: 'load-error', path: FOLDER });

    // the store hydrated (empty) and its own setState reached setItem: wait out the debounce
    await new Promise((r) => setTimeout(r, 700));
    expect(port.writes).toEqual([]);
    expect(port.removals).toEqual([]);
    expect(new TextDecoder().decode(port.files.get(`${FOLDER}/config/settings.yaml`)!)).toBe('userName: Elmar\n');
  });

  it('notes still in iCloud show the downloading screen, nothing is written, and "Try again" loads them once they arrive', async () => {
    const MemFsPort = await memPort();
    const port = new MemFsPort();
    const enc = (s: string) => new TextEncoder().encode(s);
    await port.mkdir(`${FOLDER}/config`);
    await port.mkdir(`${FOLDER}/notes`);
    await port.writeFile(`${FOLDER}/config/settings.yaml`, enc('userName: Elmar\nonboarded: true\n'));
    await port.writeFile(`${FOLDER}/notes/.braai.md.icloud`, enc('plist'));
    await port.writeFile(`${FOLDER}/notes/.shed.md.icloud`, enc('plist'));
    let online = false;
    port.ensureDownloaded = async (p) => {
      if (online && !(await port.exists(p))) {
        const id = p.endsWith('braai.md') ? 'nte_braai' : 'nte_shed';
        await port.writeFile(p, enc(`---\nid: ${id}\ntitle: ${id}\n---\n`));
      }
      return port.exists(p);
    };
    port.writes = [];
    localStorage.setItem('elmar.vaultPath', FOLDER);

    const boot = await freshBoot(port);
    await expect(boot.bootVault()).resolves.toEqual({ kind: 'icloud-pending', count: 2 });

    // the store hydrated (empty) and its own setState reached setItem: wait out the debounce
    await new Promise((r) => setTimeout(r, 700));
    expect(port.writes).toEqual([]);
    expect(port.removals).toEqual([]);
    expect(port.files.has(`${FOLDER}/notes/.braai.md.icloud`)).toBe(true);

    // still offline: the same screen, still nothing written
    await expect(boot.retryIcloud()).resolves.toEqual({ kind: 'icloud-pending', count: 2 });
    expect(port.writes).toEqual([]);

    online = true;
    await expect(boot.retryIcloud()).resolves.toEqual({ kind: 'ready' });
    const { useHQ } = await import('../store');
    expect(useHQ.getState().notes.map((n) => n.id).sort()).toEqual(['nte_braai', 'nte_shed']);
    expect(useHQ.getState().settings.userName).toBe('Elmar');
  });

  it('a saved folder that cannot even be checked goes to first run, not a spinner', async () => {
    const MemFsPort = await memPort();
    class OutOfScopePort extends MemFsPort {
      override async exists(p: string): Promise<boolean> {
        if (p.startsWith('/Volumes/')) throw 'forbidden path';
        return super.exists(p);
      }
    }
    localStorage.setItem('elmar.vaultPath', '/Volumes/USB/Notes');
    const boot = await freshBoot(new OutOfScopePort());
    // the out-of-scope path is not suggested again: the default is
    await expect(boot.bootVault()).resolves.toEqual({ kind: 'needs-folder', suggested: "/Users/elmar/Elmar's App" });
  });

  it('a saved folder that is simply gone is offered again as missing, and not made again', async () => {
    const MemFsPort = await memPort();
    localStorage.setItem('elmar.vaultPath', '/Users/elmar/Notes');
    const port = new MemFsPort();
    const boot = await freshBoot(port);
    await expect(boot.bootVault()).resolves.toEqual({ kind: 'needs-folder', suggested: '/Users/elmar/Notes', missing: true });
    expect(await port.exists('/Users/elmar/Notes')).toBe(false);
  });

  it('"Look again" opens the folder once it is back, and makes nothing while it is gone', async () => {
    const MemFsPort = await memPort();
    localStorage.setItem('elmar.vaultPath', '/Users/elmar/Notes');
    const port = new MemFsPort();
    const boot = await freshBoot(port);
    await boot.bootVault();
    await expect(boot.lookAgain('/Users/elmar/Notes')).resolves.toEqual({
      kind: 'needs-folder',
      suggested: '/Users/elmar/Notes',
      missing: true,
    });
    expect(await port.exists('/Users/elmar/Notes')).toBe(false);
    await port.mkdir('/Users/elmar/Notes'); // iCloud signed in again
    await expect(boot.lookAgain('/Users/elmar/Notes')).resolves.toEqual({ kind: 'ready' });
  });

  it('opens a good folder: makes it, remembers it, and is ready', async () => {
    const MemFsPort = await memPort();
    const port = new MemFsPort();
    const boot = await freshBoot(port);
    await expect(boot.openFolderAt(FOLDER)).resolves.toEqual({ kind: 'ready' });
    expect(await port.exists(FOLDER)).toBe(true);
    expect(localStorage.getItem('elmar.vaultPath')).toBe(FOLDER);
  });
});

describe('reconnecting to another folder', () => {
  it('keeps one close handler and one focus watcher, both on the folder in use now', async () => {
    const MemFsPort = await memPort();
    /** The new folder's disk is slow, so closing without waiting for it would lose the edit. */
    class SlowPort extends MemFsPort {
      override async writeFile(p: string, d: Uint8Array): Promise<void> {
        await new Promise((r) => setTimeout(r, 15));
        return super.writeFile(p, d);
      }
    }
    const first = new MemFsPort();
    const second = new SlowPort();
    const boot = await freshBoot(first);
    const { createTauriRoot } = await import('./tauri-root');
    const { useHQ } = await import('../store');

    // as after the load-error screen's "Choose another folder…": a second connect in one session
    boot.connectVault(createTauriRoot('/first', first));
    boot.connectVault(createTauriRoot('/second', second));
    await vi.waitFor(() => expect(w.closeHandlers.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20)); // give a second registration every chance to appear
    expect(w.closeHandlers).toHaveLength(1);
    expect(w.focusWatchers).toBe(1);

    useHQ.setState({ settings: { ...useHQ.getState().settings, userName: 'Elmar' } }); // an edit, debounced
    const landedAtDestroy: boolean[] = [];
    w.onDestroy = () => {
      landedAtDestroy.push([...second.files.keys()].some((p) => p.endsWith('config/settings.yaml')));
    };
    await w.closeHandlers[0]({ preventDefault: () => {} });

    expect(landedAtDestroy).toEqual([true]); // destroyed once, after the new folder's write landed
    expect(first.writes).toEqual([]);
  });
});

describe('coming back to the app while notes are in iCloud', () => {
  /** A loaded folder, then a note evicted while the app was open. Fetching it would never finish. */
  async function loadedThenEvicted() {
    const MemFsPort = await memPort();
    const port = new MemFsPort();
    const enc = (s: string) => new TextEncoder().encode(s);
    await port.mkdir('/v/config');
    await port.mkdir('/v/notes');
    await port.writeFile('/v/config/settings.yaml', enc('userName: Elmar\nonboarded: true\n'));
    await port.writeFile('/v/notes/braai.md', enc('---\nid: nte_braai\ntitle: Braai\n---\n'));
    const boot = await freshBoot(port);
    const { createTauriRoot } = await import('./tauri-root');
    const storage = boot.connectVault(createTauriRoot('/v', port));
    const raw = (await storage.getItem('hq-data')) as string;
    const doc = JSON.parse(raw).state;
    // save it once, so every file is in the app's own form and the edit below touches only settings
    storage.setItem('hq-data', raw);
    await storage.flush();
    expect(port.files.has('/v/notes/braai.md')).toBe(true);

    port.files.delete('/v/notes/braai.md');
    await port.writeFile('/v/notes/.braai.md.icloud', enc('plist'));
    const asked: string[] = [];
    port.ensureDownloaded = (p) => {
      asked.push(p);
      return new Promise<boolean>(() => {}); // iCloud never answers
    };
    let reads = 0;
    let notesListed = false;
    const readDir = port.readDir.bind(port);
    port.readDir = async (p) => {
      if (p === '/v/config') reads++;
      if (p === '/v/notes') notesListed = true;
      return readDir(p);
    };
    port.writes = [];
    return { port, storage, asked, doc, reads: () => reads, notesListed: () => notesListed };
  }

  it('the refocus read does not wait for iCloud, and an edit made meanwhile is written promptly', async () => {
    const { port, storage, asked, doc, notesListed } = await loadedThenEvicted();
    const sync = storage.syncFromDisk().catch((e: unknown) => e);
    await vi.waitFor(() => expect(notesListed()).toBe(true)); // the read has reached the evicted note
    // an edit while that read is under way, saved at once
    storage.setItem('hq-data', JSON.stringify({ state: { ...doc, settings: { ...doc.settings, userName: 'Elmar M' } }, version: 1 }));
    await storage.flush();
    expect(port.writes).toContain('/v/config/settings.yaml');
    expect(new TextDecoder().decode(port.files.get('/v/config/settings.yaml')!)).toContain('Elmar M');
    await sync; // settled, not stuck on the download
    expect(asked).toEqual([]);
  });

  it('two quick refocuses read the folder once', async () => {
    const { storage, reads } = await loadedThenEvicted();
    await Promise.all([storage.syncFromDisk().catch(() => null), storage.syncFromDisk().catch(() => null)]);
    expect(reads()).toBe(1);
  });
});

describe('choosing a folder', () => {
  it.each([
    ['/Volumes/USB/Notes', 'Choose a folder inside your home folder.'],
    ['/Users/elmar', 'Choose a folder inside your home folder.'],
    ['/Users/elmarx/Notes', 'Choose a folder inside your home folder.'],
    ['/Users/elmar/.config/notes', "That folder is hidden. Choose one you can see in Finder."],
    ['/Users/elmar/Documents/.notes', "That folder is hidden. Choose one you can see in Finder."],
  ])('refuses %s, before saving anything', async (path, message) => {
    const MemFsPort = await memPort();
    const port = new MemFsPort();
    const boot = await freshBoot(port);
    await expect(boot.openFolderAt(path)).rejects.toThrow(message);
    expect(localStorage.getItem('elmar.vaultPath')).toBeNull();
    expect(port.dirs.size).toBe(0);
  });

  it('accepts folders inside home, on Windows too', async () => {
    const { folderProblem } = await freshBoot(new (await memPort())());
    expect(folderProblem('/Users/elmar/Documents/Notes', '/Users/elmar')).toBeNull();
    expect(folderProblem("C:\\Users\\Seank\\Elmar's App", 'C:\\Users\\seank')).toBeNull();
    expect(folderProblem('C:/Users/seank/AppData/Local/Temp/x', 'C:\\Users\\seank')).toBeNull();
  });
});
