import { describe, expect, it } from 'vitest';
import { fullFixture, type VaultDoc } from '@hq/store-fs';
import type { Note, Project, Task } from '../types';
import { MORE_NOTES_ID, layoutMap, type MapEdge, type MapNode } from './map-layout';

const ALL = { tasks: true, notes: true, someday: true };
const SIZE = { w: 1120, h: 760 };

const STAMP = '2026-10-01T00:00:00.000Z';

function project(id: string, over: Partial<Project> = {}): Project {
  return { id, name: id, status: 'active', tags: [], links: [], archived: false, createdAt: STAMP, updatedAt: STAMP, ...over };
}
function task(id: string, projectId?: string, over: Partial<Task> = {}): Task {
  return { id, title: id, projectId, priority: 'medium', focus: false, status: 'ready', createdAt: STAMP, ...over };
}
function note(id: string, projectId?: string, over: Partial<Note> = {}): Note {
  return { id, title: id, body: '', tags: [], projectId, pinned: false, createdAt: STAMP, updatedAt: STAMP, ...over };
}

/** The fixture, plus a someday project with children and a subproject with its own task and note. */
function doc(): VaultDoc {
  const d = fullFixture();
  d.tasks.push(task('tsk_later', 'prj_e'), task('tsk_sub', 'prj_child', { status: 'done' }));
  d.notes.push(note('nte_later', 'prj_e'), note('nte_sub', 'prj_child'));
  return d;
}

const byKind = (nodes: MapNode[], kind: MapNode['kind']) => nodes.filter((n) => n.kind === kind);
const node = (nodes: MapNode[], refId: string) => nodes.find((n) => n.refId === refId);
const hasEdge = (edges: MapEdge[], from: string, to: string, style: MapEdge['style']) =>
  edges.some((e) => e.style === style && ((e.from === from && e.to === to) || (e.from === to && e.to === from)));

