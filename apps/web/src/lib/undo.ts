import { create } from 'zustand';
import { useHQ, type DeleteSnapshot } from '../store';

/**
 * The undo window over deletes. The delete itself already happened — the store and the vault
 * are truthful the moment the toast appears. Each entry holds the inverse (a DeleteSnapshot);
 * "Undo" restores it, expiry commits it (which is when asset blobs actually die).
 *
 * Runtime state only: this never touches HQData, so a crash mid-window loses nothing but the
 * chance to undo — the delete stands, exactly as shown.
 */

export const UNDO_MS = 5000;
const MAX_TOASTS = 3;

/**
 * An entry is either a *delete* (holds a `DeleteSnapshot` the store re-inserts) or a *reversible
 * action* (holds `onUndo`/`onCommit` thunks — e.g. archive, which flips a flag rather than removing
 * a row). Both ride the same 5-second toast; the shape decides how undo/expire resolve.
 */
export interface UndoEntry {
  id: string;
  label: string;
  expiresAt: number;
  snap?: DeleteSnapshot;
  onUndo?: () => void;
  onCommit?: () => void;
}

interface UndoState {
  entries: UndoEntry[];
  push: (entry: { label: string; snap?: DeleteSnapshot; onUndo?: () => void; onCommit?: () => void }) => void;
  undo: (id: string) => void;
  expire: (id: string) => void;
  /** Commit everything now — called on pagehide so a closing tab never skips blob cleanup. */
  flushAll: () => void;
}

/** Timer handles live outside the store — they are not state, and clearing them must not re-render. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const drop = (id: string): void => {
  const t = timers.get(id);
  if (t !== undefined) clearTimeout(t);
  timers.delete(id);
};

export const useUndo = create<UndoState>((set, get) => ({
  entries: [],
  push: ({ label, snap, onUndo, onCommit }) => {
    // a fourth toast evicts the oldest — its window closes early, its delete commits
    if (get().entries.length >= MAX_TOASTS) get().expire(get().entries[0].id);
    const id = crypto.randomUUID();
    timers.set(
      id,
      setTimeout(() => get().expire(id), UNDO_MS),
    );
    set((s) => ({ entries: [...s.entries, { id, label, expiresAt: Date.now() + UNDO_MS, snap, onUndo, onCommit }] }));
  },
  undo: (id) => {
    const entry = get().entries.find((e) => e.id === id);
    if (!entry) return;
    drop(id);
    if (entry.snap) useHQ.getState().restoreDelete(entry.snap);
    else entry.onUndo?.();
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
  },
  expire: (id) => {
    const entry = get().entries.find((e) => e.id === id);
    if (!entry) return;
    drop(id);
    if (entry.snap) useHQ.getState().commitDelete(entry.snap);
    else entry.onCommit?.();
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
  },
  flushAll: () => {
    for (const e of get().entries) {
      drop(e.id);
      if (e.snap) useHQ.getState().commitDelete(e.snap);
      else e.onCommit?.();
    }
    set({ entries: [] });
  },
}));

/**
 * The one call every delete button makes: run the delete, toast the way back.
 *
 *   deleteWithUndo(() => deleteNote(id))
 */
export function deleteWithUndo(run: () => DeleteSnapshot | undefined): void {
  const snap = run();
  if (snap) useUndo.getState().push({ label: snap.label, snap });
}

/**
 * The same 5-second toast for a *reversible action* that isn't a delete — archive, say. Do the thing,
 * then hand back the way out: `onUndo` reverses it, optional `onCommit` runs when the window closes.
 *
 *   undoable(`Archived ${p.name}`, () => updateProject(id, { archived: false }))
 */
export function undoable(label: string, onUndo: () => void, onCommit?: () => void): void {
  useUndo.getState().push({ label, onUndo, onCommit });
}
