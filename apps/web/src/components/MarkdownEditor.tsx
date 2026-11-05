import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, NodeSelection } from '@tiptap/pm/state';
import { Markdown } from 'tiptap-markdown';
import { FileText, X } from 'lucide-react';
import { parseMentionHref, type MentionKind, type MentionTarget } from '../lib/mentions';
import { registerEditorFlush } from '../lib/editor-flush';
import { isOpenLinkClick, isOpenableUrl, openExternalUrl, type UrlOpener } from '../lib/open-link';
import { MAX_ATTACHMENT_BYTES, tooBigMessage } from '../lib/attachment-limit';
import {
  AssetImage,
  MarkdownItalic,
  MarkdownTable,
  MarkdownText,
  MentionLink,
  RawHtmlBlock,
  RawHtmlInline,
  TightTaskList,
} from './markdown-extensions';
import type { ID } from '../types';

/*
 * The note body editor. Markdown is the stored form, and the one contract that matters is that
 * nothing is lost: every supported construct loads and saves back unchanged, HTML it has no node for
 * is kept verbatim, every edit reaches `onChange` (debounced, but flushed on blur, unmount, tab close
 * and quit), and a change made elsewhere is never overwritten without asking.
 *
 * Two note conventions ride on ordinary markdown links:
 *   - an attachment is `![name](asset:<id>)` (shown in place) or `[name](asset:<id>)` (a file);
 *   - a mention is `[name](elmar://project/<id>)` or `[name](elmar://note/<id>)`, an atomic chip here.
 */

export interface MentionOption {
  type: MentionKind;
  id: ID;
  label: string;
}

export interface MarkdownEditorProps {
  value: string;
  onChange: (md: string) => void;
  onPickMention: (q: string) => MentionOption[];
  /** Stores the file. Rejecting means nothing was stored; the editor says so and goes on. */
  onFile: (f: File) => Promise<{ assetId: ID; name: string }>;
  /** A mention in the body was followed (click, or Enter on a selected mention). */
  onOpenMention?: (target: MentionTarget) => void;
  /** A file link (`[name](asset:<id>)`) in the body was clicked. */
  onOpenAsset?: (assetId: ID) => void;
  /** Opens a web or mail link that was ⌘-clicked. The default is the Mac's browser or mail app; tests pass a fake. */
  openUrl?: UrlOpener;
  /**
   * The note changed elsewhere while he was typing, and the banner was left without a choice when
   * the editor went away (another note, another screen, quit). This is the version that is NOT in
   * the note — his set-aside text — and it must be kept somewhere (Notes saves a conflicted copy).
   */
  onUnresolvedConflict?: (setAside: string) => void;
  /** Rendered between the toolbar and the body (the note's title and chips). */
  header?: ReactNode;
  /** Rendered under the body (the note's other attachments). */
  footer?: ReactNode;
  /** Rendered on the toolbar's right (e.g. "Saved 2 hours ago"). */
  status?: ReactNode;
}

const DEBOUNCE_MS = 250;
const MAX_MENTIONS = 8;
const NOTICE_MS = 10000;

/* ------------------------------------------------------------- the menu */

interface MenuState {
  items: MentionOption[];
  index: number;
  rect: DOMRect | null;
  pick: (o: MentionOption) => void;
}

