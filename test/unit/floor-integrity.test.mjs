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
  ASPECT_TOLERANCE,
  GONE_HOME_DAYS,
  FLOOR_OPEN_MAX,
  OPEN_FLOOR_MAX,
  ROOM_FILL_COLUMN_MAX,
  ROOM_FILL_MAX,
  ROOM_HEIGHT_STRETCH_MAX,
  ROOM_WIDTH_STRETCH_MAX,
  SERVICE_COLUMN_MAX,
  WORKING_OPEN_MAX,
} from '../../public/render/plan.js';
import {
  ASPECT_SETTLE,
  LOUNGE_PACKS,
  OFFICE_MAX_W,
  OFFICE_ROW_ASPECT_MAX,
  OFFICE_SEAT_PITCH,
  SERVICE_W_STEP,
} from '../../public/render/plan-units.js';
import { assignSeats, AgentRuntime, derivePlacement } from '../../public/render/agents.js';
import { idleProjectsOf } from '../../public/floor-rule.js';
// The fit is the other half of WP-59 and the two only mean anything together:
// an envelope the shape of the window that the camera then refuses to grow
// into it is the same picture as a small building. `scene.js` imports cleanly
// under plain Node (see the note at the foot of it), so the fill arithmetic is
// asked here rather than restated.
import {
  computeFill,
  computeTargetAspect,
  FILL_MIN_LONG,
  FILL_MIN_SHORT,
  GROUND_MARGIN_MAX,
} from '../../public/render/scene.js';
import { counts } from '../../src/core/model.mjs';

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
 * `juniors` are WP-41's subagents: `[parentId, count]`, standing beside the
 * agent that spawned them wherever that agent is. They are the population
 * WP-59d's second defect needs — sixteen of them beside a BENCHED senior drew
 * a packed row along the lounge's bottom wall with half of it outside the
 * room.
 * @param {{projects?: number[], waiting?: number, benched?: number,
 *   letGo?: number, idleProjects?: number[], goneHome?: number,
 *   juniors?: [string, number][]}} spec
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
  for (const [parentId, count] of spec.juniors ?? []) {
    const parent = agents.find((a) => a.id === parentId);
    for (let k = 0; k < count; k++) {
      agents.push(
        agent(`${parentId}j${k}`, {
          projectId: parent ? parent.projectId : 'p0',
          subagent: true,
          parentId,
        }),
      );
    }
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
  {
    // WP-59b's `threeRooms`: the owner's own floor in miniature — three active
    // repos, one at a desk in each, a few benched and three repos nobody is
    // in. THREE is the point of it. It is the smallest room count a row cannot
    // be split evenly into, so WP-59's packer dealt it two-and-one and the
    // lone room could honestly take only a third of its band; the rest of that
    // row was drawn as bare floor beside it. No other population in this list
    // has an odd number of rooms above one.
    projects: [4, 3, 2],
    idleProjects: [2, 1, 1],
    benched: 6,
    waiting: 3,
  },
  {
    // WP-59d: THE OWNER'S OWN FLOOR. One busy project and three one-desk ones,
    // a thirteen-line board, a queue of nine and a lounge holding twenty-three
    // benched agents beside twenty-four who have gone home. It is the shape
    // §141 proved a COLUMN cannot fill — after every lever in the fill order,
    // 43% of his working side was still open plan — and it is the shape the
    // second arrangement exists for.
    projects: [8, 1, 1, 1],
    idleProjects: [7, 4, 4, 3, 2, 2, 2, 1, 1, 1, 1, 1, 1],
    benched: 23,
    waiting: 9,
    goneHome: 24,
  },
];

/**
 * The same floor with WP-41's juniors on it: sixteen beside a BENCHED senior,
 * two beside somebody at a desk, one beside an agent waiting in the office.
 *
 * Its own fixture rather than a sixteenth population, because juniors are
 * counted as agents at desks (`08` B6, and `desksIn` in `plan.js`) — sixteen
 * of them make their parent's project a twenty-desk room beside three one-desk
 * ones, which is a floor about table sizes rather than about the thing these
 * two tests are for.
 */
const JUNIORS = {
  ...POPULATIONS[POPULATIONS.length - 1],
  juniors: /** @type {[string, number][]} */ ([
    ['b0', 16],
    ['p1-0', 2],
    ['w0', 1],
  ]),
};

const ASPECTS = [1.2, 1.6, 1.78, 2.06, 2.2];

/**
 * The stages WP-59 is measured on: the goldens' window, and the two the owner
 * actually reported the building shrinking in.
 *
 * AND THE STAGE A WINDOW ACTUALLY GIVES (WP-60). The first three are WINDOW
 * sizes, and the canvas is not the window: the header and the queue strip take
 * about 130 px off the top before the floor gets any, so a 1920 x 1080 window
 * hands `buildPlan` roughly 1920 x 950. That is a 2.02:1 stage rather than a
 * 1.78:1 one, and it is a different question — near `ASPECT_MAX`, where the
 * building cannot be the window's shape and the search has to choose what to
 * give up instead.
 *
 * It was not a hypothetical. WP-60 found the `wide` golden — the capture §142
 * added to show the second arrangement — drawn as a COLUMN with 54% of its
 * working side bare, because at 2.02:1 the column cleared `ASPECT_TOLERANCE`
 * by a hair and the full two-row floor missed it by a hair, and
 * `betterArrangement`'s first rank was a bar rather than a distance. Every
 * assertion in this file passed, because none of them was ever asked at the
 * size the product renders at.
 */
const STAGES = [
  [1600, 1000],
  [1920, 1080],
  [1920, 950],
  [2560, 1440],
  [2560, 1310],
];

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
      // A junior's room is its PARENT's, wherever that is, so
      // `derivePlacement` — which answers `desk` for one standing in a lounge
      // — cannot name it. `no agent is drawn outside the room it stands in`
      // below is the same property asked the way a junior can answer it.
      if (a.subagent === true) continue;
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
    // A ROOM IN A ROW IS WIDER, and that is the shape it is for (WP-59d).
    // `ROOM_ASPECT_MAX` is the bound on a reception whose desk is at the top
    // and whose queue runs down both sides of it; the row reception's waiting
    // area runs along its width with the desk at one end, and what stops it
    // there is `OFFICE_ROW_ASPECT_MAX`.
    const aspect = office.w / office.h;
    const max = plan.arrangement === 'two-rows' ? OFFICE_ROW_ASPECT_MAX : 1.8;
    assert.ok(
      aspect >= 0.6 && aspect <= max + 1e-6,
      `reception aspect ${aspect} is out of band for a ${plan.arrangement} floor`,
    );
    // Everyone in the queue still gets a seat in it.
    assert.equal(plan.officeSeats.length, waiting);
  }
});

test('an idle repo costs no floor at all, and is still reachable', () => {
  // The defect WP-50 exists to fix: a repo with nobody in it used to get a
  // collapsed ROOM, which still bid for area in the treemap. On the reference
  // machine that turned the working floor into large empty cells. WP-50 made
  // it a line on a strip; WP-60 made it a line in a popover, which is the same
  // sentence with the floor taken out of it.
  for (const n of [1, 4, 15]) {
    // One repo, every session benched, nobody active in it.
    const { projects, agents } = floor({ projects: [], benched: n });
    projects.push({ id: 'p0', name: 'p0', sessionCount: n, tokens: 0, needsYou: 0 });
    const plan = buildPlan(projects, agents, { targetAspect: 2.06, now: NOW });
    assert.equal(
      plan.rooms.find((r) => r.kind === 'project'),
      undefined,
      `${n} benched sessions and nobody active should cost no room`,
    );
    assert.equal(
      plan.rooms.find((r) => r.kind === 'directory'),
      undefined,
      'and no strip either — the floor is for the repos somebody is in',
    );
    // AND IT IS STILL VISIBLE SOMEWHERE. The half of the rule that makes the
    // other half safe: a repo the floor does not draw and the list does not
    // carry is a repo the user cannot start an agent in.
    assert.deepEqual(
      idleProjectsOf({ projects, agents }).map((e) => e.id),
      ['p0'],
      'the repo has to be reachable from the idle list',
    );
  }
});

