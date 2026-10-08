/**
 * The painting primitives the whole backdrop is built from
 * (WP-22 follow-up).
 *
 * Split out of `backdrop.js` unchanged: the seeded RNG that makes a plank
 * pattern deterministic, the offscreen canvas factory, the rounded rect, the
 * two-pass shadow, and the contact every furniture item makes with the floor
 * (docs/03-VISUAL-SPEC.md §6).
 *
 * Canvas APIs are used only inside these functions, never at module scope, so
 * importing this file is safe where `OffscreenCanvas` does not exist.
 */

import { LIGHT_DIR, PALETTE } from './palette.js';
import { deviceScaleOf } from './device-px.js';
import { LOOK } from './look-derive.js';

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

/**
 * THE DESIGN GRID: 14 pixels to a plan unit.
 *
 * Every `*_PX` constant in the painters, every corner radius and every line
 * width is a number on this grid. It was also the resolution the floor was
 * BAKED at, and is not any more: `bakeBackdrop` takes the device pixels per unit
 * the floor is about to be drawn at and scales the whole drawing to it, so the
 * bitmap reaches the screen one pixel to one pixel. What a painter writes is
 * unchanged — it still draws on this grid — and `device-px.js` is how it learns
 * what one of these pixels is on the device, for the three things a transform
 * does not scale.
 */
export const U_DEFAULT = 14;

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
// EVERY LENGTH HERE IS IN PLAN UNITS, and is a distance ALONG THE LIGHT, never
// a drop down the page. A unit is about 0.30 m, so each row is a claim about a
// real object's shadow; and a length on the ray cannot pick its own direction,
// so no shadow on this floor can point anywhere but where the light travels.
// The `*_PX` names below are the same lengths on the 14 px design grid, kept
// for the callers that work in it.

/**
 * @type {Readonly<{propCast:number, wallCast:number, slab:number,
 *   slabBlur:number, slabEdge:number, envelope:number, envelopeBlur:number}>}
 */
export const SHADOW_U = Object.freeze({
  /** A tall prop's cast: about nine centimetres of shadow at noon. */
  propCast: 0.3,
  /** A full-height wall's cast onto the floor beside it. */
  wallCast: 0.22,
  /** A room slab's shadow onto the screed round it, and how soft it is. */
  slab: 5 / 14,
  slabBlur: 10 / 14,
  /** The slab's own rim, seen from above. */
  slabEdge: 6 / 14,
  /** The building's shadow onto the studio ground: 8 px down, 8 px right at noon. */
  envelope: (8 * Math.SQRT2) / 14,
  envelopeBlur: 26 / 14,
});

/** A cast is this soft: its blur, as a share of its own length. */
export const CAST_BLUR_RATIO = 0.55;

/**
 * WHERE A THING MEETS THE FLOOR.
 *
 * Contact is the object's own outline, a little larger and a little blurred,
 * straight underneath — never an oval laid along its foot. `CONTACT_GROW_U` is
 * how far past the outline it reaches and `CONTACT_BLUR_U` how soft its edge
 * is. A painter's path cannot be grown, so where the outline is the painter's
 * own (`grounded`) the reach is spent as blur; where it is a plain footprint
 * (`contactUnder`) it is grown for real.
 */
export const CONTACT_GROW_U = 0.06;
export const CONTACT_BLUR_U = 0.12;
/** A short thing presses on the floor less: its contact, as a share of a tall one's. */
export const SHORT_CONTACT_ALPHA = 0.8;

/** A tall prop's cast at noon, on the design grid. */
export const PROP_SHADOW_DIST_PX = SHADOW_U.propCast * U_DEFAULT;
/** A full-height wall's cast at noon, on the design grid. */
export const WALL_SHADOW_DIST_PX = SHADOW_U.wallCast * U_DEFAULT;

