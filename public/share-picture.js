/**
 * The share picture: the floor, and a slim band under it.
 *
 * `S` photographs the window you are looking at, at the size it happens to be,
 * with a three-line caption. This is the other picture — the one made to be
 * posted: a fixed 16:9 (or square) frame, the floor laid out for that frame
 * rather than cropped to it, and one line of the floor's own numbers.
 *
 * ```
 * ┌────────────────────────────────────────────────────────────┐
 * │                                                            │
 * │                       [ the floor ]                        │
 * │                                                            │
 * ├────────────────────────────────────────────────────────────┤
 * │ ◙ DeckHQ   7 need you · 2 hands up · oldest 1d 2h   deckhq.dev │
 * └────────────────────────────────────────────────────────────┘
 * ```
 *
 * No header, no queue strip, no hooks chip and no cursor: none of them is the
 * floor, and the strip carries session titles.
 *
 * The split is `snapshot.js`'s: the model (`shareFooterModel`, `shareLayout`)
 * is pure and is what the tests drive; `drawShareFooter` and
 * `composeSharePicture` are the only things here that touch a canvas. What the
 * floor is drawn FROM is not this file's business — see `share-redact.js`.
 */

import { WORDMARK, formatWait } from './snapshot.js';

/**
 * The two frames, in CSS pixels. At 2x the wide one is a 3520 x 1980 PNG.
 *
 * WHY 1760 x 990 AND NOT 1600 x 900. The frame was 1600 x 900 first, and the
 * demo floor photographed in it lost every wait badge. The floor draws a
 * waiting agent's badge only at 14 px to the unit or more
 * (`BADGE_MIN_PX_PER_UNIT`): a building's height in units is its rooms', so its
 * scale is the stage's height, and 900 less the band and the margin left 756 —
 * 13.0 px to the unit, measured, where the window the same floor is watched in
 * gives 14.9. The wait is the point of the picture. Ten per cent more frame
 * gives the building 842 px and 14.5; the shape is still 16:9 and the scale
 * is still a whole 2.
 */
export const SHARE_SHAPES = Object.freeze({
  wide: Object.freeze({ id: 'wide', label: '16:9', w: 1760, h: 990 }),
  square: Object.freeze({ id: 'square', label: '1:1', w: 1400, h: 1400 }),
});

/** Output pixels per CSS pixel. The floor is drawn at this, not resampled to it. */
export const SHARE_SCALE = 2;

/**
 * Ground left round the building on every side, in CSS pixels. Enough that a
 * room plate on the top wall is whole and the building's shadow has somewhere
 * to fall; little enough that the floor is still the picture.
 */
export const SHARE_MARGIN = 36;

/** The band's metrics, in CSS pixels. */
export const SHARE_FOOTER = Object.freeze({ height: 76, padX: 40, mark: 32, gap: 12 });

/**
 * Where the floor and the band go in a frame.
 * @param {'wide'|'square'|string} shape
 * @param {boolean} footer
 * @returns {{w:number, h:number, floorH:number, footerH:number, scale:number}}
 */
