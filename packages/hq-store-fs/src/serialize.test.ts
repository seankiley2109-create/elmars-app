import { describe, expect, it } from 'vitest';
import { emptyData } from '@hq/core/data';
import { canonical, deserialize, serialize } from './serialize';
import { fullFixture } from './fixtures';
import type { VaultDoc } from './codecs';

const roundTrip = (d: VaultDoc) => deserialize(serialize(d));

describe('round trip', () => {
  it('holds for an empty document', () => {
    const d = emptyData();
    expect(roundTrip(d)).toEqual(canonical(d));
  });

  it('holds for the full fixture — every collection, every field', () => {
    const d = fullFixture();
    expect(roundTrip(d)).toEqual(canonical(d));
  });

  it('writes no files for an empty document beyond settings', () => {
    expect([...serialize(emptyData()).keys()]).toEqual(['config/settings.yaml']);
  });

  it('is a fixpoint — load/save/load never drifts', () => {
    const once = roundTrip(fullFixture());
    expect(roundTrip(once)).toEqual(once);
    expect(serialize(once)).toEqual(serialize(roundTrip(once)));
  });

  it('canonical is idempotent and does not change the bytes', () => {
    const d = fullFixture();
    expect(canonical(canonical(d))).toEqual(canonical(d));
    expect(serialize(canonical(d))).toEqual(serialize(d));
  });

  it('is deterministic — same document, same files', () => {
    expect(serialize(fullFixture())).toEqual(serialize(fullFixture()));
  });
});

