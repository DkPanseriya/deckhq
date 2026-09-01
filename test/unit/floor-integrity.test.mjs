/**
 * Floor integrity: the properties that make the plan and the people on it
 * agree with each other.
 *
 * `plan.test.mjs` and `layout-anchors.test.mjs` cover the WP13 acceptance
 * list. This file covers the class of defect that list did not catch, all of
 * which were live on the floor:
 *
 *   - a room's furniture and its walls resolving in two different frames, so
 *     wall-anchored props drifted away from everything else in the room;
 *   - the plan being rebuilt only when the PROJECT set changed, so benching or
 *     archiving a session assigned it a seat that did not exist;
 *   - two agents assigned the same seat, drawn one on top of the other.
 *
 * Every assertion here is a property over generated inputs rather than a
 * snapshot, because the failures above only appeared at particular
 * populations.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlan } from '../../public/render/plan.js';
import { assignSeats, AgentRuntime, derivePlacement } from '../../public/render/agents.js';

const EPS = 1e-6;

/** How far from square a project room may be before it reads as a splinter. */
const PROJECT_ASPECT_BAND = 2.6;

/** @param {string} id @param {object} over */
function agent(id, over = {}) {
  return {
    id,
    projectId: 'p0',
    activityState: 'working',
    ackState: 'active',
    reviewSince: null,
    ...over,
  };
}

/**
 * A population with a given mix, plus the projects to match.
 * @param {{projects?: number[], waiting?: number, benched?: number, letGo?: number}} spec
 */
function floor(spec) {
  const sizes = spec.projects ?? [3];
  const agents = [];
  const projects = sizes.map((n, i) => ({
    id: `p${i}`,
    name: `p${i}`,
    sessionCount: n,
    tokens: 1000 * (i + 1),
    needsYou: 0,
  }));
  sizes.forEach((n, i) => {
    for (let k = 0; k < n; k++) {
      agents.push(agent(`p${i}-${k}`, { projectId: `p${i}` }));
    }
  });
  for (let k = 0; k < (spec.waiting ?? 0); k++) {
    agents.push(agent(`w${k}`, { activityState: 'for_review', reviewSince: 1_000_000 + k * 1000 }));
  }
  for (let k = 0; k < (spec.benched ?? 0); k++) {
    agents.push(agent(`b${k}`, { ackState: 'benched', activityState: 'ended' }));
  }
  for (let k = 0; k < (spec.letGo ?? 0); k++) {
    agents.push(agent(`g${k}`, { ackState: 'let_go', activityState: 'ended' }));
  }
  return { projects, agents };
}

/** Populations chosen to straddle every threshold the plan has. */
const POPULATIONS = [
  // Nothing at all: the reception, an empty lounge, and no working floor.
  { projects: [] },
  { projects: [], waiting: 60 },
  { projects: [], benched: 3 },
  { projects: [1] },
  { projects: [1], waiting: 1 },
  { projects: [3, 1], benched: 1 },
  { projects: [5], benched: 3, letGo: 1 },
  { projects: [8, 2], benched: 7, waiting: 4 },
  { projects: [21, 5, 3, 1], benched: 12, waiting: 9, letGo: 6 },
  { projects: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], benched: 37, waiting: 25, letGo: 17 },
];

const ASPECTS = [1.2, 1.6, 1.78, 2.06, 2.2];

// ------------------------------------------------------------ the one frame

test('every prop resolves inside the room it belongs to, at every population and aspect', () => {
  // The two-frames defect, stated directly. Contents were laid out at a
  // natural size and then centred inside a larger room, while wall and corner
  // anchors resolved against the room's own edges — so the reception's sofas
  // sat on the walls and its rug fifteen units away in the middle.
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    for (const targetAspect of ASPECTS) {
      const plan = buildPlan(projects, agents, { targetAspect });
      for (const room of plan.rooms) {
        for (const prop of room.props || []) {
          assert.ok(
            prop.x >= room.x - 0.01 &&
              prop.y >= room.y - 0.01 &&
              prop.x + prop.w <= room.x + room.w + 0.01 &&
              prop.y + prop.h <= room.y + room.h + 0.01,
            `${room.id}/${prop.kind} (${prop.anchor.type}) at ${prop.x.toFixed(1)},${prop.y.toFixed(
              1,
            )} is outside its room ${room.x.toFixed(1)},${room.y.toFixed(1)} ${room.w.toFixed(
              1,
            )}x${room.h.toFixed(1)}`,
          );
        }
      }
    }
  }
});

