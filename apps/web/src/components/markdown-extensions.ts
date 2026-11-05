import { getHTMLFromFragment, Node } from '@tiptap/core';
import Italic from '@tiptap/extension-italic';
import Text from '@tiptap/extension-text';
import TaskList from '@tiptap/extension-task-list';
import Image from '@tiptap/extension-image';
import Mention from '@tiptap/extension-mention';
import Table from '@tiptap/extension-table';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import type { MarkdownSerializerState } from 'prosemirror-markdown';
import { getAssetBlob } from '../lib/assets';
import { mentionHref, parseMentionHref } from '../lib/mentions';

/*
 * The schema pieces behind the note editor, each with the markdown it reads and writes. The rule
 * throughout: what was in the note comes back out of it. Text is escaped the markdown way (`\<`),
 * never as HTML entities; HTML the editor has no node for is kept verbatim as a raw block or span;
 * table cells keep whatever they hold.
 */

/* ------------------------------------------------------------- escaping */

type State = MarkdownSerializerState & {
  /** What has been written so far (public in prosemirror-markdown, missing from its types). */
  out: string;
  inTable?: boolean;
  inAutolink?: boolean;
  options: { escapeExtraCharacters?: RegExp };
};

/**
 * Beyond prosemirror-markdown's own escapes: a `<` that could open a tag, comment or autolink, and an
 * `&` that would read as an entity. (`|` in a table cell is handled once, for the whole cell, by the
 * table serializer — see `escapeCellPipes`.)
 */
const EXTRA = /<(?=[A-Za-z/!?])|&(?=#?[A-Za-z0-9]+;)/g;

function esc(state: State, text: string): string {
  state.options.escapeExtraCharacters = EXTRA;
  return state.esc(text);
}

export const MarkdownText = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: State, node: PMNode) {
          state.options.escapeExtraCharacters = EXTRA;
          state.text(node.text ?? '', !state.inAutolink);
        },
        parse: {},
      },
    };
  },
});

/** Italic is written `_like this_`. */
export const MarkdownItalic = Italic.extend({
  addStorage: () => ({
    markdown: {
      serialize: { open: '_', close: '_', mixable: true, expelEnclosingWhitespace: true },
      parse: {},
    },
  }),
});

/**
 * tiptap-markdown keeps bullet and numbered lists tight (no blank line between items) but not
 * checklists; the same attribute here keeps `- [ ] a\n- [x] b` as written.
 */
export const TightTaskList = TaskList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tight: {
        default: true,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-tight') === 'true' || !el.querySelector('p'),
        renderHTML: (attrs: { tight?: boolean }) => (attrs.tight ? { 'data-tight': 'true' } : {}),
      },
    };
  },
});

/* --------------------------------------------------------- markdown-it */

interface MdToken {
  type: string;
  content: string;
  children: MdToken[] | null;
  attrSet(name: string, value: string): void;
}
interface MarkdownIt {
  utils: { escapeHtml(s: string): string };
  renderer: {
    rules: Record<string, (tokens: MdToken[], idx: number, options: unknown, env: unknown, self: MdRenderer) => string>;
  };
}
interface MdRenderer {
  renderToken(tokens: MdToken[], idx: number, options: unknown): string;
}

/** An image's alt as written, escapes included (markdown-it drops `\[` from alt text). */
function altText(tokens: MdToken[]): string {
  return tokens
    .map((t) => (t.type === 'image' ? altText(t.children ?? []) : t.type === 'softbreak' || t.type === 'hardbreak' ? '\n' : t.content))
    .join('');
}

const SETUP = Symbol('elmar-markdown-setup');
const TASK_BOX = /^<input class="task-list-item-checkbox"[^>]*>$/;
const BR = /^<br\s*\/?>$/i;

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rawInlineTag = (html: string) => `<span data-raw-inline="${escAttr(html)}"></span>`;

/** Tags the editor's schema reads inside an HTML table. Anything else is kept as raw inline source. */
const TABLE_KNOWN = new Set([
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'col', 'p', 'br', 'a', 'img', 'strong', 'b', 'em',
  'i', 's', 'del', 'strike', 'code', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr',
]);
const VOID = new Set(['br', 'img', 'input', 'hr', 'col', 'wbr']);

