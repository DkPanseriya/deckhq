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

import {
  buildPlan,
  floorPopulation,
  isGoneHome,
  GONE_HOME_DAYS,
  DIRECTORY_MAX_H,
  PLATE_BAND,
} from '../../public/render/plan.js';
import { assignSeats, AgentRuntime, derivePlacement } from '../../public/render/agents.js';

const EPS = 1e-6;

/** How far from square a project room may be before it reads as a splinter. */
const PROJECT_ASPECT_BAND = 2.6;

/**
 * A fixed clock. Every gone-home decision is `now - lastActivityAt` against a
 * window, so a fixture that used the real clock would be a different floor
 * every time it ran.
 */
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

/** @param {string} id @param {object} over */
function agent(id, over = {}) {
  return {
    id,
    projectId: 'p0',
    activityState: 'working',
    ackState: 'active',
    reviewSince: null,
    // Recent by default: an agent the floor has no reason to hide.
    lastActivityAt: NOW - 60_000,
    ...over,
  };
}

/**
 * A population with a given mix, plus the projects to match.
 *
 * `idleProjects` are repos with sessions and nobody active — the shape WP-50
 * turns into directory lines. `goneHome` are benched agents whose last
 * activity is well past the window, which the lounge must not size itself to.
 * @param {{projects?: number[], waiting?: number, benched?: number,
 *   letGo?: number, idleProjects?: number[], goneHome?: number}} spec
 */
