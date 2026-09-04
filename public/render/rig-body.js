/**
 * The body itself, part by part (WP-22 follow-up).
 *
 * Split out of `rig.js` unchanged: the contact shadow, the far-zoom
 * simplification, and then legs, torso, arms, fingers, head, hair and
 * waistband — in the order `drawCharacter` paints them.
 */

import { PALETTE } from './palette.js';
import {
  TAU,
  HAIR,
  TORSO_RX,
  HEAD_R,
  HIP_OFFSET_X,
  LEG_LEN_STAND,
  SHADOW_OX,
  SHADOW_OY,
  SHADOW_RX,
  SHADOW_RY,
  TORSO_RY,
  SKIN,
  HEAD_OFFSET_Y,
  LEG_WIDTH,
  HIP_OFFSET_Y,
  LEG_LEN_SEATED,
  ARM_WIDTH,
  HAND_R,
} from './rig-metrics.js';
import {
  SIDES,
  _rx,
  _ry,
  rotateLocal,
  _rSx,
  _lSx,
  _rSy,
  _lSy,
  _rEx,
  _lEx,
  _rEy,
  _lEy,
  _rHx,
  _lHx,
  _rHy,
  _lHy,
} from './rig-pose.js';

// -------------------------------------------------------------- body parts

export function drawContactShadow(ctx, ox, oy, u) {
  ctx.fillStyle = PALETTE.shadowContact;
  ctx.beginPath();
  ctx.ellipse(ox + SHADOW_OX * u, oy + SHADOW_OY * u, SHADOW_RX * u, SHADOW_RY * u, 0, 0, TAU);
  ctx.fill();
}

/**
 * L0: two shapes, and the state colour is one of them. `skin` and `build` are
 * the only parts of an agent's appearance that survive down here — a hat is
 * three pixels of noise at this scale, so nothing else is drawn (WP-20).
 * @param {string} [skin] @param {number} [build]
 */
export function drawSimpleBody(ctx, ox, oy, u, color, skin, build) {
  const b = build || 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(ox, oy, TORSO_RX * u * b, TORSO_RY * u * b, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = skin || SKIN;
  ctx.beginPath();
  ctx.arc(ox, oy + HEAD_OFFSET_Y * u, HEAD_R * u, 0, TAU);
  ctx.fill();
}

export function drawLegs(ctx, pose, ox, oy, cosA, sinA, u, color) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = LEG_WIDTH * u;
  if (pose.seated) {
    for (const side of SIDES) {
      rotateLocal(HIP_OFFSET_X * side, HIP_OFFSET_Y, cosA, sinA);
      const hx = ox + _rx * u,
        hy = oy + _ry * u;
      rotateLocal(HIP_OFFSET_X * side, HIP_OFFSET_Y + LEG_LEN_SEATED, cosA, sinA);
      const fx = ox + _rx * u,
        fy = oy + _ry * u;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(fx, fy);
      ctx.stroke();
    }
  } else {
    for (const side of SIDES) {
      const phase = side > 0 ? pose.legPhase : (pose.legPhase + 0.5) % 1;
      const swing = Math.sin(phase * TAU) * 0.28;
      rotateLocal(HIP_OFFSET_X * side, HIP_OFFSET_Y, cosA, sinA);
      const hx = ox + _rx * u,
        hy = oy + _ry * u;
      rotateLocal(HIP_OFFSET_X * side, HIP_OFFSET_Y + LEG_LEN_STAND + swing, cosA, sinA);
      const fx = ox + _rx * u,
        fy = oy + _ry * u;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(fx, fy);
      ctx.stroke();
    }
  }
}

// `facingRot` (not raw `pose.bodyAngle` — see the FACING CONVENTION comment
// above `drawCharacter`) so the ellipse's wide axis (TORSO_RX > TORSO_RY)
// tilts to lie across the character's true lateral direction.
/**
 * @param {number} [build] per-agent torso scale (WP-20, `AGENT_BUILDS`). It
 *   scales the ellipse and nothing else: the fill is still `color` — the state
 *   colour — at full strength, so the one thing the torso has to say is said
 *   at exactly the contrast it was before.
 */
export function drawTorso(ctx, ox, oy, facingRot, u, color, build) {
  const b = build || 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(ox, oy, TORSO_RX * u * b, TORSO_RY * u * b, facingRot, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = PALETTE.inkCool;
  ctx.lineWidth = Math.max(0.6, u * 0.035);
  ctx.stroke();
}

/** @param {string} [skin] per-agent skin tone (WP-20); defaults to the constant. */
export function drawArmStroke(ctx, side, u, color, skin) {
  const sx = side > 0 ? _rSx : _lSx,
    sy = side > 0 ? _rSy : _lSy;
  const ex = side > 0 ? _rEx : _lEx,
    ey = side > 0 ? _rEy : _lEy;
  const hx = side > 0 ? _rHx : _lHx,
    hy = side > 0 ? _rHy : _lHy;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = ARM_WIDTH * u;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.fillStyle = skin || SKIN;
  ctx.beginPath();
  ctx.arc(hx, hy, HAND_R * u, 0, TAU);
  ctx.fill();
}

export function drawFingerTicks(ctx, side, u, fingerPhase) {
  const hx = side > 0 ? _rHx : _lHx,
    hy = side > 0 ? _rHy : _lHy;
  const s = 0.14 + 0.16 * fingerPhase;
  ctx.strokeStyle = PALETTE.inkWarm;
  ctx.lineWidth = Math.max(0.5, u * 0.045);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hx - u * 0.08, hy);
  ctx.lineTo(hx - u * 0.08, hy - u * s);
  ctx.moveTo(hx + u * 0.08, hy);
  ctx.lineTo(hx + u * 0.08, hy - u * s);
  ctx.stroke();
}

