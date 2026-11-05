import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { fullFixture } from '@hq/store-fs';

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));

import MapView from './MapView';
import { useHQ } from '../store';

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function renderMap() {
  return render(
    <MemoryRouter initialEntries={['/map']}>
      <Routes>
        <Route path="*" element={<MapView />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const detail = () => within(screen.getByTestId('map-detail'));
const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
  localStorage.clear();
  const doc = fullFixture();
  useHQ.setState({ ...doc, settings: { ...doc.settings, onboarded: true }, hydrated: true });
});
afterEach(cleanup);

describe('MapView', () => {
  it('starts on the whole picture, with the key and the three chips', () => {
    renderMap();
    expect(detail().getByText('Everything')).toBeDefined();
    expect(detail().getByText('Elmar')).toBeDefined();
    expect(screen.getByLabelText('Key')).toBeDefined();
    for (const chip of ['Tasks', 'Notes', 'Someday']) expect(screen.getByRole('button', { name: chip }).getAttribute('aria-pressed')).toBe('true');
  });

  it('draws a project with its done/total, and an on-hold project says so', () => {
    renderMap();
    const kitchen = screen.getByRole('button', { name: 'Kitchen renovation, On the go' });
    expect(kitchen.textContent).toBe('1/3');
    expect(screen.getByText('December in Knysna · on hold')).toBeDefined();
  });

  it("selecting a project shows its card and its cluster's labels, and opens the project", () => {
    renderMap();
    expect(screen.queryByText('Book the plumber')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Kitchen renovation, On the go' }));
    expect(detail().getByText('Project · On the go')).toBeDefined();
    expect(detail().getByText('1 of 3 tasks done')).toBeDefined();
    expect(detail().getByText('Next: Choose the worktop')).toBeDefined();
    expect(screen.getByText('Book the plumber')).toBeDefined(); // its task's label
    fireEvent.click(detail().getByRole('button', { name: 'Open project' }));
    expect(where()).toBe('/projects/prj_a');
  });

  it('a task opens its detail; a note opens the note', () => {
    // pinned, so it shows by itself rather than inside "n more notes"
    useHQ.setState((s) => ({ notes: s.notes.map((n) => (n.id === 'nte_trips' ? { ...n, pinned: true } : n)) }));
    renderMap();
    fireEvent.click(screen.getByRole('button', { name: 'Task: Book the plumber' }));
    expect(detail().getByText('In Kitchen renovation')).toBeDefined();
    fireEvent.click(detail().getByRole('button', { name: 'Open task' }));
    expect(where()).toBe('/map?task=tsk_a');

    fireEvent.click(screen.getByRole('button', { name: 'Note: Trip ideas' }));
    expect(detail().getByText('Note · Travel & Trips')).toBeDefined();
    expect(detail().getByText('Not in a project yet')).toBeDefined();
    fireEvent.click(detail().getByRole('button', { name: 'Open note' }));
    expect(where()).toBe('/notes/nte_trips');
  });

  it('dims the other clusters when one is selected', () => {
    renderMap();
    fireEvent.click(screen.getByRole('button', { name: 'Kitchen renovation, On the go' }));
    const other = screen.getByRole('button', { name: 'Task: Draft the packing list' });
    const own = screen.getByRole('button', { name: 'Task: Book the plumber' });
    expect(other.style.opacity).toBe('0.35');
    expect(own.style.opacity).toBe('1');
  });

  it('the chips filter the map and are remembered', () => {
    renderMap();
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(screen.queryByRole('button', { name: 'Task: Book the plumber' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Someday' }));
    expect(screen.queryByRole('button', { name: /^Cycle Tour 2027/ })).toBeNull();
    cleanup();
    renderMap();
    expect(screen.getByRole('button', { name: 'Tasks' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Someday' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Task: Book the plumber' })).toBeNull();
  });

  it('zooms in, out and back to fit', () => {
    renderMap();
    const stage = () => screen.getByTestId('map-surface').firstElementChild as HTMLElement;
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(stage().style.transform).toContain('scale(1.2)');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(stage().style.transform).not.toContain('scale(1)');
    fireEvent.click(screen.getByRole('button', { name: 'Fit everything' }));
    expect(stage().style.transform).toBe('translate(0px, 0px) scale(1)');
  });
  it('the notes nobody mentions share one node, which opens Notes', () => {
    renderMap();
    fireEvent.click(screen.getByRole('button', { name: '3 more notes, not in a project' }));
    expect(detail().getByText('Notes not in a project')).toBeDefined();
    expect(detail().getByText('3 notes that no project holds and nothing mentions')).toBeDefined();
    fireEvent.click(detail().getByRole('button', { name: 'Open notes' }));
    expect(where()).toBe('/notes');
  });

  it('calls me "You" when the name is the onboarding default', () => {
    useHQ.setState({ settings: { userName: 'there', onboarded: true } });
    renderMap();
    expect(screen.getByRole('button', { name: 'You, everything' })).toBeDefined();
  });

  describe('keyboard', () => {
    /** What Tab would visit, in order: focusable, not taken out of the tab order, not disabled. */
    const tabOrder = () =>
      [...document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')].filter(
        (el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled,
      );

    it('the whole picture is one tab stop, and Tab from a selected node reaches Open next', () => {
      renderMap();
      const kitchen = screen.getByRole('button', { name: 'Kitchen renovation, On the go' });
      fireEvent.click(kitchen);
      const nodeStops = tabOrder().filter((el) => el.closest('[data-testid="map-surface"]'));
      expect(nodeStops).toEqual([kitchen]);
      const order = tabOrder();
      const from = order.indexOf(kitchen);
      const open = detail().getByRole('button', { name: 'Open project' });
      const steps = order.indexOf(open) - from;
      expect(steps).toBeGreaterThan(0);
      expect(steps).toBeLessThanOrEqual(3);
    });

    it('arrow keys move between nodes, and Enter selects', () => {
      renderMap();
      const me = screen.getByRole('button', { name: 'Elmar, everything' });
      me.focus();
      fireEvent.keyDown(me, { key: 'ArrowRight' });
      const first = document.activeElement as HTMLElement;
      expect(first.getAttribute('aria-label')).toBe('Kitchen renovation, On the go');
      expect(first.tabIndex).toBe(0);
      expect(me.tabIndex).toBe(-1);
      fireEvent.keyDown(first, { key: 'ArrowRight' });
      expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toMatch(/^Task: |^Done: |^Note: /);
      fireEvent.keyDown(document.activeElement!, { key: 'Home' });
      expect(document.activeElement).toBe(me);
    });

    it('focusing a node off screen pans it into view, and the map never scrolls', () => {
      localStorage.setItem('hq.view.map.view', JSON.stringify({ x: -5000, y: 3000, scale: 1 }));
      renderMap();
      const stage = () => screen.getByTestId('map-surface').firstElementChild as HTMLElement;
      const offset = () => stage().style.transform.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/)!.slice(1).map(Number);
      expect(offset()).toEqual([-5000, 3000]);
      const me = screen.getByRole('button', { name: 'Elmar, everything' });
      act(() => me.focus());
      // me sits at (0.42 × 1120, 380) in the unmeasured jsdom map: on screen now, 48 px in from the edge
      const [x, y] = offset();
      const sx = 0.42 * 1120 + x;
      const sy = 380 + y;
      expect(sx).toBeGreaterThanOrEqual(48);
      expect(sx).toBeLessThanOrEqual(1120 - 48);
      expect(sy).toBeGreaterThanOrEqual(48);
      expect(sy).toBeLessThanOrEqual(760 - 48);

      const wrap = screen.getByTestId('map-wrap');
      wrap.scrollLeft = 40;
      wrap.scrollTop = 25;
      fireEvent.scroll(wrap);
      expect([wrap.scrollLeft, wrap.scrollTop]).toEqual([0, 0]);
    });

    it('clicking a node near the edge does not pan the map; only keyboard focus does', () => {
      localStorage.setItem('hq.view.map.view', JSON.stringify({ x: -5000, y: 3000, scale: 1 }));
      renderMap();
      const stage = () => screen.getByTestId('map-surface').firstElementChild as HTMLElement;
      const me = screen.getByRole('button', { name: 'Elmar, everything' });
      // a mouse click: pointerdown, then the browser focuses the button, then click
      fireEvent.pointerDown(me, { button: 0 });
      act(() => me.focus());
      fireEvent.pointerUp(me);
      fireEvent.click(me);
      expect(stage().style.transform).toBe('translate(-5000px, 3000px) scale(1)');
      // keyboard focus afterwards still reveals
      act(() => me.blur());
      act(() => me.focus());
      expect(stage().style.transform).not.toBe('translate(-5000px, 3000px) scale(1)');
    });

    it('Escape inside the map goes back to the whole picture; Escape elsewhere does not', () => {
      renderMap();
      const kitchen = screen.getByRole('button', { name: 'Kitchen renovation, On the go' });
      fireEvent.click(kitchen);
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(detail().getByText('Project · On the go')).toBeDefined();
      fireEvent.keyDown(kitchen, { key: 'Escape' });
      expect(detail().getByText('Everything')).toBeDefined();
    });
  });
});
