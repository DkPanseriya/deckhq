/**
 * What the five furniture painters share: how much detail a bake can hold, the
 * tones a detail is drawn in, the edge every top shows, and the task chair.
 *
 * LEVEL OF DETAIL. A floor is baked at the scale it is drawn at, anywhere from
 * 7.5 to past 30 device pixels to the plan unit, and a keyboard row that is a
 * crisp hairline at 32 is a grey smear at 8. So every painter asks `detailOf`
 * once and draws one of three things:
 *
 *   0  under 10 px per unit   the silhouette and its edge, and nothing else
 *   1  10 to 16               plus what names the piece: the screen and its
 *                             keyboard, a chair's back and arms, a sofa's cushions
 *   2  over 16                everything: key rows, castors, seams, book spines
 *
 * Level 0 never costs more path operations than the furniture did before it
 * had levels; `test/unit/furniture.test.mjs` counts them.
 *
 * Coordinates are the design grid's, as everywhere in the backdrop. No shadow
 * is set here: a piece meets the floor through the `local` its painter is
 * handed (`grounded` in `backdrop-paint.js`), and a detail casts nothing.
 */

import { PALETTE, appearanceHash } from './palette.js';
import { deviceScaleOf } from './device-px.js';
import { roundRect, lightDir } from './backdrop-paint.js';
import { setRadius } from './look-derive.js';
import { furnitureTonesFor } from './furniture-tones.js';

/** Under this many device pixels to the unit a piece is its silhouette. */
export const LOD_MID_PPU = 10;
/** Over this many it carries every detail it has. */
export const LOD_FULL_PPU = 16;

/**
 * How much detail the bake this context belongs to can hold: 0, 1 or 2.
 * @param {any} ctx @param {number} u design pixels per plan unit
 * @returns {0|1|2}
 */
export function detailOf(ctx, u) {
  const ppu = u * deviceScaleOf(ctx);
  if (ppu < LOD_MID_PPU) return 0;
  return ppu > LOD_FULL_PPU ? 2 : 1;
}

/** One device pixel, in the context's own units: the width of a hairline. */
export function onePx(/** @type {any} */ ctx) {
  return 1 / deviceScaleOf(ctx);
}

/** @type {{key:string, tones:Readonly<Record<string,string>>}|null} */
let cached = null;

/**
 * The detail tones for the palette the floor is painted in right now. Derived
 * once per palette rather than once per prop: a bake paints four hundred
 * pieces from the same thirty tokens.
 * @returns {Readonly<Record<string,string>>}
 */
export function tones() {
  const p = /** @type {Record<string,string>} */ (PALETTE);
  const key = `${p.deskTop}${p.tableWood}${p.chairFill}${p.sofaCushion}${p.counterTop}${p.wallFill}${p.inkWarm}${p.plantLeafA}${p.deskSheen}`;
  if (!cached || cached.key !== key) cached = { key, tones: furnitureTonesFor(p) };
  return cached.tones;
}

/**
 * A number in [0, 1) that belongs to this prop and to nothing else on the
 * floor: its id where it has one, what it is attached to, and where it stands.
 * The same plan bakes the same floor, so there is no random source here.
 *
 * @param {any} prop @param {string} salt which of the prop's choices this is
 */
export function seeded(prop, salt) {
  const a = (prop && prop.anchor) || {};
  const where = `${prop.id || ''}|${a.to || a.of || ''}|${a.edge || ''}|${Number(prop.x).toFixed(2)},${Number(prop.y).toFixed(2)}`;
  return appearanceHash(`${salt}:${prop.kind}:${where}`) / 4294967296;
}

/**
 * EVERY TOP SHOWS ITS EDGE. The light travels down and to the right, so the
 * two edges it reaches first are lit and the two it leaves by are in shade: a
 * darker band there, as wide as `band`, split between them by how the light is
 * travelling — a morning light, lower and more from the left, gives the right
 * edge more of it. Clipped to the top's own outline, so a rounded corner stays
 * rounded.
 *
 * @param {any} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} r the top's corner radius
 * @param {number} band the shaded band at noon, in design pixels
 * @param {string} dark @param {string} lit
 */
export function topEdges(ctx, x, y, w, h, r, band, dark, lit) {
  const dir = lightDir();
  const bx = Math.min(w / 2, band * dir.x * Math.SQRT2);
  const by = Math.min(h / 2, band * dir.y * Math.SQRT2);
  const sheen = Math.max(onePx(ctx), band * 0.5);
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.fillStyle = dark;
  ctx.fillRect(x, y + h - by, w, by);
  ctx.fillRect(x + w - bx, y, bx, h - by);
  ctx.fillStyle = lit;
  ctx.fillRect(x, y, w - bx, sheen);
  ctx.fillRect(x, y + sheen, sheen, h - by - sheen);
  ctx.restore();
}

