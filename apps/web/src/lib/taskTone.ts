import type { ChipTone } from '../components/tone';
import type { DayLoad } from '../selectors';
import { isDone, type Priority, type Task } from '../types';

/**
 * The calendar's tone tables for tasks — pure data, no store/React dependency, so calendar chips
 * can key into the same `tone.ts` surfaces (`TONE_STYLE`, `MARKER_TONE`) everything else does.
 *
 * `PRIORITY_TONE` is the single source for a task's priority colour (`high→warn, medium→accent,
 * low→dim`) — `TaskRow`, `TaskBoard` and the calendar all resolve it through `MARKER_TONE`, so the
 * dot can't drift between surfaces. `taskTickTone` is likewise the one open/done→tone rule.
 */
export const PRIORITY_TONE: Record<Priority, ChipTone> = {
  high: 'warn',
  medium: 'accent',
  low: 'dim',
};

/** On screen a task is only open or done — the five statuses stay in the data, never in the tone. */
export const taskTickTone = (t: Task): ChipTone => (isDone(t) ? 'ok' : 'dim');

const PRIORITY_CYCLE: Priority[] = ['low', 'medium', 'high'];

/** low → medium → high → low, for a chip's click-to-cycle priority dot. */
export function nextPriority(p: Priority): Priority {
  return PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(p) + 1) % PRIORITY_CYCLE.length];
}

/**
 * Tailwind classes for a day-number badge, given today/completion state — the one place this
 * branches, so MonthCalendar's and WeekStrip's day headers read as the same visual system.
 * Priority: full completion glows ok, then partial progress rings ok, then today's own accent identity, then plain.
 */
export function dayBadgeTone(isToday: boolean, inMonth: boolean, load?: DayLoad): string {
  if (load?.complete) return 'glow bg-ok text-white font-bold';
  if (load && load.total > 0 && load.done > 0) {
    return `ring-2 ring-ok/50 ${isToday ? 'glow bg-accent text-white font-bold' : inMonth ? 'text-muted' : 'text-dim'}`;
  }
  if (isToday) return 'glow bg-accent text-white font-bold';
  return inMonth ? 'text-muted' : 'text-dim';
}
