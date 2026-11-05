import { useMemo, type ComponentType, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Settings as SettingsIcon } from 'lucide-react';
import { useHQ } from '../store';
import { isTopLevel, projectColor, todayTasks } from '../selectors';
import { isDone } from '../types';
import { useToday } from '../lib/use-today';

/**
 * The five places, in order, for the rail and for `g`+key navigation. Settings is reached from the
 * rail's footer and the command palette rather than being a place of its own.
 *
 * Projects is the one that matters: the Calendar, the command palette and the link picker all
 * drill into `/projects/<id>` (the project workspace) — remove the routes and you break all three.
 */
export const NAV_ITEMS = [
  { to: '/', label: 'Today', key: 't' },
  { to: '/projects', label: 'Projects', key: 'p' },
  { to: '/notes', label: 'Notes', key: 'n' },
  { to: '/calendar', label: 'Calendar', key: 'c' },
  { to: '/map', label: 'Map', key: 'm' },
] as const;

type NavItem = (typeof NAV_ITEMS)[number];

/** Anything the rail, the palette and the bottom bar can draw as a place's icon. */
export type NavIcon = ComponentType<{ size?: number | string; className?: string }>;

/** The mockup's own line icons: 24-grid, 1.75 stroke, round caps — drawn in the text colour. */
function lineIcon(paths: ReactNode, name: string): NavIcon {
  const Icon = ({ size = 20, className }: { size?: number | string; className?: string }) => (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className ?? ''}`}
      aria-hidden
    >
      {paths}
    </svg>
  );
  Icon.displayName = name;
  return Icon;
}

const TodayIcon = lineIcon(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
  </>,
  'TodayIcon',
);
const ProjectsIcon = lineIcon(
  <>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </>,
  'ProjectsIcon',
);
const NotesIcon = lineIcon(
  <>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
    <path d="M14 2v5h5M8 13h8M8 17h5" />
  </>,
  'NotesIcon',
);
const CalendarIcon = lineIcon(
  <>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </>,
  'CalendarIcon',
);
const MapIcon = lineIcon(
  <>
    <circle cx="12" cy="5" r="2.5" />
    <circle cx="5" cy="19" r="2.5" />
    <circle cx="19" cy="19" r="2.5" />
    <path d="M12 7.5v4M12 11.5 6.8 17.2M12 11.5l5.2 5.7" />
  </>,
  'MapIcon',
);
export const SearchIcon = lineIcon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
  'SearchIcon',
);

export const NAV_ICONS: Record<NavItem['to'], NavIcon> = {
  '/': TodayIcon,
  '/projects': ProjectsIcon,
  '/notes': NotesIcon,
  '/calendar': CalendarIcon,
  '/map': MapIcon,
};

/** Where the data folder lives, as the Mac app records it. Absent in the browser. */
export const VAULT_PATH_KEY = 'elmar.vaultPath';

/** The footer line: iCloud Drive when the folder is inside it, otherwise this Mac only. */
export function savedWhere(): string {
  let path: string | null = null;
  try {
    path = localStorage.getItem(VAULT_PATH_KEY);
  } catch {
    // storage blocked: say the plain thing
  }
  return path?.includes('com~apple~CloudDocs') ? 'Saved on this Mac · iCloud Drive' : 'Saved on this Mac only';
}

const placeCls = (isActive: boolean) =>
  `relative flex h-11 items-center gap-3 rounded-md px-3 font-medium transition-colors ${
    isActive ? 'signal-tick bg-raised font-semibold text-ink' : 'text-ink-2 hover:bg-raised hover:text-ink'
  }`;

const projectCls = (isActive: boolean) =>
  `flex h-9 items-center gap-2.5 rounded-md px-3 text-2sm leading-5 text-ink transition-colors hover:bg-raised ${
    isActive ? 'bg-raised font-semibold' : ''
  }`;

/** The small figure at the end of a place's row. */
function Count({ n }: { n: number }) {
  if (n === 0) return null;
  return <span className="mono ml-auto text-xs text-ink-3">{n}</span>;
}

/** The desktop rail, as the mockup draws it: who, search, the five places, the projects, where it's saved. */
export default function Sidebar({ onSearch }: { onSearch?: () => void }) {
  const userName = useHQ((s) => s.settings.userName);
  const projects = useHQ((s) => s.projects);
  const tasks = useHQ((s) => s.tasks);

  // Top-level folders that are On the go or On hold, in board order.
  const listed = useMemo(
    () =>
      projects.filter(
        (p) => !p.archived && (p.status === 'active' || p.status === 'blocked') && isTopLevel({ projects }, p),
      ),
    [projects],
  );

  // Today's figure: what is still open and due today or earlier — the Today page's own list, so the
  // two can't drift, and it rolls over at midnight with the day.
  const today = useToday();
  const leftToday = useMemo(() => todayTasks({ tasks }, today).filter((t) => !isDone(t)).length, [tasks, today]);

  const counts: Partial<Record<NavItem['to'], number>> = { '/': leftToday, '/projects': listed.length };
  const name = userName.trim();

  return (
    <>
      {/* Desktop rail */}
      <aside
        aria-label="Sidebar"
        className="flex w-60 shrink-0 flex-col border-r border-line bg-panel px-3 pt-5 max-md:hidden"
      >
        <div className="flex items-center gap-2.5 px-2 pb-4">
          <span
            className="font-display flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink font-bold text-white"
            aria-hidden
          >
            {(name[0] ?? '·').toUpperCase()}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-semibold">{name || 'Welcome'}</span>
            <span className="text-xs leading-5 text-ink-3">Personal</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onSearch}
          className="mb-4 flex h-10 w-full shrink-0 cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-paper px-2.5 text-left text-ink-2 transition-colors hover:text-ink"
        >
          <SearchIcon size={16} />
          Search everything
          <kbd className="font-mono ml-auto rounded border border-line bg-panel px-[5px] text-2xs leading-[18px] text-ink-2">
            ⌘K
          </kbd>
        </button>

        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ to, label }) => {
            const Icon = NAV_ICONS[to];
            return (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => placeCls(isActive)}>
                <Icon size={20} />
                {label}
                <Count n={counts[to] ?? 0} />
              </NavLink>
            );
          })}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {listed.length > 0 && (
            <>
              <div id="sidebar-projects" className="px-3 pb-1.5 pt-5 text-xs leading-5 text-ink-3">
                Projects
              </div>
              <ul aria-labelledby="sidebar-projects">
                {listed.map((p) => (
                  <li key={p.id}>
                    <NavLink to={`/projects/${p.id}`} className={({ isActive }) => projectCls(isActive)}>
                      <span
                        data-dot
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]"
                        style={{ background: projectColor({ projects }, p) ?? 'var(--mt-line-strong)' }}
                        aria-hidden
                      />
                      <span className="truncate">{p.name}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-3 py-3.5 text-xs leading-5 text-ink-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{savedWhere()}</span>
          {/* A 44×44 hit area around a 24px mark; the negative margins keep the footer 48px tall. */}
          <NavLink
            to="/settings"
            aria-label="Settings"
            title="Settings"
            className={({ isActive }) =>
              `group -my-3 -mr-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-md transition-colors hover:text-ink ${
                isActive ? 'text-ink' : 'text-ink-3'
              }`
            }
          >
            {({ isActive }) => (
              <span
                className={`rounded-md p-1 transition-colors group-hover:bg-raised ${isActive ? 'bg-raised' : ''}`}
              >
                <SettingsIcon size={16} strokeWidth={1.75} aria-hidden />
              </span>
            )}
          </NavLink>
        </div>
      </aside>

      {/* Mobile bottom bar */}
      <nav
        aria-label="Places"
        className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-1 overflow-x-auto border-t border-line bg-panel px-2 py-1.5 md:hidden"
      >
        {NAV_ITEMS.map(({ to, label }) => {
          const Icon = NAV_ICONS[to];
          return (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              aria-label={label}
              className={({ isActive }) =>
                `flex min-w-14 flex-col items-center gap-0.5 rounded-md px-2 py-1.5 text-micro ${
                  isActive ? 'font-semibold text-ink' : 'text-ink-2'
                }`
              }
            >
              <Icon size={19} />
              {label}
            </NavLink>
          );
        })}
      </nav>
    </>
  );
}
