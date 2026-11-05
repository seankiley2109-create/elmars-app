import { describe, expect, it } from 'vitest';
import type { CalEvent } from '@hq/core/types';
import { canonical, deserialize, serialize } from './serialize';
import { fullFixture } from './fixtures';
import { eventMonth, parseEventFile, parseEventLine, printEventFile, printEventLine } from './events';

const timed: CalEvent = {
  id: 'e1',
  title: 'Leadership check-in',
  date: '2026-11-03',
  start: '08:30',
  end: '09:15',
  projectId: 'p1',
  location: 'Office',
  notes: 'Agenda: hiring, budget.',
  createdAt: '2026-11-01',
};

const allDay: CalEvent = { id: 'e2', title: 'Family lunch', date: '2026-11-03', createdAt: '2026-11-01' };

describe('event lines', () => {
  it('prints and parses a timed event with location, project and notes', () => {
    const line = printEventLine(timed);
    expect(line).toBe('- 08:30–09:15 Leadership check-in 📍 Office 📝[[notes/e1]] ➕ 2026-11-01 ^e1 →p1');
    const { notes: _notes, ...withoutNotes } = timed;
    expect(parseEventLine(line, '2026-11-03')).toEqual(withoutNotes);
  });

  it('prints and parses an all-day event', () => {
    const line = printEventLine(allDay);
    expect(line).toBe('- all day Family lunch ➕ 2026-11-01 ^e2');
    expect(parseEventLine(line, '2026-11-03')).toEqual(allDay);
  });

  it('keeps a title ending in " ^abc" intact', () => {
    const e: CalEvent = { ...allDay, title: 'Pack the car ^abc' };
    expect(parseEventLine(printEventLine(e), e.date)).toEqual(e);
  });

  it('keeps a title with token lookalikes intact', () => {
    const e: CalEvent = { ...allDay, title: 'See →p9 ➕ 2026-01-01 ⏫', start: '10:00', end: '11:00' };
    expect(parseEventLine(printEventLine(e), e.date)).toEqual(e);
  });

  it('prints <start>–<start> when only a start is set', () => {
    expect(printEventLine({ ...allDay, start: '14:00' })).toBe('- 14:00–14:00 Family lunch ➕ 2026-11-01 ^e2');
  });

  it('returns null for lines it did not write', () => {
    expect(parseEventLine('just some prose', '2026-11-03')).toBeNull();
    expect(parseEventLine('- [ ] a task ➕ 2026-11-01 ^t1', '2026-11-03')).toBeNull();
    expect(parseEventLine('- all day No id ➕ 2026-11-01', '2026-11-03')).toBeNull();
  });

  it('never throws: line breaks print as spaces', () => {
    const line = printEventLine({ ...allDay, title: 'a\nb', location: 'c\r\n d' });
    expect(line).toBe('- all day a b 📍 c d ➕ 2026-11-01 ^e2');
  });

  it('escapes a 📍 in the title (and allows one in the location), including a literal backslash-pin', () => {
    const titles = ['Meet at 📍 the pier', '📍', 'ends with 📍', 'C:\\📍 odd', 'a\\📍b \\\\📍', 'Path\\'];
    for (const title of titles) {
      for (const location of [undefined, 'Pier 📍 3', '📍 x 📍']) {
        const e: CalEvent = { ...allDay, title, ...(location ? { location } : {}) };
        expect(parseEventLine(printEventLine(e), e.date)).toEqual(e);
      }
    }
  });
});

describe('event files', () => {
  it('orders a day all-day first, then by start, then by id', () => {
    const a: CalEvent = { id: 'a', title: 'Late', date: '2026-11-03', start: '15:00', end: '16:00', createdAt: '2026-11-01' };
    const b: CalEvent = { id: 'b', title: 'Early', date: '2026-11-03', start: '08:00', end: '09:00', createdAt: '2026-11-01' };
    const c: CalEvent = { id: 'c', title: 'All day', date: '2026-11-03', createdAt: '2026-11-01' };
    const d: CalEvent = { id: 'd', title: 'Earlier day', date: '2026-11-02', start: '23:00', end: '23:30', createdAt: '2026-11-01' };
    const text = printEventFile([a, b, c, d]);
    const heads = text.split('\n').filter((l) => l.startsWith('## '));
    expect(heads).toEqual(['## 2026-11-02', '## 2026-11-03']);
    const ids = text
      .split('\n')
      .filter((l) => l.startsWith('- '))
      .map((l) => /\^(\S+)/.exec(l)![1]);
    expect(ids).toEqual(['d', 'c', 'b', 'a']);
  });

  it('parses a file back, giving each event its heading date', () => {
    const { notes: _n, ...t } = timed;
    expect(parseEventFile(printEventFile([timed, allDay]))).toEqual([allDay, t]);
  });

  it('files an event under its month', () => {
    expect(eventMonth(timed)).toBe('2026-11');
  });
});

describe('events in the vault', () => {
  it('the fixture carries a timed event with every field and an all-day event', () => {
    const events = fullFixture().events;
    expect(events.some((e) => e.start && e.end && e.projectId && e.location && e.notes)).toBe(true);
    expect(events.some((e) => !e.start)).toBe(true);
  });

  it('round-trips through the vault files, with the notes body in a sidecar', () => {
    const d = fullFixture();
    const files = serialize(d);
    const withNotes = d.events.find((e) => e.notes !== undefined)!;
    expect(files.has(`events/notes/${withNotes.id}.md`)).toBe(true);
    expect([...files.keys()].some((p) => /^events\/\d{4}-\d{2}\.md$/.test(p))).toBe(true);
    expect(deserialize(files)).toEqual(canonical(d));
  });

  it('reads "no end" and "end == start" as the same thing, and an all-day event as timeless', () => {
    const d = {
      ...fullFixture(),
      events: [
        { ...allDay, id: 'x1', start: '14:00' },
        { ...allDay, id: 'x2', end: '15:00', location: '' },
      ],
    };
    expect(deserialize(serialize(d))).toEqual(canonical(d));
    expect(deserialize(serialize(d)).events).toEqual([
      { ...allDay, id: 'x2' },
      { ...allDay, id: 'x1', start: '14:00' },
    ]);
  });

  it('round-trips a title containing a literal backslash-pin exactly', () => {
    const d = { ...fullFixture(), events: [{ ...allDay, title: 'odd \\📍 title' }] };
    expect(deserialize(serialize(d))).toEqual(canonical(d));
    expect(deserialize(serialize(d)).events[0].title).toBe('odd \\📍 title');
  });

  it('keeps an empty notes body as an empty string', () => {
    const d = { ...fullFixture(), events: [{ ...allDay, notes: '' }] };
    expect(deserialize(serialize(d)).events).toEqual([{ ...allDay, notes: '' }]);
  });
});
