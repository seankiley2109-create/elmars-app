import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { fullFixture } from '@hq/store-fs';

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));

import Sidebar, { NAV_ITEMS } from './Sidebar';
import { useHQ } from '../store';

function renderSidebar(route = '/', onSearch = () => {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Sidebar onSearch={onSearch} />
    </MemoryRouter>,
  );
}

const rail = () => screen.getByRole('complementary');

beforeEach(() => {
  localStorage.clear();
  const doc = fullFixture();
  useHQ.setState({ ...doc, settings: { ...doc.settings, onboarded: true }, hydrated: true });
});
afterEach(cleanup);

describe('Sidebar', () => {
  it('shows the name tile, "Personal" and the search button with ⌘K', () => {
    const onSearch = vi.fn();
    renderSidebar('/', onSearch);
    expect(within(rail()).getByText('Elmar')).toBeDefined();
    expect(within(rail()).getByText('Personal')).toBeDefined();
    const search = within(rail()).getByRole('button', { name: /Search everything/ });
    expect(search.textContent).toContain('⌘K');
    fireEvent.click(search);
    expect(onSearch).toHaveBeenCalledOnce();
  });

  it('lists the five places and marks the open one', () => {
    renderSidebar('/calendar');
    const nav = within(rail()).getByRole('navigation', { name: 'Main' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.textContent?.replace(/\d+$/, ''))).toEqual(NAV_ITEMS.map((n) => n.label));
    const current = links.find((a) => a.getAttribute('aria-current') === 'page');
    expect(current?.textContent).toBe('Calendar');
    expect(current?.className).toContain('signal-tick');
  });

  it('lists the top-level On the go and On hold projects, each with its colour dot', () => {
    renderSidebar();
    const list = within(rail()).getByRole('list', { name: 'Projects' });
    const names = within(list).getAllByRole('link').map((a) => a.textContent);
    expect(names).toEqual(['Kitchen renovation', 'December in Knysna', 'Board pack Q4']);
    const kitchen = within(list).getByRole('link', { name: 'Kitchen renovation' });
    expect(kitchen.querySelector('[data-dot]')?.getAttribute('style')).toMatch(/background/);
  });

  it('says where things are saved, and links to settings', () => {
    renderSidebar();
    expect(within(rail()).getByText('Saved on this Mac only')).toBeDefined();
    const settings = within(rail()).getByRole('link', { name: 'Settings' });
    expect(settings.getAttribute('href')).toBe('/settings');
    // a 44×44 hit area, pulled into the footer's padding so the footer keeps its height
    expect(settings.className).toMatch(/\bh-11\b/);
    expect(settings.className).toMatch(/\bw-11\b/);
    expect(settings.className).toMatch(/-my-3\b/);
    cleanup();
    localStorage.setItem('elmar.vaultPath', '/Users/elmar/Library/Mobile Documents/com~apple~CloudDocs/Elmar');
    renderSidebar();
    expect(within(rail()).getByText('Saved on this Mac · iCloud Drive')).toBeDefined();
  });
});

describe('Sidebar Today count', () => {
  afterEach(() => vi.useRealTimers());

  it('rolls over with the day on focus, without any task changing', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(2026, 10, 3, 23, 59, 30));
    const task = (id: string, dueDate: string) => ({
      id,
      title: id,
      priority: 'medium' as const,
      focus: false,
      status: 'ready' as const,
      dueDate,
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    useHQ.setState({ tasks: [task('a', '2026-11-03'), task('b', '2026-11-04')] });
    renderSidebar();
    const today = () => within(rail()).getByRole('link', { name: /^Today/ }).textContent;
    expect(today()).toBe('Today1');

    vi.setSystemTime(new Date(2026, 10, 4, 0, 0, 30));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(today()).toBe('Today2');
  });
});
