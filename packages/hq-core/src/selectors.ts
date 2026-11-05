import { isDone, type CalEvent, type EntityRef, type HQData, type ID, type Note, type Project, type Task } from './types';
import { addDays, dayOfIso, startOfWeekStr, todayStr } from './dates';

export const EXPORT_REMIND_DAYS = 14;

/** Everything an `EntityRef` might point at. */
export type LabelState = Pick<HQData, 'projects' | 'tasks' | 'notes' | 'assets'>;

/**
 * The human name behind an `EntityRef`.
 *
 * Lives here rather than in the UI because two callers need it: the link picker, and the vault
 * serializer, which stamps a readable label into `links.yaml` so a join table of uuids is not the one
 * file in the vault you cannot read. One implementation means adding an entity type breaks both at once.
 */
export function entityLabel(s: LabelState, ref: EntityRef): string {
  switch (ref.type) {
    case 'project':
      return s.projects.find((x) => x.id === ref.id)?.name ?? 'Missing project';
    case 'task':
      return s.tasks.find((x) => x.id === ref.id)?.title ?? 'Missing task';
    case 'note':
      return s.notes.find((x) => x.id === ref.id)?.title ?? 'Missing note';
    case 'asset':
      return s.assets.find((x) => x.id === ref.id)?.name ?? 'Missing file';
  }
}

