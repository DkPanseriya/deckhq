/**
 * WP-78 and WP-93 — who sits where.
 *
 * The owner, 14 September, in two sentences that were WP-78:
 *
 *   _"Only live working agents are on desks in the project rooms. Everyone
 *   else is in the lounge area, so I can clearly see which sessions are active
 *   at the moment."_
 *
 *   _"Nobody sits by default in front of the manager; everybody is waiting on
 *   the sofa. Only the agent I open walks up to the manager desk."_
 *
 * WP-78 read the second one as a description of the floor he was looking at and
 * shipped its opposite: the whole waiting queue in a row of chairs at the desk,
 * and the sofas seating nobody. On 15 September he said it again as an
 * instruction — _"They all should sit on the sofa. Only the agent I open walks
 * up to the manager desk."_ — and this file now holds both halves of it:
 *
 *   - the waiting sit on the reception sofas, oldest wait nearest the desk,
 *     and whoever the sofas cannot take stands beside them;
 *   - there is ONE visitor chair, it is empty unless a waiting session's panel
 *     is open, and no observed event can ever put anybody in it.
 *
 * Everything here is asked of the REAL plan and the REAL seating pass, because
 * the failure this guards against is a rule that is true in `placement()` and
 * false on the floor: a person whose zone says office and whose coordinates are
 * in the middle of the carpet is the same defect as a desk on a corridor.
 *
 * No DOM and no canvas — `plan.js`, `agents.js` and `floor-rule.js` are pure
 * (docs/DEVIATIONS.md §122), which is what lets this run under `node --test`.
 * The one `INVARIANT:` test drives a real `Registry`, so it isolates first.
 */

import '../helpers/isolate.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildPlan } from '../../public/render/plan.js';
import { buildOffice, seatOffice, OFFICE_QUEUE_ZONE } from '../../public/render/plan-office.js';
import { OFFICE_SOFA_PITCH, OFFICE_VISITOR_CHAIRS } from '../../public/render/plan-units.js';
import { assignSeats, derivePlacement } from '../../public/render/agents.js';
import { placement, waitingSince } from '../../public/floor-rule.js';
import { Registry } from '../../src/core/state-machine.mjs';
import { agentId } from '../../src/core/model.mjs';
import { Store } from '../../src/core/store.mjs';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

/** @param {string} id @param {object} over */
function agent(id, over = {}) {
  return {
    id,
    projectId: 'p0',
    activityState: 'working',
    ackState: 'active',
    reviewSince: null,
    needsInputSince: null,
    lastActivityAt: NOW - MIN,
    ...over,
  };
}

/** A waiting session that has been waiting `mins` minutes. */
const waiter = (id, mins, over = {}) =>
  agent(id, { activityState: 'for_review', reviewSince: NOW - mins * MIN, ...over });

const room = (plan, kind, id) =>
  plan.rooms.find((r) => r.kind === kind && (id === undefined || r.id === id));

/** Is `seat` inside `rect`, allowing half a unit for a body's own width? */
const inside = (seat, rect, pad = 0.5) =>
  seat.x >= rect.x - pad &&
  seat.x <= rect.x + rect.w + pad &&
  seat.y >= rect.y - pad &&
  seat.y <= rect.y + rect.h + pad;

/** Is this place ON one of the reception's sofa runs? (WP-93: it must be.) */
const onASofa = (seat, office, pad = 0.6) =>
  office.props.filter((p) => p.kind === 'sofa').some((s) => inside(seat, s, pad));

/** Is this place the visitor chair — the one seat a selection decides? */
const atTheChair = (seat, plan) =>
  !!seat &&
  !!plan.officeChair &&
  Math.hypot(seat.x - plan.officeChair.x, seat.y - plan.officeChair.y) < 1e-9;

/** Who, if anybody, is in the visitor chair. */
const inTheChair = (seats, plan) =>
  [...seats].filter(([, s]) => atTheChair(s, plan)).map(([id]) => id);

/** How far each place is from the manager. The queue's whole order is this. */
function distanceFromDesk(office) {
  const desk = office.props.find((p) => p.kind === 'user_desk');
  const centre = { x: desk.x + desk.w / 2, y: desk.y + desk.h / 2 };
  return (s) => Math.hypot(s.x - centre.x, s.y - centre.y);
}

