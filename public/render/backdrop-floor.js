/**
 * What the floor and its walls are made of (WP-22 follow-up).
 *
 * The floor materials that shipped first, the circulation lane, the slab a
 * room stands on, and the walls: the outside wall, the three styles of
 * partition between two rooms, the baseboard at their feet and the doors in
 * them. Daylight and the shade at a wall's foot are `backdrop-light.js`.
 *
 * All of it is baked once per plan change and blitted per frame — nothing
 * here runs in the frame loop (docs/02-ARCHITECTURE.md §8).
 */

import { fadedOut, PALETTE, washedCarpet } from './palette.js';
import { registerBodyScale } from './plan-scale.js';
import { deviceGrid, deviceScaleOf, snapPx, snapScaleOf, snapWidth } from './device-px.js';
import {
  alphaScaled,
  lightCast,
  roundRect,
  setLightShadow,
  CAST_BLUR_RATIO,
  CONTACT_BLUR_U,
  ROOM_SLAB_EDGE_PX,
  ROOM_SLAB_SHADOW_BLUR_PX,
  ROOM_SLAB_SHADOW_DIST_PX,
  SHADOW_U,
  SHORT_CONTACT_ALPHA,
  U_DEFAULT,
} from './backdrop-paint.js';
import { LOOK } from './look-derive.js';
import { DOOR_LEAF_U, DOOR_OPEN_DEG, DOOR_OPENING_U, DOOR_SWING_ALPHA } from './look-ambience.js';

// ------------------------------------------------- how big the patterns are
//
// WP-85a. Every pattern on this floor is a size in PLAN UNITS rather than in
// baked pixels, and that is the difference between a material and a texture: a
// unit is about 0.30 m (`docs/plan/10-INTERIOR-DESIGN.md` heading), so a number
// here is a claim about a real floor that anybody can check against a real
// building. The bake happens to run at `U_DEFAULT`, and these were tuned there;
// stating them in units means a bake at any other `u` lays the same floor
// rather than the same bitmap.

/**
 * The herringbone lattice, in units (§3.2). Was 46 baked px — 3.29 U — which
 * made a block 4.67 U × 1.58 U, or 1.40 m × 0.47 m. A real herringbone block is
 * 0.30–0.60 m by 0.07–0.10 m: three times too long, five times too wide, twelve
 * times the area, and a board measured 65 px in `three.png` against a 24 px
 * character. At 1.71 U the block is 2.43 U × 0.82 U — 0.73 m × 0.25 m — which
 * is a wide-format parquet rather than a decking plank.
 */
export const HERRINGBONE_CELL_U = 24 / U_DEFAULT;

/** A block's length and width as fractions of the cell. 45°, which is what makes a warm room read warm. */
export const HERRINGBONE_BLOCK_L = 1.42;
export const HERRINGBONE_BLOCK_W = 0.48;

/** The seam between two blocks, in units. Was 1.6 baked px at 0.55 alpha. */
export const HERRINGBONE_SEAM_U = 0.8 / U_DEFAULT;

/**
 * The carpet weave's pitch, in units (§3.2). Two hairline passes at 3 baked px:
 * far enough apart to read as a weave under a 2× crop, close enough to vanish
 * into one tone at fit scale, which is what a floor is supposed to do.
 */
export const CARPET_WEAVE_PITCH_U = 3 / U_DEFAULT;

/** The kitchen tile's grid, in units (§3.2): 22 baked px, down from 30. */
export const TILE_CELL_U = 22 / U_DEFAULT;

/**
 * A threshold's pool of light, in units (§3.3). A doorway is how a plan says
 * *you are entering something*, and a pool is the cheapest way to say it that
 * costs no floor area and blocks no route.
 */
export const DOOR_POOL_R_U = 2.8;

/**
 * THE SCREED THRESHOLD (§3.3), 4.4 U along the wall by 0.4 U across it.
 *
 * *"Three new threshold pieces, because they are how a plan says you are
 * entering something."* This is the first of them and it belongs to the FLOOR
 * rather than to a room: a doorway is shared by the room and the corridor
 * outside it, and a band that belonged to one of them would stop at the wall.
 * It is also the only one of the three that has to know where the door is, and
 * the door is assigned after every room has been built (`assignDoors`).
 *
 * Laid INTO the screed, under the pool of light that lands on it, so a
 * threshold reads as a change of surface rather than as a step.
 */
export const THRESHOLD_RUN_U = 4.4;
export const THRESHOLD_DEPTH_U = 0.4;

