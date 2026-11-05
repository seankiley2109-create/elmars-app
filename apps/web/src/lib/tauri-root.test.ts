import { describe, expect, it, vi } from 'vitest';
import './jsdom-blob';
import { fullFixture, serialize, type VaultDoc } from '@hq/store-fs';
import { MemFsPort, tempNameFor } from './fs-port';
import { createTauriRoot, IcloudPendingError, onIcloudProgress, sweepTempFiles } from './tauri-root';
import { readAsset, readManagedFiles, writeAsset } from './vault-fs';
import { createVaultStorage, flushOnQuit } from './vault-storage';

/**
 * The Mac app keeps its notes on the real file system through Tauri's fs plugin, behind a stand-in for
 * the browser's FileSystemDirectoryHandle. These tests run the unchanged vault code on that stand-in,
 * over an in-memory port, so what they prove is the seam: the same storage code, a different disk.
 */

const envelope = (state: VaultDoc) => JSON.stringify({ state, version: 1 });
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** The port's files as text, keyed by path. */
const asText = (port: MemFsPort) => new Map([...port.files].map(([p, b]) => [p, text(b)]));

async function saved() {
  const port = new MemFsPort();
  const storage = createVaultStorage(createTauriRoot('/v', port));
  storage.setItem('hq-data', envelope(fullFixture()));
  await storage.flush();
  port.writes = [];
  return { port, storage };
}

const bytesOf = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer());

