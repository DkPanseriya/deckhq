/**
 * WP-10 — the queue strip and the deck (`docs/plan/05-GUI-UX-SPEC.md` §3).
 *
 * Two things are being pinned here.
 *
 * **One order.** `public/deck.js` and `src/cli/deck.mjs` order the same queue
 * in two processes that can never import each other: `src/` is never served to
 * the browser and the browser is never handed a Node module. So they are
 * separate implementations of one rule, and the only thing that can stop them
 * drifting is a test that runs both over one fixture and compares the id
 * sequences. If this file fails, `deckhq ls` and the GUI now disagree about
 * which item `J` lands on next.
 *
 * **Real table semantics.** The deck is the accessible equivalent of the floor
 * (§10): a screen-reader user gets the same queue, in the same order, with the
 * same actions, and the floor is never the only way to reach anything. That is
 * a claim about the DOM, so the DOM is asserted directly — the render
 * functions are pure and take their `document`, the technique
 * `diff-view.test.mjs` and `markdown.test.mjs` use.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DECK_HINT_THRESHOLD,
  OLD_MS,
  buildChip,
  cut,
  groupDigits,
  queueGroups,
  queueOrder,
  renderDeckTable,
  renderStrip,
  rowLabel,
  waitStart,
  waited,
} from '../../public/deck.js';
import { groupRows, waited as cliWaited } from '../../src/cli/deck.mjs';
import { waitStart as cliWaitStart } from '../../src/cli/source.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../../public');

// --------------------------------------------------------------- DOM stub
//
// Records exactly what the renderer asked for and nothing else. Nothing here
// parses HTML, so the only way a `<script>` could become an element is if the
// renderer created one.

class StubNode {
  /** @param {string} tagName */
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = '';
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
const byClass = (root, cls) =>
  all(root).filter((n) => String(n.className).split(/\s+/).includes(cls));

// -------------------------------------------------------- shared fixture
//
// One population, used by both orderings. Deliberately awkward: a stall older
// than everything else (so grouping is observable, not accidental), two rows
// with the same timestamp (so the tie-break is exercised), a benched agent
// that must not appear, a for_review agent in another project, and one wait
// over a day old.

const T0 = 1_760_000_000_000;
const H = 3_600_000;

/** @param {any} extra */
const agent = (extra) => ({
  runtime: 'claude-code',
  ackState: 'active',
  activityState: 'for_review',
  projectId: 'orbital-api',
  projectName: 'orbital-api',
  tokens: 0,
  lastText: '',
  lastActivityAt: T0,
  ...extra,
});

const POPULATION = [
  agent({
    id: 'claude-code:e',
    mk: 'MK5.1',
    displayName: 'Rune',
    activityState: 'needs_input',
    needsInputSince: T0 - 4 * H,
    projectId: 'mobile-app',
    projectName: 'mobile-app',
    lastText: 'May I run the migration on prod?',
    tokens: 412_000,
  }),
  agent({
    id: 'claude-code:a',
    mk: 'MK1.1',
    displayName: 'Ada',
    reviewSince: T0 - 26 * H,
    lastText: 'Done. Tests pass and the change is on the branch.\nWant me to open the PR?',
    tokens: 160_000,
  }),
  agent({
    id: 'claude-code:s',
    mk: 'MK3.2',
    displayName: 'Sable',
    activityState: 'stalled',
    // Older than every for_review and needs_input row, and still below them.
    lastOutputAt: T0 - 40 * H,
    projectId: 'data-pipeline',
    projectName: 'data-pipeline',
    tokens: 220_100,
  }),
  agent({
    id: 'claude-code:c',
    mk: 'MK2.3',
    displayName: 'Wren',
    reviewSince: T0 - 40 * 60_000,
    projectId: 'checkout-flow',
    projectName: 'checkout-flow',
    lastText: 'Refund path fixed; orphaned rows are gone.',
    tokens: 88_400,
  }),
  // Same instant as Wren: the tie must break on the id, in both processes.
  agent({
    id: 'claude-code:b',
    mk: 'MK1.4',
    displayName: 'Juno',
    reviewSince: T0 - 40 * 60_000,
    lastText: 'Opened the PR. Anything else?',
    tokens: 31_900,
  }),
  agent({ id: 'claude-code:z', mk: 'MK9.9', ackState: 'benched', reviewSince: T0 - 3 * H }),
  agent({ id: 'claude-code:y', mk: 'MK9.8', activityState: 'working', ackState: 'active' }),
  agent({ id: 'claude-code:x', mk: 'MK9.7', ackState: 'let_go', reviewSince: T0 - 9 * H }),
];

