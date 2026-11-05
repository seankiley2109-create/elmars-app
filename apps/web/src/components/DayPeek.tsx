import { X } from 'lucide-react';
import { useHQ } from '../store';
import { tasksDueInRange } from '../selectors';
import { formatDayLong, todayStr } from '../lib/dates';
import Modal from './Modal';
import TaskRow from './TaskRow';
import { Button, SectionLabel } from './ui';
import type { CalEvent } from '../types';

/**
 * What a single day asks of you — the calendar's "work from here" surface. Opened by clicking a day
 * cell. Lists the tasks due that day and lets you tick them off in place.
 */
export default function DayPeek({
  date,
  onClose,
  onEventClick,
  onAddEvent,
}: {
  date: string;
  onClose: () => void;
  /** Open an event of the day (the Calendar's sheet). When omitted, events are listed but not clickable. */
  onEventClick?: (event: CalEvent) => void;
  /** Add an event on this day. When omitted, no button is shown. */
  onAddEvent?: (date: string) => void;
}) {
  const tasks = useHQ((s) => s.tasks);
  const allEvents = useHQ((s) => s.events);

  const dueTasks = tasksDueInRange({ tasks }, date, date);
  const events = allEvents
    .filter((e) => e.date === date)
    .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
  const isToday = date === todayStr();
  const empty = dueTasks.length === 0 && events.length === 0;

  return (
    <Modal open onClose={onClose} label={formatDayLong(date)} placement="center" className="w-[min(92vw,30rem)]">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold">{formatDayLong(date)}</h2>
            {isToday && <p className="text-2xs font-semibold text-accent">Today</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-dim transition-colors hover:text-ink">
            <X size={16} />
          </button>
        </div>

        {empty ? (
          <p className="py-6 text-center text-sm text-muted">Nothing due on this day.</p>
        ) : (
          <div className="max-h-[70vh] space-y-5 overflow-y-auto">
            {events.length > 0 && (
              <section aria-label="Events">
                <SectionLabel>Events</SectionLabel>
                <ul className="space-y-1.5">
                  {events.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        disabled={!onEventClick}
                        onClick={() => onEventClick?.(e)}
                        className="flex w-full items-baseline gap-3 rounded-md bg-raised px-3 py-2 text-left text-sm enabled:hover:brightness-95"
                      >
                        <span className="tnum w-24 shrink-0 font-mono text-xs text-ink-2">
                          {e.start ? (e.end ? `${e.start}–${e.end}` : e.start) : 'All day'}
                        </span>
                        <span className="min-w-0 truncate font-semibold">{e.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {dueTasks.length > 0 && (
              <section aria-label="Tasks due">
                <SectionLabel>Tasks due</SectionLabel>
                <div className="space-y-2">
                  {dueTasks.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
        {onAddEvent && (
          <div className="mt-4 flex justify-end">
            <Button onClick={() => onAddEvent(date)}>Add event</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
