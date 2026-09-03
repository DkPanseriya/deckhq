/**
 * One key, two features: `S`.
 *
 * WP-14 binds `S` to the office snapshot and `Shift+S` to the redaction
 * toggle, both in `public/app.js`. WP-19 binds `A`/`D`/`S` to the permission
 * card's Allow / Deny / Allow for session, in `public/panel.js`. Nothing in
 * either package knew about the other, and "whichever listener happens to be
 * registered first wins" is not a rule anybody can read off the screen.
 *
 * So the rule is written down as one pure function, `permissionKeyDecision()`,
 * and this file walks it. The precedence:
 *
 *   - the card takes `S` only while it is genuinely answerable — panel open on
 *     an agent, a pending request the runtime did not mark
 *     `requiresUserInteraction`, no text control focused, no modal dialog, and
 *     a session-scoped suggestion to send back;
 *   - otherwise `S` is the snapshot;
 *   - `Shift+S` is the redaction toggle always, card or no card.
 *
 * The second half reads `public/app.js` and `public/panel.js` as source, the
 * way `deck-keys.test.mjs` does: there is no DOM here, and standing one up to
 * press a key would test a stub rather than the product. What can be checked
 * without one is that the wiring says what it must say.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { permissionKeyDecision } from '../../public/panel.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../../public');
/** @param {string} src */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
const read = (name) => stripComments(fs.readFileSync(path.join(PUBLIC, name), 'utf8'));

/** A pending permission with a session-scoped rule to offer. */
const PENDING = {
  id: 'req-1',
  tool: 'Bash',
  summary: 'rm -rf build',
  suggestions: [{ destination: 'session' }],
};

/** The context in which the card really is answerable. */
const ANSWERABLE = { panelOpen: true, typing: false, dialogOpen: false, pending: PENDING };

const press = (key, o = {}) => permissionKeyDecision({ key, ...o }, { ...ANSWERABLE, ...o.ctx });

// -------------------------------------------------------- the card's keys

test('A, D and S answer the card while it is answerable', () => {
  assert.equal(press('a'), 'allow');
  assert.equal(press('A'), 'allow');
  assert.equal(press('d'), 'deny');
  assert.equal(press('D'), 'deny');
  assert.equal(press('s'), 'session');
  assert.equal(press('S'), 'session');
});

test('every other key is somebody else’s', () => {
  for (const key of ['b', 'B', 'g', 'j', 'k', '1', '2', '3', 'Tab', 'Enter', 'Escape']) {
    assert.equal(press(key), null, `${key} must not answer the permission card`);
  }
});

// ------------------------------------------------------ the S precedence

test('S is the office snapshot whenever there is no card to answer', () => {
  // The whole floor's normal state: nothing is asking permission.
  assert.equal(press('s', { ctx: { pending: null } }), null);
  assert.equal(press('s', { ctx: { pending: undefined } }), null);
  // A closed panel has no card on screen, so `S` is the snapshot even though
  // the request exists on the snapshot.
  assert.equal(press('s', { ctx: { panelOpen: false } }), null);
  // The composer has focus: `S` is a letter being typed, and neither feature
  // may take it. app.js's own handler is inert here for the same reason.
  assert.equal(press('s', { ctx: { typing: true } }), null);
  // A modal dialog is over the top of both.
  assert.equal(press('s', { ctx: { dialogOpen: true } }), null);
});

test('a request the runtime says must be answered in the terminal keeps its hands off S', () => {
  // `requiresUserInteraction` means DeckHQ may not answer it at all — the card
  // renders as a note, not as buttons — so `S` stays the snapshot.
  const pending = { ...PENDING, requiresUserInteraction: true };
  assert.equal(press('s', { ctx: { pending } }), null);
  assert.equal(press('a', { ctx: { pending } }), null);
  assert.equal(press('d', { ctx: { pending } }), null);
});

