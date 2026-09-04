// A machine of our own, before anything under `src/` is loaded: several of
// those modules resolve a path out of the environment while they evaluate.
// `docs/DEVIATIONS.md` §124.
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Registry } from '../../src/core/state-machine.mjs';
import { agentId } from '../../src/core/model.mjs';

// ---------------------------------------------------------------------------
// Fakes. Registry is tested against the adapter *contract*
// (docs/02-ARCHITECTURE.md §2), never against a real adapter — those belong
// to another package. Same for the store: a minimal in-memory double
// exposing exactly the surface state-machine.mjs uses.
// ---------------------------------------------------------------------------

function fakeStore(initialSettings = {}) {
  let settings = {
    stallWindowMs: 600000,
    notifications: true,
    sound: false,
    pollIntervalMs: 5000,
    ...initialSettings,
  };
  let seededAt = null;
  const ack = new Map();
  const archivedProjects = new Set();
  return {
    async load() {},
    get settings() {
      return { ...settings };
    },
    setSettings(patch) {
      settings = { ...settings, ...patch };
    },
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
      const next = { ...prev, ...patch, updatedAt: Date.now() };
      ack.set(id, next);
      return { ...next };
    },
    allAck() {
      const out = {};
      for (const [k, v] of ack) out[k] = { ...v };
      return out;
    },
    isProjectArchived(projectId) {
      return archivedProjects.has(projectId);
    },
    setProjectArchived(projectId, archived) {
      if (archived) archivedProjects.add(projectId);
      else archivedProjects.delete(projectId);
    },
    archivedProjects() {
      return [...archivedProjects];
    },
  };
}

function makeAdapter(id, opts = {}) {
  let summaries = opts.summaries || [];
  let live = opts.live || [];
  let available = opts.available !== false;
  let scanCalls = 0;
  let liveCalls = 0;
  return {
    id,
    label: opts.label || id,
    async available() {
      return available;
    },
    async scanSessions() {
      scanCalls++;
      return summaries;
    },
    async liveSessions() {
      liveCalls++;
      return live;
    },
    async conversation() {
      return opts.conversation || [];
    },
    async send() {
      return { ok: true };
    },
    async openInTerminal() {},
    hooks: {
      supported: true,
      describe: () => ({ file: '', json: '', events: [], note: '' }),
      install: async () => {},
      remove: async () => {},
      installed: async () => false,
    },
    setSummaries(s) {
      summaries = s;
    },
    setLive(l) {
      live = l;
    },
    setAvailable(a) {
      available = a;
    },
    get scanCalls() {
      return scanCalls;
    },
    get liveCalls() {
      return liveCalls;
    },
  };
}

function makeSummary(id, over = {}) {
  return {
    id: agentId('claude-code', id),
    runtime: 'claude-code',
    title: over.title ?? `title-${id}`,
    hasCustomTitle: over.hasCustomTitle ?? false,
    cwd: over.cwd ?? 'C:\\proj',
    gitBranch: over.gitBranch ?? null,
    model: over.model ?? 'claude-opus-5',
    lastActivityAt: over.lastActivityAt ?? Date.now(),
    tokens: over.tokens ?? 10,
    cacheTokens: over.cacheTokens ?? 0,
    costEstimate: over.costEstimate ?? 0.01,
    lastRole: over.lastRole ?? 'user',
    lastText: over.lastText ?? 'hi',
    turnEnded: over.turnEnded ?? over.lastRole === 'assistant',
    // Deliberately absent unless asked for: an adapter that cannot see an
    // archive reports undefined, which must not be read as "not archived".
    ...(over.archived === undefined ? {} : { archived: over.archived }),
  };
}

function makeLive(id, over = {}) {
  return {
    id: agentId('claude-code', id),
    runtime: 'claude-code',
    cwd: over.cwd ?? 'C:\\proj',
    name: over.name ?? null,
    startedAt: over.startedAt ?? Date.now(),
    pid: over.pid ?? 111,
  };
}

function find(registry, id) {
  return registry.agents.find((a) => a.id === agentId('claude-code', id));
}

// ---------------------------------------------------------------------------
// A. Poll path — docs/02-ARCHITECTURE.md §4.2 (no hooks installed)
// ---------------------------------------------------------------------------

test('poll path: live + assistant spoke last -> for_review, reviewSince set, degraded flagged', async () => {
  const adapter = makeAdapter('claude-code', {
    summaries: [makeSummary('a', { lastRole: 'assistant' })],
    live: [makeLive('a')],
  });
  const registry = new Registry({ store: fakeStore(), adapters: [adapter] });
  await registry.refresh();

  const agent = find(registry, 'a');
  assert.equal(agent.activityState, 'for_review');
  assert.notEqual(agent.reviewSince, null);
  assert.equal(registry.snapshot().degraded['claude-code'], true);
});

