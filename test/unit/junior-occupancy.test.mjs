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
import { crewChipAt, crewNameAt } from '../../public/render/crew.js';
import { drawCrews } from '../../public/render/crew-draw.js';
import { counts } from '../../src/core/model.mjs';

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

test('bug 201: the away crew’s desk carries the parent’s name, and the chip counts the desk', () => {
  const { agents, projects, parent } = ownersFloor();
  parent.label = 'MK4.1';
  const plan = buildPlan(projects, agents, { stage: STAGE, now: NOW });
  const seats = assignSeats(plan, agents);
  const records = agents
    .filter((a) => seats.get(a.id)?.crew === true)
    .map((a) => ({ id: a.id, agent: a, targetSeat: seats.get(a.id), x: 0, y: 0 }));
  /** @type {{text:string, x:number, y:number}[]} */
  const texts = [];
  const ctx = new Proxy(
    { measureText: (t) => ({ width: String(t).length * 6 }) },
    {
      get: (target, key) =>
        key === 'fillText'
          ? (text, x, y) => texts.push({ text, x, y })
          : key in target
            ? target[key]
            : () => {},
      set: () => true,
    },
  );
  const camera = { U: 20, zoom: 1, panX: 0, panY: 0 };
  drawCrews(/** @type {any} */ (ctx), {
    records,
    agentsById: new Map(agents.map((a) => [a.id, a])),
    camera,
    scale: 20,
    charU: 30,
    lod: 2,
    reduced: false,
    pinned: 0,
    nowMs: NOW,
    // The parent's own seat is the office sofa; nothing may be drawn there.
    seatOf: () => ({ x: -1000, y: -1000, angle: 0 }),
    crewCounts: new Map([[parent.id, 13]]),
  });
  const anchor = records[0].targetSeat.crewAnchor;
  const name = texts.find((t) => t.text === 'MK4.1');
  assert.ok(name, 'the desk says whose crew it is');
  const at = crewNameAt(anchor);
  assert.ok(Math.hypot(name.x - at.x * 20, name.y - at.y * 20) < 1e-6, 'on that desk');
  const chip = texts.find((t) => t.text === '+1');
  assert.ok(chip, 'thirteen at the desk, twelve drawn: +1');
  const c = crewChipAt(anchor);
  assert.ok(Math.hypot(chip.x - c.x * 20, chip.y - c.y * 20) < 1e-6, 'beside the desk');
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

/**
 * Audit F5: the header's "at desk" is the people the floor puts at a desk —
 * working or stalled, top-level or junior, in a room — off the one `placement`
 * the seating reads. An ended, benched or waiting session is never at a desk.
 * Asked of the floor itself: every desk-placed agent is seated inside a project
 * room, or is a crew member past the draw cap that the `+N` chip stands for.
 */
test('audit F5: "at desk" counts exactly who the floor seats at a desk', () => {
  const { agents, projects, parent } = ownersFloor();
  // The audit's own shape on top of the owner's: finished juniors (which the
  // header used to count at desks) and a stalled senior at its desk.
  for (let i = 20; i < 24; i++) {
    agents.push(junior(jid(i), parent.id, { activityState: 'ended' }));
  }
  agents.push(agent('claude-code:stuck', { projectId: 'deckhq', activityState: 'stalled' }));
  const c = counts(agents, { now: NOW });
  // 13 working juniors + 2 working seniors + 1 stalled senior. Not the waiting
  // parent, not the 4 ended juniors, not the benched pair.
  assert.equal(c.drawn.atDesk, 16);
  assert.equal(c.drawn.waiting, 1, 'the parent on the sofa, and none of its crew');
  assert.equal(c.drawn.benched, 2);

  const plan = buildPlan(projects, agents, { stage: STAGE, now: NOW });
  const seats = assignSeats(plan, agents);
  const projectRooms = plan.rooms.filter((r) => r.kind === 'project');
  let seated = 0;
  let chip = 0;
  for (const a of agents) {
    const s = seats.get(a.id);
    if (!s) continue;
    if (projectRooms.some((r) => inside(s, r))) seated++;
    if (s.crew === true && s.crewIndex === 0) chip += s.crewTotal - CREW_DRAW_CAP;
  }
  assert.equal(chip, 1, 'thirteen at the desk, twelve drawn');
  assert.equal(seated + chip, c.drawn.atDesk, 'the header and the floor are one count');
});

/**
 * Audit F4: a crew whose juniors run in git worktrees. Each worktree-isolated
 * junior reports its own worktree as its cwd, so five siblings can name five
 * repos; keyed by their own repo they were five crews of one and no arc formed.
 * @param {object|null} parentOver the parent's fields, or null for no parent
 */
function worktreeCrew(parentOver) {
  const parent = parentOver && agent('claude-code:p', parentOver);
  const wt = (k) => `career-ops-claude-worktrees-agent-${k}`;
  const agents = [
    ...(parent ? [parent] : []),
    junior(jid(1), 'claude-code:p', { projectId: wt('a') }),
    junior(jid(2), 'claude-code:p', { projectId: wt('b') }),
    junior(jid(3), 'claude-code:p', { projectId: wt('c') }),
    junior(jid(4), 'claude-code:p', { projectId: parent ? 'career-ops' : wt('d') }),
    junior(jid(5), 'claude-code:p', { projectId: parent ? 'career-ops' : wt('e') }),
  ];
  const projects = [
    { id: 'career-ops', name: 'career-ops', sessionCount: 1, activeCount: 1 },
    ...['a', 'b', 'c', 'd', 'e'].map((k) => ({
      id: wt(k),
      name: `agent-${k}`,
      sessionCount: 0,
      activeCount: 1,
    })),
  ];
  return { agents, projects };
}

for (const [label, over] of [
  ['at its desk', {}],
  ['on the sofa', { activityState: 'for_review', reviewSince: NOW - MIN }],
]) {
  test(`audit F4: juniors in worktrees of the parent's repo form one arc, parent ${label}`, () => {
    const { agents, projects } = worktreeCrew(over);
    const pop = floorPopulation(agents, { now: NOW });
    assert.deepEqual(pop.crews.get('career-ops'), [5], 'one crew of five, in the parent’s room');
    assert.equal(pop.crews.size, 1, 'no worktree has a crew of its own');
    const plan = buildPlan(projects, agents, { stage: STAGE, now: NOW });
    const seats = assignSeats(plan, agents);
    const home = room(plan, 'project', 'career-ops');
    for (const j of agents.filter((a) => a.subagent)) {
      const s = seats.get(j.id);
      assert.equal(s?.crew, true, `${j.id} is in the arc`);
      assert.equal(s?.crewOf, 'claude-code:p');
      assert.ok(inside(s, home), `${j.id} is in the parent's room`);
    }
  });
}

test('audit F4: with the parent off the snapshot, its worktree juniors still share one room', () => {
  const { agents, projects } = worktreeCrew(null);
  const pop = floorPopulation(agents, { now: NOW });
  assert.deepEqual([...pop.crews.values()], [[5]], 'one crew, not five crews of one');
  const plan = buildPlan(projects, agents, { stage: STAGE, now: NOW });
  const seats = assignSeats(plan, agents);
  assert.ok(
    agents.every((j) => seats.get(j.id)?.crew === true),
    'every junior is in the one arc',
  );
});
