/**
 * The painting primitives the whole backdrop is built from
 * (WP-22 follow-up).
 *
 * Split out of `backdrop.js` unchanged: the seeded RNG that makes a plank
 * pattern deterministic, the offscreen canvas factory, the rounded rect, the
 * two-pass shadow, and the contact shadow every furniture item carries
 * (docs/03-VISUAL-SPEC.md §6).
 *
 * Canvas APIs are used only inside these functions, never at module scope, so
 * importing this file is safe where `OffscreenCanvas` does not exist.
 */

import { LIGHT_DIR, PALETTE } from './palette.js';

// ---- local colour tokens ------------------------------------------------
// palette.js is owned by another engineer on this build. A colour this file
// needs that PALETTE does not carry lives here instead, as a named constant
// with a comment explaining the gap — never as a bare literal buried in a
// paint case.
//
// LAMP_GLOW: the reception floor lamp needs a warm halo under its shade.
// Every glow PALETTE actually has (monitorScreenGlow, cabinetScreenGlow) is
// the same cool cyan tuned for a screen; reusing it here would make the
// lamp read as another monitor. Checked by hand against the reserved-
// crimson discipline in palette.js: rgb(255,214,140) is nowhere near
// STATE_COLORS.for_review (#C0392B).
export const LAMP_GLOW = 'rgba(255, 214, 140, 0.4)';

export const U_DEFAULT = 14;

/**
 * Deepest a prop's contact shadow may fall, in baked pixels. Depth says how
 * thick a thing is; without a ceiling, a very large flat prop cast a shadow
 * the size of a room. Roughly a rug's thickness at `U_DEFAULT`.
 */
export const CONTACT_SHADOW_MAX_PX = 10;

/**
 * How far past its own rect a prop's paint may reach, in plan units — foliage,
 * a lamp's glow, the soft edge of a shadow. Everything else is clipped.
 */
export const PROP_BLEED = 0.6;

// ---- how far each thing on the floor is lifted off it ---------------------
//
// Every one of these is a distance ALONG `LIGHT_DIR` in baked pixels, never a
// drop down the page, and that is the whole of WP-72's first acceptance
// criterion: an offset stated as a length on the ray cannot pick its own
// direction, so no shadow on this floor can point anywhere but down-right.
//
// The three that existed before this package are stated as `n * √2` so their
// components come out at exactly the `(n, n)` the floor already shipped with —
// a contact shadow at (2, 2), a wall at (2, 2), a prop at (3, 3). The floor
// gains a horizontal component and loses none of its vertical one.

/** A prop's two-pass drop shadow: 3 px down, 3 px right. */
export const PROP_SHADOW_DIST_PX = 3 * Math.SQRT2;
/** The dark line where a prop meets the floor. */
export const CONTACT_SHADOW_DIST_PX = 2 * Math.SQRT2;
/** A full-height wall's shadow onto the floor beside it. */
export const WALL_SHADOW_DIST_PX = 2 * Math.SQRT2;

/**
 * A ROOM IS A SLAB, AND THESE ARE ITS TWO NUMBERS (WP-72).
 *
 * `ROOM_SLAB_EDGE_PX` is the rim's width, in baked pixels at `U_DEFAULT`. It
 * has to survive the fit: the floor is drawn at between `MIN_SCALE` (7.5) and
 * `CHAR_MAX_PX_PER_UNIT` px per unit, so a rim of `n` baked pixels is
 * `n / U_DEFAULT * scale` px on screen, and 6 gives 3.2 px at the very
 * smallest a floor is ever drawn — the ">= 3 px at fit scale" the package asks
 * for, measured at the worst case rather than at the usual one.
 * `test/unit/lighting.test.mjs` re-derives that rather than trusting it.
 *
 * `ROOM_SLAB_SHADOW_*` is what the rim casts OUTWARD. Its reach — the blur
 * plus the offset — must stay well inside the circulation between two rooms,
 * or a floor of rooms becomes a floor of one dark band: `CORRIDOR` is 4 units,
 * which is 56 baked pixels, and 15 is under a third of it. The same test
 * asserts that against `CORRIDOR` itself rather than against 56.
 */
