import { describe, expect, it } from 'vitest';
import type { CalEvent, Note, Project, Task } from './types';
import { comingUp, eventsOn, greeting, projectProgress, recentNotes, todayTasks } from './selectors';

const TODAY = '2026-11-03';

const task = (id: string, o: Partial<Task> = {}): Task => ({
  id,
  title: id,
  priority: 'medium',
  focus: false,
  status: 'ready',
  createdAt: '2026-10-01T00:00:00.000Z',
  ...o,
});

const project = (id: string, o: Partial<Project> = {}): Project => ({
  id,
  name: id,
  status: 'active',
  tags: [],
  links: [],
  archived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...o,
});

const note = (id: string, updatedAt: string): Note => ({
  id,
  title: id,
  body: '',
  tags: [],
  pinned: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt,
});

const event = (id: string, o: Partial<CalEvent> = {}): CalEvent => ({
  id,
  title: id,
  date: TODAY,
  createdAt: '2026-10-01',
  ...o,
});

// completedAt is stored at local midnight of its day (see normalizeToDay)
const midnight = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toISOString();
};

describe('todayTasks', () => {
  it('lists overdue before today, then by priority', () => {
    const tasks = [
      task('today-low', { dueDate: TODAY, priority: 'low' }),
      task('today-high', { dueDate: TODAY, priority: 'high' }),
      task('overdue-low', { dueDate: '2026-10-31', priority: 'low' }),
      task('future', { dueDate: '2026-11-04' }),
      task('undated'),
    ];
    expect(todayTasks({ tasks }, TODAY).map((t) => t.id)).toEqual(['overdue-low', 'today-high', 'today-low']);
  });

  it("puts tasks completed today after the open ones, and leaves out yesterday's", () => {
    const tasks = [
      task('done-today', { dueDate: TODAY, status: 'done', completedAt: midnight(TODAY) }),
      task('done-yesterday', { dueDate: '2026-11-02', status: 'done', completedAt: midnight('2026-11-02') }),
      task('open', { dueDate: TODAY }),
    ];
    expect(todayTasks({ tasks }, TODAY).map((t) => t.id)).toEqual(['open', 'done-today']);
  });
});

describe('comingUp', () => {
  it('covers tomorrow to day +6, by date, and excludes today, day +7 and done tasks', () => {
    const tasks = [
      task('d7', { dueDate: '2026-11-10' }),
      task('d6', { dueDate: '2026-11-09' }),
      task('d2', { dueDate: '2026-11-05' }),
      task('d0', { dueDate: TODAY }),
      task('d1-done', { dueDate: '2026-11-04', status: 'done', completedAt: midnight(TODAY) }),
    ];
    expect(comingUp({ tasks }, TODAY).map((t) => t.id)).toEqual(['d2', 'd6']);
  });
});

describe('recentNotes', () => {
  it('returns the n most recently edited', () => {
    const notes = [
      note('a', '2026-11-01T10:00:00.000Z'),
      note('c', '2026-11-03T10:00:00.000Z'),
      note('b', '2026-11-02T10:00:00.000Z'),
    ];
    expect(recentNotes({ notes }, 2).map((n) => n.id)).toEqual(['c', 'b']);
  });
});

describe('eventsOn', () => {
  it('lists all-day first, then by start, for that date only', () => {
    const events = [
      event('late', { start: '16:30' }),
      event('allday'),
      event('early', { start: '08:30' }),
      event('other-day', { date: '2026-11-04', start: '07:00' }),
    ];
    expect(eventsOn({ events }, TODAY).map((e) => e.id)).toEqual(['allday', 'early', 'late']);
  });
});

describe('projectProgress', () => {
  it('counts done of total for on-the-go and on-hold folders, in board order', () => {
    const projects = [
      project('p1'),
      project('p2', { status: 'blocked' }),
      project('later', { status: 'later' }),
      project('gone', { archived: true }),
      project('kid', { parentId: 'p1' }),
    ];
    const tasks = [
      task('a', { projectId: 'p1', status: 'done' }),
      task('b', { projectId: 'p1' }),
      task('c', { projectId: 'kid' }),
      task('d', { projectId: 'later' }),
    ];
    const rows = projectProgress({ projects, tasks });
    expect(rows.map((r) => [r.project.id, r.done, r.total])).toEqual([
      ['p1', 1, 3],
      ['p2', 0, 0],
    ]);
  });
});

describe('greeting', () => {
  it('changes at 12 and 17', () => {
    expect(greeting(11)).toBe('Good morning');
    expect(greeting(12)).toBe('Good afternoon');
    expect(greeting(16)).toBe('Good afternoon');
    expect(greeting(17)).toBe('Good evening');
  });
});
