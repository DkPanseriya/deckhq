/**
 * THE FLOORS THE PRODUCT DRAWS KEEP THE DESIGNER'S RULEBOOK.
 *
 * `plan-proportions.test.mjs` checks the rules as arithmetic. This asks them
 * of real plans: every demo population a golden photographs, the 150-agent
 * `large` floor, and `crowded` — a floor the shape of the owner's own, where
 * the lounge had 40% of the building, the reception 17%, and five project
 * rooms shared 35% as one hall and four strips. Each at four real windows.
 *
 * Everything is measured off the plan's rectangles here, with arithmetic
 * written out in this file, and only then compared with what the plan says of
 * itself (`plan.proportions`). `node test/helpers/measure-proportions.mjs` prints
 * the same numbers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { LARGE_NOW, ownerShapedFloor, populationFloor } from '../helpers/large-floor.mjs';
import { buildPlan } from '../../public/render/plan.js';
import {
  STAGE_REBUILD_THRESHOLD,
  computeFill,
  shouldRebuildStage,
} from '../../public/render/scene-camera.js';
import { MIN_SCALE } from '../../public/render/scene-lod.js';
import { BODY_HEIGHT_U, RIG_DETAIL_MIN_PX } from '../../public/render/rig-metrics.js';
import { resetAgentScale } from '../../public/render/plan-scale.js';
import {
  LOUNGE_AREA_MAX,
  NOMINAL_PX_PER_UNIT,
  OFFICE_AREA_MAX,
  ROOMS_AREA_MIN,
  ROOM_AREA_SPREAD_MAX,
  ROOM_RATIO_MAX,
  ROOM_RATIO_MIN,
  ROWS_LIMIT,
  ROWS_MAX,
  ROW_DEPTH_SPREAD_MAX,
  SCALE_MIN_PX_PER_UNIT,
  WINDOW_FILL_MIN,
  measureProportions,
  nominalWidth,
  proportionFaults,
} from '../../public/render/plan-proportions.js';

const EPS = 1e-6;

/** Real windows, and the canvas each leaves the floor once the chrome is off it. */
const WINDOWS = [
  [1600, 1000],
  [1920, 1080],
  [2000, 1185],
  [1366, 768],
];
const CHROME_H = 130;

/** The populations, by the name a capture is taken under. */
const FLOORS = {
  demo: () => populationFloor('demo'),
  three: () => populationFloor('three'),
  reference: () => populationFloor('reference'),
  pinned: () => populationFloor('pinned'),
  away: () => populationFloor('away'),
  crew: () => populationFloor('crew'),
  'crew-waiting': () => populationFloor('crew-waiting'),
  large: () => populationFloor('large'),
  crowded: ownerShapedFloor,
};

/** @param {{projects:any[], agents:any[]}} floor @param {number} winW @param {number} winH */
function planAt(floor, winW, winH) {
  const stage = { w: winW, h: winH - CHROME_H };
  return { stage, plan: buildPlan(floor.projects, floor.agents, { stage, now: LARGE_NOW }) };
}

const areaOf = (/** @type {any[]} */ rooms) => rooms.reduce((a, r) => a + r.w * r.h, 0);
const pct = (/** @type {number} */ v) => `${(v * 100).toFixed(1)}%`;

