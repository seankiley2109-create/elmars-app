import { useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useUndo, UNDO_MS } from '../lib/undo';

/**
 * The stack of "Deleted — Undo" toasts. Bottom-centre, above everything (z-[60]) — a delete
 * fired from inside a slide-over (z-50) must still show its way back on top. No portal and
 * no AnimatePresence — see Overlay.tsx: exiting presence children never leave the DOM in
 * this stack, so a toast animates in and simply unmounts when its window closes.
 *
 * `flushAll` on pagehide mirrors vault-storage's flush-on-unload: closing the tab commits every
 * open window so blob cleanup never silently skips.
 */
export default function UndoToastHost() {
  const entries = useUndo((s) => s.entries);
  const undo = useUndo((s) => s.undo);
  const flushAll = useUndo((s) => s.flushAll);
  const reduced = useReducedMotion();

  useEffect(() => {
    const flush = () => flushAll();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushAll();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flushAll]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2">
      <>
        {entries.map((e) => (
          <motion.div
            key={e.id}
            role="status"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="pointer-events-auto relative flex max-w-96 items-center gap-3 overflow-hidden rounded-xl border border-line bg-surface px-4 py-2.5 shadow-2xl"
          >
            <span className="truncate text-sm text-ink">{e.label}</span>
            <button
              onClick={() => undo(e.id)}
              className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-accent transition-colors hover:bg-surface2"
            >
              Undo
            </button>
            {!reduced && (
              <motion.div
                className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-accent/50"
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                transition={{ duration: UNDO_MS / 1000, ease: 'linear' }}
                aria-hidden
              />
            )}
          </motion.div>
        ))}
      </>
    </div>
  );
}
