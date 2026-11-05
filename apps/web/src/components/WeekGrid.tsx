import { useLayoutEffect, useMemo, useRef } from 'react';
import { layoutDay } from '../lib/day-layout';
import { tint } from '../lib/color';
import { parseDateStr } from '../lib/dates';
import type { CalEvent } from '../types';

/** Pixels per hour, and the hour the grid is scrolled to when it opens. */
export const HOUR_PX = 54;
export const SCROLL_TO_HOUR = 7;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const NEUTRAL_FILL = '#EFEDE7';

/** One entry in the "Due" row: a task you can tick, or a project's start / target day. */
export interface DueItem {
  id: string;
  kind: 'task' | 'start' | 'target';
  label: string;
  color?: string;
  done?: boolean;
}

interface Props {
  /** One date (Day view) or seven (Week view), as YYYY-MM-DD. */
  days: string[];
  today: string;
  /** Minutes since midnight, for the "now" line. */
  nowMinutes: number;
  events: CalEvent[];
  /** The colour of an event's project, if it has one. */
  colorOf: (e: CalEvent) => string | undefined;
  dueOn: (day: string) => DueItem[];
  onEventClick: (e: CalEvent) => void;
  /** An empty stretch of a day was clicked — `time` is HH:MM, snapped to the half hour. */
  onSlotClick: (day: string, time: string) => void;
  onToggleTask: (id: string) => void;
}

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const pad = (n: number) => String(n).padStart(2, '0');

function dayLabel(day: string): { name: string; num: number } {
  const d = parseDateStr(day);
  return { name: d.toLocaleDateString(undefined, { weekday: 'short' }), num: d.getDate() };
}

function eventTime(e: CalEvent): string {
  const parts = [e.start, e.location].filter(Boolean);
  return parts.join(' · ');
}

/**
 * The time grid behind the Day and Week views. A header row (day names), a "Due" row, then 24 hours
 * at 54px each that scroll as one with the headers pinned above. The grid opens scrolled to 07:00;
 * the rest of the day is a scroll away.
 */
