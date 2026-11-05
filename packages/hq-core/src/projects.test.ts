import { describe, expect, it } from 'vitest';
import { PROJECT_COLORS, nextProjectColor } from './data';
import { dayToIso } from './dates';
import { projectCard } from './selectors';
import type { Note, Project, Task } from './types';

const project = (over: Partial<Project> & { id: string }): Project => ({
  name: over.id,
  status: 'active',
  tags: [],
  links: [],
  archived: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...over,
});

const task = (over: Partial<Task> & { id: string }): Task => ({
  title: over.id,
  priority: 'medium',
  focus: false,
  status: 'ready',
  createdAt: '2026-07-01T00:00:00.000Z',
  ...over,
});

const note = (over: Partial<Note> & { id: string }): Note => ({
  title: over.id,
  body: '',
  tags: [],
  pinned: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...over,
});

describe('projectCard', () => {
  const kitchen = project({ id: 'kitchen', nextStep: 'Choose tiles', startDate: '2026-11-01', targetDate: '2026-12-15' });
  const tiles = project({ id: 'tiles', parentId: 'kitchen' });
  const garden = project({ id: 'garden' });
  const doc = {
    projects: [kitchen, tiles, garden],
    tasks: [
      task({ id: 't1', projectId: 'kitchen', status: 'done' }),
      task({ id: 't2', projectId: 'kitchen' }),
      task({ id: 't3', projectId: 'tiles', status: 'done' }),
      task({ id: 't4', projectId: 'tiles' }),
      task({ id: 't5', projectId: 'garden', status: 'done' }),
      task({ id: 't6' }),
    ],
    notes: [
      note({ id: 'n1', projectId: 'kitchen' }),
      note({ id: 'n2', projectId: 'kitchen' }),
      note({ id: 'n3', projectId: 'garden' }),
      note({ id: 'n4' }),
    ],
  };

  it("counts that project's tasks, including its subprojects', and nobody else's", () => {
    const c = projectCard(doc, kitchen);
    expect(c.done).toBe(2);
    expect(c.total).toBe(4);
  });

  it("counts only that project's notes", () => {
    expect(projectCard(doc, kitchen).notes).toBe(2);
    expect(projectCard(doc, garden).notes).toBe(1);
    expect(projectCard(doc, tiles).notes).toBe(0);
  });

  it('carries the next step and the target date', () => {
    const c = projectCard(doc, kitchen);
    expect(c.next).toBe('Choose tiles');
    expect(c.target).toBe('2026-12-15');
  });

  it('leaves next and target off when there are none', () => {
    const c = projectCard(doc, garden);
    expect(c.next).toBeUndefined();
    expect(c.target).toBeUndefined();
  });

  it('treats the born-today one-day window (start = target = created day) as no target', () => {
    const fresh = project({
      id: 'fresh',
      createdAt: dayToIso('2026-11-03'),
      startDate: '2026-11-03',
      targetDate: '2026-11-03',
    });
    expect(projectCard({ ...doc, projects: [...doc.projects, fresh] }, fresh).target).toBeUndefined();
  });

  it('shows any other target, even a one-day one chosen for another day', () => {
    const made = dayToIso('2026-11-03');
    const later = project({ id: 'l', createdAt: made, startDate: '2026-11-20', targetDate: '2026-11-20' });
    expect(projectCard({ ...doc, projects: [...doc.projects, later] }, later).target).toBe('2026-11-20');
    const noStart = project({ id: 'n', createdAt: made, targetDate: '2026-11-03' });
    expect(projectCard({ ...doc, projects: [...doc.projects, noStart] }, noStart).target).toBe('2026-11-03');
    const diff = project({ id: 'd', createdAt: made, startDate: '2026-11-01', targetDate: '2026-11-03' });
    expect(projectCard({ ...doc, projects: [...doc.projects, diff] }, diff).target).toBe('2026-11-03');
  });
});

describe('nextProjectColor', () => {
  it('starts with the first colour', () => {
    expect(nextProjectColor([])).toBe(PROJECT_COLORS[0]);
  });

  it('picks the first colour not yet in use', () => {
    expect(nextProjectColor([PROJECT_COLORS[0], PROJECT_COLORS[1]])).toBe(PROJECT_COLORS[2]);
    expect(nextProjectColor([PROJECT_COLORS[1]])).toBe(PROJECT_COLORS[0]);
  });

  it('ignores case and projects with no colour', () => {
    expect(nextProjectColor([PROJECT_COLORS[0].toLowerCase(), undefined])).toBe(PROJECT_COLORS[1]);
  });

  it('cycles round once every colour is taken', () => {
    const all = [...PROJECT_COLORS];
    expect(nextProjectColor(all)).toBe(PROJECT_COLORS[0]);
    expect(nextProjectColor([...all, '#000000'])).toBe(PROJECT_COLORS[1]);
  });
});
