import { useHQ } from '../store';
import { STATUS_TONE, type CalendarDeadline, type CalendarItem, type CalendarChip, type TrayItem } from '../components/MonthCalendar';
import { taskTickTone } from './taskTone';
import { childProjects } from '../selectors';
import { isDone, type Task } from '../types';

const windowed = (t: Task): boolean => t.startDate !== undefined && t.scheduledDate !== undefined;
const anchorOf = (t: Task): string | undefined => t.dueDate ?? t.scheduledDate;

/**
 * One derivation for "this project on a calendar", shared by the workspace timeline and the
 * Roadmap drill-down so the two surfaces can never disagree about what a project looks like.
 *
 * Parent: bars = its subprojects + its OWN windowed tasks, chips = its OWN single-date tasks, tray =
 * unscheduled non-shipped children + undated open own tasks. Leaf: bar = itself (when dated) + its
 * windowed tasks. Every id in `items` is a child project id or a windowed-task id (`isChild` /
 * `isTaskWindow` disambiguate); chip/tray ids are task ids.
 */
export function useProjectCalendarData(projectId: string, showShipped: boolean) {
  const projects = useHQ((s) => s.projects);
  const tasks = useHQ((s) => s.tasks);

  const self = projects.find((p) => p.id === projectId);
  const children = childProjects({ projects }, projectId);
  const own = tasks.filter((t) => t.projectId === projectId);

  const barSource = children.length > 0 ? children : self ? [self] : [];
  const projectBars: CalendarItem[] = barSource
    .filter((p) => p.startDate && p.targetDate && (showShipped || p.status !== 'shipped' || p.id === projectId))
    .map((p) => ({ id: p.id, start: p.startDate!, end: p.targetDate!, label: p.name, tone: STATUS_TONE[p.status] }));

  // Windowed own tasks render as bars alongside the project bars (toned open/done, dashed via kind).
  const taskBars: CalendarItem[] = own
    .filter(windowed)
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
  const items: CalendarItem[] = [...projectBars, ...taskBars];

  const chips: CalendarChip[] = own
    .filter((t) => !windowed(t) && anchorOf(t) !== undefined)
    .map((t) => ({ id: t.id, date: anchorOf(t)!, label: t.title, muted: isDone(t) }));

  const deadlines: CalendarDeadline[] = own
    .filter((t) => windowed(t) && t.dueDate !== undefined)
    .map((t) => ({ id: t.id, date: t.dueDate!, label: t.title }));

  const tray: TrayItem[] = [
    ...children
      .filter((c) => (!c.startDate || !c.targetDate) && c.status !== 'shipped')
      .map((c) => ({ id: c.id, label: c.name })),
    ...own.filter((t) => !windowed(t) && anchorOf(t) === undefined && !isDone(t)).map((t) => ({ id: t.id, label: t.title })),
  ];

  const childIds = new Set(children.map((c) => c.id));
  const taskWindowIds = new Set(taskBars.map((b) => b.id));
  const scheduledChipIds = new Set(chips.filter((c) => own.find((t) => t.id === c.id && t.dueDate === undefined)).map((c) => c.id));
  const isChild = (id: string) => childIds.has(id);
  const isTaskWindow = (id: string) => taskWindowIds.has(id);
  const isScheduledChip = (id: string) => scheduledChipIds.has(id);

  return { self, children, items, chips, deadlines, tray, isChild, isTaskWindow, isScheduledChip };
}
