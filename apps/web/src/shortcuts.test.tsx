import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { fullFixture } from '@hq/store-fs';

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));
vi.mock('./lib/vault-boot', () => ({
  useVaultBoot: () => [{ kind: 'ready' }, () => {}],
  grantVault: vi.fn(),
  openVault: vi.fn(),
  skipVault: vi.fn(),
}));

import App from './App';
import { useHQ } from './store';

function Where() {
  const { pathname } = useLocation();
  return <output data-testid="where">{pathname}</output>;
}

function renderApp(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
      <Where />
    </MemoryRouter>,
  );
}

const key = (init: KeyboardEventInit) =>
  act(() => {
    fireEvent.keyDown(window, init);
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
  localStorage.clear();
  const doc = fullFixture();
  useHQ.setState({ ...doc, settings: { ...doc.settings, onboarded: true }, hydrated: true });
});
afterEach(cleanup);

describe('capture', () => {
  it('⌘N opens the capture bar and @ files the task under a project', () => {
    renderApp('/map');
    key({ key: 'n', metaKey: true });
    const input = screen.getByLabelText('Capture a task');
    fireEvent.change(input, { target: { value: 'Call Pieter @kitch' } });
    expect(screen.getByText('Kitchen renovation', { selector: 'span.font-semibold' })).toBeDefined();
    fireEvent.submit(input.closest('form')!);
    const added = useHQ.getState().tasks.find((t) => t.title === 'Call Pieter');
    expect(added).toMatchObject({ projectId: 'prj_a', status: 'ready' });
    expect(screen.queryByLabelText('Capture a task')).toBeNull();
  });

  it('never drops typed text: a line that is only a project stays open with a hint', () => {
    renderApp('/map');
    const before = useHQ.getState().tasks.length;
    key({ key: 'n', metaKey: true });
    const input = screen.getByLabelText('Capture a task') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '@kitchen' } });
    fireEvent.submit(input.closest('form')!);
    expect(useHQ.getState().tasks.length).toBe(before);
    expect(screen.getByLabelText('Capture a task')).toBe(input);
    expect(input.value).toBe('@kitchen');
    expect(screen.getByText('Add what to do, then press Enter')).toBeDefined();
    // the hint goes once he types on
    fireEvent.change(input, { target: { value: '@kitchen measure' } });
    expect(screen.queryByText('Add what to do, then press Enter')).toBeNull();
  });

  it('keeps the draft when the bar closes without adding, by Escape or by ⌘K', () => {
    renderApp('/map');
    key({ key: 'n', metaKey: true });
    fireEvent.change(screen.getByLabelText('Capture a task'), { target: { value: 'Buy grout' } });
    key({ key: 'k', metaKey: true }); // search takes over
    expect(screen.queryByLabelText('Capture a task')).toBeNull();
    expect(screen.getByPlaceholderText('Search everything…')).toBeDefined();
    key({ key: 'n', metaKey: true }); // back to capture: the draft is still there
    expect((screen.getByLabelText('Capture a task') as HTMLInputElement).value).toBe('Buy grout');
    key({ key: 'Escape' });
    expect(screen.queryByLabelText('Capture a task')).toBeNull();
    key({ key: 'n', metaKey: true });
    const input = screen.getByLabelText('Capture a task') as HTMLInputElement;
    expect(input.value).toBe('Buy grout');
    // once added, the bar starts empty
    fireEvent.submit(input.closest('form')!);
    key({ key: 'n', metaKey: true });
    expect((screen.getByLabelText('Capture a task') as HTMLInputElement).value).toBe('');
  });

  it('Ctrl+N works too, and the bare c key no longer captures', () => {
    renderApp('/map');
    key({ key: 'c' });
    expect(screen.queryByLabelText('Capture a task')).toBeNull();
    key({ key: 'n', ctrlKey: true });
    expect(screen.getByLabelText('Capture a task')).toBeDefined();
  });
});

describe('focus', () => {
  it('the capture and search bars ring the whole bar when their bare input has keyboard focus', () => {
    renderApp('/map');
    key({ key: 'n', metaKey: true });
    expect(screen.getByLabelText('Capture a task').closest('form')!.className).toContain(
      'has-[:focus-visible]:outline-2',
    );
    key({ key: 'k', metaKey: true });
    expect(screen.getByPlaceholderText('Search everything…').closest('[cmdk-root]')!.className).toContain(
      'has-[:focus-visible]:outline-2',
    );
  });
});

describe('search', () => {
  it('⌘K searches note bodies and Enter opens the highlighted result', () => {
    renderApp('/');
    key({ key: 'k', metaKey: true });
    const input = screen.getByPlaceholderText('Search everything…');
    fireEvent.change(input, { target: { value: 'apricot' } });
    // Today's own recent-notes card shows the same note, so look inside the palette
    expect(within(input.closest('[cmdk-root]') as HTMLElement).getByText(/Garlic, lemon, apricot jam/)).toBeDefined();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('where').textContent).toBe('/notes/nte_braai');
  });

  it('the sidebar search button opens it', () => {
    renderApp('/');
    fireEvent.click(screen.getByRole('button', { name: /Search everything/ }));
    expect(screen.getByPlaceholderText('Search everything…')).toBeDefined();
  });

  it('g then a letter still goes to a place', () => {
    renderApp('/');
    key({ key: 'g' });
    key({ key: 'c' });
    expect(screen.getByTestId('where').textContent).toBe('/calendar');
  });
});
