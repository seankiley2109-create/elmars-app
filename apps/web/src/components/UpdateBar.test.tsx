import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));
vi.mock('../lib/vault-boot', () => ({ VAULT_PATH_KEY: 'elmar.vaultPath' }));

import UpdateBar from './UpdateBar';
import Settings from '../views/Settings';
import {
  FIRST_CHECK_MS,
  UPDATE_COPY,
  configureUpdater,
  resetUpdater,
  useUpdates,
  type FoundUpdate,
  type UpdaterPort,
} from '../lib/updater';

function update(over: Partial<FoundUpdate> = {}): FoundUpdate {
  return { version: '0.1.1', notes: 'Fixes and small improvements.', downloadAndInstall: vi.fn(async () => {}), ...over };
}

function port(check: () => Promise<FoundUpdate | null>): UpdaterPort {
  return { check: vi.fn(check), relaunch: vi.fn(async () => {}) };
}

const statusText = () => document.querySelector('[role="status"]')?.textContent ?? '';
const byText = (text: string) => screen.queryByRole('button', { name: text });

beforeEach(() => resetUpdater());
afterEach(() => {
  cleanup();
  resetUpdater();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the update offer', () => {
  it('is not there until an update is found', () => {
    configureUpdater({ port: port(async () => null) });
    render(<UpdateBar />);
    expect(screen.queryByTestId('update-bar')).toBeNull();
  });

  it('looks quietly 30 s after the app is ready, not before, and offers what it finds', async () => {
    vi.useFakeTimers();
    const p = port(async () => update());
    configureUpdater({ port: p });
    render(<UpdateBar />);
    // coming to the front before the first look does not jump the gun
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS - 1);
    });
    expect(p.check).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(p.check).toHaveBeenCalledTimes(1);
    expect(screen.getByText(UPDATE_COPY.ready)).toBeDefined();
    expect(screen.getByTestId('update-line').textContent).toBe('Version 0.1.1 · Fixes and small improvements.');
  });

  it('in a browser it never looks', async () => {
    vi.useFakeTimers();
    configureUpdater({ port: null });
    render(<UpdateBar />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS * 2);
    });
    expect(screen.queryByTestId('update-bar')).toBeNull();
  });

  it('"Later" puts it away', () => {
    configureUpdater({ port: port(async () => null) });
    useUpdates.setState({ offer: update(), shown: true });
    render(<UpdateBar />);
    fireEvent.click(byText(UPDATE_COPY.later)!);
    expect(screen.queryByTestId('update-bar')).toBeNull();
  });

  it('"Update and restart" saves, shows progress, then restarts; both buttons are 44 px', async () => {
    let finish!: () => void;
    const steps: string[] = [];
    const u = update({
      downloadAndInstall: vi.fn((onEvent) => {
        steps.push('install');
        onEvent({ event: 'Started', data: { contentLength: 100 } });
        onEvent({ event: 'Progress', data: { chunkLength: 40 } });
        return new Promise<void>((r) => (finish = r));
      }),
    });
    const p = port(async () => u);
    configureUpdater({
      port: p,
      save: async () => {
        steps.push('save');
        return true;
      },
    });
    useUpdates.setState({ offer: u, shown: true });
    render(<UpdateBar />);
    for (const b of screen.getAllByRole('button')) expect(b.className).toContain('min-h-11');

    fireEvent.click(byText(UPDATE_COPY.update)!);
    await waitFor(() => expect(screen.getByTestId('update-line').textContent).toBe('Getting the new version… 40%'));
    expect(byText(UPDATE_COPY.update)!.hasAttribute('disabled')).toBe(true);
    expect(byText(UPDATE_COPY.later)!.hasAttribute('disabled')).toBe(true);
    await act(async () => finish());
    await waitFor(() => expect(p.relaunch).toHaveBeenCalledTimes(1));
    expect(steps).toEqual(['save', 'install', 'save']);
  });

  it('a failed install says so plainly and can be put away', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const u = update({ downloadAndInstall: vi.fn(async () => Promise.reject(new Error('bad signature'))) });
    configureUpdater({ port: port(async () => u), save: async () => true });
    useUpdates.setState({ offer: u, shown: true });
    render(<UpdateBar />);
    fireEvent.click(byText(UPDATE_COPY.update)!);
    await waitFor(() => expect(statusText()).toBe(UPDATE_COPY.failed));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('update-bar')).toBeNull();
  });
});

describe('Settings → Check for updates', () => {
  function renderSettings() {
    return render(
      <MemoryRouter initialEntries={['/settings']}>
        <Settings />
        <UpdateBar />
      </MemoryRouter>,
    );
  }
  const settingsStatus = () => document.querySelector('.max-w-2xl [role="status"]')?.textContent ?? '';

  it('is not offered in a browser', () => {
    configureUpdater({ port: null });
    renderSettings();
    expect(byText(UPDATE_COPY.check)).toBeNull();
  });

  it('says "Checking…" while it looks, then that he is up to date, with the version', async () => {
    let answer!: (u: FoundUpdate | null) => void;
    configureUpdater({ port: port(() => new Promise((r) => (answer = r))) });
    renderSettings();
    fireEvent.click(byText(UPDATE_COPY.check)!);
    const busy = byText(UPDATE_COPY.checking)!;
    expect(busy.hasAttribute('disabled')).toBe(true);
    expect(busy.className).toContain('min-h-11');
    await act(async () => answer(null));
    await waitFor(() => expect(settingsStatus()).toBe("You're up to date (0.1.0)."));
    expect(byText(UPDATE_COPY.check)).not.toBeNull();
  });

  it('a new version: says so, and the same offer comes up', async () => {
    configureUpdater({ port: port(async () => update()) });
    renderSettings();
    fireEvent.click(byText(UPDATE_COPY.check)!);
    await waitFor(() => expect(settingsStatus()).toBe(UPDATE_COPY.found('0.1.1')));
    expect(screen.getByTestId('update-bar')).toBeDefined();
    expect(byText(UPDATE_COPY.update)).not.toBeNull();
  });

  it('a check that fails: a plain message, no offer', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    configureUpdater({ port: port(async () => Promise.reject(new Error('offline'))) });
    renderSettings();
    fireEvent.click(byText(UPDATE_COPY.check)!);
    await waitFor(() => expect(settingsStatus()).toBe(UPDATE_COPY.checkFailed));
    expect(screen.queryByTestId('update-bar')).toBeNull();
  });
});
