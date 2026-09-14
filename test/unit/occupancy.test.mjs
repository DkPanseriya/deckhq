/**
 * WP-78 — who sits where.
 *
 * The owner, 14 September, in two sentences that are the whole package:
 *
 *   _"Only live working agents are on desks in the project rooms. Everyone
 *   else is in the lounge area, so I can clearly see which sessions are active
 *   at the moment."_
 *
 *   _"Nobody sits by default in front of the manager; everybody is waiting on
 *   the sofa. Only the agent I open walks up to the manager desk."_ — said
 *   about a floor that was doing the opposite of what he wanted.
 *
 * Everything here is asked of the REAL plan and the REAL seating pass, because
 * the failure this guards against is a rule that is true in `placement()` and
 * false on the floor: a person whose zone says office and whose coordinates are
 * on a sofa is the same defect as a desk on a corridor.
 *
 * No DOM and no canvas — `plan.js`, `agents.js` and `floor-rule.js` are pure
 * (docs/DEVIATIONS.md §122), which is what lets this run under `node --test`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlan } from '../../public/render/plan.js';
import { buildOffice, seatOffice, OFFICE_QUEUE_ZONE } from '../../public/render/plan-office.js';
import {
  OFFICE_MIN_W,
  OFFICE_VISITOR_MAX,
  OFFICE_VISITOR_MIN,
  OFFICE_VISITOR_THIRD,
  visitorChairCount,
} from '../../public/render/plan-units.js';
import { assignSeats, derivePlacement } from '../../public/render/agents.js';
import { placement, waitingSince } from '../../public/floor-rule.js';

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

const room = (plan, kind, id) =>
  plan.rooms.find((r) => r.kind === kind && (id === undefined || r.id === id));

/** Is `seat` inside `rect`, allowing half a unit for a body's own width? */
const inside = (seat, rect, pad = 0.5) =>
  seat.x >= rect.x - pad &&
  seat.x <= rect.x + rect.w + pad &&
  seat.y >= rect.y - pad &&
  seat.y <= rect.y + rect.h + pad;

/**
 * THE DESK ZONE: the clear floor the manager's desk looks down, derived from
 * the room rather than restated.
 *
 * The three sofa runs form a C against the walls (`plan-office.js`), so what
 * they enclose — plus the band the desk itself stands in — is a rectangle, and
 * it is exactly the region a waiting agent is allowed to be in. Computed by
 * pushing each interior edge in past whichever run hugs it, which works for the
 * portrait reception and for the transposed row one without knowing which it
 * was handed.
 */
