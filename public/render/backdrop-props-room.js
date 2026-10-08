/**
 * What a project room is furnished with past its desks: the meeting table, the
 * credenza, the shelving and the standing whiteboard (`plan-interior.js`).
 *
 * THESE ARE THE QUIET PIECES. A room's subject is the person at a desk, so the
 * desk keeps the darker timber, the light pool and the one person on the floor.
 * Everything here is cut from the pale wood the lounge's tables are, on chairs
 * with no base and no arms, and none of it is lit: it reads as furniture when
 * looked at and as texture when not.
 *
 * Coordinates arrive pre-converted to px and already rotated by `angle`, and
 * the caller has already clipped to the prop's own footprint plus
 * `PROP_BLEED`: a prop may not paint outside its own rect. How much of a piece
 * is drawn depends on the scale of the bake (`detailOf`).
 */

import { PALETTE } from './palette.js';
import { roundRect, seededRng, unturn, TABLE_EDGE_U } from './backdrop-paint.js';
import { LOOK, setRadius } from './look-derive.js';
import { CHAIR, CHAIR_GAP, SEAT_PITCH } from './plan-units.js';
import { MEETING_END } from './plan-interior.js';
import {
  CHAIR_SEAT,
  detailOf,
  onePx,
  seeded,
  taskChair,
  tones,
  topEdges,
} from './backdrop-props-kit.js';

/** How much of a meeting chair is under the table's edge. */
export const MEETING_TUCK = 0.35;

/** A drawer front on a credenza is this wide, and its pull this long, in plan units. */
export const DRAWER_U = 1.4;
export const DRAWER_PULL_U = 0.3;
/** One thing stands on a credenza for every this many units of it. */
export const CREDENZA_OBJECT_U = 3;

/** A shelf's bays between uprights, and how deep a book stands, in plan units. */
export const SHELF_BAY_U = 2.4;
export const BOOK_DEPTH_U = 0.8;
/** A spine's width, narrowest to widest, where a bake can hold one. */
export const BOOK_SPINE_U = Object.freeze([0.12, 0.3]);
/** One slot in this many is left empty, and one book in this many leans. */
export const BOOK_GAP_SHARE = 0.08;
export const BOOK_LEAN_EVERY = 12;
export const BOOK_LEAN = (12 * Math.PI) / 180;

/**
 * THE BOOKS ON A SHELF, seen from above: their top edges, side by side.
 *
 * Seeded from the shelf itself, so the same shelf holds the same books on
 * every bake. Three muted tones a step of value apart; the variety is in how
 * wide a spine is and how far it stands out, never in its hue.
 *
 * @param {any} ctx @param {any} prop
 * @param {number} x0 @param {number} x1 the run the books fill
 * @param {number} y0 the back of the shelf @param {number} deep the well's depth
 * @param {number} u @param {0|1|2} lod
 */
function paintBooks(ctx, prop, x0, x1, y0, deep, u, lod) {
  const t = tones();
  const tint = [t.bookA, t.bookB, t.bookC];
  const rng = seededRng(
    `books:${prop.id || ''}:${Number(prop.x).toFixed(2)},${Number(prop.y).toFixed(2)}`,
  );
  // A spine a bake cannot hold is drawn as the two or three it would blur into.
  const k = lod >= 2 ? 1 : 2;
  const lo = BOOK_SPINE_U[0] * u * k;
  const hi = BOOK_SPINE_U[1] * u * k;
  const gap = Math.max(onePx(ctx), 0.03 * u);
  let x = x0;
  let n = 0;
  while (x < x1 - lo) {
    const bw = Math.min(x1 - x, lo + (hi - lo) * rng());
    const bd = deep * (0.72 + 0.28 * rng());
    const tone = tint[Math.floor(rng() * 3) % 3];
    const skip = rng() < BOOK_GAP_SHARE;
    n++;
    if (!skip) {
      ctx.fillStyle = tone;
      if (lod >= 2 && n % BOOK_LEAN_EVERY === 0) {
        // One in twelve has fallen against its neighbour.
        ctx.save();
        ctx.translate(x + bw / 2, y0 + bd / 2);
        ctx.rotate(BOOK_LEAN);
        ctx.fillRect(-bw / 2, -bd / 2, bw, bd);
        ctx.restore();
      } else {
        ctx.fillRect(x, y0, bw, bd);
      }
    }
    x += bw + gap;
  }
}