for (const [name, make] of Object.entries(FLOORS)) {
  test(`${name}: the project rooms are the majority, and neither service room is past its cap`, () => {
    const floor = make();
    for (const [winW, winH] of WINDOWS) {
      const { plan } = planAt(floor, winW, winH);
      const where = `${name} at ${winW}x${winH}`;
      const building = plan.width * plan.height;
      const of = (/** @type {string} */ kind) => plan.rooms.filter((r) => r.kind === kind);
      assert.ok(of('project').length > 0, `${where}: no project room on the floor`);
      const rooms = areaOf(of('project')) / building;
      const office = areaOf(of('office')) / building;
      const lounge = areaOf(of('lounge')) / building;
      const corridors = areaOf(of('corridor')) / building;
      assert.ok(rooms >= ROOMS_AREA_MIN - EPS, `${where}: project rooms have ${pct(rooms)}`);
      assert.ok(office <= OFFICE_AREA_MAX + EPS, `${where}: the office has ${pct(office)}`);
      assert.ok(lounge <= LOUNGE_AREA_MAX + EPS, `${where}: the lounge has ${pct(lounge)}`);
      // And the four add up: the building is tiled, so "the rest" is corridor.
      assert.ok(
        Math.abs(rooms + office + lounge + corridors - 1) < 1e-6,
        `${where}: the rooms cover ${pct(rooms + office + lounge + corridors)} of the building`,
      );
    }
  });

  test(`${name}: every project room is a room — no strip, no hall beside a slot`, () => {
    const floor = make();
    for (const [winW, winH] of WINDOWS) {
      const { plan } = planAt(floor, winW, winH);
      const where = `${name} at ${winW}x${winH}`;
      const rooms = plan.rooms.filter((r) => r.kind === 'project');
      for (const r of rooms) {
        const ratio = r.w / r.h;
        assert.ok(
          ratio >= ROOM_RATIO_MIN - EPS && ratio <= ROOM_RATIO_MAX + EPS,
          `${where}: ${r.id} is ${r.w.toFixed(1)} x ${r.h.toFixed(1)}, ${ratio.toFixed(2)}:1`,
        );
        if (r.natural && r.pinned !== true) {
          assert.ok(
            r.w >= r.natural.w - 0.01 && r.h >= r.natural.h - 0.01,
            `${where}: ${r.id} is smaller than its furniture`,
          );
        }
      }
      const sizes = rooms.map((r) => r.w * r.h);
      const spread = Math.max(...sizes) / Math.min(...sizes);
      assert.ok(
        spread <= ROOM_AREA_SPREAD_MAX + EPS,
        `${where}: the largest room is ${spread.toFixed(2)}x the smallest`,
      );
    }
  });

  test(`${name}: the rooms stand in rows of one depth, near-equal, with nothing left over`, () => {
    const floor = make();
    for (const [winW, winH] of WINDOWS) {
      const { plan } = planAt(floor, winW, winH);
      const where = `${name} at ${winW}x${winH}`;
      /** @type {Map<number, any[]>} */
      const rows = new Map();
      for (const r of plan.rooms.filter((x) => x.kind === 'project')) {
        const key = Math.round(r.y * 100);
        rows.set(key, [...(rows.get(key) || []), r]);
      }
      assert.ok(rows.size >= 1 && rows.size <= ROWS_LIMIT, `${where}: ${rows.size} rows`);
      const depths = [];
      for (const row of rows.values()) {
        row.sort((a, b) => a.x - b.x);
        for (const r of row) {
          assert.ok(Math.abs(r.h - row[0].h) < 0.01, `${where}: ${r.id} is not its row's depth`);
        }
        for (let i = 1; i < row.length; i++) {
          assert.ok(
            Math.abs(row[i].x - (row[i - 1].x + row[i - 1].w)) < 0.01,
            `${where}: a gap between ${row[i - 1].id} and ${row[i].id}`,
          );
        }
        // The row ends on the building line: no cell is left over beside it.
        const last = row[row.length - 1];
        assert.ok(
          Math.abs(last.x + last.w - plan.width) < 0.01,
          `${where}: the row at y=${row[0].y.toFixed(1)} stops short of the building line`,
        );
        depths.push(row[0].h);
      }
      const spread = Math.max(...depths) / Math.min(...depths) - 1;
      assert.ok(
        spread <= ROW_DEPTH_SPREAD_MAX + EPS,
        `${where}: row depths ${depths.map((d) => d.toFixed(1))} differ by ${pct(spread)}`,
      );
      // Nothing on a floor with rooms is open plan nobody stands on.
      const open = plan.rooms.filter((r) => r.kind === 'corridor' && r.thoroughfare === false);
      assert.deepEqual(
        open.map((r) => r.id),
        [],
        `${where}: open floor`,
      );
    }
  });

  test(`${name}: the building fills the window on both axes`, () => {
    const floor = make();
    for (const [winW, winH] of WINDOWS) {
      const { plan, stage } = planAt(floor, winW, winH);
      const fill = computeFill(plan.width, plan.height, stage.w, stage.h);
      assert.ok(
        Math.min(fill.coverW, fill.coverH) >= WINDOW_FILL_MIN,
        `${name} at ${winW}x${winH}: a ${plan.width.toFixed(1)} x ${plan.height.toFixed(1)} ` +
          `building covers ${pct(fill.coverW)} by ${pct(fill.coverH)}`,
      );
    }
  });

  test(`${name}: what the plan says of its own proportions is what it drew`, () => {
    const floor = make();
    for (const [winW, winH] of WINDOWS) {
      const { plan } = planAt(floor, winW, winH);
      const where = `${name} at ${winW}x${winH}`;
      const measured = measureProportions(plan);
      assert.deepEqual(proportionFaults(measured), [], where);
      assert.deepEqual(plan.proportions.faults, [], where);
      for (const key of /** @type {const} */ (['rooms', 'office', 'lounge', 'corridors'])) {
        assert.ok(Math.abs(plan.proportions.shares[key] - measured.shares[key]) < 1e-9, where);
      }
      assert.equal(plan.proportions.rows, measured.rows, where);
    }
  });
}

