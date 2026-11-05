import type { CalEvent } from '../types';

export interface DayBox {
  event: CalEvent;
  /** px from the top of the grid (which starts at `firstHour`). */
  top: number;
  height: number;
  /** Which of `cols` side-by-side columns the event sits in. */
  col: number;
  cols: number;
}

/** An event with no end, or one shorter than this, is drawn this tall. */
export const MIN_MINUTES = 30;
const DAY_MINUTES = 24 * 60;

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

/**
 * Lay one day's timed events onto a vertical hour grid. All-day events (no `start`) are skipped.
 * Overlapping events share the width: events that touch one another, directly or through a chain,
 * form a cluster; each takes the first free column and the whole cluster is split into as many
 * columns as it needed. Overlap is judged on the *drawn* height, so a 10-minute event still claims
 * its 30 minutes.
 */
export function layoutDay(events: CalEvent[], hourPx: number, firstHour: number): DayBox[] {
  const timed = events
    .filter((e): e is CalEvent & { start: string } => e.start !== undefined)
    .map((event) => {
      const start = minutesOf(event.start);
      const rawEnd = event.end !== undefined ? minutesOf(event.end) : start;
      // an end before the start is as good as no end; nothing is drawn past midnight
      const end = Math.min(DAY_MINUTES, start + Math.max(MIN_MINUTES, rawEnd - start));
      return { event, start, end };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out: DayBox[] = [];
  let cluster: { event: CalEvent; start: number; end: number; col: number }[] = [];
  let clusterEnd = -1;
  let colEnds: number[] = [];

  const flush = () => {
    for (const c of cluster) {
      out.push({
        event: c.event,
        top: ((c.start - firstHour * 60) / 60) * hourPx,
        height: ((c.end - c.start) / 60) * hourPx,
        col: c.col,
        cols: colEnds.length,
      });
    }
    cluster = [];
    colEnds = [];
    clusterEnd = -1;
  };

  for (const e of timed) {
    if (cluster.length > 0 && e.start >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= e.start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(e.end);
    } else {
      colEnds[col] = e.end;
    }
    cluster.push({ ...e, col });
    clusterEnd = Math.max(clusterEnd, e.end);
  }
  flush();
  return out;
}
