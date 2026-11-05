import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));

import Projects, { ProjectCard } from './Projects';
import CommandPalette from '../components/CommandPalette';
import { useHQ } from '../store';
import type { Project } from '../types';

const iso = '2026-11-03T00:00:00.000Z';
const proj = (over: Partial<Project> & { id: string }): Project => ({
  name: over.id,
  status: 'active',
  tags: [],
  links: [],
  archived: false,
  createdAt: iso,
  updatedAt: iso,
  ...over,
});

beforeAll(() => {
  // jsdom has neither of these; the palette's list (cmdk) uses both
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  useHQ.setState({
    projects: [proj({ id: 'a', name: 'Alpha' }), proj({ id: 'old', name: 'Old one', archived: true })],
    tasks: [],
    notes: [],
    events: [],
    hydrated: true,
  });
});
afterEach(cleanup);

const renderProjects = (initial: string | { pathname: string; state?: unknown } = '/projects') =>
  render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/projects" element={<Projects />} />
        <Route path="/" element={<p>home</p>} />
      </Routes>
    </MemoryRouter>,
  );

const composerInput = (col: string) => screen.queryByLabelText(`New project name — ${col}`) as HTMLInputElement | null;

describe('Projects add form', () => {
  it('⌘K "New project" lands on Projects with the On the go form open and focused', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <CommandPalette open onClose={() => {}} onCapture={() => {}} />
        <Routes>
          <Route path="/projects" element={<Projects />} />
          <Route path="/" element={<p>home</p>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('New project'));
    const input = composerInput('On the go');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('opens from router state once, then clears it', () => {
    renderProjects({ pathname: '/projects', state: { adding: 'active' } });
    expect(composerInput('On the go')).not.toBeNull();
    // closing it must not bring it back (the state was cleared, not left to re-fire)
    fireEvent.click(screen.getByText('Cancel'));
    expect(composerInput('On the go')).toBeNull();
  });

  it('"New project" from the archive goes back to current projects and opens the form', () => {
    renderProjects();
    fireEvent.click(screen.getByText('Archived (1)'));
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByText('Old one')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /New project/ }));
    expect(screen.getByText('Alpha')).toBeDefined();
    expect(screen.queryByText('Old one')).toBeNull();
    expect(composerInput('On the go')).not.toBeNull();
  });

  it('an open form does not survive a trip to the archive and back', () => {
    renderProjects();
    fireEvent.click(screen.getByLabelText('Add a project to Someday'));
    expect(composerInput('Someday')).not.toBeNull();
    fireEvent.click(screen.getByText('Archived (1)'));
    fireEvent.click(screen.getByText('Show current'));
    expect(composerInput('Someday')).toBeNull();
  });

  it('returns focus to the "+" that opened the form, on cancel and on add', () => {
    renderProjects();
    const plus = screen.getByLabelText('Add a project to Someday');
    fireEvent.click(plus);
    fireEvent.click(screen.getByText('Cancel'));
    expect(document.activeElement).toBe(plus);

    fireEvent.click(plus);
    fireEvent.change(composerInput('Someday')!, { target: { value: 'Learn to sail' } });
    fireEvent.click(screen.getByText('Add'));
    expect(useHQ.getState().projects.some((p) => p.name === 'Learn to sail' && p.status === 'later')).toBe(true);
    expect(document.activeElement).toBe(plus);
  });

  it('Escape closes the form and returns focus', () => {
    renderProjects();
    const plus = screen.getByLabelText('Add a project to On hold');
    fireEvent.click(plus);
    fireEvent.keyDown(composerInput('On hold')!, { key: 'Escape' });
    expect(composerInput('On hold')).toBeNull();
    expect(document.activeElement).toBe(plus);
  });
});

describe('ProjectCard', () => {
  it('puts no block element inside its button', () => {
    const { container } = render(
      <MemoryRouter>
        <ProjectCard project={proj({ id: 'a', name: 'Alpha', nextStep: 'Call' })} onOpen={() => {}} />
      </MemoryRouter>,
    );
    const button = container.querySelector('button')!;
    expect(button.querySelector('div, p, h1, h2, h3, ul, section')).toBeNull();
    expect(button.textContent).toContain('Alpha');
  });
});