test('poll path: live + user spoke last -> working', async () => {
  const adapter = makeAdapter('claude-code', {
    summaries: [makeSummary('a', { lastRole: 'user' })],
    live: [makeLive('a')],
  });
  const registry = new Registry({ store: fakeStore(), adapters: [adapter] });
  await registry.refresh();

  assert.equal(find(registry, 'a').activityState, 'working');
});

test('poll path: not live, never observed for_review -> ended', async () => {
  const store = fakeStore();
  store.markSeeded(1); // isolate this from first-run seeding, tested separately
  const adapter = makeAdapter('claude-code', {
    summaries: [makeSummary('a', { lastRole: 'assistant' })],
    live: [],
  });
  const registry = new Registry({ store, adapters: [adapter] });
  await registry.refresh();

  assert.equal(find(registry, 'a').activityState, 'ended');
  assert.equal(find(registry, 'a').live, false);
});

test('poll path: needs_input and stalled are never invented, even across repeated refreshes and ticks', async () => {
  const adapter = makeAdapter('claude-code', {
    summaries: [
      makeSummary('a', { lastRole: 'user', lastActivityAt: Date.now() - 20 * 60 * 1000 }),
    ],
    live: [makeLive('a')],
  });
  const registry = new Registry({
    store: fakeStore({ stallWindowMs: 2 * 60 * 1000 }),
    adapters: [adapter],
  });
  await registry.refresh();
  registry.tick(Date.now() + 60 * 60 * 1000); // way past any stall window
  await registry.refresh();

  const state = find(registry, 'a').activityState;
  assert.ok(state === 'working', `expected working, got ${state}`);
  assert.notEqual(state, 'needs_input');
  assert.notEqual(state, 'stalled');
});

// ---------------------------------------------------------------------------
// B. Hook path — docs/02-ARCHITECTURE.md §4.1 (hooks installed)
// ---------------------------------------------------------------------------

async function setupHookRegistry(overrides = {}) {
  const adapter = makeAdapter('claude-code', {
    summaries: [makeSummary('a', overrides)],
    live: [makeLive('a')],
  });
  const registry = new Registry({ store: fakeStore(), adapters: [adapter] });
  registry.setHookStatus({ 'claude-code': { supported: true, installed: true } });
  await registry.refresh();
  return { registry, adapter };
}

test('hook path: SessionStart registers the session as working and live', async () => {
  const { registry } = await setupHookRegistry();
  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'SessionStart' });
  const agent = find(registry, 'a');
  assert.equal(agent.activityState, 'working');
  assert.equal(agent.live, true);
  assert.equal(registry.snapshot().degraded['claude-code'], false);
});

test('hook path: UserPromptSubmit sets working, sets lastOutputAt, and clears reviewSince/needsInputSince (documented exception)', async () => {
  const { registry } = await setupHookRegistry();
  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'Stop', at: 1000 });
  assert.equal(find(registry, 'a').activityState, 'for_review');
  assert.notEqual(find(registry, 'a').reviewSince, null);

  registry.applyHook({
    runtime: 'claude-code',
    sessionId: 'a',
    hookEvent: 'UserPromptSubmit',
    at: 2000,
  });
  const agent = find(registry, 'a');
  assert.equal(agent.activityState, 'working');
  assert.equal(agent.lastOutputAt, 2000);
  assert.equal(agent.reviewSince, null);
  assert.equal(agent.needsInputSince, null);
});

test('hook path: Notification sets needs_input and needsInputSince', async () => {
  const { registry } = await setupHookRegistry();
  registry.applyHook({
    runtime: 'claude-code',
    sessionId: 'a',
    hookEvent: 'Notification',
    at: 500,
  });
  const agent = find(registry, 'a');
  assert.equal(agent.activityState, 'needs_input');
  assert.equal(agent.needsInputSince, 500);
});

test('hook path: Stop sets for_review and reviewSince; firing twice does not move it forward', async () => {
  const { registry } = await setupHookRegistry();
  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'Stop', at: 1000 });
  assert.equal(find(registry, 'a').reviewSince, 1000);

  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'Stop', at: 999999 });
  assert.equal(find(registry, 'a').reviewSince, 1000, 'reviewSince is set only if unset');
  assert.equal(find(registry, 'a').activityState, 'for_review');
});

test('hook path: SubagentStop updates lastOutputAt only, never the parent activityState', async () => {
  const { registry } = await setupHookRegistry();
  registry.applyHook({
    runtime: 'claude-code',
    sessionId: 'a',
    hookEvent: 'Notification',
    at: 100,
  });
  assert.equal(find(registry, 'a').activityState, 'needs_input');

  registry.applyHook({
    runtime: 'claude-code',
    sessionId: 'a',
    hookEvent: 'SubagentStop',
    at: 12345,
  });
  const agent = find(registry, 'a');
  assert.equal(agent.activityState, 'needs_input', 'SubagentStop must not change parent state');
  assert.equal(agent.lastOutputAt, 12345);
});

