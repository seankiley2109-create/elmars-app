import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));
// The real converter, except that a body saying EXPLODE breaks it, the way a note nobody foresaw might.
vi.mock('./enml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./enml')>();
  return {
    ...actual,
    enmlToMarkdown: (enml: string, assets: Parameters<typeof actual.enmlToMarkdown>[1]) => {
      if (enml.includes('EXPLODE')) throw new TypeError("Cannot read properties of undefined (reading 'x')");
      return actual.enmlToMarkdown(enml, assets);
    },
  };
});

import sample from './__fixtures__/sample.enex?raw';
import { parseEnex } from './enex';
import { importEnexFiles, type ImportDeps } from './import';
import { useHQ } from '../../store';
import type { ID } from '../../types';
import { dayToIso } from '../dates';

// Due dates are local calendar dates, so pin the zone like enex.test.ts: Elmar is at UTC+2.
vi.stubEnv('TZ', 'Africa/Johannesburg');
afterAll(() => {
  vi.unstubAllEnvs();
});

const S = () => useHQ.getState();

/** The bytes inside a Blob (jsdom's Blob has no arrayBuffer()). */
function bytesOf(blob: Blob): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer)));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

type Put = { id: ID; blob: Blob; name: string };

/** The store as the sheet hands it over, plus a blob store that remembers every write. */
function deps(fail?: (name: string) => boolean): ImportDeps & { puts: Put[] } {
  const puts: Put[] = [];
  return {
    store: S(),
    puts,
    putAssetBlob: async (id, blob, name) => {
      if (fail?.(name)) throw new Error('The disk is full.');
      puts.push({ id, blob, name });
    },
  };
}

const SAMPLE = { name: 'sample.enex', text: sample };
const noteTitled = (title: string) => {
  const note = S().notes.find((n) => n.title === title);
  if (!note) throw new Error(`no note titled ${title}`);
  return note;
};
const linkedTo = (noteId: ID) =>
  S().links.filter((l) => l.to.type === 'note' && l.to.id === noteId).map((l) => l.from);

beforeEach(() => {
  S().clearAll();
});

