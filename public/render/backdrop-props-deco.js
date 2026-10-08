/**
 * What a room is dressed in (`plan-deco.js`): the waste bin, the coat stand,
 * the panel on a wall, the pendant lamp and the standing table.
 *
 * One switch, a `default` that answers `false` so `paintProp` can try the next
 * group. `local` is the caller's — the piece's cast and its contact with the
 * floor (`grounded`) — and nothing here sets a shadow of its own. A pendant
 * hangs from a ceiling: it is drawn without `local`, and meets no floor.
 *
 * THESE ARE THE QUIETEST THINGS IN A ROOM, on purpose. Every tone is cut from
 * the furniture's own tokens (`furniture-tones.js`) and held to the same two
 * rules as a desk: no detail over 1.6:1 against what it is drawn on, and no
 * fill near a colour that asks for the user. The one colour a room may add is
 * its own accent on a wall panel, and only where the look gives rooms a colour.
 *
 * How much of a piece is drawn depends on the scale of the bake (`detailOf`):
 * at level 0 each is a silhouette of three or four path operations.
 *
 * Coordinates arrive pre-converted to px and already rotated by `angle`, and
 * the caller has already clipped to the prop's own footprint plus
 * `PROP_BLEED`.
 */

import { PALETTE } from './palette.js';
import { LOOK, roomAccentFor, setRadius } from './look-derive.js';
import { roundRect, unturn } from './backdrop-paint.js';
import { detailOf, onePx, seeded, tones, topEdges } from './backdrop-props-kit.js';

/**
 * THE POOL A LAMP LAYS ON THE FLOOR, as a radius in plan units by kind. The
 * bake lays it with the desks' own pool (`paintLightPool`), under the walls and
 * the furniture, and not at all in a room whose lights are off.
 */
export const LAMP_POOL_U = Object.freeze({ lamp: 2.2, pendant: 2.4 });

/** A bin's disc, a coat stand's arms and its base ring: shares of the footprint. */
export const BIN_WELL = 0.62;
export const STAND_ARM = 0.42;
export const STAND_BASE = 0.3;
/** A panel's mount against its wall, as a share of its depth. */
export const PANEL_MOUNT = 0.22;
/** The gap between the two halves of a panel hung as a pair, in plan units. */
export const PANEL_GAP_U = 0.3;
/** One felt tile of a panel is about this long. */
export const PANEL_TILE_U = 0.8;

/**
 * @param {any} ctx @param {any} prop @param {number} u
 * @param {number} w @param {number} h @param {(fn:(k:any)=>void)=>void} local
 * @returns {boolean} whether this group recognised the kind
 */
