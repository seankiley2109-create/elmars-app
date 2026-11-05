import { useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { ChevronLeft, ChevronRight, Flag } from 'lucide-react';
import { monthGrid, weekSegments, type Segment } from '../lib/calendar';
import { addDays, addMonths, daysBetween, parseDateStr, todayStr } from '../lib/dates';
import { MARKER_TONE, SEGMENT_TONE, TONE_STYLE, type ChipTone } from './tone';
import { dayBadgeTone, PRIORITY_TONE } from '../lib/taskTone';
import type { DayLoad } from '../selectors';
import type { Priority, ProjectStatus } from '../types';

/**
 * A month grid you can act on. Bars are ranged items (projects) laid across the weeks by the pure
 * maths in lib/calendar.ts; chips are single-day items (tasks) living inside the day cells. Every
 * drag ends in exactly one callback — the calendar owns no data and writes nothing.
 *
 * Layout: each week row is a relative box. The day cells form the background grid (and are the drop
 * targets); the bars live in an absolutely-positioned 7-column overlay above them. The overlay is
 * `pointer-events-none` except the bars themselves — otherwise the cells underneath could never
 * receive a drop. Cells reserve headroom for the week's lanes via padding, so chips flow below bars.
 */

export interface CalendarItem {
  id: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  label: string;
  tone?: ChipTone;
  /** Overrides `tone` with a raw colour (e.g. a project's folder colour) via the same wash formula spans use. */
  color?: string;
  /** `'task'` bars get a lighter treatment + a priority dot; `'project'` (default) bars are solid. */
  kind?: 'project' | 'task';
  /** A leading priority dot on a task bar. */
  priority?: Priority;
  /** A completed task bar — struck through, dimmed. */
  muted?: boolean;
}

/** A deadline (📅) flag pinned to a day — independent of any bar. Render-only, never dragged. */
export interface CalendarDeadline {
  id: string;
  date: string; // YYYY-MM-DD
  label: string;
}

export interface CalendarChip {
  id: string;
  date: string; // YYYY-MM-DD
  label: string;
  muted?: boolean;
  /** Draggable by default; `false` for read-only overlays (e.g. task-due dots on the whole-map view). */
  draggable?: boolean;
  /** Status/outcome wash — defaults to the neutral `dim` pill when unset. */
  tone?: ChipTone;
  /** Shows a small priority dot; independently clickable when `onCyclePriority` is wired. */
  priority?: Priority;
  /** A project's folder colour, washed behind the label — takes precedence over `tone` when set. */
  projectColor?: string;
}

export interface TrayItem {
  id: string;
  label: string;
  overdue?: boolean;
}

/** How a project's status colours its calendar bar — shared by every surface that draws one. */
export const STATUS_TONE: Record<ProjectStatus, ChipTone> = {
  active: 'warn',
  blocked: 'danger',
  later: 'dim',
  shipped: 'ok',
};

interface Props {
  month: string; // YYYY-MM
  onMonthChange: (month: string) => void;
  items: CalendarItem[];
  chips?: CalendarChip[];
  tray?: TrayItem[];
  trayLabel?: string;
  onItemClick?: (id: string) => void;
  /** A chip was clicked (not dragged) — opens its detail. */
  onChipClick?: (id: string) => void;
  /** A day cell (not a bar) was clicked — opens the day peek. */
  onDayClick?: (day: string) => void;
  /** A bar was dropped on a day — same duration, new start. */
  onMoveItem: (id: string, start: string, end: string) => void;
  /** A resize handle was dropped on a day. Ends are pre-clamped to keep start ≤ end. */
  onResizeItem?: (id: string, start: string, end: string) => void;
  /** A tray item or chip was dropped on a day. */
  onDropExternal?: (id: string, day: string) => void;
  /** A bar or chip was dropped back on the tray. */
  onUnschedule?: (id: string) => void;
  /** 📅 deadline flags — one per windowed task whose due day falls in the month. Render-only. */
  deadlines?: CalendarDeadline[];
  /** A chip's edge was dragged onto another day — turn it into a work window. When wired, chips grow
   *  drag handles on hover. `start`/`end` are pre-ordered (start ≤ end). */
  onCreateWindow?: (id: string, start: string, end: string) => void;
  /** `[`/`]` on a focused chip — reschedule it a day earlier/later without a drag. */
  onNudge?: (id: string, dir: 1 | -1) => void;
  /** The priority dot on a chip was clicked — cycle to the next priority. */
  onCyclePriority?: (id: string) => void;
  /** One-click "→ Today" on an overdue tray pill, as an alternative to dragging it. */
  onQuickToday?: (id: string) => void;
  /** Per-day completion, keyed by `YYYY-MM-DD` — drives the day badge's reward glow. */
  dayProgress?: Map<string, DayLoad>;
  /** Planner layout: taller day cells and more visible chips per day, for the full-page `/calendar`. */
  tall?: boolean;
  /** The page supplies its own previous / next / Today controls (the Calendar does) — omit the built-in row. */
  hideHeader?: boolean;
}

type DragData =
  | { type: 'bar'; id: string; segFirstDay: string; span: number; itemStart: string }
  | { type: 'resize-start' | 'resize-end'; id: string }
  | { type: 'chip-resize-start' | 'chip-resize-end'; id: string }
  | { type: 'tray' | 'chip'; id: string };

const DAY_NUM_H = 26;
const LANE_H = 30;

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ResizeHandle({ item, edge }: { item: CalendarItem; edge: 'start' | 'end' }) {
  const { listeners, attributes, setNodeRef } = useDraggable({
    id: `resize:${item.id}:${edge}`,
    data: { type: `resize-${edge}`, id: item.id } satisfies DragData,
  });
  return (
    <span
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      aria-label={`Drag to move the ${edge === 'start' ? 'start' : 'target'} date of ${item.label}`}
      className={`absolute inset-y-0 w-1.5 cursor-ew-resize touch-none rounded-full hover:bg-current/40 ${
        edge === 'start' ? 'left-0' : 'right-0'
      }`}
    />
  );
}

/** Exported so WeekStrip renders the identical bar — one drag system for week and month. */
export function Bar({
  item,
  seg,
  segFirstDay,
  onItemClick,
  resizable,
}: {
  item: CalendarItem;
  seg: Segment;
  segFirstDay: string;
  onItemClick?: (id: string) => void;
  resizable: boolean;
}) {
  const isTask = item.kind === 'task';
  const { listeners, attributes, setNodeRef, isDragging } = useDraggable({
    id: `bar:${item.id}:${segFirstDay}`,
    data: { type: 'bar', id: item.id, segFirstDay, span: seg.span, itemStart: item.start } satisfies DragData,
  });
  // Space (dnd-kit) starts a drag; Enter opens. Compose so both keys work off the same focusable bar.
  const { onKeyDown: dragKeyDown, ...dragListeners } = listeners ?? {};
  return (
    <div
      style={{ gridColumn: `${seg.col + 1} / span ${seg.span}`, gridRow: seg.lane + 1 }}
      className="pointer-events-auto relative px-0.5"
    >
      <div
        ref={setNodeRef}
        {...dragListeners}
        {...attributes}
        role="button"
        aria-label={`${item.label} — Space to move, Enter to open`}
        onClick={() => onItemClick?.(item.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onItemClick?.(item.id);
            return;
          }
          dragKeyDown?.(e);
        }}
        style={
          item.color
            ? {
                background: `color-mix(in srgb, ${item.color} 14%, transparent)`,
                borderColor: `color-mix(in srgb, ${item.color} 45%, transparent)`,
                color: item.color,
              }
            : undefined
        }
        className={`relative flex h-[26px] cursor-grab touch-none items-center gap-1 border px-2 text-2xs leading-none active:cursor-grabbing ${
          isTask ? 'font-medium border-dashed' : 'font-semibold'
        } ${item.color ? '' : SEGMENT_TONE[item.tone ?? 'accent']} ${
          seg.isStart ? 'rounded-l-lg' : 'border-l-0'
        } ${seg.isEnd ? 'rounded-r-lg' : 'border-r-0'} ${isDragging ? 'opacity-30' : ''}`}
      >
        {isTask && item.priority && (seg.isStart || seg.col === 0) && (
          <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${MARKER_TONE[PRIORITY_TONE[item.priority]]}`} />
        )}
        <span className={`truncate ${item.muted ? 'line-through opacity-70' : ''}`}>
          {(seg.isStart || seg.col === 0) && item.label}
        </span>
        {resizable && seg.isStart && <ResizeHandle item={item} edge="start" />}
        {resizable && seg.isEnd && <ResizeHandle item={item} edge="end" />}
      </div>
    </div>
  );
}

/** The priority dot: a plain visual marker, or an independently-clickable cycle button when wired. */
function PriorityDot({ priority, onCyclePriority, chipId }: { priority: Priority; onCyclePriority?: (id: string) => void; chipId: string }) {
  const cls = `h-1.5 w-1.5 shrink-0 rounded-full ${MARKER_TONE[PRIORITY_TONE[priority]]}`;
  if (!onCyclePriority) return <span aria-hidden className={cls} />;
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onCyclePriority(chipId);
      }}
      aria-label={`Cycle priority — currently ${priority}`}
      className={`shrink-0 rounded-full transition-transform hover:scale-125 ${cls}`}
    />
  );
}

/** A chip's background: `projectColor` wins (folder-colour wash) over its status/priority `tone`. */
function chipStyle(chip: CalendarChip): { className: string; style?: React.CSSProperties } {
  if (chip.projectColor) {
    return {
      className: 'border',
      style: {
        background: `color-mix(in srgb, ${chip.projectColor} 14%, transparent)`,
        borderColor: `color-mix(in srgb, ${chip.projectColor} 45%, transparent)`,
        color: chip.projectColor,
      },
    };
  }
  const tone = chip.muted ? 'dim' : (chip.tone ?? 'dim');
  return { className: `border ${TONE_STYLE[tone]}` };
}

/** A chip-edge drag handle: pulling it onto another day turns the chip into a work-window bar. */
function ChipEdge({ chip, edge }: { chip: CalendarChip; edge: 'start' | 'end' }) {
  const { listeners, attributes, setNodeRef } = useDraggable({
    id: `chipedge:${chip.id}:${edge}`,
    data: { type: `chip-resize-${edge}`, id: chip.id } satisfies DragData,
  });
  return (
    <span
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // stop the chip body's own drag from also starting when the edge is grabbed
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Drag to stretch "${chip.label}" across days`}
      className={`absolute inset-y-0 z-10 w-2 cursor-ew-resize touch-none rounded-full opacity-0 transition-opacity hover:bg-current/40 group-hover:opacity-100 focus-visible:opacity-100 ${
        edge === 'start' ? 'left-0' : 'right-0'
      }`}
    />
  );
}

/** Exported so WeekStrip renders the identical chip — one visual system for both calendars. */
export function Chip({
  chip,
  onClick,
  onNudge,
  onCyclePriority,
  resizable,
}: {
  chip: CalendarChip;
  onClick?: (id: string) => void;
  onNudge?: (id: string, dir: 1 | -1) => void;
  onCyclePriority?: (id: string) => void;
  /** When set, the chip grows start/end handles on hover — drag one to create a multi-day window. */
  resizable?: boolean;
}) {
  const { listeners, attributes, setNodeRef, isDragging } = useDraggable({
    id: `chip:${chip.id}`,
    data: { type: 'chip', id: chip.id } satisfies DragData,
  });
  // Space (dnd-kit) starts a drag; Enter opens; [ and ] nudge the date — same composition Bar uses.
  const { onKeyDown: dragKeyDown, ...dragListeners } = listeners ?? {};
  const { className, style } = chipStyle(chip);
  return (
    <div
      ref={setNodeRef}
      {...dragListeners}
      {...attributes}
      role="button"
      tabIndex={0}
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(chip.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onClick?.(chip.id);
          return;
        }
        if (e.key === '[') {
          e.preventDefault();
          onNudge?.(chip.id, -1);
          return;
        }
        if (e.key === ']') {
          e.preventDefault();
          onNudge?.(chip.id, 1);
          return;
        }
        dragKeyDown?.(e);
      }}
      aria-label={`${chip.label} — drag to another day, Enter to open, [ or ] to reschedule${
        resizable ? ', or drag an edge to span days' : ''
      }`}
      className={`group relative flex cursor-grab touch-none items-center gap-1 truncate rounded-lg px-1.5 py-1 text-2xs font-medium leading-tight transition-colors active:cursor-grabbing ${className} ${
        chip.muted ? 'line-through opacity-70' : ''
      } ${isDragging ? 'opacity-30' : ''}`}
    >
      {chip.priority && <PriorityDot priority={chip.priority} onCyclePriority={onCyclePriority} chipId={chip.id} />}
      <span className="truncate">{chip.label}</span>
      {resizable && <ChipEdge chip={chip} edge="start" />}
      {resizable && <ChipEdge chip={chip} edge="end" />}
    </div>
  );
}