test('hook path: SessionEnd on a plain working session -> ended, live false', async () => {
  const { registry } = await setupHookRegistry();
  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'SessionEnd' });
  const agent = find(registry, 'a');
  assert.equal(agent.activityState, 'ended');
  assert.equal(agent.live, false);
});

test('hook path: SessionEnd on a for_review session keeps it for_review (flagged deviation from the literal table)', async () => {
  const { registry } = await setupHookRegistry();
  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'Stop', at: 1000 });
  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'SessionEnd' });
  const agent = find(registry, 'a');
  assert.equal(agent.activityState, 'for_review');
  assert.equal(agent.live, false);
  assert.equal(agent.reviewSince, 1000);
});

test('hook path: SessionStart on a for_review session does not walk it out of the office (flagged deviation)', async () => {
  const { registry } = await setupHookRegistry();
  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'Stop', at: 1000 });
  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'SessionStart' });
  const agent = find(registry, 'a');
  assert.equal(agent.activityState, 'for_review');
  assert.equal(agent.reviewSince, 1000);
});

// ---------------------------------------------------------------------------
// C. Stall detection — docs/02-ARCHITECTURE.md §4.3
// ---------------------------------------------------------------------------

test('stall: working moves to stalled once past the window, only with hooks installed', async () => {
  const { registry } = await setupHookRegistry();
  registry.applyHook({
    runtime: 'claude-code',
    sessionId: 'a',
    hookEvent: 'UserPromptSubmit',
    at: 0,
  });
  assert.equal(find(registry, 'a').activityState, 'working');

  registry.tick(10 * 60 * 1000 + 1); // stallWindowMs default is 600000
  assert.equal(find(registry, 'a').activityState, 'stalled');
});

test('stall: a stalled agent returns to working on its own once new output arrives', async () => {
  const { registry } = await setupHookRegistry();
  registry.applyHook({
    runtime: 'claude-code',
    sessionId: 'a',
    hookEvent: 'UserPromptSubmit',
    at: 0,
  });
  registry.tick(10 * 60 * 1000 + 1);
  assert.equal(find(registry, 'a').activityState, 'stalled');

  registry.applyHook({
    runtime: 'claude-code',
    sessionId: 'a',
    hookEvent: 'SubagentStop',
    at: 10 * 60 * 1000 + 1,
  });
  registry.tick(10 * 60 * 1000 + 2); // now - lastOutputAt is tiny again
  assert.equal(find(registry, 'a').activityState, 'working');
});

test('stall: never applies without hooks installed, regardless of elapsed time', async () => {
  const adapter = makeAdapter('claude-code', {
    summaries: [makeSummary('a', { lastRole: 'user', lastActivityAt: 0 })],
    live: [makeLive('a')],
  });
  const registry = new Registry({
    store: fakeStore({ stallWindowMs: 2 * 60 * 1000 }),
    adapters: [adapter],
  });
  await registry.refresh(); // hooks not installed -> degraded
  registry.tick(999 * 24 * 60 * 60 * 1000);
  assert.equal(find(registry, 'a').activityState, 'working');
});

// ---------------------------------------------------------------------------
// C2. Thought bubbles — WP-52, docs/plan/08-PLAN-V2-100X.md §3.5/§9.
//
// `currentTool` is observed, transient and entirely cosmetic. The tests that
// matter are the ones proving it CANNOT reach anything else.
// ---------------------------------------------------------------------------

/** A PreToolUse as the HTTP route hands it over, adapter parsing already done. */
function preToolUse(name, summary, at) {
  return {
    runtime: 'claude-code',
    sessionId: 'a',
    hookEvent: 'PreToolUse',
    tool: { name, summary },
    at,
  };
}

test('WP-52: PreToolUse sets currentTool with the time it started; PostToolUse clears it', async () => {
  const { registry } = await setupHookRegistry();
  assert.equal(find(registry, 'a').currentTool, null, 'nothing is running yet');

  registry.applyHook(preToolUse('Bash', 'Bash npm test', 1000));
  assert.deepEqual(find(registry, 'a').currentTool, {
    name: 'Bash',
    summary: 'Bash npm test',
    since: 1000,
  });

  registry.applyHook({
    runtime: 'claude-code',
    sessionId: 'a',
    hookEvent: 'PostToolUse',
    at: 1500,
  });
  assert.equal(find(registry, 'a').currentTool, null);
});

test('WP-52: Stop and SessionEnd clear the bubble too', async () => {
  for (const event of ['Stop', 'SessionEnd']) {
    const { registry } = await setupHookRegistry();
    registry.applyHook(preToolUse('Bash', 'Bash npm test', 1000));
    assert.notEqual(find(registry, 'a').currentTool, null);
    registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: event, at: 2000 });
    assert.equal(find(registry, 'a').currentTool, null, `${event} left a stale bubble behind`);
  }
});

