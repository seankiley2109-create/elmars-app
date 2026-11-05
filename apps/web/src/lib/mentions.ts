import type { ID } from '../types';

export type MentionKind = 'project' | 'note';
export interface MentionTarget {
  type: MentionKind;
  id: ID;
}

/** `elmar://project/<id>` / `elmar://note/<id>` — the href a mention carries in a note body. */
export const mentionHref = (type: MentionKind, id: ID): string => `elmar://${type}/${id}`;

/** The target behind a mention href, or undefined for any other href. */
export function parseMentionHref(href: string | null | undefined): MentionTarget | undefined {
  const m = /^elmar:\/\/(project|note)\/([^/?#\s]+)$/.exec(href ?? '');
  return m ? { type: m[1] as MentionKind, id: decodeURIComponent(m[2]) } : undefined;
}

/**
 * A markdown link (not an image) whose href is a mention. The label may hold escaped brackets
 * (`\]`), which is how the editor writes a name like "Q4 [draft]".
 */
const MENTION_LINK = /(?<!!)\[(?:\\.|[^\]\\])*\]\((elmar:\/\/[^)\s]+)\)/g;

/** Every project and note a note body mentions, each once, in order of first mention. */
export function mentionTargets(md: string): MentionTarget[] {
  const out: MentionTarget[] = [];
  const seen = new Set<string>();
  for (const m of md.matchAll(MENTION_LINK)) {
    const target = parseMentionHref(m[1]);
    if (!target) continue;
    const key = `${target.type}/${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}