/**
 * A ROOM IS A SLAB, AND THESE ARE ITS TWO NUMBERS (WP-72).
 *
 * `ROOM_SLAB_EDGE_PX` is the rim's width on the design grid. It has to survive
 * the fit: the floor is drawn at between `MIN_SCALE` (7.5) and
 * `CHAR_MAX_PX_PER_UNIT` px per unit, so a rim of `n` design pixels is
 * `n / U_DEFAULT * scale` px on screen, and 6 gives 3.2 px at the very
 * smallest a floor is ever drawn. `test/unit/lighting.test.mjs` re-derives that
 * rather than trusting it.
 *
 * `ROOM_SLAB_SHADOW_*` is what the rim casts OUTWARD. Its reach — the blur
 * plus the offset — must stay well inside the circulation between two rooms,
 * or a floor of rooms becomes a floor of one dark band: `CORRIDOR` is 4 units,
 * and the reach is under a third of it. The same test asserts that against
 * `CORRIDOR` itself.
 */
export const ROOM_SLAB_EDGE_PX = SHADOW_U.slabEdge * U_DEFAULT;
export const ROOM_SLAB_SHADOW_BLUR_PX = SHADOW_U.slabBlur * U_DEFAULT;
export const ROOM_SLAB_SHADOW_DIST_PX = SHADOW_U.slab * U_DEFAULT;

/** The building's own shadow onto the studio ground. */
export const ENVELOPE_SHADOW_DIST_PX = SHADOW_U.envelope * U_DEFAULT;
export const ENVELOPE_SHADOW_BLUR_PX = SHADOW_U.envelopeBlur * U_DEFAULT;

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
  board_stand: 'tall',
  // A booth is a high back on three sides: it is the tallest seat on the floor.
  booth: 'tall',
  bookshelf: 'tall',
  // A coat stand is a pole taller than the people who use it.
  coat_stand: 'tall',
  counter: 'tall',
  desk: 'tall',
  dining_table: 'tall',
  exit_sign: 'tall',
  foosball: 'tall',
  fridge: 'tall',
  // A meeting table is a table: you walk round it, and it casts like a desk.
  meeting_table: 'tall',
  pinboard: 'tall',
  pool_table: 'tall',
  reception_desk: 'tall',
  screen: 'tall',
  shelf: 'tall',
  sofa: 'tall',
  sofa_corner: 'tall',
  // A high table: you stand at it, and it casts like the desks.
  standing_table: 'tall',
  table_tennis: 'tall',
  tv: 'tall',
  user_desk: 'tall',
  // A panel hangs on a wall at eye height: it throws along the light as the
  // whiteboard beside it does.
  wall_panel: 'tall',
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
  // A waste bin is knee high.
  bin: 'short',
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
  // Waist-high storage against a wall: it casts onto the floor it stands on.
  credenza: 'short',
  desk_tray: 'short',
  fruit_bowl: 'short',
  lamp: 'short',
  magazine_table: 'short',
  monitor: 'short',
  // A pendant lamp hangs from the ceiling and touches nothing: its painter
  // gives it neither a cast nor a contact. Named, so the guard has an answer.
  pendant: 'short',
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
 * BOTH ARE SCALED TO THE DEVICE HERE. A canvas applies its transform to
 * geometry and not to shadows: `shadowBlur` and the two offsets are device
 * pixels whatever `scale()` says. Written unscaled, a display reporting a pixel
 * ratio of 2 drew every shadow on this floor at half the size the design was
 * tuned at — 10 px of reach became 5 — and the lighting a HiDPI owner saw was
 * not the lighting in any golden. `deviceScaleOf` is 1 for a context nobody
 * has spoken for, so a recorder and a thumbnail are told what they always were.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {{blur?:number, dist?:number, color?:string}} [opts]
 */
export function setLightShadow(
  ctx,
  { blur = 8, dist = PROP_SHADOW_DIST_PX, color = PALETTE.shadowContact } = {},
) {
  const k = deviceScaleOf(ctx);
  const dir = lightDir();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * k;
  ctx.shadowOffsetX = dir.x * dist * k;
  ctx.shadowOffsetY = dir.y * dist * k;
}

