import { describe, expect, it } from 'vitest';
import type { ID } from '@hq/core/types';
import sample from './__fixtures__/sample.enex?raw';
import { parseEnex } from './enex';
import { enmlToMarkdown } from './enml';

const PNG_MD5 = 'b357a19c87624c7c4d131aeeb4ae677f';
const PDF_MD5 = 'd163124b385f9cbfc33988e452bf7b30';

type Assets = Map<string, { id: ID; name: string; mime: string }>;

const ASSETS: Assets = new Map([
  [PNG_MD5, { id: 'a1', name: 'dot.png', mime: 'image/png' }],
  [PDF_MD5, { id: 'a2', name: 'boarding_pass.pdf', mime: 'application/pdf' }],
]);

const enml = (body: string) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
  '<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">\n' +
  `<en-note>${body}</en-note>`;

const convert = (body: string, assets: Assets = ASSETS) => enmlToMarkdown(enml(body), assets);

describe('enmlToMarkdown: converted elements', () => {
  const cases: Array<[string, string, string]> = [
    ['h1', '<h1>Heading one</h1>', '# Heading one'],
    ['h2', '<h2>Heading two</h2>', '## Heading two'],
    ['h3', '<h3>Heading three</h3>', '### Heading three'],
    ['h4', '<h4>Heading four</h4>', '#### Heading four'],
    ['h5', '<h5>Heading five</h5>', '##### Heading five'],
    ['h6', '<h6>Heading six</h6>', '###### Heading six'],
    ['p', '<p>Plain paragraph.</p>', 'Plain paragraph.'],
    ['div blocks', '<div>One</div><div>Two</div>', 'One\n\nTwo'],
    ['nested div blocks', '<div><div>Outer one</div><div>Outer two</div></div>', 'Outer one\n\nOuter two'],
    ['br', '<div>First line<br/>Second line</div>', 'First line  \nSecond line'],
    ['empty <div><br/></div> lines', '<div>A</div><div><br/></div><div>B</div>', 'A\n\nB'],
    ['b', '<div>a <b>bold</b> word</div>', 'a **bold** word'],
    ['strong', '<div>a <strong>strong</strong> word</div>', 'a **strong** word'],
    ['i', '<div>an <i>italic</i> word</div>', 'an *italic* word'],
    ['em', '<div>an <em>emphasised</em> word</div>', 'an *emphasised* word'],
    ['u (plain text)', '<div>an <u>underlined</u> word</div>', 'an underlined word'],
    ['b with spaces inside', '<div>a<b> bold </b>word</div>', 'a **bold** word'],
    ['a', '<div>See <a href="https://example.com/docs">the docs</a>.</div>', 'See [the docs](https://example.com/docs).'],
    ['a without text', '<div><a href="https://example.com/"></a></div>', '[https://example.com/](https://example.com/)'],
    ['a without href', '<div><a>just text</a></div>', 'just text'],
    [
      'ul (nested)',
      '<ul><li>Apples</li><li>Pears<ul><li>Conference</li><li>Williams</li></ul></li></ul>',
      '- Apples\n- Pears\n  - Conference\n  - Williams',
    ],
    [
      'ul nested the Evernote way (list inside list)',
      '<ul><li>Apples</li><ul><li>Gala</li></ul><li>Pears</li></ul>',
      '- Apples\n  - Gala\n- Pears',
    ],
    [
      'ol (nested)',
      '<ol><li>First</li><li>Second<ol><li>Second A</li><li>Second B</li></ol></li><li>Third</li></ol>',
      '1. First\n2. Second\n   1. Second A\n   2. Second B\n3. Third',
    ],
    ['li wrapping a div', '<ul><li><div>Wrapped <b>item</b></div></li></ul>', '- Wrapped **item**'],
    ['en-todo (open)', '<div><en-todo checked="false"/>Call the plumber</div>', '- [ ] Call the plumber'],
    ['en-todo (no checked attribute)', '<div><en-todo/>Water the plants</div>', '- [ ] Water the plants'],
    ['en-todo (done)', '<div><en-todo checked="true"/>Pay the rent</div>', '- [x] Pay the rent'],
    [
      'en-todo run makes one tight list',
      '<div><en-todo checked="false"/>A</div><div><en-todo checked="true"/>B</div>',
      '- [ ] A\n- [x] B',
    ],
    [
      'simple table',
      '<table><tr><th>Item</th><th>Qty</th></tr><tr><td>Eggs</td><td>12</td></tr></table>',
      '| Item | Qty |\n| --- | --- |\n| Eggs | 12 |',
    ],
    [
      'simple table with thead, tbody, divs and a pipe',
      '<table><thead><tr><td><div>Key</div></td><td><div>Value</div></td></tr></thead>' +
        '<tbody><tr><td><div>a|b</div></td><td><div><b>yes</b></div></td></tr></tbody></table>',
      '| Key | Value |\n| --- | --- |\n| a\\|b | **yes** |',
    ],
    ['hr', '<div>Above</div><hr/><div>Below</div>', 'Above\n\n---\n\nBelow'],
    ['en-media (image)', `<div><en-media hash="${PNG_MD5}" type="image/png"/></div>`, '![dot.png](asset:a1)'],
    [
      'en-media (other file)',
      `<div><en-media hash="${PDF_MD5}" type="application/pdf"/></div>`,
      '[boarding_pass.pdf](asset:a2)',
    ],
    [
      'en-media inline with text',
      `<div>Scan: <en-media hash="${PNG_MD5}" type="image/png"/></div>`,
      'Scan: ![dot.png](asset:a1)',
    ],
    [
      'span and font styling dropped',
      '<div><span style="color:#ff0000;font-weight:bold">Red span</span> and ' +
        '<font color="blue" face="Courier">blue font</font> text.</div>',
      'Red span and blue font text.',
    ],
    ['style attributes dropped', '<div style="font-size:20px"><b style="color:red">Big</b></div>', '**Big**'],
    ['&nbsp; entity', '<div>a&nbsp;b</div>', 'a b'],
    [
      'markdown characters in text are escaped',
      '<div>*not bold* and [not a link] 2 &lt; 3 and snake_case stays</div>',
      '\\*not bold\\* and \\[not a link\\] 2 \\< 3 and snake_case stays',
    ],
    ['line-start heading marker escaped', '<div># not a heading</div>', '\\# not a heading'],
    ['line-start list marker escaped', '<div>1. not a list</div>', '1\\. not a list'],
    // Block structure inside inline wrappers keeps its structure (styling still dropped).
    [
      'table inside a span',
      '<span><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></span>',
      '| A | B |\n| --- | --- |\n| 1 | 2 |',
    ],
    ['list inside a font', '<font color="red"><ul><li>One</li><li>Two</li></ul></font>', '- One\n- Two'],
    ['heading inside a b', '<b><h2>Title</h2></b>', '## Title'],
    ['hr inside a span', '<span>Above</span><span><hr/></span><span>Below</span>', 'Above\n\n---\n\nBelow'],
    [
      'table inside a div inside a span, after text',
      '<span>Intro <div><table><tr><td>x</td></tr></table></div></span>',
      'Intro\n\n| x |\n| --- |',
    ],
    // Adjacent runs of the same style merge.
    ['adjacent b runs merge', '<div><b>foo</b><b>bar</b></div>', '**foobar**'],
    ['adjacent b and strong merge', '<div><b>foo</b><strong>bar</strong></div>', '**foobar**'],
    ['adjacent i and em merge', '<div><i>foo</i><em>bar</em></div>', '*foobar*'],
    ['runs split by a space stay apart', '<div><b>foo</b> <b>bar</b></div>', '**foo** **bar**'],
    // More conversions.
    ['s', '<div>a <s>gone</s> b</div>', 'a ~~gone~~ b'],
    ['strike', '<div>a <strike>gone</strike> b</div>', 'a ~~gone~~ b'],
    ['del', '<div>a <del>gone</del> b</div>', 'a ~~gone~~ b'],
    ['code', '<div>Run <code>npm test</code> now</div>', 'Run `npm test` now'],
    ['code keeps markdown characters verbatim', '<div><code>*x* _y_ [z]</code></div>', '`*x* _y_ [z]`'],
    ['code containing a backtick', '<div><code>a`b</code></div>', '``a`b``'],
    ['code starting with a backtick', '<div><code>`tick</code></div>', '`` `tick ``'],
    [
      'pre',
      '<pre>const a = 1;\n  if (a &lt; 2) {\n    go(*x*);\n  }</pre>',
      '```\nconst a = 1;\n  if (a < 2) {\n    go(*x*);\n  }\n```',
    ],
    ['pre with div lines and br', '<pre><div>line one</div><div>  line two<br/>line three</div></pre>', '```\nline one\n  line two\nline three\n```'],
    ['pre containing a fence', '<pre>x\n```\ny</pre>', '````\nx\n```\ny\n````'],
    [
      'blockquote',
      '<blockquote><div>Quoted <b>text</b></div><div>Second</div></blockquote>',
      '> Quoted **text**\n>\n> Second',
    ],
    [
      'nested blockquote',
      '<blockquote><div>Outer</div><blockquote><div>Inner</div></blockquote></blockquote>',
      '> Outer\n>\n> > Inner',
    ],
    ['sup and sub as plain text', '<div>E = mc<sup>2</sup> and H<sub>2</sub>O</div>', 'E = mc2 and H2O'],
    ['named HTML entities', '<div>Caf&eacute; &ccedil;a &hearts; &amp; more</div>', 'Café ça ♥ & more'],
  ];

  it.each(cases)('%s', (_name, body, expected) => {
    const out = convert(body);
    expect(out.markdown).toBe(expected);
    expect(out.fallback).toBe(false);
    expect(out.encrypted).toBe(0);
  });

  it('en-crypt becomes a quoted line and is counted', () => {
    const out = convert('<div>Before.</div><en-crypt hint="x" cipher="AES" length="128">AAAA</en-crypt><div>After.</div>');
    expect(out.markdown).toBe('Before.\n\n> Encrypted in Evernote; not imported\n\nAfter.');
    expect(out.encrypted).toBe(1);
    expect(out.fallback).toBe(false);
  });

  it('counts every en-crypt', () => {
    const out = convert('<en-crypt>AAAA</en-crypt><div><en-crypt>BBBB</en-crypt></div>');
    expect(out.markdown).toBe('> Encrypted in Evernote; not imported\n\n> Encrypted in Evernote; not imported');
    expect(out.encrypted).toBe(2);
  });
});