/**
 * How far an empty chair has been left turned: 8 to 15 degrees, either way.
 * The bake does not know who is sitting where, so every task chair is turned;
 * a seated figure covers the seat and the turn reads as a chair somebody is in.
 * @param {any} prop @returns {number} radians
 */
export function chairSwivel(prop) {
  const deg = 8 + 7 * seeded(prop, 'swivel');
  return ((seeded(prop, 'side') < 0.5 ? -deg : deg) * Math.PI) / 180;
}

/**
 * A task chair's seat, as shares of its footprint: how wide, how deep, and how
 * far forward of centre it sits. The back stands `back` of the footprint behind
 * the centre at its furthest. A meeting chair's tuck is measured from these.
 */
export const CHAIR_SEAT = Object.freeze({ w: 0.7, d: 0.62, forward: 0.07, back: 0.35 });

/**
 * A TASK CHAIR, drawn with its back at -y: whoever sits in it looks DOWN the
 * page, toward +y, and the back is behind them. A caller turns it so that +y
 * is the way the seat faces.
 *
 * From the floor up: a five-star base whose castors show past the seat, the
 * seat itself, an arm pad down each side, and the back as a curved band behind
 * the occupant. A meeting chair is the same chair without the base and arms —
 * it is pushed under a table and is not somewhere to look for somebody.
 *
 * @param {any} ctx
 * @param {number} s the chair's footprint, in design pixels
 * @param {(fn:(k:any)=>void)=>void} local the caller's contact-and-fill
 * @param {0|1|2} lod
 * @param {{plain?:boolean}} [opts] `plain`: no base and no arms
 */
export function taskChair(ctx, s, local, lod, opts = {}) {
  const t = tones();
  const seatW = s * CHAIR_SEAT.w;
  const seatD = s * CHAIR_SEAT.d;
  const mid = s * CHAIR_SEAT.forward;
  const top = mid - seatD / 2;
  if (lod >= 1 && !opts.plain) {
    // The base: five spokes 72 degrees apart, one straight back, and a castor
    // on the end of each. Two of the five show clear of the seat.
    const reach = s * 0.43;
    ctx.strokeStyle = t.chairBase;
    ctx.lineWidth = Math.max(onePx(ctx), s * 0.035);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      ctx.moveTo(0, mid);
      ctx.lineTo(Math.cos(a) * reach, mid + Math.sin(a) * reach);
    }
    ctx.stroke();
    ctx.fillStyle = t.chairBase;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      const cx = Math.cos(a) * reach;
      const cy = mid + Math.sin(a) * reach;
      ctx.moveTo(cx + s * 0.045, cy);
      ctx.arc(cx, cy, s * 0.045, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  local((k) => {
    k.fillStyle = PALETTE.chairFill;
    roundRect(k, -seatW / 2, top, seatW, seatD, setRadius(4));
    k.fill();
    k.strokeStyle = PALETTE.chairEdge;
    k.lineWidth = 1.2;
    k.stroke();
  });
  if (lod >= 1 && !opts.plain) {
    // An arm pad down each side, over the seat's own edge.
    ctx.fillStyle = t.chairArm;
    for (const side of [-1, 1]) {
      roundRect(ctx, side * (seatW / 2) - s * 0.045, top + s * 0.1, s * 0.09, s * 0.36, 1.2);
      ctx.fill();
    }
  }
  if (lod >= 2) {
    // The seat pan's own seam, a twentieth of a unit in from its edge.
    const inset = s * 0.06;
    ctx.strokeStyle = t.seatLine;
    ctx.lineWidth = onePx(ctx);
    roundRect(ctx, -seatW / 2 + inset, top + inset, seatW - inset * 2, seatD - inset * 2, 3);
    ctx.stroke();
  }
  // The back: a band curved round the occupant, wider than the seat it stands
  // behind and clear of it.
  const half = s * 0.39;
  const y = top - s * 0.02;
  ctx.strokeStyle = t.chairBack;
  ctx.lineWidth = Math.max(1.5, s * 0.15);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-half, y + s * 0.07);
  ctx.quadraticCurveTo(0, y - s * 0.1, half, y + s * 0.07);
  ctx.stroke();
  ctx.lineCap = 'butt';
}
