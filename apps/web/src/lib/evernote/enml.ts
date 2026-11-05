import type { ID } from '@hq/core/types';

export type EnmlAsset = { id: ID; name: string; mime: string };

export type EnmlResult = {
  markdown: string;
  /** True when the note held something markdown can't carry faithfully; `markdown` is still the best effort. */
  fallback: boolean;
  /** How many `en-crypt` blocks were replaced by a placeholder line. */
  encrypted: number;
};

export const ENCRYPTED_LINE = '> Encrypted in Evernote; not imported';

/**
 * Converts an Evernote note body (ENML) to markdown. `assets` is keyed by the resource's MD5 hex hash,
 * the same value as `<en-media hash>`. Attachments become `![name](asset:id)` for images and
 * `[name](asset:id)` for other files.
 */
export function enmlToMarkdown(enml: string, assets: Map<string, EnmlAsset>): EnmlResult {
  const { root, wellFormed } = parseEnml(enml);
  const converter = new Converter(assets);
  if (!wellFormed) converter.fallback = true;
  const markdown = joinBlocks(converter.blocks(root));
  return { markdown, fallback: converter.fallback, encrypted: converter.encrypted };
}

// ---------------------------------------------------------------------------------------------
// Parsing

/** The only named entities XML knows without a DTD. */
const XML_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);
const entityCache = new Map<string, string | null>();

/** Resolves an HTML named entity (e.g. `eacute`) to numeric character references, or null if unknown. */
function numericEntity(name: string): string | null {
  let out = entityCache.get(name);
  if (out === undefined) {
    const decoded = new DOMParser().parseFromString(`<!doctype html><body>&${name};`, 'text/html').body.textContent ?? '';
    out =
      decoded && decoded !== `&${name};`
        ? Array.from(decoded)
            .map((c) => `&#${c.codePointAt(0)};`)
            .join('')
        : null;
    entityCache.set(name, out);
  }
  return out;
}

function parseEnml(enml: string): { root: Element; wellFormed: boolean } {
  const src = enml
    .replace(/^﻿/, '')
    .trim()
    .replace(/^<\?xml[^>]*\?>/, '')
    .trim()
    .replace(/^<!DOCTYPE[^>]*>/i, '')
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (match, name: string) =>
      XML_ENTITIES.has(name) ? match : (numericEntity(name) ?? match),
    );
  try {
    const doc = new DOMParser().parseFromString(src, 'text/xml');
    if (doc.documentElement && doc.getElementsByTagName('parsererror').length === 0) {
      return { root: doc.documentElement, wellFormed: true };
    }
  } catch {
    // fall through to the forgiving HTML parser
  }
  const html = new DOMParser().parseFromString(src, 'text/html');
  return { root: html.getElementsByTagName('en-note')[0] ?? html.body, wellFormed: false };
}

// ---------------------------------------------------------------------------------------------
// Conversion

type BlockKind = 'para' | 'todo' | 'heading' | 'list' | 'table' | 'hr' | 'quote' | 'code';
type Block = { kind: BlockKind; text: string };

/** Blocks whose structure is lost if they are flattened into a line of text. */
const STRUCTURAL_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'hr', 'pre', 'blockquote', 'en-crypt',
]);
const BLOCK_TAGS = new Set(['en-note', 'div', 'p', ...STRUCTURAL_TAGS]);
/** Inline elements that only add styling (or a link); if they hold structural blocks they act as blocks. */
const WRAPPER_TAGS = new Set([
  'b', 'strong', 'i', 'em', 's', 'strike', 'del', 'u', 'sup', 'sub', 'code', 'a', 'span', 'font',
]);
const LEAF_INLINE_TAGS = new Set(['br', 'en-media', 'en-todo', 'style']);
/** Content markdown can't hold at all: skipped, and the note is flagged. */
const UNSUPPORTED_TAGS = new Set(['iframe', 'object', 'svg', 'embed', 'applet', 'script']);
const TABLE_PARTS = new Set(['thead', 'tbody', 'tfoot']);
/** Styles whose adjacent runs merge: `<b>a</b><b>b</b>` gives `**ab**`. */
const STYLE_MARKS: Record<string, string> = {
  b: '**', strong: '**', i: '*', em: '*', s: '~~', strike: '~~', del: '~~',
};

