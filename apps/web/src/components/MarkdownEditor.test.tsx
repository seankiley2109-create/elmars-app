import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';

const getAssetBlob = vi.fn(async (_id: string) => new Blob(['png'], { type: 'image/png' }) as Blob | undefined);
vi.mock('../lib/assets', () => ({ getAssetBlob: (id: string) => getAssetBlob(id) }));

import MarkdownEditor from './MarkdownEditor';
import { enmlToMarkdown } from '../lib/evernote/enml';
import { flushOpenEditors } from '../lib/editor-flush';
import { NodeSelection } from '@tiptap/pm/state';

beforeAll(() => {
  // jsdom has no object URLs
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:test/${++n}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => cleanup());

const noMentions = () => [];
const noFiles = async () => ({ assetId: 'x', name: 'x' });

function mount(value: string, over: Partial<Parameters<typeof MarkdownEditor>[0]> = {}) {
  const onChange = vi.fn();
  const view = render(
    <MarkdownEditor value={value} onChange={onChange} onPickMention={noMentions} onFile={noFiles} {...over} />,
  );
  const dom = view.container.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null;
  if (!dom?.editor) throw new Error('editor did not mount');
  return { ...view, onChange, editor: dom.editor };
}

const markdownOf = (editor: Editor): string =>
  (editor.storage.markdown as { getMarkdown: () => string }).getMarkdown();

/** Trailing whitespace on each line, and at the end, is not a difference. */
const norm = (md: string) => md.replace(/[ \t]+$/gm, '').trimEnd();

describe('MarkdownEditor round-trips the supported markdown', () => {
  const samples: [string, string][] = [
    ['heading', '# H'],
    ['bold and italic', '**b** _i_'],
    ['nested list', '- a\n  - b'],
    ['ordered list', '1. x'],
    ['checklist', '- [ ] t\n- [x] d'],
    ['link', '[l](https://x.y)'],
    ['inline image attachment', '![p](asset:a1)'],
    ['file attachment', '[quote.pdf](asset:a2)'],
    ['2×2 table', '| a | b |\n| --- | --- |\n| c | d |'],
    ['project mention', 'Ask [Kitchen renovation](elmar://project/p1) first'],
    ['note mention', 'See [Braai marinade](elmar://note/n-2).'],
    [
      'a whole note',
      '# Kitchen\n\nThree quotes so far, see [Quotes](elmar://note/n1).\n\n- [x] Measure the wall\n- [ ] Choose tiles\n\n![tiles](asset:a1)',
    ],
  ];

  for (const [name, md] of samples) {
    it(name, () => {
      const { editor, onChange } = mount(md);
      expect(norm(markdownOf(editor))).toBe(norm(md));
      // opening a note is not an edit
      expect(onChange).not.toHaveBeenCalled();
    });
  }

  it('a table cell keeps an image, a mention, a link alone, and an escaped |', () => {
    const md = [
      '| What | Where |',
      '| --- | --- |',
      '| ![p](asset:a1) | x |',
      '| [K](elmar://project/p1) | y |',
      '| [quote.pdf](asset:a2) | z |',
      '| c \\| d | e |',
      '|  | empty on the left |',
    ].join('\n');
    const { editor } = mount(md);
    expect(norm(markdownOf(editor))).toBe(norm(md));
    // and again: what was saved loads back to the same table (the "e" is not pushed out of its cell)
    const again = mount(markdownOf(editor)).editor;
    expect(norm(markdownOf(again))).toBe(norm(md));
  });

  it('a table from the Evernote importer comes back exactly as imported', () => {
    const enml =
      '<?xml version="1.0" encoding="UTF-8"?><en-note><table>' +
      '<tr><th>Item</th><th>Note</th></tr>' +
      '<tr><td>tiles | grout</td><td><en-media hash="h1" type="image/png"/></td></tr>' +
      '<tr><td>a &lt;b&gt; c</td><td><b>bold</b> and <i>it</i></td></tr>' +
      '</table></en-note>';
    const { markdown } = enmlToMarkdown(enml, new Map([['h1', { id: 'a1', name: 'dot.png', mime: 'image/png' }]]));
    expect(markdown).toContain('tiles \\| grout');
    const { editor } = mount(markdown);
    const out = markdownOf(editor);
    expect(out).toContain('tiles \\| grout');
    expect(out).toContain('![dot.png](asset:a1)');
    // and the saved form is stable: loading it gives it back unchanged
    expect(norm(markdownOf(mount(out).editor))).toBe(norm(out));
  });

  it('an imported cell with two lines keeps both when another cell is edited', () => {
    const enml =
      '<?xml version="1.0" encoding="UTF-8"?><en-note><table>' +
      '<tr><th>Where</th><th>When</th></tr>' +
      '<tr><td><div>12 Long St</div><div>Cape Town</div></td><td>Friday</td></tr>' +
      '</table></en-note>';
    const { markdown } = enmlToMarkdown(enml, new Map());
    expect(markdown).toBe('| Where | When |\n| --- | --- |\n| 12 Long St<br>Cape Town | Friday |');
    vi.useFakeTimers();
    let saved: string;
    try {
      const { editor, onChange, unmount } = mount(markdown);
      let pos = -1;
      editor.state.doc.descendants((n, p) => {
        if (n.isText && n.text === 'Friday') pos = p + n.nodeSize;
      });
      act(() => {
        editor.commands.setTextSelection(pos);
        editor.commands.insertContent(' at 6');
      });
      unmount();
      saved = onChange.mock.calls.at(-1)![0] as string;
    } finally {
      vi.useRealTimers();
    }
    expect(norm(saved)).toBe('| Where | When |\n| --- | --- |\n| 12 Long St<br>Cape Town | Friday at 6 |');
    const cells: string[] = [];
    mount(saved).editor.state.doc.descendants((n) => {
      if (n.type.name === 'tableCell') cells.push(n.textContent);
    });
    expect(cells).toEqual(['12 Long StCape Town', 'Friday at 6']);
  });

  it('a | inside code in a table cell stays escaped across two edits (importer output)', () => {
    const enml =
      '<?xml version="1.0" encoding="UTF-8"?><en-note><table>' +
      '<tr><th>Command</th><th>What</th></tr>' +
      '<tr><td><code>ls | wc</code></td><td>count files</td></tr>' +
      '</table></en-note>';
    const { markdown } = enmlToMarkdown(enml, new Map());
    expect(markdown).toContain('`ls \\| wc`');
    let md = markdown;
    for (let edit = 1; edit <= 2; edit++) {
      vi.useFakeTimers();
      try {
        const { editor, onChange, unmount } = mount(md);
        act(() => {
          editor.commands.focus('end');
          editor.commands.insertContent('!');
        });
        unmount();
        md = onChange.mock.calls.at(-1)![0] as string;
      } finally {
        vi.useRealTimers();
      }
      expect(md).toContain('| `ls \\| wc` |');
      expect(md).toContain('count files');
    }
    const { editor } = mount(md);
    const cells: string[] = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'tableCell') cells.push(n.textContent);
    });
    expect(cells[0]).toBe('ls | wc');
    expect(cells[1]).toMatch(/^count files/);
  });

  /** Load, edit once at the end, return what would be saved. */
  function editOnceTable(md: string): string {
    vi.useFakeTimers();
    try {
      const { editor, onChange, unmount } = mount(md);
      act(() => {
        editor.commands.focus('end');
        editor.commands.insertContent('!');
      });
      unmount();
      return onChange.mock.calls.at(-1)![0] as string;
    } finally {
      vi.useRealTimers();
    }
  }
  const cellTexts = (md: string): string[] => {
    const { editor } = mount(md);
    const out: string[] = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') out.push(n.textContent);
    });
    return out;
  };

  it('a backslash before | in a code span in a cell survives two edits exactly (importer output)', () => {
    const enml =
      '<?xml version="1.0" encoding="UTF-8"?><en-note><table>' +
      '<tr><th>Command</th><th>What</th></tr>' +
      "<tr><td><code>grep 'a\\|b' f</code></td><td>either</td></tr>" +
      '</table></en-note>';
    const { markdown } = enmlToMarkdown(enml, new Map());
    expect(markdown).toContain("`grep 'a\\\\|b' f`");
    expect(cellTexts(markdown)[2]).toBe("grep 'a\\|b' f");
    const once = editOnceTable(markdown);
    const twice = editOnceTable(once);
    for (const md of [once, twice]) {
      expect(md).toContain("| `grep 'a\\\\|b' f` |");
      expect(cellTexts(md)[2]).toBe("grep 'a\\|b' f");
    }
  });

  it('typed code and text with \\| in a cell read back exactly', () => {
    const { editor } = mount('| a | b |\n| --- | --- |\n| x | y |');
    let pos = -1;
    editor.state.doc.descendants((n, p) => {
      if (n.isText && n.text === 'x') pos = p + 1;
    });
    act(() => {
      editor.commands.insertContentAt(pos, [
        { type: 'text', text: ' ' },
        { type: 'text', text: 'x\\|y', marks: [{ type: 'code' }] },
        { type: 'text', text: ' p\\|q r|s' },
      ]);
    });
    const md = markdownOf(editor);
    expect(cellTexts(md)[2]).toBe('x x\\|y p\\|q r|s');
    expect(cellTexts(md)[3]).toBe('y');
    expect(cellTexts(editOnceTable(md))[2]).toBe('x x\\|y p\\|q r|s');
  });

  it('an HTML table never holds a blank line, so a code block in a cell can not split it', () => {
    const { editor } = mount('');
    act(() => {
      editor.commands.setContent(
        {
          type: 'doc',
          content: [
            {
              type: 'table',
              content: [
                { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Code' }] }] }] },
                { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'l1\n\nl3' }] }] }] },
              ],
            },
          ],
        },
        true,
      );
    });
    const md = markdownOf(editor);
    expect(md.startsWith('<table')).toBe(true);
    expect(md.trimEnd()).not.toMatch(/\n[ \t]*\n/);
    const codeOf = (src: string) => {
      const { editor: e } = mount(src);
      let code = '';
      e.state.doc.descendants((n) => {
        if (n.type.name === 'codeBlock') code = n.textContent;
      });
      return { code, first: e.state.doc.firstChild?.type.name };
    };
    expect(codeOf(md)).toEqual({ code: 'l1\n\nl3', first: 'table' });
    // an edit lands at the end, inside the code block: the table is written the same way, one line
    const once = editOnceTable(md);
    expect(once.trimEnd()).toBe(md.trimEnd().replace('l3</code>', 'l3!</code>'));
    expect(codeOf(once)).toEqual({ code: 'l1\n\nl3!', first: 'table' });
    const twice = editOnceTable(once);
    expect(twice.trimEnd()).not.toMatch(/\n[ \t]*\n/);
    expect(codeOf(twice)).toEqual({ code: 'l1\n\nl3!!', first: 'table' });
  });

  it('Enter and Shift+Enter in a cell keep the table a markdown table, both lines in the cell', () => {
    const { editor } = mount('| a | b |\n| --- | --- |\n| first | x |');
    let pos = -1;
    editor.state.doc.descendants((n, p) => {
      if (n.isText && n.text === 'first') pos = p + n.nodeSize;
    });
    act(() => {
      editor.commands.setTextSelection(pos);
      editor.commands.splitBlock(); // Enter
      editor.commands.insertContent('second');
      editor.commands.setHardBreak(); // Shift+Enter
      editor.commands.insertContent('third');
    });
    const md = norm(markdownOf(editor));
    expect(md).toBe('| a | b |\n| --- | --- |\n| first<br>second<br>third | x |');
    const again = mount(md).editor;
    expect(again.state.doc.firstChild?.type.name).toBe('table'); // editable, not a raw block
    const cells: string[] = [];
    again.state.doc.descendants((n) => {
      if (n.type.name === 'tableCell') cells.push(n.textContent);
    });
    expect(cells[0]).toBe('firstsecondthird');
    expect(norm(markdownOf(again))).toBe(md);
  });

  it('a cell with raw HTML and a mention survives', () => {
    const md = '| a | b |\n| --- | --- |\n| <u>under</u> [K](elmar://project/p1) | y |';
    const { editor } = mount(md);
    expect(norm(markdownOf(editor))).toBe(md);
  });

  it('a table markdown cannot hold is written as HTML with raw HTML as its own source, and reads back as a table', () => {
    const { editor } = mount('| a | b |\n| --- | --- |\n| <u>under</u> | y |');
    let pos = -1;
    editor.state.doc.descendants((n, p) => {
      if (n.isText && n.text === 'y') pos = p + 1;
    });
    act(() => {
      editor.commands.setTextSelection(pos);
      editor.commands.toggleBulletList(); // a list in a cell: GFM can't hold it
    });
    const html = markdownOf(editor);
    expect(html.startsWith('<table')).toBe(true);
    expect(html).toContain('<u>under</u>');
    expect(html).not.toContain('data-raw-inline');
    const again = mount(html).editor;
    expect(again.state.doc.firstChild?.type.name).toBe('table');
    expect(markdownOf(again)).toContain('<u>under</u>');
    expect(again.state.doc.textContent).toContain('under');
  });

  it('a mention is one atomic link in the editor, not loose text', () => {
    const { container } = mount('[Kitchen renovation](elmar://project/p1)');
    const a = container.querySelector('a[data-type="mention"]');
    expect(a?.getAttribute('href')).toBe('elmar://project/p1');
    expect(a?.textContent).toBe('Kitchen renovation');
  });
});

