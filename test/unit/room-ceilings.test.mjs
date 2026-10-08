/**
 * A ROOM HAS A MAXIMUM SIZE, and a floor of few rooms is drawn larger instead
 * of its rooms being laid larger (`public/render/plan-proportions.js` (c)).
 *
 * Held over the named floors at four real windows: no room past its module's
 * ceiling, every room still a room's shape and the family still a family, the
 * scale between the two the renderer draws at, the building over the whole
 * window, and no room more than 45% bare. And on a floor of one to three
 * projects, with the size left to the floor, nobody is lost in it.
 */

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { buildPlan } from '../../public/render/plan.js';
import { bareFloorShare } from '../../public/render/plan-interior.js';
import {
  HALL_WIDTH_MIN,
  MODULE_AREA_MAX,
  MODULE_WEIGHTS,
  ROOMS_AREA_MIN,
  ROOMS_CEILING_REACH,
  ROOM_AREA_SPREAD_MAX,
  ROOM_RATIO_MAX,
  ROOM_RATIO_MIN,
  SCALE_MAX_PX_PER_UNIT,
  SCALE_MIN_PX_PER_UNIT,
  WINDOW_FILL_MIN,
  roomAreaMax,
  roomDepthMax,
  roomWidthMax,
  splitRow,
} from '../../public/render/plan-proportions.js';
import { resetAgentScale } from '../../public/render/plan-scale.js';
import { CORRIDOR } from '../../public/render/plan-units.js';
import { BODY_HEIGHT_U, RIG_UNIT_U } from '../../public/render/rig-metrics.js';
import { computeFill } from '../../public/render/scene-camera.js';
import { BODY_MAX_PX, CHAR_MAX_PX_PER_UNIT } from '../../public/render/scene-lod.js';
import { LARGE_NOW, populationFloor } from '../helpers/large-floor.mjs';

const WINDOWS = [
  [1600, 1000],
  [1920, 1080],
  [2000, 1185],
  [1366, 768],
];
const CHROME_H = 130;
const NAMES = ['single', 'pair', 'three', 'worktrees', 'demo', 'reference', 'crowded', 'large'];
const FEW = ['single', 'pair', 'three', 'worktrees'];
const EPS = 1e-6;

/** @param {string} name @param {number[]} win @param {string} [agentSize] */
function planAt(name, [winW, winH], agentSize) {
  const floor = populationFloor(name);
  const stage = { w: winW, h: winH - CHROME_H };
  const plan = buildPlan(floor.projects, floor.agents, { stage, now: LARGE_NOW, agentSize });
  return { plan, stage, fill: computeFill(plan.width, plan.height, stage.w, stage.h) };
}
const projectRooms = (/** @type {any} */ plan) =>
  plan.rooms.filter((/** @type {any} */ r) => r.kind === 'project');
const rectHash = (/** @type {any} */ plan) =>
  createHash('sha1')
    .update(
      projectRooms(plan)
        .map((/** @type {any} */ r) =>
          [r.id, r.x.toFixed(3), r.y.toFixed(3), r.w.toFixed(3), r.h.toFixed(3)].join(','),
        )
        .join(';'),
    )
    .digest('hex')
    .slice(0, 8);

test('the ceilings are one number and the module family: 840, 1260 and 1890 U²', () => {
  assert.deepEqual(
    [MODULE_AREA_MAX.S, MODULE_AREA_MAX.M, MODULE_AREA_MAX.L].map(Math.round),
    [840, 1260, 1890],
  );
  assert.ok(Math.abs(MODULE_AREA_MAX.L / MODULE_AREA_MAX.S - MODULE_WEIGHTS.L) < EPS);
  // Largest over smallest stays inside the spread the family is held to.
  assert.ok(MODULE_AREA_MAX.L / MODULE_AREA_MAX.S <= ROOM_AREA_SPREAD_MAX);
  // A room is never held under its own desks, and a pinned room is a small one.
  assert.equal(roomAreaMax('S', 1000), 1600);
  assert.equal(roomAreaMax(undefined), MODULE_AREA_MAX.S);
  // The depth and the width a ceiling allows are the shape bounds read off it.
  assert.ok(Math.abs(roomDepthMax(840) - Math.sqrt(840 / ROOM_RATIO_MIN)) < EPS);
  assert.ok(Math.abs(roomWidthMax(840) - Math.sqrt(840 * ROOM_RATIO_MAX)) < EPS);
});

test('a row never lays a room past its ceiling, and leaves a hall no narrower than a corridor', () => {
  assert.equal(HALL_WIDTH_MIN, CORRIDOR);
  // Two rooms of 840 U² in a row 25 deep are 33.6 wide each, whatever is spare.
  const widths = splitRow([1, 1], 120, 25, [], 0, [840, 840], Infinity);
  assert.deepEqual(
    widths?.map((w) => Math.round(w * 10) / 10),
    [33.6, 33.6],
  );
  // With no leave to, there is no split: the row is not padded with a room.
  assert.equal(splitRow([1, 1], 120, 25, [], 0, [840, 840], 0), null);
  // And a sliver beside them becomes a corridor's width, taken from the rooms.
  const tight = splitRow([1, 1], 69, 25, [], 0, [840, 840], Infinity);
  assert.ok(tight && Math.abs(tight[0] + tight[1] - (69 - HALL_WIDTH_MIN)) < EPS, `${tight}`);
  // A row too deep for the ceiling has no shape to lay the room at.
  assert.equal(splitRow([1], 60, 40, [], 0, [840], Infinity), null);
});

