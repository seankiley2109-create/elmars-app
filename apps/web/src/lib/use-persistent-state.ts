import { useState, type Dispatch, type SetStateAction } from 'react';

/**
 * `useState` whose value survives navigation and reloads by persisting to `localStorage`.
 *
 * For **view chrome only** — filters, folder selection, zoom — never for vault data. The Sidebar
 * codifies the rule this generalizes (`hq.sidebar.library`): the vault stays the truth for work,
 * localStorage holds the UI preferences. Keys are namespaced under `hq.view.` so they never collide
 * with other stored state.
 *
 * Read is lazy (no hydration flash, no per-render re-read) and the write rides the setter, so there
 * is no mount effect to clobber the restored value. Parse and quota failures fall back silently to
 * `initial` — a corrupt or full store degrades to a plain, in-memory `useState`.
 */
export function usePersistentState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = `hq.view.${key}`;

  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  const set: Dispatch<SetStateAction<T>> = (next) => {
    setValue((prev) => {
      const val = next instanceof Function ? (next as (p: T) => T)(prev) : next;
      try {
        localStorage.setItem(storageKey, JSON.stringify(val));
      } catch {
        /* private mode / quota — keep working in memory */
      }
      return val;
    });
  };

  return [value, set];
}
