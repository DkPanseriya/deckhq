/**
 * B itself, part by part (WP-22 follow-up; rewritten for WP-79).
 *
 * A 45° three-quarter robot: chunky barrel, dome head, wrap visor. The 45° read
 * is the cheat every top-down RPG already uses — the floor stays near-plan and
 * the actor is tilted toward the camera — and the top-plane ellipses on the
 * barrel and the dome are what sell the tilt. The figure is BILLBOARDED: it
 * never turns with `bodyAngle`, so all six poses read from whichever direction
 * the user happens to be scanning the floor in, and the contact ellipse under
 * the feet is the only element left in the floor's own plane.
 *
 * Paint order, back to front:
 *
 *   contact shadow → rim halo → base → far arm → barrel (top plane, collar
 *   ring, chest plate, chest glyph) → near arm and mitt → held page → dome and
 *   ear cups → visor and its state mark → brow bar → crown accessory → rarity
 *   marker → legendary aura
 *
 * The RAISED HAND is drawn in the near-arm slot but reaches above the dome, and
 * nothing after it is drawn over it. That is not an accident of ordering: a
 * raised hand is the one thing on this floor the user must never fail to see
 * (VISUAL-SPEC §5), and `test/unit/rig-orientation.test.mjs` measures that its
 * bounding box clears the body's top at every level of detail.
 */

import {
  FIGURE_HALO,
  FIGURE_HALO_POOL_ALPHA,
  FIGURE_HALO_POOL_SPAN,
  FIGURE_HALO_RIM_PX,
  channelsOf,
  figureHaloMode,
  mixHex,
  PALETTE,
} from './palette.js';
import {
  BASE_U,
  BODY_HEIGHT_U,
  RIG_DETAIL_MIN_PX,
  RIG_INK,
  RIG_MARK,
  RIG_MARK_MIN_PX,
  RIG_OFF,
  RIG_PANE,
  RIG_PANE_DEAD,
  SHADOW_OX,
  SHADOW_OY,
  SHADOW_RX,
  SHADOW_RY,
  TAU,
  fade,
} from './rig-metrics.js';
import {
  MITT_R,
  lCircle,
  lEllipse,
  lLimb,
  lRoundRect,
  ln,
  lx,
  ly,
  rigArms,
  rigLineWidth,
  walkFrame,
  _rHx,
  _rHy,
  _lHx,
  _lHy,
} from './rig-pose.js';
import {
  DOME_R,
  SHELL_W,
  crownPath,
  crownPathB,
  crownTop,
  drawChestGlyph,
  drawRarityTrait,
} from './rig-traits.js';

// ---------------------------------------------------------------- the halo
//
// WP-85a §3.9, and the whole of `03-VISUAL-SPEC.md` §10's rewritten promise.
//
// §10 used to say "all state colours meet 3:1 against their floor background",
// which was never true on any theme: on the default parquet `needs_input`
// measured 1.70:1, on night shift `for_review` 1.44:1. It could not be fixed by
// moving the floor either — the state palette is mid-tone, so a floor clearing
// 3:1 against all six would have to be near paper or near black. So the surface
// a state colour is read against stopped being the floor, and became one
// constant that travels with the figure: `FIGURE_HALO`, worst case 3.28:1.
//
// Two devices, because a light floor and a dark one need opposite things:
//
//   POOL (light floors). A soft radial under the feet. Its job is not contrast
//     but UNIFORMITY — it flattens the parquet under a character so the
//     silhouette sits on one tone rather than on four boards and a seam.
//   RIM (dark floors). The silhouette drawn once in the halo colour, `rim`
//     wider all round, with the real body painted straight over it: what
//     survives is a thin bright edge.
//
// WP-79 KEPT BOTH AND MADE THE RIM UNCONDITIONAL. B's own design carries a
// light outline on every floor (`docs/media/design/character/B.png` — it is
// what separates a robot from a desk, a plant and its neighbour), so the rim
// pass now runs on light floors too, at the stated 1.1 px; on a dark floor it
// runs at double that, which is the contrast device §3.9 measured. The pool is
// unchanged and still light-floors-only. Both drop below
// `RIG_DETAIL_MIN_PX` — the README's own risk note: at 100 agents the halo is
// the first thing that should stop being drawn.