test("the reception's free-standing furniture stays with its wall furniture", () => {
  // The specific symptom the frame bug produced: sofas hard against the walls
  // and the rug they surround stranded in the middle of a much wider room.
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    const plan = buildPlan(projects, agents, { targetAspect: 2.06 });
    const office = plan.rooms.find((r) => r.kind === 'office');
    const rug = office.props.find((p) => p.kind === 'rug');
    const sofas = office.props.filter((p) => p.kind === 'sofa');
    assert.ok(rug && sofas.length >= 3, 'the reception needs a rug and three sofa runs');
    for (const sofa of sofas) {
      const gapX = Math.max(sofa.x - (rug.x + rug.w), rug.x - (sofa.x + sofa.w), 0);
      const gapY = Math.max(sofa.y - (rug.y + rug.h), rug.y - (sofa.y + sofa.h), 0);
      assert.ok(
        Math.hypot(gapX, gapY) <= 2.5,
        `a reception sofa is ${Math.hypot(gapX, gapY).toFixed(
          1,
        )} U from the rug it is supposed to surround`,
      );
    }
  }
});

test('rooms tile the envelope exactly and never overlap, at every aspect', () => {
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    for (const targetAspect of ASPECTS) {
      const plan = buildPlan(projects, agents, { targetAspect });
      let area = 0;
      for (const r of plan.rooms) {
        area += r.w * r.h;
        assert.ok(
          r.x >= -EPS &&
            r.y >= -EPS &&
            r.x + r.w <= plan.width + 0.01 &&
            r.y + r.h <= plan.height + 0.01,
          `${r.id} lies outside the envelope`,
        );
      }
      const envelope = plan.width * plan.height;
      // Exactly, not approximately. A gap is a hole in the building — the
      // backdrop paints a floor per rectangle, so it would render as a void —
      // and an overlap means a room is standing on a corridor.
      assert.ok(
        Math.abs(area - envelope) / envelope < 0.001,
        `rooms cover ${((area / envelope) * 100).toFixed(2)}% of the floor, expected 100%`,
      );
    }
  }
});

// ----------------------------------------------------- a place for everyone

test('every agent on the floor has a place of its own', () => {
  // `assignSeats` gives one agent one seat. A plan with fewer seats than
  // agents therefore drew bodies on top of each other — which is what happened
  // every time the lounge or the departures room was a size behind the
  // population. Both now size themselves to their occupants.
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    const plan = buildPlan(projects, agents, { targetAspect: 2.06 });
    const seats = assignSeats(plan, agents);

    // Archived sessions are off the floor and get no place at all; everybody
    // still in play gets one of their own.
    const onFloor = agents.filter((a) => a.ackState !== 'let_go');
    assert.equal(seats.size, onFloor.length, 'every agent on the floor must be given a place');

    const seen = new Map();
    for (const [id, seat] of seats) {
      const key = `${seat.x.toFixed(2)}:${seat.y.toFixed(2)}`;
      assert.ok(
        !seen.has(key),
        `${id} and ${seen.get(key)} were both put at ${key} — two agents in one place`,
      );
      seen.set(key, id);
    }
  }
});