/**
 * WHERE THE LIGHT IS TRAVELLING, in the look the floor is painted in.
 *
 * A look names its light — morning, noon or evening — and all three travel
 * down and to the right, so the floor's one-direction rule survives the choice.
 * Noon is `LIGHT_DIR` itself.
 * @returns {Readonly<{x:number, y:number}>}
 */
export function lightDir() {
  return (LOOK.light && LOOK.light.dir) || LIGHT_DIR;
}

/** How much longer than noon's a tall thing's shadow is, in this look's light. */
export function lightCast() {
  const cast = LOOK.light && LOOK.light.cast;
  return cast > 0 ? cast : 1;
}

/**
 * Where a thing lifted `dist` off the floor puts its shadow, in baked pixels.
 * The same vector `setLightShadow` writes, for the painters that place a shape
 * by hand rather than letting the context blur one.
 * @param {number} dist
 * @returns {{x:number, y:number}}
 */
export function shadowOffsetFor(dist) {
  const dir = lightDir();
  return { x: dir.x * dist, y: dir.y * dist };
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

// ---------------------------------------------------------------- contact

/**
 * A colour's alpha, scaled. Any `rgba()` the palette carries.
 * @param {string} colour @param {number} k
 */
export function alphaScaled(colour, k) {
  const m = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(
    String(colour).trim(),
  );
  if (!m) return colour;
  return `rgba(${m[1]},${m[2]},${m[3]},${Math.round(Number(m[4]) * k * 1000) / 1000})`;
}

/** The contact colour for a tall thing or a short one. @param {boolean} tall */
function contactColour(tall) {
  return tall ? PALETTE.shadowContact : alphaScaled(PALETTE.shadowContact, SHORT_CONTACT_ALPHA);
}

/**
 * PAINT A SHAPE STANDING ON THE FLOOR: its cast, its contact, and itself.
 *
 * `fn` draws the shape. A tall thing is drawn once throwing its cast along the
 * light — `SHADOW_U.propCast` long, times the mood — and once pressing its own
 * outline into the floor straight underneath. A short thing has no cast: it is
 * drawn once with its contact and once plain. Two fills either way, which is
 * what a prop has always cost.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {(ctx: any) => void} fn
 * @param {boolean} tall
 * @param {number} [u] px per plan unit on the design grid
 */
export function grounded(ctx, fn, tall, u = U_DEFAULT) {
  const contact = {
    blur: (CONTACT_BLUR_U + 2 * CONTACT_GROW_U) * u,
    dist: 0,
    color: contactColour(tall),
  };
  if (tall) {
    const length = SHADOW_U.propCast * u * lightCast();
    withShadow(ctx, fn, { blur: CAST_BLUR_RATIO * length, dist: length });
    withShadow(ctx, fn, contact);
    return;
  }
  withShadow(ctx, fn, contact);
  fn(ctx);
}

/**
 * CONTACT UNDER A PLAIN FOOTPRINT, for a thing that is laid rather than stood:
 * a rug, a mat. The footprint's own outline grown `CONTACT_GROW_U`, blurred
 * `CONTACT_BLUR_U`, straight underneath. Painted BEFORE the thing, which then
 * covers all of it but the rim.
 *
 * `r` is the corner radius; a radius of half the smaller side is a circle.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} [r] @param {boolean} [tall] @param {number} [u]
 */
export function contactUnder(ctx, x, y, w, h, r = 0, tall = false, u = U_DEFAULT) {
  if (!(w > 0) || !(h > 0)) return;
  const g = CONTACT_GROW_U * u;
  const colour = contactColour(tall);
  ctx.save();
  setLightShadow(ctx, { blur: CONTACT_BLUR_U * u, dist: 0, color: colour });
  ctx.fillStyle = colour;
  roundRect(ctx, x - g, y - g, w + 2 * g, h + 2 * g, r + g);
  ctx.fill();
  ctx.restore();
}