describe('importEnexFiles on sample.enex', () => {
  it('reports what it brought in', async () => {
    const report = await importEnexFiles([SAMPLE], deps());
    expect(report).toMatchObject({
      notes: 8,
      attachments: 2,
      tasks: 3, // two Evernote tasks and one reminder
      skipped: 0,
      notebooks: ['sample'],
      failed: [],
      noteErrors: [],
      unreadable: [],
      unopened: [],
      notesNotBrought: [],
      // imported long after 2023: the open reminder and the open task lose their dates
      oldWithoutDate: { reminders: 1, tasks: 1 },
    });
    expect(report.fallbacks).toEqual([{ noteId: noteTitled('Budget table').id, title: 'Budget table' }]);
    expect(report.encrypted).toEqual([{ noteId: noteTitled('Locked note').id, title: 'Locked note' }]);
    expect(S().notes).toHaveLength(8);
    expect(S().tasks).toHaveLength(3);
  });

  it('files every note under From Evernote/<notebook>', async () => {
    await importEnexFiles([SAMPLE], deps());
    expect(new Set(S().notes.map((n) => n.folder))).toEqual(new Set(['From Evernote/sample']));
  });

  it('keeps the Evernote dates, the tags and the words', async () => {
    await importEnexFiles([SAMPLE], deps());
    expect(noteTitled('Formatting tour')).toMatchObject({
      createdAt: '2023-10-14T09:15:00.000Z',
      updatedAt: '2023-10-15T18:30:45.000Z',
      tags: ['work', 'reference'],
      pinned: false,
    });
    expect(noteTitled('Formatting tour').body).toContain('# Heading one');
    expect(noteTitled('Café 👍 שלום').body).toBe('Café au lait 👍 — שלום עולם');
    const standups = S().notes.filter((n) => n.title === 'Standup');
    expect(standups.map((n) => n.createdAt)).toEqual(['2023-01-02T08:00:00.000Z', '2023-01-09T08:00:00.000Z']);
  });

  it('brings nothing in twice: the same file again only skips', async () => {
    const first = await importEnexFiles([SAMPLE], deps());
    const again = deps();
    const second = await importEnexFiles([SAMPLE], again);
    expect(second).toMatchObject({ notes: 0, skipped: first.notes, attachments: 0, tasks: 0, notebooks: ['sample'] });
    expect(second.fallbacks).toEqual([]);
    expect(second.encrypted).toEqual([]);
    expect(again.puts).toEqual([]);
    expect(S().notes).toHaveLength(8);
    expect(S().tasks).toHaveLength(3);
    expect(S().assets).toHaveLength(4); // 2 attachments and 2 originals
  });

  it('tells two notes of the same title apart by when they were made', async () => {
    const [monday] = parseEnex(sample, 'x').filter((n) => n.title === 'Standup');
    S().addNote({ title: 'Standup', createdAt: monday.created });
    const report = await importEnexFiles([SAMPLE], deps());
    expect(report).toMatchObject({ notes: 7, skipped: 1 });
    expect(S().notes.filter((n) => n.title === 'Standup')).toHaveLength(2);
  });

  it('turns each attachment into a file linked to its note, shown in the body', async () => {
    await importEnexFiles([SAMPLE], deps());
    const receipts = noteTitled('Receipts');
    const linked = linkedTo(receipts.id);
    expect(linked.every((r) => r.type === 'asset')).toBe(true);
    const files = S().assets.filter((a) => linked.some((r) => r.id === a.id));
    expect(files.map(({ name, mime, size }) => ({ name, mime, size }))).toEqual([
      { name: 'dot.png', mime: 'image/png', size: 70 },
      { name: 'boarding_pass.pdf', mime: 'application/pdf', size: 51 },
    ]);
    expect(receipts.body).toContain(`![dot.png](asset:${files[0].id})`);
    expect(receipts.body).toContain(`[boarding_pass.pdf](asset:${files[1].id})`);
  });

  it('keeps the original of a note it could not show exactly, and of an encrypted note, linked to each', async () => {
    await importEnexFiles([SAMPLE], deps());
    for (const title of ['Budget table', 'Locked note']) {
      const linked = linkedTo(noteTitled(title).id);
      expect(linked).toHaveLength(1);
      const original = S().assets.find((a) => a.id === linked[0].id)!;
      expect(original).toMatchObject({ name: 'Original from Evernote.html', mime: 'text/html' });
    }
    // and only those notes: the others came across whole
    expect(S().assets.filter((a) => a.name === 'Original from Evernote.html')).toHaveLength(2);
  });

  it('makes the tasks: done stays done, a coming reminder is due on its day, all linked to the note', async () => {
    const report = await importEnexFiles([SAMPLE], { ...deps(), today: '2023-10-01' });
    expect(report.oldWithoutDate).toEqual({ reminders: 0, tasks: 0 });
    const groceries = noteTitled('Groceries');
    const byTitle = (t: string) => S().tasks.find((x) => x.title === t)!;
    expect(byTitle('Buy milk')).toMatchObject({ status: 'done' });
    expect(byTitle('Buy milk').completedAt).toBeDefined();
    expect(byTitle('Book dentist')).toMatchObject({ status: 'ready', dueDate: '2023-10-20' });
    // reminder 2023-10-19T17:00Z is 19:00 that day at UTC+2
    expect(byTitle('Reminder: Groceries')).toMatchObject({ status: 'ready', dueDate: '2023-10-19' });
    const linkedTasks = linkedTo(groceries.id).filter((r) => r.type === 'task').map((r) => r.id);
    expect(new Set(linkedTasks)).toEqual(new Set(S().tasks.map((t) => t.id)));
  });

  it('brings past reminders and tasks in open and without a date, the old date kept in the task', async () => {
    const report = await importEnexFiles([SAMPLE], { ...deps(), today: '2023-10-21' });
    expect(report.oldWithoutDate).toEqual({ reminders: 1, tasks: 1 });
    const byTitle = (t: string) => S().tasks.find((x) => x.title === t)!;
    const reminder = byTitle('Reminder: Groceries');
    expect(reminder).toMatchObject({ status: 'ready', notes: 'Evernote reminder for 19 Oct 2023' });
    expect(reminder.dueDate).toBeUndefined();
    const dentist = byTitle('Book dentist');
    expect(dentist).toMatchObject({ status: 'ready', notes: 'Evernote task due 20 Oct 2023' });
    expect(dentist.dueDate).toBeUndefined();
    expect(byTitle('Buy milk')).toMatchObject({ status: 'done' });
  });

  it('keeps a date that is today: only days already gone lose theirs', async () => {
    await importEnexFiles([SAMPLE], { ...deps(), today: '2023-10-19' });
    const byTitle = (t: string) => S().tasks.find((x) => x.title === t)!;
    expect(byTitle('Reminder: Groceries').dueDate).toBe('2023-10-19');
    expect(byTitle('Reminder: Groceries').notes).toBeUndefined();
    expect(byTitle('Book dentist').dueDate).toBe('2023-10-20');
  });

  it('brings a reminder marked done in Evernote in as done, not counted as old', async () => {
    const text =
      '<?xml version="1.0" encoding="UTF-8"?><en-export><note><title>Call the bank</title>' +
      '<created>20231001T080000Z</created><updated>20231001T080000Z</updated>' +
      '<note-attributes><reminder-time>20231019T170000Z</reminder-time>' +
      '<reminder-done-time>20231019T180000Z</reminder-done-time></note-attributes>' +
      '<content><![CDATA[<en-note><div>Ask about the card.</div></en-note>]]></content></note></en-export>';
    const report = await importEnexFiles([{ name: 'Work.enex', text }], { ...deps(), today: '2026-11-03' });
    expect(report.oldWithoutDate).toEqual({ reminders: 0, tasks: 0 });
    const task = S().tasks.find((t) => t.title === 'Reminder: Call the bank')!;
    expect(task).toMatchObject({ status: 'done', completedAt: dayToIso('2023-10-19') });
  });

  it('saves the bytes once per attachment and once per original, byte for byte, before the file exists', async () => {
    const d = deps();
    const seenWhenSaved: boolean[] = [];
    const put = d.putAssetBlob;
    d.putAssetBlob = async (id, blob, name) => {
      seenWhenSaved.push(S().assets.some((a) => a.id === id));
      await put(id, blob, name);
    };
    await importEnexFiles([SAMPLE], d);
    expect(seenWhenSaved).toEqual([false, false, false, false]);

    const notes = parseEnex(sample, 'sample');
    const receipts = notes.find((n) => n.title === 'Receipts')!;
    const locked = notes.find((n) => n.title === 'Locked note')!;
    const budget = notes.find((n) => n.title === 'Budget table')!;
    expect(d.puts.map((p) => p.name)).toEqual([
      'dot.png',
      'boarding_pass.pdf',
      'Original from Evernote.html', // Locked note
      'Original from Evernote.html', // Budget table
    ]);
    expect(await bytesOf(d.puts[0].blob)).toEqual(Array.from(receipts.resources[0].data));
    expect(await bytesOf(d.puts[1].blob)).toEqual(Array.from(receipts.resources[1].data));
    expect(await bytesOf(d.puts[2].blob)).toEqual(Array.from(new TextEncoder().encode(locked.enml)));
    expect(await bytesOf(d.puts[3].blob)).toEqual(Array.from(new TextEncoder().encode(budget.enml)));
    // each write went under the id of the asset that now describes it
    expect(d.puts.map((p) => p.id)).toEqual(
      d.puts.map((p) => S().assets.find((a) => a.id === p.id && a.name === p.name)?.id),
    );
  });

  it('counts progress note by note', async () => {
    const seen: [number, number][] = [];
    await importEnexFiles([SAMPLE], { ...deps(), onProgress: (done, total) => void seen.push([done, total]) });
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, 8]));
  });
});

