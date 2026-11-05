import { describe, expect, it } from 'vitest';
import { monthGrid, weekSegments, type SpanItem } from './calendar';

describe('monthGrid', () => {
  it('starts a Monday-first month on its own 1st', () => {
    // June 2026: the 1st is a Monday — no lead-in from May.
    const weeks = monthGrid('2026-06');
    expect(weeks[0][0]).toBe('2026-06-01');
    expect(weeks).toHaveLength(5);
    expect(weeks.at(-1)![6]).toBe('2026-07-05'); // trailing days pad the final week
  });

  it('pads a Sunday-first month with six days of the previous month', () => {
    // November 2026 starts on a Sunday — the worst case for a Monday-start grid.
    const weeks = monthGrid('2026-11');
    expect(weeks[0]).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
    expect(weeks).toHaveLength(6);
  });

  it('handles February of a non-leap year', () => {
    // Feb 2026: 28 days, starts Sunday.
    const weeks = monthGrid('2026-02');
    expect(weeks[0][6]).toBe('2026-02-01');
    expect(weeks.at(-1)!).toContain('2026-02-28');
  });

  it('every row is 7 consecutive days', () => {
    for (const week of monthGrid('2026-07')) {
      expect(week).toHaveLength(7);
    }
  });
});

describe('weekSegments', () => {
  const week = (mondayTo: string[]) => mondayTo; // readability only
  const JUL_W2 = week([
    '2026-07-06',
    '2026-07-07',
    '2026-07-08',
    '2026-07-09',
    '2026-07-10',
    '2026-07-11',
    '2026-07-12',
  ]);

  it('places a single-day item in its column with both ends true', () => {
    const segs = weekSegments([{ id: 'a', start: '2026-07-08', end: '2026-07-08' }], JUL_W2);
    expect(segs).toEqual([{ id: 'a', col: 2, span: 1, isStart: true, isEnd: true, lane: 0 }]);
  });

  it('splits a 3-week bar into 3 segments with boundary flags only at the true ends', () => {
    const grid = monthGrid('2026-07');
    const item: SpanItem = { id: 'bar', start: '2026-07-08', end: '2026-07-21' };
    const perWeek = grid.map((w) => weekSegments([item], w));

    const nonEmpty = perWeek.filter((s) => s.length > 0);
    expect(nonEmpty).toHaveLength(3);

    const [first, middle, last] = nonEmpty.map((s) => s[0]);
    expect(first).toMatchObject({ col: 2, span: 5, isStart: true, isEnd: false });
    expect(middle).toMatchObject({ col: 0, span: 7, isStart: false, isEnd: false });
    expect(last).toMatchObject({ col: 0, span: 2, isStart: false, isEnd: true });
  });

  it('drops items that do not intersect the week', () => {
    expect(weekSegments([{ id: 'x', start: '2026-08-01', end: '2026-08-04' }], JUL_W2)).toEqual([]);
  });

  it('stacks overlapping items into lanes and reuses freed lanes', () => {
    const segs = weekSegments(
      [
        { id: 'long', start: '2026-07-06', end: '2026-07-10' }, // cols 0-4
        { id: 'clash', start: '2026-07-07', end: '2026-07-08' }, // overlaps long → lane 1
        { id: 'after', start: '2026-07-11', end: '2026-07-12' }, // starts after long ends → lane 0
      ],
      JUL_W2,
    );
    const byId = Object.fromEntries(segs.map((s) => [s.id, s]));
    expect(byId.long.lane).toBe(0);
    expect(byId.clash.lane).toBe(1);
    expect(byId.after.lane).toBe(0);
  });

  it('tolerates an inverted range by swapping the ends', () => {
    const segs = weekSegments([{ id: 'inv', start: '2026-07-10', end: '2026-07-08' }], JUL_W2);
    expect(segs[0]).toMatchObject({ col: 2, span: 3, isStart: true, isEnd: true });
  });
});
