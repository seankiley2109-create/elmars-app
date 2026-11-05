import { useState } from 'react';
import { FolderSearch, RotateCcw, TriangleAlert } from 'lucide-react';
import { chooseFolder, openFolderAt, openVault, retryLoad, type VaultState } from '../lib/vault-boot';
import { isTauri } from '../lib/platform';
import { btnGhost, btnPrimary } from './ui';

/**
 * The folder is there but could not be read. Shown instead of the app, above the `hydrated` gate,
 * because the store hydrated to its empty default and showing that (or onboarding) would look like
 * his notes were gone. The storage has stopped writing, so "Nothing has been changed" is true.
 */
export default function LoadError({ path, onChange }: { path?: string; onChange: (next: VaultState) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseAnother = async () => {
    setBusy(true);
    setError(null);
    try {
      if (isTauri()) {
        const picked = await chooseFolder();
        if (picked) onChange(await openFolderAt(picked));
      } else {
        onChange(await openVault());
      }
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn't open that folder. Try another one.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-warn/15 text-warn">
            <TriangleAlert size={28} />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">Your notes couldn't be opened.</h1>
          <p className="mt-2 text-sm text-muted">Nothing has been changed.</p>
          {path && (
            <p className="mt-4 w-full break-all rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-ink">
              {path}
            </p>
          )}
        </div>

        <button className={`${btnPrimary} w-full justify-center`} disabled={busy} onClick={retryLoad}>
          <RotateCcw size={16} />
          Try again
        </button>
        <button
          className={`${btnGhost} mt-3 w-full justify-center`}
          disabled={busy}
          onClick={() => void chooseAnother()}
        >
          <FolderSearch size={16} />
          Choose another folder…
        </button>

        {error && <p className="mt-3 text-center text-sm text-warn">{error}</p>}
      </div>
    </div>
  );
}
