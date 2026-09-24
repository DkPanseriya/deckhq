/**
 * Bug 201 — a junior sits where ITS OWN state puts it, never where its parent is.
 *
 * The owner, 24 September: _"many sessions running, but nobody on the desk, they
 * are rather shown working in boss office."_ His floor had fifteen sessions in
 * `working`; thirteen were juniors of one `career-ops` senior that had finished
 * its turn and was waiting on the reception sofa for review. `assignSeats`
 * anchored every junior to its parent's seat, wherever that seat was, so a
 * crew of thirteen working juniors was drawn standing round the office sofa and
 * the project room they were working in had thirteen empty desks.
 *
 * The rule this file holds, per agent and by its own state:
 *
 *   - working / stalled  -> a desk in its project room. Beside its parent's DESK
 *     when the parent has one; its own desk in the room when the parent does
 *     not (on a sofa, in the lounge, gone). Three or more concurrent juniors are
 *     a formation, anchored to the parent's desk or — the parent away — to the
 *     room's primary desk, with the parent's name on it.
 *   - waiting            -> the office, like anyone else.
 *   - ended / benched    -> the lounge, like anyone else.
 *
 * Everything is asked of the REAL plan and the REAL seating pass, because the
 * defect was a rule true in `placement()` (a working junior was `desk`) and false
 * on the floor (its coordinates were on a sofa).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlan } from '../../public/render/plan.js';
import { assignSeats } from '../../public/render/agents.js';
import { CREW_DRAW_CAP, floorPopulation, placement } from '../../public/floor-rule.js';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const STAGE = { w: 1600, h: 1000 };

/** @param {string} id @param {object} over */
function agent(id, over = {}) {
  return {
    id,
    projectId: 'career-ops',
    activityState: 'working',
    ackState: 'active',
    reviewSince: null,
    needsInputSince: null,
    lastActivityAt: NOW - MIN,
    ...over,
  };
}

/** A junior of `parentId`, working, its transcript moving. */
const junior = (id, parentId, over = {}) =>
  agent(id, { subagent: true, parentId, lastGrowthAt: NOW - 5_000, ...over });

const room = (plan, kind, id) =>
  plan.rooms.find((r) => r.kind === kind && (id === undefined || r.id === id));

const inside = (seat, rect, pad = 0.5) =>
  !!seat &&
  !!rect &&
  seat.x >= rect.x - pad &&
  seat.x <= rect.x + rect.w + pad &&
  seat.y >= rect.y - pad &&
  seat.y <= rect.y + rect.h + pad;

/** Zero-padded, so id order is number order and the first twelve are drawn. */
const jid = (i) => `claude-code:j${String(i).padStart(2, '0')}`;

const same = (a, b) => !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

/**
 * THE OWNER'S FLOOR, in the shape `GET /api/state` showed it: one `career-ops`
 * senior in `for_review` with thirteen working juniors, two top-level working
 * sessions elsewhere (one running `Bash`), and a benched `working` and a benched
 * `needs_input` in the same repo.
 */
function ownersFloor() {
  const parent = agent('claude-code:boss', {
    activityState: 'for_review',
    reviewSince: NOW - 3 * MIN,
  });
  const agents = [parent];
  for (let i = 0; i < 13; i++) {
    agents.push(junior(`claude-code:j${String(i).padStart(2, '0')}`, parent.id));
  }
  agents.push(
    agent('claude-code:wt', {
      projectId: 'career-ops-wt',
      currentTool: { name: 'Bash', summary: 'Bash npm test', since: NOW - 4_000 },
    }),
    agent('claude-code:deck', { projectId: 'deckhq' }),
    agent('claude-code:bench-work', { ackState: 'benched' }),
    agent('claude-code:bench-hand', {
      ackState: 'benched',
      activityState: 'needs_input',
      needsInputSince: NOW - 9 * MIN,
    }),
  );
  const projects = [
    { id: 'career-ops', name: 'career-ops', sessionCount: 3, activeCount: 1 },
    { id: 'career-ops-wt', name: 'career-ops-wt', sessionCount: 1, activeCount: 1 },
    { id: 'deckhq', name: 'deckhq', sessionCount: 1, activeCount: 1 },
  ];
  return { agents, projects, parent };
}

