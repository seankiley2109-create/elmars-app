import { motion } from 'framer-motion';
import { Star, Trash2 } from 'lucide-react';
import { FOCUS_CAP, useHQ } from '../store';
import { deleteWithUndo } from '../lib/undo';
import { useOpenTask } from './TaskDetailHost';
import { isDone, type Task } from '../types';
import { daysUntil, formatShort } from '../lib/dates';
import { projectCrumb } from '../selectors';
import { MARKER_TONE } from './tone';
import { PRIORITY_TONE } from '../lib/taskTone';

export function AnimatedCheck({ checked }: { checked: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
        checked ? 'glow border-accent bg-accent' : 'border-line bg-surface2'
      }`}
    >
      <motion.svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden>
        <motion.path
          d="M3 8.5 L6.5 12 L13 4.5"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        />
      </motion.svg>
    </span>
  );
}

export default function TaskRow({ task, showProject = true }: { task: Task; showProject?: boolean }) {
  const toggleTask = useHQ((s) => s.toggleTask);
  const toggleFocus = useHQ((s) => s.toggleFocus);
  const deleteTask = useHQ((s) => s.deleteTask);
  const openTask = useOpenTask();
  const crumb = useHQ((s) => {
    const p = s.projects.find((x) => x.id === task.projectId);
    return p ? projectCrumb(s, p) : undefined;
  });
  // the 3-star cap, surfaced as a disabled star with a reason rather than a click that silently no-ops
  const focusFull = useHQ(
    (s) => !task.focus && s.tasks.filter((t) => t.focus && t.status !== 'done').length >= FOCUS_CAP,
  );
  // on screen a task is only open or done; the other statuses stay in the data
  const done = isDone(task);

  const due = task.dueDate ? daysUntil(task.dueDate) : null;
  const dueLabel =
    due === null ? null : due < 0 ? `${-due}d overdue` : due === 0 ? 'today' : formatShort(task.dueDate!);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="group flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5"
    >
      <button
        onClick={() => toggleTask(task.id)}
        aria-label={done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
        className="shrink-0"
      >
        <AnimatedCheck checked={done} />
      </button>

      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${MARKER_TONE[PRIORITY_TONE[task.priority]]}`} title={`${task.priority} priority`} />

      <button
        onClick={() => openTask(task.id)}
        title={task.title}
        className={`min-w-0 flex-1 truncate text-left text-sm transition-colors hover:text-accent ${done ? 'text-dim line-through' : ''}`}
        aria-label={`Open "${task.title}"`}
      >
        {task.title}
      </button>

      {showProject && crumb && (
        <span
          title={crumb}
          className="max-w-48 truncate rounded-full bg-surface2 px-2 py-0.5 text-2xs text-muted"
        >
          {crumb}
        </span>
      )}

      {dueLabel && (
        <span className={`shrink-0 text-2xs tnum ${due! < 0 ? 'font-semibold text-warn' : 'text-muted'}`}>
          {dueLabel}
        </span>
      )}

      {/* Row controls stay faintly visible at rest (discoverable, not invisible) and come up to full
          on row hover or keyboard focus. */}
      {!done && (
        <button
          onClick={() => toggleFocus(task.id)}
          disabled={focusFull}
          title={focusFull ? 'Focus is full — 3 max. Unstar one first.' : undefined}
          aria-label={task.focus ? 'Remove from focus' : focusFull ? 'Focus is full — 3 max' : 'Add to focus'}
          className={`shrink-0 transition ${
            task.focus
              ? 'text-accent'
              : focusFull
                ? 'cursor-default text-dim opacity-30'
                : 'text-dim opacity-50 hover:!text-accent group-hover:opacity-100 focus-visible:opacity-100'
          }`}
        >
          <Star size={16} fill={task.focus ? 'currentColor' : 'none'} />
        </button>
      )}

      <button
        onClick={() => deleteWithUndo(() => deleteTask(task.id))}
        aria-label={`Delete "${task.title}"`}
        className="shrink-0 text-dim opacity-50 transition hover:!text-warn group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Trash2 size={15} />
      </button>
    </motion.div>
  );
}
