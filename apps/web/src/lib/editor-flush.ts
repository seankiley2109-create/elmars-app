/**
 * Open editors hold their last few hundred milliseconds of typing in a debounce. Closing the tab or
 * quitting the app fires no blur, so whoever is about to persist for the last time calls
 * `flushOpenEditors()` first: every open editor hands its pending text to the store, and the store
 * write that follows carries it.
 *
 * Kept free of editor code so `vault-storage` can call it without pulling TipTap in.
 */

/**
 * Why the editors are being flushed:
 * - `'hide'`: the window was only hidden (he switched apps). Pending text is saved; anything waiting
 *   on his decision (an open "changed outside the app" banner) stays open for when he comes back.
 * - `'unload'`: the page is going away (tab closed, app quit). Pending text is saved, and anything
 *   waiting on his decision is settled so nothing is lost.
 */
export type FlushReason = 'hide' | 'unload';

type Flusher = (reason: FlushReason) => void;

const flushers = new Set<Flusher>();

/** An editor registers its flush while mounted; the returned function unregisters it. */
export function registerEditorFlush(flush: Flusher): () => void {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}

/** Write every open editor's pending text to the store now. One failing editor doesn't stop the rest. */
export function flushOpenEditors(reason: FlushReason = 'unload'): void {
  for (const flush of [...flushers]) {
    try {
      flush(reason);
    } catch (err) {
      console.error('An editor could not save its last change', err);
    }
  }
}

// Without a folder there is no vault-storage unload hook, so the editors flush on their own too.
// (With a folder, `flushOnUnload` calls this before writing; flushing twice is harmless.)
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flushOpenEditors('unload'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOpenEditors('hide');
  });
}
