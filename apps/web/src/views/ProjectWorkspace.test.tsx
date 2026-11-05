import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const t = vi.hoisted(() => ({ openUrl: vi.fn(async (_u: string) => {}) }));
vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));
vi.mock('../lib/platform', () => ({ isTauri: () => true, onAppFocus: () => () => {} }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (u: string) => t.openUrl(u) }));

import ProjectWorkspace from './ProjectWorkspace';
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
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  t.openUrl.mockClear();
  useHQ.setState({
    projects: [
      proj({
        id: 'k',
        name: 'Kitchen',
        links: [
          { label: 'Supplier', url: 'https://tiles.example.com/order' },
          { label: 'Builder', url: 'mailto:builder@example.com' },
          { label: 'Old note', url: 'evernote:///view/1/s1/a/a/' },
        ],
      }),
    ],
    tasks: [],
    notes: [],
    events: [],
    hydrated: true,
  });
});
afterEach(cleanup);

const renderWorkspace = () =>
  render(
    <MemoryRouter initialEntries={['/projects/k']}>
      <Routes>
        <Route path="/projects/:id" element={<ProjectWorkspace />} />
      </Routes>
    </MemoryRouter>,
  );

describe('a project’s links', () => {
  it('open web and mail links in their own app', async () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('link', { name: 'Supplier' }));
    fireEvent.click(screen.getByRole('link', { name: 'Builder' }), { metaKey: true });
    await vi.waitFor(() => expect(t.openUrl).toHaveBeenCalledTimes(2));
    expect(t.openUrl.mock.calls.map((c) => c[0])).toEqual(['https://tiles.example.com/order', 'mailto:builder@example.com']);
  });

  it('never open any other scheme', async () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('link', { name: 'Old note' }), { metaKey: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(t.openUrl).not.toHaveBeenCalled();
  });
});

describe('deleting a project says plainly what stays', () => {
  it('in plain words', () => {
    renderWorkspace();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Its tasks and notes stay, without a project.');
    expect(text).not.toMatch(/graph links|promotes|toast/);
  });
});
