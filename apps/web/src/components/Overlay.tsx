import { useEffect, type ReactNode } from 'react';

/**
 * The one backdrop every overlay shares: dimmed, click-outside and Escape both close.
 * Children are the panel — motion elements at z-50; their initial/animate entrance plays,
 * and close is an instant unmount.
 *
 * ⚠️ No AnimatePresence, no createPortal — by measurement, not taste. In this stack (React
 * 18.3 StrictMode dev + framer-motion 11.15) AnimatePresence NEVER removes an exiting child
 * that leaves via a conditional: the panel and backdrop finish their fade and then sit in the
 * DOM forever, the invisible backdrop eating every click in the app. Everything here is
 * position:fixed, so document order doesn't matter; the z-scale does the stacking.
 *
 * Z-scale, app-wide: z-30 floating chips (search hint, VaultToast) · z-40 mobile
 * nav + this backdrop · z-50 overlay panels · z-[60] undo toasts.
 */
export default function Overlay({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} aria-hidden />}
      {open && children}
    </>
  );
}