export function shareLayout(shape, footer) {
  const frame = SHARE_SHAPES[shape] || SHARE_SHAPES.wide;
  const footerH = footer ? SHARE_FOOTER.height : 0;
  return { w: frame.w, h: frame.h, floorH: frame.h - footerH, footerH, scale: SHARE_SCALE };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The band's one line, from the floor's own numbers.
 *
 * `7 need you · 2 hands up · oldest 1d 2h · 21 sessions, 5 rooms`. Every part
 * is a count the header already shows or a wait the floor already draws;
 * nothing is computed for the picture that the floor does not say itself. A
 * part with nothing to report is left out rather than printed as a zero, and
 * a floor nobody is waiting on says so.
 *
 * It reads the same fields from a redacted snapshot as from a real one, which
 * is the point: counts, states and times are what the redaction keeps.
 *
 * @param {any} snapshot
 * @param {{now?: number, rooms?: number}} [opts] `rooms`: how many project rooms
 *   the picture actually draws, where the caller has the plan to count them. A
 *   project with nobody active has no room, so the list of projects is only
 *   the fallback: the band must not count a room the picture does not show.
 * @returns {{line:string, parts:string[], wordmark:string, name:string}}
 */
export function shareFooterModel(snapshot, opts = {}) {
  const src = snapshot || {};
  const agents = Array.isArray(src.agents) ? src.agents : [];
  const counts = src.counts || {};
  const now = Number.isFinite(opts.now) ? Number(opts.now) : Number(src.now) || 0;

  let oldest = 0;
  for (const a of agents) {
    if (!a || a.ackState !== 'active') continue;
    const since = a.reviewSince || a.needsInputSince || null;
    if (since && now) oldest = Math.max(oldest, now - since);
  }
  const sessions = agents.filter((a) => a && a.subagent !== true && a.ackState !== 'let_go').length;
  const listed = (Array.isArray(src.projects) ? src.projects : []).length;
  const rooms = Number.isFinite(opts.rooms) ? Number(opts.rooms) : listed;
  const needsYou = Number(counts.needsYou) || 0;
  const handsUp = Number(counts.handsUp) || 0;

  /** @type {string[]} */
  const parts = [];
  if (needsYou > 0) parts.push(needsYou === 1 ? '1 needs you' : `${needsYou} need you`);
  else parts.push('nobody waiting');
  if (handsUp > 0) parts.push(plural(handsUp, 'hand up', 'hands up'));
  if (needsYou > 0 && oldest >= 60_000) parts.push(`oldest ${formatWait(oldest)}`);
  parts.push(`${plural(sessions, 'session', 'sessions')}, ${plural(rooms, 'room', 'rooms')}`);

  return { line: parts.join(' · '), parts, wordmark: WORDMARK, name: 'DeckHQ' };
}

/**
 * The mark, as `public/brand/deckhq-mark.svg` draws it: six rounded
 * rectangles in a 512 box (the circle is one whose radius is half its side).
 * `test/unit/share-picture.test.mjs` reads the SVG and fails if these differ.
 * Each is `[x, y, w, h, radius, role]`; the rim is stroked, the rest filled.
 * @type {ReadonlyArray<readonly [number, number, number, number, number, string]>}
 */
export const MARK_SHAPES = Object.freeze([
  [0, 0, 512, 512, 112, 'plate'],
  [6, 6, 500, 500, 106, 'edge'],
  [236, 106, 40, 76, 20, 'dim'],
  [212, 48, 88, 88, 44, 'accent'],
  [44, 170, 424, 300, 104, 'form'],
  [104, 232, 304, 118, 59, 'deep'],
]);

/** A rounded rectangle as a path, for a context that may predate `roundRect`. */
function roundedPath(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

/**
 * Paint the mark `size` wide with its top-left at (x, y).
 *
 * In the chrome's own tokens and NEUTRAL, as it is in the header: the amber
 * antenna tip belongs to the icon, and in a band that sits under a floor whose
 * amber means "a hand is up" it would be a second meaning for one colour.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} size
 * @param {Record<string,string>} colors `stripColors()`'s
 */
export function drawMark(ctx, x, y, size, colors) {
  const k = size / 512;
  const paint = {
    plate: colors.bg,
    edge: colors.line,
    dim: colors.muted,
    accent: colors.ink2,
    form: colors.ink,
    deep: colors.bg,
  };
  ctx.save();
  for (const [sx, sy, w, h, r, role] of MARK_SHAPES) {
    roundedPath(ctx, x + sx * k, y + sy * k, w * k, h * k, r * k);
    if (role === 'edge') {
      ctx.strokeStyle = paint.edge;
      ctx.lineWidth = 12 * k;
      ctx.stroke();
    } else {
      ctx.fillStyle = paint[role];
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * The longest run of `parts`, from the front, that fits `maxWidth` at the
 * context's current font. The first part always stays: it is the headline.
 * @param {{measureText:(t:string)=>{width:number}}} ctx
 * @param {string[]} parts @param {number} maxWidth
 * @returns {string}
 */
export function fitParts(ctx, parts, maxWidth) {
  for (let n = parts.length; n > 1; n--) {
    const text = parts.slice(0, n).join(' · ');
    if (ctx.measureText(text).width <= maxWidth) return text;
  }
  return parts[0] || '';
}

/**
 * Paint the band into `ctx`, whose origin is the band's top-left and which is
 * already scaled. The mark and the name on the left, the numbers in the
 * middle of the frame, `deckhq.dev` on the right — and all of it quieter than
 * the floor above: the chrome's surface, one hairline, ink no brighter than a
 * room plate's.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof shareFooterModel>} model
 * @param {{width:number, colors:Record<string,string>, fontSans?:string, fontMono?:string}} opts
 */
export function drawShareFooter(ctx, model, opts) {
  const { width, colors } = opts;
  const sans = opts.fontSans || 'system-ui, sans-serif';
  const mono = opts.fontMono || 'ui-monospace, monospace';
  const { height, padX, mark, gap } = SHARE_FOOTER;
  const mid = height / 2;

  ctx.save();
  ctx.fillStyle = colors.surface;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = colors.line;
  ctx.fillRect(0, 0, width, 1);

  drawMark(ctx, padX, mid - mark / 2, mark, colors);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `600 24px ${sans}`;
  ctx.fillStyle = colors.ink;
  ctx.fillText(model.name, padX + mark + gap, mid + 1);
  const left = padX + mark + gap + ctx.measureText(model.name).width;

  ctx.font = `21px ${mono}`;
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'right';
  ctx.fillText(model.wordmark, width - padX, mid + 1);
  const right = width - padX - ctx.measureText(model.wordmark).width;

  // Centred on the frame, not on the gap between the two ends: the eye reads
  // the band against the picture above it. It gives way only if it would
  // touch either end, and then it loses parts from the back before it moves.
  ctx.font = `500 24px ${sans}`;
  ctx.fillStyle = colors.ink2;
  ctx.textAlign = 'center';
  const room = Math.max(0, right - left - gap * 4);
  const text = fitParts(ctx, model.parts, room);
  const half = ctx.measureText(text).width / 2;
  const centre = Math.min(Math.max(width / 2, left + gap * 2 + half), right - gap * 2 - half);
  ctx.fillText(text, centre, mid + 1);
  ctx.restore();
}

/**
 * The picture: the floor as it was drawn, and the band under it.
 *
 * The floor canvas is the share scene's own, already at `SHARE_SCALE` — it is
 * copied pixel for pixel, never resampled, which is the whole reason that
 * scene exists (`share-sheet.js`).
 *
 * @param {object} o
 * @param {HTMLCanvasElement} o.floor  backing store `w * scale` by `floorH * scale`
 * @param {ReturnType<typeof shareLayout>} o.layout
 * @param {ReturnType<typeof shareFooterModel>|null} o.footer null for no band
 * @param {Record<string,string>} o.colors
 * @param {string} [o.fontSans]
 * @param {string} [o.fontMono]
 * @param {(w:number,h:number)=>HTMLCanvasElement} [o.makeCanvas]
 * @returns {HTMLCanvasElement}
 */
export function composeSharePicture(o) {
  const make =
    o.makeCanvas ||
    ((w, h) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    });
  const { w, h, floorH, footerH, scale } = o.layout;
  const out = make(Math.round(w * scale), Math.round(h * scale));
  const ctx = out.getContext('2d', { alpha: false }) || out.getContext('2d');
  ctx.fillStyle = o.colors.bg;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(o.floor, 0, 0, Math.round(w * scale), Math.round(floorH * scale));
  if (o.footer && footerH > 0) {
    ctx.save();
    ctx.translate(0, Math.round(floorH * scale));
    ctx.scale(scale, scale);
    drawShareFooter(ctx, o.footer, {
      width: w,
      colors: o.colors,
      fontSans: o.fontSans,
      fontMono: o.fontMono,
    });
    ctx.restore();
  }
  return out;
}
