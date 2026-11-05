import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useHQ } from '../store';
import type { CalendarChip, CalendarDeadline, CalendarItem, TrayItem } from '../components/MonthCalendar';
import { taskTickTone } from './taskTone';
import { dayLoadRange, isTopLevel, projectColor, type DayLoad } from '../selectors';
import { todayStr } from './dates';
import { isDone, type Project, type Task } from '../types';

/**
 * One derivation for "tasks on a calendar", shared by every week/month view so they can never
 * disagree about what a task chip looks like — mirrors `useProjectCalendarData.ts`'s split (a pure
 * function the caller can feed a pre-filtered task list, plus a thin store-reading hook for the
 * common case). On screen a task is only open or done, so chips and bars tone by that alone.
 */

export interface TaskCalendarSource {
  tasks: Task[];
  projects: Project[];
}

export interface TaskCalendarData {
  /** Single-anchor task chips in [start, end] — draggable, toned open/done, carrying priority + project colour. */
  chips: CalendarChip[];
  /** Windowed tasks (🛫 start + ⏳ scheduled) overlapping [start, end] — draggable/resizable bars. */
  taskBars: CalendarItem[];
  /** 📅 deadlines of windowed tasks falling in [start, end] — render-only flags, never a chip. */
  deadlines: CalendarDeadline[];
  /** Overdue-or-undated open tasks, each tagged `overdue` relative to *today* (not just `start`). */
  tray: TrayItem[];
  /** Top-level dated projects overlapping [start, end] — only populated when `includeSpans`. */
  spans: CalendarItem[];
  /** Per-day completion for [start, end] — drives the calendar's day-complete reward glow. */
  dayProgress: Map<string, DayLoad>;
  /** A project span (drag → `updateProject{startDate,targetDate}`). */
  isProjectSpan: (id: string) => boolean;
  /** A windowed-task bar (drag/resize → `updateTask{startDate,scheduledDate}`). */
  isTaskBar: (id: string) => boolean;
  /** A chip anchored on ⏳ scheduled, not 📅 due (drop → `updateTask{scheduledDate}`). */
  isScheduledChip: (id: string) => boolean;
}

/** A task is a calendar *bar* only when it carries a full work window. */
const windowed = (t: Task): boolean => t.startDate !== undefined && t.scheduledDate !== undefined;
/** The single day a non-windowed task anchors to as a chip: its deadline, else its scheduled day. */
const anchorOf = (t: Task): string | undefined => t.dueDate ?? t.scheduledDate;

export function deriveTaskCalendarData(
  data: TaskCalendarSource,
  start: string,
  end: string,
  opts: { includeSpans?: boolean } = {},
): TaskCalendarData {
  const { tasks, projects } = data;
  const today = todayStr();
  const colorByProject = new Map(projects.map((p) => [p.id, projectColor({ projects }, p)]));

  // A task lands in exactly one primary render — bar, chip, or tray — so nothing double-renders.
  const scheduledChipIds = new Set<string>();
  const chips: CalendarChip[] = tasks
    .filter((t) => !windowed(t) && anchorOf(t) !== undefined && anchorOf(t)! >= start && anchorOf(t)! <= end)
    .map((t) => {
      // A chip anchored on ⏳ scheduled (no 📅 due) writes back to scheduledDate, not dueDate.
      if (t.dueDate === undefined && t.scheduledDate !== undefined) scheduledChipIds.add(t.id);
      return {
        id: t.id,
        date: anchorOf(t)!,
        label: t.title,
        muted: isDone(t),
        tone: taskTickTone(t),
        priority: t.priority,
        projectColor: t.projectId ? colorByProject.get(t.projectId) : undefined,
      };
    });

  // Windowed tasks → bars spanning [🛫 start, ⏳ scheduled], toned open/done (projects tone by folder colour).
  const taskBars: CalendarItem[] = tasks
    .filter((t) => windowed(t) && t.startDate! <= end && t.scheduledDate! >= start)
    .map((t) => ({
      id: t.id,
      start: t.startDate!,
      end: t.scheduledDate!,
      label: t.title,
      tone: taskTickTone(t),
      kind: 'task' as const,
      priority: t.priority,
      muted: isDone(t),
    }));

  // A windowed task's 📅 deadline is a flag on its due day, never a chip.
  const deadlines: CalendarDeadline[] = tasks
    .filter((t) => windowed(t) && t.dueDate !== undefined && t.dueDate >= start && t.dueDate <= end)
    .map((t) => ({ id: t.id, date: t.dueDate!, label: t.title }));

  // Tray = open tasks that neither bar nor chip in this range: undated, or their anchor is past `start`.
  // Windowed tasks are scheduled, so they never sit in the tray.
  const tray: TrayItem[] = tasks
    .filter((t) => !isDone(t) && !windowed(t) && (anchorOf(t) === undefined || anchorOf(t)! < start))
    .map((t) => ({ id: t.id, label: t.title, overdue: Boolean(t.dueDate && t.dueDate < today) }));

  const spans: CalendarItem[] = opts.includeSpans
    ? projects
        .filter(
          (p) =>
            !p.archived &&
            isTopLevel({ projects }, p) &&
            p.startDate &&
            p.targetDate &&
            p.startDate <= end &&
            p.targetDate >= start,
        )
        .map((p) => ({ id: p.id, start: p.startDate!, end: p.targetDate!, label: p.name, color: projectColor({ projects }, p) }))
    : [];

  const dayProgress = dayLoadRange({ tasks }, start, end);

  const spanIds = new Set(spans.map((s) => s.id));
  const barIds = new Set(taskBars.map((b) => b.id));
  return {
    chips,
    taskBars,
    deadlines,
    tray,
    spans,
    dayProgress,
    isProjectSpan: (id: string) => spanIds.has(id),
    isTaskBar: (id: string) => barIds.has(id),
    isScheduledChip: (id: string) => scheduledChipIds.has(id),
  };
}

export function useTaskCalendarData(
  start: string,
  end: string,
  opts: { includeSpans?: boolean } = {},
): TaskCalendarData {
  const includeSpans = opts.includeSpans;
  const data = useHQ(useShallow((s) => ({ tasks: s.tasks, projects: s.projects })));
  return useMemo(
    () => deriveTaskCalendarData(data, start, end, { includeSpans }),
    [data, start, end, includeSpans],
  );
}
