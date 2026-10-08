/**
 * The props the lounge is furnished with: sofas and their corner pieces,
 * armchairs, the booth, the coffee table and what is on it, the side and
 * magazine tables, the lamp and the water cooler.
 *
 * One switch, a `default` that answers `false` so `paintProp` can try the next
 * group. `local` is the caller's — the piece's cast and its contact with the
 * floor (`grounded`) — handed in rather than rebuilt, and nothing here sets a
 * shadow of its own. How much of a piece is drawn depends on the scale of the
 * bake: `detailOf` in `backdrop-props-kit.js`.
 *
 * Coordinates arrive pre-converted to px and already rotated by `angle`, and
 * the caller has already clipped to the prop's own footprint plus
 * `PROP_BLEED`: a prop may not paint outside its own rect.
 */

import { PALETTE } from './palette.js';
import { LOOK, setRadius } from './look-derive.js';
import { roundRect, unturn, SOFA_ARM_U, SOFA_BACK_U } from './backdrop-paint.js';
import { LAMP_GLOW } from './backdrop-paint.js';
import { detailOf, onePx, seeded, tones, topEdges } from './backdrop-props-kit.js';

/** A seat cushion is about this wide, and the gap between two this narrow. */
export const CUSHION_U = 1.9;
export const CUSHION_GAP_U = 0.06;
/** The one pillow a sofa carries: its side, and how far it is turned. */
export const PILLOW_U = 0.6;
export const PILLOW_TURN = (12 * Math.PI) / 180;
/** A booth's high back, and the table between its two benches, in plan units. */
export const BOOTH_BACK_U = 0.35;
export const BOOTH_TABLE_U = Object.freeze({ across: 0.9, along: 1.6 });

/**
 * A low table's top: the pale timber, its outline, and — where a bake can hold
 * them — its two shaded edges and two lit ones.
 *
 * @param {any} ctx @param {number} w @param {number} h @param {number} r
 * @param {number} u @param {(fn:(k:any)=>void)=>void} local @param {0|1|2} lod
 */
function lowTable(ctx, w, h, r, u, local, lod) {
  local((k) => {
    k.fillStyle = PALETTE.tableWood;
    roundRect(k, -w / 2, -h / 2, w, h, r);
    k.fill();
    k.strokeStyle = PALETTE.deskEdge;
    k.lineWidth = 1.2;
    k.stroke();
  });
  if (lod >= 1) {
    const t = tones();
    topEdges(ctx, -w / 2, -h / 2, w, h, r, Math.max(1, 0.08 * u), t.tableBand, t.tableLit);
  }
}

/**
 * @param {any} ctx @param {any} prop @param {number} u
 * @param {number} w @param {number} h @param {(fn:(k:any)=>void)=>void} local
 * @returns {boolean} whether this group recognised the kind
 */
