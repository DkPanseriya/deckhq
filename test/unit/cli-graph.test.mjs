/**
 * `src/cli/` has no import cycle, and the offers still say what they said —
 * WP-92i, `docs/plan/13-ARCHITECTURE-AUDIT.md` A-07.
 *
 * `app.mjs → pin.mjs → shortcut.mjs → app.mjs`: three commands that each offer
 * the next, and the third reaching back for `BIN`. Benign — every edge is read
 * inside a function body, and an ES module cycle resolves as long as nothing in
 * it reads an imported binding while the module is still evaluating — but
 * nothing in the toolchain said it was there, and "benign" is a property
 * somebody has to re-establish by reading every edge each time one is added.
 * This says it instead.
 *
 * THE GRAPH IS BUILT THE WAY THE AUDIT BUILT ITS OWN. Comments are stripped
 * first, so a JSDoc `import('./x.mjs')` in a type position is not counted as an
 * edge — it is not one; it produces no code. What is counted is every static
 * `import`, every `export … from` and every dynamic `import()` with a literal
 * specifier, because all three are edges a reader has to follow and all three
 * are edges the module graph really has.
 *
 * The second half of the file is the wording. WP-92i moved four strings and two
 * functions out of `pin.mjs` into `offers.mjs`; the whole promise of the move is
 * that a user sees exactly what they saw before, so every one of those strings
 * is written out here in full. A change to any of them fails on the string
 * rather than on a diff nobody reads.
 */
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// WP-92m moved the three functions this file used to declare — the comment
// stripper, the specifier scanner and the cycle detector — into a helper, so
// that `client-graph.test.mjs` can ask `public/` the same question without
// importing a test file and running its tests twice. Not one line of any of
// the three changed. Every assertion below is WP-92i's, untouched.
import { findCycle, graphOf, specifiersOf, stripComments } from '../helpers/module-graph.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'cli');

/** The `src/cli/` graph: module basename -> the siblings it names. */
const cliGraph = () => graphOf(CLI, '.mjs');

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

test('src/cli/ has no import cycle', async () => {
  const graph = await cliGraph();
  assert.ok(
    graph.size >= 15,
    `the walk found only ${graph.size} modules — is it looking at src/cli?`,
  );
  const cycle = findCycle(graph);
  assert.equal(cycle, null, cycle ? `src/cli/ has a cycle: ${cycle.join(' -> ')}` : 'unreachable');
});

test('the three offering commands form a chain, and nothing offers back', async () => {
  const graph = await cliGraph();
  // The direction of the story: `app` offers the pin, the pin delegates the
  // writing to `shortcut`. Neither of the last two reaches back.
  assert.ok(graph.get('app.mjs')?.includes('pin.mjs'), 'app must still make the offer');
  assert.ok(graph.get('pin.mjs')?.includes('shortcut.mjs'), 'the pin must still delegate');
  assert.equal(graph.get('shortcut.mjs')?.includes('app.mjs'), false);
  assert.equal(graph.get('shortcut.mjs')?.includes('pin.mjs'), false);
  assert.equal(graph.get('pin.mjs')?.includes('app.mjs'), false);
  // And the module they share shares nothing of `src/cli/`'s, which is what
  // makes it incapable of closing a cycle with any of them.
  assert.deepEqual(graph.get('offers.mjs'), []);
});

test('the cycle detector finds a cycle when there is one', () => {
  // The gate's own proof. Without this, "no cycle" and "no detector" look the
  // same from the outside.
  const none = new Map([
    ['a.mjs', ['b.mjs']],
    ['b.mjs', ['c.mjs']],
    ['c.mjs', []],
  ]);
  assert.equal(findCycle(none), null);
  const three = new Map([
    ['a.mjs', ['b.mjs']],
    ['b.mjs', ['c.mjs']],
    ['c.mjs', ['a.mjs']],
  ]);
  assert.deepEqual(findCycle(three), ['a.mjs', 'b.mjs', 'c.mjs', 'a.mjs']);
  const self = new Map([['a.mjs', ['a.mjs']]]);
  assert.deepEqual(findCycle(self), ['a.mjs', 'a.mjs']);
});

test('a comment is not an edge, and a string is not a comment', () => {
  // Why the stripper exists: the audit's own graph counted a JSDoc
  // `import('./x.mjs')` as an edge until it stripped comments, and thirteen
  // `plan*.js` modules looked like one cycle because of it.
  assert.deepEqual(specifiersOf("/** @type {import('./app.mjs').X} */\nlet a;"), []);
  assert.deepEqual(specifiersOf("// import { x } from './app.mjs';\nlet a;"), []);
  assert.deepEqual(specifiersOf("import { x } from './app.mjs';"), ['./app.mjs']);
  assert.deepEqual(specifiersOf("const { x } = await import('./pin.mjs');"), ['./pin.mjs']);
  assert.deepEqual(specifiersOf("export { x } from './offers.mjs';"), ['./offers.mjs']);
  assert.equal(stripComments("const s = 'a // b';").includes('// b'), true);
});

// ---------------------------------------------------------------------------
// The wording. Every string WP-92i moved, in full.
// ---------------------------------------------------------------------------

test('every offer says exactly what it said before the move', async () => {
  const offers = await import('../../src/cli/offers.mjs');

  assert.equal(offers.PIN_QUESTION, 'Put DeckHQ on your Desktop and Start Menu? [y/N] ');
  assert.equal(offers.PIN_FLAG, 'pinOffered');
  assert.equal(
    offers.PIN_HINT,
    '  An icon for this: `deckhq shortcut --install --yes` — Desktop and Start Menu,\n' +
      '  removable with `deckhq shortcut --remove --yes`.\n',
  );
  assert.equal(
    offers.PIN_DECLINED,
    '  This is not asked again. `deckhq shortcut --install` whenever you want it.\n\n',
  );
});

test('what counts as a yes has not moved either', async () => {
  const { isYes } = await import('../../src/cli/offers.mjs');
  for (const yes of ['y', 'Y', 'yes', 'YES', ' yes ', 'Yes']) assert.equal(isYes(yes), true, yes);
  for (const no of ['', ' ', 'n', 'no', 'yep', 'yes please', null, undefined, 0, 'ye'])
    assert.equal(isYes(no), false, String(no));
});

test('the offer text lives in one module and no other', async () => {
  // A second copy of the question is the state A-07 was about, one level down:
  // three commands agreeing by having each written it out.
  //
  // Comments first, for the same reason the graph strips them: `pin.mjs`'s
  // header quotes the question in prose, which is documentation of the offer
  // rather than a second implementation of it.
  const files = (await readdir(CLI)).filter((f) => f.endsWith('.mjs'));
  /** @type {string[]} */
  const carriers = [];
  for (const file of files) {
    const code = stripComments(await readFile(path.join(CLI, file), 'utf8'));
    if (code.includes('Put DeckHQ on your Desktop and Start Menu?')) carriers.push(file);
  }
  assert.deepEqual(carriers, ['offers.mjs']);
});
