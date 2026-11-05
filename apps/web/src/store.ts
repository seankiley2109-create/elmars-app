import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import type {
  ActivityEvent,
  ActivityType,
  Asset,
  CalEvent,
  EntityRef,
  HQData,
  ID,
  Link,
  Note,
  Priority,
  Project,
  ProjectStatus,
  Settings,
  Task,
  TaskStatus,
} from './types';
import { STATUS_LABEL } from './types';
import { dayToIso, todayStr } from './lib/dates';
import { delAssetBlob } from './lib/assets';
import { mentionTargets } from './lib/mentions';
import { emptyData, nextProjectColor, oneLine } from '@hq/core/data';
import { validateImport } from '@hq/core/validate';
import { isDescendantOf } from '@hq/core/selectors';

export { validateImport };

/** What Settings says when a file is not one of this app's backups. */
export const NOT_A_BACKUP = "This isn't a backup from Elmar's App.";

const ACTIVITY_CAP = 2000;
export const FOCUS_CAP = 3;

const uuid = (): ID => crypto.randomUUID();
const now = (): string => new Date().toISOString();
/** Task dates are stored at local midnight — the folder carries them at day precision. */
const taskDay = (): string => dayToIso(todayStr());

/* ---------------------------------------------------------------- state */

/**
 * Everything needed to reverse one delete. The delete itself is real and immediate —
 * the store (and therefore the folder) reflects the loss the moment it happens; this is
 * the inverse, held by the undo toast for its 5-second window.
 *
 * `blobIds` is the one deferred side effect: asset blobs are destroyed only in
 * `commitDelete`, because a destroyed blob is the single thing a restore cannot bring back.
 */
export interface DeleteSnapshot {
  /** Toast copy, e.g. `Deleted "Book the plumber"`. */
  label: string;
  removed: Partial<Pick<HQState, 'tasks' | 'projects' | 'notes' | 'links' | 'assets' | 'events'>>;
  /** Fields cleared on OTHER entities, as [entityId, previousValue] — restored only if still cleared. */
  patched?: {
    taskProjectIds?: [ID, ID][]; // deleteProject: tasks that lost their projectId
    eventProjectIds?: [ID, ID][]; // deleteProject: events that lost their projectId
    noteProjectIds?: [ID, ID][]; // deleteProject: notes that lost their projectId
    childParentIds?: [ID, ID][]; // deleteProject: children promoted up one level
    /** The parentId children were promoted to (the deleted project's own parent) — restore compares against this, not `undefined`. */
    promotedParentId?: ID;
  };
  /** Events the delete logged (e.g. project_deleted) — stripped on undo so history stays honest. */
  activityIds?: ID[];
  /** Asset blobs to destroy when the undo window closes. Never touched on restore. */
  blobIds?: ID[];
}

export interface HQState {
  settings: Settings;
  projects: Project[];
  tasks: Task[];
  notes: Note[];
  links: Link[];
  assets: Asset[];
  activity: ActivityEvent[];
  events: CalEvent[];
  hydrated: boolean;

  // settings
  setUserName: (name: string) => void;
  completeOnboarding: (name: string, data?: Partial<HQData>) => void;

  // tasks
  addTask: (input: { title: string; projectId?: ID; priority?: Priority; dueDate?: string }) => ID;
  updateTask: (id: ID, patch: Partial<Omit<Task, 'id' | 'createdAt'>>) => void;
  /** Open <-> done. The only status change the screen makes. */
  toggleTask: (id: ID) => void;
  setTaskStatus: (id: ID, status: TaskStatus) => void;
  toggleFocus: (id: ID) => boolean; // false if focus cap reached
  deleteTask: (id: ID) => DeleteSnapshot | undefined;

  // events
  addEvent: (input: Omit<CalEvent, 'id' | 'createdAt'>) => ID;
  updateEvent: (id: ID, patch: Partial<Omit<CalEvent, 'id' | 'createdAt'>>) => void;
  deleteEvent: (id: ID) => DeleteSnapshot | undefined;

  // projects
  addProject: (input: {
    name: string;
    parentId?: ID;
    color?: string;
    status?: ProjectStatus;
    nextStep?: string;
    startDate?: string;
    targetDate?: string;
  }) => ID;
  updateProject: (id: ID, patch: Partial<Omit<Project, 'id' | 'createdAt'>>) => void;
  setProjectStatus: (id: ID, status: ProjectStatus) => void;
  deleteProject: (id: ID) => DeleteSnapshot | undefined;