/** A read-only chip: same shape as the draggable one, no drag wiring — click still opens if wired. */
export function StaticChip({ chip, onClick }: { chip: CalendarChip; onClick?: (id: string) => void }) {
  const { className, style } = chipStyle(chip);
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={style}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(chip.id); } : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onClick(chip.id);
              }
            }
          : undefined
      }
      className={`flex items-center gap-1 truncate rounded-lg px-1.5 py-1 text-2xs font-medium leading-tight transition-colors ${className} ${
        onClick ? 'cursor-pointer hover:opacity-90' : ''
      } ${chip.muted ? 'line-through opacity-70' : ''}`}
    >
      {chip.priority && <PriorityDot priority={chip.priority} chipId={chip.id} />}
      <span className="truncate">{chip.label}</span>
    </div>
  );
}

const MAX_CHIPS = 3;
const MAX_CHIPS_TALL = 7; // planner layout has room for more before overflowing

/** The day-number badge — plain by default, warm-glow once the day is fully handled. */
/** The day-number badge — plain by default, warm-glow once the day is fully handled. */
function DayBadge({ day, isToday, inMonth, load }: { day: string; isToday: boolean; inMonth: boolean; load?: DayLoad }) {
  return (
    <span
      title={load && load.total > 0 ? `${load.done}/${load.total} handled` : undefined}
      style={{ top: 4 }}
      className={`absolute ml-0.5 mt-[-22px] inline-flex h-5 w-5 items-center justify-center rounded-full text-2xs transition-colors ${dayBadgeTone(isToday, inMonth, load)}`}
    >
      {Number(day.slice(8))}
    </span>
  );
}

