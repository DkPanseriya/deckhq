/**
 * WP-17's hardest acceptance line: **nothing in the ledger path may read or
 * mutate ack state**, and a ledger write failure must never block the state
 * machine.
 *
 * The way that is proved here is the only way it can honestly be proved: the
 * SAME script is driven through three registries — one with no ledger at all,
 * one with a working ledger, one whose ledger throws on every single call —
 * and the resulting `Agent[]` and the ENTIRE ack map are compared. If the
 * ledger could touch anything the user owns, or could interrupt the machine
 * part-way, these three would differ.
 *
 * The second half of the file is WP-17's other acceptance line: a day's ledger
 * reconstructs the needs-you queue at any past timestamp. That is checked
 * against the live machine's own snapshot rather than against a hand-written
 * expectation, so the replay cannot drift away from `needsYou()`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Registry } from '../../src/core/state-machine.mjs';
import { agentId, needsYou } from '../../src/core/model.mjs';
import { Ledger, dayKey, readDay, reconstructQueue } from '../../src/core/ledger.mjs';

// ---------------------------------------------------------------------------
// Fakes, the same shape as state-machine.test.mjs's.
// ---------------------------------------------------------------------------

function fakeStore() {
  const settings = {
    stallWindowMs: 600000,
    notifications: true,
    sound: false,
    zoom: 0,
    pollIntervalMs: 5000,
    showLetGo: false,
  };
  let seededAt = null;
  const ack = new Map();
  const archivedProjects = new Set();
  return {
    async load() {},
    get settings() {
      return { ...settings };
    },
    setSettings() {},
    get seededAt() {
      return seededAt;
    },
    markSeeded(ts) {
      seededAt = ts;
    },
    getAck(id) {
      return ack.has(id) ? { ...ack.get(id) } : undefined;
    },
    setAck(id, patch) {
      const prev = ack.get(id) || {
        state: 'active',
        reviewSince: null,
        needsInputSince: null,
        updatedAt: 0,
      };
      const next = { ...prev, ...patch, updatedAt: 0 };
      ack.set(id, next);
      return { ...next };
    },
    allAck() {
      const out = {};
      for (const [k, v] of [...ack.entries()].sort()) out[k] = { ...v };
      return out;
    },
    isProjectArchived(id) {
      return archivedProjects.has(id);
    },
    setProjectArchived(id, on) {
      if (on) archivedProjects.add(id);
      else archivedProjects.delete(id);
    },
    archivedProjects() {
      return [...archivedProjects];
    },
  };
}

function makeAdapter(opts = {}) {
  let summaries = opts.summaries || [];
  let live = opts.live || [];
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
      return live;
    },
    setSummaries(s) {
      summaries = s;
    },
    setLive(l) {
      live = l;
    },
    hooks: { supported: true, installed: async () => false },
  };
}

/**
 * One fixed instant, a minute ago. Fixed so the three runs below are
 * comparable at all; recent because first-run seeding lets go of anything
 * older than fourteen days (`src/core/seed.mjs`), and a script that seeds
 * every session as `let_go` proves nothing about anything.
 */
const RECENT = Date.now() - 60_000;

function summary(id, over = {}) {
  return {
    id: agentId('claude-code', id),
    runtime: 'claude-code',
    title: `title-${id}`,
    hasCustomTitle: false,
    cwd: over.cwd ?? 'C:\\work\\api',
    gitBranch: null,
    model: 'claude-opus-5',
    lastActivityAt: over.lastActivityAt ?? RECENT,
    tokens: over.tokens ?? 10,
    cacheTokens: 0,
    costEstimate: 0,
    lastRole: over.lastRole ?? 'user',
    lastText: 'hi',
    turnEnded: over.turnEnded ?? over.lastRole === 'assistant',
    // Absent unless asked for: an adapter that cannot see an archive reports
    // undefined, which must never be read as "not archived".
    ...(over.archived === undefined ? {} : { archived: over.archived }),
  };
}

function liveSession(id, over = {}) {
  return {
    id: agentId('claude-code', id),
    runtime: 'claude-code',
    cwd: over.cwd ?? 'C:\\work\\api',
    name: null,
    startedAt: RECENT,
    pid: 1,
  };
}

/**
 * The script both runs are driven through. Every kind of thing that reaches
 * the state machine: a scan, hook events, a tick, an action, an archive, a
 * send, and an action that is illegal and must still throw the same way.
 *
 * @param {Registry} registry
 * @param {ReturnType<typeof makeAdapter>} adapter
 */
