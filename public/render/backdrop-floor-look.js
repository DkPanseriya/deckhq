/**
 * THE FIVE FLOORS THE LOOK CENTRE ADDS — WP-88a, §1.a.
 *
 * `backdrop-floor.js` already paints four of §1.a's nine materials: the
 * herringbone, the broadloom weave, the ceramic tile and the poured screed. This
 * file is the other five — wide ash boards, terrazzo, polished concrete,
 * loop-pile tile and cork — plus `paintFloorMaterial`, the one dispatcher every
 * caller goes through, so a zone's floor is chosen in one place rather than by a
 * chain of `if`s in the bake.
 *
 * Its own module rather than more of `backdrop-floor.js` for the reason
 * `plan-shapes.js` is its own: that file is near WP-22's 900-line ceiling, and
 * five painters and a dispatcher is a vocabulary rather than more of the floor
 * it already draws.
 *
 * ## Two rules every painter here keeps
 *
 * **Every size is in PLAN UNITS**, read off `FLOOR_MATERIALS[id].pattern`, so a
 * bake at any `u` lays the same floor rather than the same bitmap — WP-85a's own
 * rule, and the difference between a material and a texture.
 *
 * **Every colour comes from the resolved look**, which is to say from the
 * theme's eleven tokens through the scheme and nothing else. No painter here
 * holds a colour. A material with a colour of its own would be a material that
 * survived a theme.
 *
 * Nothing here runs in the frame loop: the backdrop is baked once per plan
 * change and blitted (docs/02-ARCHITECTURE.md §8).
 */

import { PALETTE, washedCarpet } from './palette.js';
import { roundRect, U_DEFAULT } from './backdrop-paint.js';
import {
  paintCarpet,
  paintCirculation,
  paintHerringbone,
  paintTile,
  CARPET_WEAVE_PITCH_U,
} from './backdrop-floor.js';
import { liveMaterial } from './look-derive.js';

/**
 * A deterministic stream of numbers keyed to a position, for the two materials
 * that scatter something — terrazzo's chips and cork's grain.
 *
 * It takes the bake's own `rng` rather than seeding its own, because the room
 * already has a seed (`seededRng(room.id)`) and a second source would make the
 * same room lay two different floors depending on which painter ran first.
 * `08-PLAN-V2-100X.md`'s hard rule is stated the other way round — no
 * `Math.random()`, no `Date.now()` — and this is what keeps it.
 *
 * @param {() => number} rng
 * @param {number} lo @param {number} hi
 */
function between(rng, lo, hi) {
  return lo + (hi - lo) * rng();
}

/**
 * WIDE ASH BOARDS (§1.a). Planks 9 × 1.6 U on the long axis, ends staggered a
 * third, four tones ±0.025, seam at 0.16.
 *
 * The straight-laid companion to the herringbone, and the one floor a project
 * room may have that is not a textile. Laid along the room's LONGER axis,
 * because a plank run across a room's short side reads as decking.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {() => number} rng
 * @param {number} u
 * @param {{tones:string[], field:string, pattern:any}} material
 */
export function paintBoards(ctx, x, y, w, h, rng, u, material) {
  const { plankL, plankW, stagger, seam } = material.pattern;
  const along = w >= h;
  const L = plankL * u;
  const W = plankW * u;
  const tones = material.tones;
  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();
  ctx.fillStyle = material.field;
  ctx.fillRect(x, y, w, h);
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = seamOf(material.tones[0], seam);
  const rows = Math.ceil((along ? h : w) / W) + 1;
  for (let r = 0; r < rows; r++) {
    // A third of a plank per row, wrapping: real board ends never line up, and
    // a row offset that is a function of the row index is the same floor on
    // every bake.
    const shift = ((r * stagger) % 1) * L;
    const start = (along ? x : y) - shift - L;
    const end = (along ? x + w : y + h) + L;
    for (let p = start; p < end; p += L) {
      ctx.fillStyle = tones[Math.floor(rng() * tones.length)];
      if (along) {
        ctx.fillRect(p, y + r * W, L, W);
        ctx.strokeRect(p, y + r * W, L, W);
      } else {
        ctx.fillRect(x + r * W, p, W, L);
        ctx.strokeRect(x + r * W, p, W, L);
      }
    }
  }
  ctx.restore();
}

