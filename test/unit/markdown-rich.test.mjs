/**
 * WP-100 · what a Claude Code reply contains, rendered — and what must never
 * come out of rendering one.
 *
 * Each case is a named piece of `test/fixtures/rich-transcript.mjs`, the
 * transcript the panel was audited with. The first half says each construct
 * renders as what it is. The second half is the security posture, which moved
 * in this package and so is written down as tests rather than as intent:
 * until WP-100 no link was ever an anchor; now an `http(s)` link is, and
 * nothing else is.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyHref,
  fileRefOf,
  needsSession,
  parseInline,
  parseMarkdown,
  renderMarkdown,
} from '../../public/markdown.js';
import { CASES, REPLY } from '../fixtures/rich-transcript.mjs';
import { all, byClass, byTag, doc } from '../helpers/dom-stub.mjs';

const render = (text) => renderMarkdown(text, doc);

// ------------------------------------------------------------- constructs

test('headings keep their level, four deep', () => {
  const root = render(CASES.headings);
  assert.deepEqual(
    byClass(root, 'md-h').map((h) => [h.className, h.textContent]),
    [
      ['md-h md-h1', 'What I found'],
      ['md-h md-h2', 'The parser'],
      ['md-h md-h3', 'Inline rules'],
      ['md-h md-h4', 'A fourth level'],
    ],
  );
});

test('nested lists: three levels, an ordered list holding bullets, and a paragraph inside an item', () => {
  const blocks = parseMarkdown(CASES.nestedLists);
  const ordered = blocks.find((b) => b.type === 'list' && b.ordered);
  assert.equal(ordered.items.length, 3);
  const inner = ordered.items[0].find((b) => b.type === 'list');
  assert.equal(inner.ordered, false);
  assert.equal(inner.items.length, 3);
  assert.equal(inner.items[1].find((b) => b.type === 'list').items.length, 1, 'the third level');
  assert.equal(ordered.items[1][1].type, 'paragraph', 'a paragraph that belongs to item two');
  const root = render(CASES.nestedLists);
  assert.equal(byTag(root, 'ol').length, 1);
  assert.equal(byTag(root, 'ul').length, 3);
});

test('a table is a table: head, alignment, cells with inline code, and an escaped pipe', () => {
  const [table] = parseMarkdown(CASES.table);
  assert.equal(table.type, 'table');
  assert.deepEqual(table.align, ['left', 'right', 'center']);
  assert.equal(table.head.length, 3);
  assert.equal(table.rows.length, 3);

  const root = render(CASES.table);
  assert.equal(byTag(root, 'table').length, 1);
  assert.deepEqual(
    byTag(root, 'th').map((th) => [th.textContent, th.className]),
    [
      ['File', 'md-al-left'],
      ['Lines', 'md-al-right'],
      ['Status', 'md-al-center'],
    ],
  );
  const cells = byTag(root, 'td').map((td) => td.textContent);
  assert.deepEqual(cells.slice(0, 3), ['public/markdown.js', '341', 'changed']);
  assert.equal(cells[6], 'a | piped cell', 'an escaped pipe is part of the cell');
  assert.equal(byTag(root, 'strong').length, 1, 'inline markdown works inside a cell');
  // It scrolls in its own box rather than widening the card.
  assert.equal(byClass(root, 'md-table-wrap').length, 1);
});

test('a line with a pipe and no rule under it is a sentence, and a ragged row is still a row', () => {
  assert.equal(parseMarkdown('a | b\nc | d')[0].type, 'paragraph');
  const [t] = parseMarkdown('| a | b |\n|---|---|\n| only one |\n| x | y | z |');
  assert.equal(t.rows[0].length, 2, 'a short row is padded');
  assert.equal(t.rows[1].length, 2, 'a long row is cut to the head');
  // A rule with a different number of columns is not this table's rule.
  assert.equal(parseMarkdown('| a | b |\n|---|\n| x |')[0].type, 'paragraph');
});

test('a code block carries its language, a copy control, and its text verbatim', () => {
  const root = render(CASES.codeFence);
  const blocks = byClass(root, 'md-codeblock');
  assert.equal(blocks.length, 3);
  assert.deepEqual(
    byClass(root, 'md-code-lang').map((l) => l.textContent),
    ['js', 'diff', 'text'],
  );
  const copies = byClass(root, 'md-copy');
  assert.equal(copies.length, 3);
  assert.ok(copies.every((b) => b.tagName === 'BUTTON' && b.attributes.type === 'button'));
  const pres = byTag(root, 'pre');
  assert.match(pres[0].textContent, /a very long line that has to scroll sideways/);
  assert.equal(pres[1].textContent, '- const a = 1;\n+ const a = 2;');
  // An info string is the writer's; only its first word is shown, and bounded.
  const odd = render('```js title="<img src=x onerror=alert(1)>" {1,3}\nx\n```');
  assert.equal(byClass(odd, 'md-code-lang')[0].textContent, 'js');
  assert.equal(byTag(odd, 'img').length, 0);
});

test('inline: code, bold, italic, strikethrough, and a snake_case_name left alone', () => {
  const root = render(CASES.inline);
  assert.equal(byTag(root, 'del')[0].textContent, 'not');
  assert.equal(byTag(root, 'strong')[0].textContent, 'care');
  assert.equal(byTag(root, 'em')[0].textContent, 'never');
  assert.deepEqual(
    byClass(root, 'md-code').map((c) => c.textContent),
    ['renderMarkdown()', 'innerHTML'],
  );
  assert.match(root.textContent, /A snake_case_name stays literal\./);
  // `~~` that is not a pair stays what was typed.
  assert.deepEqual(parseInline('a ~~ b'), [{ type: 'text', text: 'a ~~ b' }]);
});

test('task lists draw a box, done or not, and it is not an input', () => {
  const root = render(CASES.tasks);
  const boxes = byClass(root, 'md-check');
  assert.deepEqual(
    boxes.map((b) => [b.textContent, b.attributes['aria-label']]),
    [
      ['☑', 'done'],
      ['☑', 'done'],
      ['☐', 'not done'],
      ['☐', 'not done'],
    ],
  );
  assert.equal(byTag(root, 'input').length, 0);
  assert.equal(byClass(root, 'md-task--done').length, 2);
  assert.match(byTag(root, 'li')[3].textContent, /voice input \(later\)/);
  // An ordinary list has no boxes and no task class.
  assert.equal(byClass(render('- a\n- b'), 'md-check').length, 0);
});

test('block quotes hold their own blocks, a list included', () => {
  const root = render(CASES.quote);
  const [q] = byTag(root, 'blockquote');
  assert.match(q.textContent, /The owner said:/);
  assert.equal(byTag(q, 'li').length, 2);
});

test('file references open a file: `path:line` in prose and in backticks, a range, a Windows path', () => {
  const root = render(CASES.fileRefs);
  const refs = byClass(root, 'md-fileref');
  assert.deepEqual(
    refs.map((r) => [r.attributes['data-file'], r.attributes['data-line']]),
    [
      ['public/markdown.js', '199'],
      ['public/panel-said.js', '107'],
      ['src/core/editor.mjs', '10'],
      ['C:\\Dk\\app\\src\\index.ts', '7'],
    ],
  );
  assert.ok(refs.every((r) => r.tagName === 'BUTTON'));
  // A sentence's full stop is the sentence's.
  assert.equal(refs[1].textContent, 'public/panel-said.js:107');
  // The time and a version number are not files.
  assert.match(root.textContent, /12:30 on the clock, and version 2\.1:3\./);
  assert.equal(refs.length, 4);
});

test('what is and is not a file reference', () => {
  assert.deepEqual(fileRefOf('src/x.js:42'), { path: 'src/x.js', line: 42 });
  assert.deepEqual(fileRefOf('panel.js:7'), { path: 'panel.js', line: 7 });
  assert.deepEqual(fileRefOf('src/x.js:42:5'), { path: 'src/x.js', line: 42 });
  assert.deepEqual(fileRefOf('src/x.js'), { path: 'src/x.js', line: 1 });
  // In running prose a path needs its line to count.
  assert.equal(fileRefOf('src/x.js', { requireLine: true }), null);
  // A host and a port, a clock, a version, a bare word, a URL, a sentence.
  for (const no of [
    'example.com:8080',
    '12:30',
    '2.1:3',
    'README',
    'x.js',
    'https://example.com/a.js:1',
    'a b.js:1',
    '',
    `${'a/'.repeat(300)}x.js:1`,
  ]) {
    assert.equal(fileRefOf(no), null, no);
  }
});

test('links: a web page is an anchor, this machine is marked, a path opens in the editor', () => {
  const root = render(CASES.links);
  const anchors = byTag(root, 'a');
  assert.deepEqual(
    anchors.map((a) => [a.attributes.href, a.className]),
    [
      ['https://example.com/docs/guide#panel', 'md-a'],
      ['https://example.com/bare?x=1', 'md-a'],
      ['http://127.0.0.1:4317/', 'md-a md-a--local'],
    ],
  );
  for (const a of anchors) {
    assert.equal(a.attributes.target, '_blank');
    assert.equal(a.attributes.rel, 'noopener noreferrer');
    assert.equal(a.attributes.title, a.attributes.href, 'where it goes is one hover away');
  }
  // A relative link is a file in the session's project.
  const [guide] = byClass(root, 'md-fileref');
  assert.equal(guide.attributes['data-file'], 'docs/GUIDE.md');
  assert.equal(guide.textContent, 'the guide');
  // mailto and javascript are words with the address visible, as every link
  // was before this package.
  const inert = byClass(root, 'md-link').map((l) => l.textContent);
  assert.deepEqual(inert, ['here (mailto:someone@example.com)', 'click me (javascript:alert(1))']);
});

test('a bare URL is linked without its sentence’s punctuation, and an angle-bracket URL is one', () => {
  const hrefs = (text) => byTag(render(text), 'a').map((a) => a.attributes.href);
  assert.deepEqual(hrefs('See https://example.com/a.'), ['https://example.com/a']);
  assert.deepEqual(hrefs('(see https://example.com/a)'), ['https://example.com/a']);
  assert.deepEqual(hrefs('https://en.example.org/wiki/A_(b)'), [
    'https://en.example.org/wiki/A_(b)',
  ]);
  assert.deepEqual(hrefs('<https://example.com/x_y_z>'), ['https://example.com/x_y_z']);
  assert.deepEqual(hrefs('a_https://example.com'), [], 'not in the middle of a word');
  // An underscore in a URL is not emphasis.
  assert.equal(byTag(render('https://example.com/a_b_c and _em_'), 'em').length, 1);
});

test('an image is named and never fetched: no <img>, a link for a web one, the session for a local one', () => {
  const root = render(CASES.image);
  assert.equal(byTag(root, 'img').length, 0, 'the page makes no request a transcript asked for');
  const images = byClass(root, 'md-image');
  assert.equal(images.length, 2);
  assert.match(images[0].textContent, /image: the floor at 1600 px open/);
  assert.equal(byTag(images[0], 'a')[0].attributes.href, 'https://example.com/floor.png');
  const local = byClass(images[1], 'md-in-session');
  assert.equal(local.length, 1);
  assert.equal(local[0].textContent, 'open in the session');
});

test('an artifact link opens in the browser AND offers the session it belongs to', () => {
  const root = render(CASES.artifact);
  assert.equal(byTag(root, 'a').length, 1);
  assert.equal(byClass(root, 'md-in-session').length, 1);
  assert.equal(needsSession('https://claude.ai/code/artifact/abc'), true);
  assert.equal(needsSession('https://claude.ai/artifacts/abc'), true);
  assert.equal(needsSession('https://example.com/artifact/abc'), false);
  assert.equal(byClass(render('https://example.com/x'), 'md-in-session').length, 0);
});

// -------------------------------------------------------------- security

const ALLOWED_TAGS = new Set([
  'DIV',
  'P',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'LI',
  'PRE',
  'CODE',
  'BLOCKQUOTE',
  'HR',
  'STRONG',
  'EM',
  'DEL',
  'SPAN',
  'A',
  'BUTTON',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TH',
  'TD',
  '#text',
]);
const ALLOWED_ATTRS = new Set([
  'type',
  'href',
  'target',
  'rel',
  'title',
  'start',
  'role',
  'aria-label',
  'aria-hidden',
  'data-lang',
  'data-file',
  'data-line',
  'data-go',
]);

/** Every element a render produced is on the list, and so is every attribute. */
function assertClean(root, what) {
  for (const node of all(root)) {
    assert.ok(ALLOWED_TAGS.has(node.tagName), `${what}: created <${node.tagName}>`);
    for (const [name, value] of Object.entries(node.attributes || {})) {
      assert.ok(ALLOWED_ATTRS.has(name), `${what}: set ${name}`);
      assert.ok(!/^on/i.test(name), `${what}: an event handler attribute, ${name}`);
      if (name === 'href') {
        assert.match(value, /^https?:\/\//, `${what}: an href that is not http(s): ${value}`);
      }
    }
    if (node.tagName === 'A') {
      assert.equal(node.attributes.rel, 'noopener noreferrer', `${what}: an anchor without rel`);
      assert.equal(node.attributes.target, '_blank');
    }
  }
}

test('SECURITY: raw HTML in a reply is text, every tag and attribute of it', () => {
  const root = render(CASES.html);
  assertClean(root, 'raw HTML');
  for (const tag of ['script', 'img', 'details', 'summary', 'iframe', 'style']) {
    assert.equal(byTag(root, tag).length, 0, `<${tag}> became an element`);
  }
  assert.equal(byTag(root, 'a').length, 0, 'an <a href> in the text is not an anchor');
  assert.match(root.textContent, /<script>alert\(1\)<\/script>/);
  assert.match(root.textContent, /<img src=x onerror="alert\(1\)">/);
  assert.match(root.textContent, /onclick="alert\(2\)"/);
});

test('SECURITY: no scheme but http and https ever becomes an anchor', () => {
  const hostile = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    ' javascript:alert(1)',
    '\u0001javascript:alert(1)',
    'javascript&colon;alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
    'file:///C:/Windows/System32/calc.exe',
    'file://server/share/x.exe',
    'blob:https://example.com/x',
    'about:blank',
    'chrome://settings',
    'ms-msdt:/id',
    'claude://code/new?q=rm',
    'vscode://file/C:/x',
    'mailto:a@b.c',
    'tel:+1',
    '//evil.example/x',
    'https://',
    'http://user:pass@evil.example/',
    'https://bank.example@evil.example/',
  ];
  for (const href of hostile) {
    const kind = classifyHref(href).kind;
    assert.ok(kind === 'text' || kind === 'file', `${JSON.stringify(href)} classified ${kind}`);
    assert.notEqual(kind, 'external');
    assert.notEqual(kind, 'loopback');
  }
  // Rendered, as a markdown link and as an image, where the address has no
  // space in it (one with a space is not link syntax at all).
  for (const href of hostile.filter((h) => !/\s/.test(h))) {
    const root = render(`[x](${href}) ![y](${href})`);
    assert.equal(byTag(root, 'a').length, 0, `${href} produced an anchor`);
    assertClean(root, href);
  }
  // An address nobody could have typed is not acted on as written.
  assert.deepEqual(classifyHref(`https://example.com/${'a'.repeat(2100)}`), { kind: 'text' });
  // The address an anchor carries is the platform's own re-serialisation.
  assert.deepEqual(classifyHref('HTTPS://EXAMPLE.com/a b'), { kind: 'text' });
  assert.deepEqual(classifyHref('HTTPS://EXAMPLE.com/a'), {
    kind: 'external',
    url: 'https://example.com/a',
  });
  assert.equal(classifyHref('http://localhost:4317/x').kind, 'loopback');
  assert.equal(classifyHref('http://app.localhost/').kind, 'loopback');
  assert.equal(classifyHref('http://[::1]:4317/').kind, 'loopback');
  assert.equal(classifyHref('http://127.0.0.1.evil.example/').kind, 'external');
  assert.equal(classifyHref('http://localhost.evil.example/').kind, 'external');
});