async function drive(registry, adapter) {
  const id = (s) => agentId('claude-code', s);
  const errors = [];

  adapter.setSummaries([
    summary('a', { lastRole: 'assistant' }),
    summary('b', { cwd: 'C:\\work\\ui' }),
    summary('c'),
  ]);
  adapter.setLive([liveSession('a'), liveSession('b')]);
  await registry.refresh();

  registry.setHookStatus({ 'claude-code': { supported: true, installed: true } });
  registry.applyHook({
    runtime: 'claude-code',
    sessionId: 'b',
    hookEvent: 'Stop',
    at: 1_700_000_100_000,
  });
  registry.applyHook({
    runtime: 'claude-code',
    sessionId: 'c',
    hookEvent: 'Notification',
    at: 1_700_000_200_000,
  });
  registry.tick(1_700_000_300_000);

  await registry.act(id('a'), 'acknowledge');
  await registry.act(id('b'), 'bench');
  try {
    await registry.act(id('c'), 'recall');
  } catch (err) {
    errors.push(err.message);
  }
  await registry.act(id('c'), 'acknowledge');
  registry.noteSent?.(id('a'), { chars: 12, ok: true });

  // Tokens move; then the desktop app archives one.
  adapter.setSummaries([
    summary('a', { lastRole: 'assistant', tokens: 900 }),
    summary('b', { cwd: 'C:\\work\\ui', archived: true }),
    summary('c'),
  ]);
  await registry.refresh();

  registry.setProjectArchived('c-work-ui', true);
  return errors;
}

/** A ledger that fails at every level a real one could. */
function brokenLedger(dir) {
  const led = new Ledger(dir, { machineId: 'broken', flushIntervalMs: 0 });
  led.record = () => {
    throw new Error('the disk is on fire');
  };
  led.markSeen = () => {
    throw new Error('the disk is still on fire');
  };
  return led;
}

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-ledger-inv-'));
}

// ---------------------------------------------------------------------------
// THE INVARIANT
// ---------------------------------------------------------------------------