describe('enmlToMarkdown: table cells keep their lines', () => {
  it('two paragraphs in a cell are joined with <br>, as the editor writes them', () => {
    const out = convert('<table><tr><td><div>para one</div><div>para two</div></td></tr></table>');
    expect(out.markdown).toBe('| para one<br>para two |\n| --- |');
    expect(out.fallback).toBe(false);
  });

  it('a <br> in a cell is kept', () => {
    const out = convert('<table><tr><th>Where</th></tr><tr><td>12 Long St<br/>Cape Town</td></tr></table>');
    expect(out.markdown).toBe('| Where |\n| --- |\n| 12 Long St<br>Cape Town |');
    expect(out.fallback).toBe(false);
  });

  it('empty lines in a cell are dropped, and a | is still escaped', () => {
    const out = convert('<table><tr><td><div>a|b</div><div><br/></div><div>c</div></td></tr></table>');
    expect(out.markdown).toBe('| a\\|b<br>c |\n| --- |');
  });
});

describe('enmlToMarkdown: Evernote code blocks', () => {
  it('become a fenced code block, verbatim, one line per div or <br>', () => {
    const out = convert(
      '<div>Run this:</div>' +
        '<div style="box-sizing: border-box; padding: 8px; font-family: Monaco, Menlo, monospace; -en-codeblock: true;">' +
        '<div>npm ci</div><div>npm test -- *.test.ts</div><div><br/></div><div>&nbsp;&nbsp;echo [done]<br/>exit 0</div></div>' +
        '<div>Then deploy.</div>',
    );
    expect(out.markdown).toBe('Run this:\n\n```\nnpm ci\nnpm test -- *.test.ts\n\n  echo [done]\nexit 0\n```\n\nThen deploy.');
    expect(out.fallback).toBe(false);
  });

  it('a code block holding backticks gets a longer fence', () => {
    const out = convert('<div style="-en-codeblock:true"><div>```js</div><div>x</div></div>');
    expect(out.markdown).toBe('````\n```js\nx\n````');
  });
});