test('the reception sofas form one continuous C, corner to corner', () => {
  // Three runs that stop short of each other read as three separate benches.
  //
  // WP-59d: A ROW RECEPTION IS THE SAME C ON ITS SIDE. `buildOfficeRow`
  // reflects the whole room in the diagonal, so the west run lies along the
  // north wall, the back run down the east one, and the ids move with the
  // walls they name. The relationship asserted here is the one that matters
  // and it is the same either way, so it is stated on the axis the runs
  // actually lie on rather than twice.
  for (const waiting of [1, 9, 25]) {
    const { projects, agents } = floor({ projects: [3], waiting });
    const plan = buildPlan(projects, agents, { targetAspect: 2.06, now: NOW });
    const office = plan.rooms.find((r) => r.kind === 'office');
    const by = (id) => office.props.find((p) => p.id === id);
    const upright = Boolean(by('wait-sofa-w'));
    const first = by(upright ? 'wait-sofa-w' : 'wait-sofa-n');
    const second = by(upright ? 'wait-sofa-e' : 'wait-sofa-s');
    const back = by(upright ? 'wait-sofa-s' : 'wait-sofa-e');
    assert.ok(first && second && back, 'the reception needs all three runs');
    // `along` is the axis the two side runs lie on; the back run closes them.
    const lo = (p) => (upright ? p.y : p.x);
    const size = (p) => (upright ? p.h : p.w);
    const across = (p) => (upright ? p.x : p.y);
    const thick = (p) => (upright ? p.w : p.h);
    // The side runs come down to meet the back run.
    assert.ok(
      Math.abs(lo(first) + size(first) - lo(back)) < 0.01,
      `the first run stops ${(lo(back) - (lo(first) + size(first))).toFixed(2)} U short of the back`,
    );
    assert.ok(
      Math.abs(lo(second) + size(second) - lo(back)) < 0.01,
      'the second run does not meet the back run',
    );
    // And the back run spans exactly between them.
    assert.ok(
      Math.abs(across(back) - (across(first) + thick(first))) < 0.01 &&
        Math.abs(across(back) + thick(back) - across(second)) < 0.01,
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
  const { workingW } = roomBands(plan);

  const crossing = plan.rooms
    .filter(
      (r) =>
        r.kind === 'corridor' &&
        r.id !== '__spine__' &&
        !r.id.startsWith('__open') &&
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
  const rooms = plan.rooms.filter((r) => r.kind === 'project');
  const total = plan.width * plan.height;
  // The spine and the cross corridors are structure — the routes people walk.
  // What is measured here is the leftover: the bays at the end of a short band
  // and the open plan under the rooms, both `thoroughfare: false`.
  //
  // WP-50 held this at 20% and WP-59 left it there, because a floor with
  // twelve rooms in it never needed to buy anything. WP-59b lays those twelve
  // ACROSS rather than in two stacked rows of six, which is a wider, shallower
  // working side — the whole point — and the height the rooms no longer take
  // becomes open plan under them. `FLOOR_OPEN_MAX` is the budget and the bound
  // here is stated against it, one point under, so this test still says
  // something the constant does not: that the twelve-room floor spends no more
  // than any other.
  const open = corridors.filter((c) => c.thoroughfare === false).reduce((a, c) => a + c.w * c.h, 0);
  assert.ok(
    open / total < FLOOR_OPEN_MAX - 0.01,
    `${((open / total) * 100).toFixed(0)}% of the floor is open floor nobody walks on`,
  );

  // And the rooms in a band share their walls: every project room's left edge
  // meets the working side's own left edge — the spine in a column, the
  // reception in a row (WP-59d) — or another room's right.
  const workingX = plan.working.x;
  for (const r of rooms) {
    const meets =
      Math.abs(r.x - workingX) < 0.01 ||
      rooms.some((o) => o !== r && Math.abs(o.x + o.w - r.x) < 0.01);
    assert.ok(meets, `${r.id} has a gap on its left rather than a shared wall`);
  }
});

test('the service rooms have no empty strip beside either of them', () => {
  // In a COLUMN the two service rooms are one width and the spine is against
  // them. In TWO ROWS they are the left ends of two rows (WP-59d) and are two
  // different widths on purpose — the reception is as wide as the rooms beside
  // it leave it and the lounge as wide as the strip does — so the sentence
  // this test is actually about is stated per row: each row is FULL, wall to
  // wall, with nothing between its two halves. A lobby is a room-shaped piece
  // of nothing either way.
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    const plan = buildPlan(projects, agents, { targetAspect: 2.06, now: NOW });
    const office = plan.rooms.find((r) => r.kind === 'office');
    const lounge = plan.rooms.find((r) => r.kind === 'lounge');
    const spine = plan.rooms.find((r) => r.id === '__spine__');
    if (plan.arrangement === 'two-rows') {
      assert.ok(office.x === 0 && lounge.x === 0, 'both rows start at the building line');
      // The spine runs between the rows, wall to wall, with the reception
      // above it and the lounge below.
      assert.ok(
        Math.abs(spine.y - (office.y + office.h)) < 0.01 &&
          Math.abs(spine.y + spine.h - lounge.y) < 0.01 &&
          Math.abs(spine.w - plan.width) < 0.01,
        'the corridor between the rows does not span between them',
      );
      // And each row fills the width: nothing is left over beside either half.
      const rowEnd = (y, h) =>
        plan.rooms
          .filter((r) => r.y < y + h - 0.01 && r.y + r.h > y + 0.01)
          .reduce((a, r) => Math.max(a, r.x + r.w), 0);
      assert.ok(
        Math.abs(rowEnd(office.y, office.h) - plan.width) < 0.01,
        'row one does not reach the building line',
      );
      assert.ok(
        Math.abs(rowEnd(lounge.y, lounge.h) - plan.width) < 0.01,
        'row two does not reach the building line',
      );
      continue;
    }
    assert.ok(
      Math.abs(office.w - lounge.w) < 0.01,
      `the lounge is ${lounge.w.toFixed(1)} wide and the reception ${office.w.toFixed(1)}`,
    );
    // Nothing sits between the column and the spine.
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

test('no arrangement puts a directory strip on the floor, at any population or shape', () => {
  // WP-60'S DEFECT, STATED AS AN ABSENCE.
  //
  // The strip was honest and it was still clutter. It cost a corner of the
  // building, a column of the envelope search, a step of the fill order and a
  // bound in `plan-units.js`, all to say something the owner wanted only when
  // he went looking for it — "keep less clutter on screen" were his words.
  // What replaces it is a chip in the stage's corner and a popover behind it,
  // which is HTML and costs no floor.
  //
  // Asserted over every population at every shape, because a strip that comes
  // back on one arrangement and not the other is exactly the kind of thing a
  // spot check misses.
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    for (const targetAspect of ASPECTS) {
      const plan = buildPlan(projects, agents, { targetAspect, now: NOW });
      assert.deepEqual(
        plan.rooms.filter((r) => r.kind === 'directory'),
        [],
        `${JSON.stringify(spec)} at ${targetAspect}:1 still draws a strip`,
      );
      // AND NOTHING IS LOST BETWEEN THE FLOOR AND THE LIST. Every repo with
      // sessions is either a room or a line, never both and never neither —
      // the property that makes moving the list off the canvas safe.
      const drawn = new Set(
        plan.rooms.filter((r) => r.kind === 'project').map((r) => String(r.id)),
      );
      const listed = new Set(idleProjectsOf({ projects, agents }).map((e) => e.id));
      for (const id of drawn) {
        assert.ok(!listed.has(id), `${id} is both a room and an idle line`);
      }
      for (const project of projects) {
        const id = String(project.id);
        if ((project.sessionCount ?? 0) <= 0 || project.archived) continue;
        assert.ok(
          drawn.has(id) || listed.has(id),
          `${JSON.stringify(spec)} at ${targetAspect}:1: ${id} is on neither the floor nor the list`,
        );
      }
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

/**
 * The bare-carpet bound in force for one room, and the name of the case
 * (WP-59c).
 *
 * TWO BOUNDS, AND THE TEST SAYS WHICH ONE IT USED. §106's 35% is the bound on
 * a room the plan CHOSE to stretch, and it is untouched. A room the service
 * column stretched — the building is as tall as its lounge, and the rooms
 * beside it are given that height whether their desks want it or not — is held
 * to 45% instead, because the alternative there is not a smaller room: it is
 * the bare open-plan block under it that this package exists to remove, and
 * that block was three times the room's own area on the owner's machine.
 *
 * Ten points, bought for a reason, and spent nowhere else: `columnStretched`
 * is a comparison against `ROOM_HEIGHT_STRETCH_MAX`, which the plan may only
 * pass when the column made it (`fillOrder` in `plan.js`).
 */
function carpetBound(plan) {
  void plan;
  return {
    max: BARE_CARPET_CEILING,
    case: 'WP-60 reports the bare carpet rather than bounding it',
  };
}

/**
 * THE CEILING A ROOM MAY NOT PASS, AND IT IS NOT THE BOUND IT USED TO BE.
 *
 * §106 held a room to 35% bare carpet and WP-59c let the service column push it
 * to 45%, and both were LIMITS: a band of rooms stopped short of its row rather
 * than pass them, and what it did not take was drawn as a bay of open floor.
 * WP-60 takes the limit off the width — a row of rooms fills its row, because a
 * bay is carpet too and carpet nothing can ever be put on, being outside every
 * room — and `plan.working.bareCarpet` reports what that costs.
 *
 * What is left here is a BALLROOM GUARD rather than a bound. It exists because
 * the first cut of WP-60 took the limit off the DEPTH as well, and a column
 * answering a lounge's height with four rooms drew them at 89% bare carpet: a
 * desk in a hall, which is §106's defect rebuilt by the code meant to remove
 * its opposite. The depth kept its bound for that reason, and 45% is what the
 * floors this package measured actually come out at — the worst room over
 * sixteen populations at five aspects and three stages is 44.7%.
 *
 * So it is a number that was MEASURED rather than chosen, and its job is to
 * fail if a later package quietly re-opens the ballroom. Over sixteen
 * populations at five aspects and three stages the worst room comes out at
 * 62.2% — the owner's own shape on a 1.2:1 window, where a room 15.0 x 17.9 U
 * of furniture is laid at 22.8 x 25.5 — and the ceiling is set clear of it.
 *
 * The AREA figure is the harsher of the two ways to say this and the axes are
 * the fairer, which is why both are asserted. 62% bare sounds like a hall; 1.5
 * times the furniture on each axis, with the rug and the planting spread into
 * it, is a room with room to walk round the desks in.
 */
const BARE_CARPET_CEILING = 0.65;

/**
 * How much wider than its furniture a room may be laid.
 *
 * `ROOM_WIDTH_STRETCH_MAX` (1.6) was the BOUND until WP-60 and is now the
 * shape the plan prefers rather than one it enforces: a row shares itself out
 * by occupancy and fills its width, so a busy project takes the width its
 * quiet neighbours did not need. This is the ballroom guard on that axis, and
 * like the one above it is measured — the widest room over the whole matrix is
 * 2.24 times its furniture — rather than chosen.
 *
 * What actually holds the disparity down is `CELL_OCCUPANCY_RATIO_MAX` inside
 * a row; this catches the case where a whole row runs away together.
 */
const ROOM_WIDTH_FILL_MAX = 2.5;

test('the bare carpet is a number the plan reports, and the floor agrees with it', () => {
  // WP-55's acceptance, as a property. Before it, one active project was given
  // the whole working band — an 88 x 67 room holding a two-seat table, 97% of it
  // floor covering — because the envelope was built to the window's shape and
  // the treemap stretched whatever rooms there were to tile the remainder.
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    for (const targetAspect of ASPECTS) {
      const plan = buildPlan(projects, agents, { targetAspect, now: NOW });
      const rooms = plan.rooms.filter((r) => r.kind === 'project');
      for (const room of rooms) {
        const bare = bareCarpet(room);
        const bound = carpetBound(plan);
        assert.ok(
          bare <= bound.max + EPS,
          `${room.id} is ${(bare * 100).toFixed(0)}% bare carpet at ${targetAspect}:1 — ` +
            `${room.w.toFixed(1)}x${room.h.toFixed(1)} for furniture needing ` +
            `${room.natural.w.toFixed(1)}x${room.natural.h.toFixed(1)}, ` +
            `against ${(bound.max * 100).toFixed(0)}% because ${bound.case}`,
        );
      }
      // AND THE PLAN SAYS THE SAME NUMBER. `plan.working.bareCarpet` is a
      // RECORD, like `plan.working.open` before it, and it is re-derived here
      // rather than trusted: a plan that could report a well-furnished floor
      // while drawing an empty one would be a worse defect than the bound this
      // package removed. It is now the only thing standing where that bound
      // was, so it has to be true.
      const worst = rooms.length ? Math.max(...rooms.map(bareCarpet)) : 0;
      assert.ok(
        Math.abs(plan.working.bareCarpet - worst) < 1e-6,
        `${JSON.stringify(spec)} at ${targetAspect}:1: the plan reports ` +
          `${(plan.working.bareCarpet * 100).toFixed(1)}% bare carpet and drew ` +
          `${(worst * 100).toFixed(1)}%`,
      );
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
    many.width > one.width * 1.3,
    `six projects (${many.width.toFixed(0)} U) should make a much wider building than one (${one.width.toFixed(0)} U)`,
  );
  // WP-59 moved this number from 1.4 to 1.3 and it is worth saying why, because
  // the direction is the opposite of the one §106 was defending. A floor with
  // one room now spends what a wide window offers on its service column and on
  // open plan rather than leaving it as ground, so the SMALL floor got wider —
  // not the large one. What §106's rule is actually about is the rooms, and
  // that is unchanged and asserted here directly: the six-project floor has six
  // rooms' worth of rooms in it.
  const roomArea = (plan) =>
    plan.rooms.filter((r) => r.kind === 'project').reduce((a, r) => a + r.w * r.h, 0);
  assert.ok(
    roomArea(many) > roomArea(one) * 4,
    `six project rooms (${roomArea(many).toFixed(0)} U²) should hold far more than one (${roomArea(one).toFixed(0)} U²)`,
  );

  // And the envelope really is the sum: the working side is exactly what is
  // left after the service rooms and the corridor between them.
  for (const plan of [one, many]) {
    const office = plan.rooms.find((r) => r.kind === 'office');
    const spine = plan.rooms.find((r) => r.id === '__spine__');
    const x = plan.working.x;
    const right = plan.rooms
      .filter((r) => r.x >= x - 0.01)
      .reduce((a, r) => Math.max(a, r.x + r.w), x);
    assert.ok(
      plan.arrangement === 'two-rows'
        ? Math.abs(x - office.w) < 0.01
        : Math.abs(spine.x - office.w) < 0.01 && Math.abs(x - (spine.x + spine.w)) < 0.01,
      'the working side does not start where the service rooms end',
    );
    assert.ok(
      Math.abs(right - plan.width) < 0.01,
      'the working side reaches the building line exactly',
    );
  }
});

// ---------------------------------- WP-59: the building fills the window

/**
 * Can this floor's contents be the shape of this stage at all?
 *
 * The question the plan is asked, stated so the test can ask it too rather
 * than trust the answer. To be the stage's shape at the height it came out,
 * the envelope would have to be `H * stageAspect` wide; the rooms it holds
 * would then cover `roomsArea / (W * H)` of it, and everything else would be
 * open floor. Under `1 - FLOOR_OPEN_MAX` that arrangement is a hangar and the
 * plan is right to refuse it — a reception, a lounge and one two-desk room
 * cannot fill a 2560 x 1440 window however they are laid out, and pretending
 * otherwise is the bare-carpet defect §106 removed, one level up.
 *
 * Conservative on purpose: it is a necessary condition, not a sufficient one,
 * so a floor it exempts might still have had an arrangement. Every population
 * that is NOT exempt is held to the fill target exactly.
 */
function couldTakeShape(plan, stageAspect) {
  const wantW = plan.height * stageAspect;
  if (plan.width >= wantW - 0.01) return true;
  const roomsArea = plan.rooms
    .filter((r) => r.kind !== 'corridor')
    .reduce((a, r) => a + honestArea(r), 0);
  if (roomsArea / Math.max(1e-6, wantW * plan.height) < 1 - FLOOR_OPEN_MAX) return false;
  // AND THE WIDTH HAS TO COME FROM SOMEWHERE (WP-59c). The envelope is the
  // service column, the spine and the working side, and the working side is
  // exactly as wide as its rooms ask for — no candidate in the search pads it,
  // because padding it is the empty lot §140 removed. So there is exactly ONE
  // lever on the width: the column, which stops at `OFFICE_MAX_W`. A floor
  // holding it at its stop is as wide as it will ever be, whatever its area
  // says.
  //
  // There were TWO until WP-60. The other was the idle strip's column count —
  // a seventeen-line board laid three columns across is a wider working side
  // than the same board laid one — and a floor with no idle repos simply did
  // not have it. With the strip gone no floor does, which makes this condition
  // strictly tighter than it was: fewer floors are exempt, and none that was
  // held to the target before is exempt now.
  //
  // Latent until this package: WP-59c makes the building SHORTER — the rooms
  // grow into the column's height and the lounge comes down to meet them — so
  // `wantW` shrinks with it and floors that used to be exempt on area alone
  // stopped being, while being no wider and no better shaped than before.
  const office = plan.rooms.find((r) => r.kind === 'office');
  // The reception's stop is `OFFICE_MAX_W` in a column and, in a row, that
  // plus a seat pitch a head for the queue whose sofas run along its width
  // (WP-59d, `searchRows`). Re-derived here rather than read off the plan:
  // `plan.officeSeats.length` IS the queue. The row cap is not on the ladder —
  // the search walks widths in `SERVICE_W_STEP` from `OFFICE_MIN_W` — so what
  // "at its stop" means there is that there was no next rung inside it.
  const cap =
    plan.arrangement === 'two-rows'
      ? OFFICE_MAX_W + plan.officeSeats.length * OFFICE_SEAT_PITCH - SERVICE_W_STEP
      : OFFICE_MAX_W;
  return !office || office.w < cap - 0.01;
}

/**
 * The floor a room could honestly have had in ANY arrangement (WP-59c).
 *
 * `couldTakeShape` asks whether this floor's contents could have covered a
 * stage-shaped envelope, and the answer has to be about the CONTENTS rather
 * than about the arrangement they happen to be in. WP-59c lets a project room
 * be stretched past `ROOM_FILL_MAX` by the service column beside it — floor it
 * takes because the building is that tall, not floor its furniture earned —
 * and counting that as coverage says a one-room floor could have filled a
 * 1.60:1 window because the room it could not widen got deeper. Capped at what
 * the room may have where the plan is free to choose, which is exactly the
 * area every room had before this package and leaves the exemption where §139
 * measured it.
 */
function honestArea(room) {
  const area = room.w * room.h;
  if (!room.natural) return area;
  // A project room may honestly be `ROOM_FILL_MAX` over its furniture wherever
  // the plan is free to choose. The lounge may not be over its own contents at
  // all: it is padded to whatever the column has left after the reception, and
  // that padding is open lounge floor rather than more lounge.
  const needs = room.natural.w * room.natural.h * (room.kind === 'project' ? ROOM_FILL_MAX : 1);
  return Math.min(area, needs);
}

/**
 * Did the SERVICE COLUMN stretch this plan's rooms — step (a) of WP-59c's fill
 * order — and which bare-carpet bound does that put them under?
 *
 * The plan's own record, because it is the only place that knows: a room 1.54x
 * its natural depth is inside `ROOM_HEIGHT_STRETCH_MAX` and still past
 * `ROOM_FILL_MAX`, so the geometry alone cannot tell a column-forced stretch
 * from a chosen one. What the tests below check instead is that the record and
 * the floor agree — a plan that says it did not stretch its rooms may not have
 * a room past `ROOM_FILL_MAX` in it, and one that says it did must have one.
 */
function columnStretched(plan) {
  return plan.working.roomsStretched === true;
}

/**
 * The bare carpet the PLAN's OWN cap allows a room on this floor.
 *
 * Not the same number as `carpetBound` above, and the difference is the point:
 * that one is the ACCEPTANCE the test holds the picture to, this one is the
 * bound the plan actually lays rooms against, and the plan deliberately keeps
 * a few points in hand under the acceptance (see `ROOM_FILL_MAX`'s note). A
 * room is "at its cap" when it has reached THIS one.
 */
function fillCap(plan) {
  return 1 - 1 / (columnStretched(plan) ? ROOM_FILL_COLUMN_MAX : ROOM_FILL_MAX);
}

/**
 * Is this room DEEPER than the plan would have chosen for it?
 *
 * It used to ask about AREA — "past the floor `ROOM_FILL_MAX` allows" — which
 * was the same question while the only thing that could make a room bigger
 * than its furniture asked for was the service column pushing it deeper. WP-60
 * makes rooms fill their row's WIDTH as well, so area no longer separates the
 * two: a room can be half again its furniture's area purely by being wide,
 * with nothing having stretched its depth at all, and `roomsStretched` is a
 * claim about the DEPTH specifically.
 */
function pastChosenFill(room) {
  return Boolean(room.natural) && room.h > room.natural.h * ROOM_HEIGHT_STRETCH_MAX + 0.01;
}

test('the building is the shape of the window, wherever its contents allow', () => {
  // The first half of WP-59's defect. §106 summed the envelope from its rooms
  // and spent the stage's shape only on the band count and the service
  // column's width — two choices a floor with one active repo does not have —
  // so the reference machine came out 57 x 55 U (1.04:1) whatever window it was
  // drawn in, and 45% of a 1920 x 1080 stage was dark ground.
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    for (const [stageW, stageH] of STAGES) {
      const stageAspect = computeTargetAspect(stageW, stageH);
      const plan = buildPlan(projects, agents, {
        stage: { w: stageW, h: stageH },
        now: NOW,
      });
      if (!couldTakeShape(plan, stageAspect)) continue;
      const aspect = plan.width / plan.height;
      const off = Math.abs(Math.log(aspect / stageAspect));
      assert.ok(
        off <= Math.log(1 + ASPECT_TOLERANCE) + EPS,
        `${JSON.stringify(spec)} at ${stageW}x${stageH}: the building is ${aspect.toFixed(2)}:1 ` +
          `on a ${stageAspect.toFixed(2)}:1 stage, ${((Math.exp(off) - 1) * 100).toFixed(0)}% off`,
      );
    }
  }
});

test('the building fills the window, and the ground is a margin rather than a mat', () => {
  // The second half. WP-55 stopped the fit at a 44 px character, so even a
  // floor of the right shape stopped growing at two thirds of a 2560 x 1440
  // stage. The cap is 72 px now and the acceptance is stated on the picture
  // rather than on the body: what fraction of the window the building covers.
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    for (const [stageW, stageH] of STAGES) {
      const stageAspect = computeTargetAspect(stageW, stageH);
      const plan = buildPlan(projects, agents, {
        stage: { w: stageW, h: stageH },
        now: NOW,
      });
      const fill = computeFill(plan.width, plan.height, stageW, stageH);
      // Past the cap the floor stops growing on purpose and the rest of the
      // window is the studio ground the building stands on (`05` §2.2).
      if (fill.capped) continue;
      // Every real stage is landscape, so the shorter side is the height.
      const short = stageW >= stageH ? fill.coverH : fill.coverW;
      const long = stageW >= stageH ? fill.coverW : fill.coverH;
      const where = `${JSON.stringify(spec)} at ${stageW}x${stageH}`;
      assert.ok(
        short >= FILL_MIN_SHORT - EPS,
        `${where}: the building covers ${(short * 100).toFixed(0)}% of the short side`,
      );
      // The margin is the fill target said the other way round, and it is the
      // one the eye actually reads: a band of ground down one side.
      assert.ok(
        (1 - short) / 2 <= GROUND_MARGIN_MAX + EPS,
        `${where}: ${(((1 - short) / 2) * 100).toFixed(0)}% of ground per side on the short axis`,
      );
      if (!couldTakeShape(plan, stageAspect)) continue;
      assert.ok(
        long >= FILL_MIN_LONG - EPS,
        `${where}: the building covers ${(long * 100).toFixed(0)}% of the long side`,
      );
    }
  }
});

test('a room is never given floor to chase the shape of a window', () => {
  // The bound that keeps the two halves above honest. Widening the envelope is
  // allowed to spend the strip's columns, the service column's width and open
  // plan; it is NOT allowed to spend a room, which is where §106 found the
  // defect in the first place. `no room is more than 35% bare carpet` above
  // states the area bound over every aspect; this states the axis bounds over
  // every STAGE, which is the case WP-59 introduced.
  //
  // BOTH axes since WP-59b, because a room may now grow into its cell on both:
  // WP-59's band could only ever be laid at `BAND_STRETCH_MAX`, so the depth
  // was bounded by a constant rather than by a rule about rooms and the width
  // bound was the whole of the story. It is not any more.
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    for (const [stageW, stageH] of STAGES) {
      const plan = buildPlan(projects, agents, { stage: { w: stageW, h: stageH }, now: NOW });
      for (const room of plan.rooms) {
        if (room.kind !== 'project' || !room.natural) continue;
        // THE WIDTH BOUND IS GONE (WP-60), and what replaced it is above: the
        // row is shared by occupancy so the extra width goes where the people
        // are, and `CELL_OCCUPANCY_RATIO_MAX` keeps the widest cell in a row
        // within three of the narrowest. A room may be as wide as its share of
        // its row; what it may not be is a room its neighbours cannot match.
        //
        // The DEPTH bound is untouched, and is the one axis WP-59c may pass —
        // only where the service column made it pass. A room deeper than 1.6x
        // its furniture is a room that would otherwise have had a bare block
        // under it, and what holds it in instead is the area, `carpetBound`
        // below.
        assert.ok(
          room.h <= room.natural.h * ROOM_HEIGHT_STRETCH_MAX + EPS ||
            plan.working.roomsStretched === true,
          `${room.id} at ${stageW}x${stageH} is ${room.h.toFixed(1)} U deep for furniture ` +
            `needing ${room.natural.h.toFixed(1)} U, and the plan does not say the column ` +
            `made it so`,
        );
        assert.ok(
          room.w <= room.natural.w * ROOM_WIDTH_FILL_MAX + EPS,
          `${room.id} at ${stageW}x${stageH} is ${room.w.toFixed(1)} U wide for furniture ` +
            `needing ${room.natural.w.toFixed(1)} U — a room that wide is a hall`,
        );
        const bound = carpetBound(plan);
        assert.ok(
          bareCarpet(room) <= bound.max + EPS,
          `${room.id} at ${stageW}x${stageH} is ${(bareCarpet(room) * 100).toFixed(0)}% bare ` +
            `carpet against ${(bound.max * 100).toFixed(0)}% because ${bound.case}`,
        );
      }
      // And the open floor it does spend stays inside its budget.
      const open = plan.rooms
        .filter((r) => r.kind === 'corridor' && r.thoroughfare === false)
        .reduce((a, r) => a + r.w * r.h, 0);
      const share = open / (plan.width * plan.height);
      assert.ok(
        share <= FLOOR_OPEN_MAX + EPS,
        `${JSON.stringify(spec)} at ${stageW}x${stageH}: ${(share * 100).toFixed(0)}% ` +
          `of the floor is open floor nobody stands on`,
      );
    }
  }
});

// --------------------------- WP-59b: the rows are full, and they are rows

/**
 * The rows of rooms on the working side, and the rectangle each was laid in.
 *
 * A band is one row of project rooms: same top edge, same depth, sharing their
 * walls. The rectangle it was laid in is the WHOLE WIDTH of the working side at
 * that depth — which is the point, because what is measured below is the part
 * of that rectangle the rooms did not take.
 *
 * @param {import('../../public/render/plan.js').Plan} plan
 */
function roomBands(plan) {
  // The rectangle the rooms are laid in: everything right of the spine in a
  // column, and everything right of the reception in row one of a two-row plan
  // (WP-59d). `plan.working` records both, and `workingSide` below re-derives
  // it from the drawn floor rather than trusting it.
  const workingW = plan.working.w;
  /** @type {Map<string, {y:number, h:number, rooms:object[]}>} */
  const byRow = new Map();
  for (const room of plan.rooms) {
    if (room.kind !== 'project') continue;
    const key = `${room.y.toFixed(2)}|${room.h.toFixed(2)}`;
    const band = byRow.get(key) ?? { y: room.y, h: room.h, rooms: [] };
    band.rooms.push(room);
    byRow.set(key, band);
  }
  return { workingW, bands: [...byRow.values()] };
}

test('a row of rooms fills its band, or every room in it is already as large as it may be', () => {
  // WP-59b'S DEFECT, STATED DIRECTLY — and stated on the BAND rather than on
  // the floor. WP-59 held open floor under 28% of the whole envelope, which
  // the owner's own floor satisfied while drawing its three rooms down the
  // left of a band with the right 55% of it bare: the service column is nearly
  // half of that building and is never open floor, so a working side that was
  // half empty still scored 25% and passed. A bay is read against the ROW it
  // is at the end of, and the budget there is `OPEN_FLOOR_MAX`.
  //
  // The escape clause is the other half of the rule rather than a weakening of
  // it. A band holding one twenty-one desk project cannot fill a working side
  // as wide as three one-desk rooms need, because `ROOM_FILL_MAX` will not let
  // that one room have the floor — and giving it the floor anyway is exactly
  // the bare-carpet defect §106 removed. So a band is either FULL or its rooms
  // are at their cap, and there is no third answer in which a row is short of
  // rooms and the plan pretends otherwise.
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    for (const [stageW, stageH] of STAGES) {
      const plan = buildPlan(projects, agents, { stage: { w: stageW, h: stageH }, now: NOW });
      const { workingW, bands } = roomBands(plan);
      for (const band of bands) {
        const taken = band.rooms.reduce((a, r) => a + r.w * r.h, 0);
        const open = 1 - taken / Math.max(1e-6, workingW * band.h);
        if (open <= OPEN_FLOOR_MAX + EPS) continue;
        // ONE room at its cap stops the row, because `ROOM_FILL_MAX` binds on
        // the SHALLOWEST room in it: every cell is the row's depth, so the
        // shallowest room is the furthest past what its furniture needs before
        // any width has been shared out, and it is the one that decides how
        // wide the row may honestly be laid. Its deeper neighbours are then
        // under-filled by exactly as much as they are deeper.
        const capped = band.rooms.some(
          (room) =>
            bareCarpet(room) >= 0.29 || room.w >= room.natural.w * ROOM_WIDTH_STRETCH_MAX - EPS,
        );
        assert.ok(
          capped,
          `${JSON.stringify(spec)} at ${stageW}x${stageH}: the band at y=${band.y.toFixed(1)} ` +
            `is ${(open * 100).toFixed(0)}% open floor and no room in it is at its cap — ` +
            `they could have had the floor`,
        );
      }
    }
  }
});

test('the working side is the wider half once it holds three rooms', () => {
  // WP-59b. The envelope search likes the service column, because a WIDER
  // column is a SHORTER one and therefore a wider building — which is how the
  // owner's floor came out with a 46 U reception-and-lounge column beside 46 U
  // of working side holding three active repos, at 65% of his window.
  //
  // THE BOUND IS SAID AT THREE ROOMS, AND THAT IS AN HONEST LIMIT RATHER THAN
  // A CONVENIENT ONE. `SERVICE_COLUMN_MAX` ranks below the window's shape in
  // the search (see `better` in `plan.js`, which says why and what ranking it
  // higher measured), so on a floor whose service side genuinely holds more
  // furniture than its working side — a reception, a lounge and two small
  // rooms — the column still wins the width, and drawing it otherwise would
  // cost that floor a third of the window. What must hold, and does at every
  // stage, is the case the product is actually about: once there are three
  // rooms with people in them, the rooms are the wider half.
  for (const spec of POPULATIONS) {
    if ((spec.projects ?? []).length < 3) continue;
    const { projects, agents } = floor(spec);
    for (const [stageW, stageH] of STAGES) {
      const plan = buildPlan(projects, agents, { stage: { w: stageW, h: stageH }, now: NOW });
      const office = plan.rooms.find((r) => r.kind === 'office');
      const lounge = plan.rooms.find((r) => r.kind === 'lounge');
      const where = `${JSON.stringify(spec)} at ${stageW}x${stageH}`;
      // IN TWO ROWS THE COMPARISON IS AN AREA (WP-59d), because the service
      // rooms are the ends of two rows rather than one full-height column and
      // a width no longer stands for either of them. Same sentence, same
      // bound: the rooms with people in them are the subject of the floor.
      if (plan.arrangement === 'two-rows') {
        // IN A ROW THE COMPARISON IS ROW ONE'S (WP-59d). The lounge is UNDER
        // the rooms and takes nothing from them; what can crowd them is the
        // reception beside them, and the bound on that is the same
        // `SERVICE_COLUMN_MAX`, measured the same way — a share of the width
        // they are laid across.
        assert.ok(
          plan.width - office.w > office.w,
          `${where}: ${(plan.width - office.w).toFixed(1)} U of rooms beside a ` +
            `${office.w.toFixed(1)} U reception`,
        );
        // HALF, not `SERVICE_COLUMN_MAX`, and the difference is what is being
        // measured. That constant is stated on a COLUMN — the office and the
        // lounge together, down the side of the rooms — and a row's reception
        // is one of those two. Held to 40% instead of to half, the owner's own
        // floor could not reach the shape of his window: the width was there,
        // in a reception 46% of a row whose rooms were still the wider half.
        assert.ok(
          office.w < plan.width / 2,
          `${where}: the reception is ${((office.w / plan.width) * 100).toFixed(0)}% of its row`,
        );
        // AND ROW TWO IS THE LOUNGE, wall to wall (WP-60). It used to share
        // the row with the idle strip, and the assertion here was that the
        // strip could not take the larger half; with the strip gone the
        // stronger statement is true and is the one worth holding — a row
        // whose only room stops short of its width is a corner of open floor
        // that nothing on the working side can reach.
        assert.ok(
          Math.abs(lounge.w - plan.width) < 0.01,
          `${where}: the lounge is ${lounge.w.toFixed(1)} U of a ${plan.width.toFixed(1)} U row`,
        );
        continue;
      }
      const workingW = plan.width - plan.working.x;
      assert.ok(
        workingW > office.w,
        `${where}: ${workingW.toFixed(1)} U of working side beside a ` +
          `${office.w.toFixed(1)} U service column`,
      );
      // And the column stays under its own bound wherever the shape allowed
      // the search to hold it there, which is what `SERVICE_COLUMN_MAX` is.
      // Stated as a note on the number rather than as a second assertion: a
      // floor of one twenty-one desk project and three one-desk ones lands at
      // 43%, because the alternative column is 8 units narrower and 14 taller.
      assert.ok(
        office.w / plan.width <= SERVICE_COLUMN_MAX + 0.05,
        `${where}: the service column is ` +
          `${((office.w / plan.width) * 100).toFixed(0)}% of the building`,
      );
    }
  }
});

test('the open floor is under the rooms, never between them and a wall', () => {
  // WP-59b. The open plan a working side cannot fill is a MARGIN under its
  // content, not a hole in the middle of it. The strip used to be the second
  // piece of content this had to order — it was pinned to the building's
  // bottom edge, and WP-59's open band then opened up BETWEEN the rooms and
  // the strip, so the two sat at opposite ends with a gap between them — and
  // WP-60 removed the strip, which leaves the plainer half of the same rule:
  // whatever the rooms did not need starts where the rooms stop.
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    for (const [stageW, stageH] of STAGES) {
      const plan = buildPlan(projects, agents, { stage: { w: stageW, h: stageH }, now: NOW });
      const where = `${JSON.stringify(spec)} at ${stageW}x${stageH}`;
      const rooms = plan.rooms.filter((r) => r.kind === 'project');
      if (!rooms.length) continue;
      const top = rooms.reduce((a, r) => Math.min(a, r.y), Infinity);
      const bottom = rooms.reduce((a, r) => Math.max(a, r.y + r.h), 0);
      for (const open of plan.rooms.filter((r) => r.id.startsWith('__open'))) {
        assert.ok(
          open.y >= bottom - 0.01 || open.y + open.h <= top + 0.01,
          `${where}: open floor at y=${open.y.toFixed(1)} sits inside the band of rooms ` +
            `(${top.toFixed(1)}..${bottom.toFixed(1)}) rather than under it`,
        );
      }
    }
  }
});

// ------------------------------- WP-55: the header describes what is drawn

// ----------------------------- WP-59c: the working side fills its own height

/**
 * The working side, measured from the floor that was actually drawn.
 *
 * `plan.working` says the same things, and this is the second opinion: a plan
 * that could report a full working side while drawing an empty one would be a
 * worse defect than the one WP-59c fixes, so nothing below trusts it.
 *
 * @param {import('../../public/render/plan.js').Plan} plan
 */
function workingSide(plan) {
  const rooms = plan.rooms.filter((r) => r.kind === 'project');
  const taken = rooms.reduce((a, r) => a + r.w * r.h, 0);
  if (plan.arrangement === 'two-rows') {
    // ROW ONE (WP-59d, narrowed by WP-60). The rooms take the part of row one
    // beside the reception, and that is the whole of the working side: row two
    // used to hold the idle strip in its right-hand corner, so it was a second
    // place content had to be measured against, and with the strip gone the
    // lounge IS row two. Derived from the rooms that were DRAWN — the corridor
    // between the rows is the row divide, and the row's own rectangle is what
    // its content is measured against.
    const spine = plan.rooms.find((r) => r.id === '__spine__');
    const office = plan.rooms.find((r) => r.kind === 'office');
    const x = office.x + office.w;
    const w = Math.max(0, plan.width - x);
    const area = w * office.h;
    return { x, w, rooms, area, spine, open: area > 1e-6 ? Math.max(0, (area - taken) / area) : 0 };
  }
  const spine = plan.rooms.find((r) => r.id === '__spine__');
  const x = spine ? spine.x + spine.w : 0;
  const w = Math.max(0, plan.width - x);
  const area = w * plan.height;
  return { x, w, rooms, area, spine, open: area > 1e-6 ? Math.max(0, (area - taken) / area) : 0 };
}

test('the working side is filled, or everything on it is already as large as it may be', () => {
  // WP-59c'S DEFECT, STATED DIRECTLY. §139 bounded the open floor over the
  // whole envelope and §140 over a ROW of rooms, and the owner's own machine
  // satisfied both while drawing three rooms across the top of the working
  // side, the idle strip under them, and the bottom two fifths of the building
  // as one bare open-plan block — because the service column sets the height
  // and nothing on the working side grew to meet it. He called it "not full
  // screen wide and very cramped".
  //
  // So the budget is stated on the side it is on. And the escape clause is the
  // other half of the rule rather than a weakening of it, exactly as §140's
  // was: the plan is allowed to leave open floor only once every lever it has
  // is at its stop. Four levers, in the order the plan pulls them:
  //
  //   (a) the rooms are at their bare-carpet cap, or as wide as they may be;
  //   (b) the lounge is at its densest, or has nobody in it to pack;
  //   (c) and only what is left is open plan.
  //
  // There were four until WP-60. Between (a) and (b) stood the idle strip,
  // which spent some of the column's height by standing its lines up into a
  // taller board. It is off the floor now, and the shorter order is the whole
  // of the change: the rooms take the height, and what they cannot take is
  // open plan.
  //
  // A floor that fails this is a floor with a lever still up, and there is no
  // third answer in which the working side is half empty and the plan had
  // nothing it could have done about it.
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    for (const [stageW, stageH] of STAGES) {
      const plan = buildPlan(projects, agents, { stage: { w: stageW, h: stageH }, now: NOW });
      const side = workingSide(plan);
      const where = `${JSON.stringify(spec)} at ${stageW}x${stageH}`;
      // First: the plan's own record of the fill order is the floor it drew.
      assert.ok(
        Math.abs(side.open - plan.working.open) < 1e-6 && Math.abs(side.w - plan.working.w) < 0.01,
        `${where}: the plan reports a working side ${plan.working.w.toFixed(1)} U wide and ` +
          `${(plan.working.open * 100).toFixed(0)}% open, and drew one ${side.w.toFixed(1)} U ` +
          `wide and ${(side.open * 100).toFixed(0)}% open`,
      );
      // THE RECORD AND THE FLOOR AGREE, IN THE DIRECTION THAT PROTECTS. A plan
      // that says it did not stretch its rooms may not have a room deeper than
      // `ROOM_HEIGHT_STRETCH_MAX` in it.
      //
      // WP-59c asserted the converse too — a plan that says it DID must have
      // one — because the flag chose between two bare-carpet bounds, and a flag
      // that can be raised for nothing is a bound that can be bought for
      // nothing. WP-60 leaves one ceiling and no choice, so the flag no longer
      // buys anything, and the converse stopped being true for an honest
      // reason: in two rows the depth is the RECEPTION's, so a floor whose
      // reception is deeper than its rooms wanted is stretched by any
      // reasonable reading while every room in it is still inside 1.6x its
      // furniture. Asserting a flag nobody acts on, in a direction it is not
      // true, is how a test comes to describe the code instead of the picture.
      const past = side.rooms.filter(pastChosenFill);
      assert.ok(
        plan.working.roomsStretched || past.length === 0,
        `${where}: the plan says nothing stretched its rooms, and ${past.length} of ` +
          `${side.rooms.length} are deeper than the plan would have chosen`,
      );
      if (side.area <= 1e-6 || side.open <= WORKING_OPEN_MAX + EPS) continue;

      // ONE ESCAPE, AND IT IS THE ONE §142 ALREADY NAMED (WP-60).
      //
      // The old clause list — a room at its bare-carpet cap, the strip on its
      // last rung, the lounge at its densest — was written while those were the
      // levers. WP-60 removed two of them (the strip is off the floor, and the
      // bare-carpet cap is reported rather than enforced on the width), and the
      // measurement it left behind is much starker than the list was: over
      // sixteen populations at three stages, EVERY floor whose rooms stand in
      // one band comes out at 0% open, and the only two above the budget are
      // the two whose rooms will not stand in one band at all.
      //
      // That is not a coincidence and it is not a gap. `plan-rows.js` refuses
      // the second arrangement to exactly those floors — a room much shallower
      // than the one it would share a row with is the bare-carpet defect one
      // level down (`HEIGHT_BAND_RATIO`), and a building wide enough for twelve
      // rooms in one row is nowhere near the shape of any window — so they can
      // only be laid as a column. And §141 proved by arithmetic that a column
      // cannot fill itself: the reception over a lounge holding twenty-three
      // benched agents is seventy units tall, and nothing that can be done to
      // the rooms closes that gap without turning them into halls.
      //
      // So the escape is stated as the refusal that causes it, and the floors
      // it lets through must still be at their depth ceiling — a column that
      // has NOT spent the depth it may honestly spend has a lever up, and that
      // is still a failure.
      const bands = new Set(side.rooms.map((r) => Math.round(r.y * 100)));
      assert.ok(
        bands.size > 1,
        `${where}: the working side is ${(side.open * 100).toFixed(0)}% open with its rooms ` +
          `in one band — a floor that can be folded has no excuse for open plan`,
      );
      const cap = fillCap(plan);
      const atCap = side.rooms.some((r) => bareCarpet(r) >= cap - 0.005);
      assert.ok(
        atCap,
        `${where}: the working side is ${(side.open * 100).toFixed(0)}% open, its rooms cannot ` +
          `be folded into one row, and none of them is at its depth cap ` +
          `(${side.rooms
            .map((r) => `${r.id} ${(bareCarpet(r) * 100).toFixed(0)}%`)
            .join(', ')} against ${(cap * 100).toFixed(0)}%) — they could have had the floor`,
      );
      // AND THE LOUNGE CAME DOWN TO MEET THEM, or there is nobody in it to
      // pack, or the building is ALREADY the shape of the window — which is the
      // one thing ranked above the fill (see `better` in `plan.js`). A denser
      // lounge is a shorter column and therefore a wider building, and past the
      // shape that is a floor bought with the window, the regression §139
      // exists to have fixed. What may never happen is both levers up at once:
      // a working side that is short, a lounge that is loose, and a building
      // that is not the window's shape either.
      const benched = plan.loungeSpots.length > 0 && counts(agents, { now: NOW }).benched > 0;
      const onShape =
        Math.abs(Math.log(plan.width / plan.height / computeTargetAspect(stageW, stageH))) <=
        Math.log(1 + ASPECT_SETTLE) + EPS;
      assert.ok(
        !benched ||
          onShape ||
          plan.working.loungePack <= LOUNGE_PACKS[LOUNGE_PACKS.length - 1] + 1e-9,
        `${where}: the working side is ${(side.open * 100).toFixed(0)}% open, the lounge is ` +
          `laid at ${plan.working.loungePack} and the building is ` +
          `${(plan.width / plan.height).toFixed(2)}:1 — it could have come down to meet it`,
      );
    }
  }
});

test('a row of rooms fills its band edge to edge, and the busy room is the wide one', () => {
  // WP-60'S OTHER HALF, AND THE OWNER'S OTHER SENTENCE: "remaining project room
  // size make it dynamic and full size for live projects".
  //
  // Two properties, and they are two halves of one picture. A row of rooms
  // TILES its band — no bay at the end, which is open floor that is not even
  // inside a room and so can never have anything put on it — and the width is
  // shared by OCCUPANCY, so the room where the work is happening is visibly the
  // big one. On his floor before this package, a twenty-four session project
  // and three one-session ones were drawn as four cells of the same width,
  // because the row was shared out by what each room's furniture measured and a
  // one-desk room's furniture is very nearly a twenty-four-desk room's once
  // both have a rug, a board and their planting.
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    for (const [stageW, stageH] of STAGES) {
      const plan = buildPlan(projects, agents, { stage: { w: stageW, h: stageH }, now: NOW });
      const where = `${JSON.stringify(spec)} at ${stageW}x${stageH}`;
      const rooms = plan.rooms.filter((r) => r.kind === 'project');
      if (!rooms.length) continue;

      // NO BAY. The corridors the plan draws beside a band are named, so this
      // asks the floor rather than inferring: `__bay-N__` is the dead end at
      // the end of a row that its rooms did not fill, and there are none now.
      const bays = plan.rooms.filter((r) => r.id.startsWith('__bay-'));
      assert.deepEqual(
        bays.map((r) => r.id),
        [],
        `${where}: ${bays.length} bay(s) of open floor at the end of a row of rooms`,
      );

      // Group the rooms into the bands they were actually drawn in, and check
      // each band is tiled: every room the band's full depth, adjacent rooms
      // sharing a wall, and the row as wide as the widest band on the floor.
      /** @type {Map<number, typeof rooms>} */
      const bands = new Map();
      for (const room of rooms) {
        const key = Math.round(room.y * 100);
        if (!bands.has(key)) bands.set(key, []);
        bands.get(key).push(room);
      }
      const spans = [...bands.values()].map((band) => {
        band.sort((a, b) => a.x - b.x);
        return band[band.length - 1].x + band[band.length - 1].w - band[0].x;
      });
      const widest = Math.max(...spans);

      for (const band of bands.values()) {
        const span = band[band.length - 1].x + band[band.length - 1].w - band[0].x;
        const taken = band.reduce((a, r) => a + r.w * r.h, 0);
        const depth = Math.max(...band.map((r) => r.h));

        // EVERY CELL IS FULL. The rooms ARE their cells — `buildPlan` assigns
        // `room.w = cell.w` — so what this actually catches is a seam: two
        // rooms that were supposed to share a wall and do not, which is a
        // sliver of floor between them that belongs to nobody.
        const fill = taken / Math.max(1e-6, span * depth);
        assert.ok(
          fill >= 0.8,
          `${where}: the band at y=${(band[0].y || 0).toFixed(1)} is ${(fill * 100).toFixed(0)}% ` +
            `full — its rooms do not tile it`,
        );
        for (let k = 1; k < band.length; k++) {
          assert.ok(
            Math.abs(band[k].x - (band[k - 1].x + band[k - 1].w)) < 0.01,
            `${where}: ${band[k - 1].id} and ${band[k].id} do not share a wall`,
          );
        }
        // AND EVERY BAND REACHES AS FAR ACROSS AS THE WIDEST DOES. A short row
        // beside a long one is §140's empty lot, and it is the thing the fill
        // rule could otherwise buy its tidiness with.
        assert.ok(
          span >= widest - 0.01,
          `${where}: a band spans ${span.toFixed(1)} U beside one spanning ${widest.toFixed(1)} U`,
        );
      }

      // THE BUSY ROOM IS THE WIDE ONE. Stated as an ordering rather than as a
      // ratio, because the ratio is `CELL_OCCUPANCY_RATIO_MAX`'s to hold and
      // this is what a person actually reads off the floor: within one band, a
      // room with more in it is never NARROWER than one with less.
      //
      // MEASURED AGAINST THE SESSION COUNT, which is the number written on the
      // room's own door plate. It is deliberately not the desk count: on the
      // owner's machine every active repo had exactly one agent at a desk and
      // the rest finished or benched, so dealt by desks the row came out as
      // four equal cells with `24 sessions` on the first plate and `4 sessions`
      // on the last — the floor saying one thing and its own labels another.
      const sessions = new Map(projects.map((p) => [String(p.id), p.sessionCount ?? 0]));
      for (const band of bands.values()) {
        for (const a of band) {
          for (const b of band) {
            const sa = sessions.get(String(a.id)) ?? 0;
            const sb = sessions.get(String(b.id)) ?? 0;
            if (sa <= sb) continue;
            assert.ok(
              a.w >= b.w - 0.01,
              `${where}: ${a.id} has ${sa} sessions in ${a.w.toFixed(1)} U and ${b.id} has ` +
                `${sb} in ${b.w.toFixed(1)} U — the busier room is the narrower one`,
            );
          }
        }
      }
    }
  }
});

test('nothing on the working side is drawn outside the room it belongs to', () => {
  // The bound that keeps WP-59c honest in the other direction. A room stretched
  // to meet a service column has wall furniture that grows with it (the board,
  // the shelf) and a rug that grows with it, and a strip standing its lines up
  // has more rows than the board it is drawn on was measured for. Either one
  // running past its own room is a worse picture than the block they exist to
  // remove — and neither is visible in a number, only in the pixels.
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    for (const [stageW, stageH] of STAGES) {
      const plan = buildPlan(projects, agents, { stage: { w: stageW, h: stageH }, now: NOW });
      const where = `${JSON.stringify(spec)} at ${stageW}x${stageH}`;
      for (const room of plan.rooms) {
        // Every room inside the envelope.
        assert.ok(
          room.x >= -EPS &&
            room.y >= -EPS &&
            room.x + room.w <= plan.width + 0.01 &&
            room.y + room.h <= plan.height + 0.01,
          `${where}: ${room.id} runs outside the building`,
        );
        for (const e of room.entries ?? []) {
          assert.ok(
            e.x >= room.x - EPS &&
              e.y >= room.y - EPS &&
              e.x + e.w <= room.x + room.w + 0.01 &&
              e.y + e.h <= room.y + room.h + 0.01,
            `${where}: the strip's line for ${e.id} is drawn outside the strip`,
          );
        }
      }
    }
  }
});

