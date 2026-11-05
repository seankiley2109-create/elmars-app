import { useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Bar, Chip, StaticChip, Tray, type CalendarChip, type CalendarItem, type TrayItem } from './MonthCalendar';
import { dayBadgeTone } from '../lib/taskTone';
import type { DayLoad } from '../selectors';
import { weekSegments } from '../lib/calendar';
import { addDays, daysBetween, formatShort, parseDateStr, startOfWeekStr, todayStr } from '../lib/dates';

/**
 * One week as seven droppable day columns — the Tasks page's execution calendar, and (with
 * `spans`) the centerpiece of Home. Renders the *same* `Chip`/`StaticChip`/`Tray` components as
 * `MonthCalendar` (imported directly, not re-implemented) so week and month are one visual system
 * rather than two that happen to look similar. No month-grid maths here except the optional spans
 * band, which reuses `weekSegments` for its lanes. The strip owns no data: every drop ends in
 * exactly one callback.
 */

/** A multi-day bar above the day columns — a project stretching across the week. */
export type StripSpan = CalendarItem;

interface Props {
  weekStart: string; // Monday, YYYY-MM-DD
  onWeekChange: (weekStart: string) => void;
  chips: CalendarChip[];
  tray: TrayItem[];
  trayLabel?: string;
  onDropExternal: (id: string, day: string) => void;
  onUnschedule?: (id: string) => void;
  onChipClick?: (id: string) => void;
  /** `[`/`]` on a focused chip — reschedule it a day earlier/later without a drag. */
  onNudge?: (id: string, dir: 1 | -1) => void;
  /** The priority dot on a chip was clicked — cycle to the next priority. */
  onCyclePriority?: (id: string) => void;
  /** One-click "→ Today" on an overdue tray pill, as an alternative to dragging it. */
  onQuickToday?: (id: string) => void;
  spans?: StripSpan[];
  onSpanClick?: (id: string) => void;
  /** Windowed-task bars across the week — draggable to move, edges to resize. */
  taskBars?: CalendarItem[];
  onTaskBarClick?: (id: string) => void;
  /** A task bar was moved (same length, new start) — write back the window. */
  onMoveItem?: (id: string, start: string, end: string) => void;
  /** A task bar's edge was dragged — write back the resized window (pre-clamped start ≤ end). */
  onResizeItem?: (id: string, start: string, end: string) => void;
  onDayClick?: (day: string) => void;
  /** Highlighted day column (Home's agenda selection). */
  selectedDay?: string;
  /** Per-day completion, keyed by `YYYY-MM-DD` — drives each day header's reward glow. */
  dayProgress?: Map<string, DayLoad>;
}

type DragData =
  | { type: 'chip' | 'tray'; id: string }
  | { type: 'bar'; id: string; segFirstDay: string; span: number; itemStart: string }
  | { type: 'resize-start' | 'resize-end'; id: string };

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function DayColumn({
  day,
  chips,
  onChipClick,
  onNudge,
  onCyclePriority,
  onDayClick,
  selected,
  load,
}: {
  day: string;
  chips: CalendarChip[];
  onChipClick?: (id: string) => void;
  onNudge?: (id: string, dir: 1 | -1) => void;
  onCyclePriority?: (id: string) => void;
  onDayClick?: (day: string) => void;
  selected?: boolean;
  load?: DayLoad;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}` });
  const isToday = day === todayStr();
  const weekday = WEEKDAYS[(parseDateStr(day).getDay() + 6) % 7];
  const badge = (
    <span
      title={load && load.total > 0 ? `${load.done}/${load.total} handled` : undefined}
      className={`tnum inline-flex h-6 w-6 items-center justify-center rounded-full text-2xs transition-colors ${dayBadgeTone(isToday, true, load)}`}
    >
      {Number(day.slice(8))}
    </span>
  );
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-48 flex-col gap-1 border-r border-line p-1.5 transition-colors last:border-r-0 ${
        isOver ? 'bg-accent/10' : selected ? 'bg-accent/5' : ''
      }`}
    >
      {onDayClick ? (
        <button
          onClick={() => onDayClick(day)}
          aria-pressed={selected}
          className={`mb-1 flex flex-col items-center gap-1 rounded-md text-center text-micro font-semibold uppercase tracking-wide transition-colors hover:text-accent ${
            selected ? 'text-accent' : 'text-dim'
          }`}
        >
          {weekday}
          {badge}
        </button>
      ) : (
        <div className="mb-1 flex flex-col items-center gap-1 text-center text-micro font-semibold uppercase tracking-wide text-dim">
          {weekday}
          {badge}
        </div>
      )}
      {chips.map((c) =>
        c.draggable === false ? (
          <StaticChip key={c.id} chip={c} onClick={onChipClick} />
        ) : (
          <Chip key={c.id} chip={c} onClick={onChipClick} onNudge={onNudge} onCyclePriority={onCyclePriority} />
        ),
      )}
    </div>
  );
}

