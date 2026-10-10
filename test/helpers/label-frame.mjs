/**
 * ONE FRAME OF A FLOOR, LAID OUT AS `_draw` LAYS IT, with no canvas.
 *
 * Moved out of `test/unit/floor-labels.test.mjs` so a second file can ask the
 * frame's own label pass the same questions of other floors: the real plan,
 * the real seats, the wait badges resolved first, the plates after them, and
 * every name set round all of it, through a context that only measures.
 */

import assert from 'node:assert/strict';

import { largeFloor, LARGE_NOW } from './large-floor.mjs';
import { buildPlan } from '../../public/render/plan.js';
import { assignSeats, worldToScreen } from '../../public/render/agents.js';
import { computeFill } from '../../public/render/scene-camera.js';
import { characterScaleFor, juniorScaleFor, lodForFigure } from '../../public/render/scene-lod.js';
import { rigHeight } from '../../public/render/rig-pose.js';
import {
  badgeBox,
  characterBox,
  formatElapsed,
  formatElapsedShort,
} from '../../public/render/rig.js';
import {
  buildingRect,
  planFrameLabels,
  wallBoxes,
} from '../../public/render/scene-frame-labels.js';
import {
  layoutPlate,
  platePlanFor,
  plateLimit,
  resolveBadgeCollisions,
} from '../../public/render/scene-labels.js';
import { floorPopulation, crewsFrom } from '../../public/floor-rule.js';
import { adoptSnapshotClock } from '../../public/clock.js';

/** Measures like a canvas: width in proportion to the font's px size. */
export function measuringCtx() {
  return {
    font: '10px x',
    measureText(text) {
      const px = parseFloat(/(\d[\d.]*)px/.exec(this.font)?.[1] ?? '10');
      return { width: String(text).length * px * 0.58 };
    },
  };
}

/** @param {any} a @param {any} b do two boxes overlap? */
export const hits = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * The box a label is DRAWN in: its own, or the smaller form the pass chose
 * (`spot.text`/`spot.px`), at the pass's offset.
 * @param {any} item @param {{offsetY:number, offsetX?:number, text?:string, px?:number}} spot
 */
export function drawnBox(item, spot) {
  const form = spot.px ? item.variants.find((v) => v.px === spot.px && v.text === spot.text) : item;
  assert.ok(form, `${item.id}: the pass chose a form the item does not have`);
  return {
    id: item.id,
    x: form.x + (spot.offsetX || 0),
    y: form.y + spot.offsetY,
    w: form.w,
    h: form.h,
  };
}

/** The wait badges of a frame, measured and resolved as the floor does it. */
function waitBadges(ctx, records, camera, charU, uOf) {
  const waits = [];
  for (const rec of records) {
    const a = rec.agent;
    if (a.ackState !== 'active' || a.activityState !== 'for_review' || !a.reviewSince) continue;
    const s = worldToScreen(rec, camera);
    const ms = LARGE_NOW - a.reviewSince;
    const box = badgeBox(ctx, s.x, s.y, charU, formatElapsed(ms));
    const cut = badgeBox(ctx, s.x, s.y, charU, formatElapsedShort(ms));
    const short = cut.w < box.w ? { x: cut.x, w: cut.w } : undefined;
    waits.push({ id: rec.id, x: box.x, y: box.y, w: box.w, h: box.h, ms, short });
  }
  const badgePlan = resolveBadgeCollisions(
    waits,
    records.map((rec) => {
      const s = worldToScreen(rec, camera);
      return { id: rec.id, ...characterBox(s.x, s.y, uOf(rec)) };
    }),
  );
  const badgeBoxes = waits
    .filter((it) => badgePlan.drawn.has(it.id))
    .map((it) => {
      const at = badgePlan.short.has(it.id) && it.short ? it.short : it;
      return { ...it, x: at.x, w: at.w, id: `badge:${it.id}` };
    });
  return { badgePlan, badgeBoxes };
}

/**
 * Build one frame of a floor at a stage, the way `_draw` does. With `badges`,
 * the wait badges are measured and resolved first, as the floor does, and the
 * names are set round them. `zoom` is the reader's own, over the fit; `reduced`
 * is reduced motion, which the frame's pass is told as the floor tells it.
 * @param {number} viewW @param {number} viewH
 * @param {() => {projects:any[], agents:any[]}} [floor]
 * @param {{badges?:boolean, zoom?:number, reduced?:boolean}} [opts]
 */
export function frameAt(viewW, viewH, floor = largeFloor, opts = {}) {
  const { badges = false, zoom = 1, reduced = false } = opts;
  adoptSnapshotClock({ now: LARGE_NOW, nowFixed: true });
  try {
    const { projects, agents } = floor();
    const plan = buildPlan(projects, agents, { stage: { w: viewW, h: viewH }, now: LARGE_NOW });
    const seats = assignSeats(plan, agents);
    const scale = computeFill(plan.width, plan.height, viewW, viewH).scale * zoom;
    const camera = { zoom: scale / 14, panX: 0, panY: 0, U: 14 };
    const charU = characterScaleFor(scale);
    // The scale each figure is DRAWN at: a junior's is one ladder step under
    // everybody else's, in an arc or out of one (WP-99, `_figureScale`).
    const uOf = (rec) => (rec.agent.subagent === true ? juniorScaleFor(scale) : charU);
    const agentsById = new Map(agents.map((a) => [a.id, a]));
    const records = agents
      .filter((a) => seats.has(a.id))
      .map((a) => ({ ...seats.get(a.id), id: a.id, targetSeat: seats.get(a.id), agent: a }))
      .sort((a, b) => a.y - b.y);
    const pop = floorPopulation(agents, { now: LARGE_NOW });
    const snapshot = { projects, agents, counts: { drawn: { waiting: pop.waiting } } };
    const ctx = measuringCtx();
    const crewCounts = new Map(
      crewsFrom(agents, { now: LARGE_NOW }).map((c) => [c.parentId, c.count]),
    );
    const { badgePlan, badgeBoxes } = waitBadges(ctx, badges ? records : [], camera, charU, uOf);
    // After the badges, as the floor lays them: a plate stops short of one.
    const plates = plan.rooms
      .filter((r) => r.kind !== 'corridor')
      .map((room) => ({
        room,
        ...layoutPlate(
          ctx,
          room,
          platePlanFor(room, snapshot, plan),
          camera,
          plateLimit(room, badgeBoxes, camera),
        ),
      }));
    const lod = lodForFigure(rigHeight(charU));
    const view = {
      records,
      agentsById,
      camera,
      charU,
      crewCounts,
      badgeBoxes,
      plateBoxes: plates.map((p) => p.rect),
      wallBoxes: wallBoxes(plan, camera),
      rooms: plan.rooms,
      selectedId: null,
      bounds: buildingRect(plan, camera),
      uOf,
      lod,
      reduced,
    };
    const labels = planFrameLabels(ctx, view);
    const made = { plan, seats, scale, camera, charU, uOf, agents, agentsById, records };
    return { ...made, ctx, view, lod, plates, labels, crewCounts, badgePlan, badgeBoxes };
  } finally {
    adoptSnapshotClock(null);
  }
}
