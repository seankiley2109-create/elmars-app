import type { ActivityEvent, HQData } from '../types';

type Slices = Pick<HQData, 'tasks' | 'projects' | 'notes'>;

/**
 * Where an activity row takes you. `null` when the referent no longer exists (or never routed) —
 * the row renders plain, exactly as it always did. Tasks return a bare `?task=` search string:
 * react-router keeps the current pathname, so the detail opens right where you are.
 */
export function activityRoute(e: ActivityEvent, s: Slices): string | null {
  const has = (list: { id: string }[]) => list.some((x) => x.id === e.refId);
  switch (e.type) {
    case 'task_created':
    case 'task_completed':
      return has(s.tasks) ? `?task=${e.refId}` : null;
    case 'project_shipped':
    case 'project_status':
      return has(s.projects) ? `/projects/${e.refId}` : null;
    case 'project_deleted':
      return null; // the one event whose referent is gone by definition
    case 'note_created':
      return has(s.notes) ? `/notes/${e.refId}` : null;
    case 'asset_added':
      return null; // an asset opens from its owner's attachments, not from the stream
  }
}
