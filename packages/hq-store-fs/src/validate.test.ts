import { describe, expect, it } from 'vitest';
import { validateImport } from '@hq/core/validate';
import { fullFixture } from './fixtures';

// validateImport lives in @hq/core, which has no test runner of its own; this package already
// depends on core and owns the fixture, so the backup check is pinned here.
const backup = () => ({ version: 1 as const, ...fullFixture() });

describe('validateImport', () => {
  it('accepts a current backup and marks the user onboarded', () => {
    const out = validateImport({ ...backup(), settings: { userName: 'Elmar', onboarded: false } });
    expect(out).not.toBeNull();
    expect(out!.version).toBe(1);
    expect(out!.settings).toEqual({ userName: 'Elmar', onboarded: true });
    expect(out!.projects).toHaveLength(fullFixture().projects.length);
    expect(Object.keys(out!).sort()).toEqual(
      ['activity', 'assets', 'events', 'links', 'notes', 'projects', 'settings', 'tasks', 'version'],
    );
  });

  it('reads a backup from before events existed as having none', () => {
    const { events: _events, ...old } = backup();
    expect(validateImport(old)!.events).toEqual([]);
  });

  it('refuses a backup whose events are malformed', () => {
    expect(validateImport({ ...backup(), events: 'nope' })).toBeNull();
    expect(validateImport({ ...backup(), events: [{ id: 'e', title: 'x', date: 'tomorrow' }] })).toBeNull();
    expect(validateImport({ ...backup(), events: [{ id: 'e', title: 'x', date: '2026-11-03', start: '9am' }] })).toBeNull();
    expect(validateImport({ ...backup(), events: [{ title: 'x', date: '2026-11-03' }] })).toBeNull();
  });

  it('keeps lastExportAt and drops settings it does not know', () => {
    const out = validateImport({ ...backup(), settings: { userName: 'E', onboarded: true, lastExportAt: '2026-07-01T10:00:00.000Z', theme: 'dark' } });
    expect(out!.settings).toEqual({ userName: 'E', onboarded: true, lastExportAt: '2026-07-01T10:00:00.000Z' });
  });

  it('accepts version 1 only — there is nothing older to upgrade from', () => {
    for (const version of [0, 2, 3, 4, 5, 6, '1', undefined]) {
      expect(validateImport({ ...backup(), version })).toBeNull();
    }
  });

  it('refuses things that are not a document', () => {
    for (const raw of [null, undefined, 'x', 42, [], {}]) expect(validateImport(raw)).toBeNull();
  });

  it('refuses a document missing a collection, or with a record that has no id', () => {
    for (const key of ['projects', 'tasks', 'notes', 'links', 'assets', 'activity'] as const) {
      const { [key]: _gone, ...rest } = backup();
      expect(validateImport(rest), `missing ${key}`).toBeNull();
      expect(validateImport({ ...backup(), [key]: [{ nope: true }] }), `${key} without id`).toBeNull();
    }
  });

  it('refuses a link that points at an entity type this app no longer has', () => {
    const links = [{ id: 'l1', from: { type: 'job', id: 'j1' }, to: { type: 'project', id: 'p1' }, kind: 'related' }];
    expect(validateImport({ ...backup(), links })).toBeNull();
  });

  it('refuses malformed records', () => {
    expect(validateImport({ ...backup(), notes: [{ id: 'n', title: 'x' }] })).toBeNull(); // no body
    expect(validateImport({ ...backup(), tasks: [{ id: 't', title: 'x' }] })).toBeNull(); // no status
    expect(validateImport({ ...backup(), assets: [{ id: 'a', name: 'x', mime: 'y', size: '9' }] })).toBeNull();
  });
});