describe('importEnexFiles when something goes wrong', () => {
  it('reports an attachment whose bytes could not be saved, makes no file for it, and carries on', async () => {
    const report = await importEnexFiles([SAMPLE], deps((name) => name === 'boarding_pass.pdf'));
    expect(report.failed).toEqual([
      { noteTitle: 'Receipts', fileName: 'boarding_pass.pdf', reason: 'Something went wrong saving this file.' },
    ]);
    expect(report).toMatchObject({ notes: 8, attachments: 1, tasks: 3 });
    expect(S().assets.some((a) => a.name === 'boarding_pass.pdf')).toBe(false);
    // the note lost something, so its original is kept and it is listed for a look
    const receipts = noteTitled('Receipts');
    expect(report.fallbacks.map((f) => f.title)).toEqual(['Receipts', 'Budget table']);
    expect(linkedTo(receipts.id).map((r) => S().assets.find((a) => a.id === r.id)?.name).sort()).toEqual([
      'Original from Evernote.html',
      'dot.png',
    ]);
  });

  it('reports an original that could not be saved and makes no file for it', async () => {
    const report = await importEnexFiles([SAMPLE], deps((name) => name === 'Original from Evernote.html'));
    expect(report.failed).toEqual([
      { noteTitle: 'Locked note', fileName: 'Original from Evernote.html', reason: 'Something went wrong saving this file.' },
      { noteTitle: 'Budget table', fileName: 'Original from Evernote.html', reason: 'Something went wrong saving this file.' },
    ]);
    expect(S().assets.some((a) => a.name === 'Original from Evernote.html')).toBe(false);
    expect(report.notes).toBe(8);
  });

  it("lists an attachment Evernote's file held but could not be read", async () => {
    const broken =
      '<?xml version="1.0" encoding="UTF-8"?><en-export><note><title>Scan</title>' +
      '<created>20261101T080000Z</created><updated>20261101T080000Z</updated>' +
      '<content><![CDATA[<en-note><div>See the scan.</div></en-note>]]></content>' +
      '<resource><data encoding="base64">@@@@ not base64 ****</data><mime>application/pdf</mime>' +
      '<resource-attributes><file-name>scan.pdf</file-name></resource-attributes></resource></note></en-export>';
    const report = await importEnexFiles([{ name: 'Work.enex', text: broken }], deps());
    const scan = noteTitled('Scan');
    expect(report.noteErrors).toEqual([
      {
        noteId: scan.id,
        title: 'Scan',
        message: 'Attachment "scan.pdf" (application/pdf) could not be decoded and was skipped.',
      },
    ]);
    expect(report.notes).toBe(1);
  });

  it('skips a file that is not an Evernote export, by name, and still imports the others', async () => {
    const report = await importEnexFiles(
      [
        { name: 'shopping.enex', text: '<html><body>nope</body></html>' },
        SAMPLE,
      ],
      deps(),
    );
    expect(report.unreadable).toEqual([
      { fileName: 'shopping.enex', reason: 'This file is not an Evernote export (.enex).' },
    ]);
    expect(report).toMatchObject({ notes: 8, notebooks: ['sample'] });
  });

  it('names notebooks after their files, whatever the case of .enex', async () => {
    const one = sample.replace(/<note>[\s\S]*<\/note>/, (all) => all.split('</note>')[0] + '</note>');
    const report = await importEnexFiles([{ name: 'Travel Plans.ENEX', text: one }], deps());
    expect(report.notebooks).toEqual(['Travel Plans']);
    expect(S().notes.map((n) => n.folder)).toEqual(['From Evernote/Travel Plans']);
  });
});

