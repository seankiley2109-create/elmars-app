import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('idb-keyval', () => ({
  get: async () => undefined,
  set: async () => {},
  del: async () => {},
}));

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useHQ } from '../store';
import TaskDetail from './TaskDetail';

/**
 * The task's only editing surface — before it existed, a task's title and priority were frozen
 * at creation. This pins that every field it offers actually writes through to the store.
 */
describe('TaskDetail', () => {
  beforeEach(() => useHQ.getState().clearAll());
  afterEach(cleanup);

  const setup = () => {
    const id = useHQ.getState().addTask({ title: 'orignal title', priority: 'low' });
    render(
      <MemoryRouter>
        <TaskDetail id={id} onClose={() => {}} />
      </MemoryRouter>,
    );
    return id;
  };

  it('shows the task and edits title, priority and due date through the store', () => {
    const id = setup();

    const title = screen.getByLabelText('Task title');
    fireEvent.change(title, { target: { value: 'original title' } });
    expect(useHQ.getState().tasks.find((t) => t.id === id)?.title).toBe('original title');

    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } });
    expect(useHQ.getState().tasks.find((t) => t.id === id)?.priority).toBe('high');

    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-09-01' } });
    expect(useHQ.getState().tasks.find((t) => t.id === id)?.dueDate).toBe('2026-09-01');
  });

  it('ticks the task done and open again — on screen a task is only open or done', () => {
    const id = setup();
    expect(screen.queryByRole('button', { name: 'Waiting' })).toBeNull(); // no five-status picker
    const tick = screen.getByRole('button', { name: 'Done' });
    expect(tick.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(tick);
    expect(useHQ.getState().tasks.find((t) => t.id === id)?.status).toBe('done');
    expect(tick.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(tick);
    expect(useHQ.getState().tasks.find((t) => t.id === id)?.status).toBe('ready');
  });

  it('renders nothing for a task that no longer exists', () => {
    render(
      <MemoryRouter>
        <TaskDetail id="gone" onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText('Task title')).toBeNull();
  });
});
