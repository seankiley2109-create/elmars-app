import { afterEach, describe, expect, it, vi } from 'vitest';
import './jsdom-blob';
import { fullFixture, type VaultDoc } from '@hq/store-fs';
import { MemFsPort } from './fs-port';
import { createTauriRoot } from './tauri-root';
import { createVaultStorage, flushOnExit, flushOnQuit, type ExitSource, type QuitWindow } from './vault-storage';

/**
 * The three ways an edit could still be lost after Task 5: quitting the app outright (Cmd+Q), a
 * reload from disk landing on top of an edit that never reached it, and a save that throws before it
 * writes anything. Each is pinned here.
 */

const envelope = (state: unknown) => JSON.stringify({ state, version: 1 });
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** A disk that can be told to refuse every write, and later to recover. */
class BrokenPort extends MemFsPort {
  broken = false;
  override async writeFile(p: string, d: Uint8Array): Promise<void> {
    if (this.broken) throw new Error('disk said no');
    return super.writeFile(p, d);
  }
}

/** A saved fixture, read back so the differ is seeded as it is at boot. */
async function primed(onSaveError = vi.fn()) {
  const port = new BrokenPort();
  const seed = createVaultStorage(createTauriRoot('/v', port));
  seed.setItem('hq-data', envelope(fullFixture()));
  await seed.flush();

  const storage = createVaultStorage(createTauriRoot('/v', port), { onSaveError });
  await storage.getItem('hq-data');
  port.writes = [];
  return { port, storage, onSaveError };
}

const projectPath = async (port: MemFsPort, name: string) => {
  for (const [p, b] of port.files) if (p.startsWith('/v/projects/') && text(b).includes(`name: ${name}`)) return p;
  throw new Error(`no file for ${name}`);
};

afterEach(() => {
  vi.useRealTimers();
});

describe('a reload never lands on an unsaved edit', () => {
  it('skips the reload while a save has failed, keeps the edit, and writes it once the disk recovers', async () => {
    const { port, storage, onSaveError } = await primed();
    const first = fullFixture().projects[0];
    const path = await projectPath(port, first.name);

    port.broken = true;
    const edited: VaultDoc = fullFixture();
    edited.projects[0].nextStep = 'Ring the plumber';
    storage.setItem('hq-data', envelope(edited));
    await storage.flush();
    expect(onSaveError).toHaveBeenCalledTimes(1);
    expect(storage.hasUnsaved()).toBe(true);

    // Meanwhile something else changed a file on disk. Normally a refocus would reload it.
    const other = await projectPath(port, fullFixture().projects[1].name);
    port.files.set(other, new TextEncoder().encode(text(port.files.get(other)!).replace(/status: \w+/, 'status: blocked')));

    // Refocus while the disk is still broken: the retry fails again, and nothing is reloaded.
    expect(await storage.syncFromDisk()).toBeNull();
    expect(onSaveError).toHaveBeenCalledTimes(2); // the retry happened and said so again
    expect(storage.hasUnsaved()).toBe(true);
    expect(text(port.files.get(path)!)).not.toContain('Ring the plumber');

    // The disk recovers: the next flush writes the edit, and the store is clean again.
    port.broken = false;
    await storage.flush();
    expect(text(port.files.get(path)!)).toContain('Ring the plumber');
    expect(storage.hasUnsaved()).toBe(false);

    // Only now does a refocus pick up the outside change.
    const result = await storage.syncFromDisk();
    expect(result?.changed).toEqual([other.slice('/v/'.length)]);
    expect(result?.doc.projects.find((p) => p.id === first.id)?.nextStep).toBe('Ring the plumber');
  });

  it('skips the reload when an edit arrives while the disk is being read', async () => {
    const { port, storage } = await primed();
    const other = await projectPath(port, fullFixture().projects[1].name);
    port.files.set(other, new TextEncoder().encode(text(port.files.get(other)!).replace(/status: \w+/, 'status: blocked')));

    // Slow reads give the edit a window to land mid-sync.
    const read = port.readFile.bind(port);
    let typed = false;
    port.readFile = async (p: string) => {
      if (!typed) {
        typed = true;
        const edited = fullFixture();
        edited.projects[0].nextStep = 'Typed during the read';
        storage.setItem('hq-data', envelope(edited));
      }
      return read(p);
    };

    expect(await storage.syncFromDisk()).toBeNull();
    expect(storage.hasUnsaved()).toBe(true);
    await storage.flush();
    expect(storage.hasUnsaved()).toBe(false);
  });
});

