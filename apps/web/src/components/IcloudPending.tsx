import { useEffect, useState } from 'react';
import { CloudDownload, RotateCcw } from 'lucide-react';
import { retryIcloud, type VaultState } from '../lib/vault-boot';
import { onIcloudProgress, type IcloudProgress } from '../lib/tauri-root';
import { btnPrimary } from './ui';

/**
 * "Downloading from iCloud: 3 of 40" while files are coming down, nothing otherwise. Shown under the
 * loading spinner on launch and on this screen while "Try again" works.
 */
export function DownloadProgress() {
  const [p, setP] = useState<IcloudProgress | null>(null);
  useEffect(() => onIcloudProgress(setP), []);
  if (!p || p.total === 0 || p.done >= p.total) return null;
  return (
    <p className="text-sm text-muted" role="status">
      Downloading from iCloud: {p.done} of {p.total}
    </p>
  );
}

/**
 * Some of his notes are still in iCloud and did not arrive in time. Shown instead of the app, above
 * the `hydrated` gate, like the load-error screen: nothing was loaded, so the store holds its empty
 * default and showing it would look as if his notes were gone. The storage refuses to write, so
 * nothing can be overwritten or deleted while this is up.
 */
export default function IcloudPending({ count, onChange }: { count: number; onChange: (next: VaultState) => void }) {
  const [busy, setBusy] = useState(false);

  const tryAgain = async () => {
    setBusy(true);
    try {
      onChange(await retryIcloud());
    } catch {
      onChange({ kind: 'load-error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
            <CloudDownload size={28} />
          </span>
          <p className="text-lg font-semibold tracking-tight">
            Some of your notes are still downloading from iCloud ({count}). Check you're online, then try again.
          </p>
        </div>

        <button className={`${btnPrimary} w-full justify-center`} disabled={busy} onClick={() => void tryAgain()}>
          <RotateCcw size={16} className={busy ? 'animate-spin' : undefined} />
          Try again
        </button>
        <div className="mt-3 flex justify-center">
          <DownloadProgress />
        </div>
      </div>
    </div>
  );
}
