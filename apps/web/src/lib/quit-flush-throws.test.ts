import { describe, expect, it, vi } from 'vitest';

/** An editor's flush that throws outright (not one the registry catches): quitting must still decide. */
vi.mock('./editor-flush', () => ({
  flushOpenEditors: () => {
    throw new Error('an editor blew up');
  },
}));

import { flushOnExit, flushOnQuit, type ExitSource, type QuitWindow } from './vault-storage';

const stub = (flush: () => Promise<void> = async () => {}) => ({ flush, hasUnsaved: () => false });

describe('quitting when the editors cannot hand over', () => {
  it('Cmd+Q still saves the folder and lets the app exit', async () => {
    let fire: (() => void) | undefined;
    const exit = vi.fn(async () => {});
    const cancel = vi.fn(async () => {});
    const flush = vi.fn(async () => {});
    const source: ExitSource = {
      onExitRequested: async (cb) => {
        fire = cb;
        return () => {};
      },
      hold: async () => {},
      exit,
      cancel,
    };
    await flushOnExit(() => stub(flush), source);
    fire!();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1));
    expect(flush).toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('closing the window still saves and closes it', async () => {
    let close: ((e: { preventDefault(): void }) => Promise<void>) | undefined;
    const destroy = vi.fn(async () => {});
    const win: QuitWindow = {
      onCloseRequested: async (cb) => {
        close = cb as typeof close;
        return () => {};
      },
      destroy,
    };
    await flushOnQuit(stub(), win);
    await close!({ preventDefault: () => {} });
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
