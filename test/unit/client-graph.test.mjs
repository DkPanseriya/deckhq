/**
 * `public/` has one import cycle left, and it is the documented one —
 * WP-92m, `docs/plan/13-ARCHITECTURE-AUDIT.md` A-07 and A-12.
 *
 * A-07 named three cycles. WP-92i closed the CLI's. This closes the second:
 * `public/deck.js` ↔ `public/usage.js`, where the deck reached into the Usage
 * tab's three exports and the Usage tab reached back for two text helpers.
 * WP-92m split `deck.js` at the seam the file had already drawn for itself and
 * both arms now point at `deck-view.js`, which imports nothing but the clock.
 *
 * The third — `settings-ui.js` ↔ `settings-ui-rates.js` — STAYS, because
 * A-07 says it stays: it is §131's documented shape-3 split, where the part
 * calls back into the closure through a `wire()`, and there is no way to take
 * that edge out without giving the part its own copy of the closure's state.
 * It is named below rather than excused by silence, so a SECOND cycle of that
 * shape cannot arrive unnoticed.
 *
 * The graph is built the way the audit built its own: comments stripped first,
 * so a JSDoc `import('./x.js')` in a type position is not counted as an edge.
 * `public/render/` is walked as its own directory for the same reason
 * `src/cli/` is — a specifier that leaves a directory cannot close a cycle
 * inside it.
 */
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findCycle, graphOf } from '../helpers/module-graph.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const RENDER = path.join(PUBLIC, 'render');

/** The one cycle A-07 leaves in place, as the path that closes it. */
const DOCUMENTED = ['settings-ui.js', 'settings-ui-rates.js', 'settings-ui.js'];

test('public/ has no import cycle but the documented settings pair', async () => {
  const graph = await graphOf(PUBLIC, '.js');
  assert.ok(
    graph.size >= 55,
    `the walk found only ${graph.size} modules — is it looking at public/?`,
  );
  // Take the documented pair's one edge out and the shell must be acyclic.
  const without = new Map(graph);
  without.set(
    'settings-ui-rates.js',
    (graph.get('settings-ui-rates.js') || []).filter((f) => f !== 'settings-ui.js'),
  );
  const cycle = findCycle(without);
  assert.equal(cycle, null, cycle ? `public/ has a cycle: ${cycle.join(' -> ')}` : 'unreachable');
});

test('the settings pair is still the only one, and still points both ways', async () => {
  // If this ever stops failing-to-be-absent, the exemption above is stale and
  // the test that uses it is excusing a cycle nobody meant to keep.
  const graph = await graphOf(PUBLIC, '.js');
  assert.deepEqual(findCycle(graph), DOCUMENTED);
});

test('INVARIANT A-07: the deck and the Usage tab no longer point at each other', async () => {
  const graph = await graphOf(PUBLIC, '.js');
  // One direction only: the deck's controller reaches the Usage tab.
  assert.ok(graph.get('deck.js')?.includes('usage.js'), 'the deck must still own the Usage tab');
  assert.equal(graph.get('usage.js')?.includes('deck.js'), false, 'usage.js reaches back again');
  // And what both of them need is below both of them, reaching neither.
  assert.ok(graph.get('deck.js')?.includes('deck-view.js'));
  assert.ok(graph.get('usage.js')?.includes('deck-view.js'));
  assert.deepEqual(
    (graph.get('deck-view.js') || []).filter((f) => f === 'deck.js' || f === 'usage.js'),
    [],
    'deck-view.js must import neither of the two modules that import it',
  );
});

test('public/render/ has no import cycle', async () => {
  // Fifty-eight modules and the audit's one false positive: thirteen `plan*.js`
  // modules looked like a cycle until the graph stopped counting JSDoc.
  const graph = await graphOf(RENDER, '.js');
  assert.ok(graph.size >= 50, `the walk found only ${graph.size} modules under render/`);
  const cycle = findCycle(graph);
  assert.equal(
    cycle,
    null,
    cycle ? `public/render/ has a cycle: ${cycle.join(' -> ')}` : 'unreachable',
  );
});

test('no public/ module imports anything from src/', async () => {
  // §122's absolute rule, and A-07's graph is the cheapest place to assert it:
  // the browser is never given a Node module.
  for (const dir of [PUBLIC, RENDER]) {
    const graph = await graphOf(dir, '.js');
    for (const [file, edges] of graph) {
      for (const edge of edges) {
        assert.ok(!edge.includes('src/'), `${file} imports ${edge}`);
      }
    }
  }
});
