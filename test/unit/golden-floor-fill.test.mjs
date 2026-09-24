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

/** @param {{sessions:number[], agents:Row[]}} floor @param {number} w @param {number} h */
function planOf(floor, w, h) {
  const projects = floor.sessions.map((n, i) => ({
    id: `p${i}`,
    name: `p${i}`,
    sessionCount: n,
    tokens: 1000 * (i + 1),
    needsYou: 0,
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