describe('enmlToMarkdown: fallback', () => {
  const cases: Array<[string, string, string]> = [
    [
      'table with colspan',
      '<table><tr><td colspan="2">Q1 budget</td></tr><tr><td>Rent</td><td>1200</td></tr></table>',
      '| Q1 budget |  |\n| --- | --- |\n| Rent | 1200 |',
    ],
    [
      'table with rowspan',
      '<table><tr><td rowspan="2">Rent</td><td>Jan</td></tr><tr><td>Feb</td></tr></table>',
      '| Rent | Jan |\n| --- | --- |\n| Feb |  |',
    ],
    [
      'nested table',
      '<table><tr><td>Outer</td><td><table><tr><td>Inner</td></tr></table></td></tr></table>',
      '| Outer | Inner |\n| --- | --- |',
    ],
    ['iframe', '<div>Video:</div><iframe src="https://example.com/v"></iframe>', 'Video:'],
    ['object', '<div>Flash:</div><object data="movie.swf"></object>', 'Flash:'],
    ['svg', '<div>Drawing:</div><svg><text>junk</text></svg>', 'Drawing:'],
    ['unrecognised element', '<div>The <abbr title="x">NASA</abbr> launch</div>', 'The NASA launch'],
    ['unrecognised block element', '<center><div>Centered</div></center>', 'Centered'],
    ['list flattened inside a heading', '<h2>Title <ul><li>x</li></ul></h2>', '## Title x'],
    ['table flattened inside a heading', '<h3>T <table><tr><td>c</td></tr></table></h3>', '### T c'],
    ['en-media with an unknown hash', '<div>Lost: <en-media hash="0000" type="image/png"/></div>', 'Lost:'],
  ];

  it.each(cases)('%s sets fallback and still gives its best markdown', (_name, body, expected) => {
    const out = convert(body);
    expect(out.fallback).toBe(true);
    expect(out.markdown).toBe(expected);
  });

  it('a list in a table cell keeps its text, line by line, and falls back', () => {
    const out = convert('<table><tr><td>Shopping</td><td><ul><li>Eggs</li><li>Milk</li></ul></td></tr></table>');
    expect(out.fallback).toBe(true);
    expect(out.markdown).toBe('| Shopping | - Eggs<br>- Milk |\n| --- | --- |');
  });

  it('code, a quote or a table in a cell falls back too', () => {
    for (const inner of ['<pre>x = 1</pre>', '<blockquote>Said</blockquote>', '<div style="-en-codeblock:true"><div>x</div></div>']) {
      expect(convert(`<table><tr><td>${inner}</td></tr></table>`).fallback).toBe(true);
    }
  });

  it('falls back to the HTML parser for ENML that is not well-formed XML', () => {
    const out = enmlToMarkdown('<en-note><div>Broken &bogus; <b>bold</div></en-note>', ASSETS);
    expect(out.fallback).toBe(true);
    expect(out.markdown).toContain('Broken');
  });
});

