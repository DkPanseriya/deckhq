/**
 * The interior designer's rulebook, as arithmetic (`plan-proportions.js`).
 *
 * These are the rules themselves, over made-up rectangles. Whether the floors
 * the product draws keep them is `floor-proportions.test.mjs`, which measures
 * real plans with the same `measureProportions` this file checks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIGHTS_OFF_DIM,
  LOUNGE_SHARE_MAX,
  MODULE_WEIGHTS,
  OFFICE_SHARE_MAX,
  PINNED_SPREAD,
  PINNED_WEIGHT,
  ROOMS_SHARE_MIN,
  ROOM_AREA_SPREAD_MAX,
  ROOM_RATIO_MAX,
  ROOM_RATIO_MIN,
  ROWS_MAX,
  ROW_DEPTH_SPREAD_MAX,
  corridorsBetween,
  dealRows,
  layGrid,
  measureProportions,
  moduleFor,
  pinnedWeight,
  proportionFaults,
  restingOnFloor,
  splitRow,
} from '../../public/render/plan-proportions.js';

const EPS = 1e-6;
const sum = (list) => list.reduce((a, v) => a + v, 0);

test('the budget adds up: rooms, office and lounge leave floor for the corridors', () => {
  assert.equal(ROOMS_SHARE_MIN, 0.55);
  assert.equal(OFFICE_SHARE_MAX, 0.2);
  assert.equal(LOUNGE_SHARE_MAX, 0.25);
  // Both caps met at once still leave the rooms their floor and nothing over.
  assert.ok(ROOMS_SHARE_MIN + OFFICE_SHARE_MAX + LOUNGE_SHARE_MAX <= 1 + EPS);
  assert.ok(ROOM_RATIO_MIN === 0.7 && ROOM_RATIO_MAX === 1.8);
  assert.ok(ROWS_MAX === 3 && ROW_DEPTH_SPREAD_MAX === 0.15);
  assert.ok(LIGHTS_OFF_DIM > 0.3 && LIGHTS_OFF_DIM < 0.4);
});

test('three modules, in the ratio 1 : 1.5 : 2.25, and two steps stay under the spread', () => {
  assert.deepEqual({ ...MODULE_WEIGHTS }, { S: 1, M: 1.5, L: 2.25 });
  assert.ok(MODULE_WEIGHTS.L / MODULE_WEIGHTS.S <= ROOM_AREA_SPREAD_MAX);
  assert.equal(moduleFor({ desks: 0 }), 'S');
  assert.equal(moduleFor({ desks: 1 }), 'S');
  assert.equal(moduleFor({ desks: 2 }), 'M');
  assert.equal(moduleFor({ desks: 4 }), 'M');
  assert.equal(moduleFor({ desks: 5 }), 'L');
  assert.equal(moduleFor({ desks: 30 }), 'L');
  assert.equal(moduleFor({ desks: 1, crew: 3 }), 'M', 'a small crew is a team room');
  assert.equal(moduleFor({ desks: 1, crew: 6 }), 'L', 'a crew of six is a large one');
  assert.equal(moduleFor({}), 'S');
});

test('a pinned room is small, and never so small the largest room is past the spread', () => {
  assert.equal(pinnedWeight([1, 1]), PINNED_WEIGHT);
  assert.equal(pinnedWeight([]), PINNED_WEIGHT);
  const beside = pinnedWeight([1, 2.25]);
  assert.ok(2.25 / beside <= PINNED_SPREAD + EPS);
  assert.ok(PINNED_SPREAD < ROOM_AREA_SPREAD_MAX);
});

test('every row touches a corridor, and one corridor serves the row either side', () => {
  assert.deepEqual(corridorsBetween(1), []);
  assert.deepEqual(corridorsBetween(2), [true]);
  assert.deepEqual(corridorsBetween(3), [true, true]);
  assert.deepEqual(corridorsBetween(4), [true, false, true]);
  assert.deepEqual(corridorsBetween(5), [true, false, true, true]);
  for (let rows = 2; rows <= 8; rows++) {
    const under = corridorsBetween(rows);
    for (let k = 0; k < rows; k++) {
      assert.ok(under[k] || under[k - 1], `row ${k + 1} of ${rows} touches no corridor`);
    }
  }
});

test('a row is shared by weight, and the widths sum to the row exactly', () => {
  const widths = splitRow([1, 1.5, 2.25], 95, 26);
  assert.ok(widths);
  assert.ok(Math.abs(sum(widths) - 95) < 1e-9);
  assert.ok(Math.abs(widths[1] / widths[0] - 1.5) < 1e-6);
  assert.ok(Math.abs(widths[2] / widths[0] - 2.25) < 1e-6);
});

test('no room in a row is a strip or a slot: the shape bounds hold where the weights would break them', () => {
  // By weight alone the first room would be 10 wide in a row 20 deep (0.5:1).
  const widths = splitRow([1, 3, 3], 70, 20);
  assert.ok(widths);
  assert.ok(Math.abs(sum(widths) - 70) < 1e-9);
  for (const w of widths) {
    assert.ok(w / 20 >= ROOM_RATIO_MIN - EPS && w / 20 <= ROOM_RATIO_MAX + EPS, `${w} x 20`);
  }
  assert.ok(Math.abs(widths[0] - 14) < 1e-6, 'the small room is held at 0.7 of the depth');
});

test('a row with too many rooms, or too few, has no legal split', () => {
  assert.equal(splitRow([1, 1, 1, 1, 1], 60, 20), null, 'five rooms of 12 x 20 are slots');
  assert.equal(splitRow([1], 60, 20), null, 'one room of 60 x 20 is a strip');
  assert.equal(splitRow([], 60, 20), null);
});

test('a room is never laid narrower than its furniture', () => {
  const desks = [{ w: 30, h: 18 }];
  const widths = splitRow([1, 1, 1], 75, 20, [desks]);
  assert.ok(widths);
  assert.ok(widths[0] >= 30 - EPS);
  assert.ok(Math.abs(sum(widths) - 75) < 1e-9);
  // Furniture too deep for the row has nowhere to stand in it.
  assert.equal(splitRow([1, 1], 40, 20, [[{ w: 15, h: 24 }]]), null);
  // And a second way of standing it, shallower and wider, is taken.
  const turned = splitRow([1, 1], 40, 20, [
    [
      { w: 15, h: 24 },
      { w: 22, h: 17 },
    ],
  ]);
  assert.ok(turned && turned[0] >= 22 - EPS);
});

test('rooms are dealt in floor order, every row is used, and no cell is left over', () => {
  const weights = [1, 1, 1.5, 1, 2.25, 1, 1];
  const bands = [
    { w: 100, d: 30 },
    { w: 100, d: 30 },
  ];
  const deal = dealRows(weights, bands);
  assert.ok(deal);
  assert.equal(deal.starts[0], 0);
  assert.ok(deal.starts[1] > 0 && deal.starts[1] < weights.length);
  assert.equal(sum(deal.widths.map((w) => w.length)), weights.length);
  for (const [k, widths] of deal.widths.entries()) {
    assert.ok(Math.abs(sum(widths) - bands[k].w) < 1e-9, `row ${k} does not fill its width`);
  }
  assert.equal(dealRows([1], bands), null, 'two rows need two rooms');
});

test('a short last row stretches its rooms inside the shape bounds', () => {
  // Five equal rooms in two equal rows: three and two.
  const grid = layGrid(
    [1, 1, 1, 1, 1],
    [
      { x: 0, y: 0, w: 90, d: 30 },
      { x: 0, y: 34, w: 90, d: 30 },
    ],
  );
  assert.ok(grid);
  const rows = [0, 1].map((k) => grid.cells.filter((c) => c.row === k));
  assert.deepEqual(rows.map((r) => r.length).sort(), [2, 3]);
  for (const c of grid.cells) {
    const ratio = c.w / c.h;
    assert.ok(ratio >= ROOM_RATIO_MIN - EPS && ratio <= ROOM_RATIO_MAX + EPS);
  }
  assert.ok(grid.spread <= ROOM_AREA_SPREAD_MAX + EPS);
  assert.ok(Math.abs(grid.spread - 1.5) < 1e-6);
});

test('the grid tiles its bands: cells abut, start at the band and end at its edge', () => {
  const bands = [
    { x: 40, y: 0, w: 80, d: 28 },
    { x: 60, y: 32, w: 60, d: 30 },
  ];
  const grid = layGrid([1, 1.5, 1, 1, 2.25], bands);
  assert.ok(grid);
  for (const [k, band] of bands.entries()) {
    const cells = grid.cells.filter((c) => c.row === k);
    assert.ok(cells.length > 0);
    assert.ok(Math.abs(cells[0].x - band.x) < 1e-9);
    for (let i = 1; i < cells.length; i++) {
      assert.ok(Math.abs(cells[i].x - (cells[i - 1].x + cells[i - 1].w)) < 1e-9);
    }
    const last = cells[cells.length - 1];
    assert.ok(Math.abs(last.x + last.w - (band.x + band.w)) < 1e-9);
    for (const c of cells) assert.ok(c.y === band.y && c.h === band.d);
  }
});

test('where the modules cannot hold the spread, the family is flattened, not broken', () => {
  // A large room and a small one share a row, beside a row of two small ones.
  // By weight the large room would be 2.25x its neighbour and 2.6x the rooms
  // in the other row; flattened, every room is inside the spread.
  const grid = layGrid(
    [2.25, 1, 1, 1],
    [
      { x: 0, y: 0, w: 78, d: 30 },
      { x: 0, y: 34, w: 42, d: 30 },
    ],
  );
  assert.ok(grid);
  assert.ok(grid.flatten < 1, 'the family was not flattened');
  assert.ok(grid.spread <= ROOM_AREA_SPREAD_MAX + EPS);
  // And a grid nothing can save says so.
  assert.equal(layGrid([1, 1], [{ x: 0, y: 0, w: 200, d: 20 }]), null);
});

test('the lounge draws its seats and one standing row; the rest are the chip', () => {
  assert.deepEqual(restingOnFloor(5, 11, 14), { seated: 5, standing: 0, chip: 0 });
  assert.deepEqual(restingOnFloor(20, 11, 14), { seated: 11, standing: 9, chip: 0 });
  assert.deepEqual(restingOnFloor(79, 22, 30), { seated: 22, standing: 30, chip: 27 });
  assert.deepEqual(restingOnFloor(0, 11, 14), { seated: 0, standing: 0, chip: 0 });
  // Nobody is lost: the three always sum to the people asked for.
  for (const n of [0, 1, 11, 12, 40, 79, 300]) {
    const got = restingOnFloor(n, 22, 30);
    assert.equal(got.seated + got.standing + got.chip, n);
  }
});

/** A plan of bare rectangles: the measurement reads nothing else. */
function sketch(rooms, width = 100, height = 60) {
  return { width, height, rooms };
}