describe('a save that throws before writing', () => {
  it('reports it through onSaveError, never as an unhandled rejection, and keeps the edit for retry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { port, storage, onSaveError } = await primed();
    const unhandled = vi.fn();
    // vitest runs in Node: an unhandled rejection surfaces on `process`, which the DOM types don't know
    type Proc = { on(e: string, f: (r: unknown) => void): void; off(e: string, f: (r: unknown) => void): void };
    const proc = (globalThis as unknown as { process: Proc }).process;
    proc.on('unhandledRejection', unhandled);
    try {
      // a document that breaks the serializer's invariants: projects must be an array
      storage.setItem('hq-data', envelope({ ...fullFixture(), projects: 42 }));
      await vi.advanceTimersByTimeAsync(600); // the debounced save fires on its own, as in the app
      await Promise.resolve();

      expect(onSaveError).toHaveBeenCalledTimes(1);
      expect(storage.hasUnsaved()).toBe(true);
      expect(port.writes).toEqual([]);

      // a good edit replaces it and goes through
      const edited = fullFixture();
      edited.projects[0].nextStep = 'Fixed';
      storage.setItem('hq-data', envelope(edited));
      await storage.flush();
      expect(port.writes).toHaveLength(1);
      expect(storage.hasUnsaved()).toBe(false);
    } finally {
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 10)); // let any stray rejection be reported
      proc.off('unhandledRejection', unhandled);
    }
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe('flushOnExit', () => {
  /** Stands in for Rust's "the app wants to quit" event and the command that lets it. */
  function fakeSource() {
    let fire: (() => void) | undefined;
    const exit = vi.fn(async () => {});
    const hold = vi.fn(async () => {});
    const cancel = vi.fn(async () => {});
    const source: ExitSource = {
      onExitRequested: async (cb) => {
        fire = cb;
        return () => {
          fire = undefined;
        };
      },
      hold,
      exit,
      cancel,
    };
    return { source, exit, hold, cancel, request: () => fire?.() };
  }

  /** The two things quitting needs from the storage. */
  const stub = (flush: () => Promise<void>, unsaved = false) => ({ flush, hasUnsaved: () => unsaved });

  it('tells Rust the page is alive, then flushes before it lets the app exit', async () => {
    const { source, exit, hold, request } = fakeSource();
    let release: (() => void) | undefined;
    const flushed = vi.fn();
    const flush = () =>
      new Promise<void>((r) => {
        release = () => {
          flushed();
          r();
        };
      });

    await flushOnExit(() => stub(flush), source);
    request();
    await vi.waitFor(() => expect(release).toBeDefined()); // the save has started
    expect(hold).toHaveBeenCalledTimes(1); // and Rust was told first: its fallback stands down
    expect(hold.mock.invocationCallOrder[0]).toBeLessThan(exit.mock.invocationCallOrder[0] ?? Infinity);
    expect(exit).not.toHaveBeenCalled(); // still writing

    release!();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1));
    expect(flushed.mock.invocationCallOrder[0]).toBeLessThan(exit.mock.invocationCallOrder[0]);
  });

  it('exits at once when no folder is open yet', async () => {
    const { source, exit, request } = fakeSource();
    await flushOnExit(() => null, source);
    request();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1));
  });

  it('stops waiting after the timeout and asks, so a stuck disk cannot hang the app', async () => {
    vi.useFakeTimers();
    const { source, exit, request } = fakeSource();
    const confirmQuit = vi.fn(async () => true);
    await flushOnExit(() => stub(() => new Promise<void>(() => {}), true), source, { timeoutMs: 5000, confirmQuit });
    request();
    await vi.advanceTimersByTimeAsync(4999);
    expect(confirmQuit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(confirmQuit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('keeps the app open when the save failed and he chooses Keep open, and holds the next Quit again', async () => {
    const { source, exit, cancel, request } = fakeSource();
    const confirmQuit = vi.fn(async () => false);
    await flushOnExit(() => stub(async () => {}, true), source, { confirmQuit });
    request();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(exit).not.toHaveBeenCalled();

    confirmQuit.mockResolvedValueOnce(true);
    request(); // not ignored: the first request is over
    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1));
    expect(confirmQuit).toHaveBeenCalledTimes(2);
  });

  it('ignores repeated requests while one is in hand', async () => {
    const { source, exit, request } = fakeSource();
    let release: (() => void) | undefined;
    await flushOnExit(() => stub(() => new Promise<void>((r) => (release = r))), source);
    request();
    request();
    await vi.waitFor(() => expect(release).toBeDefined());
    request();
    release!();
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

describe('flushOnQuit (closing the window)', () => {
  function fakeWindow() {
    let onClose: ((e: { preventDefault(): void }) => unknown) | undefined;
    const win: QuitWindow = {
      onCloseRequested: async (h) => {
        onClose = h;
        return () => {};
      },
      destroy: vi.fn(async () => {}),
    };
    return { win, close: () => onClose!({ preventDefault: () => {} }) };
  }

  it('does not destroy the window while the last save failed, if he chooses Keep open', async () => {
    const { port, storage } = await primed();
    port.broken = true;
    const edited = fullFixture();
    edited.projects[0].nextStep = 'Ring the plumber';
    storage.setItem('hq-data', envelope(edited));

    const { win, close } = fakeWindow();
    const confirmQuit = vi.fn(async () => false);
    await flushOnQuit(storage, win, { confirmQuit });
    await close();

    expect(confirmQuit).toHaveBeenCalledTimes(1);
    expect(win.destroy).not.toHaveBeenCalled();
    expect(storage.hasUnsaved()).toBe(true);
  });

  it('closes after he chooses Quit anyway', async () => {
    const { port, storage } = await primed();
    port.broken = true;
    storage.setItem('hq-data', envelope({ ...fullFixture(), settings: { ...fullFixture().settings, userName: 'E' } }));
    const { win, close } = fakeWindow();
    await flushOnQuit(storage, win, { confirmQuit: async () => true });
    await close();
    expect(win.destroy).toHaveBeenCalledTimes(1);
  });

  it('closes without asking when everything saved', async () => {
    const { storage } = await primed();
    storage.setItem('hq-data', envelope(fullFixture()));
    const { win, close } = fakeWindow();
    const confirmQuit = vi.fn(async () => false);
    await flushOnQuit(storage, win, { confirmQuit });
    await close();
    expect(confirmQuit).not.toHaveBeenCalled();
    expect(win.destroy).toHaveBeenCalledTimes(1);
  });

  it('stops waiting on a stuck disk after the timeout and asks', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { port, storage } = await primed();
    port.writeFile = () => new Promise<void>(() => {}); // never answers
    storage.setItem('hq-data', envelope({ ...fullFixture(), settings: { ...fullFixture().settings, userName: 'E' } }));
    const { win, close } = fakeWindow();
    const confirmQuit = vi.fn(async () => true);
    await flushOnQuit(storage, win, { confirmQuit, timeoutMs: 5000 });
    const closing = close();
    await vi.advanceTimersByTimeAsync(5000);
    await closing;
    expect(confirmQuit).toHaveBeenCalledTimes(1); // the write was still in flight: not saved
    expect(win.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('closing the window and quitting at once', () => {
  it('asks "Quit anyway?" once, and both act on the one answer', async () => {
    const { port, storage } = await primed();
    port.broken = true;
    storage.setItem('hq-data', envelope({ ...fullFixture(), settings: { ...fullFixture().settings, userName: 'E' } }));

    let answer!: (quit: boolean) => void;
    const confirmQuit = vi.fn(() => new Promise<boolean>((r) => (answer = r)));

    let onClose: ((e: { preventDefault(): void }) => unknown) | undefined;
    const win: QuitWindow = {
      onCloseRequested: async (h) => {
        onClose = h;
        return () => {};
      },
      destroy: vi.fn(async () => {}),
    };
    await flushOnQuit(storage, win, { confirmQuit });

    let fire!: () => void;
    const exit = vi.fn(async () => {});
    await flushOnExit(
      () => storage,
      {
        onExitRequested: async (cb) => {
          fire = cb;
          return () => {};
        },
        hold: async () => {},
        exit,
        cancel: async () => {},
      },
      { confirmQuit },
    );

    const closing = onClose!({ preventDefault: () => {} });
    fire(); // Cmd+Q while the close is still deciding
    await vi.waitFor(() => expect(confirmQuit).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(confirmQuit).toHaveBeenCalledTimes(1);

    answer(true);
    await closing;
    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1));
    expect(win.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('a folder that fails to load', () => {
  it('is never written to: not the empty document, not anything', async () => {
    class UnreadablePort extends BrokenPort {
      override async readDir(): Promise<{ name: string; isDirectory: boolean }[]> {
        throw 'forbidden path';
      }
    }
    const port = new UnreadablePort();
    await port.mkdir('/v/config');
    await port.writeFile('/v/config/settings.yaml', new TextEncoder().encode('userName: Elmar\n'));
    port.writes = [];

    const storage = createVaultStorage(createTauriRoot('/v', port));
    await expect(storage.getItem('hq-data')).rejects.toBeDefined();
    expect(storage.loadFailed()).toBe(true);

    storage.setItem('hq-data', envelope({ ...fullFixture(), projects: [], notes: [] }));
    await storage.flush();
    await storage.removeItem('hq-data');
    expect(port.writes).toEqual([]);
    expect(port.removals).toEqual([]);
    expect(text(port.files.get('/v/config/settings.yaml')!)).toBe('userName: Elmar\n');
    expect(await storage.syncFromDisk()).toBeNull();
  });
});
