import { useEffect } from 'react';
import { ArrowDownCircle, X } from 'lucide-react';
import { onAppFocus } from '../lib/platform';
import {
  FIRST_CHECK_MS,
  TICK_MS,
  UPDATE_COPY,
  canUpdate,
  checkQuietly,
  dismissUpdate,
  installUpdate,
  offerLine,
  progressLine,
  useUpdates,
} from '../lib/updater';
import { FOCUS_RING } from './ui';

/**
 * The app's own looks for an update: once, 30 s after it is ready, then whenever the window comes to
 * the front or the half-hourly timer ticks, but at most once every 6 hours (`checkQuietly`). Only in
 * the Mac app. Never a word on screen unless an update is found.
 */
export function useUpdateChecks(): void {
  useEffect(() => {
    if (!canUpdate()) return;
    let started = false;
    const first = window.setTimeout(() => {
      started = true;
      void checkQuietly();
    }, FIRST_CHECK_MS);
    const later = () => {
      if (started) void checkQuietly();
    };
    const tick = window.setInterval(later, TICK_MS);
    const offFocus = onAppFocus(later);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(tick);
      offFocus();
    };
  }, []);
}

/**
 * The offer of a new version: a calm card, bottom right, that he can put away ("Later"). Its main
 * button is the one thing to do at that moment, so it is marked in the accent, but as a tint rather
 * than a second pink fill: the page underneath keeps its own one pink button.
 */
export default function UpdateBar() {
  useUpdateChecks();
  const offer = useUpdates((s) => s.offer);
  const shown = useUpdates((s) => s.shown);
  const phase = useUpdates((s) => s.phase);
  const progress = useUpdates((s) => s.progress);

  if (!offer || !shown) return null;
  const busy = phase === 'saving' || phase === 'downloading' || phase === 'restarting';

  let line: string;
  if (phase === 'saving') line = UPDATE_COPY.saving;
  else if (phase === 'downloading') line = progressLine(progress);
  else if (phase === 'restarting') line = UPDATE_COPY.restarting;
  else line = offerLine(offer);

  return (
    <section
      aria-label="New version"
      data-testid="update-bar"
      className="fixed bottom-36 right-4 z-[55] w-[min(92vw,26rem)] rounded-lg border border-line bg-panel p-4 shadow-2xl md:bottom-6 md:right-6"
    >
      <div className="flex items-start gap-3">
        <ArrowDownCircle size={20} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <div role="status" className="min-w-0 flex-1">
          {phase === 'failed' ? (
            <p className="text-sm text-ink">{UPDATE_COPY.failed}</p>
          ) : (
            <>
              <p className="text-sm font-semibold text-ink">{UPDATE_COPY.ready}</p>
              <p className="mt-0.5 truncate text-2sm text-ink-2" data-testid="update-line">
                {line}
              </p>
            </>
          )}
        </div>
        {phase === 'failed' && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={dismissUpdate}
            className={`-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-raised hover:text-ink ${FOCUS_RING}`}
          >
            <X size={16} aria-hidden />
          </button>
        )}
      </div>
      {phase !== 'failed' && (
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={dismissUpdate}
            disabled={busy}
            className={`inline-flex min-h-11 items-center rounded-md border border-transparent px-4 text-sm font-semibold text-ink-2 transition-colors hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
          >
            {UPDATE_COPY.later}
          </button>
          <button
            type="button"
            onClick={() => void installUpdate()}
            disabled={busy}
            className={`inline-flex min-h-11 items-center rounded-md border border-[var(--mt-action)] bg-[var(--mt-action-tint)] px-4 text-sm font-semibold text-[var(--mt-accent-text)] transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
          >
            {UPDATE_COPY.update}
          </button>
        </div>
      )}
    </section>
  );
}
