import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('idb-keyval', () => ({
  get: async () => undefined,
  set: async () => {},
  del: async () => {},
}));

vi.mock('./lib/assets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/assets')>();
  return { ...actual, delAssetBlob: vi.fn(async () => {}) };
});

import { useHQ, validateImport, FOCUS_CAP } from './store';
import { delAssetBlob } from './lib/assets';
import { streakDays } from './selectors';
import { PROJECT_COLORS } from '@hq/core/data';
import { canonical, deserialize, fullFixture, serialize } from '@hq/store-fs';
import { addDays, dayToIso, todayStr } from './lib/dates';

const S = () => useHQ.getState();

beforeEach(() => {
  S().clearAll();
});

describe('onboarding', () => {
  it('starting empty records the name and leaves every collection empty', () => {
    expect(S().settings.onboarded).toBe(false);
    S().completeOnboarding('Elmar');
    expect(S().settings).toMatchObject({ userName: 'Elmar', onboarded: true });
    expect(S().projects).toEqual([]);
    expect(S().tasks).toEqual([]);
    expect(S().notes).toEqual([]);
  });

  it('the settings carry no theme — the app is light only', () => {
    expect('theme' in S().settings).toBe(false);
    expect('setTheme' in S()).toBe(false);
  });
});

describe('tasks are open or done on screen', () => {
  it('a new task starts open (ready)', () => {
    const id = S().addTask({ title: 'Book the plumber' });
    expect(S().tasks.find((t) => t.id === id)?.status).toBe('ready');
  });

  it('toggleTask switches ready -> done -> ready, stamping and clearing completedAt', () => {
    const id = S().addTask({ title: 'Order the oven' });
    S().toggleTask(id);
    let t = S().tasks.find((x) => x.id === id)!;
    expect(t.status).toBe('done');
    expect(t.completedAt).toBe(dayToIso(todayStr()));
    S().toggleTask(id);
    t = S().tasks.find((x) => x.id === id)!;
    expect(t.status).toBe('ready');
    expect(t.completedAt).toBeUndefined();
  });

  it('a task in another status in the data is open on screen: one tick closes it, the next reopens to ready', () => {
    const id = S().addTask({ title: 'Waiting on a quote' });
    S().setTaskStatus(id, 'waiting');
    S().toggleTask(id);
    expect(S().tasks.find((x) => x.id === id)?.status).toBe('done');
    S().toggleTask(id);
    expect(S().tasks.find((x) => x.id === id)?.status).toBe('ready');
  });

  it('toggling a missing task id changes nothing', () => {
    S().addTask({ title: 'still here' });
    const before = S().tasks;
    S().toggleTask('nope');
    expect(S().tasks).toBe(before);
  });
});

describe('focus cap', () => {
  it('allows at most 3 focused tasks', () => {
    const ids = ['a', 'b', 'c', 'd'].map((t) => S().addTask({ title: t }));
    expect(S().toggleFocus(ids[0])).toBe(true);
    expect(S().toggleFocus(ids[1])).toBe(true);
    expect(S().toggleFocus(ids[2])).toBe(true);
    expect(S().toggleFocus(ids[3])).toBe(false);
    expect(S().tasks.filter((t) => t.focus).length).toBe(FOCUS_CAP);
  });

  it('frees a slot when a focused task completes', () => {
    const ids = ['a', 'b', 'c', 'd'].map((t) => S().addTask({ title: t }));
    ids.slice(0, 3).forEach((id) => S().toggleFocus(id));
    S().toggleTask(ids[0]);
    expect(S().toggleFocus(ids[3])).toBe(true);
  });
});