const NOW = T0;

// ------------------------------------------------------------- the order

test('the GUI queue and `deckhq waiting` order the same snapshot identically', () => {
  const gui = queueOrder(POPULATION).map((a) => a.id);
  const cli = groupRows(POPULATION, { waitingOnly: true }).flatMap((g) => g.rows.map((a) => a.id));
  assert.deepEqual(gui, cli);
  // And it is the order the spec draws: oldest first, hands up and finished
  // turns above the stall, the tie broken on the id.
  assert.deepEqual(gui, [
    'claude-code:a',
    'claude-code:e',
    'claude-code:b',
    'claude-code:c',
    'claude-code:s',
  ]);
});

test('the two groups are the same groups, with the same rows', () => {
  const gui = queueGroups(POPULATION).map((g) => [g.key, g.rows.map((a) => a.id)]);
  const cli = groupRows(POPULATION, { waitingOnly: true }).map((g) => [
    g.key,
    g.rows.map((a) => a.id),
  ]);
  assert.deepEqual(gui, cli);
  assert.deepEqual(
    gui.map((g) => g[0]),
    ['waiting', 'stalled'],
  );
});

test('waitStart and waited agree with the terminal deck', () => {
  for (const a of POPULATION) assert.equal(waitStart(a), cliWaitStart(a));
  for (const ms of [0, 30_000, 60_000, 7 * 60_000, 40 * 60_000, 4 * H + 12 * 60_000, 26 * H, -1]) {
    assert.equal(waited(ms), cliWaited(ms), `waited(${ms})`);
  }
  // The spec's own column, spelled out (§3.2).
  assert.equal(waited(26 * H), '1d 2h');
  assert.equal(waited(4 * H + 12 * 60_000), '4h 12m');
  assert.equal(waited(40 * 60_000), '40m');
});

test('a benched, let-go or working agent is never in the queue', () => {
  const ids = queueOrder(POPULATION).map((a) => a.id);
  for (const id of ['claude-code:z', 'claude-code:y', 'claude-code:x']) {
    assert.ok(!ids.includes(id), `${id} must not be in the queue`);
  }
});

test('a project filter scopes the queue without reordering it', () => {
  const scoped = queueOrder(POPULATION, { projectFilter: 'orbital-api' }).map((a) => a.id);
  assert.deepEqual(scoped, ['claude-code:a', 'claude-code:b']);
});

test('the order is total: the same input always gives the same output', () => {
  const once = queueOrder(POPULATION).map((a) => a.id);
  const shuffled = [...POPULATION].reverse();
  assert.deepEqual(
    queueOrder(shuffled).map((a) => a.id),
    once,
  );
});

// ------------------------------------------------------------- the strip

test('the strip is a role="list" of real buttons, oldest chip first', () => {
  const list = renderStrip(POPULATION, { now: NOW, selectedId: null }, doc);
  assert.equal(list.tagName, 'UL');
  assert.equal(list.getAttribute('role'), 'list');

  const items = list.children;
  assert.equal(items.length, 5);
  for (const item of items) {
    assert.equal(item.tagName, 'LI');
    assert.equal(item.children.length, 1);
    assert.equal(item.children[0].tagName, 'BUTTON');
    assert.equal(item.children[0].getAttribute('type'), 'button');
  }
  // §3.1: the oldest chip is always leftmost. It is first in the DOM, which
  // is also the order a screen reader and the Tab key take them in.
  assert.equal(items[0].getAttribute('data-id'), 'claude-code:a');
  assert.deepEqual(
    items.map((n) => n.getAttribute('data-id')),
    queueOrder(POPULATION).map((a) => a.id),
  );
});