test('every agent stands inside the room its placement names', () => {
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    const plan = buildPlan(projects, agents, { targetAspect: 2.06 });
    const seats = assignSeats(plan, agents);
    const roomFor = (a) => {
      const placement = derivePlacement(a);
      if (placement === 'desk') {
        return plan.rooms.find((r) => r.kind === 'project' && r.id === a.projectId);
      }
      if (placement === 'office') return plan.rooms.find((r) => r.kind === 'office');
      return plan.rooms.find((r) => r.kind === 'lounge');
    };
    for (const a of agents) {
      if (a.ackState === 'let_go') continue; // off the floor entirely
      const seat = seats.get(a.id);
      const room = roomFor(a);
      assert.ok(room, `${a.id}: no room for placement ${derivePlacement(a)}`);
      assert.ok(
        seat.x >= room.x - 0.5 &&
          seat.x <= room.x + room.w + 0.5 &&
          seat.y >= room.y - 0.5 &&
          seat.y <= room.y + room.h + 0.5,
        `${a.id} (${derivePlacement(a)}) is at ${seat.x.toFixed(1)},${seat.y.toFixed(
          1,
        )}, outside ${room.id}`,
      );
    }
  }
});

test('the waiting queue is seated oldest first, one to a seat', () => {
  const { projects, agents } = floor({ projects: [2], waiting: 9 });
  const plan = buildPlan(projects, agents, { targetAspect: 2.06 });
  const seats = assignSeats(plan, agents);
  const waiting = agents
    .filter((a) => a.activityState === 'for_review')
    .sort((a, b) => a.reviewSince - b.reviewSince);
  waiting.forEach((a, i) => {
    assert.deepEqual(
      seats.get(a.id),
      plan.officeSeats[i],
      `the agent waiting ${i === 0 ? 'longest' : `${i} places back`} is in the wrong seat`,
    );
  });
});

// ------------------------------------------------------- the runtime's frame

test('a plan rebuild snaps the floor rather than marching everyone across it', () => {
  // Every seat in a rebuilt plan is somewhere else, so comparing the old seat
  // to the new one made every agent path to its "new" position through a
  // building it was never standing in. On a window resize that was the whole
  // population walking at once.
  const { projects, agents } = floor({ projects: [6, 3], benched: 4, waiting: 2 });
  const wide = buildPlan(projects, agents, { targetAspect: 2.2 });
  const runtime = new AgentRuntime();
  runtime.sync(agents, wide, assignSeats(wide, agents));
  for (const rec of runtime.all()) assert.equal(rec.path.length, 0, 'first sync must not walk');

  const narrow = buildPlan(projects, agents, { targetAspect: 1.2 });
  const narrowSeats = assignSeats(narrow, agents);
  runtime.sync(agents, narrow, narrowSeats);

  for (const rec of runtime.all()) {
    assert.equal(rec.path.length, 0, `${rec.id} started walking because the plan was rebuilt`);
    const seat = narrowSeats.get(rec.id);
    assert.ok(
      Math.hypot(rec.x - seat.x, rec.y - seat.y) < EPS,
      `${rec.id} is not on its new seat after the rebuild`,
    );
  }
});

test('a state change on a settled floor DOES walk the agent that changed, and only it', () => {
  const { projects, agents } = floor({ projects: [6] });
  const plan = buildPlan(projects, agents, { targetAspect: 2.06 });
  const runtime = new AgentRuntime();
  runtime.sync(agents, plan, assignSeats(plan, agents));

  const moved = agents.map((a) => (a.id === 'p0-0' ? { ...a, ackState: 'benched' } : a));
  const rebuilt = buildPlan(projects, moved, { targetAspect: 2.06 });
  // Same plan OBJECT: this is the ordinary per-push sync, not a rebuild.
  runtime.sync(moved, plan, assignSeats(plan, moved));

  assert.ok(runtime.get('p0-0').path.length > 0, 'the benched agent should walk to the lounge');
  for (const rec of runtime.all()) {
    if (rec.id === 'p0-0') continue;
    assert.equal(rec.path.length, 0, `${rec.id} moved, and nothing about it changed`);
  }
  assert.ok(rebuilt, 'sanity: the rebuilt plan is only here to prove it was not used');
});

// ------------------------------------------------------------- the corridors

