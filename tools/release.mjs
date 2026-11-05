#!/usr/bin/env node
// npm run release -- 0.1.1
//
// Bumps the app's version everywhere it is written, commits "release: v0.1.1", and makes the tag
// v0.1.1. It does NOT push: it prints the one command that does, and pushing the tag is what makes
// GitHub build and publish the update (.github/workflows/build-mac.yml). See docs/RELEASING.md.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION_FILES, bumpAll, readVersions, releaseProblem } from './release-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fail(message) {
  console.error(`\nrelease: ${message}\n`);
  process.exit(1);
}

const next = (process.argv[2] ?? '').replace(/^v/, '');
if (!next) fail('say which version, for example: npm run release -- 0.1.1');

const texts = Object.fromEntries(
  Object.entries(VERSION_FILES).map(([key, path]) => [key, readFileSync(join(root, path), 'utf8')]),
);
const versions = readVersions(texts);
const current = versions.tauriConf;
const disagree = Object.entries(versions).filter(([, v]) => v !== current);
if (disagree.length > 0) {
  fail(
    `the version files don't agree (${VERSION_FILES.tauriConf} says ${current}):\n` +
      disagree.map(([k, v]) => `  ${VERSION_FILES[k]} says ${v}`).join('\n'),
  );
}

const problem = releaseProblem(next, current);
if (problem) fail(problem);

if (git('status', '--porcelain') !== '') fail('there are uncommitted changes. Commit or put them aside first.');

const tag = `v${next}`;
if (git('tag', '--list', tag) !== '') fail(`the tag ${tag} already exists.`);

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') console.warn(`release: note: you're on "${branch}", not main.`);

const bumped = bumpAll(texts, next);
for (const [key, path] of Object.entries(VERSION_FILES)) writeFileSync(join(root, path), bumped[key]);

git('add', ...Object.values(VERSION_FILES));
git('commit', '-m', `release: ${tag}`);
// annotated, so `git push --follow-tags` takes it along (it skips lightweight tags)
git('tag', '-a', tag, '-m', `Elmar's App ${tag}`);

console.log(`\nReady: ${current} → ${next}, committed and tagged ${tag}.`);
console.log('\nTo publish it, run:\n');
console.log(`  git push origin ${branch === 'main' ? 'main' : branch} --follow-tags\n`);
console.log("GitHub then builds it and publishes the release (about 15 minutes). Elmar's app offers the update");
console.log('within 6 hours, or straight away from Settings → Check for updates.\n');
