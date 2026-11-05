import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));

const putAssetBlob = vi.fn(async (_id: string, _blob: Blob, _name: string) => {});
vi.mock('./assets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./assets')>()),
  putAssetBlob: (id: string, blob: Blob, name: string) => putAssetBlob(id, blob, name),
  delAssetBlob: async () => {},
}));

import { useHQ } from '../store';
import { AttachmentTooBig, attachToNote, inlineAssetIds, snippetOf } from './note-files';
import { enmlToMarkdown } from './evernote/enml';

const S = () => useHQ.getState();

beforeEach(() => {
  S().clearAll();
  putAssetBlob.mockClear();
});

describe('attachToNote', () => {
  it('writes the bytes first, then adds the asset linked to the note under the same id', async () => {
    const n = S().addNote({ title: 'Kitchen' });
    const order: string[] = [];
    putAssetBlob.mockImplementationOnce(async () => {
      order.push(`blob (assets: ${S().assets.length})`);
    });
    const { assetId, name } = await attachToNote(new File(['png'], 'tiles.png', { type: 'image/png' }), n);
    expect(order).toEqual(['blob (assets: 0)']);
    expect(name).toBe('tiles.png');
    expect(S().assets).toMatchObject([{ id: assetId, name: 'tiles.png', mime: 'image/png', size: 3 }]);
    expect(S().links.some((l) => l.from.id === assetId && l.to.id === n)).toBe(true);
    expect(putAssetBlob.mock.calls[0][0]).toBe(assetId);
  });

  it('a failed write adds nothing: no asset, no link, and the caller hears about it', async () => {
    const n = S().addNote({ title: 'Kitchen' });
    putAssetBlob.mockRejectedValueOnce(new Error('disk full'));
    await expect(attachToNote(new File(['x'], 'photo.png', { type: 'image/png' }), n)).rejects.toThrow('disk full');
    expect(S().assets).toEqual([]);
    expect(S().links).toEqual([]);
  });

  it('refuses a file over 50 MB without writing anything', async () => {
    const n = S().addNote({ title: 'Kitchen' });
    const big = new File(['x'], 'holiday.mov');
    Object.defineProperty(big, 'size', { value: 50 * 1024 * 1024 + 1 });
    await expect(attachToNote(big, n)).rejects.toBeInstanceOf(AttachmentTooBig);
    expect(putAssetBlob).not.toHaveBeenCalled();
    expect(S().assets).toEqual([]);
  });

  it('names a pasted screenshot that has no name', async () => {
    const n = S().addNote({ title: 'Kitchen' });
    const { name } = await attachToNote(new File(['x'], '', { type: 'image/png' }), n);
    expect(name).toBe('Pasted image');
  });
});

describe('note text helpers', () => {
  it('inlineAssetIds finds images and file links', () => {
    expect([...inlineAssetIds('![a](asset:a1) and [b.pdf](asset:a2) and [w](https://x.y)')]).toEqual(['a1', 'a2']);
  });

  it('snippetOf reads an imported note as its words: names for files, links and mentions, never ids', () => {
    const img = '3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f';
    const pdf = '9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
    const enml =
      '<?xml version="1.0" encoding="UTF-8"?><en-note>' +
      '<h1>Trip to Knysna</h1>' +
      '<div><en-todo checked="false"/>Book the <a href="https://example.com/a_b-c(1)">shuttle</a></div>' +
      '<div><en-todo checked="true"/>Pack <en-media hash="h1" type="image/png"/></div>' +
      '<div><en-media hash="h2" type="application/pdf"/> and AT&amp;T, 1 &lt; 2, snake_case</div>' +
      '<table><tr><th>Day</th><th>Plan</th></tr><tr><td>Mon</td><td><b>Beach</b> | braai</td></tr></table>' +
      '<en-crypt>xyz</en-crypt>' +
      '</en-note>';
    const { markdown } = enmlToMarkdown(
      enml,
      new Map([
        ['h1', { id: img, name: 'beach-umbrella_1.png', mime: 'image/png' }],
        ['h2', { id: pdf, name: 'boarding_pass.pdf', mime: 'application/pdf' }],
      ]),
    );
    const body = `${markdown}\n\nSee [Knysna packing list](elmar://note/0b1c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e).\n\n<!-- clipped -->\n<div>Raw <b>html</b></div>`;
    const snip = snippetOf(body);
    expect(snip).not.toMatch(/asset:|elmar:|https?:|[0-9a-f]{8}-|[0-9a-f]{32}|<\/?[a-z]|\*\*|\]\(|---/);
    const words =
      'Trip to Knysna Book the shuttle Pack beach-umbrella_1.png boarding_pass.pdf and AT&T, 1 < 2, snake_case ' +
      'Day Plan Mon Beach | braai Encrypted in Evernote; not imported See Knysna packing list. Raw html';
    expect(snip).toBe(words.slice(0, 220)); // the list shows at most 220 characters
    // and the tail, past that cap, reads as cleanly
    expect(snippetOf(body.slice(body.indexOf('See ')))).toBe('See Knysna packing list. Raw html');
  });

  it('snippetOf reads as plain words: no entities, escapes, marks or HTML', () => {
    expect(snippetOf('# Plan\n\n1 < 2 > 0, \\<div> & **bold** [K](elmar://project/p) <!-- hidden --> <u>u</u> c \\| d')).toBe(
      'Plan 1 < 2 > 0, <div> & bold K u c | d',
    );
  });
});