test('every room opens onto the corridor network, and the network is connected', () => {
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    const plan = buildPlan(projects, agents, { targetAspect: 2.06 });
    const lines = plan.nav;
    assert.ok(lines.length > 0, 'a floor needs at least one walkable line');

    for (const room of plan.rooms) {
      if (room.kind === 'corridor') continue;
      assert.ok(room.door, `${room.id} has no door`);
      assert.ok(room.navEntry, `${room.id} does not reach a corridor`);
      // The door is on the room's own boundary, so leaving it is a straight
      // step through its own wall rather than a diagonal across the furniture.
      const onEdge =
        Math.abs(room.door.x - room.x) < 0.01 ||
        Math.abs(room.door.x - (room.x + room.w)) < 0.01 ||
        Math.abs(room.door.y - room.y) < 0.01 ||
        Math.abs(room.door.y - (room.y + room.h)) < 0.01;
      assert.ok(onEdge, `${room.id}'s door is not on its own boundary`);
      // And the entry point is inside the building.
      assert.ok(
        room.navEntry.x >= -EPS &&
          room.navEntry.x <= plan.width + EPS &&
          room.navEntry.y >= -EPS &&
          room.navEntry.y <= plan.height + EPS,
        `${room.id}'s corridor entry is outside the building`,
      );
    }

    // Connectivity: every line reaches the spine, directly or through another.
    const reached = new Set([lines[0]]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const a of lines) {
        if (!reached.has(a)) continue;
        for (const b of lines) {
          if (reached.has(b) || a.axis === b.axis) continue;
          const v = a.axis === 'v' ? a : b;
          const h = a.axis === 'h' ? a : b;
          if (h.c < v.min - EPS || h.c > v.max + EPS) continue;
          if (v.c < h.min - EPS || v.c > h.max + EPS) continue;
          reached.add(b);
          grew = true;
        }
      }
    }
    assert.equal(reached.size, lines.length, 'the corridor network is not fully connected');
  }
});

// ------------------------------------------------------------ room balance

test('the working rooms are the subject of the floor, not the service rooms', () => {
  // The reception and the lounge are context; the project rooms are what the
  // product is for. Before the rebalance the service side took 58% of the floor
  // and the project rooms 13%, because the reception was a fixed size whatever
  // was waiting in it, the departures room was stretched to the reception's
  // height, and a collapsed project room was a fixed 13 x 5 card.
  const { projects, agents } = floor({
    projects: [15, 7, 4, 3, 2, 2, 2, 1, 1, 1, 1, 1],
    benched: 37,
    waiting: 1,
    letGo: 17,
  });
  const plan = buildPlan(projects, agents, { targetAspect: 2.06 });
  const area = (kind) =>
    plan.rooms.filter((r) => r.kind === kind).reduce((a, r) => a + r.w * r.h, 0);
  const total = plan.width * plan.height;
  const office = area('office');
  const service = office + area('lounge') + area('let_go');

  assert.ok(
    area('project') / total > 0.15,
    `project rooms are only ${((area('project') / total) * 100).toFixed(0)}% of the floor`,
  );
  assert.ok(
    service / total < 0.62,
    `the service rooms take ${((service / total) * 100).toFixed(0)}% of the floor`,
  );
  // And the reception is sized for its queue rather than for the building.
  assert.ok(office / total < 0.2, 'the reception should not dominate the floor');
});

test('the reception grows with its queue and never becomes a corridor', () => {
  let previous = 0;
  for (const waiting of [0, 1, 5, 12, 25]) {
    const { projects, agents } = floor({ projects: [4], waiting });
    const plan = buildPlan(projects, agents, { targetAspect: 2.06 });
    const office = plan.rooms.find((r) => r.kind === 'office');
    const size = office.w * office.h;
    assert.ok(size >= previous - 1e-6, `the reception shrank going from ${waiting} waiting`);
    previous = size;
    const aspect = office.w / office.h;
    assert.ok(aspect >= 0.6 && aspect <= 1.8 + 1e-6, `reception aspect ${aspect} is out of band`);
    // Everyone in the queue still gets a seat in it.
    assert.equal(plan.officeSeats.length, waiting);
  }
});

