import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => {
  let release: (s: { kind: 'ready' }) => void = () => {};
  return {
    retryIcloud: vi.fn(
      () =>
        new Promise<{ kind: 'ready' }>((r) => {
          release = r;
        }),
    ),
    finish: () => release({ kind: 'ready' }),
  };
});
vi.mock('../lib/vault-boot', () => ({ retryIcloud: m.retryIcloud }));

const p = vi.hoisted(() => ({ listeners: [] as ((x: { done: number; total: number }) => void)[] }));
vi.mock('../lib/tauri-root', () => ({
  onIcloudProgress: (cb: (x: { done: number; total: number }) => void) => {
    p.listeners.push(cb);
    return () => {
      p.listeners = p.listeners.filter((l) => l !== cb);
    };
  },
}));
const progress = (done: number, total: number) => act(() => p.listeners.forEach((l) => l({ done, total })));

import IcloudPending, { DownloadProgress } from './IcloudPending';

const FORBIDDEN = /\b(vault|jobs?|runs?|backlog|shipped|signals?|inbox)\b/i;

describe('IcloudPending', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    p.listeners = [];
  });

  it('says plainly what is happening and what to do, with the count', () => {
    render(<IcloudPending count={3} onChange={() => {}} />);
    const shown = document.body.textContent ?? '';
    expect(shown).toContain("Some of your notes are still downloading from iCloud (3). Check you're online, then try again.");
    expect(shown).not.toMatch(FORBIDDEN);
    expect(screen.getByText('Try again')).toBeDefined();
  });

  it('"Try again" loads again in place, shows how far the download got, then hands over the result', async () => {
    const onChange = vi.fn();
    render(<IcloudPending count={3} onChange={onChange} />);
    fireEvent.click(screen.getByText('Try again'));
    expect(m.retryIcloud).toHaveBeenCalledTimes(1);
    expect((screen.getByText('Try again').closest('button') as HTMLButtonElement).disabled).toBe(true);

    progress(1, 3);
    expect(document.body.textContent).toContain('Downloading from iCloud: 1 of 3');
    expect(document.body.textContent).not.toMatch(FORBIDDEN);

    await act(async () => m.finish());
    expect(onChange).toHaveBeenCalledWith({ kind: 'ready' });
  });

  it('the progress line shows only while something is downloading', () => {
    render(<DownloadProgress />);
    expect(document.body.textContent).toBe('');
    progress(0, 40);
    expect(document.body.textContent).toBe('Downloading from iCloud: 0 of 40');
    progress(40, 40);
    expect(document.body.textContent).toBe('');
  });
});
