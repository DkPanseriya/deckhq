import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  worldToScreen,
  screenToWorld,
  lodForZoom,
  assignSeats,
  planWalk,
  pickNextActivity,
  hashString,
  mulberry32,
  PAIRED_ACTIVITIES,
  ROTATION_MIN_S,
  ROTATION_MAX_S,
} from '../../public/render/agents.js';
// scene.js and rig.js both import cleanly under plain Node — every module in
// their dependency chain (plan.js, backdrop.js, clips.js, palette.js,
// agents.js) is side-effect-free at module scope — so the pure camera/label
// functions they export are reachable here directly, with no DOM. See the
// "note on testing this file" at the bottom of scene.js.
import {
  computeTargetAspect,
  shouldRebuildAspect,
  computeFitScale,
  resolveLabelCollisions,
} from '../../public/render/scene.js';
import { buildPlan } from '../../public/render/plan.js';
import { truncateLabel, labelBox } from '../../public/render/rig.js';

// ------------------------------------------------------- world <-> screen

test('worldToScreen/screenToWorld round-trip exactly across a range of scale multipliers, with non-zero pan', () => {
  const U = 14;
  for (const zoom of [1.0, 1.7, 2.5]) {
    const camera = { zoom, panX: 137.5, panY: -42.25, U };
    for (const point of [
      { x: 0, y: 0 },
      { x: 12.5, y: 30 },
      { x: -8, y: 200.25 },
      { x: 400, y: -75 },
    ]) {
      const screen = worldToScreen(point, camera);
      const back = screenToWorld(screen, camera);
      assert.ok(Math.abs(back.x - point.x) < 1e-9, `x round-trip at zoom ${zoom}`);
      assert.ok(Math.abs(back.y - point.y) < 1e-9, `y round-trip at zoom ${zoom}`);

      const world = screenToWorld(point, camera);
      const backScreen = worldToScreen(world, camera);
      assert.ok(Math.abs(backScreen.x - point.x) < 1e-9, `screen->world->screen x at zoom ${zoom}`);
      assert.ok(Math.abs(backScreen.y - point.y) < 1e-9, `screen->world->screen y at zoom ${zoom}`);
    }
  }
});

// --------------------------------------------------------------------- LOD

test('lodForZoom boundaries (VISUAL-SPEC §1.1)', () => {
  assert.equal(lodForZoom(0.35), 0);
  assert.equal(lodForZoom(0.699), 0);
  assert.equal(lodForZoom(0.7), 1);
  assert.equal(lodForZoom(1.0), 1);
  assert.equal(lodForZoom(1.4), 1);
  assert.equal(lodForZoom(1.400001), 2);
  assert.equal(lodForZoom(2.5), 2);
});

// ------------------------------------------------------------- seat fixture

function makeAgent(id, overrides = {}) {
  return {
    id,
    projectId: 'proj-a',
    activityState: 'working',
    ackState: 'active',
    reviewSince: null,
    ...overrides,
  };
}

function makePlan() {
  const projectSeats = [];
  for (let i = 0; i < 4; i++) projectSeats.push({ x: i, y: 0, angle: 0 });
  const officeSeats = [];
  for (let i = 0; i < 5; i++) officeSeats.push({ x: 0, y: i, angle: Math.PI });
  const loungeSpots = [];
  for (let i = 0; i < 4; i++)
    loungeSpots.push({
      id: `lounge-${i}`,
      kind: 'lounge_idle',
      x: i,
      y: 10,
      angle: 0,
      capacity: 1,
    });
  return {
    width: 200,
    height: 200,
    rooms: [],
    seats: new Map([['proj-a', projectSeats]]),
    officeSeats,
    loungeSpots,
    doors: [],
  };
}

test('assignSeats: stable across two calls with unchanged placement', () => {
  const plan = makePlan();
  const agents = [makeAgent('a1'), makeAgent('a2'), makeAgent('a3')];
  const first = assignSeats(plan, agents);
  const second = assignSeats(plan, agents);
  assert.deepEqual([...first.entries()], [...second.entries()]);
});

