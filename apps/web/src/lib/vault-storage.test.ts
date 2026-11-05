import { describe, expect, it } from 'vitest';
import { emptyData } from '@hq/core/data';
import { serialize, type VaultDoc } from '@hq/store-fs';
import { MemFs } from './mem-fs';
import { createVaultStorage } from './vault-storage';

type Flushable = ReturnType<typeof createVaultStorage>;

const envelope = (state: VaultDoc) => JSON.stringify({ state, version: 1 });

const doc = (): VaultDoc => ({
  ...emptyData(),
  settings: { userName: 'Elmar', onboarded: true },
  projects: [
    { id: 'p1', name: 'Kitchen renovation', status: 'active', tags: [], links: [], archived: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'p2', name: 'Garden irrigation', status: 'later', tags: [], links: [], archived: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  ],
});

async function primed() {
  const fs = new MemFs();
  const root = fs.root();
  const storage = createVaultStorage(root) as Flushable;
  // seed the vault, then read it back so lastWritten is populated from disk as it is at boot
  for (const [path, content] of serialize(doc())) fs.set(path, content);
  await storage.getItem('hq-data');
  fs.writes = [];
  fs.removals = [];
  return { fs, storage };
}

describe('vault storage', () => {
  it('treats an empty folder as nothing stored', async () => {
    const fs = new MemFs();
    const storage = createVaultStorage(fs.root());
    expect(await storage.getItem('hq-data')).toBeNull();
  });

  it('reads a vault back into a document', async () => {
    const { storage } = await primed();
    const raw = await storage.getItem('hq-data');
    const parsed = JSON.parse(raw!) as { state: VaultDoc; version: number };
    expect(parsed.version).toBe(1);
    expect(parsed.state.projects.map((p) => p.name).sort()).toEqual(['Garden irrigation', 'Kitchen renovation']);
  });

  it('writes exactly one file when one project changes', async () => {
    const { fs, storage } = await primed();

    const next = doc();
    next.projects[0].nextStep = 'Choose the worktop';
    storage.setItem('hq-data', envelope(next));
    await storage.flush();

    expect(fs.writes).toEqual(['projects/kitchen-renovation.md']);
    expect(fs.removals).toEqual([]);
  });

  it('writes nothing at all when nothing changed', async () => {
    const { fs, storage } = await primed();
    storage.setItem('hq-data', envelope(doc()));
    await storage.flush();
    expect(fs.writes).toEqual([]);
  });

  it('removes the file when its entity is deleted', async () => {
    const { fs, storage } = await primed();

    const next = doc();
    next.projects = next.projects.filter((p) => p.id !== 'p2');
    storage.setItem('hq-data', envelope(next));
    await storage.flush();

    expect(fs.removals).toEqual(['projects/garden-irrigation.md']);
    expect(fs.files.has('projects/garden-irrigation.md')).toBe(false);
    expect(fs.files.has('projects/kitchen-renovation.md')).toBe(true);
  });

  it('debounces a burst into a single pass', async () => {
    const { fs, storage } = await primed();

    for (const step of ['a', 'ab', 'abc']) {
      const next = doc();
      next.projects[0].nextStep = step;
      storage.setItem('hq-data', envelope(next));
    }
    await storage.flush();

    expect(fs.writes).toEqual(['projects/kitchen-renovation.md']);
    expect(fs.files.get('projects/kitchen-renovation.md')).toContain('nextStep: abc');
  });

  it('primes the differ from disk, so a migration does not rewrite the vault it just wrote', async () => {
    // the migration writes the files itself rather than through setItem, leaving lastWritten empty
    const fs = new MemFs();
    for (const [path, content] of serialize(doc())) fs.set(path, content);
    const storage = createVaultStorage(fs.root()) as Flushable;

    await storage.prime();
    fs.writes = [];

    storage.setItem('hq-data', envelope(doc()));
    await storage.flush();
    expect(fs.writes).toEqual([]);
  });

  it('never touches paths it does not manage', async () => {
    const { fs, storage } = await primed();
    fs.set('.git/config', 'do not touch');
    fs.set('assets/ast_1__x.png', 'bytes');

    // a fresh read must not adopt them, so the delete pass cannot claim them
    const fresh = createVaultStorage(fs.root()) as Flushable;
    await fresh.getItem('hq-data');
    fresh.setItem('hq-data', envelope(doc()));
    await fresh.flush();

    expect(fs.removals).toEqual([]);
    expect(fs.files.get('.git/config')).toBe('do not touch');
    expect(fs.files.get('assets/ast_1__x.png')).toBe('bytes');
    void storage;
  });
});

/**
 * The read direction: Claude edits the vault, HQ tabs back in and notices.
 *
 * `git -C vault status` staying clean after a focus is the property that matters — if the reseed
 * breaks, merely looking at the tab rewrites the whole vault.
 */
describe('vault storage — syncFromDisk', () => {
  /** What Claude editing `projects/kitchen-renovation.md` by hand looks like from HQ's side. */
  const editOnDisk = (fs: MemFs, path: string, from: string, to: string) => {
    const raw = fs.files.get(path)!;
    expect(raw).toContain(from); // guard: a fixture drift would make this test vacuous
    fs.set(path, raw.replace(from, to));
  };

  it('returns null when nothing changed, and writes nothing', async () => {
    const { fs, storage } = await primed();
    expect(await storage.syncFromDisk()).toBeNull();
    expect(fs.writes).toEqual([]);
  });

  it('picks up a file edited outside HQ', async () => {
    const { fs, storage } = await primed();
    editOnDisk(fs, 'projects/kitchen-renovation.md', 'status: active', 'status: blocked');

    const result = await storage.syncFromDisk();

    expect(result?.changed).toEqual(['projects/kitchen-renovation.md']);
    expect(result?.doc.projects.find((p) => p.id === 'p1')?.status).toBe('blocked');
    // the other project came back untouched
    expect(result?.doc.projects.find((p) => p.id === 'p2')?.status).toBe('later');
  });

  it('picks up a file deleted outside HQ', async () => {
    const { fs, storage } = await primed();
    fs.files.delete('projects/garden-irrigation.md');

    const result = await storage.syncFromDisk();

    expect(result?.changed).toEqual(['projects/garden-irrigation.md']);
    expect(result?.doc.projects.map((p) => p.id)).toEqual(['p1']);
  });

  it('picks up a file added outside HQ', async () => {
    const { fs, storage } = await primed();
    const added = { ...doc(), projects: [{ ...doc().projects[0], id: 'p3', name: 'December in Knysna' }] };
    fs.set('projects/december-in-knysna.md', serialize(added).get('projects/december-in-knysna.md')!);

    const result = await storage.syncFromDisk();

    expect(result?.changed).toEqual(['projects/december-in-knysna.md']);
    expect(result?.doc.projects.map((p) => p.name).sort()).toEqual(['December in Knysna', 'Garden irrigation', 'Kitchen renovation']);
  });

  it('reseeds, so tabbing back does not rewrite the vault', async () => {
    // the whole point: without the reseed the next save sees Claude's files as new and rewrites them
    const { fs, storage } = await primed();
    editOnDisk(fs, 'projects/kitchen-renovation.md', 'status: active', 'status: blocked');

    const result = await storage.syncFromDisk();
    fs.writes = [];

    // what zustand does immediately after setState(result.doc)
    storage.setItem('hq-data', envelope(result!.doc));
    await storage.flush();

    expect(fs.writes).toEqual([]);
    expect(await storage.syncFromDisk()).toBeNull();
  });

  it('flushes a pending edit before reading, rather than reverting it', async () => {
    const { fs, storage } = await primed();

    const mine = doc();
    mine.projects[0].nextStep = 'Choose the worktop';
    storage.setItem('hq-data', envelope(mine)); // still inside the debounce window

    const result = await storage.syncFromDisk();

    // my in-flight edit reached disk...
    expect(fs.files.get('projects/kitchen-renovation.md')).toContain('nextStep: Choose the worktop');
    // ...and is not reported as someone else's change
    expect(result).toBeNull();
  });

  it('leaves unmanaged paths out of the diff', async () => {
    const { fs, storage } = await primed();
    fs.set('.git/index', 'churn');
    fs.set('assets/ast_1__x.png', 'bytes');

    expect(await storage.syncFromDisk()).toBeNull();
  });
});