export function paintDecoProps(ctx, prop, u, w, h, local) {
  switch (prop.kind) {
    case 'bin': {
      // A waste bin from above: a disc, and the darker well inside its rim.
      const r = Math.min(w, h) / 2;
      const lod = detailOf(ctx, u);
      const t = tones();
      local((k) => {
        k.fillStyle = t.binBody;
        k.beginPath();
        k.arc(0, 0, r * 0.93, 0, Math.PI * 2);
        k.fill();
      });
      if (lod >= 1) {
        ctx.fillStyle = t.binWell;
        ctx.beginPath();
        ctx.arc(0, 0, r * BIN_WELL, 0, Math.PI * 2);
        ctx.fill();
      }
      if (lod >= 2) {
        // Something thrown away, off centre: a bin somebody uses.
        const a = seeded(prop, 'paper') * Math.PI * 2;
        ctx.fillStyle = t.binPaper;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.22, Math.sin(a) * r * 0.22, r * 0.24, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'coat_stand': {
      // A pole, three arms a third of a turn apart, and the ring it stands on.
      // A coat or two on the arms is what says the room has people in it.
      const s = Math.min(w, h);
      const lod = detailOf(ctx, u);
      const t = tones();
      const turn = seeded(prop, 'turn') * Math.PI * 2;
      const arm = s * STAND_ARM;
      if (lod >= 1) {
        ctx.strokeStyle = t.standPole;
        ctx.lineWidth = Math.max(onePx(ctx), s * 0.06);
        ctx.beginPath();
        ctx.arc(0, 0, s * STAND_BASE, 0, Math.PI * 2);
        ctx.stroke();
      }
      local((k) => {
        k.strokeStyle = t.standPole;
        k.lineWidth = Math.max(1.2, s * 0.09);
        k.lineCap = 'round';
        k.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = turn + (i * Math.PI * 2) / 3;
          k.moveTo(0, 0);
          k.lineTo(Math.cos(a) * arm, Math.sin(a) * arm);
        }
        k.stroke();
        k.lineCap = 'butt';
      });
      if (lod >= 1) {
        // One coat, or two: a rounded shape hung over the end of an arm.
        const coats = seeded(prop, 'coats') < 0.5 ? 1 : 2;
        for (let i = 0; i < coats; i++) {
          const a = turn + (i * Math.PI * 2) / 3;
          ctx.save();
          ctx.translate(Math.cos(a) * arm * 0.82, Math.sin(a) * arm * 0.82);
          ctx.rotate(a);
          ctx.fillStyle = i === 0 ? t.coatA : t.coatB;
          roundRect(ctx, -s * 0.16, -s * 0.24, s * 0.32, s * 0.48, s * 0.12);
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.fillStyle = t.standPole;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(1, s * 0.12), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'wall_panel': {
      // A PANEL ON A WALL, drawn the way the whiteboard is: its mount against
      // the wall and its face tipped a little into the room, because a thing
      // hung flat on a wall is a line from straight above and a line says
      // nothing. Its rect is its footprint; the wall it hangs on is the side
      // its anchor names.
      unturn(ctx, prop);
      const side = (prop.anchor && prop.anchor.side) || (h > w ? 'W' : 'N');
      ctx.rotate({ N: 0, S: Math.PI, W: -Math.PI / 2, E: Math.PI / 2 }[side] || 0);
      const run = Math.max(w, h);
      const deep = Math.min(w, h);
      const lod = detailOf(ctx, u);
      const t = tones();
      const mount = Math.max(1, deep * PANEL_MOUNT);
      const face = deep - mount;
      const halves = prop.split === 2 && lod >= 1 ? 2 : 1;
      const gap = halves === 2 ? Math.min(run * 0.2, PANEL_GAP_U * u) : 0;
      const each = (run - gap) / halves;
      // One silhouette meets the wall and the floor — a shadowed fill is the
      // dear part of a bake — and the cloth is laid on it afterwards.
      local((k) => {
        k.fillStyle = LOOK.partitions.glassFrame;
        k.fillRect(-run / 2, -deep / 2, run, halves === 2 ? mount : deep);
      });
      ctx.fillStyle = t.panelFill;
      for (let i = 0; i < halves; i++) {
        ctx.fillRect(-run / 2 + i * (each + gap), -deep / 2 + mount, each, face);
      }
      if (lod >= 1) {
        // FELT TILES, one beside the next: the room's own colour among them
        // where rooms have one, a green and a timber tone where they do not.
        const accent = roomAccentFor(LOOK, prop.mk);
        const cloth = accent
          ? [accent, t.panelFill, accent]
          : [t.panelSage, t.panelFill, t.panelTimber];
        const first = Math.floor(seeded(prop, 'tile') * cloth.length);
        const tiles = Math.max(2, Math.round(each / (PANEL_TILE_U * u)));
        for (let i = 0; i < halves; i++) {
          const x = -run / 2 + i * (each + gap);
          for (let k = 0; k < tiles; k++) {
            ctx.fillStyle = cloth[(first + i + k) % cloth.length];
            ctx.fillRect(x + (each / tiles) * k, -deep / 2 + mount, each / tiles, face);
          }
          if (lod >= 2) {
            // The joint between two tiles, and the frame round them all.
            ctx.fillStyle = t.panelGroove;
            for (let k = 1; k < tiles; k++) {
              ctx.fillRect(x + (each / tiles) * k, -deep / 2 + mount, onePx(ctx), face);
            }
          }
          const px = onePx(ctx) / 2;
          ctx.strokeStyle = LOOK.partitions.glassFrame;
          ctx.lineWidth = onePx(ctx);
          ctx.strokeRect(x + px, -deep / 2 + mount + px, each - px * 2, face - px * 2);
        }
      }
      break;
    }
    case 'pendant': {
      // A PENDANT LAMP, seen from above: the rim of its shade, and the light
      // inside it. It hangs over a table and touches nothing, so it has no
      // contact and no cast; the pool it lays is on the floor, under the table.
      const r = Math.min(w, h) / 2;
      const lod = detailOf(ctx, u);
      const t = tones();
      ctx.fillStyle = t.tableLit;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = t.pendantRing;
      ctx.lineWidth = Math.max(1.2, r * 0.2);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.74, 0, Math.PI * 2);
      ctx.stroke();
      if (lod >= 2) {
        // The fitting at its centre, where the cord comes down.
        ctx.fillStyle = t.pendantRing;
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(onePx(ctx), r * 0.16), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'standing_table': {
      // A high table: the pale timber top a meeting table has, narrower, and
      // the rail underneath it showing as a line down its length.
      unturn(ctx, prop);
      const lod = detailOf(ctx, u);
      const t = tones();
      const r = setRadius(3);
      local((k) => {
        k.fillStyle = PALETTE.tableWood;
        roundRect(k, -w / 2, -h / 2, w, h, r);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1.2;
        k.stroke();
      });
      if (lod >= 1) {
        topEdges(ctx, -w / 2, -h / 2, w, h, r, Math.max(1, 0.08 * u), t.tableBand, t.tableLit);
      }
      if (lod >= 2) {
        const wide = w >= h;
        const len = (wide ? w : h) * 0.7;
        const strip = Math.max(onePx(ctx), (wide ? h : w) * 0.1);
        ctx.fillStyle = t.tableStrip;
        if (wide) ctx.fillRect(-len / 2, -strip / 2, len, strip);
        else ctx.fillRect(-strip / 2, -len / 2, strip, len);
      }
      break;
    }
    default:
      return false;
  }
  return true;
}
