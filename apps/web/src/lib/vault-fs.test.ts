import { describe, expect, it } from 'vitest';
import { fullFixture, serialize } from '@hq/store-fs';
import { assetFileName, assetNameOnDisk, isManagedPath, writeAsset } from './vault-fs';
import { MemFs } from './mem-fs';

/**
 * The allowlist and the codecs are two lists that must agree, and no type connects them.
 *
 * This is not hypothetical: `skills/` was missing from MANAGED_DIRS from the day Skill became an
 * entity until 2026-07-17. The codec wrote `skills/*.md` happily — `writeFile` does not check the
 * allowlist — but `readManagedFiles` never walked the directory, so every skill loaded as empty and
 * all 11 evidence links in `links.yaml` pointed at ids that no longer resolved. Nothing threw.
 */
describe('the managed-path allowlist covers the serializer', () => {
  it('every file the serializer writes is a path the walker reads back', () => {
    const unmanaged = [...serialize(fullFixture()).keys()].filter((p) => !isManagedPath(p));
    expect(unmanaged).toEqual([]);
  });

  it('still refuses everything outside it', () => {
    for (const p of ['.git/config', 'assets/ast_a__topology.png', '.obsidian/workspace.json', 'README.md']) {
      expect(isManagedPath(p)).toBe(false);
    }
  });
});

describe('attachment file names stay inside assets/', () => {
  it('names a file for the ids the app makes', () => {
    expect(assetFileName('4b0c7a6e-1d2f-4c3b-9a8e-123456789abc', 'quote.pdf')).toBe('4b0c7a6e-1d2f-4c3b-9a8e-123456789abc__quote.pdf');
    expect(assetFileName('ast_a', 'a/../b.png')).toBe('ast_a__a_.._b.png');
  });

  it('refuses an id that could reach outside the folder', () => {
    for (const bad of ['../x', '..', 'a/b', 'a\\b', '', '.hidden']) expect(() => assetFileName(bad, 'x.png')).toThrow();
  });

  it('writes nothing for a crafted id', async () => {
    const fs = new MemFs();
    await expect(writeAsset(fs.root(), '../../evil', new Blob(['x']), 'x.txt')).rejects.toThrow();
    expect([...fs.files.keys()]).toEqual([]);
    expect(fs.writes).toEqual([]);
  });

  it('finds a file by id, and never by a crafted one', async () => {
    const fs = new MemFs();
    fs.set('assets/ast_a__quote.pdf', 'x');
    expect(await assetNameOnDisk(fs.root(), 'ast_a')).toBe('ast_a__quote.pdf');
    expect(await assetNameOnDisk(fs.root(), '../assets/ast_a')).toBeUndefined();
  });
});
