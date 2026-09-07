/**
 * The injectable clock, both halves of it (WP-63).
 *
 * `src/core/clock.mjs` is what the daemon reads instead of `Date.now()`
 * wherever a model timestamp is produced or compared, and `public/clock.js` is
 * what the browser reads instead of `Date.now()` wherever an age is drawn. The
 * two are tested together because the contract between them is one sentence —
 * the daemon serves `now` and says with `nowFixed` whether it is pinned — and
 * a test that only checked one end could not see it break.
 *
 * The load-bearing assertion is the NEGATIVE one: with nothing set, both
 * clocks are `Date.now()` and nothing else. An override that quietly changed
 * behaviour on every machine that has never heard of it would be a far worse
 * bug than the drifting goldens it was written to fix.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';

import { CLOCK_ENV, fixedNow, isFixed, now, parseInstant } from '../../src/core/clock.mjs';
import { adoptSnapshotClock, isPinned, now as clientNow } from '../../public/clock.js';

/** Run `fn` with `DECKHQ_NOW` set to `value` (or unset for `null`), then put it back. */
function withEnv(value, fn) {
  const before = process.env[CLOCK_ENV];
  if (value === null) delete process.env[CLOCK_ENV];
  else process.env[CLOCK_ENV] = value;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env[CLOCK_ENV];
    else process.env[CLOCK_ENV] = before;
  }
}

// ------------------------------------------------------------- the daemon

test('with no override the clock is the wall clock, to within a second', () => {
  withEnv(null, () => {
    assert.equal(isFixed(), false);
    assert.equal(fixedNow(), null);
    const drift = Math.abs(now() - Date.now());
    assert.ok(drift < 1000, `the unpinned clock was ${drift}ms from the wall clock`);
  });
});

test('DECKHQ_NOW pins the clock to exactly that instant', () => {
  const iso = '2026-09-01T09:00:00Z';
  withEnv(iso, () => {
    assert.equal(isFixed(), true);
    assert.equal(fixedNow(), Date.parse(iso));
    assert.equal(now(), Date.parse(iso));
    // Twice, with real time passing in between: pinned means pinned.
    assert.equal(now(), now());
  });
});

test('the override is re-read, so one process can hold two instants', () => {
  // This is what `test/integration/demo-clock.test.mjs` leans on, and what a
  // module that resolved the environment once at load could not do.
  const a = withEnv('2026-09-01T09:00:00Z', now);
  const b = withEnv('2026-09-02T09:00:00Z', now);
  assert.equal(b - a, 86_400_000);
  withEnv(null, () => assert.equal(isFixed(), false));
});

test('an unreadable or blank override is ignored, not obeyed', () => {
  for (const bad of ['', '   ', 'tomorrow', 'yesterday afternoon', 'NaN']) {
    withEnv(bad, () => {
      assert.equal(isFixed(), false, `${JSON.stringify(bad)} was accepted as an instant`);
      assert.ok(Math.abs(now() - Date.now()) < 1000);
    });
  }
});

test('parseInstant answers null for everything it cannot read', () => {
  assert.equal(parseInstant(undefined), null);
  assert.equal(parseInstant(null), null);
  assert.equal(parseInstant(''), null);
  assert.equal(parseInstant('  '), null);
  assert.equal(parseInstant('not a date'), null);
  assert.equal(parseInstant('2026-09-01T09:00:00Z'), Date.parse('2026-09-01T09:00:00Z'));
  // Surrounding whitespace is a shell's doing, not the caller's mistake.
  assert.equal(parseInstant(' 2026-09-01T09:00:00Z '), Date.parse('2026-09-01T09:00:00Z'));
});

// ------------------------------------------------------------- the browser

test('the client clock is Date.now() until a snapshot pins it', () => {
  adoptSnapshotClock(null);
  assert.equal(isPinned(), false);
  assert.ok(Math.abs(clientNow() - Date.now()) < 1000);

  // A snapshot from a daemon that carries no clock at all — an older build,
  // or any surface that hands the client a hand-built object.
  adoptSnapshotClock({ agents: [] });
  assert.equal(isPinned(), false);
  assert.ok(Math.abs(clientNow() - Date.now()) < 1000);
});

test('a LIVE now does not freeze the client, and a pinned one does', () => {
  // The distinction the whole design rests on. A live `now` is a sample that
  // is already stale when it arrives and goes on ageing until the next push,
  // so freezing on it would stop the panel's per-second waiting line.
  const live = Date.now() - 4000;
  adoptSnapshotClock({ now: live, nowFixed: false });
  assert.equal(isPinned(), false);
  assert.ok(Math.abs(clientNow() - Date.now()) < 1000, 'a live now froze the client clock');

  const pinned = Date.parse('2026-09-01T09:00:00Z');
  adoptSnapshotClock({ now: pinned, nowFixed: true });
  assert.equal(isPinned(), true);
  assert.equal(clientNow(), pinned);
  assert.equal(clientNow(), clientNow());

  // And it lets go again when the next snapshot is not pinned, so a tab does
  // not have to be reloaded to come back to the real clock.
  adoptSnapshotClock({ now: Date.now(), nowFixed: false });
  assert.equal(isPinned(), false);
});

test('a pinned flag with no readable instant pins nothing', () => {
  for (const bad of [undefined, null, 'soon', NaN]) {
    adoptSnapshotClock({ now: bad, nowFixed: true });
    assert.equal(isPinned(), false, `now=${String(bad)} was accepted`);
  }
  adoptSnapshotClock(null);
});