test('no agent is drawn outside the room it stands in, juniors included', () => {
  // WP-59d, AND IT IS THE ONE THE OWNER SAW. §141 added "nothing on the
  // working side is drawn outside the room it belongs to", which is about
  // furniture and about the strip's lines; this is the same sentence about
  // PEOPLE, which is where it was actually being broken. On his own floor a
  // benched senior with sixteen juniors drew them in one row forty units wide
  // along the lounge's bottom wall — sixteen labelled bodies, half of them
  // over the corridor outside the lounge — because WP-41 stood each junior one
  // seat pitch further out than the last and nothing ever asked where the wall
  // was.
  //
  // A JUNIOR'S ROOM IS ITS PARENT'S. That is the whole of WP-41's rule
  // ("a junior is only ever beside its parent") and it is why this cannot be
  // asked of `derivePlacement`, which answers `desk` for a junior standing in
  // a lounge beside a benched senior.
  const PAD = 0.5;
  for (const spec of [...POPULATIONS, JUNIORS]) {
    const { projects, agents } = floor(spec);
    const byId = new Map(agents.map((a) => [a.id, a]));
    for (const [stageW, stageH] of STAGES) {
      const plan = buildPlan(projects, agents, { stage: { w: stageW, h: stageH }, now: NOW });
      const seats = assignSeats(plan, agents);
      const where = `${JSON.stringify(spec)} at ${stageW}x${stageH}`;
      const roomFor = (a) => {
        if (a.subagent === true) {
          const parent = byId.get(String(a.parentId));
          return parent ? roomFor(parent) : null;
        }
        const p = derivePlacement(a);
        if (p === 'desk')
          return plan.rooms.find((r) => r.kind === 'project' && r.id === a.projectId);
        if (p === 'office') return plan.rooms.find((r) => r.kind === 'office');
        return plan.rooms.find((r) => r.kind === 'lounge');
      };
      for (const a of agents) {
        const seat = seats.get(a.id);
        if (!seat) continue; // let go, gone home, or a junior with no parent drawn
        const room = roomFor(a);
        assert.ok(room, `${where}: ${a.id} has a seat and no room`);
        assert.ok(
          seat.x >= room.x - PAD &&
            seat.x <= room.x + room.w + PAD &&
            seat.y >= room.y - PAD &&
            seat.y <= room.y + room.h + PAD,
          `${where}: ${a.id}${a.subagent ? ' (junior)' : ''} stands at ` +
            `${seat.x.toFixed(1)},${seat.y.toFixed(1)}, outside ${room.id} ` +
            `(${room.x.toFixed(1)},${room.y.toFixed(1)} ${room.w.toFixed(1)}x${room.h.toFixed(1)})`,
        );
      }
    }
  }
});