test('assignSeats: reassigns when placement changes, leaves the rest untouched', () => {
  const plan = makePlan();
  const agents = [makeAgent('a1'), makeAgent('a2'), makeAgent('a3')];
  const before = assignSeats(plan, agents);

  const benched = agents.map((a) => (a.id === 'a2' ? { ...a, ackState: 'benched' } : a));
  const after = assignSeats(plan, benched);

  // a2 moved from a desk seat to a lounge spot.
  assert.notDeepEqual(before.get('a2'), after.get('a2'));
  assert.ok(plan.loungeSpots.some((s) => s.x === after.get('a2').x && s.y === after.get('a2').y));

  // a1 and a3, whose placement did not change, keep exactly the same seat.
  assert.deepEqual(before.get('a1'), after.get('a1'));
  assert.deepEqual(before.get('a3'), after.get('a3'));
});

test('assignSeats: let_go agents get no seat', () => {
  const plan = makePlan();
  const agents = [makeAgent('a1'), makeAgent('a2', { ackState: 'let_go' })];
  const seats = assignSeats(plan, agents);
  assert.ok(seats.has('a1'));
  assert.ok(!seats.has('a2'));
});

test('assignSeats: office seats ordered oldest reviewSince first, front of queue first', () => {
  const plan = makePlan();
  const agents = [
    makeAgent('newest', { activityState: 'for_review', reviewSince: 3000 }),
    makeAgent('oldest', { activityState: 'for_review', reviewSince: 1000 }),
    makeAgent('middle', { activityState: 'for_review', reviewSince: 2000 }),
  ];
  const seats = assignSeats(plan, agents);
  // officeSeats[i].y === i in the fixture, so the seat's y tells us queue position.
  assert.equal(seats.get('oldest').y, 0);
  assert.equal(seats.get('middle').y, 1);
  assert.equal(seats.get('newest').y, 2);
});

// -------------------------------------------------------------- planWalk

test('planWalk never produces a waypoint inside a wall rectangle (two rooms + an obstacle between them)', () => {
  const source = {
    kind: 'project',
    id: 'src',
    name: 'Source',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    walls: 'partial',
    plateLines: ['', ''],
  };
  const dest = {
    kind: 'project',
    id: 'dst',
    name: 'Dest',
    x: 40,
    y: 0,
    w: 10,
    h: 10,
    walls: 'partial',
    plateLines: ['', ''],
  };
  // Sits directly between them, spanning the straight line from source to dest.
  const obstacle = {
    kind: 'project',
    id: 'wall',
    name: 'Wall',
    x: 20,
    y: -5,
    w: 8,
    h: 20,
    walls: 'full',
    plateLines: ['', ''],
  };
  const rooms = [source, dest, obstacle];

  const from = { x: 5, y: 5, room: source };
  const to = { x: 45, y: 5, room: dest };
  const waypoints = planWalk(from, to, rooms);

  assert.ok(waypoints.length > 0);
  for (const wp of waypoints) {
    for (const rect of [source, dest, obstacle]) {
      const insideX = wp.x > rect.x + 1e-6 && wp.x < rect.x + rect.w - 1e-6;
      const insideY = wp.y > rect.y + 1e-6 && wp.y < rect.y + rect.h - 1e-6;
      const inside = insideX && insideY;
      if (rect.id === 'dst' && wp === waypoints[waypoints.length - 1]) continue; // arrival point is meant to be inside its own room
      assert.ok(!inside, `waypoint (${wp.x}, ${wp.y}) must not be inside room "${rect.id}"`);
    }
  }
  // Final waypoint is the destination itself.
  const last = waypoints[waypoints.length - 1];
  assert.equal(last.x, to.x);
  assert.equal(last.y, to.y);
});

