/**
 * WP-99 — a lead with a junior still working stays at its own desk.
 *
 * The owner sent a picture of three juniors working on the floor round an
 * empty chair and asked whether it was a bug. It was a rule: the lead's turn
 * had ended (`for_review`), `placement()` sends every waiting session to the
 * reception, and its juniors are placed by their own state (bug 201) — so the
 * crew was at the desk and its lead on a sofa in another room.
 *
 * WHAT IS HELD HERE:
 *
 *   - the rule, and the order of what still wins over it: `let_go`, then the
 *     user's bench;
 *   - that it is PLACEMENT ONLY — the state, the wait badge, the queue and
 *     every needs-you count are what they were;
 *   - that a junior's own placement did not move;
 *   - that the floor, the header's "at desk" and the room's size agree;
 *   - that the lead at its desk does not look as if it is typing, and says
 *     why it is there.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  agentIndex,
  floorPopulation,
  isDeskAgent,
  isSupervising,
  isWaitingAgent,
  placement,
  workingJuniorsOf,
} from '../../public/floor-rule.js';
import { restingOrder } from '../../public/floor-resting.js';
import { supervisingLineFor } from '../../public/panel-format.js';
import { queueOrder } from '../../public/deck.js';
import { buildPlan } from '../../public/render/plan.js';
import { assignSeats, derivePlacement, rigSeatOf } from '../../public/render/agents.js';
import { clipForActivity, initialClipFor } from '../../public/render/agents-activity.js';
import { waitingBadgeMs } from '../../public/render/scene-frame.js';
import { iconForAgent, isNeedsYouAgent } from '../../public/render/scene-agent.js';
import { adoptSnapshotClock } from '../../public/clock.js';
import { counts, needsYou } from '../../src/core/model.mjs';
import { LARGE_NOW, populationFloor } from '../helpers/large-floor.mjs';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const STAGE = { w: 1600, h: 1000 };

const agent = (id, over = {}) => ({
  id,
  projectId: 'p',
  activityState: 'working',
  ackState: 'active',
  reviewSince: null,
  needsInputSince: null,
  lastActivityAt: NOW - MIN,
  ...over,
});
const junior = (id, parentId, over = {}) =>
  agent(id, { subagent: true, parentId, lastGrowthAt: NOW - 5_000, ...over });
const lead = (over = {}) =>
  agent('lead', { activityState: 'for_review', reviewSince: NOW - 3 * MIN, ...over });
const where = (a, agents) => placement(a, agentIndex(agents));
const PROJECTS = [{ id: 'p', name: 'p', sessionCount: 1, activeCount: 1 }];

const inside = (seat, rect, pad = 0.5) =>
  !!seat &&
  !!rect &&
  seat.x >= rect.x - pad &&
  seat.x <= rect.x + rect.w + pad &&
  seat.y >= rect.y - pad &&
  seat.y <= rect.y + rect.h + pad;

// ------------------------------------------------------------------ the rule

test('a waiting lead with a working junior is at its desk; with none, in the office', () => {
  for (const waiting of [
    { activityState: 'for_review', reviewSince: NOW - MIN },
    { activityState: 'needs_input', needsInputSince: NOW - MIN },
  ]) {
    const l = lead(waiting);
    const state = waiting.activityState;
    // One working junior is enough.
    assert.equal(where(l, [l, junior('j1', 'lead')]), 'desk', state);
    assert.equal(
      where(l, [l, junior('j1', 'lead'), junior('j2', 'lead', { activityState: 'ended' })]),
      'desk',
      state,
    );
    // Only ended juniors, a junior with its own hand up, or none: the office.
    assert.equal(where(l, [l, junior('j1', 'lead', { activityState: 'ended' })]), 'office', state);
    assert.equal(
      where(l, [
        l,
        junior('j1', 'lead', { activityState: 'needs_input', needsInputSince: NOW - MIN }),
      ]),
      'office',
      state,
    );
    assert.equal(where(l, [l]), 'office', state);
    // Somebody else's working junior is not this lead's crew.
    assert.equal(where(l, [l, agent('other'), junior('j1', 'other')]), 'office', state);
    // And asked without the snapshot, the rule is the per-agent one it was.
    assert.equal(placement(l), 'office', state);
  }
});

test('let_go wins, then the user’s bench; and an ended lead is not kept', () => {
  const crew = [junior('j1', 'lead'), junior('j2', 'lead'), junior('j3', 'lead')];
  const gone = lead({ ackState: 'let_go' });
  assert.equal(where(gone, [gone, ...crew]), 'let_go');
  const benched = lead({ ackState: 'benched' });
  assert.equal(where(benched, [benched, ...crew]), 'lounge');
  assert.equal(isSupervising(benched, agentIndex([benched, ...crew])), false);
  // Benched with its hand up, too: the user's ack is the user's.
  const hand = lead({ ackState: 'benched', activityState: 'needs_input' });
  assert.equal(where(hand, [hand, ...crew]), 'lounge');
  // The rule is about a session that is WAITING. One whose session has ended
  // rests where it rested; a working or stalled one was at its desk already.
  const ended = lead({ activityState: 'ended' });
  assert.equal(where(ended, [ended, ...crew]), 'lounge');
  for (const state of ['working', 'stalled']) {
    const busy = lead({ activityState: state });
    assert.equal(where(busy, [busy, ...crew]), 'desk');
    assert.equal(isSupervising(busy, agentIndex([busy, ...crew])), false, 'it is not waiting');
  }
});

test('when the last working junior ends, the lead goes where its own state sends it', () => {
  const l = lead();
  const j = (state) => [
    junior('j1', 'lead', { activityState: state[0] }),
    junior('j2', 'lead', { activityState: state[1] }),
  ];
  // Three snapshots, and nothing kept between them: it is a function of each.
  assert.equal(where(l, [l, ...j(['working', 'working'])]), 'desk');
  assert.equal(where(l, [l, ...j(['ended', 'working'])]), 'desk');
  assert.equal(where(l, [l, ...j(['ended', 'ended'])]), 'office');
  assert.equal(workingJuniorsOf(l, agentIndex([l, ...j(['ended', 'working'])])), 1);
  assert.equal(workingJuniorsOf(l, agentIndex([l, ...j(['ended', 'ended'])])), 0);
});

test('a junior’s own placement is what it was, with the index or without', () => {
  const states = ['working', 'stalled', 'needs_input', 'for_review', 'ended'];
  for (const parentState of states) {
    for (const state of states) {
      for (const ackState of ['active', 'benched', 'let_go']) {
        const l = lead({ activityState: parentState });
        const j = junior('j1', 'lead', { activityState: state, ackState });
        // A junior with a working sub-agent of its own is still placed by its state.
        const deeper = junior('j2', 'j1');
        const agents = [l, j, deeper];
        const label = `${state}/${ackState} under a ${parentState} lead`;
        assert.equal(where(j, agents), placement(j), label);
        assert.equal(derivePlacement(j, agentIndex(agents)), placement(j), label);
        assert.equal(isSupervising(j, agentIndex(agents)), false, label);
        assert.equal(workingJuniorsOf(j, agentIndex(agents)), 0, label);
      }
    }
  }
});

// -------------------------------------------------------- placement, and only

test('PLACEMENT ONLY: state, badge, icon, queue and every needs-you count are untouched', () => {
  adoptSnapshotClock({ now: NOW, nowFixed: true });
  try {
    const l = lead();
    const crewWorking = [junior('j1', 'lead'), junior('j2', 'lead'), junior('j3', 'lead')];
    const crewEnded = crewWorking.map((j) => ({ ...j, activityState: 'ended' }));
    const others = [
      agent('hand', { activityState: 'needs_input', needsInputSince: NOW - 5 * MIN }),
      agent('stuck', { activityState: 'stalled' }),
      agent('busy'),
    ];
    const kept = [l, ...crewWorking, ...others];
    const sent = [l, ...crewEnded, ...others];
    assert.equal(where(l, kept), 'desk');
    assert.equal(where(l, sent), 'office');

    // The same lead, the same counts, wherever it sits.
    const a = counts(kept, { now: NOW });
    const b = counts(sent, { now: NOW });
    for (const key of [
      'needsYou',
      'handsUp',
      'stalled',
      'forReview',
      'benched',
      'letGo',
      'total',
    ]) {
      assert.equal(a[key], b[key], key);
    }
    assert.equal(a.needsYou, 3);
    assert.equal(a.forReview, 1);
    assert.equal(needsYou(l), true);
    assert.equal(isNeedsYouAgent(l), true);
    // And a snapshot of the lead before the rule existed reads the same too:
    // nothing about the agent was written to.
    const before = JSON.stringify(l);
    where(l, kept);
    isSupervising(l, agentIndex(kept));
    assert.equal(JSON.stringify(l), before);
    assert.equal(l.activityState, 'for_review');
    assert.equal(l.ackState, 'active');

    // It wears its for-review badge and its check at the desk…
    assert.equal(waitingBadgeMs(l), 3 * MIN);
    assert.equal(iconForAgent(l), 'check');
    // …and is in the queue, in the place its wait gives it.
    const order = (list) => queueOrder(list).map((x) => x.id);
    assert.deepEqual(order(kept), order(sent));
    assert.ok(order(kept).includes('lead'));

    // What moved is where it is DRAWN: one more at a desk, one fewer on a sofa.
    assert.equal(a.drawn.atDesk, b.drawn.atDesk + 1 + crewWorking.length);
    assert.equal(a.drawn.waiting, b.drawn.waiting - 1);
  } finally {
    adoptSnapshotClock(null);
  }
});

// ---------------------------------------------------------------- on the floor

test('ON THE FLOOR: the lead sits at its desk with its juniors round it, and the counts agree', () => {
  for (const n of [1, 2, 3, 5, 13]) {
    const l = lead();
    const agents = [l];
    for (let i = 0; i < n; i++) agents.push(junior(`j${String(i).padStart(2, '0')}`, 'lead'));
    agents.push(agent('other', { projectId: 'q' }));
    const projects = [...PROJECTS, { id: 'q', name: 'q', sessionCount: 1, activeCount: 1 }];
    const byId = agentIndex(agents);
    const plan = buildPlan(projects, agents, { stage: STAGE, now: NOW });
    const seats = assignSeats(plan, agents);
    const room = plan.rooms.find((r) => r.kind === 'project' && r.id === 'p');
    const office = plan.rooms.find((r) => r.kind === 'office');
    const seat = seats.get('lead');
    const label = `${n} working junior${n === 1 ? '' : 's'}`;

    assert.ok(inside(seat, room), `${label}: the lead is not in its room`);
    assert.ok(!inside(seat, office, -0.5), `${label}: the lead is in the office`);
    assert.ok(
      (plan.seats.get('p') || []).some((s) => s === seat),
      `${label}: the lead is not at one of the room's desks`,
    );
    // Its crew is round ITS desk — not cabled to an empty one with its name on it.
    for (const j of agents.filter((a) => a.subagent)) {
      const js = seats.get(j.id);
      if (!js) continue; // past the draw cap: the `+N` chip
      assert.ok(inside(js, room), `${label}: ${j.id} is not in the room`);
      assert.equal(js.crewAway, undefined, `${label}: ${j.id}'s crew is marked away`);
      if (js.crew) {
        assert.equal(Math.hypot(js.crewAnchor.x - seat.x, js.crewAnchor.y - seat.y) < 1e-6, true);
      }
    }
    // The rule, the room's size and the header are one count.
    const pop = floorPopulation(agents, { now: NOW });
    assert.equal(pop.waiting, 0, label);
    assert.equal(isDeskAgent(l, byId), true);
    assert.equal(isWaitingAgent(l, byId), false);
    assert.equal(pop.leading.has('lead'), true);
    const c = counts(agents, { now: NOW });
    assert.equal(c.drawn.waiting, 0, label);
    assert.equal(c.drawn.atDesk, n + 2, `${label}: the lead, its crew and the bystander`);
    // And the lounge's list does not have it either.
    assert.equal(
      restingOrder(agents, new Set()).some((a) => a.id === 'lead'),
      false,
    );
  }
});

test('ON THE FLOOR: the demo’s waiting crew has its lead at the desk', () => {
  // `crew-waiting` is bug 201's own fixture: a senior in `for_review` with
  // thirteen juniors, of which some are still writing.
  const { projects, agents } = populationFloor('crew-waiting');
  const byId = agentIndex(agents);
  const boss = agents.find((a) => !a.subagent && workingJuniorsOf(a, byId) > 0);
  assert.ok(boss, 'the fixture has no lead with a working junior');
  assert.equal(boss.activityState, 'for_review');
  assert.equal(isSupervising(boss, byId), true);
  const plan = buildPlan(projects, agents, { stage: STAGE, now: LARGE_NOW });
  const seats = assignSeats(plan, agents);
  const room = plan.rooms.find((r) => r.kind === 'project' && r.id === boss.projectId);
  assert.ok(inside(seats.get(boss.id), room), 'the lead is not in its crew’s room');
  const first = agents.map((a) => seats.get(a.id)).find((s) => s && s.crew === true);
  assert.equal(first.crewOf, boss.id);
  assert.equal(first.crewAway, undefined);
});

// ------------------------------------------------------- how it looks and reads

test('SUPERVISING: at its desk a waiting lead holds its page and does not type', () => {
  // A finished turn at a desk is only ever a lead waiting on its crew.
  assert.equal(clipForActivity('for_review'), 'stand_wait');
  assert.notEqual(clipForActivity('for_review'), clipForActivity('working'));
  assert.equal(initialClipFor(lead(), 'desk'), initialClipFor(lead(), 'office'));
  // A raised hand is a raised hand wherever it is raised.
  const hand = lead({ activityState: 'needs_input' });
  assert.equal(initialClipFor(hand, 'desk'), 'hand_raise');
  // Everybody else at a desk is as they were.
  assert.equal(clipForActivity('working'), 'type');
  assert.equal(clipForActivity('stalled'), 'slump');
  // And it sits in the desk's chair, in its own state's pose.
  const rec = { path: [], targetSeat: { x: 1, y: 2 }, placement: 'desk', seated: true };
  assert.equal(rigSeatOf(rec, null), 'desk');
});

test('SUPERVISING: the tooltip says what it is waiting on, and says it of nobody else', () => {
  const l = lead();
  const one = [l, junior('j1', 'lead')];
  const three = [l, junior('j1', 'lead'), junior('j2', 'lead'), junior('j3', 'lead')];
  assert.equal(supervisingLineFor(l, one), 'waiting on 1 junior');
  assert.equal(supervisingLineFor(l, three), 'waiting on 3 juniors');
  // The count is the juniors still WORKING, not the juniors.
  const mixed = [l, junior('j1', 'lead'), junior('j2', 'lead', { activityState: 'ended' })];
  assert.equal(supervisingLineFor(l, mixed), 'waiting on 1 junior');
  // Nobody the floor did not keep at a desk for that reason gets the phrase.
  assert.equal(supervisingLineFor(l, [l]), null);
  assert.equal(supervisingLineFor(l, null), null);
  assert.equal(supervisingLineFor(three[1], three), null, 'a junior');
  const busy = lead({ activityState: 'working' });
  assert.equal(supervisingLineFor(busy, [busy, junior('j1', 'lead')]), null, 'a working lead');
  const benched = lead({ ackState: 'benched' });
  assert.equal(supervisingLineFor(benched, [benched, junior('j1', 'lead')]), null, 'benched');
});