/** An export of the given `<note>` elements. */
const exportOf = (...notes: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><en-export>${notes.join('')}</en-export>`;
const noteXml = (title: string, body: string, extra = '') =>
  `<note><title>${title}</title><created>20240101T080000Z</created><updated>20240101T080000Z</updated>` +
  `${extra}<content><![CDATA[<en-note><div>${body}</div></en-note>]]></content></note>`;
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('importEnexFiles never drops a note', () => {
  it('brings in two different notes with the same title made in the same second', async () => {
    const text = exportOf(noteXml('Standup', 'Monday'), noteXml('Standup', 'Tuesday'));
    const report = await importEnexFiles([{ name: 'Work.enex', text }], deps());
    expect(report).toMatchObject({ notes: 2, skipped: 0 });
    expect(S().notes.map((n) => n.body).sort()).toEqual(['Monday', 'Tuesday']);

    // and a later run finds both already here
    const again = await importEnexFiles([{ name: 'Work.enex', text }], deps());
    expect(again).toMatchObject({ notes: 0, skipped: 2 });
  });

  it('skips the very same note met twice in one run (the same notebook chosen twice)', async () => {
    const report = await importEnexFiles([SAMPLE, { name: 'sample.enex', text: sample }], deps());
    expect(report).toMatchObject({ notes: 8, skipped: 8 });
  });
});

describe('importEnexFiles never stops on one note', () => {
  it('names a note it could not bring in, removes the bytes it saved for it, and carries on', async () => {
    const resource =
      `<resource><data encoding="base64">${PNG_BASE64}</data><mime>image/png</mime>` +
      '<resource-attributes><file-name>dot.png</file-name></resource-attributes></resource>';
    const text = exportOf(
      noteXml('Before', 'First.'),
      `<note><title>Odd one</title><created>20240101T090000Z</created><updated>20240101T090000Z</updated>` +
        `<content><![CDATA[<en-note><div>EXPLODE</div></en-note>]]></content>${resource}</note>`,
      noteXml('After', 'Last.'),
    );
    const removed: ID[] = [];
    const d = { ...deps(), delAssetBlob: async (id: ID) => void removed.push(id) };
    const seen: [number, number][] = [];
    const report = await importEnexFiles([{ name: 'Work.enex', text }], {
      ...d,
      onProgress: (done, total) => void seen.push([done, total]),
    });

    expect(report.notesNotBrought).toEqual([
      { title: 'Odd one', notebook: 'Work', reason: 'Something in this note couldn’t be read.' },
    ]);
    expect(S().notes.map((n) => n.title)).toEqual(['Before', 'After']);
    expect(report).toMatchObject({ notes: 2, attachments: 0 });
    // no half-made note: no file, no link, and the saved bytes are gone again
    expect(S().assets).toEqual([]);
    expect(removed).toEqual(d.puts.map((p) => p.id));
    expect(removed).toHaveLength(1);
    expect(seen.at(-1)).toEqual([3, 3]);
  });
});

describe('importEnexFiles explains in plain words', () => {
  it('says there is no space left, rather than the error the browser gave', async () => {
    const report = await importEnexFiles([SAMPLE], {
      ...deps(),
      putAssetBlob: async (_id, _blob, name) => {
        if (name === 'dot.png') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        if (name === 'boarding_pass.pdf') throw new DOMException('Permission denied by the user agent', 'NotAllowedError');
      },
    });
    expect(report.failed).toEqual([
      { noteTitle: 'Receipts', fileName: 'dot.png', reason: 'There isn’t enough space left on this Mac to save it.' },
      {
        noteTitle: 'Receipts',
        fileName: 'boarding_pass.pdf',
        reason: 'The app wasn’t allowed to save it into your folder.',
      },
    ]);
  });

  it('never shows a raw error', async () => {
    const report = await importEnexFiles([SAMPLE], deps((name) => name === 'dot.png'));
    expect(report.failed.map((f) => f.reason)).toEqual(['Something went wrong saving this file.']);
  });
});

describe('importEnexFiles reads one file at a time', () => {
  it('reads files when it needs them, and lists one that could not be opened under its own heading', async () => {
    const log: string[] = [];
    const lazy = (name: string, text: string) => ({
      name,
      read: async () => {
        log.push(`read ${name}`);
        return text;
      },
    });
    const two = exportOf(noteXml('Second notebook note', 'Hi.'));
    const report = await importEnexFiles(
      [
        lazy('sample.enex', sample),
        { name: 'locked.enex', read: async () => Promise.reject(new DOMException('x', 'NotReadableError')) },
        lazy('Work.enex', two),
      ],
      {
        ...deps(),
        onProgress: (done, total) => void log.push(`${done}/${total}`),
      },
    );
    expect(report.unopened).toEqual([{ fileName: 'locked.enex', reason: 'The file couldn’t be opened.' }]);
    expect(report.unreadable).toEqual([]);
    expect(report).toMatchObject({ notes: 9, notebooks: ['sample', 'Work'] });
    // a quick count first, then each file is read again only when its turn comes
    expect(log.slice(0, 3)).toEqual(['read sample.enex', 'read Work.enex', '0/9']);
    expect(log.indexOf('read Work.enex', 3)).toBeGreaterThan(log.indexOf('8/9'));
    expect(log.at(-1)).toBe('9/9');
  });
});

describe('importEnexFiles and undated reminders', () => {
  it('makes an undated reminder into an undated task linked to its note', async () => {
    const text = exportOf(
      noteXml('Call the bank', 'Ask about the card.', '<note-attributes><reminder-order>1697699700000</reminder-order></note-attributes>'),
    );
    const report = await importEnexFiles([{ name: 'Work.enex', text }], deps());
    expect(report.tasks).toBe(1);
    expect(report.oldWithoutDate).toEqual({ reminders: 0, tasks: 0 });
    const task = S().tasks.find((t) => t.title === 'Reminder: Call the bank')!;
    expect(task).toMatchObject({ status: 'ready' });
    expect(task.dueDate).toBeUndefined();
    expect(task.notes).toBeUndefined();
    expect(linkedTo(noteTitled('Call the bank').id)).toEqual([{ type: 'task', id: task.id }]);
  });

  it('brings an undated reminder that was done in as done', async () => {
    const text = exportOf(
      noteXml(
        'Call the bank',
        'Done already.',
        '<note-attributes><reminder-order>1</reminder-order><reminder-done-time>20240102T080000Z</reminder-done-time></note-attributes>',
      ),
    );
    await importEnexFiles([{ name: 'Work.enex', text }], deps());
    expect(S().tasks.find((t) => t.title === 'Reminder: Call the bank')).toMatchObject({
      status: 'done',
      completedAt: dayToIso('2024-01-02'),
    });
  });
});