describe('MarkdownEditor', () => {
  it('has the toolbar, every button labelled', () => {
    mount('');
    for (const label of ['Bold', 'Italic', 'Heading', 'Bulleted list', 'Checklist', 'Add a photo or file', 'Link to a project or note']) {
      expect(screen.getByRole('button', { name: label })).toBeDefined();
    }
  });

  it('shows an asset: image through an object URL but keeps asset: in the markdown', async () => {
    const { container, editor } = mount('![p](asset:a1)');
    await waitFor(() => expect(container.querySelector('img[alt="p"]')?.getAttribute('src')).toMatch(/^blob:/));
    expect(getAssetBlob).toHaveBeenCalledWith('a1');
    expect(markdownOf(editor)).toContain('![p](asset:a1)');
  });

  it('every edit reaches onChange, and a pending edit is flushed on unmount', () => {
    vi.useFakeTimers();
    try {
      const { editor, onChange, unmount } = mount('Hello');
      act(() => {
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);
        editor.commands.insertContent(' there');
      });
      act(() => vi.advanceTimersByTime(300));
      expect(onChange).toHaveBeenLastCalledWith('Hello there');

      act(() => {
        editor.commands.insertContent('!');
      });
      expect(onChange).toHaveBeenCalledTimes(1); // still debouncing
      unmount();
      expect(onChange).toHaveBeenLastCalledWith('Hello there!');
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes on blur', () => {
    vi.useFakeTimers();
    try {
      const { editor, onChange } = mount('A');
      act(() => {
        editor.commands.insertContent('B');
      });
      act(() => {
        editor.view.dom.dispatchEvent(new FocusEvent('blur'));
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0]).toMatch(/AB|BA/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a pasted image goes through onFile and lands as an asset: image', async () => {
    const onFile = vi.fn(async (f: File) => ({ assetId: 'new1', name: f.name }));
    const { editor } = mount('', { onFile });
    const file = new File(['png'], 'tiles.png', { type: 'image/png' });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { files: [file], items: [], types: ['Files'], getData: () => '' },
    });
    act(() => {
      editor.view.dom.dispatchEvent(event);
    });
    await waitFor(() => expect(markdownOf(editor)).toContain('![tiles.png](asset:new1)'));
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('a dropped non-image file lands as an asset: link', async () => {
    const onFile = vi.fn(async (f: File) => ({ assetId: 'doc1', name: f.name }));
    const { editor } = mount('', { onFile });
    const file = new File(['%PDF'], 'quote.pdf', { type: 'application/pdf' });
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [file], types: ['Files'], getData: () => '' } });
    act(() => {
      editor.view.dom.dispatchEvent(event);
    });
    await waitFor(() => expect(markdownOf(editor)).toContain('[quote.pdf](asset:doc1)'));
  });

  it('typing @ lists matching projects and notes, and picking one inserts a mention', async () => {
    const onPickMention = vi.fn((q: string) =>
      [
        { type: 'project' as const, id: 'p1', label: 'Kitchen renovation' },
        { type: 'note' as const, id: 'n1', label: 'Knysna packing list' },
      ].filter((t) => t.label.toLowerCase().includes(q.toLowerCase())),
    );
    const { editor } = mount('', { onPickMention });
    act(() => {
      editor.commands.focus();
      editor.commands.insertContent('@kit');
    });
    const option = await screen.findByRole('option', { name: /Kitchen renovation/ });
    expect(screen.queryByRole('option', { name: /Knysna/ })).toBeNull();
    act(() => {
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(markdownOf(editor)).toContain('[Kitchen renovation](elmar://project/p1)');
  });

  it('the mention list is tied to the body for assistive tech', async () => {
    const onPickMention = () => [
      { type: 'project' as const, id: 'p1', label: 'Kitchen renovation' },
      { type: 'note' as const, id: 'n1', label: 'Knysna packing list' },
    ];
    const { editor } = mount('', { onPickMention });
    act(() => {
      editor.commands.focus();
      editor.commands.insertContent('@k');
    });
    const list = await screen.findByRole('listbox');
    const body = editor.view.dom;
    expect(body.getAttribute('aria-controls')).toBe(list.id);
    const active = body.getAttribute('aria-activedescendant');
    expect(active && document.getElementById(active)?.textContent).toMatch(/Kitchen renovation/);
    act(() => {
      body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    });
    const next = body.getAttribute('aria-activedescendant');
    expect(next && document.getElementById(next)?.textContent).toMatch(/Knysna/);
  });

  it('Enter on a selected mention follows it, as a click does', () => {
    const onOpenMention = vi.fn();
    const { editor } = mount('Ask [Kitchen renovation](elmar://project/p1) first', { onOpenMention });
    let pos = -1;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === 'mention') pos = p;
    });
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(onOpenMention).toHaveBeenCalledWith({ type: 'project', id: 'p1' });
    expect(markdownOf(editor)).toBe('Ask [Kitchen renovation](elmar://project/p1) first'); // no line split
  });
});

