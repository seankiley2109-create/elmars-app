import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { useHQ } from '../store';
import { usePersistentState } from '../lib/use-persistent-state';
import { EmptyState } from '../components/ui';
import MapDetail from '../components/MapDetail';
import { STATUS_LABEL } from '../types';
import { projectProgressDeep } from '../selectors';
import { ME_ID, MORE_NOTES_ID, layoutMap, type MapFilters, type MapNode, type MapSize } from '../lib/map-layout';

/** Until the map has measured itself (and in tests, where nothing has a size): the mockup's map. */
const DEFAULT_SIZE: MapSize = { w: 1120, h: 760 };
const DEFAULT_SHOW: MapFilters = { tasks: true, notes: true, someday: true };
const CHIPS: { key: keyof MapFilters; label: string }[] = [
  { key: 'tasks', label: 'Tasks' },
  { key: 'notes', label: 'Notes' },
  { key: 'someday', label: 'Someday' },
];
/** Past this many notes in no project, their names show only when one is selected or hovered. */
const LOOSE_LABELS_MAX = 10;

const TRACK = '#E9E6DF';
const EDGE = { hub: '#D0CCC3', kid: '#DAD7CF', on: '#878379', mention: '#878379' };
const SELECTED_RING = '0 0 0 3px #FFFFFF, 0 0 0 5px #16171A';
const EASE = 'opacity 150ms cubic-bezier(.2,.8,.2,1)';

type LabelSide = 'mid' | 'r' | 'l' | 't' | 'b';
const LABEL_SHIFT: Record<LabelSide, string> = {
  mid: 'translate(-50%,-50%)',
  r: 'translate(0,-50%)',
  l: 'translate(-100%,-50%)',
  t: 'translate(-50%,-100%)',
  b: 'translate(-50%,0)',
};

const NODE_BOX: Record<MapNode['kind'], number> = { me: 80, project: 70, task: 30, note: 30 };

