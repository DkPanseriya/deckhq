/**
 * The pose, and the arithmetic that turns it into limbs (WP-22 follow-up).
 *
 * Split out of `rig.js` unchanged: the two sides, the pose defaults every
 * caller merges into, the hand-rolled rotate-then-translate that replaces
 * `ctx.save`/`rotate`/`restore` per limb, the arm solve, and the rounded
 * rectangle every panel and bubble is built from.
 *
 * The scratch numbers are module scope on purpose: `drawCharacter` allocates
 * no objects or arrays per call, which is what holds 25 animated characters
 * at 60 fps (docs/02-ARCHITECTURE.md §8).
 */

import { SHOULDER_OFFSET_X, SHOULDER_OFFSET_Y, ARM_LEN1, ARM_LEN2 } from './rig-metrics.js';

export const SIDES = [1, -1]; // right, left — a module constant, never reallocated

// -------------------------------------------------------------------- pose

/** @returns {import('./clips.js').Pose} */
export function defaultPose() {
  return {
    bodyAngle: 0,
    lean: 0,
    headTurn: 0,
    armL: { shoulder: 0, elbow: 0, hand: 'rest' },
    armR: { shoulder: 0, elbow: 0, hand: 'rest' },
    legPhase: 0,
    seated: false,
    prop: null,
    bob: 0,
    ring: false,
    ringPhase: 0,
    fingerPhase: 0,
    thoughtPhase: 0,
    speechPhase: 0,
  };
}

export function mergeInto(base, partial) {
  const out = { ...base, armL: { ...base.armL }, armR: { ...base.armR } };
  for (const key of Object.keys(partial)) {
    if (key === 'armL' || key === 'armR') out[key] = { ...out[key], ...partial[key] };
    else out[key] = partial[key];
  }
  return out;
}

/**
 * Builds a complete Pose (VISUAL-SPEC §3), starting from rest and applying
 * `overrides` on top. `armL`/`armR` overrides merge one level deep.
 * @param {Partial<import('./clips.js').Pose>} [overrides]
 * @returns {import('./clips.js').Pose}
 */
export function makePose(overrides) {
  const base = defaultPose();
  return overrides ? mergeInto(base, overrides) : base;
}

// ------------------------------------------------------------- local rotate

// Scratch outputs for rotateLocal — avoids allocating a {x,y} pair per call.
// Safe because drawCharacter runs synchronously to completion per character;
// nothing re-enters rotateLocal while a previous result is still pending.
export let _rx = 0;
export let _ry = 0;
export function rotateLocal(lx, ly, cosA, sinA) {
  _rx = lx * cosA - ly * sinA;
  _ry = lx * sinA + ly * cosA;
}

// Scratch world-space arm joint positions, filled by computeArmGeometry and
// read by drawArmStroke / drawFingerTicks / prop drawers. Two full sets
// (right, left) so prop-behind can be drawn before the arm strokes and
// prop-front can be drawn after hair, per the normative draw order.
export let _rSx = 0,
  _rSy = 0,
  _rEx = 0,
  _rEy = 0,
  _rHx = 0,
  _rHy = 0;
export let _lSx = 0,
  _lSy = 0,
  _lEx = 0,
  _lEy = 0,
  _lHx = 0,
  _lHy = 0;

export function computeArmGeometry(ox, oy, cosA, sinA, u, side, shoulder, elbow) {
  const sOffX = SHOULDER_OFFSET_X * side;
  const sOffY = SHOULDER_OFFSET_Y;
  const dir1x = Math.sin(shoulder) * side;
  const dir1y = Math.cos(shoulder);
  const angle2 = shoulder + elbow;
  const dir2x = Math.sin(angle2) * side;
  const dir2y = Math.cos(angle2);

  rotateLocal(sOffX, sOffY, cosA, sinA);
  const sx = ox + _rx * u,
    sy = oy + _ry * u;
  rotateLocal(sOffX + dir1x * ARM_LEN1, sOffY + dir1y * ARM_LEN1, cosA, sinA);
  const ex = ox + _rx * u,
    ey = oy + _ry * u;
  rotateLocal(
    sOffX + dir1x * ARM_LEN1 + dir2x * ARM_LEN2,
    sOffY + dir1y * ARM_LEN1 + dir2y * ARM_LEN2,
    cosA,
    sinA,
  );
  const hx = ox + _rx * u,
    hy = oy + _ry * u;

  if (side > 0) {
    _rSx = sx;
    _rSy = sy;
    _rEx = ex;
    _rEy = ey;
    _rHx = hx;
    _rHy = hy;
  } else {
    _lSx = sx;
    _lSy = sy;
    _lEx = ex;
    _lEy = ey;
    _lHx = hx;
    _lHy = hy;
  }
}

// ---------------------------------------------------------------- primitives

/**
 * The rounded-rect path itself, so fill and stroke can share one definition
 * (and one set of `ctx` methods — deliberately no `arcTo`, since the fake
 * contexts the unit suite renders through implement exactly what this file
 * already used).
 */
export function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

export function roundRectFill(ctx, x, y, w, h, r) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fill();
}

export function roundRectStroke(ctx, x, y, w, h, r) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.stroke();
}