test('bug 201: a waiting senior’s thirteen working juniors are in the project room, not the office', () => {
  const { agents, projects, parent } = ownersFloor();
  const plan = buildPlan(projects, agents, { stage: STAGE, now: NOW });
  const seats = assignSeats(plan, agents);
  const office = room(plan, 'office');
  const lounge = room(plan, 'lounge');
  const career = room(plan, 'project', 'career-ops');
  assert.ok(career, 'career-ops has working sessions in it and must have a room');

  // The senior is where its own state puts it: on the reception sofa.
  assert.equal(placement(parent), 'office');
  assert.ok(inside(seats.get(parent.id), office), 'the waiting senior is in the office');

  // Its juniors are where THEIR state puts them: working, so at the room.
  const juniors = agents.filter((a) => a.subagent === true);
  const drawn = juniors.filter((j) => seats.has(j.id));
  assert.equal(drawn.length, CREW_DRAW_CAP, 'twelve are drawn, the thirteenth is the chip');
  for (const j of drawn) {
    const seat = seats.get(j.id);
    assert.ok(inside(seat, career), `${j.id} is not in the career-ops room`);
    assert.ok(!inside(seat, office, -0.5), `${j.id} is working in the boss's office`);
  }
  // A formation, anchored to a DESK of that room, with the parent named on it.
  const deskSeats = plan.seats.get('career-ops') || [];
  const first = seats.get(drawn[0].id);
  assert.equal(first.crew, true, 'thirteen juniors are a crew');
  assert.equal(first.crewOf, parent.id);
  assert.equal(first.crewAway, true, 'the parent is not at the desk the crew is cabled to');
  assert.ok(
    deskSeats.some((s) => same(s, first.crewAnchor)),
    'the arc is anchored to one of the room’s own desks',
  );
  assert.equal(first.crewTotal, 13, 'the chip counts the crew at the desk');

  // The two top-level working sessions are at desks in their own rooms.
  for (const id of ['claude-code:wt', 'claude-code:deck']) {
    const a = agents.find((x) => x.id === id);
    const seat = seats.get(id);
    assert.ok(seat, `${id} has no place`);
    assert.ok(inside(seat, room(plan, 'project', a.projectId)), `${id} is not at its desk`);
  }
  // The user's ack wins over the observed state: benched is the lounge.
  for (const id of ['claude-code:bench-work', 'claude-code:bench-hand']) {
    assert.equal(placement(agents.find((x) => x.id === id)), 'lounge');
    assert.ok(inside(seats.get(id), lounge), `${id} is benched and not in the lounge`);
  }
});

test('bug 201: one or two juniors of a parent that is away take desks of their own', () => {
  const parent = agent('claude-code:p', { activityState: 'for_review', reviewSince: NOW - MIN });
  const agents = [parent, junior('claude-code:j1', parent.id), junior('claude-code:j2', parent.id)];
  const projects = [{ id: 'career-ops', name: 'career-ops', sessionCount: 1, activeCount: 1 }];
  const plan = buildPlan(projects, agents, { stage: STAGE, now: NOW });
  const seats = assignSeats(plan, agents);
  const deskSeats = plan.seats.get('career-ops') || [];
  assert.equal(deskSeats.length, 2, 'a desk each, and none for the parent on the sofa');
  for (const id of ['claude-code:j1', 'claude-code:j2']) {
    const seat = seats.get(id);
    assert.ok(
      deskSeats.some((s) => same(s, seat)),
      `${id} is not at a desk of its own in the room`,
    );
    assert.notEqual(seat.crew, true);
  }
  assert.ok(!same(seats.get('claude-code:j1'), seats.get('claude-code:j2')));
});

