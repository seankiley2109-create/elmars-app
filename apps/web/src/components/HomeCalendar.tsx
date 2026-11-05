import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHQ } from '../store';
import WeekStrip from './WeekStrip';
import MonthCalendar from './MonthCalendar';
import CalendarModeToggle, { type CalendarMode } from './CalendarModeToggle';
import { useOpenTask } from './TaskDetailHost';
import { useTaskCalendarData } from '../lib/useTaskCalendarData';
import { usePersistentState } from '../lib/use-persistent-state';
import { nextPriority } from '../lib/taskTone';
import { monthGrid } from '../lib/calendar';
import { addDays, startOfWeekStr, todayStr } from '../lib/dates';
import { SectionLabel } from './ui';

/**
 * Home's centerpiece: the week/month calendar with everything on it.
 *
 * - Project bars band across the top in their folder colours (top-level, dated, not archived) in
 *   both modes — click one to open its workspace; drag/stretch to reschedule in month mode (week
 *   mode keeps them read-only, matching the app's existing "stretch them on the Calendar" rule).
 * - Task chips sit on their due days — drag to reschedule, click to open, `[`/`]` to nudge a day,
 *   click the priority dot to cycle it. Done ones stay, struck.
 * - The tray holds overdue and unscheduled work waiting to be dragged forward, or moved to today
 *   with one click.
 * - A day fully handled (every task due that day done) glows; week mode
 *   also carries a seven-dot progress row for the visible week at a glance.
 */
export default function HomeCalendar({
  selectedDay,
  onSelectDay,
}: {
  selectedDay: string;
  onSelectDay: (day: string) => void;
}) {
  const updateTask = useHQ((s) => s.updateTask);
  const updateProject = useHQ((s) => s.updateProject);
  const navigate = useNavigate();
  const openTask = useOpenTask();
  const [mode, setMode] = usePersistentState<CalendarMode>('home.calendarMode', 'week');
  const [weekStart, setWeekStart] = useState(() => startOfWeekStr());
  const [month, setMonth] = useState(() => todayStr().slice(0, 7));

  const weekEnd = addDays(weekStart, 6);
  const grid = monthGrid(month);
  const monthStart = grid[0][0];
  const monthEnd = grid[grid.length - 1][6];
  const [start, end] = mode === 'week' ? [weekStart, weekEnd] : [monthStart, monthEnd];

  const cal = useTaskCalendarData(start, end, { includeSpans: true });

  const onNudge = (id: string, dir: 1 | -1) => {
    const chip = cal.chips.find((c) => c.id === id);
    if (!chip) return;
    const day = addDays(chip.date, dir);
    updateTask(id, cal.isScheduledChip(id) ? { scheduledDate: day } : { dueDate: day });
  };
  const onCyclePriority = (id: string) => {
    const chip = cal.chips.find((c) => c.id === id);
    if (chip?.priority) updateTask(id, { priority: nextPriority(chip.priority) });
  };
  const onQuickToday = (id: string) => updateTask(id, { dueDate: todayStr() });
  const onSpanClick = (id: string) => navigate(`/projects/${id}`);

  // A single id can be a project bar, a task bar, a scheduled chip, or a due chip — each writes back
  // to a different field. The derivation owns the predicates (ids are opaque).
  const onMoveItem = (id: string, s: string, e: string) =>
    cal.isProjectSpan(id) ? updateProject(id, { startDate: s, targetDate: e }) : updateTask(id, { startDate: s, scheduledDate: e });
  const onDropExternal = (id: string, day: string) =>
    updateTask(id, cal.isScheduledChip(id) ? { scheduledDate: day } : { dueDate: day });
  const onUnschedule = (id: string) =>
    cal.isProjectSpan(id)
      ? updateProject(id, { startDate: undefined, targetDate: undefined })
      : cal.isTaskBar(id)
        ? updateTask(id, { startDate: undefined, scheduledDate: undefined })
        : cal.isScheduledChip(id)
          ? updateTask(id, { scheduledDate: undefined })
          : updateTask(id, { dueDate: undefined });
  const onCreateWindow = (id: string, s: string, e: string) => updateTask(id, { startDate: s, scheduledDate: e });
  const onItemClick = (id: string) => (cal.isProjectSpan(id) ? navigate(`/projects/${id}`) : openTask(id));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>{mode === 'week' ? 'This week' : 'This month'}</SectionLabel>
        <CalendarModeToggle mode={mode} onChange={(m) => setMode(m)} />
      </div>

      {mode === 'week' ? (
        <WeekStrip
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          chips={cal.chips}
          tray={cal.tray}
          onDropExternal={onDropExternal}
          onUnschedule={onUnschedule}
          onChipClick={openTask}
          onNudge={onNudge}
          onCyclePriority={onCyclePriority}
          onQuickToday={onQuickToday}
          spans={cal.spans}
          onSpanClick={onSpanClick}
          taskBars={cal.taskBars}
          onTaskBarClick={openTask}
          onMoveItem={onMoveItem}
          onResizeItem={onMoveItem}
          onDayClick={onSelectDay}
          selectedDay={selectedDay}
          dayProgress={cal.dayProgress}
        />
      ) : (
        <>
          <MonthCalendar
            month={month}
            onMonthChange={setMonth}
            items={[...cal.spans, ...cal.taskBars]}
            chips={cal.chips}
            deadlines={cal.deadlines}
            tray={cal.tray}
            onItemClick={onItemClick}
            onChipClick={openTask}
            onDayClick={onSelectDay}
            onMoveItem={onMoveItem}
            onResizeItem={onMoveItem}
            onDropExternal={onDropExternal}
            onUnschedule={onUnschedule}
            onCreateWindow={onCreateWindow}
            onNudge={onNudge}
            onCyclePriority={onCyclePriority}
            onQuickToday={onQuickToday}
            dayProgress={cal.dayProgress}
          />
          <p className="mt-2 text-2xs text-dim">
            Bars are projects and multi-day tasks — drag to move, stretch the ends. Drag a task chip's
            edge to span it across days. The flag is a deadline.
          </p>
        </>
      )}
    </div>
  );
}
