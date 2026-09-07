/**
 * The goldens' clock, proved against the thing the goldens photograph (WP-63).
 *
 * `docs/DEVIATIONS.md` §87 claims "every fixture value is a pure function of
 * the population name". §144's goldens note is the receipt for that claim
 * being false: seven populations failed `goldens:check` identically before and
 * after a package that touched nothing on the canvas, and the diff was two age
 * strings. Ages were `Date.now() - ageHours`, so a committed PNG matched only
 * on the day it was captured.
 *
 * This is the test that says it is true now. It runs the real
 * `scripts/demo-floor.mjs` — the same child the goldens harness spawns, real
 * fixture on disk, real daemon, real state machine — twice, at two pinned
 * instants A DAY APART, and asserts the two snapshots are the same floor:
 * identical once every timestamp is expressed relative to the snapshot's own
 * `now`, which is exactly the quantity every age on the screen is drawn from.
 *
 * And the negative, which matters more: with nothing set, the daemon's `now`
 * is the wall clock and `nowFixed` is false, so no machine that has never
 * heard of `DECKHQ_NOW` behaves differently than it did before.
 *
 * `three` is the population, not `demo`: it is the smallest floor with several
 * rooms, every state, and no two sessions of the same age, and it is already a
 * committed golden (`wide`). Two daemon boots is the price of this proof; a
 * unit test over the fixture builder could not have caught the ages, because
 * they are computed in the client from fields the daemon puts in the snapshot.
 */
// First, and before anything under `src/`: it moves the machine.
import { HOME as SANDBOX } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEMO = path.join(ROOT, 'scripts', 'demo-floor.mjs');

const EPOCH_A = '2026-09-01T09:00:00Z';
const EPOCH_B = '2026-09-02T09:00:00Z';

/** How long the child gets to print its URL before this is an environment problem. */
const BOOT_MS = 60_000;

/**
 * Boot one demo floor, ask it for `/api/state`, and stop it.
 *
 * The child is spawned rather than imported for the reason the goldens harness
 * spawns it: `demo-floor.mjs` is a script with top-level effects that points
 * `CLAUDE_CONFIG_DIR` and `DECKHQ_STATE_DIR` at a fixture and never puts them
 * back. A process of its own is the only honest way to run it twice.
 *
 * @param {string|null} pinned an ISO instant for `DECKHQ_NOW`, or null for the real clock
 * @returns {Promise<any>} the snapshot `GET /api/state` answered with
 */
async function floorSnapshot(pinned) {
  const env = { ...process.env };
  if (pinned) env.DECKHQ_NOW = pinned;
  else delete env.DECKHQ_NOW;

  const child = spawn(process.execPath, [DEMO, '--population', 'three', '--port', '0'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });

  /** @type {() => Promise<void>} */
  const stop = () =>
    new Promise((done) => {
      if (child.exitCode != null) return done();
      const give = setTimeout(done, 8000);
      if (typeof give.unref === 'function') give.unref();
      child.once('exit', () => {
        clearTimeout(give);
        done();
      });
      try {
        child.kill();
      } catch {
        done();
      }
    });

  try {
    const url = await new Promise((resolve, reject) => {
      let out = '';
      let err = '';
      const timer = setTimeout(
        () => reject(new Error(`demo floor did not start in ${BOOT_MS}ms\n${out}\n${err}`)),
        BOOT_MS,
      );
      if (typeof timer.unref === 'function') timer.unref();
      child.stdout.on('data', (b) => {
        out += String(b);
        const match = out.match(/https?:\/\/\S+/);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
      child.stderr.on('data', (b) => {
        err += String(b);
      });
      // `close`, not `exit`: on Windows `exit` can fire before the child's
      // stderr has drained, which is how §87 lost the one message that
      // explained a failure.
      child.on('close', (code) => {
        clearTimeout(timer);
        reject(new Error(`demo floor exited ${code} before printing a URL\n${out}\n${err}`));
      });
    });
    const res = await fetch(new URL('api/state', url));
    assert.equal(res.status, 200);
    return await res.json();
  } finally {
    await stop();
  }
}

/**
 * Every timestamp in a snapshot, expressed relative to that snapshot's own
 * clock. This is the shape the FLOOR is drawn from: nothing on the screen
 * shows an epoch, it shows `now - reviewSince` and the like.
 *
 * The rule is deliberately structural rather than a list of field names — a
 * list would go stale the first time somebody adds a timestamp, and going
 * stale would mean this test silently stopped covering it. Any integer past
 * the year 2001 in milliseconds is a timestamp; nothing else in a snapshot is
 * that large (the fattest token count on this floor is about three million).
 *
 * @param {any} value
 * @param {number} now
 * @returns {any}
 */
function relativeTo(value, now) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 1_000_000_000_000 ? value - now : value;
  }
  if (Array.isArray(value)) return value.map((v) => relativeTo(v, now));
  if (value && typeof value === 'object') {
    /** @type {Record<string, any>} */
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = relativeTo(value[key], now);
    return out;
  }
  return value;
}

test('a pinned demo floor is the same floor a day later', async () => {
  const a = await floorSnapshot(EPOCH_A);
  const b = await floorSnapshot(EPOCH_B);

  // The daemon served the instant it was given, and said it was pinned.
  assert.equal(a.now, Date.parse(EPOCH_A), 'the snapshot did not carry the pinned clock');
  assert.equal(b.now, Date.parse(EPOCH_B));
  assert.equal(a.nowFixed, true);
  assert.equal(b.nowFixed, true);
  assert.equal(b.now - a.now, 86_400_000, 'the two runs were not a day apart');

  // The floor itself is there — a test that passed over two empty snapshots
  // would prove nothing at all.
  assert.ok(a.agents.length >= 9, `the fixture came up with ${a.agents.length} agents`);
  assert.ok(a.projects.length >= 3);
  assert.ok(
    a.agents.some((x) => x.reviewSince),
    'nobody is waiting on this floor, so no age was compared',
  );

  // And it is the same floor: every timestamp sits at the same distance from
  // `now`, so every string the client formats out of one is the same string.
  assert.deepEqual(
    relativeTo(b, b.now),
    relativeTo(a, a.now),
    'the demo floor moved when only the clock did',
  );
});

test('with no override the daemon serves the wall clock and pins nothing', async () => {
  const snap = await floorSnapshot(null);
  assert.notEqual(snap.nowFixed, true, 'an unpinned daemon claimed a pinned clock');
  const drift = Math.abs(snap.now - Date.now());
  assert.ok(drift < 1000, `the snapshot's now was ${drift}ms from the wall clock`);
  // The ages are still real ages: the floor was seeded relative to the same
  // reading, so the oldest wait is the fixture's own 66 hours, not 56 years.
  const oldest = Math.max(...snap.agents.map((x) => snap.now - (x.lastActivityAt || snap.now)));
  assert.ok(oldest > 0 && oldest < 90 * 3600_000, `oldest activity was ${oldest}ms old`);
});

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
