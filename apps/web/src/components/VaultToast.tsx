import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { onVaultReloaded } from '../lib/vault-events';

const DISMISS_MS = 4000;

/** `projects/kitchen-renovation.md` → `kitchen-renovation.md`. The filename is what actually changed. */
const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * Says what reloaded when the vault changed outside HQ.
 *
 * Names only what we can prove — the file. Mapping a path back to an entity's real `name` would mean
 * re-running the slug allocator, and a *wrong* name here would be worse than a filename.
 *
 * Bottom-left: the right column is taken by the search button (`bottom-4`), and the mobile nav owns
 * `bottom-0`.
 */
export default function VaultToast() {
  const [changed, setChanged] = useState<string[] | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => onVaultReloaded(setChanged), []);

  useEffect(() => {
    if (!changed) return;
    const id = window.setTimeout(() => setChanged(null), DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [changed]);

  const message =
    changed?.length === 1
      ? `${basename(changed[0])} changed outside the app — reloaded.`
      : `${changed?.length} files changed outside the app — reloaded.`;

  // Plain conditional, no AnimatePresence — see Overlay.tsx: exiting presence children never
  // leave the DOM in this stack, and a toast that can't leave is worse than one that leaves abruptly.
  return (
    <>
      {changed && (
        <motion.div
          role="status"
          title={changed.join('\n')}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="fixed bottom-20 left-4 z-30 flex max-w-72 items-center gap-2 rounded-full border border-accent/50 bg-surface px-3.5 py-2 text-xs text-ink shadow-lg md:bottom-4"
        >
          <RefreshCw size={12} className="shrink-0 text-accent" aria-hidden />
          <span className="truncate">{message}</span>
        </motion.div>
      )}
    </>
  );
}
