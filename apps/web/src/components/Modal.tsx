import { useEffect, useRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import Overlay from './Overlay';

/**
 * The centered/top-sheet modal every command surface shares — the counterpart to `SlideOver` for
 * things that aren't drawers (command palette, capture bar, shortcut help, day peek). It wraps the
 * shared `Overlay` (so it inherits the deliberate no-portal / no-AnimatePresence backdrop and
 * Escape/click-out) and adds the three things each of those used to hand-roll differently: a labelled
 * `role="dialog"`, a real focus trap with focus restoration, and one entrance animation. Transform
 * motion is suppressed automatically under reduced-motion by the app-root `MotionConfig`.
 *
 * `placement`: `top` for command-style sheets that drop from the top, `center` for a dialog. Width is
 * the caller's job via `className` (e.g. `max-w-xl`, `w-[min(92vw,30rem)]`).
 */
function useFocusTrap(ref: React.RefObject<HTMLElement>, open: boolean, initialFocus: boolean) {
  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    const trigger = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          )
        : [];

    if (initialFocus && node) (focusables()[0] ?? node).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !node) return;
      const f = focusables();
      if (f.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = f[0];
      const last = f[f.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Return focus to whatever opened the modal — a keyboard user lands back where they were.
      trigger?.focus?.();
    };
  }, [open, initialFocus, ref]);
}

const PLACEMENT: Record<'top' | 'center', string> = {
  top: 'fixed inset-x-4 top-[12vh] z-50 mx-auto',
  center: 'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
};

export default function Modal({
  open,
  onClose,
  label,
  placement = 'center',
  className = '',
  initialFocus = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  placement?: 'top' | 'center';
  className?: string;
  /** Set false when a child owns focus on mount (e.g. cmdk's autoFocus input). */
  initialFocus?: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open, initialFocus);

  return (
    <Overlay open={open} onClose={onClose}>
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`${PLACEMENT[placement]} outline-none ${className}`}
        initial={{ opacity: 0, scale: 0.97, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
      >
        {children}
      </motion.div>
    </Overlay>
  );
}
