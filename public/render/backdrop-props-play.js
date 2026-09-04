/**
 * The props the games room and the kitchen are furnished with (WP-22 follow-up).
 *
 * Split out of `backdrop.js`'s `paintProp` unchanged. The dining and board-game tables, the pool table, table tennis, foosball, the arcade cabinet, and the counter, fridge, coffee machine, reception desk and bar beyond them.
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

/**
 * @param {any} ctx @param {any} prop @param {number} u
 * @param {number} w @param {number} h @param {(fn:(k:any)=>void)=>void} local
 * @returns {boolean} whether this group recognised the kind
 */
export function paintPlayProps(ctx, prop, u, w, h, local) {
  switch (prop.kind) {
    case 'dining_table':
    case 'board_game_table': {
      local((k) => {
        k.fillStyle = PALETTE.tableWood;
        k.beginPath();
        k.arc(0, 0, w / 2, 0, Math.PI * 2);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1.2;
        k.stroke();
      });
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(0, 0, w * 0.28, 0, Math.PI * 2);
      ctx.stroke();
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
      const ball = Math.max(1.1, pocket * 0.46);
      const rackAt = alongX ? bw * 0.22 : bh * 0.22;
      const BALLS = ['#C4622F', '#3B5E8C', '#B03A3A', '#6E4E96', '#D8A73C'];
      let n = 0;
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i <= row; i++) {
          const along = rackAt + row * ball * 1.9;
          const across = (i - row / 2) * ball * 2.1;
          ctx.fillStyle = BALLS[n % BALLS.length];
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
      local((k) => {
        k.fillStyle = PALETTE.counterTop;
        roundRect(k, -w / 2, -h / 2, w, h, 2);
        k.fill();
      });
      ctx.strokeStyle = PALETTE.chairEdge;
      ctx.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
      ctx.fillStyle = PALETTE.hob;
      ctx.fillRect(-w * 0.32, -h * 0.2, w * 0.2, h * 0.4);
      ctx.fillStyle = PALETTE.sink;
      roundRect(ctx, w * 0.1, -h * 0.22, w * 0.24, h * 0.44, 2);
      ctx.fill();
      break;
    }
    case 'fridge': {
      local((k) => {
        k.fillStyle = PALETTE.fridgeFill;
        roundRect(k, -w / 2, -h / 2, w, h, 2);
        k.fill();
        k.strokeStyle = PALETTE.chairEdge;
        k.stroke();
      });
      break;
    }
    case 'coffee_machine': {
      local((k) => {
        k.fillStyle = PALETTE.furnitureMetal;
        roundRect(k, -w / 2, -h / 2, w, h, 1);
        k.fill();
      });
      break;
    }
    case 'reception_desk': {
      // A low counter, distinct from `user_desk`: no centre divider (that
      // is what makes user_desk read as "a desk to sit at") — instead a
      // raised front lip the way a real reception counter presents to the
      // room, plus a small nameplate/monitor accent so it reads as a
      // staffed counter rather than a plain plinth.
      local((k) => {
        k.fillStyle = PALETTE.counterTop;
        roundRect(k, -w / 2, -h / 2, w, h, 2.5);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1.2;
        k.stroke();
      });
      const lip = Math.max(1.5, h * 0.22);
      ctx.fillStyle = PALETTE.furnitureMetal;
      ctx.fillRect(-w / 2, h / 2 - lip, w, lip);
      ctx.fillStyle = PALETTE.monitorBody;
      roundRect(ctx, w * 0.28, -h / 2 + h * 0.16, w * 0.16, h * 0.3, 1);
      ctx.fill();
      break;
    }
    case 'bar_counter': {
      // A long counter with a worktop edge — same body language as
      // `counter` (kitchen) but without fittings: the darker front band
      // and the thin highlight above it are what say "bar", the overhang
      // lip a drinker would lean on.
      local((k) => {
        k.fillStyle = PALETTE.counterTop;
        roundRect(k, -w / 2, -h / 2, w, h, 2);
        k.fill();
      });
      ctx.strokeStyle = PALETTE.chairEdge;
      ctx.lineWidth = 1;
      roundRect(ctx, -w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1, 1.5);
      ctx.stroke();
      const edge = Math.max(1.2, h * 0.18);
      ctx.fillStyle = PALETTE.furnitureMetal;
      ctx.fillRect(-w / 2, h / 2 - edge, w, edge);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
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
