import yaml from 'js-yaml';

/**
 * Dump with the DEFAULT schema, load with JSON_SCHEMA. The asymmetry is deliberate and load-bearing:
 *
 * - The default dumper knows `2026-01-14T09:12:00Z` would read back as a timestamp, so it quotes it.
 *   JSON_SCHEMA has no timestamp type and emits it bare — fine for us, but any *other* reader of the
 *   vault (Obsidian, a script, a human) would then parse it as a date. Quoting keeps the vault portable.
 * - JSON_SCHEMA on load never coerces a scalar to a Date, so a hand-written unquoted date in
 *   frontmatter stays a string instead of silently becoming an object we'd write back wrong.
 *
 * Every date in HQData is a string. Neither direction may ever produce a Date.
 *
 * js-yaml omits `undefined` values at every depth, so optional fields round-trip as absent keys
 * without any pre-processing.
 */
export function dumpYaml(value: unknown): string {
  return yaml.dump(value, { lineWidth: -1, noRefs: true });
}

export function loadYaml(text: string): unknown {
  return yaml.load(text, { schema: yaml.JSON_SCHEMA });
}

const FM_OPEN = '---\n';
const FM_CLOSE = '\n---\n';

/** `---\n<yaml>---\n\n<body>`. The body is omitted entirely when empty. */
export function stringifyDoc(data: Record<string, unknown>, body: string): string {
  const head = `${FM_OPEN}${dumpYaml(data)}---\n`;
  return body === '' ? head : `${head}\n${body}`;
}

export function parseDoc(text: string): { data: Record<string, unknown>; body: string } {
  if (!text.startsWith(FM_OPEN)) return { data: {}, body: text };
  // start at the trailing newline of FM_OPEN so empty frontmatter (`---\n---\n`) still matches
  const end = text.indexOf(FM_CLOSE, FM_OPEN.length - 1);
  if (end === -1) return { data: {}, body: text };

  const loaded = loadYaml(text.slice(FM_OPEN.length, end + 1));
  const data = typeof loaded === 'object' && loaded !== null ? (loaded as Record<string, unknown>) : {};

  let body = text.slice(end + FM_CLOSE.length);
  if (body.startsWith('\n')) body = body.slice(1); // the separator blank line stringifyDoc added
  return { data, body };
}