/**
 * How far a desk's pool reaches past the desk itself, in units. The pool is a
 * downlight over a workstation, so it has to take in the chair and the person
 * as well as the worktop — a pool that stopped at the desk edge would read as a
 * lighter desk rather than as a lit place.
 */
export let DESK_POOL_MARGIN_U = 2.2;

// WP-88c, §2: *"desk light-pool margin"* is one row of the scaling table, and
// the reason is in the sentence above it — the pool takes in the chair and the
// PERSON as well as the worktop, so a pool sized for a 2.52 U figure is a stain
// round the feet of a 3.15 U one. The pattern cells at the top of this file are
// the other side of the law and do not move: a floor is laid by the building.
registerBodyScale((s) => {
  DESK_POOL_MARGIN_U = 2.2 * s;
});

/**
 * Which props stand under a downlight (§3.2): the manager's desk, and every
 * working desk. Not the lounge — its bays and their centrepieces are WP-85c,
 * and a pool with nothing under it is a stain.
 * @type {ReadonlyArray<string>}
 */
export const LIT_PROP_KINDS = Object.freeze(['user_desk', 'reception_desk', 'desk']);

// ------------------------------------------------------------- materials

/**
 * The boards: reception and lounge (§3.2).
 *
 * A 1.71 U herringbone in four tones a thirtieth apart, seamed at a fifth of an
 * alpha. The four tones and the seam are the theme's (see `themes.js`); the
 * geometry is here, and both halves were the loudest thing in the product
 * before WP-85a.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {() => number} rng
 * @param {number} [u] px per plan unit; the bake's own `u`.
 */
export function paintHerringbone(ctx, x, y, w, h, rng, u = U_DEFAULT) {
  const CELL = HERRINGBONE_CELL_U * u;
  const L = CELL * HERRINGBONE_BLOCK_L;
  const W = CELL * HERRINGBONE_BLOCK_W;
  const tones = [
    PALETTE.woodHerringboneA,
    PALETTE.woodHerringboneB,
    PALETTE.woodHerringboneC,
    PALETTE.woodHerringboneD,
  ];
  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();
  ctx.fillStyle = PALETTE.woodHerringboneB;
  ctx.fillRect(x, y, w, h);

  const cols = Math.ceil(w / CELL) + 3;
  const rows = Math.ceil(h / CELL) + 3;
  ctx.lineWidth = HERRINGBONE_SEAM_U * u;
  for (let j = -2; j < rows; j++) {
    for (let i = -2; i < cols; i++) {
      const dir = (i + j) % 2 === 0 ? 1 : -1;
      const toneIdx = Math.floor(rng() * tones.length);
      ctx.save();
      ctx.translate(x + i * CELL, y + j * CELL);
      ctx.rotate((dir * 45 * Math.PI) / 180);
      ctx.fillStyle = tones[toneIdx];
      ctx.fillRect(0, 0, L, W);
      ctx.strokeStyle = PALETTE.woodHerringboneSeam;
      ctx.strokeRect(0, 0, L, W);
      ctx.fillStyle = PALETTE.woodHerringboneSheen;
      ctx.fillRect(0, 0, L, W * 0.32);
      ctx.restore();
    }
  }
  ctx.restore();
}

/**
 * Woven carpet, warm grey — a WEAVE since WP-85a (§3.2).
 *
 * `tint` is the identity colour of the project whose room this is, or nothing
 * for the circulation that happens to be carpeted (WP-72). The carpet moves
 * `CARPET_IDENTITY_WASH` — six per cent — of the way toward it and no further:
 * the room agrees with the ring on the agent sitting in it, and the surface is
 * still a carpet. The WEAVE is untouched by the wash, so it stays one material
 * across the whole floor and only its ground shifts.
 *
 * IT USED TO SCATTER UP TO SIX THOUSAND SINGLE PIXELS — `rgba(255,255,255,0.55)`
 * and `rgba(150,140,125,0.16)`, one device pixel each, placed at random inside
 * the room. That reads as a dirty surface at 1× and as sensor noise at 2×, and
 * it cost six thousand fills per room on every rebake. A weave is DIRECTIONAL
 * and LOW-FREQUENCY and salt is neither, so this is two hairline passes at
 * `CARPET_WEAVE_PITCH_U` — one horizontal, one vertical, the light one first —
 * which is a textile at a 2× crop and one flat tone at fit scale.
 *
 * The `rng` argument is kept, unused, and that is deliberate rather than an
 * oversight: a weave has nothing random in it, and removing the parameter would
 * change every call site in a package whose golden diff is supposed to be paint
 * only. `test/unit/interior.test.mjs` reads this function's source and fails if
 * a 1 × 1 fill ever comes back.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {() => number} _rng kept for the call signature; a weave is not random
 * @param {string|((colour:string)=>string)|null} [tint] an identity accent to
 *   wash toward, or the room's own tint as a function (`washedCarpet`)
 * @param {number} [u] px per plan unit; the bake's own `u`.
 */