/** The projects-in-flight band: one lane-stacked row of bars above the day columns. */
function SpanBand({
  spans,
  days,
  onSpanClick,
}: {
  spans: StripSpan[];
  days: string[];
  onSpanClick?: (id: string) => void;
}) {
  const segments = weekSegments(spans, days);
  if (segments.length === 0) return null;
  const lanes = Math.max(...segments.map((s) => s.lane)) + 1;
  const byId = new Map(spans.map((s) => [s.id, s]));
  return (
    <div
      className="grid gap-y-1 border-b border-line p-1.5"
      style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gridTemplateRows: `repeat(${lanes}, 1.4rem)` }}
    >
      {segments.map((seg) => {
        const span = byId.get(seg.id)!;
        const color = span.color ?? 'var(--accent)';
        return (
          <button
            key={seg.id}
            onClick={() => onSpanClick?.(seg.id)}
            title={span.label}
            className={`truncate border px-2 text-left text-2xs font-semibold leading-[1.3rem] transition-opacity hover:opacity-80 ${
              seg.isStart ? 'rounded-l-md' : 'border-l-0'
            } ${seg.isEnd ? 'rounded-r-md' : 'border-r-0'}`}
            style={{
              gridColumn: `${seg.col + 1} / span ${seg.span}`,
              gridRow: seg.lane + 1,
              background: `color-mix(in srgb, ${color} 14%, transparent)`,
              borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
              color,
            }}
          >
            {span.label}
          </button>
        );
      })}
    </div>
  );
}

/** The task-windows band: draggable/resizable bars for tasks spanning several days this week. */
function TaskBarBand({
  bars,
  days,
  onTaskBarClick,
}: {
  bars: CalendarItem[];
  days: string[];
  onTaskBarClick?: (id: string) => void;
}) {
  const segments = weekSegments(bars, days);
  if (segments.length === 0) return null;
  const lanes = Math.max(...segments.map((s) => s.lane)) + 1;
  const byId = new Map(bars.map((b) => [b.id, b]));
  return (
    <div
      className="grid gap-y-1 border-b border-line p-1.5"
      style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gridTemplateRows: `repeat(${lanes}, 1.75rem)` }}
    >
      {segments.map((seg) => (
        <Bar
          key={`${seg.id}:${seg.col}:${seg.lane}`}
          item={byId.get(seg.id)!}
          seg={seg}
          segFirstDay={days[seg.col]}
          onItemClick={onTaskBarClick}
          resizable
        />
      ))}
    </div>
  );
}

/** Seven dots, one per visible day — the week-native reward signal, at a glance in the nav bar. */
function WeekProgressDots({ days, dayProgress }: { days: string[]; dayProgress?: Map<string, DayLoad> }) {
  if (!dayProgress) return null;
  return (
    <span className="ml-1 flex items-center gap-1" aria-hidden>
      {days.map((day) => {
        const load = dayProgress.get(day);
        const cls = load?.complete
          ? 'bg-ok'
          : load && load.total > 0 && load.done > 0
            ? 'bg-ok/50'
            : 'border border-line';
        return <span key={day} title={day} className={`h-1.5 w-1.5 rounded-full ${cls}`} />;
      })}
    </span>
  );
}

