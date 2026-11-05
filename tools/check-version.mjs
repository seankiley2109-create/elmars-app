#!/usr/bin/env node
// node tools/check-version.mjs v0.1.1
//
// The release workflow's first step on a tag: stop before building if the tag and the version files
// disagree (a tag pushed by hand, or a bump that missed a file).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION_FILES, readVersions, tagProblems } from './release-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.argv[2] ?? '';
const versions = readVersions(
  Object.fromEntries(Object.entries(VERSION_FILES).map(([key, path]) => [key, readFileSync(join(root, path), 'utf8')])),
);
const problems = tagProblems(tag, versions);
if (problems.length > 0) {
  console.error(`The tag and the app's version don't match:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  console.error('Make releases with `npm run release -- X.Y.Z`, which sets them all and tags to match.');
  process.exit(1);
}
console.log(`Tag ${tag} matches the app's version (${versions.tauriConf}).`);
