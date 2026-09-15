/**
 * THE PICTURES THE LOOK SECTION IS MADE OF — WP-88b.
 *
 * `docs/plan/11-LOOK-CONTROL-CENTRE.md` §4 asks for three kinds of picture, and
 * every one of them is painted by the **real** floor painter rather than by a
 * second renderer that draws something that looks like a floor:
 *
 *   - a **preset thumbnail**, one per card, 160 x 100 at ~7 px/U;
 *   - a **live preview**, the same fragment larger, repainted on every change;
 *   - a **swatch**, 46 x 28, one per option a painter can actually draw.
 *
 * `paintFloorMaterial` and `paintProp` are the two entry points, which is the
 * whole point: *"a swatch cannot drift from the floor it stands for"*. A second
 * painter here would be a second herringbone, and the first time one of them was
 * fixed the other would be a lie.
 *
 * ============================================================================
 * WHY A FRAGMENT AND NOT THE `three` FLOOR
 *
 * The obvious thumbnail is `bakeBackdrop(scene._plan)` scaled down, and it is
 * the wrong one twice. A bake lays its pattern in PLAN UNITS, so shrinking the
 * picture does not shrink the work: the herringbone still lays one block per
 * 1.71 U over the whole envelope whatever the thumbnail is, and six of those is
 * six full floor bakes to fill a strip 160 px wide. And a full bake is
 * 4800 x 2880 physical pixels before it is scaled, six times over, inside a
 * settings sheet.
 *
 * So a thumbnail is a **four-zone fragment** — office, corridor, project room,
 * lounge, with the two rugs, a desk and a plant on it — laid out in plan units
 * and painted by the floor's own painters at the thumbnail's own `u`. It shows
 * what a preset actually changes: the four floors, the scheme's temperature, the
 * rug tones and patterns, the furniture set's radius and frame, the plant
 * family. `LOOK_THUMB_DRAW_BUDGET` below is what holds it to that, and
 * `test/unit/look-ui.test.mjs` measures all six against it.
 * ============================================================================
 *
 * Pure: every function here takes a 2D context and numbers. No DOM at module
 * scope and none inside, so `node --test` can hand it a recorder and count what
 * it did (the technique `lighting.test.mjs` already uses on `paintProp`).
 */

import { LOOK, applyLook } from './render/look-derive.js';
import { paintFloorMaterial } from './render/backdrop-floor-look.js';
import { paintProp } from './render/backdrop.js';
import { seededRng } from './render/backdrop-paint.js';

/** The preset card's picture, in CSS pixels. §4's "~7 px/U" at this size. */
export const THUMB_W = 160;
export const THUMB_H = 100;
/** One option's chip. §4: *"every chip the same painter at 46 x 28"*. */
export const SWATCH_W = 46;
export const SWATCH_H = 28;

/** Plan units per pixel for each picture. The preview is §4's "~9 px/U". */
export const THUMB_U = 7;
export const PREVIEW_U = 9;
export const SWATCH_U = 7;

/**
 * How many context operations all six preset thumbnails together may cost.
 *
 * A ceiling, not a measurement: the six measured 6,076 operations at 160 x 100
 * when this was written, and the budget is a shade over twice that, so a painter
 * that gains a pass does not fail this on the first line. What it catches is the
 * thing it exists to catch — somebody reaching for `bakeBackdrop` and putting
 * six whole floor bakes behind a settings sheet, which is two orders of
 * magnitude over this number rather than a few per cent.
 */
export const LOOK_THUMB_DRAW_BUDGET = 13000;

/**
 * RUN `fn` WITH THE FLOOR TEMPORARILY PAINTED IN SOME OTHER LOOK.
 *
 * Every painter in `render/` reads the live `LOOK` and the live `PALETTE` — that
 * is the device WP-88a chose, and it is the right one for a floor that is baked
 * once. A swatch for an option nobody has chosen yet therefore has to BE that
 * floor for the length of one paint, and then stop being it.
 *
 * Safe because it is synchronous end to end: nothing between the two
 * `applyLook` calls yields, so no other painter can observe the borrowed look.
 * `applyLook(LOOK.look, LOOK.theme)` is an exact restore rather than an
 * approximate one — a resolved look is a pure function of those two.
 *
 * @template T
 * @param {unknown} look   the look to borrow
 * @param {unknown} theme  the theme name to borrow it on
 * @param {() => T} fn
 * @returns {T}
 */
