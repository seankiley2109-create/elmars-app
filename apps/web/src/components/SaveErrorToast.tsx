import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { onSaveFailed } from '../lib/vault-events';

const DISMISS_MS = 6000;

/**
 * Says a save did not reach the disk. The storage keeps the edit and retries it, so this is a notice,
 * not a dialog: it goes away by itself and comes back if the next attempt fails too.
 *
 * Bottom-left like VaultToast, one row up, so the two never sit on top of each other.
 */
export default function SaveErrorToast() {
  const [shownAt, setShownAt] = useState<number | null>(null);

  useEffect(() => onSaveFailed(() => setShownAt(Date.now())), []);

  useEffect(() => {
    if (shownAt === null) return;
    const id = window.setTimeout(() => setShownAt(null), DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [shownAt]);

  if (shownAt === null) return null;
  return (
    <div
      role="alert"
      className="fixed bottom-32 left-4 z-30 flex max-w-72 items-center gap-2 rounded-full border border-warn/50 bg-surface px-3.5 py-2 text-xs text-ink shadow-lg md:bottom-16"
    >
      <AlertTriangle size={12} className="shrink-0 text-warn" aria-hidden />
      <span>Couldn't save your changes. Trying again…</span>
    </div>
  );
}
