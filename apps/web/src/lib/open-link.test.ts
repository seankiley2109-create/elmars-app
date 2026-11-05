import { beforeEach, describe, expect, it, vi } from 'vitest';

const t = vi.hoisted(() => ({ tauri: true, openUrl: vi.fn(async (_u: string) => {}) }));
vi.mock('./platform', () => ({ isTauri: () => t.tauri, onAppFocus: () => () => {} }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (u: string) => t.openUrl(u) }));

import { isOpenLinkClick, isOpenableUrl, openExternalUrl } from './open-link';

beforeEach(() => {
  t.tauri = true;
  t.openUrl.mockClear();
});

describe('which links open', () => {
  it('http, https and mailto only', () => {
    for (const ok of ['https://x.y/a', 'http://x.y', 'HTTPS://X.Y', 'mailto:e@x.y', ' https://x.y ']) expect(isOpenableUrl(ok)).toBe(true);
    for (const no of [
      'evernote:///view/1/s1/a/a/',
      'message://%3Cid@x%3E',
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      'asset:a1',
      'elmar://note/n1',
      'tel:123',
      '',
      null,
      undefined,
    ])
      expect(isOpenableUrl(no)).toBe(false);
  });

  it('⌘-click on a Mac, Ctrl-click elsewhere', () => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    expect(isOpenLinkClick({ metaKey: true, ctrlKey: false })).toBe(mac);
    expect(isOpenLinkClick({ metaKey: false, ctrlKey: true })).toBe(!mac);
    expect(isOpenLinkClick({ metaKey: false, ctrlKey: false })).toBe(false);
  });
});

describe('opening a link', () => {
  it('hands a web or mail link to the Mac app’s opener', async () => {
    expect(await openExternalUrl('https://x.y/a')).toBe(true);
    expect(await openExternalUrl('mailto:e@x.y')).toBe(true);
    expect(t.openUrl.mock.calls.map((c) => c[0])).toEqual(['https://x.y/a', 'mailto:e@x.y']);
  });

  it('two clicks in a row both open', async () => {
    expect(await Promise.all([openExternalUrl('https://x.y/a'), openExternalUrl('mailto:e@x.y')])).toEqual([true, true]);
    expect(t.openUrl).toHaveBeenCalledTimes(2);
  });

  it('never opens another scheme', async () => {
    expect(await openExternalUrl('evernote:///view/1/s1/a/a/')).toBe(false);
    expect(await openExternalUrl('javascript:alert(1)')).toBe(false);
    expect(t.openUrl).not.toHaveBeenCalled();
  });

  it('a browser opens a new tab', async () => {
    t.tauri = false;
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    expect(await openExternalUrl('https://x.y/a')).toBe(true);
    expect(open).toHaveBeenCalledWith('https://x.y/a', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('a fake opener is used when given, and an opener that fails is not an error', async () => {
    const fake = vi.fn(async () => {
      throw new Error('refused');
    });
    expect(await openExternalUrl('https://x.y', fake)).toBe(false);
    expect(fake).toHaveBeenCalledWith('https://x.y');
  });
});