function useElementSize(ref: React.RefObject<HTMLElement | null>): MapSize {
  const [size, setSize] = useState<MapSize>(DEFAULT_SIZE);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      // nothing measured (hidden, or a test DOM): keep the last real size
      if (w > 0 && h > 0) setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export default function MapView() {
  const settings = useHQ((s) => s.settings);
  const projects = useHQ((s) => s.projects);
  const tasks = useHQ((s) => s.tasks);
  const notes = useHQ((s) => s.notes);
  const links = useHQ((s) => s.links);

  const [savedShow, setShow] = usePersistentState<Partial<MapFilters>>('map.show', DEFAULT_SHOW);
  // only the three chips that exist; anything else a saved preference carries is ignored
  const saved = savedShow && typeof savedShow === 'object' ? savedShow : {};
  const tasksOn = saved.tasks ?? DEFAULT_SHOW.tasks;
  const notesOn = saved.notes ?? DEFAULT_SHOW.notes;
  const somedayOn = saved.someday ?? DEFAULT_SHOW.someday;
  const show: MapFilters = { tasks: tasksOn, notes: notesOn, someday: somedayOn };

  const [view, setView] = usePersistentState('map.view', { x: 0, y: 0, scale: 1 });
  const [selected, setSelected] = useState<string>(ME_ID);
  const [hovered, setHovered] = useState<string | null>(null);
  const dragging = useRef<{ startX: number; startY: number; ox: number; oy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(wrapRef);

  const { nodes, edges } = useMemo(
    () =>
      layoutMap(
        { settings, projects, tasks, notes, links },
        { tasks: tasksOn, notes: notesOn, someday: somedayOn },
        size,
      ),
    [settings, projects, tasks, notes, links, tasksOn, notesOn, somedayOn, size],
  );
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const progress = useMemo(() => {
    const m = new Map<string, { done: number; total: number }>();
    for (const n of nodes) if (n.kind === 'project' && n.refId) m.set(n.id, projectProgressDeep({ projects, tasks }, n.refId));
    return m;
  }, [nodes, projects, tasks]);
  const statusOf = useMemo(() => new Map(projects.map((p) => [p.id, p.status])), [projects]);

  // a selection a filter has just hidden falls back to the whole picture
  const sel = byId.get(selected) ?? byId.get(ME_ID)!;
  const active = sel.kind === 'project' ? sel.id : sel.parentId;
  const me = byId.get(ME_ID)!;
  const looseCount = nodes.filter((n) => n.kind === 'note' && !n.parentId).length;

  // ---- keyboard: one tab stop for the whole picture (roving), arrows move between nodes ----
  const [cursor, setCursor] = useState<string | null>(null);
  const tabStop = cursor && byId.has(cursor) ? cursor : sel.id;
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  // me, then each project followed by its own children, then the loose notes
  const keyOrder = useMemo(() => {
    const order: string[] = [];
    for (const n of nodes) {
      if (n.kind === 'me' || n.kind === 'project') order.push(n.id);
      if (n.kind === 'project') for (const k of nodes) if (k.parentId === n.id) order.push(k.id);
    }
    for (const n of nodes) if (n.kind !== 'me' && n.kind !== 'project' && !n.parentId) order.push(n.id);
    return order;
  }, [nodes]);
  const onNodeKey = (e: React.KeyboardEvent, id: string) => {
    const i = keyOrder.indexOf(id);
    let next: string | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = keyOrder[(i + 1) % keyOrder.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = keyOrder[(i - 1 + keyOrder.length) % keyOrder.length];
    else if (e.key === 'Home') next = keyOrder[0];
    else if (e.key === 'End') next = keyOrder[keyOrder.length - 1];
    if (!next) return;
    e.preventDefault();
    setCursor(next);
    buttons.current.get(next)?.focus({ preventScroll: true });
  };

  // A focused node off screen is panned into view. The wrapper never scrolls: it clips, and any
  // scroll the browser still manages (focus, find-in-page) is undone, so the node layer and the
  // controls cannot drift apart.
  const FOCUS_MARGIN = 48;
  const revealNode = (n: MapNode) =>
    setView((v) => {
      const sx = (n.x - size.w / 2) * v.scale + size.w / 2 + v.x;
      const sy = (n.y - size.h / 2) * v.scale + size.h / 2 + v.y;
      const dx = sx < FOCUS_MARGIN ? FOCUS_MARGIN - sx : sx > size.w - FOCUS_MARGIN ? size.w - FOCUS_MARGIN - sx : 0;
      const dy = sy < FOCUS_MARGIN ? FOCUS_MARGIN - sy : sy > size.h - FOCUS_MARGIN ? size.h - FOCUS_MARGIN - sy : 0;
      return dx || dy ? { ...v, x: v.x + dx, y: v.y + dy } : v;
    });
  // Only keyboard focus pans: a click focuses the node too, and the map must not jump under the mouse.
  const pointerFocus = useRef(false);
  const unscroll = () => {
    const el = wrapRef.current;
    if (el && (el.scrollLeft || el.scrollTop)) {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    }
  };

  // ---- pan and zoom, as in HQ ----
  const clampScale = (s: number) => Math.min(2.5, Math.max(0.4, s));
  const zoom = (dir: number) => setView((v) => ({ ...v, scale: clampScale(v.scale * (dir > 0 ? 1.2 : 1 / 1.2)) }));
  const fit = () => setView({ x: 0, y: 0, scale: 1 });

  const onWheel = (e: React.WheelEvent) => zoom(e.deltaY < 0 ? 1 : -1);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    suppressClick.current = false;
    dragging.current = { startX: e.clientX, startY: e.clientY, ox: view.x, oy: view.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragging.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      d.moved = true;
      // captured only once it is really a drag, so a plain click still reaches the node under it
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }
    if (d.moved) setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
  };
  const onPointerUp = () => {
    if (dragging.current?.moved) {
      // swallow the click that ends a drag, and only that one (a later Enter on a node still picks)
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 0);
    }
    dragging.current = null;
  };
  const pick = (id: string) => {
    if (suppressClick.current) return;
    setSelected(id);
  };

  if (projects.every((p) => p.archived) && notes.length === 0) {
    return (
      <div className="flex flex-col gap-[18px]">
        <Header show={show} onToggle={(k) => setShow({ ...show, [k]: !show[k] })} />
        <EmptyState
          title="The map is waiting"
          hint="Add a few projects and they'll gather here around you, with their tasks and notes."
        />
      </div>
    );
  }

  // ---- labels ----
  const labels: {
    key: string;
    x: number;
    y: number;
    side: LabelSide;
    text: string;
    muted?: boolean;
    strong?: boolean;
    maxWidth?: number;
  }[] = [];
  for (const n of nodes) {
    if (n.kind === 'me') {
      labels.push({ key: n.id, x: n.x, y: n.y + 48, side: 'b', text: n.label });
    } else if (n.kind === 'project') {
      // toward the centre, so the outward side stays free for the fan; just clear of the ring
      const dx = n.x - me.x;
      const dy = n.y - me.y;
      const len = Math.hypot(dx, dy) || 1;
      const c = dx / len;
      const s = dy / len;
      const status = n.refId ? statusOf.get(n.refId) : undefined;
      const side: LabelSide = Math.abs(c) > 0.6 ? (c > 0 ? 'l' : 'r') : s > 0 ? 't' : 'b';
      labels.push({
        key: n.id,
        x: n.x - 38 * c,
        y: n.y - 38 * s,
        side,
        text: status === 'blocked' ? `${n.label} · on hold` : n.label,
        muted: n.someday,
        strong: true,
      });
    } else if (n.parentId) {
      if (n.parentId !== active && n.id !== hovered) continue;
      // outward, away from the project
      const parent = byId.get(n.parentId)!;
      const dx = n.x - parent.x;
      const dy = n.y - parent.y;
      const len = Math.hypot(dx, dy) || 1;
      const c = dx / len;
      const s = dy / len;
      labels.push({
        key: n.id,
        x: n.x + 16 * c,
        y: n.y + 16 * s,
        side: c > 0.35 ? 'r' : c < -0.35 ? 'l' : s > 0 ? 'b' : 't',
        text: n.label,
      });
    } else if (looseCount <= LOOSE_LABELS_MAX || n.id === MORE_NOTES_ID || n.id === sel.id || n.id === hovered) {
      // to the right, the open side of the map, cut short before the edge; left when the map is narrow
      const room = size.w - n.x - 24;
      const text = n.label || 'Untitled';
      if (room >= 100) labels.push({ key: n.id, x: n.x + 14, y: n.y, side: 'r', text, maxWidth: room });
      else labels.push({ key: n.id, x: n.x - 14, y: n.y, side: 'l', text, maxWidth: n.x - 24 });
    }
  }

  const ringStyle = (n: MapNode): CSSProperties => {
    const on = n.id === sel.id ? { boxShadow: SELECTED_RING } : {};
    if (n.kind === 'me') return { width: 72, height: 72, borderRadius: '50%', background: '#16171A', ...on };
    if (n.kind === 'project') {
      const pct = Math.round((n.progress ?? 0) * 100);
      return {
        width: 62,
        height: 62,
        borderRadius: '50%',
        ...(n.someday
          ? { background: '#FFFFFF', border: '2px dashed #878379' }
          : { background: `conic-gradient(${n.color} ${pct}%, ${TRACK} 0)` }),
        ...on,
      };
    }
    if (n.kind === 'task') {
      return {
        width: 14,
        height: 14,
        borderRadius: '50%',
        border: `2.5px solid ${n.color}`,
        background: n.done ? n.color : '#FFFFFF',
        ...on,
      };
    }
    return { width: 16, height: 16, borderRadius: 4, border: `2px solid ${n.color}`, background: '#FFFFFF', ...on };
  };

  const ariaOf = (n: MapNode): string => {
    if (n.kind === 'me') return `${n.label}, everything`;
    if (n.kind === 'project') return `${n.label}, ${STATUS_LABEL[(n.refId && statusOf.get(n.refId)) || 'active']}`;
    if (n.kind === 'task') return `${n.done ? 'Done' : 'Task'}: ${n.label}`;
    if (n.id === MORE_NOTES_ID) return `${n.label}, not in a project`;
    return `Note: ${n.label || 'Untitled'}`;
  };

  return (
    <div className="flex h-full min-h-[600px] flex-col gap-[18px]">
      <Header show={show} onToggle={(k) => setShow({ ...show, [k]: !show[k] })} />

      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1 overflow-hidden overflow-clip rounded-lg border border-line bg-panel"
        style={{ backgroundImage: 'radial-gradient(#E2DFD7 1px, transparent 1.2px)', backgroundSize: '24px 24px' }}
        role="group"
        aria-label="Map of projects, tasks and notes"
        data-testid="map-wrap"
        onScroll={unscroll}
        onKeyDown={(e) => {
          // Escape inside the map goes back to the whole picture; a dialog's own Escape stays its own
          if (e.key === 'Escape' && !e.defaultPrevented) setSelected(ME_ID);
        }}
      >
        {/* the pan surface: everything that moves with drag and zoom */}
        <div
          className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          data-testid="map-surface"
        >
          <div
            className="absolute left-0 top-0"
            style={{
              width: size.w,
              height: size.h,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transformOrigin: `${size.w / 2}px ${size.h / 2}px`,
            }}
          >
            <svg className="pointer-events-none absolute left-0 top-0" width={size.w} height={size.h} aria-hidden="true">
              {edges.map((e) => {
                const a = byId.get(e.from)!;
                const b = byId.get(e.to)!;
                const on = e.style !== 'mention' && active !== undefined && (e.to === active || e.from === active);
                const dim = e.style === 'kid' && active !== undefined && e.from !== active;
                return (
                  <line
                    key={`${e.style}:${e.from}:${e.to}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={on ? EDGE.on : EDGE[e.style]}
                    strokeWidth={e.style === 'hub' ? 2 : 1.5}
                    strokeDasharray={e.style === 'mention' ? '5 4' : undefined}
                    opacity={dim ? 0.35 : 1}
                    style={{ transition: EASE }}
                  />
                );
              })}
            </svg>

            {nodes.map((n) => {
              const box = NODE_BOX[n.kind];
              const dim = n.parentId !== undefined && active !== undefined && n.parentId !== active;
              const counts = n.kind === 'project' ? progress.get(n.id) : undefined;
              return (
                <button
                  key={n.id}
                  type="button"
                  className="absolute flex items-center justify-center rounded-full border-0 bg-transparent p-0"
                  style={{
                    left: n.x,
                    top: n.y,
                    width: box,
                    height: box,
                    transform: 'translate(-50%,-50%)',
                    opacity: dim ? 0.35 : 1,
                    transition: EASE,
                    cursor: 'pointer',
                  }}
                  ref={(el) => {
                    if (el) buttons.current.set(n.id, el);
                    else buttons.current.delete(n.id);
                  }}
                  tabIndex={n.id === tabStop ? 0 : -1}
                  aria-label={ariaOf(n)}
                  aria-pressed={n.id === sel.id}
                  onClick={() => pick(n.id)}
                  onKeyDown={(e) => onNodeKey(e, n.id)}
                  onPointerDown={() => {
                    pointerFocus.current = true;
                    window.setTimeout(() => (pointerFocus.current = false), 0);
                  }}
                  onPointerEnter={() => setHovered(n.id)}
                  onPointerLeave={() => setHovered((h) => (h === n.id ? null : h))}
                  onFocus={() => {
                    setHovered(n.id);
                    setCursor(n.id);
                    unscroll();
                    if (!pointerFocus.current) revealNode(n);
                    pointerFocus.current = false;
                  }}
                  onBlur={() => setHovered((h) => (h === n.id ? null : h))}
                >
                  <span className="flex items-center justify-center" style={ringStyle(n)}>
                    {n.kind === 'me' && (
                      <span className="font-display text-[28px] font-extrabold leading-none text-white">
                        {n.label.charAt(0).toUpperCase()}
                      </span>
                    )}
                    {n.kind === 'project' && (
                      <span className="mono flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white text-xs text-ink">
                        {counts && counts.total ? `${counts.done}/${counts.total}` : ''}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}

            {labels.map((l) => (
              <span
                key={`label:${l.key}`}
                className={`pointer-events-none absolute max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap rounded px-1.5 py-0.5 ${
                  l.strong ? 'text-2sm leading-[18px]' : 'text-xs leading-4'
                } ${l.muted ? 'text-ink-2' : 'text-ink'}`}
                style={{
                  left: l.x,
                  top: l.y,
                  transform: LABEL_SHIFT[l.side],
                  background: 'rgba(255,255,255,0.92)',
                  fontWeight: l.strong ? 600 : undefined,
                  maxWidth: l.maxWidth !== undefined ? Math.max(60, Math.min(240, l.maxWidth)) : undefined,
                }}
              >
                {l.text}
              </span>
            ))}
          </div>
        </div>

        <MapDetail node={sel} nodes={nodes} edges={edges} />

        <div
          className="absolute right-4 top-4 flex flex-col overflow-hidden rounded-md border border-line-strong bg-panel"
          role="group"
          aria-label="Zoom"
        >
          <ZoomButton label="Zoom in" onClick={() => zoom(1)}>
            <Plus size={16} />
          </ZoomButton>
          <ZoomButton label="Zoom out" onClick={() => zoom(-1)}>
            <Minus size={16} />
          </ZoomButton>
          <ZoomButton label="Fit everything" onClick={fit}>
            <Maximize size={16} />
          </ZoomButton>
        </div>

        <Key />
      </div>
    </div>
  );
}

function Header({ show, onToggle }: { show: MapFilters; onToggle: (k: keyof MapFilters) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2.5">
      <div className="flex flex-1 flex-col gap-1.5">
        <span className="text-2sm text-ink-2">Everything you have on, and how it connects. Click anything.</span>
        <h1 className="m-0 text-4xl">Map</h1>
      </div>
      {CHIPS.map((c) => (
        <button
          key={c.key}
          type="button"
          aria-pressed={show[c.key]}
          onClick={() => onToggle(c.key)}
          className={`inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-2sm transition-colors hover:bg-raised ${
            show[c.key] ? 'border-ink bg-raised font-semibold text-ink' : 'border-line-strong bg-panel text-ink-2'
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center border-0 border-t border-line bg-panel text-ink first:border-t-0 hover:bg-raised"
    >
      {children}
    </button>
  );
}

/** The key, bottom left, as in the mockup. */
function Key() {
  return (
    <div
      className="absolute bottom-4 left-4 flex flex-wrap items-center gap-4 rounded-lg border border-line px-3 py-2 text-xs text-ink-2"
      style={{ background: 'rgba(255,255,255,0.94)' }}
      role="group"
      aria-label="Key"
    >
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block h-3.5 w-3.5 rounded-full"
          style={{ background: `conic-gradient(#D64D1E 55%, ${TRACK} 0)` }}
        />
        Project, ring shows progress
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-full bg-white" style={{ border: '2.5px solid #5A5852' }} />
        Task
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: '#5A5852' }} />
        Done
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-[13px] w-[13px] rounded-[3px] bg-white" style={{ border: '2px solid #5A5852' }} />
        Note
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-[22px]" style={{ borderTop: '1.5px dashed #878379' }} />
        Mentions
      </span>
    </div>
  );
}