/**
 * TERRAZZO (§1.a). 220 seeded chips per 100 U², each 0.10–0.22 U, three chip
 * tones, **no grid** — a grid would make it tile, and terrazzo is poured.
 *
 * The chips are the one place on this floor where a speck is allowed a contrast
 * a field is not (2.0:1 rather than 1.14:1): under 0.3 U the eye integrates a
 * chip into the ground rather than reading it as a surface of its own. The
 * measurement is in `look-guards.js`, over all 162 combinations.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {() => number} rng
 * @param {number} u
 * @param {{specks:string[], field:string, pattern:any}} material
 */
export function paintTerrazzo(ctx, x, y, w, h, rng, u, material) {
  const { chipsPer100U2, chipMinU, chipMaxU } = material.pattern;
  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();
  ctx.fillStyle = material.field;
  ctx.fillRect(x, y, w, h);
  const areaU2 = (w / u) * (h / u);
  // Bounded, and the bound is the room: a 60 × 40 U lounge is 5280 chips, which
  // is the same order as the weave passes a carpet already costs. Rooms larger
  // than that are capped rather than allowed to grow the bake past its budget.
  const count = Math.min(20000, Math.round((areaU2 / 100) * chipsPer100U2));
  const chips = material.specks;
  if (!chips.length) {
    ctx.restore();
    return;
  }
  for (let i = 0; i < count; i++) {
    const cx = x + rng() * w;
    const cy = y + rng() * h;
    const r = (between(rng, chipMinU, chipMaxU) * u) / 2;
    ctx.fillStyle = chips[Math.floor(rng() * chips.length)];
    ctx.beginPath();
    // An ellipse at a quarter turn or so, because a poured chip is a broken
    // fragment and a circle reads as a dot pattern.
    ctx.ellipse(cx, cy, r, r * between(rng, 0.55, 0.95), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * POLISHED CONCRETE (§1.a). One diagonal sheen, saw-cut joints on a 12 U grid at
 * 0.10.
 *
 * The quietest floor in the catalogue and the only one offered in all four
 * zones. Its field is the screed a shade down, which is what makes it legal
 * beside a poured-screed corridor: §1 rule 3's second clause wants a hairline of
 * value between two materials off one token, and this is that hairline.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} u
 * @param {{field:string, pattern:any}} material
 */
export function paintConcrete(ctx, x, y, w, h, u, material) {
  const cell = material.pattern.jointU * u;
  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();
  ctx.fillStyle = material.field;
  ctx.fillRect(x, y, w, h);
  // One diagonal sheen across the whole slab: a polished floor catches the light
  // in a band, not in a grid, and the band is what says "polished" at fit scale.
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.45, PALETTE.circulationSheen);
  g.addColorStop(1, 'rgba(0,0,0,0.03)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = seamOf(material.field, material.pattern.joint);
  ctx.lineWidth = 0.75;
  for (let gy = Math.ceil(y / cell) * cell; gy <= y + h; gy += cell) {
    ctx.beginPath();
    ctx.moveTo(x, gy + 0.5);
    ctx.lineTo(x + w, gy + 0.5);
    ctx.stroke();
  }
  for (let gx = Math.ceil(x / cell) * cell; gx <= x + w; gx += cell) {
    ctx.beginPath();
    ctx.moveTo(gx + 0.5, y);
    ctx.lineTo(gx + 0.5, y + h);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * LOOP-PILE TILE (§1.a). The broadloom's own weave under a 6 U checker of
 * alternating pile, ±0.012.
 *
 * A carpet tile is a carpet whose pile runs a different way every square, and
 * that — not a different colour — is the whole of the difference. At ±0.012 the
 * checker is 1.02:1 between its two halves, which is under the value plateau
 * §1.a holds a field to and still visible as a laying pattern at a 2× crop.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {() => number} rng
 * @param {string|null} tint
 * @param {number} u
 * @param {{tones:string[], field:string, pattern:any}} material
 */
export function paintLoopPile(ctx, x, y, w, h, rng, tint, u, material) {
  const cell = material.pattern.checkerU * u;
  const pitch = (material.pattern.pitchU || CARPET_WEAVE_PITCH_U) * u;
  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();
  ctx.fillStyle = washedCarpet(material.field, tint);
  ctx.fillRect(x, y, w, h);
  // The checker first, so the weave passes lie ON it and the two halves read as
  // one textile laid two ways rather than as two textiles.
  const light = washedCarpet(material.tones[1] || material.field, tint);
  ctx.fillStyle = light;
  const cols = Math.ceil(w / cell) + 1;
  const rows = Math.ceil(h / cell) + 1;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if ((i + j) % 2 !== 0) continue;
      ctx.fillRect(x + i * cell, y + j * cell, cell, cell);
    }
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = PALETTE.carpetWeaveLight;
  ctx.beginPath();
  for (let gy = Math.ceil(y / pitch) * pitch; gy <= y + h; gy += pitch) {
    ctx.moveTo(x, gy + 0.5);
    ctx.lineTo(x + w, gy + 0.5);
  }
  ctx.stroke();
  ctx.strokeStyle = PALETTE.carpetWeaveDark;
  ctx.beginPath();
  for (let gx = Math.ceil(x / pitch) * pitch; gx <= x + w; gx += pitch) {
    ctx.moveTo(gx + 0.5, y);
    ctx.lineTo(gx + 0.5, y + h);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * CORK (§1.a). Flat, seeded 0.16 × 0.07 U grain flecks at 0.14.
 *
 * The one warm soft floor that is not a textile, and the reason `garden-floor`
 * can plant a project room without putting a carpet under it. The flecks are
 * short strokes rather than dots: cork grain is directional, and a dot field at
 * this density is noise.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {() => number} rng
 * @param {number} u
 * @param {{specks:string[], field:string, pattern:any}} material
 */
export function paintCork(ctx, x, y, w, h, rng, u, material) {
  const { fleckLU, fleckWU, fleck } = material.pattern;
  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();
  ctx.fillStyle = material.field;
  ctx.fillRect(x, y, w, h);
  const grain = material.specks[0];
  if (grain) {
    ctx.globalAlpha = fleck;
    ctx.fillStyle = grain;
    // One fleck per 0.5 U², bounded the same way terrazzo's chips are.
    const count = Math.min(20000, Math.round(((w / u) * (h / u)) / 0.5));
    for (let i = 0; i < count; i++) {
      const cx = x + rng() * w;
      const cy = y + rng() * h;
      const turn = rng() < 0.5;
      const l = fleckLU * u * between(rng, 0.7, 1.3);
      const t = fleckWU * u;
      ctx.fillRect(cx, cy, turn ? l : t, turn ? t : l);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/**
 * A seam or a joint, as an `rgba()` of the material's own field taken well down.
 * One expression, so nine materials cannot each decide what a dark line is.
 * @param {string} field @param {number} a
 */
function seamOf(field, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(field).trim());
  if (!m) return `rgba(99,90,78,${a})`;
  const [r, g, b] = [0, 2, 4].map((i) => Math.round(parseInt(m[1].slice(i, i + 2), 16) * 0.45));
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * PAINT ONE ZONE'S FLOOR, whatever it is made of.
 *
 * The one place a material id becomes paint. The four materials that shipped
 * before this package go to the painters that already drew them, with the same
 * arguments they already took, so the default look is byte-identical to the
 * floor these functions have always laid — which is what `goldens:check` is
 * measuring when it says 0 px.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {string} id a key of `FLOOR_MATERIALS`
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {() => number} rng
 * @param {string|null} tint the project's identity colour, or null
 * @param {number} [u]
 */
export function paintFloorMaterial(ctx, id, x, y, w, h, rng, tint = null, u = U_DEFAULT) {
  const material = liveMaterial(id);
  switch (material.painter) {
    case 'herringbone':
      return paintHerringbone(ctx, x, y, w, h, rng, u);
    case 'carpet':
      return paintCarpet(ctx, x, y, w, h, rng, tint, u);
    case 'tile':
      return paintTile(ctx, x, y, w, h, u);
    case 'screed':
      return paintCirculation(ctx, x, y, w, h);
    case 'boards':
      return paintBoards(ctx, x, y, w, h, rng, u, material);
    case 'terrazzo':
      return paintTerrazzo(ctx, x, y, w, h, rng, u, material);
    case 'concrete':
      return paintConcrete(ctx, x, y, w, h, u, material);
    case 'loop-pile':
      return paintLoopPile(ctx, x, y, w, h, rng, tint, u, material);
    case 'cork':
      return paintCork(ctx, x, y, w, h, rng, u, material);
    default:
      return paintCirculation(ctx, x, y, w, h);
  }
}
