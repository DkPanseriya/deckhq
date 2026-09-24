/**
 * B's local frame, its six poses, and the primitives every part is built from
 * (WP-22 follow-up; rewritten for WP-79).
 *
 * THE FRAME. Origin at the ground contact, y UP, one local unit =
 * `RIG_UNIT_U` plan units. `rigFrame(ox, oy, h)` is entered once per character
 * and every helper below reads the module's scratch numbers it writes, so a
 * local point becomes a screen point in exactly one place. Nothing rotates with
 * `bodyAngle`: B is BILLBOARDED, which is how a 45° three-quarter figure and a
 * top-down plan can share one picture (the convention every top-down RPG uses
 * — `docs/media/design/character/README.md`).
 *
 * NO `ctx.save`/`ctx.rotate` PER PART, and no `Path2D`. The scratch numbers are
 * module scope on purpose: `drawCharacter` allocates no objects or arrays per
 * call, which is what holds 25 animated characters at 60 fps
 * (docs/02-ARCHITECTURE.md §8). It also means every coordinate handed to `ctx`
 * already IS the final screen coordinate, which is what the point-recording
 * fake contexts in the test suite measure.
 */

import { RIG_UNIT_U, TAU } from './rig-metrics.js';

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

// ------------------------------------------------------------- the six poses
//
// One skeleton per state, plus `walking`. Every field is in the local frame.
//
//   lean     forward (+) / back (-) tilt of the barrel and the dome
//   by       the barrel's bottom edge: how low the figure sits
//   hy       the dome's centre
//   hrot     the dome's pitch; it also slides the visor down the face
//   aR/aL    the right and left mitt, in local coordinates
//   sq       vertical squash on the barrel: a slumped robot is shorter
//   stand    standing rather than seated (feet apart, under the body)
//   recline  the benched sprawl: feet out to one side
//   card     holding a page up — `for_review` and nothing else
//
// These are the study's own numbers (`docs/media/design/character/lib.js`,
// `skelB`), ported rather than re-invented: they are what the owner looked at.

/** @type {Readonly<Record<string, any>>} */
export const RIG_POSES = Object.freeze({
  working: Object.freeze({
    lean: 0.12,
    by: 0.21,
    hy: 0.755,
    hrot: 0.18,
    aR: [0.3, 0.27],
    aL: [-0.29, 0.28],
    sq: 1,
  }),
  // THE ONE POSE THAT MUST NEVER BE OCCLUDED. The hand goes to 0.97 — clear
  // above the dome — and `drawCharacter` draws it after the head for exactly
  // that reason. `handTop()` below is what the test measures.
  needs_input: Object.freeze({
    lean: -0.02,
    by: 0.22,
    hy: 0.775,
    hrot: -0.05,
    // Out as well as up. The study put the mitt at 0.27 — hard against the
    // dome's own edge and inside the ear cup's circle — which reads as a bump
    // on the head rather than as a hand. 0.36 puts clear air between the arm
    // and the head at every size the floor is drawn at.
    aR: [0.36, 1.03],
    aL: [-0.3, 0.26],
    sq: 1,
  }),
  stalled: Object.freeze({
    lean: 0.2,
    by: 0.17,
    hy: 0.665,
    hrot: 0.46,
    aR: [0.26, 0.12],
    aL: [-0.25, 0.13],
    sq: 0.93,
  }),
  for_review: Object.freeze({
    lean: -0.03,
    by: 0.27,
    hy: 0.855,
    hrot: -0.04,
    aR: [0.15, 0.44],
    aL: [-0.15, 0.44],
    sq: 1,
    stand: 1,
    card: 1,
  }),
  ended: Object.freeze({
    lean: 0.27,
    by: 0.14,
    hy: 0.595,
    hrot: 0.66,
    aR: [0.24, 0.07],
    aL: [-0.23, 0.08],
    sq: 0.87,
  }),
  benched: Object.freeze({
    lean: -0.26,
    by: 0.18,
    hy: 0.665,
    hrot: -0.3,
    aR: [0.34, 0.36],
    aL: [-0.34, 0.52],
    sq: 1,
    recline: 1,
  }),
  // Walking is B's seventh pose and the one the study did not have to draw,
  // because the sheet is a still. Two frames and nothing between them: a
  // chunky robot's walk reads as a waddle, and a waddle is a step and its
  // mirror. `walkFrame` picks which.
  walking: Object.freeze({
    lean: 0.06,
    by: 0.24,
    hy: 0.8,
    hrot: 0.06,
    aR: [0.33, 0.33],
    aL: [-0.33, 0.26],
    sq: 1,
    stand: 1,
    walk: 1,
  }),
});

