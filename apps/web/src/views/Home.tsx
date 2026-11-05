import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { Download, Plus } from 'lucide-react';
import { useHQ } from '../store';
import {
  comingUp,
  eventsOn,
  greeting,
  projectColor,
  projectProgress,
  recentNotes,
  todayTasks,
} from '../selectors';
import { parseCapture } from '../lib/capture';
import { addDays, dayOfIso, parseDateStr } from '../lib/dates';
import { useNow, useToday } from '../lib/use-today';
import { useOpenTask } from '../components/TaskDetailHost';
import { Button } from '../components/ui';
import { isDone, type CalEvent, type Note, type Project, type Task } from '../types';

/* ---- small formatters ---- */

const NO_PROJECT_DOT = 'var(--mt-line-strong)';

/** "Tuesday 3 November" — the day, the date, the month; no comma, whatever the system locale. */
function longDay(dateStr: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).formatToParts(
    parseDateStr(dateStr),
  );
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}`;
}

/** "Thu 5 Nov" */
function shortDay(dateStr: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(
    parseDateStr(dateStr),
  );
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}`;
}

/** "31 Oct" */
function dayMonth(dateStr: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).formatToParts(
    parseDateStr(dateStr),
  );
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')} ${get('month')}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Edited 2 hours ago", "Edited yesterday". */
function editedAgo(iso: string, now: Date, today: string): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'Edited just now';
  if (minutes < 60) return `Edited ${plural(minutes, 'minute', 'minutes')} ago`;
  const day = dayOfIso(iso);
  if (day === today) return `Edited ${plural(Math.floor(minutes / 60), 'hour', 'hours')} ago`;
  if (day === addDays(today, -1)) return 'Edited yesterday';
  const days = Math.round((parseDateStr(today).getTime() - parseDateStr(day).getTime()) / 86_400_000);
  if (days < 30) return `Edited ${days} days ago`;
  return `Edited ${dayMonth(day)}`;
}

