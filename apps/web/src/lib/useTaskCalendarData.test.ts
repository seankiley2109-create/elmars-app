import { describe, expect, it } from 'vitest';
import { deriveTaskCalendarData } from './useTaskCalendarData';
import { addDays, todayStr } from './dates';
import type { Project, Task } from '../types';

const task = (over: Partial<Task>): Task => ({
  id: 't1',
  title: 'A task',
  priority: 'medium',
  focus: false,
  status: 'ready',
  createdAt: '2026-07-01T00:00:00.000Z',
  ...over,
});

const project = (over: Partial<Project>): Project => ({
  id: 'p1',
  name: 'Project',
  status: 'active',
  tags: [],
  links: [],
  archived: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...over,
});

describe('deriveTaskCalendarData', () => {
  it('builds task chips within range, toned only open or done, carrying priority + project colour', () => {
    const projects = [project({ id: 'p1', color: '#4D8DFF' })];
    const tasks = [
      // in_progress stays in the data but shows as plain open
      task({ id: 'a', status: 'in_progress', priority: 'high', dueDate: '2026-07-05', projectId: 'p1' }),
      task({ id: 'b', status: 'done', priority: 'low', dueDate: '2026-07-06' }),
    ];
    const out = deriveTaskCalendarData({ tasks, projects }, '2026-07-01', '2026-07-10');
    expect(out.chips).toEqual([
      { id: 'a', date: '2026-07-05', label: 'A task', muted: false, tone: 'dim', priority: 'high', projectColor: '#4D8DFF' },
      { id: 'b', date: '2026-07-06', label: 'A task', muted: true, tone: 'ok', priority: 'low', projectColor: undefined },
    ]);
  });

  it('excludes tasks outside the range', () => {
    const tasks = [task({ id: 'a', dueDate: '2026-08-01' })];
    const out = deriveTaskCalendarData({ tasks, projects: [] }, '2026-07-01', '2026-07-10');
    expect(out.chips).toEqual([]);
  });

  it('tray excludes done tasks and includes overdue + undated, tagging real-world overdue', () => {
    const yesterday = addDays(todayStr(), -1);
    const tasks = [
      task({ id: 'done', status: 'done', dueDate: '2026-07-01' }),
      task({ id: 'overdue', status: 'ready', dueDate: yesterday }),
      task({ id: 'undated', status: 'ready' }),
      task({ id: 'future', status: 'ready', dueDate: addDays(todayStr(), 30) }),
    ];
    const out = deriveTaskCalendarData({ tasks, projects: [] }, todayStr(), todayStr());
    const ids = out.tray.map((t) => t.id).sort();
    expect(ids).toEqual(['overdue', 'undated']);
    expect(out.tray.find((t) => t.id === 'overdue')?.overdue).toBe(true);
    expect(out.tray.find((t) => t.id === 'undated')?.overdue).toBe(false);
  });

  it('spans are empty unless includeSpans is set, and only include top-level dated projects overlapping the range', () => {
    const projects = [
      project({ id: 'top', name: 'Top', startDate: '2026-07-05', targetDate: '2026-07-08' }),
      project({ id: 'child', name: 'Child', parentId: 'top', startDate: '2026-07-05', targetDate: '2026-07-08' }),
      project({ id: 'undated', name: 'Undated' }),
    ];
    const withoutSpans = deriveTaskCalendarData({ tasks: [], projects }, '2026-07-01', '2026-07-10');
    expect(withoutSpans.spans).toEqual([]);
    const withSpans = deriveTaskCalendarData(
      { tasks: [], projects },
      '2026-07-01',
      '2026-07-10',
      { includeSpans: true },
    );
    expect(withSpans.spans.map((s) => s.id)).toEqual(['top']);
  });

  it('dayProgress mirrors dayLoadRange for the same range', () => {
    const tasks = [task({ id: 'a', status: 'done', dueDate: '2026-07-05' })];
    const out = deriveTaskCalendarData({ tasks, projects: [] }, '2026-07-05', '2026-07-05');
    expect(out.dayProgress.get('2026-07-05')).toMatchObject({ total: 1, done: 1, complete: true });
  });

  it('a windowed task becomes a bar, not a chip, and never sits in the tray', () => {
    const tasks = [task({ id: 'w', status: 'in_progress', priority: 'high', startDate: '2026-07-04', scheduledDate: '2026-07-07' })];
    const out = deriveTaskCalendarData({ tasks, projects: [] }, '2026-07-01', '2026-07-10');
    expect(out.taskBars).toEqual([
      { id: 'w', start: '2026-07-04', end: '2026-07-07', label: 'A task', tone: 'dim', kind: 'task', priority: 'high', muted: false },
    ]);
    expect(out.chips).toEqual([]);
    expect(out.tray).toEqual([]);
    expect(out.isTaskBar('w')).toBe(true);
    expect(out.isProjectSpan('w')).toBe(false);
  });

  it('a windowed task with a 📅 deadline emits a flag on the due day, not a chip', () => {
    const tasks = [task({ id: 'w', startDate: '2026-07-04', scheduledDate: '2026-07-07', dueDate: '2026-07-08' })];
    const out = deriveTaskCalendarData({ tasks, projects: [] }, '2026-07-01', '2026-07-10');
    expect(out.deadlines).toEqual([{ id: 'w', date: '2026-07-08', label: 'A task' }]);
    expect(out.chips).toEqual([]);
  });

  it('a ⏳ scheduled-alone task chips on its scheduled day and reports isScheduledChip', () => {
    const tasks = [task({ id: 's', scheduledDate: '2026-07-06' })];
    const out = deriveTaskCalendarData({ tasks, projects: [] }, '2026-07-01', '2026-07-10');
    expect(out.chips.map((c) => ({ id: c.id, date: c.date }))).toEqual([{ id: 's', date: '2026-07-06' }]);
    expect(out.taskBars).toEqual([]);
    expect(out.isScheduledChip('s')).toBe(true);
  });

  it('a 📅 due chip is anchored on the due day and is not a scheduled chip', () => {
    const tasks = [task({ id: 'd', dueDate: '2026-07-06', scheduledDate: '2026-07-05' })];
    const out = deriveTaskCalendarData({ tasks, projects: [] }, '2026-07-01', '2026-07-10');
    expect(out.chips[0]?.date).toBe('2026-07-06'); // due wins the anchor
    expect(out.isScheduledChip('d')).toBe(false);
  });

  it('isProjectSpan distinguishes a project span from a task bar', () => {
    const projects = [project({ id: 'p1', startDate: '2026-07-03', targetDate: '2026-07-08' })];
    const tasks = [task({ id: 'w', startDate: '2026-07-04', scheduledDate: '2026-07-07' })];
    const out = deriveTaskCalendarData({ tasks, projects }, '2026-07-01', '2026-07-10', { includeSpans: true });
    expect(out.isProjectSpan('p1')).toBe(true);
    expect(out.isTaskBar('p1')).toBe(false);
    expect(out.isProjectSpan('w')).toBe(false);
    expect(out.isTaskBar('w')).toBe(true);
  });
});
