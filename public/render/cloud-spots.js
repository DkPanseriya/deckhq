/**
 * WHERE A THOUGHT CLOUD GOES: beside the head, and never over a name.
 *
 * A cloud hangs up and to the right of its figure, and until now nothing
 * asked what was already there. On a crew's arc that was the name over the
 * next junior's head; at a two-sided desk it was the name under the feet of
 * whoever sits across it. A name, a wait badge and a crew's chip are what the
 * reader came for, and a cloud says only "thinking" — so the cloud yields.
 *
 * THE RULE. Once every name has been set (`scene-frame-labels.js`), each
 * figure's cloud is tried on its own side, the right; then mirrored to the
 * left; and where both are over a name, a role chip, a wait badge or a crew's
 * chip, the figure has no cloud this frame. The box asked about is the whole
 * cloud at its largest, sway included, so the answer does not change as a
 * cloud grows and is a function of where people are standing and of nothing
 * else — the same inputs as the names, and decided in the same pass.
 *
 * Pure: no canvas, no clock.
 */

import { CHROME_BUBBLE_U } from './rig-metrics.js';

/** How far beside the feet the cloud's centre hangs, in units of the figure. */
export const CLOUD_ASIDE_U = 0.95;

/**
 * The cloud's box about its own centre, in units of the figure: its four
 * lobes (`rig-props.js`), its outline, and the sway to either side.
 */
export const CLOUD_BOX_U = Object.freeze({ left: 0.84, right: 0.7, up: 0.6, down: 0.54 });

/**
 * The screen box of one figure's cloud, on one side of its head.
 * @param {number} ox @param {number} oy the figure's feet
 * @param {number} u the scale it is drawn at
 * @param {1|-1} side `1` right of the head, `-1` mirrored to its left
 * @returns {{x:number, y:number, w:number, h:number}}
 */
export function cloudBox(ox, oy, u, side) {
  const cx = ox + side * u * CLOUD_ASIDE_U;
  const cy = oy - u * CHROME_BUBBLE_U;
  const west = side === 1 ? CLOUD_BOX_U.left : CLOUD_BOX_U.right;
  return {
    x: cx - west * u,
    y: cy - CLOUD_BOX_U.up * u,
    w: (CLOUD_BOX_U.left + CLOUD_BOX_U.right) * u,
    h: (CLOUD_BOX_U.up + CLOUD_BOX_U.down) * u,
  };
}

/** @typedef {{x:number, y:number, w:number, h:number}} Rect */

/** @param {Rect} a @param {Rect} b */
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Where the collision pass set every name it drew, as boxes: each label in the
 * form and at the offset it was given. A sub-agent's two rows are one box, so
 * its role chip is in it. A name that was dropped has none.
 * @param {any[]} labels `planFrameLabels`'s items
 * @param {Map<string, any>} plan its placements, by id
 * @returns {Rect[]}
 */
export function placedLabelBoxes(labels, plan) {
  /** @type {Rect[]} */
  const out = [];
  for (const it of labels || []) {
    const spot = plan.get(it.id);
    if (!spot) continue;
    const smaller = (it.variants || []).find((v) => v.px === spot.px && v.text === spot.text);
    const form = spot.px === undefined || !smaller ? it : smaller;
    out.push({
      x: form.x + (spot.offsetX || 0),
      y: form.y + (spot.offsetY || 0),
      w: form.w,
      h: form.h,
    });
  }
  return out;
}

/**
 * WHICH SIDE EVERY FIGURE'S CLOUD IS ON THIS FRAME.
 * @param {{id:string, x:number, y:number, u:number}[]} figures feet and scale
 * @param {Rect[]} taken what a cloud may not cover: every name set this frame
 *   (role chips included), every wait badge and pill, every crew's chip
 * @returns {Map<string, 1|-1|0>} `1` right, `-1` left, `0` no cloud this frame
 */
export function placeClouds(figures, taken) {
  /** @type {Map<string, 1|-1|0>} */
  const out = new Map();
  for (const f of figures) {
    /** @type {1|-1|0} */
    let side = 0;
    for (const s of /** @type {const} */ ([1, -1])) {
      const box = cloudBox(f.x, f.y, f.u, s);
      if (taken.some((t) => overlaps(box, t))) continue;
      side = s;
      break;
    }
    out.set(f.id, side);
  }
  return out;
}
