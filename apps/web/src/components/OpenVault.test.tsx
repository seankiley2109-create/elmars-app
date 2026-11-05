import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));

// the factory is hoisted, so the fns must be created inside it
vi.mock('../lib/vault-boot', () => ({ grantVault: vi.fn(), openVault: vi.fn(), skipVault: vi.fn() }));

import OpenVault from './OpenVault';

/**
 * The gate the whole app now boots through. With `skipHydration`, nothing sets `hydrated` until a
 * backend is chosen — so if this screen fails to render, HQ shows a spinner forever and there is no
 * way in. Worth a test that does not depend on a browser being available.
 */
describe('OpenVault', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup); // globals: false means no automatic cleanup between tests

  it('offers to choose a folder when none is saved', () => {
    render(<OpenVault state={{ kind: 'needs-folder' }} onChange={() => {}} />);
    expect(screen.getByRole('heading').textContent).toBe('Choose where to save');
    expect(screen.getByRole('button', { name: /choose a folder/i })).toBeDefined();
  });

  it('offers to unlock when the handle is saved but permission lapsed', () => {
    const dir = {} as FileSystemDirectoryHandle;
    render(<OpenVault state={{ kind: 'needs-permission', dir }} onChange={() => {}} />);
    expect(screen.getByRole('heading').textContent).toBe('Open your folder again');
    expect(screen.getByRole('button', { name: /open folder/i })).toBeDefined();
  });

  it('always leaves an escape hatch to browser storage', () => {
    render(<OpenVault state={{ kind: 'needs-folder' }} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /continue without a folder/i })).toBeDefined();
  });
});
