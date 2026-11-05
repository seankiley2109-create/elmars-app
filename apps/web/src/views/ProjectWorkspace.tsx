import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Archive, ArrowLeft, ChevronRight, FileText, GanttChart, Kanban, Link2, List, Plus, Trash2 } from 'lucide-react';
import { PROJECT_COLORS } from '@hq/core/data';
import { useHQ } from '../store';
import { deleteWithUndo, undoable } from '../lib/undo';
import { openExternalUrl } from '../lib/open-link';
import {
  childProjects,
  isDescendantOf,
  isTopLevel,
  parentOf,
  projectProgressDeep,
} from '../selectors';
import { usePersistentState } from '../lib/use-persistent-state';
import Attachments from '../components/Attachments';
import LinkPicker from '../components/LinkPicker';
import MonthCalendar from '../components/MonthCalendar';
import ProjectBoard from '../components/ProjectBoard';
import TaskRow from '../components/TaskRow';
import { useOpenTask } from '../components/TaskDetailHost';
import { ProjectCard } from './Projects';
import { useProjectCalendarData } from '../lib/useProjectCalendarData';
import { Card, EmptyState, ProgressBar, SectionLabel, Segmented, btn, btnGhost, btnPrimary, fieldCls, inputCls } from '../components/ui';
import { relativeTime, todayStr } from '../lib/dates';
import { STATUS_LABEL, isDone, type ProjectStatus } from '../types';

/**
 * The full-page home of one project, level-aware:
 *
 * - a **parent** leads with its subprojects — list (default) / board / timeline — plus its own
 *   tasks, files, history;
 * - a **leaf** leads with its tasks — list (default) / timeline. On screen a task is only open or
 *   done, so there is no task-status board.
 *
 * Reached from the Projects board, the calendar, the command palette and the link picker.
 */