export default function WeekStrip({
  weekStart,
  onWeekChange,
  chips,
  tray,
  trayLabel = 'Overdue & undated',
  onDropExternal,
  onUnschedule,
  onChipClick,
  onNudge,
  onCyclePriority,
  onQuickToday,
  spans,
  onSpanClick,
  taskBars,
  onTaskBarClick,
  onMoveItem,
  onResizeItem,
  onDayClick,
  selectedDay,
  dayProgress,
}: Props) {
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const grabOffset = useRef(0);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const labelOf = (id: string) =>
    chips.find((c) => c.id === id)?.label ??
    taskBars?.find((b) => b.id === id)?.label ??
    tray.find((t) => t.id === id)?.label ??
    '';

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as DragData | undefined;
    if (!data) return;
    setDragLabel(labelOf(data.id));
    if (data.type === 'bar') {
      // which day of the bar was grabbed, so a drop keeps it under the cursor (same maths as MonthCalendar)
      const rect = e.active.rect.current.initial;
      const ev = e.activatorEvent as PointerEvent;
      let within = 0;
      if (rect && rect.width > 0 && typeof ev.clientX === 'number') {
        within = Math.min(data.span - 1, Math.max(0, Math.floor((ev.clientX - rect.left) / (rect.width / data.span))));
      }
      grabOffset.current = daysBetween(data.itemStart, data.segFirstDay) + within;
    }
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragLabel(null);
    const data = e.active.data.current as DragData | undefined;
    const overId = e.over ? String(e.over.id) : '';
    if (!data || !overId) return;
    if (overId === 'tray') {
      onUnschedule?.(data.id);
      return;
    }
    if (!overId.startsWith('day:')) return;
    const day = overId.slice(4);
    if (data.type === 'bar') {
      const item = taskBars?.find((i) => i.id === data.id);
      if (!item) return;
      const start = addDays(day, -grabOffset.current);
      onMoveItem?.(data.id, start, addDays(start, daysBetween(item.start, item.end)));
    } else if (data.type === 'resize-start') {
      const item = taskBars?.find((i) => i.id === data.id);
      if (item) onResizeItem?.(data.id, day <= item.end ? day : item.end, item.end);
    } else if (data.type === 'resize-end') {
      const item = taskBars?.find((i) => i.id === data.id);
      if (item) onResizeItem?.(data.id, item.start, day >= item.start ? day : item.start);
    } else {
      onDropExternal(data.id, day);
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => onWeekChange(addDays(weekStart, -7))} aria-label="Previous week" className="rounded-lg border border-line p-1.5 text-muted transition-colors hover:text-ink">
          <ChevronLeft size={15} />
        </button>
        <button onClick={() => onWeekChange(addDays(weekStart, 7))} aria-label="Next week" className="rounded-lg border border-line p-1.5 text-muted transition-colors hover:text-ink">
          <ChevronRight size={15} />
        </button>
        <span className="ml-1 text-sm font-bold">
          {formatShort(weekStart)} – {formatShort(addDays(weekStart, 6))}
        </span>
        <WeekProgressDots days={days} dayProgress={dayProgress} />
        <button
          onClick={() => onWeekChange(startOfWeekStr())}
          className="ml-auto rounded-full border border-line px-3 py-1 text-xs font-semibold text-muted transition-colors hover:text-ink"
        >
          This week
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[640px] overflow-hidden rounded-2xl border border-line">
          {spans && spans.length > 0 && <SpanBand spans={spans} days={days} onSpanClick={onSpanClick} />}
          {taskBars && taskBars.length > 0 && <TaskBarBand bars={taskBars} days={days} onTaskBarClick={onTaskBarClick} />}
          <div className="grid grid-cols-7">
            {days.map((day) => (
              <DayColumn
                key={day}
                day={day}
                chips={chips.filter((c) => c.date === day)}
                onChipClick={onChipClick}
                onNudge={onNudge}
                onCyclePriority={onCyclePriority}
                onDayClick={onDayClick}
                selected={selectedDay === day}
                load={dayProgress?.get(day)}
              />
            ))}
          </div>
        </div>
      </div>

      <Tray items={tray} label={trayLabel} onQuickToday={onQuickToday} />

      <DragOverlay>
        {dragLabel ? (
          <div className="glow rounded-lg border border-accent bg-surface px-2.5 py-1 text-2xs font-semibold">
            {dragLabel}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
