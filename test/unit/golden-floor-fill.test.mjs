/**
 * The floors the goldens photograph fill the stage the canvas is given (WP-99).
 *
 * `floor-integrity.test.mjs` asks WP-59's two questions — is the building the
 * shape of the window, and does it fill it — over sixteen synthetic
 * populations, and none of them is a floor anybody photographs. The `demo`
 * golden was drawn 2.23:1 on a 1.84:1 stage for nine days, a band of ground
 * above and below the building, with every one of those assertions green:
 * the populations were not the demo's, and the stage list held the goldens'
 * WINDOW (1600 x 1000) but not the canvas that window gives the floor once
 * the header and the queue strip are off it (1600 x 870).
 *
 * So these are the goldens' own floors, as `scripts/demo-populations.mjs`
 * hands them to `buildPlan` — room by room and agent by agent, read off a
 * running demo floor — at the stage each capture's canvas actually is.
 * `wide` is the `three` population on a 1920 x 1080 window.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlan, ASPECT_TOLERANCE } from '../../public/render/plan.js';
import { CORRIDOR, MARGIN } from '../../public/render/plan-units.js';
import { computeFill, computeTargetAspect, FILL_MIN_SHORT } from '../../public/render/scene.js';

const NOW = 1_800_000_000_000;
const EPS = 1e-6;

/**
 * One row per agent: `[room, activityState, ackState, minutesAgo, parent]`,
 * `parent` the row index of the agent a junior belongs to, or -1.
 * @typedef {[number, string, string, number, number]} Row
 */

/** @type {Record<string, {sessions:number[], agents:Row[]}>} */
const FLOORS = {
  demo: {
    sessions: [7, 5, 5, 4, 3, 1],
    agents: [
      [0, 'for_review', 'active', 317, -1],
      [1, 'for_review', 'active', 77, -1],
      [1, 'for_review', 'active', 473, -1],
      [4, 'for_review', 'active', 1145, -1],
      [3, 'stalled', 'active', 4, -1],
      [3, 'working', 'active', 7, 6],
      [3, 'working', 'active', 8, -1],
      [3, 'working', 'active', 8, 6],
      [0, 'working', 'active', 131, -1],
      [2, 'working', 'active', 185, -1],
      [0, 'needs_input', 'active', 209, -1],
      [2, 'needs_input', 'active', 275, -1],
      [0, 'ended', 'active', 725, -1],
      [1, 'ended', 'active', 1565, -1],
      [0, 'ended', 'active', 1805, -1],
      [3, 'ended', 'active', 1985, -1],
      [4, 'ended', 'active', 2405, -1],
      [1, 'ended', 'benched', 2645, -1],
      [3, 'ended', 'benched', 2825, -1],
      [0, 'ended', 'benched', 3125, -1],
      [5, 'ended', 'benched', 3305, -1],
      [1, 'ended', 'benched', 3485, -1],
      [2, 'ended', 'active', 3665, -1],
      [4, 'ended', 'benched', 3785, -1],
      [0, 'ended', 'benched', 3965, -1],
      [2, 'ended', 'benched', 4205, -1],
      [2, 'ended', 'benched', 4445, -1],
      [5, 'ended', 'let_go', 5405, -1],
    ],
  },
  three: {
    sessions: [3, 2, 2, 1, 1],
    agents: [
      [0, 'for_review', 'active', 312, -1],
      [2, 'working', 'active', 48, -1],
      [1, 'needs_input', 'active', 72, -1],
      [0, 'working', 'active', 126, -1],
      [2, 'ended', 'benched', 2820, -1],
      [4, 'ended', 'benched', 3300, -1],
      [1, 'ended', 'benched', 3480, -1],
      [3, 'ended', 'benched', 3780, -1],
      [0, 'ended', 'benched', 3960, -1],
    ],
  },
};

/** The captures, each at the stage its canvas gets: the window less 130 px. */
const CAPTURES = /** @type {const} */ ([
  ['demo', 'demo', 1600, 870],
  ['three', 'three', 1600, 870],
  ['wide', 'three', 1920, 950],
]);

/**
 * @param {{sessions:number[], agents:Row[], pinned?:number[]}} floor
 * @param {number} w @param {number} h
 */
