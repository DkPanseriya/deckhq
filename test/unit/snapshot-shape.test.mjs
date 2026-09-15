/**
 * The demo snapshot is the real snapshot's shape (WP-92g, audit A-10).
 *
 * `src/core/demo-fixture.mjs` says what it is for in its own header: "a
 * snapshot-shaped object", so that every surface downstream — the floor, the
 * panel, the deck, the strip, `doctor`, the status line — has one code path
 * instead of two. `Registry.snapshot()` substitutes it for the real thing on a
 * machine with no sessions, at the one place a snapshot is produced, and
 * nothing after that point is told which floor it is holding except by the
 * `demo` flag.
 *
 * That promise had quietly stopped being true. `_realSnapshot()` grew `crews`
 * (WP-89) and `rateCardVersion` (WP-26); the actor floor grew neither. Nothing
 * caught it because the test that existed listed the keys it expected by hand,
 * so it only ever checked the fields somebody had remembered to add to it —
 * the same failure shape as the three gates WP-92a–c replaced.
 *
 * So this file does not hold a list. It stands up a REAL `Registry` against a
 * real `Store` and a fake adapter, takes a real snapshot, and compares its keys
 * against the actor floor's. The only difference either direction may be is the
 * two fields the demo floor exists to add.
 *
 * The one `INVARIANT:`-adjacent thing to keep in view: nothing here acks
 * anything, and the actors are never in `registry.agents`.
 */

// A machine of our own, before anything under `src/` is loaded. §124.
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Registry } from '../../src/core/state-machine.mjs';
import { Store } from '../../src/core/store.mjs';
import { agentId } from '../../src/core/model.mjs';
import { buildDemoSnapshot } from '../../src/core/demo-fixture.mjs';
import { crewsFrom } from '../../public/floor-rule.js';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

/** The two fields an actor floor carries that a real floor has no use for. */
const DEMO_ONLY = ['demo', 'demoNote'];

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

/** A fake runtime with `n` sessions on it, in the shape the registry scans. */
function adapterWith(n) {
  const summaries = Array.from({ length: n }, (_, i) => ({
    id: agentId('claude-code', `s${i}`),
    runtime: 'claude-code',
    title: `title-${i}`,
    hasCustomTitle: false,
    cwd: 'C:\\work\\api',
    gitBranch: null,
    model: 'claude-opus-5-20260501',
    lastActivityAt: NOW - MIN,
    tokens: 10,
    cacheTokens: 0,
    costEstimate: 0,
    lastRole: 'user',
    lastText: 'hi',
    turnEnded: false,
  }));
  return {
    id: 'claude-code',
    label: 'Claude Code',
    async available() {
      return true;
    },
    async scanSessions() {
      return summaries;
    },
    async liveSessions() {
      return [];
    },
    hooks: { supported: true, installed: async () => false },
  };
}

/** A registry over a temp store, scanned once. */
async function scanned(sessions) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-shape-'));
  const store = new Store(path.join(dir, 'state.json'));
  await store.load();
  const registry = new Registry({
    store,
    adapters: [adapterWith(sessions)],
    ledger: null,
    log: quiet,
  });
  await registry.refresh();
  return registry;
}

test('the actor floor carries exactly the daemon snapshot keys, plus demo and demoNote', async () => {
  const registry = await scanned(3);
  const real = registry.snapshot();
  assert.equal(real.demo, undefined, 'three sessions is not an empty machine');

  const demo = buildDemoSnapshot({ now: NOW });
  const realKeys = Object.keys(real);
  const demoKeys = Object.keys(demo);

  assert.deepEqual(
    demoKeys.filter((k) => !realKeys.includes(k)),
    DEMO_ONLY,
    'the actor floor carries a field the real one does not, so a surface can read one and not the other',
  );
  assert.deepEqual(
    realKeys.filter((k) => !demoKeys.includes(k)),
    [],
    'the real floor carries a field the actor floor does not; downstream this is a second code path',
  );
  // Order too, so a reader diffing the two modules sees the same list twice.
  assert.deepEqual(demoKeys, [...realKeys, ...DEMO_ONLY]);
});

test('the substitution an empty machine gets is the same shape it would have had', async () => {
  // The path that actually ships: no sessions, so `snapshot()` returns the
  // actors. Compared against a scanned machine's real snapshot.
  const empty = await scanned(0);
  const substituted = empty.snapshot();
  assert.equal(substituted.demo, true, 'an empty machine should be showing actors');
  assert.deepEqual(empty.agents, [], 'the actors must not be in the registry');

  const real = (await scanned(3)).snapshot();
  assert.deepEqual(Object.keys(substituted), [...Object.keys(real), ...DEMO_ONLY]);
});

test('the actors crews are derived by the one crew rule, and published even when empty', () => {
  const demo = buildDemoSnapshot({ now: NOW });
  assert.ok(Array.isArray(demo.crews), 'crews absent is what made the client derive them again');
  assert.deepEqual(demo.crews, crewsFrom(demo.agents, { now: NOW }));
});

test('every cost the actors carry names the dated table it came from', async () => {
  const demo = buildDemoSnapshot({ now: NOW });
  assert.ok('rateCardVersion' in demo, 'the field must exist whether or not a caller filled it');
  assert.ok(
    demo.agents.some((a) => typeof a.costEstimate === 'number'),
    'the field would be pointless if no actor carried a cost',
  );

  // The fixture is a pure function of `now` — the rate card stats a file under
  // the user's home — so the registry reads it and passes it in, exactly as it
  // does `settings`, `hooks`, `takenNames` and `writeError`. What ships is the
  // substituted snapshot, and that one carries the real dated string.
  const shipped = (await scanned(0)).snapshot();
  assert.equal(shipped.demo, true);
  assert.equal(typeof shipped.rateCardVersion, 'string');
  assert.ok(
    shipped.rateCardVersion.length > 0,
    'a cost with no rate card reads "rate card unknown"',
  );
});