  // links
  addLink: (from: EntityRef, to: EntityRef, kind?: Link['kind']) => ID;
  removeLink: (id: ID) => void;

  // notes
  addNote: (input: {
    title: string;
    body?: string;
    tags?: string[];
    folder?: string;
    projectId?: ID;
    pinned?: boolean;
    /** An imported note keeps its own dates; otherwise both are now. */
    createdAt?: string;
    updatedAt?: string;
  }) => ID;
  /** Also runs `syncMentions` whenever the body changes. */
  updateNote: (id: ID, patch: Partial<Omit<Note, 'id' | 'createdAt'>>) => void;
  deleteNote: (id: ID) => DeleteSnapshot | undefined;
  /**
   * Make the note's `related` links follow the projects and notes its body mentions: add one per new
   * mention; drop one whose mention was in the note's stored body and is gone from `body`. Links that
   * were never mentions, `blocks` links and other notes' links are untouched.
   */
  syncMentions: (noteId: ID, body: string) => void;

  // assets (blob handled by src/lib/assets.ts, metadata here)
  /** `id` may be given, so a caller can save the bytes under it before the asset exists. */
  addAsset: (input: Omit<Asset, 'id' | 'createdAt'> & { id?: ID }, linkTo?: EntityRef) => ID;
  /**
   * `from` is the note, task or project whose attachment list the file is removed from. While another
   * note's body still shows the file, only `from` lets go of it: the record stays, so backups keep it.
   */
  deleteAsset: (id: ID, from?: EntityRef) => DeleteSnapshot | undefined;

  // undo — every entity delete above returns a DeleteSnapshot; the toast holds it
  restoreDelete: (snap: DeleteSnapshot) => void;
  commitDelete: (snap: DeleteSnapshot) => void;

  // data
  exportData: () => HQData;
  importData: (raw: unknown) => { ok: true } | { ok: false; error: string };
  clearAll: () => void;
  markExported: () => void;
}

function pushEvent(
  activity: ActivityEvent[],
  type: ActivityType,
  refId: ID,
  label: string,
): ActivityEvent[] {
  const next = [...activity, { id: uuid(), type, refId, label, at: now() }];
  return next.length > ACTIVITY_CAP ? next.slice(next.length - ACTIVITY_CAP) : next;
}

const pruneLinks = (links: Link[], ids: ID[]): Link[] =>
  links.filter((l) => !ids.includes(l.from.id) && !ids.includes(l.to.id));

/**
 * Prune links to deleted ids; any asset that just lost its last link is dropped
 * too (metadata only — assets exist via attachment links, so zero remaining links
 * means orphaned). Blobs are NOT destroyed here: the caller carries `droppedAssets`
 * into a DeleteSnapshot, and the blob dies only when the undo window closes
 * (commitDelete). Destroying it here would make undo restore a broken attachment.
 */
function pruneLinksAndAssets(
  s: Pick<HQState, 'links' | 'assets' | 'notes'>,
  ids: ID[],
): { links: Link[]; assets: Asset[]; removedLinks: Link[]; droppedAssets: Asset[] } {
  const links = pruneLinks(s.links, ids);
  const removedLinks = s.links.filter((l) => ids.includes(l.from.id) || ids.includes(l.to.id));
  const stillLinked = new Set(links.flatMap((l) => [l.from.id, l.to.id]));
  // a note that stays and still shows the file keeps it, linked or not (notes written before bodies
  // linked their attachments have only the reference)
  const stillShown = assetIdsShown(s.notes.filter((n) => !ids.includes(n.id)));
  const droppedAssets = s.assets.filter(
    (a) =>
      !stillLinked.has(a.id) &&
      !stillShown.has(a.id) &&
      s.links.some((l) => l.from.id === a.id || l.to.id === a.id),
  );
  const drop = new Set(droppedAssets.map((a) => a.id));
  return {
    links,
    assets: drop.size ? s.assets.filter((a) => !drop.has(a.id)) : s.assets,
    removedLinks,
    droppedAssets,
  };
}

