import { describe, expect, it } from 'vitest';
import { isSafeId, validateImport } from './validate';

const backup = (assetId: unknown) => ({
  version: 1,
  settings: { userName: 'Elmar' },
  projects: [],
  tasks: [],
  notes: [],
  links: [],
  activity: [],
  events: [],
  assets: [{ id: assetId, name: 'quote.pdf', mime: 'application/pdf', size: 3, createdAt: '2026-11-03T00:00:00.000Z' }],
});

describe('attachment ids in a backup', () => {
  it('accepts the ids the app makes: UUIDs, and older prefixed ones', () => {
    expect(validateImport(backup('4b0c7a6e-1d2f-4c3b-9a8e-123456789abc'))).not.toBeNull();
    expect(validateImport(backup('ast_a'))).not.toBeNull();
  });

  it('refuses a backup whose attachment id is not a plain name', () => {
    for (const bad of ['../../Library/x', '..', 'a/b', 'a\\b', '.hidden', '', 'a b', 'x'.repeat(200), 7]) {
      expect(validateImport(backup(bad))).toBeNull();
    }
  });

  it('isSafeId', () => {
    expect(isSafeId('ast_given')).toBe(true);
    expect(isSafeId('blob-1')).toBe(true);
    expect(isSafeId('../x')).toBe(false);
    expect(isSafeId('-x')).toBe(false);
  });
});