export default function WeekGrid({
  days,
  today,
  nowMinutes,
  events,
  colorOf,
  dueOn,
  onEventClick,
  onSlotClick,
  onToggleTask,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = SCROLL_TO_HOUR * HOUR_PX - 10; // 10px up so the 07:00 label clears the pinned header
  }, [days.length]);

  const cols = `60px repeat(${days.length}, minmax(0, 1fr))`;
  const boxesByDay = useMemo(
    () => new Map(days.map((d) => [d, layoutDay(events.filter((e) => e.date === d), HOUR_PX, 0)])),
    [days, events],
  );

  const allDayByDay = useMemo(
    () => days.map((d) => events.filter((e) => e.date === d && e.start === undefined)),
    [days, events],
  );

  return (
    <div
      ref={scroller}
      data-testid="time-grid"
      className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-panel"
    >
      <div className="sticky top-0 z-10 bg-panel">
        <div className="grid" style={{ gridTemplateColumns: cols }}>
          <div />
          {days.map((d) => {
            const { name, num } = dayLabel(d);
            const isToday = d === today;
            return (
              <div
                key={d}
                className={`flex h-[52px] items-center gap-2 border-l border-line px-3 text-[13px] ${
                  isToday ? 'font-semibold text-ink' : 'text-ink-2'
                }`}
              >
                {name}
                <span
                  className={`tnum inline-flex h-[30px] w-[30px] items-center justify-center rounded-full font-mono text-[15px] font-medium ${
                    isToday ? 'bg-ink text-white' : 'text-ink'
                  }`}
                >
                  {num}
                </span>
              </div>
            );
          })}
        </div>
        {allDayByDay.some((list) => list.length > 0) && (
          <div className="grid" style={{ gridTemplateColumns: cols }}>
            <div className="border-t border-line pr-2.5 pt-2.5 text-right text-[11px] text-ink-3">All day</div>
            {days.map((d, i) => (
              <div key={d} className="flex min-h-[40px] flex-col gap-1 border-l border-t border-line p-1.5" aria-label={`All day ${d}`}>
                {allDayByDay[i].map((e) => {
                  const color = colorOf(e);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => onEventClick(e)}
                      className="flex h-6 w-full cursor-pointer items-center overflow-hidden whitespace-nowrap rounded px-2 text-left text-xs font-semibold text-ink hover:brightness-95"
                      style={{ background: color ? tint(color, 0.14) : NEUTRAL_FILL }}
                    >
                      <span className="truncate">{e.title}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        <div className="grid" style={{ gridTemplateColumns: cols }}>
          <div className="border-t border-line pr-2.5 pt-2.5 text-right text-[11px] text-ink-3">Due</div>
          {days.map((d) => (
            <div key={d} className="flex min-h-[40px] flex-col gap-1 border-l border-t border-line p-1.5" aria-label={`Due ${d}`}>
              {dueOn(d).map((item) => (
                <DueRow key={`${item.kind}:${item.id}`} item={item} onToggle={onToggleTask} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="grid border-t border-line" style={{ gridTemplateColumns: cols }}>
        <div className="flex flex-col">
          {HOURS.map((h) => (
            <div
              key={h}
              className="tnum h-[54px] pr-2.5 text-right font-mono text-[11px] text-ink-3"
              style={{ transform: h === 0 ? 'none' : 'translateY(-8px)', paddingTop: h === 0 ? 2 : 0 }}
            >
              {hh(h)}
            </div>
          ))}
        </div>
        {days.map((d) => {
          const isToday = d === today;
          return (
            <div
              key={d}
              data-testid={`day-${d}`}
              className="relative cursor-pointer border-l border-line"
              style={{
                height: 24 * HOUR_PX,
                backgroundColor: isToday ? '#FBFAF7' : undefined,
                backgroundImage:
                  'repeating-linear-gradient(to bottom, transparent 0, transparent 53px, #EEECE6 53px, #EEECE6 54px)',
              }}
              onClick={(e) => {
                const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                const mins = Math.min(23 * 60 + 30, Math.max(0, Math.floor(((y / HOUR_PX) * 60) / 30) * 30));
                onSlotClick(d, `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`);
              }}
            >
              {(boxesByDay.get(d) ?? []).map((b) => {
                const color = colorOf(b.event);
                const w = 100 / b.cols;
                const compact = b.height < 44; // too short for two lines: title and time share one
                return (
                  <button
                    key={b.event.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(b.event);
                    }}
                    className={`absolute flex cursor-pointer overflow-hidden rounded-md px-2 text-left text-xs leading-4 text-ink outline-offset-2 hover:brightness-95 ${
                      compact ? 'items-center gap-2 py-0.5' : 'flex-col items-start gap-px py-1.5'
                    }`}
                    style={{
                      top: b.top,
                      // never past the bottom of the grid, however short the block
                      height: Math.min(Math.max(20, b.height - 2), 24 * HOUR_PX - b.top),
                      left: `calc(${b.col * w}% + 4px)`,
                      width: `calc(${w}% - 8px)`,
                      background: color ? tint(color, 0.14) : NEUTRAL_FILL,
                    }}
                  >
                    <b className={`truncate text-[13px] font-semibold leading-[17px] ${compact ? 'min-w-0 shrink' : 'w-full'}`}>
                      {b.event.title}
                    </b>
                    <span className={`tnum truncate font-mono text-[11px] text-ink-2 ${compact ? 'shrink-0' : 'w-full'}`}>
                      {eventTime(b.event)}
                    </span>
                  </button>
                );
              })}
              {isToday && (
                <div
                  className="pointer-events-none absolute inset-x-0 h-0.5 bg-ink"
                  style={{ top: (nowMinutes / 60) * HOUR_PX - 1 }}
                  role="img"
                  aria-label={`Now, ${pad(Math.floor(nowMinutes / 60))}:${pad(nowMinutes % 60)}`}
                >
                  <span className="absolute -left-[5px] -top-1 h-2.5 w-2.5 rounded-full bg-ink" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DueRow({ item, onToggle }: { item: DueItem; onToggle: (id: string) => void }) {
  const dot = (
    <span
      className="h-2 w-2 shrink-0 rounded-[3px]"
      style={{ background: item.color ?? 'var(--mt-line-strong)' }}
      aria-hidden
    />
  );
  const base =
    'flex h-6 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded bg-raised px-2 text-xs font-medium';
  if (item.kind === 'task') {
    return (
      <label className={`${base} cursor-pointer`}>
        <input
          type="checkbox"
          className="m-0 h-3.5 w-3.5 accent-[#16171A]"
          checked={!!item.done}
          onChange={() => onToggle(item.id)}
          aria-label={`Mark "${item.label}" done`}
        />
        {dot}
        <span className={`truncate ${item.done ? 'text-ink-3 line-through' : ''}`}>{item.label}</span>
      </label>
    );
  }
  return (
    <div className={`${base} text-ink-2`}>
      {dot}
      <span className="truncate">
        {item.kind === 'start' ? 'Starts: ' : 'Target: '}
        {item.label}
      </span>
    </div>
  );
}