test('WALK CONFINEMENT: a route never leaves the building and never crosses a wall', () => {
  // The reported bug: agents left the manager's office in an arbitrary
  // direction, walked off the screen, and reappeared on the far side. The old
  // router did generic obstacle avoidance and, when blocked, swept around the
  // BOUNDING BOX of the obstacles — a box whose edges are outside the floor.
  // Agents now travel only on the corridor centrelines the plan publishes.
  const plan = buildPlan(
    [1, 2, 5, 11, 3, 1, 2].map((c, i) => ({
      id: `p${i}`,
      name: `p${i}`,
      sessionCount: c,
      tokens: 1000,
    })),
    [
      ...Array.from({ length: 6 }, () => ({ ackState: 'active', activityState: 'for_review' })),
      ...Array.from({ length: 4 }, () => ({ ackState: 'benched', activityState: 'ended' })),
    ],
  );

  const office = plan.rooms.find((r) => r.kind === 'office');
  const lounge = plan.rooms.find((r) => r.kind === 'lounge');
  const projects = plan.rooms.filter((r) => r.kind === 'project');
  assert.ok(office && lounge && projects.length >= 3, 'need a floor with somewhere to walk');

  // Every room the plan lays out must have a way in and out.
  for (const room of plan.rooms) {
    if (room.kind === 'corridor') continue;
    assert.ok(room.door, `${room.id} has no door`);
    assert.ok(room.navEntry, `${room.id} has no corridor entry`);
  }

  const pairs = [
    [office, lounge],
    [office, projects[0]],
    [projects[0], lounge],
    [projects[0], projects[projects.length - 1]],
    [lounge, projects[1]],
  ];

  for (const [a, b] of pairs) {
    const from = { x: a.x + a.w / 2, y: a.y + a.h / 2, room: a };
    const to = { x: b.x + b.w / 2, y: b.y + b.h / 2, room: b };
    const path = [from, ...planWalk(from, to, plan.rooms, plan)];

    for (const w of path) {
      assert.ok(
        w.x >= 0 && w.x <= plan.width && w.y >= 0 && w.y <= plan.height,
        `${a.id} -> ${b.id}: waypoint (${w.x.toFixed(1)}, ${w.y.toFixed(1)}) is off the floor ` +
          `(${plan.width.toFixed(1)} x ${plan.height.toFixed(1)})`,
      );
    }

    // Nothing may cut through a room that is neither end of the journey.
    // Nothing may cut through a room that is CLOSED. The working floor is
    // open plan: its bays are divided by waist-height partitions
    // (03-VISUAL-SPEC.md §6) and tile their band exactly, sharing walls rather
    // than being separated by circulation, so crossing one to reach the next
    // is what walking across an open-plan floor is. A room with real walls —
    // the user's office — must still be entered through its door.
    const others = plan.rooms.filter(
      (r) => r.kind !== 'corridor' && r.walls === 'full' && r.id !== a.id && r.id !== b.id,
    );
    for (let i = 1; i < path.length; i++) {
      const mid = { x: (path[i - 1].x + path[i].x) / 2, y: (path[i - 1].y + path[i].y) / 2 };
      for (const r of others) {
        const inside =
          mid.x > r.x + 0.5 &&
          mid.x < r.x + r.w - 0.5 &&
          mid.y > r.y + 0.5 &&
          mid.y < r.y + r.h - 0.5;
        assert.ok(!inside, `${a.id} -> ${b.id} cuts through ${r.id}`);
      }
    }

    const last = path[path.length - 1];
    assert.ok(Math.abs(last.x - to.x) < 1e-6 && Math.abs(last.y - to.y) < 1e-6, 'must arrive');
  }
});

test('a walk leaves through its own door before joining a corridor', () => {
  const plan = buildPlan(
    [3, 4].map((c, i) => ({ id: `p${i}`, name: `p${i}`, sessionCount: c, tokens: 1 })),
    [{ ackState: 'active', activityState: 'for_review' }],
  );
  const office = plan.rooms.find((r) => r.kind === 'office');
  const target = plan.rooms.find((r) => r.kind === 'project');
  const from = { x: office.x + 2, y: office.y + 2, room: office };
  const to = { x: target.x + 2, y: target.y + 2, room: target };
  const path = planWalk(from, to, plan.rooms, plan);

  const hitsDoor = path.some(
    (w) => Math.abs(w.x - office.door.x) < 1e-6 && Math.abs(w.y - office.door.y) < 1e-6,
  );
  assert.ok(hitsDoor, 'the route must pass through the office door it was given');
});

test('planWalk within the same room is a direct step, no detour', () => {
  const room = {
    kind: 'lounge',
    id: 'lounge',
    name: 'Lounge',
    x: 0,
    y: 0,
    w: 30,
    h: 30,
    walls: 'partial',
    plateLines: ['', ''],
  };
  const from = { x: 2, y: 2, room };
  const to = { x: 20, y: 20, room };
  const waypoints = planWalk(from, to, [room]);
  assert.deepEqual(waypoints, [{ x: 20, y: 20 }]);
});

// --------------------------------------------------------- activity rotation

function fakeRecord(id) {
  const seed = hashString(id);
  return { id, seed, rng: mulberry32(seed) };
}