function DayCell({
  day,
  month,
  laneCount,
  chips,
  deadlines,
  onDayClick,
  onChipClick,
  onNudge,
  onCyclePriority,
  chipResizable,
  tall,
  progress,
}: {
  day: string;
  month: string;
  laneCount: number;
  chips: CalendarChip[];
  deadlines: CalendarDeadline[];
  onDayClick?: (day: string) => void;
  onChipClick?: (id: string) => void;
  onNudge?: (id: string, dir: 1 | -1) => void;
  onCyclePriority?: (id: string) => void;
  chipResizable?: boolean;
  tall?: boolean;
  progress?: DayLoad;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}` });
  const inMonth = day.startsWith(month);
  const isToday = day === todayStr();
  const shownChips = chips.slice(0, tall ? MAX_CHIPS_TALL : MAX_CHIPS);
  const chipOverflow = chips.length - shownChips.length;
  return (
    <div
      ref={setNodeRef}
      onClick={onDayClick ? () => onDayClick(day) : undefined}
      style={{ paddingTop: DAY_NUM_H + laneCount * LANE_H }}
      className={`${tall ? 'min-h-40' : 'min-h-28'} space-y-1 border-r border-t border-line p-1.5 transition-colors last:border-r-0 ${
        onDayClick ? 'cursor-pointer hover:bg-surface2/40' : ''
      } ${isOver ? 'bg-accent/10' : inMonth ? '' : 'bg-surface2/40'}`}
    >
      <DayBadge day={day} isToday={isToday} inMonth={inMonth} load={progress} />
      {deadlines.length > 0 && (
        <span
          style={{ top: 6 }}
          title={`Due: ${deadlines.map((d) => d.label).join(', ')}`}
          className="absolute right-1.5 inline-flex items-center gap-0.5 text-danger"
        >
          <Flag size={11} aria-hidden />
          {deadlines.length > 1 && <span className="text-micro font-semibold leading-none">{deadlines.length}</span>}
        </span>
      )}
      {shownChips.map((c) =>
        c.draggable === false ? (
          <StaticChip key={c.id} chip={c} onClick={onChipClick} />
        ) : (
          <Chip key={c.id} chip={c} onClick={onChipClick} onNudge={onNudge} onCyclePriority={onCyclePriority} resizable={chipResizable} />
        ),
      )}
      {chipOverflow > 0 && <div className="px-0.5 text-micro text-dim">+{chipOverflow} more</div>}
    </div>
  );
}

/** Exported so WeekStrip's tray is the identical component — same drop-to-unschedule, quick-today. */
export function Tray({ items, label, onQuickToday }: { items: TrayItem[]; label: string; onQuickToday?: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'tray' });
  return (
    <div
      ref={setNodeRef}
      className={`mt-3 rounded-2xl border border-dashed p-3 transition-colors ${
        isOver ? 'border-accent/60 bg-accent/5' : 'border-line'
      }`}
    >
      <div className="label mb-2">{label}</div>
      {items.length === 0 ? (
        <p className="text-2xs text-dim">Nothing waiting — drop something here to unschedule it.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((t) => (
            <TrayPill key={t.id} item={t} onQuickToday={onQuickToday} />
          ))}
        </div>
      )}
    </div>
  );
}

function TrayPill({ item, onQuickToday }: { item: TrayItem; onQuickToday?: (id: string) => void }) {
  const { listeners, attributes, setNodeRef, isDragging } = useDraggable({
    id: `tray:${item.id}`,
    data: { type: 'tray', id: item.id } satisfies DragData,
  });
  return (
    <span
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      aria-label={`${item.label} — drag onto a day to schedule it`}
      className={`group inline-flex cursor-grab touch-none items-center gap-1 rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors active:cursor-grabbing ${
        item.overdue ? 'border-warn/40 text-warn hover:border-warn' : 'border-line text-muted hover:border-accent/60'
      } ${isDragging ? 'opacity-30' : ''}`}
    >
      {item.label}
      {onQuickToday && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onQuickToday(item.id);
          }}
          aria-label={`Move "${item.label}" to today`}
          className="rounded px-1 text-micro font-semibold text-dim opacity-0 transition-opacity hover:!text-accent group-hover:opacity-100 focus-visible:opacity-100"
        >
          → Today
        </button>
      )}
    </span>
  );
}

export default function MonthCalendar({
  month,
  onMonthChange,
  items,
  chips = [],
  tray,
  trayLabel = 'Unscheduled',
  onItemClick,
  onChipClick,
  onDayClick,
  onMoveItem,
  onResizeItem,
  onDropExternal,
  onUnschedule,
  deadlines = [],
  onCreateWindow,
  onNudge,
  onCyclePriority,
  onQuickToday,
  dayProgress,
  tall,
  hideHeader,
}: Props) {
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const grabOffset = useRef(0);

  const weeks = useMemo(() => monthGrid(month), [month]);
  const perWeek = useMemo(() => weeks.map((w) => weekSegments(items, w)), [weeks, items]);
  const chipsByDay = useMemo(() => {
    const m = new Map<string, CalendarChip[]>();
    for (const c of chips) {
      const list = m.get(c.date);
      if (list) list.push(c);
      else m.set(c.date, [c]);
    }
    return m;
  }, [chips]);
  const deadlinesByDay = useMemo(() => {
    const m = new Map<string, CalendarDeadline[]>();
    for (const d of deadlines) {
      const list = m.get(d.date);
      if (list) list.push(d);
      else m.set(d.date, [d]);
    }
    return m;
  }, [deadlines]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Space picks a bar up to drag; Enter is left free so it can *open* the bar (see Bar's onKeyDown).
    useSensor(KeyboardSensor, { keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }),
  );

  const labelOf = (id: string) =>
    items.find((i) => i.id === id)?.label ??
    chips.find((c) => c.id === id)?.label ??
    tray?.find((t) => t.id === id)?.label ??
    '';

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as DragData | undefined;
    if (!data) return;
    setDragLabel(labelOf(data.id));
    if (data.type === 'bar') {
      // which day of the bar was grabbed — so a drop keeps the bar under the cursor, not snapped
      // to its start. Pointer x within the segment → day within segment → days from item.start.
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
      if (data.type === 'bar' || data.type === 'chip') onUnschedule?.(data.id);
      return;
    }
    if (!overId.startsWith('day:')) return;
    const day = overId.slice(4);

    if (data.type === 'bar') {
      const item = items.find((i) => i.id === data.id);
      if (!item) return;
      const start = addDays(day, -grabOffset.current);
      onMoveItem(data.id, start, addDays(start, daysBetween(item.start, item.end)));
    } else if (data.type === 'resize-start') {
      const item = items.find((i) => i.id === data.id);
      if (item) onResizeItem?.(data.id, day <= item.end ? day : item.end, item.end);
    } else if (data.type === 'resize-end') {
      const item = items.find((i) => i.id === data.id);
      if (item) onResizeItem?.(data.id, item.start, day >= item.start ? day : item.start);
    } else if (data.type === 'chip-resize-start' || data.type === 'chip-resize-end') {
      // Dragging a chip's edge onto another day promotes it to a work-window bar. The chip's own day
      // is the fixed anchor; the drop day is the other edge. A drop back on the same day is a no-op.
      const chip = chips.find((c) => c.id === data.id);
      if (chip && day !== chip.date) {
        const [s, e2] = day < chip.date ? [day, chip.date] : [chip.date, day];
        onCreateWindow?.(data.id, s, e2);
      }
    } else {
      onDropExternal?.(data.id, day);
    }
  };

  const monthLabel = parseDateStr(`${month}-01`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    // pointerWithin, not the default rectIntersection: week rows have variable heights (each reserves
    // headroom for its bar lanes), so hit-testing the dragged bar's own thin rect against cell rects
    // could resolve to a neighbouring row — a drop landing a row off from where the cursor was. Testing
    // the pointer position instead matches exactly what the DragOverlay shows the user.
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      {!hideHeader && (
        <div className="mb-3 flex items-center gap-2">
          <button onClick={() => onMonthChange(addMonths(month, -1))} aria-label="Previous month" className="rounded-lg border border-line p-1.5 text-muted transition-colors hover:text-ink">
            <ChevronLeft size={15} />
          </button>
          <button onClick={() => onMonthChange(addMonths(month, 1))} aria-label="Next month" className="rounded-lg border border-line p-1.5 text-muted transition-colors hover:text-ink">
            <ChevronRight size={15} />
          </button>
          <span className="ml-1 text-sm font-bold">{monthLabel}</span>
          <button
            onClick={() => onMonthChange(todayStr().slice(0, 7))}
            className="ml-auto rounded-full border border-line px-3 py-1 text-xs font-semibold text-muted transition-colors hover:text-ink"
          >
            Today
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-line">
        <div className="grid grid-cols-7 border-b border-line bg-surface/50">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-1.5 text-2xs font-semibold uppercase tracking-wide text-dim">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week, w) => {
          const segs = perWeek[w];
          const laneCount = segs.reduce((max, s) => Math.max(max, s.lane + 1), 0);
          return (
            <div key={week[0]} className="relative">
              <div className="grid grid-cols-7">
                {week.map((day) => (
                  <div key={day} className="relative">
                    <DayCell
                      day={day}
                      month={month}
                      laneCount={laneCount}
                      chips={chipsByDay.get(day) ?? []}
                      deadlines={deadlinesByDay.get(day) ?? []}
                      onDayClick={onDayClick}
                      onChipClick={onChipClick}
                      onNudge={onNudge}
                      onCyclePriority={onCyclePriority}
                      chipResizable={Boolean(onCreateWindow)}
                      tall={tall}
                      progress={dayProgress?.get(day)}
                    />
                  </div>
                ))}
              </div>
              {laneCount > 0 && (
                <div
                  style={{ top: DAY_NUM_H, gridAutoRows: LANE_H }}
                  className="pointer-events-none absolute inset-x-0 grid grid-cols-7"
                >
                  {segs.map((seg) => {
                    const item = items.find((i) => i.id === seg.id);
                    if (!item) return null;
                    return (
                      <Bar
                        key={`${seg.id}:${seg.col}:${seg.lane}`}
                        item={item}
                        seg={seg}
                        segFirstDay={week[seg.col]}
                        onItemClick={onItemClick}
                        resizable={Boolean(onResizeItem)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {tray && <Tray items={tray} label={trayLabel} onQuickToday={onQuickToday} />}

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
