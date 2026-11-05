import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useHQ } from '../store';
import MonthCalendar, { type CalendarChip } from '../components/MonthCalendar';
import DayPeek from '../components/DayPeek';
import EventSheet from '../components/EventSheet';
import WeekGrid, { type DueItem } from '../components/WeekGrid';
import { useOpenTask } from '../components/TaskDetailHost';
import { Button } from '../components/ui';
import { usePersistentState } from '../lib/use-persistent-state';
import { addDays, addMonths, parseDateStr, startOfWeekOf, toDateStr } from '../lib/dates';
import { monthGrid } from '../lib/calendar';
import { projectColor } from '../selectors';
import { isDone, type CalEvent } from '../types';

type View = 'day' | 'week' | 'month';
const VIEWS: { value: View; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

/** What the sheet is open on: an event being edited, or a blank one on a day (and maybe a time). */
type Sheet = { event?: CalEvent; date: string; start?: string };

const monthYear = (day: string) =>
  parseDateStr(day).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

function titleFor(view: View, anchor: string): string {
  if (view === 'day') {
    return parseDateStr(anchor).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }
  if (view === 'month') return monthYear(anchor);
  const first = startOfWeekOf(anchor);
  const last = addDays(first, 6);
  if (first.slice(0, 7) === last.slice(0, 7)) return monthYear(first);
  const mon = (d: string) => parseDateStr(d).toLocaleDateString(undefined, { month: 'short' });
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  return sameYear
    ? `${mon(first)} – ${mon(last)} ${last.slice(0, 4)}`
    : `${mon(first)} ${first.slice(0, 4)} – ${mon(last)} ${last.slice(0, 4)}`;
}

function shift(view: View, anchor: string, dir: 1 | -1): string {
  if (view === 'day') return addDays(anchor, dir);
  if (view === 'week') return addDays(anchor, 7 * dir);
  return `${addMonths(anchor.slice(0, 7), dir)}-01`;
}

/**
 * The calendar: Day, Week and Month over the same events. Day and Week are a time grid with a
 * "Due" row along the top (tasks due that day, which you can tick, and project start / target
 * days); Month reuses the month grid with events and due tasks as chips.
 */
export default function CalendarPage() {
  const events = useHQ((s) => s.events);
  const tasks = useHQ((s) => s.tasks);
  const projects = useHQ((s) => s.projects);
  const toggleTask = useHQ((s) => s.toggleTask);
  const openTask = useOpenTask();
  const navigate = useNavigate();

  const [view, setView] = usePersistentState<View>('calendar.view', 'week');
  const [now, setNow] = useState(() => new Date());
  const today = toDateStr(now);
  const [anchor, setAnchor] = useState(today);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [peekDay, setPeekDay] = useState<string | null>(null);
  // the day last clicked in Month — where "New event" lands
  const [selected, setSelected] = useState<string | null>(null);

  // keep the "now" line and today's highlight honest: tick each minute, and catch up on return
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = setInterval(tick, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const colorById = useMemo(() => new Map(projects.map((p) => [p.id, projectColor({ projects }, p)])), [projects]);
  const colorOf = useCallback(
    (e: CalEvent) => (e.projectId ? colorById.get(e.projectId) : undefined),
    [colorById],
  );

  const dueOn = useCallback(
    (day: string): DueItem[] => {
      const out: DueItem[] = [];
      for (const t of tasks) {
        if (t.dueDate !== day) continue;
        out.push({
          id: t.id,
          kind: 'task',
          label: t.title,
          color: t.projectId ? colorById.get(t.projectId) : undefined,
          done: isDone(t),
        });
      }
      for (const p of projects) {
        if (p.archived || p.status === 'shipped') continue;
        if (p.startDate === day) out.push({ id: p.id, kind: 'start', label: p.name, color: colorById.get(p.id) });
        if (p.targetDate === day) out.push({ id: p.id, kind: 'target', label: p.name, color: colorById.get(p.id) });
      }
      return out;
    },
    [tasks, projects, colorById],
  );

  const days = useMemo(
    () => (view === 'day' ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeekOf(anchor), i))),
    [view, anchor],
  );

  const month = anchor.slice(0, 7);
  const monthChips = useMemo<CalendarChip[]>(() => {
    if (view !== 'month') return [];
    const weeks = monthGrid(month);
    const from = weeks[0][0];
    const to = weeks[weeks.length - 1][6];
    const evChips: CalendarChip[] = events
      .filter((e) => e.date >= from && e.date <= to)
      .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))
      .map((e) => ({
        id: e.id,
        date: e.date,
        label: e.start ? `${e.start} ${e.title}` : e.title,
        draggable: false,
        projectColor: colorOf(e),
      }));
    const taskChips: CalendarChip[] = tasks
      .filter((t) => t.dueDate !== undefined && t.dueDate >= from && t.dueDate <= to)
      .map((t) => ({ id: t.id, date: t.dueDate!, label: t.title, muted: isDone(t), draggable: false }));
    const projectChips: CalendarChip[] = [];
    for (const p of projects) {
      if (p.archived || p.status === 'shipped') continue;
      const color = colorById.get(p.id);
      if (p.startDate && p.startDate >= from && p.startDate <= to)
        projectChips.push({ id: `prj:start:${p.id}`, date: p.startDate, label: `Starts: ${p.name}`, draggable: false, projectColor: color });
      if (p.targetDate && p.targetDate >= from && p.targetDate <= to)
        projectChips.push({ id: `prj:target:${p.id}`, date: p.targetDate, label: `Target: ${p.name}`, draggable: false, projectColor: color });
    }
    return [...evChips, ...projectChips, ...taskChips];
  }, [view, month, events, tasks, projects, colorById, colorOf]);

  const onChipClick = (id: string) => {
    if (id.startsWith('prj:')) {
      navigate(`/projects/${id.split(":")[2]}`);
      return;
    }
    const ev = events.find((e) => e.id === id);
    if (ev) setSheet({ event: ev, date: ev.date });
    else openTask(id);
  };

  // where "New event" lands: Month → the day last clicked, else today, else the 1st of the shown month;
  // Day/Week → today when it's on screen, otherwise the first visible day
  const newEventDate =
    view === 'month'
      ? selected && selected.slice(0, 7) === month
        ? selected
        : today.slice(0, 7) === month
          ? today
          : `${month}-01`
      : days.includes(today)
        ? today
        : days[0];

  const nav = view === 'day' ? 'day' : view === 'week' ? 'week' : 'month';

  return (
    <div className="flex h-full min-h-[32rem] flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-[13px] text-ink-2">Events, with the tasks that are due along the top</span>
          <h1 className="font-display text-4xl font-extrabold leading-10 tracking-tight">{titleFor(view, anchor)}</h1>
        </div>
        <button
          type="button"
          aria-label={`Previous ${nav}`}
          onClick={() => setAnchor(shift(view, anchor, -1))}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line-strong bg-panel text-ink hover:bg-raised"
        >
          <ChevronLeft size={16} />
        </button>
        <Button onClick={() => setAnchor(today)}>Today</Button>
        <button
          type="button"
          aria-label={`Next ${nav}`}
          onClick={() => setAnchor(shift(view, anchor, 1))}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line-strong bg-panel text-ink hover:bg-raised"
        >
          <ChevronRight size={16} />
        </button>
        <div role="group" aria-label="Range" className="inline-flex overflow-hidden rounded-md border border-line-strong bg-panel">
          {VIEWS.map((v, i) => (
            <button
              key={v.value}
              type="button"
              aria-pressed={view === v.value}
              onClick={() => setView(v.value)}
              className={`h-[38px] px-3.5 text-ink-2 ${i > 0 ? 'border-l border-line' : ''} ${
                view === v.value ? 'bg-raised font-semibold text-ink' : ''
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <Button variant="primary" onClick={() => setSheet({ date: newEventDate })}>
          <Plus size={16} aria-hidden />
          New event
        </Button>
      </div>

      {view === 'month' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MonthCalendar
            month={month}
            onMonthChange={(m) => setAnchor(`${m}-01`)}
            hideHeader
            tall
            items={[]}
            chips={monthChips}
            onChipClick={onChipClick}
            onDayClick={(d) => {
              setSelected(d);
              setPeekDay(d);
            }}
            onMoveItem={() => {}}
          />
        </div>
      ) : (
        <WeekGrid
          days={days}
          today={today}
          nowMinutes={now.getHours() * 60 + now.getMinutes()}
          events={events}
          colorOf={colorOf}
          dueOn={dueOn}
          onEventClick={(e) => setSheet({ event: e, date: e.date })}
          onSlotClick={(date, start) => setSheet({ date, start })}
          onToggleTask={toggleTask}
        />
      )}

      {sheet && (
        <EventSheet
          // a fresh form per target, so a second click never inherits the first one's fields
          key={`${sheet.event?.id ?? 'new'}:${sheet.date}:${sheet.start ?? ''}`}
          event={sheet.event}
          date={sheet.date}
          start={sheet.start}
          onClose={() => setSheet(null)}
        />
      )}
      {peekDay && (
        <DayPeek
          date={peekDay}
          onClose={() => setPeekDay(null)}
          onEventClick={(e) => {
            setPeekDay(null);
            setSheet({ event: e, date: e.date });
          }}
          onAddEvent={(d) => {
            setPeekDay(null);
            setSheet({ date: d });
          }}
        />
      )}
    </div>
  );
}
