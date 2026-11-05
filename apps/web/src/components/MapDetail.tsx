import { useNavigate } from 'react-router-dom';
import { useHQ } from '../store';
import { useOpenTask } from './TaskDetailHost';
import { Button } from './ui';
import { STATUS_LABEL, isDone, type ID, type Project } from '../types';
import { childProjects, projectCrumb, projectProgressDeep } from '../selectors';
import { dayOfIso, formatShort } from '../lib/dates';
import { ME_COLOR, MORE_NOTES_ID, type MapEdge, type MapNode } from '../lib/map-layout';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "A", "A and B", "A, B and C". */
function andList(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** `id` and every project below it, cycle-safe. */
function subtree(projects: Project[], id: ID): Set<ID> {
  const ids = new Set<ID>([id]);
  const stack = [id];
  while (stack.length) {
    for (const c of childProjects({ projects }, stack.pop()!)) {
      if (!ids.has(c.id)) {
        ids.add(c.id);
        stack.push(c.id);
      }
    }
  }
  return ids;
}

interface Detail {
  kicker: string;
  title: string;
  color: string;
  bar?: { pct: number };
  lines: string[];
  cta: string;
  open: () => void;
}

/**
 * The card in the map's bottom-right corner: what the selected thing is, a few facts about it, and
 * one button that goes to its real home. With nothing selected it sums up the whole map.
 */
export default function MapDetail({ node, nodes, edges }: { node: MapNode; nodes: MapNode[]; edges: MapEdge[] }) {
  const projects = useHQ((s) => s.projects);
  const tasks = useHQ((s) => s.tasks);
  const notes = useHQ((s) => s.notes);
  const navigate = useNavigate();
  const openTask = useOpenTask();

  function describe(): Detail | undefined {
    if (node.kind === 'me') {
      const onMap = nodes.filter((n) => n.kind === 'project');
      const onTheGo = onMap.filter((n) => projects.find((p) => p.id === n.refId)?.status === 'active').length;
      const openTasks = nodes.filter((n) => n.kind === 'task' && !n.done).length;
      // the "n more notes" node stands for n of them
      const notesOnMap = nodes.filter((n) => n.kind === 'note').reduce((sum, n) => sum + (n.count ?? 1), 0);
      return {
        kicker: 'Everything',
        title: node.label,
        color: ME_COLOR,
        lines: [
          `${plural(onMap.length, 'project')}, ${onTheGo} on the go`,
          `${plural(openTasks, 'open task')} on the map`,
          plural(notesOnMap, 'note'),
        ],
        cta: 'Open Today',
        open: () => navigate('/'),
      };
    }

    if (node.kind === 'project') {
      const p = projects.find((x) => x.id === node.refId);
      if (!p) return undefined;
      const { done, total } = projectProgressDeep({ projects, tasks }, p.id);
      const ids = subtree(projects, p.id);
      const noteCount = notes.filter((n) => n.projectId && ids.has(n.projectId)).length;
      const subs = ids.size - 1;
      return {
        kicker: `Project · ${STATUS_LABEL[p.status]}`,
        title: p.name,
        color: node.color,
        bar: total ? { pct: Math.round((done / total) * 100) } : undefined,
        lines: [
          total ? `${done} of ${total} tasks done` : 'No tasks yet',
          ...(p.nextStep ? [`Next: ${p.nextStep}`] : []),
          [plural(noteCount, 'note'), ...(subs ? [plural(subs, 'subproject')] : [])].join(' · '),
        ],
        cta: 'Open project',
        open: () => navigate(`/projects/${p.id}`),
      };
    }

    if (node.kind === 'task') {
      const t = tasks.find((x) => x.id === node.refId);
      if (!t) return undefined;
      const p = projects.find((x) => x.id === t.projectId);
      const done = isDone(t);
      return {
        kicker: done ? 'Task · done' : 'Task',
        title: t.title,
        color: node.color,
        lines: [
          ...(p ? [`In ${projectCrumb({ projects }, p)}`] : []),
          ...(t.dueDate && !done ? [`Due ${formatShort(t.dueDate)}`] : []),
          done ? `Ticked off${t.completedAt ? ` ${formatShort(dayOfIso(t.completedAt))}` : ''}` : 'Still to do',
        ],
        cta: 'Open task',
        open: () => openTask(t.id),
      };
    }

    if (node.id === MORE_NOTES_ID) {
      return {
        kicker: 'Notes',
        title: 'Notes not in a project',
        color: node.color,
        lines: [`${plural(node.count ?? 0, 'note')} that no project holds and nothing mentions`],
        cta: 'Open notes',
        open: () => navigate('/notes'),
      };
    }

    const n = notes.find((x) => x.id === node.refId);
    if (!n) return undefined;
    const p = projects.find((x) => x.id === n.projectId);
    const mentions = edges
      .filter((e) => e.style === 'mention' && (e.from === node.id || e.to === node.id))
      .map((e) => nodes.find((x) => x.id === (e.from === node.id ? e.to : e.from))?.label)
      .filter((l): l is string => Boolean(l));
    const folder = n.folder?.split('/')[0];
    return {
      kicker: folder ? `Note · ${folder}` : 'Note',
      title: n.title || 'Untitled',
      color: node.color,
      lines: [
        p ? `In ${projectCrumb({ projects }, p)}` : mentions.length ? `Mentions ${andList(mentions)}` : 'Not in a project yet',
        ...(p && mentions.length ? [`Mentions ${andList(mentions)}`] : []),
        `Edited ${formatShort(dayOfIso(n.updatedAt))}`,
      ],
      cta: 'Open note',
      open: () => navigate(`/notes/${n.id}`),
    };
  }

  const d = describe();
  if (!d) return null;

  return (
    <div
      className="absolute bottom-4 right-4 flex w-[268px] flex-col gap-2 rounded-lg border border-line bg-panel p-4 shadow-[0_12px_32px_rgba(22,23,26,0.12)]"
      aria-live="polite"
      data-testid="map-detail"
    >
      <span className="flex items-center gap-2 text-xs text-ink-2">
        <span className="inline-block h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: d.color }} />
        {d.kicker}
      </span>
      <span className="font-display text-lg font-bold leading-6 [overflow-wrap:anywhere]">{d.title}</span>
      {d.bar && (
        <span className="block h-1.5 overflow-hidden rounded-[3px] bg-raised" aria-hidden="true">
          <span className="block h-full rounded-[3px]" style={{ width: `${d.bar.pct}%`, background: d.color }} />
        </span>
      )}
      {d.lines.map((line, i) => (
        <span key={i} className="text-2sm leading-[18px] text-ink-2 [overflow-wrap:anywhere]">
          {line}
        </span>
      ))}
      <Button className="mt-1 self-start" onClick={d.open}>
        {d.cta}
      </Button>
    </div>
  );
}