test('INVARIANT: a failing ledger changes neither the agents nor one byte of ack state', async () => {
  const dir = await tmpDir();
  try {
    /** @param {(d:string) => any} makeLedger */
    const run = async (makeLedger) => {
      const store = fakeStore();
      const adapter = makeAdapter();
      const ledger = makeLedger ? makeLedger(dir) : null;
      const registry = new Registry({ store, adapters: [adapter], ledger });
      try {
        const errors = await drive(registry, adapter);
        return { agents: registry.agents, ack: store.allAck(), errors };
      } finally {
        if (ledger) await ledger.close().catch(() => {});
      }
    };

    const none = await run(null);
    const working = await run(
      (d) => new Ledger(path.join(d, 'ok'), { machineId: 'ok', flushIntervalMs: 0 }),
    );
    const broken = await run(brokenLedger);

    assert.deepEqual(working.agents, none.agents, 'a working ledger changed the agents');
    assert.deepEqual(broken.agents, none.agents, 'a broken ledger changed the agents');
    assert.deepEqual(working.ack, none.ack, 'a working ledger changed ack state');
    assert.deepEqual(broken.ack, none.ack, 'a broken ledger changed ack state');
    // The same illegal action is refused the same way in all three.
    assert.deepEqual(working.errors, none.errors);
    assert.deepEqual(broken.errors, none.errors);
    assert.equal(none.errors.length, 1);

    // And the working one really did write something, so the comparison above
    // is not three runs of nothing.
    const written = await readDay(path.join(dir, 'ok'), dayKey(Date.now()));
    assert.ok(written.length > 5, `expected records, got ${written.length}`);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('INVARIANT: the ledger module never reaches the store', async () => {
  const source = await fsp.readFile(new URL('../../src/core/ledger.mjs', import.meta.url), 'utf8');
  // The guarantee is structural: it is the direction of the imports.
  assert.ok(!/from '\.\/store\.mjs'/.test(source), 'ledger.mjs imports the store');
  assert.ok(!/from '\.\/state-machine\.mjs'/.test(source), 'ledger.mjs imports the state machine');
  assert.ok(!/setAck|getAck|reviewSince|needsInputSince/.test(source.replace(/^ \*.*$/gm, '')));
});

// ---------------------------------------------------------------------------
// What the ledger recorded
// ---------------------------------------------------------------------------

test('the state machine writes one first_seen, the transitions, the actions, the sends and the token deltas', async () => {
  const dir = await tmpDir();
  try {
    const ledger = new Ledger(dir, { machineId: 'm'.repeat(32), flushIntervalMs: 0 });
    await ledger.prime();
    const store = fakeStore();
    const adapter = makeAdapter();
    const registry = new Registry({ store, adapters: [adapter], ledger });
    await drive(registry, adapter);
    await ledger.close();

    const records = await readDay(dir, dayKey(Date.now()));
    const of = (kind) => records.filter((r) => r.kind === kind);

    assert.equal(new Set(records.map((r) => r.machineId)).size, 1);
    assert.equal(records[0].machineId, 'm'.repeat(32));

    // Exactly one first_seen per session, and it carries the baseline.
    const first = of('session').filter((r) => r.event === 'first_seen');
    assert.deepEqual(first.map((r) => r.sessionId).sort(), [
      'claude-code:a',
      'claude-code:b',
      'claude-code:c',
    ]);
    for (const r of first) {
      assert.ok(typeof r.activity === 'string' && typeof r.ack === 'string');
    }

    // The six actions, by name.
    assert.deepEqual(
      of('action').map((r) => r.action),
      ['acknowledge', 'bench', 'acknowledge'],
      'an illegal action must not be recorded',
    );

    // The send, once.
    assert.equal(of('send').length, 1);
    assert.equal(of('send')[0].chars, 12);

    // Token deltas only when they moved.
    const tokens = of('tokens');
    assert.ok(tokens.length >= 1);
    assert.ok(tokens.some((r) => r.delta === 890 && r.tokens === 900));

    // Two projects, two keys, and neither is a path.
    const keys = new Set(records.map((r) => r.projectKey));
    assert.equal(keys.size, 2);
    for (const k of keys) assert.match(k, /^[0-9a-f]{16}$/);

    // The desktop archive is in there.
    assert.ok(of('session').some((r) => r.event === 'archived'));

    // Activity transitions, with from and to.
    const activity = of('state').filter((r) => r.dim === 'activity');
    assert.ok(activity.length > 0);
    for (const r of activity) assert.ok(r.from && r.to && r.from !== r.to);
    const ack = of('state').filter((r) => r.dim === 'ack');
    assert.ok(ack.some((r) => r.to === 'benched'));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// WP-17's acceptance: the queue, reconstructed
// ---------------------------------------------------------------------------

test('a day\u2019s ledger reconstructs the needs-you queue the live machine is showing', async () => {
  const dir = await tmpDir();
  try {
    // A clock the test moves in whole seconds. Every one of these steps
    // happens inside the same millisecond of real time, and `at` is a
    // timestamp the replay compares with `<=`, so with a real clock the first
    // snapshot would legitimately see records from the last step.
    let clock = Date.now();
    const ledger = new Ledger(dir, { machineId: 'x', flushIntervalMs: 0, now: () => clock });
    await ledger.prime();
    const store = fakeStore();
    const adapter = makeAdapter();
    const registry = new Registry({ store, adapters: [adapter], ledger });

    /** @type {Array<{at:number, queue:string[]}>} */
    const marks = [];
    const snap = () => {
      marks.push({
        at: clock,
        queue: registry.agents
          .filter((a) => needsYou(a))
          .map((a) => a.id)
          .sort(),
      });
      clock += 1000;
    };

    const id = (s) => agentId('claude-code', s);

    adapter.setSummaries([summary('a'), summary('b'), summary('c')]);
    adapter.setLive([liveSession('a'), liveSession('b'), liveSession('c')]);
    await registry.refresh();
    registry.setHookStatus({ 'claude-code': { supported: true, installed: true } });
    snap();

    registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'Stop', at: clock });
    snap();

    registry.applyHook({
      runtime: 'claude-code',
      sessionId: 'b',
      hookEvent: 'Notification',
      at: clock,
    });
    snap();

    await registry.act(id('a'), 'acknowledge');
    snap();

    registry.applyHook({ runtime: 'claude-code', sessionId: 'c', hookEvent: 'Stop', at: clock });
    await registry.act(id('b'), 'bench');
    snap();

    await ledger.close();
    const records = await readDay(dir, dayKey(Date.now()));

    for (const mark of marks) {
      const replayed = reconstructQueue(records, mark.at)
        .map((x) => x.sessionId)
        .sort();
      assert.deepEqual(replayed, mark.queue, `the ledger disagrees with the floor at ${mark.at}`);
    }
    // And the last mark was not empty, so this is not five comparisons of [].
    assert.ok(marks[marks.length - 1].queue.length > 0);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
