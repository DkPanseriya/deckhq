/**
 * HOW WIDE A LINE OF FLOOR TEXT IS, asked once.
 *
 * Every name, wait badge, room plate and chip on the floor is measured before
 * it is drawn — the collision pass has to know how wide a name is before it
 * can keep it off its neighbour — and it was measured again on every frame:
 * three `measureText` calls and three `font` assignments for each piece of text
 * drawn, sixty times a second, for strings that change once a minute at most.
 *
 * A width is a function of the font and the string and of nothing else the
 * floor sets, so it is kept: per context, per font, per string. The font is
 * assigned only when something actually has to be measured, which means a
 * caller that goes on to DRAW must set its own font — every one of them
 * already did (`drawLabel`, `drawBadge`, the plates).
 *
 * PER CONTEXT, because a width belongs to the thing that measured it: the
 * floor's canvas and a test's stub are different rulers.
 *
 * FORGOTTEN when a font finishes loading, since the same font string then
 * names different glyphs; `textMetricsEpoch` moves with it so a floor that is
 * holding still knows to draw again. And bounded: a tool bubble's summary is
 * free text that changes all day, so a context that has measured
 * `TEXT_METRICS_MAX` strings starts over rather than growing.
 *
 * No DOM beyond the guarded `document.fonts` listener, no clock, no randomness.
 */

/** The most strings one context keeps widths for before it starts over. */
export const TEXT_METRICS_MAX = 4000;

/** @type {WeakMap<object, {fonts:Map<string, Map<string, number>>, size:number, epoch:number}>} */
const BY_CONTEXT = new WeakMap();

let epoch = 0;

/**
 * Bumped whenever every kept width was thrown away (a font finished loading).
 * @returns {number}
 */
export function textMetricsEpoch() {
  return epoch;
}

/** Throw every kept width away: the next question of each is measured again. */
export function forgetTextMetrics() {
  epoch++;
}

if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
  document.fonts.addEventListener('loadingdone', forgetTextMetrics);
}

/**
 * The width of `text` set in `font`, in the context's own pixels.
 *
 * Leaves `ctx.font` alone when the answer is already known, and at `font` when
 * it had to be measured.
 *
 * @param {{font:string, measureText:(text:string)=>{width:number}}} ctx
 * @param {string} font a CSS font shorthand, exactly as it would be assigned
 * @param {string} text
 * @returns {number}
 */
export function textWidth(ctx, font, text) {
  let kept = BY_CONTEXT.get(ctx);
  if (!kept || kept.epoch !== epoch || kept.size >= TEXT_METRICS_MAX) {
    kept = { fonts: new Map(), size: 0, epoch };
    BY_CONTEXT.set(ctx, kept);
  }
  let widths = kept.fonts.get(font);
  if (!widths) {
    widths = new Map();
    kept.fonts.set(font, widths);
  }
  let w = widths.get(text);
  if (w === undefined) {
    ctx.font = font;
    w = ctx.measureText(text).width;
    widths.set(text, w);
    kept.size++;
  }
  return w;
}
