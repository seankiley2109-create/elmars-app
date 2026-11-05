import type { VaultDoc } from '@hq/store-fs';
import { isDone, type EntityRef, type ID, type Note, type Project, type Task } from '../types';
import { isTopLevel, parentOf, projectProgressDeep } from '../selectors';

/**
 * Where everything sits on the Map. Pure and deterministic: the same document, filters and size
 * always give the same picture (no clock, no randomness), so the map never shuffles under Elmar.
 *
 * - `me` sits at the centre, a little left of middle, so the loose notes have room on the right.
 * - Top-level projects that are not archived and not done sit on an ellipse around `me`, evenly
 *   spaced clockwise from the top. Subprojects never get a node: their tasks and notes collapse
 *   into their root project's cluster and take its colour.
 * - Each project's tasks and notes fan outward, away from `me`.
 * - Notes in no project sit on an outer arc to the right, a little below the middle (the corner
 *   itself is the detail card's). Only pinned ones and ones in a mention show one by one; the rest
 *   (an Evernote import can bring a hundred) share a single "n more notes" node.
 * - A note whose project id no longer resolves (its project was deleted) counts as in no project:
 *   it floats with the loose notes. A task like that is left off, as tasks in no project are.
 *   A note in a project that still exists but is archived or done stays off with its project.
 * - Dashed "mention" edges come from `related` links whose two ends are both on the map.
 */

export interface MapFilters {
  tasks: boolean;
  notes: boolean;
  someday: boolean;
}

export interface MapSize {
  w: number;
  h: number;
}

export type MapNode = {
  id: string;
  kind: 'me' | 'project' | 'task' | 'note';
  refId?: ID;
  label: string;
  x: number;
  y: number;
  color: string;
  done?: boolean;
  progress?: number;
  someday?: boolean;
  parentId?: string;
  /** Only on the one node that stands for the loose notes nobody mentions: how many it holds. */
  count?: number;
};

export type MapEdge = { from: string; to: string; style: 'hub' | 'kid' | 'mention' };

export const ME_ID = 'me';
/** Someday projects, and a project with no colour of its own. */
export const NEUTRAL_COLOR = '#6B6963';
/** Notes that belong to no project. */
export const LOOSE_COLOR = '#5A5852';
export const ME_COLOR = '#16171A';
/** The one node that stands for every loose note that is neither pinned nor mentioned. */
export const MORE_NOTES_ID = 'notes:more';

const ME_X = 0.42; // × w
const RX = 0.26; // × w
const RY = 0.33; // × h
const KID_RADIUS = 86;
const KID_STEP = 30; // degrees between children on the first ring
const KID_SPAN = 150; // degrees, at most, for one ring of children
/** Below this the first ring is full and further children start a ring further out. */
const KID_MIN_STEP = 18;
const KID_RING_GAP = 30;
/**
 * Loose notes: an arc on the right, beyond the projects' fans and level with or a little below
 * `me` — the free side of the map, since `me` sits left of middle. It stops short of the bottom-right
 * corner, which the detail card covers.
 */
const LOOSE_RX = 0.16; // × w, added to the project ellipse
const LOOSE_RY = 0.1; // × h, added to the project ellipse
const LOOSE_FROM = -14; // degrees, clockwise from 3 o'clock
const LOOSE_TO = 22;
const LOOSE_GAP = 26; // px between loose notes along the arc, and between rows
const LOOSE_MIN_GAP = 10; // how close they may close up when there are very many
const EDGE_PAD = 16;

const STATUS_ORDER: Record<Project['status'], number> = { active: 0, blocked: 1, later: 2, shipped: 3 };

export const nodeId = (type: 'project' | 'task' | 'note', id: ID): string => `${type}:${id}`;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Angular offsets (degrees, around the outward direction) and radii for `n` children. */
function fan(n: number): { r: number; deg: number }[] {
  const out: { r: number; deg: number }[] = [];
  let left = n;
  for (let ring = 0; left > 0; ring++) {
    const r = KID_RADIUS + ring * KID_RING_GAP;
    const scale = KID_RADIUS / r; // keep the same distance between neighbours on outer rings
    const cap = Math.floor(KID_SPAN / (KID_MIN_STEP * scale)) + 1;
    const k = Math.min(left, cap);
    const span = k > 1 ? Math.min(KID_SPAN, (k - 1) * KID_STEP * scale) : 0;
    for (let i = 0; i < k; i++) out.push({ r, deg: k > 1 ? -span / 2 + (i * span) / (k - 1) : 0 });
    left -= k;
  }
  return out;
}

/** Onboarding stores "there" ("Hi there") when he gives no name; neither that nor blank is a name. */
function meName(stored: string): string {
  const name = stored.trim();
  return name && name.toLowerCase() !== 'there' ? name : 'You';
}

/** The parts of the document the map reads; a whole `VaultDoc` will do. */
export type MapDoc = Pick<VaultDoc, 'settings' | 'projects' | 'tasks' | 'notes' | 'links'>;

