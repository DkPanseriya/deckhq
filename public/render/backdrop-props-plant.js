/**
 * The planting, the thresholds and what is on a desk (WP-85c).
 *
 * `docs/plan/10-INTERIOR-DESIGN.md` §3.5, §3.6 and §3.3 add nine prop kinds to
 * this floor and §1.6 is the reason they are here at all: *"forty prop kinds,
 * one silhouette repeated"*. Two plants at two scales answered every spare
 * corner in the building, and a bench desk carried a monitor and nothing else
 * whoever was sitting at it.
 *
 * ITS OWN MODULE for the reason the other three are: `backdrop-props-desk.js`
 * is the largest of them and WP-22's ceiling is 900 lines. The split is by
 * SUBJECT rather than by size — desks, lounge, games, and now the things that
 * grow and the things you step over — so a reader looking for a plant has one
 * file to open.
 *
 * Coordinates arrive pre-converted to px and already rotated by `angle`, and
 * the caller has already clipped to the prop's own footprint plus
 * `PROP_BLEED`: a prop may not paint outside its own rect.
 */

import { PALETTE } from './palette.js';
import { roundRect, unturn } from './backdrop-paint.js';

/**
 * How much of a plant's own footprint the pot takes, and how far the foliage
 * is allowed over it.
 *
 * A plant seen from directly above is FOLIAGE with a rim of pot showing, which
 * is why the pot is drawn first and smaller: a pot drawn at the footprint with
 * leaves inside it reads as a bucket. `PROP_BLEED` is what lets the canopy
 * cross the rect at all (see `paintProp`), and it is the same allowance a
 * lamp's pool of light uses.
 */
const POT_R = 0.38;
const CANOPY_R = 0.52;

/**
 * One leaf mass. Deterministic in `i` — there is no PRNG in this file and
 * there may not be one, because the backdrop is baked once per plan and the
 * next bake must be pixel-identical.
 *
 * @param {any} k @param {number} cx @param {number} cy @param {number} r
 * @param {string} tone
 */
function lobe(k, cx, cy, r, tone) {
  k.fillStyle = tone;
  k.beginPath();
  k.arc(cx, cy, r, 0, Math.PI * 2);
  k.fill();
}

/**
 * The pot under a free-standing plant: a disc, a rim, and the soil ring that
 * stops the foliage reading as though it were growing out of the floor.
 * @param {any} k @param {number} s the plant's half-size in px
 */
function pot(k, s) {
  k.fillStyle = PALETTE.plantPot;
  k.beginPath();
  k.arc(0, s * 0.34, s * POT_R, 0, Math.PI * 2);
  k.fill();
  k.strokeStyle = PALETTE.planterSoil;
  k.lineWidth = Math.max(1, s * 0.07);
  k.beginPath();
  k.arc(0, s * 0.34, s * POT_R * 0.72, 0, Math.PI * 2);
  k.stroke();
}

/**
 * @param {any} ctx @param {any} prop @param {number} u
 * @param {number} w @param {number} h @param {(fn:(k:any)=>void)=>void} local
 * @returns {boolean} whether this group recognised the kind
 */
