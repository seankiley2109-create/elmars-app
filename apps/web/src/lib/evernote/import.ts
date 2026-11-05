import SparkMD5 from 'spark-md5';
import { oneLine } from '@hq/core/data';
import { dayOfIso, normalizeToDay, todayStr } from '@hq/core/dates';
import type { HQState } from '../../store';
import type { EntityRef, ID } from '../../types';
import { parseEnex, type EnexNote, type EnexResource } from './enex';
import { enmlToMarkdown, type EnmlAsset } from './enml';

export const ORIGINAL_NAME = 'Original from Evernote.html';
export const FOLDER_ROOT = 'From Evernote';

export type NoteRef = { noteId: ID; title: string };

export type ImportReport = {
  /** Notes brought in (duplicates not counted). */
  notes: number;
  /** Attachments saved as files (the kept originals are not counted). */
  attachments: number;
  /** Tasks made, reminders included. */
  tasks: number;
  /** Notes already here (same title and created date), left alone. */
  skipped: number;
  /** One per readable file: the file name without `.enex`. */
  notebooks: string[];
  /** Notes that could not be shown exactly; each keeps its original as `Original from Evernote.html`. */
  fallbacks: NoteRef[];
  /** Notes with encrypted text, which stays in Evernote; each keeps its original too. */
  encrypted: NoteRef[];
  /** Files whose bytes could not be saved; no file was made for them. The reason is in plain words. */
  failed: { noteTitle: string; fileName: string; reason: string }[];
  /** Problems inside Evernote's file, e.g. an attachment that could not be read. */
  noteErrors: (NoteRef & { message: string })[];
  /** Files that are not Evernote exports; nothing was taken from them. */
  unreadable: { fileName: string; reason: string }[];
  /** Files that could not be opened at all. */
  unopened: { fileName: string; reason: string }[];
  /** Notes that broke while being brought in. Nothing of them was kept; the rest carried on. */
  notesNotBrought: { title: string; notebook: string; reason: string }[];
  /** Open reminders and tasks whose date had already gone: they came in without one, so Today stays clear. */
  oldWithoutDate: { reminders: number; tasks: number };
};

/** A chosen file: its text, or a way to read it when its turn comes (so only one file is held at a time). */
export type EnexSource = { name: string; text: string } | { name: string; read: () => Promise<string> };

export type ImportDeps = {
  store: Pick<HQState, 'notes' | 'addNote' | 'addTask' | 'updateTask' | 'addAsset' | 'addLink'>;
  putAssetBlob: (id: ID, blob: Blob, name: string) => Promise<void>;
  /** Removes bytes saved for a note that then could not be brought in. Optional: without it they stay. */
  delAssetBlob?: (id: ID) => Promise<void>;
  /** Called with 0 before the first note and after every note, imported or skipped. Awaited. */
  onProgress?: (done: number, total: number) => void | Promise<void>;
  /** The local day of the import (`YYYY-MM-DD`); dates before it are old. Defaults to today. */
  today?: string;
};

const uuid = (): ID => crypto.randomUUID();

/** `Travel.enex` -> `Travel`. */
export function notebookOf(fileName: string): string {
  return fileName.replace(/\.enex$/i, '').trim() || 'Notebook';
}

