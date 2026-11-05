import { afterAll, describe, expect, it, vi } from 'vitest';
import sample from './__fixtures__/sample.enex?raw';
import { enmlToMarkdown } from './enml';
import { parseEnex } from './enex';

// Due dates are local calendar dates, so pin the zone (before any date is computed): Elmar is at
// UTC+2, and Johannesburg has no DST. Node re-reads the zone when process.env.TZ is assigned.
vi.stubEnv('TZ', 'Africa/Johannesburg');
afterAll(() => {
  vi.unstubAllEnvs();
});

const PNG_MD5 = 'b357a19c87624c7c4d131aeeb4ae677f';
const PDF_MD5 = 'd163124b385f9cbfc33988e452bf7b30';
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const utf8 = (s: string) => Array.from(new TextEncoder().encode(s));

const exportOf = (noteBody: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><en-export><note><title>T</title>` +
  `<created>20261101T080000Z</created><updated>20261101T080000Z</updated>${noteBody}</note></en-export>`;

describe('parseEnex', () => {
  it('runs these tests at UTC+2', () => {
    expect(new Date('2026-11-04T22:00:00Z').getTimezoneOffset()).toBe(-120);
  });

  const notes = parseEnex(sample, 'Personal');
  const byTitle = (title: string) => {
    const note = notes.find((n) => n.title === title);
    if (!note) throw new Error(`no note titled ${title}`);
    return note;
  };

  it('reads every note, in order, tagged with the given notebook', () => {
    expect(notes).toHaveLength(8);
    expect(notes.map((n) => n.title)).toEqual([
      'Formatting tour',
      'Receipts',
      'Locked note',
      'Budget table',
      'Groceries',
      'Standup',
      'Standup',
      'Café 👍 שלום',
    ]);
    expect(notes.every((n) => n.notebook === 'Personal')).toBe(true);
  });

  it('turns Evernote dates into ISO strings', () => {
    const tour = byTitle('Formatting tour');
    expect(tour.created).toBe('2023-10-14T09:15:00.000Z');
    expect(tour.updated).toBe('2023-10-15T18:30:45.000Z');
  });

  it('keeps two notes with the same title apart by their created dates', () => {
    const standups = notes.filter((n) => n.title === 'Standup');
    expect(standups.map((n) => n.created)).toEqual([
      '2023-01-02T08:00:00.000Z',
      '2023-01-09T08:00:00.000Z',
    ]);
    expect(standups[0].enml).toContain('Monday standup.');
    expect(standups[1].enml).toContain('Next Monday standup.');
  });

  it('reads the tags', () => {
    expect(byTitle('Formatting tour').tags).toEqual(['work', 'reference']);
    expect(byTitle('Receipts').tags).toEqual(['travel']);
    expect(byTitle('Locked note').tags).toEqual([]);
  });

  it('keeps the ENML of the note body', () => {
    const enml = byTitle('Locked note').enml;
    expect(enml).toContain('<en-note>');
    expect(enml).toContain('<en-crypt');
  });

  it('decodes the resources and hashes them with MD5', () => {
    const { resources } = byTitle('Receipts');
    expect(resources).toHaveLength(2);
    const [png, pdf] = resources;

    expect(png.hash).toBe(PNG_MD5);
    expect(png.mime).toBe('image/png');
    expect(png.fileName).toBe('dot.png');
    expect(png.data.length).toBe(70);
    expect(Array.from(png.data.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    expect(pdf.hash).toBe(PDF_MD5);
    expect(pdf.mime).toBe('application/pdf');
    expect(pdf.fileName).toBe('boarding_pass.pdf');
    expect(pdf.data.length).toBe(51);
    expect(new TextDecoder('latin1').decode(pdf.data.slice(0, 8))).toBe('%PDF-1.4');

    expect(byTitle('Formatting tour').resources).toEqual([]);
  });

  it('reads the tasks: done, and due cut to a date', () => {
    expect(byTitle('Groceries').tasks).toEqual([
      { title: 'Buy milk', done: true },
      { title: 'Book dentist', done: false, due: '2023-10-20' },
    ]);
    expect(byTitle('Formatting tour').tasks).toEqual([]);
  });

  it('takes a due date as the local calendar date of the instant', () => {
    const [note] = parseEnex(
      exportOf(
        '<content><![CDATA[<en-note/>]]></content>' +
          '<task><title>Late call</title><taskStatus>open</taskStatus><dueDate>20261104T220000Z</dueDate></task>' +
          '<task><title>Early call</title><taskStatus>open</taskStatus><dueDate>20261104T215959Z</dueDate></task>',
      ),
      'Work',
    );
    expect(note.tasks).toEqual([
      { title: 'Late call', done: false, due: '2026-11-05' },
      { title: 'Early call', done: false, due: '2026-11-04' },
    ]);
  });

  it('has no errors for a clean export', () => {
    expect(notes.every((n) => n.errors.length === 0)).toBe(true);
  });

  it('skips a corrupt resource but keeps the note, and records the error', () => {
    const [note] = parseEnex(
      exportOf(
        `<content><![CDATA[<en-note><div><en-media hash="${PNG_MD5}" type="image/png"/></div>` +
          `<div><en-media hash="ffffffffffffffffffffffffffffffff" type="application/pdf"/></div></en-note>]]></content>` +
          `<resource><data encoding="base64">${PNG_BASE64}</data><mime>image/png</mime>` +
          `<resource-attributes><file-name>dot.png</file-name></resource-attributes></resource>` +
          `<resource><data encoding="base64">@@@@ not base64 ****</data><mime>application/pdf</mime>` +
          `<resource-attributes><file-name>broken.pdf</file-name></resource-attributes></resource>`,
      ),
      'Work',
    );
    expect(note.title).toBe('T');
    expect(note.resources.map((r) => r.hash)).toEqual([PNG_MD5]);
    expect(note.errors).toEqual(['Attachment "broken.pdf" (application/pdf) could not be decoded and was skipped.']);

    const assets = new Map(note.resources.map((r) => [r.hash, { id: 'a1', name: r.fileName ?? '', mime: r.mime }]));
    const out = enmlToMarkdown(note.enml, assets);
    expect(out.markdown).toBe('![dot.png](asset:a1)');
    expect(out.fallback).toBe(true);
  });

  it('reads the reminder time', () => {
    expect(byTitle('Groceries').reminderAt).toBe('2023-10-19T17:00:00.000Z');
    expect(byTitle('Formatting tour').reminderAt).toBeUndefined();
  });

  it('reads when a reminder was marked done, and leaves it out when it was not', () => {
    const [done] = parseEnex(
      exportOf(
        '<note-attributes><reminder-time>20231019T170000Z</reminder-time>' +
          '<reminder-done-time>20231019T180500Z</reminder-done-time></note-attributes>' +
          '<content><![CDATA[<en-note/>]]></content>',
      ),
      'Work',
    );
    expect(done.reminderAt).toBe('2023-10-19T17:00:00.000Z');
    expect(done.reminderDoneAt).toBe('2023-10-19T18:05:00.000Z');
    expect(byTitle('Groceries').reminderDoneAt).toBeUndefined();
  });

  it('reads a reminder that has no time (only its place in the reminder list)', () => {
    const [undated] = parseEnex(
      exportOf(
        '<note-attributes><reminder-order>1697699700000</reminder-order></note-attributes>' +
          '<content><![CDATA[<en-note/>]]></content>',
      ),
      'Work',
    );
    expect(undated.reminderOrder).toBe('1697699700000');
    expect(undated.reminderAt).toBeUndefined();
    expect(byTitle('Groceries').reminderOrder).toBe('1697699700000');
    expect(byTitle('Formatting tour').reminderOrder).toBeUndefined();
  });

  it('keeps "Café", "👍" and "שלום" byte-exact in the title and the body', () => {
    const note = notes[7];
    expect(note.title).toBe('Café 👍 שלום');
    expect(utf8(note.title)).toEqual([
      0x43, 0x61, 0x66, 0xc3, 0xa9, 0x20, 0xf0, 0x9f, 0x91, 0x8d, 0x20, 0xd7, 0xa9, 0xd7, 0x9c, 0xd7, 0x95, 0xd7, 0x9d,
    ]);
    expect(note.enml).toContain('Café au lait 👍 — שלום עולם');
  });

  it('accepts an export with a byte-order mark and no notes', () => {
    const empty = '﻿<?xml version="1.0" encoding="UTF-8"?><en-export></en-export>';
    expect(parseEnex(empty, 'Empty')).toEqual([]);
  });

  it('rejects text that is not an Evernote export', () => {
    expect(() => parseEnex('<html><body>nope</body></html>', 'X')).toThrow(/Evernote export/);
    expect(() => parseEnex('not xml at all <', 'X')).toThrow(/Evernote export/);
  });
});
