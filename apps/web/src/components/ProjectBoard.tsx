import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { motion } from 'framer-motion';
import { FileText, Plus } from 'lucide-react';
import { useHQ } from '../store';
import { childProjects, projectCard, projectColor } from '../selectors';
import { daysUntil, parseDateStr } from '../lib/dates';
import { Button } from './ui';
import { STATUS_LABEL, type Project, type ProjectStatus } from '../types';

/**
 * The project-status board, shared by the Projects page (top-level projects) and the parent
 * workspace (subprojects). Dropping a card calls `setProjectStatus`; what clicking means is the
 * caller's business via `onOpen`.
 *
 * Column titles are the on-screen status names from `STATUS_LABEL` (On the go, On hold, Someday,
 * Done) — never the data's own words. Each column sits on the raised surface; pass `onCreate` and
 * the open columns get a "+" that adds a project straight into that status.
 */

const COLUMN_ORDER: ProjectStatus[] = ['active', 'blocked', 'later', 'shipped'];
const COLUMNS = COLUMN_ORDER.map((status) => ({ status, title: STATUS_LABEL[status] }));

const DAY_MONTH = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const dayMonth = (d: string) => DAY_MONTH.format(parseDateStr(d));

const NO_COLOR = '#6B6963';

/** The card's top-right pill: finished, waiting, or the date it is aimed at. */
function CardPill({ status, target }: { status: ProjectStatus; target?: string }) {
  const base = 'ml-auto inline-flex h-[22px] items-center whitespace-nowrap rounded-full px-2 text-xs font-medium';
  if (status === 'shipped') return <span className={`${base} bg-ok-bg text-ok`}>Done</span>;
  if (status === 'blocked') return <span className={`${base} bg-pend-bg text-pend`}>Waiting</span>;
  if (!target) return null;
  const days = daysUntil(target);
  if (days < 0) return <span className={`${base} bg-crit-bg text-crit`}>Due {dayMonth(target)}</span>;
  if (days <= 14) return <span className={`${base} bg-soon-bg text-soon`}>Due {dayMonth(target)}</span>;
  return <span className={`${base} bg-raised text-ink-2`}>By {dayMonth(target)}</span>;
}

/** What a project card holds: name, next step, progress bar, counts, and a target pill. */
export function ProjectStatusCard({
  project,
  dragging = false,
  showStatus = false,
}: {
  project: Project;
  dragging?: boolean;
  /** Spell the status out as a pill — for grids that do not group by status. */
  showStatus?: boolean;
}) {
  const projects = useHQ((s) => s.projects);
  const tasks = useHQ((s) => s.tasks);
  const notes = useHQ((s) => s.notes);
  const card = projectCard({ projects, tasks, notes }, project);
  const color = projectColor({ projects }, project) ?? NO_COLOR;
  const subCount = childProjects({ projects }, project.id).length;
  const shipped = project.status === 'shipped';
  const pct = card.total ? Math.round((card.done / card.total) * 100) : 0;
  const nextLine = card.next
    ? project.status === 'active'
      ? `Next: ${card.next}`
      : card.next
    : card.total === 0 && project.status === 'later'
      ? 'An idea for now. No tasks yet.'
      : undefined;

  return (
    // spans all the way down: this card sits inside a <button> in the workspace's list, where a block element is invalid
    <span
      className={`flex flex-col gap-2.5 rounded-lg border bg-panel p-3.5 text-left text-ink transition-colors ${
        dragging ? 'border-line-strong shadow-lg' : 'border-line hover:border-line-strong'
      }`}
    >
      <span className={`flex items-center gap-2 text-[15px] font-semibold leading-[22px] ${shipped ? 'text-ink-2' : ''}`}>
        <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color }} aria-hidden />
        <span className="min-w-0 flex-1 break-words">{project.name}</span>
        {showStatus && (
          <span className="inline-flex h-[22px] shrink-0 items-center rounded-full bg-raised px-2 text-xs font-medium text-ink-2">
            {STATUS_LABEL[project.status]}
          </span>
        )}
      </span>
      {nextLine && <span className="text-2sm leading-[18px] text-ink-2">{nextLine}</span>}
      {card.total > 0 && (
        <span className="block h-1.5 overflow-hidden rounded-[3px] bg-raised">
          <span
            className="block h-full rounded-[3px]"
            style={{ width: `${pct}%`, background: shipped ? 'var(--mt-ok)' : color }}
          />
        </span>
      )}
      <span className="flex items-center gap-3 text-xs text-ink-2">
        {card.total > 0 && (
          <span className="mono">
            {card.done} of {card.total}
          </span>
        )}
        {card.notes > 0 ? (
          <span className="inline-flex items-center gap-1">
            <FileText size={14} aria-hidden />
            {card.notes} {card.notes === 1 ? 'note' : 'notes'}
          </span>
        ) : (
          card.total === 0 && <span>No notes yet</span>
        )}
        {subCount > 0 && (
          <span>
            {subCount} subproject{subCount === 1 ? '' : 's'}
          </span>
        )}
        <CardPill status={project.status} target={card.target} />
      </span>
    </span>
  );
}

function DraggableCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: project.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      aria-label={`${project.name} — drag to change status, press to open`}
      onClick={onOpen}
      className={`cursor-grab touch-none active:cursor-grabbing ${isDragging ? 'opacity-30' : ''}`}
    >
      <ProjectStatusCard project={project} />
    </div>
  );
}

/** The one-line "name it" form that opens inside a column. Enter adds, Escape closes. */
function Composer({ title, onSubmit, onCancel }: { title: string; onSubmit: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (n) onSubmit(n);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg border border-line-strong bg-panel p-2.5">
      <input
        ref={ref}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        placeholder="Name this project…"
        aria-label={`New project name — ${title}`}
        className="h-11 w-full rounded-md border border-line-strong bg-paper px-2.5 text-sm focus:border-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mt-focus)]"
      />
      <div className="flex justify-end gap-2">
        <Button variant="quiet" className="h-11 px-3" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="secondary" type="submit" className="h-11 px-3" disabled={!name.trim()}>
          Add
        </Button>
      </div>
    </form>
  );
}

function Column({
  status,
  title,
  projects,
  onOpen,
  adding,
  onAdd,
  onCancelAdd,
  onCreate,
}: {
  status: ProjectStatus;
  title: string;
  projects: Project[];
  onOpen: (id: string) => void;
  adding: boolean;
  onAdd?: (opener: HTMLElement) => void;
  onCancelAdd: () => void;
  onCreate?: (name: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      aria-labelledby={`col-${status}`}
      className={`flex min-h-64 min-w-0 flex-col gap-2.5 rounded-[10px] bg-raised px-2.5 pb-3 pt-1.5 transition-shadow ${
        isOver ? 'ring-2 ring-line-strong' : ''
      }`}
    >
      <div className="flex h-11 items-center gap-2 px-1">
        <h2 id={`col-${status}`} className="m-0 text-[15px]">
          {title}
        </h2>
        <span className="mono text-xs text-ink-2">{projects.length}</span>
        {onAdd && (
          <button
            type="button"
            onClick={(e) => onAdd(e.currentTarget)}
            aria-label={`Add a project to ${title}`}
            className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-line hover:text-ink"
          >
            <Plus size={16} aria-hidden />
          </button>
        )}
      </div>
      {adding && onCreate && <Composer title={title} onSubmit={onCreate} onCancel={onCancelAdd} />}
      {projects.map((p) => (
        <motion.div key={p.id} layout transition={{ duration: 0.18, ease: 'easeOut' }}>
          <DraggableCard project={p} onOpen={() => onOpen(p.id)} />
        </motion.div>
      ))}
      {status === 'later' &&
        (onAdd ? (
          <button
            type="button"
            onClick={(e) => onAdd(e.currentTarget)}
            className="flex h-16 items-center justify-center rounded-lg border border-dashed border-line-strong text-ink-2 transition-colors hover:bg-panel hover:text-ink"
          >
            Drop an idea here
          </button>
        ) : (
          <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-line-strong text-ink-2">
            Drop an idea here
          </div>
        ))}
    </section>
  );
}

export default function ProjectBoard({
  projects,
  onOpen,
  onCreate,
  adding: addingProp,
  onAddingChange,
  returnFocusRef,
}: {
  projects: Project[];
  onOpen: (id: string) => void;
  /** Adds a project in a status; when given, the open columns get a "+" button. */
  onCreate?: (name: string, status: ProjectStatus) => void;
  /** Which column's add form is open, when the parent drives it (the header's "New project"). */
  adding?: ProjectStatus | null;
  onAddingChange?: (status: ProjectStatus | null) => void;
  /** Where focus goes when a form the parent opened (not a column "+") closes. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const setProjectStatus = useHQ((s) => s.setProjectStatus);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [addingOwn, setAddingOwn] = useState<ProjectStatus | null>(null);
  const adding = addingProp !== undefined ? addingProp : addingOwn;
  const setAdding = onAddingChange ?? setAddingOwn;
  // the "+" or slot that opened the form: closing it (cancel or add) hands focus back there
  const openerRef = useRef<HTMLElement | null>(null);
  const openForm = (status: ProjectStatus, opener: HTMLElement) => {
    openerRef.current = opener;
    setAdding(status);
  };
  const closeForm = () => {
    setAdding(null);
    const back = openerRef.current ?? returnFocusRef?.current;
    openerRef.current = null;
    back?.focus();
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const over = e.over?.id as ProjectStatus | undefined;
    if (!over) return;
    setProjectStatus(String(e.active.id), over);
  };
  const dragged = projects.find((p) => p.id === activeId);

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="grid min-h-0 flex-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((c) => (
          <Column
            key={c.status}
            {...c}
            projects={projects.filter((p) => p.status === c.status)}
            onOpen={onOpen}
            adding={adding === c.status}
            // finished work is not added to; the Done column has no "+"
            onAdd={onCreate && c.status !== 'shipped' ? (opener) => openForm(c.status, opener) : undefined}
            onCancelAdd={closeForm}
            onCreate={
              onCreate
                ? (name) => {
                    onCreate(name, c.status);
                    closeForm();
                  }
                : undefined
            }
          />
        ))}
      </div>
      <DragOverlay>{dragged ? <ProjectStatusCard project={dragged} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}
