import { describe, expect, it } from 'vitest';
import { fullFixture, type VaultDoc } from '@hq/store-fs';
import { searchAll } from './search';

function doc(): VaultDoc {
  const d = fullFixture();
  d.notes.push({
    id: 'nte_cafe',
    title: 'Saturday plans',
    body: 'Meet Pieter at the Café on Long Street before the ride, then go to the tile shop for samples and the grout colours.',
    tags: [],
    pinned: false,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z',
  });
  d.tasks.push({
    id: 'tsk_cafe',
    title: 'Pay the café bill',
    priority: 'medium',
    focus: false,
    status: 'ready',
    createdAt: '2026-07-11T00:00:00.000Z',
  });
  return d;
}

describe('searchAll', () => {
  it('finds a note by its body, accent-insensitively, with a snippet around the hit', () => {
    const hit = searchAll(doc(), 'cafe').find((r) => r.id === 'nte_cafe');
    expect(hit).toMatchObject({ type: 'note', title: 'Saturday plans' });
    expect(hit?.snippet).toContain('Café');
    expect(hit!.snippet!.length).toBeLessThanOrEqual(80);
  });

  it('ranks a title match before a body match', () => {
    const ids = searchAll(doc(), 'cafe').map((r) => r.id);
    expect(ids.indexOf('tsk_cafe')).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf('tsk_cafe')).toBeLessThan(ids.indexOf('nte_cafe'));
  });

  it('is case-insensitive and searches projects, tasks, notes and events', () => {
    const found = (q: string) => searchAll(doc(), q).map((r) => `${r.type}:${r.id}`);
    expect(found('KITCHEN')).toContain('project:prj_a');
    expect(found('plumber')).toEqual(expect.arrayContaining(['task:tsk_a', 'event:evt_a']));
    expect(found('marinade')).toContain('note:nte_braai');
  });

  it('leaves out archived projects', () => {
    const ids = searchAll(doc(), 'planning').map((r) => r.id);
    expect(ids).not.toContain('prj_b');
    expect(ids).toContain('prj_c');
  });

  it('returns nothing for an empty query and respects the limit', () => {
    expect(searchAll(doc(), '   ')).toEqual([]);
    expect(searchAll(doc(), 'e', 3)).toHaveLength(3);
  });
});
