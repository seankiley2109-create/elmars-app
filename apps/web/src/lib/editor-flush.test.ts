import { describe, expect, it, vi } from 'vitest';
import { flushOpenEditors, registerEditorFlush } from './editor-flush';
import { flushOnUnload, type VaultStorage } from './vault-storage';

describe('flushing open editors', () => {
  it('calls every registered editor, survives one that throws, and forgets an unregistered one', () => {
    const a = vi.fn();
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const b = vi.fn();
    const offA = registerEditorFlush(a);
    const offBad = registerEditorFlush(bad);
    const offB = registerEditorFlush(b);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    flushOpenEditors();
    expect([a, bad, b].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
    offA();
    offBad();
    flushOpenEditors();
    expect([a, b].map((f) => f.mock.calls.length)).toEqual([1, 2]);
    offB();
    err.mockRestore();
  });

  it('tells the editors why: a hidden window is "hide", a page going away is "unload"', () => {
    const reasons: string[] = [];
    const off = registerEditorFlush((r) => reasons.push(r));
    flushOpenEditors();
    flushOpenEditors('hide');
    window.dispatchEvent(new Event('pagehide'));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    off();
    expect(reasons).toEqual(['unload', 'hide', 'unload', 'hide']);
  });

  it('flushOnUnload passes the same reasons on', () => {
    const reasons: string[] = [];
    const off = registerEditorFlush((r) => reasons.push(r));
    const stop = flushOnUnload({ flush: vi.fn(async () => {}) } as unknown as VaultStorage);
    window.dispatchEvent(new Event('pagehide'));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    stop();
    off();
    // each event reaches the editors twice (the module's own listener, then flushOnUnload's): same reason both times
    expect(reasons).toEqual(['unload', 'unload', 'hide', 'hide']);
  });

  it('on tab close the folder write comes after the editors have handed over their text', () => {
    const order: string[] = [];
    const off = registerEditorFlush(() => order.push('editor'));
    const storage = { flush: vi.fn(async () => void order.push('folder')) } as unknown as VaultStorage;
    const stop = flushOnUnload(storage);

    window.dispatchEvent(new Event('pagehide'));
    expect(order.at(-1)).toBe('folder');
    expect(order.indexOf('editor')).toBeLessThan(order.indexOf('folder'));

    order.length = 0;
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(order.at(-1)).toBe('folder');
    expect(order.indexOf('editor')).toBeLessThan(order.indexOf('folder'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    stop();
    off();
  });
});