/** Consecutive days (ending today or yesterday) with at least one activity event. */
export function streakDays(s: Pick<HQData, 'activity'>): number {
  const days = new Set(s.activity.map((e) => dayOfIso(e.at)));
  let cursor = todayStr();
  if (!days.has(cursor)) cursor = addDays(cursor, -1); // today isn't over yet
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function tasksDoneThisWeek(s: Pick<HQData, 'tasks'>): number {
  const weekStart = startOfWeekStr();
  return s.tasks.filter((t) => isDone(t) && t.completedAt && dayOfIso(t.completedAt) >= weekStart).length;
}

export function activeProjects(s: Pick<HQData, 'projects'>): Project[] {
  return s.projects.filter((p) => !p.archived && p.status === 'active');
}

export function blockedProjects(s: Pick<HQData, 'projects'>): Project[] {
  return s.projects.filter((p) => !p.archived && p.status === 'blocked');
}

export function focusTasks(s: Pick<HQData, 'tasks'>): Task[] {
  return s.tasks.filter((t) => t.focus && !isDone(t));
}

export function exportOverdue(s: Pick<HQData, 'settings' | 'tasks' | 'projects'>): boolean {
  const hasData = s.tasks.length > 0 || s.projects.length > 0;
  if (!hasData) return false;
  if (!s.settings.lastExportAt) return true;
  return dayOfIso(s.settings.lastExportAt) < addDays(todayStr(), -EXPORT_REMIND_DAYS);
}

/* --------------------------------------------------------- project hierarchy */

/*
 * The hierarchy is Project → child Project → ... → Task, nesting to any depth. `childProjects`
 * looks up direct children regardless of the node's own depth; `isTopLevel` is simply
 * "no resolvable parent". Deep roll-ups (`projectProgressDeep`, `projectTasksDeep`,
 * `projectShelved`) walk the full subtree, not just direct
 * children. `isDescendantOf` is the cycle guard both the store's reparent check and the UI's
 * parent-picker use, so a node can never be moved into its own subtree.
 */

type HierarchyState = Pick<HQData, 'projects'>;

/** Does any project claim `id` as its parent? */
export function isParent(s: HierarchyState, id: ID): boolean {
  return s.projects.some((p) => p.parentId === id);
}

/** The direct children of `id`, at any depth in the tree. */
export function childProjects(s: HierarchyState, id: ID): Project[] {
  return s.projects.filter((p) => p.parentId === id);
}

/** `id` plus every descendant's id, at any depth. Cycle-safe (a hand-edited loop can't spin it). */
function subtreeIds(s: HierarchyState, id: ID): Set<ID> {
  const ids = new Set<ID>([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of childProjects(s, cur)) {
      if (!ids.has(c.id)) {
        ids.add(c.id);
        stack.push(c.id);
      }
    }
  }
  return ids;
}

/**
 * Top-level = renders in the Projects grid and on the Calendar.
 *
 * True when the project has no parent, the parent doesn't resolve (a dangling hand-edit renders
 * top-level rather than vanishing), or walking up the parent chain loops back on itself — a
 * hand-edited cycle of any length renders every member of the cycle top-level, so nothing in it
 * ever becomes unreachable.
 */
export function isTopLevel(s: HierarchyState, p: Project): boolean {
  if (!p.parentId) return true;
  const seen = new Set<ID>([p.id]);
  let cursor: Project = p;
  for (;;) {
    if (!cursor.parentId) return false;
    const parent = s.projects.find((x) => x.id === cursor.parentId);
    if (!parent || seen.has(parent.id)) return true;
    seen.add(parent.id);
    cursor = parent;
  }
}

/** The resolved parent — only when this project genuinely renders as a child. */
export function parentOf(s: HierarchyState, p: Project): Project | undefined {
  return isTopLevel(s, p) ? undefined : s.projects.find((x) => x.id === p.parentId);
}

/**
 * True if `candidateId` sits anywhere below `nodeId` in the tree — i.e. `nodeId` is one of
 * `candidateId`'s ancestors. The cycle guard for re-parenting: a node can never be moved under
 * something that's already inside its own subtree.
 */
export function isDescendantOf(s: HierarchyState, candidateId: ID, nodeId: ID): boolean {
  let cursor = s.projects.find((p) => p.id === candidateId);
  const seen = new Set<ID>();
  while (cursor?.parentId) {
    if (cursor.parentId === nodeId) return true;
    if (seen.has(cursor.id)) return false;
    seen.add(cursor.id);
    cursor = s.projects.find((p) => p.id === cursor!.parentId);
  }
  return false;
}

/** Rolled-up progress: the project's own tasks plus every descendant's, at any depth. */
export function projectProgressDeep(
  s: Pick<HQData, 'tasks' | 'projects'>,
  projectId: ID,
): { done: number; total: number } {
  const ids = subtreeIds(s, projectId);
  const linked = s.tasks.filter((t) => t.projectId !== undefined && ids.has(t.projectId));
  return { done: linked.filter(isDone).length, total: linked.length };
}

/** The project's own tasks plus every descendant's — the list behind {@link projectProgressDeep}. */
export function projectTasksDeep(s: Pick<HQData, 'tasks' | 'projects'>, projectId: ID): Task[] {
  const ids = subtreeIds(s, projectId);
  return s.tasks.filter((t) => t.projectId !== undefined && ids.has(t.projectId));
}

/**
 * How a project reads when it's shown out of context — the full ancestor chain joined with "›",
 * just the name for a top-level one. The flat surfaces (command palette, Project pulse, the task
 * pill) use this so a subproject named "API" never looks like a top-level folder of the same name.
 */
export function projectCrumb(s: HierarchyState, p: Project): string {
  const chain = [p.name];
  const seen = new Set<ID>([p.id]);
  let cursor = p;
  for (;;) {
    const parent = parentOf(s, cursor);
    if (!parent || seen.has(parent.id)) break;
    chain.unshift(parent.name);
    seen.add(parent.id);
    cursor = parent;
  }
  return chain.join(' › ');
}

/**
 * Should this project rest in the collapsed "Done" shelf? Derived, never a status — the
 * vocabulary stays closed. Shipped outright, or everything inside it has shipped: it has
 * descendants, every one of them (at any depth) shipped, and no open tasks of its own.
 */
export function projectShelved(s: Pick<HQData, 'tasks' | 'projects'>, p: Project): boolean {
  if (p.status === 'shipped') return true;
  const ids = subtreeIds(s, p.id);
  ids.delete(p.id);
  if (ids.size === 0) return false;
  const descendants = s.projects.filter((x) => ids.has(x.id));
  if (!descendants.every((c) => c.status === 'shipped')) return false;
  return !s.tasks.some((t) => t.projectId === p.id && !isDone(t));
}

/**
 * Tasks with a due date in [from, to] inclusive.
 */
export function tasksDueInRange(s: Pick<HQData, 'tasks'>, from: string, to: string): Task[] {
  return s.tasks.filter((t) => t.dueDate !== undefined && t.dueDate >= from && t.dueDate <= to);
}

export interface DayLoad {
  total: number;
  done: number;
  /** Every task due that day is done. */
  complete: boolean;
}

const EMPTY_DAY_LOAD: DayLoad = { total: 0, done: 0, complete: false };

/**
 * How "handled" each day is — tasks due that day, bucketed across [from, to] inclusive. Backs the
 * calendar's day-complete mark: a day only counts as `complete` once every task due that day is done.
 */
export function dayLoadRange(s: Pick<HQData, 'tasks'>, from: string, to: string): Map<string, DayLoad> {
  const byDay = new Map<string, DayLoad>();
  for (const t of s.tasks) {
    if (t.dueDate === undefined || t.dueDate < from || t.dueDate > to) continue;
    let d = byDay.get(t.dueDate);
    if (!d) {
      d = { total: 0, done: 0, complete: false };
      byDay.set(t.dueDate, d);
    }
    d.total += 1;
    if (isDone(t)) d.done += 1;
  }
  for (const d of byDay.values()) d.complete = d.total > 0 && d.done === d.total;
  return byDay;
}

/** Single-day convenience wrapper over {@link dayLoadRange}. */
export function dayLoad(s: Pick<HQData, 'tasks'>, day: string): DayLoad {
  return dayLoadRange(s, day, day).get(day) ?? EMPTY_DAY_LOAD;
}

/**
 * The folder swatch. Always the root ancestor's — colour lives at the top of the tree only, no
 * matter how deep `p` sits, so it's stored exactly once.
 */
export function projectColor(s: HierarchyState, p: Project): string | undefined {
  const seen = new Set<ID>([p.id]);
  let cursor = p;
  for (;;) {
    const parent = parentOf(s, cursor);
    if (!parent || seen.has(parent.id)) return cursor.color;
    seen.add(parent.id);
    cursor = parent;
  }
}

/* ---- Today (Task 8) ---- */

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

/**
 * What Today asks of you: open tasks due today or earlier (overdue first, then by priority, then by
 * due date), followed by the tasks completed today. `today` is passed in so the clock is never read here.
 */
export function todayTasks(s: Pick<HQData, 'tasks'>, today: string): Task[] {
  const open = s.tasks
    .filter((t) => !isDone(t) && t.dueDate !== undefined && t.dueDate <= today)
    .sort((a, b) => {
      const overdue = Number(b.dueDate! < today) - Number(a.dueDate! < today);
      if (overdue !== 0) return overdue;
      const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (byPriority !== 0) return byPriority;
      return a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0;
    });
  const doneToday = s.tasks.filter((t) => isDone(t) && t.completedAt !== undefined && dayOfIso(t.completedAt) === today);
  return [...open, ...doneToday];
}

/** Open tasks due in the six days after `today`, by date. Today and day +7 are out. */
export function comingUp(s: Pick<HQData, 'tasks'>, today: string): Task[] {
  const last = addDays(today, 6);
  return s.tasks
    .filter((t) => !isDone(t) && t.dueDate !== undefined && t.dueDate > today && t.dueDate <= last)
    .sort((a, b) => {
      if (a.dueDate! !== b.dueDate!) return a.dueDate! < b.dueDate! ? -1 : 1;
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    });
}

/** The `n` most recently edited notes. */
export function recentNotes(s: Pick<HQData, 'notes'>, n: number): Note[] {
  return [...s.notes].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)).slice(0, n);
}

