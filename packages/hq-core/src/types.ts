export type ID = string;

export type ProjectStatus = 'active' | 'blocked' | 'later' | 'shipped';
export type Priority = 'low' | 'medium' | 'high';
export type TaskStatus = 'backlog' | 'ready' | 'in_progress' | 'waiting' | 'done';

export interface ProjectLink {
  label: string;
  url: string;
}

export interface Project {
  id: ID;
  /**
   * Makes this a subproject of another project. Nesting is unlimited — a child can itself have
   * children, to any depth. In the vault this is the `parent:` frontmatter key; the nested folder
   * path (mirroring the full ancestor chain) is derived from it, never the reverse.
   *
   * There is no Area above this: a top-level project *is* the folder.
   */
  parentId?: ID;
  name: string;
  /**
   * Hex swatch for the folder — the dot on the grid, the cluster on the map. Set on top-level
   * projects; a subproject inherits its parent's via `projectColor`, so it is never stored twice.
   */
  color?: string;
  status: ProjectStatus;
  nextStep?: string;
  notes?: string;
  tags: string[];
  links: ProjectLink[];
  impact?: 1 | 2 | 3;
  urgency?: 1 | 2 | 3;
  startDate?: string; // YYYY-MM-DD — day precision, like Task.dueDate
  targetDate?: string; // YYYY-MM-DD
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: ID;
  title: string;
  projectId?: ID;
  priority: Priority;
  /**
   * A task's **work window**, day-precision like `dueDate`. When both are set the task spans
   * `[startDate, scheduledDate]` inclusive and renders as a draggable/resizable calendar bar (the
   * Obsidian Tasks 🛫 start / ⏳ scheduled tokens). `dueDate` stays an independent *deadline*.
   */
  startDate?: string; // YYYY-MM-DD — 🛫
  scheduledDate?: string; // YYYY-MM-DD — ⏳
  dueDate?: string; // YYYY-MM-DD — 📅 deadline
  focus: boolean;
  status: TaskStatus;
  /** Freeform markdown body — commands, ticket refs, checklists. Stored in `tasks/notes/<id>.md`. */
  notes?: string;
  createdAt: string;
  completedAt?: string;
}

export const isDone = (t: Task): boolean => t.status === 'done';

export const ENTITY_TYPES = ['project', 'task', 'note', 'asset'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export interface EntityRef {
  type: EntityType;
  id: ID;
}

export interface Link {
  id: ID;
  from: EntityRef;
  to: EntityRef;
  kind: 'related' | 'blocks';
}

export interface Note {
  id: ID;
  title: string;
  body: string; // markdown
  tags: string[];
  folder?: string; // path like "Home/Recipes"
  projectId?: ID;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Asset {
  id: ID;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
}

export type ActivityType =
  | 'task_created'
  | 'task_completed'
  | 'project_shipped'
  | 'project_status'
  | 'project_deleted'
  | 'note_created'
  | 'asset_added';

export interface ActivityEvent {
  id: ID;
  type: ActivityType;
  refId: ID;
  label: string;
  at: string; // ISO
}

/**
 * A calendar event: something that happens at a time, as opposed to a `Task` that gets done.
 * All dates are day precision (`YYYY-MM-DD`), times are `HH:MM` local. The event is all day
 * exactly when `start` is undefined.
 */
export interface CalEvent {
  id: ID;
  title: string;
  date: string; // YYYY-MM-DD
  start?: string; // HH:MM
  end?: string; // HH:MM
  projectId?: ID;
  location?: string;
  /** Freeform markdown body. Stored in `events/notes/<id>.md`. */
  notes?: string;
  createdAt: string; // YYYY-MM-DD
}

export interface Settings {
  userName: string;
  onboarded: boolean;
  lastExportAt?: string;
}

export interface HQData {
  version: 1;
  settings: Settings;
  projects: Project[];
  tasks: Task[];
  notes: Note[];
  links: Link[];
  assets: Asset[];
  activity: ActivityEvent[];
  events: CalEvent[];
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'On the go',
  blocked: 'On hold',
  later: 'Someday',
  shipped: 'Done',
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'In Progress',
  waiting: 'Waiting',
  done: 'Done',
};
