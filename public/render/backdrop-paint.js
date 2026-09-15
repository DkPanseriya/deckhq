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

/**
 * THE EDGE BAND EVERY TABLE TOP SHOWS (WP-85b, `10-INTERIOR-DESIGN.md` §3.4).
 *
 * *"Every table shows its edge — a 0.15 U darker band on the light-away side, a
 * sheen on the lit side."* A size in PLAN UNITS rather than in baked pixels, for
 * the reason every other pattern size became one in WP-85a: a bake at any `u`
 * must lay the same furniture, and a 2 px band is a different piece of furniture
 * at a different zoom.
 */
export const TABLE_EDGE_U = 0.15;

/**
 * THE ARM AND THE BACK EVERY SEAT SHOWS (WP-85b, §3.4).
 *
 * *"Every seat shows its back — frame band far side, cushion near, arms at
 * 0.6 U; a rectangle with seams is a radiator."* Both were baked pixels (7 and
 * 6) and are units now, for `TABLE_EDGE_U`'s reason.
 */
export const SOFA_ARM_U = 0.6;
export const SOFA_BACK_U = 0.5;

/**
 * UNDO THE WRAPPER'S FACING TURN, for a prop whose RECT IS ITS FOOTPRINT.
 *
 * `paintProp` clips to the prop's own axis-aligned box and then rotates by
 * `prop.angle`, because a chair, a tub chair and a character all need to face
 * somewhere. A desk, a rug, a monitor, a tray, a low table and a framed print do
 * not: their `w × h` says how they LIE, the plan's bounds, anchors and tests all
 * read that unrotated box, and turning the drawing inside a clip cut to the box
 * renders an 8.8 × 3 desk as a 3 × 3 square.
 *
 * `sofa` and `manager` have cancelled it by hand since WP-22 — *"a 32 x 2.6 back
 * run rotated by its own facing renders as a 2.6 x 32 band straight across the
 * room"* — and everything else on the list got away with it because `angle` is
 * zero everywhere except in the ROW reception, which `buildOfficeRow` builds by
 * reflecting the portrait room in the diagonal and therefore hands every prop a
 * quarter turn. On that floor the user's desk, the wool rug, the low table and
 * the wall art were all being drawn square. `docs/DEVIATIONS.md` §163.
 *
 * @param {any} ctx @param {{angle?: number}} prop
 */
export function unturn(ctx, prop) {
  const a = (prop && prop.angle) || 0;
  if (a) ctx.rotate(-a);
}

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
 * HOW TALL EVERY PROP ON THIS FLOOR IS (WP-78).
 *
 * The owner, 14 September: _"The oval shadows sometimes are offset and make no
 * sense."_ They were right, and it was not a bug in the offset: WP-72 gave
 * everything on the floor the same 45-degree ray, which is correct for a thing
 * with height and wrong for a thing without one. A mug, a chair and a potted
 * plant are on the floor. An object lying on the floor does not throw a shadow
 * down and to the right of itself; it darkens the floor it is touching. Putting
 * a 2 px slide under a 2 U chair is what made the oval look detached from the
 * thing it belonged to.
 *
 * So height is DECLARED, per kind, here. Not inferred from `w * h`: a rug is
 * the biggest prop in a project room and the flattest thing in the building,
 * and a size heuristic gets that exactly backwards. Two values and no third —
 * `tall` casts along `LIGHT_DIR`, `short` casts straight down onto the floor
 * under it — because a floor plan drawn from above cannot show a gradient of
 * heights and should not pretend to.
 *
 * A kind with no entry here is a defect, not a default:
 * `test/unit/lighting.test.mjs` reads every `kind` the plan can emit and every
 * `case` the painters answer to, and fails on the first one this table does not
 * name. `PROP_HEIGHT` is checked rather than guessed, so the next prop somebody
 * adds has to say which it is.
 */
