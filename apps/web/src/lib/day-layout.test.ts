import { describe, expect, it } from 'vitest';
import { layoutDay } from './day-layout';
import type { CalEvent } from '../types';

const ev = (id: string, start?: string, end?: string): CalEvent => ({
  id,
  title: id,
  date: '2026-11-03',
  start,
  end,
  createdAt: '2026-11-01',
});

const HOUR = 54;

describe('layoutDay', () => {
  it('places 08:30-09:15 at 1.5 hours down and 0.75 hours tall when the grid starts at 07:00', () => {
    const [box] = layoutDay([ev('a', '08:30', '09:15')], HOUR, 7);
    expect(box.top).toBeCloseTo(1.5 * HOUR);
    expect(box.height).toBeCloseTo(0.75 * HOUR);
    expect(box.col).toBe(0);
    expect(box.cols).toBe(1);
  });

  it('splits the column between overlapping events', () => {
    const boxes = layoutDay([ev('a', '09:00', '10:00'), ev('b', '09:30', '10:30')], HOUR, 7);
    expect(boxes.map((b) => b.cols)).toEqual([2, 2]);
    expect(boxes.map((b) => b.col).sort()).toEqual([0, 1]);
  });

  it('keeps back-to-back events in full width, and reuses a free column inside a cluster', () => {
    const back = layoutDay([ev('a', '09:00', '10:00'), ev('b', '10:00', '11:00')], HOUR, 7);
    expect(back.map((b) => b.cols)).toEqual([1, 1]);
    const chain = layoutDay(
      [ev('a', '09:00', '10:30'), ev('b', '09:30', '10:00'), ev('c', '10:00', '11:00')],
      HOUR,
      7,
    );
    const byId = Object.fromEntries(chain.map((b) => [b.event.id, b]));
    expect(byId.a.col).toBe(0);
    expect(byId.b.col).toBe(1);
    expect(byId.c.col).toBe(1);
    expect(chain.every((b) => b.cols === 2)).toBe(true);
  });

  it('draws an event without an end 30 minutes tall', () => {
    const [box] = layoutDay([ev('a', '09:00')], HOUR, 7);
    expect(box.height).toBeCloseTo(0.5 * HOUR);
  });

  it('draws an event shorter than 30 minutes 30 minutes tall', () => {
    const [box] = layoutDay([ev('a', '09:00', '09:10')], HOUR, 7);
    expect(box.height).toBeCloseTo(0.5 * HOUR);
  });

  it('checks overlap on the drawn height, so a short event blocks its 30 minutes', () => {
    const boxes = layoutDay([ev('a', '09:00', '09:10'), ev('b', '09:20', '10:00')], HOUR, 7);
    expect(boxes.map((b) => b.cols)).toEqual([2, 2]);
  });

  it('skips all-day events', () => {
    expect(layoutDay([ev('a'), ev('b', '09:00', '10:00')], HOUR, 7).map((b) => b.event.id)).toEqual(['b']);
  });

  it('gives three mutually overlapping events three columns', () => {
    const boxes = layoutDay(
      [ev('a', '09:00', '11:00'), ev('b', '09:30', '10:30'), ev('c', '10:00', '10:45')],
      HOUR,
      7,
    );
    expect(boxes.map((b) => b.cols)).toEqual([3, 3, 3]);
    expect(boxes.map((b) => b.col).sort()).toEqual([0, 1, 2]);
  });

  it('treats an end before the start as no end', () => {
    const [box] = layoutDay([ev('a', '22:00', '01:00')], HOUR, 0);
    expect(box.top).toBeCloseTo(22 * HOUR);
    expect(box.height).toBeCloseTo(0.5 * HOUR);
  });

  it('clamps the drawn end to midnight, so a late event never grows the day', () => {
    const [box] = layoutDay([ev('a', '23:45', '23:59')], HOUR, 0);
    expect(box.top + box.height).toBeCloseTo(24 * HOUR);
    const [long] = layoutDay([ev('b', '23:00', '23:59')], HOUR, 0);
    expect(long.top + long.height).toBeLessThanOrEqual(24 * HOUR + 0.001);
    const [noEnd] = layoutDay([ev('c', '23:50')], HOUR, 0);
    expect(noEnd.top + noEnd.height).toBeCloseTo(24 * HOUR);
  });

  it('measures from midnight when firstHour is 0', () => {
    const [box] = layoutDay([ev('a', '07:00', '08:00')], HOUR, 0);
    expect(box.top).toBeCloseTo(7 * HOUR);
  });
});