/** A cheap count of the notes in an export, for the progress total, without parsing it. */
export function countNotes(text: string): number {
  return (text.match(/<note[\s>]/g) ?? []).length;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2023-10-19` -> `19 Oct 2023`. */
function longDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export const NOT_OPENED = 'The file couldn’t be opened.';
export const NOT_AN_EXPORT = 'This file is not an Evernote export (.enex).';
export const NOTE_NOT_READ = 'Something in this note couldn’t be read.';
const NOTE_NOT_FINISHED = 'Part of this note couldn’t be finished. Check it against Evernote.';

/** Why a file could not be saved, in plain words. Never the browser's own message. */
export function plainSaveReason(e: unknown): string {
  const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '';
  const message = typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : '';
  if (name === 'QuotaExceededError' || /quota/i.test(message)) {
    return 'There isn’t enough space left on this Mac to save it.';
  }
  if (name === 'NotAllowedError' || name === 'SecurityError' || /permission|not allowed/i.test(message)) {
    return 'The app wasn’t allowed to save it into your folder.';
  }
  if (name === 'NotFoundError') return 'The folder it was saving into couldn’t be found.';
  return 'Something went wrong saving this file.';
}

/** A name for an attachment Evernote kept without one: `Attachment 2.pdf`. */
function attachmentName(res: EnexResource, n: number): string {
  if (res.fileName) return res.fileName;
  const sub = res.mime.split('/')[1]?.split(/[+;]/)[0]?.trim().toLowerCase();
  const ext = sub === 'jpeg' ? 'jpg' : sub && /^[a-z0-9.-]{1,10}$/.test(sub) && sub !== 'octet-stream' ? sub : '';
  return ext ? `Attachment ${n}.${ext}` : `Attachment ${n}`;
}

const textOf = (file: EnexSource): Promise<string> => ('text' in file ? Promise.resolve(file.text) : file.read());

/**
 * Brings Evernote exports in: one notebook per file, filed under `From Evernote/<notebook>`.
 *
 * - Nothing already here is touched. A note already here (same title and created date) is skipped;
 *   within one run, only the very same note (title, created date and body) counts as met before, so
 *   two different notes made in the same second both come in.
 * - Each attachment's bytes are saved before its file is made, so there is never a file without
 *   bytes; one that cannot be saved is reported and the import carries on.
 * - A note that breaks is reported by title and leaves nothing behind; the notes after it still come in.
 * - Files are read one at a time: a quick count first for the progress total, then each file is read,
 *   brought in and let go before the next.
 */
export async function importEnexFiles(files: EnexSource[], deps: ImportDeps): Promise<ImportReport> {
  const { store, putAssetBlob, delAssetBlob, onProgress } = deps;
  const today = deps.today ?? todayStr();
  const report: ImportReport = {
    notes: 0,
    attachments: 0,
    tasks: 0,
    skipped: 0,
    notebooks: [],
    fallbacks: [],
    encrypted: [],
    failed: [],
    noteErrors: [],
    unreadable: [],
    unopened: [],
    notesNotBrought: [],
    oldWithoutDate: { reminders: 0, tasks: 0 },
  };

  // 1. Count, holding one file's text at a time.
  const plan: { file: EnexSource; count: number }[] = [];
  for (const file of files) {
    try {
      plan.push({ file, count: countNotes(await textOf(file)) });
    } catch {
      report.unopened.push({ fileName: file.name, reason: NOT_OPENED });
    }
  }
  let total = plan.reduce((n, p) => n + p.count, 0);
  let done = 0;
  await onProgress?.(done, total);

  const hereAlready = new Set(store.notes.map((n) => `${n.title}\u0000${n.createdAt}`));
  const metThisRun = new Set<string>();

  // 2. Bring each file in, then let it go.
  for (const { file, count } of plan) {
    const notebook = notebookOf(file.name);
    let notes: EnexNote[] = [];
    let text: string | undefined;
    try {
      text = await textOf(file);
    } catch {
      report.unopened.push({ fileName: file.name, reason: NOT_OPENED });
    }
    if (text !== undefined) {
      try {
        notes = parseEnex(text, notebook);
        if (!report.notebooks.includes(notebook)) report.notebooks.push(notebook);
      } catch {
        report.unreadable.push({ fileName: file.name, reason: NOT_AN_EXPORT });
      }
      text = undefined; // the notes hold what is needed now
    }
    if (notes.length !== count) {
      total += notes.length - count;
      await onProgress?.(done, total);
    }
    while (notes.length > 0) {
      const note = notes.shift()!; // let each note's bytes go once it is in
      await importNote(note, notebook);
      done += 1;
      await onProgress?.(done, total);
    }
  }
  return report;

  async function importNote(note: EnexNote, notebook: string): Promise<void> {
    const title = oneLine(note.title) || 'Untitled';
    const createdAt = note.created || note.updated || new Date().toISOString();
    const updatedAt = note.updated || createdAt;
    const sameNote = `${title}\u0000${createdAt}\u0000${SparkMD5.hash(note.enml)}`;
    if (hereAlready.has(`${title}\u0000${createdAt}`) || metThisRun.has(sameNote)) {
      report.skipped += 1;
      return;
    }
    metThisRun.add(sameNote);

    const written: ID[] = [];
    let noteId: ID | undefined;
    try {
      // 1. The bytes first, each under the id its file will have.
      const saved: { id: ID; name: string; mime: string; size: number }[] = [];
      const byHash = new Map<string, EnmlAsset>();
      for (const [i, res] of note.resources.entries()) {
        const id = uuid();
        const name = attachmentName(res, i + 1);
        try {
          await putAssetBlob(id, new Blob([res.data as BlobPart], { type: res.mime }), name);
        } catch (e) {
          report.failed.push({ noteTitle: title, fileName: name, reason: plainSaveReason(e) });
          continue;
        }
        written.push(id);
        saved.push({ id, name, mime: res.mime, size: res.data.length });
        if (!byHash.has(res.hash)) byHash.set(res.hash, { id, name, mime: res.mime });
      }

      // 2. The words. An attachment that was not saved leaves its place unfilled, which marks the note
      //    as one to keep the original of.
      const { markdown, fallback, encrypted } = enmlToMarkdown(note.enml, byHash);
      const lostSomething = fallback || saved.length < note.resources.length;
      // Encrypted text can't come across, so its original (which holds it) is kept too: nothing is lost.
      const needsOriginal = lostSomething || encrypted > 0;

      let original: { id: ID; size: number } | undefined;
      if (needsOriginal) {
        const id = uuid();
        const bytes = new TextEncoder().encode(note.enml);
        try {
          await putAssetBlob(id, new Blob([bytes as BlobPart], { type: 'text/html' }), ORIGINAL_NAME);
          written.push(id);
          original = { id, size: bytes.length };
        } catch (e) {
          report.failed.push({ noteTitle: title, fileName: ORIGINAL_NAME, reason: plainSaveReason(e) });
        }
      }

      // 3. The note, then its files and tasks, all linked to it. Everything that can break comes before this.
      noteId = store.addNote({ title, body: markdown, tags: note.tags, folder: `${FOLDER_ROOT}/${notebook}`, createdAt, updatedAt });
      const noteRef: EntityRef = { type: 'note', id: noteId };
      report.notes += 1;

      for (const a of saved) {
        store.addAsset({ id: a.id, name: a.name, mime: a.mime, size: a.size }, noteRef);
        report.attachments += 1;
      }
      if (original) store.addAsset({ id: original.id, name: ORIGINAL_NAME, mime: 'text/html', size: original.size }, noteRef);

      if (lostSomething) report.fallbacks.push({ noteId, title });
      if (encrypted > 0) report.encrypted.push({ noteId, title });
      for (const message of note.errors) report.noteErrors.push({ noteId, title, message });

      for (const task of note.tasks) {
        addTask(noteRef, task.title || 'Untitled task', task.due, task.done ? normalizeToDay(updatedAt) : undefined, 'task');
      }
      if (note.reminderAt || note.reminderOrder) {
        // A reminder with no time (only on Evernote's reminder list) comes in as a task with no date.
        const doneAt = note.reminderDoneAt ? normalizeToDay(note.reminderDoneAt) : undefined;
        addTask(noteRef, `Reminder: ${title}`, note.reminderAt ? dayOfIso(note.reminderAt) : undefined, doneAt, 'reminder');
      }
    } catch {
      if (noteId === undefined) {
        // Nothing of the note was made; take back the bytes saved for it, and say so.
        report.notesNotBrought.push({ title, notebook, reason: NOTE_NOT_READ });
        for (const id of written) await delAssetBlob?.(id).catch(() => {});
      } else {
        report.noteErrors.push({ noteId, title, message: NOTE_NOT_FINISHED });
      }
    }
  }

  /**
   * A date that has already gone comes in as a word in the task, not a due date: years of old
   * Evernote reminders must not land on Today as overdue. Coming dates stay due dates.
   */
  function addTask(
    noteRef: EntityRef,
    taskTitle: string,
    due: string | undefined,
    completedAt: string | undefined,
    kind: 'task' | 'reminder',
  ): void {
    const old = due !== undefined && due < today;
    const taskId = store.addTask({ title: taskTitle, dueDate: old ? undefined : due });
    if (old) {
      store.updateTask(taskId, {
        notes: kind === 'reminder' ? `Evernote reminder for ${longDay(due)}` : `Evernote task due ${longDay(due)}`,
      });
      if (!completedAt) report.oldWithoutDate[kind === 'reminder' ? 'reminders' : 'tasks'] += 1;
    }
    if (completedAt) store.updateTask(taskId, { status: 'done', completedAt });
    store.addLink({ type: 'task', id: taskId }, noteRef);
    report.tasks += 1;
  }
}
