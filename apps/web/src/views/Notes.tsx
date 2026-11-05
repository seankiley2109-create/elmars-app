import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, ExternalLink, FileText, Folder, Image as ImageIcon, Pin, Plus, Trash2, X } from 'lucide-react';
import { useHQ } from '../store';
import { deleteWithUndo } from '../lib/undo';
import { usePersistentState } from '../lib/use-persistent-state';
import { openAsset, saveAssetCopy } from '../lib/open-file';
import { attachToNote, inlineAssetIds, snippetOf } from '../lib/note-files';
import { showNotice } from '../lib/notice';
import { addDays, dayOfIso, parseDateStr, todayStr } from '../lib/dates';
import type { MentionTarget } from '../lib/mentions';
import { EVERNOTE_FOLDER, evernoteImportedOn, notebooks, projectColor } from '../selectors';
import { useOpenTask } from '../components/TaskDetailHost';
import MarkdownEditor, { type MentionOption } from '../components/MarkdownEditor';
import { Button } from '../components/ui';
import type { ID, Note, Project } from '../types';

/*
 * Notes: three panes, as in docs/mockup/Notes.dc.html.
 *   1. Notebooks — All notes, his folders, By project, and From Evernote with the day it came in.
 *   2. The list  — title, snippet, project dot and date; "New note" is the screen's one primary action.
 *   3. The editor — toolbar, title, project/notebook/tag chips, the body, and "Mentioned in".
 * `/notes/:id` selects a note; `/notes` shows the first one in the list.
 */

type Filter = { kind: 'all' } | { kind: 'folder'; path: string } | { kind: 'project'; id: ID };

const NEUTRAL_DOT = 'var(--mt-ink-3)';

/* ------------------------------------------------------------- helpers */

const DAY_MONTH = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const WEEKDAY_DAY_MONTH = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** "Just now", "5 minutes ago", "2 hours ago", "Yesterday", "30 Oct". */
function when(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return min === 1 ? '1 minute ago' : `${min} minutes ago`;
  const day = dayOfIso(iso);
  const today = todayStr();
  if (day === today) {
    const h = Math.floor(min / 60);
    return h === 1 ? '1 hour ago' : `${h} hours ago`;
  }
  if (day === addDays(today, -1)) return 'Yesterday';
  const d = parseDateStr(day);
  return (d.getFullYear() === new Date().getFullYear() ? DAY_MONTH : DAY_MONTH_YEAR).format(d);
}

/** `when` inside a sentence: "Saved just now", "Saved yesterday", "Saved 30 Oct". */
function savedWhen(iso: string): string {
  const w = when(iso);
  return w === 'Just now' || w === 'Yesterday' ? w.toLowerCase() : w;
}

/** "today", "tomorrow", "Fri 6 Nov". */
function dayLabel(day: string): string {
  const today = todayStr();
  if (day === today) return 'today';
  if (day === addDays(today, 1)) return 'tomorrow';
  return WEEKDAY_DAY_MONTH.format(parseDateStr(day));
}

const isEvernote = (folder?: string) =>
  !!folder && (folder === EVERNOTE_FOLDER || folder.startsWith(`${EVERNOTE_FOLDER}/`));

const leaf = (path: string) => path.split('/').at(-1) ?? path;

/* ------------------------------------------------------------- pieces */

function Dot({ color }: { color?: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color ?? NEUTRAL_DOT }} aria-hidden />;
}

function Count({ n }: { n: number }) {
  return <span className="ml-auto font-mono text-xs font-medium tabular-nums text-ink-3">{n}</span>;
}

function BookButton({
  on,
  onClick,
  depth = 0,
  children,
}: {
  on: boolean;
  onClick: () => void;
  depth?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={on ? 'true' : undefined}
      style={{ paddingLeft: 12 + depth * 16 }}
      className={`flex h-10 w-full shrink-0 items-center gap-2.5 rounded-md pr-3 text-left text-[13px] text-ink transition-colors ${
        on ? 'bg-panel font-semibold shadow-[inset_2px_0_0_var(--mt-ink)]' : 'font-medium hover:bg-raised'
      }`}
    >
      {children}
    </button>
  );
}

const SideLabel = ({ children, first }: { children: ReactNode; first?: boolean }) => (
  <span className={`px-3 pb-2 text-xs text-ink-3 ${first ? '' : 'pt-[18px]'}`}>{children}</span>
);