function knownInTable(el: Element): boolean {
  const tag = el.localName;
  if (TABLE_KNOWN.has(tag)) return true;
  if (el.hasAttribute('data-raw-inline') || el.hasAttribute('data-raw-html')) return true;
  // the checklist's own markup
  const inTask = !!el.closest('li[data-checked]');
  return inTask && (tag === 'label' || tag === 'input' || tag === 'div' || (tag === 'span' && el.parentElement?.localName === 'label'));
}

function startTag(el: Element): string {
  const attrs = Array.from(el.attributes)
    .map((a) => (a.value === '' ? ` ${a.name}` : ` ${a.name}="${a.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`))
    .join('');
  return `<${el.localName}${attrs}>`;
}

/**
 * An HTML table stays a table (it is not captured as a raw block): the browser reads it, but first
 * every comment and every tag the schema has no node for (`<u>`, `<span style>`…) is swapped for a
 * raw inline node carrying its source, with its contents left in place between open and close.
 */
function tableHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const body = doc.body;
  const walk = (node: globalThis.Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 8) {
        const span = doc.createElement('span');
        span.setAttribute('data-raw-inline', `<!--${(child as Comment).data}-->`);
        child.replaceWith(span);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      walk(el);
      if (knownInTable(el)) continue;
      const open = doc.createElement('span');
      open.setAttribute('data-raw-inline', startTag(el));
      const parts: globalThis.Node[] = [open, ...Array.from(el.childNodes)];
      if (!VOID.has(el.localName)) {
        const close = doc.createElement('span');
        close.setAttribute('data-raw-inline', `</${el.localName}>`);
        parts.push(close);
      }
      el.replaceWith(...parts);
    }
  };
  walk(body);
  return body.innerHTML;
}

/**
 * Raw HTML in a note (a comment, `<details>`, `<u>`, a `<span style>`) is handed to the editor as a
 * wrapper carrying the source, so it becomes a raw node kept byte for byte, instead of being parsed
 * into the schema and stripped to its text. Two exceptions are real structure: an HTML `<table>`
 * (parsed as a table, see `tableHtml`) and `<br>` inside a GFM table cell (a line break in the cell).
 */
function setupMarkdownIt(md: MarkdownIt & { [SETUP]?: true }): void {
  if (md[SETUP]) return; // tiptap-markdown runs setup on every parse
  md[SETUP] = true;
  const attr = md.utils.escapeHtml;
  md.renderer.rules.html_block = (tokens, idx) => {
    const html = tokens[idx].content;
    if (/^\s*<table[\s>]/i.test(html)) return tableHtml(html);
    return `<div data-raw-html="${attr(html)}"></div>`;
  };
  md.renderer.rules.html_inline = (tokens, idx, _options, env) => {
    const html = tokens[idx].content;
    // the checklist plugin draws its boxes as inline HTML: those are checklist syntax, not raw HTML
    if (TASK_BOX.test(html)) return html;
    if ((env as { inCell?: boolean }).inCell && BR.test(html)) return '<br>';
    return rawInlineTag(html);
  };
  for (const cell of ['td', 'th']) {
    md.renderer.rules[`${cell}_open`] = (tokens, idx, options, env, self) => {
      (env as { inCell?: boolean }).inCell = true;
      return self.renderToken(tokens, idx, options);
    };
    md.renderer.rules[`${cell}_close`] = (tokens, idx, options, env, self) => {
      (env as { inCell?: boolean }).inCell = false;
      return self.renderToken(tokens, idx, options);
    };
  }
  md.renderer.rules.image = (tokens, idx, options, _env, self) => {
    tokens[idx].attrSet('alt', altText(tokens[idx].children ?? []));
    return self.renderToken(tokens, idx, options);
  };
}

/* ------------------------------------------------------------- raw html */

export const RawHtmlBlock = Node.create({
  name: 'rawHtmlBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { html: { default: '', parseHTML: (el) => el.getAttribute('data-raw-html') ?? '', renderHTML: () => ({}) } };
  },
  parseHTML() {
    return [{ tag: 'div[data-raw-html]', priority: 100 }];
  },
  renderHTML({ node }) {
    // shown as its source: what is there is what will be saved
    return ['div', { 'data-raw-html': node.attrs.html, class: 'md-raw', title: 'Kept exactly as it was written' }, String(node.attrs.html).replace(/\n+$/, '')];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: State, node: PMNode) {
          state.write(String(node.attrs.html).replace(/\n+$/, ''));
          state.closeBlock(node);
        },
        parse: { setup: setupMarkdownIt },
      },
    };
  },
});

