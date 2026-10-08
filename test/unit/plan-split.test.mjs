/**
 * The row split, against its definition.
 *
 * `splitRow` and `dealRows` were rewritten to be cheap on a floor of many
 * rooms: the rooms of a row are a span of the floor's arrays instead of a copy
 * cut for the question, every room's bounds are measured once per depth, and
 * rows that are the same row share an answer (`plan-split.js`,
 * `plan-proportions.js`). A faster split that lays a different floor is a
 * regression nobody would see until a room moved in a golden, so the two below
 * are the functions as they were written before, kept here as the definition,
 * and the shipped ones are held to them TO THE BIT, over thousands of rows a
 * seeded generator makes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HALL_WIDTH_MIN,
  ROOM_RATIO_IDEAL,
  ROOM_RATIO_MAX,
  ROOM_RATIO_MIN,
  dealRows,
  splitRow,
  widestIn,
} from '../../public/render/plan-proportions.js';

const EPS = 1e-6;

// ------------------------------------------------------------ the definition

function narrowestRef(footprints, depth) {
  let furniture = 0;
  if (Array.isArray(footprints) && footprints.length) {
    furniture = Infinity;
    for (const f of footprints) if (f.h <= depth + EPS) furniture = Math.min(furniture, f.w);
  }
  return Math.max(ROOM_RATIO_MIN * depth, furniture);
}

function splitRowRef(
  weights,
  width,
  depth,
  footprints = [],
  give = 0,
  caps = [],
  spare = 0,
  loose = false,
) {
  const n = weights.length;
  if (!n || !(width > 0) || !(depth > 0)) return null;
  const hi = weights.map((_, i) => widestIn(depth, caps[i]));
  const lo = weights.map((_, i) => narrowestRef(footprints[i], depth));
  if (lo.some((v, i) => v > hi[i] + EPS)) return null;
  let least = 0;
  for (const v of lo) least += v;
  if (least > width + EPS) return null;
  let most = 0;
  for (const v of hi) most += v;
  if (most < width - EPS) {
    const left = width - most;
    if (left <= give + EPS) return hi;
    const shape = ROOM_RATIO_MAX * depth;
    const held = loose || hi.every((v) => v < shape - EPS);
    if (!held || left > spare + EPS) return null;
    if (left >= HALL_WIDTH_MIN - EPS) return hi;
    return splitRowRef(weights, width - HALL_WIDTH_MIN, depth, footprints, 0, caps, 0);
  }
  const out = Array(n).fill(-1);
  let rest = width;
  let open = 0;
  for (const m of weights) open += m;
  for (let pass = 0; pass <= n; pass++) {
    const k = rest / Math.max(1e-12, open);
    let under = 0;
    let over = 0;
    for (let i = 0; i < n; i++) {
      if (out[i] >= 0) continue;
      const v = k * weights[i];
      if (v < lo[i]) under += lo[i] - v;
      else if (v > hi[i]) over += v - hi[i];
    }
    const low = under >= over;
    let held = false;
    for (let i = 0; i < n; i++) {
      if (out[i] >= 0) continue;
      const v = k * weights[i];
      if (under + over <= EPS) out[i] = v;
      else if (low ? v < lo[i] : v > hi[i]) {
        out[i] = low ? lo[i] : hi[i];
        rest -= out[i];
        open -= weights[i];
        held = true;
      }
    }
    if (!held) break;
  }
  let widest = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += out[i];
    if (out[i] > out[widest]) widest = i;
  }
  out[widest] += width - total;
  return out;
}

const leaves = (b) => Math.max(b.give ?? 0, b.spare ?? 0);

function dealRowsRef(weights, bands, footprints = [], caps = []) {
  const n = weights.length;
  const rows = bands.length;
  if (!rows || n < rows) return null;
  const total = weights.reduce((a, v) => a + v, 0);
  const ceiling = caps.length === n ? caps.reduce((a, v) => a + v, 0) : Infinity;
  const floor = bands.reduce((a, b) => a + b.w * b.d, 0);
  const unit = Math.min(ceiling, floor) / Math.max(1e-9, total);
  const most = bands.map((b) => Math.floor(b.w / (ROOM_RATIO_MIN * b.d) + EPS));
  const fewest = bands.map((b) =>
    Math.max(1, Math.ceil((b.w - leaves(b)) / (ROOM_RATIO_MAX * b.d) - EPS)),
  );
  const sumOf = (list) => list.reduce((a, v) => a + v, 0);
  if (n > sumOf(most) || n < sumOf(fewest)) return null;
  const span = n + 1;
  const memo = new Array(rows * span * span);
  const row = (k, i, j) => {
    if (j - i > most[k] || j - i < fewest[k]) return null;
    const key = (k * span + i) * span + j;
    const known = memo[key];
    if (known !== undefined) return known;
    const band = bands[k];
    const widths = splitRowRef(
      weights.slice(i, j),
      band.w,
      band.d,
      footprints.slice(i, j),
      band.give ?? 0,
      caps.slice(i, j),
      band.spare ?? 0,
      band.loose === true,
    );
    let got = null;
    if (widths) {
      let cost = 0;
      widths.forEach((w, at) => {
        const size = Math.log((w * band.d) / (unit * weights[i + at]));
        const shape = Math.log(w / band.d / ROOM_RATIO_IDEAL);
        cost += size * size + 0.25 * shape * shape;
      });
      got = { cost, widths };
    }
    memo[key] = got;
    return got;
  };
  const cost = new Float64Array((rows + 1) * span).fill(Infinity);
  const from = new Int32Array((rows + 1) * span).fill(-1);
  cost[0] = 0;
  for (let k = 1; k <= rows; k++) {
    for (let j = k; j <= n - (rows - k); j++) {
      for (let i = Math.max(k - 1, j - most[k - 1]); i <= j - fewest[k - 1]; i++) {
        const before = cost[(k - 1) * span + i];
        if (before === Infinity) continue;
        const got = row(k - 1, i, j);
        if (!got) continue;
        if (before + got.cost < cost[k * span + j] - 1e-12) {
          cost[k * span + j] = before + got.cost;
          from[k * span + j] = i;
        }
      }
    }
  }
  if (cost[rows * span + n] === Infinity) return null;
  const starts = Array(rows).fill(0);
  const widths = Array(rows).fill(null);
  for (let k = rows, j = n; k >= 1; k--) {
    const i = from[k * span + j];
    starts[k - 1] = i;
    widths[k - 1] = row(k - 1, i, j).widths;
    j = i;
  }
  return { starts, widths };
}

// ----------------------------------------------------------------- the rows

/** A seeded generator: the same rows on every machine, and no `Math.random`. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A floor's worth of rooms, in the family the planner deals with. */
function rooms(rnd, n) {
  const weights = [];
  const footprints = [];
  const caps = [];
  for (let i = 0; i < n; i++) {
    const w = [1, 1.5, 2.25][Math.floor(rnd() * 3)];
    weights.push(rnd() < 0.2 ? Math.pow(w, 0.7) : w);
    const ways = Math.floor(rnd() * 3);
    footprints.push(
      ways === 0
        ? undefined
        : Array.from({ length: ways }, () => ({ w: 4 + rnd() * 14, h: 4 + rnd() * 12 })),
    );
    caps.push(rnd() < 0.3 ? 0 : 60 + rnd() * 400);
  }
  return { weights, footprints, caps };
}

