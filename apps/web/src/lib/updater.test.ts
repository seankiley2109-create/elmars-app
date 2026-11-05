import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHECK_EVERY_MS,
  checkForUpdate,
  checkQuietly,
  configureUpdater,
  dismissUpdate,
  installUpdate,
  isCheckDue,
  offerLine,
  progressLine,
  resetUpdater,
  useUpdates,
  type DownloadEvent,
  type FoundUpdate,
  type UpdaterPort,
} from './updater';
import { readyToQuit } from './vault-storage';

/** Every step lands here in order, so the tests can say what happened before what. */
let steps: string[];

function fakeUpdate(over: Partial<FoundUpdate> = {}): FoundUpdate {
  return {
    version: '0.1.1',
    notes: 'Fixes and small improvements.',
    downloadAndInstall: vi.fn(async (onEvent: (e: DownloadEvent) => void) => {
      steps.push('install');
      onEvent({ event: 'Started', data: { contentLength: 200 } });
      onEvent({ event: 'Progress', data: { chunkLength: 50 } });
      onEvent({ event: 'Progress', data: { chunkLength: 150 } });
      onEvent({ event: 'Finished' });
    }),
    ...over,
  };
}

function fakePort(found: FoundUpdate | null | Error): UpdaterPort & { check: ReturnType<typeof vi.fn>; relaunch: ReturnType<typeof vi.fn> } {
  return {
    check: vi.fn(async () => {
      steps.push('check');
      if (found instanceof Error) throw found;
      return found;
    }),
    relaunch: vi.fn(async () => {
      steps.push('relaunch');
    }),
  };
}

beforeEach(() => {
  steps = [];
  resetUpdater();
});

afterEach(() => {
  resetUpdater();
  vi.restoreAllMocks();
});

describe('looking for an update', () => {
  it('no update: nothing is offered', async () => {
    const port = fakePort(null);
    configureUpdater({ port });
    expect(await checkForUpdate()).toEqual({ kind: 'none' });
    expect(useUpdates.getState().offer).toBeNull();
    expect(useUpdates.getState().shown).toBe(false);
  });

  it('an update: it is offered, with its version', async () => {
    configureUpdater({ port: fakePort(fakeUpdate()) });
    expect(await checkForUpdate()).toEqual({ kind: 'available', version: '0.1.1' });
    expect(useUpdates.getState().offer?.version).toBe('0.1.1');
    expect(useUpdates.getState().shown).toBe(true);
  });

  it('a check that fails (offline) is silent: logged, nothing offered, nothing thrown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    configureUpdater({ port: fakePort(new Error('offline')) });
    await expect(checkQuietly()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(useUpdates.getState().shown).toBe(false);
    expect(await checkForUpdate(Date.now())).toEqual({ kind: 'error' });
  });

  it('in a browser there is no updater: no check is made', async () => {
    configureUpdater({ port: null });
    expect(await checkForUpdate()).toEqual({ kind: 'none' });
    await checkQuietly();
    expect(steps).toEqual([]);
  });

  it('looks on its own at most once every 6 hours', async () => {
    const port = fakePort(null);
    configureUpdater({ port });
    const t0 = 1_000_000;
    await checkQuietly(t0);
    await checkQuietly(t0 + 60_000); // focus a minute later
    await checkQuietly(t0 + CHECK_EVERY_MS - 1);
    expect(port.check).toHaveBeenCalledTimes(1);
    await checkQuietly(t0 + CHECK_EVERY_MS);
    expect(port.check).toHaveBeenCalledTimes(2);
  });

  it('isCheckDue: never looked, or 6 hours since', () => {
    expect(isCheckDue(null, 5)).toBe(true);
    expect(isCheckDue(0, CHECK_EVERY_MS - 1)).toBe(false);
    expect(isCheckDue(0, CHECK_EVERY_MS)).toBe(true);
  });

  it('"Later" puts the offer away; the next look brings it back', async () => {
    configureUpdater({ port: fakePort(fakeUpdate()) });
    await checkForUpdate();
    dismissUpdate();
    expect(useUpdates.getState().shown).toBe(false);
    await checkForUpdate();
    expect(useUpdates.getState().shown).toBe(true);
  });
});