// Placeholders for en-todo boxes; they become `- [ ] ` / `- [x] ` once we know where the line starts.
const OPEN = '';
const DONE = '';

class Converter {
  fallback = false;
  encrypted = 0;
  private inItem = false;
  private tableDepth = 0;

  constructor(private readonly assets: Map<string, EnmlAsset>) {}

  /** Converts a container's children into blocks, gathering inline runs into paragraphs. */
  blocks(parent: Node): Block[] {
    const out: Block[] = [];
    let run: Node[] = [];
    const flush = () => {
      const block = this.paragraph(this.renderInline(run));
      if (block) out.push(block);
      run = [];
    };
    for (const node of Array.from(parent.childNodes)) {
      if (isElement(node) && this.isBlock(node)) {
        flush();
        out.push(...this.block(node));
      } else {
        run.push(node);
      }
    }
    flush();
    return out;
  }

  private isBlock(el: Element): boolean {
    const name = tag(el);
    if (BLOCK_TAGS.has(name)) return true;
    if (LEAF_INLINE_TAGS.has(name) || UNSUPPORTED_TAGS.has(name)) return false;
    const inside = WRAPPER_TAGS.has(name) ? STRUCTURAL_TAGS : BLOCK_TAGS;
    return Array.from(el.getElementsByTagName('*')).some((d) => inside.has(tag(d)));
  }

  private block(el: Element): Block[] {
    const name = tag(el);
    const heading = /^h([1-6])$/.exec(name);
    if (heading) {
      const text = cleanInline(this.inlineChildren(el));
      return text ? [{ kind: 'heading', text: `${'#'.repeat(Number(heading[1]))} ${text}` }] : [];
    }
    if (isCodeBlock(el)) return [{ kind: 'code', text: fencedCode(preText(el).replace(/\u00a0/g, ' ')) }];
    switch (name) {
      case 'hr':
        return [{ kind: 'hr', text: '---' }];
      case 'ul':
      case 'ol': {
        const text = this.list(el);
        return text ? [{ kind: 'list', text }] : [];
      }
      case 'table':
        return this.table(el);
      case 'en-crypt':
        this.encrypted++;
        return [{ kind: 'quote', text: ENCRYPTED_LINE }];
      case 'pre':
        return [{ kind: 'code', text: fencedCode(preText(el)) }];
      case 'blockquote': {
        const inner = joinBlocks(this.blocks(el));
        if (!inner) return [];
        const text = inner
          .split('\n')
          .map((l) => (l ? `> ${l}` : '>'))
          .join('\n');
        return [{ kind: 'quote', text }];
      }
      case 'en-note':
      case 'div':
      case 'p':
      case 'li':
        return this.blocks(el);
      default:
        // A styling wrapper around blocks: keep the blocks, drop the styling.
        if (!WRAPPER_TAGS.has(name)) this.fallback = true;
        return this.blocks(el);
    }
  }

  private inlineChildren(el: Element): string {
    return this.renderInline(Array.from(el.childNodes));
  }

  /** Renders inline nodes, merging adjacent runs of the same style. */
  private renderInline(nodes: Node[]): string {
    let out = '';
    let pending = null as { mark: string; inner: string } | null;
    const flushStyle = () => {
      if (pending) out += wrap(pending.inner, pending.mark);
      pending = null;
    };
    for (const node of nodes) {
      const mark = isElement(node) ? STYLE_MARKS[tag(node)] : undefined;
      if (mark && isElement(node)) {
        const inner = this.inlineChildren(node);
        if (pending && pending.mark === mark) pending.inner += inner;
        else {
          flushStyle();
          pending = { mark, inner };
        }
      } else {
        flushStyle();
        out += this.inline(node);
      }
    }
    flushStyle();
    return out;
  }

