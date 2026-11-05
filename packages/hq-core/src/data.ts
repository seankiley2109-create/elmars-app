import type { ActivityEvent, Asset, CalEvent, Link, Note, Project, Settings, Task } from './types';

export const defaultSettings: Settings = {
  userName: '',
  onboarded: false,
};

/**
 * A title or location as one line: each run of line breaks (with the space around it) becomes a
 * single space, then the ends are trimmed. A pasted multi-line title is stored this way everywhere
 * (store boundary and vault codecs), because the vault holds these fields on a single line.
 */
export const oneLine = (s: string): string => s.replace(/\s*[\r\n]+\s*/g, ' ').trim();

/** The swatches a top-level project can wear — each passes contrast on the paper surface. */
export const PROJECT_COLORS = [
  '#D64D1E',
  '#16877A',
  '#3A4FB0',
  '#8F5B00',
  '#0E7A5C',
  '#6B3FA0',
  '#B8175F',
  '#5A5852',
] as const;

/**
 * The colour for a new top-level project: the first swatch no top-level project wears yet, or, once
 * every swatch is taken, the one the count lands on so the palette cycles round evenly.
 * `inUse` is the colour of each existing top-level project (undefined = none set).
 */
export function nextProjectColor(inUse: ReadonlyArray<string | undefined>): string {
  const taken = new Set(inUse.filter((c): c is string => Boolean(c)).map((c) => c.toLowerCase()));
  const free = PROJECT_COLORS.find((c) => !taken.has(c.toLowerCase()));
  return free ?? PROJECT_COLORS[inUse.length % PROJECT_COLORS.length];
}

/** A document with every collection present and empty. The shape `partialize` persists. */
export const emptyData = () => ({
  settings: { ...defaultSettings },
  projects: [] as Project[],
  tasks: [] as Task[],
  notes: [] as Note[],
  links: [] as Link[],
  assets: [] as Asset[],
  activity: [] as ActivityEvent[],
  events: [] as CalEvent[],
});
