/**
 * WHERE A TOOL BUBBLE GOES: over its head, and never over a name.
 *
 * A bubble says what a session is doing — `Bash npm test` — on one line,
 * centred over its head, and it is as wide as the line. At a two-sided desk
 * that is wide enough to reach the name of whoever sits beside it: in the
 * product's own recording of the office the bubble over one session ran into
 * the name of the next. The thought cloud already had this rule
 * (`cloud-spots.js`); the bubble, which takes the cloud's place while a tool
 * runs, did not.
 *
 * THE RULE, the cloud's own. Once every name has been set
 * (`scene-frame-labels.js`), each bubble is tried:
 *
 *   1. where it has always been, centred over the head;
 *   2. A STEP ASIDE, an eighth of its own width at a time to the right and
 *      then the left, as far as the other side of the head — where its edge is
 *      on the head's centre line, and it is still plainly that head's;
 *   3. SHORTER, the line cut to three quarters and then half of its width,
 *      each tried in all of those places;
 *   4. and only where none of that is clear of a name, a role chip, a wait
 *      badge or a crew's chip, not this frame.
 *
 * Nothing moves farther than it has to: every place is tried for the whole
 * line before the line is cut, and the centre before either side.
 *
 * Pure: no canvas beyond the measure it is handed, no clock.
 */

import { toolBubbleBox, toolBubbleShorter } from './rig-bubble.js';

/** How far a bubble steps at a time, as a share of its own width. */
export const BUBBLE_STEP = 1 / 8;

/** The steps tried, in order: centred, then right and left, out to half a width. */
export const BUBBLE_STEPS = Object.freeze([0, 1, -1, 2, -2, 3, -3, 4, -4]);

/** The line's width as it may be cut, in the order tried: whole first. */
export const BUBBLE_SHARES = Object.freeze([1, 0.75, 0.5]);

/** The floor a bubble keeps between itself and a name, in screen px. */
export const BUBBLE_CLEAR_PX = 2;

/** @typedef {{x:number, y:number, w:number, h:number}} Rect */

/** @param {Rect} a @param {Rect} b */
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * WHERE EVERY FIGURE'S TOOL BUBBLE IS THIS FRAME.
 * @param {{font:string, measureText:(text:string)=>{width:number}}} ctx
 * @param {{id:string, x:number, y:number, u:number, text:string}[]} figures the
 *   feet, the scale and the line of every figure that carries a bubble
 * @param {Rect[]} taken what a bubble may not cover: every name set this frame
 *   (role chips included), every wait badge and pill, every crew's chip
 * @returns {Map<string, {dx:number, text:string}|null>} the step aside and the
 *   line it has room for; `null` for a figure with no bubble this frame
 */
export function placeBubbles(ctx, figures, taken) {
  /** @type {Map<string, {dx:number, text:string}|null>} */
  const out = new Map();
  for (const f of figures) {
    const whole = toolBubbleBox(ctx, f.x, f.y, f.u, f.text);
    /** @type {{dx:number, text:string}|null} */
    let spot = null;
    let last = '';
    for (const share of BUBBLE_SHARES) {
      const text = share === 1 ? whole.text : toolBubbleShorter(ctx, f.u, whole.text, share);
      if (text === last) continue;
      last = text;
      const box = share === 1 ? whole : toolBubbleBox(ctx, f.x, f.y, f.u, text);
      for (const step of BUBBLE_STEPS) {
        const dx = step * BUBBLE_STEP * box.w;
        const rect = {
          x: box.x + dx - BUBBLE_CLEAR_PX,
          y: box.y - BUBBLE_CLEAR_PX,
          w: box.w + BUBBLE_CLEAR_PX * 2,
          h: box.h + BUBBLE_CLEAR_PX * 2,
        };
        if (taken.some((t) => overlaps(rect, t))) continue;
        spot = { dx, text: box.text };
        break;
      }
      if (spot) break;
    }
    out.set(f.id, spot);
  }
  return out;
}