test('a collapsed project room is sized to the repo it stands for', () => {
  const sizes = [1, 4, 15];
  const rooms = sizes.map((n) => {
    const { projects, agents } = floor({ projects: [n], benched: n });
    // Every session benched, so the room collapses.
    const withIdle = projects.map((p) => ({ ...p, activeCount: 0 }));
    const plan = buildPlan(withIdle, agents, { targetAspect: 2.06 });
    return plan.rooms.find((r) => r.kind === 'project');
  });
  assert.ok(
    rooms.every((r) => r && r.collapsed),
    'all three rooms should be collapsed',
  );
  assert.ok(
    rooms[0].w * rooms[0].h < rooms[1].w * rooms[1].h,
    'a four-session repo should read larger than a one-session repo',
  );
  assert.ok(
    rooms[1].w * rooms[1].h < rooms[2].w * rooms[2].h,
    'a fifteen-session repo should read larger than a four-session one',
  );
});

test('the reception sofas form one continuous C, corner to corner', () => {
  // Three runs that stop short of each other read as three separate benches.
  for (const waiting of [1, 9, 25]) {
    const { projects, agents } = floor({ projects: [3], waiting });
    const plan = buildPlan(projects, agents, { targetAspect: 2.06 });
    const office = plan.rooms.find((r) => r.kind === 'office');
    const by = (id) => office.props.find((p) => p.id === id);
    const west = by('wait-sofa-w');
    const east = by('wait-sofa-e');
    const back = by('wait-sofa-s');
    assert.ok(west && east && back, 'the reception needs all three runs');
    // The side runs come down to meet the back run.
    assert.ok(
      Math.abs(west.y + west.h - back.y) < 0.01,
      `the west run stops ${(back.y - (west.y + west.h)).toFixed(2)} U short of the back run`,
    );
    assert.ok(Math.abs(east.y + east.h - back.y) < 0.01, 'the east run does not meet the back run');
    // And the back run spans exactly between them.
    assert.ok(
      Math.abs(back.x - (west.x + west.w)) < 0.01 && Math.abs(back.x + back.w - east.x) < 0.01,
      'the back run does not span between the two side runs',
    );
  }
});

test('the working floor is two rows with one corridor between them', () => {
  const { projects, agents } = floor({
    projects: [15, 7, 4, 3, 2, 2, 2, 1, 1, 1, 1, 1],
    benched: 37,
    waiting: 2,
  });
  const plan = buildPlan(projects, agents, { targetAspect: 2.06 });
  const rooms = plan.rooms.filter((r) => r.kind === 'project');
  const spine = plan.rooms.find((r) => r.id === '__spine__');
  const workingX = spine.x + spine.w;
  const workingW = plan.width - workingX;

  // Exactly one corridor spans the working floor.
  const fullWidth = plan.rooms.filter(
    (r) => r.kind === 'corridor' && r.id !== '__spine__' && r.w >= workingW - 0.01,
  );
  assert.equal(fullWidth.length, 1, 'the working floor takes one shared corridor, not one per row');

  // And the rooms sit in two bands, one either side of it.
  const split = fullWidth[0].y;
  const above = rooms.filter((r) => r.y + r.h <= split + 0.01);
  const below = rooms.filter((r) => r.y >= split + fullWidth[0].h - 0.01);
  assert.equal(above.length + below.length, rooms.length, 'every room is in one band or the other');
  assert.ok(above.length > 0 && below.length > 0, 'both bands hold rooms');
});

test('a project room is a room, not a splinter', () => {
  // The reason the working floor is squarified rather than shelved: a small
  // project beside a large one used to become a full-height sliver, because a
  // shelf gives every room in a row the same depth whatever its width.
  for (const spec of [
    { projects: [21, 2, 2, 2, 1, 1], benched: 6 },
    { projects: [15, 7, 4, 3, 2, 2, 2, 1, 1, 1, 1, 1], benched: 37 },
    { projects: [3, 3, 3], benched: 1 },
  ]) {
    const { projects, agents } = floor(spec);
    const plan = buildPlan(projects, agents, { targetAspect: 2.06 });
    for (const r of plan.rooms.filter((x) => x.kind === 'project')) {
      const aspect = r.w / r.h;
      assert.ok(
        aspect >= 1 / PROJECT_ASPECT_BAND && aspect <= PROJECT_ASPECT_BAND,
        `${r.id} is ${r.w.toFixed(1)} x ${r.h.toFixed(1)} (${aspect.toFixed(2)}:1) — a splinter`,
      );
    }
  }
});

