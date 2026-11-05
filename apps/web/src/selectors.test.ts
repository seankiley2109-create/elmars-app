import { describe, expect, it } from 'vitest';
import {
  childProjects,
  dayLoadRange,
  evernoteImportedOn,
  isDescendantOf,
  isTopLevel,
  notebooks,
  parentOf,
  projectColor,
  projectCrumb,
  projectProgressDeep,
  projectTasksDeep,
  projectShelved,
  tasksDueInRange,
} from './selectors';
import type { ActivityEvent, Note, Project, Task } from './types';

const task = (over: Partial<Task>): Task => ({
  id: 't1',
  title: 'A task',
  priority: 'medium',
  focus: false,
  status: 'done',
  createdAt: '2026-07-01T00:00:00.000Z',
  ...over,
});

/* ---------------------------------------------------------------- hierarchy */

const project = (over: Partial<Project> & { id: string }): Project => ({
  name: over.id,
  status: 'active',
  tags: [],
  links: [],
  archived: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...over,
});

describe('project hierarchy', () => {
  const parent = project({ id: 'parent', name: 'Kitchen renovation' });
  const childA = project({ id: 'childA', parentId: 'parent' });
  const childB = project({ id: 'childB', parentId: 'parent', status: 'shipped' });

  it('childProjects finds direct children at any depth', () => {
    const grandchild = project({ id: 'grandchild', parentId: 'childA' });
    const s = { projects: [parent, childA, childB, grandchild] };
    expect(childProjects(s, 'parent').map((p) => p.id)).toEqual(['childA', 'childB']);
    expect(childProjects(s, 'childA').map((p) => p.id)).toEqual(['grandchild']);
    expect(childProjects(s, 'grandchild')).toEqual([]);
  });

  it('a dangling parentId renders top-level; parentOf resolves only real children', () => {
    const orphan = project({ id: 'orphan', parentId: 'ghost' });
    const s = { projects: [parent, childA, orphan] };
    expect(isTopLevel(s, orphan)).toBe(true);
    expect(isTopLevel(s, childA)).toBe(false);
    expect(parentOf(s, orphan)).toBeUndefined();
    expect(parentOf(s, childA)?.id).toBe('parent');
  });

  it('a hand-edited cycle renders both projects top-level — nothing vanishes', () => {
    const a = project({ id: 'a', parentId: 'b' });
    const b = project({ id: 'b', parentId: 'a' });
    const s = { projects: [a, b] };
    expect(isTopLevel(s, a)).toBe(true);
    expect(isTopLevel(s, b)).toBe(true);
  });

  it('projectProgressDeep rolls up own and child tasks', () => {
    const s = {
      projects: [parent, childA, childB],
      tasks: [
        task({ id: 'own', projectId: 'parent', status: 'done', completedAt: '2026-07-02T00:00:00.000Z' }),
        task({ id: 'ca1', projectId: 'childA', status: 'in_progress' }),
        task({ id: 'cb1', projectId: 'childB', status: 'done', completedAt: '2026-07-03T00:00:00.000Z' }),
        task({ id: 'other', projectId: 'elsewhere', status: 'done', completedAt: '2026-07-03T00:00:00.000Z' }),
      ],
    };
    expect(projectProgressDeep(s, 'parent')).toEqual({ done: 2, total: 3 });
  });

  it('projectShelved: shipped self; all-children-shipped needs no open own tasks; leaves stay', () => {
    const shippedLeaf = project({ id: 'sl', status: 'shipped' });
    const activeLeaf = project({ id: 'al' });
    const allShippedParent = project({ id: 'asp' });
    const c1 = project({ id: 'c1', parentId: 'asp', status: 'shipped' });
    const c2 = project({ id: 'c2', parentId: 'asp', status: 'shipped' });

    const base = { projects: [shippedLeaf, activeLeaf, allShippedParent, c1, c2], tasks: [] as Task[] };
    expect(projectShelved(base, shippedLeaf)).toBe(true);
    expect(projectShelved(base, activeLeaf)).toBe(false);
    expect(projectShelved(base, allShippedParent)).toBe(true);

    const withOpenOwnTask = { ...base, tasks: [task({ id: 't', projectId: 'asp', status: 'ready' })] };
    expect(projectShelved(withOpenOwnTask, allShippedParent)).toBe(false);

    const mixedChildren = { projects: [allShippedParent, c1, project({ id: 'c3', parentId: 'asp' })], tasks: [] as Task[] };
    expect(projectShelved(mixedChildren, allShippedParent)).toBe(false);
  });

  it('rolls up progress, time and shelved status through a 3-level chain', () => {
    const root = project({ id: 'root', name: 'Root', color: '#ff0000' });
    const mid = project({ id: 'mid', parentId: 'root' });
    const leaf = project({ id: 'leaf', parentId: 'mid', status: 'shipped' });
    const s = {
      projects: [root, mid, leaf],
      tasks: [
        task({ id: 'rt', projectId: 'root', status: 'ready' }),
        task({ id: 'lt', projectId: 'leaf', status: 'done', completedAt: '2026-07-03T00:00:00.000Z' }),
      ] as Task[],
    };
    // a task on the grandchild rolls all the way up to the root
    expect(projectProgressDeep(s, 'root')).toEqual({ done: 1, total: 2 });
    expect(projectTasksDeep(s, 'root').map((t) => t.id).sort()).toEqual(['lt', 'rt']);
    // color always traces to the root ancestor, no matter the depth
    expect(projectColor({ projects: s.projects }, leaf)).toBe('#ff0000');
    expect(projectColor({ projects: s.projects }, mid)).toBe('#ff0000');
    // shelved only once every descendant, at any depth, has shipped and no open own tasks remain
    const allShipped = { projects: [root, { ...mid, status: 'shipped' as const }, leaf], tasks: [] as Task[] };
    expect(projectShelved(allShipped, root)).toBe(true);
    expect(projectShelved(s, root)).toBe(false); // rt is still open
  });

  it('isDescendantOf walks the parent chain to any depth, cycle-safe', () => {
    const root = project({ id: 'root' });
    const mid = project({ id: 'mid', parentId: 'root' });
    const leaf = project({ id: 'leaf', parentId: 'mid' });
    const s = { projects: [root, mid, leaf] };
    expect(isDescendantOf(s, 'leaf', 'root')).toBe(true);
    expect(isDescendantOf(s, 'mid', 'root')).toBe(true);
    expect(isDescendantOf(s, 'root', 'leaf')).toBe(false);
    expect(isDescendantOf(s, 'root', 'root')).toBe(false);

    const a = project({ id: 'a', parentId: 'b' });
    const b = project({ id: 'b', parentId: 'a' });
    expect(isDescendantOf({ projects: [a, b] }, 'a', 'b')).toBe(true); // terminates, doesn't spin
  });
});

