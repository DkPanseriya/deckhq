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

import { PALETTE } from './palette.js';

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
 * Run `fn` with a soft drop/contact shadow applied, then restore. Every
 * furniture item gets one of these — it is what makes the render read as a
 * photograph rather than a diagram (VISUAL-SPEC §6).
 */
export function withShadow(ctx, fn, { blur = 8, oy = 3, color = PALETTE.shadowContact } = {}) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = oy;
  fn(ctx);
  ctx.restore();
}

// ------------------------------------------------------------------ props

export function drawContactShadow(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle = PALETTE.shadowContact;
  ctx.beginPath();
  ctx.ellipse(
    x + w / 2 + 2,
    y + h + 2,
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