test('activity rotation: duration always falls within 45-90s', () => {
  const record = fakeRecord('rotation-duration');
  for (let i = 0; i < 200; i++) {
    const { duration } = pickNextActivity(record, {
      table_tennis: true,
      chat: true,
      board_game: true,
    });
    assert.ok(
      duration >= ROTATION_MIN_S && duration < ROTATION_MAX_S,
      `duration ${duration} out of range`,
    );
  }
});

test('activity rotation: degrades paired to solo when no partner is free', () => {
  const record = fakeRecord('rotation-degrade');
  for (let i = 0; i < 300; i++) {
    const choice = pickNextActivity(record, {}); // nothing available
    assert.ok(
      !PAIRED_ACTIVITIES.has(choice.activity),
      `expected a solo activity, got "${choice.activity}"`,
    );
    assert.equal(choice.paired, false);
  }
});

test('activity rotation: a paired activity can be chosen when a partner is available', () => {
  const record = fakeRecord('rotation-paired-available');
  const availability = { table_tennis: true, chat: true, board_game: true };
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const choice = pickNextActivity(record, availability);
    seen.add(choice.activity);
  }
  const sawAPaired = [...PAIRED_ACTIVITIES].some((a) => seen.has(a));
  assert.ok(
    sawAPaired,
    'expected at least one paired activity to be picked when partners are available',
  );
});

test('activity rotation: deterministic across a fresh "reload" — same id, same first draw', () => {
  const a = fakeRecord('agent-deterministic');
  const b = fakeRecord('agent-deterministic');
  assert.deepEqual(pickNextActivity(a, { chat: true }), pickNextActivity(b, { chat: true }));
});

// --------------------------------------------------------- fit scale + resize

// Several viewport sizes spanning the acceptance range (1280x720 -
// 2560x1440), each paired with a plan whose aspect is inside the
// CONTRACTS-WP13.md clamp [1.60, 1.78] — i.e. what `plan.js` actually hands
// back, since `Plan.width/height` are built to that ratio.
const VIEWPORTS = [
  { w: 1280, h: 720 }, // 16:9
  { w: 1920, h: 1080 }, // 16:9
  { w: 2560, h: 1440 }, // 16:9
  { w: 1440, h: 900 }, // 16:10-ish
];
const PLAN_ASPECTS = [1.6, 1.7, 1.78];

test('computeFitScale is exact on one axis and never overflows the other, across viewports from 1280x720 to 2560x1440', () => {
  for (const { w: viewW, h: viewH } of VIEWPORTS) {
    for (const aspect of PLAN_ASPECTS) {
      const planH = 120; // arbitrary unit size; only the ratio matters here
      const planW = planH * aspect;
      const scale = computeFitScale(planW, planH, viewW, viewH);
      const planWpx = planW * scale;
      const planHpx = planH * scale;
      // "Contain" fit: never larger than the viewport on either axis (no
      // scrollbar, no overflow) ...
      assert.ok(planWpx <= viewW + 1e-6, `width overflow at ${viewW}x${viewH}, aspect ${aspect}`);
      assert.ok(planHpx <= viewH + 1e-6, `height overflow at ${viewW}x${viewH}, aspect ${aspect}`);
      // ... and exactly fills it on at least one axis (no scrollbar wasted —
      // this is the "exactly fills" half of acceptance 1; the other half,
      // "no letterbox band wider than 8px" on the slack axis, follows from
      // plan.js's own targetAspect clamp tracking the viewport's aspect
      // within 0.02, which is exercised separately below).
      const widthExact = Math.abs(planWpx - viewW) < 1e-6;
      const heightExact = Math.abs(planHpx - viewH) < 1e-6;
      assert.ok(
        widthExact || heightExact,
        `no exact-fit axis at ${viewW}x${viewH}, aspect ${aspect}`,
      );
    }
  }
});

test('a resize leaves the floor still exactly fitted (stateless recompute, before and after)', () => {
  const planW = 170;
  const planH = 100;
  const before = { w: 1920, h: 1080 };
  const after = { w: 1366, h: 900 };

  for (const view of [before, after]) {
    const scale = computeFitScale(planW, planH, view.w, view.h);
    const planWpx = planW * scale;
    const planHpx = planH * scale;
    assert.ok(planWpx <= view.w + 1e-6);
    assert.ok(planHpx <= view.h + 1e-6);
    const widthExact = Math.abs(planWpx - view.w) < 1e-6;
    const heightExact = Math.abs(planHpx - view.h) < 1e-6;
    assert.ok(widthExact || heightExact, `no exact-fit axis after resizing to ${view.w}x${view.h}`);
  }
});