test("the lounge's packed row of juniors is inside the lounge", () => {
  // The same property, stated on the one case it was broken in, so a
  // regression names itself. Sixteen juniors beside a benched senior: they are
  // all drawn, all in the lounge, and no two of them are in the same place.
  const { projects, agents } = floor(JUNIORS);
  for (const [stageW, stageH] of STAGES) {
    const plan = buildPlan(projects, agents, { stage: { w: stageW, h: stageH }, now: NOW });
    const seats = assignSeats(plan, agents);
    const lounge = plan.rooms.find((r) => r.kind === 'lounge');
    const juniors = agents.filter((a) => a.parentId === 'b0');
    assert.equal(juniors.length, 16, 'the fixture has to hold the row that broke');
    const seen = new Set();
    for (const j of juniors) {
      const seat = seats.get(j.id);
      assert.ok(seat, `${j.id} is not drawn at all`);
      assert.ok(
        seat.x >= lounge.x &&
          seat.x <= lounge.x + lounge.w &&
          seat.y >= lounge.y &&
          seat.y <= lounge.y + lounge.h,
        `${j.id} stands at ${seat.x.toFixed(1)},${seat.y.toFixed(1)}, outside the ` +
          `${lounge.w.toFixed(1)}x${lounge.h.toFixed(1)} lounge at ` +
          `${lounge.x.toFixed(1)},${lounge.y.toFixed(1)} (${stageW}x${stageH})`,
      );
      const key = `${seat.x.toFixed(2)}:${seat.y.toFixed(2)}`;
      assert.ok(!seen.has(key), `two juniors are standing at ${key}`);
      seen.add(key);
    }
  }
});

