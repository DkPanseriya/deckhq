/**
 * The change key, and the one way it can be wrong — WP-92h, A-05.
 *
 * `_rebuild()` asks `changeKey(agents)` whether the floor moved, and the
 * answer decides whether anybody is told. Before WP-92h the question was
 * `JSON.stringify(agents)`, which reads every field because it does not know
 * what a field is. `changeKey` names them, which is where the 5.8x comes from
 * and also the only way it can fail: a field named in `Agent` and not named
 * here is a field whose change never leaves the daemon. The floor would keep
 * drawing the old value until something else moved.
 *
 * So this file walks a REAL agent — computed by a real `Registry` over the
 * adapter contract, not hand-written — moves each of its fields in turn, and
 * asserts the key moved with it. Add a field to `Agent` and forget
 * `changeKey`, and this fails on the field's own name.
 *
 * The nested three (`tokenBreakdown`, `currentTool`, `pendingPermission`) and
 * `supersedes` are listed explicitly: two of them are absent from a plain
 * agent, so walking the object's own keys would never reach them.
 */
// A machine of our own, before anything under `src/` is loaded.
// `docs/DEVIATIONS.md` §124.
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Registry } from '../../src/core/state-machine.mjs';
import { changeKey } from '../../src/core/state-machine-rules.mjs';
import { agentId } from '../../src/core/model.mjs';

function fakeStore() {
  const ack = new Map();
  return {
    async load() {},
    get settings() {
      return { stallWindowMs: 600000, notifications: true, sound: false, pollIntervalMs: 5000 };
    },
    setSettings() {},
    get seededAt() {
      return null;
    },
    markSeeded() {},
    getAck(id) {
      return ack.has(id) ? { ...ack.get(id) } : undefined;
    },
    setAck(id, patch) {
      const next = { state: 'active', reviewSince: null, needsInputSince: null, ...patch };
      ack.set(id, next);
      return { ...next };
    },
    allAck() {
      return {};
    },
    isProjectArchived() {
      return false;
    },
    archivedProjects() {
      return [];
    },
  };
}

function adapterWith(summaries, live) {
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
    async conversation() {
      return [];
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
  };
}

/** Two sessions, so the key has a list to get wrong as well as a record. */
async function realAgents() {
  const summaries = ['a', 'b'].map((id, i) => ({
    id: agentId('claude-code', id),
    runtime: 'claude-code',
    title: `title-${id}`,
    hasCustomTitle: false,
    cwd: `C:\\proj-${id}`,
    gitBranch: 'main',
    model: 'claude-opus-5',
    lastActivityAt: 1_700_000_000_000 + i,
    tokens: 10 + i,
    cacheTokens: 0,
    costEstimate: 0.01,
    lastRole: 'user',
    lastText: 'hi',
    turnEnded: false,
  }));
  const live = summaries.map((s) => ({
    id: s.id,
    runtime: 'claude-code',
    cwd: s.cwd,
    name: null,
    startedAt: 1_700_000_000_000,
    pid: 111,
  }));
  const registry = new Registry({ store: fakeStore(), adapters: [adapterWith(summaries, live)] });
  await registry.refresh();
  assert.equal(registry.agents.length, 2, 'the fixture must produce two agents');
  return registry.agents;
}

/**
 * A different value of the same rough kind. Never the same value: the test
 * asserts the key MOVED, so a bump that does not move the field proves
 * nothing.
 */
function bump(v) {
  if (typeof v === 'string') return v + '-moved';
  if (typeof v === 'number') return v + 1;
  if (typeof v === 'boolean') return !v;
  if (v === null) return 'no-longer-null';
  if (Array.isArray(v)) return [...v, 'one-more'];
  return null;
}

