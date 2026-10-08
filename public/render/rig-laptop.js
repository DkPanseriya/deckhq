/**
 * A JUNIOR'S LAPTOP, ON THE FLOOR IN FRONT OF IT (WP-99).
 *
 * A junior working on the floor — in a crew's arc, or beside its lead — sits
 * cross-legged with a small open laptop on the carpet in front of its knees.
 * It is what says *this one is working here* about a figure that has no desk,
 * and at a crowded floor's scale it is the second thing, after the size, that
 * says *junior*.
 *
 * WP-97 drew it on the knees, over the barrel, in the figure's own frame. On a
 * 20 px body that was a pale bar across a green lap, and under 16 px it was
 * nothing. On the floor it is a shape of its own, clear of the silhouette, and
 * it is drawn the way the floor's other furniture is: from above. A figure is a
 * billboard and a laptop is a thing lying on the carpet, exactly as a desk's
 * monitor is a slab on a desk.
 *
 * WHAT IS DRAWN, nearest the sitter first:
 *
 *   - the deck, in the floor's furniture metal, with the contact shadow every
 *     laid thing has (`contactUnder`, `backdrop-paint.js` — one light, one
 *     helper), and the screen's light on the keys nearest it;
 *   - the screen: a lid leaning back shows its lit face from above, so it is
 *     a band of the WORKING tone at full strength — the one saturated thing
 *     in the picture, and the same green its cable is;
 *   - the lid's edge: a thin dark slab along the side away from the sitter.
 *
 * THE LID IS `crewCableLive`: open while that junior's transcript is moving and
 * folded once it has gone quiet, so a shut laptop is the same observed fact a
 * grey cable is. Shut, there is no light: the lid lies on the deck and a
 * sliver of metal is all of the deck its sitter can still see.
 *
 * Token colours only, and every length a share of the figure's own height, so
 * the laptop is one size against its junior at every agent size and every fit.
 * No clock, no randomness, nothing allocated.
 */

import { PALETTE, STATE_COLORS } from './palette.js';
import { contactUnder } from './backdrop-paint.js';
import { rigHeight, roundRectPath } from './rig-pose.js';

/** How wide the laptop is, as a share of the figure's height. */
export const LAPTOP_W = 0.5;
/** How deep, sitter's edge to the lid's own edge. */
export const LAPTOP_DEPTH = 0.26;
/** How far in front of the feet point the sitter's edge of it lies. */
export const LAPTOP_FRONT = 0.03;
/** The lid's edge, seen from above, as a share of the depth. */
export const LAPTOP_LID = 0.2;
/** The lit screen, leaning back and so seen from above, as a share of the depth. */
export const LAPTOP_SCREEN = 0.42;
/** How much of the screen's light lands on the keys. */
export const LAPTOP_WASH = 0.28;

/**
 * The deck's screen rect, for a figure whose feet are at `(ox, oy)`.
 * @param {number} ox @param {number} oy the ground contact, screen px
 * @param {number} u px per plan unit at the figure's own scale
 * @param {{x:number, y:number, w:number, h:number}} [out] written into
 * @returns {{x:number, y:number, w:number, h:number}}
 */
export function laptopBox(ox, oy, u, out) {
  const h = rigHeight(u);
  const box = out || { x: 0, y: 0, w: 0, h: 0 };
  box.w = LAPTOP_W * h;
  box.h = LAPTOP_DEPTH * h;
  box.x = ox - box.w / 2;
  box.y = oy + LAPTOP_FRONT * h;
  return box;
}

/** Module-scope scratch: one laptop is drawn to completion before the next. */
const _box = { x: 0, y: 0, w: 0, h: 0 };

/**
 * Draw one junior's laptop.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} ox @param {number} oy the junior's ground contact, screen px
 * @param {number} u px per plan unit at the JUNIOR's scale
 * @param {number|null|undefined} lid how open it is, 0 shut .. 1 open; omitted, open
 * @param {0|1|2} [lod] under 1 the contact shadow is not drawn: a blurred fill
 *   under a slab three pixels deep is a cost with no picture
 */
export function drawFloorLaptop(ctx, ox, oy, u, lid, lod = 2) {
  const open = typeof lid === 'number' && Number.isFinite(lid) ? Math.max(0, Math.min(1, lid)) : 1;
  const box = laptopBox(ox, oy, u, _box);
  const r = Math.min(box.w, box.h) * 0.16;
  const edge = Math.max(1, LAPTOP_LID * box.h);
  const screen = LAPTOP_SCREEN * box.h * open;
  // Where the deck ends and the lid begins: the hinge, from the sitter's edge.
  const hinge = box.h - edge - screen;

  if (lod >= 1) contactUnder(ctx, box.x, box.y, box.w, box.h, r, false, u);
  // The lid first, the whole footprint: its edge is what is left showing on
  // the far side once the deck and the screen are laid over it, and a folded
  // laptop is all lid but the sliver of deck its sitter can still see.
  ctx.fillStyle = PALETTE.monitorBody;
  roundRectPath(ctx, box.x, box.y, box.w, box.h, r);
  ctx.fill();
  ctx.fillStyle = PALETTE.furnitureMetal;
  const deck = open > 0.01 ? hinge : box.h * LAPTOP_LID;
  roundRectPath(ctx, box.x, box.y, box.w, deck, Math.min(r, deck / 2));
  ctx.fill();
  if (open <= 0.01) return;

  ctx.fillStyle = STATE_COLORS.working;
  // The screen, lit: the working tone itself, between the hinge and the edge.
  ctx.fillRect(box.x, box.y + hinge, box.w, screen);
  // And its light on the keys nearest it.
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * LAPTOP_WASH * open;
  ctx.fillRect(box.x, box.y + hinge * 0.45, box.w, hinge * 0.55);
  ctx.globalAlpha = alpha;
}