test('SECURITY: injection through every construct produces only the allowed elements and attributes', () => {
  const attacks = [
    '# <img src=x onerror=alert(1)>',
    '| <script>x</script> | `<b>` |\n|---|---|\n| [a](javascript:x) | ![i](data:image/svg+xml,<svg onload=alert(1)>) |',
    '- [x] <input autofocus onfocus=alert(1)>',
    '> <iframe src="javascript:alert(1)"></iframe>',
    '```html\n<script>alert(1)</script>\n```',
    '```"><script>alert(1)</script>\nx\n```',
    '[<img src=x onerror=alert(1)>](https://example.com)',
    '[x](https://example.com/"onmouseover="alert(1))',
    '[x](https://example.com/ "title\\" onclick=\\"alert(1)")',
    '`x" onclick="alert(1)`',
    'a.js:1" onclick="alert(1)',
    '`../../../../etc/passwd`',
    '<a href="https://example.com" onclick="alert(1)">x</a>',
    '<https://example.com/"><script>alert(1)</script>>',
    '~~<s onmouseover=alert(1)>~~',
    REPLY,
  ];
  for (const text of attacks) assertClean(render(text), text.slice(0, 40));
  // A path that climbs out is still only DATA on a button; whether it may be
  // opened is the route's decision (`resolveInRepo`), not this file's.
  const [climb] = byClass(render('`../../../../etc/passwd.txt`'), 'md-fileref');
  assert.equal(climb.attributes['data-file'], '../../../../etc/passwd.txt');
  assert.equal(climb.tagName, 'BUTTON');
});

test('SECURITY: untrusted text cannot make the parser run away', () => {
  const big = [
    `${'a/'.repeat(20000)}x.js:1`,
    `https://example.com/${'('.repeat(20000)}`,
    `${'|'.repeat(5000)}\n${'|---'.repeat(5000)}|`,
    '~~'.repeat(20000),
    `${'['.repeat(10000)}x${'](a)'.repeat(10000)}`,
    `${'a.b.c.d.'.repeat(5000)}:1`,
  ];
  for (const text of big) {
    const t0 = Date.now();
    render(text);
    const ms = Date.now() - t0;
    assert.ok(ms < 2000, `a ${text.length}-character input took ${ms} ms`);
  }
});
