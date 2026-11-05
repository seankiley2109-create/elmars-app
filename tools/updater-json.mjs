#!/usr/bin/env node
// node tools/updater-json.mjs path/to/latest.json [--fix]
// node tools/updater-json.mjs path/to/latest.json --create <version> <package url> <path/to/.sig> [notes]
//
// Checks that the release's latest.json offers the update to both Apple silicon (darwin-aarch64) and
// Intel (darwin-x86_64) Macs, pointing at the universal Elmar's App.app.tar.gz and its signature.
// Exits 1 when it doesn't. With --fix, fills the missing entries from darwin-universal and rewrites the file.
// With --create, writes the file from scratch from the published package (tauri-action can skip it:
// see buildUpdaterJson).
import { readFileSync, writeFileSync } from 'node:fs';
import { buildUpdaterJson, fixUpdaterJson, updaterJsonProblems } from './release-lib.mjs';

const [path, flag, ...rest] = process.argv.slice(2);
if (!path) {
  console.error('usage: node tools/updater-json.mjs latest.json [--fix | --create <version> <url> <sig file> [notes]]');
  process.exit(2);
}
let json;
if (flag === '--create') {
  const [version, url, sigFile, notes = ''] = rest;
  json = buildUpdaterJson({ version, url, signature: readFileSync(sigFile, 'utf8'), notes });
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`Wrote ${path} from the published update package.`);
} else {
  json = JSON.parse(readFileSync(path, 'utf8'));
  if (flag === '--fix') {
    json = fixUpdaterJson(json);
    writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`Rewrote ${path} so both Macs get the update.`);
  }
}
const problems = updaterJsonProblems(json);
if (problems.length > 0) {
  console.error(`latest.json isn't right yet:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`latest.json offers ${json.version} to Apple silicon and Intel Macs.`);
