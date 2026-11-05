import { useState } from 'react';
import { motion } from 'framer-motion';
import { FolderOpen, HardDrive, ShieldCheck } from 'lucide-react';
import { grantVault, openVault, skipVault, type VaultState } from '../lib/vault-boot';
import { btnGhost, btnPrimary } from './ui';

/**
 * Mounts above App's `hydrated` gate: with `skipHydration` nothing sets `hydrated` until a backend is
 * chosen, so the spinner would otherwise spin forever.
 *
 * The folder handle survives a reload but the permission does not — Chrome drops it once per browser
 * session. That is the whole cost of the design: one click, first thing in the morning.
 */
export default function OpenVault({
  state,
  onChange,
}: {
  state: Extract<VaultState, { kind: 'needs-folder' } | { kind: 'needs-permission' }>;
  onChange: (next: VaultState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resuming = state.kind === 'needs-permission';

  const run = async (fn: () => Promise<VaultState>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that folder.');
    } finally {
      setBusy(false);
    }
  };

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
            {resuming ? <ShieldCheck size={28} /> : <FolderOpen size={28} />}
          </span>
          <h1 className="text-2xl font-bold tracking-tight">{resuming ? 'Open your folder again' : 'Choose where to save'}</h1>
          <p className="mt-2 text-sm text-muted">
            {resuming
              ? 'Your browser asks for the folder once each session. One click and you carry on where you left off.'
              : 'Everything is saved as plain files in a folder you own. Choose it once.'}
          </p>
        </div>

        <button
          className={`${btnPrimary} w-full justify-center`}
          disabled={busy}
          onClick={() => void run(() => (resuming ? grantVault(state.dir) : openVault()))}
        >
          <FolderOpen size={16} />
          {busy ? 'Opening…' : resuming ? 'Open folder' : 'Choose a folder'}
        </button>

        {error && <p className="mt-3 text-center text-sm text-warn">{error}</p>}

        <div className="mt-6 border-t border-line pt-5">
          <button
            className={`${btnGhost} w-full justify-center`}
            disabled={busy}
            onClick={() => void run(skipVault)}
          >
            <HardDrive size={16} />
            Continue without a folder
          </button>
          <p className="mt-2 text-center text-xs text-dim">
            Keeps working in browser storage. Clearing site data erases it — move to a folder when you can.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
