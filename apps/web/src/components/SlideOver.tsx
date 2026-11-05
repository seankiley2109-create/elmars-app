import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import Overlay from './Overlay';

export default function SlideOver({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Overlay open={open} onClose={onClose}>
      <motion.aside
        key="panel"
        role="dialog"
        aria-label={title}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-line bg-surface shadow-2xl"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="truncate text-base font-bold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface2 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </motion.aside>
    </Overlay>
  );
}
