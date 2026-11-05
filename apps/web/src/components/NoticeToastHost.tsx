import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useNotices } from '../lib/notice';

/** Plain notices (see lib/notice.ts), bottom-centre just above the undo toasts. */
export default function NoticeToastHost() {
  const notices = useNotices((s) => s.notices);
  const dismiss = useNotices((s) => s.dismiss);
  const navigate = useNavigate();
  if (!notices.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2">
      {notices.map((n) => (
        <div
          key={n.id}
          role="status"
          className="pointer-events-auto flex max-w-[32rem] items-center gap-2 rounded-xl border border-line bg-panel py-1 pl-4 pr-1 text-sm text-ink shadow-2xl"
        >
          <span className="min-w-0 flex-1">{n.text}</span>
          {n.action && (
            <button
              type="button"
              onClick={() => {
                dismiss(n.id);
                navigate(n.action!.to);
              }}
              className="h-11 shrink-0 rounded-md px-3 font-semibold text-[var(--mt-accent-text)] hover:bg-raised"
            >
              {n.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(n.id)}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-raised hover:text-ink"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