test('with no session-scoped suggestion there is no third button, and S is the snapshot', () => {
  // Allow and Deny are still the card's; only `S` falls through. This is the
  // one case where the three keys disagree with each other.
  for (const suggestions of [undefined, null, [], 'nope']) {
    const ctx = { pending: { ...PENDING, suggestions } };
    assert.equal(press('s', { ctx }), null, `suggestions=${JSON.stringify(suggestions)}`);
    assert.equal(press('a', { ctx }), 'allow');
    assert.equal(press('d', { ctx }), 'deny');
  }
});

test('Shift+S is the redaction toggle, card or no card', () => {
  // The one that would be silently wrong: a permission card up, the user
  // reaching for redaction, and getting "allowed for this session" instead.
  assert.equal(press('S', { shiftKey: true }), null);
  assert.equal(press('s', { shiftKey: true }), null);
  // And shift is never the card's on the other two either.
  assert.equal(press('A', { shiftKey: true }), null);
  assert.equal(press('D', { shiftKey: true }), null);
});

test('a browser or OS chord is nobody’s', () => {
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
    assert.equal(press('s', { [mod]: true }), null);
    assert.equal(press('a', { [mod]: true }), null);
  }
});

test('nothing is decided from a missing event or a missing context', () => {
  assert.equal(permissionKeyDecision(null, ANSWERABLE), null);
  assert.equal(permissionKeyDecision({ key: 's' }, null), null);
});

// ------------------------------------------------------------ the wiring

test('the panel’s listener asks the rule and does nothing else', () => {
  const panel = read('panel.js');
  // One decision point. A second `switch (e.key)` in the listener is how the
  // two implementations drift apart again.
  assert.match(panel, /const decision = permissionKeyDecision\(e, \{/);
  assert.match(panel, /if \(!decision\) return;/);
  // It yields the event when the rule says null — that is what lets app.js's
  // `S` reach the snapshot — and claims it when the rule says otherwise.
  assert.match(panel, /e\.stopImmediatePropagation\(\);\s*\n\s*answerPermission\(decision\);/);
  assert.equal(
    (panel.match(/permissionKeyDecision\(/g) || []).length,
    2,
    'declared once, called once',
  );
});

test('app.js still owns S and Shift+S, and reads shift explicitly', () => {
  const app = read('app.js');
  const start = app.indexOf('function handleKeydown(');
  assert.notEqual(start, -1, 'handleKeydown() not found in app.js');
  const map = app.slice(start, app.indexOf('\nfunction ', start + 1));
  assert.match(map, /case 's':\s*case 'S':/);
  // The shift key is read from the event rather than inferred from the case of
  // `e.key`, so caps lock does not silently swap the two.
  //
  // WP-18 added the third branch: with the day's card up, `S` saves the CARD
  // (plus a small photograph of the floor) rather than the floor alone. The
  // order matters and is asserted — `Shift+S` is still redaction whatever is
  // on screen, and the card only intercepts the unshifted key.
  assert.match(
    map,
    /if \(e\.shiftKey\) toggleRedaction\(\);[\s\S]*?else if \(openCard\) saveCard\(\);[\s\S]*?else takeSnapshot\(\);/,
  );
});

test('the keys WP-10, WP-19, WP-50 and WP-14 each brought all still have a home', () => {
  const app = read('app.js');
  const start = app.indexOf('function handleKeydown(');
  const map = app.slice(start, app.indexOf('\nfunction ', start + 1));
  // WP-10's deck and queue.
  assert.match(map, /e\.key === 'Tab' && !e\.shiftKey/);
  assert.match(map, /case 'j':\s*case 'J':/);
  assert.match(map, /case 'k':\s*case 'K':/);
  assert.match(map, /case '1':\s*case '2':\s*case '3':/);
  // WP-50's gone-home walk.
  assert.match(map, /case 'g':\s*case 'G':\s*selectNextGoneHome\(\);/);
  // WP-14's snapshot.
  assert.match(map, /takeSnapshot\(\)/);
  // WP-19's A and D reach the card through the panel's own listener, not
  // through this map; `A` is here as acknowledge and `D` is not here at all.
  assert.match(map, /panel\.performAction\('acknowledge', keyTarget\(\)\)/);
  assert.doesNotMatch(map, /case 'd':/);
});