/** One day's events: all-day first, then by start time. */
export function eventsOn(s: Pick<HQData, 'events'>, date: string): CalEvent[] {
  return s.events
    .filter((e) => e.date === date)
    .sort((a, b) => {
      if (a.start === undefined || b.start === undefined) return Number(b.start === undefined) - Number(a.start === undefined);
      return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
    });
}

/**
 * How far along each folder is, for the ones On the go or On hold, in board order. Folders only
 * (subprojects roll up into their parent via {@link projectProgressDeep}), matching the sidebar's list.
 */
export function projectProgress(
  s: Pick<HQData, 'projects' | 'tasks'>,
): { project: Project; done: number; total: number }[] {
  return s.projects
    .filter((p) => !p.archived && (p.status === 'active' || p.status === 'blocked') && isTopLevel(s, p))
    .map((project) => ({ project, ...projectProgressDeep(s, project.id) }));
}

export function greeting(hour: number): 'Good morning' | 'Good afternoon' | 'Good evening' {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/* ---- Projects (Task 9) ---- */

export interface ProjectCardData {
  done: number;
  total: number;
  notes: number;
  next?: string;
  target?: string;
}

/**
 * Everything a board card shows beyond the project itself: task progress (the project's own tasks
 * plus every subproject's), how many notes are filed straight under it, its next step, and its
 * target date. The one-day bar a new project is born with (start = target = the day it was made) is
 * a placeholder, not a deadline anyone chose, so it reads as no target; any other target shows.
 */
export function projectCard(s: Pick<HQData, 'tasks' | 'projects' | 'notes'>, p: Project): ProjectCardData {
  const { done, total } = projectProgressDeep(s, p.id);
  const notes = s.notes.filter((n) => n.projectId === p.id).length;
  const placeholder =
    p.targetDate !== undefined && p.startDate === p.targetDate && p.targetDate === dayOfIso(p.createdAt);
  const target = p.targetDate && !placeholder ? p.targetDate : undefined;
  return { done, total, notes, next: p.nextStep || undefined, target };
}

/* ---- Notes (Task 10) ---- */

/** The folder Evernote notebooks are imported under (`From Evernote/<notebook>`). */
export const EVERNOTE_FOLDER = 'From Evernote';

const underEvernote = (path: string): boolean =>
  path === EVERNOTE_FOLDER || path.startsWith(`${EVERNOTE_FOLDER}/`);

/** Compares folder paths segment by segment, so "Recipes/Baking" sits right under "Recipes". */
function byPathSegments(a: string, b: string): number {
  const as = a.split('/');
  const bs = b.split('/');
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const c = as[i].localeCompare(bs[i]);
    if (c) return c;
  }
  return as.length - bs.length;
}

