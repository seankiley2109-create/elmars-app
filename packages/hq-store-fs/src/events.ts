import { oneLine } from '@hq/core/data';
import type { CalEvent } from '@hq/core/types';

/**
 * Calendar events as checklist-style lines, one file per month, a `##` heading per day.
 *
 *   ## 2026-11-03
 *
 *   - all day Family lunch ➕ 2026-11-01 ^e2
 *   - 08:30–09:15 Leadership check-in 📍 Office 📝[[notes/e1]] ➕ 2026-11-01 ^e1 →p1
 *
 * Every scalar field of `CalEvent` is carried: `date` by the heading, `start`/`end` by the time range
 * (an en dash, U+2013; "all day" when `start` is unset), then title, location (📍), createdAt (➕), id
 * and projectId. `notes` is the exception — its body lives in `events/notes/<id>.md` (see the events
 * codec), and the `📝[[notes/<id>]]` token is only a decorative link to it, like on a task line.
 *
 * Parsing follows tasks.ts: tokens are stripped from the right, and the mandatory `➕ <created>` anchor
 * means a title ending in `^abc` or `→foo` can never be mistaken for a token.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

/** `events/2026-11.md` — grouped by the month of the event's own date. */
export function eventMonth(e: CalEvent): string {
  return e.date.slice(0, 7);
}

/** Within a day: all-day first, then by start time, then by id. Total, so the order is canonical. */
export function compareWithinDay(a: CalEvent, b: CalEvent): number {
  const sa = a.start ?? '';
  const sb = b.start ?? '';
  if (sa !== sb) return sa < sb ? -1 : 1; // '' (all day) sorts before any HH:MM
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Date, then within-day order. The file order AND the canonical order. */
export function compareEvents(a: CalEvent, b: CalEvent): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return compareWithinDay(a, b);
}

/**
 * The form an event takes after a trip through the vault: an all-day event has no times, and a
 * timed event whose end equals its start has no end (that is exactly how "no end" is printed). An
 * empty location is no location. Title and location are one line each (pasted line breaks become
 * spaces), so printing never has to refuse an event.
 */
export function normalizeEvent(e: CalEvent): CalEvent {
  const out = { ...e, title: oneLine(e.title) };
  if (out.end !== undefined && (out.start === undefined || out.end === out.start)) delete out.end;
  if (out.location !== undefined) {
    out.location = oneLine(out.location);
    if (out.location === '') delete out.location;
  }
  return out;
}

/**
 * The location is introduced by ` 📍 `, so a 📍 in a title must not look like that. In a title every
 * 📍 is preceded by a backslash, and any backslashes already in front of it are doubled first, so
 * a run of n backslashes before a 📍 prints as 2n+1 — always odd, always reversible.
 */
const escapeTitle = (t: string): string => t.replace(/(\\*)📍/gu, (_m, bs: string) => `${bs}${bs}\\📍`);
const unescapeTitle = (t: string): string =>
  t.replace(/(\\+)📍/gu, (_m, bs: string) => `${'\\'.repeat(Math.floor(bs.length / 2))}📍`);

export function printEventLine(e: CalEvent): string {
  const when = e.start === undefined ? 'all day' : `${e.start}–${e.end ?? e.start}`;
  let line = `- ${when} ${escapeTitle(oneLine(e.title))}`;
  const location = e.location === undefined ? '' : oneLine(e.location);
  if (location) line += ` 📍 ${location}`;
  if (e.notes !== undefined) line += ` 📝[[notes/${e.id}]]`;
  line += ` ➕ ${e.createdAt}`;
  line += ` ^${e.id}`;
  if (e.projectId) line += ` →${e.projectId}`;
  return line;
}

/** Returns null for a line that isn't an event line (prose, blank lines, stray text). */
export function parseEventLine(line: string, date: string): CalEvent | null {
  const m = /^\s*- (?:all day|(\d{2}:\d{2})–(\d{2}:\d{2})) (.*)$/u.exec(line);
  if (!m) return null;
  const [, start, end, body] = m;

  // Leading space so a token directly after the time range still has its `\s` to match.
  let rest = ` ${body}`.trimEnd();
  const peel = (re: RegExp): string | undefined => {
    const hit = re.exec(rest);
    if (!hit) return undefined;
    rest = rest.slice(0, hit.index);
    return hit[1] ?? '';
  };

  const projectId = peel(/\s→(\S+)$/u);
  const id = peel(/\s\^(\S+)$/u);
  const createdAt = peel(/\s➕ (\d{4}-\d{2}-\d{2})$/u);
  if (!id || !createdAt) return null; // not a line we wrote; leave it alone
  // Decoration only (the sidecar note is the source of truth). Matching this event's own id means a
  // title that merely ends in a lookalike link is left alone.
  peel(new RegExp(`\\s📝\\[\\[notes/${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]$`, 'u'));
  // The first ` 📍 ` starts the location: a title's own 📍 is always escaped (so never follows a
  // space), and the location may contain anything after it.
  let location: string | undefined;
  const at = rest.indexOf(' 📍 ');
  if (at !== -1) {
    location = rest.slice(at + ' 📍 '.length);
    rest = rest.slice(0, at);
  }

  return {
    id,
    title: unescapeTitle(rest.trim()),
    date,
    ...(start ? { start } : {}),
    ...(end && end !== start ? { end } : {}),
    ...(projectId ? { projectId } : {}),
    ...(location ? { location } : {}),
    createdAt,
  };
}

export function printEventFile(events: readonly CalEvent[]): string {
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) {
    const list = byDay.get(e.date);
    if (list) list.push(e);
    else byDay.set(e.date, [e]);
  }
  const sections: string[] = [];
  for (const date of [...byDay.keys()].sort()) {
    const lines = [...byDay.get(date)!].sort(compareWithinDay).map(printEventLine);
    sections.push(`## ${date}\n\n${lines.join('\n')}\n`);
  }
  return sections.join('\n');
}

export function parseEventFile(text: string): CalEvent[] {
  const out: CalEvent[] = [];
  let date: string | null = null;
  for (const line of text.split('\n')) {
    const heading = /^##\s+(.*?)\s*$/u.exec(line);
    if (heading) {
      date = DAY.test(heading[1]) ? heading[1] : null;
      continue;
    }
    if (!date) continue;
    const event = parseEventLine(line, date);
    if (event) out.push(event);
  }
  return out;
}