export function paintPlantProps(ctx, prop, u, w, h, local) {
  const tones = [PALETTE.plantLeafA, PALETTE.plantLeafB, PALETTE.plantLeafC];
  switch (prop.kind) {
    case 'plant_broad': {
      // §3.6: *"three overlapping lobes, low"*. WIDE AND SHORT, and the three
      // lobes sit side by side rather than in a rosette — a bush seen from
      // above is a low mound with a horizon, not a flower.
      const s = Math.max(w, h) / 2;
      local((k) => pot(k, s));
      const lobes = /** @type {const} */ ([
        [-0.42, -0.06, 0.6],
        [0.44, -0.1, 0.58],
        [0.02, -0.34, 0.66],
      ]);
      lobes.forEach(([dx, dy, r], i) =>
        lobe(ctx, dx * s, dy * s, r * s * CANOPY_R * 2, tones[i % tones.length]),
      );
      break;
    }
    case 'plant_blade': {
      // §3.6: *"five upright blades, tall and narrow"*. The one plant on this
      // floor with a DIRECTION: five tapering blades fanning from the pot, so
      // it cannot be mistaken for the bush beside it at any scale.
      const s = Math.max(w, h) / 2;
      local((k) => pot(k, s));
      const blades = /** @type {const} */ ([
        [-0.5, -0.86],
        [-0.22, -1.02],
        [0.04, -1.08],
        [0.3, -0.98],
        [0.54, -0.8],
      ]);
      // THE BLADES REACH THE EDGE OF THE FOOTPRINT. The first cut scaled the
      // tips by `CANOPY_R`, which is the radius a round canopy gets — and a
      // blade is not round: it came out as a green wedge a third of the way up
      // a visible pot, which at fit scale reads as a chipped saucer. A blade
      // plant's whole silhouette is its reach.
      const foot = s * 0.26;
      const reach = s * 0.92;
      blades.forEach(([tipX, tipY], i) => {
        ctx.fillStyle = tones[i % tones.length];
        ctx.beginPath();
        ctx.moveTo(-foot * 0.5, s * 0.34);
        ctx.quadraticCurveTo(tipX * s * 0.36, tipY * s * 0.5, tipX * reach, tipY * reach);
        ctx.quadraticCurveTo(tipX * s * 0.5, tipY * s * 0.4, foot * 0.5, s * 0.34);
        ctx.closePath();
        ctx.fill();
      });
      break;
    }
    case 'plant_tree': {
      // §3.6: *"one canopy with two highlight masses"*. ONE mass, not a
      // rosette of seven: a tree read from above is a single crown, and the
      // two highlights are where the key light reaches it — upper left, the
      // one direction on this floor (`LIGHT_DIR`).
      const s = Math.max(w, h) / 2;
      local((k) => pot(k, s));
      lobe(ctx, 0, -s * 0.06, s * CANOPY_R * 1.72, PALETTE.plantLeafC);
      lobe(ctx, -s * 0.28, -s * 0.34, s * CANOPY_R * 0.82, PALETTE.plantLeafA);
      lobe(ctx, s * 0.12, -s * 0.42, s * CANOPY_R * 0.52, PALETTE.plantLeafB);
      break;
    }
    case 'planter': {
      // §3.6: *"a trough of low planting, used as a soft partition"*. It is a
      // PARTITION first — the thing that divides one lounge bay from the next
      // — so it is drawn as a run of the partition's own material with
      // planting along it, and never as a row of pots.
      unturn(ctx, prop);
      const run = Math.max(w, h);
      const across = Math.min(w, h);
      const vertical = h >= w;
      local((k) => {
        k.fillStyle = PALETTE.planterTrough;
        roundRect(k, -w / 2, -h / 2, w, h, Math.min(3, across / 2));
        k.fill();
      });
      // The trough's own rim, so the run reads as a built thing with a lip on
      // it rather than as a painted stripe.
      ctx.strokeStyle = PALETTE.planterSoil;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.45;
      roundRect(ctx, -w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1, Math.min(3, across / 2));
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = PALETTE.planterSoil;
      const inset = Math.max(0.8, across * 0.18);
      roundRect(
        ctx,
        -w / 2 + inset,
        -h / 2 + inset,
        Math.max(1, w - inset * 2),
        Math.max(1, h - inset * 2),
        1,
      );
      ctx.fill();
      // PLANTING THAT OVERLAPS ITSELF. The first cut spaced the lobes 1.6
      // across-widths apart, and at the goldens' scale a 0.9 U trough came out
      // as a vertical string of separate green beads — a bead curtain laid on
      // the floor, which is neither a partition nor a plant. The pitch is
      // under one radius now, so the masses merge into one low run and the
      // three tones read as depth in it.
      const r = across * 0.52;
      const pitch = Math.max(across * 0.62, 3);
      const span = Math.max(0, run - across * 0.9);
      const n = Math.max(1, Math.round(span / pitch));
      for (let i = 0; i <= n; i++) {
        const along = (i / n - 0.5) * span;
        lobe(ctx, vertical ? 0 : along, vertical ? along : 0, r, tones[(i * 2 + 1) % tones.length]);
      }
      break;
    }
    case 'mug': {
      // A mug is a disc with a handle, and at 0.8 U it is eleven pixels: the
      // handle is what makes it a mug rather than a coaster.
      const r = Math.min(w, h) / 2;
      local((k) => {
        k.fillStyle = PALETTE.clutterCeramic;
        k.beginPath();
        k.arc(0, 0, r * 0.82, 0, Math.PI * 2);
        k.fill();
      });
      ctx.strokeStyle = PALETTE.clutterCeramic;
      ctx.lineWidth = Math.max(1, r * 0.3);
      ctx.beginPath();
      ctx.arc(r * 0.86, 0, r * 0.34, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.fillStyle = PALETTE.inkSoft;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.46, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'notebook': {
      // An open notebook: two leaves and the spine between them, which is the
      // only thing that separates it from the in-tray at this size.
      unturn(ctx, prop);
      local((k) => {
        k.fillStyle = PALETTE.clutterPaper;
        roundRect(k, -w / 2, -h / 2, w, h, 1);
        k.fill();
      });
      ctx.strokeStyle = PALETTE.inkSoft;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(0, -h / 2 + 1);
      ctx.lineTo(0, h / 2 - 1);
      ctx.stroke();
      // Two ruled lines a side, never more: at 1.3 U a third is a grey block.
      for (const side of /** @type {const} */ ([-1, 1])) {
        for (let i = 1; i <= 2; i++) {
          const y = -h / 2 + (h * i) / 3;
          ctx.beginPath();
          ctx.moveTo(side * (w * 0.08), y);
          ctx.lineTo(side * (w * 0.42), y);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'sticky': {
      // A square of note, turned a few degrees off the desk's own axis. The
      // TURN is the whole of the silhouette: a sticky note square to the table
      // is a tile, and a tile is what the floor already has too many of.
      unturn(ctx, prop);
      ctx.rotate(0.22);
      local((k) => {
        k.fillStyle = PALETTE.clutterNote;
        roundRect(k, -w / 2, -h / 2, w, h, 1);
        k.fill();
      });
      ctx.strokeStyle = PALETTE.inkSoft;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-w * 0.28, -h * 0.1);
      ctx.lineTo(w * 0.28, -h * 0.1);
      ctx.moveTo(-w * 0.28, h * 0.18);
      ctx.lineTo(w * 0.12, h * 0.18);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'doormat': {
      // §3.3's mat, inside the reception door only. Pile rather than pattern:
      // two hairline runs across the short axis, at the weave pitch the carpet
      // already uses, so the one textile on this floor that is not a rug still
      // reads as something you wipe your feet on.
      unturn(ctx, prop);
      local((k) => {
        k.fillStyle = PALETTE.matFill;
        roundRect(k, -w / 2, -h / 2, w, h, 2);
        k.fill();
      });
      ctx.strokeStyle = PALETTE.matPile;
      ctx.lineWidth = 1;
      const step = Math.max(3, Math.min(w, h) / 5);
      for (let x = -w / 2 + step; x < w / 2 - 1; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, -h / 2 + 2);
        ctx.lineTo(x, h / 2 - 2);
        ctx.stroke();
      }
      ctx.strokeStyle = PALETTE.rugEdge;
      ctx.lineWidth = 1;
      roundRect(ctx, -w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1, 2);
      ctx.stroke();
      break;
    }
    default:
      return false;
  }
  return true;
}