describe('activity emission', () => {
  it('records exactly one completion event, idempotent across un/re-complete', () => {
    const id = S().addTask({ title: 'ship it' });
    S().toggleTask(id); // done
    S().toggleTask(id); // undone
    S().toggleTask(id); // done again
    const completions = S().activity.filter((e) => e.type === 'task_completed' && e.refId === id);
    expect(completions.length).toBe(1);
  });

  it('emits project_shipped when a project moves to shipped', () => {
    const id = S().addProject({ name: 'Kitchen renovation' });
    S().setProjectStatus(id, 'shipped');
    S().setProjectStatus(id, 'shipped'); // no-op, no duplicate
    const shipped = S().activity.filter((e) => e.type === 'project_shipped');
    expect(shipped.length).toBe(1);
    // the label is plain words, never the builder's
    expect(shipped[0].label).toBe('Finished Kitchen renovation');
  });

  it('gives each new top-level project the first colour not in use; subprojects wear none', () => {
    const a = S().addProject({ name: 'A' });
    const b = S().addProject({ name: 'B' });
    const child = S().addProject({ name: 'Child', parentId: a });
    const c = S().addProject({ name: 'C', color: '#123456' });
    const colorOf = (id: string) => S().projects.find((p) => p.id === id)?.color;
    expect(colorOf(a)).toBe(PROJECT_COLORS[0]);
    expect(colorOf(b)).toBe(PROJECT_COLORS[1]);
    expect(colorOf(child)).toBeUndefined();
    expect(colorOf(c)).toBe('#123456'); // an explicit colour is respected
    S().updateProject(a, { color: undefined }); // freeing a swatch makes it the next pick
    expect(colorOf(S().addProject({ name: 'D' }))).toBe(PROJECT_COLORS[0]);
  });

  it('labels a status change with the on-screen status name', () => {
    const id = S().addProject({ name: 'Cycle tour' });
    S().setProjectStatus(id, 'blocked');
    expect(S().activity.at(-1)?.label).toBe('Cycle tour is on hold');
  });

  it('leaves a new task dateless (a "someday" item); an explicit date is kept', () => {
    const a = S().addTask({ title: 'no date' });
    const b = S().addTask({ title: 'dated', dueDate: '2026-09-01' });
    expect(S().tasks.find((t) => t.id === a)?.dueDate).toBeUndefined();
    expect(S().tasks.find((t) => t.id === b)?.dueDate).toBe('2026-09-01');
  });

  it('defaults a new project to a 1-day bar on today; explicit dates and parentId stored', () => {
    const a = S().addProject({ name: 'fresh' });
    const b = S().addProject({ name: 'planned', startDate: '2026-08-01', targetDate: '2026-08-15', parentId: a });
    const pa = S().projects.find((p) => p.id === a)!;
    const pb = S().projects.find((p) => p.id === b)!;
    expect(pa.startDate).toBe(todayStr());
    expect(pa.targetDate).toBe(todayStr());
    expect(pb.startDate).toBe('2026-08-01');
    expect(pb.targetDate).toBe('2026-08-15');
    expect(pb.parentId).toBe(a);
  });

  it('deleting a parent promotes its children to top level and keeps their tasks', () => {
    const parent = S().addProject({ name: 'Parent' });
    const child = S().addProject({ name: 'Child', parentId: parent });
    const childTask = S().addTask({ title: 'child work', projectId: child });
    S().deleteProject(parent);
    const survivor = S().projects.find((p) => p.id === child)!;
    expect(survivor.parentId).toBeUndefined();
    expect(S().tasks.find((t) => t.id === childTask)?.projectId).toBe(child);
  });

  it('deleting a project unassigns its tasks and records the deletion', () => {
    const pid = S().addProject({ name: 'Doomed' });
    const tid = S().addTask({ title: 'survives', projectId: pid });
    S().deleteProject(pid);
    expect(S().projects.find((p) => p.id === pid)).toBeUndefined();
    expect(S().tasks.find((t) => t.id === tid)?.projectId).toBeUndefined();
    const deleted = S().activity.filter((e) => e.type === 'project_deleted' && e.refId === pid);
    expect(deleted).toHaveLength(1);
    expect(deleted[0].label).toBe('Deleted Doomed');
  });

  it('deleting a missing project id is a no-op, not a phantom event', () => {
    S().deleteProject('nope');
    expect(S().activity.filter((e) => e.type === 'project_deleted')).toHaveLength(0);
  });

  it('prunes the activity stream at 2000 events', () => {
    for (let i = 0; i < 2010; i++) S().addTask({ title: `t${i}` });
    expect(S().activity.length).toBe(2000);
    // oldest pruned, newest kept
    expect(S().activity.at(-1)?.label).toBe('t2009');
  });
});

describe('streak', () => {
  const ev = (day: string) => ({
    id: crypto.randomUUID(),
    type: 'task_completed' as const,
    refId: 'x',
    label: 'x',
    at: new Date(`${day}T12:00:00`).toISOString(),
  });

  it('counts consecutive days ending today', () => {
    const today = todayStr();
    const activity = [ev(addDays(today, -2)), ev(addDays(today, -1)), ev(today)];
    expect(streakDays({ activity })).toBe(3);
  });

  it('does not break if today has no activity yet', () => {
    const today = todayStr();
    const activity = [ev(addDays(today, -2)), ev(addDays(today, -1))];
    expect(streakDays({ activity })).toBe(2);
  });

  it('resets across a gap', () => {
    const today = todayStr();
    const activity = [ev(addDays(today, -5)), ev(today)];
    expect(streakDays({ activity })).toBe(1);
  });

  it('is zero with no recent activity', () => {
    const today = todayStr();
    expect(streakDays({ activity: [ev(addDays(today, -3))] })).toBe(0);
  });
});

