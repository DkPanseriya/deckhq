/**
 * DeckHQ character rig — one procedural rig, canvas 2D, no sprite sheets.
 *
 * Scales cleanly across zoom 0.35-2.5 because every dimension derives from
 * `u` (px per plan unit at the current zoom). Body colour is the state
 * colour, passed in by the caller (scene.js resolves it from palette.js's
 * `STATE_COLORS`) — this module never needs the state name itself, only the
 * resolved colour, a badge string, and an icon name. Skin, hair and prop
 * materials are constant across agents by design (VISUAL-SPEC §3):
 * individuality is carried by the name label, not by appearance.
 *
 * Performance (docs/02-ARCHITECTURE.md §8: 25 animated characters at 60 fps):
 * `drawCharacter` allocates no objects or arrays per call. Body-part
 * transforms are computed by hand (rotate a local point, then translate) into
 * flat module-scope scratch numbers rather than via `ctx.save/rotate/restore`
 * per limb — `drawCharacter` itself never calls `ctx.save`/`ctx.restore` at
 * all; the few stateful canvas properties it touches (`globalAlpha`) are
 * read and restored manually, which is cheaper than a full state push/pop.
 */

import { PALETTE } from './palette.js';

const TAU = Math.PI * 2;
const BASE_U = 14; // reference px-per-unit these proportions were tuned at

// ---------------------------------------------------------------- constants

const SKIN = '#E4B98E';
const HAIR = '#3C2A1C';
const OUTLINE = 'rgba(255,255,255,0.85)';
const SELECTION_RING_COLOR = 'rgba(74,68,56,0.55)';
const CLOUD_FILL = 'rgba(252, 250, 244, 0.95)';
const CLOUD_EDGE = 'rgba(90, 78, 62, 0.45)';
const DOT_COLOR = PALETTE.inkCool;

const PROP_COLORS = Object.freeze({
  mug: PALETTE.fridgeFill,
  plate: PALETTE.tileBase,
  cue: PALETTE.tableWood,
  paddle: PALETTE.inkCool,
  controller: PALETTE.cabinetBody,
  piece: PALETTE.chairBackrest,
});

// ---- the manager: the user's own avatar at the office desk (WP15 addendum) --
// Not an agent — no state colour, no MK tag, no project identity. Reuses the
// same body primitives as every character (see drawManagerFigure at the
// bottom of this file) so it reads as the same species, just bigger and in a
// suit.
const MANAGER_SUIT = PALETTE.managerSuit;
const MANAGER_SHIRT = PALETTE.managerShirt;
const MANAGER_TIE = PALETTE.managerTie;
const MANAGER_SCALE = 1.3; // "a bit bigger" than an agent (uniform scale over u)

// body-part geometry, expressed as a fraction of `u` (tuned at BASE_U = 14)
const SHADOW_RX = 0.86,
  SHADOW_RY = 0.39,
  SHADOW_OX = 0.12,
  SHADOW_OY = 0.62;
const TORSO_RX = 0.82,
  TORSO_RY = 0.61;
const HEAD_R = 0.5,
  HEAD_OFFSET_Y = -0.95;
const SHOULDER_OFFSET_X = 0.5,
  // Kept symmetric with HIP_OFFSET_Y below: shoulders sit as far forward of
  // centre as the hips sit behind it. At the old -0.2, the `type` clip's
  // reach (clips.js TYPE_ARM: shoulder=1.2, elbow=0.35) landed the typing
  // hand only ~0.01 local units on the correct (forward, head-side) side of
  // centre — effectively a coin flip once floating point is involved, and
  // `type` drives `working`, the single commonest state on a real machine.
  // -0.4 gives every reaching pose real margin on the correct side without
  // moving the reach angles themselves (verified against all 16 clips in
  // clips.js; see test/unit/rig-orientation.test.mjs).
  SHOULDER_OFFSET_Y = -0.4;
const HIP_OFFSET_X = 0.32,
  HIP_OFFSET_Y = 0.4;
// Identity marks (CONTRACTS-WP15.md §2) and the manager's suit accents share
// this local frame: COLLAR_OFFSET_Y sits between the shoulder line and the
// head (the neckline); GLYPH_OFFSET is "the shoulder/back" the spec calls
// for — slightly behind centre (local +y) and to one side.
const COLLAR_OFFSET_Y = -0.58;
const GLYPH_OFFSET_X = 0.4,
  GLYPH_OFFSET_Y = 0.08;
const ARM_LEN1 = 0.55,
  ARM_LEN2 = 0.5,
  ARM_WIDTH = 0.22,
  HAND_R = 0.16;