export const PROP_HEIGHT = Object.freeze({
  // --- tall: furniture you would walk around, and it casts like it.
  arcade_cabinet: 'tall',
  art: 'tall',
  armchair: 'tall',
  bar_counter: 'tall',
  board_game_table: 'tall',
  bookshelf: 'tall',
  counter: 'tall',
  desk: 'tall',
  dining_table: 'tall',
  exit_sign: 'tall',
  foosball: 'tall',
  fridge: 'tall',
  pinboard: 'tall',
  pool_table: 'tall',
  reception_desk: 'tall',
  screen: 'tall',
  shelf: 'tall',
  sofa: 'tall',
  sofa_corner: 'tall',
  table_tennis: 'tall',
  tv: 'tall',
  user_desk: 'tall',
  water_cooler: 'tall',
  whiteboard: 'tall',
  // WP-85c's plants. A TREE IS TALL and the other three are not, which is the
  // whole of why §3.6 gives them four silhouettes rather than one at four
  // scales: a 3.2 U canopy at head height casts along the ray like the
  // bookcase beside it, a 2.0 U bush on the floor casts straight down, and a
  // planter is a trough somebody steps over.
  plant_tree: 'tall',
  // --- short: on the floor, or standing on something that already is.
  bar_stool: 'short',
  box: 'short',
  // WP-85c's desk clutter. Everything here stands ON a desk that has already
  // cast its own shadow along the ray; a mug that cast a second one would be a
  // mug floating three pixels above the table it is sitting on.
  mug: 'short',
  notebook: 'short',
  sticky: 'short',
  plant_blade: 'short',
  plant_broad: 'short',
  planter: 'short',
  // WP-85c's doormat (§3.3), inside the reception door. Laid INTO the floor,
  // like the screed band it lies behind — a mat that cast along the ray would
  // be a mat somebody had left propped against the wall. The band itself is
  // not here because it is not a prop: it belongs to the doorway, which is
  // shared by the room and the corridor, so `backdrop-floor.js` paints it.
  doormat: 'short',
  chair: 'short',
  coffee_machine: 'short',
  coffee_table: 'short',
  desk_tray: 'short',
  fruit_bowl: 'short',
  lamp: 'short',
  magazine_table: 'short',
  monitor: 'short',
  rug: 'short',
  rug_round: 'short',
  side_table: 'short',
  tub_chair: 'short',
  // The manager is a character, not furniture: `drawManagerFigure` draws its
  // own contact shadow and `paintProp` skips the prop one. Named anyway, so
  // the guard below has an answer for every kind the plan emits.
  manager: 'short',
});

/**
 * Does this prop cast along the light, or straight down onto the floor?
 *
 * A prop may state its own `tall` — an explicit boolean on the object always
 * wins, which is the seam a one-off piece of furniture needs — and otherwise
 * the answer is its kind's entry in `PROP_HEIGHT`. An unknown kind reads short,
 * because a thing nobody has measured is better drawn flat than drawn floating.
 *
 * @param {{kind?: string, tall?: boolean}} prop
 * @returns {boolean}
 */
export function isTallProp(prop) {
  if (!prop) return false;
  if (prop.tall === true || prop.tall === false) return prop.tall;
  return PROP_HEIGHT[prop.kind] === 'tall';
}

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

/**
 * The dark line where a prop meets the floor.
 *
 * `tall` decides whether it is offset at all (WP-78). A tall prop's contact
 * shadow travels the 2 px along `LIGHT_DIR` WP-72 gave it, because the thing
 * above it really is lifted off the floor. A short one gets no offset: it sits
 * directly beneath, which is the whole of the owner's complaint about ovals
 * that "make no sense" beside the thing they belong to.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {boolean} [tall]
 */
export function drawContactShadow(ctx, x, y, w, h, tall = true) {
  // Placed by hand rather than blurred by the context, so it takes its
  // direction from `LIGHT_DIR` the same way every other shadow does (WP-72).
  // At 45° this is the (2, 2) the floor already shipped with, to the pixel.
  const off = tall ? shadowOffsetFor(CONTACT_SHADOW_DIST_PX) : { x: 0, y: 0 };
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
    //
    // WP-78: and a SHORT thing is by definition not thick. This ellipse is
    // painted over the bottom of the prop rather than under it, so on a rug or
    // a coffee table the old depth read as a detached smudge below the
    // furniture rather than as the line where it meets the floor — the second
    // half of the owner's "the oval shadows make no sense".
    tall
      ? Math.min(CONTACT_SHADOW_MAX_PX, Math.max(h * 0.22, 3))
      : Math.min(CONTACT_SHADOW_MAX_PX / 2, Math.max(h * 0.1, 2)),
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}
