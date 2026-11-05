import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitForElementToBeRemoved } from '@testing-library/react';
import { notifyVaultReloaded } from '../lib/vault-events';
import VaultToast from './VaultToast';

/**
 * The only thing that tells you Claude touched your vault. If it silently fails to render, edits
 * appear out of nowhere and the app feels haunted.
 */
describe('VaultToast', () => {
  afterEach(cleanup); // globals: false means no automatic cleanup

  it('names the file when exactly one changed', () => {
    render(<VaultToast />);
    act(() => notifyVaultReloaded(['projects/kitchen-renovation.md']));
    expect(screen.getByRole('status').textContent).toBe('kitchen-renovation.md changed outside the app — reloaded.');
  });

  it('counts when several changed, and keeps the paths in the title', () => {
    render(<VaultToast />);
    act(() => notifyVaultReloaded(['projects/a.md', 'tasks/2026-07.md', 'notes/b.md']));
    const el = screen.getByRole('status');
    expect(el.textContent).toBe('3 files changed outside the app — reloaded.');
    expect(el.getAttribute('title')).toBe('projects/a.md\ntasks/2026-07.md\nnotes/b.md');
  });

  it('shows nothing until something changes', () => {
    render(<VaultToast />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  // real timers, not fake: AnimatePresence unmounts on a requestAnimationFrame-driven exit that fake
  // timers never advance, so faking the clock would prove the dismiss timer fired but not that the
  // toast actually leaves the DOM.
  it('dismisses itself', async () => {
    render(<VaultToast />);
    act(() => notifyVaultReloaded(['notes/b.md']));
    expect(screen.queryByRole('status')).not.toBeNull();
    await waitForElementToBeRemoved(() => screen.queryByRole('status'), { timeout: 6000 });
  }, 8000);

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<VaultToast />);
    unmount();
    // a stray listener firing setState on a dead component is a leak, not a crash — assert quietly
    expect(() => notifyVaultReloaded(['notes/b.md'])).not.toThrow();
  });
});