/** The six states the floor can be in, in VISUAL-SPEC §5's order. */
export const RIG_STATES = Object.freeze([
  'working',
  'needs_input',
  'stalled',
  'for_review',
  'ended',
  'benched',
]);

/**
 * The pose for a state, total over anything a caller might hand it.
 *
 * `let_go` and any unknown name fall through to `ended` — a session that is not
 * running is a powered-down robot, which is the honest picture for both.
 * @param {string} state
 */
export function rigPoseFor(state) {
  return RIG_POSES[state] || (state === 'walking' ? RIG_POSES.walking : RIG_POSES.ended);
}

/**
 * THE ONE PLACE TIME ENTERS THE FIGURE (WP-79).
 *
 * Idle micro-motion — the antenna bob and the visor blink — is a phase in
 * `[0, 1)` and nothing else, and it comes from the injected clock the caller
 * already has (`public/clock.js` via `scene-draw.js`, `minifloor.js`, the
 * panel's close-up). There is no `Date.now()` and no `Math.random()` anywhere
 * under this function, which is what lets a golden be a golden.
 *
 * Under `prefers-reduced-motion` it returns exactly `0` — not "a small value",
 * not "the first frame": zero, so every term derived from it drops out of the
 * arithmetic entirely and the figure is the static one the design sheets show
 * (VISUAL-SPEC §10, and the sheets' own note that they *are* the reduced-motion
 * render).
 *
 * WP-87 added the third case. `pinned` — a number in `[0, 1)`, from `?phase=` —
 * returns exactly that, WITHOUT the figure going still: the bob and the blink
 * are held at one point of their cycle while everything else on the floor keeps
 * animating, which is what lets a golden photograph a moving frame rather than
 * the reduced-motion render. `reduced` still wins over it, because a reader who
 * asked for no motion gets none however the URL is written.
 *
 * @param {number} seconds elapsed seconds from the injected clock
 * @param {boolean} [reduced]
 * @param {number|null} [pinned] WP-87's `?phase=`, or null for the clock
 * @returns {number} a phase in [0, 1), or 0 under reduced motion
 */
export function idlePhase(seconds, reduced, pinned) {
  if (reduced) return 0;
  if (typeof pinned === 'number' && Number.isFinite(pinned)) {
    const pin = pinned % 1;
    return pin < 0 ? pin + 1 : pin;
  }
  const s = Number(seconds);
  if (!Number.isFinite(s)) return 0;
  const period = 3.4; // one bob and one blink; deliberately not a round number
  let p = (s % period) / period;
  if (p < 0) p += 1;
  return p;
}

// ------------------------------------------------------------- sitting down
//
// WP-97. Until this package every figure on the floor stood, including the
// ones at a desk, on a sofa and in a crew — the rig had no way to sit. These
// are the three ways B sits, and each one is a function of the STATE pose
// rather than a seventh set of numbers per state, so the upper body keeps
// saying exactly what it said standing:
//
//   desk   at a task chair, hands to the keys: shins down to the floor, the
//          knees tucked under the barrel, the body a chair's height lower.
//   sofa   reclined: the body tipped back, the legs out along the cushion.
//   floor  cross-legged, a laptop on the knees — a crew member (WP-89).
//
// THE FEET POINT DOES NOT MOVE. The frame's origin is still the ground
// contact, so the label, the halo, the contact shadow, the hit box and the
// chrome above the head all hang off the same point they always did; what
// moves is how far above it the body is drawn.
//
// THE RAISED HAND DOES NOT MOVE EITHER. Every hand below `RAISED_Y` sinks with
// the body; a raised one stays exactly where `needs_input` put it, so a seated
// figure's hand clears its own dome by MORE than a standing one's does.

/** The three seats, in the order the tests walk them. */
export const RIG_SEATS = Object.freeze(['desk', 'sofa', 'floor']);

/** How far each seat lowers the barrel's bottom edge, local units. */
const SEAT_DROP = Object.freeze({ desk: 0.08, sofa: 0.09, floor: 0.15 });
/** The extra drop of the short silhouette drawn below `RIG_DETAIL_MIN_PX`. */
const SHORT_DROP = 0.035;
/** A mitt at or above this local height is a raised hand, and never sinks. */
const RAISED_Y = 0.9;
/** A standing pose (`for_review`) is seated from this bottom edge. */
const STAND_BY = 0.22;