test('WP-52: a PostToolUse that never arrives expires with the stall window', async () => {
  const { registry } = await setupHookRegistry();
  registry.applyHook(preToolUse('Bash', 'Bash npm run build', 1000));

  registry.tick(1000 + 600000); // exactly the window: still current
  assert.notEqual(find(registry, 'a').currentTool, null);

  registry.tick(1000 + 600001);
  assert.equal(
    find(registry, 'a').currentTool,
    null,
    'a tool nobody reported finishing must not hang over a head forever',
  );
});

test('WP-52: PreToolUse is not output — it never resets the stall clock', async () => {
  const { registry } = await setupHookRegistry();
  registry.applyHook({
    runtime: 'claude-code',
    sessionId: 'a',
    hookEvent: 'UserPromptSubmit',
    at: 0,
  });
  registry.applyHook(preToolUse('Bash', 'Bash sleep 999', 1000));
  assert.equal(
    find(registry, 'a').lastOutputAt,
    0,
    'lastOutputAt is the stall clock, not activity',
  );
  registry.tick(600001);
  assert.equal(find(registry, 'a').activityState, 'stalled');
});

test('WP-52: a tool event never takes a raised hand off the floor', async () => {
  const { registry } = await setupHookRegistry();
  registry.applyHook({
    runtime: 'claude-code',
    sessionId: 'a',
    hookEvent: 'Notification',
    at: 100,
  });
  registry.applyHook(preToolUse('Read', 'Read src/foo.ts', 200));
  assert.equal(find(registry, 'a').activityState, 'needs_input');
  registry.applyHook({
    runtime: 'claude-code',
    sessionId: 'a',
    hookEvent: 'PostToolUse',
    at: 300,
  });
  assert.equal(find(registry, 'a').activityState, 'needs_input');
});

test('WP-52: a PreToolUse carrying no tool leaves nothing to draw', async () => {
  const { registry } = await setupHookRegistry();
  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'PreToolUse', at: 10 });
  assert.equal(find(registry, 'a').currentTool, null);
});

// ---------------------------------------------------------------------------
// D. act() — docs/02-ARCHITECTURE.md §5.1
// ---------------------------------------------------------------------------

test('act(acknowledge): legal from for_review/needs_input/stalled, clears both timestamps, returns to desk', async () => {
  const { registry } = await setupHookRegistry();
  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'Stop', at: 1000 });
  const id = agentId('claude-code', 'a');

  await registry.act(id, 'acknowledge');
  const agent = find(registry, 'a');
  assert.equal(agent.reviewSince, null);
  assert.equal(agent.needsInputSince, null);
  assert.equal(agent.activityState, 'working');
  assert.equal(agent.ackState, 'active');
});

test('act(acknowledge): illegal from a plain working state', async () => {
  const { registry } = await setupHookRegistry();
  const id = agentId('claude-code', 'a');
  await assert.rejects(() => registry.act(id, 'acknowledge'), /not legal/);
});

test('act(review): forces for_review from any active state', async () => {
  const { registry } = await setupHookRegistry();
  const id = agentId('claude-code', 'a');
  await registry.act(id, 'review');
  const agent = find(registry, 'a');
  assert.equal(agent.activityState, 'for_review');
  assert.notEqual(agent.reviewSince, null);
});

test('act(review): illegal once benched', async () => {
  const { registry } = await setupHookRegistry();
  const id = agentId('claude-code', 'a');
  await registry.act(id, 'bench');
  await assert.rejects(() => registry.act(id, 'review'), /not legal/);
});

test('act(bench)/act(recall) round-trip; recall illegal unless benched', async () => {
  const { registry } = await setupHookRegistry();
  const id = agentId('claude-code', 'a');

  await assert.rejects(() => registry.act(id, 'recall'), /not legal/);

  await registry.act(id, 'bench');
  assert.equal(find(registry, 'a').ackState, 'benched');

  await assert.rejects(
    () => registry.act(id, 'bench'),
    /not legal/,
    'already benched, not "any active state"',
  );

  await registry.act(id, 'recall');
  assert.equal(find(registry, 'a').ackState, 'active');
});

test('act(let_go)/act(rehire) round-trip; rehire illegal unless let_go', async () => {
  const { registry } = await setupHookRegistry();
  const id = agentId('claude-code', 'a');

  await assert.rejects(() => registry.act(id, 'rehire'), /not legal/);

  await registry.act(id, 'let_go');
  assert.equal(find(registry, 'a').ackState, 'let_go');

  await assert.rejects(() => registry.act(id, 'review'), /not legal/);

  await registry.act(id, 'rehire');
  assert.equal(find(registry, 'a').ackState, 'active');
});

test('act(): let_go is legal from any ackState', async () => {
  const { registry } = await setupHookRegistry();
  const id = agentId('claude-code', 'a');
  await registry.act(id, 'bench');
  await registry.act(id, 'let_go');
  assert.equal(find(registry, 'a').ackState, 'let_go');
});

test('act(): unknown action throws', async () => {
  const { registry } = await setupHookRegistry();
  const id = agentId('claude-code', 'a');
  await assert.rejects(() => registry.act(id, 'nonsense'), /Unknown action/);
});

