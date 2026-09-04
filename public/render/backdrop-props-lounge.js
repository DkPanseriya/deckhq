/**
 * The props the lounge is furnished with (WP-22 follow-up).
 *
 * Split out of `backdrop.js`'s `paintProp` unchanged. Sofas and their corner pieces, the coffee table and what is on it, the side and magazine tables, the lamp and the water cooler.
 *
 * The switch is the original's, case for case and line for line, including
 * every `break`. What is new is only the wrapper: a `default` that answers
 * `false` so `paintProp` can try the next group, and the `true` after the
 * switch that says this group drew it. `local` is the caller's — the
 * two-pass shadow-then-fill it built around `withShadow` — handed in rather
 * than rebuilt, so no prop's shadow changed.
 *
 * Coordinates arrive pre-converted to px and already rotated by `angle`, and
 * the caller has already clipped to the prop's own footprint plus
 * `PROP_BLEED`: a prop may not paint outside its own rect.
 */

import { PALETTE } from './palette.js';
import { roundRect } from './backdrop-paint.js';
import { LAMP_GLOW } from './backdrop-paint.js';

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
      // Rotating the prop instead was tried and is wrong: `angle` also has to
      // mean which way the sofa FACES, and the layout rect used for bounds and
      // anchors is the unrotated box — so a rotated sofa rendered across its
      // own footprint. That is what turned the reception's back run upright.
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
      // is the far side from that. Without this every sofa in the building had
      // its back to the room and its seat to the wall.
      const backAtStart = vertical ? Math.cos(a) < 0 : Math.sin(a) > 0;
      local((k) => {
        k.fillStyle = PALETTE.sofaFrame;
        roundRect(k, -len / 2, -depth / 2, len, depth, 6);
        k.fill();
        k.strokeStyle = PALETTE.chairEdge;
        k.stroke();
      });
      // Arms at each end and a back along one long side, so a sofa reads as a
      // sofa from directly above instead of as a white slab with lines on it.
      const arm = Math.min(depth * 0.34, 7);
      const back = Math.min(depth * 0.3, 6);
      const backY = backAtStart ? -depth / 2 : depth / 2 - back;
      ctx.fillStyle = PALETTE.sofaFrame;
      roundRect(ctx, -len / 2, backY, len, back, 4);
      ctx.fill();
      roundRect(ctx, -len / 2, -depth / 2, arm, depth, 4);
      ctx.fill();
      roundRect(ctx, len / 2 - arm, -depth / 2, arm, depth, 4);
      ctx.fill();
      // Seat cushions between the arms, each with its own soft seam.
      const seatX = -len / 2 + arm;
      const seatW = Math.max(2, len - arm * 2);
      const seatY = backAtStart ? -depth / 2 + back : -depth / 2 + 1.5;
      const seatH = Math.max(2, depth - back - 1.5);
      // A cushion is about as wide as the sofa is deep, and the seams between
      // them are seams — a 2.4px gap on every one turned a long reception run
      // into a row of separate white tiles.
      const n = Math.max(1, Math.round(seatW / Math.max(24, depth)));
      const cw = seatW / n;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = PALETTE.sofaCushion;
        roundRect(ctx, seatX + i * cw + 0.8, seatY + 1, cw - 1.6, seatH - 2, 3);
        ctx.fill();
        ctx.strokeStyle = PALETTE.sofaSeam;
        ctx.lineWidth = 0.9;
        roundRect(ctx, seatX + i * cw + 0.8, seatY + 1, cw - 1.6, seatH - 2, 3);
        ctx.stroke();
      }
      break;
    }
    case 'coffee_table': {
      // Low table in front of a sofa group. Same wood tone and soft ring
      // highlight as the dining and board-game tables so the lounge reads as
      // one furniture set, but rectangular rather than round: a coffee table
      // is a low rectangle, and the shape is what keeps the two apart from
      // above now that the tone no longer does.
      local((k) => {
        k.fillStyle = PALETTE.tableWood;
        roundRect(k, -w / 2, -h / 2, w, h, 5);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1.2;
        k.stroke();
      });
      const inset = Math.min(w, h) * 0.22;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(0.6, u / 22);
      roundRect(ctx, -w / 2 + inset, -h / 2 + inset, w - inset * 2, h - inset * 2, 3);
      ctx.stroke();
      break;
    }
    case 'fruit_bowl': {
      // A bowl of fruit on a counter: the small domestic cue that makes a
      // room read as a kitchen rather than as more office furniture.
      const r = Math.min(w, h) / 2;
      local((k) => {
        k.fillStyle = PALETTE.deskTop;
        k.beginPath();
        k.arc(0, 0, r, 0, Math.PI * 2);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.stroke();
      });
      const fruit = [
        [-0.3, -0.2, '#C0563B'],
        [0.3, -0.15, '#D98F2E'],
        [0, 0.25, '#7C9A4A'],
        [-0.15, 0.05, '#C9A227'],
      ];
      for (const [fx, fy, tone] of /** @type {Array<[number, number, string]>} */ (fruit)) {
        ctx.fillStyle = tone;
        ctx.beginPath();
        ctx.arc(fx * r, fy * r, r * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'sofa_corner': {
      // The corner unit of the reception's C-shaped sectional. Same
      // fill/edge tokens as `sofa` so it reads as one continuous run
      // where they abut; one large seat cushion instead of a row of small
      // ones is what marks it as the turning corner rather than another
      // straight length.
      local((k) => {
        k.fillStyle = PALETTE.sofaFill;
        roundRect(k, -w / 2, -h / 2, w, h, 6);
        k.fill();
        k.strokeStyle = PALETTE.chairEdge;
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
      break;
    }
    case 'side_table': {
      // Small square table beside the sofa — same wood tokens as the desk
      // family, just square and low, with a soft corner sheen instead of
      // the desk's centre divider.
      local((k) => {
        k.fillStyle = PALETTE.tableWood;
        roundRect(k, -w / 2, -h / 2, w, h, 3);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1;
        k.stroke();
      });
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      roundRect(ctx, -w / 2 + 1, -h / 2 + 1, w * 0.5, h * 0.5, 2);
      ctx.fill();
      break;
    }
    case 'magazine_table': {
      // Low rectangular coffee table with a couple of magazines fanned
      // across it — small flat rects at a slight angle read as "in use",
      // the same trick the whiteboard's marker dashes use.
      local((k) => {
        k.fillStyle = PALETTE.tableWood;
        roundRect(k, -w / 2, -h / 2, w, h, 4);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1.2;
        k.stroke();
      });
      const mags = [
        { dx: -0.16, dy: -0.06, rot: -0.16, tone: PALETTE.whiteboardMarkerBlue },
        { dx: 0.1, dy: 0.1, rot: 0.22, tone: PALETTE.whiteboardMarkerPlum },
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
      // and a warm glow escaping under its rim. LAMP_GLOW (top of file)
      // is a colour palette.js does not carry — its only glows are the
      // cool monitor/arcade cyan, and a floor lamp needs to read as warm
      // light.
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
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(-r * 0.18, -r * 0.18, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default:
      return false;
  }
  return true;
}