export function paintCarpet(ctx, x, y, w, h, _rng, tint = null, u = U_DEFAULT) {
  const pitch = CARPET_WEAVE_PITCH_U * u;
  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();
  ctx.fillStyle = washedCarpet(PALETTE.carpetBase, tint);
  ctx.fillRect(x, y, w, h);
  paintWeave(ctx, x, y, w, h, pitch);
  ctx.restore();
}

/**
 * THE WEAVE ITSELF: two hairline passes, the light one first.
 *
 * One function because two carpets lay it — the broadloom above and the loop
 * pile in `backdrop-floor-look.js` — and because it is the pattern on this
 * floor that a pixel grid is hardest on. Three pixels of pitch at a fit scale of
 * 15.85 px per unit is 3.4 device pixels: every line straddles two rows, and
 * the spacing drifts in and out of step with them across the room. In a bake
 * the pitch and the line are whole device pixels (`deviceGrid`), and the pass is
 * thinned by exactly what the rounding thickened it, so the carpet keeps its
 * tone. The grid is anchored to the floor, not the room, so two rooms side by
 * side are one weave.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} pitch the designed pitch, in the context's own pixels
 */
function paintWeave(ctx, x, y, w, h, pitch) {
  const grid = deviceGrid(ctx, pitch, 1);
  const step = grid.pitch;
  if (grid.alpha !== 1) ctx.globalAlpha = grid.alpha;
  ctx.lineWidth = grid.width;
  ctx.strokeStyle = PALETTE.carpetWeaveLight;
  ctx.beginPath();
  for (let gy = Math.ceil(y / step) * step; gy <= y + h; gy += step) {
    ctx.moveTo(x, grid.at(gy));
    ctx.lineTo(x + w, grid.at(gy));
  }
  ctx.stroke();
  ctx.strokeStyle = PALETTE.carpetWeaveDark;
  ctx.beginPath();
  for (let gx = Math.ceil(x / step) * step; gx <= x + w; gx += step) {
    ctx.moveTo(grid.at(gx), y);
    ctx.lineTo(grid.at(gx), y + h);
  }
  ctx.stroke();
}
// Exported by name, below the function rather than on it: the carpet and its
// weave are one material, and `test/unit/interior.test.mjs` reads them as one.
export { paintWeave };

/**
 * Square tile with grout lines — the café bay only (§3.2).
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} [u] px per plan unit; the bake's own `u`.
 */