describe('layoutMap', () => {
  it('puts me at the centre, slightly left of middle', () => {
    const { nodes } = layoutMap(doc(), ALL, SIZE);
    const me = nodes.find((n) => n.kind === 'me')!;
    expect(me.x).toBeCloseTo(0.42 * SIZE.w);
    expect(me.y).toBeCloseTo(SIZE.h / 2);
  });

  it('shows top-level, unarchived projects that are not done, each joined to me', () => {
    const { nodes, edges } = layoutMap(doc(), ALL, SIZE);
    const ids = byKind(nodes, 'project').map((n) => n.refId).sort();
    // prj_b archived, prj_c shipped, prj_child a subproject; prj_orphan's parent is missing so it is top-level
    expect(ids).toEqual(['prj_a', 'prj_d', 'prj_e', 'prj_f', 'prj_orphan']);
    const me = nodes.find((n) => n.kind === 'me')!;
    for (const p of byKind(nodes, 'project')) expect(hasEdge(edges, me.id, p.id, 'hub')).toBe(true);
  });

  it('places projects on the ellipse, evenly spaced from the top', () => {
    const { nodes } = layoutMap(doc(), ALL, SIZE);
    const me = nodes.find((n) => n.kind === 'me')!;
    const projects = byKind(nodes, 'project');
    const first = projects[0];
    expect(first.x).toBeCloseTo(me.x);
    expect(first.y).toBeCloseTo(me.y - 0.33 * SIZE.h);
    for (const p of projects) {
      const u = (p.x - me.x) / (0.26 * SIZE.w);
      const v = (p.y - me.y) / (0.33 * SIZE.h);
      expect(u * u + v * v).toBeCloseTo(1);
    }
  });

  it('gives every visible task and note a kid edge to its project', () => {
    const { nodes, edges } = layoutMap(doc(), ALL, SIZE);
    const kids = nodes.filter((n) => (n.kind === 'task' || n.kind === 'note') && n.parentId);
    expect(kids.length).toBeGreaterThan(0);
    for (const k of kids) {
      const parent = nodes.find((n) => n.id === k.parentId);
      expect(parent?.kind).toBe('project');
      expect(hasEdge(edges, k.parentId!, k.id, 'kid')).toBe(true);
    }
    // every project task in the fixture that belongs to a shown project is on the map
    expect(node(nodes, 'tsk_a')?.parentId).toBe(node(nodes, 'prj_a')?.id);
    expect(node(nodes, 'tsk_i')?.parentId).toBe(node(nodes, 'prj_d')?.id);
  });

  it("collapses a subproject's tasks and notes into its root project's cluster, in the root's colour", () => {
    const { nodes } = layoutMap(doc(), ALL, SIZE);
    const root = node(nodes, 'prj_a')!;
    expect(node(nodes, 'prj_child')).toBeUndefined();
    for (const id of ['tsk_sub', 'nte_sub']) {
      expect(node(nodes, id)?.parentId).toBe(root.id);
      expect(node(nodes, id)?.color).toBe('#C21E62');
    }
    expect(root.color).toBe('#C21E62');
  });

  it('fans children outward at radius 86, 30° apart', () => {
    const { nodes } = layoutMap(doc(), ALL, SIZE);
    const p = node(nodes, 'prj_d')!; // two children: tsk_i, nte_braai
    const kids = nodes.filter((n) => n.parentId === p.id);
    expect(kids).toHaveLength(2);
    for (const k of kids) expect(Math.hypot(k.x - p.x, k.y - p.y)).toBeCloseTo(86);
    const [a, b] = kids.map((k) => Math.atan2(k.y - p.y, k.x - p.x));
    let diff = Math.abs(a - b);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    expect((diff * 180) / Math.PI).toBeCloseTo(30);
  });

  it('marks done tasks, someday projects and project progress', () => {
    const { nodes } = layoutMap(doc(), ALL, SIZE);
    expect(node(nodes, 'tsk_f')?.done).toBe(true);
    expect(node(nodes, 'tsk_a')?.done).toBe(false);
    expect(node(nodes, 'prj_e')?.someday).toBe(true);
    expect(node(nodes, 'prj_a')?.someday).toBeFalsy();
    // prj_a: tsk_a, tsk_f (done), tsk_h, plus the subproject's tsk_sub (done) → 2 of 4
    expect(node(nodes, 'prj_a')?.progress).toBeCloseTo(0.5);
  });

  it('someday: false removes later projects and their children', () => {
    const { nodes, edges } = layoutMap(doc(), { ...ALL, someday: false }, SIZE);
    expect(byKind(nodes, 'project').some((n) => n.someday)).toBe(false);
    for (const id of ['prj_e', 'prj_orphan', 'tsk_later', 'nte_later']) expect(node(nodes, id)).toBeUndefined();
    const ids = new Set(nodes.map((n) => n.id));
    for (const e of edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
  });

  it('a project-less note has no kid edge, and a mention edge when linked', () => {
    const d = doc();
    d.links.push({ id: 'lnk_m', from: { type: 'note', id: 'nte_trips' }, to: { type: 'project', id: 'prj_f' }, kind: 'related' });
    const { nodes, edges } = layoutMap(d, ALL, SIZE);
    const loose = node(nodes, 'nte_trips')!;
    expect(loose.parentId).toBeUndefined();
    expect(edges.some((e) => e.style === 'kid' && (e.from === loose.id || e.to === loose.id))).toBe(false);
    expect(hasEdge(edges, loose.id, node(nodes, 'prj_f')!.id, 'mention')).toBe(true);
  });

  it('loose notes sit on the right, beyond the projects, clear of the detail card', () => {
    const { nodes } = layoutMap(doc(), ALL, SIZE);
    const me = nodes.find((n) => n.kind === 'me')!;
    const loose = byKind(nodes, 'note').filter((n) => !n.parentId);
    // the fixture's three loose notes are neither pinned nor mentioned: one shared node
    expect(loose.map((n) => n.id)).toEqual([MORE_NOTES_ID]);
    for (const n of loose) {
      expect(n.x).toBeGreaterThan(me.x + 0.26 * SIZE.w + 86); // past the right-hand project's fan
      expect(n.y).toBeGreaterThan(me.y - 0.33 * SIZE.h * 0.5);
      // the card covers the bottom-right corner: 268 wide, up to ~210 tall, 16 in from the edges
      expect(n.x > SIZE.w - 300 && n.y > SIZE.h - 240).toBe(false);
    }
  });

  it('mention edges only join nodes on the map, and only related links', () => {
    const d = doc();
    d.links.push(
      { id: 'lnk_n', from: { type: 'note', id: 'nte_trips' }, to: { type: 'note', id: 'nte_plans' }, kind: 'related' },
      { id: 'lnk_x', from: { type: 'note', id: 'nte_trips' }, to: { type: 'project', id: 'prj_c' }, kind: 'related' },
      { id: 'lnk_y', from: { type: 'note', id: 'nte_trips' }, to: { type: 'project', id: 'prj_d' }, kind: 'blocks' },
    );
    const { nodes, edges } = layoutMap(d, ALL, SIZE);
    const ids = new Set(nodes.map((n) => n.id));
    const mentions = edges.filter((e) => e.style === 'mention');
    for (const e of mentions) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
    expect(hasEdge(edges, node(nodes, 'nte_trips')!.id, node(nodes, 'nte_plans')!.id, 'mention')).toBe(true);
    expect(hasEdge(edges, node(nodes, 'nte_trips')!.id, node(nodes, 'prj_d')!.id, 'mention')).toBe(false);
    // the fixture's note ↔ asset link has no asset on the map
    expect(mentions.some((e) => e.to.includes('ast_') || e.from.includes('ast_'))).toBe(false);
  });

  it('a mention of a subproject lands on its root project', () => {
    const d = doc();
    d.links.push({ id: 'lnk_s', from: { type: 'note', id: 'nte_trips' }, to: { type: 'project', id: 'prj_child' }, kind: 'related' });
    const { nodes, edges } = layoutMap(d, ALL, SIZE);
    expect(hasEdge(edges, node(nodes, 'nte_trips')!.id, node(nodes, 'prj_a')!.id, 'mention')).toBe(true);
  });

  it('tasks: false removes all task nodes', () => {
    const { nodes } = layoutMap(doc(), { ...ALL, tasks: false }, SIZE);
    expect(byKind(nodes, 'task')).toEqual([]);
    expect(byKind(nodes, 'note').length).toBeGreaterThan(0);
  });

  it('notes: false removes all note nodes', () => {
    const { nodes } = layoutMap(doc(), { ...ALL, notes: false }, SIZE);
    expect(byKind(nodes, 'note')).toEqual([]);
    expect(byKind(nodes, 'task').length).toBeGreaterThan(0);
  });

  it('with 12 projects, no two project nodes are closer than 110 px', () => {
    const d = doc();
    d.projects = Array.from({ length: 12 }, (_, i) => project(`p${i}`, { color: '#3A4FB0' }));
    const { nodes } = layoutMap(d, ALL, SIZE);
    const projects = byKind(nodes, 'project');
    expect(projects).toHaveLength(12);
    for (let i = 0; i < projects.length; i++)
      for (let j = i + 1; j < projects.length; j++)
        expect(Math.hypot(projects[i].x - projects[j].x, projects[i].y - projects[j].y)).toBeGreaterThanOrEqual(110);
  });

  it('every node lies within size, even when crowded', () => {
    const d = doc();
    d.projects = Array.from({ length: 12 }, (_, i) => project(`p${i}`, { color: '#3A4FB0' }));
    d.tasks = d.projects.flatMap((p) => Array.from({ length: 40 }, (_, i) => task(`${p.id}_t${i}`, p.id, { status: i % 3 ? 'ready' : 'done' })));
    // pinned, so each one shows and the arc really is crowded
    d.notes = Array.from({ length: 120 }, (_, i) => note(`loose${i}`, undefined, { pinned: true }));
    for (const size of [SIZE, { w: 640, h: 420 }, { w: 1600, h: 1000 }]) {
      const { nodes } = layoutMap(d, ALL, size);
      for (const n of nodes) {
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.x).toBeLessThanOrEqual(size.w);
        expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.y).toBeLessThanOrEqual(size.h);
      }
    }
    const { nodes } = layoutMap(doc(), ALL, SIZE);
    for (const n of nodes) {
      expect(n.x >= 0 && n.x <= SIZE.w && n.y >= 0 && n.y <= SIZE.h).toBe(true);
    }
  });

  describe('notes in no project', () => {
    const many = (d: VaultDoc, n: number) => {
      for (let i = 0; i < n; i++) d.notes.push(note(`imp${i}`, undefined, { folder: 'From Evernote' }));
    };

    it('the unpinned, unmentioned ones share one "n more notes" node', () => {
      const d = doc();
      many(d, 100);
      const { nodes, edges } = layoutMap(d, ALL, SIZE);
      const more = nodes.filter((n) => n.id === MORE_NOTES_ID);
      expect(more).toHaveLength(1);
      // 100 imported + the fixture's three
      expect(more[0]).toMatchObject({ kind: 'note', label: '103 more notes', count: 103 });
      expect(more[0].refId).toBeUndefined();
      expect(nodes.some((n) => n.refId?.startsWith('imp'))).toBe(false);
      expect(edges.some((e) => e.from === MORE_NOTES_ID || e.to === MORE_NOTES_ID)).toBe(false);
    });

    it('pinned and mentioned ones still show one by one', () => {
      const d = doc();
      many(d, 100);
      d.notes.push(note('nte_pin', undefined, { pinned: true }));
      d.links.push(
        { id: 'lnk_m1', from: { type: 'note', id: 'imp7' }, to: { type: 'project', id: 'prj_f' }, kind: 'related' },
        { id: 'lnk_m2', from: { type: 'note', id: 'nte_plans' }, to: { type: 'note', id: 'imp8' }, kind: 'related' },
      );
      const { nodes, edges } = layoutMap(d, ALL, SIZE);
      for (const id of ['nte_pin', 'imp7', 'imp8']) {
        expect(node(nodes, id)).toBeDefined();
        expect(node(nodes, id)?.parentId).toBeUndefined();
      }
      expect(hasEdge(edges, node(nodes, 'imp8')!.id, node(nodes, 'nte_plans')!.id, 'mention')).toBe(true);
      expect(nodes.find((n) => n.id === MORE_NOTES_ID)?.count).toBe(101);
    });

    it('a link to something not on the map does not count as a mention', () => {
      const d = doc();
      d.links.push({ id: 'lnk_gone', from: { type: 'note', id: 'nte_trips' }, to: { type: 'project', id: 'prj_c' }, kind: 'related' });
      const { nodes } = layoutMap(d, ALL, SIZE);
      expect(node(nodes, 'nte_trips')).toBeUndefined();
      expect(nodes.find((n) => n.id === MORE_NOTES_ID)?.count).toBe(3);
    });

    it('a single unmentioned note shows as itself', () => {
      const d = doc();
      d.notes = d.notes.filter((n) => n.id !== 'nte_untitled_1' && n.id !== 'nte_untitled_2');
      const { nodes } = layoutMap(d, ALL, SIZE);
      expect(node(nodes, 'nte_trips')).toBeDefined();
      expect(nodes.find((n) => n.id === MORE_NOTES_ID)).toBeUndefined();
    });
  });

  it('calls me "You" when no name was given', () => {
    for (const userName of ['', '  ', 'there', 'There']) {
      const d = doc();
      d.settings = { ...d.settings, userName };
      expect(layoutMap(d, ALL, SIZE).nodes.find((n) => n.kind === 'me')?.label).toBe('You');
    }
  });

  it('a note whose project no longer exists floats as a loose note; such a task is left off', () => {
    const d = doc();
    d.tasks.push(task('tsk_dangling', 'prj_deleted'));
    d.notes.push(
      note('nte_dangling_pinned', 'prj_deleted', { pinned: true }),
      note('nte_dangling_plain', 'prj_deleted'),
    );
    const { nodes, edges } = layoutMap(d, ALL, SIZE);
    expect(node(nodes, 'tsk_dangling')).toBeUndefined();
    // pinned: on its own, with no kid edge
    const pinned = node(nodes, 'nte_dangling_pinned')!;
    expect(pinned.parentId).toBeUndefined();
    expect(edges.some((e) => e.style === 'kid' && e.to === pinned.id)).toBe(false);
    // unpinned and unmentioned: inside "n more notes", with the fixture's three
    expect(node(nodes, 'nte_dangling_plain')).toBeUndefined();
    expect(nodes.find((n) => n.id === MORE_NOTES_ID)?.count).toBe(4);
  });

  it('a note in an archived project stays off the map (its project still exists)', () => {
    const d = doc();
    d.notes.push(note('nte_archived', 'prj_b', { pinned: true }));
    const { nodes } = layoutMap(d, ALL, SIZE);
    expect(node(nodes, 'nte_archived')).toBeUndefined();
    expect(nodes.find((n) => n.id === MORE_NOTES_ID)?.count).toBe(3);
  });

  describe('edge cases', () => {
    it('no projects: just me and the notes, no hub lines', () => {
      const d = doc();
      d.projects = [];
      d.notes.push(note('nte_pin', undefined, { pinned: true }));
      const { nodes, edges } = layoutMap(d, ALL, SIZE);
      expect(byKind(nodes, 'project')).toEqual([]);
      expect(byKind(nodes, 'task')).toEqual([]);
      expect(edges.filter((e) => e.style !== 'mention')).toEqual([]);
      expect(node(nodes, 'nte_pin')).toBeDefined();
    });

    it('one project sits at the top', () => {
      const d = doc();
      d.projects = [project('solo', { color: '#3A4FB0' })];
      d.tasks = [task('t1', 'solo')];
      const { nodes } = layoutMap(d, ALL, SIZE);
      const me = nodes.find((n) => n.kind === 'me')!;
      const solo = node(nodes, 'solo')!;
      expect(solo.x).toBeCloseTo(me.x);
      expect(solo.y).toBeCloseTo(me.y - 0.33 * SIZE.h);
      expect(node(nodes, 't1')!.y).toBeLessThan(solo.y); // fans outward: up
    });

    it('subprojects three and more deep still collapse into the root', () => {
      const d = doc();
      d.projects = [
        project('root', { color: '#3A4FB0' }),
        project('l1', { parentId: 'root' }),
        project('l2', { parentId: 'l1' }),
        project('l3', { parentId: 'l2' }),
        project('l4', { parentId: 'l3', archived: true }),
      ];
      d.tasks = [task('deep', 'l3'), task('under_archived', 'l4')];
      d.notes = [note('deep_note', 'l2')];
      const { nodes } = layoutMap(d, ALL, SIZE);
      expect(byKind(nodes, 'project').map((n) => n.refId)).toEqual(['root']);
      expect(node(nodes, 'deep')?.parentId).toBe(node(nodes, 'root')!.id);
      expect(node(nodes, 'deep')?.color).toBe('#3A4FB0');
      expect(node(nodes, 'deep_note')?.parentId).toBe(node(nodes, 'root')!.id);
      expect(node(nodes, 'under_archived')).toBeUndefined();
    });

    it('a parent cycle neither hangs nor loses its projects', () => {
      const d = doc();
      d.projects = [project('a', { parentId: 'b' }), project('b', { parentId: 'c' }), project('c', { parentId: 'a' })];
      d.tasks = [task('ta', 'a'), task('tc', 'c')];
      const { nodes, edges } = layoutMap(d, ALL, SIZE);
      // every member of a cycle renders top-level (isTopLevel), each with its own tasks
      expect(byKind(nodes, 'project').map((n) => n.refId).sort()).toEqual(['a', 'b', 'c']);
      expect(hasEdge(edges, node(nodes, 'a')!.id, node(nodes, 'ta')!.id, 'kid')).toBe(true);
      expect(hasEdge(edges, node(nodes, 'c')!.id, node(nodes, 'tc')!.id, 'kid')).toBe(true);
    });
  });

  it('is deterministic, and node ids are unique', () => {
    const a = layoutMap(doc(), ALL, SIZE);
    const b = layoutMap(doc(), ALL, SIZE);
    expect(a).toEqual(b);
    expect(new Set(a.nodes.map((n) => n.id)).size).toBe(a.nodes.length);
  });
});
