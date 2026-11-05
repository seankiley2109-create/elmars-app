import type { VaultDoc } from '@hq/store-fs';
import type { ID } from '../types';
import { isDone } from '../types';

export type SearchHit = { type: 'project' | 'task' | 'note' | 'event'; id: ID; title: string; snippet?: string };

const SNIPPET_MAX = 80;
const SNIPPET_LEAD = 30; // characters of context kept before the hit

/** Lower case with the accents taken off: "Café" and "cafe" read the same. */
function foldChars(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Folds `s` and remembers, for every folded character, where it came from in `s` — so a hit found
 * in the folded text can be cut out of the original, accents intact.
 */
function foldWithMap(s: string): { text: string; from: number[] } {
  let text = '';
  const from: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = foldChars(ch);
    for (let j = 0; j < f.length; j++) from.push(i);
    text += f;
    i += ch.length;
  }
  return { text, from };
}

/** Up to 80 characters of `body` around the hit at original index `at`, on one line. */
function snippetAround(body: string, at: number): string {
  const start = Math.max(0, at - SNIPPET_LEAD);
  const lead = start > 0 ? '…' : '';
  const room = SNIPPET_MAX - lead.length - 1; // keep one for a trailing ellipsis
  const end = Math.min(body.length, start + room);
  const tail = end < body.length ? '…' : '';
  return `${lead}${body.slice(start, end).replace(/\s+/g, ' ').trim()}${tail}`;
}

/**
 * Everything that matches `q`: titles first (a title that starts with the words before one that
 * merely contains them), then note bodies, each with a snippet around the hit. Case- and
 * accent-insensitive. Archived projects stay out; open tasks come before finished ones.
 */
export function searchAll(
  doc: Pick<VaultDoc, 'projects' | 'tasks' | 'notes' | 'events'>,
  q: string,
  limit = 20,
): SearchHit[] {
  const needle = foldChars(q).replace(/\s+/g, ' ').trim();
  if (!needle) return [];

  const candidates: SearchHit[] = [
    ...doc.projects.filter((p) => !p.archived).map((p) => ({ type: 'project' as const, id: p.id, title: p.name })),
    ...doc.tasks.filter((t) => !isDone(t)).map((t) => ({ type: 'task' as const, id: t.id, title: t.title })),
    ...doc.notes.map((n) => ({ type: 'note' as const, id: n.id, title: n.title })),
    ...doc.events.map((e) => ({ type: 'event' as const, id: e.id, title: e.title })),
    ...doc.tasks.filter(isDone).map((t) => ({ type: 'task' as const, id: t.id, title: t.title })),
  ];

  const titled: { hit: SearchHit; rank: number }[] = [];
  for (const c of candidates) {
    const at = foldChars(c.title).indexOf(needle);
    if (at >= 0) titled.push({ hit: c, rank: at === 0 ? 0 : 1 });
  }
  // stable: within a rank, the candidate order above holds
  titled.sort((a, b) => a.rank - b.rank);

  const inTitle = new Set(titled.map((t) => `${t.hit.type}:${t.hit.id}`));
  const bodies: SearchHit[] = [];
  for (const n of doc.notes) {
    if (inTitle.has(`note:${n.id}`)) continue;
    const folded = foldWithMap(n.body);
    const at = folded.text.indexOf(needle);
    if (at >= 0) bodies.push({ type: 'note', id: n.id, title: n.title, snippet: snippetAround(n.body, folded.from[at]) });
  }

  return [...titled.map((t) => t.hit), ...bodies].slice(0, limit);
}