/** The nested shapes, and the values a field of each can take. */
const NESTED = {
  tokenBreakdown: [
    undefined,
    { input: 1, output: 2 },
    { input: 1, output: 3 },
    { input: 1, output: 2, cacheRead: 4 },
  ],
  currentTool: [
    null,
    { name: 'Bash', summary: 'npm test', since: 1_700_000_000_000 },
    { name: 'Bash', summary: 'npm run lint', since: 1_700_000_000_000 },
    { name: 'Read', summary: 'npm test', since: 1_700_000_000_000 },
    { name: 'Bash', summary: 'npm test', since: 1_700_000_000_001 },
  ],
  pendingPermission: [
    null,
    {
      id: 'tu_1',
      tool: 'Bash',
      summary: 'rm -rf build',
      suggestions: [],
      requiresUserInteraction: false,
      since: 1_700_000_000_000,
    },
    {
      id: 'tu_1',
      tool: 'Bash',
      summary: 'rm -rf dist',
      suggestions: [],
      requiresUserInteraction: false,
      since: 1_700_000_000_000,
    },
  ],
  supersedes: [[], ['claude-code:old'], ['claude-code:old', 'claude-code:older']],
};

test('every field of a real agent moves the change key', async () => {
  const agents = await realAgents();
  const base = changeKey(agents);

  for (const field of Object.keys(agents[0])) {
    if (field in NESTED) continue; // covered below, with real shapes
    const moved = [{ ...agents[0], [field]: bump(agents[0][field]) }, agents[1]];
    assert.notEqual(
      changeKey(moved),
      base,
      `changeKey does not read "${field}" — a change to it would never reach the browser`,
    );
  }
});

test('the nested fields move the change key, present, absent and altered', async () => {
  const agents = await realAgents();
  for (const [field, values] of Object.entries(NESTED)) {
    /** @type {Set<string>} */
    const seen = new Set();
    for (const value of values) {
      const one = { ...agents[0] };
      if (value === undefined) delete one[field];
      else one[field] = value;
      const key = changeKey([one, agents[1]]);
      assert.equal(seen.has(key), false, `changeKey collides on two values of "${field}"`);
      seen.add(key);
    }
  }
});

test('a field of one agent moving is not the same key as the same move on the other', async () => {
  const agents = await realAgents();
  const first = changeKey([{ ...agents[0], tokens: 99 }, agents[1]]);
  const second = changeKey([agents[0], { ...agents[1], tokens: 99 }]);
  assert.notEqual(first, second);
});

test('losing an agent moves the key, and so does gaining one', async () => {
  const agents = await realAgents();
  const base = changeKey(agents);
  assert.notEqual(changeKey([agents[0]]), base);
  assert.notEqual(changeKey([...agents, { ...agents[0], id: 'claude-code:c' }]), base);
});

test('free text cannot smuggle a separator from one field into the next', async () => {
  // The reason `title` and `lastText` are length-prefixed. Without the length,
  // these two floors are one string: the separator the key uses is a character
  // a title is allowed to contain.
  const agents = await realAgents();
  const left = { ...agents[0], title: 'a\u001fb', lastText: 'c' };
  const right = { ...agents[0], title: 'a', lastText: 'b\u001fc' };
  assert.notEqual(changeKey([left, agents[1]]), changeKey([right, agents[1]]));
});

test('an empty string and an absent value are not the same key', async () => {
  const agents = await realAgents();
  const empty = changeKey([{ ...agents[0], lastText: '' }, agents[1]]);
  const absent = changeKey([{ ...agents[0], lastText: undefined }, agents[1]]);
  const nulled = changeKey([{ ...agents[0], gitBranch: null }, agents[1]]);
  const blank = changeKey([{ ...agents[0], gitBranch: '' }, agents[1]]);
  assert.notEqual(empty, absent);
  assert.notEqual(nulled, blank);
});

test('the same floor twice is the same key', async () => {
  const agents = await realAgents();
  assert.equal(changeKey(agents), changeKey(agents.map((a) => ({ ...a }))));
  assert.equal(changeKey([]), changeKey([]));
});