/**
 * One seated skeleton, from a state's standing one. Pure, and called only at
 * module load: `SEATED` below holds every answer, so `drawCharacter` looks one
 * up rather than allocating one.
 * @param {any} k @param {'desk'|'sofa'|'floor'} seat @param {boolean} short
 */
function seatPose(k, seat, short) {
  const base = k.stand ? STAND_BY : k.by;
  const by = Math.max(0.05, base - SEAT_DROP[seat] - (short ? SHORT_DROP : 0));
  const drop = k.by - by;
  const sink = (a) => (a[1] >= RAISED_Y ? a : Object.freeze([a[0], a[1] - drop]));
  // The crew's hands go to the laptop on the knees, not to where a standing
  // pose happened to hold them; a raised hand is still a raised hand.
  const lap = (a, x) => (a[1] >= RAISED_Y ? a : Object.freeze([x, by + 0.13]));
  return Object.freeze({
    lean: seat === 'sofa' ? Math.min(k.lean, -0.16) : k.lean,
    by,
    hy: k.hy - drop,
    hrot: k.hrot,
    aR: seat === 'floor' ? lap(k.aR, 0.2) : sink(k.aR),
    aL: seat === 'floor' ? lap(k.aL, -0.19) : sink(k.aL),
    sq: k.sq,
    card: k.card || 0,
    seat,
    short: short ? 1 : 0,
  });
}

/**
 * Every seated skeleton, as `SEATED[state][seat][short]`. Built once, and
 * nested rather than keyed by a joined string so a lookup builds nothing.
 */
const SEATED = {};
for (const state of RIG_STATES) {
  SEATED[state] = {};
  for (const seat of RIG_SEATS) {
    SEATED[state][seat] = [seatPose(RIG_POSES[state], seat, false), seatPose(RIG_POSES[state], seat, true)];
  }
}

/**
 * The pose for a state in a seat — or, for no seat, the standing one.
 *
 * `short` is the silhouette below `RIG_DETAIL_MIN_PX`: the legs merge into one
 * low mass and the body sits a little lower still. The visor and the raised
 * hand are not in it; nothing about sitting touches either.
 * @param {string} state
 * @param {string|null|undefined} seat `'desk'`, `'sofa'`, `'floor'`, or none
 * @param {boolean} [short]
 */
export function rigSeatedPose(state, seat, short) {
  if (seat !== 'desk' && seat !== 'sofa' && seat !== 'floor') return rigPoseFor(state);
  const row = SEATED[state] || SEATED.ended;
  return row[seat][short ? 1 : 0];
}

/**
 * Which of B's two walk frames to draw, from the clip's own leg phase. Two
 * frames, so this is a step function rather than a blend.
 * @param {number} legPhase
 */
export function walkFrame(legPhase) {
  const p = Number(legPhase);
  if (!Number.isFinite(p)) return 0;
  return ((p % 1) + 1) % 1 < 0.5 ? 0 : 1;
}

// ------------------------------------------------------------- the frame

// Scratch frame: the ground contact in screen px, and the figure's height in
// screen px (one local unit). Written by `rigFrame`, read by every helper
// below. Safe because `drawCharacter` runs synchronously to completion per
// character; nothing re-enters while a previous figure is still pending.
export let _ox = 0;
export let _oy = 0;
export let _h = 1;

/**
 * Enter a character's local frame.
 * @param {number} ox @param {number} oy the ground contact, screen px
 * @param {number} h one local unit, in screen px (the figure's height)
 */
export function rigFrame(ox, oy, h) {
  _ox = ox;
  _oy = oy;
  _h = h;
}

/** How tall the figure is drawn, in screen px, at plan scale `u`. */
export function rigHeight(u) {
  return RIG_UNIT_U * u;
}

/** A local x to a screen x. */
export function lx(x) {
  return _ox + x * _h;
}

/** A local y to a screen y. The frame's y runs UP; the canvas's runs down. */
export function ly(y) {
  return _oy - y * _h;
}

/** A local length to screen px. */
export function ln(n) {
  return n * _h;
}

/** The line weight every outline on the figure is drawn at, in screen px. */
export function rigLineWidth(h) {
  return Math.max(0.95, h * 0.023);
}

// Scratch world-space hand positions, filled by `rigArms` and read by the prop
// drawers in `rig-props.js` — a mug, a plate, a paddle and a cue are all
// positioned off a mitt.
export let _rHx = 0,
  _rHy = 0,
  _lHx = 0,
  _lHy = 0;

/**
 * Put both mitts in screen space for this pose. `rig-props.js` reads the
 * result; so does the rim pass, which needs an arm's geometry before the body
 * is painted over it.
 * @param {{aR:number[], aL:number[]}} k
 * @param {number} [dR] @param {number} [dL] WP-97's typing tap: how far each
 *   mitt is lifted off the pose, local units. Zero for anything standing.
 */