/** `![…](asset:<id>)` and `[…](asset:<id>)`: an attachment a note body shows. Same as `inlineAssetIds`. */
const ASSET_REF = /\]\(asset:([^)\s]+)\)/g;

/** Every attachment id these note bodies show. */
function assetIdsShown(notes: Pick<Note, 'body'>[]): Set<ID> {
  const out = new Set<ID>();
  for (const n of notes) for (const m of n.body.matchAll(ASSET_REF)) out.add(m[1]);
  return out;
}

/**
 * The links after syncing one note's mentions (see `syncMentions`), or `undefined` when nothing
 * changes. Every attachment the body shows is linked to the note too (an image pasted or copied in
 * from another note), so deleting the note it first came with never takes the file from this one;
 * that link is never taken away by an edit (the file then shows under the note's attachments). A mention of something that doesn't exist, or of the note itself, links nothing; a target
 * already linked to the note either way, of any kind, gets no second link.
 *
 * Only a mention that was in `prevBody` and is gone from `body` takes its link away: a `related` link
 * made by hand (one that was never a mention) is never touched by an edit.
 */
function mentionLinks(
  s: Pick<HQState, 'links' | 'projects' | 'notes' | 'assets'>,
  noteId: ID,
  prevBody: string,
  body: string,
): Link[] | undefined {
  const exists = (t: { type: 'project' | 'note'; id: ID }) =>
    t.id !== noteId &&
    (t.type === 'project' ? s.projects.some((p) => p.id === t.id) : s.notes.some((n) => n.id === t.id));
  const targets = mentionTargets(body).filter(exists);
  const key = (t: { type: string; id: ID }) => `${t.type}/${t.id}`;
  const wanted = new Set(targets.map(key));
  const dropped = new Set(
    mentionTargets(prevBody)
      .map(key)
      .filter((k) => !wanted.has(k)),
  );

  const kept = s.links.filter(
    (l) =>
      !(
        l.from.type === 'note' &&
        l.from.id === noteId &&
        l.kind === 'related' &&
        (l.to.type === 'project' || l.to.type === 'note') &&
        dropped.has(key(l.to))
      ),
  );
  const linked = (id: ID) =>
    kept.some((l) => (l.from.id === noteId && l.to.id === id) || (l.from.id === id && l.to.id === noteId));
  const added: Link[] = targets
    .filter((t) => !linked(t.id))
    .map((t) => ({ id: uuid(), from: { type: 'note', id: noteId }, to: { type: t.type, id: t.id }, kind: 'related' }));
  for (const assetId of assetIdsShown([{ body }])) {
    if (!s.assets.some((a) => a.id === assetId) || linked(assetId)) continue;
    // the same shape `addAsset` gives a file attached to a note
    added.push({ id: uuid(), from: { type: 'asset', id: assetId }, to: { type: 'note', id: noteId }, kind: 'related' });
  }

  if (!added.length && kept.length === s.links.length) return undefined;
  return [...kept, ...added];
}

/* ------------------------------------------------------------- storage */

const idbStorage: StateStorage = {
  getItem: async (name) => (await idbGet<string>(name)) ?? null,
  setItem: async (name, value) => idbSet(name, value),
  removeItem: async (name) => idbDel(name),
};

/**
 * `createJSONStorage`'s factory runs once, when the store is constructed, and zustand memoises the
 * result — so a reassignable `let activeStorage` would never take effect after the folder is picked.
 * This object's identity never changes; only what it delegates to does.
 */
let backend: StateStorage = idbStorage;

const hqStorage: StateStorage = {
  getItem: (name) => backend.getItem(name),
  setItem: (name, value) => backend.setItem(name, value),
  removeItem: (name) => backend.removeItem(name),
};

/** Point the store at a folder. Call before `useHQ.persist.rehydrate()`. */
export function useVaultBackend(storage: StateStorage): void {
  backend = storage;
}

/** True while the app is reading and writing IndexedDB rather than a folder. */
export const isUsingVault = (): boolean => backend !== idbStorage;

/* ------------------------------------------------------ task mechanics */

