import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { CalendarDays, CheckSquare, Download, FolderKanban, Plus, Settings as SettingsIcon, StickyNote } from 'lucide-react';
import { useHQ } from '../store';
import { projectCrumb } from '../selectors';
import Modal from './Modal';
import { useOpenTask } from './TaskDetailHost';
import { NAV_ICONS, NAV_ITEMS, SearchIcon } from './Sidebar';
import { BAR_FOCUS_RING } from './ui';
import { searchAll, type SearchHit } from '../lib/search';

type IconType = React.ComponentType<{ size?: number | string; className?: string }>;

const HIT_ICON: Record<SearchHit['type'], IconType> = {
  project: FolderKanban,
  task: CheckSquare,
  note: StickyNote,
  event: CalendarDays,
};

/** Accent- and case-blind "contains", for the palette's own commands. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * ⌘K: search everything. Empty, it offers the actions and the places; typing searches projects,
 * tasks, notes and events through `searchAll` (titles first, then note bodies), and Enter opens
 * the highlighted one.
 */
export default function CommandPalette({
  open,
  onClose,
  onCapture,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: () => void;
}) {
  const navigate = useNavigate();
  const openTask = useOpenTask();
  const projects = useHQ((s) => s.projects);
  const tasks = useHQ((s) => s.tasks);
  const notes = useHQ((s) => s.notes);
  const events = useHQ((s) => s.events);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const go = (to: string) => {
    navigate(to);
    onClose();
  };

  const focusNewInput = (to: string) => {
    navigate(to);
    onClose();
    setTimeout(() => {
      document
        .querySelector<HTMLElement>('main input[type="text"], main input:not([type]), main textarea')
        ?.focus();
    }, 250);
  };

  const q = query.trim();
  const hits = useMemo(
    () => (q ? searchAll({ projects, tasks, notes, events }, q) : []),
    [q, projects, tasks, notes, events],
  );

  const actions: { text: string; icon: IconType; run: () => void }[] = [
    {
      text: 'New task',
      icon: Plus,
      run: () => {
        onClose();
        onCapture();
      },
    },
    {
      text: 'New project',
      icon: Plus,
      // Projects reads this once, opens the On the go add form, and clears it
      run: () => {
        navigate('/projects', { state: { adding: 'active' } });
        onClose();
      },
    },
    { text: 'New note', icon: Plus, run: () => focusNewInput('/notes') },
    {
      text: 'Save a backup file',
      icon: Download,
      // Settings does the save, so its result (or its failure) is shown in words
      run: () => {
        navigate('/settings', { state: { saveBackup: true } });
        onClose();
      },
    },
  ];
  const places: { text: string; icon: IconType; to: string }[] = [
    ...NAV_ITEMS.map(({ to, label }) => ({ text: label, icon: NAV_ICONS[to], to })),
    { text: 'Settings', icon: SettingsIcon, to: '/settings' },
  ];
  // With a query, the commands narrow by the same rule as the search; without one, all show.
  const shows = (text: string) => !q || fold(text).includes(fold(q));
  const shownActions = actions.filter((a) => shows(a.text));
  const shownPlaces = places.filter((p) => shows(p.text));

  const openHit = (h: SearchHit) => {
    if (h.type === 'task') {
      openTask(h.id);
      onClose();
    } else if (h.type === 'project') go(`/projects/${h.id}`);
    else if (h.type === 'note') go(`/notes/${h.id}`);
    else go('/calendar');
  };

  const hitLabel = (h: SearchHit) => {
    if (h.type !== 'project') return h.title;
    const p = projects.find((x) => x.id === h.id);
    return p ? projectCrumb({ projects }, p) : h.title;
  };

  const hitSub = (h: SearchHit) => {
    if (h.snippet) return undefined; // the snippet gets its own line
    if (h.type === 'event') return events.find((e) => e.id === h.id)?.date;
    return undefined;
  };

  return (
    <Modal open={open} onClose={onClose} label="Search" placement="top" className="max-w-xl" initialFocus={false}>
      <Command
        label="Search"
        shouldFilter={false}
        className={`overflow-hidden rounded-lg border border-line-strong bg-panel shadow-2xl ${BAR_FOCUS_RING}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="flex h-[52px] items-center gap-3 border-b border-line px-4 text-ink-2">
          <SearchIcon size={18} />
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Search everything…"
            className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
            autoFocus
          />
          <kbd className="font-mono shrink-0 rounded border border-line bg-panel px-[5px] text-2xs leading-[18px] text-ink-2">
            esc
          </kbd>
        </div>

        <Command.List className="max-h-[50vh] overflow-y-auto p-2">
          <Command.Empty className="px-3 py-8 text-center text-sm text-ink-2">
            Nothing matches — try fewer letters.
          </Command.Empty>

          {hits.length > 0 && (
            <Command.Group heading="Results" className="cmdk-group">
              {hits.map((h) => (
                <Item
                  key={`${h.type}:${h.id}`}
                  value={`${h.type}:${h.id}`}
                  onSelect={() => openHit(h)}
                  icon={HIT_ICON[h.type]}
                  text={hitLabel(h)}
                  sub={hitSub(h)}
                  snippet={h.snippet}
                />
              ))}
            </Command.Group>
          )}

          {shownActions.length > 0 && (
            <Command.Group heading="Actions" className="cmdk-group">
              {shownActions.map((a) => (
                <Item key={a.text} value={`action ${a.text}`} onSelect={a.run} icon={a.icon} text={a.text} />
              ))}
            </Command.Group>
          )}

          {shownPlaces.length > 0 && (
            <Command.Group heading="Go to" className="cmdk-group">
              {shownPlaces.map((p) => (
                <Item key={p.to} value={`go ${p.text}`} onSelect={() => go(p.to)} icon={p.icon} text={p.text} />
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </Modal>
  );
}

function Item({
  onSelect,
  icon: Icon,
  text,
  sub,
  snippet,
  value,
}: {
  onSelect: () => void;
  icon: IconType;
  text: string;
  sub?: string;
  snippet?: string;
  value: string;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      value={value}
      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm text-ink data-[selected=true]:bg-raised"
    >
      <Icon size={16} className="shrink-0 text-ink-2" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{text}</span>
        {snippet && <span className="truncate text-xs text-ink-2">{snippet}</span>}
      </span>
      {sub && <span className="mono max-w-40 shrink-0 truncate text-2xs text-ink-3">{sub}</span>}
    </Command.Item>
  );
}