test('three rows is the norm: only a floor with two dozen rooms is laid in more', () => {
  for (const [name, make] of Object.entries(FLOORS)) {
    const floor = make();
    for (const [winW, winH] of WINDOWS) {
      const { plan } = planAt(floor, winW, winH);
      const rooms = plan.rooms.filter((r) => r.kind === 'project').length;
      if (rooms >= 20) continue;
      assert.ok(
        plan.proportions.rows <= ROWS_MAX,
        `${name} at ${winW}x${winH}: ${rooms} rooms in ${plan.proportions.rows} rows`,
      );
    }
  }
});

test('crowded, the owner’s floor: five rooms of two sizes, four of them dark, none a strip', () => {
  const floor = ownerShapedFloor();
  const { plan } = planAt(floor, 2000, 1185);
  const rooms = plan.rooms.filter((r) => r.kind === 'project');
  assert.equal(rooms.length, 5);
  const lit = rooms.filter((r) => r.dim !== true);
  const dark = rooms.filter((r) => r.dim === true);
  assert.deepEqual(
    lit.map((r) => r.id),
    ['atlas'],
    'the one room somebody is working in',
  );
  assert.equal(dark.length, 4);
  for (const r of dark) assert.equal(r.away, true, `${r.id} is dark and not away`);
  // The room with two people at its desk is a team room; the four whose people
  // are in the office are one-desk rooms, and they are one size between them.
  const sizes = dark.map((r) => r.w * r.h);
  assert.ok(Math.max(...sizes) / Math.min(...sizes) <= 1.6, `the dark rooms: ${sizes}`);
  const atlas = lit[0].w * lit[0].h;
  assert.ok(atlas >= Math.min(...sizes) - EPS, 'the working room is the smallest on the floor');
  // What the picture showed, and what it shows now.
  const shares = measureProportions(plan).shares;
  assert.ok(shares.lounge <= 0.25 + EPS && shares.rooms >= 0.55 - EPS, JSON.stringify(shares));
});

// ------------------------------------------------------------- (i) the scale

/**
 * A floor of a few rooms, made here: `sizes` people at desks per repo, so many
 * waiting in the first of them and so many resting.
 * @param {number[]} sizes @param {number} resting @param {number} waiting
 */
function fewRooms(sizes, resting, waiting) {
  const base = { ackState: 'active', lastActivityAt: LARGE_NOW - 60_000 };
  const projects = sizes.map((n, i) => ({ id: `p${i}`, name: `p${i}`, sessionCount: n }));
  const agents = sizes.flatMap((n, i) =>
    Array.from({ length: n }, (_, k) => ({
      ...base,
      id: `p${i}-${k}`,
      projectId: `p${i}`,
      activityState: 'working',
    })),
  );
  for (let k = 0; k < waiting; k++) {
    agents.push({
      ...base,
      id: `w${k}`,
      projectId: 'p0',
      activityState: 'for_review',
      reviewSince: LARGE_NOW - 60_000 * (k + 1),
    });
  }
  for (let k = 0; k < resting; k++) {
    agents.push({
      id: `b${k}`,
      projectId: 'p0',
      activityState: 'ended',
      ackState: 'benched',
      lastActivityAt: LARGE_NOW - 60_000 * k,
    });
  }
  return { projects, agents };
}

/**
 * THE FLOORS MOST PEOPLE HAVE: one to four repos. Canvases from 4:3 to an
 * ultrawide, because what a few rooms can be laid as turns on the window's
 * shape more than a full floor's does.
 */
const FEW = [[1], [1, 1], [2, 2], [5, 1], [8, 3], [1, 1, 1], [3, 2, 2], [1, 1, 1, 1]];
const CROWDS = [
  [0, 0],
  [12, 3],
  [79, 16],
];
const CANVASES = [
  [1200, 900],
  [1400, 1000],
  [1600, 1000],
  [1600, 940],
  [1600, 900],
  [1600, 870],
  [1366, 638],
  [1920, 950],
  [2000, 1055],
  [2560, 1000],
];
/**
 * The smallest a floor of a few rooms is drawn, in pixels a unit, with the
 * lounge and the queue as full as the owner's. Measured at 9.2 on the worst of
 * these — two rooms on a 1366 px laptop under seventy-nine resting — and held a
 * little under it. Before the front was a way of laying a floor, two rooms on
 * a 1600 x 1000 canvas were a building 296 U wide: 5.4.
 */