// ---------------------------------------------------------------- the rule

test('WP-93: 4 working and 2 stalled at desks, 3 waiting on the sofas, 5 in the lounge', () => {
  /** @type {any[]} */
  const agents = [];
  // Four working, spread over two rooms so "at a desk" is not one room's luck.
  for (let i = 0; i < 4; i++) {
    agents.push(agent(`work-${i}`, { projectId: i < 2 ? 'p0' : 'p1' }));
  }
  // Two stalled — the ONE exception to "only live working agents are on desks".
  // A stalled session is live work that has gone quiet and may resume, so it
  // keeps its desk and its badge rather than being walked to the lounge and
  // back on a timer.
  for (let i = 0; i < 2; i++) {
    agents.push(agent(`stall-${i}`, { projectId: 'p0', activityState: 'stalled' }));
  }
  // Three waiting on the user: both waiting states, because both need him and
  // nobody else.
  agents.push(
    waiter('wait-review-0', 40),
    agent('wait-hand-0', {
      projectId: 'p1',
      activityState: 'needs_input',
      needsInputSince: NOW - 25 * MIN,
    }),
    waiter('wait-review-1', 5),
  );
  // Five who are neither: three the user benched, two that simply finished.
  for (let i = 0; i < 3; i++) {
    agents.push(agent(`bench-${i}`, { ackState: 'benched', activityState: 'ended' }));
  }
  for (let i = 0; i < 2; i++) {
    agents.push(agent(`done-${i}`, { projectId: 'p1', activityState: 'ended' }));
  }

  const projects = [
    { id: 'p0', name: 'p0', sessionCount: 9, tokens: 100 },
    { id: 'p1', name: 'p1', sessionCount: 5, tokens: 100 },
  ];
  const plan = buildPlan(projects, agents, { targetAspect: 1.78, now: NOW });
  const seats = assignSeats(plan, agents);
  assert.equal(plan.hidden.size, 0, 'both repos are live, so nobody is hidden');

  const at = (id) => {
    const seat = seats.get(id);
    assert.ok(seat, `${id} was given no place at all`);
    return seat;
  };

  // --- the project rooms hold the working and the stalled, and nobody else.
  const deskIds = ['work-0', 'work-1', 'work-2', 'work-3', 'stall-0', 'stall-1'];
  for (const id of deskIds) {
    const a = agents.find((x) => x.id === id);
    assert.equal(derivePlacement(a), 'desk', `${id} should be at a desk`);
    const r = room(plan, 'project', a.projectId);
    assert.ok(r, `${a.projectId} has no room`);
    assert.ok(inside(at(id), r), `${id} is outside ${a.projectId}`);
  }
  // Six people at desks and six desks: a project room that is a register of
  // everything that ever ran in the repo is what WP-78 removed, and WP-93
  // leaves that half of it exactly as it was.
  assert.equal(plan.seats.get('p0').length, 4);
  assert.equal(plan.seats.get('p1').length, 2);
  for (const r of plan.rooms.filter((x) => x.kind === 'project')) {
    for (const [id, seat] of seats) {
      if (!inside(seat, r, -0.5)) continue;
      assert.ok(deskIds.includes(id), `${id} is in ${r.id} and is not working there`);
    }
  }

  // --- the reception SOFAS hold everybody who is waiting, and the chair is
  // empty: nobody's panel is open.
  const office = room(plan, 'office');
  const waitingIds = ['wait-review-0', 'wait-hand-0', 'wait-review-1'];
  assert.equal(plan.officeSeats.length, 3, 'the office is laid out for its whole queue');
  assert.deepEqual(inTheChair(seats, plan), [], 'somebody is at the desk with no panel open');
  for (const id of waitingIds) {
    const a = agents.find((x) => x.id === id);
    assert.equal(derivePlacement(a), 'office', `${id} should be waiting on the user`);
    const seat = at(id);
    assert.ok(inside(seat, office), `${id} is outside the reception`);
    assert.ok(
      onASofa(seat, office),
      `${id} is at (${seat.x.toFixed(1)}, ${seat.y.toFixed(1)}), which is not a sofa`,
    );
  }
  // Oldest wait nearest the desk (`seatOffice`'s order, `assignSeats`'s sort).
  const far = distanceFromDesk(office);
  const byWait = [...waitingIds].sort(
    (a, b) =>
      waitingSince(agents.find((x) => x.id === a)) - waitingSince(agents.find((x) => x.id === b)),
  );
  assert.deepEqual(byWait, ['wait-review-0', 'wait-hand-0', 'wait-review-1']);
  for (let i = 1; i < byWait.length; i++) {
    assert.ok(
      far(at(byWait[i])) >= far(at(byWait[i - 1])) - 1e-9,
      `${byWait[i]} waited less than ${byWait[i - 1]} and is sitting closer to the desk`,
    );
  }

  // --- and the lounge holds everything else: benched and ended alike.
  const lounge = room(plan, 'lounge');
  for (const id of ['bench-0', 'bench-1', 'bench-2', 'done-0', 'done-1']) {
    const a = agents.find((x) => x.id === id);
    assert.equal(derivePlacement(a), 'lounge', `${id} should be in the lounge`);
    assert.ok(inside(at(id), lounge), `${id} is outside the lounge`);
  }
  // Nobody was drawn twice and nobody was dropped.
  assert.equal(seats.size, agents.length);
});

