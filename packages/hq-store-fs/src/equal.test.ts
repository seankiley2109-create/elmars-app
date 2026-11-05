import { describe, expect, it } from 'vitest';
import { emptyData } from '@hq/core/data';
import { docEquals } from './equal';
import { fullFixture } from './fixtures';
import { canonical, deserialize, serialize } from './serialize';

describe('docEquals', () => {
  it('ignores key order — the whole reason it exists', () => {
    // JSON.stringify would call these different and block a perfectly good migration
    const a = { id: 'p1', name: 'Kitchen renovation', status: 'active' };
    const b = { status: 'active', name: 'Kitchen renovation', id: 'p1' };
    expect(JSON.stringify(a) === JSON.stringify(b)).toBe(false);
    expect(docEquals(a, b)).toBe(true);
  });

  it('treats an absent key and undefined as the same', () => {
    expect(docEquals({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });

  it('still catches real differences', () => {
    expect(docEquals({ a: 1 }, { a: 2 })).toBe(false);
    expect(docEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(docEquals([1, 2], [2, 1])).toBe(false);
    expect(docEquals([1, 2], [1, 2, 3])).toBe(false);
    expect(docEquals({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
    expect(docEquals(null, {})).toBe(false);
    expect(docEquals([], {})).toBe(false);
  });

  it('says a real round trip is equal, where stringify does not', () => {
    const d = fullFixture();
    expect(docEquals(deserialize(serialize(d)), canonical(d))).toBe(true);
    expect(docEquals(deserialize(serialize(emptyData())), canonical(emptyData()))).toBe(true);
  });
});