describe('tasksDueInRange', () => {
  it('includes every task with a due date inside the range', () => {
    const tasks: Task[] = [
      task({ id: 'a', status: 'ready', dueDate: '2026-07-05' }),
      task({ id: 'b', status: 'ready', dueDate: '2026-07-20' }), // out of range
      task({ id: 'c', status: 'ready' }), // no due date
      task({ id: 'd', status: 'ready', dueDate: '2026-07-06' }),
    ];
    expect(tasksDueInRange({ tasks }, '2026-07-01', '2026-07-10').map((t) => t.id)).toEqual(['a', 'd']);
  });
});

describe('projectCrumb', () => {
  it('reads a subproject as "Parent › Child" and a top-level as its own name', () => {
    const parent = project({ id: 'p', name: 'Backup Engineering' });
    const child = project({ id: 'c', name: 'Fleet Reporting', parentId: 'p' });
    const projects = [parent, child];
    expect(projectCrumb({ projects }, parent)).toBe('Backup Engineering');
    expect(projectCrumb({ projects }, child)).toBe('Backup Engineering › Fleet Reporting');
  });

  it('joins the full ancestor chain at any depth', () => {
    const root = project({ id: 'r', name: 'Backup Engineering' });
    const mid = project({ id: 'm', name: 'Fleet Reporting', parentId: 'r' });
    const leaf = project({ id: 'l', name: 'Weekly Digest', parentId: 'm' });
    const projects = [root, mid, leaf];
    expect(projectCrumb({ projects }, leaf)).toBe('Backup Engineering › Fleet Reporting › Weekly Digest');
  });
});