test('WP-93: three waiting sit on the sofas in arrival order, and the chair stays empty', () => {
  const agents = [waiter('old', 40), waiter('middle', 25), waiter('new', 5)];
  const plan = buildPlan([{ id: 'p0', name: 'p0', sessionCount: 3, tokens: 1 }], agents, {
    targetAspect: 1.78,
    now: NOW,
  });
  const office = room(plan, 'office');
  const seats = assignSeats(plan, agents);

  assert.equal(plan.officeSeats.length, 3);
  assert.equal(
    plan.officeSeats.filter((s) => s.standing).length,
    0,
    'three people fit on the sofas of any reception this product builds',
  );
  for (const id of ['old', 'middle', 'new']) {
    assert.ok(onASofa(seats.get(id), office), `${id} is not on a sofa`);
  }
  // Arrival order, oldest nearest — and the chair, which is right there across
  // the desk, holds nobody, because nobody's panel is open.
  const far = distanceFromDesk(office);
  assert.ok(far(seats.get('old')) <= far(seats.get('middle')) + 1e-9);
  assert.ok(far(seats.get('middle')) <= far(seats.get('new')) + 1e-9);
  assert.ok(plan.officeChair, 'the reception still has its one chair');
  assert.deepEqual(inTheChair(seats, plan), []);
});

