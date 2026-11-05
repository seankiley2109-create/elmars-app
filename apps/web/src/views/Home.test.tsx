import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useHQ } from '../store';
import Home from './Home';

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));

const stamp = (d: string) => new Date(`${d}T00:00:00`).toISOString();

function seed(): void {
  useHQ.setState({
    hydrated: true,
    settings: { userName: 'Elmar', onboarded: true },
    projects: [
      {
        id: 'prj_k',
        name: 'Kitchen renovation',
        color: '#D64D1E',
        status: 'active',
        tags: [],
        links: [],
        archived: false,
        createdAt: stamp('2026-10-01'),
        updatedAt: stamp('2026-10-01'),
      },
    ],
    tasks: [
      { id: 't1', title: 'Renew the licence disc', priority: 'medium', focus: false, status: 'ready', dueDate: '2026-10-31', createdAt: stamp('2026-10-01') },
      { id: 't2', title: 'Call Pieter', projectId: 'prj_k', priority: 'medium', focus: false, status: 'ready', dueDate: '2026-11-03', createdAt: stamp('2026-10-01') },
      { id: 't3', title: 'Book flights', priority: 'medium', focus: false, status: 'ready', dueDate: '2026-11-05', createdAt: stamp('2026-10-01') },
    ],
    notes: [],
    events: [
      { id: 'e1', title: 'Leadership check-in', date: '2026-11-03', start: '08:30', end: '09:15', location: 'Office', createdAt: '2026-10-01' },
      { id: 'e2', title: 'Dentist', date: '2026-11-03', start: '11:00', end: '12:00', createdAt: '2026-10-01' },
    ],
    links: [],
    assets: [],
    activity: [],
  });
}

function renderHome() {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(2026, 10, 3, 8, 5)); // Tuesday 3 November, 08:05
  seed();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Today', () => {
  it('greets by the hour, with the date line and the pills', () => {
    renderHome();
    expect(screen.getByText('Tuesday 3 November')).toBeDefined();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Good morning, Elmar');
    expect(screen.getByText('Overdue · 31 Oct')).toBeDefined();
    expect(screen.getByText('Today', { selector: 'span' })).toBeDefined();
    expect(screen.getByText('2 left, 0 done')).toBeDefined();
    expect(screen.getByText('Thu 5 Nov')).toBeDefined();
  });

  it('ticks a task in place and shows it as done', () => {
    renderHome();
    fireEvent.click(screen.getByLabelText('Complete "Call Pieter"'));
    expect(useHQ.getState().tasks.find((t) => t.id === 't2')?.status).toBe('done');
    expect(screen.getByText('Done', { selector: 'span' })).toBeDefined();
    expect(screen.getByText('1 left, 1 done')).toBeDefined();
  });

  it('puts "In n min" on the next event when it is under an hour away, and not on later ones', () => {
    renderHome();
    expect(screen.getByText('In 25 min')).toBeDefined();
    expect(screen.queryAllByText(/^In \d+ min$/)).toHaveLength(1);
  });

  it('captures into a project with @ and dates it today', () => {
    renderHome();
    const input = screen.getByPlaceholderText(/^Capture a task for today/);
    fireEvent.change(input, { target: { value: 'Order tiles @kitch' } });
    fireEvent.submit(input.closest('form')!);
    expect(useHQ.getState().tasks.find((t) => t.title === 'Order tiles')).toMatchObject({
      projectId: 'prj_k',
      dueDate: '2026-11-03',
    });
  });

  it('says so in a sentence when there is nothing', () => {
    useHQ.setState({ tasks: [], events: [], projects: [] });
    renderHome();
    expect(screen.getByText('Nothing due today.')).toBeDefined();
    expect(screen.getByText('Nothing due in the next week.')).toBeDefined();
    expect(screen.getByText('No notes yet.')).toBeDefined();
    expect(screen.getByText('Nothing on the calendar today.')).toBeDefined();
    expect(screen.getByText('No projects on the go.')).toBeDefined();
  });
});