export function withLook(look, theme, fn) {
  const wasLook = LOOK.look;
  const wasTheme = LOOK.theme;
  try {
    applyLook(look, theme);
    return fn();
  } finally {
    applyLook(wasLook, wasTheme);
  }
}

/**
 * The fragment's four zones, as fractions of the picture.
 *
 * A spine down the middle with the office on one side, a project room over a
 * lounge bay on the other: the smallest arrangement in which all four of §1.a's
 * zones touch, so all three of `ZONE_ADJACENCY`'s edges are visible in it. The
 * numbers are fractions rather than units so the same fragment serves a 46 px
 * swatch, a 160 px card and a 380 px preview.
 */
const ZONE_BOXES = Object.freeze({
  office: Object.freeze({ x: 0, y: 0, w: 0.42, h: 1 }),
  corridor: Object.freeze({ x: 0.42, y: 0, w: 0.16, h: 1 }),
  rooms: Object.freeze({ x: 0.58, y: 0, w: 0.42, h: 0.56 }),
  lounge: Object.freeze({ x: 0.58, y: 0.56, w: 0.42, h: 0.44 }),
});

/** Every zone this fragment paints, in paint order. @type {ReadonlyArray<string>} */
export const THUMB_ZONES = Object.freeze(Object.keys(ZONE_BOXES));

/**
 * Lay one zone's floor, in the material the LIVE look gives that zone.
 *
 * `seededRng(zone)` rather than a fresh source: terrazzo and cork scatter, and a
 * scattered floor that moved between two repaints of the same swatch would be a
 * picture that could never be a golden. Same rule as the bake's own
 * `seededRng(room.id)` and the same reason (`08` §1.1: no `Math.random()`).
 *
 * @param {any} ctx
 * @param {string} zone
 * @param {number} w @param {number} h  the picture, in px
 * @param {number} u  px per plan unit
 * @param {string|null} [tint]
 */
function paintZone(ctx, zone, w, h, u, tint = null) {
  const box = ZONE_BOXES[/** @type {keyof typeof ZONE_BOXES} */ (zone)];
  paintFloorMaterial(
    ctx,
    LOOK.look.floors[zone],
    Math.round(box.x * w),
    Math.round(box.y * h),
    Math.round(box.w * w),
    Math.round(box.h * h),
    seededRng(zone),
    tint,
    u,
  );
}

/**
 * One prop on the fragment, positioned in the fraction of a ZONE it sits in.
 *
 * Props are the one thing here that is sized in plan units rather than in
 * fractions, because a desk is 5.2 U wide on every floor and a desk that scaled
 * with the thumbnail would stop being a desk. If the zone is too small to hold
 * it at this `u` — which a 46 px swatch always is — nothing is drawn, and that
 * is the honest answer rather than a desk squeezed to a sliver.
 *
 * @param {any} ctx
 * @param {{kind:string, tone?:string, wU:number, hU:number, zone:string,
 *          fx:number, fy:number}} spec
 * @param {number} w @param {number} h @param {number} u
 */
function paintFragmentProp(ctx, spec, w, h, u) {
  const box = ZONE_BOXES[/** @type {keyof typeof ZONE_BOXES} */ (spec.zone)];
  const zoneW = (box.w * w) / u;
  const zoneH = (box.h * h) / u;
  if (spec.wU > zoneW || spec.hU > zoneH) return false;
  const x = (box.x * w) / u + spec.fx * (zoneW - spec.wU);
  const y = (box.y * h) / u + spec.fy * (zoneH - spec.hU);
  paintProp(ctx, { ...spec, x, y, w: spec.wU, h: spec.hU, angle: 0 }, u);
  return true;
}