describe('import / export', () => {
  it('rejects malformed payloads without touching existing data', () => {
    S().addTask({ title: 'keep me' });
    const before = S().tasks;
    expect(S().importData({ nonsense: true }).ok).toBe(false);
    expect(S().importData('not even an object').ok).toBe(false);
    expect(S().importData({ version: 2 }).ok).toBe(false);
    expect(S().importData({ ...S().exportData(), version: 6 }).ok).toBe(false);
    expect(S().tasks).toEqual(before);
  });

  it('round-trips export → import losslessly', () => {
    S().completeOnboarding('Elmar', fullFixture());
    const id = S().addTask({ title: 'roundtrip', priority: 'high' });
    S().toggleTask(id);
    const exported = S().exportData();
    const json = JSON.parse(JSON.stringify(exported)); // simulate file round-trip

    S().clearAll();
    expect(S().tasks.length).toBe(0);

    const result = S().importData(json);
    expect(result.ok).toBe(true);
    expect(S().exportData()).toEqual(exported);
  });

  it('validateImport accepts a real export', () => {
    S().completeOnboarding('Elmar', fullFixture());
    expect(validateImport(S().exportData())).not.toBeNull();
  });

  it('exports version 1 holding only the kept collections', () => {
    S().completeOnboarding('Elmar', fullFixture());
    const doc = S().exportData();
    expect(doc.version).toBe(1);
    expect(Object.keys(doc).sort()).toEqual(
      ['activity', 'assets', 'events', 'links', 'notes', 'projects', 'settings', 'tasks', 'version'].sort(),
    );
  });

  it('importing a backup marks the app onboarded and replaces what was there', () => {
    S().addTask({ title: 'gone after import' });
    const backup = { ...fullFixture(), version: 1, settings: { userName: 'Elmar', onboarded: false } };
    expect(S().importData(JSON.parse(JSON.stringify(backup))).ok).toBe(true);
    expect(S().settings.onboarded).toBe(true);
    expect(S().tasks.map((t) => t.id)).toEqual(fullFixture().tasks.map((t) => t.id));
  });
});

