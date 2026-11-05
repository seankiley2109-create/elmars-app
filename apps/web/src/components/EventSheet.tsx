import { useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useHQ } from '../store';
import { deleteWithUndo } from '../lib/undo';
import type { CalEvent } from '../types';
import Modal from './Modal';
import ProjectSelect from './ProjectSelect';
import { Button, inputCls } from './ui';

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 text-xs font-medium text-ink-2 ${className}`}>
      {label}
      {children}
    </label>
  );
}

/**
 * Add or edit one calendar event. With `event` it edits (and offers Delete, behind a confirmation);
 * without, it adds on `date`. `start` seeds the start time when you clicked an empty slot in the grid.
 */
export default function EventSheet({
  event,
  date,
  start: seedStart,
  onClose,
}: {
  event?: CalEvent;
  date: string;
  start?: string;
  onClose: () => void;
}) {
  const addEvent = useHQ((s) => s.addEvent);
  const updateEvent = useHQ((s) => s.updateEvent);
  const deleteEvent = useHQ((s) => s.deleteEvent);

  const [title, setTitle] = useState(event?.title ?? '');
  const [day, setDay] = useState(event?.date ?? date);
  const [allDay, setAllDay] = useState(event ? event.start === undefined : false);
  const [start, setStart] = useState(event?.start ?? seedStart ?? '09:00');
  const [end, setEnd] = useState(event?.end ?? '');
  const [projectId, setProjectId] = useState<string | undefined>(event?.projectId);
  const [location, setLocation] = useState(event?.location ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  // what the form held when it opened — anything different is an unsaved edit
  const [initial] = useState(() => ({ title, day, allDay, start, end, projectId, location, notes }));
  const dirty =
    title !== initial.title ||
    day !== initial.day ||
    allDay !== initial.allDay ||
    start !== initial.start ||
    end !== initial.end ||
    projectId !== initial.projectId ||
    location !== initial.location ||
    notes !== initial.notes;

  /** Every way out (Escape, backdrop, X, Cancel) comes through here: clean closes are instant, a dirty one asks first. */
  const requestClose = () => {
    if (dirty) {
      setConfirming(false);
      setDiscarding(true);
    } else {
      onClose();
    }
  };

  const endBeforeStart = !allDay && end !== '' && end <= start;
  const startMissing = !allDay && start === '';
  const whyNot =
    title.trim() === ''
      ? 'Give the event a title to save it.'
      : day === ''
        ? 'Pick a date to save it.'
        : startMissing
          ? 'Pick a start time, or tick All day.'
          : endBeforeStart
            ? 'The end has to be after the start.'
            : null;
  const canSave = whyNot === null;

  const save = () => {
    if (!canSave) return;
    const fields = {
      title: title.trim(),
      date: day,
      start: allDay ? undefined : start,
      end: allDay || end === '' ? undefined : end,
      projectId,
      location: location.trim() === '' ? undefined : location.trim(),
      notes: notes.trim() === '' ? undefined : notes,
    };
    if (event) updateEvent(event.id, fields);
    else addEvent(fields);
    onClose();
  };

  return (
    <Modal open onClose={requestClose} initialFocus={false} label={event ? 'Edit event' : 'New event'} className="w-[min(92vw,30rem)]">
      <form
        className="rounded-xl border border-line bg-panel p-5 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">{event ? 'Edit event' : 'New event'}</h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="-m-2 inline-flex h-11 w-11 items-center justify-center rounded-md text-ink-3 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <Field label="Title">
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </Field>

          <div className="flex items-end gap-3">
            <Field label="Date" className="flex-1">
              <input type="date" className={inputCls} value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
            <label className="flex h-[42px] items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#16171A]"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
              />
              All day
            </label>
          </div>

          {!allDay && (
            <div className="flex gap-3">
              <Field label="Start" className="flex-1">
                <input type="time" className={`${inputCls} tnum font-mono`} value={start} onChange={(e) => setStart(e.target.value)} />
              </Field>
              <Field label="End" className="flex-1">
                <input type="time" className={`${inputCls} tnum font-mono`} value={end} onChange={(e) => setEnd(e.target.value)} />
              </Field>
            </div>
          )}

          <Field label="Project">
            <ProjectSelect value={projectId} onChange={setProjectId} label="Project" />
          </Field>
          <Field label="Location">
            <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          <Field label="Note">
            <textarea className={`${inputCls} min-h-20 resize-y`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        {whyNot && (
          <p id="event-why-not" role="status" className="mt-3 text-xs text-ink-2">
            {whyNot}
          </p>
        )}

        {discarding ? (
          <div className="mt-5 flex items-center gap-2">
            <span className="text-sm text-ink-2">Discard changes?</span>
            <span className="flex-1" />
            <Button variant="quiet" onClick={() => setDiscarding(false)} autoFocus>
              Keep editing
            </Button>
            <Button variant="secondary" className="border-crit text-crit" onClick={onClose}>
              Discard
            </Button>
          </div>
        ) : (
        <div className="mt-5 flex items-center gap-2">
          {event && !confirming && (
            <Button variant="quiet" className="text-crit" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
          {event && confirming && (
            <>
              <span className="text-sm text-ink-2">Delete this event?</span>
              <Button
                variant="secondary"
                className="border-crit text-crit"
                onClick={() => {
                  deleteWithUndo(() => deleteEvent(event.id));
                  onClose();
                }}
              >
                Yes, delete
              </Button>
              <Button variant="quiet" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </>
          )}
          <span className="flex-1" />
          <Button variant="quiet" onClick={requestClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!canSave} aria-describedby={whyNot ? 'event-why-not' : undefined}>
            Save
          </Button>
        </div>
        )}
      </form>
    </Modal>
  );
}
