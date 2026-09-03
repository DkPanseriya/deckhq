/**
 * The panel's markdown renderer, run as a pure function against a minimal DOM
 * stub. The stub records exactly what the renderer asked for — element names,
 * classes, attributes and text — and nothing here parses HTML, so the only
 * way a `<script>` could become an element is if the renderer created one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarkdown, parseInline, renderMarkdown } from '../../public/markdown.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(HERE, '../../public/markdown.js');

class StubNode {
  /** @param {string} tagName */
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.className = '';
    this._text = null;
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v);
  }
  get textContent() {
    if (this._text !== null) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }
}
class StubText {
  constructor(text) {
    this.tagName = '#text';
    this.textContent = String(text);
    this.children = [];
  }
}
const doc = {
  createElement: (tag) => new StubNode(tag),
  createTextNode: (text) => new StubText(text),
};

/** Every element in the tree, depth first. */
function all(node, out = []) {
  out.push(node);
  for (const c of node.children || []) all(c, out);
  return out;
}
const byTag = (root, tag) => all(root).filter((n) => n.tagName === tag.toUpperCase());

test('SECURITY: a fenced block containing <script> renders as visible text and creates no element', () => {
  const text =
    'Run this:\n\n```html\n<script>alert(1)</script>\n<img src=x onerror=alert(2)>\n```\n';
  const root = renderMarkdown(text, doc);
  assert.equal(byTag(root, 'script').length, 0);
  assert.equal(byTag(root, 'img').length, 0);
  const [pre] = byTag(root, 'pre');
  assert.ok(pre, 'the fence became a <pre>');
  assert.equal(pre.children[0].tagName, 'CODE');
  assert.equal(
    pre.children[0].textContent,
    '<script>alert(1)</script>\n<img src=x onerror=alert(2)>',
  );
  // The tag inside a paragraph is text too, and so is one inside inline code.
  const inline = renderMarkdown('a <b>bold</b> `<script>` word', doc);
  assert.equal(byTag(inline, 'b').length, 0);
  assert.equal(byTag(inline, 'script').length, 0);
  assert.equal(inline.textContent, 'a <b>bold</b> <script> word');
});

test('SECURITY: the renderer source never touches innerHTML or outerHTML', () => {
  // Comments stripped: the header is allowed to name the rule it keeps.
  const src = fs.readFileSync(SOURCE, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(
    src,
    /innerHTML|outerHTML|insertAdjacentHTML|DOMParser|createContextualFragment/,
  );
  // A stub that has no innerHTML at all rendered every test here, which is the
  // structural proof — this assertion just names the rule.
  assert.equal('innerHTML' in new StubNode('div'), false);
});

test('headings, paragraphs and thematic breaks', () => {
  const tree = parseMarkdown('# Title\n\nFirst line\nsecond line\n\n---\n\n### Deep');
  assert.deepEqual(
    tree.map((b) => b.type),
    ['heading', 'paragraph', 'hr', 'heading'],
  );
  assert.equal(tree[0].level, 1);
  assert.equal(tree[3].level, 3);
  assert.equal(tree[1].children[0].text, 'First line\nsecond line');
  const root = renderMarkdown('# Title\n\n### Deep', doc);
  // Levels are demoted so the panel's own h2 stays the page's outline.
  assert.equal(root.children[0].tagName, 'H4');
  assert.equal(root.children[1].tagName, 'H6');
});

test('bullet and numbered lists, including nesting and continuation lines', () => {
  const md = [
    '- one',
    '- two',
    '  continued',
    '  - nested a',
    '  - nested b',
    '',
    '3. three',
    '4. four',
  ].join('\n');
  const [ul, ol] = parseMarkdown(md);
  assert.equal(ul.type, 'list');
  assert.equal(ul.ordered, false);
  assert.equal(ul.items.length, 2);
  assert.equal(ul.items[1][0].type, 'paragraph');
  assert.equal(ul.items[1][0].children[0].text, 'two\ncontinued');
  assert.equal(ul.items[1][1].type, 'list');
  assert.equal(ul.items[1][1].items.length, 2);
  assert.equal(ol.type, 'list');
  assert.equal(ol.ordered, true);
  assert.equal(ol.start, 3);
  const root = renderMarkdown(md, doc);
  const rendered = byTag(root, 'ol')[0];
  assert.equal(rendered.attributes.start, '3');
  assert.equal(byTag(root, 'li').length, 6);
});

test('fenced code keeps its text verbatim, its language, and tolerates an unterminated fence', () => {
  const [code] = parseMarkdown('```js\nconst a = **not bold**;\n\n  indented\n```');
  assert.equal(code.type, 'code');
  assert.equal(code.lang, 'js');
  assert.equal(code.text, 'const a = **not bold**;\n\n  indented');
  const [open] = parseMarkdown('~~~\nnever closed');
  assert.equal(open.type, 'code');
  assert.equal(open.text, 'never closed');
  const root = renderMarkdown('```sh\nnpm test\n```', doc);
  assert.equal(byTag(root, 'code')[0].attributes['data-lang'], 'sh');
});

test('inline code, bold, italic and links; links become text with the URL visible', () => {
  const inline = parseInline(
    'use `a**b**` and **bold _in_ it** or *em* and [docs](https://x.test/p)',
  );
  assert.deepEqual(
    inline.map((n) => n.type),
    ['text', 'code', 'text', 'strong', 'text', 'em', 'text', 'link'],
  );
  assert.equal(inline[1].text, 'a**b**');
  assert.equal(inline[3].children[1].type, 'em');
  assert.equal(inline[7].href, 'https://x.test/p');
  const root = renderMarkdown('see [the docs](https://x.test/p) now', doc);
  assert.equal(byTag(root, 'a').length, 0, 'never an anchor');
  assert.equal(root.textContent, 'see the docs (https://x.test/p) now');
  assert.equal(byTag(root, 'strong').length, 0);
});

test('emphasis markers that are not emphasis stay literal', () => {
  assert.deepEqual(parseInline('2 * 3 * 4'), [{ type: 'text', text: '2 * 3 * 4' }]);
  assert.deepEqual(parseInline('snake_case_name'), [{ type: 'text', text: 'snake_case_name' }]);
  assert.deepEqual(parseInline('unclosed **bold'), [{ type: 'text', text: 'unclosed **bold' }]);
  assert.deepEqual(parseInline('\\*escaped\\*'), [{ type: 'text', text: '*escaped*' }]);
});

test('block quotes nest their own blocks', () => {
  const [q] = parseMarkdown('> quoted\n> - item');
  assert.equal(q.type, 'quote');
  assert.deepEqual(
    q.children.map((b) => b.type),
    ['paragraph', 'list'],
  );
  const root = renderMarkdown('> quoted', doc);
  assert.equal(root.children[0].tagName, 'BLOCKQUOTE');
});

test('plain text, empty text and Windows line endings are all fine', () => {
  assert.deepEqual(parseMarkdown(''), []);
  assert.deepEqual(parseMarkdown(null), []);
  const [p] = parseMarkdown('one\r\ntwo');
  assert.equal(p.children[0].text, 'one\ntwo');
  assert.equal(renderMarkdown('just words', doc).textContent, 'just words');
});