export default function ProjectWorkspace() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const projects = useHQ((s) => s.projects);
  const project = projects.find((p) => p.id === id);
  const allTasks = useHQ((s) => s.tasks);
  const allActivity = useHQ((s) => s.activity);
  const notes = useHQ((s) => s.notes);
  const updateProject = useHQ((s) => s.updateProject);
  const updateTask = useHQ((s) => s.updateTask);
  const setProjectStatus = useHQ((s) => s.setProjectStatus);
  const deleteProject = useHQ((s) => s.deleteProject);
  const addProject = useHQ((s) => s.addProject);
  const addTask = useHQ((s) => s.addTask);

  const [newTask, setNewTask] = useState('');
  const [newSub, setNewSub] = useState('');
  const [newLink, setNewLink] = useState({ label: '', url: '' });
  const [confirmText, setConfirmText] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [month, setMonth] = useState(() => todayStr().slice(0, 7));
  // a parent can show only its own tasks, or roll up its subprojects' — so the visible list finally
  // matches the rolled-up progress number above it
  const [includeSubs, setIncludeSubs] = usePersistentState('workspace.includeSubs', false);

  const children = childProjects({ projects }, id);
  const isParentProject = children.length > 0;
  const calendar = useProjectCalendarData(id, showDone);
  const openTask = useOpenTask();

  // Shared timeline write-back — a dropped id is a child/self project bar, a windowed-task bar, or a
  // task chip (scheduled vs due). The derivation owns the predicates.
  const calMove = (dropId: string, s: string, e: string) =>
    calendar.isTaskWindow(dropId)
      ? updateTask(dropId, { startDate: s, scheduledDate: e })
      : updateProject(dropId, { startDate: s, targetDate: e });
  const calDrop = (dropId: string, day: string) =>
    calendar.isChild(dropId)
      ? updateProject(dropId, { startDate: day, targetDate: day })
      : updateTask(dropId, calendar.isScheduledChip(dropId) ? { scheduledDate: day } : { dueDate: day });
  const calUnschedule = (dropId: string) =>
    calendar.isChild(dropId)
      ? updateProject(dropId, { startDate: undefined, targetDate: undefined })
      : calendar.isTaskWindow(dropId)
        ? updateTask(dropId, { startDate: undefined, scheduledDate: undefined })
        : calendar.isScheduledChip(dropId)
          ? updateTask(dropId, { scheduledDate: undefined })
          : updateTask(dropId, { dueDate: undefined });
  const calCreateWindow = (tid: string, s: string, e: string) => updateTask(tid, { startDate: s, scheduledDate: e });
  const calItemClick = (itemId: string) =>
    calendar.isTaskWindow(itemId) ? openTask(itemId) : navigate(`/projects/${itemId}`);

  if (!project) {
    return (
      <div>
        <Link to="/projects" className={`${btnGhost} mb-6`}>
          <ArrowLeft size={15} /> All projects
        </Link>
        <EmptyState title="No such project" hint="It may have been deleted, or the link is stale." />
      </div>
    );
  }

  const parent = parentOf({ projects }, project);
  // the full ancestor chain, root first — the breadcrumb reads correctly at any nesting depth
  const ancestors: typeof projects = [];
  {
    let cursor = parent;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      ancestors.unshift(cursor);
      seen.add(cursor.id);
      cursor = parentOf({ projects }, cursor);
    }
  }
  // Every other project except this one's own descendants — moving a node into its own subtree
  // would create a cycle, so those branches are pruned entirely rather than just disabled.
  const locationOptions: { id: string; label: string }[] = [];
  {
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    const walk = (kids: typeof projects, depth: number) => {
      for (const p of [...kids].sort(byName)) {
        if (p.id === id || isDescendantOf({ projects }, p.id, id)) continue;
        locationOptions.push({ id: p.id, label: `${'    '.repeat(depth)}${p.name}` });
        walk(childProjects({ projects }, p.id), depth + 1);
      }
    };
    walk(
      projects.filter((p) => !p.archived && isTopLevel({ projects }, p)),
      0,
    );
  }
  const tasks = allTasks.filter((t) => t.projectId === id);
  const activity = allActivity.filter((e) => e.refId === id);
  const projectNotes = notes.filter((n) => n.projectId === id);
  const progress = projectProgressDeep({ tasks: allTasks, projects }, id);
  const done = tasks.filter(isDone).length;

  // Parents lead with the subproject list — the legible, always-populated default; Board and
  // Timeline are one click away via the icon toggle. Leaves lead with their task list.
  const rawView = params.get('view');
  const subView = rawView === 'timeline' ? 'timeline' : rawView === 'board' ? 'board' : 'list';
  const taskView = rawView === 'timeline' ? 'timeline' : 'list';
  const setView = (v: string, def: string) => setParams(v === def ? {} : { view: v }, { replace: true });

  const field = (label: string, node: React.ReactNode) => (
    <div>
      <SectionLabel>{label}</SectionLabel>
      {node}
    </div>
  );

  // Icon-only toggle for the subprojects switcher — List/Board/Timeline read by shape, not text,
  // so the three sit together as one compact control instead of a row of text pills.
  const viewIconBtn = (active: boolean, Icon: typeof List, label: string, onClick: () => void) => (
    <button
      key={label}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`rounded-md p-2 transition-colors ${
        active ? 'bg-raised text-ink' : 'text-ink-2 hover:bg-raised hover:text-ink'
      }`}
    >
      <Icon size={15} />
    </button>
  );

  const dateInput = (key: 'startDate' | 'targetDate', label: string) => (
    <input
      type="date"
      className={inputCls}
      value={project[key] ?? ''}
      onChange={(e) => updateProject(id, { [key]: e.target.value || undefined })}
      aria-label={label}
    />
  );

  const scaleSelect = (key: 'impact' | 'urgency', label: string) => (
    <select
      className={inputCls}
      value={project[key] ?? ''}
      onChange={(e) =>
        updateProject(id, { [key]: e.target.value ? (Number(e.target.value) as 1 | 2 | 3) : undefined })
      }
      aria-label={label}
    >
      <option value="">Unset</option>
      <option value="1">1 — low</option>
      <option value="2">2 — medium</option>
      <option value="3">3 — high</option>
    </select>
  );

  const addTaskForm = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!newTask.trim()) return;
        addTask({ title: newTask.trim(), projectId: id });
        setNewTask('');
      }}
      className="mb-3 flex gap-2"
    >
      <input
        className={inputCls}
        placeholder="Add a task to this project…"
        value={newTask}
        onChange={(e) => setNewTask(e.target.value)}
        aria-label="New project task"
      />
      <button className={btnPrimary} type="submit" disabled={!newTask.trim()}>
        <Plus size={15} />
      </button>
    </form>
  );

  const taskList = tasks.length === 0 ? (
    <p className="rounded-xl border border-dashed border-line px-4 py-3 text-xs text-dim">
      No tasks yet — the bar above is where the work starts.
    </p>
  ) : (
    <div className="space-y-2">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} showProject={false} />
      ))}
    </div>
  );

  // Include-subprojects view: the folder's own tasks, then a badged group per subproject that has
  // any. This is the list that matches the rolled-up progress/time — every task counted is on screen.
  const deepTaskList = (
    <div className="space-y-6">
      <div className="space-y-2">
        {tasks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-3 text-xs text-dim">
            Nothing on the folder itself — its work lives in the subprojects below.
          </p>
        ) : (
          tasks.map((t) => <TaskRow key={t.id} task={t} showProject={false} />)
        )}
      </div>
      {children.map((c) => {
        const childTasks = allTasks.filter((t) => t.projectId === c.id);
        if (childTasks.length === 0) return null;
        const childDone = childTasks.filter(isDone).length;
        return (
          <div key={c.id}>
            <Link
              to={`/projects/${c.id}`}
              className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted transition-colors hover:text-accent"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: project.color ?? 'var(--accent)' }}
                aria-hidden
              />
              <span className="truncate">{c.name}</span>
              <span className="tnum text-dim">
                {childDone}/{childTasks.length}
              </span>
            </Link>
            <div className="space-y-2">
              {childTasks.map((t) => (
                <TaskRow key={t.id} task={t} showProject={false} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------ header */}
      <div>
        <nav className="mb-4 flex items-center gap-1.5 text-sm text-muted">
          <Link to="/projects" className="inline-flex items-center gap-1.5 transition-colors hover:text-ink">
            <ArrowLeft size={15} /> All projects
          </Link>
          {ancestors.map((a) => (
            <span key={a.id} className="flex items-center gap-1.5">
              <ChevronRight size={13} className="text-dim" />
              <Link to={`/projects/${a.id}`} className="transition-colors hover:text-ink">
                {a.name}
              </Link>
            </span>
          ))}
          {/* the trail always ends on this project — top-level or nested, any depth */}
          <ChevronRight size={13} className="text-dim" />
          <span className="text-ink">{project.name}</span>
        </nav>
        <input
          className="font-display -mx-2 w-full rounded-md bg-transparent px-2 text-4xl font-extrabold leading-tight tracking-tight transition-colors hover:bg-raised focus:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mt-focus)]"
          value={project.name}
          onChange={(e) => updateProject(id, { name: e.target.value })}
          aria-label="Project name"
          title="Click to rename"
        />
        {parent && (
          <Link
            to={`/projects/${parent.id}`}
            className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-2xs font-semibold text-muted transition-colors hover:border-accent hover:text-accent"
          >
            Subproject of {parent.name}
          </Link>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => setProjectStatus(id, s)}
              aria-pressed={project.status === s}
              className={`h-9 rounded-md border px-3.5 text-sm transition-colors ${
                project.status === s
                  ? 'border-line-strong bg-raised font-semibold text-ink'
                  : 'border-line text-ink-2 hover:bg-raised hover:text-ink'
              }`}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <ProgressBar done={progress.done} total={progress.total} />
      </div>

      {/* ------------------------------------------------- subprojects */}
      {/* any project can hold its own subprojects, at any depth */}
      <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <SectionLabel>{`Subprojects (${children.length})`}</SectionLabel>
            {isParentProject && (
              <div className="flex items-center gap-1">
                {viewIconBtn(subView === 'list', List, 'List', () => setView('list', 'list'))}
                {viewIconBtn(subView === 'board', Kanban, 'Board', () => setView('board', 'list'))}
                {viewIconBtn(subView === 'timeline', GanttChart, 'Timeline', () => setView('timeline', 'list'))}
                {subView === 'timeline' && (
                  <button
                    onClick={() => setShowDone((v) => !v)}
                    className={`ml-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                      showDone ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-muted hover:text-ink'
                    }`}
                    aria-pressed={showDone}
                  >
                    Show done
                  </button>
                )}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newSub.trim()) return;
              const cid = addProject({ name: newSub.trim(), parentId: id });
              setNewSub('');
              navigate(`/projects/${cid}`);
            }}
            className="mb-3 flex gap-2"
          >
            <input
              className={inputCls}
              placeholder="Add a subproject…"
              value={newSub}
              onChange={(e) => setNewSub(e.target.value)}
              aria-label="New subproject name"
            />
            <button className={`${btnGhost} disabled:opacity-40`} type="submit" disabled={!newSub.trim()} aria-label="Add subproject">
              <Plus size={15} />
            </button>
          </form>

          {isParentProject && subView === 'timeline' && (
            <>
              <MonthCalendar
                month={month}
                onMonthChange={setMonth}
                items={calendar.items}
                chips={calendar.chips}
                deadlines={calendar.deadlines}
                tray={calendar.tray}
                trayLabel="Unscheduled"
                onItemClick={calItemClick}
                onMoveItem={calMove}
                onResizeItem={calMove}
                onDropExternal={calDrop}
                onUnschedule={calUnschedule}
                onCreateWindow={calCreateWindow}
              />
              <p className="mt-2 text-2xs text-dim">
                Bars are subprojects and multi-day tasks — drag to move, stretch the ends. Drag a task
                chip's edge to span it across days; the flag is a deadline.
              </p>
            </>
          )}
          {isParentProject && subView === 'board' && (
            <ProjectBoard projects={children} onOpen={(cid) => navigate(`/projects/${cid}`)} />
          )}
          {isParentProject && subView === 'list' && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                {children
                  .filter((c) => c.status !== 'shipped')
                  .map((c) => (
                    <ProjectCard key={c.id} project={c} onOpen={() => navigate(`/projects/${c.id}`)} />
                  ))}
              </div>
              {children.some((c) => c.status === 'shipped') && (
                <div>
                  <button onClick={() => setShowDone((v) => !v)} className="label transition-colors hover:text-ink">
                    {showDone ? '▾' : '▸'} {STATUS_LABEL.shipped} ({children.filter((c) => c.status === 'shipped').length})
                  </button>
                  {showDone && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {children
                        .filter((c) => c.status === 'shipped')
                        .map((c) => (
                          <ProjectCard key={c.id} project={c} onOpen={() => navigate(`/projects/${c.id}`)} />
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
      </div>

      {/* ------------------------------------------------------- tasks */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <SectionLabel>
            {isParentProject
              ? includeSubs
                ? `All tasks (${progress.done}/${progress.total})`
                : `Own tasks (${done}/${tasks.length})`
              : `Tasks (${done}/${tasks.length})`}
          </SectionLabel>
          <div className="flex gap-1">
            {isParentProject ? (
              <Segmented
                ariaLabel="Task scope"
                value={includeSubs ? 'subs' : 'folder'}
                onChange={(v) => setIncludeSubs(v === 'subs')}
                options={[
                  { value: 'folder', label: 'This folder' },
                  { value: 'subs', label: 'Include subprojects' },
                ]}
              />
            ) : (
              <>
                {viewIconBtn(taskView === 'list', List, 'List', () => setView('list', 'list'))}
                {viewIconBtn(taskView === 'timeline', GanttChart, 'Timeline', () => setView('timeline', 'list'))}
              </>
            )}
          </div>
        </div>
        {addTaskForm}
        {isParentProject && includeSubs ? (
          deepTaskList
        ) : !isParentProject && taskView === 'timeline' ? (
          <>
            <MonthCalendar
              month={month}
              onMonthChange={setMonth}
              items={calendar.items}
              chips={calendar.chips}
              deadlines={calendar.deadlines}
              tray={calendar.tray}
              trayLabel="Unscheduled"
              onItemClick={calItemClick}
              onMoveItem={calMove}
              onResizeItem={calMove}
              onDropExternal={calDrop}
              onUnschedule={calUnschedule}
              onCreateWindow={calCreateWindow}
            />
            <p className="mt-2 text-2xs text-dim">
              Chips are single-day tasks; bars are multi-day. Drag to reschedule, stretch a chip's
              edge to span days, or drop onto Unscheduled to clear it.
            </p>
          </>
        ) : (
          taskList
        )}
      </div>

      {/* ---------------------------------------------------- overview */}
      <div className="grid gap-6 md:grid-cols-2">
        {field(
          'Next step',
          <input
            className={inputCls}
            placeholder="The single next thing to do…"
            value={project.nextStep ?? ''}
            onChange={(e) => updateProject(id, { nextStep: e.target.value || undefined })}
            aria-label="Next step"
          />,
        )}
        {/* a folder carries the swatch; a subproject inherits it, so there is nothing to set */}
        {!parent &&
          field(
            'Colour',
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="h-10 w-14 cursor-pointer rounded-xl border border-line bg-surface2 p-1"
                value={project.color ?? PROJECT_COLORS[0]}
                onChange={(e) => updateProject(id, { color: e.target.value })}
                aria-label="Folder colour"
              />
              {project.color && (
                <button onClick={() => updateProject(id, { color: undefined })} className={btnGhost}>
                  Clear
                </button>
              )}
            </div>,
          )}
        {field(
          'Location',
          <select
            className={inputCls}
            value={parent?.id ?? ''}
            onChange={(e) => updateProject(id, { parentId: e.target.value || undefined })}
            aria-label="Move to folder"
          >
            <option value="">Top level</option>
            {locationOptions.map((p) => (
              <option key={p.id} value={p.id}>
                Inside {p.label}
              </option>
            ))}
          </select>,
        )}
        {field('Start date', dateInput('startDate', 'Start date'))}
        {field('Target date', dateInput('targetDate', 'Target date'))}
        {field('Impact', scaleSelect('impact', 'Impact'))}
        {field('Urgency', scaleSelect('urgency', 'Urgency'))}
        {field(
          'Tags',
          <input
            className={inputCls}
            placeholder="comma, separated, tags"
            value={project.tags.join(', ')}
            onChange={(e) =>
              updateProject(id, {
                tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
              })
            }
            aria-label="Tags"
          />,
        )}
        {field(
          'Links',
          <div className="space-y-2">
            {project.links.map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <Link2 size={14} className="shrink-0 text-accent" />
                <a
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  // the Mac app's web view follows no link itself: web and mail links open in their own app
                  onClick={(e) => {
                    e.preventDefault();
                    void openExternalUrl(l.url);
                  }}
                  className="min-w-0 flex-1 truncate text-accent hover:underline"
                >
                  {l.label || l.url}
                </a>
                <button
                  aria-label={`Remove link ${l.label}`}
                  onClick={() => updateProject(id, { links: project.links.filter((_, j) => j !== i) })}
                  className="text-dim hover:text-warn"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newLink.url.trim()) return;
                updateProject(id, { links: [...project.links, { ...newLink }] });
                setNewLink({ label: '', url: '' });
              }}
              className="flex gap-2"
            >
              <input
                className={inputCls}
                placeholder="Label"
                value={newLink.label}
                onChange={(e) => setNewLink({ ...newLink, label: e.target.value })}
                aria-label="Link label"
              />
              <input
                className={inputCls}
                placeholder="https://…"
                value={newLink.url}
                onChange={(e) => setNewLink({ ...newLink, url: e.target.value })}
                aria-label="Link URL"
              />
              <button className={btnGhost} type="submit" aria-label="Add link">
                <Plus size={15} />
              </button>
            </form>
          </div>,
        )}
      </div>

      {field(
        'Notes',
        <textarea
          className={`${inputCls} min-h-28 resize-y`}
          placeholder="Context, findings, anything worth keeping…"
          value={project.notes ?? ''}
          onChange={(e) => updateProject(id, { notes: e.target.value || undefined })}
          aria-label="Notes"
        />,
      )}

      {field('Linked entities', <LinkPicker entity={{ type: 'project', id }} />)}

      {/* -------------------------------------------------------- files */}
      <div>
        <SectionLabel>Files</SectionLabel>
        <div className="space-y-4">
          <Attachments entity={{ type: 'project', id }} />
          {projectNotes.length > 0 && (
            <div className="space-y-1.5">
              {projectNotes.map((n) => (
                <button
                  key={n.id}
                  onClick={() => navigate(`/notes/${n.id}`)}
                  className="flex w-full items-center gap-2 text-left text-xs text-muted transition-colors hover:text-ink"
                >
                  <FileText size={14} className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate">{n.title}</span>
                  <span className="shrink-0 text-dim">note</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------ history */}
      {activity.length > 0 &&
        field(
          'History',
          <ul className="space-y-1.5">
            {[...activity].reverse().slice(0, 15).map((e) => (
              <li key={e.id} className="flex items-center gap-2 text-xs text-muted">
                <span className="h-1 w-1 rounded-full bg-accent" />
                <span className="min-w-0 flex-1 truncate">{e.label}</span>
                <span className="shrink-0 text-dim">{relativeTime(e.at)}</span>
              </li>
            ))}
          </ul>,
        )}

      {/* -------------------------------------------------- danger zone */}
      <Card className="space-y-3 border-warn/30 p-5">
        <SectionLabel>Danger zone</SectionLabel>
        <button
          onClick={() => {
            if (project.archived) {
              // restoring — no undo needed, and stay on the now-active workspace
              updateProject(id, { archived: false });
            } else {
              // archiving hides the project from every list; give the same 5s way back as delete
              updateProject(id, { archived: true });
              undoable(`Archived ${project.name}`, () => updateProject(id, { archived: false }));
              navigate('/projects');
            }
          }}
          className={btnGhost}
        >
          <Archive size={15} />
          {project.archived ? 'Unarchive project' : 'Archive project'}
        </button>
        {isParentProject ? (
          <>
            {/* a folder takes its whole shape with it — the typed gate stays for that */}
            <p className="text-sm text-muted">
              Its tasks and notes stay, without a project. Its subprojects move up a level. The
              project itself goes, with any attachments nothing else uses. Type{' '}
              <span className="font-mono font-semibold text-warn">DELETE</span> to unlock.
            </p>
            <div className="flex gap-2">
              <input
                className={`${fieldCls} w-40`}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                aria-label="Type DELETE to confirm"
              />
              <button
                onClick={() => {
                  deleteWithUndo(() => deleteProject(id));
                  navigate('/projects');
                }}
                disabled={confirmText !== 'DELETE'}
                className={`${btn({ tone: 'danger' })} disabled:opacity-40`}
              >
                <Trash2 size={15} /> Delete project
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              Its tasks and notes stay, without a project. The project itself goes, with any
              attachments nothing else uses. You can undo it for a few seconds.
            </p>
            <button
              onClick={() => {
                deleteWithUndo(() => deleteProject(id));
                navigate('/projects');
              }}
              className={btn({ tone: 'danger' })}
            >
              <Trash2 size={15} /> Delete project
            </button>
          </>
        )}
      </Card>
    </div>
  );
}