test('a chip carries state icon, elapsed, name and project — and nothing else', () => {
  const list = renderStrip(POPULATION, { now: NOW, selectedId: null }, doc);
  const chip = list.children[0].children[0];
  const text = chip.textContent;
  assert.match(text, /1d 2h/);
  assert.match(text, /Ada/);
  assert.match(text, /orbital-api/);
  assert.match(text, /✓/);
  // The last line is a hover reveal, not chip furniture (§3.1).
  assert.ok(!text.includes('Tests pass'));
});

test('state is never colour alone: every chip spells its state out', () => {
  const list = renderStrip(POPULATION, { now: NOW, selectedId: null }, doc);
  const labels = list.children.map((n) => n.children[0].getAttribute('aria-label'));
  assert.match(labels[0], /^For review, waiting 1d 2h, Ada, orbital-api$/);
  assert.match(labels[1], /^Hands up, waiting 4h 00m, Rune, mobile-app$/);
  assert.match(labels[4], /^Stalled, /);
});

test('past 24 hours the elapsed time reaches for the accent, and not before', () => {
  const list = renderStrip(POPULATION, { now: NOW, selectedId: null }, doc);
  const olds = list.children.map((n) => byClass(n, 'strip-when')[0].className.includes('is-old'));
  assert.deepEqual(olds, [true, false, false, false, true]);
  assert.equal(OLD_MS, 24 * 3_600_000);
});

test('the selected chip is ringed and says so', () => {
  const list = renderStrip(POPULATION, { now: NOW, selectedId: 'claude-code:b' }, doc);
  const chips = list.children.map((n) => n.children[0]);
  const selected = chips.filter((c) => c.getAttribute('aria-current') === 'true');
  assert.equal(selected.length, 1);
  assert.equal(selected[0].getAttribute('data-id'), 'claude-code:b');
  assert.ok(selected[0].className.includes('is-selected'));
});

test('SECURITY: a hostile name or project becomes text, never an element', () => {
  const hostile = [
    agent({
      id: 'claude-code:h',
      displayName: '<script>alert(1)</script>',
      projectName: '<img src=x onerror=alert(2)>',
      lastText: '</td><script>alert(3)</script>',
      reviewSince: T0 - H,
    }),
  ];
  const strip = renderStrip(hostile, { now: NOW }, doc);
  const deck = renderDeckTable(hostile, { now: NOW }, doc);
  for (const root of [strip, deck]) {
    for (const node of all(root)) {
      assert.ok(!['SCRIPT', 'IMG', 'IFRAME'].includes(node.tagName), `created a ${node.tagName}`);
    }
  }
  // The characters survive as characters, cut to the column's width.
  assert.match(strip.textContent, /<script>alert\(1\)/);
});

// -------------------------------------------------------------- the deck

test('the deck is a real table: caption, column headers, row headers, row groups', () => {
  const table = renderDeckTable(POPULATION, { now: NOW, selectedId: null }, doc);
  assert.equal(table.tagName, 'TABLE');

  const caption = byTag(table, 'caption');
  assert.equal(caption.length, 1);
  assert.match(caption[0].textContent, /oldest first/i);

  const heads = byTag(table, 'thead');
  assert.equal(heads.length, 1);
  const columnHeaders = byTag(heads[0], 'th');
  assert.deepEqual(
    columnHeaders.map((th) => th.textContent),
    ['Waiting', 'Who', 'Project', 'Last word', 'Tokens'],
  );
  for (const th of columnHeaders) assert.equal(th.getAttribute('scope'), 'col');

  // Two row groups, in queue order, with the stall in its own — that is the
  // rule in §3.2, drawn without a fake row for a screen reader to read out.
  const bodies = byTag(table, 'tbody');
  assert.deepEqual(
    bodies.map((b) => b.getAttribute('data-group')),
    ['waiting', 'stalled'],
  );
  assert.equal(bodies[1].children.length, 1);

  // Every row has five cells, and WHO is the row header.
  const rows = bodies.flatMap((b) => b.children);
  assert.equal(rows.length, 5);
  for (const tr of rows) {
    assert.equal(tr.tagName, 'TR');
    assert.equal(tr.children.length, 5);
    const rowHeaders = tr.children.filter((c) => c.tagName === 'TH');
    assert.equal(rowHeaders.length, 1);
    assert.equal(rowHeaders[0].getAttribute('scope'), 'row');
    assert.equal(tr.children[1], rowHeaders[0], 'WHO is the row header');
  }
});