/** A chip that edits a short text on Enter or blur (notebook, new tag). */
function ChipInput({
  value,
  placeholder,
  label,
  list,
  icon,
  onCommit,
  clearOnCommit,
}: {
  value: string;
  placeholder: string;
  label: string;
  list?: string;
  icon?: ReactNode;
  onCommit: (v: string) => void;
  clearOnCommit?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft.trim());
    if (clearOnCommit) setDraft('');
  };
  return (
    <label className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 text-xs text-ink-2 focus-within:border-line-strong hover:border-line-strong">
      {icon}
      <input
        aria-label={label}
        placeholder={placeholder}
        list={list}
        value={draft}
        size={Math.max(placeholder.length, draft.length, 4)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') setDraft(value);
        }}
        className="min-w-0 bg-transparent text-xs text-ink outline-none placeholder:text-ink-3"
      />
    </label>
  );
}

/** A 44px hit area centred on a smaller control (the control needs `relative`). */
const HIT_44 =
  "before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']";

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The note's files that its body doesn't show in place: an image deleted from the text, an Evernote
 * attachment, the "Original from Evernote" page. Nothing attached to a note is ever out of reach.
 */
function NoteFiles({ noteId, body }: { noteId: ID; body: string }) {
  const assets = useHQ((s) => s.assets);
  const links = useHQ((s) => s.links);
  const deleteAsset = useHQ((s) => s.deleteAsset);

  const files = useMemo(() => {
    const inline = inlineAssetIds(body);
    const linked = new Set(
      links
        .filter((l) => (l.from.type === 'asset' && l.to.id === noteId) || (l.to.type === 'asset' && l.from.id === noteId))
        .map((l) => (l.from.type === 'asset' ? l.from.id : l.to.id)),
    );
    return assets.filter((a) => linked.has(a.id) && !inline.has(a.id));
  }, [assets, links, noteId, body]);

  if (!files.length) return null;
  return (
    <section aria-label="Attachments" className="mt-4 border-t border-line pt-4">
      <h3 className="mb-2 text-xs text-ink-3">Attachments</h3>
      <ul className="flex flex-col gap-1">
        {files.map((a) => (
          <li key={a.id} className="flex items-center gap-3 rounded-md px-1 hover:bg-[#FAF9F6]">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-raised text-ink-2" aria-hidden>
              {a.mime.startsWith('image/') ? <ImageIcon size={15} /> : <FileText size={15} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">{a.name}</span>
              <span className="block text-xs text-ink-3">{prettySize(a.size)}</span>
            </span>
            <button
              type="button"
              aria-label={`Open ${a.name}`}
              title={`Open ${a.name}`}
              onClick={() => void openAsset(a)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink-2 hover:bg-raised hover:text-ink"
            >
              <ExternalLink size={16} aria-hidden />
            </button>
            <button
              type="button"
              aria-label={`Save a copy of ${a.name}…`}
              title="Save a copy…"
              onClick={() => void saveAssetCopy(a)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink-2 hover:bg-raised hover:text-ink"
            >
              <Download size={16} aria-hidden />
            </button>
            <button
              type="button"
              aria-label={`Remove ${a.name}`}
              title={`Remove ${a.name}`}
              onClick={() => deleteWithUndo(() => deleteAsset(a.id))}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink-3 hover:bg-raised hover:text-ink"
            >
              <Trash2 size={16} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* --------------------------------------------------------------- editor */

interface Mention {
  key: string;
  label: string;
  open: () => void;
}

function NoteEditor({ note }: { note: Note }) {
  const projects = useHQ((s) => s.projects);
  const notes = useHQ((s) => s.notes);
  const tasks = useHQ((s) => s.tasks);
  const events = useHQ((s) => s.events);
  const links = useHQ((s) => s.links);
  const updateNote = useHQ((s) => s.updateNote);
  const deleteNote = useHQ((s) => s.deleteNote);
  const assets = useHQ((s) => s.assets);
  const navigate = useNavigate();
  const openTask = useOpenTask();

  const project = projects.find((p) => p.id === note.projectId);
  const liveProjects = useMemo(
    () => projects.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  );
  const folders = useMemo(() => notebooks({ notes }).map((f) => f.path), [notes]);

  const onPickMention = useCallback(
    (query: string): MentionOption[] => {
      const q = query.trim().toLowerCase();
      const rank = (name: string) => {
        const n = name.toLowerCase();
        if (!q) return 1;
        if (n.startsWith(q)) return 0;
        return n.includes(q) ? 1 : -1;
      };
      const all: (MentionOption & { rank: number })[] = [
        ...liveProjects.map((p) => ({ type: 'project' as const, id: p.id, label: p.name, rank: rank(p.name) })),
        ...notes
          .filter((n) => n.id !== note.id)
          .map((n) => ({ type: 'note' as const, id: n.id, label: n.title, rank: rank(n.title) })),
      ];
      return all
        .filter((o) => o.rank >= 0)
        .sort((a, b) => a.rank - b.rank || (a.type === b.type ? 0 : a.type === 'project' ? -1 : 1) || a.label.localeCompare(b.label))
        .map(({ rank: _rank, ...o }) => o);
    },
    [liveProjects, notes, note.id],
  );

  // the bytes are written before the asset exists: a failed write adds nothing, and the editor says so
  const onFile = useCallback((f: File) => attachToNote(f, note.id), [note.id]);

  /**
   * He left the "changed outside the app" banner unanswered (switched note, left Notes, quit): the
   * version not in the note is kept as a note of its own beside it, and he is told where.
   */
  const keepConflictedCopy = useCallback(
    (setAside: string) => {
      const s = useHQ.getState();
      const cur = s.notes.find((n) => n.id === note.id) ?? note; // read now: it may have been renamed or moved
      const title = `${cur.title || 'Untitled'} (conflicted copy)`;
      const id = s.addNote({ title, body: setAside, folder: cur.folder, projectId: cur.projectId, tags: cur.tags });
      s.syncMentions(id, setAside); // its mentions link like any note's
      showNotice({ text: `Kept your other version as "${title}".`, action: { label: 'Open', to: `/notes/${id}` } });
    },
    [note],
  );

  const onOpenAsset = useCallback(
    (assetId: ID) => {
      const asset = assets.find((a) => a.id === assetId);
      if (asset) void openAsset(asset);
    },
    [assets],
  );

  const onOpenMention = useCallback(
    (t: MentionTarget) => navigate(t.type === 'project' ? `/projects/${t.id}` : `/notes/${t.id}`),
    [navigate],
  );

  /** Incoming links, then the open tasks and coming events of the note's project. */
  const mentionedIn = useMemo((): Mention[] => {
    const out: Mention[] = [];
    const seen = new Set<string>();
    const push = (key: string, label: string, open: () => void) => {
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ key, label, open });
    };
    for (const l of links) {
      const other = l.to.id === note.id ? l.from : l.from.id === note.id && l.to.type === 'task' ? l.to : undefined;
      if (!other) continue;
      if (other.type === 'note') {
        const n = notes.find((x) => x.id === other.id);
        if (n) push(`note/${n.id}`, n.title, () => navigate(`/notes/${n.id}`));
      } else if (other.type === 'project') {
        const p = projects.find((x) => x.id === other.id);
        if (p) push(`project/${p.id}`, p.name, () => navigate(`/projects/${p.id}`));
      } else if (other.type === 'task') {
        const t = tasks.find((x) => x.id === other.id);
        if (t) push(`task/${t.id}`, t.title, () => openTask(t.id));
      }
    }
    if (note.projectId) {
      const today = todayStr();
      for (const t of tasks.filter((x) => x.projectId === note.projectId && x.status !== 'done')) {
        push(`task/${t.id}`, t.title, () => openTask(t.id));
      }
      const coming = events
        .filter((e) => e.projectId === note.projectId && e.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? ''));
      for (const e of coming) {
        push(`event/${e.id}`, `${e.title}, ${dayLabel(e.date)}${e.start ? ` ${e.start}` : ''}`, () => navigate('/calendar'));
      }
    }
    return out;
  }, [links, notes, projects, tasks, events, note.id, note.projectId, navigate, openTask]);

  const SHOWN = 6;

  const header = (
    <>
      <input
        aria-label="Note title"
        placeholder="Untitled"
        value={note.title}
        onChange={(e) => updateNote(note.id, { title: e.target.value.replace(/\s*[\r\n]+\s*/g, ' ') })}
        onFocus={(e) => {
          if (note.title === 'Untitled') e.target.select();
        }}
        className="w-full bg-transparent font-display text-[32px] font-extrabold leading-9 tracking-[-0.02em] text-ink outline-none placeholder:text-ink-3"
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-paper pl-2.5 pr-2.5 text-xs text-ink-2 focus-within:border-line-strong hover:border-line-strong">
          <Dot color={project ? projectColor({ projects }, project) : undefined} />
          <select
            aria-label="Project"
            value={note.projectId ?? ''}
            onChange={(e) => updateNote(note.id, { projectId: e.target.value || undefined })}
            className="cursor-pointer appearance-none bg-transparent pr-0.5 text-xs text-ink-2 outline-none"
          >
            <option value="">No project</option>
            {project && project.archived && <option value={project.id}>{project.name}</option>}
            {liveProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <ChipInput
          value={note.folder ?? ''}
          placeholder="Notebook"
          label="Notebook"
          list="note-notebooks"
          icon={<Folder size={12} aria-hidden />}
          onCommit={(v) => updateNote(note.id, { folder: v.replace(/^\/+|\/+$/g, '') || undefined })}
        />
        <datalist id="note-notebooks">
          {folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        {note.tags.map((t) => (
          <span key={t} className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-paper pl-2.5 pr-1 text-xs text-ink-2">
            #{t}
            {/* a 16px mark with a 44px hit area; always visible, so a keyboard user can find it */}
            <button
              type="button"
              aria-label={`Remove tag ${t}`}
              title={`Remove tag ${t}`}
              onClick={() => updateNote(note.id, { tags: note.tags.filter((x) => x !== t) })}
              className={`relative inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-3 hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-[var(--mt-action)] ${HIT_44}`}
            >
              <X size={11} aria-hidden />
            </button>
          </span>
        ))}
        <ChipInput
          value=""
          placeholder="Add tag"
          label="Add tag"
          clearOnCommit
          onCommit={(v) => {
            const tag = v.replace(/^#+/, '').trim();
            if (tag && !note.tags.includes(tag)) updateNote(note.id, { tags: [...note.tags, tag] });
          }}
        />
      </div>
    </>
  );

  const status = (
    <span className="flex items-center gap-1">
      <span className="mr-2">Saved {savedWhen(note.updatedAt)}</span>
      <button
        type="button"
        aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
        aria-pressed={note.pinned}
        title={note.pinned ? 'Unpin note' : 'Pin note'}
        onClick={() => updateNote(note.id, { pinned: !note.pinned })}
        className={`inline-flex h-11 w-11 items-center justify-center rounded-md transition-colors hover:bg-raised ${note.pinned ? 'text-ink' : 'text-ink-3 hover:text-ink'}`}
      >
        <Pin size={15} fill={note.pinned ? 'currentColor' : 'none'} />
      </button>
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
        onClick={() => {
          deleteWithUndo(() => deleteNote(note.id));
          navigate('/notes');
        }}
        className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-raised hover:text-ink"
      >
        <Trash2 size={15} />
      </button>
    </span>
  );

  const files = <NoteFiles noteId={note.id} body={note.body} />;

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-panel" aria-label="Note">
      <button
        type="button"
        onClick={() => navigate('/notes')}
        className="flex h-11 items-center gap-2 border-b border-line px-4 text-sm text-ink-2 md:hidden"
      >
        <ArrowLeft size={16} /> All notes
      </button>
      <MarkdownEditor
        key={note.id}
        value={note.body}
        onChange={(md) => updateNote(note.id, { body: md })}
        onPickMention={onPickMention}
        onFile={onFile}
        onOpenMention={onOpenMention}
        onOpenAsset={onOpenAsset}
        onUnresolvedConflict={keepConflictedCopy}
        header={header}
        footer={files}
        status={status}
      />
      {mentionedIn.length > 0 && (
        <div className="flex flex-none flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-line px-6 py-3.5 text-[13px] text-ink-2 lg:px-14">
          <svg className="h-4 w-4 flex-none fill-none stroke-current" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
            <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
            <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
          </svg>
          Mentioned in
          {mentionedIn.slice(0, SHOWN).map((m, i) => (
            <span key={m.key} className="inline-flex items-center gap-2.5">
              {i > 0 && <span aria-hidden>·</span>}
              <button
                type="button"
                onClick={m.open}
                className="text-left text-[var(--mt-accent-text)] hover:text-[var(--mt-action-hover)] hover:underline"
              >
                {m.label}
              </button>
            </span>
          ))}
          {mentionedIn.length > SHOWN && <span>· and {mentionedIn.length - SHOWN} more</span>}
        </div>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- page */

export default function Notes() {
  const notes = useHQ((s) => s.notes);
  const projects = useHQ((s) => s.projects);
  const activity = useHQ((s) => s.activity);
  const addNote = useHQ((s) => s.addNote);
  const { id: openId } = useParams();
  const navigate = useNavigate();
  const [filter, setFilter] = usePersistentState<Filter>('notes.notebook', { kind: 'all' });

  const books = useMemo(() => notebooks({ notes }), [notes]);
  const ownBooks = books.filter((b) => !isEvernote(b.path));
  const evernoteBooks = books.filter((b) => isEvernote(b.path));
  const importedOn = useMemo(() => evernoteImportedOn({ notes, activity }), [notes, activity]);

  const byProject = useMemo(() => {
    const counts = new Map<ID, number>();
    for (const n of notes) if (n.projectId) counts.set(n.projectId, (counts.get(n.projectId) ?? 0) + 1);
    return projects
      .filter((p) => counts.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ project: p, count: counts.get(p.id)! }));
  }, [notes, projects]);

  // a remembered notebook that no longer exists falls back to all notes
  const active: Filter =
    (filter.kind === 'folder' && !books.some((b) => b.path === filter.path)) ||
    (filter.kind === 'project' && !byProject.some((b) => b.project.id === filter.id))
      ? { kind: 'all' }
      : filter;

  const shown = useMemo(() => {
    const inView = notes.filter((n) =>
      active.kind === 'all'
        ? true
        : active.kind === 'project'
          ? n.projectId === active.id
          : n.folder === active.path || !!n.folder?.startsWith(`${active.path}/`),
    );
    return inView.sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.updatedAt.localeCompare(a.updatedAt)));
  }, [notes, active]);

  const projectOf = (n: Note): Project | undefined => projects.find((p) => p.id === n.projectId);
  const heading =
    active.kind === 'all'
      ? 'All notes'
      : active.kind === 'project'
        ? (projects.find((p) => p.id === active.id)?.name ?? 'Notes')
        : active.path === EVERNOTE_FOLDER
          ? EVERNOTE_FOLDER
          : leaf(active.path);

  const selected = openId ? notes.find((n) => n.id === openId) : shown[0];

  const newNote = () => {
    const id = addNote({
      title: 'Untitled',
      folder: active.kind === 'folder' ? active.path : undefined,
      projectId: active.kind === 'project' ? active.id : undefined,
    });
    navigate(`/notes/${id}`);
  };

  const isOn = (f: Filter) =>
    f.kind === active.kind &&
    (f.kind === 'all' ||
      (f.kind === 'folder' && active.kind === 'folder' && f.path === active.path) ||
      (f.kind === 'project' && active.kind === 'project' && f.id === active.id));

  const filterValue = (f: Filter) => (f.kind === 'all' ? 'all' : f.kind === 'folder' ? `folder:${f.path}` : `project:${f.id}`);

  return (
    <div className="flex h-full min-h-0">
      {/* 1. Notebooks */}
      <nav aria-label="Notebooks" className="hidden w-[236px] flex-none flex-col gap-0.5 overflow-y-auto border-r border-line bg-paper px-3 py-6 xl:flex">
        <SideLabel first>Notebooks</SideLabel>
        <BookButton on={isOn({ kind: 'all' })} onClick={() => setFilter({ kind: 'all' })}>
          All notes
          <Count n={notes.length} />
        </BookButton>
        {ownBooks.map((b) => (
          <BookButton
            key={b.path}
            depth={b.path.split('/').length - 1}
            on={isOn({ kind: 'folder', path: b.path })}
            onClick={() => setFilter({ kind: 'folder', path: b.path })}
          >
            <span className="min-w-0 truncate">{leaf(b.path)}</span>
            <Count n={b.count} />
          </BookButton>
        ))}

        {byProject.length > 0 && <SideLabel>By project</SideLabel>}
        {byProject.map(({ project: p, count }) => (
          <BookButton key={p.id} on={isOn({ kind: 'project', id: p.id })} onClick={() => setFilter({ kind: 'project', id: p.id })}>
            <Dot color={projectColor({ projects }, p)} />
            <span className="min-w-0 truncate">{p.name}</span>
            <Count n={count} />
          </BookButton>
        ))}

        {evernoteBooks.length > 0 && (
          <>
            <SideLabel>Brought over</SideLabel>
            {evernoteBooks.map((b) => (
              <BookButton
                key={b.path}
                depth={b.path.split('/').length - 1}
                on={isOn({ kind: 'folder', path: b.path })}
                onClick={() => setFilter({ kind: 'folder', path: b.path })}
              >
                {b.path === EVERNOTE_FOLDER && (
                  <svg className="h-4 w-4 flex-none fill-none stroke-current" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
                    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
                  </svg>
                )}
                <span className="min-w-0 truncate">{leaf(b.path)}</span>
                <Count n={b.count} />
              </BookButton>
            ))}
            <span className="px-3 py-1 text-xs leading-4 text-ink-3">
              {importedOn ? `Imported ${DAY_MONTH.format(parseDateStr(importedOn))}` : 'Imported'} with their notebooks, tags and
              attachments.
            </span>
          </>
        )}
      </nav>

      {/* 2. The list */}
      <section
        aria-labelledby="notes-h"
        className={`w-full flex-none flex-col border-r border-line bg-panel md:flex md:w-[300px] lg:w-[340px] ${openId ? 'max-md:hidden' : 'flex'}`}
      >
        <div className="flex items-center gap-2 px-5 pb-3.5 pt-6">
          <h1 id="notes-h" className="min-w-0 flex-1 truncate font-display text-[28px] font-extrabold leading-8 tracking-[-0.02em]">
            {heading}
          </h1>
          <Button variant="primary" onClick={newNote}>
            <Plus size={16} aria-hidden /> New note
          </Button>
        </div>
        {/* below the width that fits the notebooks pane, the notebooks are a picker */}
        <div className="px-5 pb-3 xl:hidden">
          <select
            aria-label="Notebook"
            value={filterValue(active)}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'all') setFilter({ kind: 'all' });
              else if (v.startsWith('folder:')) setFilter({ kind: 'folder', path: v.slice('folder:'.length) });
              else setFilter({ kind: 'project', id: v.slice('project:'.length) });
            }}
            className="h-9 w-full rounded-md border border-line-strong bg-paper px-2 text-[13px] text-ink"
          >
            <option value="all">All notes</option>
            {books.map((b) => (
              <option key={b.path} value={`folder:${b.path}`}>
                {'  '.repeat(b.path.split('/').length - 1)}
                {leaf(b.path)}
              </option>
            ))}
            {byProject.map(({ project: p }) => (
              <option key={p.id} value={`project:${p.id}`}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {shown.length === 0 ? (
            <p className="border-t border-line px-5 py-6 text-[13px] text-ink-2">
              No notes here yet. Recipes, plans, things to remember: write them once, find them again.
            </p>
          ) : (
            shown.map((n) => {
              const p = projectOf(n);
              const on = selected?.id === n.id;
              const where = p ? p.name : n.folder ? (isEvernote(n.folder) ? EVERNOTE_FOLDER : leaf(n.folder)) : undefined;
              const snip = snippetOf(n.body);
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => navigate(`/notes/${n.id}`)}
                  aria-current={on ? 'true' : undefined}
                  className={`flex w-full flex-col gap-1 border-t border-line px-5 py-3.5 text-left text-ink ${
                    on ? 'bg-raised shadow-[inset_2px_0_0_var(--mt-ink)]' : 'hover:bg-[#FAF9F6]'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-[15px] font-semibold leading-[22px]">
                    <span className="min-w-0 truncate">{n.title || 'Untitled'}</span>
                    {n.pinned && <Pin size={12} className="shrink-0 text-ink-3" aria-label="Pinned" />}
                  </span>
                  {snip && <span className="line-clamp-2 text-[13px] leading-[18px] text-ink-2">{snip}</span>}
                  <span className="flex items-center gap-1.5 text-xs text-ink-3">
                    {where && (
                      <>
                        <Dot color={p ? projectColor({ projects }, p) : undefined} />
                        <span className="min-w-0 truncate">{where}</span>
                        <span aria-hidden>·</span>
                      </>
                    )}
                    <span className="shrink-0">{when(n.updatedAt)}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* 3. The editor */}
      {selected ? (
        <div className={`min-w-0 flex-1 ${openId ? 'flex' : 'max-md:hidden md:flex'}`}>
          <NoteEditor key={selected.id} note={selected} />
        </div>
      ) : (
        <section aria-label="Note" className="hidden min-w-0 flex-1 items-center justify-center bg-panel p-10 text-center md:flex">
          <div>
            <p className="font-display text-lg font-bold">{openId ? 'This note is gone' : 'Nothing written yet'}</p>
            <p className="mt-1 text-[13px] text-ink-2">
              {openId ? 'It may have been deleted. Pick another from the list.' : 'Start with "New note". Everything saves as you type.'}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
