import { dayToIso } from '@hq/core';
import type { VaultDoc } from './codecs';

/**
 * A document that exercises every collection and every field — including the awkward ones.
 *
 * The mapped type in codecs.ts guarantees no collection is *forgotten*; this guarantees no field
 * *within* one is. Every optional appears present in one record and absent in another.
 *
 * Task `createdAt`/`completedAt` are at local midnight because that is the normalised form at rest
 * (see `normalizeToDay`); the vault stores them to day precision.
 *
 * Everything here is invented, in the spirit of the app's own world: a kitchen, a holiday, a cycle
 * tour. Nothing comes from anyone's real data.
 */
export function fullFixture(): VaultDoc {
  return {
    settings: { userName: 'Elmar', onboarded: true, lastExportAt: '2026-07-01T10:00:00.000Z' },

    projects: [
      {
        // every optional present; a Windows path in a link
        id: 'prj_a',
        name: 'Kitchen renovation',
        color: '#C21E62',
        status: 'active',
        nextStep: 'Choose the worktop',
        notes: 'Quotes in by Friday.\n\n## Detail\nCabinets ordered.',
        tags: ['home', 'renovation'],
        links: [{ label: 'Quotes folder', url: String.raw`C:\Users\Elmar\Documents\2026\Kitchen\quotes` }],
        impact: 3,
        urgency: 2,
        startDate: '2026-07-01',
        targetDate: '2026-08-15',
        archived: false,
        createdAt: '2026-01-14T09:12:00.000Z',
        updatedAt: '2026-07-16T17:40:00.000Z',
      },
      {
        // every optional absent, and a name that collides with prj_c and prj_child
        id: 'prj_b',
        name: 'Planning',
        status: 'later',
        tags: [],
        links: [],
        archived: true,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
      },
      {
        // same name as prj_b -> same slug -> the allocator must not let one overwrite the other.
        // notes: '' is the empty-vs-absent case; it must not come back as undefined.
        id: 'prj_c',
        name: 'Planning',
        status: 'shipped',
        notes: '',
        tags: ['admin'],
        links: [],
        archived: false,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z',
      },
      {
        // a child of prj_a — nests under the parent's folder. Same name as prj_b/prj_c on purpose:
        // the nested path must never cross-collide with the flat ones.
        id: 'prj_child',
        parentId: 'prj_a',
        name: 'Planning',
        status: 'active',
        nextStep: 'Book the plumber',
        tags: [],
        links: [],
        archived: false,
        createdAt: '2026-03-05T00:00:00.000Z',
        updatedAt: '2026-03-06T00:00:00.000Z',
      },
      {
        // dangling parent — must round-trip literally (parent: kept) at a flat, top-level path
        id: 'prj_orphan',
        parentId: 'prj_missing',
        name: 'Garden irrigation',
        status: 'later',
        tags: [],
        links: [],
        archived: false,
        createdAt: '2026-03-07T00:00:00.000Z',
        updatedAt: '2026-03-07T00:00:00.000Z',
      },
      {
        // accents and a blocked status
        id: 'prj_d',
        name: 'December in Knysna',
        color: '#2F7D6B',
        status: 'blocked',
        nextStep: 'Wait for the cottage to confirm',
        tags: ['holiday', 'café'],
        links: [],
        targetDate: '2026-12-15',
        archived: false,
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-02T00:00:00.000Z',
      },
      { id: 'prj_e', name: 'Cycle Tour 2027', status: 'later', tags: [], links: [], impact: 1, urgency: 1, archived: false, createdAt: '2026-05-03T00:00:00.000Z', updatedAt: '2026-05-03T00:00:00.000Z' },
      { id: 'prj_f', name: 'Board pack Q4', status: 'active', tags: [], links: [], startDate: '2026-10-01', archived: false, createdAt: '2026-05-04T00:00:00.000Z', updatedAt: '2026-05-04T00:00:00.000Z' },
    ],

    tasks: [
      {
        id: 'tsk_a',
        title: 'Book the plumber',
        projectId: 'prj_a',
        priority: 'high',
        // full window + a separate deadline: 🛫 start, ⏳ scheduled, 📅 due all present at once
        startDate: '2026-07-14',
        scheduledDate: '2026-07-17',
        dueDate: '2026-07-18',
        focus: true,
        status: 'in_progress',
        // Multi-line notes with a line that itself looks like a checklist item — it must round-trip
        // as inert body text in tasks/notes/tsk_a.md, never be reparsed as a task line.
        notes: 'Quote ref KR-1182.\n\n- [ ] Confirm the water shut-off\n- [ ] Ask about the dishwasher\n\n`ask for the foreman`',
        createdAt: dayToIso('2026-07-02'),
      },
      // adversarial titles: each ends in or contains a token lookalike. The mandatory `➕ <date>`
      // sits between the title and every optional token, which is what keeps these parseable.
      { id: 'tsk_b', title: 'Title ending in a caret ^abc', priority: 'medium', focus: false, status: 'backlog', createdAt: dayToIso('2026-07-03') },
      // notes: '' — the empty-vs-absent case; it must come back as '' from the sidecar, not undefined.
      { id: 'tsk_c', title: 'See →prj_x for detail', priority: 'low', focus: false, status: 'ready', notes: '', createdAt: dayToIso('2026-07-04') },
      { id: 'tsk_d', title: 'Mid ⏫ string 📅 with ⭐ tokens', priority: 'medium', focus: false, status: 'waiting', createdAt: dayToIso('2026-07-05') },
      { id: 'tsk_e', title: 'Ends with a date ➕ 2026-01-01', priority: 'medium', focus: false, status: 'backlog', createdAt: dayToIso('2026-07-06') },
      {
        id: 'tsk_f',
        title: 'Order the oven',
        projectId: 'prj_a',
        priority: 'medium',
        focus: false,
        status: 'done',
        createdAt: dayToIso('2026-07-07'),
        completedAt: dayToIso('2026-07-15'),
      },
      // a second month -> a second tasks/<month>.md file
      { id: 'tsk_g', title: 'Older task', priority: 'medium', focus: false, status: 'done', createdAt: dayToIso('2026-06-11'), completedAt: dayToIso('2026-06-12') },
      // a pure work window: 🛫 + ⏳, no 📅 deadline — renders as a bar with no deadline flag
      { id: 'tsk_h', title: 'Tile delivery and fitting', projectId: 'prj_a', priority: 'medium', focus: false, status: 'backlog', createdAt: dayToIso('2026-07-08'), startDate: '2026-07-20', scheduledDate: '2026-07-22' },
      // ⏳ scheduled alone (no 🛫 start) — a single-anchor case, must not become a bar
      { id: 'tsk_i', title: 'Draft the packing list', projectId: 'prj_d', priority: 'low', focus: false, status: 'ready', createdAt: dayToIso('2026-07-09'), scheduledDate: '2026-07-25' },
      // adversarial: a title ending in a 🛫 lookalike, carrying a REAL window — proves the strip
      // peels the real 🛫/⏳ tokens without eating the lookalike in the title.
      { id: 'tsk_j', title: 'Ends with a start token 🛫 2026-01-01', priority: 'medium', focus: false, status: 'backlog', createdAt: dayToIso('2026-07-10'), startDate: '2026-07-26', scheduledDate: '2026-07-28' },
    ],

    notes: [
      // awkward titles: a colon, a slash and a question mark (all filename-hostile), two notes both
      // called "Untitled", and an emoji. Each must get its own file and survive the round trip.
      { id: 'nte_plans', title: 'Plans: Q4/Q1?', body: 'Board pack first, then the cycle tour.', tags: ['work'], projectId: 'prj_f', pinned: false, createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-02T00:00:00.000Z' },
      { id: 'nte_untitled_1', title: 'Untitled', body: 'Scribbled while on the phone.', tags: [], pinned: false, createdAt: '2026-04-03T00:00:00.000Z', updatedAt: '2026-04-03T00:00:00.000Z' },
      // empty body: it must come back as '' (a note body is never undefined)
      { id: 'nte_untitled_2', title: 'Untitled', body: '', tags: [], pinned: false, createdAt: '2026-04-04T00:00:00.000Z', updatedAt: '2026-04-04T00:00:00.000Z' },
      { id: 'nte_braai', title: 'Braai 🔥 marinade', body: 'Garlic, lemon, apricot jam.\n\n## Method\nLeave overnight.', tags: ['recipe', 'braai'], folder: 'Home/Recipes', projectId: 'prj_d', pinned: true, createdAt: '2026-04-05T00:00:00.000Z', updatedAt: '2026-04-06T00:00:00.000Z' },
      // a folder whose name has characters the path slug drops; the literal must survive in frontmatter
      { id: 'nte_trips', title: 'Trip ideas', body: 'x', tags: [], folder: 'Travel & Trips/Ideas', pinned: false, createdAt: '2026-04-07T00:00:00.000Z', updatedAt: '2026-04-07T00:00:00.000Z' },
    ],

    links: [
      { id: 'lnk_a', from: { type: 'project', id: 'prj_d' }, to: { type: 'note', id: 'nte_braai' }, kind: 'related' },
      { id: 'lnk_b', from: { type: 'project', id: 'prj_b' }, to: { type: 'project', id: 'prj_a' }, kind: 'blocks' },
      { id: 'lnk_c', from: { type: 'task', id: 'tsk_a' }, to: { type: 'project', id: 'prj_a' }, kind: 'related' },
      { id: 'lnk_d', from: { type: 'note', id: 'nte_plans' }, to: { type: 'asset', id: 'ast_a' }, kind: 'related' },
    ],

    assets: [
      { id: 'ast_a', name: 'floorplan.png', mime: 'image/png', size: 20481, createdAt: '2026-06-01T00:00:00.000Z' },
      { id: 'ast_b', name: 'shopping-list.txt', mime: 'text/plain', size: 12, createdAt: '2026-06-02T00:00:00.000Z' },
    ],

    activity: [
      { id: 'act_a', type: 'task_created', refId: 'tsk_a', label: 'Book the plumber', at: '2026-06-20T09:00:00.000Z' },
      { id: 'act_b', type: 'project_shipped', refId: 'prj_c', label: 'Planning', at: '2026-07-01T09:00:00.000Z' },
      { id: 'act_c', type: 'task_completed', refId: 'tsk_f', label: 'Order the oven', at: '2026-07-15T08:22:11.000Z' },
      { id: 'act_d', type: 'project_status', refId: 'prj_d', label: 'December in Knysna is on hold', at: '2026-07-16T08:30:00.000Z' },
      { id: 'act_e', type: 'note_created', refId: 'nte_braai', label: 'Braai 🔥 marinade', at: '2026-07-16T09:00:00.000Z' },
      { id: 'act_f', type: 'asset_added', refId: 'ast_a', label: 'floorplan.png', at: '2026-07-16T09:05:00.000Z' },
      { id: 'act_g', type: 'project_deleted', refId: 'prj_gone', label: 'Deleted Old plan', at: '2026-07-16T09:10:00.000Z' },
    ],

    events: [
      {
        // every optional present; notes carry a line that looks like a checklist item
        id: 'evt_a',
        title: 'Plumber site visit',
        date: '2026-07-17',
        start: '08:30',
        end: '09:15',
        projectId: 'prj_a',
        location: 'Kitchen at home',
        notes: 'Bring the quote (ref KR-1182).\n\n- [ ] Ask about the water shut-off',
        createdAt: '2026-07-02',
      },
      // all day, every optional absent; a title ending in a token lookalike, in a second month file
      { id: 'evt_b', title: 'Cottage handover ^abc', date: '2026-08-02', createdAt: '2026-07-03' },
    ],
  };
}