export function paintLoungeProps(ctx, prop, u, w, h, local) {
  switch (prop.kind) {
    case 'sofa': {
      // A sofa's RECT is the truth about how it lies: a run wider than it is
      // deep is horizontal, a run deeper than it is wide is vertical. The
      // cushion loop below divides along the length, so a taller-than-wide
      // sofa is drawn in a quarter-turned frame with its dimensions swapped.
      //
      // A sofa's RECT is its footprint and must NOT turn with `angle`. The
      // switch's wrapper has already applied `prop.angle`, so cancel it here
      // exactly as `manager` does: a 32 x 2.6 back run rotated by its own
      // facing renders as a 2.6 x 32 band straight across the room it is
      // supposed to sit at the back of.
      const a = prop.angle || 0;
      ctx.rotate(-a);
      const vertical = h > w;
      const len = vertical ? h : w;
      const depth = vertical ? w : h;
      if (vertical) ctx.rotate(Math.PI / 2);
      // WHICH SIDE THE BACK IS ON. The rect says how a sofa LIES; `angle` says
      // which way it FACES, in the plan's convention (0 is +x, east). The back
      // is the far side from that.
      const backAtStart = vertical ? Math.cos(a) < 0 : Math.sin(a) > 0;
      const lod = detailOf(ctx, u);
      const t = tones();
      local((k) => {
        k.fillStyle = PALETTE.sofaFrame;
        roundRect(k, -len / 2, -depth / 2, len, depth, setRadius(6));
        k.fill();
        k.strokeStyle = PALETTE.chairEdge;
        k.lineWidth = 1;
        k.stroke();
      });
      // §3.4 states both in PLAN UNITS — *"arms at 0.6 U"* — because 7 baked
      // pixels is a different piece of furniture at every zoom the floor is
      // drawn at, and a sofa whose arms vanish at fit scale is the slab again.
      const arm = Math.min(depth * 0.34, SOFA_ARM_U * u);
      const back = Math.min(depth * 0.3, SOFA_BACK_U * u);
      const rim = 1;
      if (lod >= 1) {
        // THE UPHOLSTERY: a back along one long side and an arm at each end,
        // a step lighter than the frame they are built on. A soft set rolls
        // its arms: wider, and round at both ends.
        const rolled = !!(LOOK.furniture && LOOK.furniture.arms);
        const backY = backAtStart ? -depth / 2 + rim : depth / 2 - back;
        ctx.fillStyle = t.sofaArm;
        roundRect(ctx, -len / 2 + rim, backY, len - rim * 2, back - rim, setRadius(4));
        ctx.fill();
        const armR = rolled ? arm / 2 : setRadius(4);
        for (const x of [-len / 2 + rim, len / 2 - arm]) {
          roundRect(ctx, x, -depth / 2 + rim, arm - rim, depth - rim * 2, armR);
          ctx.fill();
        }
      }
      // Seat cushions between the arms. A reception run says how many it has
      // (`prop.cushions`): one person sits on each, so the count is the plan's
      // and the same at every zoom. Any other sofa has one for every 1.9 U.
      const seatX = -len / 2 + arm;
      const seatW = Math.max(2, len - arm * 2);
      const seatY = backAtStart ? -depth / 2 + back : -depth / 2 + 1.5;
      const seatH = Math.max(2, depth - back - 1.5);
      const n =
        prop.cushions > 0 ? prop.cushions : Math.max(1, Math.round(seatW / (CUSHION_U * u)));
      const cw = seatW / n;
      const gap = Math.max(0.8, (CUSHION_GAP_U * u) / 2);
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = PALETTE.sofaCushion;
        roundRect(ctx, seatX + i * cw + gap, seatY + 1, cw - gap * 2, seatH - 2, 3);
        ctx.fill();
        if (lod >= 2) {
          ctx.strokeStyle = t.sofaSeam;
          ctx.lineWidth = onePx(ctx);
          ctx.stroke();
        }
      }
      if (lod === 0) break;
      // The back cushions: a second, shallower row, leaning on the back.
      const padH = back * 0.62;
      const padY = backAtStart ? -depth / 2 + back - padH * 0.72 : depth / 2 - back - padH * 0.28;
      ctx.fillStyle = t.sofaBack;
      for (let i = 0; i < n; i++) {
        roundRect(ctx, seatX + i * cw + gap * 2, padY, cw - gap * 4, padH, 2);
        ctx.fill();
      }
      if (lod >= 2) {
        // ONE PILLOW, at whichever end this sofa keeps it, turned a little.
        const end = seeded(prop, 'pillow') < 0.5 ? -1 : 1;
        const side = Math.min(PILLOW_U * u, cw * 0.5);
        ctx.save();
        ctx.translate(
          end * (seatW / 2 - side * 0.75),
          backAtStart ? seatY + side * 0.8 : seatY + seatH - side * 0.8,
        );
        ctx.rotate(end * PILLOW_TURN);
        ctx.fillStyle = t.pillow;
        roundRect(ctx, -side / 2, -side / 2, side, side, 2);
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 'armchair': {
      // THE QUIET CORNER'S ARMCHAIR (§3.4), 3.0 U — the largest of the four
      // seat kinds and the one that has to read as a single seat rather than as
      // a short sofa. So: a square frame with a high back on the far side and
      // one cushion, where a sofa is a long frame with several.
      //
      // The wrapper has already turned the canvas by `angle`, and an armchair's
      // footprint is square, so this is drawn in the FACING frame: +x is the way
      // the occupant looks, the back is behind them at -x and the arms run along
      // ±y. No rotation to cancel, unlike the sofa, whose rect is a long run and
      // therefore cannot be turned.
      const s = Math.min(w, h);
      const back = Math.max(2, s * 0.26);
      const arm = Math.max(1.5, s * 0.18);
      const lod = detailOf(ctx, u);
      const t = tones();
      local((k) => {
        k.fillStyle = PALETTE.sofaFrame;
        roundRect(k, -s / 2, -s / 2, s, s, setRadius(5));
        k.fill();
        k.strokeStyle = PALETTE.chairEdge;
        k.lineWidth = 1;
        k.stroke();
      });
      if (lod >= 1) {
        // The same construction as a sofa, at one seat: the back, then an arm
        // down each side of it.
        const rolled = !!(LOOK.furniture && LOOK.furniture.arms);
        ctx.fillStyle = t.sofaArm;
        roundRect(ctx, -s / 2 + 1, -s / 2 + 1, back - 1, s - 2, setRadius(4));
        ctx.fill();
        for (const y of [-s / 2 + 1, s / 2 - arm]) {
          roundRect(ctx, -s / 2 + 1, y, s - 2, arm - 1, rolled ? arm / 2 : setRadius(3));
          ctx.fill();
        }
      }
      const seatX = -s / 2 + back;
      const seatW = s - back - arm * 0.6;
      ctx.fillStyle = PALETTE.sofaCushion;
      roundRect(ctx, seatX, -s / 2 + arm, seatW, s - arm * 2, setRadius(4));
      ctx.fill();
      if (lod >= 2) {
        ctx.strokeStyle = t.sofaSeam;
        ctx.lineWidth = onePx(ctx);
        ctx.stroke();
        // The back cushion, leaning where the occupant's shoulders go.
        ctx.fillStyle = t.sofaBack;
        roundRect(ctx, seatX - back * 0.3, -s / 2 + arm + 2, back * 0.7, s - arm * 2 - 4, 2);
        ctx.fill();
      }
      break;
    }
    case 'booth': {
      // A QUIET BOOTH: a high back on three sides, a bench down each arm and
      // a table between them, open on the side it faces. Its rect is its
      // footprint, so the facing turn is undone and the open side is chosen
      // from the angle instead.
      const a = prop.angle || 0;
      unturn(ctx, prop);
      const lod = detailOf(ctx, u);
      const t = tones();
      const sideways = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a));
      // Drawn open toward +y; turned so that +y is the way it faces.
      ctx.rotate(
        sideways ? (Math.cos(a) > 0 ? -Math.PI / 2 : Math.PI / 2) : Math.sin(a) < 0 ? Math.PI : 0,
      );
      const bw = sideways ? h : w;
      const bd = sideways ? w : h;
      const wall = Math.min(bw * 0.2, BOOTH_BACK_U * u);
      const iw = bw - wall * 2;
      const id = bd - wall;
      // The back is a U: the far wall and both arms, and nothing across the front.
      local((k) => {
        k.fillStyle = PALETTE.sofaFrame;
        k.beginPath();
        k.moveTo(-bw / 2, -bd / 2);
        k.lineTo(bw / 2, -bd / 2);
        k.lineTo(bw / 2, bd / 2);
        k.lineTo(iw / 2, bd / 2);
        k.lineTo(iw / 2, -bd / 2 + wall);
        k.lineTo(-iw / 2, -bd / 2 + wall);
        k.lineTo(-iw / 2, bd / 2);
        k.lineTo(-bw / 2, bd / 2);
        k.closePath();
        k.fill();
      });
      // The floor inside it, four per cent lighter than the room's: it is lit.
      ctx.fillStyle = PALETTE.deskSheen;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(-iw / 2, -bd / 2 + wall, iw, id);
      ctx.globalAlpha = 1;
      // A bench down each arm, two cushions long.
      const bench = iw * 0.27;
      for (const side of [-1, 1]) {
        const x = side < 0 ? -iw / 2 : iw / 2 - bench;
        for (let i = 0; i < 2; i++) {
          ctx.fillStyle = PALETTE.sofaCushion;
          roundRect(
            ctx,
            x + 0.8,
            -bd / 2 + wall + (id / 2) * i + 0.8,
            bench - 1.6,
            id / 2 - 1.6,
            3,
          );
          ctx.fill();
          if (lod >= 2) {
            ctx.strokeStyle = t.sofaSeam;
            ctx.lineWidth = onePx(ctx);
            ctx.stroke();
          }
        }
      }
      // The table between them.
      const tw = Math.min(iw - bench * 2 - 2, BOOTH_TABLE_U.across * u);
      const tl = Math.min(id * 0.6, BOOTH_TABLE_U.along * u);
      ctx.fillStyle = PALETTE.tableWood;
      roundRect(ctx, -tw / 2, -bd / 2 + wall + (id - tl) / 2, tw, tl, setRadius(2));
      ctx.fill();
      if (lod >= 1) {
        ctx.strokeStyle = t.tableBand;
        ctx.lineWidth = onePx(ctx);
        ctx.stroke();
      }
      break;
    }
    case 'coffee_table': {
      unturn(ctx, prop);
      // Low table in front of a sofa group. Same wood tone as the dining and
      // board-game tables so the lounge reads as one furniture set, but
      // rectangular rather than round: a coffee table is a low rectangle, and
      // the shape is what keeps the two apart from above.
      const lod = detailOf(ctx, u);
      const t = tones();
      lowTable(ctx, w, h, setRadius(5), u, local, lod);
      // The inset: a glass or a lower shelf, a quarter of the way in.
      const inset = Math.min(w, h) * 0.22;
      ctx.strokeStyle = t.tableLit;
      ctx.lineWidth = Math.max(0.6, u / 22);
      roundRect(ctx, -w / 2 + inset, -h / 2 + inset, w - inset * 2, h - inset * 2, 3);
      ctx.stroke();
      if (lod >= 2) {
        // A book left on it and a dish beside the book, at opposite ends.
        const along = w >= h;
        const reach = (along ? w : h) * 0.24;
        const end = seeded(prop, 'book') < 0.5 ? -1 : 1;
        const s = Math.min(w, h) * 0.2;
        ctx.save();
        ctx.translate(along ? end * reach : 0, along ? 0 : end * reach);
        ctx.rotate(0.2 * end);
        ctx.fillStyle = t.topBook;
        ctx.fillRect(-s * 1.1, -s * 0.75, s * 2.2, s * 1.5);
        ctx.restore();
        ctx.fillStyle = t.topTray;
        ctx.beginPath();
        ctx.arc(along ? -end * reach : 0, along ? 0 : -end * reach, s * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = t.tableBand;
        ctx.lineWidth = onePx(ctx);
        ctx.stroke();
      }
      break;
    }
    case 'fruit_bowl': {
      // A bowl of fruit on a counter: the small domestic cue that makes a
      // room read as a kitchen rather than as more office furniture. The fruit
      // is the counter's and the planting's own colours, never a red.
      const r = Math.min(w, h) / 2;
      const t = tones();
      local((k) => {
        k.fillStyle = PALETTE.deskTop;
        k.beginPath();
        k.arc(0, 0, r, 0, Math.PI * 2);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1;
        k.stroke();
      });
      const fruit = /** @type {Array<[number, number, string]>} */ ([
        [-0.3, -0.2, t.fruitA],
        [0.3, -0.15, t.fruitB],
        [0, 0.25, t.fruitC],
        [-0.15, 0.05, t.fruitD],
      ]);
      for (const [fx, fy, tone] of fruit) {
        ctx.fillStyle = tone;
        ctx.beginPath();
        ctx.arc(fx * r, fy * r, r * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'sofa_corner': {
      // The corner unit of a sectional. Framed like the runs it joins, so the
      // three read as one piece where they abut; one large seat cushion rather
      // than a row of small ones is what marks it as the turning corner.
      const lod = detailOf(ctx, u);
      local((k) => {
        k.fillStyle = PALETTE.sofaFrame;
        roundRect(k, -w / 2, -h / 2, w, h, setRadius(6));
        k.fill();
        k.strokeStyle = PALETTE.chairEdge;
        k.lineWidth = 1;
        k.stroke();
      });
      const cushionPad = Math.min(w, h) * 0.16;
      ctx.fillStyle = PALETTE.sofaCushion;
      roundRect(
        ctx,
        -w / 2 + cushionPad,
        -h / 2 + cushionPad,
        w - cushionPad * 2,
        h - cushionPad * 2,
        5,
      );
      ctx.fill();
      if (lod >= 2) {
        ctx.strokeStyle = tones().sofaSeam;
        ctx.lineWidth = onePx(ctx);
        ctx.stroke();
      }
      break;
    }
    case 'side_table': {
      unturn(ctx, prop);
      // Small square table beside the sofa — the pale timber, square and low.
      lowTable(ctx, w, h, setRadius(3), u, local, detailOf(ctx, u));
      break;
    }
    case 'magazine_table': {
      unturn(ctx, prop);
      // Low rectangular coffee table with a couple of magazines fanned
      // across it — small flat rects at a slight angle read as "in use",
      // the same trick the whiteboard's marker dashes use. Their covers are
      // muted to the table they lie on: a magazine is not a signal.
      const t = tones();
      lowTable(ctx, w, h, setRadius(4), u, local, detailOf(ctx, u));
      const mags = [
        { dx: -0.16, dy: -0.06, rot: -0.16, tone: t.magazineA },
        { dx: 0.1, dy: 0.1, rot: 0.22, tone: t.magazineB },
      ];
      const mw = Math.max(3, w * 0.26);
      const mh = Math.max(2, h * 0.38);
      mags.forEach((m) => {
        ctx.save();
        ctx.translate(m.dx * w, m.dy * h);
        ctx.rotate(m.rot);
        ctx.fillStyle = m.tone;
        roundRect(ctx, -mw / 2, -mh / 2, mw, mh, 1);
        ctx.fill();
        ctx.restore();
      });
      break;
    }
    case 'lamp': {
      // Floor lamp: a small base point, with a wider shade ring above it
      // and a warm glow escaping under its rim. `LAMP_GLOW` is the one warm
      // light on this floor, named in `backdrop-paint.js`.
      const r = Math.min(w, h) / 2;
      ctx.fillStyle = LAMP_GLOW;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.1, 0, Math.PI * 2);
      ctx.fill();
      local((k) => {
        k.strokeStyle = PALETTE.chairFill;
        k.lineWidth = Math.max(1.5, r * 0.5);
        k.beginPath();
        k.arc(0, 0, r * 0.62, 0, Math.PI * 2);
        k.stroke();
      });
      ctx.fillStyle = PALETTE.furnitureMetal;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(1, r * 0.2), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'water_cooler': {
      // A small cylinder with a bottle on top, seen from above: the base
      // is the wider circle, the inverted bottle a smaller one nested
      // inside it.
      const r = Math.min(w, h) / 2;
      local((k) => {
        k.fillStyle = PALETTE.furnitureMetal;
        k.beginPath();
        k.arc(0, 0, r, 0, Math.PI * 2);
        k.fill();
      });
      ctx.fillStyle = PALETTE.monitorScreenGlow;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.whiteboardSurface;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.arc(-r * 0.18, -r * 0.18, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    default:
      return false;
  }
  return true;
}