test('act(): unknown agent id throws', async () => {
  const { registry } = await setupHookRegistry();
  await assert.rejects(
    () => registry.act('claude-code:does-not-exist', 'acknowledge'),
    /No such agent/,
  );
});

// ---------------------------------------------------------------------------
// E. Emit only on real change
// ---------------------------------------------------------------------------

test('emits to subscribers only when the snapshot actually changed', async () => {
  const adapter = makeAdapter('claude-code', {
    summaries: [makeSummary('a', { lastRole: 'user' })],
    live: [makeLive('a')],
  });
  const registry = new Registry({ store: fakeStore(), adapters: [adapter] });
  let calls = 0;
  const unsubscribe = registry.on(() => calls++);

  await registry.refresh(); // first snapshot: empty -> populated, must emit
  assert.equal(calls, 1);

  await registry.refresh(); // identical data, must NOT emit again
  assert.equal(calls, 1);

  unsubscribe();
  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'Notification' });
  assert.equal(calls, 1, 'unsubscribed listener must not be called');
});

// ---------------------------------------------------------------------------
// F. refresh() re-entrancy
// ---------------------------------------------------------------------------

test('refresh() is re-entrant-safe: concurrent calls coalesce rather than piling up', async () => {
  const adapter = makeAdapter('claude-code', {
    summaries: [makeSummary('a')],
    live: [makeLive('a')],
  });
  const registry = new Registry({ store: fakeStore(), adapters: [adapter] });

  const p1 = registry.refresh();
  const p2 = registry.refresh();
  const p3 = registry.refresh();
  await Promise.all([p1, p2, p3]);

  assert.ok(adapter.scanCalls <= 2, `expected at most 2 scans, got ${adapter.scanCalls}`);
  assert.ok(find(registry, 'a'), 'agent must still be present after concurrent refreshes');
});

// ---------------------------------------------------------------------------
// G. Bootstrap from a persisted reviewSince (daemon-restart simulation)
// ---------------------------------------------------------------------------

test('a fresh Registry restores for_review from a persisted reviewSince rather than re-deriving ended', async () => {
  const store = fakeStore();
  store.markSeeded(1); // this ack record already exists; seeding must not run over it anyway
  const id = agentId('claude-code', 'a');
  store.setAck(id, { state: 'active', reviewSince: 777 });

  const adapter = makeAdapter('claude-code', {
    // Not live: the process exited while the daemon was down. Without the
    // bootstrap, a brand-new in-memory record defaults to 'ended' here and
    // the pending review would silently vanish from the office on restart.
    summaries: [
      makeSummary('a', {
        lastRole: 'assistant',
        lastActivityAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
      }),
    ],
    live: [],
  });
  const registry = new Registry({ store, adapters: [adapter] });
  await registry.refresh();

  const agent = find(registry, 'a');
  assert.equal(agent.activityState, 'for_review');
  assert.equal(agent.reviewSince, 777);
  assert.equal(agent.live, false);
});

test('degraded path: a new user turn found on restart clears a stale reviewSince, mirroring UserPromptSubmit', async () => {
  const store = fakeStore();
  store.markSeeded(1);
  const id = agentId('claude-code', 'a');
  store.setAck(id, { state: 'active', reviewSince: 777 });

  const adapter = makeAdapter('claude-code', {
    summaries: [
      makeSummary('a', {
        lastRole: 'assistant',
        lastActivityAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
      }),
    ],
    live: [makeLive('a')],
  });
  const registry = new Registry({ store, adapters: [adapter] });
  await registry.refresh();
  assert.equal(
    find(registry, 'a').activityState,
    'for_review',
    'sanity: bootstrapped as for_review first',
  );

  // The user replied directly in their terminal while the daemon was down;
  // the next scan finds a new user turn appended to the transcript.
  adapter.setSummaries([makeSummary('a', { lastRole: 'user', lastActivityAt: Date.now() })]);
  await registry.refresh();

  const agent = find(registry, 'a');
  assert.equal(agent.activityState, 'working');
  assert.equal(agent.reviewSince, null);
});

// ---------------------------------------------------------------------------
// H. Seeding wired into refresh()
// ---------------------------------------------------------------------------

test('refresh() seeds exactly once on first run and never re-seeds', async () => {
  const store = fakeStore();
  const oldId = agentId('claude-code', 'old');
  const adapter = makeAdapter('claude-code', {
    summaries: [
      makeSummary('old', {
        lastRole: 'user',
        lastActivityAt: Date.now() - 40 * 24 * 60 * 60 * 1000,
      }),
    ],
    live: [],
  });
  const registry = new Registry({ store, adapters: [adapter] });

  await registry.refresh();
  assert.notEqual(store.seededAt, null);
  assert.equal(store.getAck(oldId).state, 'let_go');

  // Simulate the user reversing the seed decision, then refresh again:
  // seeding must never re-run and clobber it back.
  await registry.act(oldId, 'rehire');
  await registry.refresh();
  assert.equal(find(registry, 'old').ackState, 'active');
});