const FEW_SCALE_MIN = 9;

test('a floor of one to four rooms keeps every rule in every shape of window, at a size worth drawing', () => {
  let worst = Infinity;
  let worstAt = '';
  /** @type {Record<string, number>} */
  const laid = {};
  for (const sizes of FEW) {
    for (const [resting, waiting] of CROWDS) {
      const floor = fewRooms(sizes, resting, waiting);
      for (const [w, h] of CANVASES) {
        const plan = buildPlan(floor.projects, floor.agents, {
          stage: { w, h },
          now: LARGE_NOW,
        });
        const where = `[${sizes}] with ${resting} resting and ${waiting} waiting on ${w}x${h}`;
        assert.deepEqual(plan.proportions.faults, [], where);
        assert.equal(plan.agentSize, 'medium', `${where}: drawn a size down`);
        const scale = w / plan.width;
        if (scale < worst) {
          worst = scale;
          worstAt = `${where}, a ${plan.arrangement} ${plan.width.toFixed(0)} U wide`;
        }
        laid[plan.arrangement] = (laid[plan.arrangement] || 0) + 1;
      }
    }
  }
  assert.ok(worst >= FEW_SCALE_MIN, `${worst.toFixed(2)} px a unit: ${worstAt}`);
  // All three ways of laying a floor are in use, and none of these is classic.
  assert.ok(laid.column > 0 && laid.bands > 0 && laid.front > 0, JSON.stringify(laid));
  assert.equal(laid['two-rows'] || 0, 0);
  console.log(
    `\n    smallest: ${worst.toFixed(2)} px a unit — ${worstAt}; ${JSON.stringify(laid)}`,
  );
});

test('two rooms in a window neither wide nor tall: the front, and the rooms side by side behind it', () => {
  const floor = fewRooms([2, 2], 0, 0);
  const plan = buildPlan(floor.projects, floor.agents, {
    stage: { w: 1600, h: 1000 },
    now: LARGE_NOW,
  });
  assert.equal(plan.arrangement, 'front');
  assert.deepEqual(plan.proportions.faults, []);
  const office = plan.rooms.find((r) => r.kind === 'office');
  const lounge = plan.rooms.find((r) => r.kind === 'lounge');
  const spine = plan.rooms.find((r) => r.id === '__spine__');
  const rooms = plan.rooms.filter((r) => r.kind === 'project');
  // One band across the top, the corridor under it wall to wall.
  assert.equal(office.y, 0);
  assert.equal(lounge.y, 0);
  assert.ok(Math.abs(office.h - lounge.h) < EPS);
  assert.ok(Math.abs(lounge.x + lounge.w - plan.width) < EPS);
  assert.ok(Math.abs(spine.w - plan.width) < EPS && Math.abs(spine.y - office.h) < EPS);
  // And the two rooms behind it, side by side, one depth, the whole width.
  assert.equal(rooms.length, 2);
  assert.ok(Math.abs(rooms[0].h - rooms[1].h) < EPS && Math.abs(rooms[0].y - rooms[1].y) < EPS);
  assert.ok(Math.abs(rooms[0].w + rooms[1].w - plan.width) < EPS);
  for (const room of rooms) {
    const ratio = room.w / room.h;
    assert.ok(ratio >= ROOM_RATIO_MIN - EPS && ratio <= ROOM_RATIO_MAX + EPS, `${ratio}`);
  }
  // Drawn at a size worth drawing: this floor was 208 U wide, 7.7 px a unit.
  assert.ok(1600 / plan.width >= 14, `${plan.width} U on 1600 px`);
});

test('the two scales the rulebook names are the renderer’s own', () => {
  // `plan-proportions.js` imports nothing, so it states both numbers itself.
  assert.equal(SCALE_MIN_PX_PER_UNIT, MIN_SCALE);
  // The nominal scale is the last at which a figure keeps its detail.
  resetAgentScale();
  const figure = NOMINAL_PX_PER_UNIT * BODY_HEIGHT_U;
  assert.ok(figure >= RIG_DETAIL_MIN_PX, `a ${figure.toFixed(1)} px figure at the nominal scale`);
  assert.ok((NOMINAL_PX_PER_UNIT - 1) * BODY_HEIGHT_U < RIG_DETAIL_MIN_PX, 'a scale to spare');
});

