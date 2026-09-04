/**
 * WP-28's hardest acceptance line: **computing a trait touches nothing the
 * user owns.**
 *
 * A trait is a description of an agent's behaviour, read off a ledger and a
 * scan. Reading it must be exactly as consequential as looking at the floor,
 * which is to say not at all — and the one way to prove that is to drive a
 * registry through a script, take the whole ack map and the whole agent list,
 * compute every trait, and compare both again afterwards.
 *
 * The structural half is the same guarantee stated as an import rule, the way
 * `docs/DEVIATIONS.md` §100 states it for the ledger: `src/core/traits.mjs`
 * cannot reach `store.mjs`, so it cannot read `reviewSince` and cannot write
 * `ackState` even by accident. If somebody later reaches for the shortcut, the
 * grep below fails loudly rather than the behaviour drifting quietly.
 */
import '../helpers/isolate.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Registry } from '../../src/core/state-machine.mjs';
import { agentId } from '../../src/core/model.mjs';
import { traits } from '../../src/core/traits.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const RECENT = Date.now() - 60_000;

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

function summary(id, over = {}) {
  return {
    id: agentId('claude-code', id),
    runtime: 'claude-code',
    title: `title-${id}`,
    hasCustomTitle: false,
    cwd: over.cwd ?? 'C:\\work\\api',
    gitBranch: null,
    model: 'claude-opus-5-20260501',
    lastActivityAt: RECENT,
    tokens: 10,
    cacheTokens: 0,
    costEstimate: 0,
    lastRole: over.lastRole ?? 'user',
    lastText: 'hi',
    turnEnded: over.lastRole === 'assistant',
    toolMix: over.toolMix ?? { files: 2, shell: 30, web: 0, search: 1 },
    textMedian: over.textMedian ?? 64,
    textTurns: 12,
  };
}

function makeAdapter(summaries) {
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

test('INVARIANT: computing every agent`s traits changes neither the agents nor one byte of ack state', async () => {
  const store = fakeStore();
  const adapter = makeAdapter([
    summary('a', { lastRole: 'assistant' }),
    summary('b', { cwd: 'C:\\work\\ui' }),
    summary('c'),
  ]);
  const registry = new Registry({ store, adapters: [adapter], ledger: null });
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
  await registry.act(agentId('claude-code', 'a'), 'acknowledge');

  const agentsBefore = JSON.parse(JSON.stringify(registry.agents));
  const ackBefore = store.allAck();

  // A synthetic ledger with enough stops that every agent gets a real line —
  // a run where every answer was "new here" would prove nothing.
  const records = [];
  for (const a of registry.agents) {
    for (let i = 0; i < 6; i++) {
      records.push({
        t: RECENT - 100_000 + i * 1000,
        kind: 'state',
        sessionId: a.id,
        projectKey: 'k',
        dim: 'activity',
        from: 'working',
        to: i % 2 ? 'needs_input' : 'for_review',
      });
    }
  }

  const lines = [];
  for (const a of registry.agents) {
    const set = traits(a.id, { records, summary: registry.traitInput(a.id) });
    lines.push(set.line);
    assert.equal(set.degraded, false, `${a.id} should have a real line`);
  }
  // And they really are lines, so the comparison below is not three no-ops.
  assert.equal(lines.length, 3);
  for (const line of lines) assert.ok(line.includes('shell-heavy'), line);

  assert.deepEqual(registry.agents, agentsBefore, 'computing traits changed the agents');
  assert.deepEqual(store.allAck(), ackBefore, 'computing traits changed ack state');
});

test('INVARIANT: the traits module and its route cannot reach user-owned state', () => {
  for (const rel of ['src/core/traits.mjs', 'src/http/routes/traits.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // Comments in these files legitimately NAME the fields they must not
    // touch, so the ban is on code: an import, a call, a property write.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of [
      'store.mjs',
      'setAck',
      'reviewSince',
      'needsInputSince',
      'ackState',
      '/api/ack',
    ]) {
      assert.ok(!code.includes(forbidden), `${rel} reaches for ${forbidden}`);
    }
  }
});

test('INVARIANT: `traitInput` is a copy, so a caller cannot write through it', async () => {
  const store = fakeStore();
  const registry = new Registry({
    store,
    adapters: [makeAdapter([summary('a')])],
    ledger: null,
  });
  await registry.refresh();
  const id = agentId('claude-code', 'a');
  const first = registry.traitInput(id);
  first.toolMix.shell = 99_999;
  first.model = 'not-a-model';
  assert.equal(registry.traitInput(id).toolMix.shell, 30);
  assert.equal(registry.traitInput(id).model, 'claude-opus-5-20260501');
  assert.equal(registry.traitInput('claude-code:nobody'), null);
});