function floor(spec) {
  const sizes = spec.projects ?? [3];
  const idleSizes = spec.idleProjects ?? [];
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
  idleSizes.forEach((n, i) => {
    projects.push({
      id: `idle${i}`,
      name: `idle${i}`,
      sessionCount: n,
      tokens: 500 * (i + 1),
      needsYou: 0,
    });
    for (let k = 0; k < n; k++) {
      agents.push(
        agent(`idle${i}-${k}`, {
          projectId: `idle${i}`,
          activityState: 'ended',
          lastActivityAt: NOW - (i + 2) * DAY,
        }),
      );
    }
  });
  for (let k = 0; k < (spec.goneHome ?? 0); k++) {
    agents.push(
      agent(`gh${k}`, {
        ackState: 'benched',
        activityState: 'ended',
        lastActivityAt: NOW - (GONE_HOME_DAYS + 3) * DAY,
      }),
    );
  }
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
  // WP-50's own shapes: idle repos that must become directory lines, and a
  // benched population most of which has gone home.
  { projects: [1], idleProjects: [3, 1, 1], benched: 2 },
  { projects: [2, 1], idleProjects: [5, 4, 3, 2, 2, 1, 1, 1], benched: 4, goneHome: 20 },
  { projects: [], idleProjects: [2, 1], benched: 1, goneHome: 6 },
  {
    // The reference machine's shape: one active repo, seventeen idle ones,
    // and a lounge whose benched population is mostly gone home.
    projects: [3],
    idleProjects: Array.from({ length: 17 }, (_, i) => (i % 3) + 1),
    benched: 8,
    waiting: 2,
    goneHome: 39,
  },
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
      const plan = buildPlan(projects, agents, { targetAspect, now: NOW });
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
    const plan = buildPlan(projects, agents, { targetAspect: 2.06, now: NOW });
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
      const plan = buildPlan(projects, agents, { targetAspect, now: NOW });
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
    const plan = buildPlan(projects, agents, { targetAspect: 2.06, now: NOW });
    const seats = assignSeats(plan, agents);

    // Archived sessions are off the floor and get no place at all, and nor
    // does anyone the plan hides — an agent who went home, or one at a desk in
    // a project with no room. Everybody the floor DRAWS gets a place of their
    // own; that is what `plan.hidden` exists to keep honest.
    const onFloor = agents.filter((a) => a.ackState !== 'let_go' && !plan.hidden.has(a.id));
    assert.equal(seats.size, onFloor.length, 'every agent on the floor must be given a place');
    for (const a of agents) {
      if (plan.hidden.has(a.id)) {
        assert.ok(!seats.has(a.id), `${a.id} is hidden and was still given a seat`);
      }
    }

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
    const plan = buildPlan(projects, agents, { targetAspect: 2.06, now: NOW });
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
      if (plan.hidden.has(a.id)) continue; // went home, or a desk with no room
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
  const plan = buildPlan(projects, agents, { targetAspect: 2.06, now: NOW });
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
  const wide = buildPlan(projects, agents, { targetAspect: 2.2, now: NOW });
  const runtime = new AgentRuntime();
  runtime.sync(agents, wide, assignSeats(wide, agents));
  for (const rec of runtime.all()) assert.equal(rec.path.length, 0, 'first sync must not walk');

  const narrow = buildPlan(projects, agents, { targetAspect: 1.2, now: NOW });
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
  const plan = buildPlan(projects, agents, { targetAspect: 2.06, now: NOW });
  const runtime = new AgentRuntime();
  runtime.sync(agents, plan, assignSeats(plan, agents));

  const moved = agents.map((a) => (a.id === 'p0-0' ? { ...a, ackState: 'benched' } : a));
  const rebuilt = buildPlan(projects, moved, { targetAspect: 2.06, now: NOW });
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
    const plan = buildPlan(projects, agents, { targetAspect: 2.06, now: NOW });
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
  const plan = buildPlan(projects, agents, { targetAspect: 2.06, now: NOW });
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
    const plan = buildPlan(projects, agents, { targetAspect: 2.06, now: NOW });
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

test('an idle repo costs a directory line, never a room', () => {
  // The defect WP-50 exists to fix: a repo with nobody in it used to get a
  // collapsed ROOM, which still bid for area in the treemap. On the reference
  // machine that turned the working floor into large empty cells.
  for (const n of [1, 4, 15]) {
    // One repo, every session benched, nobody active in it.
    const { projects, agents } = floor({ projects: [], benched: n });
    projects.push({ id: 'p0', name: 'p0', sessionCount: n, tokens: 0, needsYou: 0 });
    const plan = buildPlan(projects, agents, { targetAspect: 2.06, now: NOW });
    assert.equal(
      plan.rooms.find((r) => r.kind === 'project'),
      undefined,
      `${n} benched sessions and nobody active should be a line, not a room`,
    );
    const directory = plan.rooms.find((r) => r.kind === 'directory');
    assert.ok(directory, 'the repo still has to be visible somewhere');
    assert.equal(directory.entries.length, 1);
    assert.ok(
      directory.h <= DIRECTORY_MAX_H + EPS,
      `the strip is ${directory.h.toFixed(1)} U tall, past the ${DIRECTORY_MAX_H} U cap`,
    );
  }
});

test('the reception sofas form one continuous C, corner to corner', () => {
  // Three runs that stop short of each other read as three separate benches.
  for (const waiting of [1, 9, 25]) {
    const { projects, agents } = floor({ projects: [3], waiting });
    const plan = buildPlan(projects, agents, { targetAspect: 2.06, now: NOW });
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

test('the working floor is bands of rooms with one shared corridor between each', () => {
  // WP-55 made the band count a CHOICE rather than a constant: the envelope is
  // summed from its contents now, so the number of bands is one of the two
  // things (with the service-column width) the plan still uses to take the
  // shape of the screen. What must hold whatever it picks is the structure —
  // rooms in bands, one corridor spanning the working floor between each pair,
  // and no room straddling one.
  const { projects, agents } = floor({
    projects: [15, 7, 4, 3, 2, 2, 2, 1, 1, 1, 1, 1],
    benched: 37,
    waiting: 2,
  });
  const plan = buildPlan(projects, agents, { targetAspect: 2.06, now: NOW });
  const rooms = plan.rooms.filter((r) => r.kind === 'project');
  const spine = plan.rooms.find((r) => r.id === '__spine__');
  const workingX = spine.x + spine.w;
  const workingW = plan.width - workingX;

  const crossing = plan.rooms
    .filter(
      (r) =>
        r.kind === 'corridor' &&
        r.id !== '__spine__' &&
        r.id !== '__open__' &&
        r.w >= workingW - 0.01,
    )
    .sort((a, b) => a.y - b.y);
  assert.ok(crossing.length >= 1, 'the working floor takes at least one shared corridor');
  assert.ok(crossing.length <= 3, `${crossing.length} cross corridors is a plan made of aisles`);

  // Every room sits wholly in one band: none of them straddles a corridor.
  for (const room of rooms) {
    for (const c of crossing) {
      assert.ok(
        room.y + room.h <= c.y + 0.01 || room.y >= c.y + c.h - 0.01,
        `${room.id} straddles the corridor at y=${c.y.toFixed(1)}`,
      );
    }
  }
  // And every band the corridors define actually holds rooms.
  const edges = [0, ...crossing.flatMap((c) => [c.y, c.y + c.h]), plan.height];
  for (let i = 0; i < edges.length - 1; i += 2) {
    const top = edges[i];
    const bottom = edges[i + 1];
    assert.ok(
      rooms.some((r) => r.y >= top - 0.01 && r.y + r.h <= bottom + 0.01),
      `the band between ${top.toFixed(1)} and ${bottom.toFixed(1)} holds no rooms`,
    );
  }
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
    const plan = buildPlan(projects, agents, { targetAspect: 2.06, now: NOW });
    for (const r of plan.rooms.filter((x) => x.kind === 'project')) {
      const aspect = r.w / r.h;
      assert.ok(
        aspect >= 1 / PROJECT_ASPECT_BAND && aspect <= PROJECT_ASPECT_BAND,
        `${r.id} is ${r.w.toFixed(1)} x ${r.h.toFixed(1)} (${aspect.toFixed(2)}:1) — a splinter`,
      );
    }
  }
});

test('the working floor is circulation and rooms, and mostly rooms', () => {
  const { projects, agents } = floor({
    projects: [15, 7, 4, 3, 2, 2, 2, 1, 1, 1, 1, 1],
    benched: 37,
    waiting: 2,
  });
  const plan = buildPlan(projects, agents, { targetAspect: 2.06, now: NOW });
  const corridors = plan.rooms.filter((r) => r.kind === 'corridor');
  assert.ok(corridors.some((c) => c.id === '__spine__'));

  // WP-50 asserted exactly two pieces of circulation, because the treemap
  // stretched the rooms to tile whatever rectangle was left over and there was
  // nothing else it COULD be. WP-55 sizes the rooms to their contents instead,
  // so a floor whose service column is taller than its rooms need, or whose
  // bands are not the same width, has floor left over — and open floor is what
  // that honestly is. What must still hold is that it stays a minority.
  const spine = plan.rooms.find((r) => r.id === '__spine__');
  const rooms = plan.rooms.filter((r) => r.kind === 'project');
  const total = plan.width * plan.height;
  // The spine and the cross corridors are structure — the routes people walk.
  // What is measured here is the leftover: the bays at the end of a short band
  // and the open band under the rooms, both `thoroughfare: false`.
  const open = corridors.filter((c) => c.thoroughfare === false).reduce((a, c) => a + c.w * c.h, 0);
  assert.ok(
    open / total < 0.2,
    `${((open / total) * 100).toFixed(0)}% of the floor is open floor nobody walks on`,
  );

  // And the rooms in a band share their walls: every project room's left edge
  // meets either the spine or another room's right.
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
    const plan = buildPlan(projects, agents, { targetAspect: 2.06, now: NOW });
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
  const plan = buildPlan(projects, agents, { targetAspect: 2.06, now: NOW });
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
  const plan = buildPlan(projects, agents, { targetAspect: 2.06, now: NOW });
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

// ------------------------------------------------------- WP-50: the rule itself

test('no room exists without an active occupant, at every population and aspect', () => {
  // `08` B6, stated as a property. A room is drawn only for a project with an
  // agent at a desk, hand up, or waiting — and "waiting" is a real occupant of
  // that room even though it is standing in the office at the time, which is
  // why the count comes from the population rather than from the seats.
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    for (const targetAspect of ASPECTS) {
      const plan = buildPlan(projects, agents, { targetAspect, now: NOW });
      const pop = floorPopulation(agents, { now: NOW });
      for (const room of plan.rooms) {
        if (room.kind !== 'project') continue;
        assert.ok(
          (pop.active.get(room.id) ?? 0) > 0,
          `${room.id} has a room and nobody active in it (${targetAspect}:1)`,
        );
      }
      // And the converse: every project with somebody active has a room, so
      // an active agent is never left without one.
      for (const [id, n] of pop.active) {
        if (n === 0) continue;
        const project = projects.find((p) => p.id === id);
        if (!project || (project.sessionCount ?? 0) === 0) continue;
        assert.ok(
          plan.rooms.some((r) => r.kind === 'project' && r.id === id),
          `${id} has ${n} active agents and no room`,
        );
      }
    }
  }
});

test('the idle-projects strip costs a plate per repo, and is capped whatever the count', () => {
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    for (const targetAspect of ASPECTS) {
      const plan = buildPlan(projects, agents, { targetAspect, now: NOW });
      const strip = plan.rooms.find((r) => r.kind === 'directory');
      const idle = projects.filter(
        (p) =>
          (p.sessionCount ?? 0) > 0 &&
          !plan.rooms.some((r) => r.kind === 'project' && r.id === p.id),
      );
      if (idle.length === 0) {
        assert.equal(strip, undefined, 'a floor with no idle repos needs no strip');
        continue;
      }
      assert.ok(strip, `${idle.length} idle repos and no strip to list them in`);
      assert.equal(strip.entries.length, idle.length, 'every idle repo gets a line');
      // A plate's height per repo, not a room's — the whole point of B6's
      // "it takes the space of a room plate, not a room". The strip's own
      // header band is the one fixed overhead and is excluded, the same way a
      // room's plate band is not part of what its furniture pays for.
      for (const e of strip.entries) {
        assert.ok(
          e.h <= PLATE_BAND + EPS,
          `a directory line is ${e.h.toFixed(2)} U tall, more than a room plate`,
        );
      }
      assert.ok(
        (strip.h - PLATE_BAND) / strip.entries.length <= PLATE_BAND + EPS,
        `the strip spends ${((strip.h - PLATE_BAND) / strip.entries.length).toFixed(2)} U per repo past its header`,
      );
      assert.ok(
        strip.h <= DIRECTORY_MAX_H + EPS,
        `the strip is ${strip.h.toFixed(1)} U tall, past the ${DIRECTORY_MAX_H} U cap`,
      );
      // And it never crowds out the rooms it stands beside.
      //
      // WP-50 stated that as "shorter than every room", which held while the
      // working floor was the width of the building and the strip could always
      // flow into columns. WP-55 makes the working floor the width of its
      // ROOMS, so one active project beside seventeen idle repos leaves the
      // strip one column wide and seventeen lines deep — genuinely taller than
      // the one room, and the honest picture of that machine. What must hold is
      // that it stays a strip: a line per repo, and a corner of the floor.
      const share = (strip.w * strip.h) / (plan.width * plan.height);
      assert.ok(
        share < 0.25,
        `the strip takes ${(share * 100).toFixed(0)}% of the floor at ${targetAspect}:1`,
      );
    }
  }
});

test('every room is furnished, not just occupied: no cell is mostly bare carpet', () => {
  // Desks count agents now, so a room's furniture is routinely smaller than
  // the cell the treemap gives it. §64 measured content fill in an occupied
  // room at 94%; the floor for that here is 60%, which is what "no cell more
  // than 40% bare carpet" means (`08` WP-50's acceptance).
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    for (const targetAspect of ASPECTS) {
      const plan = buildPlan(projects, agents, { targetAspect, now: NOW });
      for (const room of plan.rooms) {
        if (room.kind !== 'project') continue;
        const box = room.props.reduce(
          (a, p) => ({
            x0: Math.min(a.x0, p.x),
            y0: Math.min(a.y0, p.y),
            x1: Math.max(a.x1, p.x + p.w),
            y1: Math.max(a.y1, p.y + p.h),
          }),
          { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
        );
        const fill = ((box.x1 - box.x0) * (box.y1 - box.y0)) / (room.w * room.h);
        assert.ok(
          fill >= 0.6,
          `${room.id} is ${((1 - fill) * 100).toFixed(0)}% bare carpet at ${targetAspect}:1`,
        );
      }
    }
  }
});

// ------------------------------------------- WP-55: the room is its contents

/**
 * How much of a room is floor its furniture has no use for.
 *
 * `room.natural` is the footprint the room's own contents need — the desk
 * cluster, the clearance the corner planting and the wall fixtures stand in,
 * and the plate band — computed by `buildProjectRoom` before the packer has
 * given the room a cell. Everything past it is bare carpet, whether or not a
 * rug has been painted over it.
 *
 * This is deliberately NOT the bounding box of the room's props, which is what
 * WP-50's fill test measured. A room with a plant in each corner and a rug
 * stretched to the walls has a prop bounding box covering 97% of it and reads,
 * correctly, as an empty room: on the reference floor that measured 3.3% bare
 * by the bounding box and 55% of the screen by eye.
 * @param {{w:number,h:number,natural?:{w:number,h:number}}} room
 */
function bareCarpet(room) {
  const natural = room.natural || { w: room.w, h: room.h };
  return 1 - (natural.w * natural.h) / (room.w * room.h);
}

test('no room is more than 35% bare carpet, at every population and aspect', () => {
  // WP-55's acceptance, as a property. Before it, one active project was given
  // the whole working band — an 88 x 67 room holding a two-seat table, 97% of it
  // floor covering — because the envelope was built to the window's shape and
  // the treemap stretched whatever rooms there were to tile the remainder.
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    for (const targetAspect of ASPECTS) {
      const plan = buildPlan(projects, agents, { targetAspect, now: NOW });
      for (const room of plan.rooms) {
        if (room.kind !== 'project') continue;
        const bare = bareCarpet(room);
        assert.ok(
          bare <= 0.35 + EPS,
          `${room.id} is ${(bare * 100).toFixed(0)}% bare carpet at ${targetAspect}:1 — ` +
            `${room.w.toFixed(1)}x${room.h.toFixed(1)} for furniture needing ` +
            `${room.natural.w.toFixed(1)}x${room.natural.h.toFixed(1)}`,
        );
      }
    }
  }
});

test('the building is the sum of its parts, not the shape of the window', () => {
  // The envelope is the service column, the spine and the working floor its
  // rooms need, side by side — so a floor with one small project comes out
  // SMALL, and `fitToWindow` draws it larger rather than the plan inventing
  // carpet to fill a 1600 x 900 stage.
  const planFor = (spec) => {
    const { projects, agents } = floor(spec);
    return buildPlan(projects, agents, { targetAspect: 1.78, now: NOW });
  };
  const one = planFor({ projects: [2], benched: 2 });
  const many = planFor({ projects: [4, 4, 4, 4, 4, 4], benched: 2 });
  assert.ok(
    many.width > one.width * 1.4,
    `six projects (${many.width.toFixed(0)} U) should make a much wider building than one (${one.width.toFixed(0)} U)`,
  );

  // And the envelope really is the sum: the working side is exactly what is
  // left after the service column and the spine.
  for (const plan of [one, many]) {
    const office = plan.rooms.find((r) => r.kind === 'office');
    const spine = plan.rooms.find((r) => r.id === '__spine__');
    const right = plan.rooms
      .filter((r) => r.x >= spine.x + spine.w - 0.01)
      .reduce((a, r) => Math.max(a, r.x + r.w), spine.x + spine.w);
    assert.ok(Math.abs(spine.x - office.w) < 0.01, 'the spine sits against the service column');
    assert.ok(
      Math.abs(right - plan.width) < 0.01,
      'the working side reaches the building line exactly',
    );
  }
});

// ------------------------------------------------------------ WP-50: gone home

test('the gone-home window is a boundary, and it is exclusive', () => {
  const at = (ms) => ({ ackState: 'benched', lastActivityAt: NOW - ms });
  const window = GONE_HOME_DAYS * DAY;
  assert.equal(isGoneHome(at(window - 1), NOW), false, 'a millisecond inside the window is drawn');
  assert.equal(isGoneHome(at(window), NOW), false, 'exactly the window is still drawn');
  assert.equal(isGoneHome(at(window + 1), NOW), true, 'a millisecond past it goes home');
  // The window is a setting, and 0 turns the filter off rather than hiding
  // everybody — which is the failure mode a clamp bug would otherwise have.
  assert.equal(isGoneHome(at(window + 1), NOW, 0), false, '0 days draws everybody');
  assert.equal(isGoneHome(at(2 * DAY), NOW, 1), true, 'a shorter window sends more people home');
  // An agent nobody can date is drawn. The floor does not hide what it cannot
  // measure.
  assert.equal(isGoneHome({ ackState: 'benched' }, NOW), false);
  assert.equal(isGoneHome({ ackState: 'benched', lastActivityAt: 0 }, NOW), false);
  // And only a benched agent can go home at all.
  assert.equal(isGoneHome({ ackState: 'active', lastActivityAt: NOW - 400 * DAY }, NOW), false);
});

test('activity brings an agent back, and its ackState never moved', () => {
  const projects = [{ id: 'p0', name: 'p0', sessionCount: 2, tokens: 0, needsYou: 0 }];
  const away = {
    id: 'sleeper',
    projectId: 'p0',
    ackState: 'benched',
    activityState: 'ended',
    lastActivityAt: NOW - (GONE_HOME_DAYS + 30) * DAY,
  };
  const working = agent('worker', { projectId: 'p0' });

  const before = buildPlan(projects, [working, away], { targetAspect: 1.78, now: NOW });
  assert.ok(before.goneHome.has('sleeper'), 'a benched agent quiet for 37 days is not drawn');
  assert.ok(!assignSeats(before, [working, away]).has('sleeper'));

  // The SAME agent, with a fresh timestamp: nothing about `ackState` has been
  // touched — this is a display filter over an observed field, which is
  // exactly why it can never interact with the invariant.
  const back = { ...away, lastActivityAt: NOW - 1000 };
  const after = buildPlan(projects, [working, back], { targetAspect: 1.78, now: NOW });
  assert.equal(after.goneHome.size, 0, 'activity brings them straight back');
  assert.ok(assignSeats(after, [working, back]).has('sleeper'), 'and back to a spot of their own');
  assert.equal(back.ackState, 'benched', 'and they are still benched, because nothing wrote to it');
  assert.equal(away.ackState, 'benched', 'nor did going home write to it');
});

test('the lounge is sized by who is drawn, and its plate carries the rest', () => {
  const projects = [{ id: 'p0', name: 'p0', sessionCount: 1, tokens: 0, needsYou: 0 }];
  const working = agent('worker');
  const benched = (n, ageDays) =>
    Array.from({ length: n }, (_, i) => ({
      id: `b${ageDays}-${i}`,
      projectId: 'p0',
      ackState: 'benched',
      activityState: 'ended',
      lastActivityAt: NOW - ageDays * DAY,
    }));

  const all = buildPlan(projects, [working, ...benched(47, 1)], {
    targetAspect: 1.78,
    now: NOW,
  });
  const mostAway = buildPlan(projects, [working, ...benched(8, 1), ...benched(39, 30)], {
    targetAspect: 1.78,
    now: NOW,
  });

  const loungeOf = (plan) => plan.rooms.find((r) => r.kind === 'lounge');
  assert.ok(
    loungeOf(mostAway).w * loungeOf(mostAway).h < loungeOf(all).w * loungeOf(all).h,
    'a lounge drawing 8 people must be smaller than one drawing 47',
  );
  assert.deepEqual(loungeOf(mostAway).plateLines, ['Lounge', '8 benched · 39 went home']);
  assert.deepEqual(loungeOf(all).plateLines, ['Lounge', '47 benched']);
  // Every one of them is still reachable: the plan names them, which is what
  // the palette/keyboard command reads.
  assert.equal(mostAway.goneHome.size, 39);
});
