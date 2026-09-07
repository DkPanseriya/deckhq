/**
 * WP-60 — the idle-projects chip and the list behind it.
 *
 * The list that used to be drawn down the corner of the canvas is HTML now, and
 * that is a claim about the DOM, so the DOM is asserted directly. This repo has
 * no jsdom and is not getting one: the render functions are pure and take their
 * `document` as a parameter, and what they are handed here is a stub that
 * records exactly what was asked of it and nothing more — the technique
 * `test/unit/deck-view.test.mjs`, `diff-view.test.mjs` and `markdown.test.mjs`
 * use. Nothing in this file parses HTML, so the only way a `<script>` could
 * become an element is if the renderer created one.
 *
 * Two things are being pinned. **The reading of a line did not change** when
 * the list left the floor: the canvas drew a name and, on the right,
 * `${sessions}${last ? ` · ${last}` : ''}`, and this asserts the same strings
 * against the same formatter. And **every string reaching the page goes through
 * `textContent`**, which is asserted rather than reviewed: the stub's
 * `innerHTML` setter throws, so a renderer that ever reached for it fails here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  idleChipLabel,
  idleRowLabel,
  idleRowText,
  renderIdleList,
} from '../../public/idle-projects.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../../public');

// --------------------------------------------------------------- DOM stub
//
// `deck-view.test.mjs`'s StubNode, with two additions this renderer needs and
// that one did not: a `dataset`, and an `innerHTML` setter that throws so the
// no-innerHTML rule is a failing test rather than a comment. The `textContent`
// getter also prefers real children over a stored string, because this renderer
// clears its list with `textContent = ''` before appending to it.

class StubNode {
  /** @param {string} tagName */
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = '';
    this.id = '';
    this.dataset = /** @type {Record<string,string>} */ ({});
    this.attrs = /** @type {Record<string,string>} */ ({});
    this._text = null;
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  set innerHTML(v) {
    throw new Error(`wrote ${JSON.stringify(String(v))} through innerHTML`);
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v);
  }
  get textContent() {
    if (this.children.length > 0) return this.children.map((c) => c.textContent).join('');
    return this._text === null ? '' : this._text;
  }
}
const doc = { createElement: (tag) => new StubNode(tag) };

/** Every element in the tree, depth first. */
function all(node, out = []) {
  out.push(node);
  for (const c of node.children || []) all(c, out);
  return out;
}
const byClass = (root, cls) =>
  all(root).filter((n) => String(n.className).split(/\s+/).includes(cls));

// -------------------------------------------------------- shared fixture
//
// The shape `idleProjectsOf` hands over, deliberately awkward: one repo with a
// day and a bit of silence, one with minutes, one that has never been dated at
// all, one with a single session so the label's plural is exercised, and a name
// far longer than the popover is wide.

const T0 = 1_760_000_000_000;
const H = 3_600_000;
const NOW = T0;

const IDLE = [
  { id: 'orbital-api', name: 'orbital-api', sessionCount: 3, lastActivityAt: T0 - 26 * H },
  { id: 'checkout-flow', name: 'checkout-flow', sessionCount: 1, lastActivityAt: T0 - 40 * 60_000 },
  { id: 'data-pipeline', name: 'data-pipeline', sessionCount: 12, lastActivityAt: 0 },
  {
    id: 'long',
    name: 'a-repository-with-a-name-far-longer-than-the-popover-is-wide',
    sessionCount: 2,
    lastActivityAt: T0 - 3 * H,
  },
];

// ---------------------------------------------------------------- the chip

test('the chip is a count and the word, at one and at many', () => {
  assert.equal(idleChipLabel(14), '14 idle');
  assert.equal(idleChipLabel(1), '1 idle');
  // Never rendered — the chip is hidden at nought — but it must still read as a
  // sentence rather than as `NaN idle` if it ever is.
  assert.equal(idleChipLabel(0), '0 idle');
  assert.equal(idleChipLabel(undefined), '0 idle');
  assert.equal(idleChipLabel(-3), '0 idle');
});

// ----------------------------------------------------------------- a row

test('a row says what the canvas strip said: name, sessions, last activity', () => {
  assert.deepEqual(idleRowText(IDLE[0], NOW), { name: 'orbital-api', stat: '3 · 1d 2h' });
  assert.deepEqual(idleRowText(IDLE[1], NOW), { name: 'checkout-flow', stat: '1 · 40m' });
});

test('a repo nothing is known about shows its count alone, not a false “0m”', () => {
  assert.deepEqual(idleRowText(IDLE[2], NOW), { name: 'data-pipeline', stat: '12' });
  // And a record with no count and no date at all still renders as strings.
  assert.deepEqual(idleRowText({ id: 'bare' }, NOW), { name: 'bare', stat: '0' });
});

