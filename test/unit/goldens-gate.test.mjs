/**
 * The goldens gate's decision, without a browser.
 *
 * `scripts/goldens.mjs` needs Chrome and a demo daemon per capture, so the rule
 * at the end of it was never reachable from a test — and that rule was the bug:
 * a capture with no golden on this platform was a FAILURE whenever the platform
 * directory existed, so the partial linux set (6 of 16) made the ubuntu job red
 * on every push for a reason that has nothing to do with a pixel. The rule now
 * lives in `scripts/lib/goldens-gate.mjs` and this is what holds it.
 *
 * DEVIATIONS §180, audit finding A-01.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { EXIT_MISMATCH, EXIT_NOT_BAKED, decide } from '../../scripts/lib/goldens-gate.mjs';

/** @param {Record<string, import('../../scripts/lib/goldens-gate.mjs').Outcome>} map */
const verdictsOf = (map) =>
  Object.entries(map).map(([name, outcome]) => ({ name, outcome: outcome }));

/** The shape linux is actually in: some baked, the rest not, nothing disagreeing. */
const PARTIAL = verdictsOf({
  demo: 'match',
  empty: 'match',
  reference: 'match',
  single: 'match',
  crew: 'missing',
  look: 'missing',
  wide: 'missing',
});

test('a partial set separates matched, missing and failed', () => {
  const { matched, missing, failed } = decide(PARTIAL, { platform: 'linux' });
  assert.deepEqual(matched, ['demo', 'empty', 'reference', 'single']);
  assert.deepEqual(missing, ['crew', 'look', 'wide']);
  assert.deepEqual(failed, []);
});

test('a missing golden is not a failure, and the summary names every one of them', () => {
  const verdict = decide(PARTIAL, { platform: 'linux' });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.exitCode, 0);
  assert.match(verdict.headline, /4 match/);
  assert.match(verdict.headline, /3 of 7 NOT YET BAKED on linux/);
  for (const name of ['crew', 'look', 'wide']) assert.match(verdict.headline, new RegExp(name));
});

test('--strict turns the same partial set into a named non-zero exit', () => {
  const verdict = decide(PARTIAL, { platform: 'linux', strict: true });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.exitCode, EXIT_NOT_BAKED);
  assert.notEqual(EXIT_NOT_BAKED, 0);
  assert.match(verdict.headline, /--strict/);
  // Still not a pixel failure: nothing disagreed with anything.
  assert.deepEqual(verdict.failed, []);
});

test('a golden that exists and disagrees stays red, strict or not', () => {
  const disagreeing = [...PARTIAL, { name: 'three', outcome: /** @type {const} */ ('fail') }];
  for (const strict of [false, true]) {
    const verdict = decide(disagreeing, { platform: 'linux', strict });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.exitCode, EXIT_MISMATCH);
    assert.deepEqual(verdict.failed, ['three']);
    assert.match(verdict.headline, /1 of 8 failed \(three\)/);
  }
});

test('a complete, matching set says so and exits 0 — the win32 line', () => {
  const all = verdictsOf(
    Object.fromEntries(
      ['demo', 'empty', 'single', 'three', 'pinned', 'reference'].map((n) => [n, 'match']),
    ),
  );
  const verdict = decide(all, { platform: 'win32' });
  assert.equal(verdict.headline, 'all 6 match');
  assert.equal(verdict.exitCode, 0);
  assert.deepEqual(verdict.missing, []);
});

test('a platform with no set at all says nothing was compared, and is not a failure', () => {
  const none = verdictsOf({ demo: 'missing', empty: 'missing' });
  const verdict = decide(none, { platform: 'darwin' });
  assert.equal(verdict.exitCode, 0);
  assert.match(verdict.headline, /nothing to compare against/);
  assert.match(verdict.headline, /2 of 2 NOT YET BAKED on darwin/);
  assert.equal(verdict.matched.length, 0);
});

test('an empty run is not a pass claiming to be one', () => {
  // Nothing was photographed at all — every capture was unproven, which
  // `goldens.mjs` reports separately. The verdict must not invent a match.
  const verdict = decide([], { platform: 'linux' });
  assert.equal(verdict.headline, 'all 0 match');
  assert.equal(verdict.exitCode, 0);
});
