/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

/**
 * Elmar's app was forked from a personal app whose data and fixtures described someone else's work.
 * None of that may ship. This reads every source file under `apps/` and `packages/` and fails,
 * listing file and line, if a name from that world turns up.
 *
 * The files come in through Vite's glob rather than `node:fs`, so the package needs no Node typings.
 * `node_modules`, `dist` and `src-tauri/target` are skipped, as are binary and generated file types.
 */
// The names themselves are kept out of plain sight (this repository is public), so the alternation
// is stored base64-encoded; decode it to read or extend the list.
const FORBIDDEN = new RegExp(
  `\\b(${atob(
    'VFNNfE1EQ1RTTVxkKnxKTkJUU01cZCp8U2VudGluZWx8RHJ1dmF8ZHNtYWRtY3xTcGVjdHJ1bSBQcm90ZWN0fE1hYVMzNjB8QXNwZXJhfEF0ZXJhfENsb3V0aWxpdHk=',
  )})\\b`,
  'i',
);

const SELF = 'no-personal-data.test.ts';

const files = import.meta.glob(
  [
    '../../../apps/**/*.{ts,tsx,css,html,json,md}',
    '../../../packages/**/*.{ts,tsx,css,html,json,md}',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/src-tauri/target/**',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

describe('no personal data ships', () => {
  it('finds no names from the app this was forked from', () => {
    const paths = Object.keys(files);
    expect(paths.length).toBeGreaterThan(20); // the scan really ran, rather than finding nothing to scan

    // the glob reports `packages/*` siblings as `../hq-core/...`; print them from the repo root
    const fromRoot = (p: string) => {
      const bare = p.replace(/^(\.\.\/)+/, '');
      return bare.startsWith('apps/') ? bare : `packages/${bare}`;
    };

    const hits: string[] = [];
    for (const path of paths) {
      if (path.endsWith(SELF)) continue; // it has to spell out the very words it forbids
      files[path].split(/\r?\n/).forEach((line, i) => {
        if (FORBIDDEN.test(line)) hits.push(`${fromRoot(path)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits, `personal data found:\n${hits.join('\n')}`).toEqual([]);
  });
});
