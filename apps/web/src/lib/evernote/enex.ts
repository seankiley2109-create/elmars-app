import SparkMD5 from 'spark-md5';

/** One attachment of an Evernote note. `hash` is the MD5 (hex) of `data`, as used by `<en-media hash>`. */
export type EnexResource = { hash: string; mime: string; fileName?: string; data: Uint8Array };

/** A task from a newer Evernote export. `due` is `YYYY-MM-DD`. */
export type EnexTask = { title: string; done: boolean; due?: string };

export type EnexNote = {
  title: string;
  /** ISO timestamps. */
  created: string;
  updated: string;
  tags: string[];
  notebook: string;
  /** The note body, still in ENML; see `enmlToMarkdown`. */
  enml: string;
  resources: EnexResource[];
  tasks: EnexTask[];
  reminderAt?: string;
  /** When the reminder was marked done in Evernote, if it was. */
  reminderDoneAt?: string;
  /** Set when the note is on Evernote's reminder list, with or without a time. */
  reminderOrder?: string;
  /** Problems met while reading this note (e.g. an attachment that could not be decoded and was skipped). */
  errors: string[];
};

/**
 * Reads an Evernote export (`.enex`). An export holds one notebook, so the caller passes its name
 * (usually taken from the file name). Throws when the text is not an Evernote export.
 */
export function parseEnex(xml: string, notebook: string): EnexNote[] {
  const doc = new DOMParser().parseFromString(xml.replace(/^﻿/, ''), 'text/xml');
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName('parsererror').length > 0 || root.localName !== 'en-export') {
    throw new Error('This file is not an Evernote export (.enex).');
  }
  return children(root, 'note').map((note) => readNote(note, notebook));
}

function readNote(note: Element, notebook: string): EnexNote {
  const created = enexDate(childText(note, 'created')) ?? '';
  const errors: string[] = [];
  const resources: EnexResource[] = [];
  for (const el of children(note, 'resource')) {
    try {
      resources.push(readResource(el));
    } catch {
      // Skip just this attachment; its <en-media> then has no asset and the note is flagged as fallback.
      const attributes = child(el, 'resource-attributes');
      const name = (attributes ? childText(attributes, 'file-name')?.trim() : undefined) || 'untitled';
      const mime = (childText(el, 'mime') ?? '').trim() || 'unknown type';
      errors.push(`Attachment "${name}" (${mime}) could not be decoded and was skipped.`);
    }
  }
  const out: EnexNote = {
    title: childText(note, 'title')?.trim() ?? '',
    created,
    updated: enexDate(childText(note, 'updated')) ?? created,
    tags: children(note, 'tag')
      .map((t) => (t.textContent ?? '').trim())
      .filter(Boolean),
    notebook,
    enml: childText(note, 'content') ?? '',
    resources,
    tasks: children(note, 'task').map(readTask),
    errors,
  };
  const attributes = child(note, 'note-attributes');
  const reminderAt = attributes ? enexDate(childText(attributes, 'reminder-time')) : undefined;
  if (reminderAt) out.reminderAt = reminderAt;
  const reminderDoneAt = attributes ? enexDate(childText(attributes, 'reminder-done-time')) : undefined;
  if (reminderDoneAt) out.reminderDoneAt = reminderDoneAt;
  // Evernote puts a note on the reminder list with `reminder-order`; a reminder with no date has only that.
  const reminderOrder = attributes ? childText(attributes, 'reminder-order')?.trim() : undefined;
  if (reminderOrder) out.reminderOrder = reminderOrder;
  return out;
}

function readResource(resource: Element): EnexResource {
  const data = decodeBase64(childText(resource, 'data') ?? '');
  const out: EnexResource = {
    hash: SparkMD5.ArrayBuffer.hash(data.buffer as ArrayBuffer),
    mime: (childText(resource, 'mime') ?? '').trim() || 'application/octet-stream',
    data,
  };
  const attributes = child(resource, 'resource-attributes');
  const fileName = attributes ? childText(attributes, 'file-name')?.trim() : undefined;
  if (fileName) out.fileName = fileName;
  return out;
}

function readTask(task: Element): EnexTask {
  const out: EnexTask = {
    title: (childText(task, 'title') ?? '').trim(),
    done: (childText(task, 'taskStatus') ?? '').trim() === 'completed',
  };
  const due = enexDate(childText(task, 'dueDate'));
  if (due) out.due = localDate(due);
  return out;
}

/** The calendar date (`YYYY-MM-DD`) of an instant in the runtime's local time zone. */
function localDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `20231014T091500Z` -> `2023-10-14T09:15:00.000Z`; anything else -> undefined. */
function enexDate(raw: string | undefined): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec((raw ?? '').trim());
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function children(parent: Element, name: string): Element[] {
  return Array.from(parent.children).filter((el) => el.localName === name);
}

function child(parent: Element, name: string): Element | undefined {
  return children(parent, name)[0];
}

function childText(parent: Element, name: string): string | undefined {
  const el = child(parent, name);
  return el ? (el.textContent ?? '') : undefined;
}