test('the spoken label spells out what the terse one abbreviates', () => {
  assert.equal(idleRowLabel(IDLE[0], NOW), 'orbital-api, 3 sessions, last active 1d 2h ago');
  assert.equal(idleRowLabel(IDLE[1], NOW), 'checkout-flow, 1 session, last active 40m ago');
  assert.equal(idleRowLabel(IDLE[2], NOW), 'data-pipeline, 12 sessions, no recorded activity');
});

// ---------------------------------------------------------------- the list

test('the list is one option per project, in the order it was given', () => {
  const listEl = new StubNode('ul');
  const rows = renderIdleList(doc, listEl, IDLE, NOW);

  assert.equal(rows.length, IDLE.length);
  assert.equal(listEl.children.length, IDLE.length);
  assert.deepEqual(
    listEl.children.map((n) => n.dataset.index),
    ['0', '1', '2', '3'],
  );
  assert.deepEqual(
    listEl.children.map((n) => n.children[0].textContent),
    IDLE.map((p) => p.name),
  );
});

test('every row is an addressable, countable option', () => {
  const listEl = new StubNode('ul');
  const rows = renderIdleList(doc, listEl, IDLE, NOW);
  const ids = new Set();
  rows.forEach((row, i) => {
    assert.equal(row.tagName, 'LI');
    assert.equal(row.getAttribute('role'), 'option');
    // `aria-activedescendant` on the listbox addresses rows by id, so an id is
    // not decoration here: without one the current row is unannounceable.
    assert.ok(row.id, `row ${i} has no id`);
    ids.add(row.id);
    assert.equal(row.getAttribute('aria-selected'), 'false');
    assert.equal(row.getAttribute('aria-posinset'), String(i + 1));
    assert.equal(row.getAttribute('aria-setsize'), String(IDLE.length));
    assert.equal(row.getAttribute('aria-label'), idleRowLabel(IDLE[i], NOW));
  });
  assert.equal(ids.size, rows.length, 'two rows share an id');
});

test('re-rendering replaces the list rather than growing it', () => {
  const listEl = new StubNode('ul');
  renderIdleList(doc, listEl, IDLE, NOW);
  const rows = renderIdleList(doc, listEl, IDLE.slice(0, 2), NOW);
  assert.equal(rows.length, 2);
  assert.equal(listEl.children.length, 2);
  assert.equal(listEl.children[1].getAttribute('aria-setsize'), '2');
});

test('an empty list renders nothing rather than a broken row', () => {
  const listEl = new StubNode('ul');
  assert.deepEqual(renderIdleList(doc, listEl, [], NOW), []);
  assert.deepEqual(renderIdleList(doc, listEl, null, NOW), []);
  assert.equal(listEl.children.length, 0);
});

test('a long name is ellipsised by CSS, never by cutting the string', () => {
  const listEl = new StubNode('ul');
  const rows = renderIdleList(doc, listEl, [IDLE[3]], NOW);
  assert.equal(byClass(rows[0], 'idle-row-name')[0].textContent, IDLE[3].name);
  assert.ok(!rows[0].textContent.includes('…'));
});

// ----------------------------------------------------------- the contract

test('SECURITY: a hostile project name becomes text, never an element', () => {
  const listEl = new StubNode('ul');
  // The stub's innerHTML setter throws, so this call failing IS the assertion
  // that nothing reached for it.
  const rows = renderIdleList(
    doc,
    listEl,
    [{ id: 'x', name: '<img src=x onerror=alert(1)>', sessionCount: 1, lastActivityAt: T0 - H }],
    NOW,
  );
  for (const node of all(rows[0])) {
    assert.ok(!['SCRIPT', 'IMG', 'IFRAME'].includes(node.tagName), `created a ${node.tagName}`);
  }
  // The characters survive as characters, whole.
  assert.match(rows[0].textContent, /<img src=x onerror=alert\(1\)>/);
});

test('the module reaches neither innerHTML nor the network at all', () => {
  // Comments stripped, the way test/unit/panel-invariant.test.mjs does it: this
  // module's own header names innerHTML in order to say it never uses it.
  const src = fs
    .readFileSync(path.join(PUBLIC, 'idle-projects.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|DOMParser/);
  assert.doesNotMatch(src, /fetch\(/);
  assert.doesNotMatch(src, /\/api\//);
});

test('the idle rule is imported, not re-derived', () => {
  const src = fs.readFileSync(path.join(PUBLIC, 'idle-projects.js'), 'utf8');
  // `floor-rule.js` is the one copy of "which repos are idle" (`08` B6). A
  // second answer here is a floor and a list that can disagree about a repo.
  assert.match(src, /import \{ idleProjectsOf \} from '\.\/floor-rule\.js'/);
  assert.match(src, /import \{ formatElapsed \} from '\.\/render\/rig-metrics\.js'/);
});
