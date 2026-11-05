/** Local-date helpers. All "day" logic uses local YYYY-MM-DD strings so a
 *  streak never breaks because of timezones. */

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayStr(): string {
  return toDateStr(new Date());
}

export function dayOfIso(iso: string): string {
  return toDateStr(new Date(iso));
}

/** Local midnight of a YYYY-MM-DD as an ISO stamp. Inverse of `dayOfIso`. */
export function dayToIso(dateStr: string): string {
  return parseDateStr(dateStr).toISOString();
}

/**
 * Snap an ISO stamp back to local midnight of its own day. Idempotent.
 *
 * The vault writes task dates as `YYYY-MM-DD` (Obsidian Tasks syntax), so `Task.createdAt` and
 * `Task.completedAt` are only recoverable to day precision. Normalising the stored value keeps
 * `deserialize(serialize(d)) === d` exact rather than lossy. Exact completion *times* are not lost —
 * every completion emits an ActivityEvent carrying a full ISO stamp.
 */
export function normalizeToDay(iso: string): string {
  return dayToIso(dayOfIso(iso));
}

export function addDays(dateStr: string, n: number): string {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function parseDateStr(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function daysUntil(dateStr: string): number {
  const ms = parseDateStr(dateStr).getTime() - parseDateStr(todayStr()).getTime();
  return Math.round(ms / 86_400_000);
}

/** Whole local days from `a` to `b` — positive when `b` is later. DST-safe via Math.round. */
export function daysBetween(a: string, b: string): number {
  const ms = parseDateStr(b).getTime() - parseDateStr(a).getTime();
  return Math.round(ms / 86_400_000);
}

/** First day of the month `n` months after `month` ("YYYY-MM"), as "YYYY-MM". */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Whole days since an ISO stamp, counted in local days. Negative for the future. */
export function daysSince(iso: string): number {
  return -daysUntil(dayOfIso(iso));
}

const DAY_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const SHORT_FMT = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatDayLong(dateStr: string): string {
  return DAY_FMT.format(parseDateStr(dateStr));
}

export function formatShort(dateStr: string): string {
  return SHORT_FMT.format(parseDateStr(dateStr));
}

export function formatTime(d: Date): string {
  return TIME_FMT.format(d);
}

export function relativeTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const days = Math.floor(s / 86400);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return formatShort(dayOfIso(iso));
}

/** ms elapsed as "m:ss", growing to "h:mm:ss" past an hour. */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * ms as a coarse, human duration — "3h 20m", "45m", "&lt;1m" — for *aggregate* totals (a project's or a
 * week's tracked time) where seconds are noise. The live timer stays on {@link formatElapsed}; this is
 * the reading-not-counting variant.
 */
export function formatDurationCoarse(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return '<1m';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Monday-start date string of the week containing `dateStr`. */
export function startOfWeekOf(dateStr: string): string {
  const d = parseDateStr(dateStr);
  const dow = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - dow);
  return toDateStr(d);
}

/** Monday-start date string of the current week. */
export function startOfWeekStr(): string {
  return startOfWeekOf(todayStr());
}
