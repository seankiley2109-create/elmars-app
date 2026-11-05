import { dayOfIso, entityLabel } from '@hq/core';
import { defaultSettings } from '@hq/core/data';
import type { ActivityEvent, Asset, CalEvent, HQData, Link, Note, Project, Settings, Task, TaskStatus } from '@hq/core/types';
import { compareEvents, eventMonth, normalizeEvent, parseEventFile, printEventFile } from './events';
import { allocatePaths, slugifyPath } from './slug';
import { normalizeTask, parseTaskFile, printTaskFile, taskMonth } from './tasks';
import { dumpYaml, loadYaml, parseDoc, stringifyDoc } from './yaml';

/** path -> file content. POSIX separators, relative to the vault root. */
export type VaultFiles = Map<string, string>;

/** Exactly what `partialize` persists: `HQData` minus the version envelope zustand tracks itself. */
export type VaultDoc = Omit<HQData, 'version'>;

/**
 * A collection's storage rule.
 *
 * `sort` defines file order AND canonical order — deliberately the same thing. `read` applies it too,
 * so deserialize never depends on Map iteration order or on how a human reordered lines in a file.
 */
export type Codec<K extends keyof VaultDoc> = {
  sort(value: VaultDoc[K]): VaultDoc[K];
  /**
   * `doc` is the whole document, for the one codec that needs to look outside its own collection:
   * links resolves uuids to names so `links.yaml` is readable. An implementation may take fewer
   * parameters than the interface declares, so every other codec ignores it and needs no change.
   */
  write(value: VaultDoc[K], out: VaultFiles, doc: VaultDoc): void;
  read(files: VaultFiles): VaultDoc[K];
};

/** Structurally identical to `Codec<K>` when `VaultDoc[K]` is `T[]` — lets the helpers stay typed. */
type ListCodec<T> = {
  sort(value: T[]): T[];
  write(value: T[], out: VaultFiles, doc: VaultDoc): void;
  read(files: VaultFiles): T[];
};

/* ------------------------------------------------------------------ helpers */

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Array.prototype.sort is stable, so a single-key comparator preserves insertion order on ties. */
const byKey =
  <T>(key: (t: T) => string) =>
  (a: T, b: T) => {
    const x = key(a);
    const y = key(b);
    return x < y ? -1 : x > y ? 1 : 0;
  };

const under = (files: VaultFiles, dir: string, ext: string): string[] =>
  [...files.keys()].filter((p) => p.startsWith(`${dir}/`) && p.endsWith(ext)).sort();

/**
 * A `config/*.yaml` list. An absent file means the collection is empty, never an error.
 *
 * `derived` adds human-readable fields to what is written and **strips them on read** — the same rule
 * the vault already applies to filenames: convenience on disk, regenerated on every write, never a
 * source of truth. `keys` must be listed explicitly; without stripping, a decoration silently becomes
 * part of the document and the round trip stops being honest.
 */
function yamlList<T>(
  path: string,
  cmp: (a: T, b: T) => number,
  derived?: { keys: readonly string[]; of: (item: T, doc: VaultDoc) => Record<string, unknown> },
): ListCodec<T> {
  return {
    sort: (v) => [...v].sort(cmp),
    write: (v, out, doc) => {
      if (!v.length) return;
      out.set(path, dumpYaml(derived ? v.map((i) => ({ ...derived.of(i, doc), ...i })) : v));
    },
    read: (files) => {
      const raw = files.get(path);
      const list = raw ? loadYaml(raw) : null;
      if (!Array.isArray(list)) return [];
      const clean = derived
        ? (list as Record<string, unknown>[]).map((i) => {
            const copy = { ...i };
            for (const k of derived.keys) delete copy[k];
            return copy as T;
          })
        : (list as T[]);
      return clean.sort(cmp);
    },
  };
}

/** Append-only records: `<dir>/<YYYY-MM>.jsonl`, one JSON object per line. Emitted, never hand-edited. */
function jsonlRecords<T>(dir: string, monthOf: (t: T) => string, cmp: (a: T, b: T) => number): ListCodec<T> {
  return {
    sort: (v) => [...v].sort(cmp),
    write: (v, out) => {
      const byMonth = new Map<string, T[]>();
      for (const item of v) {
        const list = byMonth.get(monthOf(item));
        if (list) list.push(item);
        else byMonth.set(monthOf(item), [item]);
      }
      for (const [month, list] of byMonth) {
        out.set(`${dir}/${month}.jsonl`, list.map((i) => JSON.stringify(i)).join('\n') + '\n');
      }
    },
    read: (files) => {
      const items: T[] = [];
      for (const path of under(files, dir, '.jsonl')) {
        for (const line of files.get(path)!.split('\n')) {
          if (line.trim() !== '') items.push(JSON.parse(line) as T);
        }
      }
      return items.sort(cmp);
    },
  };
}

/**
 * One markdown file per entity: frontmatter + a body field.
 *
 * `optionalBody` handles the `undefined` vs `''` distinction. A fresh project has no `notes` key at
 * all; `updateProject({notes: ''})` sets an empty string. Both would write an empty body, so an empty
 * string is carried by an explicit frontmatter key rather than being silently promoted to `undefined`.
 */