  private inline(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      return escapeText((node.nodeValue ?? '').replace(/[]/g, '').replace(/\s+/g, ' '));
    }
    if (!isElement(node)) return '';
    const name = tag(node);
    if (STYLE_MARKS[name]) return wrap(this.inlineChildren(node), STYLE_MARKS[name]);
    switch (name) {
      case 'br':
        return '\n';
      case 'u':
      case 'sup':
      case 'sub':
      case 'span':
      case 'font':
        return this.inlineChildren(node);
      case 'code':
        return codeSpan(node.textContent ?? '');
      case 'a':
        return this.link(node);
      case 'en-media':
        // children only exist when the forgiving HTML parser swallowed what followed `<en-media/>`
        return this.media(node) + this.inlineChildren(node);
      case 'en-todo':
        return (node.getAttribute('checked') === 'true' ? DONE : OPEN) + this.inlineChildren(node);
      case 'style':
        return '';
      case 'en-crypt':
        this.encrypted++;
        return ' Encrypted in Evernote; not imported ';
      case 'en-note':
      case 'div':
      case 'p':
        return ` ${this.inlineChildren(node)} `;
      default:
        if (UNSUPPORTED_TAGS.has(name)) {
          this.fallback = true;
          return '';
        }
        // Unknown elements, and structure (a list in a heading, say) flattened into a line.
        this.fallback = true;
        return STRUCTURAL_TAGS.has(name) ? ` ${this.inlineChildren(node)} ` : this.inlineChildren(node);
    }
  }

  private link(el: Element): string {
    const href = (el.getAttribute('href') ?? '').trim();
    const inner = this.inlineChildren(el).replace(/\n/g, ' ');
    if (!href) return inner;
    const [, lead, label, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
    const url = href.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
    return `${lead}[${label || escapeText(href)}](${url})${trail}`;
  }

  private media(el: Element): string {
    const asset = this.assets.get((el.getAttribute('hash') ?? '').trim().toLowerCase());
    if (!asset) {
      this.fallback = true;
      return '';
    }
    const mime = asset.mime || el.getAttribute('type') || '';
    const name =
      asset.name
        .replace(/\[/g, '(')
        .replace(/\]/g, ')')
        .replace(/\\/g, '/')
        .replace(/\s+/g, ' ')
        .trim() || 'attachment';
    return `${mime.startsWith('image/') ? '!' : ''}[${name}](asset:${asset.id})`;
  }

  /** Turns an inline run into a paragraph (or a run of to-do lines). */
  private paragraph(run: string): Block | null {
    const lines = run.split('\n').map((l) => l.replace(/ {2,}/g, ' ').trim());
    while (lines.length && !lines[0]) lines.shift();
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    if (!lines.length) return null;

    const isTodo = (l: string) => l.startsWith(OPEN) || l.startsWith(DONE);
    let text = '';
    let gap = false;
    for (const line of lines) {
      if (!line) {
        gap = true;
        continue;
      }
      if (text) text += gap ? '\n\n' : isTodo(line) ? '\n' : '  \n';
      gap = false;
      text += this.finishLine(line);
    }
    return { kind: isTodo(lines[0]) ? 'todo' : 'para', text };
  }

  private finishLine(line: string): string {
    let out: string;
    if (line.startsWith(OPEN) || line.startsWith(DONE)) {
      const box = line.startsWith(DONE) ? '[x]' : '[ ]';
      const rest = escapeLineStart(line.slice(1).trim());
      out = `${this.inItem ? '' : '- '}${box}${rest ? ` ${rest}` : ''}`;
    } else {
      out = escapeLineStart(line);
    }
    return out.replace(new RegExp(DONE, 'g'), '[x]').replace(new RegExp(OPEN, 'g'), '[ ]');
  }

  private list(el: Element): string {
    const ordered = tag(el) === 'ol';
    let n = Math.max(1, Math.floor(Number(el.getAttribute('start')) || 1));
    let indentBy = 2;
    const items: string[] = [];
    for (const node of Array.from(el.childNodes)) {
      if (isElement(node) && (tag(node) === 'ul' || tag(node) === 'ol')) {
        // Evernote nests lists as siblings of <li>: they belong to the item before them.
        const nested = this.list(node);
        if (nested) items.push(indent(nested, indentBy, true));
        continue;
      }
      if (!isElement(node) && !(node.nodeValue ?? '').trim()) continue;
      if (isElement(node) && tag(node) !== 'li') this.fallback = true;
      const marker = ordered ? `${n++}. ` : '- ';
      indentBy = marker.length;
      items.push(this.item(node, marker));
    }
    return items.join('\n');
  }

  private item(node: Node, marker: string): string {
    const saved = this.inItem;
    this.inItem = true;
    const blocks = isElement(node) ? this.blocks(node) : [this.paragraph(this.inline(node))].filter(isBlockValue);
    this.inItem = saved;
    if (!blocks.length) return marker.trimEnd();
    let body = blocks[0].text;
    for (let i = 1; i < blocks.length; i++) {
      const prev = blocks[i - 1];
      const next = blocks[i];
      const tight = next.kind === 'list' || (prev.kind === 'todo' && next.kind === 'todo');
      const sep = tight ? '\n' : prev.kind === 'para' && next.kind === 'para' ? '  \n' : '\n\n';
      body += sep + next.text;
    }
    return marker + indent(body, marker.length, false);
  }

  private table(el: Element): Block[] {
    if (this.tableDepth > 0) this.fallback = true;
    this.tableDepth++;
    const rows: string[][] = [];
    const collect = (parent: Element) => {
      for (const child of Array.from(parent.children)) {
        const name = tag(child);
        if (name === 'tr') rows.push(this.row(child));
        else if (TABLE_PARTS.has(name)) collect(child);
        else if (name !== 'colgroup' && name !== 'col') this.fallback = true;
      }
    };
    collect(el);
    this.tableDepth--;

    const width = Math.max(0, ...rows.map((r) => r.length));
    if (!width) return [];
    if (this.tableDepth > 0) {
      // A table inside a table cell: flatten it to its text.
      return [{ kind: 'para', text: rows.flat().filter(Boolean).join(' ') }];
    }
    const line = (cells: string[]) =>
      `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
    const text = [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
    return [{ kind: 'table', text }];
  }

  private row(tr: Element): string[] {
    const cells: string[] = [];
    for (const cell of Array.from(tr.children)) {
      const name = tag(cell);
      if (name !== 'td' && name !== 'th') {
        this.fallback = true;
        continue;
      }
      if (Number(cell.getAttribute('colspan')) > 1 || Number(cell.getAttribute('rowspan')) > 1) {
        this.fallback = true;
      }
      const blocks = this.blocks(cell);
      // A GFM cell holds lines of text only: a list, code, a quote or a table in it is kept as its text,
      // line by line, and the note is flagged so the original stays at hand.
      if (blocks.some((b) => !CELL_KINDS.has(b.kind)) || Array.from(cell.getElementsByTagName('*')).some(unfitInCell)) {
        this.fallback = true;
      }
      // Each line of the cell (a paragraph, a line break) is joined with `<br>`, exactly as the editor
      // writes several lines in a cell (MarkdownTable in components/markdown-extensions.ts).
      cells.push(blocks.flatMap(cellLines).join('<br>').replace(/\|/g, '\\|'));
    }
    return cells;
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers

/** Blocks a GFM table cell holds as they are: lines of text. */
const CELL_KINDS = new Set<BlockKind>(['para']);

/** Elements a GFM cell can't hold: their text is kept, flattened, and the note is flagged. */
function unfitInCell(el: Element): boolean {
  return ['ul', 'ol', 'pre', 'blockquote', 'table'].includes(tag(el)) || isCodeBlock(el);
}

/** The lines of a block, as they go into a table cell. */
function cellLines(b: Block): string[] {
  let lines = b.text.split('\n');
  if (b.kind === 'code') lines = lines.slice(1, -1); // the fences
  if (b.kind === 'quote') lines = lines.map((l) => l.replace(/^>\s?/, ''));
  return lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Evernote's code block: `<div style="-en-codeblock:true; ...">`, one child div (or `<br>`) per line. */
function isCodeBlock(el: Element): boolean {
  return tag(el) === 'div' && /-en-codeblock\s*:\s*true/i.test(el.getAttribute('style') ?? '');
}

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

function isBlockValue(b: Block | null): b is Block {
  return b !== null;
}

function tag(el: Element): string {
  return el.localName.toLowerCase();
}

function joinBlocks(blocks: Block[]): string {
  return blocks
    .map((b, i) => (i === 0 ? '' : blocks[i - 1].kind === 'todo' && b.kind === 'todo' ? '\n' : '\n\n') + b.text)
    .join('');
}

/** Moves edge whitespace outside the markers, so `<b> x </b>` gives ` **x** `. */
function wrap(inner: string, marker: string): string {
  const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return core ? `${lead}${marker}${core}${marker}${trail}` : inner;
}

/** Inline code, fenced with more backticks than the text contains in a row. */
function codeSpan(raw: string): string {
  const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw.replace(/\s+/g, ' '))!;
  if (!core) return lead;
  const fence = '`'.repeat(longestRun(core, '`') + 1);
  const pad = core.startsWith('`') || core.endsWith('`') ? ' ' : '';
  return `${lead}${fence}${pad}${core}${pad}${fence}${trail}`;
}

/** A fenced code block holding `text` verbatim. */
function fencedCode(text: string): string {
  const fence = '`'.repeat(Math.max(3, longestRun(text, '`') + 1));
  return text ? `${fence}\n${text}\n${fence}` : `${fence}\n${fence}`;
}

/** The verbatim text of a `<pre>`: `br` and line-level elements become newlines. */
function preText(pre: Element): string {
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) return node.nodeValue ?? '';
    if (!isElement(node)) return '';
    const name = tag(node);
    if (name === 'br') return '\n';
    const inner = Array.from(node.childNodes).map(walk).join('');
    return (name === 'div' || name === 'p' || name === 'li') && !inner.endsWith('\n') ? `${inner}\n` : inner;
  };
  return walk(pre)
    .replace(/^\r?\n/, '')
    .replace(/\s+$/, '');
}

function longestRun(text: string, ch: string): number {
  let best = 0;
  let cur = 0;
  for (const c of text) {
    cur = c === ch ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

/** Inline content on a single line (headings). */
function cleanInline(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(new RegExp(DONE, 'g'), '[x]')
    .replace(new RegExp(OPEN, 'g'), '[ ]');
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Escapes characters markdown would read as formatting. `_` inside a word is left alone. */
function escapeText(text: string): string {
  return text
    .replace(/[\\`*[\]<~]/g, '\\$&')
    .replace(/_/g, (m, i: number, s: string) =>
      WORD_CHAR.test(s[i - 1] ?? '') && WORD_CHAR.test(s[i + 1] ?? '') ? m : '\\_',
    );
}

/** Escapes a line start that markdown would read as a heading, quote, list or rule. */
function escapeLineStart(line: string): string {
  if (/^(#{1,6}(\s|$)|>|[-+](\s|$)|=+\s*$|-+\s*$)/.test(line)) return `\\${line}`;
  const ordered = /^(\d{1,9})([.)])(\s|$)/.exec(line);
  if (ordered) return `${ordered[1]}\\${line.slice(ordered[1].length)}`;
  return line;
}

/** Indents every non-empty line by `n` spaces (all of them, or all but the first). */
function indent(text: string, n: number, first: boolean): string {
  const pad = ' '.repeat(n);
  return text
    .split('\n')
    .map((l, i) => (l && (first || i > 0) ? pad + l : l))
    .join('\n');
}
