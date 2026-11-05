import { addDays, addMonths, daysBetween, startOfWeekOf } from './dates';

/**
 * Pure month-grid maths for the roadmap calendar. No React, no store — the layout is testable
 * without a DOM, and the component only positions what these functions return.
 *
 * All dates are local YYYY-MM-DD strings (see dates.ts); lexicographic compare IS date compare.
 */

export interface SpanItem {
  id: string;
  start: string; // YYYY-MM-DD, inclusive
  end: string; // YYYY-MM-DD, inclusive
}

export interface Segment {
  id: string;
  /** 0–6 column within the week (Mon=0). */
  col: number;
  /** Days covered in this week, 1–7. */
  span: number;
  /** True when the item's real start falls in this week — rounded left end + resize handle. */
  isStart: boolean;
  /** True when the item's real end falls in this week — rounded right end + resize handle. */
  isEnd: boolean;
  /** Stacking row within the week, 0-based. */
  lane: number;
}

/** Monday-start weeks covering the month ("YYYY-MM"): 4–6 rows of 7 day-strings. */
export function monthGrid(month: string): string[][] {
  const lastDay = addDays(`${addMonths(month, 1)}-01`, -1);
  const weeks: string[][] = [];
  let day = startOfWeekOf(`${month}-01`);
  while (day <= lastDay) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
    day = addDays(day, 7);
  }
  return weeks;
}

/**
 * Clip each item intersecting `week` to it and stack the results into lanes.
 *
 * Lanes are assigned greedily (col asc, span desc, id as tiebreak): each segment takes the lowest
 * lane with no overlap. Lane numbers are per-week — a long bar may change lanes across rows, which
 * is fine because rows are visually independent.
 */
export function weekSegments(items: SpanItem[], week: string[]): Segment[] {
  const weekStart = week[0];
  const weekEnd = week[6];

  const clipped = items
    .map((item) => {
      // tolerate inverted ranges rather than rendering nothing
      const [start, end] = item.start <= item.end ? [item.start, item.end] : [item.end, item.start];
      if (start > weekEnd || end < weekStart) return null;
      const col = start >= weekStart ? daysBetween(weekStart, start) : 0;
      const lastCol = end <= weekEnd ? daysBetween(weekStart, end) : 6;
      return {
        id: item.id,
        col,
        span: lastCol - col + 1,
        isStart: start >= weekStart,
        isEnd: end <= weekEnd,
        lane: 0,
      };
    })
    .filter((s): s is Segment => s !== null)
    .sort((a, b) => a.col - b.col || b.span - a.span || a.id.localeCompare(b.id));

  const laneEnds: number[] = []; // per lane, the last occupied column
  for (const seg of clipped) {
    let lane = laneEnds.findIndex((end) => end < seg.col);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = seg.col + seg.span - 1;
    seg.lane = lane;
  }
  return clipped;
}