test('the plan says which arrangement it was laid in, and the floor agrees', () => {
  // WP-59d. `plan.arrangement` is a RECORD, like `plan.working` before it, and
  // it is re-derived here rather than trusted: a column has its spine running
  // down between two rooms of one width, and two rows have it running across
  // between a reception above and a lounge below.
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    for (const [stageW, stageH] of STAGES) {
      const plan = buildPlan(projects, agents, { stage: { w: stageW, h: stageH }, now: NOW });
      const where = `${JSON.stringify(spec)} at ${stageW}x${stageH}`;
      assert.ok(
        plan.arrangement === 'column' || plan.arrangement === 'two-rows',
        `${where}: the plan does not say how it was laid`,
      );
      const spine = plan.rooms.find((r) => r.id === '__spine__');
      const office = plan.rooms.find((r) => r.kind === 'office');
      const lounge = plan.rooms.find((r) => r.kind === 'lounge');
      if (plan.arrangement === 'two-rows') {
        assert.ok(spine.w > spine.h, `${where}: a two-row plan's corridor runs across it`);
        assert.ok(office.y < spine.y && lounge.y >= spine.y, `${where}: the rows are not stacked`);
        // And the second arrangement is only ever taken on a wide stage.
        assert.ok(
          plan.targetAspect >= 1.45 - EPS,
          `${where}: a ${plan.targetAspect.toFixed(2)}:1 stage is a column's`,
        );
      } else {
        assert.ok(spine.h >= spine.w, `${where}: a column's corridor runs down it`);
        assert.ok(Math.abs(office.w - lounge.w) < 0.01, `${where}: the column is not one width`);
      }
    }
  }
});