test('WP-93: when the sofas are full the rest stand beside them, in arrival order', () => {
  // Asked of `buildOffice` directly, the way WP-78's own split test was: the
  // packer hands the reception whatever box the floor has spare, and a rule
  // about what happens when the SOFAS run out has to be asked of a room whose
  // sofas actually do. A reception at its own natural size seats six; the
  // seventh is the first person to stand.
  const { room: office } = buildOffice(7);
  const runs = office.props.filter((p) => p.kind === 'sofa');
  const capacity = runs.reduce(
    (n, s) => n + Math.floor(Math.max(s.w, s.h) / OFFICE_SOFA_PITCH + 1e-9),
    0,
  );
  assert.equal(capacity, 6, 'the reception at its natural size seats six on its three runs');

  const { officeSeats } = seatOffice(office, 7);
  assert.equal(officeSeats.length, 7);
  assert.deepEqual(
    officeSeats.map((s) => !!s.standing),
    [false, false, false, false, false, false, true],
    'the sofas fill before anybody stands',
  );
  for (const seat of officeSeats.filter((s) => !s.standing)) {
    assert.ok(onASofa(seat, office), 'a seated waiting agent is not on a sofa');
  }

  // The one who stands is BESIDE the seating and never at the desk: the well
  // is the floor the three runs enclose, and it starts below the visitor chair.
  const well = office.zones.find((z) => z.id === 'office-well');
  const standing = officeSeats.filter((s) => s.standing);
  for (const s of standing) {
    assert.ok(inside(s, well, 0), 'somebody is queueing outside the well the sofas enclose');
    assert.equal(onASofa(s, office), false, 'somebody is standing on a sofa');
  }
  const chair = office.props.find((p) => p.kind === 'tub_chair');
  for (const s of standing) {
    assert.ok(
      Math.hypot(s.x - (chair.x + chair.w / 2), s.y - (chair.y + chair.h / 2)) > 2,
      'the queue has reached the manager’s desk',
    );
  }

  // And the queue is in the order the plan laid it out, which is the order
  // `assignSeats` hands the waiting agents over in.
  const queue = office.zones
    .filter((z) => String(z.id).startsWith(OFFICE_QUEUE_ZONE))
    .sort(
      (a, b) =>
        Number(String(a.id).slice(OFFICE_QUEUE_ZONE.length)) -
        Number(String(b.id).slice(OFFICE_QUEUE_ZONE.length)),
    );
  assert.ok(queue.length >= standing.length, 'the room laid out fewer places than it needs');
  standing.forEach((s, i) => {
    assert.ok(Math.abs(s.x - (queue[i].x + queue[i].w / 2)) < 1e-9);
    assert.ok(Math.abs(s.y - (queue[i].y + queue[i].h / 2)) < 1e-9);
  });

  // The sofas fill before anybody stands at every size the room can be, and the
  // split is a pure function of the room — the same reception twice over gives
  // the same answer.
  for (const n of [1, 3, 6, 8, 12, 20]) {
    const built = buildOffice(n);
    const a = seatOffice(built.room, n).officeSeats;
    const b = seatOffice(buildOffice(n).room, n).officeSeats;
    assert.deepEqual(a, b, `the reception for ${n} waiting seated them differently twice`);
    const seated = a.filter((s) => !s.standing).length;
    assert.equal(a.length, n);
    assert.ok(seated > 0 && seated <= n, `${n} waiting seated ${seated}`);
    assert.ok(
      a.slice(0, seated).every((s) => !s.standing) && a.slice(seated).every((s) => s.standing),
      `${n} waiting: somebody stood while a cushion was free`,
    );
  }
});

test('WP-93: the manager’s desk has exactly one visitor chair, at every reception size', () => {
  assert.equal(OFFICE_VISITOR_CHAIRS, 1);
  for (const w of [0, 22, 24, 26, 30, 40, 46]) {
    const { room: office } = buildOffice(6, w ? { w, h: 0 } : undefined);
    const chairs = office.props.filter((p) => p.kind === 'tub_chair');
    assert.equal(chairs.length, 1, `fit w=${w} produced ${chairs.length} chairs`);
    for (const c of chairs) {
      assert.ok(c.x >= 0 && c.x + c.w <= office.w, `the chair is through a wall at w=${w}`);
      assert.ok(c.y >= 0 && c.y + c.h <= office.h, `the chair is through a wall at w=${w}`);
    }
    // And it is square across the desk from the manager, which is the whole of
    // what it is for: the person being seen sits opposite the person seeing
    // them, not off to one side of them.
    const desk = office.props.find((p) => p.kind === 'user_desk');
    assert.ok(Math.abs(chairs[0].x + chairs[0].w / 2 - (desk.x + desk.w / 2)) < 1e-9);
  }
});

// ------------------------------------------------- the one thing selection does

/** A floor with three waiting sessions, one working one, and one resting. */
function selectableFloor() {
  const agents = [
    waiter('old', 40),
    waiter('middle', 25),
    waiter('new', 5),
    agent('busy'),
    agent('done', { activityState: 'ended' }),
  ];
  const plan = buildPlan([{ id: 'p0', name: 'p0', sessionCount: 5, tokens: 1 }], agents, {
    targetAspect: 1.78,
    now: NOW,
  });
  return { agents, plan };
}

