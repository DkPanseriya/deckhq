/**
 * How many device pixels one pixel of a context's own space is.
 *
 * A canvas has two kinds of number. Geometry — a `fillRect`, a path, a font
 * size — goes through the context's transform, so a floor baked under
 * `scale(k)` is `k` times larger and exactly as sharp. Three things do not:
 * `shadowBlur` and `shadowOffsetX/Y` are in device pixels whatever the
 * transform says, and a hairline is only crisp when its edges land ON device
 * pixels, which the transform knows nothing about. Left alone, a floor on a
 * display that reports `devicePixelRatio = 2` has shadows exactly half the size
 * the design was tuned at, and a 1 px seam at a fractional scale is a 2 px
 * smear at half strength.
 *
 * So whoever sets a context's scale says so here, once, and the painters ask.
 * A context nobody has spoken for answers 1 and snaps nothing — a test
 * recorder, a Look thumbnail and a swatch all paint exactly as they did.
 *
 * The snapping assumes the context's transform is that scale and a whole number
 * of device pixels of translation, which is what a bake and a frame both set.
 * Under a rotation it is meaningless, and nothing rotated asks.
 *
 * Pure: a `WeakMap` and arithmetic. No DOM, no clock.
 */

/** @type {WeakMap<object, number>} */
const SCALE = new WeakMap();

/**
 * Say what one pixel of `ctx`'s space is on the device.
 * @param {any} ctx @param {number} k device pixels per context pixel
 */
export function setDeviceScale(ctx, k) {
  if (ctx && typeof ctx === 'object' && k > 0 && Number.isFinite(k)) SCALE.set(ctx, k);
}

/**
 * Device pixels per context pixel; 1 for a context nobody has spoken for.
 * @param {any} ctx @returns {number}
 */
export function deviceScaleOf(ctx) {
  return (ctx && SCALE.get(ctx)) || 1;
}

/**
 * The same, or 0 where nobody has said — the form a painter branches on.
 * @param {any} ctx @returns {number}
 */
export function snapScaleOf(ctx) {
  return (ctx && SCALE.get(ctx)) || 0;
}

/**
 * `v` moved to the nearest device-pixel boundary. Unchanged where the context's
 * scale is unknown.
 * @param {any} ctx @param {number} v @returns {number}
 */
export function snapPx(ctx, v) {
  const k = snapScaleOf(ctx);
  return k ? Math.round(v * k) / k : v;
}

/**
 * A width that is a whole number of device pixels and at least one of them.
 * @param {any} ctx @param {number} w @returns {number}
 */
export function snapWidth(ctx, w) {
  const k = snapScaleOf(ctx);
  return k ? Math.max(1, Math.round(w * k)) / k : w;
}

/**
 * A SET OF PARALLEL HAIRLINES, LAID ON THE DEVICE GRID.
 *
 * A weave, a grout grid and a saw-cut joint are all the same drawing: lines
 * `width` wide every `pitch`. At a fractional scale neither number is a whole
 * count of device pixels, so every line is anti-aliased across two rows and the
 * spacing beats against the pixel grid — which is the moiré a carpet shows when
 * its bitmap is stretched. Here both are rounded to whole device pixels, so every
 * line is the same line.
 *
 * Rounding changes how much ink is on the floor — a 0.85 px line drawn 1 px wide
 * is 18 % darker — so `alpha` is what puts the surface back to the tone it was
 * designed at: the designed coverage over the snapped one, never above 1.
 *
 * `at(v)` is where the centre of the line that the unsnapped drawing put at
 * `v + 0.5` goes. Unknown scale: the numbers come back untouched.
 *
 * @param {any} ctx
 * @param {number} pitch @param {number} width both in the context's own pixels
 * @returns {{pitch:number, width:number, alpha:number, at:(v:number)=>number}}
 */
export function deviceGrid(ctx, pitch, width) {
  const k = snapScaleOf(ctx);
  if (!k) return { pitch, width, alpha: 1, at: (v) => v + 0.5 };
  const wd = Math.max(1, Math.round(width * k));
  const pd = Math.max(wd + 1, Math.round(pitch * k));
  return {
    pitch: pd / k,
    width: wd / k,
    alpha: Math.min(1, (width * pd) / (pitch * wd)),
    at: (v) => (Math.round((v + 0.5 - width / 2) * k) + wd / 2) / k,
  };
}