test('the working floor has one corridor and no other circulation in it', () => {
  const { projects, agents } = floor({
    projects: [15, 7, 4, 3, 2, 2, 2, 1, 1, 1, 1, 1],
    benched: 37,
    waiting: 2,
  });
  const plan = buildPlan(projects, agents, { targetAspect: 2.06 });
  const corridors = plan.rooms.filter((r) => r.kind === 'corridor');
  // Exactly two pieces of circulation on the whole floor: the spine, and the
  // one cross corridor. Everything else is a room.
  assert.equal(
    corridors.length,
    2,
    `expected a spine and one cross corridor, got ${corridors.map((c) => c.id).join(', ')}`,
  );
  assert.ok(corridors.some((c) => c.id === '__spine__'));

  // And the rooms either side of the cross corridor share their walls: every
  // project room's left edge meets either the spine or another room's right.
  const spine = plan.rooms.find((r) => r.id === '__spine__');
  const rooms = plan.rooms.filter((r) => r.kind === 'project');
  for (const r of rooms) {
    const meets =
      Math.abs(r.x - (spine.x + spine.w)) < 0.01 ||
      rooms.some((o) => o !== r && Math.abs(o.x + o.w - r.x) < 0.01);
    assert.ok(meets, `${r.id} has a gap on its left rather than a shared wall`);
  }
});

test('the service column has no empty strip beside either of its rooms', () => {
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    const plan = buildPlan(projects, agents, { targetAspect: 2.06 });
    const office = plan.rooms.find((r) => r.kind === 'office');
    const lounge = plan.rooms.find((r) => r.kind === 'lounge');
    assert.ok(
      Math.abs(office.w - lounge.w) < 0.01,
      `the lounge is ${lounge.w.toFixed(1)} wide and the reception ${office.w.toFixed(1)}`,
    );
    // Nothing sits between the column and the spine.
    const spine = plan.rooms.find((r) => r.id === '__spine__');
    if (!spine) continue;
    assert.ok(
      Math.abs(spine.x - office.w) < 0.01,
      'there is a strip of floor between the reception and the corridor',
    );
  }
});

// --------------------------------------------------------- lounge behaviour

test('the lounge only offers activities it has the furniture for', () => {
  // With one benched agent the lounge lays out a dining table and nothing
  // else. Offering pool anyway had the agent playing an imaginary game in the
  // middle of the floor.
  const { projects, agents } = floor({ projects: [2], benched: 1 });
  const plan = buildPlan(projects, agents, { targetAspect: 2.06 });
  const kinds = new Set(plan.loungeSpots.map((s) => s.kind));
  assert.ok(!kinds.has('pool'), 'a one-person lounge has no pool table to stand at');

  const runtime = new AgentRuntime();
  runtime.sync(agents, plan, assignSeats(plan, agents));
  // Drive the rotation hard enough that a bad pick would show up.
  for (let i = 0; i < 200; i++) {
    runtime.step(1, { plan });
    for (const rec of runtime.all()) {
      if (rec.placement !== 'lounge' || !rec.rotation.activity) continue;
      assert.ok(
        kinds.has(rec.rotation.activity),
        `a benched agent picked "${rec.rotation.activity}", which this lounge has no spot for`,
      );
    }
  }
});

test('two benched agents never end up standing in the same place', () => {
  const { projects, agents } = floor({ projects: [2], benched: 12 });
  const plan = buildPlan(projects, agents, { targetAspect: 2.06 });
  const runtime = new AgentRuntime();
  runtime.sync(agents, plan, assignSeats(plan, agents));
  for (let i = 0; i < 400; i++) {
    runtime.step(0.5, { plan });
    const held = new Map();
    for (const rec of runtime.all()) {
      if (rec.placement !== 'lounge' || rec.path.length > 0) continue;
      const key = `${rec.x.toFixed(2)}:${rec.y.toFixed(2)}`;
      assert.ok(!held.has(key), `${rec.id} is standing on ${held.get(key)} at ${key}`);
      held.set(key, rec.id);
    }
  }
});
