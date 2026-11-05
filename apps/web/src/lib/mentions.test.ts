import { describe, expect, it } from 'vitest';
import { mentionTargets } from './mentions';

describe('mentionTargets', () => {
  it('finds both kinds and ignores ordinary links', () => {
    const md = [
      'Call about [Kitchen renovation](elmar://project/p1) today.',
      'See [Braai marinade](elmar://note/n2) and [the shop](https://example.com).',
      '![tiles](asset:a1) and [quote.pdf](asset:a2)',
    ].join('\n\n');
    expect(mentionTargets(md)).toEqual([
      { type: 'project', id: 'p1' },
      { type: 'note', id: 'n2' },
    ]);
  });

  it('lists each target once, even when mentioned twice', () => {
    const md = '[A](elmar://project/p1) then [A again](elmar://project/p1)';
    expect(mentionTargets(md)).toEqual([{ type: 'project', id: 'p1' }]);
  });

  it('ignores other elmar kinds and images that happen to use the scheme', () => {
    expect(mentionTargets('[t](elmar://task/t1) ![x](elmar://note/n1)')).toEqual([]);
  });

  it('finds nothing in plain text', () => {
    expect(mentionTargets('elmar://project/p1 is not a link')).toEqual([]);
  });
});