export function paintTile(ctx, x, y, w, h, u = U_DEFAULT) {
  // Grout is a hairline, not a rule. At full contrast on a 24px pitch the grid
  // outweighed everything standing on it and the room read as graph paper.
  // In a bake the cell and the grout are whole device pixels, and the grout is
  // thinned by what the rounding thickened it (`deviceGrid`).
  const grid = deviceGrid(ctx, TILE_CELL_U * u, 0.75);
  const CELL = grid.pitch;
  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();
  ctx.fillStyle = PALETTE.tileBase;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = PALETTE.tileGrout;
  ctx.lineWidth = grid.width;
  if (grid.alpha !== 1) ctx.globalAlpha = grid.alpha;
  for (let gy = y; gy <= y + h + CELL; gy += CELL) {
    ctx.beginPath();
    ctx.moveTo(x, grid.at(gy));
    ctx.lineTo(x + w, grid.at(gy));
    ctx.stroke();
  }
  for (let gx = x; gx <= x + w + CELL; gx += CELL) {
    ctx.beginPath();
    ctx.moveTo(grid.at(gx), y);
    ctx.lineTo(grid.at(gx), y + h);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A POOL OF LIGHT (WP-85a §3.2), and the one new device in this package.
 *
 * WP-72 gave the floor one key light and spent it entirely on shadow direction,
 * which made it a rule about offsets rather than a light. This is the other
 * half: a soft warm radial, baked with the backdrop, over the places a plan
 * lights because that is where the work and the arriving happen — the manager's
 * desk, every working desk, each corridor threshold.
 *
 * It is a `radial-gradient` fill and nothing else: no shadow, no stroke, no
 * second pass. The centre stop is the theme's `lightPool` and the outer stop is
 * the same colour at zero alpha (`fadedOut`) rather than a transparent black,
 * because a gradient whose far stop is a different hue interpolates through that
 * hue in premultiplied space and leaves a grey ring — which is the artefact
 * `fadedOut` exists to prevent everywhere else on this floor.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} cx @param {number} cy centre, in baked pixels
 * @param {number} r radius, in baked pixels
 */
export function paintLightPool(ctx, cx, cy, r) {
  if (!(r > 0)) return;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  // Full at the centre, gone at the rim, and nothing in between: a straight
  // ramp is what a soft light on a flat floor looks like from directly above,
  // and any hold on the inner stops turns it into a disc with an edge.
  g.addColorStop(0, PALETTE.lightPool);
  g.addColorStop(1, fadedOut(PALETTE.lightPool));
  ctx.save();
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Circulation floor: the corridors and the spine.
 *
 * Poured, seamless and almost featureless on purpose. Corridors are now most
 * of the space between rooms, and painting them as 24px tile drew a hard grid
 * over a third of the building — the plan read as graph paper rather than as a
 * floor. A long, very soft sheen down the length of the run is enough to say
 * "polished surface" without competing with anything in a room.
 */
export function paintCirculation(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = PALETTE.circulationBase;
  ctx.fillRect(x, y, w, h);
  const along = w >= h;
  const g = along
    ? ctx.createLinearGradient(x, y, x, y + h)
    : ctx.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0, PALETTE.circulationSheen);
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.03)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

// ------------------------------------------------------------- the room slab

/**
 * Cast a room's own shadow onto the floor AROUND it (WP-72).
 *
 * A room is a slab laid on the screed, and this is the shadow its rim throws.
 * It is what a partitioned project room never had: a partition is waist height
 * and correctly casts nothing (VISUAL-SPEC §6), so a row of project rooms was
 * a set of carpets printed on one continuous surface, with a 2.5 px line
 * between them doing all the work of saying they were separate rooms.
 *
 * THE SHADOW IS DRAWN WITHOUT DRAWING THE SHAPE. The room's own carpet must
 * not be darkened — the plate, the names and the "+" are read on it, and
 * `assertThemeContrast` measures the ink against the carpet, not against the
 * carpet under its own shadow. So the context is clipped to everything EXCEPT
 * the room (one even-odd path: the whole bitmap, then the room), the room's
 * rect is filled opaque, and the fill itself is clipped away. What survives is
 * exactly the part of the blur that landed outside.
 *
 * It is called after every floor material is down, so the shadow lands on the
 * neighbour a room shares a partition with as well as on the circulation
 * between bands — which is the case the acceptance criterion names, and the
 * one a room-at-a-time pass would have painted over.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} canvasW @param {number} canvasH the bake, in baked pixels
 */
export function castRoomShadow(ctx, x, y, w, h, canvasW, canvasH) {
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvasW, canvasH);
  ctx.rect(x, y, w, h);
  ctx.clip('evenodd');
  setLightShadow(ctx, {
    blur: ROOM_SLAB_SHADOW_BLUR_PX,
    dist: ROOM_SLAB_SHADOW_DIST_PX,
    color: PALETTE.slabShadow,
  });
  // Opaque, and never seen: the clip above removes every pixel of it. Only
  // `shadowColor` reaches the floor, and only where the blur put it.
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.restore();
}

/**
 * The slab's own thickness, seen from directly above (WP-72).
 *
 * A darker band inside the room's two LIGHT-AWAY sides — south and east, since
 * the key light is upper-left. The shade at the foot of the walls
 * (`backdrop-light.js`) is a different statement — a wall standing above the
 * floor occludes the light reaching the corner — and is deepest on the other
 * two sides, so the four edges together read as a lit slab rather than as a
 * room outlined in dark.
 *
 * The band fades INWARD from the edge rather than sitting as a hard stripe:
 * a stripe on a herringbone floor at fit scale aliases into the plank seams,
 * and the gradient's far stop is `slabEdge` at zero alpha rather than a
 * transparent black, so nothing interpolates through a hue the floor does not
 * have.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 */
