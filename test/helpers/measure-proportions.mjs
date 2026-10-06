#!/usr/bin/env node
/**
 * Print what the floor's proportions measure, population by window.
 *
 *     node test/helpers/measure-proportions.mjs [population ...]
 *
 * One line per floor: the arrangement and the building, the area shares of
 * the project rooms, the office, the lounge and the corridors, the range of
 * the rooms' shapes, the largest room over the smallest, the row depths'
 * spread, how much of the window the building covers, and every rule of
 * `public/render/plan-proportions.js` the floor breaks. It is the measurement
 * `test/unit/floor-proportions.test.mjs` asserts, printed.
 */

import { buildPlan } from '../../public/render/plan.js';
import { computeFill } from '../../public/render/scene-camera.js';
import { LARGE_NOW, ownerShapedFloor, populationFloor } from './large-floor.mjs';

/** Real windows, and the chrome above the canvas on each. */
const WINDOWS = [
  [1600, 1000],
  [1920, 1080],
  [2000, 1185],
  [1366, 768],
];
const CHROME_H = 130;
const NAMES = ['demo', 'three', 'reference', 'pinned', 'away', 'crew', 'crew-waiting', 'large'];

const asked = process.argv.slice(2);
const names = asked.length ? asked : [...NAMES, 'owner'];
const pct = (/** @type {number} */ v) => `${(v * 100).toFixed(1).padStart(5)}%`;

for (const name of names) {
  const floor = name === 'owner' ? ownerShapedFloor() : populationFloor(name);
  for (const [winW, winH] of WINDOWS) {
    const stage = { w: winW, h: winH - CHROME_H };
    const started = process.hrtime.bigint();
    const plan = buildPlan(floor.projects, floor.agents, { stage, now: LARGE_NOW });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const m = plan.proportions;
    const fill = computeFill(plan.width, plan.height, stage.w, stage.h);
    console.log(
      [
        `${name.padEnd(12)} ${`${winW}x${winH}`.padEnd(9)}`,
        `${plan.arrangement.padEnd(8)} ${plan.width.toFixed(1)}x${plan.height.toFixed(1)}`.padEnd(
          22,
        ),
        `${fill.scale.toFixed(1)}px/U`,
        `rooms ${pct(m.shares.rooms)} office ${pct(m.shares.office)} lounge ${pct(m.shares.lounge)}`,
        `corr ${pct(m.shares.corridors)}`,
        `n=${String(m.rooms).padStart(2)} rows=${m.rows}`,
        `ratio ${m.ratioMin.toFixed(2)}-${m.ratioMax.toFixed(2)}`,
        `spread ${m.areaSpread.toFixed(2)}`,
        `depth ${pct(m.rowDepthSpread)}`,
        `fill ${pct(Math.min(fill.coverW, fill.coverH))}`,
        `${ms.toFixed(0)}ms`,
      ].join('  '),
    );
    for (const fault of m.faults) console.log(`    FAULT ${fault}`);
  }
}
