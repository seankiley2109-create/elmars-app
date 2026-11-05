import { describe, expect, it } from 'vitest';
import { canonical, deserialize, fullFixture, serialize } from '@hq/store-fs';

/**
 * The app-level view of the vault round trip: what Elmar's data looks like once it has been written
 * to files and read back. The exhaustive field-by-field cases live in `hq-store-fs`; this one pins
 * the properties the app leans on.
 */
describe('vault round trip — the fixture, as the app sees it', () => {
  it('round-trips the full fixture', () => {
    const d = fullFixture();
    expect(deserialize(serialize(d))).toEqual(canonical(d));
  });

  it('actually has data to lose', () => {
    const d = fullFixture();
    expect(d.projects.length).toBeGreaterThan(5);
    expect(d.projects.filter((p) => !p.parentId).length).toBeGreaterThan(1);
    expect(d.tasks.length).toBeGreaterThan(0);
    expect(d.notes.length).toBeGreaterThan(0);
    expect(d.links.length).toBeGreaterThan(0);
    expect(d.assets.length).toBeGreaterThan(0);
  });

  it('keeps every project name and status', () => {
    const d = fullFixture();
    const back = deserialize(serialize(d));
    expect(back.projects.map((p) => p.name).sort()).toEqual(d.projects.map((p) => p.name).sort());
    expect(back.projects.filter((p) => p.status === 'blocked')).toHaveLength(
      d.projects.filter((p) => p.status === 'blocked').length,
    );
  });

  it('writes one legible markdown file per project', () => {
    const files = serialize(fullFixture());
    const projectFiles = [...files.keys()].filter((p) => p.startsWith('projects/'));
    expect(projectFiles).toHaveLength(fullFixture().projects.length);
    expect(projectFiles).toContain('projects/kitchen-renovation.md');
  });
});