export function paintRoomSlabEdge(ctx, x, y, w, h) {
  const band = Math.min(ROOM_SLAB_EDGE_PX, w / 2, h / 2);
  if (band <= 0) return;
  const near = fadedOut(PALETTE.slabEdge);
  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();

  const east = ctx.createLinearGradient(x + w - band, y, x + w, y);
  east.addColorStop(0, near);
  east.addColorStop(1, PALETTE.slabEdge);
  ctx.fillStyle = east;
  ctx.fillRect(x + w - band, y, band, h);

  const south = ctx.createLinearGradient(x, y + h - band, x, y + h);
  south.addColorStop(0, near);
  south.addColorStop(1, PALETTE.slabEdge);
  ctx.fillStyle = south;
  ctx.fillRect(x, y + h - band, w, band);

  ctx.restore();
}

// -------------------------------------------------------------- walls/doors

/** Half the thickest wall, in baked pixels: where a room's own floor starts. */
const LIGHTS_OFF_INSET_PX = 3;

/**
 * A ROOM WITH THE LIGHTS OFF (`plan-proportions.js` (e)).
 *
 * Two fills over the room's floor and everything standing on it, painted after
 * the furniture so the desk dims with the carpet under it: the `lightsOff` veil
 * takes the light, and `lightsOffMute` through a `saturation` blend takes a
 * third of the colour. Both are neutral, so every pixel keeps its hue and the
 * desk keeps its edge against the carpet (`dimmedBy` is the same arithmetic).
 * Inside the walls: a wall is shared with the lit room next door, and half a
 * dimmed partition reads as a smudge.
 *
 * Nothing is removed and nothing changes size — the room is the room it would
 * be with somebody at the desk — and the plate is live text drawn over the
 * bake on its own halo, so it reads as it does anywhere (`plateGroundOverDim`).
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} rx @param {number} ry @param {number} rw @param {number} rh
 *   the room's rectangle in baked pixels
 */
export function paintLightsOff(ctx, rx, ry, rw, rh) {
  const inset = LIGHTS_OFF_INSET_PX;
  if (rw <= inset * 2 || rh <= inset * 2) return;
  ctx.save();
  ctx.fillStyle = PALETTE.lightsOff;
  ctx.fillRect(rx + inset, ry + inset, rw - inset * 2, rh - inset * 2);
  // A context without the blend keeps `source-over`, and is not given the grey
  // as a second veil: the room is then dark at full colour, never fogged.
  ctx.globalCompositeOperation = 'saturation';
  if (ctx.globalCompositeOperation === 'saturation') {
    ctx.fillStyle = PALETTE.lightsOffMute;
    ctx.fillRect(rx + inset, ry + inset, rw - inset * 2, rh - inset * 2);
  }
  ctx.restore();
}

/** How thick the two full-height walls are, on the design grid. */
export const WALL_PX = Object.freeze({ exterior: 6, solid: 5 });

/** What is painted over what where two walls share a line: weakest first. */
const WALL_RANK = Object.freeze({ partition: 0, solid: 1, exterior: 2 });

/** @param {Array<[number,number]>} spans @param {number} from @param {number} to */
function without(spans, from, to) {
  /** @type {Array<[number,number]>} */
  const out = [];
  for (const [p, q] of spans) {
    if (to <= p || from >= q) out.push([p, q]);
    else {
      if (from > p) out.push([p, from]);
      if (to < q) out.push([to, q]);
    }
  }
  return out;
}

/**
 * THE WALLS AS THEY ARE BUILT: one piece of wall per stretch of line.
 *
 * The plan lists a wall per room edge, so a stretch two rooms share is listed
 * twice and a partition can lie along a full-height wall. Painted as listed, a
 * sheet of glass would be laid twice and a shadow cast twice. Here every
 * stretch belongs to the strongest wall on it, and a doorway is an opening:
 * the wall stops for `DOOR_OPENING_U`, or the door's own width where that is
 * narrower.
 *
 * Pure geometry in plan units. Returned weakest first, so a full-height wall
 * is painted over the end of a partition that meets it.
 *
 * @param {ReadonlyArray<{x1:number,y1:number,x2:number,y2:number,kind:string,
 *   door?:{at:number,width:number}}>} walls
 * @param {ReadonlyArray<{x:number,y:number,angle:number,width:number}>} [doors]
 * @returns {Array<{x1:number,y1:number,x2:number,y2:number,kind:string}>}
 */