// ---------------------------------------------------------------------------
// I. THE INVARIANT — the whole product.
// ---------------------------------------------------------------------------

test('INVARIANT: no observed event can clear reviewSince', async () => {
  const adapter = makeAdapter('claude-code', {
    summaries: [makeSummary('a', { lastRole: 'user' })],
    live: [makeLive('a')],
  });
  const store = fakeStore();
  const registry = new Registry({ store, adapters: [adapter] });
  registry.setHookStatus({ 'claude-code': { supported: true, installed: true } });
  await registry.refresh();

  const id = agentId('claude-code', 'a');
  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'Stop', at: 1000 });
  const reviewSince = find(registry, 'a').reviewSince;
  assert.equal(reviewSince, 1000);

  function assertUnchanged(label) {
    const now = find(registry, 'a').reviewSince;
    assert.equal(now, reviewSince, `reviewSince changed after: ${label}`);
  }

  // 1. A full refresh cycle (no data changes).
  await registry.refresh();
  assertUnchanged('a full refresh cycle');

  // 2. Every hook event type, except the one documented exception.
  //    (UserPromptSubmit is verified separately below to DO clear it — a
  //    deliberate, spec-mandated exception for direct user action, see the
  //    module doc comment in state-machine.mjs.)
  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'SessionStart' });
  assertUnchanged('SessionStart');

  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'Notification' });
  assertUnchanged('Notification');

  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'SubagentStop' });
  assertUnchanged('SubagentStop');

  // Stop firing twice must not move it forward either (set only if unset).
  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'Stop', at: 999999999 });
  assertUnchanged('Stop firing a second time');

  // 3. A live -> dead transition (SessionEnd is the hook-observed version of
  //    exactly this; the process dying is not a user action).
  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'SessionEnd' });
  assertUnchanged('a live -> dead transition (SessionEnd)');
  assert.equal(
    find(registry, 'a').activityState,
    'for_review',
    'and the item must not leave the office',
  );
  assert.equal(find(registry, 'a').live, false);

  // 4. Reading the conversation. Registry exposes no such method at all —
  //    conversation reads go straight from the HTTP layer to the adapter —
  //    so this documents that there is no code path from a read into
  //    Registry state, by calling exactly what that layer would call.
  await adapter.conversation(id, { maxMessages: 100 });
  assertUnchanged('a conversation read');

  // Only act() may clear it.
  await registry.act(id, 'acknowledge');
  assert.equal(
    find(registry, 'a').reviewSince,
    null,
    'act(acknowledge) is the one legitimate clear',
  );
});

test('INVARIANT (poll-only companion): a pure poll-observed liveness loss keeps a for_review agent in for_review', async () => {
  const adapter = makeAdapter('claude-code', {
    summaries: [makeSummary('a', { lastRole: 'assistant' })],
    live: [makeLive('a')],
  });
  const registry = new Registry({ store: fakeStore(), adapters: [adapter] }); // no hooks installed
  await registry.refresh();

  const before = find(registry, 'a');
  assert.equal(before.activityState, 'for_review');
  const reviewSince = before.reviewSince;
  assert.notEqual(reviewSince, null);

  // The process disappears from liveSessions() — a pure poll observation,
  // not any kind of user action.
  adapter.setLive([]);
  await registry.refresh();

  const after = find(registry, 'a');
  assert.equal(after.live, false);
  assert.equal(after.activityState, 'for_review');
  assert.equal(after.reviewSince, reviewSince);
});

