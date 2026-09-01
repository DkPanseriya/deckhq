import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentId,
  clampText,
  counts,
  estimateCost,
  needsYou,
  placement,
  projectIdFromCwd,
  projectNameFromCwd,
  projects,
  splitAgentId,
} from '../../src/core/model.mjs';

/** @param {Partial<import('../../src/core/model.mjs').Agent>} over */
function agent(over = {}) {
  return {
    id: 'claude-code:x',
    runtime: 'claude-code',
    title: 't',
    hasCustomTitle: false,
    projectId: 'p',
    projectName: 'p',
    cwd: 'C:/p',
    gitBranch: null,
    model: null,
    live: false,
    activityState: 'ended',
    ackState: 'active',
    reviewSince: null,
    needsInputSince: null,
    lastOutputAt: null,
    lastActivityAt: 0,
    tokens: 0,
    cacheTokens: 0,
    costEstimate: 0,
    lastRole: null,
    lastText: '',
    ...over,
  };
}

test('placement: user-owned states outrank observed ones', () => {
  // let_go and benched win over anything observed.
  // Let-go agents now have a room of their own (the departures room) rather
  // than vanishing from the floor. `let_go` still outranks every observed
  // state — an archived session does not queue for review.
  assert.equal(placement(agent({ ackState: 'let_go', activityState: 'for_review' })), 'let_go');
  assert.equal(placement(agent({ ackState: 'benched', activityState: 'for_review' })), 'lounge');
  assert.equal(placement(agent({ ackState: 'active', activityState: 'for_review' })), 'office');
});

test('placement: a dead session still sits at its project desk', () => {
  // docs/01-PRODUCT.md §4.1 — only an explicit bench moves it to the lounge.
  assert.equal(placement(agent({ live: false, activityState: 'ended' })), 'desk');
  assert.equal(placement(agent({ activityState: 'needs_input' })), 'desk');
  assert.equal(placement(agent({ activityState: 'stalled' })), 'desk');
  assert.equal(placement(agent({ activityState: 'working' })), 'desk');
});

test('needsYou counts only active agents in the three attention states', () => {
  assert.equal(needsYou(agent({ activityState: 'needs_input' })), true);
  assert.equal(needsYou(agent({ activityState: 'stalled' })), true);
  assert.equal(needsYou(agent({ activityState: 'for_review' })), true);
  assert.equal(needsYou(agent({ activityState: 'working' })), false);
  assert.equal(needsYou(agent({ activityState: 'ended' })), false);
  // Benched or let go never counts, whatever the runtime thinks.
  assert.equal(needsYou(agent({ activityState: 'for_review', ackState: 'benched' })), false);
  assert.equal(needsYou(agent({ activityState: 'for_review', ackState: 'let_go' })), false);
});

test('counts gives the three-way header breakdown', () => {
  const c = counts([
    agent({ id: 'a', activityState: 'needs_input' }),
    agent({ id: 'b', activityState: 'stalled' }),
    agent({ id: 'c', activityState: 'for_review' }),
    agent({ id: 'd', activityState: 'for_review' }),
    agent({ id: 'e', activityState: 'working' }),
    agent({ id: 'f', ackState: 'benched' }),
    agent({ id: 'g', ackState: 'let_go', activityState: 'for_review' }),
  ]);
  assert.equal(c.handsUp, 1);
  assert.equal(c.stalled, 1);
  assert.equal(c.forReview, 2);
  assert.equal(c.needsYou, 4);
  assert.equal(c.benched, 1);
  assert.equal(c.letGo, 1);
  assert.equal(c.working, 1);
  assert.equal(c.total, 7);
  // needs_input, stalled and working all sit at a desk; for_review is in the office.
  assert.equal(c.atDesk, 3);
});

test('project slugs are stable across separators and case', () => {
  const a = projectIdFromCwd('C:\\Dk\\Projects\\1_Project_DeckHQ');
  const b = projectIdFromCwd('c:/dk/projects/1_project_deckhq/');
  assert.equal(a, b);
  assert.equal(projectIdFromCwd(''), 'unknown');
  assert.equal(projectNameFromCwd('C:\\Dk\\Projects\\1_Project_DeckHQ'), '1_Project_DeckHQ');
  assert.equal(projectNameFromCwd('/home/me/career-ops/'), 'career-ops');
});

test('projects groups and sorts, and excludes let_go from sizing', () => {
  const list = projects([
    agent({ id: '1', projectId: 'a', projectName: 'a', tokens: 10 }),
    agent({ id: '2', projectId: 'a', projectName: 'a', tokens: 5, activityState: 'for_review' }),
    agent({ id: '3', projectId: 'a', projectName: 'a', ackState: 'let_go' }),
    agent({ id: '4', projectId: 'b', projectName: 'b' }),
  ]);
  const a = list.find((p) => p.id === 'a');
  assert.equal(a.sessionCount, 2, 'let_go must not size the room');
  assert.equal(a.agentIds.length, 3);
  assert.equal(a.tokens, 15);
  assert.equal(a.needsYou, 1);
  assert.equal(list[0].id, 'a', 'largest project first');
});

test('agent ids round-trip through the runtime prefix', () => {
  const id = agentId('claude-code', 'fd61ff58-6d65-4edc-9c77-1cd4efbf80a4');
  assert.equal(id, 'claude-code:fd61ff58-6d65-4edc-9c77-1cd4efbf80a4');
  assert.deepEqual(splitAgentId(id), {
    runtime: 'claude-code',
    sessionId: 'fd61ff58-6d65-4edc-9c77-1cd4efbf80a4',
  });
  // A session id containing a colon must not be truncated.
  assert.deepEqual(splitAgentId('codex:a:b'), { runtime: 'codex', sessionId: 'a:b' });
});

test('clampText collapses whitespace and truncates at 400', () => {
  assert.equal(clampText('  a\n\n b  '), 'a b');
  const long = clampText('x'.repeat(600));
  assert.equal(long.length, 400);
  assert.ok(long.endsWith('…'));
});

test('estimateCost separates cache reads from input and scales by model tier', () => {
  const opus = estimateCost({ input: 1e6, output: 0, model: 'claude-opus-5' });
  const sonnet = estimateCost({ input: 1e6, output: 0, model: 'claude-sonnet-5' });
  assert.ok(opus > sonnet, 'opus must not be priced below sonnet');
  // Cache reads are an order of magnitude cheaper than fresh input.
  const cached = estimateCost({ cacheRead: 1e6, model: 'claude-opus-5' });
  assert.ok(cached < opus / 5);
  assert.equal(estimateCost({}), 0);
});
