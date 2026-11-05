import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { useHQ } from '../store';
import { delAssetBlob, putAssetBlob as savedBlob } from '../lib/assets';
import { importEnexFiles, ORIGINAL_NAME, type ImportDeps, type ImportReport, type NoteRef } from '../lib/evernote/import';
import Modal from './Modal';
import { Button } from './ui';

type Phase =
  | { kind: 'start' }
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'report'; report: ImportReport }
  | { kind: 'broken'; reason: string };

const TITLE = 'Bring your Evernote notes';
/** Every control in the sheet is at least 44px tall. */
const TALL = 'h-11';

/** `1 note`, `8 notes`. */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** `a`, `a and b`, `a, b and c`. */
function listOf(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** Lets the screen paint between notes. */
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * The Evernote import, as a sheet: how to export from Evernote, then the files, then progress note by
 * note, then a report in plain words. Opened from first launch and from Settings.
 */
export default function EvernoteImport({
  open,
  onClose,
  putAssetBlob = savedBlob,
  onRunningChange,
}: {
  open: boolean;
  onClose: () => void;
  /** Where attachment bytes go; the app's own store unless a test passes another. */
  putAssetBlob?: ImportDeps['putAssetBlob'];
  /** Told when an import starts and ends, so the app can hold its shortcuts meanwhile. */
  onRunningChange?: (running: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'start' });
  const fileRef = useRef<HTMLInputElement>(null);
  const running = phase.kind === 'importing';

  // While notes are coming in, closing the window would cut the import short: ask first.
  useEffect(() => {
    if (!running) return;
    onRunningChange?.(true);
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => {
      window.removeEventListener('beforeunload', guard);
      onRunningChange?.(false);
    };
  }, [running, onRunningChange]);

  const close = () => {
    if (phase.kind === 'importing') return; // it finishes first; the report says what came across
    setPhase({ kind: 'start' });
    onClose();
  };

  const run = async (picked: File[]) => {
    if (picked.length === 0) return;
    setPhase({ kind: 'importing', done: 0, total: 0 });
    try {
      // Each file is read when its turn comes, so only one is held at a time.
      const report = await importEnexFiles(
        picked.map((f) => ({ name: f.name, read: () => readText(f) })),
        {
          store: useHQ.getState(),
          putAssetBlob,
          delAssetBlob,
          onProgress: async (done, total) => {
            setPhase({ kind: 'importing', done, total });
            await nextFrame();
          },
        },
      );
      setPhase({ kind: 'report', report });
    } catch {
      // Never leave the sheet stuck on progress, and never show a raw error: say it plainly.
      setPhase({ kind: 'broken', reason: 'Something unexpected went wrong.' });
    }
  };

  return (
    <Modal open={open} onClose={close} label={TITLE} className="w-[min(92vw,34rem)]">
      <div className="max-h-[86vh] overflow-y-auto rounded-xl border border-line bg-panel p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-display text-xl font-bold">
            {phase.kind === 'report'
              ? reportTitle(phase.report)
              : phase.kind === 'broken'
                ? 'The import stopped partway'
                : TITLE}
          </h2>
          {phase.kind !== 'importing' && (
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="-m-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-3 hover:text-ink"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {phase.kind === 'start' && (
          <>
            <p className="text-sm text-ink-2">
              Your notes come across with their attachments, tags, tasks and dates. Nothing in Evernote changes.
            </p>
            <ol className="mt-5 space-y-4">
              <Step n={1} title="Export each notebook from Evernote">
                In Evernote, right-click a notebook, choose <b>Export notebook…</b> and save it as an{' '}
                <b>.enex</b> file. Do this for each notebook you want here.
              </Step>
              <Step n={2} title="Choose the files">
                Pick the .enex files you saved. You can choose several at once.
              </Step>
            </ol>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".enex"
              className="hidden"
              aria-label="Evernote files"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = '';
                void run(picked);
              }}
            />
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="quiet" className={TALL} onClick={close}>
                Not now
              </Button>
              <Button variant="primary" className={TALL} onClick={() => fileRef.current?.click()}>
                Choose files…
              </Button>
            </div>
          </>
        )}

        {phase.kind === 'importing' && <Progress done={phase.done} total={phase.total} />}

        {phase.kind === 'broken' && (
          <div className="space-y-3 text-sm text-ink-2">
            <p>{phase.reason}</p>
            <p>
              Notes that came across are kept. Choosing the same files again brings in the rest, and skips the
              notes already here.
            </p>
            <div className="flex justify-end">
              <Button variant="primary" className={TALL} onClick={() => setPhase({ kind: 'start' })}>
                Try again
              </Button>
            </div>
          </div>
        )}

        {phase.kind === 'report' && (
          <Report report={phase.report} onClose={close} onMore={() => setPhase({ kind: 'start' })} />
        )}
      </div>
    </Modal>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-raised font-mono text-xs font-semibold text-ink">
        {n}
      </span>
      <span className="text-sm">
        <span className="block font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-ink-2">{children}</span>
      </span>
    </li>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div aria-live="polite">
      <p className="text-sm text-ink-2">
        {total === 0 ? 'Reading your files…' : `Bringing in your notes: ${done} of ${total} notes`}
      </p>
      <div
        role="progressbar"
        aria-label="Notes brought in"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="mt-3 h-2 overflow-hidden rounded-full bg-raised"
      >
        <div className="h-full rounded-full bg-action transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-3 text-xs text-ink-3">Keep this open until it finishes.</p>
    </div>
  );
}

function reportTitle(r: ImportReport): string {
  if (r.notes > 0) return 'Your notes are here';
  if (r.skipped > 0) return 'These notes were already here';
  return 'No notes came across';
}

function summary(r: ImportReport): string {
  const what =
    r.attachments === 0 && r.tasks === 0
      ? count(r.notes, 'note', 'notes')
      : listOf([
          count(r.notes, 'note', 'notes'),
          ...(r.attachments > 0 ? [count(r.attachments, 'attachment', 'attachments')] : []),
          ...(r.tasks > 0 ? [count(r.tasks, 'task', 'tasks')] : []),
        ]);
  const from =
    r.notebooks.length === 1
      ? `the notebook “${r.notebooks[0]}”`
      : `${r.notebooks.length} notebooks: ${listOf(r.notebooks.map((n) => `“${n}”`))}`;
  if (r.notebooks.length === 0) return 'Nothing came across.';
  if (r.notes === 0) return `Nothing new came across from ${from}.`;
  return `Brought in ${what} from ${from}.`;
}

/** `1 old reminder and 3 old tasks came in without a date, …`, or nothing when no date was dropped. */
function oldLine({ reminders, tasks }: ImportReport['oldWithoutDate']): string | null {
  const total = reminders + tasks;
  if (total === 0) return null;
  const parts = [
    ...(reminders > 0 ? [`${count(reminders, 'old reminder', 'old reminders')}`] : []),
    ...(tasks > 0 ? [`${count(tasks, 'old task', 'old tasks')}`] : []),
  ];
  const they = total === 1 ? 'so it doesn’t crowd Today. It keeps its old date in its notes.' : 'so they don’t crowd Today. Each keeps its old date in its notes.';
  return `${listOf(parts)} came in without a date, ${they}`;
}

function Report({ report: r, onClose, onMore }: { report: ImportReport; onClose: () => void; onMore: () => void }) {
  return (
    <div className="space-y-5 text-sm">
      <div className="space-y-1.5 text-ink">
        <p>{summary(r)}</p>
        {r.notes > 0 && <p className="text-ink-2">You’ll find them in Notes, in the folder “From Evernote”.</p>}
        {oldLine(r.oldWithoutDate) && <p className="text-ink-2">{oldLine(r.oldWithoutDate)}</p>}
        {r.skipped > 0 && (
          <p className="text-ink-2">
            {r.skipped === 1
              ? '1 note was already here, so it was left as it was. Changes made to it in Evernote since it was first brought in weren’t brought in.'
              : `${r.skipped} notes were already here, so they were left as they were. Changes made to them in Evernote since they were first brought in weren’t brought in.`}
          </p>
        )}
      </div>

      {r.fallbacks.length > 0 && (
        <Section title="Worth a look">
          <p className="text-ink-2">
            {r.fallbacks.length === 1
              ? `This note had something that can’t be shown exactly here, like a table with merged cells. Its original is kept with it as “${ORIGINAL_NAME}”.`
              : `These notes had something that can’t be shown exactly here, like a table with merged cells. Each one keeps its original as “${ORIGINAL_NAME}”.`}
          </p>
          <NoteLinks notes={r.fallbacks} onOpen={onClose} />
        </Section>
      )}

      {r.encrypted.length > 0 && (
        <Section title="Encrypted text">
          <p className="text-ink-2">
            {r.encrypted.length === 1
              ? `This note has encrypted text, which stays in Evernote. Its original is kept with it as “${ORIGINAL_NAME}”, and the rest of the note is here.`
              : `These notes have encrypted text, which stays in Evernote. Each keeps its original as “${ORIGINAL_NAME}”, and the rest of each note is here.`}
          </p>
          <NoteLinks notes={r.encrypted} onOpen={onClose} />
        </Section>
      )}

      {r.notesNotBrought.length > 0 && (
        <Section title="Notes that couldn’t be brought in">
          <p className="text-ink-2">
            Nothing of {r.notesNotBrought.length === 1 ? 'this note' : 'these notes'} was added here, and{' '}
            {r.notesNotBrought.length === 1 ? 'it’s' : 'they’re'} still in Evernote. Bringing the notebook in again
            tries again.
          </p>
          <ul className="space-y-1 text-ink-2">
            {r.notesNotBrought.map((n, i) => (
              <li key={i}>
                <span className="font-medium text-ink">{n.title}</span> in “{n.notebook}”: {n.reason}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {r.failed.length > 0 && (
        <Section title="Files that couldn’t be saved">
          <p className="text-ink-2">
            They’re still in Evernote. To bring one in, delete its note here, then bring that notebook in again.
          </p>
          <ul className="space-y-1 text-ink-2">
            {r.failed.map((f, i) => (
              <li key={i}>
                <span className="font-medium text-ink">{f.fileName}</span> in “{f.noteTitle}”: {f.reason}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {r.noteErrors.length > 0 && (
        <Section title="Attachments Evernote couldn’t hand over">
          <ul className="space-y-1 text-ink-2">
            {r.noteErrors.map((e, i) => (
              <li key={i}>
                <NoteLink note={e} onOpen={onClose} />: {e.message}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {r.unopened.length > 0 && (
        <Section title="Files that couldn’t be opened">
          <p className="text-ink-2">
            Nothing was taken from {r.unopened.length === 1 ? 'this file' : 'these files'}. Try exporting the
            notebook from Evernote again.
          </p>
          <ul className="space-y-1 text-ink-2">
            {r.unopened.map((f, i) => (
              <li key={i}>
                <span className="font-medium text-ink">{f.fileName}</span>: {f.reason}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {r.unreadable.length > 0 && (
        <Section title="Files that aren’t Evernote exports">
          <p className="text-ink-2">Nothing was taken from {r.unreadable.length === 1 ? 'this file' : 'these files'}.</p>
          <ul className="space-y-1 text-ink-2">
            {r.unreadable.map((f, i) => (
              <li key={i}>
                <span className="font-medium text-ink">{f.fileName}</span>: {f.reason}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="border-t border-line pt-4 text-ink-2">
        You can keep Evernote until you’re happy everything is here.
      </p>

      <div className="flex justify-end gap-2">
        <Button variant="quiet" className={TALL} onClick={onMore}>
          Bring more notes
        </Button>
        <Button variant="primary" className={TALL} onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function NoteLink({ note, onOpen }: { note: NoteRef; onOpen: () => void }) {
  return (
    <Link to={`/notes/${note.noteId}`} onClick={onOpen} className="inline-flex min-h-11 items-center font-medium text-accent underline underline-offset-2">
      {note.title}
    </Link>
  );
}

function NoteLinks({ notes, onOpen }: { notes: NoteRef[]; onOpen: () => void }) {
  return (
    <ul className="space-y-1">
      {notes.map((n) => (
        <li key={n.noteId}>
          <NoteLink note={n} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}