/**
 * The notebooks pane: every folder and subfolder, each counting its own notes plus its subfolders'.
 * His own folders come first, alphabetically with each subfolder under its parent; everything under
 * `From Evernote/` follows, grouped beneath one "From Evernote" entry.
 */
export function notebooks(doc: Pick<HQData, 'notes'>): { path: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const n of doc.notes) {
    const parts = (n.folder ?? '').split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join('/');
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  const all = [...counts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => byPathSegments(a.path, b.path));
  return [...all.filter((f) => !underEvernote(f.path)), ...all.filter((f) => underEvernote(f.path))];
}

/**
 * The day (YYYY-MM-DD, local) the notes under "From Evernote" came in: the latest day one of them was
 * added to this app, read from the activity log. Undefined when there are none, or the log no longer
 * holds their arrival.
 */
export function evernoteImportedOn(doc: Pick<HQData, 'notes' | 'activity'>): string | undefined {
  const imported = new Set(doc.notes.filter((n) => n.folder && underEvernote(n.folder)).map((n) => n.id));
  let latest: string | undefined;
  for (const e of doc.activity) {
    if (e.type === 'note_created' && imported.has(e.refId) && (latest === undefined || e.at > latest)) latest = e.at;
  }
  return latest === undefined ? undefined : dayOfIso(latest);
}