/** The first couple of lines of a note's body, with the markdown marks taken out. */
function snippet(body: string): string {
  return body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function duration(start: string, end: string): string | undefined {
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const m = mins(end) - mins(start);
  if (!(m > 0)) return undefined;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

/* ---- pieces ---- */

const PILL = 'inline-flex h-[22px] items-center whitespace-nowrap rounded-full px-2 text-xs font-medium';
const PILL_TONE = { crit: 'bg-crit-bg text-crit', soon: 'bg-soon-bg text-soon', ok: 'bg-ok-bg text-ok' } as const;

function Dot({ color }: { color?: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]"
      style={{ background: color ?? NO_PROJECT_DOT }}
      aria-hidden
    />
  );
}

function Panel({ id, title, children, aside }: { id: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex h-[52px] items-center gap-2.5 px-4">
        <h2 id={id} className="text-[17px] leading-6">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const EMPTY = 'border-t border-line px-4 py-4 text-ink-2';

type ProjectLookup = (id: string | undefined) => { name: string; color?: string } | undefined;

function TodayRow({ task, today, lookup }: { task: Task; today: string; lookup: ProjectLookup }) {
  const toggleTask = useHQ((s) => s.toggleTask);
  const openTask = useOpenTask();
  const done = isDone(task);
  const project = lookup(task.projectId);
  const overdue = !done && task.dueDate !== undefined && task.dueDate < today;
  const pill = done
    ? { tone: PILL_TONE.ok, text: 'Done' }
    : overdue
      ? { tone: PILL_TONE.crit, text: `Overdue · ${dayMonth(task.dueDate!)}` }
      : { tone: PILL_TONE.soon, text: 'Today' };

  return (
    <div className="flex h-[52px] items-center gap-3.5 border-t border-line px-4 hover:bg-[#FAF9F6]">
      {/* the box stays 20 px as drawn; the label around it is the 24 px hit area */}
      <label className="-m-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          checked={done}
          onChange={() => toggleTask(task.id)}
          aria-label={done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
          className="m-0 h-5 w-5 cursor-pointer accent-ink"
        />
      </label>
      <button
        type="button"
        onClick={() => openTask(task.id)}
        aria-label={`Open "${task.title}"`}
        className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 text-left"
      >
        <span
          className={`truncate text-[15px] leading-[22px] ${
            done ? 'font-medium text-ink-3 line-through' : 'font-semibold'
          }`}
        >
          {task.title}
        </span>
        <span className="flex items-center gap-1.5 text-xs leading-4 text-ink-2">
          <Dot color={project?.color} />
          <span className="truncate">{project?.name ?? 'No project'}</span>
        </span>
      </button>
      <span className={`${PILL} ${pill.tone}`}>{pill.text}</span>
    </div>
  );
}

function CaptureBar({ inputRef, today }: { inputRef: RefObject<HTMLInputElement>; today: string }) {
  const addTask = useHQ((s) => s.addTask);
  const projects = useHQ((s) => s.projects);
  const [text, setText] = useState('');

  const submit = () => {
    const parsed = parseCapture(text, projects);
    if (!parsed.title) return;
    addTask({ title: parsed.title, projectId: parsed.projectId, dueDate: today });
    setText('');
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="flex h-[52px] items-center gap-3 rounded-lg border border-line-strong bg-panel px-4 text-ink-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-action">
        <Plus size={20} strokeWidth={1.75} className="shrink-0" aria-hidden />
        <span className="sr-only">Capture</span>
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Capture a task for today. Type @ to put it in a project."
          className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
        />
        <kbd className="font-mono shrink-0 rounded border border-line bg-panel px-[5px] text-2xs leading-[18px] text-ink-2">
          ⌘N
        </kbd>
      </label>
    </form>
  );
}

function NoteCard({ note, project, now, today }: { note: Note; project?: Project; now: Date; today: string }) {
  const projects = useHQ((s) => s.projects);
  const folder = note.folder?.split('/')[0];
  return (
    <Link
      to={`/notes/${note.id}`}
      className="flex h-[100px] flex-col gap-1.5 rounded-lg border border-line bg-panel px-4 py-3.5 text-ink hover:border-line-strong"
    >
      <span className="truncate font-semibold">{note.title || 'Untitled'}</span>
      <span className="line-clamp-2 text-2sm leading-[18px] text-ink-2">{snippet(note.body)}</span>
      <span className="mt-auto flex items-center gap-1.5 text-xs leading-4 text-ink-2">
        {project ? (
          <>
            <Dot color={projectColor({ projects }, project)} />
            {editedAgo(note.updatedAt, now, today)}
          </>
        ) : folder ? (
          <>
            <Download size={14} strokeWidth={1.75} aria-hidden />
            <span className="truncate">{folder}</span>
          </>
        ) : (
          editedAgo(note.updatedAt, now, today)
        )}
      </span>
    </Link>
  );
}

function EventRow({
  event,
  lookup,
  soon,
}: {
  event: CalEvent;
  lookup: ProjectLookup;
  /** Minutes until it starts, when that is under an hour. */
  soon?: number;
}) {
  const project = lookup(event.projectId);
  const length = event.start && event.end ? duration(event.start, event.end) : undefined;
  const detail = [event.location, project?.name, length].filter(Boolean).join(' · ');
  return (
    <div className="flex min-h-14 items-start gap-3.5 border-t border-line px-4 py-2.5">
      {event.start ? (
        <span className="mono w-11 shrink-0 pt-px text-2sm leading-5">{event.start}</span>
      ) : (
        <span className="w-11 shrink-0 pt-px text-xs leading-5 text-ink-2">All day</span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-semibold">{event.title}</span>
        {detail && (
          <span className="flex items-center gap-1.5 text-xs leading-4 text-ink-2">
            {project && <Dot color={project.color} />}
            <span className="truncate">{detail}</span>
          </span>
        )}
      </div>
      {soon !== undefined && <span className={`${PILL} ${PILL_TONE.soon}`}>In {soon} min</span>}
    </div>
  );
}

/* ---- the screen ---- */

export default function Home() {
  const { userName, tasks, projects, notes, events } = useHQ(
    useShallow((s) => ({
      userName: s.settings.userName,
      tasks: s.tasks,
      projects: s.projects,
      notes: s.notes,
      events: s.events,
    })),
  );
  const today = useToday();
  const now = useNow();
  const openTask = useOpenTask();
  const captureRef = useRef<HTMLInputElement>(null);

  const lookup: ProjectLookup = useMemo(() => {
    const byId = new Map(projects.map((p) => [p.id, p]));
    return (id) => {
      const p = id ? byId.get(id) : undefined;
      return p ? { name: p.name, color: projectColor({ projects }, p) } : undefined;
    };
  }, [projects]);

  const todays = useMemo(() => todayTasks({ tasks }, today), [tasks, today]);
  const upcoming = useMemo(() => comingUp({ tasks }, today), [tasks, today]);
  const recent = useMemo(() => recentNotes({ notes }, 3), [notes]);
  const todaysEvents = useMemo(() => eventsOn({ events }, today), [events, today]);
  const progress = useMemo(() => projectProgress({ projects, tasks }), [projects, tasks]);

  const left = todays.filter((t) => !isDone(t)).length;
  const finished = todays.length - left;

  // The next event that hasn't started, if it is under an hour away.
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const next = todaysEvents.find((e) => e.start && Number(e.start.slice(0, 2)) * 60 + Number(e.start.slice(3, 5)) > nowMinutes);
  const nextIn = next?.start ? Number(next.start.slice(0, 2)) * 60 + Number(next.start.slice(3, 5)) - nowMinutes : undefined;

  const name = userName.trim();
  const hello = greeting(now.getHours());

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-2sm text-ink-2">{longDay(today)}</span>
          <h1 className="text-4xl leading-10">
            {hello}
            {name && name !== 'there' && (
              <>
                {', '}
                <span className="bg-[linear-gradient(100deg,#DD297D_0%,#F24567_40%,#F65559_65%,#F86C49_100%)] bg-clip-text text-transparent">
                  {name}
                </span>
              </>
            )}
          </h1>
        </div>
        <Button variant="primary" onClick={() => captureRef.current?.focus()}>
          <Plus size={16} strokeWidth={1.75} aria-hidden />
          New
        </Button>
      </div>

      <CaptureBar inputRef={captureRef} today={today} />

      <div className="grid min-h-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel
            id="today-h"
            title="Today"
            aside={
              todays.length > 0 && (
                <span className="text-2sm text-ink-2">
                  {left === 0 ? 'All done. Enjoy your day.' : `${left} left, ${finished} done`}
                </span>
              )
            }
          >
            {todays.length === 0 ? (
              <p className={EMPTY}>Nothing due today.</p>
            ) : (
              todays.map((t) => <TodayRow key={t.id} task={t} today={today} lookup={lookup} />)
            )}
          </Panel>

          <section aria-labelledby="soon-h" className="overflow-hidden rounded-lg border border-line bg-panel">
            <div className="flex h-12 items-center px-4">
              <h2 id="soon-h" className="text-[17px] leading-6">
                Coming up this week
              </h2>
            </div>
            {upcoming.length === 0 ? (
              <p className={EMPTY}>Nothing due in the next week.</p>
            ) : (
              upcoming.map((t) => {
                const project = lookup(t.projectId);
                return (
                  <div key={t.id} className="flex h-[46px] items-center gap-3.5 border-t border-line px-4">
                    <span className="w-[72px] shrink-0 text-2sm text-ink-2">{shortDay(t.dueDate!)}</span>
                    <button
                      type="button"
                      onClick={() => openTask(t.id)}
                      aria-label={`Open "${t.title}"`}
                      className="min-w-0 flex-1 cursor-pointer truncate text-left font-medium"
                    >
                      {t.title}
                    </button>
                    {project && (
                      <span className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-ink-2">
                        <Dot color={project.color} />
                        <span className="truncate">{project.name}</span>
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </section>

          <section aria-labelledby="notes-h" className="flex flex-col gap-2">
            <div className="flex items-center">
              <h2 id="notes-h" className="flex-1 text-[17px] leading-6">
                Recent notes
              </h2>
              <Link to="/notes" className="text-2sm text-accent hover:text-action-hover">
                All notes
              </Link>
            </div>
            {recent.length === 0 ? (
              <p className="rounded-lg border border-line bg-panel px-4 py-4 text-ink-2">No notes yet.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {recent.map((n) => (
                  <NoteCard
                    key={n.id}
                    note={n}
                    project={projects.find((p) => p.id === n.projectId)}
                    now={now}
                    today={today}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Panel
            id="cal-h"
            title="Today's calendar"
            aside={
              <>
                <span className="flex-1" />
                <Link to="/calendar" className="text-2sm text-accent hover:text-action-hover">
                  Week
                </Link>
              </>
            }
          >
            {todaysEvents.length === 0 ? (
              <p className={EMPTY}>Nothing on the calendar today.</p>
            ) : (
              todaysEvents.map((e) => (
                <EventRow
                  key={e.id}
                  event={e}
                  lookup={lookup}
                  soon={e === next && nextIn !== undefined && nextIn < 60 ? nextIn : undefined}
                />
              ))
            )}
          </Panel>

          <Panel
            id="proj-h"
            title="Projects"
            aside={
              <>
                <span className="flex-1" />
                <Link to="/projects" className="text-2sm text-accent hover:text-action-hover">
                  Board
                </Link>
              </>
            }
          >
            {progress.length === 0 ? (
              <p className={EMPTY}>No projects on the go.</p>
            ) : (
              progress.map(({ project, done, total }) => {
                const color = projectColor({ projects }, project);
                return (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className="flex h-[52px] flex-col justify-center gap-2 border-t border-line px-4 text-ink hover:bg-[#FAF9F6]"
                  >
                    <span className="flex items-center gap-2">
                      <Dot color={color} />
                      <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                      <span className="mono text-xs text-ink-2">
                        {done} of {total}
                      </span>
                    </span>
                    <span className="block h-1.5 overflow-hidden rounded-[3px] bg-raised">
                      <span
                        className="block h-full rounded-[3px]"
                        style={{ width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%`, background: color ?? NO_PROJECT_DOT }}
                      />
                    </span>
                  </Link>
                );
              })
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
