/**
 * Deep equality for documents.
 *
 * `JSON.stringify(a) === JSON.stringify(b)` is the obvious shortcut and it is wrong here: it compares
 * key *order*, and `deserialize` rebuilds every object in its codec's field order, which is not the
 * order the store or the seed happened to build them in. Two identical documents stringify to
 * different strings, so the shortcut reports data loss where there is none — and a migration guarded
 * by it would refuse to run, permanently.
 *
 * `undefined` and an absent key are treated as the same thing, matching how optional fields round-trip
 * through YAML (an absent key reads back as `undefined`).
 */
export function docEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;

  const aArr = Array.isArray(a);
  if (aArr !== Array.isArray(b)) return false;
  if (aArr) {
    const x = a as unknown[];
    const y = b as unknown[];
    return x.length === y.length && x.every((v, i) => docEquals(v, y[i]));
  }

  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) if (!docEquals(x[k], y[k])) return false;
  return true;
}