test('the largest scale the rulebook names is the renderer’s own', () => {
  resetAgentScale();
  assert.ok(Math.abs(SCALE_MAX_PX_PER_UNIT - BODY_MAX_PX / BODY_HEIGHT_U) < 1e-9);
  assert.ok(Math.abs(SCALE_MAX_PX_PER_UNIT - CHAR_MAX_PX_PER_UNIT) < 1e-9);
});

for (const name of NAMES) {
  test(`${name}: no room past its ceiling, every rule kept, the window covered, no room bare`, () => {
    for (const win of WINDOWS) {
      const { plan, fill } = planAt(name, win);
      const where = `${name} at ${win[0]}x${win[1]}`;
      const rooms = projectRooms(plan);
      for (const r of rooms) {
        assert.ok(r.w * r.h <= r.areaMax + 1e-3, `${where}: ${r.id} is over its ceiling`);
        const ratio = r.w / r.h;
        assert.ok(
          ratio >= ROOM_RATIO_MIN - EPS && ratio <= ROOM_RATIO_MAX + EPS,
          `${where}: ${r.id}`,
        );
        const bare = bareFloorShare(r);
        assert.ok(bare <= 0.45 + 1e-9, `${where}: ${r.id} is ${(bare * 100).toFixed(1)}% bare`);
      }
      const areas = rooms.map((/** @type {any} */ r) => r.w * r.h);
      assert.ok(Math.max(...areas) / Math.min(...areas) <= ROOM_AREA_SPREAD_MAX + EPS, where);
      assert.deepEqual(plan.proportions.faults, [], where);
      // The majority, or four fifths of all they may be.
      const share = plan.proportions.shares.rooms;
      assert.ok(
        share >= ROOMS_AREA_MIN - EPS || plan.proportions.ceilingReach >= ROOMS_CEILING_REACH - EPS,
        `${where}: rooms ${(share * 100).toFixed(0)}%`,
      );
      // Drawn between the two scales the renderer has, over the whole window.
      // (`large` on the laptop window scrolls at the smallest, as it did.)
      assert.ok(fill.scale >= SCALE_MIN_PX_PER_UNIT - EPS, `${where}: ${fill.scale}`);
      assert.ok(fill.scale <= CHAR_MAX_PX_PER_UNIT + EPS, `${where}: ${fill.scale}`);
      assert.ok(
        Math.min(fill.coverW, fill.coverH) >= WINDOW_FILL_MIN,
        `${where}: the building covers ${fill.coverW.toFixed(2)} x ${fill.coverH.toFixed(2)}`,
      );
      // And a hall is inside the building: what the rooms leave is still floor.
      const tiled = plan.rooms.reduce(
        (/** @type {number} */ a, /** @type {any} */ r) => a + r.w * r.h,
        0,
      );
      assert.ok(Math.abs(tiled / (plan.width * plan.height) - 1) < 1e-6, `${where}: not tiled`);
    }
    resetAgentScale();
  });
}

test('a floor of many rooms is laid as it was: `large`, room for room', () => {
  // Taken before the ceilings existed. Its rooms were under them already.
  const before = ['847ebba9', '893d4873', '92bf23e2', '49676056'];
  assert.deepEqual(
    WINDOWS.map((win) => rectHash(planAt('large', win).plan)),
    before,
  );
  // `crowded` is the same floor on the laptop window, where its rooms were
  // under them too. On the three larger ones its one-desk rooms were 880 to
  // 1,520 U²: they are 840 now, the rooms are still the majority, and the
  // building is drawn larger for it.
  assert.equal(rectHash(planAt('crowded', [1366, 768]).plan), '8d3a5b36');
  for (const win of WINDOWS.slice(0, 3)) {
    const { plan, fill } = planAt('crowded', win);
    assert.ok(plan.proportions.shares.rooms >= ROOMS_AREA_MIN - EPS, `${win}`);
    assert.ok(fill.scale >= 12.5, `${win}: ${fill.scale.toFixed(1)} px a unit`);
  }
  resetAgentScale();
});

test('one to three projects: the building is drawn larger, and with the size left to the floor nobody is lost', () => {
  // What a person at a desk measures, crown to floor: the figure less the
  // drop of a desk seat (`SEAT_DROP.desk`, a tenth of the frame unit).
  const seated = (/** @type {number} */ scale) => (BODY_HEIGHT_U - 0.1 * RIG_UNIT_U) * scale;
  /** Pixels a unit on these floors before a room had a ceiling. */
  const was = { single: 16.3, pair: 12.0, three: 16.5, worktrees: 16.8 };
  for (const name of FEW) {
    const at = planAt(name, [1600, 1000]);
    assert.ok(
      at.fill.scale >= was[/** @type {keyof typeof was} */ (name)] - 0.05,
      `${name}: ${at.fill.scale.toFixed(1)} px a unit, where it was ${was[/** @type {keyof typeof was} */ (name)]}`,
    );
    // `auto`: the count, and then the scale — a floor still at the nominal
    // scale one size up is laid at it.
    const auto = planAt(name, [1600, 1000], 'auto');
    assert.equal(auto.plan.agentSize, 'large', name);
    const px = seated(auto.fill.scale);
    assert.ok(px >= 48, `${name}: a seated figure is ${px.toFixed(1)} px tall`);
    assert.ok(
      BODY_HEIGHT_U * auto.fill.scale <= BODY_MAX_PX + EPS,
      `${name}: over the body's ceiling`,
    );
    resetAgentScale();
  }
});