const LEG_LEN_STAND = 0.55,
  LEG_LEN_SEATED = 0.28,
  LEG_WIDTH = 0.24;
const SELECTION_RING_R = 1.35;
const RING_BASE_R = 1.15;

const SIDES = [1, -1]; // right, left — a module constant, never reallocated

// -------------------------------------------------------------------- pose

/** @returns {import('./clips.js').Pose} */
function defaultPose() {
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

function mergeInto(base, partial) {
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

// -------------------------------------------------------------- text/format

/**
 * Formats a waiting-time badge: `4m`, `2h 10m`, `2d 4h`.
 * @param {number} ms
 * @returns {string}
 */
export function formatElapsed(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  if (totalHours < 24) return remMinutes > 0 ? `${totalHours}h ${remMinutes}m` : `${totalHours}h`;
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

/**
 * Truncates a name label to at most 18 characters total (VISUAL-SPEC §7),
 * preferring a break on a word boundary within the budget over a mid-word
 * cut (tech-lead review finding 1, docs/DEVIATIONS.md "Findings from
 * review": labels were truncating mid-word). Falls back to a hard cut when
 * the budget contains no space to break on — a single word longer than the
 * budget has nowhere else to give.
 * @param {string} label
 * @returns {string}
 */
export function truncateLabel(label) {
  const s = String(label == null ? '' : label);
  if (s.length <= 18) return s;
  const budget = 17; // + 1 ellipsis char = 18 total
  const slice = s.slice(0, budget);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${cut}…`;
}

const monoFontCache = new Map();
function monoFont(px) {
  const key = Math.round(px);
  let f = monoFontCache.get(key);
  if (f === undefined) {
    f = `700 ${key}px "JetBrains Mono", monospace`;
    monoFontCache.set(key, f);
  }
  return f;
}

const sansFontCache = new Map();
function sansFont(px) {
  const key = Math.round(px);
  let f = sansFontCache.get(key);
  if (f === undefined) {
    f = `600 ${key}px "IBM Plex Sans", system-ui, sans-serif`;
    sansFontCache.set(key, f);
  }
  return f;
}

// ------------------------------------------------------------- local rotate

// Scratch outputs for rotateLocal — avoids allocating a {x,y} pair per call.
// Safe because drawCharacter runs synchronously to completion per character;
// nothing re-enters rotateLocal while a previous result is still pending.
let _rx = 0;
let _ry = 0;
function rotateLocal(lx, ly, cosA, sinA) {
  _rx = lx * cosA - ly * sinA;
  _ry = lx * sinA + ly * cosA;
}

// Scratch world-space arm joint positions, filled by computeArmGeometry and
// read by drawArmStroke / drawFingerTicks / prop drawers. Two full sets
// (right, left) so prop-behind can be drawn before the arm strokes and
// prop-front can be drawn after hair, per the normative draw order.
let _rSx = 0,
  _rSy = 0,
  _rEx = 0,
  _rEy = 0,
  _rHx = 0,
  _rHy = 0;
let _lSx = 0,
  _lSy = 0,
  _lEx = 0,
  _lEy = 0,
  _lHx = 0,
  _lHy = 0;

function computeArmGeometry(ox, oy, cosA, sinA, u, side, shoulder, elbow) {
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

function roundRectFill(ctx, x, y, w, h, r) {
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
  ctx.fill();
}

// -------------------------------------------------------------- body parts

function drawContactShadow(ctx, ox, oy, u) {
  ctx.fillStyle = PALETTE.shadowContact;
  ctx.beginPath();
  ctx.ellipse(ox + SHADOW_OX * u, oy + SHADOW_OY * u, SHADOW_RX * u, SHADOW_RY * u, 0, 0, TAU);
  ctx.fill();
}

function drawSimpleBody(ctx, ox, oy, u, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(ox, oy, TORSO_RX * u, TORSO_RY * u, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(ox, oy + HEAD_OFFSET_Y * u, HEAD_R * u, 0, TAU);
  ctx.fill();
}

function drawLegs(ctx, pose, ox, oy, cosA, sinA, u, color) {
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
function drawTorso(ctx, ox, oy, facingRot, u, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(ox, oy, TORSO_RX * u, TORSO_RY * u, facingRot, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = PALETTE.inkCool;
  ctx.lineWidth = Math.max(0.6, u * 0.035);
  ctx.stroke();
}

function drawArmStroke(ctx, side, u, color) {
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
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(hx, hy, HAND_R * u, 0, TAU);
  ctx.fill();
}

function drawFingerTicks(ctx, side, u, fingerPhase) {
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

function drawHead(ctx, ox, oy, cosA, sinA, u) {
  rotateLocal(0, HEAD_OFFSET_Y, cosA, sinA);
  const hx = ox + _rx * u,
    hy = oy + _ry * u;
  ctx.fillStyle = SKIN;
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
 */
function drawHair(ctx, ox, oy, cosA, sinA, u, facingRot, hairColor) {
  rotateLocal(0, HEAD_OFFSET_Y, cosA, sinA);
  const hx = ox + _rx * u,
    hy = oy + _ry * u;
  const backAngle = facingRot + Math.PI / 2;
  ctx.fillStyle = hairColor || HAIR;
  ctx.beginPath();
  ctx.arc(hx, hy, HEAD_R * u * 0.96, backAngle - Math.PI / 2, backAngle + Math.PI / 2);
  ctx.closePath();
  ctx.fill();
}

// -------------------------------------------------------- identity + suit

/**
 * One small vector glyph from CONTRACTS-WP15.md §2's `AVATAR_GLYPHS`
 * vocabulary (`palette.js`). No fonts, no emoji — pure vector paths, drawn
 * small enough to read as a mark rather than an icon. Falls back to the
 * 'hex' shape for any unrecognised name (defensive, per this codebase's
 * "better a plain box than a missing desk" convention in backdrop.js).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} r
 * @param {string} kind @param {string} color
 */
function drawGlyph(ctx, x, y, r, kind, color) {
  ctx.fillStyle = color;
  switch (kind) {
    case 'triangle':
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.87, y + r * 0.5);
      ctx.lineTo(x - r * 0.87, y + r * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    case 'square':
      ctx.fillRect(x - r * 0.75, y - r * 0.75, r * 1.5, r * 1.5);
      break;
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fill();
      break;
    case 'drop':
      ctx.beginPath();
      ctx.arc(x, y + r * 0.2, r * 0.7, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.55, y - r * 0.05);
      ctx.lineTo(x - r * 0.55, y - r * 0.05);
      ctx.closePath();
      ctx.fill();
      break;
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const outerA = -Math.PI / 2 + (i * TAU) / 5;
        const innerA = outerA + TAU / 10;
        const px = x + Math.cos(outerA) * r,
          py = y + Math.sin(outerA) * r;
        const ix = x + Math.cos(innerA) * r * 0.45,
          iy = y + Math.sin(innerA) * r * 0.45;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        ctx.lineTo(ix, iy);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'cross': {
      const t = r * 0.42;
      ctx.fillRect(x - t / 2, y - r, t, r * 2);
      ctx.fillRect(x - r, y - t / 2, r * 2, t);
      break;
    }
    case 'ring':
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(0.6, r * 0.32);
      ctx.beginPath();
      ctx.arc(x, y, r * 0.68, 0, TAU);
      ctx.stroke();
      break;
    case 'hex':
    default:
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6 - Math.PI / 6;
        const px = x + Math.cos(a) * r,
          py = y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
  }
}

/**
 * Project identity marks (CONTRACTS-WP15.md §2): a small clothing accent at
 * the collar, and the avatar glyph on the shoulder/back. Both use
 * `identity.accent` — one accent colour in two places reads as one
 * identity, not two unrelated decorations. Drawn last among the body parts
 * (after hair, in `drawCharacter`) so nothing painted afterward occludes
 * them; gated on `lod >= 1` by the caller, same as hair itself.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} ox @param {number} oy @param {number} cosA @param {number} sinA @param {number} u
 * @param {{hair:string, accent:string, glyph:string}} identity
 */
function drawIdentityMarks(ctx, ox, oy, cosA, sinA, u, identity) {
  rotateLocal(0, COLLAR_OFFSET_Y, cosA, sinA);
  const cx = ox + _rx * u,
    cy = oy + _ry * u;
  ctx.fillStyle = identity.accent;
  ctx.beginPath();
  ctx.arc(cx, cy, u * 0.13, 0, TAU);
  ctx.fill();

  rotateLocal(GLYPH_OFFSET_X, GLYPH_OFFSET_Y, cosA, sinA);
  const gx = ox + _rx * u,
    gy = oy + _ry * u;
  drawGlyph(ctx, gx, gy, u * 0.22, identity.glyph, identity.accent);
}

/**
 * The manager's collar + tie — the detail that reads "suit", not just "dark
 * shirt". Manager-only; agents never call this (their "small clothing
 * accent" is `drawIdentityMarks`'s collar dot instead).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} ox @param {number} oy @param {number} cosA @param {number} sinA @param {number} u
 */
function drawSuitAccents(ctx, ox, oy, cosA, sinA, u) {
  rotateLocal(0, COLLAR_OFFSET_Y, cosA, sinA);
  const nx = ox + _rx * u,
    ny = oy + _ry * u;
  const s = u * 0.32;
  ctx.fillStyle = MANAGER_SHIRT;
  ctx.beginPath();
  ctx.moveTo(nx, ny);
  ctx.lineTo(nx - s * 0.55, ny - s * 0.15);
  ctx.lineTo(nx, ny + s * 0.9);
  ctx.lineTo(nx + s * 0.55, ny - s * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = MANAGER_TIE;
  ctx.beginPath();
  ctx.moveTo(nx - s * 0.13, ny);
  ctx.lineTo(nx + s * 0.13, ny);
  ctx.lineTo(nx + s * 0.08, ny + s * 1.3);
  ctx.lineTo(nx, ny + s * 1.55);
  ctx.lineTo(nx - s * 0.08, ny + s * 1.3);
  ctx.closePath();
  ctx.fill();
}

// ------------------------------------------------------------------- props

function drawCueBehind(ctx, u) {
  const dx = _rHx - _lHx,
    dy = _rHy - _lHy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len,
    uy = dy / len;
  ctx.strokeStyle = PROP_COLORS.cue;
  ctx.lineCap = 'round';
  ctx.lineWidth = u * 0.09;
  ctx.beginPath();
  ctx.moveTo(_rHx, _rHy);
  ctx.lineTo(_rHx + ux * 0.35 * u, _rHy + uy * 0.35 * u);
  ctx.stroke();
}

function drawCueFront(ctx, u) {
  const dx = _lHx - _rHx,
    dy = _lHy - _rHy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len,
    uy = dy / len;
  ctx.strokeStyle = PROP_COLORS.cue;
  ctx.lineCap = 'round';
  ctx.lineWidth = u * 0.07;
  ctx.beginPath();
  ctx.moveTo(_rHx, _rHy);
  ctx.lineTo(_lHx + ux * 0.9 * u, _lHy + uy * 0.9 * u);
  ctx.stroke();
}

function drawMug(ctx, x, y, u) {
  const r = u * 0.16;
  ctx.fillStyle = PROP_COLORS.mug;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = PALETTE.inkCool;
  ctx.lineWidth = Math.max(0.5, u * 0.03);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + r * 1.3, y, r * 0.5, -0.9, 0.9);
  ctx.stroke();
}

function drawPlate(ctx, x, y, u) {
  const r = u * 0.2;
  ctx.fillStyle = PROP_COLORS.plate;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = PALETTE.inkCool;
  ctx.lineWidth = Math.max(0.4, u * 0.025);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.68, 0, TAU);
  ctx.stroke();
}

function drawPaddle(ctx, x, y, u) {
  ctx.fillStyle = PROP_COLORS.paddle;
  roundRectFill(ctx, x - u * 0.14, y - u * 0.18, u * 0.28, u * 0.24, u * 0.08);
  ctx.strokeStyle = PALETTE.inkWarm;
  ctx.lineWidth = Math.max(0.5, u * 0.03);
  ctx.beginPath();
  ctx.moveTo(x, y + u * 0.06);
  ctx.lineTo(x, y + u * 0.22);
  ctx.stroke();
}

function drawController(ctx, x, y, u) {
  ctx.fillStyle = PROP_COLORS.controller;
  roundRectFill(ctx, x - u * 0.32, y - u * 0.12, u * 0.64, u * 0.22, u * 0.08);
}

function drawPiece(ctx, x, y, u) {
  ctx.fillStyle = PROP_COLORS.piece;
  ctx.beginPath();
  ctx.arc(x, y, u * 0.1, 0, TAU);
  ctx.fill();
}

function drawPropFront(ctx, prop, u) {
  if (prop === 'mug') drawMug(ctx, _rHx, _rHy, u);
  else if (prop === 'plate') drawPlate(ctx, _rHx, _rHy, u);
  else if (prop === 'paddle') drawPaddle(ctx, _rHx, _rHy, u);
  else if (prop === 'piece') drawPiece(ctx, _rHx, _rHy, u);
  else if (prop === 'controller') drawController(ctx, (_rHx + _lHx) / 2, (_rHy + _lHy) / 2, u);
  else if (prop === 'cue') drawCueFront(ctx, u);
}

// -------------------------------------------------------------------- icons

function drawHandIcon(ctx, cx, topY, size, color, pulse) {
  const s = size * (0.92 + 0.16 * pulse);
  const w = s * 0.62,
    h = s;
  const baseY = topY + size;
  const left = cx - w / 2;
  const fingerW = w * 0.15,
    gap = w * 0.03;
  ctx.fillStyle = color;
  roundRectFill(ctx, cx - w * 0.32, baseY - h * 0.42, w * 0.64, h * 0.42, w * 0.16);
  for (let i = 0; i < 4; i++) {
    const fx = left + i * (fingerW + gap);
    const fh = h * 0.5 * (1 - Math.abs(i - 1.5) * 0.06);
    roundRectFill(ctx, fx, baseY - h * 0.42 - fh, fingerW, fh, fingerW * 0.4);
  }
  roundRectFill(ctx, left - w * 0.12, baseY - h * 0.28, w * 0.16, h * 0.22, w * 0.08);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(0.6, size * 0.045);
  ctx.strokeRect(cx - w * 0.32, baseY - h * 0.42, w * 0.64, h * 0.42);
}

function drawHourglassIcon(ctx, cx, topY, size, color) {
  const w = size * 0.68,
    h = size;
  const left = cx - w / 2,
    right = cx + w / 2,
    top = topY,
    bottom = topY + h,
    mid = topY + h / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(right, top);
  ctx.lineTo(cx, mid);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.lineTo(cx, mid);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(0.6, size * 0.08);
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(right, top);
  ctx.moveTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();
}

function drawCheckIcon(ctx, cx, topY, size, color) {
  const r = size / 2;
  const cy = topY + r;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(0.8, size * 0.14);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.45, cy + r * 0.02);
  ctx.lineTo(cx - r * 0.12, cy + r * 0.35);
  ctx.lineTo(cx + r * 0.5, cy - r * 0.35);
  ctx.stroke();
}

/** Minimum 10px tall, high-contrast vector icons — no fonts, no emoji. */
function drawIcon(ctx, ox, oy, u, kind, color, ringPhase) {
  const size = Math.max(10, u * 0.9);
  const topY = oy - u * 1.05 - size;
  if (kind === 'hand') {
    const pulse = Math.sin(ringPhase * TAU) * 0.5 + 0.5;
    drawHandIcon(ctx, ox, topY, size, color, pulse);
  } else if (kind === 'hourglass') {
    drawHourglassIcon(ctx, ox, topY, size, color);
  } else if (kind === 'check') {
    drawCheckIcon(ctx, ox, topY, size, color);
  }
}

/** Thought (`think`) / speech (`chat`) dots: rise and fade above the head. */
function drawDots(ctx, ox, oy, u, opacity) {
  // A thought cloud beside the head, in the comic-strip idiom: two small
  // trailing bubbles leading up to a lobed cloud. Three dots in a row read as
  // "loading" rather than "thinking" — the cloud is what makes it legible as
  // a thought at a glance, which is the whole point of the `working` state
  // having a visible thinking pose at all.
  const prevAlpha = ctx.globalAlpha;
  const cx = ox + u * 0.95;
  const cy = oy - u * 1.5;

  // The trail, rising from beside the head toward the cloud.
  ctx.fillStyle = CLOUD_FILL;
  ctx.strokeStyle = CLOUD_EDGE;
  ctx.lineWidth = Math.max(0.6, u * 0.045);
  const trail = [
    [ox + u * 0.5, oy - u * 0.55, u * 0.1],
    [ox + u * 0.72, oy - u * 0.95, u * 0.14],
  ];
  for (const [tx, ty, tr] of trail) {
    ctx.globalAlpha = opacity * 0.85;
    ctx.beginPath();
    ctx.arc(tx, ty, tr, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }

  // The cloud itself: overlapping lobes filled as one shape, so the seams
  // between them never show.
  ctx.globalAlpha = opacity;
  const lobes = [
    [-0.42, 0.06, 0.3],
    [-0.1, -0.16, 0.38],
    [0.28, 0.0, 0.3],
    [0.02, 0.2, 0.28],
  ];
  ctx.beginPath();
  for (const [lx, ly, lr] of lobes) {
    ctx.moveTo(cx + lx * u + lr * u, cy + ly * u);
    ctx.arc(cx + lx * u, cy + ly * u, lr * u, 0, TAU);
  }
  ctx.fill();
  ctx.stroke();

  // Three beats inside the cloud, so it still reads as active thought.
  ctx.fillStyle = DOT_COLOR;
  for (let i = -1; i <= 1; i++) {
    ctx.globalAlpha = opacity * (i === 0 ? 0.9 : 0.55);
    ctx.beginPath();
    ctx.arc(cx + i * u * 0.22, cy + u * 0.02, u * 0.055, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = prevAlpha;
}

// ------------------------------------------------------------------ chrome

function drawFloorRing(ctx, ox, oy, u, phase, color, reduced) {
  const baseR = u * RING_BASE_R;
  let r, alpha;
  if (reduced) {
    r = baseR;
    alpha = 0.5;
  } else {
    const s = Math.sin(phase * TAU) * 0.5 + 0.5;
    r = baseR + s * u * 0.35;
    alpha = 0.25 + s * 0.35;
  }
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = u * 0.16;
  ctx.beginPath();
  ctx.arc(ox, oy, r, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = prevAlpha;
}

function drawSelectionRing(ctx, ox, oy, u) {
  ctx.strokeStyle = SELECTION_RING_COLOR;
  ctx.lineWidth = Math.max(1.2, u * 0.14);
  ctx.beginPath();
  ctx.arc(ox, oy, u * SELECTION_RING_R, 0, TAU);
  ctx.stroke();
}

function drawBadge(ctx, ox, oy, u, text, color) {
  ctx.font = monoFont(Math.max(10, u * 0.7));
  const padX = u * 0.35;
  const w = ctx.measureText(text).width + padX * 2;
  const h = u * 1.05;
  const topY = oy - u * 2.35 - h;
  ctx.fillStyle = color;
  roundRectFill(ctx, ox - w / 2, topY, w, h, h * 0.32);
  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, ox, topY + h / 2 + h * 0.04);
  ctx.restore();
}

/**
 * The label's bounding box in screen space, without drawing anything.
 * Nothing is painted behind the text any more (CONTRACTS-WP15.md §3 — the
 * backing plate this used to describe is gone), so this box is now purely a
 * measurement: the room for `scene.js`'s per-frame label-collision pass
 * (tech-lead review finding 1) to reason about, sized with the same padding
 * a plate would have had so labels still keep a little breathing room from
 * each other.
 * @param {{font:string, measureText:(text:string)=>{width:number}}} ctx
 *   only `.font` (assigned) and `.measureText` are read — a plain stubbed
 *   object with those two members is enough, which is what the unit test
 *   for this function uses; a real `CanvasRenderingContext2D` also works.
 * @param {number} ox character origin x (screen px)
 * @param {number} oy character origin y (screen px)
 * @param {number} u px per plan unit at the current zoom
 * @param {string} rawLabel
 * @returns {{text:string, x:number, y:number, w:number, h:number, top:number}}
 *   `x,y,w,h`: the text's bounding box (screen space, before any collision
 *   offset). `top`: the text's un-offset draw y (baseline `'top'`), reused
 *   by `drawLabel` so measurement and paint never drift apart.
 */
export function labelBox(ctx, ox, oy, u, rawLabel) {
  const text = truncateLabel(rawLabel);
  const fontPx = Math.max(9, u * 0.62);
  ctx.font = sansFont(fontPx);
  const textW = ctx.measureText(text).width;
  const padX = Math.max(3, u * 0.18);
  const padY = Math.max(1.5, u * 0.09);
  const w = textW + padX * 2;
  const h = fontPx * 1.18 + padY * 2;
  const top = oy + u * 1.35;
  return { text, x: ox - w / 2, y: top - padY, w, h, top };
}

/**
 * Draws the name label: haloed text directly on the floor, no backing plate
 * (CONTRACTS-WP15.md §3: "Agent labels lose their backing plates. Short MK
 * tags need far less room than a session title did, so they no longer need
 * a plate to be legible.") — KEPT the halo stroke, DROPPED the rounded plate
 * that used to sit behind it. A halo (stroke the glyphs in a light tone,
 * then fill them dark) brightens only the pixels immediately behind each
 * letter, so — unlike a flat ink fill on its own — it holds contrast against
 * both floor materials and against patterned desk furniture without needing
 * an opaque backing; a plate was overkill once the label shrank from a full
 * session title down to a short MK tag or display name. `offsetY` is
 * `scene.js`'s per-frame collision-avoidance nudge, 0 when the label needs
 * none.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} ox @param {number} oy @param {number} u
 * @param {string} rawLabel
 * @param {number} [offsetY]
 */
function drawLabel(ctx, ox, oy, u, rawLabel, offsetY) {
  const box = labelBox(ctx, ox, oy, u, rawLabel);
  const dy = offsetY || 0;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = sansFont(Math.max(9, u * 0.62)); // labelBox already set it; re-assert before drawing
  ctx.lineWidth = Math.max(2, u * 0.16);
  ctx.strokeStyle = 'rgba(255,253,249,0.95)';
  ctx.strokeText(box.text, ox, box.top + dy);
  ctx.fillStyle = PALETTE.inkWarm;
  ctx.fillText(box.text, ox, box.top + dy);
  // Text alignment is global context state. Leaking 'center' out of here
  // pushed every room plate's text off its position.
  ctx.restore();
}

// -------------------------------------------------------------- the rig API

/**
 * FACING CONVENTION (VISUAL-SPEC §3's `Pose.bodyAngle`): 0 faces +x (east),
 * `Math.PI / 2` faces +y (south) — identical to `plan.js`'s `angleTo` (see
 * its doc comment there) and therefore to `Seat.angle`, which is where
 * `bodyAngle` ultimately comes from: `clips.js`'s `sampleClip` only ever
 * returns a small relative sway on top of it, and `scene.js` adds the
 * seat's absolute facing before calling `drawCharacter`.
 *
 * The body parts below are authored in a *local*, unrotated frame where
 * "forward" (the head — VISUAL-SPEC: "the head sits forward-of-centre") is
 * local -y and "lateral" (left/right, e.g. `SHOULDER_OFFSET_X`) is local x.
 * That local frame itself faces local -y, a quarter turn away from the +x
 * the convention above requires. Every routine that turns one of those
 * local points into a screen point must therefore rotate by
 * `bodyAngle + Math.PI / 2`, never by `bodyAngle` directly — that
 * quarter-turn correction is `facingRot` below, threaded through
 * `cosA`/`sinA` into `drawLegs` / `computeArmGeometry` / `drawHead` /
 * `drawHair`, and passed straight through to `drawTorso` / `drawHair`
 * wherever they need the facing angle itself rather than its sine/cosine.
 *
 * Get this wrong — e.g. rotate by raw `bodyAngle` — and the head (which has
 * no lateral offset) ends up displaced along what is actually the
 * character's *side* axis, while the arms (which do have a real lateral
 * spread) end up spread along what is actually the *forward/back* axis:
 * this was exactly the "hands on one side, head on the other, arms coming
 * out of the back" bug. See test/unit/rig-orientation.test.mjs.
 */

/**
 * Draws one character. `opts.u` is px-per-unit at the current zoom; every
 * dimension derives from it so the rig scales cleanly across 0.35-2.5.
 *
 * Draw order (VISUAL-SPEC §3, plus floor-level chrome and above-head chrome
 * that the §3 body-part order doesn't cover): floor ring -> selection ring ->
 * contact shadow -> legs -> torso -> held prop (behind) -> arms -> head ->
 * hair -> identity marks (collar accent + glyph, when `opts.identity` is set)
 * -> prop (in front) -> state icon (or thought/speech dots) -> badge -> name
 * label.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./clips.js').Pose} pose
 * @param {{ x:number, y:number, u:number, lod:0|1|2, color:string,
 *   label?:string, labelOffsetY?:number, icon?:'hand'|'hourglass'|'check'|null,
 *   badge?:string|null, selected?:boolean, reduced?:boolean,
 *   identity?:{hair:string, accent:string, glyph:string}|null }} opts
 *   `labelOffsetY`: vertical screen-px nudge applied to the label only
 *   (`scene.js`'s per-frame collision resolution, tech-lead review finding 1).
 *   `identity` (CONTRACTS-WP15.md §2): project appearance from
 *   `palette.js`'s `identityFor`. The torso stays `opts.color` — the state
 *   colour — regardless; identity rides on hair, a small clothing accent and
 *   a shoulder/back glyph only, and only at `lod >= 1` (L0's `drawSimpleBody`
 *   has no hair or accent layer to carry it).
 */
export function drawCharacter(ctx, pose, opts) {
  const ox = opts.x,
    oy = opts.y,
    u = opts.u,
    lod = opts.lod,
    color = opts.color;
  const reduced = !!opts.reduced;
  const identity = opts.identity || null;
  // See the FACING CONVENTION comment above — rotating by pose.bodyAngle
  // directly (instead of facingRot) is the bug this file used to have.
  const facingRot = pose.bodyAngle + Math.PI / 2;
  const cosA = Math.cos(facingRot);
  const sinA = Math.sin(facingRot);

  if (pose.ring) drawFloorRing(ctx, ox, oy, u, pose.ringPhase, color, reduced);
  if (opts.selected) drawSelectionRing(ctx, ox, oy, u);

  drawContactShadow(ctx, ox, oy, u);

  if (lod === 0) {
    drawSimpleBody(ctx, ox, oy, u, color);
  } else {
    const by = oy + pose.bob * (u / BASE_U);
    drawLegs(ctx, pose, ox, by, cosA, sinA, u, color);
    drawTorso(ctx, ox, by, facingRot, u, color);

    computeArmGeometry(ox, by, cosA, sinA, u, 1, pose.armR.shoulder, pose.armR.elbow);
    computeArmGeometry(ox, by, cosA, sinA, u, -1, pose.armL.shoulder, pose.armL.elbow);

    if (pose.prop === 'cue') drawCueBehind(ctx, u);

    drawArmStroke(ctx, 1, u, color);
    drawArmStroke(ctx, -1, u, color);
    if (lod >= 2 && pose.armR.hand === 'key') drawFingerTicks(ctx, 1, u, pose.fingerPhase);
    if (lod >= 2 && pose.armL.hand === 'key') drawFingerTicks(ctx, -1, u, pose.fingerPhase);

    drawHead(ctx, ox, by, cosA, sinA, u);
    drawHair(ctx, ox, by, cosA, sinA, u, facingRot, identity ? identity.hair : undefined);
    if (identity) drawIdentityMarks(ctx, ox, by, cosA, sinA, u, identity);

    if (pose.prop) drawPropFront(ctx, pose.prop, u);
  }

  if (opts.icon) {
    drawIcon(ctx, ox, oy, u, opts.icon, color, pose.ringPhase);
  } else {
    const thoughtOpacity = Math.sin(Math.min(1, Math.max(0, pose.thoughtPhase)) * Math.PI);
    if (thoughtOpacity > 0.02) drawDots(ctx, ox, oy, u, thoughtOpacity);
    const speechOpacity = Math.sin(Math.min(1, Math.max(0, pose.speechPhase)) * Math.PI);
    if (speechOpacity > 0.02) drawDots(ctx, ox, oy, u, speechOpacity);
  }

  if (opts.badge) drawBadge(ctx, ox, oy, u, opts.badge, color);
  if (lod >= 1 && opts.label) drawLabel(ctx, ox, oy, u, opts.label, opts.labelOffsetY);
}

// ------------------------------------------------------------- the manager

/**
 * The user's own avatar, standing at the head of their desk — not an agent,
 * so it carries none of an agent's chrome: a fixed suit tone instead of a
 * state colour, no state icon, no waiting badge, no hand-raise ring, no MK
 * tag, no project identity. Reuses the exact same body primitives as
 * `drawCharacter`, in the same order — contact shadow -> legs -> torso ->
 * arms -> head -> hair -> suit accents — so it reads as unmistakably the
 * same species as every agent on the floor: just bigger, standing taller,
 * and in a suit.
 *
 * Called from `backdrop.js`'s `paintProp` (`case 'manager'`), which bakes the
 * whole floor once per plan change, never per frame — so unlike
 * `drawCharacter` this takes one fixed confident standing pose rather than a
 * Pose sampled from a clip: legs together, arms at rest, chest square to the
 * queue.
 *
 * `backdrop.js` calls this from inside a translate-to-the-prop-centre
 * transform with the ambient `ctx.rotate` cancelled back out first, because
 * (like `drawCharacter`) this function bakes facing into the coordinates it
 * hands to `ctx` itself, exactly per the FACING CONVENTION above — it must
 * not also be called under an active rotation, or the figure would be turned
 * twice.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x:number, y:number, u:number, angle?:number }} opts
 *   `x,y`: the figure's centre, in the current (translate-only) transform.
 *   `u`: px-per-unit before the manager's own size bump (`MANAGER_SCALE`
 *   above — "a bit bigger" than an agent, per the work order).
 *   `angle`: facing, in `Pose.bodyAngle`'s convention (0 = +x/east).
 */
export function drawManagerFigure(ctx, opts) {
  const ox = opts.x,
    oy = opts.y,
    u = opts.u * MANAGER_SCALE;
  const bodyAngle = opts.angle || 0;
  const facingRot = bodyAngle + Math.PI / 2;
  const cosA = Math.cos(facingRot);
  const sinA = Math.sin(facingRot);
  const pose = makePose({
    bodyAngle,
    armL: { shoulder: 0, elbow: 0, hand: 'rest' },
    armR: { shoulder: 0, elbow: 0, hand: 'rest' },
  });

  drawContactShadow(ctx, ox, oy, u);
  drawLegs(ctx, pose, ox, oy, cosA, sinA, u, MANAGER_SUIT);
  drawTorso(ctx, ox, oy, facingRot, u, MANAGER_SUIT);

  computeArmGeometry(ox, oy, cosA, sinA, u, 1, pose.armR.shoulder, pose.armR.elbow);
  computeArmGeometry(ox, oy, cosA, sinA, u, -1, pose.armL.shoulder, pose.armL.elbow);
  drawArmStroke(ctx, 1, u, MANAGER_SUIT);
  drawArmStroke(ctx, -1, u, MANAGER_SUIT);

  drawHead(ctx, ox, oy, cosA, sinA, u);
  drawHair(ctx, ox, oy, cosA, sinA, u, facingRot);
  drawSuitAccents(ctx, ox, oy, cosA, sinA, u);
}