test('WP-93: opening a waiting session walks it to the visitor chair, and moves nobody else', () => {
  const { agents, plan } = selectableFloor();
  const before = assignSeats(plan, agents);
  const after = assignSeats(plan, agents, { selectedId: 'middle' });

  assert.deepEqual(inTheChair(after, plan), ['middle'], 'exactly one person is at the desk');
  assert.ok(atTheChair(after.get('middle'), plan));
  // Everybody else — the other two waiting, the one working, the one resting —
  // is exactly where they were. Opening a panel must move ONE person; a queue
  // that closes up behind whoever left would walk every session that had been
  // waiting longer than the one you opened.
  for (const id of ['old', 'new', 'busy', 'done']) {
    assert.deepEqual(after.get(id), before.get(id), `${id} moved when "middle" was opened`);
  }
  // And its own cushion is left empty rather than given to the next in line.
  assert.equal(
    [...after.values()].some(
      (s) => Math.hypot(s.x - before.get('middle').x, s.y - before.get('middle').y) < 1e-9,
    ),
    false,
    'somebody took the seat of the session that was called to the desk',
  );
});

test('WP-93: closing the panel walks it back to its own sofa place', () => {
  const { agents, plan } = selectableFloor();
  const seated = assignSeats(plan, agents);
  const called = assignSeats(plan, agents, { selectedId: 'old' });
  // The panel closes (`selectedId: null`), or another session is selected.
  const closed = assignSeats(plan, agents, { selectedId: null });
  const moved = assignSeats(plan, agents, { selectedId: 'new' });

  assert.ok(atTheChair(called.get('old'), plan));
  assert.deepEqual(
    [...closed.entries()].map(([id, s]) => [id, s.x, s.y]),
    [...seated.entries()].map(([id, s]) => [id, s.x, s.y]),
    'closing the panel did not put the floor back',
  );
  assert.deepEqual(inTheChair(moved, plan), ['new'], 'the chair holds one person at a time');
  assert.deepEqual(moved.get('old'), seated.get('old'), '"old" did not go back to its sofa');
});

test('WP-93: opening a session that is not waiting moves nobody', () => {
  const { agents, plan } = selectableFloor();
  const before = assignSeats(plan, agents);
  for (const id of ['busy', 'done', 'nobody-at-all']) {
    const after = assignSeats(plan, agents, { selectedId: id });
    assert.deepEqual(
      [...after.entries()],
      [...before.entries()],
      `selecting "${id}" moved somebody`,
    );
    assert.deepEqual(inTheChair(after, plan), [], `selecting "${id}" filled the chair`);
  }
  // Which is the rule stated once, in the zone rule: working stays at its desk
  // and resting stays in the lounge whatever the panel is showing.
  assert.equal(placement(agents.find((a) => a.id === 'busy')), 'desk');
  assert.equal(placement(agents.find((a) => a.id === 'done')), 'lounge');
});

