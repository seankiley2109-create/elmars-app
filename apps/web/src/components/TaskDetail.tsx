import { useState } from 'react';
import { Star, Trash2 } from 'lucide-react';
import { useHQ } from '../store';
import { deleteWithUndo } from '../lib/undo';
import { isDone, type Priority } from '../types';
import { dayOfIso, formatShort } from '../lib/dates';
import SlideOver from './SlideOver';
import { AnimatedCheck } from './TaskRow';
import LinkPicker from './LinkPicker';
import Attachments from './Attachments';
import ProjectSelect from './ProjectSelect';
import { SectionLabel, btn, inputCls, selectCls } from './ui';

const PRIORITIES: Priority[] = ['low', 'medium', 'high'];

/**
 * The task's one editing surface — everything a task is, changeable in one place. Until this
 * existed a task's title and priority were frozen at creation; the only field the app ever
 * patched was dueDate, by drag.
 */
export default function TaskDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const task = useHQ((s) => s.tasks.find((t) => t.id === id));
  const updateTask = useHQ((s) => s.updateTask);
  const toggleTask = useHQ((s) => s.toggleTask);
  const toggleFocus = useHQ((s) => s.toggleFocus);
  const deleteTask = useHQ((s) => s.deleteTask);
  const [focusFull, setFocusFull] = useState(false);

  if (!task) return null;
  // on screen a task is only open or done; the other statuses stay in the data
  const done = isDone(task);

  return (
    <SlideOver open onClose={onClose} title="Task">
      <div className="space-y-5">
        <input
          className={`${inputCls} text-lg font-bold`}
          value={task.title}
          onChange={(e) => updateTask(id, { title: e.target.value })}
          aria-label="Task title"
        />

        <button
          onClick={() => toggleTask(id)}
          aria-pressed={done}
          className="flex items-center gap-2.5 text-sm"
        >
          <AnimatedCheck checked={done} />
          Done
        </button>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <SectionLabel>Priority</SectionLabel>
            <select
              className={selectCls}
              value={task.priority}
              onChange={(e) => updateTask(id, { priority: e.target.value as Priority })}
              aria-label="Priority"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p[0].toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <SectionLabel>Due</SectionLabel>
            <input
              type="date"
              className={inputCls}
              value={task.dueDate ?? ''}
              onChange={(e) => updateTask(id, { dueDate: e.target.value || undefined })}
              aria-label="Due date"
            />
          </div>
        </div>

        <div>
          <SectionLabel>Work window</SectionLabel>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor={`start-${id}`} className="mb-1 block text-2xs text-dim">Start 🛫</label>
              <input
                id={`start-${id}`}
                type="date"
                className={inputCls}
                value={task.startDate ?? ''}
                onChange={(e) => updateTask(id, { startDate: e.target.value || undefined })}
              />
            </div>
            <div>
              <label htmlFor={`sched-${id}`} className="mb-1 block text-2xs text-dim">Scheduled ⏳</label>
              <input
                id={`sched-${id}`}
                type="date"
                className={inputCls}
                value={task.scheduledDate ?? ''}
                onChange={(e) => updateTask(id, { scheduledDate: e.target.value || undefined })}
              />
            </div>
          </div>
          <p className="mt-1.5 text-2xs text-dim">
            Set both to give the task a multi-day bar on the calendar — or just drag a chip’s edge.
            Due stays a separate deadline.
          </p>
        </div>

        <div>
          <SectionLabel>Project</SectionLabel>
          <ProjectSelect
            value={task.projectId}
            onChange={(projectId) => updateTask(id, { projectId })}
            label="Project this task belongs to"
          />
        </div>

        <div>
          <SectionLabel>Notes</SectionLabel>
          <textarea
            className={`${inputCls} min-h-28 resize-y font-mono text-2sm`}
            placeholder="Anything worth remembering…"
            value={task.notes ?? ''}
            onChange={(e) => updateTask(id, { notes: e.target.value || undefined })}
            aria-label="Task notes"
          />
        </div>

        {!done && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => {
                const ok = toggleFocus(id);
                setFocusFull(!ok);
              }}
              aria-pressed={task.focus}
              className={btn({ active: task.focus })}
            >
              <Star size={15} fill={task.focus ? 'currentColor' : 'none'} />
              {task.focus ? 'Focused' : 'Focus'}
            </button>
            {focusFull && !task.focus && <span className="text-xs text-warn">Focus is full — 3 max. Unstar one first.</span>}
          </div>
        )}

        <LinkPicker entity={{ type: 'task', id }} />
        <Attachments entity={{ type: 'task', id }} />

        <p className="text-xs text-dim">
          Created {formatShort(dayOfIso(task.createdAt))}
          {task.completedAt ? ` · completed ${formatShort(dayOfIso(task.completedAt))}` : ''}
        </p>

        <div className="border-t border-line pt-4">
          <button
            onClick={() => {
              deleteWithUndo(() => deleteTask(id));
              onClose();
            }}
            className={btn({ tone: 'danger' })}
          >
            <Trash2 size={15} /> Delete task
          </button>
        </div>
      </div>
    </SlideOver>
  );
}