describe('createTauriRoot', () => {
  it('writes the serialized fixture as files under the root', async () => {
    const { port } = await saved();
    const expected = new Map([...serialize(fullFixture())].map(([p, c]) => [`/v/${p}`, c]));
    expect(asText(port)).toEqual(expected);
  });

  it('reads back what it wrote', async () => {
    const { port } = await saved();
    const fresh = createVaultStorage(createTauriRoot('/v', port));
    const raw = await fresh.getItem('hq-data');
    expect(JSON.parse(raw as string).state.projects.length).toBe(fullFixture().projects.length);
    expect(port.writes).toEqual([]);
  });

  it('one edit writes one file', async () => {
    const { port, storage } = await saved();
    const next = fullFixture();
    next.projects[0].nextStep = 'Ring the plumber';
    storage.setItem('hq-data', envelope(next));
    await storage.flush();

    expect(port.writes).toHaveLength(1);
    expect(text(port.files.get(port.writes[0])!)).toContain('Ring the plumber');
  });

  it('never removes an unmanaged path', async () => {
    const { port, storage } = await saved();
    await port.writeFile('/v/My stuff.txt', new TextEncoder().encode('mine'));

    const next = fullFixture();
    next.notes.shift();
    storage.setItem('hq-data', envelope(next));
    await storage.flush();

    expect(port.removals.length).toBeGreaterThan(0); // the note really was removed
    expect(port.removals.every((p) => p.startsWith('/v/notes/'))).toBe(true);
    expect(text(port.files.get('/v/My stuff.txt')!)).toBe('mine');
  });

  it('round-trips an asset byte for byte', async () => {
    const port = new MemFsPort();
    const root = createTauriRoot('/v', port);
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e])], { type: 'image/png' });

    await writeAsset(root, 'ast_1', png, 'pic.png');
    const back = await readAsset(root, 'ast_1', 'image/png');

    expect(back).toBeDefined();
    expect([...(await bytesOf(back!))]).toEqual([0x89, 0x50, 0x4e]);
    expect(back!.type).toBe('image/png');
    expect([...port.files.keys()]).toEqual(['/v/assets/ast_1__pic.png']);
  });

  it('rejects a missing entry with NotFoundError', async () => {
    const root = createTauriRoot('/v', new MemFsPort());
    await expect(root.getFileHandle('nope.md')).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(root.getDirectoryHandle('nope')).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(root.removeEntry('nope.md')).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('reports a failed write and retries it', async () => {
    /** A disk that refuses exactly one write — iCloud mid-sync, a full disk for a moment. */
    class FlakyPort extends MemFsPort {
      failNext = false;
      override async writeFile(p: string, d: Uint8Array): Promise<void> {
        if (this.failNext) {
          this.failNext = false;
          throw new Error('disk said no');
        }
        return super.writeFile(p, d);
      }
    }
    const { port: seeded } = await saved();
    const port = new FlakyPort();
    for (const d of seeded.dirs) await port.mkdir(d);
    for (const [p, b] of seeded.files) await port.writeFile(p, b);
    port.failNext = true;
    port.writes = [];

    const onSaveError = vi.fn();
    const storage = createVaultStorage(createTauriRoot('/v', port), { onSaveError });
    await storage.getItem('hq-data');

    const next = fullFixture();
    next.projects[0].nextStep = 'Ring the plumber';
    storage.setItem('hq-data', envelope(next));
    await storage.flush();

    expect(onSaveError).toHaveBeenCalledTimes(1);
    expect(port.writes).toEqual([]);

    await storage.flush();
    expect(onSaveError).toHaveBeenCalledTimes(1);
    expect(port.writes).toHaveLength(1);
    expect(text(port.files.get(port.writes[0])!)).toContain('Ring the plumber');
  });

  it('flushOnQuit flushes before the window closes', async () => {
    /** A disk slow enough that closing without waiting would lose the write. */
    class SlowPort extends MemFsPort {
      override async writeFile(p: string, d: Uint8Array): Promise<void> {
        await new Promise((r) => setTimeout(r, 20));
        return super.writeFile(p, d);
      }
    }
    const port = new SlowPort();
    const storage = createVaultStorage(createTauriRoot('/v', port));

    let onClose: ((e: { preventDefault(): void }) => unknown) | undefined;
    const landedAtDestroy: number[] = [];
    const win = {
      onCloseRequested: async (h: (e: { preventDefault(): void }) => unknown) => {
        onClose = h;
        return () => {};
      },
      destroy: vi.fn(async () => {
        landedAtDestroy.push(port.files.size);
      }),
    };
    await flushOnQuit(storage, win);

    storage.setItem('hq-data', envelope(fullFixture())); // debounced: nothing on disk yet
    expect(port.files.size).toBe(0);

    const preventDefault = vi.fn();
    await onClose!({ preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(win.destroy).toHaveBeenCalledTimes(1);
    expect(landedAtDestroy).toEqual([serialize(fullFixture()).size]);
  });
});

/**
 * macOS: Tauri's fs scope matches globs with `require_literal_leading_dot`, so `$HOME/**` refuses every
 * path with a component starting with `.`. Only the explicit allows in capabilities/default.json get
 * through: `.activity` (read and write) and iCloud's `.<name>.icloud` placeholders (exists only), in
 * any visible folder or in `.activity`.
 */
class UnixScopePort extends MemFsPort {
  refusals: string[] = [];
  private refused(p: string, op: string): boolean {
    const parts = p.split('/').filter(Boolean);
    const hidden = parts.filter((s) => s.startsWith('.'));
    if (hidden.every((s) => s === '.activity')) return false;
    const last = parts[parts.length - 1];
    const placeholder = /^\.(.+)\.icloud$/.test(last);
    const above = hidden.slice(0, -1);
    const placeholderAllowed =
      above.length === 0 || (above.length === 1 && parts[parts.length - 2] === '.activity');
    if (op === 'exists' && placeholder && placeholderAllowed) return false;
    this.refusals.push(`${op} ${p}`);
    return true;
  }
  private guard(p: string, op: string) {
    if (this.refused(p, op)) throw `forbidden path: ${p}`; // the plugin rejects with a bare string
  }
  override async readDir(p: string) {
    this.guard(p, 'readDir');
    return super.readDir(p);
  }
  override async readFile(p: string) {
    this.guard(p, 'readFile');
    return super.readFile(p);
  }
  override async writeFile(p: string, d: Uint8Array) {
    this.guard(p, 'writeFile');
    return super.writeFile(p, d);
  }
  override async mkdir(p: string) {
    this.guard(p, 'mkdir');
    return super.mkdir(p);
  }
  override async remove(p: string) {
    this.guard(p, 'remove');
    return super.remove(p);
  }
  override async rename(a: string, b: string) {
    this.guard(a, 'rename');
    this.guard(b, 'rename');
    return super.rename(a, b);
  }
  override async exists(p: string) {
    this.guard(p, 'exists');
    return super.exists(p);
  }
  override async stat(p: string) {
    this.guard(p, 'stat');
    return super.stat(p);
  }
  /** Put a file there the way Finder or iCloud would: not through the app, so not through the scope. */
  plant(p: string, content = 'x') {
    for (let at = p.slice(0, p.lastIndexOf('/')); at !== ''; at = at.slice(0, at.lastIndexOf('/'))) this.dirs.add(at);
    this.files.set(p, new TextEncoder().encode(content));
  }
}

describe('createTauriRoot on a macOS-style scope', () => {
  it('saves and loads the whole fixture, .activity included, with nothing refused', async () => {
    const port = new UnixScopePort();
    const storage = createVaultStorage(createTauriRoot('/v', port));
    storage.setItem('hq-data', envelope(fullFixture()));
    await storage.flush();
    expect([...port.files.keys()].some((p) => p.startsWith('/v/.activity/'))).toBe(true);

    const fresh = createVaultStorage(createTauriRoot('/v', port));
    const raw = await fresh.getItem('hq-data');
    expect(JSON.parse(raw as string).state.activity.length).toBe(fullFixture().activity.length);
    expect(port.refusals).toEqual([]);
  });

  it("skips Finder's .DS_Store and other hidden names, so loading never touches them", async () => {
    const port = new UnixScopePort();
    const seed = createVaultStorage(createTauriRoot('/v', port));
    seed.setItem('hq-data', envelope(fullFixture()));
    await seed.flush();
    port.plant('/v/.DS_Store');
    port.plant('/v/notes/.DS_Store');
    port.plant('/v/.git/config');

    const storage = createVaultStorage(createTauriRoot('/v', port));
    await expect(storage.getItem('hq-data')).resolves.not.toBeNull();
    expect(port.refusals).toEqual([]);
  });

  it('lists an iCloud placeholder under its real name, touching only what the scope allows', async () => {
    const port = new UnixScopePort();
    port.plant('/v/notes/a.md', 'a');
    port.plant('/v/notes/.b.md.icloud', 'plist');
    port.plant('/v/notes/.DS_Store');
    const notes = await createTauriRoot('/v', port).getDirectoryHandle('notes');
    const names: string[] = [];
    for await (const name of notes.keys()) names.push(name);
    expect(names.sort()).toEqual(['a.md', 'b.md']);
    expect(port.refusals).toEqual([]);
  });

  it('checks for a placeholder and asks for the download without any refused path', async () => {
    const port = new UnixScopePort();
    port.plant('/v/notes/.b.md.icloud', 'plist');
    const asked: string[] = [];
    port.ensureDownloaded = async (p) => {
      asked.push(p);
      port.plant(p, '---\ntitle: B\n---\n');
      return true;
    };
    const files = await readManagedFiles(createTauriRoot('/v', port));
    expect([...files.keys()]).toEqual(['notes/b.md']);
    expect(asked).toEqual(['/v/notes/b.md']);
    expect(port.refusals).toEqual([]);
  });

  it('asking for a missing file checks for its placeholder within the scope, in .activity too', async () => {
    const port = new UnixScopePort();
    port.plant('/v/notes/a.md', 'a');
    port.plant('/v/.activity/2026-10.jsonl', '{}');
    const root = createTauriRoot('/v', port);
    for (const dir of ['notes', '.activity']) {
      const handle = await root.getDirectoryHandle(dir);
      await expect(handle.getFileHandle('gone.md')).rejects.toMatchObject({ name: 'NotFoundError' });
    }
    expect(port.refusals).toEqual([]);
  });
});

describe('createTauriRoot writes atomically', () => {
  it('writes beside the file and renames over it, leaving no temp files', async () => {
    const { port, storage } = await saved();
    const renames: [string, string][] = [];
    const rename = port.rename.bind(port);
    port.rename = async (a, b) => {
      renames.push([a, b]);
      return rename(a, b);
    };
    const next = fullFixture();
    next.projects[0].nextStep = 'Ring the plumber';
    storage.setItem('hq-data', envelope(next));
    await storage.flush();

    expect(renames).toHaveLength(1);
    const [from, to] = renames[0];
    expect(from.startsWith(`${to}.tmp-`)).toBe(true);
    expect(text(port.files.get(to)!)).toContain('Ring the plumber');
    expect([...port.files.keys()].filter((p) => p.includes('.tmp-'))).toEqual([]);
  });

  it('removes the temp file when the rename fails, and the old file is untouched', async () => {
    const { port } = await saved();
    const onSaveError = vi.fn();
    const storage = createVaultStorage(createTauriRoot('/v', port), { onSaveError });
    await storage.getItem('hq-data');
    const before = asText(port);
    port.rename = async () => {
      throw 'rename refused';
    };
    const next = fullFixture();
    next.projects[0].nextStep = 'Ring the plumber';
    storage.setItem('hq-data', envelope(next));
    await storage.flush();

    expect(onSaveError).toHaveBeenCalledTimes(1);
    expect(asText(port)).toEqual(before);
  });

  it('names temp files in exactly one shape: <name>.tmp-<8 of a-z0-9>', () => {
    for (let i = 0; i < 200; i++) expect(tempNameFor('/v/notes/a.md')).toMatch(/^\/v\/notes\/a\.md\.tmp-[a-z0-9]{8}$/);
  });

  it('never reads a left-behind temp file as data, and sweeps it on the next load', async () => {
    const { port } = await saved();
    const stray = '/v/projects/kitchen.md.tmp-abc12345';
    await port.writeFile(stray, new TextEncoder().encode('---\nhalf a fi'));
    const root = createTauriRoot('/v', port);

    const projects = await root.getDirectoryHandle('projects');
    const names: string[] = [];
    for await (const name of projects.keys()) names.push(name);
    expect(names.some((n) => n.includes('.tmp-'))).toBe(false);

    expect(await sweepTempFiles('/v', port)).toEqual([stray]);
    expect(port.files.has(stray)).toBe(false);
  });

  it('sweeps only inside the folders the app manages, and only its own temp shape', async () => {
    const { port } = await saved();
    const bytes = new TextEncoder().encode('his');
    await port.mkdir('/v/My stuff/deeper');
    const his = [
      '/v/My stuff/x.tmp-1',
      '/v/My stuff/report.tmp-old',
      '/v/My stuff/a.md.tmp-abcd1234', // our exact shape, but not our folder
      '/v/My stuff/deeper/b.md.tmp-abcd1234',
      '/v/notes.tmp-abcd1234', // at the root: not inside a managed folder
      '/v/notes/plan.tmp-old', // in our folder, but not our shape
      '/v/notes/plan.md.tmp-ABCD1234', // upper case: not our shape
      '/v/notes/plan.md.tmp-abcd123', // seven characters: not our shape
    ];
    for (const p of his) await port.writeFile(p, bytes);
    const ours = ['/v/notes/a.md.tmp-abcd1234', '/v/.activity/2026-07.jsonl.tmp-zz99yy88', '/v/assets/ast_1__x.png.tmp-00aa11bb'];
    await port.mkdir('/v/assets');
    for (const p of ours) await port.writeFile(p, bytes);

    const walked: string[] = [];
    const readDir = port.readDir.bind(port);
    port.readDir = async (p) => {
      walked.push(p);
      return readDir(p);
    };
    expect((await sweepTempFiles('/v', port)).sort()).toEqual([...ours].sort());
    for (const p of his) expect(port.files.has(p)).toBe(true);
    expect(walked.some((p) => p.startsWith('/v/My stuff'))).toBe(false); // never even looked
  });
});

describe('createTauriRoot matches the browser on wrong kinds and file types', () => {
  it('rejects a file where a folder is asked for, and the reverse, with TypeMismatchError', async () => {
    const port = new MemFsPort();
    await port.mkdir('/v/assets');
    await port.writeFile('/v/notes', new TextEncoder().encode('a stray file called notes'));
    const root = createTauriRoot('/v', port);
    await expect(root.getDirectoryHandle('notes')).rejects.toMatchObject({ name: 'TypeMismatchError' });
    await expect(root.getDirectoryHandle('notes', { create: true })).rejects.toMatchObject({
      name: 'TypeMismatchError',
    });
    await expect(root.getFileHandle('assets')).rejects.toMatchObject({ name: 'TypeMismatchError' });
  });

  it('skips a stray file named like a managed folder instead of failing the load', async () => {
    const { port } = await saved();
    for (const p of [...port.files.keys()]) if (p.startsWith('/v/notes/')) port.files.delete(p);
    port.dirs.delete('/v/notes');
    await port.writeFile('/v/notes', new TextEncoder().encode('not a folder'));
    const storage = createVaultStorage(createTauriRoot('/v', port));
    const raw = await storage.getItem('hq-data');
    expect(JSON.parse(raw as string).state.notes).toEqual([]);
  });

  it('gives files a MIME type from the extension', async () => {
    const port = new MemFsPort();
    await port.mkdir('/v/a');
    const names = ['n.md', 's.yaml', 'x.jsonl', 'p.png', 'q.JPG', 'r.pdf', 'w.webp', 'z.bin'];
    for (const n of names) await port.writeFile(`/v/a/${n}`, new Uint8Array([1]));
    const dir = await createTauriRoot('/v', port).getDirectoryHandle('a');
    const types: string[] = [];
    for (const n of names) types.push((await (await dir.getFileHandle(n)).getFile()).type);
    expect(types).toEqual([
      'text/markdown',
      'application/yaml',
      'application/jsonl',
      'image/png',
      'image/jpeg',
      'application/pdf',
      'image/webp',
      'application/octet-stream',
    ]);
  });
});

/**
 * iCloud Drive can move a file's bytes off the Mac and leave `.<name>.icloud` in its place. Such a note
 * is not deleted: the app fetches it before loading, and if it cannot, it loads nothing at all rather
 * than a document with that note missing (which the next save would then delete for good).
 */
describe('createTauriRoot with notes still in iCloud', () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const NOTE = '---\nid: nte_a\ntitle: A\n---\nThe body.\n';

  /** A disk whose `.a.md.icloud` placeholders come down (or do not) when asked. */
  function evicted(paths: string[], arrives: (p: string) => boolean) {
    const port = new MemFsPort();
    const asked: string[] = [];
    let inFlight = 0;
    const seen = { maxInFlight: 0 };
    port.ensureDownloaded = async (p) => {
      asked.push(p);
      inFlight++;
      seen.maxInFlight = Math.max(seen.maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      if (await port.exists(p)) return true;
      if (!arrives(p)) return false;
      await port.writeFile(p, enc(NOTE));
      return true;
    };
    const plant = async () => {
      for (const p of paths) {
        const dir = p.slice(0, p.lastIndexOf('/'));
        await port.mkdir(dir);
        await port.writeFile(`${dir}/.${p.slice(dir.length + 1)}.icloud`, enc('plist'));
      }
      port.writes = [];
    };
    return { port, asked, seen, plant };
  }

  it('downloads a placeholder and reads the note', async () => {
    const { port, asked, plant } = evicted(['/v/notes/a.md'], () => true);
    await plant();
    const files = await readManagedFiles(createTauriRoot('/v', port));
    expect(asked).toEqual(['/v/notes/a.md']);
    expect(files.get('notes/a.md')).toBe(NOTE);
    expect([...files.keys()]).toEqual(['notes/a.md']); // the placeholder itself is never data
  });

  it('refuses to load while a note is still in iCloud', async () => {
    const { port, plant } = evicted(['/v/notes/a.md'], () => false);
    await port.mkdir('/v/config');
    await port.writeFile('/v/config/settings.yaml', enc('userName: Elmar\n'));
    await plant();

    const err = await readManagedFiles(createTauriRoot('/v', port)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IcloudPendingError);
    expect((err as IcloudPendingError).paths).toEqual(['notes/a.md']);

    // and through the storage: nothing is ever written or removed
    const storage = createVaultStorage(createTauriRoot('/v', port));
    await expect(storage.getItem('hq-data')).rejects.toBeInstanceOf(IcloudPendingError);
    storage.setItem('hq-data', envelope({ ...fullFixture(), notes: [] }));
    await storage.flush();
    await storage.removeItem('hq-data');
    expect(port.writes).toEqual([]);
    expect(port.removals).toEqual([]);
    expect(port.files.has('/v/notes/.a.md.icloud')).toBe(true);
  });

  it('counts every note still in iCloud, in every folder, before giving up', async () => {
    const waiting = ['/v/notes/a.md', '/v/notes/trip/b.md', '/v/projects/shed.md', '/v/.activity/2026-10.jsonl'];
    const { port, plant } = evicted(waiting, () => false);
    await plant();
    const err = await readManagedFiles(createTauriRoot('/v', port)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IcloudPendingError);
    expect([...(err as IcloudPendingError).paths].sort()).toEqual(
      ['.activity/2026-10.jsonl', 'notes/a.md', 'notes/trip/b.md', 'projects/shed.md'].sort(),
    );
  });

  it('fetches several at once, but never more than four', async () => {
    const paths = Array.from({ length: 12 }, (_, i) => `/v/notes/n${i}.md`);
    const { port, seen, plant } = evicted(paths, () => true);
    await plant();
    const files = await readManagedFiles(createTauriRoot('/v', port));
    expect(files.size).toBe(12);
    expect(seen.maxInFlight).toBe(4);
  });

  it('reports progress while fetching', async () => {
    const paths = Array.from({ length: 6 }, (_, i) => `/v/notes/n${i}.md`);
    const { port, plant } = evicted(paths, () => true);
    await plant();
    const seen: { done: number; total: number }[] = [];
    const stop = onIcloudProgress((p) => seen.push(p));
    await readManagedFiles(createTauriRoot('/v', port));
    stop();
    expect(seen.map((p) => p.done)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(seen.every((p) => p.total === 6)).toBe(true);
  });

  it('a download that errors counts as still in iCloud, not as gone', async () => {
    const { port, plant } = evicted(['/v/notes/a.md'], () => true);
    await plant();
    port.ensureDownloaded = async () => {
      throw 'brctl failed';
    };
    const err = await readManagedFiles(createTauriRoot('/v', port)).catch((e: unknown) => e);
    expect((err as IcloudPendingError).paths).toEqual(['notes/a.md']);
  });

  it('a placeholder beside its downloaded file reads the file once and asks for nothing', async () => {
    const { port, asked, plant } = evicted(['/v/notes/a.md'], () => true);
    await plant();
    await port.writeFile('/v/notes/a.md', enc(NOTE));
    const files = await readManagedFiles(createTauriRoot('/v', port));
    expect([...files.keys()]).toEqual(['notes/a.md']);
    expect(asked).toEqual([]);
  });

  it('a whole fixture with one note evicted loads every note once it arrives', async () => {
    const { port } = await saved();
    const note = [...port.files.keys()].find((p) => p.startsWith('/v/notes/'))!;
    const bytes = port.files.get(note)!;
    port.files.delete(note);
    const name = note.slice(note.lastIndexOf('/') + 1);
    port.files.set(`${note.slice(0, note.lastIndexOf('/'))}/.${name}.icloud`, enc('plist'));
    port.ensureDownloaded = async (p) => {
      if (p === note) port.files.set(p, bytes);
      return port.exists(p);
    };
    const raw = await createVaultStorage(createTauriRoot('/v', port)).getItem('hq-data');
    expect(JSON.parse(raw as string).state.notes.length).toBe(fullFixture().notes.length);
  });

  it('an asset still in iCloud is found by name and fetched only when it is read', async () => {
    const port = new MemFsPort();
    await port.mkdir('/v/assets');
    await port.writeFile('/v/assets/.ast_2__other.png.icloud', enc('plist'));
    await port.writeFile('/v/assets/.ast_1__pic.png.icloud', enc('plist'));
    const asked: string[] = [];
    port.ensureDownloaded = async (p) => {
      asked.push(p);
      await port.writeFile(p, new Uint8Array([0x89, 0x50]));
      return true;
    };
    const back = await readAsset(createTauriRoot('/v', port), 'ast_1', 'image/png');
    expect([...(await bytesOf(back!))]).toEqual([0x89, 0x50]);
    expect(asked).toEqual(['/v/assets/ast_1__pic.png']); // not the other one
  });

  it('once a download times out, the rest are not waited for: all marked as still in iCloud at once', async () => {
    const paths = [
      ...Array.from({ length: 12 }, (_, i) => `/v/notes/n${i}.md`),
      ...Array.from({ length: 4 }, (_, i) => `/v/projects/p${i}.md`),
    ];
    const { port, asked, plant } = evicted(paths, () => false); // offline: every fetch times out
    await plant();
    const err = await readManagedFiles(createTauriRoot('/v', port)).catch((e: unknown) => e);
    expect((err as IcloudPendingError).paths).toHaveLength(16);
    expect(asked).toHaveLength(4); // the first wave only; nothing after the first timeout
  });

  it('a file asked for by name that is still in iCloud rejects with IcloudPendingError, not NotFoundError', async () => {
    const port = new MemFsPort();
    await port.mkdir('/v/notes');
    await port.writeFile('/v/notes/.a.md.icloud', enc('plist'));
    port.ensureDownloaded = async () => false;
    const notes = await createTauriRoot('/v', port).getDirectoryHandle('notes');
    const err = await notes.getFileHandle('a.md').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IcloudPendingError);
    expect((err as IcloudPendingError).paths).toEqual(['notes/a.md']);
    await expect(notes.getFileHandle('b.md')).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

/**
 * A note can be evicted after it loaded. Deleting or saving it must fetch it first: removing nothing
 * would leave a placeholder that brings the note back on the next load, and writing beside the
 * placeholder would make iCloud reconcile two copies. If it cannot be fetched, the save fails the
 * ordinary way (said once, kept, retried).
 */
describe('saving over or deleting a note that is still in iCloud', () => {
  const enc = (s: string) => new TextEncoder().encode(s);

  /** Loaded, then one note evicted. `online` decides whether asking for it brings it back. */
  async function evictedAfterLoad() {
    const { port } = await saved();
    const onSaveError = vi.fn();
    const storage = createVaultStorage(createTauriRoot('/v', port), { onSaveError });
    const raw = await storage.getItem('hq-data');
    const doc = JSON.parse(raw as string).state as VaultDoc;
    const note = [...port.files.keys()].find((p) => p.startsWith('/v/notes/'))!;
    const placeholder = `${note.slice(0, note.lastIndexOf('/'))}/.${note.slice(note.lastIndexOf('/') + 1)}.icloud`;
    const bytes = port.files.get(note)!;
    port.files.delete(note);
    port.files.set(placeholder, enc('plist'));
    const net = { online: false, asked: [] as string[] };
    port.ensureDownloaded = async (p) => {
      net.asked.push(p);
      if (p === note && net.online && port.files.has(placeholder)) {
        port.files.delete(placeholder); // as iCloud does: the placeholder becomes the file
        port.files.set(note, bytes);
      }
      return port.exists(p);
    };
    port.writes = [];
    port.removals = [];
    const noteId = doc.notes.find((n) => text(bytes).includes(n.id))!.id;
    return { port, storage, doc, note, placeholder, net, onSaveError, noteId };
  }

  it('deleting it offline fails the save, keeps the placeholder, and the next flush retries', async () => {
    const { port, storage, doc, note, placeholder, net, onSaveError, noteId } = await evictedAfterLoad();
    storage.setItem('hq-data', envelope({ ...doc, notes: doc.notes.filter((n) => n.id !== noteId) }));
    await storage.flush();

    expect(onSaveError).toHaveBeenCalledTimes(1);
    expect(port.files.has(placeholder)).toBe(true);
    expect(port.removals).toEqual([]);
    expect(storage.hasUnsaved()).toBe(true);

    net.online = true;
    await storage.flush(); // the retry
    expect(port.removals).toEqual([note]);
    expect(port.files.has(placeholder)).toBe(false);
    expect(port.files.has(note)).toBe(false);
    expect(storage.hasUnsaved()).toBe(false);
  });

  it('deleting it online downloads it, then removes it: no placeholder left to bring it back', async () => {
    const { port, storage, doc, note, placeholder, net, onSaveError, noteId } = await evictedAfterLoad();
    net.online = true;
    storage.setItem('hq-data', envelope({ ...doc, notes: doc.notes.filter((n) => n.id !== noteId) }));
    await storage.flush();
    expect(onSaveError).not.toHaveBeenCalled();
    expect(net.asked).toEqual([note]);
    expect(port.removals).toEqual([note]);
    expect([...port.files.keys()].some((p) => p === placeholder || p === note)).toBe(false);
  });

  it('saving over it writes nothing beside the placeholder until it has downloaded', async () => {
    const { port, storage, doc, note, placeholder, net, onSaveError, noteId } = await evictedAfterLoad();
    const edited = { ...doc, notes: doc.notes.map((n) => (n.id === noteId ? { ...n, body: `${n.body}\n\nBraai, revised` } : n)) };
    storage.setItem('hq-data', envelope(edited));
    await storage.flush();

    expect(onSaveError).toHaveBeenCalledTimes(1);
    expect(port.writes).toEqual([]);
    expect(port.files.has(note)).toBe(false);
    expect([...port.files.keys()].filter((p) => p.includes('.tmp-'))).toEqual([]);
    expect(port.files.has(placeholder)).toBe(true);

    net.online = true;
    await storage.flush();
    expect(port.writes).toEqual([note]);
    expect(text(port.files.get(note)!)).toContain('Braai, revised');
    expect(port.files.has(placeholder)).toBe(false);
  });

  it('an evicted asset is fetched before it is removed', async () => {
    const port = new MemFsPort();
    await port.mkdir('/v/assets');
    await port.writeFile('/v/assets/.ast_1__pic.png.icloud', enc('plist'));
    port.ensureDownloaded = async (p) => {
      port.files.delete('/v/assets/.ast_1__pic.png.icloud');
      await port.writeFile(p, new Uint8Array([1]));
      return true;
    };
    const root = createTauriRoot('/v', port);
    const { removeAsset } = await import('./vault-fs');
    await removeAsset(root, 'ast_1');
    expect([...port.files.keys()]).toEqual([]);
  });
});