export const ROOM_SLAB_EDGE_PX = 6;
export const ROOM_SLAB_SHADOW_BLUR_PX = 10;
export const ROOM_SLAB_SHADOW_DIST_PX = 5;

/** The building's own shadow onto the studio ground: 8 px down, 8 px right. */
export const ENVELOPE_SHADOW_DIST_PX = 8 * Math.SQRT2;
export const ENVELOPE_SHADOW_BLUR_PX = 26;

/**
 * Small deterministic PRNG (mulberry32) seeded from a string. Re-baking the
 * same plan must be pixel-identical, so no `Math.random()` is used anywhere
 * in this file.
 * @param {string} seedStr
 * @returns {() => number} a function returning floats in [0, 1)
 */
export function seededRng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let seed = h >>> 0;
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create a canvas without touching the document: OffscreenCanvas where
 * available, a detached `<canvas>` element otherwise.
 * @param {number} w
 * @param {number} h
 */
export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h);
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function roundRect(ctx, x, y, w, h, r) {
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

/**
 * Point the context's shadow at the floor's one light (WP-72).
 *
 * THE ONLY PLACE `shadowOffsetX`/`shadowOffsetY` ARE WRITTEN. Four painters
 * cast — props, walls, room slabs, the building itself — and before this they
 * each set `shadowOffsetY` and left `shadowOffsetX` at zero, which is not "no
 * horizontal component" so much as "a light directly above the page, per
 * painter, by omission". `test/unit/lighting.test.mjs` reads the renderer's
 * own source and fails if a second place ever writes either property.
 *
 * `dist` is a distance along `LIGHT_DIR`, in baked pixels. See the constants
 * above for the four the floor actually uses.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {{blur?:number, dist?:number, color?:string}} [opts]
 */
export function setLightShadow(
  ctx,
  { blur = 8, dist = PROP_SHADOW_DIST_PX, color = PALETTE.shadowContact } = {},
) {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = LIGHT_DIR.x * dist;
  ctx.shadowOffsetY = LIGHT_DIR.y * dist;
}

/**
 * Where a thing lifted `dist` off the floor puts its shadow, in baked pixels.
 * The same vector `setLightShadow` writes, for the painters that place a shape
 * by hand rather than letting the context blur one.
 * @param {number} dist
 * @returns {{x:number, y:number}}
 */
export function shadowOffsetFor(dist) {
  return { x: LIGHT_DIR.x * dist, y: LIGHT_DIR.y * dist };
}

/**
 * Run `fn` with a soft drop/contact shadow applied, then restore. Every
 * furniture item gets one of these — it is what makes the render read as a
 * photograph rather than a diagram (VISUAL-SPEC §6).
 */
export function withShadow(ctx, fn, opts = {}) {
  ctx.save();
  setLightShadow(ctx, opts);
  fn(ctx);
  ctx.restore();
}

// ------------------------------------------------------------------ props

export function drawContactShadow(ctx, x, y, w, h) {
  // Placed by hand rather than blurred by the context, so it takes its
  // direction from `LIGHT_DIR` the same way every other shadow does (WP-72).
  // At 45° this is the (2, 2) the floor already shipped with, to the pixel.
  const off = shadowOffsetFor(CONTACT_SHADOW_DIST_PX);
  ctx.save();
  ctx.fillStyle = PALETTE.shadowContact;
  ctx.beginPath();
  ctx.ellipse(
    x + w / 2 + off.x,
    y + h + off.y,
    Math.max(w / 2, 4),
    // A contact shadow is the dark line where a thing meets the floor, and its
    // depth is a property of how THICK the thing is, not of how big it is.
    // Unbounded, a room-sized rug (WP-50 gives one to a room much larger than
    // its desk cluster) cast a 380 px ellipse across half the room.
    Math.min(CONTACT_SHADOW_MAX_PX, Math.max(h * 0.22, 3)),
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}