describe('MarkdownEditor never garbles text on the first edit', () => {
  /** Load, make one small edit at the end, and read what would be saved. */
  function editOnce(md: string): string {
    vi.useFakeTimers();
    try {
      const { editor, onChange, unmount } = mount(md);
      act(() => {
        editor.commands.focus('end');
        editor.commands.insertContent('!');
      });
      unmount();
      return onChange.mock.calls.at(-1)![0] as string;
    } finally {
      vi.useRealTimers();
    }
  }

  it('angle brackets and ampersands stay text, never entities', () => {
    const out = editOnce('1 < 2 > 0 and \\<div\\> & \\&amp; too');
    expect(out).not.toMatch(/&lt;|&gt;/);
    expect(out).toBe('1 < 2 > 0 and \\<div> & \\&amp; too!');
    // and it reads back as the same words
    const { editor } = mount(out);
    expect(editor.state.doc.textContent).toBe('1 < 2 > 0 and <div> & &amp; too!');
  });

  it('keeps an HTML comment, block and inline, verbatim', () => {
    expect(editOnce('<!-- keep me -->\n\nText')).toBe('<!-- keep me -->\n\nText!');
    expect(editOnce('Before <!-- aside --> after')).toBe('Before <!-- aside --> after!');
  });

  it('keeps HTML it has no node for: details, u, span', () => {
    const details = '<details><summary>More</summary>\n\nHidden part\n\n</details>\n\nEnd';
    expect(editOnce(details)).toBe(`${details}!`);
    expect(editOnce('A <u>under</u> and <span style="color:red">red</span> word')).toBe(
      'A <u>under</u> and <span style="color:red">red</span> word!',
    );
  });

  it('keeps escaped brackets in an image alt', () => {
    expect(editOnce('![a \\[b\\]](asset:a1) x')).toBe('![a \\[b\\]](asset:a1) x!');
  });

  it('keeps links to other apps: an Evernote note link and a Mail message link', () => {
    expect(editOnce('See [Trip plan](evernote:///view/123/s1/abc/abc/) now')).toBe('See [Trip plan](evernote:///view/123/s1/abc/abc/) now!');
    expect(editOnce('The [mail](message://%3Cid@x%3E) here')).toBe('The [mail](message://%3Cid@x%3E) here!');
  });

  it('still never makes a script link', () => {
    const { container, editor } = mount('');
    act(() => {
      editor.commands.setContent('<p><a href="javascript:alert(1)">x</a> <a href=" VBScript:y">y</a> <a href="data:text/html,hi">z</a></p>');
    });
    expect(container.querySelectorAll('a')).toHaveLength(0);
    const typed = mount('[x](javascript:alert(1)) [y](data:text/html,hi)');
    expect(typed.container.querySelectorAll('a')).toHaveLength(0);
  });

  it('keeps raw HTML inside a table cell', () => {
    const md = '| a | b |\n| --- | --- |\n| <u>x</u> | y |';
    expect(norm(editOnce(md))).toBe('| a | b |\n| --- | --- |\n| <u>x</u> | y! |');
  });
});

