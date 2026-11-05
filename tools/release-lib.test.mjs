// node --test tools/   (run by the root `npm test`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VERSION_FILES,
  bumpAll,
  compareVersions,
  parseVersion,
  readVersions,
  releaseProblem,
  tagProblems,
  fixUpdaterJson,
  updaterJsonProblems,
} from './release-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const realTexts = () =>
  Object.fromEntries(Object.entries(VERSION_FILES).map(([k, p]) => [k, readFileSync(join(root, p), 'utf8')]));

test('parses plain X.Y.Z, with or without a v, and nothing else', () => {
  assert.deepEqual(parseVersion('0.1.1'), [0, 1, 1]);
  assert.deepEqual(parseVersion('v1.20.3'), [1, 20, 3]);
  for (const bad of ['', '0.1', '0.1.1.1', '01.1.1', '0.1.1-beta', 'one', undefined]) assert.equal(parseVersion(bad), null, bad);
});

test('compares numerically, not as text', () => {
  assert.ok(compareVersions('0.1.10', '0.1.9') > 0);
  assert.ok(compareVersions('0.2.0', '0.1.99') > 0);
  assert.ok(compareVersions('1.0.0', '0.99.99') > 0);
  assert.equal(compareVersions('v0.1.1', '0.1.1'), 0);
  assert.ok(compareVersions('0.1.0', '0.1.1') < 0);
});

test('a release must be a plain version newer than the current one', () => {
  assert.equal(releaseProblem('0.1.1', '0.1.0'), null);
  assert.equal(releaseProblem('0.2.0', '0.1.9'), null);
  assert.match(releaseProblem('0.1.0', '0.1.0'), /newer/);
  assert.match(releaseProblem('0.0.9', '0.1.0'), /newer/);
  assert.match(releaseProblem('0.1', '0.1.0'), /isn't a version/);
  assert.match(releaseProblem('0.1.1-rc1', '0.1.0'), /isn't a version/);
});

test("reads the same version from every file in the repo as it is today", () => {
  const versions = readVersions(realTexts());
  const values = new Set(Object.values(versions));
  assert.equal(values.size, 1, JSON.stringify(versions));
  assert.ok(parseVersion([...values][0]));
});

test('bumps every file, and only the version, keeping CRLF line endings', () => {
  const texts = realTexts();
  const current = readVersions(texts).tauriConf;
  const bumped = bumpAll(texts, '9.8.7');
  assert.deepEqual(new Set(Object.values(readVersions(bumped))), new Set(['9.8.7']));
  for (const key of Object.keys(texts)) {
    // put the old version back and the file is byte-for-byte what it was
    const restored = bumpAll({ [key]: bumped[key] }, current)[key];
    assert.equal(restored, texts[key], key);
  }
  // the root package.json's own version and other packages' versions are not the app's version
  assert.match(bumped.lockfile, /"name": "elmars-app",\r?\n\s+"version": "1.0.0"/);

  const crlf = { tauriConf: '{\r\n  "version": "0.1.0",\r\n  "x": { "version": "5" }\r\n}\r\n' };
  assert.equal(bumpAll(crlf, '0.1.1').tauriConf, '{\r\n  "version": "0.1.1",\r\n  "x": { "version": "5" }\r\n}\r\n');
  const lock = { cargoLock: '[[package]]\r\nname = "elmars-app"\r\nversion = "0.1.0"\r\n' };
  assert.equal(bumpAll(lock, '0.1.1').cargoLock, '[[package]]\r\nname = "elmars-app"\r\nversion = "0.1.1"\r\n');
  const toml = { cargoToml: '[package]\r\nname = "elmars-app"\r\nversion = "0.1.0"\r\n\r\n[dependencies]\r\nserde = { version = "1.0" }\r\n' };
  assert.match(bumpAll(toml, '0.1.1').cargoToml, /^version = "0.1.1"\r$/m);
  assert.match(bumpAll(toml, '0.1.1').cargoToml, /serde = \{ version = "1.0" \}/);
});

test('a file without a version is an error, not a silent skip', () => {
  assert.throws(() => bumpAll({ cargoLock: 'name = "something-else"\nversion = "1"\n' }, '0.1.1'), /Cargo.lock/);
});

test("the workflow's tag check: everything must agree with the tag", () => {
  const all = (v) => Object.fromEntries(Object.keys(VERSION_FILES).map((k) => [k, v]));
  assert.deepEqual(tagProblems('v0.1.1', all('0.1.1')), []);
  assert.deepEqual(tagProblems('refs/tags/v0.1.1', all('0.1.1')), []);
  const off = { ...all('0.1.1'), webPackage: '0.1.0' };
  assert.deepEqual(tagProblems('v0.1.1', off), ['apps/web/package.json says 0.1.0, the tag says 0.1.1']);
  assert.equal(tagProblems('v0.1.2', all('0.1.1')).length, Object.keys(VERSION_FILES).length);
  assert.match(tagProblems('vnext', all('0.1.1'))[0], /isn't a version/);
});

test('latest.json: both Macs must get the signed universal update; a missing one is filled from darwin-universal', () => {
  const app = { signature: 'c2ln', url: 'https://github.com/x/releases/download/v0.1.1/Elmar.s.App.app.tar.gz' };
  const good = { version: '0.1.1', platforms: { 'darwin-universal': app, 'darwin-aarch64': app, 'darwin-x86_64': app } };
  assert.deepEqual(updaterJsonProblems(good), []);

  const universalOnly = { version: '0.1.1', notes: 'n', platforms: { 'darwin-universal': app } };
  assert.deepEqual(updaterJsonProblems(universalOnly), [
    'darwin-aarch64 has no signed .app.tar.gz',
    'darwin-x86_64 has no signed .app.tar.gz',
  ]);
  const fixed = fixUpdaterJson(universalOnly);
  assert.deepEqual(updaterJsonProblems(fixed), []);
  assert.deepEqual(fixed.platforms['darwin-x86_64'], app);
  assert.equal(fixed.notes, 'n');

  // a .dmg or an unsigned entry does not count
  const dmg = { ...good, platforms: { ...good.platforms, 'darwin-x86_64': { signature: 'c2ln', url: 'x.dmg' } } };
  assert.deepEqual(updaterJsonProblems(dmg), ['darwin-x86_64 has no signed .app.tar.gz']);
  const unsigned = { ...good, platforms: { ...good.platforms, 'darwin-aarch64': { signature: '', url: app.url } } };
  assert.deepEqual(updaterJsonProblems(fixUpdaterJson(unsigned)), []);

  assert.throws(() => fixUpdaterJson({ version: '0.1.1', platforms: {} }), /no signed/);
});