// ------------------------------------------ WP13 rebuild policy (scene.js)

test('computeTargetAspect clamps to [1.20, 2.20] (docs/DEVIATIONS.md 12)', () => {
  // The clamp was widened from [1.60, 1.78]: after the header is subtracted,
  // every viewport the spec requires to fill exactly sits around 1.85-1.93,
  // so the narrow range letterboxed four of the five by 100-115 px.
  assert.equal(computeTargetAspect(1920, 1080), 1920 / 1080);
  assert.equal(computeTargetAspect(1600, 834), 1600 / 834); // ~1.92, now unclamped
  assert.equal(computeTargetAspect(1280, 662), 1280 / 662); // ~1.93, now unclamped
  assert.equal(computeTargetAspect(3000, 800), 2.2); // absurdly wide -> clamped down
  assert.equal(computeTargetAspect(800, 1000), 1.2); // taller than wide -> clamped up
  assert.equal(computeTargetAspect(1700, 1000), 1.7); // inside range, unclamped
});

test('rebuild threshold: an aspect change of 0.01 does not trigger a rebuild; 0.05 does', () => {
  assert.equal(shouldRebuildAspect(1.7, 1.71), false); // diff 0.01
  assert.equal(shouldRebuildAspect(1.71, 1.7), false); // symmetric
  assert.equal(shouldRebuildAspect(1.7, 1.75), true); // diff 0.05
  assert.equal(shouldRebuildAspect(1.75, 1.7), true);
  // Just under / just over the 0.02 tolerance (CONTRACTS-WP13.md: rebuild
  // "only when it differs ... by more than 0.02"). Kept a hair off the exact
  // boundary rather than testing 0.02 itself, since 1.72 - 1.70 is not
  // exactly representable in IEEE-754 double and lands fractionally over
  // 0.02 — a floating-point artefact of the test values, not of the rule.
  assert.equal(shouldRebuildAspect(1.7, 1.719), false); // diff 0.019, safely under
  assert.equal(shouldRebuildAspect(1.7, 1.721), true); // diff 0.021, safely over
});

// ------------------------------------------------------- label truncation

test('truncateLabel: short labels pass through unchanged', () => {
  assert.equal(truncateLabel('Fix login bug'), 'Fix login bug');
  assert.equal(truncateLabel(''), '');
  assert.equal(truncateLabel('Exactly 18 chars!!'), 'Exactly 18 chars!!'); // 18 chars, untouched
});

test('truncateLabel: breaks on a word boundary within the first 18 characters, never mid-word, when one exists', () => {
  const label = 'Redesign the login flow completely'; // 35 chars, spaces well before the budget
  const out = truncateLabel(label);
  assert.ok(out.length <= 18, `expected <= 18 chars, got ${out.length} ("${out}")`);
  assert.ok(out.endsWith('…'));
  // The character right before the ellipsis must be the end of a whole word
  // from the source string, not a fragment invented by a mid-word cut.
  const withoutEllipsis = out.slice(0, -1);
  assert.ok(
    withoutEllipsis === '' || label.startsWith(`${withoutEllipsis} `) || label === withoutEllipsis,
    `"${withoutEllipsis}" is not a whole-word prefix of "${label}"`,
  );
});

test('truncateLabel: falls back to a hard cut, still <= 18 chars, when the budget has no space to break on', () => {
  const label = 'Supercalifragilisticexpialidocious'; // one long word, no spaces at all
  const out = truncateLabel(label);
  assert.ok(out.length <= 18, `expected <= 18 chars, got ${out.length} ("${out}")`);
  assert.ok(out.endsWith('…'));
  assert.equal(out, `${label.slice(0, 17)}…`);
});

test('truncateLabel: never exceeds 18 characters, fuzzed over many labels with and without spaces', () => {
  const words = ['fix', 'the', 'login', 'flow', 'completely', 'refactor', 'a', 'b', 'longwordxyz'];
  for (let i = 0; i < 200; i++) {
    const wordCount = 1 + (i % 6);
    const label = Array.from({ length: wordCount }, (_, k) => words[(i + k) % words.length]).join(
      i % 3 === 0 ? '' : ' ',
    );
    const out = truncateLabel(label);
    assert.ok(out.length <= 18, `"${label}" -> "${out}" (${out.length} chars)`);
  }
});