function planOf(floor, w, h) {
  const projects = floor.sessions.map((n, i) => ({
    id: `p${i}`,
    name: `p${i}`,
    sessionCount: n,
    tokens: 1000 * (i + 1),
    needsYou: 0,
    pinned: Boolean(floor.pinned?.includes(i)),
  }));
  const agents = floor.agents.map(([room, act, ack, minutes, parent], i) => ({
    id: `a${i}`,
    projectId: `p${room}`,
    activityState: act,
    ackState: ack,
    reviewSince: act === 'for_review' ? NOW - minutes * 60_000 : null,
    lastActivityAt: NOW - minutes * 60_000,
    subagent: parent >= 0,
    parentId: parent >= 0 ? `a${parent}` : null,
  }));
  return buildPlan(projects, agents, { now: NOW, stage: { w, h }, goneHomeDays: 7 });
}

for (const [name, floorName, w, h] of CAPTURES) {
  test(`the ${name} golden's building is the shape of its ${w} x ${h} stage, and fills it`, () => {
    const plan = planOf(FLOORS[floorName], w, h);
    const stageAspect = computeTargetAspect(w, h);
    const aspect = plan.width / plan.height;
    const off = Math.abs(Math.log(aspect / stageAspect));
    assert.ok(
      off <= Math.log(1 + ASPECT_TOLERANCE) + EPS,
      `${name}: a ${plan.arrangement} building ${aspect.toFixed(2)}:1 on a ` +
        `${stageAspect.toFixed(2)}:1 stage, ${((Math.exp(off) - 1) * 100).toFixed(0)}% off`,
    );
    const fill = computeFill(plan.width, plan.height, w, h);
    if (fill.capped) return;
    assert.ok(
      fill.coverH >= FILL_MIN_SHORT - EPS,
      `${name}: the building covers ${(fill.coverH * 100).toFixed(0)}% of the stage's height`,
    );
  });
}

// ------------------------------------------ audit F2 and F3: the window, filled

/**
 * `scripts/demo-populations.mjs`'s `reference` floor, as the same compact
 * table: eighteen repos of 13 down to 1 sessions, 47 benched, one working, two
 * waiting on review, the rest idle — ages in whole hours from two to a month.
 * @returns {{sessions:number[], agents:Row[]}}
 */
function referenceFloor() {
  const sessions = [13, 9, 7, 6, 5, 4, 4, 3, 3, 3, 3, 2, 2, 2, 1, 1, 1, 1];
  /** @type {Row[]} */
  const agents = [];
  let n = 0;
  let benched = 0;
  sessions.forEach((count, room) => {
    for (let k = 0; k < count; k++, n++) {
      const minutes = (2 + ((n * 37) % 120) * 6) * 60;
      if (n === 0) agents.push([room, 'working', 'active', minutes, -1]);
      else if (n < 3) agents.push([room, 'for_review', 'active', minutes, -1]);
      else if (benched < 47 && n % 10 !== 5) {
        benched++;
        agents.push([room, 'ended', 'benched', minutes, -1]);
      } else agents.push([room, 'ended', 'active', minutes, -1]);
    }
  });
  return { sessions, agents };
}

/**
 * The owner's floor from the audit, anonymised to its counts: twelve waiting on
 * review, thirty-three in the lounge, one senior at a desk with a crew of
 * thirteen, and five more one-desk rooms. It is the floor that drew a column
 * 133.9 x 86 on every window from 1420 x 690 to 2560 x 1310 — a quarter of the
 * width dark, and a 83.9 x 14.8 U corridor under the rooms.
 * @returns {{sessions:number[], agents:Row[]}}
 */
function ownerFloor() {
  /** @type {Row[]} */
  const agents = [];
  for (let k = 0; k < 12; k++) agents.push([k % 6, 'for_review', 'active', 5 + k, -1]);
  for (let k = 0; k < 33; k++)
    agents.push([k % 6, 'ended', k % 2 ? 'benched' : 'active', 20 + k, -1]);
  const senior = agents.length;
  agents.push([0, 'working', 'active', 1, -1]);
  for (let k = 1; k <= 5; k++) agents.push([k, 'working', 'active', 2 + k, -1]);
  for (let k = 0; k < 13; k++) agents.push([0, 'working', 'active', 1, senior]);
  const sessions = [0, 0, 0, 0, 0, 0];
  for (const [room, , , , parent] of agents) if (parent < 0) sessions[room]++;
  return { sessions, agents };
}