/**
 * The ground pool, on a light floor. Drawn under the contact shadow, because
 * the shadow is a thing ON the floor and the pool is the floor.
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} ox @param {number} oy the figure's ground contact
 * @param {number} u px per plan unit
 */
export function drawHaloPool(ctx, ox, oy, u) {
  const r = FIGURE_HALO_POOL_SPAN * BODY_HEIGHT_U * u;
  if (!(r > 0)) return;
  const ch = channelsOf(FIGURE_HALO) || [255, 255, 255];
  const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, r);
  g.addColorStop(0, `rgba(${ch[0]},${ch[1]},${ch[2]},${FIGURE_HALO_POOL_ALPHA})`);
  g.addColorStop(1, `rgba(${ch[0]},${ch[1]},${ch[2]},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(ox, oy, r, 0, TAU);
  ctx.fill();
}

/**
 * How wide the rim is at this zoom, in px. Proportional to `u` so a character
 * drawn twice as large gets twice the edge rather than a hairline that
 * disappears, with a floor of 0.8 px so it never falls below a device pixel on
 * a floor drawn small.
 * @param {number} u
 */
export function haloRimWidth(u) {
  return Math.max(0.8, (FIGURE_HALO_RIM_PX * u) / BASE_U);
}

/**
 * The halo under one character, whichever device this floor calls for. Returns
 * `true` when the RIM should be laid at double width — a dark floor, where the
 * rim is the contrast device rather than only the outline.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} ox @param {number} oy @param {number} u
 * @param {number} lod the halo is not drawn at L0 (§4)
 * @returns {boolean} whether this floor wants the wide rim
 */
export function drawFigureHalo(ctx, ox, oy, u, lod) {
  if (lod < 1) return false;
  if (figureHaloMode() === 'rim') return true;
  drawHaloPool(ctx, ox, oy, u);
  return false;
}

export function drawContactShadow(ctx, ox, oy, u) {
  ctx.fillStyle = PALETTE.shadowContact;
  ctx.beginPath();
  ctx.ellipse(ox + SHADOW_OX * u, oy + SHADOW_OY * u, SHADOW_RX * u, SHADOW_RY * u, 0, 0, TAU);
  ctx.fill();
}

// ------------------------------------------------------- the figure's scratch
//
// Module scope, written once per character by `rigSetup`, so `drawRig` and
// every path builder under it allocate nothing at all. Same discipline, and
// same safety argument, as `rig-pose.js`'s frame: one character is drawn to
// completion before the next one starts.

let _k = null; // the pose skeleton
let _id = null; // the resolved identity slots
let _t = null; // the state colour, fanned out
let _h = 1; // the figure's height in screen px
let _lw = 1; // the ink weight in screen px
let _bw = 0.54; // barrel width, local
let _bh = 0.44; // barrel height, local
let _bx = 0; // barrel centre x, local
let _by = 0.43; // barrel centre y, local
let _hx = 0; // dome centre x, local
let _hy = 0.755; // dome centre y, local
let _hr = 0.235; // dome radius, local
let _detail = true; // draw the rim, the chest glyph and the far arm
let _tiny = false; // the state mark swaps to one bold form
let _droop = 0; // 0 upright, 1 fully drooped
let _phase = 0; // idle micro-motion, 0 under reduced motion
let _frame = 0; // which walk frame
// WP-87 · the two character-life terms the BODY carries. Everything else
// `life.js` computes is drawn by `rig.js` over the top of the figure; these two
// change the figure itself, so they live with the rest of its geometry.
let _flicker = 0; // visor flash on a real tool call, 0..1
let _power = 0; // power-down, 0 lit .. 1 dark
let _card = 1; // how open the held page is, 0 edge-on .. 1 flat

/**
 * Resolve one character's geometry into the scratch above.
 * @param {any} k the pose skeleton (`rig-pose.js`'s `RIG_POSES`)
 * @param {any} id the identity slots (`rig-traits.js`'s `rigIdentity`)
 * @param {any} tints the state colour fanned out (`rig-metrics.js`'s `rigTints`)
 * @param {number} h the figure's height, screen px
 * @param {number} phase idle phase in [0,1), 0 under reduced motion
 * @param {boolean} dim force the reduced drawing (L0)
 * @param {import('./life.js').Life|null} [life] WP-87's character life. Omitted
 *   — the manager's avatar, a caller that predates it — every term rests.
 */
export function rigSetup(k, id, tints, h, phase, dim, life) {
  _flicker = life ? life.flicker : 0;
  _power = life ? life.power : 0;
  _card = life ? life.card : 1;
  _k = k;
  _id = id;
  _t = tints;
  _h = h;
  _lw = rigLineWidth(h);
  _bw = SHELL_W[id.shell] || SHELL_W[0];
  _bh = 0.44 * (k.sq || 1);
  _bx = k.lean * 0.35;
  _by = k.by + _bh / 2;
  _hx = k.lean;
  _hy = k.hy;
  _hr = DOME_R[id.dome] || DOME_R[0];
  _detail = !dim && h >= RIG_DETAIL_MIN_PX;
  _tiny = h < RIG_MARK_MIN_PX;
  // A dead figure's antenna is fully drooped — unless it is still going down,
  // in which case the droop IS the power-down: the aerial falls over the same
  // 1.6 s the pane fades over, which is the only part of the strip that moves.
  _droop = tints.dead ? (_power > 0 ? _power : 1) : k.lean > 0.18 ? 0.7 : 0;
  _phase = phase || 0;
  _frame = k.walk ? walkFrame(phase * 2) : 0;
  rigArms(k);
}

/**
 * What this figure is currently dropping, as plain booleans. Exported so the
 * LOD test reads the rig's own answer rather than a second copy of the rule.
 * @returns {{rim:boolean, chestGlyph:boolean, farArm:boolean, boldMark:boolean}}
 */
export function rigDetail() {
  return { rim: _detail, chestGlyph: _detail, farArm: _detail, boldMark: _tiny };
}

// ------------------------------------------------------------ path builders

function basePath(ctx, grow) {
  const g = grow || 0;
  const k = _k;
  if (_id.shell === 2) {
    // A tread skirt instead of feet: the third silhouette, and the one that
    // reads at the smallest size because it is one mass.
    lRoundRect(ctx, 0, k.by * 0.6, _bw * 0.9 + g, k.by * 1.35 + g, k.by * 0.5, 0);
    return false;
  }
  const lift = k.walk && _frame === 0 ? 0.03 : 0;
  lRoundRect(
    ctx,
    -_bw * 0.22,
    k.by * 0.55 + lift,
    _bw * 0.34 + g,
    k.by * 1.3 + g,
    _bw * 0.14,
    k.recline ? -0.55 : 0,
  );
  return true;
}

function baseFootB(ctx, grow) {
  const g = grow || 0;
  const k = _k;
  const lift = k.walk && _frame === 1 ? 0.03 : 0;
  lRoundRect(
    ctx,
    _bw * 0.24,
    k.by * 0.55 + (k.recline ? 0.03 : 0) + lift,
    _bw * 0.34 + g,
    k.by * 1.3 + g,
    _bw * 0.14,
    k.recline ? -0.65 : 0,
  );
}

function barrelPath(ctx, grow) {
  const g = grow || 0;
  lRoundRect(ctx, _bx, _by, _bw + g, _bh + g, _bw * 0.28, -_k.lean * 0.5);
}

function domePath(ctx, grow) {
  const g = grow || 0;
  lEllipse(ctx, _hx, _hy, _hr * 1.06 + g, _hr * (_id.dome === 2 ? 1.14 : 0.98) + g, 0);
}

function nearArmPath(ctx) {
  lLimb(ctx, _bx + _bw * 0.4, _by + _bh * 0.2, _k.aR[0], _k.aR[1]);
}

function farArmPath(ctx) {
  lLimb(ctx, _bx - _bw * 0.4, _by + _bh * 0.2, _k.aL[0], _k.aL[1]);
}

// ---------------------------------------------------------------- the rim

/**
 * The rim pass: every mass of the silhouette, in the halo colour, `rim` px
 * proud. The real body is drawn immediately after and covers all but the edge.
 *
 * `rigSetup` must already have run — `drawCharacter` does that before calling
 * this, which is the one ordering rule the rig has.
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} rim the rim's width in screen px
 */
export function drawFigureRim(ctx, rim) {
  if (!_detail) return;
  ctx.fillStyle = FIGURE_HALO;
  ctx.strokeStyle = FIGURE_HALO;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = rim * 2;
  // A stroke of `2 * rim` centred on a filled path is that path grown by
  // `rim` on every side — one call per mass rather than a second geometry.
  const two = basePath(ctx, 0);
  ctx.fill();
  ctx.stroke();
  if (two) {
    baseFootB(ctx, 0);
    ctx.fill();
    ctx.stroke();
  }
  ctx.lineWidth = ln(0.12) + rim * 2;
  farArmPath(ctx);
  ctx.stroke();
  nearArmPath(ctx);
  ctx.lineWidth = ln(0.13) + rim * 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(_rHx, _rHy, ln(MITT_R) + rim, 0, TAU);
  ctx.fill();
  ctx.lineWidth = rim * 2;
  barrelPath(ctx, 0);
  ctx.fill();
  ctx.stroke();
  domePath(ctx, 0);
  ctx.fill();
  ctx.stroke();
}

// ------------------------------------------------------------- the body

function paint(ctx, fill, ink) {
  ctx.fillStyle = fill;
  ctx.fill();
  if (ink !== false) {
    ctx.strokeStyle = RIG_INK;
    ctx.lineWidth = _lw;
    ctx.stroke();
  }
}

/**
 * The base: two stubby feet, or the tread skirt. The one part of the figure
 * that touches the ground, and the one the walk cycle moves.
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawRigBase(ctx) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const two = basePath(ctx, 0);
  paint(ctx, _t.deep);
  if (two) {
    baseFootB(ctx, 0);
    paint(ctx, _t.deep);
  }
  // The boots: the project's deep tone, a band across the front of each foot.
  // One of the three "small elements" identity is allowed (design README).
  if (_detail && two) {
    ctx.fillStyle = _id.boot;
    lRoundRect(ctx, -_bw * 0.22, _k.by * 0.22, _bw * 0.34, _k.by * 0.4, _bw * 0.08, 0);
    ctx.fill();
    lRoundRect(ctx, _bw * 0.24, _k.by * 0.22, _bw * 0.34, _k.by * 0.4, _bw * 0.08, 0);
    ctx.fill();
  }
}

/** The far arm: the first thing to go below `RIG_DETAIL_MIN_PX`. */
export function drawRigFarArm(ctx) {
  if (!_detail) return;
  ctx.strokeStyle = _t.deep;
  ctx.lineCap = 'round';
  ctx.lineWidth = ln(0.12);
  farArmPath(ctx);
  ctx.stroke();
  ctx.fillStyle = _t.deep;
  ctx.beginPath();
  ctx.arc(_lHx, _lHy, ln(MITT_R * 0.86), 0, TAU);
  ctx.fill();
}

/**
 * The barrel: the state colour at full strength, over the whole body mass.
 *
 * This fill IS the legibility model. `test/unit/identity-visuals.test.mjs`
 * measures that it is `opts.color` exactly, at alpha 1, for every appearance
 * and at every LOD — if that ever stops being true the floor has stopped
 * answering the only question it exists to answer (VISUAL-SPEC §3, §5).
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawRigBarrel(ctx) {
  ctx.lineJoin = 'round';
  barrelPath(ctx, 0);
  paint(ctx, _t.col);

  // The lit top plane, which is what says "tilted toward the camera" rather
  // than "lying on the floor".
  lEllipse(ctx, _bx + _k.lean * 0.12, _by + _bh * 0.38, _bw * 0.44, _bh * 0.15, 0);
  ctx.fillStyle = _t.lite;
  ctx.fill();

  // The collar ring: the project's colour, small and at the top of the mass.
  lEllipse(ctx, _bx + _k.lean * 0.18, _by + _bh * 0.44, _bw * 0.3, _bh * 0.1, 0);
  ctx.fillStyle = _id.project;
  ctx.fill();

  // The chest plate, and the project glyph on it.
  lRoundRect(ctx, _bx, _by - _bh * 0.1, _bw * 0.52, _bh * 0.42, _bw * 0.11, -_k.lean * 0.5);
  ctx.fillStyle = _t.dark;
  ctx.fill();
  if (_detail) drawChestGlyph(ctx, _bx, _by - _bh * 0.1, _bw * 0.15, _id.glyph, _id.project);
}

/**
 * The near arm and its mitt — and, for `needs_input`, the raised hand.
 *
 * Drawn AFTER the barrel and BEFORE the dome, and never gated on detail: at
 * every level of detail and at every zoom this arm is drawn, because at
 * `needs_input` it is the message.
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawRigNearArm(ctx) {
  ctx.strokeStyle = _t.lite;
  ctx.lineCap = 'round';
  ctx.lineWidth = ln(0.13);
  nearArmPath(ctx);
  ctx.stroke();
  ctx.fillStyle = _id.mitt;
  ctx.beginPath();
  ctx.arc(_rHx, _rHy, ln(MITT_R), 0, TAU);
  ctx.fill();
  ctx.strokeStyle = RIG_INK;
  ctx.lineWidth = _lw;
  ctx.stroke();
}

/** The page a `for_review` robot is holding up. */
export function drawRigCard(ctx) {
  if (!_k.card) return;
  // WP-87's PAGE FLIP (§2): the page narrows to its own edge and comes back,
  // four frames over half a second, once every twelve. `_card` is 1 when it is
  // held flat, which is both the reduced-motion form and every frame but the
  // one in twenty-four this is turning in.
  const open = Math.max(0.06, _card);
  lRoundRect(ctx, 0, _k.aR[1] + 0.02, 0.32 * open, 0.2, 0.03, 0);
  paint(ctx, '#FBF7EE');
  // Edge-on there is nothing written on it to draw, and the two rules would
  // stand proud of a page a tenth of their length.
  if (!_detail || open < 0.7) return;
  ctx.strokeStyle = fade(RIG_INK, 0.5);
  ctx.lineWidth = _lw;
  ctx.beginPath();
  ctx.moveTo(lx(-0.1), ly(_k.aR[1] + 0.06));
  ctx.lineTo(lx(0.1), ly(_k.aR[1] + 0.06));
  ctx.moveTo(lx(-0.1), ly(_k.aR[1] - 0.01));
  ctx.lineTo(lx(0.06), ly(_k.aR[1] - 0.01));
  ctx.stroke();
}

/** The dome and its ear cups. The dome is the state colour, like everything. */
export function drawRigDome(ctx) {
  // Ear cups first, so the dome overlaps them.
  const ey = _hy - _hr * 0.14;
  lCircle(ctx, _hx - _hr * 1.04, ey, _hr * 0.34);
  paint(ctx, _t.deep);
  lCircle(ctx, _hx + _hr * 1.04, ey, _hr * 0.34);
  paint(ctx, _t.deep);
  if (_detail) {
    ctx.fillStyle = _id.accent;
    lCircle(ctx, _hx - _hr * 1.04, ey, _hr * 0.15);
    ctx.fill();
    lCircle(ctx, _hx + _hr * 1.04, ey, _hr * 0.15);
    ctx.fill();
  }
  domePath(ctx, 0);
  paint(ctx, _t.col);
  // The dome's own lit top plane.
  lEllipse(ctx, _hx, _hy + _hr * 0.52, _hr * 0.62, _hr * 0.22, 0);
  ctx.fillStyle = _t.lite;
  ctx.fill();
}

/**
 * THE VISOR: the state signal, and the most findable element on the floor.
 *
 * A bright pane with a dark mark, the state colour tinting both — the single
 * biggest finding of the design study, measured against the alternative
 * (a dark visor with a light mark), which did not survive 24 px. The pane is
 * drawn at every level of detail, without exception; only the MARK simplifies,
 * to one bold form below `RIG_MARK_MIN_PX`.
 *
 * `ended` is the one state with no light in it: the pane goes to
 * `RIG_PANE_DEAD` and the mark to `RIG_OFF`, which is what a powered-down
 * screen looks like and is why an ended session cannot be mistaken for a
 * working one at any size.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} state
 */
export function drawRigVisor(ctx, state) {
  const tilt = -_k.hrot * 0.5;
  const vy = _hy - _hr * 0.14 - _k.hrot * 0.16;
  // The blink: one frame in sixteen, the pane closes to a slot. Exactly zero
  // frames under reduced motion, because `_phase` is exactly zero there.
  const blink = _phase > 0.94 ? 0.24 : 1;
  lRoundRect(ctx, _hx, vy, _hr * 1.6, _hr * 0.8 * blink, _hr * 0.32 * blink, tilt);
  // WP-87 · THE POWER-DOWN, and it is drawn ON THE VISOR because the visor is
  // where this figure's power lives (§3.9, and `RIG_PANE_DEAD` above). Five
  // frames over 1.6 s, keyed to the session's own end timestamp so it runs once
  // and no re-render can run it again. Frame 5 IS the dead pane, which is what
  // an ended session has always been drawn with — so an ended figure that has
  // been ended for a while is pixel-for-pixel what it was before this package.
  // HOW MUCH LIGHT IS IN THE VISOR IS PART OF THE STATE.
  // `working`, `needs_input` and `for_review` are lit: something is happening,
  // or something is waiting on you. `stalled` is dimmed — it has gone quiet but
  // it is still live. `benched` is softer still, resting. `ended` has no power
  // in it at all. Three levels rather than two, because "gone quiet" and
  // "finished" are the two states a monitoring floor must never confuse.
  let pane = _t.dead
    ? RIG_PANE_DEAD
    : state === 'stalled'
      ? mixHex(RIG_PANE, RIG_PANE_DEAD, 0.5)
      : state === 'benched'
        ? mixHex(RIG_PANE, RIG_PANE_DEAD, 0.25)
        : RIG_PANE;
  // Mid power-down the pane is still on its way out; at `_power === 1` this is
  // exactly `RIG_PANE_DEAD` and the expression above it.
  if (_power > 0 && _power < 1) pane = mixHex(RIG_PANE, RIG_PANE_DEAD, _power);
  // THE FLICKER (§2): a real tool call opening, three frames over 0.24 s. It
  // brightens the pane rather than moving anything, because the visor is the
  // most findable element on the floor and a flash there is legible at 16 px
  // where a moved hand is not. It is capped at one per 0.5 s upstream, in
  // `AgentRuntime#sync`, so a tool loop cannot strobe.
  else if (_flicker > 0) pane = mixHex(pane, RIG_MARK, _flicker * 0.85);
  ctx.fillStyle = pane;
  ctx.fill();
  ctx.strokeStyle = RIG_INK;
  ctx.lineWidth = _lw * 0.9;
  ctx.stroke();
  if (blink < 1) return;
  drawStateMark(ctx, state, _hx, vy, _hr * 0.34, _t.dead ? RIG_OFF : _t.glass, _tiny);
  // The brow bar: the `glasses` slot, a raised ridge over the visor.
  if (_id.brow && _detail) {
    lRoundRect(ctx, _hx, vy + _hr * 0.52, _hr * 1.5, _hr * 0.16, _hr * 0.08, tilt);
    ctx.fillStyle = _t.deep;
    ctx.fill();
  }
}

