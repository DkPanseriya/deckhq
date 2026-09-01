import { test } from 'node:test';
import assert from 'node:assert/strict';

import { seedPlan, seedIfNeeded } from '../../src/core/seed.mjs';
import { agentId } from '../../src/core/model.mjs';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const REVIEW_WINDOW = 72 * HOUR;
const ACTIVE_WINDOW = 14 * DAY;
const NOW = 2_000_000_000_000; // arbitrary fixed epoch

/** @param {Partial<import('../../src/core/model.mjs').SessionSummary>} overrides */
function summary(overrides) {
  return {
    runtime: 'claude-code',
    title: 'a session',
    hasCustomTitle: false,
    cwd: 'C:\\proj',
    gitBranch: null,
    model: 'claude-opus-5',
    lastActivityAt: NOW,
    tokens: 100,
    cacheTokens: 0,
    costEstimate: 0.01,
    lastRole: 'assistant',
    lastText: 'done',
    ...overrides,
    // Always last and always prefixed: overrides.id is the raw session id,
    // never the final agent id, no matter what order the caller listed it.
    id: agentId('claude-code', overrides.id ?? 's1'),
  };
}

/** Minimal in-memory Store double: exactly the surface seed.mjs uses. */
function fakeStore() {
  let seededAt = null;
  const ack = new Map();
  return {
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
    _ackMap: ack,
  };
}

test('seedPlan: assistant spoke last, well within 72h -> for_review with reviewSince = lastActivityAt', () => {
  const lastActivityAt = NOW - (REVIEW_WINDOW - 1);
  const s = summary({ id: 'a', lastRole: 'assistant', lastActivityAt });
  const plan = seedPlan([s], NOW);
  assert.deepEqual(plan.get(s.id), { state: 'active', reviewSince: lastActivityAt });
});

test('seedPlan: boundary at exactly 72h does NOT qualify for for_review (strict <)', () => {
  const lastActivityAt = NOW - REVIEW_WINDOW;
  const s = summary({ id: 'a', lastRole: 'assistant', lastActivityAt });
  const plan = seedPlan([s], NOW);
  assert.deepEqual(plan.get(s.id), { state: 'active', reviewSince: null });
});

test('seedPlan: user spoke last within 72h -> plain active, not for_review', () => {
  const lastActivityAt = NOW - HOUR;
  const s = summary({ id: 'a', lastRole: 'user', lastActivityAt });
  const plan = seedPlan([s], NOW);
  assert.deepEqual(plan.get(s.id), { state: 'active', reviewSince: null });
});

test('seedPlan: activity between 72h and 14 days -> active at desk regardless of lastRole', () => {
  const lastActivityAt = NOW - (REVIEW_WINDOW + HOUR);
  const s = summary({ id: 'a', lastRole: 'assistant', lastActivityAt });
  const plan = seedPlan([s], NOW);
  assert.deepEqual(plan.get(s.id), { state: 'active', reviewSince: null });
});

test('seedPlan: boundary just under 14 days -> active', () => {
  const lastActivityAt = NOW - (ACTIVE_WINDOW - 1);
  const s = summary({ id: 'a', lastRole: 'user', lastActivityAt });
  const plan = seedPlan([s], NOW);
  assert.deepEqual(plan.get(s.id), { state: 'active', reviewSince: null });
});

test('seedPlan: boundary at exactly 14 days -> let_go (strict <)', () => {
  const lastActivityAt = NOW - ACTIVE_WINDOW;
  const s = summary({ id: 'a', lastRole: 'assistant', lastActivityAt });
  const plan = seedPlan([s], NOW);
  assert.deepEqual(plan.get(s.id), { state: 'let_go', reviewSince: null });
});

test('seedPlan: much older than 14 days -> let_go', () => {
  const lastActivityAt = NOW - (ACTIVE_WINDOW + 30 * DAY);
  const s = summary({ id: 'a', lastRole: 'user', lastActivityAt });
  const plan = seedPlan([s], NOW);
  assert.deepEqual(plan.get(s.id), { state: 'let_go', reviewSince: null });
});

test('seedPlan: handles many sessions independently', () => {
  const sessions = [
    summary({ id: 'fresh', lastRole: 'assistant', lastActivityAt: NOW - HOUR }),
    summary({ id: 'mid', lastRole: 'user', lastActivityAt: NOW - 5 * DAY }),
    summary({ id: 'old', lastRole: 'assistant', lastActivityAt: NOW - 40 * DAY }),
  ];
  const plan = seedPlan(sessions, NOW);
  assert.equal(plan.get(agentId('claude-code', 'fresh')).state, 'active');
  assert.notEqual(plan.get(agentId('claude-code', 'fresh')).reviewSince, null);
  assert.equal(plan.get(agentId('claude-code', 'mid')).state, 'active');
  assert.equal(plan.get(agentId('claude-code', 'mid')).reviewSince, null);
  assert.equal(plan.get(agentId('claude-code', 'old')).state, 'let_go');
});

test('seedIfNeeded runs exactly once and records seededAt', async () => {
  const store = fakeStore();
  const s = summary({ id: 'a', lastRole: 'assistant', lastActivityAt: NOW - HOUR });

  const ranFirst = await seedIfNeeded(store, [s], NOW);
  assert.equal(ranFirst, true);
  assert.equal(store.seededAt, NOW);
  const firstRecord = store.getAck(s.id);
  assert.notEqual(firstRecord.reviewSince, null);

  // Change the underlying data and try again: seeding must not re-run.
  const s2 = summary({ id: 'a', lastRole: 'user', lastActivityAt: NOW });
  const ranSecond = await seedIfNeeded(store, [s2], NOW + DAY);
  assert.equal(ranSecond, false);
  assert.deepEqual(store.getAck(s.id), firstRecord);
});

test('seedIfNeeded never overwrites an ack record that already exists', async () => {
  const store = fakeStore();
  const s = summary({ id: 'a', lastRole: 'assistant', lastActivityAt: NOW - HOUR });

  // Simulate a record already present before seeding ever runs (e.g. the
  // user, or some earlier code path, already acted on this session).
  store.setAck(s.id, { state: 'benched', reviewSince: 42 });

  await seedIfNeeded(store, [s], NOW);

  const rec = store.getAck(s.id);
  assert.equal(rec.state, 'benched');
  assert.equal(rec.reviewSince, 42);
});

test('seedIfNeeded marks seeded even with zero sessions, so it never retries later', async () => {
  const store = fakeStore();
  const ran = await seedIfNeeded(store, [], NOW);
  assert.equal(ran, true);
  assert.equal(store.seededAt, NOW);
  assert.deepEqual(store._ackMap.size, 0);

  const ranAgain = await seedIfNeeded(store, [summary({ id: 'later' })], NOW + DAY);
  assert.equal(ranAgain, false);
  assert.equal(store._ackMap.size, 0);
});
