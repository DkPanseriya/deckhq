import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentId,
  clampText,
  counts,
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

test('counts.drawn describes the floor, and counts still describes the deck', () => {
  // WP-55. `atDesk` is every session whose placement is a desk, which is what
  // the deck and the CLI mean by it. `drawn.atDesk` is the ones the FLOOR puts
  // at a desk — a project with nobody active in it has no room, so the finished
  // sessions sitting in it are not drawn anywhere and are counted as
  // `drawn.finished` instead. They are still in `total`, still in the panel,
  // still in the deck.
  const list = [
    // `busy` has somebody working, so it gets a room and its finished session
    // is drawn at a desk in it.
    agent({ id: 'a', projectId: 'busy', activityState: 'working' }),
    agent({ id: 'b', projectId: 'busy', activityState: 'ended' }),
    // `quiet` has only finished sessions: a directory line, no room, nobody
    // drawn.
    agent({ id: 'c', projectId: 'quiet', activityState: 'ended' }),
    agent({ id: 'd', projectId: 'quiet', activityState: 'ended' }),
    // Waiting in the office — drawn, but not at a desk. Its project keeps a
    // room while it queues, which is why it is not in `quiet`.
    agent({ id: 'e', projectId: 'queued', activityState: 'for_review' }),
  ];
  const c = counts(list, { now: 1_000_000_000_000, goneHomeDays: 7 });
  assert.equal(c.atDesk, 4, 'the deck still counts every session at a desk');
  assert.equal(c.drawn.atDesk, 2, 'the floor draws two of them at a desk');
  assert.equal(c.drawn.finished, 2, 'and names the two it does not draw');
  assert.equal(c.drawn.waiting, 1);
  assert.equal(c.drawn.atDesk + c.drawn.finished, c.atDesk, 'every desk session is accounted for');
});

test('counts.drawn splits the benched by the gone-home window', () => {
  const NOW = 1_800_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;
  const benched = (id, ageDays) =>
    agent({ id, ackState: 'benched', lastActivityAt: NOW - ageDays * DAY });
  const list = [benched('a', 1), benched('b', 30), benched('c', 30), { ...benched('d', 30) }];
  list[3].lastActivityAt = 0; // nobody can date it, so the floor draws it

  const c = counts(list, { now: NOW, goneHomeDays: 7 });
  assert.equal(c.benched, 4, 'the deck counts every benched session');
  assert.equal(c.drawn.benched, 2, 'the lounge draws the recent one and the undateable one');
  assert.equal(c.drawn.wentHome, 2);
  assert.equal(c.drawn.benched + c.drawn.wentHome, c.benched);

  // A window of zero turns the filter off rather than sending everybody home,
  // the same refusal `plan.js` makes.
  const off = counts(list, { now: NOW, goneHomeDays: 0 });
  assert.equal(off.drawn.wentHome, 0);
  assert.equal(off.drawn.benched, 4);
  // And nothing wrote to anybody's ackState.
  for (const a of list) assert.equal(a.ackState, 'benched');
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

// `estimateCost` and the rate card left this file at WP-26: they read
// `src/data/rates.json` and the user's override, and this module promises no
// I/O. Their tests live in `test/unit/rates.test.mjs`.

test('a project sums only the sessions the rate card could price', () => {
  const [p] = projects([
    agent({ id: 'a', projectId: 'p', costEstimate: 1.5 }),
    agent({ id: 'b', projectId: 'p', costEstimate: null }),
  ]);
  assert.equal(p.costEstimate, 1.5);
  assert.equal(p.costRated, true, 'one priced session is enough to have a rate');
});

test('a project nobody could price is flagged unrated rather than zero', () => {
  const [p] = projects([
    agent({ id: 'a', projectId: 'p', costEstimate: null }),
    agent({ id: 'b', projectId: 'p', costEstimate: null }),
  ]);
  assert.equal(p.costEstimate, 0);
  assert.equal(p.costRated, false, '"no rate" and "$0.00" are different claims');
});
