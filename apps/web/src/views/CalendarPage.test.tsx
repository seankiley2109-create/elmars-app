import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useHQ } from '../store';
import CalendarPage from './CalendarPage';

// Tue 3 Nov 2026, 08:05 — the week of Mon 2 to Sun 8
const NOW = new Date(2026, 10, 3, 8, 5);

function setup() {
  useHQ.getState().clearAll();
  const project = useHQ.getState().addProject({ name: 'Kitchen renovation', color: '#D64D1E' });
  const ev = useHQ.getState().addEvent({
    title: 'Dentist',
    date: '2026-11-03',
    start: '11:00',
    end: '12:00',
    projectId: project,
    location: 'Durbanville',
  });
  useHQ.getState().addEvent({ title: 'Weekly planning', date: '2026-11-02', start: '09:00', end: '10:00' });
  const task = useHQ.getState().addTask({ title: 'Call Pieter', priority: 'medium', dueDate: '2026-11-03' });
  render(
    <MemoryRouter>
      <CalendarPage />
    </MemoryRouter>,
  );
  return { project, ev, task };
}

describe('CalendarPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('opens on the current week, Monday first, with today marked and a now line in today only', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('November 2026');
    const heads = screen.getAllByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/, { exact: false });
    expect(heads.length).toBeGreaterThanOrEqual(7);
    expect(screen.getAllByRole('img', { name: /^Now, 08:05$/ })).toHaveLength(1);
    const today = screen.getByTestId('day-2026-11-03');
    expect(within(today).getByRole('img', { name: /^Now/ })).toBeTruthy();
  });

  it('draws an event in its project tint and a neutral fill without a project', () => {
    setup();
    const tinted = screen.getByText('Dentist').closest('button') as HTMLElement;
    expect(tinted.style.background).toMatch(/rgb\(249, 230, 22[34]\)|#f9e6e0/i);
    const plain = screen.getByText('Weekly planning').closest('button') as HTMLElement;
    expect(plain.style.background).toMatch(/rgb\(239, 237, 231\)|#efede7/i);
  });

  it('shows tasks due that day in the Due row and ticks them', () => {
    const { task } = setup();
    const box = screen.getByRole('checkbox', { name: /Call Pieter/ }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(useHQ.getState().tasks.find((t) => t.id === task)?.status).toBe('done');
  });

  it('opens an event to edit, saves the change, and deletes it after a confirmation', () => {
    const { ev } = setup();
    fireEvent.click(screen.getByText('Dentist'));
    const dialog = screen.getByRole('dialog', { name: 'Edit event' });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Dentist (moved)' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(useHQ.getState().events.find((e) => e.id === ev)?.title).toBe('Dentist (moved)');

    fireEvent.click(screen.getByText('Dentist (moved)'));
    const again = screen.getByRole('dialog', { name: 'Edit event' });
    fireEvent.click(within(again).getByRole('button', { name: 'Delete' }));
    expect(useHQ.getState().events.some((e) => e.id === ev)).toBe(true); // asked first
    fireEvent.click(within(again).getByRole('button', { name: 'Yes, delete' }));
    expect(useHQ.getState().events.some((e) => e.id === ev)).toBe(false);
  });

  it('clicking an empty slot opens a new event on that day', () => {
    setup();
    const col = screen.getByTestId('day-2026-11-05');
    col.getBoundingClientRect = () => ({ top: 0, left: 0, right: 100, bottom: 1296, width: 100, height: 1296, x: 0, y: 0, toJSON() {} });
    fireEvent.click(col, { clientY: 10 * 54 + 5 }); // 10:00
    const dialog = screen.getByRole('dialog', { name: 'New event' });
    expect((within(dialog).getByLabelText('Date') as HTMLInputElement).value).toBe('2026-11-05');
    expect((within(dialog).getByLabelText('Start') as HTMLInputElement).value).toBe('10:00');
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Tile showroom' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    const added = useHQ.getState().events.find((e) => e.title === 'Tile showroom');
    expect(added).toMatchObject({ date: '2026-11-05', start: '10:00' });
  });

  it('saves an all-day event without times', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'New event' }));
    const dialog = screen.getByRole('dialog', { name: 'New event' });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Public holiday' } });
    fireEvent.click(within(dialog).getByLabelText('All day'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    const added = useHQ.getState().events.find((e) => e.title === 'Public holiday');
    expect(added?.date).toBe('2026-11-03');
    expect(added?.start).toBeUndefined();
  });

  it('will not save an end before the start', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'New event' }));
    const dialog = screen.getByRole('dialog', { name: 'New event' });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Backwards' } });
    fireEvent.change(within(dialog).getByLabelText('End'), { target: { value: '08:00' } });
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('moves by week, day and month, and Today comes back', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(screen.queryByText('Dentist')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByText('Dentist')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/3 November 2026|November 3, 2026/);
    expect(screen.queryByText('Weekly planning')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(screen.getByText('Weekly planning')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('December 2026');
  });

  it('lists the week Monday to Sunday', () => {
    setup();
    const days = screen.getAllByTestId(/^day-/).map((el) => el.getAttribute('data-testid'));
    expect(days).toEqual([
      'day-2026-11-02',
      'day-2026-11-03',
      'day-2026-11-04',
      'day-2026-11-05',
      'day-2026-11-06',
      'day-2026-11-07',
      'day-2026-11-08',
    ]);
  });

  it('has no now line in a week that does not contain today', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(screen.queryByRole('img', { name: /^Now/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.getAllByRole('img', { name: /^Now/ })).toHaveLength(1);
  });

  describe('all-day events', () => {
    const addAllDay = () =>
      useHQ.getState().addEvent({ title: 'Public holiday', date: '2026-11-04' });

    it('show in the Week view and open the sheet', () => {
      setup();
      addAllDay();
      cleanup();
      render(
        <MemoryRouter>
          <CalendarPage />
        </MemoryRouter>,
      );
      const chip = within(screen.getByLabelText('All day 2026-11-04')).getByText('Public holiday');
      fireEvent.click(chip);
      const dialog = screen.getByRole('dialog', { name: 'Edit event' });
      expect((within(dialog).getByLabelText('All day') as HTMLInputElement).checked).toBe(true);
    });

    it('show in the Day view and open the sheet', () => {
      setup();
      addAllDay();
      fireEvent.click(screen.getByRole('button', { name: 'Day' }));
      expect(screen.queryByText('Public holiday')).toBeNull(); // the 3rd has none
      fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
      fireEvent.click(screen.getByText('Public holiday'));
      expect(screen.getByRole('dialog', { name: 'Edit event' })).toBeTruthy();
    });
  });

  describe('closing the sheet with edits', () => {
    const openDirty = () => {
      setup();
      fireEvent.click(screen.getByRole('button', { name: 'New event' }));
      const dialog = screen.getByRole('dialog', { name: 'New event' });
      fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Half typed' } });
      return dialog;
    };
    const stillOpenAndAsking = () => {
      expect(screen.getByRole('dialog', { name: 'New event' })).toBeTruthy();
      expect(screen.getByText('Discard changes?')).toBeTruthy();
      expect(useHQ.getState().events.some((e) => e.title === 'Half typed')).toBe(false);
    };

    it('asks before the X discards edits', () => {
      const dialog = openDirty();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      stillOpenAndAsking();
      fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
      expect(screen.queryByText('Discard changes?')).toBeNull();
      expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Half typed');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(useHQ.getState().events.some((e) => e.title === 'Half typed')).toBe(false);
    });

    it('asks before Escape discards edits', () => {
      openDirty();
      fireEvent.keyDown(window, { key: 'Escape' });
      stillOpenAndAsking();
    });

    it('asks before a click on the backdrop discards edits', () => {
      openDirty();
      fireEvent.click(document.querySelector('.fixed.inset-0.z-40') as HTMLElement);
      stillOpenAndAsking();
    });

    it('asks before Cancel discards edits', () => {
      const dialog = openDirty();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      stillOpenAndAsking();
    });

    it('closes at once when nothing changed', () => {
      setup();
      fireEvent.click(screen.getByRole('button', { name: 'New event' }));
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'New event' }));
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('says why Save is off, and ties the reason to the button', () => {
      setup();
      fireEvent.click(screen.getByRole('button', { name: 'New event' }));
      const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      const why = document.getElementById(save.getAttribute('aria-describedby') ?? '');
      expect(why?.textContent).toMatch(/title/i);
    });
  });

  describe('month view', () => {
    const toMonth = () => fireEvent.click(screen.getByRole('button', { name: 'Month' }));

    it('shows a project\'s start and target days', () => {
      setup(); // a new project starts and targets today
      toMonth();
      expect(screen.getByText('Starts: Kitchen renovation')).toBeTruthy();
      expect(screen.getByText('Target: Kitchen renovation')).toBeTruthy();
    });

    it('lists the day\'s events when you click it, rather than "nothing due"', () => {
      setup();
      toMonth();
      fireEvent.click(screen.getByText('10')); // an empty day first
      expect(screen.getByText('Nothing due on this day.')).toBeTruthy();
    });

    it('lists a day with events, and opens one from the list', () => {
      setup();
      toMonth();
      fireEvent.click(screen.getAllByText('2')[0]); // Mon 2nd: Weekly planning
      const peek = screen.getByRole('dialog');
      expect(within(peek).queryByText('Nothing due on this day.')).toBeNull();
      fireEvent.click(within(peek).getByText('Weekly planning'));
      expect(screen.getByRole('dialog', { name: 'Edit event' })).toBeTruthy();
    });

    it('seeds the clicked day for a new event, from the day sheet and from New event', () => {
      setup();
      toMonth();
      fireEvent.click(screen.getByText('10'));
      fireEvent.click(screen.getByRole('button', { name: 'Add event' }));
      expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2026-11-10');
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      fireEvent.click(screen.getByText('12'));
      fireEvent.click(screen.getByRole('button', { name: 'Close' })); // close the day sheet
      fireEvent.click(screen.getByRole('button', { name: 'New event' }));
      expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2026-11-12');
    });
  });

  it('the month view shows events and opens one in the sheet', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    fireEvent.click(screen.getByText(/11:00 Dentist/));
    expect(screen.getByRole('dialog', { name: 'Edit event' })).toBeTruthy();
  });
});