/**
 * The crown accessory, then the rarity marker over it.
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawRigCrown(ctx) {
  // The antenna bob: a slow rise and fall, and exactly zero under reduced
  // motion because `_phase` is exactly zero there.
  const bob = _phase === 0 ? 0 : Math.sin(_phase * TAU) * 0.012;
  const hy = _hy + bob;
  ctx.lineJoin = 'round';
  crownPath(ctx, _id.crown, _hx, hy, _hr, _droop);
  paint(ctx, _id.accent);
  if (crownPathB(ctx, _id.crown, _hx, hy, _hr, _droop)) paint(ctx, _id.accent);
  if (_id.trait && _id.trait !== 'glow') {
    drawRarityTrait(ctx, _id.trait, _id.traitColor, _hx, hy, _hr, _bw, _by, RIG_INK);
  }
  if (_id.tier === 'legendary' && _detail) {
    lEllipse(ctx, _hx, hy + _hr * 1.52, _hr * 1.25, _hr * 0.36, 0);
    ctx.strokeStyle = fade(_id.traitColor, 0.65);
    ctx.lineWidth = _lw * 2.2;
    ctx.stroke();
  }
}

/**
 * The local y of the top of the DRAWN figure — crown accessory included, badge
 * excluded. What the over-head chrome hangs off.
 */