test('INVARIANT: a PreToolUse/PostToolUse event changes no user-owned field', async () => {
  // WP-52 adds two hook events that fire many times a minute on a busy
  // session. They exist to say what an agent is DOING; nothing about them may
  // reach what the USER owns — `ackState`, `reviewSince`, `needsInputSince` —
  // nor the needs-you count those three produce. This is the guard on that.
  const adapter = makeAdapter('claude-code', {
    summaries: [makeSummary('a', { lastRole: 'user' }), makeSummary('b', { lastRole: 'user' })],
    live: [makeLive('a'), makeLive('b')],
  });
  const store = fakeStore();
  const registry = new Registry({ store, adapters: [adapter] });
  registry.setHookStatus({ 'claude-code': { supported: true, installed: true } });
  await registry.refresh();

  // One waiting in the office, one with its hand up: between them they cover
  // every state the needs-you count is made of that a hook can produce.
  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'Stop', at: 1000 });
  registry.applyHook({
    runtime: 'claude-code',
    sessionId: 'b',
    hookEvent: 'Notification',
    at: 900,
  });
  await registry.act(agentId('claude-code', 'b'), 'bench');

  /** Everything the user owns, plus the count derived from it. */
  const userOwned = () => {
    const snapshot = registry.snapshot();
    return {
      needsYou: snapshot.counts.needsYou,
      handsUp: snapshot.counts.handsUp,
      stalled: snapshot.counts.stalled,
      forReview: snapshot.counts.forReview,
      benched: snapshot.counts.benched,
      letGo: snapshot.counts.letGo,
      agents: snapshot.agents.map((x) => ({
        id: x.id,
        ackState: x.ackState,
        reviewSince: x.reviewSince,
        needsInputSince: x.needsInputSince,
        activityState: x.activityState,
      })),
      ack: store.allAck(),
    };
  };

  const before = userOwned();
  for (const sessionId of ['a', 'b']) {
    for (const tool of [
      { name: 'Bash', summary: 'Bash npm test' },
      { name: 'Edit', summary: 'Edit src/foo.ts' },
      { name: 'WebFetch', summary: 'WebFetch' },
    ]) {
      registry.applyHook({
        runtime: 'claude-code',
        sessionId,
        hookEvent: 'PreToolUse',
        tool,
        at: 2000,
      });
      registry.applyHook({
        runtime: 'claude-code',
        sessionId,
        hookEvent: 'PostToolUse',
        at: 2100,
      });
    }
  }

  assert.deepEqual(userOwned(), before, 'a tool event moved something the user owns');
  // And the one thing it IS allowed to move came back to rest.
  for (const a of registry.snapshot().agents) assert.equal(a.currentTool, null);
});

test('INVARIANT: a pending permission changes no user-owned field and no activity state', async () => {
  // WP-19. A permission card sits BESIDE an agent, with its own lifetime. It
  // says the runtime is asking a question about one tool call; it says nothing
  // about whether the user is done with the session, and it must not move the
  // raised hand on the floor either — that is `Notification`'s to put up and
  // the runtime's to take down.
  const adapter = makeAdapter('claude-code', {
    summaries: [makeSummary('a', { lastRole: 'user' }), makeSummary('b', { lastRole: 'user' })],
    live: [makeLive('a'), makeLive('b')],
  });
  const store = fakeStore();
  const registry = new Registry({ store, adapters: [adapter] });
  registry.setHookStatus({ 'claude-code': { supported: true, installed: true } });
  await registry.refresh();

  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'Stop', at: 1000 });
  registry.applyHook({
    runtime: 'claude-code',
    sessionId: 'b',
    hookEvent: 'Notification',
    at: 900,
  });

  const observable = () => {
    const snapshot = registry.snapshot();
    return {
      counts: snapshot.counts,
      agents: snapshot.agents.map((x) => ({
        id: x.id,
        ackState: x.ackState,
        reviewSince: x.reviewSince,
        needsInputSince: x.needsInputSince,
        activityState: x.activityState,
      })),
      ack: store.allAck(),
    };
  };

  const before = observable();
  const id = agentId('claude-code', 'b');
  registry.setPendingPermission(id, {
    id: 'toolu_1',
    tool: 'Bash',
    summary: 'npm run deploy',
    suggestions: [],
    requiresUserInteraction: false,
    since: 1234,
  });
  assert.deepEqual(observable(), before, 'a permission request moved something it does not own');

  const withCard = registry.snapshot().agents.find((x) => x.id === id);
  assert.equal(withCard.pendingPermission.tool, 'Bash');
  assert.equal(withCard.pendingPermission.since, 1234);
  // The hand stays up: the card appearing and vanishing is not the runtime
  // moving on.
  assert.equal(withCard.activityState, 'needs_input');

  registry.clearPendingPermission(id, 'toolu_1');
  assert.deepEqual(observable(), before);
  assert.equal(
    registry.snapshot().agents.find((x) => x.id === id).pendingPermission,
    null,
    'the card outlived its hold',
  );
  // A stale clear for a request that is no longer the one showing is ignored.
  registry.setPendingPermission(id, {
    id: 'toolu_2',
    tool: 'Write',
    summary: 'src/a.ts',
    suggestions: [],
    requiresUserInteraction: false,
    since: 2000,
  });
  registry.clearPendingPermission(id, 'toolu_1');
  assert.equal(
    registry.snapshot().agents.find((x) => x.id === id).pendingPermission.id,
    'toolu_2',
    'an expiring older request took a newer card down with it',
  );
});

test('INVARIANT: UserPromptSubmit is the one documented exception and DOES clear reviewSince/needsInputSince', async () => {
  const { registry } = await setupHookRegistry();
  registry.applyHook({ runtime: 'claude-code', sessionId: 'a', hookEvent: 'Stop', at: 1000 });
  assert.notEqual(find(registry, 'a').reviewSince, null);

  registry.applyHook({
    runtime: 'claude-code',
    sessionId: 'a',
    hookEvent: 'UserPromptSubmit',
    at: 2000,
  });
  assert.equal(find(registry, 'a').reviewSince, null);
});

