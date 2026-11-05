// The version logic behind `npm run release` and the release workflow's tag check.
// Pure functions over file text, so they are tested without touching the repo (release-lib.test.mjs).
// Every bump is a targeted text replacement: formatting and line endings (CRLF on Windows) stay as they are.

/** The files that carry the app's version, relative to the repo root. */
export const VERSION_FILES = {
  tauriConf: 'apps/web/src-tauri/tauri.conf.json',
  webPackage: 'apps/web/package.json',
  lockfile: 'package-lock.json',
  cargoToml: 'apps/web/src-tauri/Cargo.toml',
  cargoLock: 'apps/web/src-tauri/Cargo.lock',
};

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** "0.1.1" or "v0.1.1" → [0, 1, 1]; anything else (including pre-release tags) → null. */
export function parseVersion(text) {
  const m = SEMVER.exec(String(text ?? '').trim().replace(/^v/, ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative, zero or positive as a is older than, the same as, or newer than b. */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`not a version: ${pa ? b : a}`);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/**
 * Why `next` can't be released after `current`, or null when it can. `next` must be plain X.Y.Z and
 * newer than what is there now.
 */
export function releaseProblem(next, current) {
  if (!parseVersion(next)) return `"${next}" isn't a version like 0.1.1.`;
  if (compareVersions(next, current) <= 0) return `${next} must be newer than the current version, ${current}.`;
  return null;
}

function replaceOnce(text, pattern, replacement, what) {
  if (!pattern.test(text)) throw new Error(`couldn't find the version in ${what}`);
  return text.replace(pattern, replacement);
}

/** The first "version": "…" in a JSON file (top-level in tauri.conf.json and package.json). */
export function readJsonVersion(text) {
  const m = /"version"\s*:\s*"([^"]+)"/.exec(text);
  return m ? m[1] : null;
}

export function bumpJsonVersion(text, version, what = 'the JSON file') {
  return replaceOnce(text, /("version"\s*:\s*")[^"]+(")/, `$1${version}$2`, what);
}

/** The apps/web entry in package-lock.json (the workspace's own version). */
export function readLockVersion(text) {
  const m = /"apps\/web"\s*:\s*\{\s*"name"\s*:\s*"@hq\/web"\s*,\s*"version"\s*:\s*"([^"]+)"/.exec(text);
  return m ? m[1] : null;
}

export function bumpLockVersion(text, version) {
  return replaceOnce(
    text,
    /("apps\/web"\s*:\s*\{\s*"name"\s*:\s*"@hq\/web"\s*,\s*"version"\s*:\s*")[^"]+(")/,
    `$1${version}$2`,
    'package-lock.json',
  );
}

/** `version = "…"` in Cargo.toml's [package] section. */
export function readCargoTomlVersion(text) {
  const m = /^\[package\][^[]*?^version\s*=\s*"([^"]+)"/m.exec(text);
  return m ? m[1] : null;
}

export function bumpCargoTomlVersion(text, version) {
  return replaceOnce(text, /(^\[package\][^[]*?^version\s*=\s*")[^"]+(")/m, `$1${version}$2`, 'Cargo.toml');
}

/** The app's own entry in Cargo.lock. */
export function readCargoLockVersion(text) {
  const m = /name = "elmars-app"\r?\nversion = "([^"]+)"/.exec(text);
  return m ? m[1] : null;
}

export function bumpCargoLockVersion(text, version) {
  return replaceOnce(text, /(name = "elmars-app"\r?\nversion = ")[^"]+(")/, `$1${version}$2`, 'Cargo.lock');
}

const READERS = {
  tauriConf: readJsonVersion,
  webPackage: readJsonVersion,
  lockfile: readLockVersion,
  cargoToml: readCargoTomlVersion,
  cargoLock: readCargoLockVersion,
};

const BUMPERS = {
  tauriConf: (t, v) => bumpJsonVersion(t, v, VERSION_FILES.tauriConf),
  webPackage: (t, v) => bumpJsonVersion(t, v, VERSION_FILES.webPackage),
  lockfile: bumpLockVersion,
  cargoToml: bumpCargoTomlVersion,
  cargoLock: bumpCargoLockVersion,
};

/** { key: version } for every version file's text in `texts` ({ key: text }). */
export function readVersions(texts) {
  return Object.fromEntries(Object.entries(texts).map(([k, t]) => [k, READERS[k](t)]));
}

/** The same texts with every version set to `version`. */
export function bumpAll(texts, version) {
  return Object.fromEntries(Object.entries(texts).map(([k, t]) => [k, BUMPERS[k](t, version)]));
}

/** The platforms an installed copy asks latest.json for: Apple silicon and Intel Macs. */
export const MAC_PLATFORMS = ['darwin-aarch64', 'darwin-x86_64'];

function isMacUpdate(entry) {
  return Boolean(
    entry &&
      typeof entry.signature === 'string' &&
      entry.signature.trim() !== '' &&
      typeof entry.url === 'string' &&
      entry.url.endsWith('.app.tar.gz'),
  );
}

/** What latest.json is missing for either kind of Mac. Empty when both point at a signed .app.tar.gz. */
export function updaterJsonProblems(json) {
  const problems = [];
  if (!parseVersion(json?.version)) problems.push(`"version" is ${JSON.stringify(json?.version)}`);
  for (const p of MAC_PLATFORMS) {
    if (!isMacUpdate(json?.platforms?.[p])) problems.push(`${p} has no signed .app.tar.gz`);
  }
  return problems;
}

/**
 * latest.json with darwin-aarch64 and darwin-x86_64 both filled from the universal build (one .app runs
 * on both). Entries already right are kept. Throws when there is no universal entry to copy from.
 */
export function fixUpdaterJson(json) {
  const platforms = { ...(json.platforms ?? {}) };
  const source = [platforms['darwin-universal'], platforms['darwin-universal-app'], ...MAC_PLATFORMS.map((p) => platforms[p])].find(
    isMacUpdate,
  );
  if (!source) throw new Error('latest.json has no signed .app.tar.gz to point both Macs at');
  for (const p of MAC_PLATFORMS) if (!isMacUpdate(platforms[p])) platforms[p] = { signature: source.signature, url: source.url };
  return { ...json, platforms };
}

/**
 * The workflow's check before building a tag: the tag, tauri.conf.json, apps/web/package.json (and
 * Cargo.toml) must all say the same version. Returns the problems, empty when they agree.
 */
export function tagProblems(tag, versions) {
  const want = String(tag).replace(/^refs\/tags\//, '').replace(/^v/, '');
  const problems = [];
  if (!parseVersion(want)) problems.push(`the tag "${tag}" isn't a version like v0.1.1`);
  for (const [key, have] of Object.entries(versions)) {
    if (have !== want) problems.push(`${VERSION_FILES[key]} says ${have ?? 'nothing'}, the tag says ${want}`);
  }
  return problems;
}