describe('notes', () => {
  it('adds a note with defaults, logs it once, and updates it in place', () => {
    const id = S().addNote({ title: 'Braai marinade' });
    const n = S().notes.find((x) => x.id === id)!;
    expect(n).toMatchObject({ title: 'Braai marinade', body: '', tags: [], pinned: false });
    expect(S().activity.filter((e) => e.type === 'note_created' && e.refId === id)).toHaveLength(1);
    S().updateNote(id, { body: 'Garlic, lemon', folder: 'Home/Recipes', pinned: true });
    expect(S().notes.find((x) => x.id === id)).toMatchObject({ body: 'Garlic, lemon', folder: 'Home/Recipes', pinned: true });
  });

  it('keeps dates and a folder it is given (an imported note), and stamps now otherwise', () => {
    const id = S().addNote({
      title: 'Receipts',
      folder: 'From Evernote/Travel',
      createdAt: '2023-10-16T10:15:00.000Z',
      updatedAt: '2023-10-17T08:00:00.000Z',
    });
    expect(S().notes.find((x) => x.id === id)).toMatchObject({
      folder: 'From Evernote/Travel',
      createdAt: '2023-10-16T10:15:00.000Z',
      updatedAt: '2023-10-17T08:00:00.000Z',
    });
    const before = Date.now();
    const freshId = S().addNote({ title: 'Fresh' });
    const plain = S().notes.find((x) => x.id === freshId)!;
    expect(Date.parse(plain.createdAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(plain.updatedAt).toBe(plain.createdAt);
  });

  it('deleteNote removes the note and its links; restore brings both back', () => {
    const noteId = S().addNote({ title: 'Trip ideas' });
    const projectId = S().addProject({ name: 'Holiday' });
    S().addLink({ type: 'note', id: noteId }, { type: 'project', id: projectId });
    const snap = S().deleteNote(noteId)!;
    expect(snap.label).toBe('Deleted "Trip ideas"');
    expect(S().notes).toHaveLength(0);
    expect(S().links).toHaveLength(0);
    S().restoreDelete(snap);
    expect(S().notes.map((n) => n.id)).toEqual([noteId]);
    expect(S().links).toHaveLength(1);
  });
});

describe('assets', () => {
  it('links the asset to its entity on add and prunes on delete', () => {
    const noteId = S().addNote({ title: 'with file' });
    const assetId = S().addAsset({ name: 'diagram.png', mime: 'image/png', size: 1234 }, { type: 'note', id: noteId });
    expect(S().assets.length).toBe(1);
    expect(S().links.some((l) => l.from.id === assetId && l.to.id === noteId)).toBe(true);
    S().deleteAsset(assetId);
    expect(S().assets.length).toBe(0);
    expect(S().links.length).toBe(0);
  });

  it('takes the id it is given, so the bytes can be saved before the asset exists', () => {
    const noteId = S().addNote({ title: 'with file' });
    const assetId = S().addAsset({ id: 'ast_given', name: 'a.png', mime: 'image/png', size: 1 }, { type: 'note', id: noteId });
    expect(assetId).toBe('ast_given');
    expect(S().assets.map((a) => a.id)).toEqual(['ast_given']);
    expect(S().links.some((l) => l.from.id === 'ast_given' && l.to.id === noteId)).toBe(true);
  });

  it('deleting the parent entity drops solely-linked asset metadata; the blob waits for commit', () => {
    const noteId = S().addNote({ title: 'with file' });
    const assetId = S().addAsset({ name: 'a.png', mime: 'image/png', size: 1 }, { type: 'note', id: noteId });
    vi.mocked(delAssetBlob).mockClear();
    const snap = S().deleteNote(noteId)!;
    expect(S().assets.length).toBe(0);
    expect(S().links.length).toBe(0);
    // deferred: the undo window still owns the blob until it closes
    expect(delAssetBlob).not.toHaveBeenCalled();
    S().commitDelete(snap);
    expect(delAssetBlob).toHaveBeenCalledWith(assetId);
  });

  it('keeps an asset that is still linked to another entity', () => {
    const noteId = S().addNote({ title: 'n' });
    const projectId = S().addProject({ name: 'p' });
    const assetId = S().addAsset({ name: 'a.png', mime: 'image/png', size: 1 }, { type: 'note', id: noteId });
    S().addLink({ type: 'asset', id: assetId }, { type: 'project', id: projectId });
    vi.mocked(delAssetBlob).mockClear();
    S().deleteNote(noteId);
    expect(S().assets.length).toBe(1);
    expect(delAssetBlob).not.toHaveBeenCalled();
  });

  it('deleteAsset defers its blob to commit; clearAll destroys immediately (no undo window)', () => {
    const noteId = S().addNote({ title: 'n' });
    const a1 = S().addAsset({ name: 'one.png', mime: 'image/png', size: 1 }, { type: 'note', id: noteId });
    const a2 = S().addAsset({ name: 'two.png', mime: 'image/png', size: 1 }, { type: 'note', id: noteId });
    vi.mocked(delAssetBlob).mockClear();
    const snap = S().deleteAsset(a1)!;
    expect(delAssetBlob).not.toHaveBeenCalled();
    S().commitDelete(snap);
    expect(delAssetBlob).toHaveBeenCalledWith(a1);
    S().clearAll();
    expect(delAssetBlob).toHaveBeenCalledWith(a2);
  });

  it('round-trips a blob through base64 for export/import', async () => {
    const { blobToBase64, base64ToBlob } = await import('./lib/assets');
    const original = new Blob(['hello hq'], { type: 'text/plain' });
    const b64 = await blobToBase64(original);
    expect(atob(b64)).toBe('hello hq');
    const restored = base64ToBlob(b64, 'text/plain');
    expect(restored.size).toBe(original.size);
    expect(restored.type).toBe('text/plain');
    // full byte round-trip: encode the restored blob again
    expect(await blobToBase64(restored)).toBe(b64);
  });
});

describe('universal links', () => {
  it('links entities, rejects duplicates and self-links, prunes on delete', () => {
    const taskId = S().addTask({ title: 'linked' });
    const noteId = S().addNote({ title: 'context' });
    S().addLink({ type: 'task', id: taskId }, { type: 'note', id: noteId });
    S().addLink({ type: 'note', id: noteId }, { type: 'task', id: taskId }); // reverse dup
    S().addLink({ type: 'note', id: noteId }, { type: 'note', id: noteId }); // self
    expect(S().links.length).toBe(1);
    S().deleteTask(taskId);
    expect(S().links.length).toBe(0);
  });
});

describe('undoable deletes', () => {
  it('deleteTask returns a snapshot carrying the task and its pruned links; restore brings all back', () => {
    const taskId = S().addTask({ title: 'reversible' });
    const noteId = S().addNote({ title: 'context' });
    S().addLink({ type: 'task', id: taskId }, { type: 'note', id: noteId });

    const snap = S().deleteTask(taskId)!;
    expect(snap.label).toBe('Deleted "reversible"');
    expect(S().tasks.find((t) => t.id === taskId)).toBeUndefined();
    expect(S().links.length).toBe(0);

    S().restoreDelete(snap);
    expect(S().tasks.find((t) => t.id === taskId)?.title).toBe('reversible');
    expect(S().links.length).toBe(1);
  });

  it('deleteProject restores promoted children, orphaned tasks and strips the deletion event on undo', () => {
    const parent = S().addProject({ name: 'Parent' });
    const child = S().addProject({ name: 'Child', parentId: parent });
    const taskId = S().addTask({ title: 'parent work', projectId: parent });

    const snap = S().deleteProject(parent)!;
    expect(S().projects.find((p) => p.id === child)?.parentId).toBeUndefined();
    expect(S().tasks.find((t) => t.id === taskId)?.projectId).toBeUndefined();
    expect(S().activity.some((e) => e.type === 'project_deleted' && e.refId === parent)).toBe(true);

    S().restoreDelete(snap);
    expect(S().projects.find((p) => p.id === parent)?.name).toBe('Parent');
    expect(S().projects.find((p) => p.id === child)?.parentId).toBe(parent);
    expect(S().tasks.find((t) => t.id === taskId)?.projectId).toBe(parent);
    // the history reads as if the delete never happened
    expect(S().activity.some((e) => e.type === 'project_deleted' && e.refId === parent)).toBe(false);
  });

  it('an undo never overwrites a reassignment made inside the toast window', () => {
    const parent = S().addProject({ name: 'Old home' });
    const other = S().addProject({ name: 'New home' });
    const taskId = S().addTask({ title: 'moved on', projectId: parent });

    const snap = S().deleteProject(parent)!;
    S().updateTask(taskId, { projectId: other }); // user re-homed it before undoing
    S().restoreDelete(snap);
    expect(S().tasks.find((t) => t.id === taskId)?.projectId).toBe(other);
  });

  it('blobs die only on commitDelete — never on the delete itself, never on restore', () => {
    const noteId = S().addNote({ title: 'holder' });
    const assetId = S().addAsset({ name: 'doc.pdf', mime: 'application/pdf', size: 10 }, { type: 'note', id: noteId });
    vi.mocked(delAssetBlob).mockClear();

    const snap = S().deleteNote(noteId)!;
    expect(snap.blobIds).toEqual([assetId]);
    expect(S().assets.length).toBe(0); // metadata gone with its last link
    expect(delAssetBlob).not.toHaveBeenCalled();

    S().restoreDelete(snap);
    expect(S().assets.find((a) => a.id === assetId)).toBeDefined();
    expect(S().links.length).toBe(1);
    expect(delAssetBlob).not.toHaveBeenCalled();

    S().commitDelete(snap);
    expect(delAssetBlob).toHaveBeenCalledTimes(1);
    expect(delAssetBlob).toHaveBeenCalledWith(assetId);
  });

  it('double-restore of overlapping snapshots does not duplicate a shared link', () => {
    const taskId = S().addTask({ title: 'one end' });
    const noteId = S().addNote({ title: 'other end' });
    S().addLink({ type: 'task', id: taskId }, { type: 'note', id: noteId });

    const taskSnap = S().deleteTask(taskId)!; // prunes the link
    const noteSnap = S().deleteNote(noteId)!; // link already gone — not in this snapshot
    S().restoreDelete(taskSnap);
    S().restoreDelete(noteSnap);
    expect(S().links.length).toBe(1);
    expect(S().tasks.length + S().notes.length).toBe(2);

    // and in the reverse order, where BOTH snapshots carry the link
    S().clearAll();
    const t2 = S().addTask({ title: 'again' });
    const n2 = S().addNote({ title: 'again note' });
    S().addLink({ type: 'task', id: t2 }, { type: 'note', id: n2 });
    const snapA = S().deleteTask(t2)!;
    S().restoreDelete(snapA);
    const snapB = S().deleteNote(n2)!;
    S().restoreDelete(snapB);
    S().restoreDelete(snapA); // stale second restore — must not duplicate anything
    expect(S().links.length).toBe(1);
    expect(S().tasks.filter((t) => t.id === t2).length).toBe(1);
  });

  it('every entity delete returns a snapshot and undefined for a missing id', () => {
    const ids = {
      task: S().addTask({ title: 't' }),
      note: S().addNote({ title: 'n' }),
      project: S().addProject({ name: 'p' }),
    };
    const asset = S().addAsset({ name: 'a.txt', mime: 'text/plain', size: 1 }, { type: 'note', id: ids.note });
    expect(S().deleteAsset(asset)?.removed.assets?.length).toBe(1);
    expect(S().deleteTask(ids.task)?.removed.tasks?.length).toBe(1);
    expect(S().deleteNote(ids.note)?.removed.notes?.length).toBe(1);
    expect(S().deleteProject(ids.project)?.removed.projects?.length).toBe(1);
    expect(S().deleteTask('nope')).toBeUndefined();
    expect(S().deleteNote('nope')).toBeUndefined();
    expect(S().deleteAsset('nope')).toBeUndefined();
    expect(S().deleteProject('nope')).toBeUndefined();
  });
});

describe('arbitrary-depth nesting is a store invariant', () => {
  it('a folder with children can gain a parent — its whole subtree moves with it', () => {
    const folder = S().addProject({ name: 'Folder' });
    const child = S().addProject({ name: 'Child', parentId: folder });
    const other = S().addProject({ name: 'Other folder' });
    S().updateProject(folder, { parentId: other, nextStep: 'now applies' });
    const p = S().projects.find((x) => x.id === folder)!;
    expect(p.parentId).toBe(other);
    expect(p.nextStep).toBe('now applies');
    // the child rode along — still parented to folder, now nested two deep under other
    expect(S().projects.find((x) => x.id === child)!.parentId).toBe(folder);
  });

  it('a project can nest under another project that is itself a child', () => {
    const folder = S().addProject({ name: 'Folder' });
    const child = S().addProject({ name: 'Child', parentId: folder });
    const leaf = S().addProject({ name: 'Leaf' });
    S().updateProject(leaf, { parentId: child });
    expect(S().projects.find((x) => x.id === leaf)!.parentId).toBe(child);
  });

  it('a project cannot be moved into its own subtree — the cycle guard', () => {
    const grandparent = S().addProject({ name: 'Grandparent' });
    const parent = S().addProject({ name: 'Parent', parentId: grandparent });
    const child = S().addProject({ name: 'Child', parentId: parent });
    // grandparent into its own grandchild's subtree — illegal, dropped
    S().updateProject(grandparent, { parentId: child, nextStep: 'still applies' });
    const g = S().projects.find((x) => x.id === grandparent)!;
    expect(g.parentId).toBeUndefined();
    expect(g.nextStep).toBe('still applies');
    // and the direct one-hop case
    S().updateProject(parent, { parentId: child });
    expect(S().projects.find((x) => x.id === parent)!.parentId).toBe(grandparent);
  });

  it('a legal move round-trips: into a folder, out to top level', () => {
    const folder = S().addProject({ name: 'Folder' });
    const leaf = S().addProject({ name: 'Leaf' });
    S().updateProject(leaf, { parentId: folder });
    expect(S().projects.find((x) => x.id === leaf)!.parentId).toBe(folder);
    S().updateProject(leaf, { parentId: undefined });
    expect(S().projects.find((x) => x.id === leaf)!.parentId).toBeUndefined();
  });

  it('a project cannot parent itself, and a dangling target is rejected', () => {
    const leaf = S().addProject({ name: 'Leaf' });
    S().updateProject(leaf, { parentId: leaf });
    expect(S().projects.find((x) => x.id === leaf)!.parentId).toBeUndefined();
    S().updateProject(leaf, { parentId: 'no-such-project' });
    expect(S().projects.find((x) => x.id === leaf)!.parentId).toBeUndefined();
  });
});

describe('the fields TaskDetail unlocked', () => {
  it('updateTask patches title, priority and projectId', () => {
    const projectId = S().addProject({ name: 'Home' });
    const id = S().addTask({ title: 'typo', priority: 'low' });
    S().updateTask(id, { title: 'fixed', priority: 'high', projectId });
    const t = S().tasks.find((x) => x.id === id)!;
    expect(t.title).toBe('fixed');
    expect(t.priority).toBe('high');
    expect(t.projectId).toBe(projectId);
  });

  it('updateTask sets and clears notes', () => {
    const id = S().addTask({ title: 'with context' });
    expect(S().tasks.find((x) => x.id === id)?.notes).toBeUndefined();
    S().updateTask(id, { notes: 'quote ref KR-1182' });
    expect(S().tasks.find((x) => x.id === id)?.notes).toBe('quote ref KR-1182');
    S().updateTask(id, { notes: undefined });
    expect(S().tasks.find((x) => x.id === id)?.notes).toBeUndefined();
  });
});

describe('events', () => {
  const input = { title: 'Leadership check-in', date: '2026-11-03', start: '08:30', end: '09:15' };

  it('addEvent stamps an id and today as createdAt', () => {
    const id = S().addEvent(input);
    expect(S().events).toEqual([{ ...input, id, createdAt: todayStr() }]);
  });

  it('updateEvent patches fields and never touches id or createdAt', () => {
    const id = S().addEvent(input);
    S().updateEvent(id, { title: 'Moved', date: '2026-11-04', location: 'Office', start: undefined });
    const e = S().events.find((x) => x.id === id)!;
    expect(e).toMatchObject({ id, title: 'Moved', date: '2026-11-04', location: 'Office', createdAt: todayStr() });
    expect(e.start).toBeUndefined();
  });

  it('deleteEvent returns a snapshot; restore brings the event and its links back', () => {
    const id = S().addEvent(input);
    const noteId = S().addNote({ title: 'agenda' });
    S().addLink({ type: 'note', id: noteId }, { type: 'task', id });
    const snap = S().deleteEvent(id)!;
    expect(snap.label).toBe('Deleted "Leadership check-in"');
    expect(S().events).toEqual([]);
    expect(S().links).toEqual([]);
    S().restoreDelete(snap);
    expect(S().events.map((e) => e.id)).toEqual([id]);
    expect(S().links).toHaveLength(1);
    expect(S().deleteEvent('missing')).toBeUndefined();
  });

  it('deleteProject clears the project from its events; undo puts it back', () => {
    const projectId = S().addProject({ name: 'Kitchen' });
    const id = S().addEvent({ ...input, projectId });
    const snap = S().deleteProject(projectId)!;
    expect(S().events.find((e) => e.id === id)?.projectId).toBeUndefined();
    S().restoreDelete(snap);
    expect(S().events.find((e) => e.id === id)?.projectId).toBe(projectId);
  });

  it('exports and re-imports events, and clearAll empties them', () => {
    S().addEvent(input);
    const out = S().exportData();
    expect(out.events).toHaveLength(1);
    S().clearAll();
    expect(S().events).toEqual([]);
    expect(S().importData(out)).toEqual({ ok: true });
    expect(S().events).toHaveLength(1);
  });
});

describe('titles that cannot block saving', () => {
  const vaultDoc = () => {
    const { version: _v, ...doc } = S().exportData();
    return doc;
  };

  it('an event with a pin in its title and location, and a pasted multi-line title, serializes and round-trips', () => {
    const a = S().addEvent({ title: 'Meet at 📍 the pier', date: '2026-11-03', location: 'Pier 📍 3' });
    const b = S().addEvent({ title: 'Agenda:\nbudget\r\n  hiring\n', date: '2026-11-03', start: '10:00', location: 'Room\n4' });
    const c = S().addEvent({ title: 'plain', date: '2026-11-03' });
    S().updateEvent(c, { title: 'a literal \\📍 here', location: 'x\ny' });

    const doc = vaultDoc();
    let back: ReturnType<typeof deserialize> | undefined;
    expect(() => {
      back = deserialize(serialize(doc));
    }).not.toThrow();
    expect(back).toEqual(canonical(doc));

    const get = (id: string) => back!.events.find((e) => e.id === id)!;
    expect(get(a)).toMatchObject({ title: 'Meet at 📍 the pier', location: 'Pier 📍 3' });
    expect(get(b)).toMatchObject({ title: 'Agenda: budget hiring', location: 'Room 4' });
    expect(get(c)).toMatchObject({ title: 'a literal \\📍 here', location: 'x y' });
  });

  it('a task title with a newline serializes and round-trips as one line', () => {
    const id = S().addTask({ title: 'Call the plumber\nabout the quote' });
    const id2 = S().addTask({ title: 'ok' });
    S().updateTask(id2, { title: 'second\r\nline' });
    expect(S().tasks.find((t) => t.id === id)!.title).toBe('Call the plumber about the quote');

    const doc = vaultDoc();
    const back = deserialize(serialize(doc));
    expect(back).toEqual(canonical(doc));
    expect(back.tasks.find((t) => t.id === id)!.title).toBe('Call the plumber about the quote');
    expect(back.tasks.find((t) => t.id === id2)!.title).toBe('second line');
  });

  it('a task that bypassed the store with a newline in its title still serializes', () => {
    const doc = { ...vaultDoc(), tasks: [{ ...fullFixture().tasks[0], title: 'raw\nimport' }] };
    expect(() => serialize(doc)).not.toThrow();
    expect(deserialize(serialize(doc))).toEqual(canonical(doc));
  });
});

describe('addAsset with an id of the caller', () => {
  it('keeps the given id, so a blob written first under it is the asset', () => {
    const n = S().addNote({ title: 'Plan' });
    const id = S().addAsset({ id: 'blob-1', name: 'tiles.png', mime: 'image/png', size: 3 }, { type: 'note', id: n });
    expect(id).toBe('blob-1');
    expect(S().assets.map((a) => a.id)).toEqual(['blob-1']);
    expect(S().links.some((l) => l.from.id === 'blob-1' && l.to.id === n)).toBe(true);
  });
});

describe('note mentions become links', () => {
  const linksFrom = (noteId: string) =>
    S()
      .links.filter((l) => l.from.id === noteId)
      .map((l) => ({ to: l.to, kind: l.kind }));

  it('syncMentions adds and removes links', () => {
    const p = S().addProject({ name: 'Kitchen renovation' });
    const q = S().addProject({ name: 'Garden irrigation' });
    const other = S().addNote({ title: 'Quotes' });
    const n = S().addNote({ title: 'Plan' });
    // not this note's mentions: a blocks link from this note, and another note's mention
    S().addLink({ type: 'note', id: n }, { type: 'project', id: q }, 'blocks');
    S().updateNote(other, { body: `[Kitchen](elmar://project/${p})` });

    S().updateNote(n, { body: `Start with [Kitchen renovation](elmar://project/${p}) and [Quotes](elmar://note/${other}).` });
    expect(linksFrom(n)).toEqual([
      { to: { type: 'project', id: q }, kind: 'blocks' },
      { to: { type: 'project', id: p }, kind: 'related' },
      { to: { type: 'note', id: other }, kind: 'related' },
    ]);

    // editing P out removes its link, and only that one
    S().updateNote(n, { body: `Only [Quotes](elmar://note/${other}) now.` });
    expect(linksFrom(n)).toEqual([
      { to: { type: 'project', id: q }, kind: 'blocks' },
      { to: { type: 'note', id: other }, kind: 'related' },
    ]);
    expect(linksFrom(other)).toEqual([{ to: { type: 'project', id: p }, kind: 'related' }]);

    // mentioning a project the note already blocks adds nothing, and the blocks link stays
    S().syncMentions(n, `[Garden](elmar://project/${q})`);
    expect(linksFrom(n)).toEqual([{ to: { type: 'project', id: q }, kind: 'blocks' }]);
  });

  it('adds no link for a mention of something missing, or of the note itself', () => {
    const n = S().addNote({ title: 'Plan' });
    S().updateNote(n, { body: `[Gone](elmar://project/nope) [Me](elmar://note/${n})` });
    expect(linksFrom(n)).toEqual([]);
  });

  it('a related link made by hand (never a mention) survives body edits', () => {
    const p = S().addProject({ name: 'Kitchen renovation' });
    const q = S().addNote({ title: 'Quotes' });
    const n = S().addNote({ title: 'Plan', body: 'first' });
    S().addLink({ type: 'note', id: n }, { type: 'project', id: p }); // made by hand
    S().updateNote(n, { body: `now with [Quotes](elmar://note/${q})` });
    S().updateNote(n, { body: 'and the mention gone again' });
    S().syncMentions(n, 'still nothing mentioned');
    expect(linksFrom(n)).toEqual([{ to: { type: 'project', id: p }, kind: 'related' }]);
  });

  it('a note edit that leaves the body alone keeps the links as they are', () => {
    const p = S().addProject({ name: 'Kitchen renovation' });
    const n = S().addNote({ title: 'Plan', body: '' });
    S().addLink({ type: 'note', id: n }, { type: 'project', id: p });
    S().updateNote(n, { title: 'Renamed' });
    expect(linksFrom(n)).toEqual([{ to: { type: 'project', id: p }, kind: 'related' }]);
  });
});

describe('deleting a project leaves its notes, without a project', () => {
  it('clears the project from its notes; undo puts it back', () => {
    const p = S().addProject({ name: 'Kitchen' });
    const n = S().addNote({ title: 'Quotes', projectId: p });
    const loose = S().addNote({ title: 'Loose' });
    const snap = S().deleteProject(p)!;
    expect(S().notes.find((x) => x.id === n)).toMatchObject({ title: 'Quotes', projectId: undefined });
    expect(snap.patched?.noteProjectIds).toEqual([[n, p]]);
    S().restoreDelete(snap);
    expect(S().notes.find((x) => x.id === n)?.projectId).toBe(p);
    expect(S().notes.find((x) => x.id === loose)?.projectId).toBeUndefined();
  });

  it('an undo never overwrites a note moved to another project inside the toast window', () => {
    const p = S().addProject({ name: 'Old home' });
    const q = S().addProject({ name: 'New home' });
    const n = S().addNote({ title: 'Quotes', projectId: p });
    const snap = S().deleteProject(p)!;
    S().updateNote(n, { projectId: q });
    S().restoreDelete(snap);
    expect(S().notes.find((x) => x.id === n)?.projectId).toBe(q);
  });
});

describe('an image shared by two notes', () => {
  const linkedTo = (assetId: string) =>
    S()
      .links.filter((l) => l.from.id === assetId || l.to.id === assetId)
      .map((l) => (l.from.id === assetId ? l.to.id : l.from.id));

  it('a note whose body shows an attachment is linked to it, once', () => {
    const a = S().addNote({ title: 'A' });
    const img = S().addAsset({ name: 'tiles.png', mime: 'image/png', size: 3 }, { type: 'note', id: a });
    S().updateNote(a, { body: `![tiles.png](asset:${img})` });
    const b = S().addNote({ title: 'B' });
    S().updateNote(b, { body: `Copied: ![tiles.png](asset:${img})` });
    S().updateNote(b, { body: `Copied: ![tiles.png](asset:${img}) again ![x](asset:${img})` });
    expect(linkedTo(img).sort()).toEqual([a, b].sort());
    // an attachment that doesn't exist links nothing
    S().updateNote(b, { body: '![gone](asset:nope)' });
    expect(S().links.some((l) => l.from.id === 'nope' || l.to.id === 'nope')).toBe(false);
  });

  it('syncMentions links the attachments a body shows', () => {
    const a = S().addNote({ title: 'A' });
    const img = S().addAsset({ name: 'tiles.png', mime: 'image/png', size: 3 }, { type: 'note', id: a });
    const b = S().addNote({ title: 'B' });
    S().syncMentions(b, `![tiles.png](asset:${img})`);
    expect(linkedTo(img)).toContain(b);
  });

  it('deleting the original note keeps the bytes for the note that still shows it', () => {
    const a = S().addNote({ title: 'A' });
    const img = S().addAsset({ name: 'tiles.png', mime: 'image/png', size: 3 }, { type: 'note', id: a });
    S().updateNote(a, { body: `![tiles.png](asset:${img})` });
    const b = S().addNote({ title: 'B' });
    S().updateNote(b, { body: `![tiles.png](asset:${img})` });
    vi.mocked(delAssetBlob).mockClear();
    const snap = S().deleteNote(a)!;
    S().commitDelete(snap);
    expect(delAssetBlob).not.toHaveBeenCalled();
    expect(S().assets.map((x) => x.id)).toContain(img);
  });

  it('keeps the bytes even for a note that shows it without a link (older notes)', () => {
    const a = S().addNote({ title: 'A' });
    const img = S().addAsset({ name: 'tiles.png', mime: 'image/png', size: 3 }, { type: 'note', id: a });
    // B's body was written before bodies linked their attachments: no link, just the reference
    useHQ.setState((s) => ({
      notes: [...s.notes, { id: 'old-b', title: 'B', body: `![t](asset:${img})`, tags: [], pinned: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    }));
    vi.mocked(delAssetBlob).mockClear();
    S().commitDelete(S().deleteNote(a)!);
    expect(delAssetBlob).not.toHaveBeenCalled();
  });

  it('removing the attachment keeps its bytes while another note body still shows it', () => {
    const a = S().addNote({ title: 'A' });
    const img = S().addAsset({ name: 'tiles.png', mime: 'image/png', size: 3 }, { type: 'note', id: a });
    const b = S().addNote({ title: 'B' });
    S().updateNote(b, { body: `![tiles.png](asset:${img})` });
    vi.mocked(delAssetBlob).mockClear();
    S().commitDelete(S().deleteAsset(img)!);
    expect(delAssetBlob).not.toHaveBeenCalled();
    // once nothing shows it, the bytes go
    S().updateNote(b, { body: 'nothing now' });
    S().commitDelete({ label: 'x', removed: {}, blobIds: [img] });
    expect(delAssetBlob).toHaveBeenCalledWith(img);
  });
});
