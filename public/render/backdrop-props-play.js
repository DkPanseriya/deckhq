/**
 * The props the games room and the kitchen are furnished with: the dining and
 * board-game tables, the pool table, table tennis, foosball, the arcade
 * cabinet, and the counter, fridge, coffee machine, reception desk and bar
 * beyond them.
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
import { roundRect, TABLE_EDGE_U } from './backdrop-paint.js';
import { setRadius } from './look-derive.js';
import { detailOf, onePx, tones, topEdges } from './backdrop-props-kit.js';

/** A reception desk is an arc: how far it sweeps, and how thick it is against its radius. */
export const RECEPTION_SWEEP = (110 * Math.PI) / 180;
export const RECEPTION_DEPTH = 1.2 / 5;

/**
 * @param {any} ctx @param {any} prop @param {number} u
 * @param {number} w @param {number} h @param {(fn:(k:any)=>void)=>void} local
 * @returns {boolean} whether this group recognised the kind
 */
export function paintPlayProps(ctx, prop, u, w, h, local) {
  switch (prop.kind) {
    case 'dining_table':
    case 'board_game_table': {
      const t = tones();
      local((k) => {
        k.fillStyle = PALETTE.tableWood;
        k.beginPath();
        k.arc(0, 0, w / 2, 0, Math.PI * 2);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1.2;
        k.stroke();
      });
      ctx.strokeStyle = t.tableLit;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, w * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      if (detailOf(ctx, u) >= 1) {
        // A round top shows its edge as a crescent: the shaded rim on the side
        // the light leaves by.
        const r = w / 2 - TABLE_EDGE_U * u * 0.5;
        ctx.strokeStyle = t.tableBand;
        ctx.lineWidth = Math.max(1, TABLE_EDGE_U * u);
        ctx.beginPath();
        ctx.arc(0, 0, r, -Math.PI * 0.2, Math.PI * 0.7);
        ctx.stroke();
      }
      break;
    }
    case 'pool_table': {
      // A pool table is only recognisable from above by its furniture: a
      // deep cloth bed, a heavy rail frame around it, and six pockets. Drawn
      // as a plain filled rectangle with a hairline border it reads as an
      // ordinary wooden side table, which is exactly what it looked like.
      const rail = Math.max(3, Math.min(w, h) * 0.1);
      const bw = w - rail * 2;
      const bh = h - rail * 2;
      const pocket = rail * 0.62;
      const alongX = w >= h;

      local((k) => {
        // Rail frame, with a lighter top edge so it reads as a raised cushion.
        k.fillStyle = PALETTE.poolRail;
        roundRect(k, -w / 2, -h / 2, w, h, rail * 0.5);
        k.fill();
        k.fillStyle = PALETTE.poolRailTop;
        roundRect(k, -w / 2, -h / 2, w, rail * 0.5, rail * 0.35);
        k.fill();

        // The cloth bed.
        k.fillStyle = PALETTE.poolFelt;
        roundRect(k, -bw / 2, -bh / 2, bw, bh, 2);
        k.fill();
      });

      // Baulk line across the short axis, a quarter of the way down the bed.
      ctx.strokeStyle = PALETTE.poolFeltLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (alongX) {
        const bx = -bw / 2 + bw * 0.25;
        ctx.moveTo(bx, -bh / 2);
        ctx.lineTo(bx, bh / 2);
      } else {
        const by = -bh / 2 + bh * 0.25;
        ctx.moveTo(-bw / 2, by);
        ctx.lineTo(bw / 2, by);
      }
      ctx.stroke();

      // Six pockets: four corners, two at the middle of the long rails.
      const pockets = [
        [-bw / 2, -bh / 2],
        [bw / 2, -bh / 2],
        [-bw / 2, bh / 2],
        [bw / 2, bh / 2],
      ];
      if (alongX) pockets.push([0, -bh / 2], [0, bh / 2]);
      else pockets.push([-bw / 2, 0], [bw / 2, 0]);
      ctx.fillStyle = PALETTE.poolPocket;
      for (const [px, py] of pockets) {
        ctx.beginPath();
        ctx.arc(px, py, pocket, 0, Math.PI * 2);
        ctx.fill();
      }

      // A racked triangle of balls at the far end, cue ball at the other, so
      // the table is legible as mid-game even when nobody is standing at it.
      // The balls are the cloth's own colour carried toward four others on the
      // floor: a game in progress, and nothing that looks like a signal.
      const ball = Math.max(1.1, pocket * 0.46);
      const rackAt = alongX ? bw * 0.22 : bh * 0.22;
      const t = tones();
      const balls = [t.ballA, t.ballB, t.ballC, t.ballD];
      let n = 0;
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i <= row; i++) {
          const along = rackAt + row * ball * 1.9;
          const across = (i - row / 2) * ball * 2.1;
          ctx.fillStyle = balls[n % balls.length];
          ctx.beginPath();
          ctx.arc(alongX ? along : across, alongX ? across : along, ball, 0, Math.PI * 2);
          ctx.fill();
          n++;
        }
      }
      ctx.fillStyle = PALETTE.chairFill;
      ctx.beginPath();
      ctx.arc(alongX ? -bw * 0.28 : 0, alongX ? 0 : -bh * 0.28, ball, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'table_tennis': {
      // Bed, painted boundary lines, the doubles line down the LENGTH, and a
      // net across the middle with posts overhanging both edges. The net is
      // what distinguishes this from any other rectangular table from above.
      const alongX = w >= h;
      local((k) => {
        k.fillStyle = PALETTE.ttBed;
        roundRect(k, -w / 2, -h / 2, w, h, 1);
        k.fill();
      });

      ctx.strokeStyle = PALETTE.ttLine;
      ctx.lineWidth = 1.2;
      const inset = Math.max(1.5, Math.min(w, h) * 0.05);
      ctx.strokeRect(-w / 2 + inset, -h / 2 + inset, w - inset * 2, h - inset * 2);

      // Doubles line, running the long way.
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      if (alongX) {
        ctx.moveTo(-w / 2 + inset, 0);
        ctx.lineTo(w / 2 - inset, 0);
      } else {
        ctx.moveTo(0, -h / 2 + inset);
        ctx.lineTo(0, h / 2 - inset);
      }
      ctx.stroke();

      // Net across the short way, overhanging so the posts are visible.
      const over = Math.max(2, Math.min(w, h) * 0.07);
      ctx.fillStyle = PALETTE.ttNet;
      if (alongX) ctx.fillRect(-1.5, -h / 2 - over, 3, h + over * 2);
      else ctx.fillRect(-w / 2 - over, -1.5, w + over * 2, 3);
      break;
    }
    case 'foosball': {
      // A table with visible rods across it — same body language as
      // `pool_table`/`table_tennis`: a felt bed inside a wood cabinet,
      // plus a row of thin metal rods carrying small alternating-colour
      // players that stand in for the two teams. Orientation-adaptive
      // (rods run across whichever axis is shorter) since this kind has
      // no fixed w/h yet in plan.js.
      local((k) => {
        k.fillStyle = PALETTE.tableWood;
        roundRect(k, -w / 2, -h / 2, w, h, 2);
        k.fill();
      });
      ctx.fillStyle = PALETTE.boardGameFelt;
      roundRect(ctx, -w / 2 + 2, -h / 2 + 2, Math.max(0, w - 4), Math.max(0, h - 4), 1);
      ctx.fill();

      const long = w >= h;
      const span = long ? h : w;
      const across = long ? w : h;
      const rods = 5;
      const dot = Math.max(0.8, Math.min(w, h) * 0.045);
      ctx.strokeStyle = PALETTE.furnitureMetal;
      ctx.lineWidth = Math.max(0.8, Math.min(w, h) * 0.02);
      const teamTones = [PALETTE.whiteboardMarkerBlue, PALETTE.whiteboardMarkerPlum];
      for (let i = 0; i < rods; i++) {
        const a = ((i + 0.5) / rods - 0.5) * across;
        ctx.beginPath();
        if (long) {
          ctx.moveTo(a, -span / 2 + 1);
          ctx.lineTo(a, span / 2 - 1);
        } else {
          ctx.moveTo(-span / 2 + 1, a);
          ctx.lineTo(span / 2 - 1, a);
        }
        ctx.stroke();
        ctx.fillStyle = teamTones[i % 2];
        [-0.28, 0.28].forEach((p) => {
          ctx.beginPath();
          if (long) ctx.arc(a, p * span, dot, 0, Math.PI * 2);
          else ctx.arc(p * span, a, dot, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      break;
    }
    case 'arcade_cabinet': {
      local((k) => {
        k.fillStyle = PALETTE.cabinetBody;
        roundRect(k, -w / 2, -h / 2, w, h, 2);
        k.fill();
      });
      ctx.fillStyle = PALETTE.cabinetScreenGlow;
      ctx.fillRect(-w * 0.3, -h * 0.3, w * 0.6, h * 0.35);
      break;
    }
    case 'counter': {
      // The kitchen's worktop: a hob at one end and a sink at the other, both
      // let into the top rather than standing on it.
      const lod = detailOf(ctx, u);
      const t = tones();
      local((k) => {
        k.fillStyle = PALETTE.counterTop;
        roundRect(k, -w / 2, -h / 2, w, h, 2);
        k.fill();
      });
      ctx.strokeStyle = PALETTE.chairEdge;
      ctx.lineWidth = 1;
      ctx.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
      if (lod >= 1) {
        topEdges(ctx, -w / 2, -h / 2, w, h, 2, Math.max(1, 0.08 * u), t.counterBand, t.counterLit);
      }
      ctx.fillStyle = t.hob;
      if (lod === 0) {
        ctx.fillRect(-w * 0.32, -h * 0.24, w * 0.2, h * 0.48);
      } else {
        roundRect(ctx, -w * 0.32, -h * 0.24, w * 0.2, h * 0.48, 1.5);
        ctx.fill();
      }
      ctx.fillStyle = t.sink;
      roundRect(ctx, w * 0.1, -h * 0.22, w * 0.24, h * 0.44, 2);
      ctx.fill();
      if (lod >= 2) {
        // Two rings on the hob, and the sink's drain and tap.
        ctx.strokeStyle = t.hobRing;
        ctx.lineWidth = onePx(ctx);
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(-w * 0.22 + side * w * 0.05, 0, Math.min(w * 0.035, h * 0.16), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = t.counterBand;
        ctx.beginPath();
        ctx.arc(w * 0.22, 0, Math.max(onePx(ctx), h * 0.05), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(w * 0.215, -h * 0.34, w * 0.01, h * 0.16);
      }
      break;
    }
    case 'fridge': {
      const lod = detailOf(ctx, u);
      local((k) => {
        k.fillStyle = PALETTE.fridgeFill;
        roundRect(k, -w / 2, -h / 2, w, h, 2);
        k.fill();
        k.strokeStyle = PALETTE.chairEdge;
        k.lineWidth = 1;
        k.stroke();
      });
      if (lod >= 2) {
        // Two doors, and a handle on each beside the line between them.
        ctx.strokeStyle = PALETTE.chairEdge;
        ctx.lineWidth = onePx(ctx);
        ctx.beginPath();
        ctx.moveTo(0, -h / 2 + 1);
        ctx.lineTo(0, h / 2 - 1);
        ctx.stroke();
        ctx.fillStyle = PALETTE.chairEdge;
        for (const side of [-1, 1]) {
          ctx.fillRect(side * w * 0.07 - w * 0.012, h * 0.1, w * 0.024, h * 0.26);
        }
      }
      break;
    }
    case 'coffee_machine': {
      const lod = detailOf(ctx, u);
      local((k) => {
        k.fillStyle = PALETTE.furnitureMetal;
        roundRect(k, -w / 2, -h / 2, w, h, 1);
        k.fill();
      });
      if (lod >= 2) {
        // The drip tray along its front, and a cup standing on it.
        const t = tones();
        ctx.fillStyle = PALETTE.inkCool;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(-w * 0.34, h * 0.08, w * 0.68, h * 0.3);
        ctx.globalAlpha = 1;
        ctx.fillStyle = t.keyboard;
        ctx.beginPath();
        ctx.arc(0, h * 0.23, Math.min(w, h) * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'reception_desk': {
      // A STAFFED COUNTER, AND IT IS AN ARC: a shallow curve inside its rect,
      // open toward the person behind it, with a lower tier along the inside
      // for a screen and a tray. Nothing else on the floor is curved, which is
      // what tells a visitor where to walk.
      const lod = detailOf(ctx, u);
      const t = tones();
      const half = RECEPTION_SWEEP / 2;
      // The largest arc of this sweep that fits the rect: its chord across the
      // width, its rise within the height.
      const R = Math.min(
        w / (2 * Math.sin(half)),
        h / (1 - Math.cos(half) * (1 - RECEPTION_DEPTH)),
      );
      const inner = R * (1 - RECEPTION_DEPTH);
      // Centred on the rect: the arc bulges up the page, toward -y.
      const cy = R - (R - inner * Math.cos(half)) / 2;
      /** @param {any} k @param {number} outer @param {number} inside */
      const band = (k, outer, inside) => {
        k.beginPath();
        k.arc(0, cy, outer, -Math.PI / 2 - half, -Math.PI / 2 + half);
        k.arc(0, cy, inside, -Math.PI / 2 + half, -Math.PI / 2 - half, true);
        k.closePath();
      };
      local((k) => {
        k.fillStyle = PALETTE.counterTop;
        band(k, R, inner);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1.2;
        k.stroke();
      });
      // The lower tier, on the inside of the curve.
      const tier = inner + (R - inner) * 0.42;
      ctx.fillStyle = t.counterBand;
      band(ctx, tier, inner);
      ctx.fill();
      if (lod >= 1) {
        // A screen on the tier, to one side: a short dark bar along the curve.
        ctx.strokeStyle = t.monitorBezel;
        ctx.lineWidth = Math.max(1.5, (R - inner) * 0.14);
        ctx.beginPath();
        ctx.arc(
          0,
          cy,
          inner + (R - inner) * 0.22,
          -Math.PI / 2 + half * 0.2,
          -Math.PI / 2 + half * 0.5,
        );
        ctx.stroke();
      }
      if (lod >= 2) {
        // And a tray of paper on the other.
        ctx.save();
        ctx.translate(0, cy);
        ctx.rotate(-half * 0.45);
        ctx.fillStyle = t.keyboard;
        roundRect(
          ctx,
          -(R - inner) * 0.3,
          -inner - (R - inner) * 0.36,
          (R - inner) * 0.6,
          (R - inner) * 0.28,
          1,
        );
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 'bar_counter': {
      // A long counter with a worktop edge — same body language as
      // `counter` (kitchen) but without fittings: the darker front band
      // and the thin highlight above it are what say "bar", the overhang
      // lip a drinker would lean on.
      const t = tones();
      local((k) => {
        k.fillStyle = PALETTE.counterTop;
        roundRect(k, -w / 2, -h / 2, w, h, setRadius(2));
        k.fill();
      });
      ctx.strokeStyle = PALETTE.chairEdge;
      ctx.lineWidth = 1;
      roundRect(ctx, -w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1, 1.5);
      ctx.stroke();
      const edge = Math.max(1.2, h * 0.18);
      ctx.fillStyle = PALETTE.furnitureMetal;
      ctx.fillRect(-w / 2, h / 2 - edge, w, edge);
      ctx.fillStyle = t.counterLit;
      ctx.fillRect(-w / 2, h / 2 - edge - 1, w, 1);
      break;
    }
    case 'bar_stool': {
      // Small round stool, drawn as a disc with a footring: the ring is
      // drawn first and slightly wider than the seat, so it peeks out
      // from beneath the seat's edge the way a real stool's metal
      // footring does when seen from directly above.
      const r = Math.min(w, h) / 2;
      ctx.strokeStyle = PALETTE.furnitureMetal;
      ctx.lineWidth = Math.max(1, r * 0.14);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
      ctx.stroke();
      local((k) => {
        k.fillStyle = PALETTE.chairFill;
        k.beginPath();
        k.arc(0, 0, r * 0.75, 0, Math.PI * 2);
        k.fill();
        k.strokeStyle = PALETTE.chairEdge;
        k.lineWidth = 1.4;
        k.stroke();
      });
      if (detailOf(ctx, u) >= 2) {
        // The seat pad's seam.
        ctx.strokeStyle = tones().seatLine;
        ctx.lineWidth = onePx(ctx);
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'box': {
      // A packing carton, seen from above: four flaps folded back, taped
      // down the middle. The joke and the affordance at once — the room
      // reads as somewhere people are leaving from.
      local((k) => {
        k.fillStyle = PALETTE.boxFill;
        roundRect(k, -w / 2, -h / 2, w, h, 1.5);
        k.fill();
      });
      ctx.strokeStyle = PALETTE.boxFlap;
      ctx.lineWidth = 1;
      ctx.strokeRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4);
      ctx.fillStyle = PALETTE.boxTape;
      ctx.fillRect(-1.5, -h / 2, 3, h);
      break;
    }
    case 'exit_sign': {
      local((k) => {
        k.fillStyle = PALETTE.exitGreen;
        roundRect(k, -w / 2, -h / 2, w, h, 1.5);
        k.fill();
      });
      break;
    }
    default:
      return false;
  }
  return true;
}
