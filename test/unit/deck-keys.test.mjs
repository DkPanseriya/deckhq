/**
 * WP-10's acceptance clause, checked: "`J`/`K`/`1`/`2`/`3` work identically in
 * strip, deck and floor" (`docs/plan/06-ENGINEERING-WORKPLAN.md` WP-10).
 *
 * "Identically" is a structural claim, not a behavioural coincidence, so it is
 * checked structurally. There is one queue (`queueOrder`), one rule for which
 * row the keys act on (`queueCursor`), one rule for where `J` and `K` go
 * (`queueStep`), and one keyboard map in `public/app.js` that hands all five
 * keys to those. A second implementation of any of them anywhere is the
 * failure this file exists to catch — the three levels drifting apart is
 * exactly how the strip ends up ringing one agent while the panel shows
 * another.
 *
 * The source-reading half is deliberate. There is no DOM in this suite and
 * standing one up to press a key would test a stub, not the product; what can
 * be tested without one is that the wiring says what it must say, and the
 * pure functions underneath behave.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { queueAnchor, queueCursor, queueOrder, queueStep } from '../../public/deck.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../../public');

/** @param {string} src */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
const read = (name) => stripComments(fs.readFileSync(path.join(PUBLIC, name), 'utf8'));

/**
 * The `handleKeydown` body, comments stripped. WP-22 moved the map out of
 * `app.js` into `app-keys.js`; the map itself is unchanged, so only the file
 * this reads moved with it (`docs/DEVIATIONS.md` §121).
 */
function keyboardMap() {
  const app = read('app-keys.js');
  const start = app.indexOf('function handleKeydown(');
  assert.notEqual(start, -1, 'handleKeydown() not found in app-keys.js');
  const end = app.indexOf('\nfunction ', start + 1);
  return app.slice(start, end === -1 ? undefined : end);
}

// ------------------------------------------------------- the shared rules

const T0 = 1_760_000_000_000;
const QUEUE = [
  { id: 'a', ackState: 'active', activityState: 'for_review', reviewSince: T0 - 5000 },
  { id: 'b', ackState: 'active', activityState: 'needs_input', needsInputSince: T0 - 4000 },
  { id: 'c', ackState: 'active', activityState: 'stalled', lastOutputAt: T0 - 9000 },
];
const ORDER = queueOrder(QUEUE);

test('one rule decides which row every key acts on', () => {
  // The panel's selection wins while it is still in the queue.
  assert.equal(queueCursor(ORDER, 'b', null), 'b');
  // A selection that has left the queue (acknowledged, benched, filtered out)
  // falls back to the deck's own cursor rather than acting on a stale row.
  assert.equal(queueCursor(ORDER, 'gone', 'c'), 'c');
  // With neither, the keys act on the oldest item — so a queue on screen
  // always has something `1`, `2` and `3` can reach.
  assert.equal(queueCursor(ORDER, null, null), 'a');
  assert.equal(queueCursor(ORDER, 'gone', 'also-gone'), 'a');
  // An empty queue has no cursor, and the callers must cope with null.
  assert.equal(queueCursor([], 'a', 'b'), null);
});

test('from nowhere, the first J lands on the oldest item', () => {
  // The bug this pins was live for one screenshot: `cursorFor` already
  // defaults to the oldest, so stepping from IT skipped straight to the
  // second item on the very first press. `queueAnchor` is what tells "nothing
  // is selected" apart from "the oldest is selected".
  assert.equal(queueAnchor(ORDER, null, null), null);
  assert.equal(queueAnchor(ORDER, 'gone', 'also-gone'), null);
  assert.equal(queueStep(ORDER, queueAnchor(ORDER, null, null), 1), ORDER[0].id);
  // And the cursor the number keys use still falls back to the oldest.
  assert.equal(queueCursor(ORDER, null, null), ORDER[0].id);
});

test('J and K clamp rather than wrap', () => {
  assert.equal(queueStep(ORDER, 'a', 1), 'b');
  assert.equal(queueStep(ORDER, 'b', -1), 'a');
  // The queue is a list of debts in age order. Wrapping from the newest back
  // to the oldest makes "keep pressing J" silently start again.
  assert.equal(queueStep(ORDER, ORDER[ORDER.length - 1].id, 1), ORDER[ORDER.length - 1].id);
  assert.equal(queueStep(ORDER, ORDER[0].id, -1), ORDER[0].id);
  // From nowhere, J lands on the oldest and K on the newest.
  assert.equal(queueStep(ORDER, null, 1), ORDER[0].id);
  assert.equal(queueStep(ORDER, null, -1), ORDER[ORDER.length - 1].id);
  assert.equal(queueStep([], null, 1), null);
});

