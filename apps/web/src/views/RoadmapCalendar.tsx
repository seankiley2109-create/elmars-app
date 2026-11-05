import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useHQ } from '../store';
import MonthCalendar, {
  STATUS_TONE,
  type CalendarChip,
  type CalendarItem,
  type TrayItem,
} from '../components/MonthCalendar';
import DayPeek from '../components/DayPeek';
import { useOpenTask } from '../components/TaskDetailHost';
import { useProjectCalendarData } from '../lib/useProjectCalendarData';
import { tasksDueInRange } from '../selectors';
import { monthGrid } from '../lib/calendar';
import { todayStr } from '../lib/dates';
import { isDone, type Project } from '../types';

/**
 * The Calendar page's engine: one month calendar at up to three zoom levels. (The file keeps its
 * historical name — it was born as the Roadmap's Timeline tab; the Roadmap page is gone.)
 *
 * Level 0 — every top-level project as a bar; the unscheduled tray waits below. Click a parent's
 * bar to zoom into level 1 — its subprojects as bars, its own tasks as chips (a leaf zooms
 * straight to its tasks). Click a subproject's bar for level 2 — that child's tasks. Back pops one
 * level. Every drop is one store write; drag semantics are identical at every level.
 */
export default function RoadmapCalendar({ projects }: { projects: Project[] }) {
  const allProjects = useHQ((s) => s.projects);
  const updateProject = useHQ((s) => s.updateProject);
  const updateTask = useHQ((s) => s.updateTask);
  const tasks = useHQ((s) => s.tasks);
  const navigate = useNavigate();
  // Month + drill path live in the URL so a drilled view is bookmarkable and browser-Back walks the
  // levels; params are omitted at their defaults (current month, top level) to keep the URL clean.
  const [params, setParams] = useSearchParams();
  const currentMonth = todayStr().slice(0, 7);
  const month = params.get('m') ?? currentMonth;
  const path = params.get('d') ? params.get('d')!.split(',') : [];
  const writeParams = (m: string, ids: string[]) => {
    const next: Record<string, string> = {};
    if (m !== currentMonth) next.m = m;
    if (ids.length) next.d = ids.join(',');
    setParams(next, { replace: true });
  };
  const setMonth = (m: string) => writeParams(m, path);
  const setPath = (ids: string[]) => writeParams(month, ids);
  const [peekDay, setPeekDay] = useState<string | null>(null);

  const focusedId = path[path.length - 1] ?? '';
  const calendar = useProjectCalendarData(focusedId, false);
  const openTask = useOpenTask();

  // Drilled-level timeline write-back — the shared derivation mixes project bars with windowed-task
  // bars and single-date task chips, so every drop branches on the derivation's predicates.
  const calMove = (dropId: string, s: string, e: string) =>
    calendar.isTaskWindow(dropId)
      ? updateTask(dropId, { startDate: s, scheduledDate: e })
      : updateProject(dropId, { startDate: s, targetDate: e });
  const calDrop = (dropId: string, day: string) =>
    calendar.isChild(dropId)
      ? updateProject(dropId, { startDate: day, targetDate: day })
      : updateTask(dropId, calendar.isScheduledChip(dropId) ? { scheduledDate: day } : { dueDate: day });
  const calUnschedule = (dropId: string) =>
    calendar.isChild(dropId)
      ? updateProject(dropId, { startDate: undefined, targetDate: undefined })
      : calendar.isTaskWindow(dropId)
        ? updateTask(dropId, { startDate: undefined, scheduledDate: undefined })
        : calendar.isScheduledChip(dropId)
          ? updateTask(dropId, { scheduledDate: undefined })
          : updateTask(dropId, { dueDate: undefined });

  // Task due-dates across the visible grid (padded to whole weeks). The day-peek follows you into the
  // drill-down levels too; the task due-chips are top-level-only, since a drilled level already shows
  // that project's own task chips. Computed as hooks up here so they run before the early return below.
  const gridWeeks = useMemo(() => monthGrid(month), [month]);
  const gridFrom = gridWeeks[0][0];
  const gridTo = gridWeeks[gridWeeks.length - 1][6];
  const taskChips = useMemo<CalendarChip[]>(
    () =>
      tasksDueInRange({ tasks }, gridFrom, gridTo).map((t) => ({
        id: t.id,
        date: t.dueDate!,
        label: t.title,
        muted: isDone(t),
        draggable: false,
      })),
    [tasks, gridFrom, gridTo],
  );

  /* ---------------------------------------------------- drilled levels */
  if (focusedId && calendar.self) {
    const focused = calendar.self;
    const atProjectLevel = calendar.children.length > 0;
    return (
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() => setPath(path.slice(0, -1))}
            className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
          >
            <ArrowLeft size={15} /> Back
          </button>
          <span className="text-sm font-bold">
            {path
              .map((pid) => allProjects.find((p) => p.id === pid)?.name)
              .filter(Boolean)
              .join(' › ')}
          </span>
          <button
            onClick={() => navigate(`/projects/${focused.id}`)}
            className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-muted transition-colors hover:text-ink"
          >
            Open workspace
          </button>
        </div>
        <MonthCalendar
          month={month}
          onMonthChange={setMonth}
          tall
          items={calendar.items}
          chips={calendar.chips}
          deadlines={calendar.deadlines}
          tray={calendar.tray}
          trayLabel={atProjectLevel ? 'Unscheduled' : 'No due date'}
          onItemClick={(barId) => {
            if (calendar.isChild(barId)) setPath([...path, barId]);
            else if (calendar.isTaskWindow(barId)) openTask(barId);
          }}
          onDayClick={setPeekDay}
          onMoveItem={calMove}
          onResizeItem={calMove}
          onDropExternal={calDrop}
          onUnschedule={calUnschedule}
          onCreateWindow={(tid, start, end) => updateTask(tid, { startDate: start, scheduledDate: end })}
        />
        <p className="mt-2 text-2xs text-dim">
          {atProjectLevel
            ? "Bars are subprojects — click one to zoom in. Chips are this project's own tasks — click a day to see everything due."
            : "Chips are this project's tasks — drag one onto a day to set its due date. Click a day to see everything due."}
        </p>
        {peekDay && <DayPeek date={peekDay} onClose={() => setPeekDay(null)} />}
      </div>
    );
  }

  /* ------------------------------------------------------- all projects */
  const scheduled = projects.filter((p) => p.startDate && p.targetDate);
  const items: CalendarItem[] = scheduled.map((p) => ({
    id: p.id,
    start: p.startDate!,
    end: p.targetDate!,
    label: p.name,
    tone: STATUS_TONE[p.status],
  }));
  // finished work doesn't need scheduling — the tray is for planning, not archaeology
  const tray: TrayItem[] = projects
    .filter((p) => (!p.startDate || !p.targetDate) && p.status !== 'shipped')
    .map((p) => ({ id: p.id, label: p.name }));

  return (
    <div>
      <MonthCalendar
        month={month}
        onMonthChange={setMonth}
        tall
        items={items}
        chips={taskChips}
        tray={tray}
        trayLabel="Unscheduled"
        onItemClick={(barId) => setPath([barId])}
        onDayClick={setPeekDay}
        onMoveItem={(barId, start, end) => updateProject(barId, { startDate: start, targetDate: end })}
        onResizeItem={(barId, start, end) => updateProject(barId, { startDate: start, targetDate: end })}
        onDropExternal={(barId, day) => updateProject(barId, { startDate: day, targetDate: day })}
        onUnschedule={(barId) => updateProject(barId, { startDate: undefined, targetDate: undefined })}
      />
      <p className="mt-2 text-2xs text-dim">
        Chips are tasks due — click any day to work from it. Click a bar to
        zoom into that project, or drop an unscheduled project on a day to start planning it.
      </p>
      {peekDay && <DayPeek date={peekDay} onClose={() => setPeekDay(null)} />}
    </div>
  );
}
