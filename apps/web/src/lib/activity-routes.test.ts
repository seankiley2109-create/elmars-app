import { describe, expect, it } from 'vitest';
import { activityRoute } from './activity-routes';
import type { ActivityEvent, HQData } from '../types';

type Slices = Parameters<typeof activityRoute>[1];

const empty: Slices = { tasks: [], projects: [], notes: [] };

const ev = (type: ActivityEvent['type'], refId: string): ActivityEvent => ({
  id: 'e1',
  type,
  refId,
  label: 'x',
  at: '2026-07-17T08:00:00.000Z',
});

describe('activityRoute', () => {
  it('routes each event type to its entity', () => {
    const s: Slices = {
      tasks: [{ id: 't1' }] as HQData['tasks'],
      projects: [{ id: 'p1' }] as HQData['projects'],
      notes: [{ id: 'n1' }] as HQData['notes'],
    };
    expect(activityRoute(ev('task_created', 't1'), s)).toBe('?task=t1');
    expect(activityRoute(ev('task_completed', 't1'), s)).toBe('?task=t1');
    expect(activityRoute(ev('project_shipped', 'p1'), s)).toBe('/projects/p1');
    expect(activityRoute(ev('project_status', 'p1'), s)).toBe('/projects/p1');
    expect(activityRoute(ev('note_created', 'n1'), s)).toBe('/notes/n1');
  });

  it('returns null when the referent no longer exists — the row renders plain', () => {
    expect(activityRoute(ev('task_completed', 'gone'), empty)).toBeNull();
    expect(activityRoute(ev('project_status', 'gone'), empty)).toBeNull();
    expect(activityRoute(ev('note_created', 'gone'), empty)).toBeNull();
  });

  it('never routes deletions or asset noise', () => {
    expect(activityRoute(ev('project_deleted', 'p1'), empty)).toBeNull();
    expect(activityRoute(ev('asset_added', 'a1'), empty)).toBeNull();
  });
});