export default function MarkdownEditor({
  value,
  onChange,
  onPickMention,
  onFile,
  onOpenMention,
  onOpenAsset,
  openUrl,
  onUnresolvedConflict,
  header,
  footer,
  status,
}: MarkdownEditorProps) {
  // Callers pass fresh closures every render; the editor is built once, so it reads them through refs.
  const onChangeRef = useRef(onChange);
  const pickRef = useRef(onPickMention);
  const fileRef = useRef(onFile);
  const openRef = useRef(onOpenMention);
  const openAssetRef = useRef(onOpenAsset);
  onChangeRef.current = onChange;
  pickRef.current = onPickMention;
  fileRef.current = onFile;
  openRef.current = onOpenMention;
  openAssetRef.current = onOpenAsset;
  const openUrlRef = useRef(openUrl);
  openUrlRef.current = openUrl;
  const unresolvedRef = useRef(onUnresolvedConflict);
  unresolvedRef.current = onUnresolvedConflict;

  const listId = useId();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<MenuState | null>(null);
  menuRef.current = menu;

  /** Problems with files, said plainly (a failed or refused attachment). */
  const [notice, setNotice] = useState<string | null>(null);
  /** His unsaved text, set aside when the note changed elsewhere mid-edit. */
  const [conflict, setConflictState] = useState<{ mine: string } | null>(null);
  // the cleanup paths (unmount, quit) read it after the last render, so it lives in a ref too
  const conflictRef = useRef<{ mine: string } | null>(null);
  const setConflict = useCallback((c: { mine: string } | null) => {
    conflictRef.current = c;
    setConflictState(c);
  }, []);
  /**
   * The banner is going away without his choice: hand the set-aside text over to be kept. Called on
   * unmount, on the quit/close flush, and before a second conflict would replace the first.
   */
  const settleConflict = useCallback(() => {
    const c = conflictRef.current;
    if (!c) return;
    conflictRef.current = null;
    setConflictState(null);
    unresolvedRef.current?.(c.mine);
  }, []);

  /* --- saving: the latest doc is kept on every edit, serialized at most every DEBOUNCE_MS --- */
  const editorRef = useRef<Editor | null>(null);
  const latestDoc = useRef<PMNode | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastEmitted = useRef(value);

  const serialize = (ed: Editor, doc: PMNode): string =>
    (ed.storage.markdown as { serializer: { serialize: (d: PMNode) => string } }).serializer.serialize(doc);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const ed = editorRef.current;
    const doc = latestDoc.current;
    if (!ed || !doc) return;
    latestDoc.current = null;
    const md = serialize(ed, doc);
    lastEmitted.current = md;
    onChangeRef.current(md);
  }, []);

  const say = useCallback((msg: string) => setNotice((prev) => (prev ? `${prev} ${msg}` : msg)), []);
  const mounted = useRef(true);

  const insertFiles = useCallback(
    async (files: File[], at?: number) => {
      for (const file of files) {
        const name = file.name || 'Pasted image';
        if (file.size > MAX_ATTACHMENT_BYTES) {
          say(tooBigMessage(name));
          continue;
        }
        const docBefore = editorRef.current?.state.doc;
        let stored: { assetId: ID; name: string };
        try {
          stored = await fileRef.current(file);
        } catch (err) {
          say(err instanceof Error && /^".*" is over 50 MB/.test(err.message) ? err.message : `Couldn't attach "${name}". Nothing was added.`);
          continue; // the other files still go in
        }
        const ed = editorRef.current;
        // gone mid-paste (another note, another screen): the rest are still stored and linked to
        // the note by onFile — they show under its Attachments — just not placed in the text
        if (!ed || ed.isDestroyed || !mounted.current) continue;
        // the note may have changed while the file was being written: then the drop point means
        // nothing any more, and the file goes where the cursor is
        if (at !== undefined && (ed.state.doc !== docBefore || at > ed.state.doc.content.size)) at = undefined;
        const src = `asset:${stored.assetId}`;
        const content = file.type.startsWith('image/')
          ? [{ type: 'image', attrs: { src, alt: stored.name } }]
          : [
              { type: 'text', text: stored.name, marks: [{ type: 'link', attrs: { href: src } }] },
              { type: 'text', text: ' ' },
            ];
        const chain = ed.chain().focus();
        (at === undefined ? chain.insertContent(content) : chain.insertContentAt(at, content)).run();
        at = undefined; // the next file follows the cursor
      }
    },
    [say],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ italic: false, text: false }),
      MarkdownText,
      MarkdownItalic,
      TightTaskList,
      TaskItem.configure({ nested: true }),
      AssetImage.configure({ inline: true }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        // without these the link mark silently drops mentions and attachments
        protocols: ['elmar', 'asset'],
        // any scheme but a script one: links to other apps (evernote:, message:) must survive an edit
        isAllowedUri: (url) => !/^\s*(javascript|vbscript|data):/i.test(url),
        HTMLAttributes: { target: null, rel: null },
      }),
      MentionLink.configure({
        suggestion: {
          char: '@',
          items: ({ query }: { query: string }) => pickRef.current(query).slice(0, MAX_MENTIONS),
          command: ({ editor: ed, range, props }) => {
            const o = props as MentionOption;
            const nodeAfter = ed.view.state.selection.$to.nodeAfter;
            if (nodeAfter?.text?.startsWith(' ')) range.to += 1;
            ed.chain()
              .focus()
              .insertContentAt(range, [
                { type: 'mention', attrs: { kind: o.type, id: o.id, label: o.label } },
                { type: 'text', text: ' ' },
              ])
              .run();
          },
          render: () => {
            const open = (p: SuggestionProps<MentionOption>) =>
              setMenu((m) => ({
                items: p.items,
                index: m && m.items === p.items ? m.index : 0,
                rect: p.clientRect?.() ?? null,
                pick: (o) => p.command(o as never),
              }));
            return {
              onStart: open,
              onUpdate: open,
              onKeyDown: ({ event }: SuggestionKeyDownProps) => {
                const m = menuRef.current;
                if (!m) return false;
                if (event.key === 'Escape') {
                  setMenu(null);
                  return true;
                }
                if (!m.items.length) return false;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  const step = event.key === 'ArrowDown' ? 1 : -1;
                  setMenu({ ...m, index: (m.index + step + m.items.length) % m.items.length });
                  return true;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  m.pick(m.items[m.index]);
                  return true;
                }
                return false;
              },
              onExit: () => setMenu(null),
            };
          },
        },
      }),
      MarkdownTable.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      RawHtmlBlock,
      RawHtmlInline,
      Markdown.configure({ html: true, tightLists: true, bulletListMarker: '-', linkify: false, breaks: false }),
    ],
    content: value,
    editorProps: {
      attributes: { class: 'md-body', 'aria-label': 'Note body' },
      handleDOMEvents: {
        paste: (_view, event) => {
          const files = Array.from((event as ClipboardEvent).clipboardData?.files ?? []);
          if (!files.length) return false;
          event.preventDefault();
          void insertFiles(files);
          return true;
        },
        drop: (view, event) => {
          const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
          if (!files.length) return false;
          event.preventDefault();
          let at: number | undefined;
          try {
            at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos;
          } catch {
            at = undefined; // no layout to measure (e.g. off screen): drop at the cursor
          }
          void insertFiles(files, at);
          return true;
        },
      },
      handleClick: (_view, _pos, event) => {
        const el = event.target as HTMLElement | null;
        const mention = el?.closest?.('a[data-type="mention"]');
        const target = mention ? parseMentionHref(mention.getAttribute('href')) : undefined;
        if (target && openRef.current) {
          openRef.current(target);
          return true;
        }
        const file = el?.closest?.('a[href^="asset:"]');
        if (file && openAssetRef.current) {
          openAssetRef.current(file.getAttribute('href')!.slice('asset:'.length));
          return true;
        }
        // ⌘-click (Ctrl-click off a Mac) follows a web or mail link; a plain click only places the cursor
        const href = el?.closest?.('a[href]')?.getAttribute('href');
        if (isOpenableUrl(href) && isOpenLinkClick(event)) {
          void openExternalUrl(href, openUrlRef.current);
          return true;
        }
        return false;
      },
      handleKeyDown: (view, event) => {
        // Enter on a selected mention follows it (the mention list, when open, has Enter first)
        if (event.key !== 'Enter' || menuRef.current || !openRef.current) return false;
        const sel = view.state.selection;
        if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'mention') return false;
        const t = parseMentionHref(`elmar://${sel.node.attrs.kind}/${sel.node.attrs.id}`);
        if (!t) return false;
        event.preventDefault();
        openRef.current(t);
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      latestDoc.current = ed.state.doc;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, DEBOUNCE_MS);
    },
    onBlur: () => flush(),
  });

  editorRef.current = editor;

  // Never lose the last keystrokes: pending text is written when the editor goes away, and when the
  // tab closes or the app quits (no blur fires then) via the shared flush hook.
  // An unanswered "changed outside" banner is settled the same way: the set-aside text is kept.
  useEffect(() => {
    mounted.current = true;
    const unregister = registerEditorFlush((reason) => {
      flush();
      // only when the page is really going away: a hidden window keeps the banner for his return
      if (reason === 'unload') settleConflict();
    });
    return () => {
      mounted.current = false;
      unregister();
      flush();
      settleConflict();
    };
  }, [flush, settleConflict]);

  /**
   * Put content in the editor that he didn't type here (an outside change, or his choice in the
   * banner) as a fresh start: not an undo step, and with the undo history cleared, so Ctrl+Z can never
   * bring the replaced text back and save it over the version just shown.
   */
  const replaceContent = useCallback((ed: Editor, md: string, keepSelection: boolean) => {
    const { from, to } = ed.state.selection;
    const chain = ed.chain().setContent(md, false).setMeta('addToHistory', false);
    (keepSelection ? chain.setTextSelection({ from, to }) : chain).run(); // clamped to the new doc
    const s = ed.state;
    ed.view.updateState(EditorState.create({ doc: s.doc, selection: s.selection, plugins: s.plugins }));
  }, []);

  // A change from elsewhere (an undo, the folder changing on disk). Our own saves coming back are
  // ignored. With nothing pending it is simply shown, the cursor kept where it was. With an edit
  // pending, nothing is silently dropped: the new version is shown and saved as it is, and his text
  // is set aside behind "Keep mine". If a banner is already up, its set-aside text stays the one
  // offered, and the text he typed since (which would otherwise vanish) is kept as a conflicted copy.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (value === lastEmitted.current) return;
    const pending = latestDoc.current;
    if (pending) {
      clearTimeout(timer.current);
      timer.current = undefined;
      latestDoc.current = null;
      const typed = serialize(editor, pending);
      if (typed !== value) {
        if (conflictRef.current) unresolvedRef.current?.(typed);
        else setConflict({ mine: typed });
      }
    } else {
      const current = (editor.storage.markdown as { getMarkdown: () => string }).getMarkdown();
      if (current === value) {
        lastEmitted.current = value;
        return;
      }
    }
    lastEmitted.current = value;
    replaceContent(editor, value, true);
  }, [editor, value, setConflict, replaceContent]);

  const keepMine = () => {
    if (!editor || !conflict) return;
    const { mine } = conflict;
    setConflict(null);
    latestDoc.current = null;
    clearTimeout(timer.current);
    lastEmitted.current = mine;
    replaceContent(editor, mine, false);
    onChangeRef.current(mine);
  };

  const chooseNewVersion = () => {
    setConflict(null);
    // the version shown stays; his set-aside text is gone by his choice, and so is its undo trail
    if (editor && !editor.isDestroyed && !latestDoc.current) {
      const s = editor.state;
      editor.view.updateState(EditorState.create({ doc: s.doc, selection: s.selection, plugins: s.plugins }));
    }
  };

  // the mention list belongs to the body for assistive tech: which list, and which option is current
  useEffect(() => {
    const dom = editor && !editor.isDestroyed ? editor.view.dom : null;
    if (!dom) return;
    if (menu) {
      dom.setAttribute('aria-controls', listId);
      dom.setAttribute('aria-autocomplete', 'list');
      if (menu.items.length) dom.setAttribute('aria-activedescendant', `${listId}-${menu.index}`);
      else dom.removeAttribute('aria-activedescendant');
    } else {
      dom.removeAttribute('aria-controls');
      dom.removeAttribute('aria-autocomplete');
      dom.removeAttribute('aria-activedescendant');
    }
  }, [editor, menu, listId]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const pickInput = useRef<HTMLInputElement>(null);

  const tool = (label: string, run: (ed: Editor) => void, active: boolean, glyph: ReactNode, glyphStyle?: string) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()} // keep the cursor where it is
      onClick={() => editor && run(editor)}
      className={`md-tb ${active ? 'md-tb-on' : ''} ${glyphStyle ?? ''}`}
    >
      {glyph}
    </button>
  );

  const startMention = (ed: Editor) => {
    const { $from } = ed.state.selection;
    const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, '\n', ' ');
    ed.chain().focus().insertContent(before && !/\s/.test(before) ? ' @' : '@').run();
  };

  return (
    <div className="md-editor">
      <style>{EDITOR_CSS}</style>
      <div className="md-toolbar" role="toolbar" aria-label="Formatting">
        {tool('Bold', (ed) => ed.chain().focus().toggleBold().run(), !!editor?.isActive('bold'), 'B', 'md-g-bold')}
        {tool('Italic', (ed) => ed.chain().focus().toggleItalic().run(), !!editor?.isActive('italic'), 'I', 'md-g-italic')}
        {tool(
          'Heading',
          (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run(),
          !!editor?.isActive('heading'),
          'H',
          'md-g-heading',
        )}
        {tool(
          'Bulleted list',
          (ed) => ed.chain().focus().toggleBulletList().run(),
          !!editor?.isActive('bulletList'),
          <svg className="md-ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
          </svg>,
        )}
        {tool(
          'Checklist',
          (ed) => ed.chain().focus().toggleTaskList().run(),
          !!editor?.isActive('taskList'),
          <svg className="md-ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m3 7 2 2 4-4M3 17l2 2 4-4M13 7h8M13 17h8" />
          </svg>,
        )}
        {tool(
          'Add a photo or file',
          () => pickInput.current?.click(),
          false,
          <svg className="md-ico" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-5-5L5 21" />
          </svg>,
        )}
        {tool(
          'Link to a project or note',
          startMention,
          false,
          <svg className="md-ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
            <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
          </svg>,
        )}
        <input
          ref={pickInput}
          type="file"
          multiple
          hidden
          aria-label="Choose a photo or file"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) void insertFiles(files);
          }}
        />
        {status && <span className="md-status">{status}</span>}
      </div>

      {conflict && (
        <div className="md-banner" role="alert">
          <span className="md-banner-text">
            This note changed outside the app while you were typing. You are seeing the new version; your
            changes are kept until you choose.
          </span>
          <button type="button" className="md-banner-btn md-banner-primary" onClick={keepMine}>
            Keep mine
          </button>
          <button type="button" className="md-banner-btn" onClick={chooseNewVersion}>
            Use the new version
          </button>
        </div>
      )}
      {notice && (
        <div className="md-banner md-banner-warn" role="alert">
          <span className="md-banner-text">{notice}</span>
          <button type="button" className="md-banner-close" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="md-scroll">
        <div className="md-doc">
          {header}
          <EditorContent editor={editor} />
          {footer}
        </div>
      </div>

      {menu && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Link to a project or note"
          className="md-menu"
          style={{
            top: (menu.rect?.bottom ?? 0) + 6,
            left: menu.rect?.left ?? 0,
          }}
        >
          {menu.items.length === 0 ? (
            <li className="md-menu-empty">No project or note by that name</li>
          ) : (
            menu.items.map((o, i) => (
              <li
                key={`${o.type}/${o.id}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === menu.index}
                className={`md-menu-item ${i === menu.index ? 'md-menu-on' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  menu.pick(o);
                }}
                onMouseEnter={() => setMenu({ ...menu, index: i })}
              >
                {o.type === 'project' ? <span className="md-menu-dot" aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
                <span className="md-menu-label">{o.label}</span>
                <span className="md-menu-kind">{o.type === 'project' ? 'Project' : 'Note'}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/* Self-contained so this file merges cleanly; colours are the Montana tokens from index.css. */
const EDITOR_CSS = `
.md-editor{display:flex;flex-direction:column;flex:1;min-height:0}
.md-toolbar{display:flex;align-items:center;gap:4px;height:60px;padding:0 24px;border-bottom:1px solid var(--mt-line);flex:none}
.md-tb{width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--mt-ink-2);cursor:pointer;font:inherit;font-weight:700}
.md-tb:hover{background:var(--mt-raised);color:var(--mt-ink)}
.md-tb:focus-visible{outline:2px solid var(--mt-action);outline-offset:1px}
.md-tb-on{background:var(--mt-raised);color:var(--mt-ink)}
.md-g-italic{font-style:italic;font-weight:500;font-family:Georgia,serif}
.md-g-heading{font-family:Archivo,sans-serif}
.md-ico{width:20px;height:20px;flex:none;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.md-status{margin-left:auto;font-size:12px;color:var(--mt-ink-3)}
.md-banner{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 24px;border-bottom:1px solid var(--mt-line);background:var(--mt-soon-bg);font-size:13px;line-height:18px;color:var(--mt-ink);flex:none}
.md-banner-warn{background:var(--mt-warn-bg)}
.md-banner-text{flex:1;min-width:220px}
.md-banner-btn{height:44px;padding:0 14px;border-radius:6px;border:1px solid var(--mt-line-strong);background:var(--mt-panel);color:var(--mt-ink);font:inherit;font-weight:600;cursor:pointer}
.md-banner-btn:hover{background:var(--mt-raised)}
.md-banner-primary{background:var(--mt-ink);border-color:var(--mt-ink);color:#fff}
.md-banner-primary:hover{background:#2a2b2f}
.md-banner-close{width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--mt-ink-2);cursor:pointer}
.md-banner-close:hover{background:var(--mt-raised);color:var(--mt-ink)}
.md-raw{font-family:"IBM Plex Mono",monospace;font-size:12px;line-height:18px;white-space:pre-wrap;color:var(--mt-ink-2);background:var(--mt-paper);border:1px dashed var(--mt-line);border-radius:6px;padding:6px 10px}
.md-raw-inline{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--mt-ink-3);background:var(--mt-paper);border-radius:4px;padding:0 3px}
.md-body .ProseMirror-selectednode.md-raw,.md-body .ProseMirror-selectednode.md-raw-inline,.md-body a.md-mention.ProseMirror-selectednode{outline:2px solid var(--mt-action);outline-offset:1px}
.md-scroll{flex:1;min-height:0;overflow-y:auto}
.md-doc{padding:32px 56px;display:flex;flex-direction:column;gap:14px;max-width:760px}
.md-body{outline:none;font-size:16px;line-height:26px;color:var(--mt-ink);min-height:240px}
.md-body>*+*{margin-top:14px}
.md-body p{margin:0}
.md-body h1,.md-body h2,.md-body h3{font-family:Archivo,sans-serif;letter-spacing:-0.01em;margin:22px 0 0}
.md-body h1{font-weight:800;font-size:24px;line-height:30px}
.md-body h2{font-weight:700;font-size:18px;line-height:24px}
.md-body h3{font-weight:700;font-size:16px;line-height:22px}
.md-body>:first-child{margin-top:0}
.md-body ul,.md-body ol{margin:0;padding-left:24px}
.md-body ul{list-style:disc}.md-body ol{list-style:decimal}
.md-body li>p{margin:0}
.md-body ul[data-type="taskList"]{list-style:none;padding-left:0}
.md-body ul[data-type="taskList"] li{display:flex;align-items:flex-start;gap:12px;min-height:32px}
.md-body ul[data-type="taskList"] li>label{flex:none;padding-top:3px}
.md-body ul[data-type="taskList"] li>label input{width:18px;height:18px;margin:0;accent-color:#16171A}
.md-body ul[data-type="taskList"] li>div{flex:1;min-width:0}
.md-body ul[data-type="taskList"] li[data-checked="true"]>div{color:var(--mt-ink-3);text-decoration:line-through}
.md-body a{color:var(--mt-accent-text);text-decoration:underline;text-underline-offset:2px}
.md-body a.md-mention{display:inline-flex;align-items:center;height:24px;padding:0 8px;border-radius:999px;border:1px solid var(--mt-line);background:var(--mt-paper);font-size:13px;color:var(--mt-ink);text-decoration:none;cursor:pointer;vertical-align:baseline}
.md-body a.md-mention:hover{border-color:var(--mt-line-strong)}
.md-body img.md-image{display:block;max-width:100%;max-height:420px;border-radius:8px;background:var(--mt-raised);min-height:40px}
.md-body img.md-image.ProseMirror-selectednode{outline:2px solid var(--mt-action)}
.md-body table{border-collapse:collapse;width:100%;font-size:14px;line-height:20px}
.md-body th,.md-body td{border:1px solid var(--mt-line);padding:6px 10px;text-align:left;vertical-align:top}
.md-body th{background:var(--mt-raised);font-weight:600}
.md-body blockquote{margin:0;padding-left:14px;border-left:3px solid var(--mt-line);color:var(--mt-ink-2)}
.md-body code{font-family:"IBM Plex Mono",monospace;font-size:13px;background:var(--mt-raised);border-radius:4px;padding:1px 4px}
.md-body pre{background:var(--mt-raised);border-radius:6px;padding:12px;overflow-x:auto}
.md-body pre code{background:none;padding:0}
.md-body p.is-editor-empty:first-child::before{content:attr(data-placeholder);color:var(--mt-ink-3);float:left;height:0;pointer-events:none}
.md-menu{position:fixed;z-index:50;min-width:260px;max-width:360px;margin:0;padding:6px;list-style:none;background:var(--mt-panel);border:1px solid var(--mt-line);border-radius:8px;box-shadow:0 8px 24px rgba(22,23,26,.12)}
.md-menu-item{display:flex;align-items:center;gap:10px;height:36px;padding:0 10px;border-radius:6px;font-size:13px;color:var(--mt-ink);cursor:pointer}
.md-menu-on{background:var(--mt-raised)}
.md-menu-dot{width:10px;height:10px;border-radius:3px;background:var(--mt-ink-3);flex:none}
.md-menu-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.md-menu-kind{font-size:12px;color:var(--mt-ink-3)}
.md-menu-empty{padding:8px 10px;font-size:13px;color:var(--mt-ink-3)}
`;