test('labelBox: measures the truncated text (via a stubbed ctx) and returns a sane screen-space rect', () => {
  // A stubbed ctx satisfies exactly what labelBox reads: an assignable
  // `.font` and a `.measureText` — no canvas, no DOM, per the work order.
  const ctx = { font: '', measureText: (text) => ({ width: text.length * 6 }) };
  const box = labelBox(ctx, 100, 200, 14, 'A very long name that truncates for sure');
  assert.equal(box.text, truncateLabel('A very long name that truncates for sure'));
  assert.ok(box.w > 0 && box.h > 0);
  // The box is horizontally centred on the character origin (ox = 100).
  assert.ok(Math.abs(box.x + box.w / 2 - 100) < 1e-9);
  // The box sits below the character origin (labels draw under the character).
  assert.ok(box.top > 200);
});

// ------------------------------------------------- label collision resolution

test('resolveLabelCollisions: non-overlapping labels are all kept at their natural position', () => {
  const items = [
    { id: 'a', x: 0, y: 0, w: 40, h: 10 },
    { id: 'b', x: 100, y: 0, w: 40, h: 10 },
    { id: 'c', x: 200, y: 0, w: 40, h: 10 },
  ];
  const plan = resolveLabelCollisions(items);
  for (const it of items) {
    assert.deepEqual(plan.get(it.id), { offsetY: 0 });
  }
});

test('resolveLabelCollisions: an overlapping lower-priority label is offset or dropped, never left overlapping', () => {
  const items = [
    { id: 'first', x: 0, y: 0, w: 40, h: 10 },
    { id: 'second', x: 10, y: 0, w: 40, h: 10 }, // overlaps "first"
  ];
  const plan = resolveLabelCollisions(items);
  assert.deepEqual(plan.get('first'), { offsetY: 0 }); // first claim wins its spot untouched
  const second = plan.get('second');
  if (second !== null) {
    // If it was kept, it must have been nudged clear of "first" — offsetY 0
    // would still overlap by construction of this fixture.
    assert.ok(second.offsetY > 0, 'a kept overlapping label must have a positive offset');
    const firstRect = { x: 0, y: 0, w: 40, h: 10 };
    const secondRect = { x: 10, y: second.offsetY, w: 40, h: 10 };
    const stillOverlaps =
      secondRect.x < firstRect.x + firstRect.w &&
      secondRect.x + secondRect.w > firstRect.x &&
      secondRect.y < firstRect.y + firstRect.h &&
      secondRect.y + secondRect.h > firstRect.y;
    assert.ok(!stillOverlaps, 'resolved label must not overlap the one already placed');
  }
  // If it was dropped (`null`), that also satisfies "never left overlapping"
  // — dropping is the documented fallback when no offset clears it.
});

test('resolveLabelCollisions: prefers dropping to leaving an unreadable overlap when offsetting cannot help', () => {
  // Many identical-size labels stacked at the exact same position: every
  // offset attempt (0h, 1h, 2h down) still lands on top of some already-
  // placed label, so everything after the first must be dropped, not drawn
  // overlapping.
  const items = Array.from({ length: 6 }, (_, i) => ({
    id: `stack-${i}`,
    x: 0,
    y: 0,
    w: 40,
    h: 10,
  }));
  const plan = resolveLabelCollisions(items);
  assert.deepEqual(plan.get('stack-0'), { offsetY: 0 });
  let droppedCount = 0;
  for (let i = 1; i < items.length; i++) {
    if (plan.get(`stack-${i}`) === null) droppedCount++;
  }
  assert.ok(droppedCount > 0, 'expected at least one label to be dropped rather than overlap');
});

test('resolveLabelCollisions: kept (selected / needs-you) labels are never dropped or nudged, even under collision — priority wins regardless of paint order', () => {
  const items = [
    // "normal" comes first in paint order, but priority — not paint order —
    // decides who gets the contested spot: every `keep` item is placed
    // before any non-`keep` item, full stop.
    { id: 'normal', x: 0, y: 0, w: 40, h: 10 },
    { id: 'needs-you', x: 5, y: 0, w: 40, h: 10, keep: true }, // overlaps "normal"
  ];
  const plan = resolveLabelCollisions(items);
  assert.deepEqual(plan.get('needs-you'), { offsetY: 0 }); // placed unconditionally, un-nudged
  // "normal" is the one that must yield: moved clear of the kept label, or
  // dropped — never left drawn on top of it.
  const normal = plan.get('normal');
  assert.ok(
    normal === null || normal.offsetY > 0,
    'the non-kept label must move or be dropped, not overlap the kept one',
  );
});