test('bug 201: every working junior is in its room, whatever its parent is doing', () => {
  /** @type {Record<string, object|null>} */
  const parents = {
    working: { activityState: 'working' },
    stalled: { activityState: 'stalled' },
    needs_input: { activityState: 'needs_input', needsInputSince: NOW - MIN },
    for_review: { activityState: 'for_review', reviewSince: NOW - MIN },
    ended: { activityState: 'ended' },
    benched: { activityState: 'ended', ackState: 'benched' },
    'benched working': { activityState: 'working', ackState: 'benched' },
    gone: null,
  };
  for (const [label, over] of Object.entries(parents)) {
    for (const n of [1, 2, 3, 5, 13]) {
      const agents = over ? [agent('claude-code:p', over)] : [];
      for (let i = 0; i < n; i++) agents.push(junior(jid(i), 'claude-code:p'));
      // A bystander keeps the room from being the parent's alone.
      agents.push(agent('claude-code:other', { projectId: 'elsewhere' }));
      const projects = [
        { id: 'career-ops', name: 'career-ops', sessionCount: over ? 1 : 0, activeCount: 1 },
        { id: 'elsewhere', name: 'elsewhere', sessionCount: 1, activeCount: 1 },
      ];
      const plan = buildPlan(projects, agents, { stage: STAGE, now: NOW });
      const seats = assignSeats(plan, agents);
      const career = room(plan, 'project', 'career-ops');
      assert.ok(career, `${label}/${n}: a repo with working sessions has a room`);
      for (let i = 0; i < Math.min(n, CREW_DRAW_CAP); i++) {
        const seat = seats.get(jid(i));
        assert.ok(seat, `${label}/${n}: junior ${i} has no place`);
        assert.ok(inside(seat, career), `${label}/${n}: junior ${i} is outside its room`);
      }
      if (over && placement(agents[0]) === 'desk') {
        assert.ok(inside(seats.get('claude-code:p'), career), `${label}: parent at its desk`);
      }
    }
  }
});

test('bug 201: a finished or waiting junior is in the zone anybody else would be', () => {
  const parent = agent('claude-code:p');
  const done = junior('claude-code:done', parent.id, { activityState: 'ended' });
  const hand = junior('claude-code:hand', parent.id, {
    activityState: 'needs_input',
    needsInputSince: NOW - MIN,
  });
  assert.equal(placement(done), 'lounge');
  assert.equal(placement(hand), 'office');
  const agents = [parent, done, hand];
  const projects = [{ id: 'career-ops', name: 'career-ops', sessionCount: 1, activeCount: 1 }];
  const plan = buildPlan(projects, agents, { stage: STAGE, now: NOW });
  const seats = assignSeats(plan, agents);
  assert.ok(inside(seats.get(done.id), room(plan, 'lounge')), 'an ended junior rests');
  assert.ok(inside(seats.get(hand.id), room(plan, 'office')), 'a raised hand waits on you');
});

test('bug 201: a junior spawned into a worktree works in its parent’s room', () => {
  // The owner's own floor: a subagent run with worktree isolation reports the
  // worktree as its cwd, a repo with no session of its own (`sessionCount` 0).
  // It is its parent's helper, and it sits in its parent's room.
  const parent = agent('claude-code:p', { activityState: 'for_review', reviewSince: NOW - MIN });
  const wt = junior('claude-code:j', parent.id, { projectId: 'career-ops-wt-agent' });
  const agents = [parent, wt];
  const projects = [
    { id: 'career-ops', name: 'career-ops', sessionCount: 1, activeCount: 1 },
    { id: 'career-ops-wt-agent', name: 'agent', sessionCount: 0, activeCount: 1 },
  ];
  const plan = buildPlan(projects, agents, { stage: STAGE, now: NOW });
  const seats = assignSeats(plan, agents);
  assert.equal(room(plan, 'project', 'career-ops-wt-agent'), undefined, 'no room of its own');
  assert.ok(inside(seats.get(wt.id), room(plan, 'project', 'career-ops')));
});

test('bug 201: the room counts a desk for the crew anchor when the parent is away', () => {
  const { agents } = ownersFloor();
  const pop = floorPopulation(agents, { now: NOW });
  // Thirteen juniors are one formation; the formation's members are not desks,
  // and the desk the formation is cabled to is — the parent is on the sofa.
  assert.deepEqual(pop.crews.get('career-ops'), [13]);
  assert.equal(pop.desks.get('career-ops'), 1);
  assert.equal(pop.waiting, 1, 'the senior, and none of its juniors');
});
