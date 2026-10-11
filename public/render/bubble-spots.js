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
 *   4. BESIDE THE NAME, where a name is directly over the head and none of
 *      that clears it: on two pixels at a time, whole and then shorter, for
 *      as long as the bubble's near edge is over its own body (`reach`);
 *   5. and only where none of that is clear of a name, a role chip, a wait
 *      badge or a crew's chip, not this frame.
 *
 * Nothing moves farther than it has to: every place is tried for the whole
 * line before the line is cut, and the centre before either side.
 *
 * AND NEVER OVER ANOTHER BUBBLE. Two sessions side by side at a desk, both in
 * a tool, are two bubbles each wider than the gap between their heads. They
 * are set in the order the figures are painted, and each one keeps clear of
 * the ones set before it by the same four steps; where that leaves one with no
 * place at all, the bubble in its way is cut shorter and they are set again. A
 * thought cloud then keeps clear of every bubble but its own figure's
 * (`cloud-spots.js`).
 *
 * Pure: no canvas beyond the measure it is handed, no clock.
 */

import { cloudBox } from './cloud-spots.js';
import { toolBubbleBox, toolBubbleShorter, toolBubbleSpan } from './rig-bubble.js';
import { CHROME_BADGE_U, SELECTION_RING_R } from './rig-metrics.js';

/** How far a bubble steps at a time, as a share of its own width. */
export const BUBBLE_STEP = 1 / 8;

/** The steps tried, in order: centred, then right and left, out to half a width. */
export const BUBBLE_STEPS = Object.freeze([0, 1, -1, 2, -2, 3, -3, 4, -4]);

/** How far at a time a bubble goes on beside a name over its head, in screen px. */
export const BUBBLE_BESIDE_PX = 2;

/** The line's width as it may be cut, in the order tried: whole first. */
export const BUBBLE_SHARES = Object.freeze([1, 0.75, 0.5]);

/** The floor a bubble keeps between itself and a name, in screen px. */
export const BUBBLE_CLEAR_PX = 2;

/** @typedef {{x:number, y:number, w:number, h:number}} Rect */

/** @param {Rect} a @param {Rect} b */
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * The box every bubble that is drawn is drawn in, by figure: what a thought
 * cloud beside it keeps clear of (`cloud-spots.js`).
 * @param {{font:string, measureText:(text:string)=>{width:number}}} ctx
 * @param {{id:string, x:number, y:number, u:number}[]} figures
 * @param {Map<string, {dx:number, text:string}|null>} spots `placeBubbles`'s
 * @returns {(Rect & {id:string})[]}
 */
export function bubbleBoxes(ctx, figures, spots) {
  const out = [];
  for (const f of figures) {
    const spot = spots.get(f.id);
    if (!spot) continue;
    const box = toolBubbleBox(ctx, f.x, f.y, f.u, spot.text);
    out.push({ id: f.id, x: box.x + spot.dx, y: box.y, w: box.w, h: box.h });
  }
  return out;
}

/**
 * WHERE EVERY FIGURE'S TOOL BUBBLE IS THIS FRAME.
 * @param {{font:string, measureText:(text:string)=>{width:number}}} ctx
 * @param {{id:string, x:number, y:number, u:number, text:string}[]} figures the
 *   feet, the scale and the line of every figure that carries a bubble, in the
 *   order they are painted
 * @param {Rect[]} taken what a bubble may not cover: every name set this frame
 *   (role chips included), every wait badge and pill, every crew's chip
 * @returns {Map<string, {dx:number, text:string}|null>} the step aside and the
 *   line it has room for; `null` for a figure with no bubble this frame
 */
export function placeBubbles(ctx, figures, taken) {
  /** @type {Map<string, number>} how far down `BUBBLE_SHARES` a line starts */
  let cuts = new Map();
  let best = setBubbles(ctx, figures, taken, cuts);
  // A BUBBLE WITH NO PLACE BECAUSE OF THE ONE BESIDE IT. Set first, a long
  // line takes the whole of the floor over two heads. The bubble in the way is
  // cut a step shorter and every bubble is set again — kept only where that
  // draws one more of them, so no line is cut for nothing.
  for (let round = 0; round < figures.length * BUBBLE_SHARES.length; round++) {
    const next = new Map(cuts);
    for (const id of best.crowding) {
      const at = next.get(id) || 0;
      if (at + 1 < BUBBLE_SHARES.length) next.set(id, at + 1);
    }
    if (![...next].some(([id, at]) => at !== (cuts.get(id) || 0))) break;
    const again = setBubbles(ctx, figures, taken, next);
    if (again.drawn <= best.drawn) break;
    [best, cuts] = [again, next];
  }
  return best.out;
}

