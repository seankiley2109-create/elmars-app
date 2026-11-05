import Modal from './Modal';
import { NAV_ITEMS } from './Sidebar';

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-line bg-surface2 px-1.5 py-0.5 text-2xs font-semibold">
      {children}
    </kbd>
  );
}

function Row({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-xs text-muted">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((k) => (
          <Key key={k}>{k}</Key>
        ))}
      </span>
    </div>
  );
}

/** Press `?` anywhere. Every shortcut the app answers to, on the shared Overlay. */
export default function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} label="Keyboard shortcuts" placement="top" className="max-w-xl">
        <div className="glow max-h-[70vh] overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-2xl">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-base font-bold">Keyboard shortcuts</h2>
            <kbd className="rounded border border-line px-1.5 py-0.5 text-micro text-dim">esc</kbd>
          </div>

          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <div>
              <div className="label mb-1.5">Anywhere</div>
              <Row keys={['⌘', 'K']} label="Search everything" />
              <Row keys={['⌘', 'N']} label="Capture a task" />
              <Row keys={['n']} label="Jump to the page's input" />
              <Row keys={['?']} label="This help" />
            </div>
            <div className="sm:col-span-2">
              <div className="label mb-1.5">Go to — press g, then</div>
              <div className="grid gap-x-8 sm:grid-cols-2">
                {NAV_ITEMS.map(({ key, label }) => (
                  <Row key={key} keys={[`g ${key}`]} label={label} />
                ))}
              </div>
            </div>
          </div>
        </div>
    </Modal>
  );
}