test('a floor is laid at its contents, or held to the window at the nominal scale', () => {
  for (const [name, make] of Object.entries(FLOORS)) {
    const floor = make();
    for (const [winW, winH] of WINDOWS) {
      const { plan, stage } = planAt(floor, winW, winH);
      const where = `${name} at ${winW}x${winH}`;
      const { contentsW, nominalW, capped } = plan.working;
      assert.equal(nominalW, nominalWidth(stage, plan.targetAspect), where);
      // Never wider than its contents: nothing is padded to a scale.
      if (contentsW > 0)
        assert.ok(plan.width <= contentsW + 1e-6, `${where}: wider than it need be`);
      if (contentsW > 0 && contentsW <= nominalW + 1e-6) {
        // It fits at the nominal scale, so it is its contents and nothing gave way.
        assert.ok(Math.abs(plan.width - contentsW) < 1e-6, `${where}: not laid at its contents`);
        assert.equal(capped, false, `${where}: a service room was held back for nothing`);
      } else if (capped) {
        // It does not, and holding the service rooms to their caps bought a
        // smaller building: no smaller than the window at the nominal scale,
        // which is the building the caps are held in.
        assert.ok(plan.width >= nominalW - 1e-6, `${where}: held under the nominal scale`);
        assert.ok(plan.width < contentsW, `${where}: held back and no smaller for it`);
      }
      // Otherwise it is past the nominal scale AT its contents: nothing the
      // service rooms could give up would have let the rooms stand in less.
    }
  }
});

test('the body size follows the scale down before a floor of forty repos scrolls', () => {
  const floor = populationFloor('large');
  const at = (/** @type {number} */ w, /** @type {number} */ h, agentSize = 'medium') =>
    buildPlan(floor.projects, floor.agents, { stage: { w, h }, now: LARGE_NOW, agentSize });
  try {
    // On a 1600 px window twenty-two rooms fit at the size they were asked for.
    const wide = at(1600, 870);
    assert.equal(wide.agentSize, 'medium');
    assert.ok(1600 / wide.width >= SCALE_MIN_PX_PER_UNIT - 1e-6);
    // On the owner's 1420 they do not, and the floor is laid a size smaller
    // rather than left to scroll — with every rule still kept.
    const narrow = at(1420, 690);
    assert.equal(narrow.agentSize, 'small');
    assert.ok(1420 / narrow.width >= SCALE_MIN_PX_PER_UNIT - 1e-6, `${narrow.width} U at 1420 px`);
    assert.deepEqual(narrow.proportions.faults, []);
    // A floor that is already at the smallest size has nowhere to go.
    assert.equal(at(1420, 690, 'small').agentSize, 'small');
    // And a floor that fits is never made smaller than it was asked to be.
    const small = populationFloor('demo');
    const demo = buildPlan(small.projects, small.agents, {
      stage: { w: 1420, h: 690 },
      now: LARGE_NOW,
      agentSize: 'large',
    });
    assert.equal(demo.agentSize, 'large');
  } finally {
    resetAgentScale();
  }
});

test('a plan is laid for a width as well as a shape, and laid again when the window is another', () => {
  const floor = ownerShapedFloor();
  const { plan } = planAt(floor, 2000, 1185);
  assert.equal(plan.stageW, 2000);
  assert.equal(shouldRebuildStage(2000, plan.stageW), false);
  assert.equal(shouldRebuildStage(2000 * (1 + STAGE_REBUILD_THRESHOLD) - 1, plan.stageW), false);
  assert.equal(shouldRebuildStage(2560, plan.stageW), true);
  assert.equal(shouldRebuildStage(1366, plan.stageW), true);
  // A plan laid for a shape alone has no width to drift from.
  const shaped = buildPlan(floor.projects, floor.agents, { targetAspect: 1.9, now: LARGE_NOW });
  assert.equal(shaped.stageW, null);
  assert.equal(shouldRebuildStage(1366, shaped.stageW), false);
  // And the same floor on a laptop's window is a narrower building, not a
  // smaller picture of the same one.
  const laptop = planAt(floor, 1366, 768).plan;
  assert.ok(
    laptop.width < plan.width,
    `${laptop.width} U on a laptop, ${plan.width} U on a monitor`,
  );
});