export const RawHtmlInline = Node.create({
  name: 'rawHtmlInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { html: { default: '', parseHTML: (el) => el.getAttribute('data-raw-inline') ?? '', renderHTML: () => ({}) } };
  },
  parseHTML() {
    return [{ tag: 'span[data-raw-inline]', priority: 100 }];
  },
  renderHTML({ node }) {
    return ['span', { 'data-raw-inline': node.attrs.html, class: 'md-raw-inline' }, String(node.attrs.html)];
  },
  renderText({ node }) {
    return String(node.attrs.html);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: State, node: PMNode) {
          state.write(String(node.attrs.html)); // in a table cell, its `|` are escaped with the cell
        },
        parse: {},
      },
    };
  },
});

/* ---------------------------------------------------------------- images */

/** One object URL per asset for the session: a re-render never re-reads the bytes or flickers. */
const assetUrls = new Map<string, Promise<string | undefined>>();

function assetUrl(id: string): Promise<string | undefined> {
  let p = assetUrls.get(id);
  if (!p) {
    p = getAssetBlob(id).then(
      (blob) => (blob ? URL.createObjectURL(blob) : undefined),
      () => undefined,
    );
    // a miss is not remembered: the bytes may land a moment later
    void p.then((url) => {
      if (!url) assetUrls.delete(id);
    });
    assetUrls.set(id, p);
  }
  return p;
}

/**
 * Images whose `src` stays `asset:<id>` in the document (so the markdown keeps it) while the screen
 * shows the bytes through an object URL.
 */
export const AssetImage = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement('img');
      img.className = 'md-image';
      let shown = '';
      const show = (n: PMNode) => {
        const src = String(n.attrs.src ?? '');
        img.alt = String(n.attrs.alt ?? '');
        if (n.attrs.title) img.title = String(n.attrs.title);
        else img.removeAttribute('title');
        if (src === shown) return;
        shown = src;
        if (src.startsWith('asset:')) {
          img.removeAttribute('src');
          img.dataset.asset = src.slice('asset:'.length);
          void assetUrl(src.slice('asset:'.length)).then((url) => {
            if (url && shown === src) img.src = url;
          });
        } else {
          delete img.dataset.asset;
          img.src = src;
        }
      };
      show(node);
      return {
        dom: img,
        update: (n: PMNode) => {
          if (n.type !== node.type) return false;
          show(n);
          return true;
        },
      };
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: State, node: PMNode) {
          const src = String(node.attrs.src ?? '').replace(/[()]/g, '\\$&');
          const title = node.attrs.title ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"` : '';
          state.write(`![${esc(state, String(node.attrs.alt ?? ''))}](${src}${title})`);
        },
        parse: {},
      },
    };
  },
});

/* -------------------------------------------------------------- mentions */

/** A mention is one atomic link chip; arrow keys select it and Enter follows it. */
export const MentionLink = Mention.extend({
  selectable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: { default: 'project', renderHTML: () => ({}) },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'a[href^="elmar://"]',
        priority: 100, // ahead of the link mark, which would otherwise take it as plain linked text
        getAttrs: (el) => {
          const t = parseMentionHref((el as HTMLElement).getAttribute('href'));
          return t ? { kind: t.type, id: t.id, label: (el as HTMLElement).textContent ?? '' } : false;
        },
      },
    ];
  },
  renderHTML({ node }) {
    return [
      'a',
      { href: mentionHref(node.attrs.kind, node.attrs.id), 'data-type': 'mention', class: 'md-mention' },
      String(node.attrs.label ?? ''),
    ];
  },
  renderText({ node }) {
    return String(node.attrs.label ?? '');
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: State, node: PMNode) {
          state.write(`[${esc(state, String(node.attrs.label ?? ''))}](${mentionHref(node.attrs.kind, node.attrs.id)})`);
        },
        parse: {},
      },
    };
  },
});

/* ---------------------------------------------------------------- tables */