/** Set a task's status and log its completion exactly once. */
function applyTaskStatus(s: HQState, id: ID, status: TaskStatus): Partial<HQState> {
  const task = s.tasks.find((t) => t.id === id);
  if (!task || task.status === status) return {};
  const nowDone = status === 'done';
  const closedDay = nowDone ? taskDay() : undefined; // day precision, like every task date
  const tasks = s.tasks.map((t) =>
    t.id === id ? { ...t, status, completedAt: nowDone ? t.completedAt ?? closedDay : undefined } : t,
  );

  let activity = s.activity;
  const alreadyLogged = s.activity.some((e) => e.type === 'task_completed' && e.refId === id);
  if (nowDone && !alreadyLogged) activity = pushEvent(activity, 'task_completed', id, task.title);

  return { tasks, activity };
}

/* --------------------------------------------------------------- store */

export const useHQ = create<HQState>()(
  persist(
    (set, get) => ({
      ...emptyData(),
      hydrated: false,

      setUserName: (userName) => set((s) => ({ settings: { ...s.settings, userName } })),
      completeOnboarding: (name, data) =>
        set((s) => ({
          ...(data ?? {}),
          settings: { ...s.settings, userName: name, onboarded: true },
        })),

      /* tasks */
      addTask: ({ title: rawTitle, projectId, priority = 'medium', dueDate }) => {
        const id = uuid();
        const title = oneLine(rawTitle); // the vault holds a title on one line
        // A new task starts open ('ready'). A dateless task stays dateless rather than silently
        // landing on today; an explicit date puts it on the calendar.
        set((s) => ({
          tasks: [
            ...s.tasks,
            { id, title, projectId, priority, dueDate, focus: false, status: 'ready', createdAt: taskDay() },
          ],
          activity: pushEvent(s.activity, 'task_created', id, title),
        }));
        return id;
      },
      updateTask: (id, patch) =>
        set((s) => {
          const clean = patch.title === undefined ? patch : { ...patch, title: oneLine(patch.title) };
          return { tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...clean } : t)) };
        }),
      toggleTask: (id) =>
        set((s) => {
          const task = s.tasks.find((t) => t.id === id);
          if (!task) return s;
          // On screen a task is only open or done; the other statuses stay in the data. Reopening
          // lands on 'ready'. The focus flag survives completion so "all focus done" is detectable.
          return applyTaskStatus(s, id, task.status === 'done' ? 'ready' : 'done');
        }),
      setTaskStatus: (id, status) => set((s) => applyTaskStatus(s, id, status)),
      toggleFocus: (id) => {
        const s = get();
        const task = s.tasks.find((t) => t.id === id);
        if (!task) return false;
        if (!task.focus) {
          const focused = s.tasks.filter((t) => t.focus && t.status !== 'done').length;
          if (focused >= FOCUS_CAP) return false;
        }
        set((st) => ({
          tasks: st.tasks.map((t) => (t.id === id ? { ...t, focus: !t.focus } : t)),
        }));
        return true;
      },
      deleteTask: (id) => {
        const s = get();
        const task = s.tasks.find((t) => t.id === id);
        if (!task) return undefined;
        const { links, assets, removedLinks, droppedAssets } = pruneLinksAndAssets(s, [id]);
        set({ tasks: s.tasks.filter((t) => t.id !== id), links, assets });
        return {
          label: `Deleted "${task.title}"`,
          removed: { tasks: [task], links: removedLinks, assets: droppedAssets },
          blobIds: droppedAssets.map((a) => a.id),
        };
      },

      /* events */
      addEvent: (input) => {
        const id = uuid();
        const clean = {
          ...input,
          title: oneLine(input.title),
          ...(input.location === undefined ? {} : { location: oneLine(input.location) }),
        };
        set((s) => ({ events: [...s.events, { ...clean, id, createdAt: todayStr() }] }));
        return id;
      },
      updateEvent: (id, patch) =>
        set((s) => {
          const clean = {
            ...patch,
            ...(patch.title === undefined ? {} : { title: oneLine(patch.title) }),
            ...(patch.location === undefined ? {} : { location: oneLine(patch.location) }),
          };
          return { events: s.events.map((e) => (e.id === id ? { ...e, ...clean } : e)) };
        }),
      deleteEvent: (id) => {
        const s = get();
        const event = s.events.find((e) => e.id === id);
        if (!event) return undefined;
        const { links, assets, removedLinks, droppedAssets } = pruneLinksAndAssets(s, [id]);
        set({ events: s.events.filter((e) => e.id !== id), links, assets });
        return {
          label: `Deleted "${event.title}"`,
          removed: { events: [event], links: removedLinks, assets: droppedAssets },
          blobIds: droppedAssets.map((a) => a.id),
        };
      },

      /* projects */
      addProject: ({ name, parentId, color, status = 'active', nextStep, startDate, targetDate }) => {
        const id = uuid();
        // no date = today: a new project is a 1-day bar on today until it's dragged/stretched
        const start = startDate ?? todayStr();
        const target = targetDate ?? todayStr();
        set((s) => ({
          projects: [
            ...s.projects,
            {
              id,
              name,
              parentId,
              // a new top-level project takes the first swatch no other top-level project wears
              color: color ?? (parentId ? undefined : nextProjectColor(s.projects.filter((p) => !p.parentId).map((p) => p.color))),
              status,
              nextStep,
              startDate: start,
              targetDate: target,
              tags: [],
              links: [],
              archived: false,
              createdAt: now(),
              updatedAt: now(),
            },
          ],
        }));
        return id;
      },
      updateProject: (id, patch) =>
        set((s) => {
          // The only store invariant on nesting is "no cycles": a project can be moved under any
          // other project, taking its own subtree with it, as long as the target isn't itself
          // inside that subtree (and isn't the project itself). An illegal parentId is dropped;
          // the rest of the patch still applies. Clearing parentId (promote to top level) is
          // always legal.
          let effective = patch;
          if ('parentId' in patch && patch.parentId !== undefined) {
            const target = s.projects.find((p) => p.id === patch.parentId);
            const illegal = !target || patch.parentId === id || isDescendantOf(s, patch.parentId, id);
            if (illegal) {
              const { parentId: _illegal, ...rest } = patch;
              effective = rest;
            }
          }
          return {
            projects: s.projects.map((p) => (p.id === id ? { ...p, ...effective, updatedAt: now() } : p)),
          };
        }),
      setProjectStatus: (id, status) =>
        set((s) => {
          const project = s.projects.find((p) => p.id === id);
          if (!project || project.status === status) return s;
          const type: ActivityType = status === 'shipped' ? 'project_shipped' : 'project_status';
          const label =
            status === 'shipped'
              ? `Finished ${project.name}`
              : `${project.name} is ${STATUS_LABEL[status].toLowerCase()}`;
          return {
            projects: s.projects.map((p) => (p.id === id ? { ...p, status, updatedAt: now() } : p)),
            activity: pushEvent(s.activity, type, id, label),
          };
        }),
      deleteProject: (id) => {
        const s = get();
        const project = s.projects.find((p) => p.id === id);
        if (!project) return undefined;
        const children = s.projects.filter((p) => p.parentId === id);
        const orphanedTasks = s.tasks.filter((t) => t.projectId === id);
        const orphanedEvents = s.events.filter((e) => e.projectId === id);
        const orphanedNotes = s.notes.filter((n) => n.projectId === id);
        const { links, assets, removedLinks, droppedAssets } = pruneLinksAndAssets(s, [id]);
        const activity = pushEvent(s.activity, 'project_deleted', id, `Deleted ${project.name}`);
        set({
          // children are promoted up one level (to the deleted project's own parent, root if it
          // had none), never destroyed — same philosophy as tasks
          projects: s.projects
            .filter((p) => p.id !== id)
            .map((p) => (p.parentId === id ? { ...p, parentId: project.parentId } : p)),
          tasks: s.tasks.map((t) => (t.projectId === id ? { ...t, projectId: undefined } : t)),
          events: s.events.map((e) => (e.projectId === id ? { ...e, projectId: undefined } : e)),
          // its notes stay, without a project, like its tasks
          notes: s.notes.map((n) => (n.projectId === id ? { ...n, projectId: undefined } : n)),
          links,
          assets,
          activity,
        });
        return {
          label: `Deleted ${project.name}`,
          removed: { projects: [project], links: removedLinks, assets: droppedAssets },
          patched: {
            taskProjectIds: orphanedTasks.map((t) => [t.id, id] as [ID, ID]),
            eventProjectIds: orphanedEvents.map((e) => [e.id, id] as [ID, ID]),
            noteProjectIds: orphanedNotes.map((n) => [n.id, id] as [ID, ID]),
            childParentIds: children.map((p) => [p.id, id] as [ID, ID]),
            promotedParentId: project.parentId,
          },
          activityIds: [activity[activity.length - 1].id],
          blobIds: droppedAssets.map((a) => a.id),
        };
      },

      /* links */
      addLink: (from, to, kind = 'related') => {
        const id = uuid();
        set((s) => {
          const dup = s.links.some(
            (l) =>
              (l.from.id === from.id && l.to.id === to.id) ||
              (l.from.id === to.id && l.to.id === from.id),
          );
          if (dup || from.id === to.id) return s;
          return { links: [...s.links, { id, from, to, kind }] };
        });
        return id;
      },
      removeLink: (id) => set((s) => ({ links: s.links.filter((l) => l.id !== id) })),

      /* notes */
      addNote: ({ title, body = '', tags = [], folder, projectId, pinned = false, createdAt, updatedAt }) => {
        const id = uuid();
        const stamp = now();
        const created = createdAt ?? stamp;
        set((s) => ({
          notes: [
            ...s.notes,
            { id, title, body, tags, folder, projectId, pinned, createdAt: created, updatedAt: updatedAt ?? created },
          ],
          activity: pushEvent(s.activity, 'note_created', id, title),
        }));
        return id;
      },
      updateNote: (id, patch) =>
        set((s) => {
          const before = s.notes.find((n) => n.id === id);
          const notes = s.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: now() } : n));
          // the body is where mentions live: whenever it changes, the note's links follow it
          if (!before || patch.body === undefined || patch.body === before.body) return { notes };
          const links = mentionLinks({ ...s, notes }, id, before.body, patch.body);
          return links ? { notes, links } : { notes };
        }),
      syncMentions: (noteId, body) =>
        set((s) => {
          // the body on record is the "before": mentions it held and `body` lacks lose their links
          const prev = s.notes.find((n) => n.id === noteId)?.body ?? '';
          const links = mentionLinks(s, noteId, prev, body);
          return links ? { links } : s;
        }),
      deleteNote: (id) => {
        const s = get();
        const note = s.notes.find((n) => n.id === id);
        if (!note) return undefined;
        const { links, assets, removedLinks, droppedAssets } = pruneLinksAndAssets(s, [id]);
        set({ notes: s.notes.filter((n) => n.id !== id), links, assets });
        return {
          label: `Deleted "${note.title}"`,
          removed: { notes: [note], links: removedLinks, assets: droppedAssets },
          blobIds: droppedAssets.map((a) => a.id),
        };
      },

      /* assets — caller stores/removes the blob via src/lib/assets.ts */
      addAsset: ({ id: givenId, ...input }, linkTo) => {
        const id = givenId ?? uuid();
        set((s) => ({
          assets: [...s.assets, { id, createdAt: now(), ...input }],
          links: linkTo
            ? [...s.links, { id: uuid(), from: { type: 'asset' as const, id }, to: linkTo, kind: 'related' as const }]
            : s.links,
          activity: pushEvent(s.activity, 'asset_added', id, input.name),
        }));
        return id;
      },
      deleteAsset: (id, from) => {
        const s = get();
        const asset = s.assets.find((a) => a.id === id);
        if (!asset) return undefined;
        const shownElsewhere = from && assetIdsShown(s.notes.filter((n) => n.id !== from.id)).has(id);
        if (shownElsewhere) {
          // another note still shows the file: detach it from `from` only
          const between = (l: Link) =>
            (l.from.id === id && l.to.id === from.id) || (l.to.id === id && l.from.id === from.id);
          const detached = s.links.filter(between);
          set({ links: s.links.filter((l) => !between(l)) });
          return { label: `Removed ${asset.name}`, removed: { links: detached } };
        }
        const removedLinks = s.links.filter((l) => l.from.id === id || l.to.id === id);
        set({
          assets: s.assets.filter((a) => a.id !== id),
          links: pruneLinks(s.links, [id]),
        });
        // the blob outlives the metadata until commitDelete — undo must find it intact
        return {
          label: `Deleted ${asset.name}`,
          removed: { assets: [asset], links: removedLinks },
          blobIds: [id],
        };
      },

      /* undo */
      restoreDelete: (snap) =>
        set((s) => {
          const out: Partial<HQState> = {};
          // Re-insert each removed slice, skipping ids that already exist — two overlapping
          // snapshots (e.g. a link pruned by both a task delete and a note delete) must not
          // duplicate on the second restore.
          for (const key of Object.keys(snap.removed) as (keyof DeleteSnapshot['removed'])[]) {
            // every slice is a homogeneous {id}[] — the cast erases the union so .map/.filter apply
            const items = snap.removed[key] as { id: ID }[] | undefined;
            if (!items?.length) continue;
            const existing = s[key] as { id: ID }[];
            const have = new Set(existing.map((x) => x.id));
            const back = items.filter((x) => !have.has(x.id));
            if (back.length) (out as Record<string, unknown>)[key] = [...existing, ...back];
          }
          // Fields cleared on other entities come back only if still cleared — an undo never
          // overwrites something the user changed inside the toast window.
          if (snap.patched?.taskProjectIds?.length) {
            const projOf = new Map(snap.patched.taskProjectIds);
            const base = (out.tasks ?? s.tasks) as Task[];
            out.tasks = base.map((t) =>
              t.projectId === undefined && projOf.has(t.id) ? { ...t, projectId: projOf.get(t.id) } : t,
            );
          }
          if (snap.patched?.eventProjectIds?.length) {
            const projOf = new Map(snap.patched.eventProjectIds);
            const base = (out.events ?? s.events) as CalEvent[];
            out.events = base.map((e) =>
              e.projectId === undefined && projOf.has(e.id) ? { ...e, projectId: projOf.get(e.id) } : e,
            );
          }
          if (snap.patched?.noteProjectIds?.length) {
            const projOf = new Map(snap.patched.noteProjectIds);
            const base = (out.notes ?? s.notes) as Note[];
            out.notes = base.map((n) =>
              n.projectId === undefined && projOf.has(n.id) ? { ...n, projectId: projOf.get(n.id) } : n,
            );
          }
          if (snap.patched?.childParentIds?.length) {
            const parentOf = new Map(snap.patched.childParentIds);
            const promotedTo = snap.patched.promotedParentId;
            const base = (out.projects ?? s.projects) as Project[];
            out.projects = base.map((p) =>
              p.parentId === promotedTo && parentOf.has(p.id) ? { ...p, parentId: parentOf.get(p.id) } : p,
            );
          }
          if (snap.activityIds?.length) {
            const drop = new Set(snap.activityIds);
            out.activity = s.activity.filter((e) => !drop.has(e.id));
          }
          return out;
        }),
      commitDelete: (snap) => {
        // a note body that still shows the file (an image copied into another note) keeps its bytes
        const shown = assetIdsShown(get().notes);
        for (const id of snap.blobIds ?? []) if (!shown.has(id)) void delAssetBlob(id);
      },

      /* data */
      exportData: () => {
        const s = get();
        return {
          version: 1,
          settings: s.settings,
          projects: s.projects,
          tasks: s.tasks,
          notes: s.notes,
          links: s.links,
          assets: s.assets,
          activity: s.activity,
          events: s.events,
        };
      },
      importData: (raw) => {
        const data = validateImport(raw);
        if (!data) return { ok: false as const, error: NOT_A_BACKUP };
        // Blobs are the caller's job (`restoreBackup` in lib/backup.ts): it removes the replaced
        // document's blobs, waits for that, then writes the backup's, so the two cannot race.
        const { version: _version, ...doc } = data;
        set(() => ({ ...doc }));
        return { ok: true as const };
      },
      clearAll: () => {
        for (const a of get().assets) void delAssetBlob(a.id);
        set(() => ({ ...emptyData() }));
      },
      markExported: () =>
        set((s) => ({ settings: { ...s.settings, lastExportAt: now() } })),
    }),
    {
      name: 'elmar-data',
      version: 1,
      storage: createJSONStorage(() => hqStorage),
      // getItem needs the folder's permission, and permission needs a user gesture — which cannot
      // happen at module-import time. The boot sequence calls rehydrate() once a backend is chosen.
      skipHydration: true,
      partialize: (s) => ({
        settings: s.settings,
        projects: s.projects,
        tasks: s.tasks,
        notes: s.notes,
        links: s.links,
        assets: s.assets,
        activity: s.activity,
        events: s.events,
      }),
      onRehydrateStorage: () => () => {
        // runs after async hydration completes
        useHQ.setState({ hydrated: true });
      },
    },
  ),
);