/**
 * One pass over the figures: each bubble by the four steps, clear of every
 * name and of every bubble set before it.
 * @param {{font:string, measureText:(text:string)=>{width:number}}} ctx
 * @param {{id:string, x:number, y:number, u:number, text:string}[]} figures
 * @param {Rect[]} taken
 * @param {Map<string, number>} cuts the share of its line each figure starts at
 * @returns {{out:Map<string, {dx:number, text:string}|null>, drawn:number,
 *   crowding:Set<string>}} `crowding`: whose bubbles stood where a figure that
 *   was given none would have had one
 */
function setBubbles(ctx, figures, taken, cuts) {
  /** @type {Map<string, {dx:number, text:string}|null>} */
  const out = new Map();
  /** @type {(Rect & {id:string})[]} the bubbles set so far, each kept clear of by the next */
  const set = [];
  /** @type {Set<string>} */
  const crowding = new Set();
  for (const f of figures) {
    const whole = toolBubbleBox(ctx, f.x, f.y, f.u, f.text);
    // The line whole, then as it may be cut: each length once.
    const forms = [];
    for (const share of BUBBLE_SHARES.slice(cuts.get(f.id) || 0)) {
      const text = share === 1 ? whole.text : toolBubbleShorter(ctx, f.u, whole.text, share);
      if (forms.some((box) => box.text === text)) continue;
      forms.push(share === 1 ? whole : toolBubbleBox(ctx, f.x, f.y, f.u, text));
    }
    /** @type {{dx:number, text:string}|null} */
    let spot = null;
    /** @type {Set<string>} */
    const inWay = new Set();
    /** Is this line clear at this step? Then it is set there. */
    const tryAt = (/** @type {any} */ box, /** @type {number} */ dx) => {
      const rect = {
        x: box.x + dx - BUBBLE_CLEAR_PX,
        y: box.y - BUBBLE_CLEAR_PX,
        w: box.w + BUBBLE_CLEAR_PX * 2,
        h: box.h + BUBBLE_CLEAR_PX * 2,
      };
      if (taken.some((t) => overlaps(rect, t))) return false;
      const beside = set.filter((t) => overlaps(rect, t));
      for (const t of beside) inWay.add(t.id);
      if (beside.length) return false;
      spot = { dx, text: box.text };
      set.push({ id: f.id, x: box.x + dx, y: box.y, w: box.w, h: box.h });
      return true;
    };
    // Centred, a step aside, shorter: every place for one length before the next.
    forms.some((box) => BUBBLE_STEPS.some((step) => tryAt(box, step * BUBBLE_STEP * box.w)));
    // BESIDE THE NAME, where one is directly over the head: on past the
    // centre line `BUBBLE_BESIDE_PX` at a time, while the bubble's near edge
    // is still over its own body. Finer than an eighth of a line, because
    // the room between a name and the edge of a body is a few pixels wide.
    const reach = (SELECTION_RING_R * f.u) / 2;
    if (!spot) {
      forms.some((box) => {
        for (let near = BUBBLE_BESIDE_PX; near <= reach; near += BUBBLE_BESIDE_PX) {
          if (tryAt(box, box.w / 2 + near) || tryAt(box, -box.w / 2 - near)) return true;
        }
        return false;
      });
    }
    if (!spot) for (const id of inWay) crowding.add(id);
    out.set(f.id, spot);
  }
  return { out, drawn: set.length, crowding };
}

/**
 * HOW HIGH OVER ITS FEET A NAME SET OVER A HEAD BEGINS, in screen px: clear of
 * everything that may open in the slot over that head — the state icon under
 * the wait badge's line (`CHROME_BADGE_U`), the top of a tool bubble, the top
 * of a thought cloud — with `BUBBLE_CLEAR_PX` of floor over the tallest.
 *
 * A name over a head was set at the badge's line, and a bubble and a cloud both
 * reach a fifth of a unit past it. So a junior whose tag had gone over its own
 * head was given no bubble and no cloud at all: its own name was in the way.
 * @param {number} u the scale the figure is drawn at
 * @returns {number}
 */
export function overHeadTop(u) {
  const cloud = -cloudBox(0, 0, u, 1).y;
  return Math.max(u * CHROME_BADGE_U, toolBubbleSpan(u).top, cloud) + BUBBLE_CLEAR_PX;
}