/**
 * A cell GFM can hold: no merged cells, and only paragraphs (Enter in a cell makes a second one; the
 * paragraphs and any line breaks are written as `<br>`). Raw HTML spanning lines can't sit in a row.
 */
function oneLineCell(cell: PMNode): boolean {
  if (cell.attrs.colspan > 1 || cell.attrs.rowspan > 1) return false;
  let ok = cell.childCount > 0;
  cell.forEach((block) => {
    if (block.type.name !== 'paragraph') ok = false;
    block.descendants((n) => {
      if (n.type.name === 'rawHtmlInline' && String(n.attrs.html).includes('\n')) ok = false;
      return ok;
    });
  });
  return ok;
}

/**
 * Every `|` in a cell gets one more backslash. markdown-it splits a GFM row on each `|` that has no
 * backslash right before it, and for each `\|` drops exactly that one backslash before reading the
 * cell — in text, in code spans and in raw HTML alike. Adding one backslash before every `|`
 * therefore gives back exactly what was written: text `a|b` → `a\|b`; code `ls | wc` → `ls \| wc`;
 * code `a\|b` → `a\\|b`; and text `a\|b` (written `a\\|b` by the text escaper) → `a\\\|b`.
 */
function escapeCellPipes(md: string): string {
  return md.replace(/\|/g, '\\|');
}

const unescAttr = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&#10;/g, '\n')
    .replace(/&amp;/g, '&');

/** A blank line ends an HTML block in markdown: the HTML table must never contain one. */
const hasBlankLine = (s: string) => /\n[ \t]*\n/.test(s);

/**
 * A table GFM can't hold, as HTML on one line. Newlines inside it (a code block in a cell, say) are
 * written as `&#10;`, so no blank line can split the table when it is read back. Raw HTML inside it is
 * written as its own source (not as the editor's wrapper), so the file reads as the HTML he would
 * expect — unless that source itself holds a blank line, in which case it keeps the wrapper, whose
 * attribute carries the source with its newlines encoded.
 */
function tableAsHtml(node: PMNode): string {
  const raw = (src: string, keep: string, trim: boolean) => {
    const source = unescAttr(src);
    if (hasBlankLine(source)) return keep;
    return trim ? source.replace(/\n+$/, '') : source;
  };
  return getHTMLFromFragment(Fragment.from(node), node.type.schema)
    .replace(/\r?\n/g, '&#10;')
    .replace(/<span data-raw-inline="([^"]*)"[^>]*>[\s\S]*?<\/span>/g, (m, src: string) => raw(src, m, false))
    .replace(/<div data-raw-html="([^"]*)"[^>]*>[\s\S]*?<\/div>/g, (m, src: string) => raw(src, m, true));
}

function isGfmTable(table: PMNode): boolean {
  let ok = table.childCount > 0;
  table.forEach((row, _o, i) => {
    row.forEach((cell) => {
      const header = cell.type.name === 'tableHeader';
      if (header !== (i === 0) || !oneLineCell(cell)) ok = false;
    });
  });
  return ok;
}

/**
 * A GFM table whenever the table fits one: every cell's content is written, whatever it is (an
 * image, a mention, code, nothing but a link); several lines in a cell are joined with `<br>`; and
 * every `|` inside a cell is escaped — code spans included, which prosemirror-markdown writes
 * unescaped. A table GFM can't hold (merged cells, a list in a cell, no header row) is written as
 * HTML, whole, and still reads back as a table.
 */
export const MarkdownTable = Table.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: State, node: PMNode) {
          if (!isGfmTable(node)) {
            state.write(tableAsHtml(node));
            state.closeBlock(node);
            return;
          }
          state.inTable = true;
          node.forEach((row, _o, i) => {
            state.write('| ');
            row.forEach((cell, _p, j) => {
              if (j) state.write(' | ');
              const start = state.out.length;
              cell.forEach((para, _q, k) => {
                if (k) state.write('<br>');
                if (para.childCount > 0) state.renderInline(para);
              });
              state.out = state.out.slice(0, start) + escapeCellPipes(state.out.slice(start));
            });
            state.write(' |');
            state.ensureNewLine();
            if (i === 0) {
              state.write(`| ${Array.from({ length: row.childCount }, () => '---').join(' | ')} |`);
              state.ensureNewLine();
            }
          });
          state.inTable = false;
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});
