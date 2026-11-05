/**
 * Where the app is running: inside the Tauri Mac app, or in a browser tab (Chrome, for development).
 *
 * Every Tauri API is imported lazily behind `isTauri()`. The browser build and the jsdom tests must never
 * call one: they throw outside the Tauri web view, and a static import would pull them into every test.
 */

/** True inside the Tauri web view. False in Chrome and in jsdom. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Call `cb` whenever the app comes back to the front: the moment to look for edits made outside it.
 *
 * In Tauri the window's focus is the signal; a browser tab uses `visibilitychange` to visible, as HQ did.
 * Returns an unsubscribe.
 */
export function onAppFocus(cb: () => void): () => void {
  if (isTauri()) {
    let stopped = false;
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const off = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (focused) cb();
      });
      if (stopped) off();
      else unlisten = off;
    });
    return () => {
      stopped = true;
      unlisten?.();
    };
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') cb();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => document.removeEventListener('visibilitychange', onVisible);
}