export function rigArms(k, dR, dL) {
  _rHx = lx(k.aR[0]);
  _rHy = ly(k.aR[1] + (dR || 0));
  _lHx = lx(k.aL[0]);
  _lHy = ly(k.aL[1] + (dL || 0));
}

/**
 * The top of the raised hand, in LOCAL units — the mitt's centre plus its
 * radius. Pure, so `test/unit/rig-orientation.test.mjs` can assert that
 * `needs_input` puts it above the dome at every LOD without rendering.
 * @param {{aR:number[]}} k
 */
export function handTop(k) {
  return k.aR[1] + MITT_R;
}

/**
 * The top of the dome, in LOCAL units: the head's centre plus its radius.
 * @param {{hy:number}} k @param {number} headR
 */
export function domeTop(k, headR) {
  return k.hy + headR * 1.14;
}

/** The mitt's radius, in local units. */
export const MITT_R = 0.075;

// ---------------------------------------------------------------- primitives

/**
 * A circle in the local frame.
 * @param {CanvasRenderingContext2D} ctx
 */
export function lCircle(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.arc(lx(cx), ly(cy), Math.max(0.1, ln(r)), 0, TAU);
}

/**
 * An ellipse in the local frame. `rot` is a local (y-up) angle, so it is
 * negated on the way to the canvas (y-down).
 * @param {CanvasRenderingContext2D} ctx
 */
export function lEllipse(ctx, cx, cy, rx, ry, rot) {
  ctx.beginPath();
  ctx.ellipse(lx(cx), ly(cy), Math.max(0.1, ln(rx)), Math.max(0.1, ln(ry)), -(rot || 0), 0, TAU);
}

/**
 * A rounded rectangle, centred on `(cx, cy)` and rotated by a local angle.
 *
 * Built by hand out of `moveTo`/`lineTo`/`quadraticCurveTo` rather than
 * `ctx.roundRect` or `Path2D` for the reason the rest of this renderer avoids
 * them: the fake contexts the unit suite draws through implement exactly the
 * primitives this file already used, and a rotated box is not something
 * `roundRect` can express anyway.
 * @param {CanvasRenderingContext2D} ctx
 */
export function lRoundRect(ctx, cx, cy, w, h, r, ang) {
  const a = ang || 0;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const hw = w / 2;
  const hh = h / 2;
  const rad = Math.min(r, hw, hh);
  // Eight corner points of the rounded box, in the box's own axes, then
  // rotated and mapped. `p(i)` is the screen point for local box coords.
  const px = (bx, by) => lx(cx + bx * cos - by * sin);
  const py = (bx, by) => ly(cy + bx * sin + by * cos);
  ctx.beginPath();
  ctx.moveTo(px(-hw + rad, hh), py(-hw + rad, hh));
  ctx.lineTo(px(hw - rad, hh), py(hw - rad, hh));
  ctx.quadraticCurveTo(px(hw, hh), py(hw, hh), px(hw, hh - rad), py(hw, hh - rad));
  ctx.lineTo(px(hw, -hh + rad), py(hw, -hh + rad));
  ctx.quadraticCurveTo(px(hw, -hh), py(hw, -hh), px(hw - rad, -hh), py(hw - rad, -hh));
  ctx.lineTo(px(-hw + rad, -hh), py(-hw + rad, -hh));
  ctx.quadraticCurveTo(px(-hw, -hh), py(-hw, -hh), px(-hw, -hh + rad), py(-hw, -hh + rad));
  ctx.lineTo(px(-hw, hh - rad), py(-hw, hh - rad));
  ctx.quadraticCurveTo(px(-hw, hh), py(-hw, hh), px(-hw + rad, hh), py(-hw + rad, hh));
  ctx.closePath();
}

/**
 * A limb: a round-capped stroke from one local point to another. Stroked
 * rather than filled, so the halo pass is the same call at a wider width.
 * @param {CanvasRenderingContext2D} ctx
 */
export function lLimb(ctx, ax, ay, bx, by) {
  ctx.beginPath();
  ctx.moveTo(lx(ax), ly(ay));
  ctx.lineTo(lx(bx), ly(by));
}

// ---------------------------------------------------------------- rounded box

/**
 * The rounded-rect path itself, in SCREEN space, so fill and stroke can share
 * one definition. Kept for the chrome — badges, bubbles and panels — which is
 * axis-aligned and lives in screen px, not in the figure's frame.
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
