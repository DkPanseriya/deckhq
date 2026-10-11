/**
 * THE LINE THAT TIES A NAME TO ITS FIGURE, and what it may not cross.
 *
 * A name that has had to leave its figure is tied back to it by a thin line.
 * That line used to run from the name to the figure's FEET, whatever was in
 * between: for a tag set over a junior's head it ran down through the head and
 * the body it was naming, and on a crew's arc the line to one junior ran across
 * the junior beside it. A line across a face is worse than no line.
 *
 * THE RULE.
 *
 *   1. A leader ends at the EDGE of the figure it belongs to, at the point of
 *      that figure nearest the name. It is never drawn over its own figure.
 *   2. It passes over nobody else. Straight where that is clear;
 *   3. where it is not, the frame's label pass moves the name to another free
 *      place first (`label-spots.js`), and only a name with no such place has
 *      its line BENT round the figure in the way — out along one axis, in along
 *      the other;
 *   4. and where neither bend is clear the line is cut SHORT, a pixel or two
 *      before the first figure it would have crossed.
 *
 * "A figure" here is the body that is drawn (`figureBox`): half as wide as the
 * ring `characterBox` measures, which on a crew's arc overlaps the ring of the
 * junior beside it.
 *
 * Pure: no canvas, no clock.
 */

import { BODY_HEIGHT_U, SELECTION_RING_R } from './rig-metrics.js';

/** How far short of a figure in its way a cut line stops, in screen px. */
export const LEADER_SHORT_PX = 2;

/** @typedef {{x:number, y:number, w:number, h:number}} Rect */

/**
 * The body a figure is drawn as, in screen px: up from its feet by its height,
 * and half the selection ring's radius to either side.
 * @param {number} ox @param {number} oy the feet
 * @param {number} u the scale the figure is drawn at
 * @returns {Rect}
 */
export function figureBox(ox, oy, u) {
  const w = SELECTION_RING_R * u;
  const h = BODY_HEIGHT_U * u;
  return { x: ox - w / 2, y: oy - h, w, h };
}

/**
 * How far along the segment a→b it first enters the INSIDE of a box, as a
 * share of its length; `null` where it never does. Running along an edge, or
 * ending on one, is not inside.
 * @param {number} ax @param {number} ay @param {number} bx @param {number} by
 * @param {Rect} r
 * @returns {number|null}
 */
export function segmentEnters(ax, ay, bx, by, r) {
  const right = r.x + r.w;
  const foot = r.y + r.h;
  // Wholly to one side of the box, or on that side's edge: most of a floor.
  if (ax <= r.x && bx <= r.x) return null;
  if (ax >= right && bx >= right) return null;
  if (ay <= r.y && by <= r.y) return null;
  if (ay >= foot && by >= foot) return null;
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  // Liang–Barsky, a side at a time: where the segment comes in past it, and
  // where it goes out. Parallel to a side it is between the two (above).
  if (dx !== 0) {
    const a = (r.x - ax) / dx;
    const b = (right - ax) / dx;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (dy !== 0) {
    const a = (r.y - ay) / dy;
    const b = (foot - ay) / dy;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t1 - t0 > 1e-9 ? t0 : null;
}

/**
 * Does any segment of a line `[x0, y0, x1, y1, …]` enter this box?
 * @param {number[]} line @param {Rect} r
 */
export function lineEnters(line, r) {
  for (let i = 0; i + 3 < line.length; i += 2) {
    if (segmentEnters(line[i], line[i + 1], line[i + 2], line[i + 3], r) !== null) return true;
  }
  return false;
}

/** @param {number[]} line @param {Rect[]} boxes does the line enter any of them? */
export const lineCrosses = (line, boxes) => boxes.some((r) => lineEnters(line, r));

/** The nearest pair of coordinates on two spans; where they overlap, by the second's middle. */
function nearest(/** @type {number} */ a0, a1, b0, b1) {
  if (a1 < b0) return [a1, b0];
  if (a0 > b1) return [a0, b1];
  const at = Math.min(Math.max((b0 + b1) / 2, Math.max(a0, b0)), Math.min(a1, b1));
  return [at, at];
}

/**
 * THE STRAIGHT LEADER: from the point of a name's box nearest its figure to
 * the point of the figure's edge nearest the name.
 * @param {Rect} rect where the name is set
 * @param {Rect} own the figure it names (`figureBox`)
 * @returns {number[]} `[x0, y0, x1, y1]`, name first, in screen px
 */
export function leaderStraight(rect, own) {
  const [ax, bx] = nearest(rect.x, rect.x + rect.w, own.x, own.x + own.w);
  const [ay, by] = nearest(rect.y, rect.y + rect.h, own.y, own.y + own.h);
  return [ax, ay, bx, by];
}

/**
 * THE LEADER FROM A NAME'S BOX TO ITS FIGURE, as the points of a line.
 * @param {Rect} rect where the name is set
 * @param {Rect} own the figure it names (`figureBox`)
 * @param {Rect[]} others what it may not cross: every other figure on the floor
 * @returns {{line:number[], clear:boolean}} `line`: `[x0, y0, x1, y1, …]` from
 *   the name to the figure, in screen px; `clear`: straight and over nobody
 */
export function leaderFor(rect, own, others) {
  const straight = leaderStraight(rect, own);
  if (!lineCrosses(straight, others)) return { line: straight, clear: true };
  const [ax, ay, bx, by] = straight;
  const bends = [
    [ax, ay, bx, ay, bx, by],
    [ax, ay, ax, by, bx, by],
  ];
  const bent = bends.find((line) => !lineEnters(line, own) && !lineCrosses(line, others));
  if (bent) return { line: bent, clear: false };
  // Cut short of the first figure in its way.
  let t = 1;
  for (const r of others) t = Math.min(t, segmentEnters(ax, ay, bx, by, r) ?? 1);
  const len = Math.hypot(bx - ax, by - ay);
  const keep = Math.max(0, t * len - LEADER_SHORT_PX) / (len || 1);
  return { line: [ax, ay, ax + (bx - ax) * keep, ay + (by - ay) * keep], clear: false };
}