describe('MarkdownEditor and changes from outside', () => {
  it('shows an outside change even while focused, and the next keystroke builds on it', () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const props = { onChange, onPickMention: noMentions, onFile: noFiles };
      const { container, rerender } = render(<MarkdownEditor value="Old text" {...props} />);
      const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
      act(() => {
        editor.view.dom.focus();
      });
      expect(editor.isFocused).toBe(true); // the caret is in the body, as when the folder reloads
      rerender(<MarkdownEditor value="New text from the folder" {...props} />);
      expect(markdownOf(editor)).toBe('New text from the folder');
      act(() => {
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);
        editor.commands.insertContent('!');
      });
      act(() => vi.advanceTimersByTime(300));
      expect(onChange).toHaveBeenLastCalledWith('New text from the folder!');
      expect(onChange.mock.calls.every(([md]) => !String(md).includes('Old text'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the cursor where it was (clamped) when an outside change lands', () => {
    const props = { onChange: vi.fn(), onPickMention: noMentions, onFile: noFiles };
    const { container, rerender } = render(<MarkdownEditor value="Hello world" {...props} />);
    const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
    act(() => {
      editor.commands.setTextSelection(4);
    });
    rerender(<MarkdownEditor value="Hello there world" {...props} />);
    expect(editor.state.selection.from).toBe(4);
    rerender(<MarkdownEditor value="Hi" {...props} />);
    expect(editor.state.selection.from).toBeLessThanOrEqual(editor.state.doc.content.size);
  });

  it('with an edit pending, picks no winner silently: shows the new version and offers his', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const props = { onChange, onPickMention: noMentions, onFile: noFiles };
      const { container, rerender } = render(<MarkdownEditor value="Shared start" {...props} />);
      const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
      act(() => {
        editor.commands.focus('end');
        editor.commands.insertContent(' and my words');
      });
      rerender(<MarkdownEditor value="Shared start, changed on the other Mac" {...props} />);
      act(() => vi.advanceTimersByTime(1000));
      // the new version is on screen, nothing was written over it, and his text is offered
      expect(markdownOf(editor)).toBe('Shared start, changed on the other Mac');
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByRole('alert').textContent).toMatch(/changed outside the app/);

      act(() => {
        screen.getByRole('button', { name: 'Keep mine' }).click();
      });
      expect(onChange).toHaveBeenLastCalledWith('Shared start and my words');
      expect(markdownOf(editor)).toBe('Shared start and my words');
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('"Use the new version" keeps the outside version and writes nothing', () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const props = { onChange, onPickMention: noMentions, onFile: noFiles };
      const { container, rerender } = render(<MarkdownEditor value="A" {...props} />);
      const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
      act(() => {
        editor.commands.insertContent('mine');
      });
      rerender(<MarkdownEditor value="Theirs" {...props} />);
      act(() => {
        screen.getByRole('button', { name: 'Use the new version' }).click();
      });
      act(() => vi.advanceTimersByTime(1000));
      expect(onChange).not.toHaveBeenCalled();
      expect(markdownOf(editor)).toBe('Theirs');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MarkdownEditor never drops an unanswered conflict', () => {
  /** Mount, type, and have the note change outside: the banner is up with "Shared start and my words" set aside. */
  function conflicted() {
    const onChange = vi.fn();
    const onUnresolvedConflict = vi.fn();
    const props = { onChange, onUnresolvedConflict, onPickMention: noMentions, onFile: noFiles };
    const view = render(<MarkdownEditor value="Shared start" {...props} />);
    const editor = (view.container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
    act(() => {
      editor.commands.focus('end');
      editor.commands.insertContent(' and my words');
    });
    view.rerender(<MarkdownEditor value="Changed on the other Mac" {...props} />);
    expect(screen.getByRole('alert').textContent).toMatch(/changed outside the app/);
    return { ...view, editor, onChange, onUnresolvedConflict, props };
  }

  it('going away with the banner open hands over the exact set-aside text', () => {
    const { unmount, onUnresolvedConflict } = conflicted();
    unmount();
    expect(onUnresolvedConflict).toHaveBeenCalledTimes(1);
    expect(onUnresolvedConflict).toHaveBeenCalledWith('Shared start and my words');
  });

  it('the quit/close flush hands it over too, once, and clears the banner', () => {
    const { unmount, onUnresolvedConflict } = conflicted();
    act(() => flushOpenEditors());
    expect(onUnresolvedConflict).toHaveBeenCalledWith('Shared start and my words');
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => flushOpenEditors());
    unmount();
    expect(onUnresolvedConflict).toHaveBeenCalledTimes(1);
  });

  it('switching apps (window hidden) saves typing but keeps the banner open and hands nothing over', () => {
    const { editor, onChange, onUnresolvedConflict, unmount } = conflicted();
    act(() => {
      editor.commands.focus('end');
      editor.commands.insertContent(' and more'); // typed on top of the version shown
    });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(onChange).toHaveBeenLastCalledWith('Changed on the other Mac and more'); // the pending edit is saved
    expect(onUnresolvedConflict).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/changed outside the app/);
    act(() => flushOpenEditors('hide'));
    expect(onUnresolvedConflict).not.toHaveBeenCalled();
    // the page really going away settles it
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(onUnresolvedConflict).toHaveBeenCalledTimes(1);
    expect(onUnresolvedConflict).toHaveBeenCalledWith('Shared start and my words');
    unmount();
    expect(onUnresolvedConflict).toHaveBeenCalledTimes(1);
  });

  it('type, outside v1, type, outside v2: the first set-aside text stays offered, the second is kept as a copy', () => {
    const { editor, rerender, props, onUnresolvedConflict, onChange } = conflicted();
    act(() => {
      editor.commands.focus('end');
      editor.commands.insertContent(' plus more');
    });
    rerender(<MarkdownEditor value="Changed yet again" {...props} />);
    // what he typed on top of v1 would vanish under v2: it is kept as a conflicted copy
    expect(onUnresolvedConflict).toHaveBeenCalledTimes(1);
    expect(onUnresolvedConflict).toHaveBeenCalledWith('Changed on the other Mac plus more');
    expect(markdownOf(editor)).toBe('Changed yet again');
    // and the banner still offers his first text
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    act(() => screen.getByRole('button', { name: 'Keep mine' }).click());
    expect(onChange).toHaveBeenLastCalledWith('Shared start and my words');
  });

  it('an outside version is not an undo step: Ctrl+Z cannot bring back his text and save it over', () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const props = { onChange, onPickMention: noMentions, onFile: noFiles };
      const { container, rerender } = render(<MarkdownEditor value="Mine" {...props} />);
      const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
      act(() => {
        editor.commands.focus('end');
        editor.commands.insertContent(' typed');
      });
      act(() => vi.advanceTimersByTime(300)); // saved
      onChange.mockClear();
      rerender(<MarkdownEditor value="The other version" {...props} />);
      act(() => {
        editor.commands.undo();
        editor.commands.undo();
      });
      act(() => vi.advanceTimersByTime(1000));
      expect(markdownOf(editor)).toBe('The other version');
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('after "Keep mine", Ctrl+Z does not bring the other version back either', () => {
    const { editor, onChange } = conflicted();
    act(() => screen.getByRole('button', { name: 'Keep mine' }).click());
    onChange.mockClear();
    act(() => {
      editor.commands.undo();
    });
    expect(markdownOf(editor)).toBe('Shared start and my words');
  });

  it('an explicit choice is his: neither "Keep mine" nor "Use the new version" leaves anything to keep', () => {
    for (const choice of ['Keep mine', 'Use the new version']) {
      const { unmount, onUnresolvedConflict } = conflicted();
      act(() => screen.getByRole('button', { name: choice }).click());
      unmount();
      act(() => flushOpenEditors());
      expect(onUnresolvedConflict).not.toHaveBeenCalled();
    }
  });
});

describe('MarkdownEditor saves on tab close and app quit', () => {
  it('flushOpenEditors hands the pending text over, and stops once the editor is gone', () => {
    vi.useFakeTimers();
    try {
      const { editor, onChange, unmount } = mount('Draft');
      act(() => {
        editor.commands.focus('end');
        editor.commands.insertContent(' saved');
      });
      flushOpenEditors();
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenLastCalledWith('Draft saved');
      unmount();
      flushOpenEditors();
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pagehide flushes an open editor', () => {
    vi.useFakeTimers();
    try {
      const { editor, onChange } = mount('Draft');
      act(() => {
        editor.commands.insertContent('X');
      });
      window.dispatchEvent(new Event('pagehide'));
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MarkdownEditor attachments that fail', () => {
  const paste = (editor: Editor, files: File[]) => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files, items: [], types: ['Files'], getData: () => '' } });
    act(() => {
      editor.view.dom.dispatchEvent(event);
    });
  };

  it('says which file failed, adds nothing for it, and goes on with the rest', async () => {
    const onFile = vi.fn(async (f: File) => {
      if (f.name === 'photo.png') throw new Error('disk full');
      return { assetId: 'ok1', name: f.name };
    });
    const { editor } = mount('', { onFile });
    paste(editor, [new File(['x'], 'photo.png', { type: 'image/png' }), new File(['y'], 'quote.pdf', { type: 'application/pdf' })]);
    await waitFor(() => expect(markdownOf(editor)).toContain('[quote.pdf](asset:ok1)'));
    expect(markdownOf(editor)).not.toContain('photo.png');
    expect(screen.getByRole('alert').textContent).toBe('Couldn\'t attach "photo.png". Nothing was added.');
  });

  it('refuses a file over 50 MB with a clear message, without trying to store it', async () => {
    const onFile = vi.fn(async (f: File) => ({ assetId: 'z', name: f.name }));
    const { editor } = mount('', { onFile });
    const big = new File(['x'], 'holiday.mov', { type: 'video/quicktime' });
    Object.defineProperty(big, 'size', { value: 60 * 1024 * 1024 });
    paste(editor, [big]);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/"holiday\.mov" is over 50 MB/));
    expect(onFile).not.toHaveBeenCalled();
    expect(markdownOf(editor)).toBe('');
  });

  it('a drop whose note changed during the write goes in at the cursor, not a stale position', async () => {
    let release!: () => void;
    const onFile = vi.fn(
      (f: File) => new Promise<{ assetId: string; name: string }>((r) => (release = () => r({ assetId: 'd1', name: f.name }))),
    );
    const { editor } = mount('First line', { onFile });
    // dropped at the end of "First line" (jsdom has no layout to measure, so the hit is given)
    editor.view.posAtCoords = () => ({ pos: 11, inside: -1 });
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { files: [new File(['%PDF'], 'quote.pdf', { type: 'application/pdf' })], types: ['Files'], getData: () => '' },
    });
    act(() => {
      editor.view.dom.dispatchEvent(event);
    });
    // meanwhile the text changes and the cursor moves to the start; position 11 now means nothing
    act(() => {
      editor.commands.setContent('Another longer line here', true);
      editor.commands.setTextSelection(1);
    });
    await act(async () => {
      release();
    });
    await waitFor(() => expect(markdownOf(editor)).toContain('asset:d1'));
    expect(markdownOf(editor)).toBe('[quote.pdf](asset:d1) Another longer line here');
  });

  it('if the editor goes away mid-paste, the remaining files are still stored', async () => {
    const releases: (() => void)[] = [];
    const onFile = vi.fn(
      (f: File) => new Promise<{ assetId: string; name: string }>((r) => releases.push(() => r({ assetId: f.name, name: f.name }))),
    );
    const { editor, unmount } = mount('', { onFile });
    paste(editor, [
      new File(['1'], 'one.png', { type: 'image/png' }),
      new File(['2'], 'two.pdf', { type: 'application/pdf' }),
      new File(['3'], 'three.png', { type: 'image/png' }),
    ]);
    expect(onFile).toHaveBeenCalledTimes(1);
    unmount(); // he switched notes while "one.png" was being written
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20)); // the editor itself is torn down
    });
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        releases[i]?.();
      });
    }
    expect(onFile.mock.calls.map(([f]) => f.name)).toEqual(['one.png', 'two.pdf', 'three.png']);
  });

  it('a file link in the body opens the file', () => {
    const onOpenAsset = vi.fn();
    const { container, editor } = mount('See [quote.pdf](asset:a2)', { onOpenAsset });
    const a = container.querySelector('a[href="asset:a2"]') as HTMLElement;
    // jsdom has no layout for ProseMirror's own click detection, so the click prop is called as it would be
    const handled = editor.view.someProp('handleClick', (f) => f(editor.view, 6, { target: a } as unknown as MouseEvent));
    expect(handled).toBe(true);
    expect(onOpenAsset).toHaveBeenCalledWith('a2');
  });
});