test('poll path: assistant spoke last but a tool is still running -> working, NOT for_review', async () => {
  // The reported bug: an agent that was hard at work walked to the manager's
  // office and waited there. `lastRole === 'assistant'` is true for the whole
  // duration of a tool call, because the narration before a `tool_use` block
  // is the last TEXT in the transcript until the tool returns. A session is
  // only up for review once its turn has actually ended: assistant spoke last
  // AND nothing is outstanding.
  const adapter = makeAdapter('claude-code', {
    summaries: [makeSummary('a', { lastRole: 'assistant', turnEnded: false })],
    live: [makeLive('a')],
  });
  const registry = new Registry({ store: fakeStore(), adapters: [adapter] });
  await registry.refresh();

  const agent = find(registry, 'a');
  assert.equal(agent.activityState, 'working', 'a busy session stays at its desk');
  assert.equal(agent.reviewSince, null, 'and never enters the review queue');
});

test('poll path: the same session goes up for review once the tool returns', async () => {
  const adapter = makeAdapter('claude-code', {
    summaries: [makeSummary('a', { lastRole: 'assistant', turnEnded: false })],
    live: [makeLive('a')],
  });
  const registry = new Registry({ store: fakeStore(), adapters: [adapter] });
  await registry.refresh();
  assert.equal(find(registry, 'a').activityState, 'working');

  adapter.setSummaries([makeSummary('a', { lastRole: 'assistant', turnEnded: true })]);
  await registry.refresh();
  assert.equal(find(registry, 'a').activityState, 'for_review');
  assert.notEqual(find(registry, 'a').reviewSince, null);
});

test('archived in the app means let go; un-archiving rehires', async () => {
  const adapter = makeAdapter('claude-code', {
    summaries: [makeSummary('a', { archived: true })],
    live: [makeLive('a')],
  });
  const registry = new Registry({ store: fakeStore(), adapters: [adapter] });
  await registry.refresh();
  assert.equal(find(registry, 'a').ackState, 'let_go', 'archived -> fired');

  adapter.setSummaries([makeSummary('a', { archived: false })]);
  await registry.refresh();
  assert.equal(find(registry, 'a').ackState, 'active', 'un-archived -> rehired');
});

test('the archive mapping governs let_go only, and never clobbers a bench', async () => {
  // A session you benched in DeckHQ is not archived in the app. If "not
  // archived" were read as "should be active", every poll would drag it off
  // the lounge and back to its desk.
  const adapter = makeAdapter('claude-code', {
    summaries: [makeSummary('a', { archived: false })],
    live: [makeLive('a')],
  });
  const registry = new Registry({ store: fakeStore(), adapters: [adapter] });
  await registry.refresh();
  await registry.act(agentId('claude-code', 'a'), 'bench');
  assert.equal(find(registry, 'a').ackState, 'benched');

  await registry.refresh();
  assert.equal(find(registry, 'a').ackState, 'benched', 'still on the bench');
});

test('a runtime that cannot report an archive leaves ackState alone', async () => {
  // `archived` undefined must never be read as "not archived" — that would
  // rehire every let-go agent belonging to such a runtime on the next poll.
  const adapter = makeAdapter('claude-code', {
    summaries: [makeSummary('a')],
    live: [makeLive('a')],
  });
  const registry = new Registry({ store: fakeStore(), adapters: [adapter] });
  await registry.refresh();
  await registry.act(agentId('claude-code', 'a'), 'let_go');
  assert.equal(find(registry, 'a').ackState, 'let_go');

  await registry.refresh();
  assert.equal(find(registry, 'a').ackState, 'let_go', 'not silently rehired');
});

test('a runtime with no sessions is not "degraded" — the banner can clear', async () => {
  // Every registered adapter used to be flagged whenever its hooks were
  // missing, so Codex — which this machine has no sessions for — kept the
  // "install hooks for exact state" banner up permanently, including after
  // Claude Code's hooks were installed. Nothing the user did could clear it.
  const used = makeAdapter('claude-code', {
    summaries: [makeSummary('a')],
    live: [makeLive('a')],
  });
  const unused = makeAdapter('codex', { summaries: [], live: [] });
  const registry = new Registry({ store: fakeStore(), adapters: [used, unused] });
  registry.setHookStatus({
    'claude-code': { supported: true, installed: true },
    codex: { supported: true, installed: false },
  });
  await registry.refresh();

  const degraded = registry.snapshot().degraded;
  assert.equal(degraded['claude-code'], false, 'hooks installed, so not degraded');
  assert.ok(!degraded.codex, 'a runtime with no sessions has nothing to report inaccurately');
});

test('a runtime that IS in use and has no hooks is still flagged', async () => {
  const a = makeAdapter('claude-code', { summaries: [makeSummary('a')], live: [makeLive('a')] });
  const registry = new Registry({ store: fakeStore(), adapters: [a] });
  registry.setHookStatus({ 'claude-code': { supported: true, installed: false } });
  await registry.refresh();
  assert.equal(registry.snapshot().degraded['claude-code'], true);
});