test('the measurement is areas over the building, and a row is a shared top edge', () => {
  const plan = sketch([
    { kind: 'office', x: 0, y: 0, w: 30, h: 28 },
    { kind: 'project', x: 30, y: 0, w: 35, h: 28 },
    { kind: 'project', x: 65, y: 0, w: 35, h: 28 },
    { kind: 'corridor', x: 0, y: 28, w: 100, h: 4 },
    { kind: 'lounge', x: 0, y: 32, w: 40, h: 28 },
    { kind: 'project', x: 40, y: 32, w: 30, h: 28 },
    { kind: 'project', x: 70, y: 32, w: 30, h: 28 },
  ]);
  const m = measureProportions(plan);
  assert.equal(m.rooms, 4);
  assert.equal(m.rows, 2);
  assert.ok(Math.abs(m.shares.office - 0.14) < 1e-9);
  assert.ok(Math.abs(m.shares.lounge - (40 * 28) / 6000) < 1e-9);
  assert.ok(Math.abs(m.shares.rooms - (130 * 28) / 6000) < 1e-9);
  assert.ok(Math.abs(sum(Object.values(m.shares)) - 1) < 1e-9, 'the sketch tiles its building');
  assert.ok(Math.abs(m.ratioMin - 30 / 28) < 1e-9 && Math.abs(m.ratioMax - 35 / 28) < 1e-9);
  assert.ok(Math.abs(m.areaSpread - 35 / 30) < 1e-9);
  assert.equal(m.rowDepthSpread, 0);
  assert.deepEqual(proportionFaults(m), []);
});