test('the header floor counts equal the plan’s drawn totals', () => {
  // The header and the plan are either side of the static-file boundary and
  // cannot import each other (docs/CONTRACTS.md), so "who is on the floor" is
  // stated twice: `counts().drawn` in `src/core/model.mjs` and `plan.hidden` in
  // `plan.js`. This is the test that stops the two drifting. Before WP-55 they
  // disagreed by nineteen on the reference machine: "21 at desk" over a floor
  // drawing two.
  for (const spec of POPULATIONS) {
    const { projects, agents } = floor(spec);
    const plan = buildPlan(projects, agents, { targetAspect: 1.78, now: NOW });
    const c = counts(agents, { now: NOW, goneHomeDays: GONE_HOME_DAYS });

    const onFloor = (a) => !plan.hidden.has(a.id);
    const desks = agents.filter((a) => derivePlacement(a) === 'desk');
    const benchedAgents = agents.filter((a) => a.ackState === 'benched');

    assert.equal(
      c.drawn.atDesk,
      desks.filter(onFloor).length,
      `"at desk" must be the sessions the floor draws at a desk (${JSON.stringify(spec)})`,
    );
    assert.equal(
      c.drawn.finished,
      desks.filter((a) => !onFloor(a)).length,
      `"finished" must be the desk sessions the floor draws nowhere (${JSON.stringify(spec)})`,
    );
    assert.equal(c.drawn.benched, benchedAgents.filter(onFloor).length);
    assert.equal(c.drawn.wentHome, plan.goneHome.size);
    assert.equal(c.drawn.waiting, plan.officeSeats.length);

    // The lounge plate carries the same two numbers the header does.
    const lounge = plan.rooms.find((r) => r.kind === 'lounge');
    const expected =
      c.drawn.wentHome > 0
        ? `${c.drawn.benched} benched · ${c.drawn.wentHome} went home`
        : `${c.drawn.benched} benched`;
    assert.equal(lounge.plateLines[1], expected);

    // And nobody has been lost: every session is still counted somewhere.
    assert.equal(c.drawn.atDesk + c.drawn.finished, c.atDesk);
    assert.equal(c.drawn.benched + c.drawn.wentHome, c.benched);
    assert.equal(c.atDesk + c.forReview + c.benched + c.letGo, c.total);
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