function deskZone(office) {
  const band = office.plateBand ?? 0;
  let x0 = office.x;
  let y0 = office.y + band;
  let x1 = office.x + office.w;
  let y1 = office.y + office.h;
  for (const s of office.props.filter((p) => p.kind === 'sofa')) {
    if (s.w > s.h) {
      if (s.y - y0 < y1 - (s.y + s.h)) y0 = Math.max(y0, s.y + s.h);
      else y1 = Math.min(y1, s.y);
    } else {
      if (s.x - x0 < x1 - (s.x + s.w)) x0 = Math.max(x0, s.x + s.w);
      else x1 = Math.min(x1, s.x);
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------------------------------------------------------------- the rule

test('WP-78: 4 working and 2 stalled at desks, 3 waiting at the manager, 5 in the lounge', () => {
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
    agent('wait-review-0', { activityState: 'for_review', reviewSince: NOW - 40 * MIN }),
    agent('wait-hand-0', {
      projectId: 'p1',
      activityState: 'needs_input',
      needsInputSince: NOW - 25 * MIN,
    }),
    agent('wait-review-1', { activityState: 'for_review', reviewSince: NOW - 5 * MIN }),
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
  // everything that ever ran in the repo is what this package removed.
  assert.equal(plan.seats.get('p0').length, 4);
  assert.equal(plan.seats.get('p1').length, 2);
  for (const r of plan.rooms.filter((x) => x.kind === 'project')) {
    for (const [id, seat] of seats) {
      if (!inside(seat, r, -0.5)) continue;
      assert.ok(deskIds.includes(id), `${id} is in ${r.id} and is not working there`);
    }
  }

  // --- the manager's desk holds everybody who is waiting, and no sofa does.
  const office = room(plan, 'office');
  const zone = deskZone(office);
  const sofas = office.props.filter((p) => p.kind === 'sofa');
  const waitingIds = ['wait-review-0', 'wait-hand-0', 'wait-review-1'];
  assert.equal(plan.officeSeats.length, 3, 'the office is laid out for its whole queue');
  for (const id of waitingIds) {
    const a = agents.find((x) => x.id === id);
    assert.equal(derivePlacement(a), 'office', `${id} should be waiting on the user`);
    const seat = at(id);
    assert.ok(
      inside(seat, zone),
      `${id} is at (${seat.x.toFixed(1)}, ${seat.y.toFixed(1)}), outside the desk zone`,
    );
    for (const s of sofas) {
      assert.equal(inside(seat, s, 0.6), false, `${id} was put on a sofa`);
    }
  }
  // Oldest wait nearest the desk (`seatOffice`'s order, `assignSeats`'s sort).
  const desk = office.props.find((p) => p.kind === 'user_desk');
  const centre = { x: desk.x + desk.w / 2, y: desk.y + desk.h / 2 };
  const far = (id) => Math.hypot(at(id).x - centre.x, at(id).y - centre.y);
  const byWait = [...waitingIds].sort(
    (a, b) =>
      waitingSince(agents.find((x) => x.id === a)) - waitingSince(agents.find((x) => x.id === b)),
  );
  assert.deepEqual(byWait, ['wait-review-0', 'wait-hand-0', 'wait-review-1']);
  for (let i = 1; i < byWait.length; i++) {
    assert.ok(
      far(byWait[i]) >= far(byWait[i - 1]) - 1e-9,
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

test('WP-78: five waiting is three in chairs and two standing, in arrival order', () => {
  // Asked of a reception wide enough for the third chair, so the split is a
  // fact about the rule rather than about whichever box the packer handed it.
  const { room: office } = buildOffice(5, { w: 30, h: 0 });
  const chairs = office.props.filter((p) => p.kind === 'waiting_chair');
  assert.equal(chairs.length, 3);
  const queue = office.zones.filter((z) => String(z.id).startsWith(OFFICE_QUEUE_ZONE));
  assert.equal(queue.length, 2, 'the two the chairs could not take are standing');

  const seats = seatOffice(office, 5);
  assert.equal(seats.length, 5);
  assert.deepEqual(
    seats.map((s) => !!s.standing),
    [false, false, false, true, true],
    'the chairs fill before anybody stands',
  );

  // The order is the queue: each place is at least as far from the desk as the
  // one before it, so "oldest nearest" on the array means oldest nearest on the
  // floor. The three chairs are a row centred on the desk, so the front of the
  // queue sits directly across from the manager and the rest flank him.
  const desk = office.props.find((p) => p.kind === 'user_desk');
  const centre = { x: desk.x + desk.w / 2, y: desk.y + desk.h / 2 };
  const far = (s) => Math.hypot(s.x - centre.x, s.y - centre.y);
  assert.ok(far(seats[0]) < far(seats[1]), 'the front of the queue is not the nearest chair');
  assert.ok(
    Math.abs(seats[0].x - centre.x) < 1e-9,
    'the front of the queue is not across the desk from the manager',
  );
  for (let i = 1; i < 3; i++) {
    assert.ok(far(seats[i]) >= far(seats[0]) - 1e-9);
  }
  // Both standing places are further back than every chair.
  for (const standing of seats.slice(3)) {
    for (const seated of seats.slice(0, 3)) {
      assert.ok(standing.y > seated.y, 'somebody is queueing in front of a chair');
    }
  }
  // And the queue itself is in the order the plan laid it out, which is the
  // order `assignSeats` hands the waiting agents over in.
  const ids = queue.map((z) => Number(String(z.id).slice(OFFICE_QUEUE_ZONE.length)));
  assert.deepEqual(ids, [0, 1]);
  for (let i = 0; i < 2; i++) {
    const z = queue[i];
    assert.ok(Math.abs(seats[3 + i].x - (z.x + z.w / 2)) < 1e-9);
    assert.ok(Math.abs(seats[3 + i].y - (z.y + z.h / 2)) < 1e-9);
  }
});

test('WP-78: the visitor chairs are two or three, scale with the room, and never move', () => {
  // Deterministic and a pure function of the room's own interior width, so the
  // same floor produces the same chairs on every rebuild and on every machine.
  for (const w of [0, 12, 22, 24, 25.9, OFFICE_VISITOR_THIRD, 30, 46, 200]) {
    const n = visitorChairCount(w);
    assert.ok(n >= OFFICE_VISITOR_MIN && n <= OFFICE_VISITOR_MAX, `w=${w} gave ${n}`);
    assert.equal(n, visitorChairCount(w), 'the same room gave two answers');
  }
  // It really does scale: the smallest reception gets two and a larger one
  // gets three, rather than the cap being unreachable or the floor unused.
  assert.equal(visitorChairCount(OFFICE_MIN_W), OFFICE_VISITOR_MIN);
  assert.equal(visitorChairCount(OFFICE_VISITOR_THIRD - 0.01), OFFICE_VISITOR_MIN);
  assert.equal(visitorChairCount(OFFICE_VISITOR_THIRD), OFFICE_VISITOR_MAX);

  // And what the reception builds agrees with it, at every width it can be
  // given, with every chair inside the room it is in.
  for (const w of [0, 22, 24, 26, 30, 40, 46]) {
    const { room: office } = buildOffice(6, w ? { w, h: 0 } : undefined);
    const chairs = office.props.filter((p) => p.kind === 'waiting_chair');
    assert.equal(chairs.length, visitorChairCount(office.w), `fit w=${w}`);
    for (const c of chairs) {
      assert.ok(c.x >= 0 && c.x + c.w <= office.w, `a chair is through a wall at w=${w}`);
      assert.ok(c.y >= 0 && c.y + c.h <= office.h, `a chair is through a wall at w=${w}`);
    }
  }
});

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
