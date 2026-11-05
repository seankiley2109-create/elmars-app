import { useState } from 'react';
import { motion } from 'framer-motion';
import { FolderOpen, FolderSearch, RotateCcw } from 'lucide-react';
import { chooseFolder, lookAgain, openFolderAt, type VaultState } from '../lib/vault-boot';
import { btnGhost, btnPrimary } from './ui';

/**
 * The Mac app's first screen: where his notes live. Shown for Tauri's `needs-folder`, above App's
 * `hydrated` gate for the same reason OpenVault is (nothing hydrates until a folder is chosen).
 *
 * The suggestion is iCloud Drive when the Mac has it. Plain words only: he never sees "vault".
 *
 * `missing`: the folder he already uses was not found (moved, renamed, iCloud signed out). Then this is
 * not a first run: it says so, and leads with "Look again", never with making the folder again empty.
 */
export const STILL_MISSING = "It's still not there. If it's in iCloud Drive, check that this Mac is signed in, then look again.";

export default function FirstRun({
  suggested,
  missing = false,
  onChange,
}: {
  suggested: string;
  missing?: boolean;
  onChange: (next: VaultState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inICloud = suggested.includes('com~apple~CloudDocs');

  const open = async (path: string | null) => {
    if (!path) return; // cancelled the picker
    setBusy(true);
    setError(null);
    try {
      onChange(await openFolderAt(path));
    } catch (e) {
      // our own refusals carry a plain reason; anything else gets the generic line
      setError(e instanceof Error && e.message ? e.message : "Couldn't open that folder. Try another one.");
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await lookAgain(suggested);
      if (next.kind === 'needs-folder') setError(STILL_MISSING);
      else onChange(next);
    } catch {
      setError(STILL_MISSING);
    } finally {
      setBusy(false);
    }
  };

  const chooseAnother = (
    <button
      className={`${btnGhost} mt-3 min-h-11 w-full justify-center`}
      disabled={busy}
      onClick={() => void chooseFolder().then(open, () => setError("Couldn't show the folder picker."))}
    >
      <FolderSearch size={16} />
      Choose another folder…
    </button>
  );

  if (missing) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 flex flex-col items-center text-center">
            <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
              <FolderSearch size={28} />
            </span>
            <h1 className="text-2xl font-bold tracking-tight">Your notes folder isn't where it was</h1>
            <p className="mt-4 w-full break-all rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-ink">
              {suggested}
            </p>
            <p className="mt-3 text-sm text-muted">
              It may have been moved or renamed, or iCloud Drive may be signed out. Nothing has been changed.
            </p>
          </div>

          <button className={`${btnPrimary} min-h-11 w-full justify-center`} disabled={busy} onClick={() => void retry()}>
            <RotateCcw size={16} />
            {busy ? 'Looking…' : 'Look again'}
          </button>
          {chooseAnother}

          {error && <p className="mt-3 text-center text-sm text-warn">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="w-full max-w-md"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="glow mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
            <FolderOpen size={28} />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">Where should your notes live?</h1>
          <p className="mt-4 w-full break-all rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-ink">
            {suggested}
          </p>
          <p className="mt-3 text-sm text-muted">
            {inICloud
              ? 'This folder is in iCloud Drive, which keeps a copy safe if the laptop is lost.'
              : 'A folder in iCloud Drive keeps a copy safe if the laptop is lost.'}
          </p>
        </div>

        <button
          className={`${btnPrimary} w-full justify-center`}
          disabled={busy}
          onClick={() => void open(suggested)}
        >
          <FolderOpen size={16} />
          {busy ? 'Opening…' : 'Use this folder'}
        </button>

        {chooseAnother}

        {error && <p className="mt-3 text-center text-sm text-warn">{error}</p>}
      </motion.div>
    </div>
  );
}