export function wallPieces(walls, doors = []) {
  const key = (/** @type {boolean} */ h, /** @type {number} */ c) =>
    `${h ? 'h' : 'v'}${c.toFixed(4)}`;
  /** @type {Map<string, Array<[number,number]>>} */
  const openings = new Map();
  for (const door of doors || []) {
    const vertical = Math.abs(Math.cos(door.angle)) > 0.5;
    const half = Math.min(door.width, DOOR_OPENING_U) / 2;
    const k = key(!vertical, vertical ? door.x : door.y);
    const at = vertical ? door.y : door.x;
    openings.set(k, [...(openings.get(k) || []), [at - half, at + half]]);
  }
  /** @type {Map<string, Array<[number,number]>>} */
  const taken = new Map();
  const ranked = (walls || [])
    .map((wall, i) => ({ wall, i }))
    .sort((p, q) => WALL_RANK[q.wall.kind] - WALL_RANK[p.wall.kind] || p.i - q.i);
  const out = [];
  for (const { wall } of ranked) {
    const h = Math.abs(wall.y2 - wall.y1) < 1e-6;
    const c = h ? wall.y1 : wall.x1;
    const from = Math.min(h ? wall.x1 : wall.y1, h ? wall.x2 : wall.y2);
    const to = Math.max(h ? wall.x1 : wall.y1, h ? wall.x2 : wall.y2);
    const k = key(h, c);
    /** @type {Array<[number,number]>} */
    let spans = [[from, to]];
    for (const [p, q] of taken.get(k) || []) spans = without(spans, p, q);
    taken.set(k, [...(taken.get(k) || []), [from, to]]);
    for (const [p, q] of openings.get(k) || []) spans = without(spans, p, q);
    if (wall.door) {
      const at = (h ? wall.x1 : wall.y1) + wall.door.at;
      spans = without(spans, at - wall.door.width / 2, at + wall.door.width / 2);
    }
    for (const [p, q] of spans) {
      if (q - p < 0.05) continue;
      out.push(
        h
          ? { x1: p, y1: c, x2: q, y2: c, kind: wall.kind }
          : { x1: c, y1: p, x2: c, y2: q, kind: wall.kind },
      );
    }
  }
  return out.sort((p, q) => WALL_RANK[p.kind] - WALL_RANK[q.kind]);
}

/**
 * WHERE ONE WALL'S PAINT GOES: which way it runs, its near face, how thick it
 * is and the stretches of it that are wall.
 *
 * ON THE DEVICE GRID, in a bake. A wall is the hardest edge on the floor and
 * the one the eye judges sharpness by, so its two faces, its ends and its
 * thickness are whole device pixels there. Outside a bake nothing is snapped.
 *
 * A partition takes its thickness, its inset and its glazing from the look's
 * partition style; a glazed one is never thinner than three device pixels,
 * because two frame lines need a sheet between them.
 *
 * @param {any} ctx
 * @param {{x1:number,y1:number,x2:number,y2:number,kind:string,door?:{at:number,width:number}}} wall
 * @param {number} u
 */
export function wallBand(ctx, wall, u) {
  const horizontal = Math.abs(wall.y2 - wall.y1) * u < 0.5;
  const style = wall.kind === 'partition' ? LOOK.partitions : null;
  let designed = style ? style.bandU * u : WALL_PX[wall.kind] || WALL_PX.solid;
  if (style && style.glazed) designed = Math.max(designed, 3 / deviceScaleOf(ctx));
  const thickness = snapWidth(ctx, designed);
  const near = snapPx(ctx, (horizontal ? wall.y1 : wall.x1) * u - thickness / 2);
  let start = Math.min(horizontal ? wall.x1 : wall.y1, horizontal ? wall.x2 : wall.y2) * u;
  let end = Math.max(horizontal ? wall.x1 : wall.y1, horizontal ? wall.x2 : wall.y2) * u;
  const origin = (horizontal ? wall.x1 : wall.y1) * u;
  // A low partition stops short of both corners, where it is long enough to.
  const inset = style ? style.insetU * u : 0;
  if (inset > 0 && end - start > 2 * inset + u) {
    start += inset;
    end -= inset;
  }
  /** @type {Array<[number,number]>} */
  let spans = [[start, end]];
  if (wall.door) {
    const at = origin + wall.door.at * u;
    const w = wall.door.width * u;
    spans = without(spans, at - w / 2, at + w / 2);
  }
  return {
    horizontal,
    near,
    thickness,
    style,
    spans: spans.map(([p, q]) => /** @type {[number,number]} */ ([snapPx(ctx, p), snapPx(ctx, q)])),
  };
}