describe('the hazards', () => {
  it('gives two same-named projects two different files', () => {
    const files = serialize(fullFixture());
    const paths = [...files.keys()].filter((p) => p.startsWith('projects/'));
    expect(paths).toHaveLength(8);
    expect(new Set(paths).size).toBe(8);

    const back = roundTrip(fullFixture());
    expect(back.projects.map((p) => p.name).sort()).toEqual([
      'Board pack Q4',
      'Cycle Tour 2027',
      'December in Knysna',
      'Garden irrigation',
      'Kitchen renovation',
      'Planning',
      'Planning',
      'Planning',
    ]);
  });

  it('nests a child project under its parent folder and keeps parentId', () => {
    const files = serialize(fullFixture());
    // the nested "Planning" and the flat "Planning" pair never cross-collide
    expect([...files.keys()]).toContain('projects/kitchen-renovation/planning.md');
    const back = roundTrip(fullFixture());
    expect(back.projects.find((p) => p.id === 'prj_child')?.parentId).toBe('prj_a');
  });

  it('tolerates a dangling parent — flat path, parent: kept literally', () => {
    const files = serialize(fullFixture());
    expect([...files.keys()]).toContain('projects/garden-irrigation.md');
    expect(files.get('projects/garden-irrigation.md')).toContain('parent: prj_missing');
    const back = roundTrip(fullFixture());
    expect(back.projects.find((p) => p.id === 'prj_orphan')?.parentId).toBe('prj_missing');
  });

  it('nests a project file path through the full ancestor chain, at any depth', () => {
    const project = (over: Partial<VaultDoc['projects'][number]> & { id: string; name: string }) => ({
      status: 'active' as const,
      tags: [],
      links: [],
      archived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...over,
    });
    const doc: VaultDoc = {
      ...emptyData(),
      projects: [
        project({ id: 'root', name: 'Home' }),
        project({ id: 'mid', name: 'Kitchen renovation', parentId: 'root' }),
        project({ id: 'leaf', name: 'Order appliances', parentId: 'mid' }),
      ],
    };
    const files = serialize(doc);
    expect([...files.keys()]).toContain('projects/home/kitchen-renovation/order-appliances.md');

    const back = roundTrip(doc);
    expect(back.projects.find((p) => p.id === 'root')?.parentId).toBeUndefined();
    expect(back.projects.find((p) => p.id === 'mid')?.parentId).toBe('root');
    expect(back.projects.find((p) => p.id === 'leaf')?.parentId).toBe('mid');
  });

  it('gives filename-hostile and duplicate note titles distinct files and round-trips them', () => {
    const f = fullFixture();
    const files = serialize(f);
    const awkward = ['nte_plans', 'nte_untitled_1', 'nte_untitled_2', 'nte_braai'];
    const titles = awkward.map((id) => f.notes.find((n) => n.id === id)!.title);
    expect(titles).toEqual(['Plans: Q4/Q1?', 'Untitled', 'Untitled', 'Braai 🔥 marinade']);

    // four notes, four different files, every one of them under notes/
    const notePaths = [...files.keys()].filter((p) => p.startsWith('notes/'));
    const pathOf = (id: string) => notePaths.find((p) => files.get(p)!.includes(`id: ${id}\n`));
    const awkwardPaths = awkward.map(pathOf);
    expect(awkwardPaths.every((p): p is string => p !== undefined)).toBe(true);
    expect(new Set(awkwardPaths).size).toBe(4);
    // no path carries a character a filesystem could trip on
    expect(notePaths.every((p) => !/[:?*"<>|\\]/.test(p) && !p.includes('//'))).toBe(true);

    const back = deserialize(files);
    expect(back).toEqual(canonical(f));
    for (const id of awkward) {
      expect(back.notes.find((n) => n.id === id)).toEqual(f.notes.find((n) => n.id === id));
    }
  });

  it('keeps notes.folder a literal rather than deriving it from the path', () => {
    const files = serialize(fullFixture());
    expect([...files.keys()]).toContain('notes/home/recipes/braai-marinade.md');

    // the path is slugified and lossy; the frontmatter value is not
    const back = roundTrip(fullFixture());
    expect(back.notes.find((n) => n.id === 'nte_braai')?.folder).toBe('Home/Recipes');
    expect(back.notes.find((n) => n.id === 'nte_trips')?.folder).toBe('Travel & Trips/Ideas');
  });

  it('distinguishes an empty body from an absent one', () => {
    const back = roundTrip(fullFixture());
    expect(back.projects.find((p) => p.id === 'prj_c')?.notes).toBe('');
    expect(back.projects.find((p) => p.id === 'prj_b')?.notes).toBeUndefined();
    expect(back.notes.find((n) => n.id === 'nte_untitled_2')?.body).toBe('');
  });

  it('round-trips task titles that look like tokens', () => {
    const back = roundTrip(fullFixture());
    const title = (id: string) => back.tasks.find((t) => t.id === id)?.title;
    expect(title('tsk_b')).toBe('Title ending in a caret ^abc');
    expect(title('tsk_c')).toBe('See →prj_x for detail');
    expect(title('tsk_d')).toBe('Mid ⏫ string 📅 with ⭐ tokens');
    expect(title('tsk_e')).toBe('Ends with a date ➕ 2026-01-01');
    // a title ending in a 🛫 lookalike, on a task that carries a real 🛫/⏳ window
    expect(title('tsk_j')).toBe('Ends with a start token 🛫 2026-01-01');
  });

  it('round-trips the 🛫 start / ⏳ scheduled work window', () => {
    const back = roundTrip(fullFixture());
    const task = (id: string) => back.tasks.find((t) => t.id === id);
    // full window + deadline all present
    expect(task('tsk_a')).toMatchObject({ startDate: '2026-07-14', scheduledDate: '2026-07-17', dueDate: '2026-07-18' });
    // window only, no deadline
    expect(task('tsk_h')).toMatchObject({ startDate: '2026-07-20', scheduledDate: '2026-07-22' });
    expect(task('tsk_h')?.dueDate).toBeUndefined();
    // scheduled alone; start absent
    expect(task('tsk_i')?.scheduledDate).toBe('2026-07-25');
    expect(task('tsk_i')?.startDate).toBeUndefined();
    // the adversarial task's real window survives intact
    expect(task('tsk_j')).toMatchObject({ startDate: '2026-07-26', scheduledDate: '2026-07-28' });
    // absent on tasks that never had a window — undefined, not empty string
    expect(task('tsk_b')?.startDate).toBeUndefined();
    expect(task('tsk_b')?.scheduledDate).toBeUndefined();
  });

  it('prints 🛫/⏳ between ➕ created and 📅 due, in canonical order', () => {
    const line = serialize(fullFixture()).get('tasks/2026-07.md')!
      .split('\n').find((l) => l.includes('^tsk_a'))!;
    expect(line).toContain('➕ 2026-07-02 🛫 2026-07-14 ⏳ 2026-07-17 📅 2026-07-18');
  });

  it('keeps a Windows path in a project link intact', () => {
    const back = roundTrip(fullFixture());
    expect(back.projects.find((p) => p.id === 'prj_a')?.links[0]?.url).toBe(
      String.raw`C:\Users\Elmar\Documents\2026\Kitchen\quotes`,
    );
  });

  it('never produces a Date from a date-shaped string', () => {
    const back = roundTrip(fullFixture());
    expect(typeof back.projects[0]?.createdAt).toBe('string');
    expect(typeof back.notes[0]?.createdAt).toBe('string');
    expect(back.settings.lastExportAt).toBe('2026-07-01T10:00:00.000Z');
  });

  it('splits tasks into month files and keeps all five statuses', () => {
    const files = serialize(fullFixture());
    expect([...files.keys()].filter((p) => /^tasks\/\d{4}-\d{2}\.md$/.test(p)).sort()).toEqual([
      'tasks/2026-06.md',
      'tasks/2026-07.md',
    ]);
    expect(new Set(roundTrip(fullFixture()).tasks.map((t) => t.status))).toEqual(
      new Set(['backlog', 'ready', 'in_progress', 'waiting', 'done']),
    );
  });

  it('keeps records out of the document tree', () => {
    const keys = [...serialize(fullFixture()).keys()];
    expect(keys).toContain('.activity/2026-06.jsonl');
    expect(keys).toContain('.activity/2026-07.jsonl');
  });
});

describe('task notes sidecars', () => {
  it('round-trips notes: present, empty, and absent', () => {
    const back = roundTrip(fullFixture());
    expect(back.tasks.find((t) => t.id === 'tsk_a')?.notes).toContain('Confirm the water shut-off');
    expect(back.tasks.find((t) => t.id === 'tsk_c')?.notes).toBe(''); // empty, not undefined
    expect(back.tasks.find((t) => t.id === 'tsk_b')?.notes).toBeUndefined(); // absent
  });

  it('writes a sidecar only for tasks that have notes', () => {
    const sidecars = [...serialize(fullFixture()).keys()].filter((p) => p.startsWith('tasks/notes/')).sort();
    expect(sidecars).toEqual(['tasks/notes/tsk_a.md', 'tasks/notes/tsk_c.md']);
  });

  it('never miscounts a sidecar as a month file', () => {
    const files = serialize(fullFixture());
    expect([...files.keys()].filter((p) => /^tasks\/\d{4}-\d{2}\.md$/.test(p)).sort()).toEqual([
      'tasks/2026-06.md',
      'tasks/2026-07.md',
    ]);
  });

  it('keeps a checklist-looking note line inert — not reparsed as a task', () => {
    const back = roundTrip(fullFixture());
    expect(back.tasks.some((t) => t.title === 'Confirm the water shut-off')).toBe(false);
    expect(back.tasks.find((t) => t.id === 'tsk_a')?.notes).toContain('- [ ] Confirm the water shut-off');
  });

  it('discards a hand-mangled 📝 token — the sidecar file is the truth', () => {
    const d = fullFixture();
    const files = serialize(d);
    const mangled = new Map(files);
    mangled.set(
      'tasks/2026-07.md',
      files.get('tasks/2026-07.md')!.replace('📝[[notes/tsk_a]]', '📝[[notes/GARBAGE]]'),
    );
    expect(deserialize(mangled)).toEqual(canonical(d));
  });
});

describe('links.yaml is readable', () => {
  it('stamps a human label next to the uuids', () => {
    const raw = serialize(fullFixture()).get('config/links.yaml')!;
    expect(raw).toContain('label: task:Book the plumber → project:Kitchen renovation');
    expect(raw).toContain("label: 'note:Plans: Q4/Q1? → asset:floorplan.png'");
  });

  it('derives the label — it is never read back', () => {
    // same rule as the filename: convenience on disk, regenerated on write, ignored on read.
    // If `label` were ever parsed, hand-editing it would corrupt the document.
    const d = fullFixture();
    const files = serialize(d);
    const mangled = new Map(files);
    mangled.set('config/links.yaml', files.get('config/links.yaml')!.replaceAll(/label: .*/g, 'label: TOTAL NONSENSE'));

    expect(deserialize(mangled)).toEqual(canonical(d));
    // and the next write puts the real label straight back
    expect(serialize(deserialize(mangled))).toEqual(files);
  });

  it('does not let the label leak into the document', () => {
    const back = deserialize(serialize(fullFixture()));
    expect(back.links.every((l) => !('label' in l))).toBe(true);
  });
});

describe('legibility', () => {
  it('writes a project as frontmatter plus a markdown body', () => {
    const files = serialize(fullFixture());
    const raw = [...files.entries()].find(([p]) => p.startsWith('projects/kitchen'))![1];
    expect(raw).toMatch(/^---\n/);
    expect(raw).toContain('status: active');
    expect(raw).toContain("color: '#C21E62'");
    expect(raw).toContain('Quotes in by Friday.');
    // an ISO stamp must be quoted so other YAML readers see a string, not a timestamp
    expect(raw).toContain("created: '2026-01-14T09:12:00.000Z'");
  });
});