describe('MarkdownEditor opens web and mail links on ⌘-click', () => {
  /** Click a link as ProseMirror would (jsdom has no layout for its own click detection). */
  function click(editor: Editor, a: HTMLElement, mods: { metaKey?: boolean; ctrlKey?: boolean } = {}) {
    const event = { target: a, metaKey: false, ctrlKey: false, ...mods } as unknown as MouseEvent;
    return editor.view.someProp('handleClick', (f) => f(editor.view, 2, event));
  }
  const onMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const openMods = () => (onMac() ? { metaKey: true } : { ctrlKey: true });

  it('⌘-click (Ctrl-click off a Mac) opens an http, https or mailto link', async () => {
    const openUrl = vi.fn(async () => {});
    const { container, editor } = mount('[a](https://example.com/x) [b](http://x.y) [c](mailto:e@x.y)', { openUrl });
    for (const href of ['https://example.com/x', 'http://x.y', 'mailto:e@x.y']) {
      const a = container.querySelector(`a[href="${href}"]`) as HTMLElement;
      expect(click(editor, a, openMods())).toBe(true);
    }
    await waitFor(() => expect(openUrl).toHaveBeenCalledTimes(3));
    expect(openUrl.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['https://example.com/x', 'http://x.y', 'mailto:e@x.y']);
  });

  it('a plain click only places the cursor', () => {
    const openUrl = vi.fn(async () => {});
    const { container, editor } = mount('[a](https://example.com/x)', { openUrl });
    const a = container.querySelector('a[href="https://example.com/x"]') as HTMLElement;
    expect(click(editor, a)).toBeFalsy();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('never opens any other scheme', () => {
    const openUrl = vi.fn(async () => {});
    const { container, editor } = mount('[Trip plan](evernote:///view/123/s1/abc/abc/) [m](message://%3Cid@x%3E)', { openUrl });
    for (const a of container.querySelectorAll('a')) click(editor, a as HTMLElement, openMods());
    expect(openUrl).not.toHaveBeenCalled();
  });
});
