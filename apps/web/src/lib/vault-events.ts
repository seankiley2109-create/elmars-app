/**
 * A one-event bus for "the vault changed underneath us".
 *
 * Deliberately not part of `HQState`. Anything on the store is one careless `partialize` edit away
 * from being serialized into the vault, and a transient UI notice has no business becoming a file.
 * `vault-storage.ts` also must not import the store, so this is the seam between them.
 */

type Listener = (changed: string[]) => void;

const listeners = new Set<Listener>();

export function onVaultReloaded(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function notifyVaultReloaded(changed: string[]): void {
  for (const fn of listeners) fn(changed);
}

/** "A save did not reach the disk" — the storage keeps the edit and tries again. Same seam, same reasons. */
const saveFailedListeners = new Set<() => void>();

export function onSaveFailed(fn: () => void): () => void {
  saveFailedListeners.add(fn);
  return () => {
    saveFailedListeners.delete(fn);
  };
}

export function notifySaveFailed(): void {
  for (const fn of saveFailedListeners) fn();
}