export function layoutMap(
  doc: MapDoc,
  filters: MapFilters,
  size: MapSize,
): { nodes: MapNode[]; edges: MapEdge[] } {
  const { w, h } = size;
  const padX = Math.min(EDGE_PAD, w / 2);
  const padY = Math.min(EDGE_PAD, h / 2);
  const clamp = (x: number, y: number) => ({
    x: Math.min(Math.max(x, padX), w - padX),
    y: Math.min(Math.max(y, padY), h - padY),
  });

  const cx = ME_X * w;
  const cy = h / 2;
  const rx = RX * w;
  const ry = RY * h;

  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];

  nodes.push({ id: ME_ID, kind: 'me', label: meName(doc.settings.userName), ...clamp(cx, cy), color: ME_COLOR });

  // ---- projects on the ellipse ----
  const shown = doc.projects
    .filter(
      (p) =>
        !p.archived &&
        p.status !== 'shipped' &&
        (filters.someday || p.status !== 'later') &&
        isTopLevel(doc, p),
    )
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]); // stable: doc order within a status
  const shownIds = new Set(shown.map((p) => p.id));
  const projectNode = new Map<ID, MapNode>();
  const outward = new Map<ID, number>();

  shown.forEach((p, i) => {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / shown.length;
    const pos = clamp(cx + rx * Math.cos(theta), cy + ry * Math.sin(theta));
    const { done, total } = projectProgressDeep(doc, p.id);
    const someday = p.status === 'later';
    const n: MapNode = {
      id: nodeId('project', p.id),
      kind: 'project',
      refId: p.id,
      label: p.name,
      ...pos,
      color: someday ? NEUTRAL_COLOR : (p.color ?? NEUTRAL_COLOR),
      progress: total ? done / total : 0,
      someday,
    };
    nodes.push(n);
    projectNode.set(p.id, n);
    outward.set(p.id, Math.atan2(pos.y - cy, pos.x - cx) || theta);
    edges.push({ from: ME_ID, to: n.id, style: 'hub' });
  });

  // ---- which cluster a project id belongs to: its root, when every step up is unarchived ----
  const byId = new Map(doc.projects.map((p) => [p.id, p]));
  const clusterCache = new Map<ID, ID | undefined>();
  const clusterOf = (projectId: ID | undefined): ID | undefined => {
    if (!projectId) return undefined;
    if (clusterCache.has(projectId)) return clusterCache.get(projectId);
    let cur: Project | undefined = byId.get(projectId);
    let result: ID | undefined;
    const seen = new Set<ID>();
    while (cur && !cur.archived && !seen.has(cur.id)) {
      seen.add(cur.id);
      const parent = parentOf(doc, cur);
      if (!parent) {
        result = shownIds.has(cur.id) ? cur.id : undefined;
        break;
      }
      cur = parent;
    }
    clusterCache.set(projectId, result);
    return result;
  };

  // ---- each cluster's children, fanned outward ----
  type Kid = { kind: 'task'; t: Task } | { kind: 'note'; n: Note };
  const kidsOf = new Map<ID, Kid[]>(shown.map((p) => [p.id, []]));
  if (filters.tasks) {
    for (const t of doc.tasks) {
      const c = clusterOf(t.projectId);
      if (c && !isDone(t)) kidsOf.get(c)!.push({ kind: 'task', t });
    }
  }
  if (filters.notes) {
    for (const n of doc.notes) {
      const c = clusterOf(n.projectId);
      if (c) kidsOf.get(c)!.push({ kind: 'note', n });
    }
  }
  if (filters.tasks) {
    // done tasks last, so on a crowded project the open work keeps the inner ring
    for (const t of doc.tasks) {
      const c = clusterOf(t.projectId);
      if (c && isDone(t)) kidsOf.get(c)!.push({ kind: 'task', t });
    }
  }

  for (const p of shown) {
    const parent = projectNode.get(p.id)!;
    const kids = kidsOf.get(p.id)!;
    const out = outward.get(p.id)!;
    fan(kids.length).forEach(({ r, deg }, i) => {
      const a = out + rad(deg);
      const pos = clamp(parent.x + r * Math.cos(a), parent.y + r * Math.sin(a));
      const k = kids[i];
      const n: MapNode =
        k.kind === 'task'
          ? { id: nodeId('task', k.t.id), kind: 'task', refId: k.t.id, label: k.t.title, ...pos, color: parent.color, done: isDone(k.t), parentId: parent.id }
          : { id: nodeId('note', k.n.id), kind: 'note', refId: k.n.id, label: k.n.title, ...pos, color: parent.color, parentId: parent.id };
      nodes.push(n);
      edges.push({ from: parent.id, to: n.id, style: 'kid' });
    });
  }

  // ---- notes in no project: an arc on the right, below the middle; more rows when crowded ----
  if (filters.notes) {
    // in no project, or in one that no longer exists (deleting a project leaves its notes' ids behind)
    const loose = doc.notes.filter((n) => !n.projectId || !byId.has(n.projectId));
    const looseIds = new Set(loose.map((n) => n.id));
    // a note "in a mention" when a related link joins it to something else that is on the map
    const onMapSoFar = new Set(nodes.map((n) => n.id));
    const endOnMap = (ref: EntityRef): boolean => {
      if (ref.type === 'project') return clusterOf(ref.id) !== undefined;
      if (ref.type === 'task') return onMapSoFar.has(nodeId('task', ref.id));
      if (ref.type === 'note') return onMapSoFar.has(nodeId('note', ref.id)) || looseIds.has(ref.id);
      return false;
    };
    const linked = new Set<ID>();
    for (const l of doc.links) {
      if (l.kind !== 'related' || (l.from.type === l.to.type && l.from.id === l.to.id)) continue;
      if (l.from.type === 'note' && looseIds.has(l.from.id) && endOnMap(l.to)) linked.add(l.from.id);
      if (l.to.type === 'note' && looseIds.has(l.to.id) && endOnMap(l.from)) linked.add(l.to.id);
    }
    const shownLoose = loose.filter((n) => n.pinned || linked.has(n.id));
    const rest = loose.length - shownLoose.length;
    // most relevant first along the arc: linked, then pinned, then most recently edited
    const order: (Note | 'more')[] = [...shownLoose].sort(
      (a, b) =>
        Number(linked.has(b.id)) - Number(linked.has(a.id)) ||
        Number(b.pinned) - Number(a.pinned) ||
        (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    // a lone unmentioned note shows as itself; two or more share one node, last on the arc
    if (rest === 1) order.push(loose.find((n) => !n.pinned && !linked.has(n.id))!);
    else if (rest > 1) order.push('more');
    // Rows: the first arc, then arcs further in (while they stay clear of the fans), then further
    // out (while they stay on the map). When even that is not enough room, the notes close up
    // along each row rather than piling against the edge.
    const arx0 = rx + LOOSE_RX * w;
    const ary0 = ry + LOOSE_RY * h;
    const sweep = rad(LOOSE_TO - LOOSE_FROM);
    const inward = Math.max(0, Math.floor((arx0 - (rx + KID_RADIUS + 44)) / LOOSE_GAP));
    const outward = Math.max(0, Math.floor((w - EDGE_PAD - cx - arx0) / LOOSE_GAP));
    const rows: { arx: number; ary: number; length: number }[] = [];
    for (let row = 0; row <= inward + outward; row++) {
      const off = (row <= inward ? -row : row - inward) * LOOSE_GAP;
      const arx = arx0 + off;
      const ary = ary0 + off;
      rows.push({ arx, ary, length: sweep * Math.sqrt((arx * arx + ary * ary) / 2) });
    }
    const total = rows.reduce((sum, r) => sum + r.length, 0);
    const gap = Math.min(LOOSE_GAP, Math.max(LOOSE_MIN_GAP, total / Math.max(1, order.length)));
    let placed = 0;
    rows.forEach(({ arx, ary, length }, row) => {
      if (placed >= order.length) return;
      const meanR = length / sweep;
      const cap = Math.max(1, Math.floor(length / gap) + 1);
      // the last row takes whatever is left, however tight
      const k = row === rows.length - 1 ? order.length - placed : Math.min(cap, order.length - placed);
      // a short row sits in the middle of the arc, a little apart; a full one spans all of it
      const step = k > 1 ? Math.min(sweep / (k - 1), (2 * LOOSE_GAP) / meanR) : 0;
      const start = rad((LOOSE_FROM + LOOSE_TO) / 2) - ((k - 1) * step) / 2;
      for (let i = 0; i < k; i++) {
        const a = start + i * step;
        const item = order[placed + i];
        const pos = clamp(cx + arx * Math.cos(a), cy + ary * Math.sin(a));
        nodes.push(
          item === 'more'
            ? { id: MORE_NOTES_ID, kind: 'note', label: `${rest} more notes`, ...pos, color: LOOSE_COLOR, count: rest }
            : { id: nodeId('note', item.id), kind: 'note', refId: item.id, label: item.title, ...pos, color: LOOSE_COLOR },
        );
      }
      placed += k;
    });
  }

  // ---- mentions: related links between two things on the map ----
  const onMap = new Set(nodes.map((n) => n.id));
  const kidPairs = new Set(edges.filter((e) => e.style === 'kid').map((e) => `${e.from}|${e.to}`));
  const resolve = (ref: EntityRef): string | undefined => {
    if (ref.type === 'project') {
      const c = clusterOf(ref.id);
      return c ? nodeId('project', c) : undefined;
    }
    if (ref.type === 'task' || ref.type === 'note') {
      const id = nodeId(ref.type, ref.id);
      return onMap.has(id) ? id : undefined;
    }
    return undefined;
  };
  const seenPairs = new Set<string>();
  for (const l of doc.links) {
    if (l.kind !== 'related') continue;
    const from = resolve(l.from);
    const to = resolve(l.to);
    if (!from || !to || from === to) continue;
    const pair = from < to ? `${from}|${to}` : `${to}|${from}`;
    if (seenPairs.has(pair) || kidPairs.has(`${from}|${to}`) || kidPairs.has(`${to}|${from}`)) continue;
    seenPairs.add(pair);
    edges.push({ from, to, style: 'mention' });
  }

  return { nodes, edges };
}