/**
 * What stands on the fragment, and why each one is there.
 *
 * Five props, one per picker group a floor material cannot show by itself: the
 * two rugs are §1.d's tone and pattern, the round rug is the lounge's own, the
 * desk carries §1.c's radius and frame line, and the plant carries §1.e's
 * family silhouette. Nothing here is decoration — a prop that showed no picker
 * would be a prop the user cannot read the section from.
 */
const FRAGMENT_PROPS = Object.freeze(
  [
    { kind: 'rug', tone: 'wool', zone: 'office', wU: 7.2, hU: 5, fx: 0.5, fy: 0.24 },
    { kind: 'rug', tone: 'task', zone: 'rooms', wU: 6.4, hU: 4, fx: 0.5, fy: 0.55 },
    { kind: 'rug_round', tone: 'wool', zone: 'lounge', wU: 4.6, hU: 4.6, fx: 0.42, fy: 0.5 },
    { kind: 'desk', zone: 'office', wU: 5.2, hU: 2.6, fx: 0.5, fy: 0.82 },
    { kind: 'plant_broad', tone: 'broad', zone: 'lounge', wU: 2, hU: 2, fx: 0.94, fy: 0.08 },
  ].map((p) => Object.freeze(p)),
);

/**
 * THE FRAGMENT, in whatever look is live right now.
 *
 * Callers that want a look other than the live one wrap this in `withLook`;
 * this function itself never applies anything, so the preview — which IS the
 * live look — costs no resolve at all.
 *
 * @param {any} ctx a 2D context, or a recorder
 * @param {{w:number, h:number, u:number, props?:boolean}} opts
 */
export function paintLookFragment(ctx, opts) {
  const { w, h, u } = opts;
  for (const zone of THUMB_ZONES) paintZone(ctx, zone, w, h, u);
  if (opts.props === false) return;
  for (const spec of FRAGMENT_PROPS) paintFragmentProp(ctx, spec, w, h, u);
}

/**
 * One preset's card picture: the fragment under that preset, on this theme.
 *
 * @param {any} ctx
 * @param {{look:unknown, theme:unknown, w?:number, h?:number, u?:number}} opts
 */
export function paintLookThumbnail(ctx, opts) {
  const w = opts.w ?? THUMB_W;
  const h = opts.h ?? THUMB_H;
  withLook(opts.look, opts.theme, () => paintLookFragment(ctx, { w, h, u: opts.u ?? THUMB_U }));
}

/**
 * ONE OPTION'S CHIP.
 *
 * A swatch is the fragment's own painter over one rectangle rather than four,
 * because a chip 46 px wide has room for one material and a border. Which
 * rectangle depends on what the option IS:
 *
 *   - a FLOOR or a SCHEME chip is that material, filling the chip;
 *   - a RUG chip is the rug's own floor with the rug lying on it, because a rug
 *     tone means nothing except against the floor it has to read on — which is
 *     exactly §1.d's whole finding.
 *
 * @param {any} ctx
 * @param {{look:unknown, theme:unknown, zone:string, rug?:string|null,
 *          w?:number, h?:number, u?:number}} opts
 */
export function paintLookSwatch(ctx, opts) {
  const w = opts.w ?? SWATCH_W;
  const h = opts.h ?? SWATCH_H;
  const u = opts.u ?? SWATCH_U;
  withLook(opts.look, opts.theme, () => {
    paintFloorMaterial(ctx, LOOK.look.floors[opts.zone], 0, 0, w, h, seededRng(opts.zone), null, u);
    if (!opts.rug) return;
    // Inset by a fifth of the chip on each side, so the floor still reads
    // around it: a rug that filled its swatch would be a colour chip again.
    const wU = (w / u) * 0.62;
    const hU = (h / u) * 0.58;
    paintProp(
      ctx,
      {
        kind: 'rug',
        tone: opts.rug,
        x: (w / u - wU) / 2,
        y: (h / u - hU) / 2,
        w: wU,
        h: hU,
        angle: 0,
      },
      u,
    );
  });
}