test('INVARIANT: no observed event ever puts anybody in the visitor chair', async () => {
  // The chair is the one place on the floor a USER decides, and the whole of
  // WP-93 is that waiting long enough can never earn it. So drive a real
  // registry through the three things that actually happen to a session — a
  // hook, a re-scan, a turn ending — planning and seating after each, and
  // assert the chair is empty every single time. `assignSeats` is called the
  // way the floor calls it when nothing is open: with no selection at all.
  const summaries = ['a', 'b', 'c'].map((id) => ({
    id: agentId('claude-code', id),
    runtime: 'claude-code',
    title: `title-${id}`,
    hasCustomTitle: false,
    cwd: 'C:\\work\\api',
    gitBranch: null,
    model: 'claude-opus-5-20260501',
    lastActivityAt: NOW - MIN,
    tokens: 10,
    cacheTokens: 0,
    costEstimate: 0,
    lastRole: 'user',
    lastText: 'hi',
    turnEnded: false,
  }));
  const adapter = {
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
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-chair-'));
  const store = new Store(path.join(dir, 'state.json'));
  await store.load();
  const registry = new Registry({
    store,
    adapters: [adapter],
    ledger: null,
    log: { info() {}, warn() {}, error() {}, debug() {} },
  });

  const chairIsEmpty = (what) => {
    const snap = registry.snapshot();
    const plan = buildPlan(snap.projects, snap.agents, { targetAspect: 1.78, now: NOW });
    const seats = assignSeats(plan, snap.agents);
    assert.ok(plan.officeChair, `${what}: the reception lost its chair`);
    assert.deepEqual(inTheChair(seats, plan), [], `${what} put somebody in the visitor chair`);
    return snap;
  };

  await registry.refresh();
  chairIsEmpty('a scan');
  registry.setHookStatus({ 'claude-code': { supported: true, installed: true } });
  // A raised hand, a finished turn, and a session ending — the three observed
  // events that put somebody in the office or take them out of it.
  registry.applyHook({
    runtime: 'claude-code',
    sessionId: 'a',
    hookEvent: 'Notification',
    at: NOW - 30 * MIN,
  });
  chairIsEmpty('a Notification hook');
  registry.applyHook({
    runtime: 'claude-code',
    sessionId: 'b',
    hookEvent: 'Stop',
    at: NOW - 20 * MIN,
  });
  const waitingSnap = chairIsEmpty('a Stop hook');
  registry.applyHook({
    runtime: 'claude-code',
    sessionId: 'c',
    hookEvent: 'SessionEnd',
    at: NOW - 10 * MIN,
  });
  chairIsEmpty('a SessionEnd hook');
  await registry.refresh();
  chairIsEmpty('a re-scan over all of it');

  // And the test really did have somebody to put in the chair: a run where
  // nobody was ever waiting would prove nothing at all.
  assert.ok(
    waitingSnap.agents.some((a) => placement(a) === 'office'),
    'no session was ever in the office, so the invariant was never tested',
  );
  await fsp.rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------- what WP-78 settled, unchanged

test('WP-78: a stalled session keeps its desk; an ended one does not', () => {
  // The exception and the rule, side by side, because the two are one line
  // apart in `AT_DESK_STATES` and the reason they differ is the whole of it: a
  // stalled session is still live and may produce its next line a second from
  // now; an ended one has finished.
  assert.equal(placement(agent('a', { activityState: 'stalled' })), 'desk');
  assert.equal(placement(agent('b', { activityState: 'ended' })), 'lounge');

  const projects = [{ id: 'p0', name: 'p0', sessionCount: 2, tokens: 1 }];
  const agents = [agent('live'), agent('quiet', { activityState: 'stalled' })];
  const plan = buildPlan(projects, agents, { targetAspect: 1.78, now: NOW });
  assert.equal(plan.seats.get('p0').length, 2, 'a stalled session is still a desk');
  const seats = assignSeats(plan, agents);
  const r = room(plan, 'project', 'p0');
  for (const id of ['live', 'quiet']) assert.ok(inside(seats.get(id), r));
});

test('WP-78: an ended session in a repo nobody is working in is still off the floor', () => {
  // WP-50's rule survives this package unchanged. A repo with no live session
  // earns no room, so its finished sessions are a line in the idle list and
  // nothing on the floor — moving them to the LOUNGE instead would put the
  // reference machine's twenty forgotten sessions back on the picture, which is
  // the thing WP-50 exists to have removed.
  const projects = [
    { id: 'busy', name: 'busy', sessionCount: 2, tokens: 1 },
    { id: 'cold', name: 'cold', sessionCount: 3, tokens: 1 },
  ];
  const agents = [
    agent('w', { projectId: 'busy' }),
    agent('busy-done', { projectId: 'busy', activityState: 'ended' }),
    agent('cold-0', { projectId: 'cold', activityState: 'ended' }),
    agent('cold-1', { projectId: 'cold', activityState: 'ended' }),
    agent('cold-2', { projectId: 'cold', activityState: 'ended' }),
  ];
  const plan = buildPlan(projects, agents, { targetAspect: 1.78, now: NOW });
  assert.deepEqual([...plan.hidden].sort(), ['cold-0', 'cold-1', 'cold-2']);
  assert.equal(plan.hidden.has('busy-done'), false);
  const seats = assignSeats(plan, agents);
  assert.ok(inside(seats.get('busy-done'), room(plan, 'lounge')));
  for (const id of ['cold-0', 'cold-1', 'cold-2']) {
    assert.equal(seats.has(id), false, `${id} has no room to be drawn in`);
  }
});
