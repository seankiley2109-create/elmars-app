import type { ID, Project } from '../types';

const fold = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Reads one captured line. An `@` at the start of a word names a project: the longest run of whole
 * words after it that is a case-insensitive prefix of a non-archived project's name picks that
 * project (the first in board order — the order of `projects` — when several fit), and those
 * `@words` leave the title. `Call Pieter @kitch` → "Call Pieter" in Kitchen renovation.
 * With no match the text stays as it is, `@` and all.
 */
export function parseCapture(text: string, projects: Project[]): { title: string; projectId?: ID } {
  const open = projects.filter((p) => !p.archived).map((p) => ({ id: p.id, name: fold(p.name) }));

  for (const at of text.matchAll(/(^|\s)@/g)) {
    const start = at.index + at[1].length; // the @ itself
    const rest = text.slice(start + 1);
    const words = [...rest.matchAll(/\S+/g)];
    if (words.length === 0 || words[0].index !== 0) continue; // "@ kitchen" names nothing

    let best: { id: ID; end: number } | undefined;
    for (let k = 1; k <= words.length; k++) {
      const prefix = fold(words.slice(0, k).map((w) => w[0]).join(' '));
      const hit = open.find((p) => p.name.startsWith(prefix));
      if (!hit) break; // a longer run can only be a longer prefix, so it cannot match either
      const last = words[k - 1];
      best = { id: hit.id, end: start + 1 + last.index + last[0].length };
    }
    if (best) {
      const title = `${text.slice(0, start)} ${text.slice(best.end)}`.replace(/\s+/g, ' ').trim();
      return { title, projectId: best.id };
    }
  }
  return { title: text.trim() };
}