test('a screen reader traverses the deck in queue order', () => {
  const table = renderDeckTable(POPULATION, { now: NOW, selectedId: null }, doc);
  const ids = byTag(table, 'tr')
    .map((tr) => tr.getAttribute('data-id'))
    .filter(Boolean);
  assert.deepEqual(
    ids,
    queueOrder(POPULATION).map((a) => a.id),
  );
});

test('a deck row carries the five columns the spec draws', () => {
  const table = renderDeckTable(POPULATION, { now: NOW, selectedId: null }, doc);
  const row = byTag(table, 'tr').find((tr) => tr.getAttribute('data-id') === 'claude-code:a');
  const [waiting, who, project, last, tokens] = row.children;
  assert.match(waiting.textContent, /^1d 2h/);
  assert.match(waiting.textContent, /For review$/); // the sr-only state word
  assert.match(who.textContent, /Ada/);
  assert.match(who.textContent, /MK1\.1/);
  assert.equal(project.textContent, 'orbital-api');
  // A newline in what the agent said is collapsed: a table row is one line.
  assert.equal(
    last.textContent,
    'Done. Tests pass and the change is on the branch. Want me to open the PR?',
  );
  assert.equal(tokens.textContent, '160,000');
});

test('a stalled row says it has gone quiet rather than showing an empty cell', () => {
  const table = renderDeckTable(POPULATION, { now: NOW }, doc);
  const row = byTag(table, 'tr').find((tr) => tr.getAttribute('data-id') === 'claude-code:s');
  assert.match(row.children[3].textContent, /silent/);
});

test('the selected row is the current one, and only one row is', () => {
  const table = renderDeckTable(POPULATION, { now: NOW, selectedId: 'claude-code:s' }, doc);
  const current = byTag(table, 'tr').filter((tr) => tr.getAttribute('aria-current') === 'true');
  assert.equal(current.length, 1);
  assert.equal(current[0].getAttribute('data-id'), 'claude-code:s');
});

test('an empty queue renders an empty table rather than a broken one', () => {
  const table = renderDeckTable([], { now: NOW }, doc);
  assert.equal(byTag(table, 'tbody').length, 0);
  assert.equal(byTag(table, 'th').length, 5); // the column headers still stand
});

// ------------------------------------------------------------- formatting

test('the deck cuts on one line and marks that it cut', () => {
  assert.equal(cut('a\n b   c', 40), 'a b c');
  assert.equal(cut('abcdef', 4), 'abc…');
  assert.equal(cut(null, 4), '');
  assert.equal(groupDigits(1_234_567), '1,234,567');
  assert.equal(groupDigits(0), '0');
});

test('rowLabel is the one sentence a screen reader hears', () => {
  const ada = POPULATION.find((a) => a.id === 'claude-code:a');
  assert.equal(rowLabel(ada, NOW), 'For review, waiting 1d 2h, Ada, orbital-api');
});

// ----------------------------------------------------------- the contract

test('the hint threshold is the spec’s six', () => {
  assert.equal(DECK_HINT_THRESHOLD, 6);
  // And the copy is the spec's, with no second-person fault (§10, `04` §5).
  const src = fs.readFileSync(path.join(PUBLIC, 'deck.js'), 'utf8');
  assert.match(src, /waiting · press Tab for the deck/);
  assert.doesNotMatch(src, /you'?ve left/i);
});

test('the strip and the deck reach neither /api/ack nor the network at all', () => {
  // Comments stripped, the way test/unit/panel-invariant.test.mjs does it:
  // this module's own header names /api/ack in order to say it never calls it.
  const src = fs
    .readFileSync(path.join(PUBLIC, 'deck.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(src, /\/api\//);
  assert.doesNotMatch(src, /fetch\(/);
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|DOMParser/);
});

test('the chip builder is what the strip is built from, so the two cannot drift', () => {
  const ada = POPULATION.find((a) => a.id === 'claude-code:a');
  const alone = buildChip(ada, { now: NOW, selectedId: null }, doc);
  const inList = renderStrip([ada], { now: NOW, selectedId: null }, doc).children[0];
  assert.equal(alone.textContent, inList.textContent);
  assert.equal(alone.children[0].getAttribute('aria-label'), rowLabel(ada, NOW));
});
