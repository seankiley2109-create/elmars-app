import { CODECS, type Codec, type VaultDoc, type VaultFiles } from './codecs';

const KEYS = Object.keys(CODECS) as (keyof VaultDoc)[];

// Generic hops so `CODECS[k]` narrows to `Codec<K>` and the value types stay checked.
function writeKey<K extends keyof VaultDoc>(k: K, doc: VaultDoc, out: VaultFiles): void {
  const codec: Codec<K> = CODECS[k];
  codec.write(codec.sort(doc[k]), out, doc);
}

function readKey<K extends keyof VaultDoc>(k: K, files: VaultFiles, out: VaultDoc): void {
  out[k] = CODECS[k].read(files);
}

function sortKey<K extends keyof VaultDoc>(k: K, doc: VaultDoc, out: VaultDoc): void {
  out[k] = CODECS[k].sort(doc[k]);
}

/**
 * The document as files. Collections that are empty write no file at all.
 *
 * Output is a pure function of `doc` — no clock, no randomness, no Map-order dependence — because the
 * writer in the app diffs this against what it last wrote. Non-determinism here would rewrite the
 * whole vault on every keystroke.
 */
export function serialize(doc: VaultDoc): VaultFiles {
  const out: VaultFiles = new Map();
  for (const k of KEYS) writeKey(k, doc, out);
  return out;
}

/** Files back to a document. A missing path means an empty collection, never an error. */
export function deserialize(files: VaultFiles): VaultDoc {
  const out = {} as VaultDoc;
  for (const k of KEYS) readKey(k, files, out);
  return out;
}

/**
 * The document in the order the vault stores it.
 *
 * Serializing sorts each collection into file order, so a round trip returns the canonical form
 * rather than the input's arbitrary array order. That is not data loss — no field changes — but it
 * means the contract is:
 *
 *     deserialize(serialize(d)) === canonical(d)
 *
 * `canonical` is idempotent and `serialize(canonical(d)) === serialize(d)`, so once a document lives
 * in the vault every later load/save cycle is a fixpoint.
 */
export function canonical(doc: VaultDoc): VaultDoc {
  const out = {} as VaultDoc;
  for (const k of KEYS) sortKey(k, doc, out);
  return out;
}
