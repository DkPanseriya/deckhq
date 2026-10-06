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
import { computeFill } from '../../public/render/scene-camera.js';
import {
  LOUNGE_AREA_MAX,
  OFFICE_AREA_MAX,
  ROOMS_AREA_MIN,
  ROOM_AREA_SPREAD_MAX,
  ROOM_RATIO_MAX,
  ROOM_RATIO_MIN,
  ROWS_LIMIT,
  ROWS_MAX,
  ROW_DEPTH_SPREAD_MAX,
  WINDOW_FILL_MIN,
  measureProportions,
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
