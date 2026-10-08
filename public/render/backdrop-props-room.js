/**
 * What a project room is furnished with past its desks: the meeting table, the
 * credenza and the standing whiteboard (`plan-interior.js`).
 *
 * THESE ARE THE QUIET PIECES. A room's subject is the person at a desk, so the
 * desk keeps the darker timber, the light pool and the one person on the floor.
 * Everything here is cut from the pale wood the lounge's tables are, on chairs
 * with no cushion highlight and no arms, and none of it is lit: it reads as
 * furniture when looked at and as texture when not.
 *
 * Coordinates arrive pre-converted to px and already rotated by `angle`, and
 * the caller has already clipped to the prop's own footprint plus
 * `PROP_BLEED`: a prop may not paint outside its own rect.
 */

import { PALETTE } from './palette.js';
import { roundRect, unturn, TABLE_EDGE_U } from './backdrop-paint.js';
import { setRadius } from './look-derive.js';
import { CHAIR, CHAIR_GAP, SEAT_PITCH } from './plan-units.js';
import { MEETING_END } from './plan-interior.js';

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
      const back = Math.max(2, chair * 0.22);
      /** Every chair's seat, and the back along its outer edge. */
      const chairs = [];
      for (const sign of [-1, 1]) {
        for (let i = 0; i < perSide; i++) {
          const a = first + i * pitch - chair / 2;
          const c = sign * (deep / 2 - CHAIR * u * 0.5) - chair / 2;
          chairs.push([
            box(a, c, chair, chair),
            box(a, sign < 0 ? c : c + chair - back, chair, back),
          ]);
        }
      }
      // THE CHAIRS FIRST, pushed in. A seat and a back and nothing else: an
      // empty meeting chair is furniture, and four of them drawn like the one
      // somebody is working in would be four places to look for somebody.
      local((k) => {
        k.fillStyle = PALETTE.chairFill;
        k.strokeStyle = PALETTE.chairEdge;
        k.lineWidth = 1;
        for (const [seat] of chairs) {
          roundRect(k, seat[0], seat[1], seat[2], seat[3], setRadius(3));
          k.fill();
          k.stroke();
        }
      });
      ctx.fillStyle = PALETTE.chairBackrest;
      for (const [, bar] of chairs) {
        roundRect(ctx, bar[0], bar[1], bar[2], bar[3], 1.5);
        ctx.fill();
      }
      // THE TABLE, over the knees of its chairs.
      const top = box(-len / 2, -(deep - reach * 2) / 2, len, deep - reach * 2);
      local((k) => {
        k.fillStyle = PALETTE.tableWood;
        roundRect(k, top[0], top[1], top[2], top[3], setRadius(3));
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1;
        k.stroke();
      });
      // §3.4: every table shows its edge, on the side the light travels toward.
      const band = Math.max(1, TABLE_EDGE_U * u);
      ctx.fillStyle = PALETTE.deskEdge;
      ctx.fillRect(top[0], top[1] + top[3] - band, top[2], band);
      ctx.fillRect(top[0] + top[2] - band, top[1], band, top[3] - band);
      return true;
    }
    case 'credenza': {
      // A low cabinet against a wall: one carcass, and a door line every two
      // units along it. No handles, no top-of-cabinet clutter — a credenza
      // with things on it is a second desk.
      unturn(ctx, prop);
      const upright = h > w;
      const run = upright ? h : w;
      local((k) => {
        k.fillStyle = PALETTE.tableWood;
        roundRect(k, -w / 2, -h / 2, w, h, setRadius(2));
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1;
        k.stroke();
      });
      const doors = Math.max(2, Math.round(run / (2 * u)));
      ctx.strokeStyle = PALETTE.deskEdge;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      for (let i = 1; i < doors; i++) {
        const at = -run / 2 + (run / doors) * i;
        ctx.beginPath();
        if (upright) {
          ctx.moveTo(-w / 2 + 1, at);
          ctx.lineTo(w / 2 - 1, at);
        } else {
          ctx.moveTo(at, -h / 2 + 1);
          ctx.lineTo(at, h / 2 - 1);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
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
