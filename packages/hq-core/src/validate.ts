import type { ActivityEvent, Asset, CalEvent, EntityRef, HQData, Link, Note, Project, Settings, Task } from './types';
import { ENTITY_TYPES } from './types';
import { defaultSettings } from './data';

const isStr = (v: unknown): v is string => typeof v === 'string';
const isArr = Array.isArray;
const hasId = (item: unknown): boolean =>
  typeof item === 'object' && item !== null && isStr((item as { id?: unknown }).id);

/**
 * An id the app makes: a UUID (`crypto.randomUUID()`), or an older prefixed one like `ast_a`. Letters,
 * digits, `_` and `-` only, so it is always one plain file name: an attachment's id names its file in
 * assets/, and an id like `../../x` from a crafted backup must never reach the disk.
 */
export const isSafeId = (v: unknown): v is string => isStr(v) && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);

const LISTS =['projects', 'tasks', 'notes', 'links', 'assets', 'activity'] as const;

const isRef = (r: unknown): r is EntityRef =>
  typeof r === 'object' &&
  r !== null &&
  (ENTITY_TYPES as readonly string[]).includes((r as EntityRef).type) &&
  isStr((r as EntityRef).id);

/**
 * Check a backup (or any parsed JSON) and return it as current data, or `null` if it is not one.
 *
 * Only `version: 1` exists. `events` arrived after the first backups were made, so a backup without it
 * is read as having none; present, it is validated like every other list. Every other list must be present and made of records with an `id`, and each
 * record must carry the fields the app dereferences without a guard. A backup that fails any check
 * is refused whole, rather than half-loaded.
 */
export function validateImport(raw: unknown): HQData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (d.version !== 1) return null;

  const s = d.settings as Record<string, unknown> | undefined;
  if (typeof s !== 'object' || s === null || !isStr(s.userName)) return null;

  for (const key of LISTS) {
    if (!isArr(d[key])) return null;
    if (!(d[key] as unknown[]).every(hasId)) return null;
  }

  if (!(d.projects as Project[]).every((p) => isStr(p.name) && isStr(p.status))) return null;
  if (!(d.tasks as Task[]).every((t) => isStr(t.title) && isStr(t.status))) return null;
  if (!(d.notes as Note[]).every((n) => isStr(n.title) && isStr(n.body))) return null;
  if (!(d.links as Link[]).every((l) => isRef(l.from) && isRef(l.to) && (l.kind === 'related' || l.kind === 'blocks')))
    return null;
  if (!(d.assets as Asset[]).every((a) => isSafeId(a.id) && isStr(a.name) && isStr(a.mime) && typeof a.size === 'number'))
    return null;

  // optional for backups written before calendar events existed
  const events = d.events === undefined ? [] : d.events;
  if (!isArr(events) || !events.every(hasId)) return null;
  const isDay = (v: unknown): v is string => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const isTime = (v: unknown): boolean => v === undefined || (isStr(v) && /^\d{2}:\d{2}$/.test(v));
  if (!(events as CalEvent[]).every((e) => isStr(e.title) && isDay(e.date) && isTime(e.start) && isTime(e.end)))
    return null;

  const settings: Settings = {
    ...defaultSettings,
    userName: s.userName,
    onboarded: true,
    ...(isStr(s.lastExportAt) ? { lastExportAt: s.lastExportAt } : {}),
  };

  return {
    version: 1,
    settings,
    projects: d.projects as Project[],
    tasks: d.tasks as Task[],
    notes: d.notes as Note[],
    links: d.links as Link[],
    assets: d.assets as Asset[],
    activity: d.activity as ActivityEvent[],
    events: events as CalEvent[],
  };
}