test('splitRow is its definition, to the bit, over ten thousand rows', () => {
  const rnd = seeded(20261008);
  let split = 0;
  for (let c = 0; c < 10_000; c++) {
    const n = 1 + Math.floor(rnd() * 9);
    const { weights, footprints, caps } = rooms(rnd, n);
    const depth = 6 + rnd() * 16;
    const width = n * depth * (0.4 + rnd() * 2.2);
    const give = rnd() < 0.3 ? rnd() * 30 : 0;
    const spare = rnd() < 0.3 ? (rnd() < 0.5 ? Infinity : rnd() * 20) : 0;
    const loose = rnd() < 0.3;
    const useCaps = rnd() < 0.6 ? caps : [];
    const want = splitRowRef(weights, width, depth, footprints, give, useCaps, spare, loose);
    const got = splitRow(weights, width, depth, footprints, give, useCaps, spare, loose);
    assert.deepStrictEqual(got, want, `row ${c}`);
    if (got) split++;
  }
  // Both answers are exercised, or the test above proved less than it says.
  assert.ok(split > 2000 && split < 9000, `${split} of 10000 rows had a legal split`);
  assert.equal(splitRow([], 10, 5), null);
  assert.equal(splitRow([1], 0, 5), null);
  assert.equal(splitRow([1], 10, 0), null);
});

test('dealRows is its definition, to the bit — rows that are the same row included', () => {
  const rnd = seeded(8675309);
  let dealt = 0;
  for (let c = 0; c < 1500; c++) {
    const rows = 1 + Math.floor(rnd() * 5);
    const n = rows + Math.floor(rnd() * 22);
    const { weights, footprints, caps } = rooms(rnd, n);
    const depth = 8 + rnd() * 10;
    const width = (n / rows) * depth * (0.7 + rnd() * 1.2);
    // A column's rows are all one row; bands differ at the ends; one row deep.
    const shape = Math.floor(rnd() * 3);
    const bands = Array.from({ length: rows }, (_, k) => {
      const d = shape === 2 && k === 0 ? depth * 1.25 : depth;
      const end = shape === 1 && (k === 0 || k === rows - 1);
      return {
        x: 0,
        y: k * depth,
        w: end ? width - 6 - rnd() * 10 : width,
        d,
        give: end ? rnd() * 12 : 0,
        spare: rnd() < 0.2 ? Infinity : 0,
        loose: rnd() < 0.2,
      };
    });
    const useCaps = rnd() < 0.5 ? caps : [];
    const want = dealRowsRef(weights, bands, footprints, useCaps);
    const got = dealRows(weights, bands, footprints, useCaps);
    assert.deepStrictEqual(got, want, `deal ${c}`);
    if (got) dealt++;
  }
  assert.ok(dealt > 150, `${dealt} of 1500 deals were legal`);
});

test('a row handed back from a deal is nobody else’s array', () => {
  // Two rows that are the same row share a measurement, never a result.
  const bands = [
    { x: 0, y: 0, w: 40, d: 10 },
    { x: 0, y: 10, w: 40, d: 10 },
  ];
  const deal = dealRows([1, 1, 1, 1, 1, 1], bands);
  assert.ok(deal);
  assert.notEqual(deal.widths[0], deal.widths[1]);
  deal.widths[0][0] = -1;
  assert.ok(deal.widths[1].every((w) => w > 0));
  assert.ok(dealRows([1, 1, 1, 1, 1, 1], bands).widths[0][0] > 0);
});
