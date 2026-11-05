#!/usr/bin/env node
// npm run release -- 0.1.1      bump every version file to 0.1.1, commit "release: v0.1.1", tag v0.1.1
// npm run release -- --current  the first release: tag the version already in the files (v0.1.0), no commit
//
// Either way it only works on an up-to-date, clean main whose tag isn't taken here or on GitHub, and it
// does NOT push: it prints the one command that does. Pushing the tag is what makes GitHub build and
// publish the update (.github/workflows/build-mac.yml). See docs/RELEASING.md.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUSH_COMMAND, VERSION_FILES, bumpAll, readVersions, releaseGuardProblem, releaseProblem } from './release-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fail(message) {
  console.error(`\nrelease: ${message}\n`);
  process.exit(1);
}

const arg = (process.argv[2] ?? '').trim();
if (!arg) fail('say which version, for example: npm run release -- 0.1.1 (or --current for the very first release)');
const tagCurrent = arg === '--current';

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

const next = tagCurrent ? current : arg.replace(/^v/, '');
if (!tagCurrent) {
  const problem = releaseProblem(next, current);
  if (problem) fail(problem);
}

const tag = `v${next}`;
const guard = releaseGuardProblem(git, tag);
if (guard) fail(guard);

if (!tagCurrent) {
  const bumped = bumpAll(texts, next);
  for (const [key, path] of Object.entries(VERSION_FILES)) writeFileSync(join(root, path), bumped[key]);
  git('add', ...Object.values(VERSION_FILES));
  git('commit', '-m', `release: ${tag}`);
}
// annotated, so `git push --follow-tags` takes it along (it skips lightweight tags)
git('tag', '-a', tag, '-m', `Elmar's App ${tag}`);

console.log(
  tagCurrent
    ? `\nReady: tagged the current version as ${tag}.`
    : `\nReady: ${current} → ${next}, committed and tagged ${tag}.`,
);
console.log('\nTo publish it, run:\n');
console.log(`  ${PUSH_COMMAND}\n`);
console.log('GitHub then builds it and publishes the release (about 15 minutes). Elmar\'s app offers the update');
console.log('within 6 hours, or straight away from Settings → Check for updates.\n');
