/**
 * Opens the one Evernote import sheet. App renders that sheet (so an import, and its report, outlive
 * whatever page started it) and subscribes here; anywhere else just calls `openEvernoteImport()`.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function openEvernoteImport(): void {
  for (const listener of [...listeners]) listener();
}

/** For App: run `listener` whenever something asks for the import. Returns the unsubscribe. */
export function onOpenEvernoteImport(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
