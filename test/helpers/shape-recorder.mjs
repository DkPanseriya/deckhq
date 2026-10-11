/**
 * A 2D CONTEXT THAT REMEMBERS WHERE EACH PAINT LANDED.
 *
 * `paint-recorder.mjs` counts operations; this keeps, for every fill and
 * stroke, the style it was painted in and the BOX of the path it painted —
 * which is the only way to ask where on a drawing a colour went, or whether a
 * shape stayed inside the square it was given. Nothing is transformed: the
 * painters it is used on hand a context final coordinates.
 */

/** @returns {any} */
export function shapeRecorder() {
  /** @type {any[]} */
  const paints = [];
  /** @type {{x0:number, y0:number, x1:number, y1:number}|null} */
  let box = null;
  const grow = (/** @type {number} */ x, /** @type {number} */ y) => {
    if (!box) box = { x0: x, y0: y, x1: x, y1: y };
    else {
      box.x0 = Math.min(box.x0, x);
      box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x);
      box.y1 = Math.max(box.y1, y);
    }
  };
  const round = (/** @type {number} */ x, /** @type {number} */ y, rx, ry) => {
    grow(x - rx, y - ry);
    grow(x + rx, y + ry);
  };
  /** @type {any} */
  const ctx = {
    paints,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    beginPath: () => (box = null),
    closePath() {},
    moveTo: grow,
    lineTo: grow,
    quadraticCurveTo: (cx, cy, x, y) => (grow(cx, cy), grow(x, y)),
    bezierCurveTo: (a, b, c, d, x, y) => (grow(a, b), grow(c, d), grow(x, y)),
    arc: (x, y, r) => round(x, y, r, r),
    ellipse: (x, y, rx, ry) => round(x, y, rx, ry),
    rect: (x, y, w, h) => (grow(x, y), grow(x + w, y + h)),
    fill: () => paints.push(shot('fill', ctx.fillStyle)),
    stroke: () => paints.push(shot('stroke', ctx.strokeStyle)),
    fillRect: (x, y, w, h) =>
      paints.push({
        op: 'fillRect',
        style: ctx.fillStyle,
        alpha: ctx.globalAlpha,
        box: { x0: x, y0: y, x1: x + w, y1: y + h },
      }),
    fillText: (text, x, y) => paints.push({ op: 'fillText', style: ctx.fillStyle, text, x, y }),
    save() {},
    restore() {},
    measureText: (/** @type {string} */ t) => ({ width: String(t).length * 6 }),
  };
  const shot = (/** @type {string} */ op, /** @type {any} */ style) => ({
    op,
    style,
    alpha: ctx.globalAlpha,
    width: ctx.lineWidth,
    box: box ? { ...box } : null,
  });
  return ctx;
}