test("the owner's floor, as it was, breaks five of the rules and says which", () => {
  // 2000 x 1185: one hall, four strips under it, a lounge across the building.
  const plan = sketch(
    [
      { kind: 'office', x: 0, y: 0, w: 49, h: 31 },
      { kind: 'project', x: 49, y: 0, w: 100, h: 21 },
      { kind: 'project', x: 49, y: 21, w: 25, h: 10 },
      { kind: 'project', x: 74, y: 21, w: 25, h: 10 },
      { kind: 'project', x: 99, y: 21, w: 25, h: 10 },
      { kind: 'project', x: 124, y: 21, w: 25, h: 10 },
      { kind: 'corridor', x: 0, y: 31, w: 149, h: 4 },
      { kind: 'lounge', x: 0, y: 35, w: 149, h: 37 },
    ],
    149,
    72,
  );
  const faults = proportionFaults(measureProportions(plan));
  assert.equal(faults.length, 5, faults.join('\n'));
  assert.match(faults[0], /project rooms have 28\.9%/);
  assert.match(faults[1], /the lounge has 51\.4%/);
  assert.match(faults[2], /a room is 2\.50:1 or 4\.76:1/);
  assert.match(faults[3], /8\.40x the smallest/);
  assert.match(faults[4], /row depths differ by 110\.0%/);
});

test('a floor with no project room is held to none of the room rules', () => {
  const plan = sketch([
    { kind: 'office', x: 0, y: 0, w: 100, h: 28 },
    { kind: 'lounge', x: 0, y: 28, w: 100, h: 32 },
  ]);
  assert.deepEqual(proportionFaults(measureProportions(plan)), []);
});