test('resolveLabelCollisions: a kept label placed first still forces later non-kept labels to move or drop', () => {
  const items = [
    { id: 'needs-you', x: 0, y: 0, w: 40, h: 10, keep: true },
    { id: 'normal', x: 5, y: 0, w: 40, h: 10 }, // overlaps the kept label
  ];
  const plan = resolveLabelCollisions(items);
  assert.deepEqual(plan.get('needs-you'), { offsetY: 0 });
  const normal = plan.get('normal');
  assert.ok(normal === null || normal.offsetY > 0, 'the non-kept label must move or be dropped');
});

// ------------------------------------------------ frozen pane + overflow scroll
//
// The office and lounge stay pinned to the left edge while the working floor
// scrolls, but only once the floor is too big to fit at a legible scale. The
// thing most likely to break is hit-testing: a click must resolve to the same
// world point whichever region it lands in, at any scroll offset.

/** Mirror of scene.js's two cameras, so the maths can be tested DOM-free. */
function cameras({ fitScale, panX, panY, pinnedW, scrollX, overflowing }) {
  const pinned = { zoom: fitScale / 14, panX, panY, U: 14 };
  const scrolled = overflowing ? { ...pinned, panX: panX - scrollX } : pinned;
  return { pinned, scrolled, boundary: panX + pinnedW };
}

test('while the floor fits, both regions share one camera and nothing scrolls', () => {
  const c = cameras({
    fitScale: 12,
    panX: 40,
    panY: 20,
    pinnedW: 300,
    scrollX: 0,
    overflowing: false,
  });
  assert.deepEqual(c.pinned, c.scrolled, 'a fitting floor must have exactly one camera');
});

test('the pinned region ignores the scroll offset entirely', () => {
  const base = { fitScale: 7.5, panX: 0, panY: 0, pinnedW: 260, overflowing: true };
  const a = cameras({ ...base, scrollX: 0 });
  const b = cameras({ ...base, scrollX: 500 });
  const office = { x: 4, y: 6 };
  assert.deepEqual(
    worldToScreen(office, a.pinned),
    worldToScreen(office, b.pinned),
    'the office must not move when the working floor scrolls',
  );
  assert.notDeepEqual(
    worldToScreen({ x: 90, y: 6 }, a.scrolled),
    worldToScreen({ x: 90, y: 6 }, b.scrolled),
    'a project room must move with the scroll',
  );
});

test('a world point round-trips exactly at any scroll offset', () => {
  for (const scrollX of [0, 37.5, 240, 999]) {
    const c = cameras({
      fitScale: 7.5,
      panX: 12,
      panY: 8,
      pinnedW: 260,
      scrollX,
      overflowing: true,
    });
    for (const cam of [c.pinned, c.scrolled]) {
      const world = { x: 91.25, y: 33.5 };
      const back = screenToWorld(worldToScreen(world, cam), cam);
      assert.ok(Math.abs(back.x - world.x) < 1e-9, `x round-trip at scrollX=${scrollX}`);
      assert.ok(Math.abs(back.y - world.y) < 1e-9, `y round-trip at scrollX=${scrollX}`);
    }
  }
});

test('the scroll offset clamps at both ends so no empty floor is exposed', () => {
  // scene.js clamps to [0, span] where span is what is left after the pinned
  // column and the visible width are taken out of the floor.
  const clamp = (v, span) => Math.min(Math.max(v, 0), span);
  const floorPx = 2400;
  const pinnedW = 300;
  const viewW = 1200;
  const span = Math.max(0, floorPx - pinnedW - (viewW - pinnedW));
  assert.equal(span, floorPx - viewW);
  assert.equal(clamp(-500, span), 0, 'cannot scroll before the start');
  assert.equal(clamp(span + 500, span), span, 'cannot scroll past the end');
});

test('a floor that fits leaves nothing to scroll', () => {
  const floorPx = 900;
  const pinnedW = 300;
  const viewW = 1200;
  const span = Math.max(0, floorPx - pinnedW - (viewW - pinnedW));
  assert.equal(span, 0, 'a fitting floor has zero scroll span');
});
