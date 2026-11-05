import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckSquare, FolderKanban, Link2, Paperclip, StickyNote, X } from 'lucide-react';
import { useHQ } from '../store';
import { inputCls } from './ui';
import { entityLabel, type LabelState } from '../selectors';
import type { EntityRef, EntityType } from '../types';

export const ENTITY_ICON: Record<EntityType, typeof Link2> = {
  project: FolderKanban,
  task: CheckSquare,
  note: StickyNote,
  asset: Paperclip,
};

// entityLabel lives in hq-core: the vault serializer needs the same names for links.yaml, and one
// implementation means adding an entity type breaks the UI and the serializer together.
export { entityLabel };
type Slices = LabelState;

export function entityRoute(ref: EntityRef): string | null {
  switch (ref.type) {
    case 'project':
      return `/projects/${ref.id}`;
    case 'note':
      return `/notes/${ref.id}`;
    case 'task':
      // a bare search string keeps the current page; the task opens in the detail panel over it
      return `?task=${ref.id}`;
    default:
      return null;
  }
}

/** Universal "linked entities" section: chips for existing links + search-to-add. */
export default function LinkPicker({ entity }: { entity: EntityRef }) {
  const navigate = useNavigate();
  const links = useHQ((s) => s.links);
  const projects = useHQ((s) => s.projects);
  const tasks = useHQ((s) => s.tasks);
  const notes = useHQ((s) => s.notes);
  const assets = useHQ((s) => s.assets);
  const addLink = useHQ((s) => s.addLink);
  const removeLink = useHQ((s) => s.removeLink);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'related' | 'blocks'>('related');

  const slices: Slices = { projects, tasks, notes, assets };

  const mine = useMemo(
    () =>
      links
        .filter((l) => l.from.id === entity.id || l.to.id === entity.id)
        .map((l) => ({ link: l, other: l.from.id === entity.id ? l.to : l.from })),
    [links, entity.id],
  );

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const linkedIds = new Set(mine.map((m) => m.other.id));
    const pool: { ref: EntityRef; label: string }[] = [
      ...projects.filter((p) => !p.archived).map((p) => ({ ref: { type: 'project' as const, id: p.id }, label: p.name })),
      ...notes.map((n) => ({ ref: { type: 'note' as const, id: n.id }, label: n.title })),
      ...tasks.filter((t) => t.status !== 'done').map((t) => ({ ref: { type: 'task' as const, id: t.id }, label: t.title })),
    ];
    return pool
      .filter((c) => c.ref.id !== entity.id && !linkedIds.has(c.ref.id) && c.label.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, projects, notes, tasks, entity.id, mine]);

  return (
    <div>
      {mine.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {mine.map(({ link, other }) => {
            const Icon = ENTITY_ICON[other.type];
            const route = entityRoute(other);
            return (
              <span
                key={link.id}
                title={link.kind === 'blocks' ? 'Blocking relationship' : undefined}
                className={`group inline-flex items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-1.5 text-2xs ${
                  link.kind === 'blocks' ? 'border-warn/40 bg-warn/10' : 'border-line bg-surface2'
                }`}
              >
                <Icon size={11} className={`shrink-0 ${link.kind === 'blocks' ? 'text-warn' : 'text-accent'}`} />
                <button
                  onClick={() => route && navigate(route)}
                  className={`max-w-44 truncate ${route ? 'hover:text-accent' : 'cursor-default'}`}
                  title={entityLabel(slices, other)}
                >
                  {entityLabel(slices, other)}
                </button>
                <button
                  onClick={() => removeLink(link.id)}
                  aria-label="Remove link"
                  className="rounded-full p-0.5 text-dim transition-colors hover:text-warn"
                >
                  <X size={11} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="relative">
        <div className="flex gap-2">
          <input
            className={inputCls}
            placeholder="Link to a project, task or note…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search entities to link"
          />
          {/* the Map draws 'blocks' as warn edges — this is where they come from */}
          <select
            className={`${inputCls} !w-28 shrink-0`}
            value={kind}
            onChange={(e) => setKind(e.target.value as 'related' | 'blocks')}
            aria-label="Link kind"
          >
            <option value="related">related</option>
            <option value="blocks">blocks</option>
          </select>
        </div>
        {candidates.length > 0 && (
          <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
            {candidates.map((c) => {
              const Icon = ENTITY_ICON[c.ref.type];
              return (
                <button
                  key={c.ref.id}
                  onClick={() => {
                    addLink(entity, c.ref, kind);
                    setQuery('');
                    setKind('related');
                  }}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-2sm transition-colors hover:bg-surface2"
                >
                  <Icon size={13} className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  <span className="text-micro uppercase tracking-wide text-dim">{c.ref.type}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
