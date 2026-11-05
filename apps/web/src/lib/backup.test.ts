import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));

import { useHQ } from '../store';
import { canonical, fullFixture } from '@hq/store-fs';
import { NOT_A_BACKUP, backupFileName, backupSummary, parseBackup } from './backup';

const S = () => useHQ.getState();
const vaultDoc = () => {
  const { version: _v, ...doc } = S().exportData();
  return doc;
};

beforeEach(() => {
  S().clearAll();
});

describe('a backup file', () => {
  it('a backup restores to the same document', () => {
    S().completeOnboarding('Elmar', fullFixture());
    const before = vaultDoc();
    const text = JSON.stringify(S().exportData(), null, 2);

    S().clearAll();
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(S().importData(parsed.raw)).toEqual({ ok: true });

    expect(canonical(vaultDoc())).toEqual(canonical(before));
  });

  it('a version-6 HQ backup is turned away with a plain message', () => {
    const hq = JSON.stringify({ ...S().exportData(), version: 6 });
    expect(parseBackup(hq)).toEqual({ ok: false, error: "This isn't a backup from Elmar's App." });
    expect(S().importData(JSON.parse(hq))).toEqual({ ok: false, error: NOT_A_BACKUP });
    expect(NOT_A_BACKUP).toBe("This isn't a backup from Elmar's App.");
  });

  it('text that is not JSON is read as not a backup, not a crash', () => {
    const r = parseBackup('definitely not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/couldn't be read/);
  });

  it('is named with the local date', () => {
    expect(backupFileName(new Date(2026, 10, 3, 23, 59))).toBe("Elmar's App backup 2026-11-03.json");
    expect(backupFileName(new Date(2026, 0, 9, 0, 1))).toBe("Elmar's App backup 2026-01-09.json");
  });

  it('is summarised in plain counts, singular and plural', () => {
    expect(backupSummary({ projects: 1, tasks: 0, notes: 12, events: 2 })).toBe('1 project, 0 tasks, 12 notes and 2 events');
    expect(backupSummary({ projects: 1, tasks: 0, notes: 12, events: 1, files: 3 })).toBe(
      '1 project, 0 tasks, 12 notes, 1 event and 3 attached files',
    );
  });
});