describe('Update and restart', () => {
  it('saves first, then installs, then restarts', async () => {
    const port = fakePort(fakeUpdate());
    configureUpdater({
      port,
      save: async () => {
        steps.push('save');
        return true;
      },
    });
    await checkForUpdate();
    steps = [];
    await installUpdate();
    // saved before the install, installed before the restart (and anything typed meanwhile saved too)
    expect(steps).toEqual(['save', 'install', 'save', 'relaunch']);
    expect(useUpdates.getState().phase).toBe('restarting');
    expect(useUpdates.getState().progress).toEqual({ done: 200, total: 200 });
  });

  it('through the real quit decision: a save that fails asks first, and "Keep open" installs nothing', async () => {
    const confirmQuit = vi.fn(async () => false);
    const storage = {
      flush: vi.fn(async () => {
        steps.push('save');
        throw new Error('disk full');
      }),
      hasUnsaved: () => true,
    };
    const port = fakePort(fakeUpdate());
    configureUpdater({ port, save: () => readyToQuit(storage, { confirmQuit, timeoutMs: 50 }) });
    await checkForUpdate();
    steps = [];
    await installUpdate();
    expect(confirmQuit).toHaveBeenCalledTimes(1);
    expect(steps).toEqual(['save']);
    expect(port.relaunch).not.toHaveBeenCalled();
    expect(useUpdates.getState().phase).toBe('offer'); // still offered, he can try again
    expect(useUpdates.getState().shown).toBe(true);
  });

  it('through the real quit decision: a save that fails asks, and "Update anyway" goes ahead', async () => {
    const confirmQuit = vi.fn(async () => true);
    const storage = { flush: async () => Promise.reject(new Error('disk full')), hasUnsaved: () => true };
    const port = fakePort(fakeUpdate());
    configureUpdater({ port, save: () => readyToQuit(storage, { confirmQuit, timeoutMs: 50 }) });
    await checkForUpdate();
    await installUpdate();
    expect(confirmQuit).toHaveBeenCalled();
    expect(port.relaunch).toHaveBeenCalledTimes(1);
  });

  it('"Keep open" at the save after installing: the offer goes, and the same version is not offered again', async () => {
    const close = vi.fn(async () => {});
    const port = fakePort(fakeUpdate({ close }));
    const answers = [true, false]; // saved before the install; the save before the restart is declined
    configureUpdater({ port, save: async () => answers.shift() ?? false });
    await checkForUpdate();
    await installUpdate();
    expect(port.relaunch).not.toHaveBeenCalled();
    expect(useUpdates.getState().offer).toBeNull();
    expect(useUpdates.getState().shown).toBe(false);
    expect(useUpdates.getState().installedVersion).toBe('0.1.1');
    expect(close).toHaveBeenCalled();

    // the server still lists 0.1.1 (this copy runs 0.1.0 until reopened): not offered again
    expect(await checkForUpdate()).toEqual({ kind: 'installed', version: '0.1.1' });
    expect(useUpdates.getState().shown).toBe(false);
    expect(useUpdates.getState().offer).toBeNull();

    // a newer one still is
    port.check.mockResolvedValueOnce(fakeUpdate({ version: '0.1.2' }));
    expect(await checkForUpdate()).toEqual({ kind: 'available', version: '0.1.2' });
    expect(useUpdates.getState().shown).toBe(true);
  });

  it('a saved folder is not asked about', async () => {
    const confirmQuit = vi.fn(async () => false);
    const flush = vi.fn(async () => {});
    const port = fakePort(fakeUpdate());
    configureUpdater({ port, save: () => readyToQuit({ flush, hasUnsaved: () => false }, { confirmQuit }) });
    await checkForUpdate();
    await installUpdate();
    expect(flush).toHaveBeenCalled();
    expect(confirmQuit).not.toHaveBeenCalled();
    expect(port.relaunch).toHaveBeenCalledTimes(1);
  });

  it('an install that fails says so plainly, and the app keeps running', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const update = fakeUpdate({
      downloadAndInstall: vi.fn(async () => {
        throw new Error('signature mismatch');
      }),
    });
    const port = fakePort(update);
    configureUpdater({ port, save: async () => true });
    await checkForUpdate();
    await expect(installUpdate()).resolves.toBeUndefined();
    expect(useUpdates.getState().phase).toBe('failed');
    expect(port.relaunch).not.toHaveBeenCalled();
  });

  it('a restart that fails says so too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const port = fakePort(fakeUpdate());
    port.relaunch.mockRejectedValueOnce(new Error('no'));
    configureUpdater({ port, save: async () => true });
    await checkForUpdate();
    await installUpdate();
    expect(useUpdates.getState().phase).toBe('failed');
  });

  it('a second click while it is under way does nothing', async () => {
    let finish!: () => void;
    const update = fakeUpdate({
      downloadAndInstall: vi.fn(() => new Promise<void>((r) => (finish = r))),
    });
    configureUpdater({ port: fakePort(update), save: async () => true });
    await checkForUpdate();
    const first = installUpdate();
    await vi.waitFor(() => expect(useUpdates.getState().phase).toBe('downloading'));
    await installUpdate();
    dismissUpdate(); // "Later" can't pull it away mid-install either
    expect(useUpdates.getState().shown).toBe(true);
    finish();
    await first;
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
  });
});

describe('the words on the offer', () => {
  it('the version and the first line of its notes', () => {
    expect(offerLine({ version: '0.1.1', notes: '## Fixes\n- Notes open faster' })).toBe('Version 0.1.1 · Fixes');
    expect(offerLine({ version: '0.1.1' })).toBe('Version 0.1.1');
    expect(offerLine({ version: '0.1.1', notes: 'x'.repeat(200) })).toHaveLength('Version 0.1.1 · '.length + 90);
  });

  it('progress as a percentage when the size is known', () => {
    expect(progressLine({ done: 50, total: 200 })).toBe('Getting the new version… 25%');
    expect(progressLine({ done: 50 })).toBe('Getting the new version…');
  });
});