/**
 * Paint one wall segment.
 *
 * Walls belong to the floor, not to a room, so this draws a segment rather
 * than a room outline. The OUTSIDE wall is thick, casts along the light and
 * carries a thin dark frame line on both faces. A SOLID interior wall (the
 * user's office) is the same, thinner. A PARTITION is whatever the look says
 * stands between two rooms:
 *
 *   - **solid** — a band of the partition colour that casts like a wall;
 *   - **glass** — two frame lines with a sheet between them and a post at
 *     intervals; it casts nothing and keeps the line where it meets the floor;
 *   - **low** — a waist-high band with rounded ends that stops short of each
 *     corner, a frame line on both edges and a shorter cast.
 *
 * Every cast is a length in plan units times the light's mood.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {{x1:number,y1:number,x2:number,y2:number,kind:string,door?:{at:number,width:number}}} wall
 * @param {number} u
 */
export function paintWallSegment(ctx, wall, u) {
  const { horizontal, near, thickness, style, spans } = wallBand(ctx, wall, u);
  const snapped = snapScaleOf(ctx) > 0;
  const glazed = !!(style && style.glazed);
  const low = !!(style && style.insetU > 0);
  const framed = wall.kind === 'exterior' || !!(style && style.frame);
  /** @param {number} from @param {number} to @param {number} off @param {number} t */
  const strip = (from, to, off, t) => {
    if (horizontal) ctx.fillRect(from, near + off, to - from, t);
    else ctx.fillRect(near + off, from, t, to - from);
  };

  // The body, and what it casts.
  ctx.save();
  if (glazed) {
    ctx.fillStyle = style.glassFill;
  } else {
    ctx.fillStyle = style ? PALETTE.partitionFill : PALETTE.wallFill;
    const cast = (style ? style.cast : SHADOW_U.wallCast) * u * lightCast();
    if (cast > 0) setLightShadow(ctx, { blur: CAST_BLUR_RATIO * cast, dist: cast });
  }
  for (const [from, to] of spans) {
    if (to - from <= 0) continue;
    if (low) {
      if (horizontal) roundRect(ctx, from, near, to - from, thickness, thickness / 2);
      else roundRect(ctx, near, from, thickness, to - from, thickness / 2);
      ctx.fill();
    } else strip(from, to, 0, thickness);
  }
  ctx.restore();

  // A line on each face. On a full-height wall it reads as the plaster edge;
  // on glass and on a low partition it is the frame, and it is what makes a
  // divider the colour of its own floor a divider at all. A whole device pixel
  // wide and just INSIDE the face in a bake, where a line centred on the face
  // would be half on the wall and half on the floor at half strength.
  ctx.save();
  const line = framed && snapped ? 1 / snapScaleOf(ctx) : snapWidth(ctx, 0.75);
  if (framed) ctx.fillStyle = LOOK.partitions.glassFrame;
  else {
    ctx.fillStyle = style ? PALETTE.partitionEdge : PALETTE.wallEdge;
    ctx.globalAlpha = Math.min(1, 0.75 / line);
  }
  if (glazed) {
    // Glass casts nothing, and still stands on the floor.
    setLightShadow(ctx, {
      blur: CONTACT_BLUR_U * u,
      dist: 0,
      color: alphaScaled(PALETTE.shadowContact, SHORT_CONTACT_ALPHA),
    });
  }
  const trim = low ? thickness / 2 : 0;
  for (const [from, to] of spans) {
    if (to - from <= 2 * trim) continue;
    strip(from + trim, to - trim, 0, line);
    strip(from + trim, to - trim, thickness - line, line);
  }
  // Posts: at both ends of a run of glass, and every few units along it.
  if (style && style.postU > 0) {
    const post = Math.max(snapWidth(ctx, style.postU * u), thickness + 2 * line);
    const off = (thickness - post) / 2;
    const pitch = style.postEveryU * u;
    for (const [from, to] of spans) {
      const run = to - from - post;
      if (run <= 0) continue;
      const count = Math.max(1, Math.round(run / pitch));
      for (let i = 0; i <= count; i++) {
        const at = snapPx(ctx, from + (run * i) / count);
        strip(at, at + post, off, post);
      }
    }
  }
  ctx.restore();
}

/**
 * THE BASEBOARD: one device pixel of the floor's own colour, a step darker, on
 * the room's side of every full-height wall and every solid partition round
 * it. Glass and low partitions carry a frame line there instead.
 *
 * Clipped to the room, so the line on a wall's other face is the other room's
 * to draw, in its own floor's colour.
 *
 * @param {any} ctx
 * @param {{x:number,y:number,w:number,h:number}} room
 * @param {{rx:number,ry:number,rw:number,rh:number}} rect the room on the device grid, in px
 * @param {ReadonlyArray<{x1:number,y1:number,x2:number,y2:number,kind:string}>} pieces
 * @param {number} u
 * @param {string} colour
 */