export function rigTopY() {
  return Math.max(
    crownTop(_id.crown, _hy, _hr, _droop),
    _hy + _hr * 1.14,
    _k.aR[1] + MITT_R + 0.04,
  );
}

/** The local y of the top of the raised hand. */
export function rigHandTopY() {
  return _k.aR[1] + MITT_R;
}

// ------------------------------------------------------------- the state mark

/**
 * The mark on the visor: six forms, one per state, each one a shape rather than
 * a glyph from a font.
 *
 * `tiny` is the sub-`RIG_MARK_MIN_PX` fallback — ONE bold form instead of the
 * full drawing. A three-bar `working` mark at 20 px of figure is three grey
 * pixels; one bar is still a bar, and the state colour is still doing the work
 * around it.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} state @param {number} cx @param {number} cy local
 * @param {number} r the mark's half-size, local
 * @param {string} color @param {boolean} tiny
 */
export function drawStateMark(ctx, state, cx, cy, r, color, tiny) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(_lw * 1.5, ln(r) * 0.36);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (state) {
    case 'working':
      // Three lines of output, or one bar when there is no room for three.
      if (tiny) {
        lRoundRect(ctx, cx, cy, r * 1.7, r * 0.44, r * 0.2, 0);
        ctx.fill();
      } else {
        lRoundRect(ctx, cx - r * 0.4, cy - r * 0.5, r * 1.1, r * 0.32, r * 0.12, 0);
        ctx.fill();
        lRoundRect(ctx, cx, cy, r * 1.9, r * 0.32, r * 0.12, 0);
        ctx.fill();
        lRoundRect(ctx, cx - r * 0.55, cy + r * 0.5, r * 0.8, r * 0.32, r * 0.12, 0);
        ctx.fill();
      }
      break;
    case 'needs_input':
      // An exclamation, because the visor is the one place the user's eye
      // lands after the badge.
      lRoundRect(ctx, cx, cy + r * 0.22, r * 0.52, r * 1.02, r * 0.2, 0);
      ctx.fill();
      lRoundRect(ctx, cx, cy - r * 0.66, r * 0.52, r * 0.42, r * 0.2, 0);
      ctx.fill();
      break;
    case 'stalled':
      // An ellipsis: the session said something and then stopped mid-sentence,
      // which is what `stalled` IS (01-PRODUCT §4.2 — `working` past the stall
      // window). The over-head icon carries the hourglass; the visor carries
      // the silence. One dot when there is no room for three.
      if (tiny) {
        lCircle(ctx, cx, cy, r * 0.3);
        ctx.fill();
      } else {
        for (const d of [-1, 0, 1]) {
          lCircle(ctx, cx + d * r * 0.62, cy, r * 0.26);
          ctx.fill();
        }
      }
      break;
    case 'for_review':
      // A tick.
      ctx.beginPath();
      ctx.moveTo(lx(cx - r * 0.78), ly(cy + r * 0.06));
      ctx.lineTo(lx(cx - r * 0.18), ly(cy - r * 0.58));
      ctx.lineTo(lx(cx + r * 0.84), ly(cy + r * 0.72));
      ctx.stroke();
      break;
    case 'ended':
      // A dead bar. Nothing is running.
      lRoundRect(ctx, cx, cy, r * 1.7, r * 0.36, r * 0.18, 0);
      ctx.fill();
      break;
    case 'benched':
      // A `z`, at rest.
      if (tiny) {
        lRoundRect(ctx, cx, cy, r * 1.5, r * 0.36, r * 0.18, 0);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(lx(cx - r * 0.66), ly(cy + r * 0.62));
        ctx.lineTo(lx(cx + r * 0.54), ly(cy + r * 0.62));
        ctx.lineTo(lx(cx - r * 0.66), ly(cy - r * 0.58));
        ctx.lineTo(lx(cx + r * 0.54), ly(cy - r * 0.58));
        ctx.stroke();
      }
      break;
    default:
      // The manager, and anything that is not one of the six: a lit pane with
      // nothing written on it. The user has no activity state.
      break;
  }
}