/**
 * @param {any} ctx @param {any} prop @param {number} u
 * @param {number} w @param {number} h @param {(fn:(k:any)=>void)=>void} local
 * @returns {boolean} whether this group recognised the kind
 */
export function paintRoomProps(ctx, prop, u, w, h, local) {
  switch (prop.kind) {
    case 'meeting_table': {
      // Its rect is its footprint: the table and the chairs down both sides.
      unturn(ctx, prop);
      const lod = detailOf(ctx, u);
      const t = tones();
      // Laid out along the table and across it. `turned` lays "along" down the
      // room, and the boxes are swapped rather than the canvas turned, so the
      // edge band and the contact shadow stay on the side the light leaves by.
      const turned = prop.turned === true;
      const len = turned ? h : w;
      const deep = turned ? w : h;
      /** @param {number} a @param {number} c @param {number} l @param {number} d */
      const box = (a, c, l, d) => (turned ? [c, a, d, l] : [a, c, l, d]);
      const chair = CHAIR * u * 0.8;
      const reach = (CHAIR + CHAIR_GAP) * u;
      const perSide = Math.max(1, Math.ceil((prop.seats || 4) / 2));
      const pitch = SEAT_PITCH * u;
      const first = -len / 2 + MEETING_END * u + pitch / 2;
      const edge = deep / 2 - reach;
      // THE CHAIRS FIRST, pushed in: a third of each is under the table's edge.
      // A seat and a back and nothing else — an empty meeting chair is
      // furniture, and four of them drawn like the one somebody is working in
      // would be four places to look for somebody.
      //
      // From the back of its back to the front of its seat, a third of that is
      // past the table's edge.
      const front = CHAIR_SEAT.forward + CHAIR_SEAT.d / 2;
      const centre = edge + chair * (front - (front + CHAIR_SEAT.back) * MEETING_TUCK);
      for (const sign of [-1, 1]) {
        for (let i = 0; i < perSide; i++) {
          const a = first + i * pitch;
          const c = sign * centre;
          ctx.save();
          ctx.translate(turned ? c : a, turned ? a : c);
          // Drawn looking up the page; turn it to face the table.
          ctx.rotate((turned ? -Math.PI / 2 : 0) + (sign > 0 ? Math.PI : 0));
          taskChair(ctx, chair, local, lod, { plain: true });
          ctx.restore();
        }
      }
      // THE TABLE, over the knees of its chairs.
      const top = box(-len / 2, -edge, len, edge * 2);
      const r = setRadius(3);
      local((k) => {
        k.fillStyle = PALETTE.tableWood;
        roundRect(k, top[0], top[1], top[2], top[3], r);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1;
        k.stroke();
      });
      // §3.4: every table shows its edge, on the side the light travels toward.
      const band = Math.max(1, TABLE_EDGE_U * u);
      if (lod === 0) {
        ctx.fillStyle = t.tableBand;
        ctx.fillRect(top[0], top[1] + top[3] - band, top[2], band);
        ctx.fillRect(top[0] + top[2] - band, top[1], band, top[3] - band);
        return true;
      }
      topEdges(ctx, top[0], top[1], top[2], top[3], r, band, t.tableBand, t.tableLit);
      // The runner down the middle: a fifth of a unit wide, three fifths of
      // the table long.
      const strip = box(-len * 0.3, -0.1 * u, len * 0.6, 0.2 * u);
      ctx.fillStyle = t.tableStrip;
      roundRect(ctx, strip[0], strip[1], strip[2], strip[3], 1);
      ctx.fill();
      return true;
    }
    case 'credenza': {
      // A low cabinet against a wall, seen from above: its top, the lines of
      // its drawer fronts, a pull on each, and the few things that end up on
      // top of one.
      unturn(ctx, prop);
      const lod = detailOf(ctx, u);
      const t = tones();
      const upright = h > w;
      const run = upright ? h : w;
      const deep = upright ? w : h;
      const r = setRadius(2);
      local((k) => {
        k.fillStyle = PALETTE.tableWood;
        roundRect(k, -w / 2, -h / 2, w, h, r);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1;
        k.stroke();
      });
      /** A point `a` along the run and `c` across it. @param {number} a @param {number} c */
      const at = (a, c) => (upright ? [c, a] : [a, c]);
      // A small bake gets a door every two units, as it always has; a larger
      // one gets the drawer fronts.
      const fronts =
        lod === 0
          ? Math.max(2, Math.round(run / (2 * u)))
          : Math.max(2, Math.round(run / (DRAWER_U * u)));
      if (lod >= 1) {
        topEdges(ctx, -w / 2, -h / 2, w, h, r, Math.max(1, 0.08 * u), t.tableBand, t.tableLit);
      }
      ctx.strokeStyle = t.tableBand;
      ctx.lineWidth = lod === 0 ? 1 : onePx(ctx);
      ctx.beginPath();
      for (let i = 1; i < fronts; i++) {
        const a = -run / 2 + (run / fronts) * i;
        ctx.moveTo(...at(a, -deep / 2 + 1));
        ctx.lineTo(...at(a, deep / 2 - 1));
      }
      ctx.stroke();
      if (lod < 2) return true;
      // A pull on every front, toward the room: the one edge a credenza opens on
      // is the one away from its wall, and the wall is not the painter's to
      // know, so the pulls sit on the centre line where either is right.
      const pull = (DRAWER_PULL_U * u) / 2;
      ctx.lineWidth = Math.max(onePx(ctx), 0.05 * u);
      ctx.beginPath();
      for (let i = 0; i < fronts; i++) {
        const a = -run / 2 + (run / fronts) * (i + 0.5);
        ctx.moveTo(...at(a - pull, deep * 0.3));
        ctx.lineTo(...at(a + pull, deep * 0.3));
      }
      ctx.stroke();
      // WHAT IS ON IT: a pot, a tray or a stack of books, one for every three
      // units, each on a front of its own and never the same two in a row.
      const things = Math.floor(run / (CREDENZA_OBJECT_U * u));
      const start = Math.floor(seeded(prop, 'credenza') * 3);
      for (let i = 0; i < things; i++) {
        const a = -run / 2 + (run / things) * (i + 0.3 + 0.4 * seeded(prop, `at${i}`));
        const [cx, cy] = at(a, -deep * 0.12);
        const s = deep * 0.26;
        const what = (start + i) % 3;
        if (what === 0) {
          ctx.fillStyle = t.topPot;
          ctx.beginPath();
          ctx.arc(cx, cy, s, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = t.topLeaf;
          ctx.beginPath();
          ctx.arc(cx - s * 0.1, cy - s * 0.1, s * 0.7, 0, Math.PI * 2);
          ctx.fill();
        } else if (what === 1) {
          ctx.fillStyle = t.topTray;
          roundRect(ctx, cx - s * 1.3, cy - s * 0.8, s * 2.6, s * 1.6, 1.5);
          ctx.fill();
          ctx.strokeStyle = t.tableBand;
          ctx.lineWidth = onePx(ctx);
          ctx.stroke();
        } else {
          ctx.fillStyle = t.topBook;
          ctx.fillRect(cx - s * 1.1, cy - s * 0.75, s * 2.2, s * 1.5);
          ctx.fillStyle = t.topTray;
          ctx.fillRect(cx - s * 0.8, cy - s * 0.9, s * 1.9, s * 1.3);
        }
      }
      return true;
    }
    case 'shelf':
    case 'bookshelf': {
      // A bookcase seen from directly above: the top of its carcass, the well
      // between its uprights, and the top edges of the books standing in it.
      // `shelf` (a project room's repo-folder launcher) and `bookshelf` (lounge
      // and reception furniture) are one piece under two placement rules.
      //
      // Its rect is its footprint, so the wrapper's facing turn is undone; the
      // run is then drawn along x whichever way the case lies.
      unturn(ctx, prop);
      const lod = detailOf(ctx, u);
      const t = tones();
      const upright = h > w;
      if (upright) ctx.rotate(Math.PI / 2);
      // Drawn 14 % deeper than its own footprint: at the depth it is given (as
      // little as 1.1 U) a case sized exactly to the rect read as too small to
      // be furniture. Along its run it grows by the same share, but never by
      // more than a fifth of a unit at each end — a long case that grew 14 %
      // ran into the sofa beside it. Placement and anchoring use `prop.w/h`
      // untouched — only the paint is bigger.
      const run = upright ? h : w;
      const bw = run + Math.min(run * 0.14, 0.4 * u);
      const bh = (upright ? w : h) * 1.14;
      local((k) => {
        k.fillStyle = PALETTE.tableWood;
        roundRect(k, -bw / 2, -bh / 2, bw, bh, 1.5);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1.4;
        k.stroke();
      });
      const pad = bh * 0.12;
      if (lod === 0) {
        // Blocks of books rather than books: three tones, one row.
        const blocks = Math.min(8, Math.max(4, Math.round(bw / (1.2 * u))));
        const each = (bw - pad * 2) / blocks;
        const tint = [t.bookA, t.bookB, t.bookC];
        for (let i = 0; i < blocks; i++) {
          ctx.fillStyle = tint[(i * 2) % 3];
          ctx.fillRect(-bw / 2 + pad + i * each, -bh / 2 + pad, each - 0.6, bh - pad * 2);
        }
        return true;
      }
      // The well the books stand in, a shade under the carcass round it.
      ctx.fillStyle = t.shelfWell;
      ctx.fillRect(-bw / 2 + pad, -bh / 2 + pad, bw - pad * 2, bh - pad * 2);
      // Uprights: one between every two bays, and the set's own at each end.
      const ends = LOOK.furniture && LOOK.furniture.uprights ? Math.max(1.5, 0.14 * u) : 0;
      const bays = Math.max(1, Math.round(bw / (SHELF_BAY_U * u)));
      const post = Math.max(onePx(ctx), 0.07 * u);
      const inner = bw - pad * 2 - ends * 2;
      const book = Math.min(bh - pad * 2, (BOOK_DEPTH_U * u * bh) / (1.2 * u * 1.14));
      for (let b = 0; b < bays; b++) {
        const x0 = -bw / 2 + pad + ends + (inner / bays) * b + (b ? post / 2 : 0);
        const x1 = -bw / 2 + pad + ends + (inner / bays) * (b + 1) - (b < bays - 1 ? post / 2 : 0);
        paintBooks(
          ctx,
          { ...prop, x: prop.x + b },
          x0 + 0.5,
          x1 - 0.5,
          -bh / 2 + pad,
          book,
          u,
          lod,
        );
      }
      ctx.fillStyle = PALETTE.tableWood;
      for (let b = 1; b < bays; b++) {
        ctx.fillRect(
          -bw / 2 + pad + ends + (inner / bays) * b - post / 2,
          -bh / 2 + pad,
          post,
          bh - pad * 2,
        );
      }
      if (ends) {
        ctx.fillStyle = t.tableBand;
        ctx.fillRect(-bw / 2 + pad, -bh / 2 + pad, ends, bh - pad * 2);
        ctx.fillRect(bw / 2 - pad - ends, -bh / 2 + pad, ends, bh - pad * 2);
      }
      return true;
    }
    case 'board_stand': {
      // A whiteboard on feet, seen from above: the thin line of the board and
      // a foot across it near each end.
      unturn(ctx, prop);
      const upright = h > w;
      const run = upright ? h : w;
      const thick = upright ? w : h;
      if (upright) ctx.rotate(Math.PI / 2);
      const foot = Math.max(2, thick * 0.3);
      ctx.fillStyle = PALETTE.furnitureMetal;
      for (const sign of [-1, 1]) {
        roundRect(ctx, sign * run * 0.36 - foot / 2, -thick / 2, foot, thick, 1);
        ctx.fill();
      }
      const board = Math.max(2, thick * 0.34);
      local((k) => {
        k.fillStyle = PALETTE.whiteboardSurface;
        roundRect(k, -run / 2, -board / 2, run, board, 1);
        k.fill();
        k.strokeStyle = PALETTE.furnitureMetal;
        k.lineWidth = 1;
        k.stroke();
      });
      return true;
    }
    default:
      return false;
  }
}
