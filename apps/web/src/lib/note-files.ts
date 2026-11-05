import { useHQ } from '../store';
import { putAssetBlob } from './assets';
import { MAX_ATTACHMENT_BYTES, tooBigMessage } from './attachment-limit';
import type { ID } from '../types';

export class AttachmentTooBig extends Error {
  constructor(readonly fileName: string) {
    super(tooBigMessage(fileName));
  }
}

/** A pasted screenshot arrives with no name, or "image.png". */
export const attachmentName = (f: File): string => f.name || 'Pasted image';

/**
 * Attach a file to a note. The bytes are written first, under a fresh id; only once they are safely
 * stored does the asset (and its link to the note) appear. A failed write therefore adds nothing —
 * no asset without bytes — and the error goes back to the caller to show.
 */
export async function attachToNote(file: File, noteId: ID): Promise<{ assetId: ID; name: string }> {
  const name = attachmentName(file);
  if (file.size > MAX_ATTACHMENT_BYTES) throw new AttachmentTooBig(name);
  const assetId = crypto.randomUUID();
  await putAssetBlob(assetId, file, name);
  useHQ
    .getState()
    .addAsset({ id: assetId, name, mime: file.type || 'application/octet-stream', size: file.size }, { type: 'note', id: noteId });
  return { assetId, name };
}

/** Asset ids a note body shows in place: `![…](asset:<id>)` and `[…](asset:<id>)`. */
export function inlineAssetIds(md: string): Set<ID> {
  return new Set([...md.matchAll(/\]\(asset:([^)\s]+)\)/g)].map((m) => m[1]));
}

/** `[label](target)` with escapes in the label and escaped parens in the target; group 1 is the label. */
const LINKISH = /!?\[((?:\\.|[^\]\\])*)\]\((?:\\.|[^)\\])*\)/g;

/**
 * A note body as one line of plain words, for the list. Attachments, links and mentions read as
 * their names (never an id or a URL); markdown syntax, HTML tags and comments go; backslash escapes
 * are undone so `\<div>` reads `<div>`. Nothing else is decoded: `&amp;` written as text stays.
 */
export function snippetOf(md: string): string {
  return md
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ') // comments (an unclosed one runs to the end)
    .replace(LINKISH, '$1') // images, files, links and mentions keep only their names
    .replace(/(?<!\\)<\/?[A-Za-z][^>]*>/g, ' ') // html tags and autolinks (not "a < b", not "\<div>")
    .replace(/^[ \t]*(?:>[ \t]?)+/gm, '') // quote marks
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '') // list and checklist marks
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '') // heading marks
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/gm, '') // table rule, or a --- rule
    .replace(/\\.|\*+|~~|`+|\||_+/g, (m, i: number, s: string) => {
      if (m.startsWith('\\')) return m; // escaped: undone below
      if (m === '|') return ' '; // a table cell edge
      // an underscore inside a word (snake_case, boarding_pass.pdf) is a letter, not emphasis
      if (m[0] === '_' && /[\p{L}\p{N}]/u.test(s[i - 1] ?? '') && /[\p{L}\p{N}]/u.test(s[i + m.length] ?? '')) return m;
      return '';
    })
    .replace(/\\([!-/:-@[-`{-~])/g, '$1') // backslash escapes (ASCII punctuation only)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}
