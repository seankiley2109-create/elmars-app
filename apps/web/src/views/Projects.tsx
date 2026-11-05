import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { useHQ } from '../store';
import ProjectBoard, { ProjectStatusCard } from '../components/ProjectBoard';
import RoadmapCalendar from './RoadmapCalendar';
import { isTopLevel } from '../selectors';
import { buttonCls } from '../components/ui';
import type { Project, ProjectStatus } from '../types';

/** A card you open, not a row you expand — clicking drills into `/projects/:id`. Used where projects are listed rather than grouped by status. */
export function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  return (
    <motion.button layout onClick={onOpen} transition={{ duration: 0.15 }} className="block w-full text-left">
      <ProjectStatusCard project={project} showStatus />
    </motion.button>
  );
}

type View = 'board' | 'timeline';

/** "4 on the go, 1 on hold, 2 for someday" — only the parts that have something in them. */
function headline(projects: Project[], archived: boolean): string {
  if (archived) return `${projects.length} archived`;
  const n = (s: ProjectStatus) => projects.filter((p) => p.status === s).length;
  const parts = [
    n('active') && `${n('active')} on the go`,
    n('blocked') && `${n('blocked')} on hold`,
    n('later') && `${n('later')} for someday`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Nothing here yet';
}

/**
 * The projects board — the top of the hierarchy and the daily driver: four columns by status
 * (drag a card to change it), a Timeline of the same projects, and a hop to the Map. A project is
 * anything with a status and a next step; click a card to go in.
 */
export default function Projects() {
  const projects = useHQ((s) => s.projects);
  const addProject = useHQ((s) => s.addProject);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const openId = params.get('p');
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<View>('board');
  const [adding, setAdding] = useState<ProjectStatus | null>(null);
  const newBtnRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();

  // Arriving with `state.adding` (⌘K "New project") opens that column's add form once; the state is
  // cleared straight away so a refresh or Back does not reopen it.
  useEffect(() => {
    const want = (location.state as { adding?: ProjectStatus } | null)?.adding;
    if (!want) return;
    setShowArchived(false);
    setView('board');
    setAdding(want);
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // the board is top-level projects only — subprojects live inside their parent's workspace
  const topLevel = projects.filter((p) => isTopLevel({ projects }, p));
  // in the order they were made, so a card you add lands at the bottom of its column
  const visible = topLevel.filter((p) => p.archived === showArchived);
  const archivedCount = topLevel.filter((p) => p.archived).length;

  // the detail surface used to be a `?p=<id>` slide-over — keep those links alive
  if (openId) return <Navigate to={`/projects/${openId}`} replace />;

  const create = (name: string, status: ProjectStatus) => {
    addProject({ name, status });
  };

  const seg = (v: View, label: string) => (
    <button
      type="button"
      key={v}
      aria-pressed={view === v}
      onClick={() => setView(v)}
      className={`inline-flex h-[38px] items-center border-l border-line px-3.5 first:border-l-0 ${
        view === v ? 'bg-raised font-semibold text-ink' : 'text-ink-2 hover:bg-raised'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-full flex-col gap-5">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex items-center gap-3 text-[13px] text-ink-2">
            {headline(visible, showArchived)}
            {archivedCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setShowArchived(!showArchived);
                  setAdding(null); // an open add form belongs to the list you just left
                }}
                // 44px tall hit area; the negative margin keeps the line the height it was
                className="-my-3 inline-flex min-h-11 items-center text-accent underline-offset-2 hover:underline"
              >
                {showArchived ? 'Show current' : `Archived (${archivedCount})`}
              </button>
            )}
          </span>
          <h1 className="m-0 text-4xl leading-10">Projects</h1>
        </div>
        <div role="group" aria-label="View" className="inline-flex overflow-hidden rounded-md border border-line-strong bg-panel">
          {seg('board', 'Board')}
          {seg('timeline', 'Timeline')}
          <Link
            to="/map"
            className="inline-flex h-[38px] items-center border-l border-line px-3.5 text-ink-2 hover:bg-raised"
          >
            Map
          </Link>
        </div>
        <button
          ref={newBtnRef}
          type="button"
          className={buttonCls('primary')}
          onClick={() => {
            // from the archive, "new" means a current project: go back to the current list first
            setShowArchived(false);
            setView('board');
            setAdding('active');
          }}
        >
          <Plus size={16} aria-hidden /> New project
        </button>
      </div>

      {view === 'board' ? (
        <ProjectBoard
          projects={visible}
          onOpen={(id) => navigate(`/projects/${id}`)}
          // the archive is a list to look through, not a place to add into
          onCreate={showArchived ? undefined : create}
          adding={adding}
          onAddingChange={setAdding}
          returnFocusRef={newBtnRef}
        />
      ) : (
        <RoadmapCalendar projects={visible} />
      )}
    </div>
  );
}