describe('projectTasksDeep', () => {
  it('returns the project\'s own tasks plus its children\'s, and nothing else', () => {
    const parent = project({ id: 'p', name: 'P' });
    const child = project({ id: 'c', parentId: 'p' });
    const s = {
      projects: [parent, child],
      tasks: [
        task({ id: 'own', projectId: 'p', status: 'ready' }),
        task({ id: 'sub', projectId: 'c', status: 'ready' }),
        task({ id: 'other', projectId: 'x', status: 'ready' }),
        task({ id: 'none', status: 'ready' }),
      ],
    };
    expect(projectTasksDeep(s, 'p').map((t) => t.id).sort()).toEqual(['own', 'sub']);
  });
});

describe('dayLoadRange', () => {
  it('returns an empty map for a range with nothing due', () => {
    expect(dayLoadRange({ tasks: [] }, '2026-07-01', '2026-07-03').size).toBe(0);
  });

  it('marks a day complete once its task is done', () => {
    const tasks = [task({ id: 'a', status: 'done', dueDate: '2026-07-10' })];
    const load = dayLoadRange({ tasks }, '2026-07-10', '2026-07-10').get('2026-07-10')!;
    expect(load).toMatchObject({ total: 1, done: 1, complete: true });
  });

  it('is not complete while a task on the day is still open', () => {
    const tasks = [
      task({ id: 'a', status: 'done', dueDate: '2026-07-10' }),
      task({ id: 'b', status: 'ready', dueDate: '2026-07-10' }),
    ];
    const load = dayLoadRange({ tasks }, '2026-07-10', '2026-07-10').get('2026-07-10')!;
    expect(load).toMatchObject({ total: 2, done: 1, complete: false });
  });

  it('excludes tasks outside the range', () => {
    const tasks = [task({ id: 'a', status: 'done', dueDate: '2026-07-20' })];
    expect(dayLoadRange({ tasks }, '2026-07-01', '2026-07-10').size).toBe(0);
  });
});

describe('notebooks', () => {
  const note = (id: string, folder?: string): Note => ({
    id,
    title: id,
    body: '',
    tags: [],
    folder,
    pinned: false,
    createdAt: '2026-10-28T09:00:00.000Z',
    updatedAt: '2026-10-28T09:00:00.000Z',
  });

  it('lists folders with their subfolders, and groups Evernote notebooks under one entry', () => {
    const notes = [
      note('a', 'Recipes'),
      note('b', 'Recipes/Baking'),
      note('c', 'Ideas'),
      note('d', 'From Evernote/Travel'),
      note('e', 'From Evernote/Travel'),
      note('f', 'From Evernote/Meeting notes'),
      note('g'),
    ];
    expect(notebooks({ notes })).toEqual([
      { path: 'Ideas', count: 1 },
      { path: 'Recipes', count: 2 },
      { path: 'Recipes/Baking', count: 1 },
      { path: 'From Evernote', count: 3 },
      { path: 'From Evernote/Meeting notes', count: 1 },
      { path: 'From Evernote/Travel', count: 2 },
    ]);
  });

  it('is empty when no note has a folder', () => {
    expect(notebooks({ notes: [note('a')] })).toEqual([]);
  });

  it('evernoteImportedOn is the day the From Evernote notes came in', () => {
    const activity: ActivityEvent[] = [
      { id: '1', type: 'note_created', refId: 'd', label: 'd', at: '2026-10-28T10:00:00.000Z' },
      { id: '2', type: 'note_created', refId: 'x', label: 'x', at: '2026-11-01T10:00:00.000Z' },
    ];
    const notes = [note('d', 'From Evernote/Travel'), note('x', 'Ideas')];
    expect(evernoteImportedOn({ notes, activity })).toBe('2026-10-28');
    expect(evernoteImportedOn({ notes: [note('x', 'Ideas')], activity })).toBeUndefined();
  });
});
