/**
 * The panel's unified-diff renderer (WP-47), run as a pure function against a
 * minimal DOM stub — the same technique as `markdown.test.mjs`, and for a
 * stronger reason: a diff is the literal contents of files an agent has just
 * written, so it is the most attacker-shaped text in the product.
 *
 * The stub records exactly what the renderer asked for, and nothing here
 * parses HTML, so the only way a `<script>` could become an element is if the
 * renderer created one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyLine, parseDiff, renderDiff } from '../../public/diff-view.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(HERE, '../../public/diff-view.js');
const STYLESHEET = path.resolve(HERE, '../../public/style.css');

class StubNode {
  /** @param {string} tagName */
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = '';
    this._text = null;
  }
  appendChild(child) {
    this.children.push(child);
    return child;
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
const doc = { createElement: (tag) => new StubNode(tag) };

/** Every element in the tree, depth first. */
function all(node, out = []) {
  out.push(node);
  for (const c of node.children || []) all(c, out);
  return out;
}
const byTag = (root, tag) => all(root).filter((n) => n.tagName === tag.toUpperCase());

const SAMPLE = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1a2b3c4..5d6e7f8 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,4 +1,5 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = 4;',
  ' export { a };',
  '',
].join('\n');

test('SECURITY: a diff containing <script> produces no HTML and no element', () => {
  const hostile = [
    'diff --git a/index.html b/index.html',
    '--- a/index.html',
    '+++ b/index.html',
    '@@ -1,2 +1,4 @@',
    '-<p>hello</p>',
    '+<script>alert(1)</script>',
    '+<img src=x onerror="alert(2)">',
    '+<iframe srcdoc="&lt;script&gt;alert(3)&lt;/script&gt;"></iframe>',
    ' </body>',
  ].join('\n');

  const root = renderDiff(hostile, doc);
  for (const tag of ['script', 'img', 'iframe', 'p', 'body', 'svg', 'a']) {
    assert.equal(byTag(root, tag).length, 0, `a <${tag}> element was created from the diff`);
  }
  // Every element is a plain div: the container and one line each.
  const tags = new Set(all(root).map((n) => n.tagName));
  assert.deepEqual([...tags], ['DIV']);

  // And the markup is still visible to the reader, character for character.
  assert.match(root.textContent, /<script>alert\(1\)<\/script>/);
  assert.match(root.textContent, /<img src=x onerror="alert\(2\)">/);
});

test('SECURITY: the module never touches innerHTML or any HTML-parsing API', () => {
  const src = fs.readFileSync(SOURCE, 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
  for (const forbidden of [
    'innerHTML',
    'outerHTML',
    'insertAdjacentHTML',
    'DOMParser',
    'createContextualFragment',
    'eval(',
    'Function(',
  ]) {
    assert.ok(!src.includes(forbidden), `diff-view.js uses ${forbidden}`);
  }
  assert.ok(src.includes('textContent'), 'text reaches the DOM through textContent');
});

test('every line of a unified diff is classified, and the headers are not +/- lines', () => {
  assert.deepEqual(
    parseDiff(SAMPLE).map((l) => l.kind),
    ['meta', 'meta', 'meta', 'meta', 'hunk', 'context', 'del', 'add', 'add', 'context'],
  );
  // `---` and `+++` are file headers. Reading them as a removal and an
  // addition is the classic renderer bug and it colours two lines a lie.
  assert.equal(classifyLine('--- a/x'), 'meta');
  assert.equal(classifyLine('+++ b/x'), 'meta');
  assert.equal(classifyLine('-x'), 'del');
  assert.equal(classifyLine('+x'), 'add');
  assert.equal(classifyLine('@@ -0,0 +1 @@'), 'hunk');
  assert.equal(classifyLine('new file mode 100644'), 'meta');
  assert.equal(classifyLine('deleted file mode 100644'), 'meta');
  assert.equal(classifyLine('rename from a'), 'meta');
  assert.equal(classifyLine('Binary files a/x and b/x differ'), 'meta');
  assert.equal(classifyLine('\\ No newline at end of file'), 'meta');
  assert.equal(classifyLine(' unchanged'), 'context');
});

test('parseDiff is pure: no document is needed and none is touched', () => {
  assert.equal(typeof globalThis.document, 'undefined', 'the suite runs without a DOM');
  assert.deepEqual(parseDiff(''), []);
  assert.deepEqual(parseDiff(null), []);
  assert.deepEqual(
    parseDiff('+a\r\n-b\r\n').map((l) => l.text),
    ['+a', '-b'],
  );
});

test('each line becomes one element carrying its kind as a class', () => {
  const root = renderDiff(SAMPLE, doc);
  assert.equal(root.className, 'diff');
  assert.equal(root.children.length, 10);
  assert.equal(root.children[4].className, 'diff-line diff-line--hunk');
  assert.equal(root.children[6].className, 'diff-line diff-line--del');
  assert.equal(root.children[6].textContent, '-const b = 2;');
  assert.equal(root.children[7].className, 'diff-line diff-line--add');
});

/* ---------------------------------------------------------------- colour */

/** @param {string} hex @returns {number} */
function relativeLuminance(hex) {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** The `--token: #hex` custom properties in style.css's `:root`. */
function readTokens() {
  const css = fs.readFileSync(STYLESHEET, 'utf8');
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(root, 'could not find the :root block in public/style.css');
  /** @type {Record<string,string>} */
  const tokens = {};
  for (const [, name, value] of root[1].matchAll(/--([\w-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)) {
    tokens[name] = value.toLowerCase();
  }
  return tokens;
}

test('CONTRAST: the diff colours clear 4.5:1 on the ground the diff is drawn on', () => {
  // Unlike the state colours (which never set small text — see
  // state-visuals.test.mjs) these three ARE the text, at 0.64rem. So they are
  // held to the normal-size floor on `--surface-2`, the diff's own ground,
  // and on the two chrome grounds behind it.
  const t = readTokens();
  for (const name of ['diff-add', 'diff-del', 'diff-hunk']) {
    assert.ok(t[name], `--${name} is missing from :root`);
    for (const ground of ['surface-2', 'bg', 'surface']) {
      const ratio = contrastRatio(t[name], t[ground]);
      assert.ok(
        ratio >= 4.5,
        `--${name} (${t[name]}) is ${ratio.toFixed(2)}:1 on --${ground} (${t[ground]}); needs >= 4.5:1`,
      );
    }
  }
});

test('COLOUR DISCIPLINE: the diff colours are not the floor palette or the accent', () => {
  // Crimson means "in your office" and the state colours mean states. A
  // removed line means neither, so it must not wear either colour.
  const t = readTokens();
  const reserved = new Set(
    Object.entries(t)
      .filter(([k]) => k.startsWith('state-') || k === 'accent')
      .map(([, v]) => v),
  );
  for (const name of ['diff-add', 'diff-del', 'diff-hunk']) {
    assert.ok(!reserved.has(t[name]), `--${name} reuses a reserved colour (${t[name]})`);
  }
});