export function paintBaseboard(ctx, room, rect, pieces, u, colour) {
  const line = 1 / deviceScaleOf(ctx);
  const framed = !!LOOK.partitions.frame;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.rx, rect.ry, rect.rw, rect.rh);
  ctx.clip();
  ctx.fillStyle = colour;
  for (const wall of pieces) {
    if (wall.kind === 'partition' && framed) continue;
    const h = Math.abs(wall.y2 - wall.y1) < 1e-6;
    const c = h ? wall.y1 : wall.x1;
    const lo = h ? room.y : room.x;
    const hi = lo + (h ? room.h : room.w);
    if (Math.abs(c - lo) > 1e-6 && Math.abs(c - hi) > 1e-6) continue;
    const from = h ? room.x : room.y;
    const to = from + (h ? room.w : room.h);
    const p = Math.min(h ? wall.x1 : wall.y1, h ? wall.x2 : wall.y2);
    const q = Math.max(h ? wall.x1 : wall.y1, h ? wall.x2 : wall.y2);
    if (q <= from || p >= to) continue;
    const band = wallBand(ctx, wall, u);
    for (const [s0, s1] of band.spans) {
      if (h) {
        ctx.fillRect(s0, band.near - line, s1 - s0, line);
        ctx.fillRect(s0, band.near + band.thickness, s1 - s0, line);
      } else {
        ctx.fillRect(band.near - line, s0, line, s1 - s0);
        ctx.fillRect(band.near + band.thickness, s0, line, s1 - s0);
      }
    }
  }
  ctx.restore();
}

/**
 * §3.3's screed band across one doorway.
 *
 * `door.angle` already says which way the wall runs — the swing opens into the
 * room, so 0 and π are a door in a vertical wall and ±π/2 a door in a
 * horizontal one — which is why this takes the door rather than the wall.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {{x:number, y:number, angle:number}} door
 * @param {number} u
 */
export function paintThresholdBand(ctx, door, u) {
  const vertical = Math.abs(Math.cos(door.angle)) > 0.5;
  const run = THRESHOLD_RUN_U * u;
  const depth = THRESHOLD_DEPTH_U * u;
  const w = vertical ? depth : run;
  const h = vertical ? run : depth;
  ctx.save();
  ctx.fillStyle = PALETTE.thresholdBand;
  ctx.fillRect(door.x * u - w / 2, door.y * u - h / 2, w, h);
  ctx.restore();
}

/**
 * A DOOR, STANDING OPEN: the leaf and the quarter circle it swings through.
 *
 * The leaf is a line `DOOR_LEAF_U` long, two device pixels wide, drawn
 * `DOOR_OPEN_DEG` open about its hinge; the swing is a hairline at
 * `DOOR_SWING_ALPHA`. Both are the frame colour. `door.angle` points into the
 * room, so the leaf opens that way from the jamb nearer the origin.
 *
 * @param {any} ctx
 * @param {{x:number, y:number, angle:number, width:number}} door
 * @param {number} u
 */
export function paintDoorSwing(ctx, door, u) {
  const vertical = Math.abs(Math.cos(door.angle)) > 0.5;
  const opening = Math.min(door.width, DOOR_OPENING_U) * u;
  const leaf = opening * (DOOR_LEAF_U / DOOR_OPENING_U);
  const hx = door.x * u - (vertical ? 0 : opening / 2);
  const hy = door.y * u - (vertical ? opening / 2 : 0);
  // Shut, the leaf lies along the wall; it turns from there toward the room.
  const shut = vertical ? Math.PI / 2 : 0;
  let turn = door.angle - shut;
  while (turn > Math.PI) turn -= 2 * Math.PI;
  while (turn <= -Math.PI) turn += 2 * Math.PI;
  const way = turn >= 0 ? 1 : -1;
  const open = shut + (way * DOOR_OPEN_DEG * Math.PI) / 180;
  const full = shut + (way * Math.PI) / 2;
  const px = 1 / deviceScaleOf(ctx);
  ctx.save();
  ctx.strokeStyle = LOOK.partitions.glassFrame;
  ctx.globalAlpha = DOOR_SWING_ALPHA;
  ctx.lineWidth = px;
  ctx.beginPath();
  ctx.arc(hx, hy, leaf, Math.min(shut, full), Math.max(shut, full));
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2 * px;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx + Math.cos(open) * leaf, hy + Math.sin(open) * leaf);
  ctx.stroke();
  ctx.restore();
}