/** @param {string} [skin] per-agent skin tone (WP-20); defaults to the constant. */
export function drawHead(ctx, ox, oy, cosA, sinA, u, skin) {
  rotateLocal(0, HEAD_OFFSET_Y, cosA, sinA);
  const hx = ox + _rx * u,
    hy = oy + _ry * u;
  ctx.fillStyle = skin || SKIN;
  ctx.beginPath();
  ctx.arc(hx, hy, HEAD_R * u, 0, TAU);
  ctx.fill();
}

// `facingRot` (not raw `pose.bodyAngle` — see the FACING CONVENTION comment
// above `drawCharacter`), so `backAngle` below lands exactly opposite the
// character's true facing direction (`facingRot + PI/2 === bodyAngle + PI`).
/**
 * @param {string} [hairColor] project identity's hair colour
 *   (CONTRACTS-WP15.md §2); defaults to the constant `HAIR` when omitted, so
 *   every existing call site (and the manager — see `drawManagerFigure`,
 *   which always wants the default) is unaffected.
 * @param {string} [style] one of `palette.js`'s `AGENT_HAIR_STYLES` (WP-20).
 *   Every style is the same back-of-the-head cap plus at most one extra shape,
 *   because outline is the only thing that survives at 16 px — a fringe drawn
 *   in three pixels is noise, a bun that changes the head's silhouette is not.
 *   Omitted (or unrecognised) draws `crop`, exactly what this rig drew before.
 */
export function drawHair(ctx, ox, oy, cosA, sinA, u, facingRot, hairColor, style) {
  rotateLocal(0, HEAD_OFFSET_Y, cosA, sinA);
  const hx = ox + _rx * u,
    hy = oy + _ry * u;
  const backAngle = facingRot + Math.PI / 2;
  const r = HEAD_R * u;
  // Unit vectors: `b` points out of the back of the head, `s` across it.
  const bx = Math.cos(backAngle),
    by = Math.sin(backAngle);
  const sx = -by,
    sy = bx;
  ctx.fillStyle = hairColor || HAIR;

  if (style === 'bun') {
    // Drawn first so the cap overlaps it — a bun sits behind the head.
    ctx.beginPath();
    ctx.arc(hx + bx * r * 0.92, hy + by * r * 0.92, r * 0.42, 0, TAU);
    ctx.fill();
  } else if (style === 'long') {
    // A fall of hair down the back, past the shoulder line.
    ctx.beginPath();
    ctx.moveTo(hx + sx * r * 0.9, hy + sy * r * 0.9);
    ctx.lineTo(hx + sx * r * 0.72 + bx * r * 2.0, hy + sy * r * 0.72 + by * r * 2.0);
    ctx.lineTo(hx - sx * r * 0.72 + bx * r * 2.0, hy - sy * r * 0.72 + by * r * 2.0);
    ctx.lineTo(hx - sx * r * 0.9, hy - sy * r * 0.9);
    ctx.closePath();
    ctx.fill();
  }

  // The cap itself. `short` sits tighter to the skull, everything else keeps
  // the 0.96 the rig has always used.
  const capR = style === 'short' ? r * 0.86 : r * 0.96;
  ctx.beginPath();
  ctx.arc(hx, hy, capR, backAngle - Math.PI / 2, backAngle + Math.PI / 2);
  ctx.closePath();
  ctx.fill();

  if (style === 'bob') {
    // Two blunt side tabs level with the jaw: the outline change that reads
    // as a bob rather than as a crop.
    for (const side of SIDES) {
      ctx.beginPath();
      ctx.ellipse(
        hx + sx * side * r * 0.82 + bx * r * 0.18,
        hy + sy * side * r * 0.82 + by * r * 0.18,
        r * 0.3,
        r * 0.52,
        backAngle,
        0,
        TAU,
      );
      ctx.fill();
    }
  } else if (style === 'tuft') {
    // A single spike off the crown, forward of the cap.
    ctx.beginPath();
    ctx.moveTo(hx - bx * r * 0.5 + sx * r * 0.34, hy - by * r * 0.5 + sy * r * 0.34);
    ctx.lineTo(hx - bx * r * 1.3 + sx * r * 0.1, hy - by * r * 1.3 + sy * r * 0.1);
    ctx.lineTo(hx - bx * r * 0.45 - sx * r * 0.2, hy - by * r * 0.45 - sy * r * 0.2);
    ctx.closePath();
    ctx.fill();
  }
}

// ------------------------------------------------ per-agent appearance (WP-20)

/**
 * The outfit accent: the back hem of a shirt, a short band across the rear of
 * the torso.
 *
 * Two decisions, both from looking at it at magnification. It is a STROKE on a
 * chord rather than a fill over the body, because the torso's colour is the
 * state and must keep its area and its contrast (VISUAL-SPEC §3/§5). And it is
 * SHORT and set well back — a first pass spanned nearly the full width at the
 * midline, and from directly above that reads as a stripe bisecting the body
 * rather than as a garment, which took the eye off the state colour it was
 * supposed to sit quietly inside. Half the width, further back, and it reads
 * as a hem.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} ox @param {number} oy @param {number} cosA @param {number} sinA
 * @param {number} u @param {number} build @param {string} accent
 */
export function drawWaistband(ctx, ox, oy, cosA, sinA, u, build, accent) {
  const halfW = TORSO_RX * build * 0.46;
  const y = TORSO_RY * build * 0.62;
  rotateLocal(-halfW, y, cosA, sinA);
  const ax = ox + _rx * u,
    ay = oy + _ry * u;
  rotateLocal(halfW, y, cosA, sinA);
  const bx = ox + _rx * u,
    by = oy + _ry * u;
  ctx.strokeStyle = accent;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, u * 0.1);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}
