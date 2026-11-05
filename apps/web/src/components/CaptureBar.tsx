import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useHQ } from '../store';
import { projectColor } from '../selectors';
import { parseCapture } from '../lib/capture';
import Modal from './Modal';
import { BAR_FOCUS_RING } from './ui';

/**
 * ⌘N from anywhere: one line becomes an open task with no date. `@` and the start of a project's
 * name files it there ("Call Pieter @kitch"); the project it will land in shows as you type.
 *
 * Typed text is never thrown away. The draft lives here, not in the dialog, so however the bar
 * closes without adding — Escape, a click outside, ⌘K — it is still there on the next ⌘N. It only
 * empties once the task is added. A line that names a project but no task keeps the bar open.
 */
export default function CaptureBar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addTask = useHQ((s) => s.addTask);
  const projects = useHQ((s) => s.projects);
  const [text, setText] = useState('');
  const [needsTitle, setNeedsTitle] = useState(false);

  const parsed = useMemo(() => parseCapture(text, projects), [text, projects]);
  const project = parsed.projectId ? projects.find((p) => p.id === parsed.projectId) : undefined;

  useEffect(() => {
    if (!open) setNeedsTitle(false);
  }, [open]);

  const submit = () => {
    if (!text.trim()) {
      onClose(); // nothing typed, nothing to keep
      return;
    }
    if (!parsed.title) {
      setNeedsTitle(true); // "@kitchen" alone: say what is missing, keep the bar and the text
      return;
    }
    addTask({ title: parsed.title, projectId: parsed.projectId });
    setText('');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} label="Capture" placement="top" className="max-w-xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className={`overflow-hidden rounded-lg border border-line-strong bg-panel shadow-2xl ${BAR_FOCUS_RING}`}
      >
        <label className="flex h-[52px] items-center gap-3 px-4 text-ink-2">
          <Plus size={20} strokeWidth={1.75} className="shrink-0" aria-hidden />
          <input
            autoFocus
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setNeedsTitle(false);
            }}
            placeholder="Capture a task. Type @ to put it in a project."
            aria-label="Capture a task"
            aria-describedby={needsTitle ? 'capture-hint' : undefined}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
          />
          <kbd className="font-mono shrink-0 rounded border border-line bg-panel px-[5px] text-2xs leading-[18px] text-ink-2">
            esc
          </kbd>
        </label>
        {(project || needsTitle) && (
          <div className="flex items-center gap-2 border-t border-line px-4 py-2 text-xs text-ink-2">
            {project && (
              <>
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  style={{ background: projectColor({ projects }, project) ?? 'var(--mt-line-strong)' }}
                  aria-hidden
                />
                Goes in <span className="font-semibold text-ink">{project.name}</span>
              </>
            )}
            {needsTitle && (
              <span id="capture-hint" role="status" className={`font-semibold text-warn ${project ? 'ml-auto' : ''}`}>
                Add what to do, then press Enter
              </span>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}