describe('enmlToMarkdown on sample.enex', () => {
  const notes = parseEnex(sample, 'Personal');
  const assets: Assets = new Map();
  notes.forEach((note, n) =>
    note.resources.forEach((r, i) =>
      assets.set(r.hash, { id: `n${n}r${i}`, name: r.fileName ?? 'untitled', mime: r.mime }),
    ),
  );
  const results = notes.map((note) => ({ title: note.title, ...enmlToMarkdown(note.enml, assets) }));
  const result = (title: string) => results.find((r) => r.title === title)!;

  it('converts the formatting tour exactly', () => {
    expect(result('Formatting tour').markdown).toBe(
      [
        '# Heading one',
        '## Heading two',
        '### Heading three',
        '#### Heading four',
        '##### Heading five',
        '###### Heading six',
        'A paragraph with **bold**, **strong**, *italic*, *emphasis* and underlined words.',
        'First line  \nSecond line',
        'See [the docs](https://example.com/docs) for more.',
        'Red span and blue font text.',
        '- [ ] Call the plumber\n- [x] Pay the rent',
        '| Item | Qty |\n| --- | --- |\n| Eggs | 12 |',
        '- Apples\n- Pears\n  - Conference\n  - Williams',
        '1. First\n2. Second\n   1. Second A',
        '---',
        'The end.',
      ].join('\n\n'),
    );
  });

  it('links the attachments by asset id', () => {
    expect(result('Receipts').markdown).toBe(
      'Hotel receipt and boarding pass:\n\n![dot.png](asset:n1r0)\n\n[boarding_pass.pdf](asset:n1r1)',
    );
  });

  it('replaces the encrypted block', () => {
    expect(result('Locked note').markdown).toBe(
      'Before the secret.\n\n> Encrypted in Evernote; not imported\n\nAfter the secret.',
    );
  });

  it('counts exactly one encrypted block across the export', () => {
    expect(results.map((r) => r.encrypted)).toEqual([0, 0, 1, 0, 0, 0, 0, 0]);
  });

  it('falls back only for the colspan note', () => {
    expect(results.filter((r) => r.fallback).map((r) => r.title)).toEqual(['Budget table']);
    expect(result('Budget table').markdown).toBe('| Q1 budget |  |\n| --- | --- |\n| Rent | 1200 |');
  });

  it('keeps "Café", "👍" and "שלום" byte-exact in the body', () => {
    const md = result('Café 👍 שלום').markdown;
    expect(md).toBe('Café au lait 👍 — שלום עולם');
    expect(Array.from(new TextEncoder().encode(md))).toEqual(
      Array.from(new TextEncoder().encode('Café au lait \u{1F44D} — שלום עולם')),
    );
  });
});