/**
 * A large floor: 150 agents over 40 repos, every state, ages spread over five
 * hours. Deterministic, so the plan is a pure function of it.
 * @returns {{sessions:number[], agents:Row[]}}
 */
function largeFloor() {
  const states = /** @type {const} */ ([
    ['working', 'active'],
    ['ended', 'benched'],
    ['ended', 'active'],
    ['for_review', 'active'],
    ['working', 'active'],
    ['needs_input', 'active'],
    ['ended', 'benched'],
    ['ended', 'active'],
    ['stalled', 'active'],
    ['ended', 'benched'],
  ]);
  const sessions = Array.from({ length: 40 }, () => 0);
  /** @type {Row[]} */
  const agents = [];
  for (let i = 0; i < 150; i++) {
    const room = (i * 7) % 40;
    const [act, ack] = states[i % states.length];
    sessions[room]++;
    agents.push([room, act, ack, 1 + ((i * 13) % 300), -1]);
  }
  return { sessions, agents };
}

/** @type {Record<string, {sessions:number[], agents:Row[], pinned?:number[]}>} */
const FILLED = {
  demo: FLOORS.demo,
  three: FLOORS.three,
  pinned: { ...FLOORS.three, pinned: [3] },
  reference: referenceFloor(),
  owner: ownerFloor(),
  large: largeFloor(),
};

/** Real windows, and the canvas each gives the floor once the chrome is off it. */
const WINDOWS = [
  [1600, 1000],
  [1920, 1080],
  [2000, 1154],
  [2000, 1182],
  [2560, 1440],
  [1366, 768],
];
const CHROME_H = 130;

/** Audit F2's number: the building covers this much of both axes. */
const FILL_BOTH_MIN = 0.96;

for (const [name, floor] of Object.entries(FILLED)) {
  test(`${name}: the building fills the window on both axes, at every real window size`, () => {
    for (const [winW, winH] of WINDOWS) {
      const [w, h] = [winW, winH - CHROME_H];
      const plan = planOf(floor, w, h);
      const fill = computeFill(plan.width, plan.height, w, h);
      const where = `${name} at ${winW}x${winH}: a ${plan.arrangement} ${plan.width.toFixed(1)} x ${plan.height.toFixed(1)}`;
      assert.ok(!fill.capped, `${where} is held back by the character cap`);
      assert.ok(
        Math.min(fill.coverW, fill.coverH) >= FILL_BOTH_MIN,
        `${where} covers ${(fill.coverW * 100).toFixed(1)}% of the width and ` +
          `${(fill.coverH * 100).toFixed(1)}% of the height`,
      );
      // No band of ground either side wider than the envelope's own margin.
      const bandW = (Math.max(0, 1 - fill.coverW) * w) / 2;
      const bandH = (Math.max(0, 1 - fill.coverH) * h) / 2;
      assert.ok(
        Math.max(bandW, bandH) <= MARGIN * fill.scale + 0.5,
        `${where} leaves a band of ground ${Math.max(bandW, bandH).toFixed(0)} px wide, ` +
          `past the ${(MARGIN * fill.scale).toFixed(0)} px margin`,
      );
    }
  });

  test(`${name}: no open floor under the rooms bigger than a corridor square (F3)`, () => {
    for (const [winW, winH] of WINDOWS) {
      const plan = planOf(floor, winW, winH - CHROME_H);
      for (const r of plan.rooms) {
        if (r.kind !== 'corridor' || r.thoroughfare !== false) continue;
        // The pinned strip's gap is WP-77's and not this: a room somebody kept
        // is laid small on purpose, beside floor held for the next one pinned.
        if (r.id.startsWith('__pinned-')) continue;
        assert.ok(
          r.w * r.h <= CORRIDOR * CORRIDOR + 1e-6,
          `${name} at ${winW}x${winH}: ${r.id} is ${r.w.toFixed(1)} x ${r.h.toFixed(1)} U of ` +
            `open floor in a ${plan.arrangement} building`,
        );
      }
    }
  });
}