function mdDocs<T extends { id: string }>(opts: {
  dir: string;
  nameOf: (t: T) => string;
  /** `doc` lets a folder depend on something outside the item — projects nest under their parent's name. */
  subdirOf?: (t: T, doc: VaultDoc) => string | undefined;
  bodyKey: string;
  bodyOf: (t: T) => string | undefined;
  optionalBody: boolean;
  toFm: (t: T) => Record<string, unknown>;
  fromDoc: (fm: Record<string, unknown>, body: string) => T;
}): ListCodec<T> {
  const { dir, nameOf, subdirOf, bodyKey, bodyOf, optionalBody, toFm, fromDoc } = opts;
  return {
    sort: (v) => [...v].sort(byId),
    write: (v, out, doc) => {
      const paths = allocatePaths(
        v,
        (i) => i.id,
        (i, slug) => {
          const folder = subdirOf?.(i, doc) ? slugifyPath(subdirOf(i, doc)!) : '';
          return folder ? `${dir}/${folder}/${slug}.md` : `${dir}/${slug}.md`;
        },
        nameOf,
      );
      for (const item of v) {
        const body = bodyOf(item);
        const fm = toFm(item);
        if (optionalBody && body === '') fm[bodyKey] = '';
        out.set(paths.get(item.id)!, stringifyDoc(fm, body ?? ''));
      }
    },
    read: (files) => {
      const items: T[] = [];
      for (const path of under(files, dir, '.md')) {
        const { data, body } = parseDoc(files.get(path)!);
        items.push(fromDoc(data, body));
      }
      return items.sort(byId);
    },
  };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** A non-empty body wins; else the explicit `''` marker; else the field was absent. */
const readOptionalBody = (fm: Record<string, unknown>, key: string, body: string): string | undefined =>
  body !== '' ? body : str(fm[key]);

const TASK_ORDER: readonly TaskStatus[] = ['backlog', 'ready', 'in_progress', 'waiting', 'done'];

/** Tasks group into month files, then status sections, then id — canonical order must match exactly. */
const taskCmp = (a: Task, b: Task) => {
  const ma = taskMonth(a);
  const mb = taskMonth(b);
  if (ma !== mb) return ma < mb ? -1 : 1;
  const sa = TASK_ORDER.indexOf(a.status);
  const sb = TASK_ORDER.indexOf(b.status);
  if (sa !== sb) return sa - sb;
  return byId(a, b);
};

/* ------------------------------------------------------------------- codecs */

/**
 * Every key of `VaultDoc` must appear. Adding a collection to `HQData` without handling it here
 * is a compile error rather than silent data loss — this mapped type is the guarantee.
 */
export const CODECS: { [K in keyof VaultDoc]: Codec<K> } = {
  settings: {
    sort: (v) => v,
    write: (v, out) => out.set('config/settings.yaml', dumpYaml(v)),
    read: (files) => {
      const raw = files.get('config/settings.yaml');
      const v = raw ? loadYaml(raw) : null;
      return v && typeof v === 'object' ? (v as Settings) : { ...defaultSettings };
    },
  },

  // links is a join table: without a label it is 88 lines of uuid → uuid and the only file in the
  // vault a human cannot read. `label` is derived and ignored on read.
  links: yamlList<Link>('config/links.yaml', byId, {
    keys: ['label'],
    of: (l, doc) => ({
      label: `${l.from.type}:${entityLabel(doc, l.from)} → ${l.to.type}:${entityLabel(doc, l.to)}`,
    }),
  }),
  assets: yamlList<Asset>('config/assets.yaml', byId),

  activity: jsonlRecords<ActivityEvent>('.activity', (e) => dayOfIso(e.at).slice(0, 7), byKey((e) => e.at)),

  projects: mdDocs<Project>({
    dir: 'projects',
    nameOf: (p) => p.name,
    // A child nests under the full chain of its ancestors' names, root first — arbitrary depth,
    // mirrored on disk. `slugifyPath` (below, via allocatePaths) slugifies each `/`-joined segment.
    // A dangling or cyclic parent just truncates the chain at the break; `parent:` in frontmatter
    // is the truth, the folder is derived decoration and is never read back.
    subdirOf: (p, doc) => {
      const chain: string[] = [];
      const seen = new Set<string>([p.id]);
      let cursor: Project | undefined = p;
      while (cursor?.parentId) {
        const parent = doc.projects.find((x) => x.id === cursor!.parentId);
        if (!parent || seen.has(parent.id)) break;
        chain.unshift(parent.name);
        seen.add(parent.id);
        cursor = parent;
      }
      return chain.length ? chain.join('/') : undefined;
    },
    bodyKey: 'notes',
    bodyOf: (p) => p.notes,
    optionalBody: true,
    toFm: (p) => ({
      id: p.id,
      name: p.name,
      parent: p.parentId,
      color: p.color,
      status: p.status,
      impact: p.impact,
      urgency: p.urgency,
      start: p.startDate,
      target: p.targetDate,
      nextStep: p.nextStep,
      tags: p.tags,
      links: p.links,
      archived: p.archived,
      created: p.createdAt,
      updated: p.updatedAt,
    }),
    fromDoc: (fm, body) => ({
      id: String(fm.id),
      name: String(fm.name),
      parentId: str(fm.parent),
      color: str(fm.color),
      status: fm.status as Project['status'],
      impact: fm.impact as Project['impact'],
      urgency: fm.urgency as Project['urgency'],
      startDate: str(fm.start),
      targetDate: str(fm.target),
      nextStep: str(fm.nextStep),
      notes: readOptionalBody(fm, 'notes', body),
      tags: strArr(fm.tags),
      links: arr<Project['links'][number]>(fm.links),
      archived: fm.archived === true,
      createdAt: String(fm.created),
      updatedAt: String(fm.updated),
    }),
  }),

  notes: mdDocs<Note>({
    dir: 'notes',
    nameOf: (n) => n.title,
    subdirOf: (n) => n.folder,
    bodyKey: 'body',
    bodyOf: (n) => n.body,
    optionalBody: false,
    toFm: (n) => ({
      id: n.id,
      title: n.title,
      folder: n.folder, // stays a literal: the nested path derives from it, never the reverse
      tags: n.tags,
      project: n.projectId,
      pinned: n.pinned,
      created: n.createdAt,
      updated: n.updatedAt,
    }),
    fromDoc: (fm, body) => ({
      id: String(fm.id),
      title: String(fm.title),
      body,
      tags: strArr(fm.tags),
      folder: str(fm.folder),
      projectId: str(fm.project),
      pinned: fm.pinned === true,
      createdAt: String(fm.created),
      updatedAt: String(fm.updated),
    }),
  }),

  tasks: {
    sort: (v) => v.map(normalizeTask).sort(taskCmp),
    write: (v, out) => {
      const byMonth = new Map<string, Task[]>();
      for (const t of v) {
        const list = byMonth.get(taskMonth(t));
        if (list) list.push(t);
        else byMonth.set(taskMonth(t), [t]);
      }
      for (const [month, list] of byMonth) out.set(`tasks/${month}.md`, printTaskFile(list));
      // A task's notes body is a sidecar markdown file, written only when the task has notes —
      // keyed by id so it never has to move when the task's month changes. `''` is carried by the
      // explicit frontmatter key, exactly like mdDocs' optionalBody.
      for (const t of v) {
        if (t.notes === undefined) continue;
        const fm: Record<string, unknown> = { id: t.id };
        if (t.notes === '') fm.notes = '';
        out.set(`tasks/notes/${t.id}.md`, stringifyDoc(fm, t.notes));
      }
    },
    read: (files) => {
      const items: Task[] = [];
      // Only the month files — NOT the whole `tasks/` subtree: `under('tasks', '.md')` would also
      // hand `tasks/notes/<id>.md` to parseTaskFile, which silently drops it. Match month files
      // exactly, then overlay each task's notes from its sidecar.
      const monthPaths = [...files.keys()].filter((p) => /^tasks\/\d{4}-\d{2}\.md$/.test(p)).sort();
      for (const path of monthPaths) items.push(...parseTaskFile(files.get(path)!));
      for (const t of items) {
        const raw = files.get(`tasks/notes/${t.id}.md`);
        if (raw !== undefined) {
          const { data, body } = parseDoc(raw);
          t.notes = readOptionalBody(data, 'notes', body);
        }
      }
      return items.sort(taskCmp);
    },
  },

  events: {
    // normalizeEvent: what a trip through the vault does to an event (no end == start, no times on an
    // all-day event) is applied here too, so canonical order and read-back order agree exactly.
    sort: (v) => v.map(normalizeEvent).sort(compareEvents),
    write: (v, out) => {
      const byMonth = new Map<string, CalEvent[]>();
      for (const e of v) {
        const list = byMonth.get(eventMonth(e));
        if (list) list.push(e);
        else byMonth.set(eventMonth(e), [e]);
      }
      for (const [month, list] of byMonth) out.set(`events/${month}.md`, printEventFile(list));
      // Same sidecar rule as tasks: the notes body lives in events/notes/<id>.md, keyed by id so it
      // never moves when the event's date does; `''` is carried by an explicit frontmatter key.
      for (const e of v) {
        if (e.notes === undefined) continue;
        const fm: Record<string, unknown> = { id: e.id };
        if (e.notes === '') fm.notes = '';
        out.set(`events/notes/${e.id}.md`, stringifyDoc(fm, e.notes));
      }
    },
    read: (files) => {
      const items: CalEvent[] = [];
      // Month files only — `events/notes/<id>.md` is a sidecar, not a month.
      const monthPaths = [...files.keys()].filter((p) => /^events\/\d{4}-\d{2}\.md$/.test(p)).sort();
      for (const path of monthPaths) items.push(...parseEventFile(files.get(path)!));
      for (const e of items) {
        const raw = files.get(`events/notes/${e.id}.md`);
        if (raw !== undefined) {
          const { data, body } = parseDoc(raw);
          e.notes = readOptionalBody(data, 'notes', body);
        }
      }
      return items.sort(compareEvents);
    },
  },
};