test('the strip, the deck and the floor walk one queue in one order', () => {
  // queueOrder is the only ordering exported, and it is what the floor's J/K
  // read as well: app.js's getNeedsYouQueue is a call to it and nothing else.
  const app = read('app-header.js');
  const start = app.indexOf('function getNeedsYouQueue(');
  const body = app.slice(start, app.indexOf('\nfunction ', start + 1));
  assert.match(body, /return queueOrder\(snapshot\.agents, \{ projectFilter \}\);/);
  assert.doesNotMatch(body, /\.sort\(/, 'a second ordering would let the levels disagree');
});

// ----------------------------------------------------------- the wiring

test('J and K are one call in app.js, whichever level is on screen', () => {
  const map = keyboardMap();
  assert.match(map, /case 'j':\s*case 'J':\s*deckUI\?\.move\(1\);/);
  assert.match(map, /case 'k':\s*case 'K':\s*deckUI\?\.move\(-1\);/);
  // The pre-WP-10 floor-only mover is gone, not merely unused.
  assert.doesNotMatch(read('app.js') + read('app-keys.js'), /function moveNeedsYouQueue\(/);
});

test('1, 2 and 3 reach the panel, and name the deck row when there is one', () => {
  const map = keyboardMap();
  assert.match(
    map,
    /case '1':\s*case '2':\s*case '3':\s*panel\.pressNumberKey\(e\.key, keyTarget\(\)\);/,
  );
});

test('A and B act on the same row the number keys do', () => {
  const map = keyboardMap();
  assert.match(map, /panel\.performAction\('acknowledge', keyTarget\(\)\)/);
  assert.match(map, /panel\.performAction\('bench', keyTarget\(\)\)/);
});

test('keyTarget is the deck cursor in the deck and the panel elsewhere', () => {
  const app = read('app-keys.js');
  const start = app.indexOf('function keyTarget(');
  assert.notEqual(start, -1, 'keyTarget() not found in app-keys.js');
  const body = app.slice(start, app.indexOf('\n}', start) + 2);
  assert.match(body, /deckUI\?\.isOpen\(\) \? deckUI\.cursor\(\) : null/);
});

test('the deck asks the same question the keys do, through one function', () => {
  const deck = read('deck.js');
  // cursorFor() delegates to the exported rule, and nothing in the controller
  // re-derives "the selected one" for itself.
  assert.match(
    deck,
    /function cursorFor\(queue\) \{\s*return queueCursor\(queue, getSelectedId\(\), cursorId\);\s*\}/,
  );
  const controller = deck.slice(deck.indexOf('export function createDeckUI('));
  assert.equal(
    (controller.match(/queueCursor\(/g) || []).length,
    1,
    'the controller asks queueCursor exactly once, inside cursorFor()',
  );
  assert.equal((controller.match(/queueStep\(/g) || []).length, 1, 'and queueStep once, in move()');
});

test('Tab is claimed only where it is not the browser’s to give', () => {
  const map = keyboardMap();
  // A keyboard user must still be able to leave the strip, the header and the
  // panel with Tab; the deck only takes it when focus is on the floor itself.
  assert.match(map, /e\.key === 'Tab' && !e\.shiftKey/);
  assert.match(map, /closest\?\.\('\.stage'\)/);
  assert.match(map, /if \(!onFloor\) return;/);
  assert.match(map, /deckUI\?\.toggle\(\)/);
});

test('Enter opens a deck row and does nothing on the floor', () => {
  const map = keyboardMap();
  assert.match(map, /e\.key === 'Enter' && deckUI\?\.isOpen\(\)/);
  assert.match(map, /deckUI\.openCursor\(\)/);
});

// ------------------------------------------------------- the invariant

test('INVARIANT: the deck acts through the panel and never touches /api/ack', () => {
  const deck = read('deck.js');
  assert.doesNotMatch(deck, /\/api\//);
  assert.doesNotMatch(deck, /performAction/);
  assert.doesNotMatch(deck, /pressNumberKey/);
  // Everything the strip and the deck do to the world goes out through one
  // callback, which app.js points at selectAgent — a read.
  const controller = deck.slice(deck.indexOf('export function createDeckUI('));
  const calls = controller.match(/onSelect\(/g) || [];
  assert.ok(calls.length >= 3, 'the chip click, the row click and the cursor move');
});

test('the panel accepts a target row without opening it', () => {
  const panel = read('panel.js');
  assert.match(panel, /async function performAction\(action, targetId\)/);
  assert.match(panel, /function pressNumberKey\(key, targetId\)/);
  // `1 Reply` is the one that has to open: a reply needs somewhere to type,
  // and the composer is in the panel.
  const press = panel.slice(
    panel.indexOf('function pressNumberKey('),
    panel.indexOf('function focusComposer('),
  );
  const caseOne = press.slice(press.indexOf("case '1'"), press.indexOf("case '2'"));
  assert.match(caseOne, /if \(id !== currentId\) open\(id\);/);
  // `3` acts on whatever row was named, open or not.
  assert.match(press.slice(press.indexOf("case '3'")), /performAction\(thirdAction\(agent\), id\)/);
});
