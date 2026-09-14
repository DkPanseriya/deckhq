/**
 * Floor themes — WP-30. `docs/plan/08-PLAN-V2-100X.md` §5, `docs/plan/06` WP-30.
 *
 * A theme is a small JSON document that repaints the FLOOR and the CHROME and
 * nothing else:
 *
 *     { name, version, floor: { wood, carpet, screed, wall, plant, … },
 *                      chrome: { bg, surface, surface-2, surface-3, line,
 *                                ink, ink-2, muted } }
 *
 * ============================================================================
 * WHAT A THEME CANNOT DO, AND WHY IT CANNOT DO IT
 *
 * The seven state colours, the crimson accent and the fourteen project
 * identities are NOT themeable, and that is enforced by construction rather
 * than by a rule someone has to remember:
 *
 *   - `FLOOR_KEYS` and `CHROME_KEYS` below are the complete allowlist. There
 *     is no key that names a state, the accent, `--accent-ink`, `--focus`, or
 *     an identity colour, so no theme document can carry one. A document with
 *     any other key is REFUSED, not ignored (see `src/core/themes.mjs`).
 *   - Every value must be `#rrggbb`. No URL, no font, no gradient, no `url()`,
 *     no `expression()` — a theme is colours and a name, so it can never fetch
 *     anything (the free core makes no outbound request, ever) or change what
 *     a letterform looks like.
 *   - The material tokens a theme resolves to are pushed through
 *     `overridePalette()`, which re-runs the colour-discipline guard: no
 *     material may be, or come near, the reserved crimson.
 *   - `test/unit/state-visuals.test.mjs` re-measures every WCAG floor in this
 *     product against EVERY shipped theme. A theme that fails is rejected at
 *     load (`assertThemeContrast`), not merely reported.
 * ============================================================================
 *
 * WHY THE FLOOR KEYS ARE MATERIALS AND NOT PALETTE TOKENS
 *
 * `palette.js` has 86 material tokens; a theme names eleven. Each floor key is
 * a MATERIAL — "the wood", "the carpet" — and the derivations below fan it out
 * into the tone variations, edges and seams that make that material read as
 * itself. A theme that had to name `woodHerringboneB` would be a theme nobody
 * could write, and a theme that could name all 86 would be a second renderer.
 *
 * Pure data and pure functions. No DOM at module scope, so this file is safe
 * to import under `node --test` and from `src/core/themes.mjs`, which is where
 * the schema that validates an imported document lives.
 */

import {
  DEFAULT_PALETTE,
  FIGURE_HALO,
  ON_FLOOR_STATES,
  overridePalette,
  PROJECT_IDENTITIES,
  resetPalette,
  STATE_COLORS,
  washedCarpet,
} from './palette.js';

/** The theme every install starts on, and the one the goldens are shot in. */
export const DEFAULT_THEME_NAME = 'default';

/**
 * How close, in sRGB distance, a themed colour may come to the reserved
 * crimson. The same bar `palette.js` holds a shipped material to, and stated
 * as one number so the floor and the chrome cannot end up with two.
 */
const CRIMSON_MIN_DISTANCE = 60;

/** The document version this build writes and reads. */
export const THEME_VERSION = 1;

/**
 * Every floor material a theme may name, and what it paints. This list IS the
 * allowlist — `src/core/themes.mjs` rejects a document with any other key.
 * @type {Readonly<Record<string, string>>}
 */
export const FLOOR_KEYS = Object.freeze({
  wood: 'the herringbone planks in the office and the lounge',
  carpet: 'the woven carpet in a project room',
  screed: 'the poured circulation between rooms',
  ground: 'the ground the building stands on',
  tile: 'the kitchen tile inside the lounge',
  wall: 'full-height walls',
  partition: 'waist-height partitions',
  desk: 'desks, benches and tables',
  seat: 'chairs, sofas and the soft furniture',
  plant: 'foliage',
  ink: 'the line work: room plates, labels, the in-room "+"',
});

/**
 * Every chrome token a theme may name. These are `public/style.css`'s `:root`
 * custom properties by the same names, minus every one that carries meaning:
 * `--accent`, `--accent-ink`, `--focus`, `--line-2` and the seven
 * `--state-*` are absent and unreachable.
 * @type {ReadonlyArray<string>}
 */
export const CHROME_KEYS = Object.freeze([
  'bg',
  'surface',
  'surface-2',
  'surface-3',
  'line',
  'ink',
  'ink-2',
  'muted',
]);

// ---------------------------------------------------------------- colour maths

/** @param {string} hex @returns {[number, number, number]} */
function rgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`themes.js: ${hex} is not a #rrggbb colour`);
  return /** @type {[number, number, number]} */ (
    [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
  );
}

/** @param {number[]} c @returns {string} */
function hex(c) {
  return `#${c
    .map((n) =>
      Math.max(0, Math.min(255, Math.round(n)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/**
 * Move a colour towards white (`k > 0`) or black (`k < 0`) by a fraction of
 * the distance. Simple on purpose: the derivations below want a family that
 * reads as one material, not a perceptually uniform ramp.
 * @param {string} colour
 * @param {number} k -1..1
 */
export function shade(colour, k) {
  const c = rgb(colour);
  const target = k >= 0 ? 255 : 0;
  const t = Math.abs(k);
  return hex(c.map((n) => n + (target - n) * t));
}

/**
 * Blend two colours. Used where a derived material has to stay in the same
 * luminance band as the surface it lies ON — a rug is the case that made this
 * necessary; see `materialTokensFor`.
 * @param {string} a
 * @param {string} b
 * @param {number} t 0 is all `a`, 1 is all `b`
 */
export function mix(a, b, t) {
  const x = rgb(a);
  const y = rgb(b);
  return hex(x.map((n, i) => n + (y[i] - n) * t));
}

/** `rgba()` of a colour at an alpha, for seams, shadows and halos. */
function alpha(colour, a) {
  const [r, g, b] = rgb(colour);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * WCAG 2.x relative luminance. Duplicated from the test suite on purpose: this
 * is the copy the PRODUCT uses to decide whether a theme's line work must be
 * light or dark, and the suite's copy is the independent check on it.
 * @param {string} colour
 */
export function relativeLuminance(colour) {
  const [r, g, b] = rgb(colour).map((n) => n / 255);
  const lin = [r, g, b].map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/**
 * WCAG contrast ratio, 1:1 to 21:1.
 * @param {string} a
 * @param {string} b
 */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ------------------------------------------------------------- the derivation

/**
 * The floor grounds — the tones a room plate, an agent label or the in-room
 * "+" is ever drawn ON. `assertThemeContrast` holds the theme's ink to 4.5:1
 * against every one of them, which is the promise `palette.js`'s `plateInk`
 * comment made by hand and this makes a test.
 * @type {ReadonlyArray<string>}
 */
export const GROUND_KEYS = Object.freeze(['wood', 'carpet', 'screed', 'ground', 'tile']);

// ------------------------------------------------- the interior's own numbers
//
// WP-85a. `docs/plan/10-INTERIOR-DESIGN.md` §3.2 is the source of every number
// in this block, and each of them is quoted here rather than inlined into the
// derivation so `test/unit/interior.test.mjs` can measure the SAME constant the
// floor is painted from.

/**
 * How far a herringbone board's two extreme tones sit either side of the
 * theme's own wood (§3.2). Was `±0.09`, which measured 1.27:1 between B and C
 * on the default floor — the loudest local contrast in the product, spent on a
 * zigzag that carries no information. `±0.03` puts the whole board family
 * inside one value plateau: 1.08:1 default, 1.13:1 on both dark themes.
 */
export const BOARD_TONE_SPREAD = 0.03;

/**
 * The ceiling that spread is held to, measured over `materialTokensFor` rather
 * than promised (§5, WP-85a's first acceptance criterion). A theme whose wood
 * is so dark that `shade(±0.03)` opens further than this is refused at import.
 */
export const BOARD_MAX_INTERNAL_CONTRAST = 1.14;

/**
 * The seam between two boards, in alpha. Was 0.55 at 1.6 px — seven per cent of
 * a 22 px block in near-black. §3.2: 0.20 at 0.8 px.
 */
export const BOARD_SEAM_ALPHA = 0.2;

/**
 * The pool of light (§3.2), the one new device in this package and what turns
 * WP-72's key light into a light rather than a shadow direction: a soft radial
 * in `#FFE9C4`, baked with the backdrop, over the manager's desk, every working
 * desk and every corridor threshold.
 *
 * Warm, and the only warm light on a floor whose chrome is cold by rule
 * (DEVIATIONS §69) — which is the point: the building is the lit thing in this
 * window.
 */
export const LIGHT_POOL_COLOR = '#FFE9C4';
export const LIGHT_POOL_ALPHA_LIGHT = 0.1;
export const LIGHT_POOL_ALPHA_DARK = 0.055;

/**
 * The slate the reception's wool rug is turned toward (§3.1, owner decision 2).
 *
 * The rug still DERIVES from the carpet — that is the legibility rule the
 * `rugCream` comment below states and `assertThemeContrast` measures — and this
 * only gives it a hue of its own once it is already inside the carpet's band.
 * It is the one textile on this floor that is not a shade of the floor, and at
 * 191 from crimson on the default theme it is nowhere near the one colour that
 * means "standing in your office".
 */
const WOOL_SLATE = '#8CA2B6';

/**
 * The composite of a ground under a light pool at the pool's BRIGHTEST point —
 * the surface a room plate, a name or the in-room "+" is actually read on once
 * §3.2's pools are baked in. `assertThemeContrast` holds the ink to 4.5:1
 * against this as well as against the bare ground, because a pool that lifted a
 * dark theme's floor into its own white line work would leave every label in
 * the building unreadable with every shipped measurement green.
 *
 * @param {string} ground
 * @param {boolean} lightInk
 */
export function pooled(ground, lightInk) {
  return mix(ground, LIGHT_POOL_COLOR, lightInk ? LIGHT_POOL_ALPHA_DARK : LIGHT_POOL_ALPHA_LIGHT);
}

/**
 * Which of the two devices a theme uses, everywhere the answer is needed: light
 * line work means a dark floor. One expression, so the derivation, the halo and
 * the guards cannot each decide for themselves what "a dark theme" is.
 * @param {string} ink
 */
export function lightInkFor(ink) {
  return relativeLuminance(ink) > 0.5;
}

/**
 * THE WALL IS THE TOP OF A ROOM'S VALUE RANGE (WP-85a §1.2), BY CONSTRUCTION.
 *
 * The audit's third finding: the brightest surfaces in the product were a
 * whiteboard, a sofa and a chair, at the highest local contrast inside any
 * room — the contrast budget spent on furniture while the people it was for
 * went fourth and fifth. §2 says a floor lives in a narrow luminance band and
 * everything worth looking at lives outside it, and the wall is where that band
 * stops.
 *
 * It is enforced HERE rather than checked afterwards, and the difference
 * matters: eleven colours are chosen by a person and the rest are arithmetic, so
 * a rule that only a test knew would be a rule every new theme broke once and
 * somebody fixed by hand. A material that would climb past the wall is walked
 * back down to it — which is what makes `assertThemeContrast`'s guard a
 * tautology for any theme this derivation produced, and a real refusal for a
 * ground a theme named itself.
 *
 * @param {string} colour the material as the derivation would like it
 * @param {string} wall the theme's wall
 * @returns {string} the same material, at or under the wall
 */
function underWall(colour, wall) {
  const ceiling = relativeLuminance(wall);
  if (relativeLuminance(colour) <= ceiling) return colour;
  // Bisect on `shade` toward black. Twenty-four halvings put the answer inside
  // a sixteen-millionth of the range, which is well under one channel count, so
  // the result is the same on every machine and every run.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (relativeLuminance(shade(colour, -mid)) > ceiling) lo = mid;
    else hi = mid;
  }
  return shade(colour, -hi);
}

/**
 * The same rule for a HIGHLIGHT: the strongest `wanted` alpha of white over
 * `base` whose composite still fits under the wall. A sheen is a material's
 * brightest pixel, not a decoration on top of it, so it is held to the same
 * ceiling the material is — otherwise the gloss on a whiteboard would be
 * exactly the bright hole §1.2 found, with the board itself measuring green.
 *
 * @param {string} base the material the highlight lies on
 * @param {string} wall the theme's wall
 * @param {number} wanted the alpha the finish would like
 */
function sheenOver(base, wall, wanted) {
  const ceiling = relativeLuminance(wall);
  /** @param {number} a */
  const composite = (a) => mix(base, '#FFFFFF', a);
  if (relativeLuminance(composite(wanted)) <= ceiling) return alpha('#FFFFFF', wanted);
  let lo = 0;
  let hi = wanted;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (relativeLuminance(composite(mid)) > ceiling) hi = mid;
    else lo = mid;
  }
  // Rounded to three places so a token stays a short readable string; the
  // rounding is downward, which cannot push the composite back over.
  return alpha('#FFFFFF', Math.floor(lo * 1000) / 1000);
}

/**
 * Composite an `rgba()` token over an opaque colour — what the eye actually
 * gets where a sheen, a cushion highlight or a rug border lies on its own
 * material. Returns `base` unchanged for anything that is not an `rgba()`.
 * @param {string} base
 * @param {string} layer
 */
export function over(base, layer) {
  const m = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(
    String(layer).trim(),
  );
  if (!m) return base;
  const a = Math.min(1, Math.max(0, Number(m[4])));
  const b = rgb(base);
  return hex([0, 1, 2].map((i) => b[i] + (Number(m[i + 1]) - b[i]) * a));
}

/**
 * Every surface inside a room at its BRIGHTEST — the flat material where it has
 * no highlight, and the composite where it has one. This is the set WP-85a's
 * "no non-wall pixel inside a room is brighter than that theme's wall" is
 * measured over, stated once so `assertThemeContrast` and the test suite look
 * at the same list.
 *
 * @param {Record<string,string>} d the derived material tokens
 * @param {Record<string,string>} floor the theme's eleven
 * @returns {Record<string,string>}
 */
export function interiorHighlights(d, floor) {
  return {
    'the board, lit': over(d.woodHerringboneC, d.woodHerringboneSheen),
    'the carpet weave': over(d.carpetBase, d.carpetWeaveLight),
    'the screed sheen': over(d.circulationBase, d.circulationSheen),
    'the tile': d.tileBase,
    'the counter': d.counterTop,
    'the partition': d.partitionFill,
    'the whiteboard face': over(d.whiteboardSurface, d.whiteboardSheen),
    'a chair cushion': over(d.chairFill, d.chairCushion),
    'a sofa cushion': d.sofaCushion,
    'the fridge': d.fridgeFill,
    'the wool rug': over(d.rugCream, d.rugBorder),
    'the task rug': over(d.rugSage, d.rugBorder),
    'a desk top': d.deskTop,
    'a desk edge': over(d.deskTop, d.deskSheen),
    'a lit ground': pooled(floor.wood, lightInkFor(floor.ink)),
    'a lit screed': pooled(floor.screed, lightInkFor(floor.ink)),
  };
}

/**
 * EVERY STATE COLOUR CLEARS 3:1 AGAINST THE FIGURE HALO (WP-85a §3.9).
 *
 * `03-VISUAL-SPEC.md` §10 used to promise this against the FLOOR, which was
 * never true on any theme and cannot be: the state palette is mid-tone —
 * `benched #7B8794` and `needs_input #B87333` both near L* 53 — so a floor
 * clearing 3:1 against all of them would have to be near paper or near black.
 * The answer belongs on the character, and it is one constant: every figure on
 * this floor stands on (light themes) or inside (dark themes) `FIGURE_HALO`, so
 * the surface a state colour is read against stopped being a variable.
 *
 * That is why this takes no theme. It is asserted at import anyway, because the
 * halo and the seven state colours are both edited by hand and the promise is
 * only worth making if something re-measures it.
 */
export function assertFigureHaloContrast() {
  for (const state of ON_FLOOR_STATES) {
    const ratio = contrastRatio(STATE_COLORS[state], FIGURE_HALO);
    if (ratio + 1e-9 < 3) {
      throw new Error(
        `the figure halo (${FIGURE_HALO}) is ${ratio.toFixed(2)}:1 against ${state}, and needs ` +
          '>= 3:1. Every character on this floor is read against the halo rather than against ' +
          'the ground — docs/03-VISUAL-SPEC.md §10.',
      );
    }
  }
}

/**
 * Fan a theme's eleven materials out into the material tokens `backdrop.js`
 * and `rig.js` actually read.
 *
 * Tokens NOT derived here keep their shipped value, and that is a decision
 * rather than an omission: the monitor bezels, the hob, the arcade cabinet,
 * the billiard cloth and the departures boxes are OBJECTS, not surfaces. A
 * theme is the building's finish — floors, walls, furniture, foliage, ink —
 * and repainting the props with it would make every theme a different
 * product rather than the same office at a different hour.
 *
 * @param {{floor: Record<string, string>}} theme
 * @returns {Record<string, string>} material tokens, ready for `overridePalette`
 */
export function materialTokensFor(theme) {
  const f = theme.floor || {};
  /** @param {string} key */
  const at = (key) => f[key] || /** @type {any} */ (DEFAULT_FLOOR)[key];

  const wood = at('wood');
  const carpet = at('carpet');
  const screed = at('screed');
  const ground = at('ground');
  const tile = at('tile');
  const wall = at('wall');
  const partition = at('partition');
  const desk = at('desk');
  const seat = at('seat');
  const plant = at('plant');
  const ink = at('ink');

  // Light line work on a dark floor, or dark line work on a light one. The
  // halo behind a room plate has to go the OTHER way from the ink or the
  // letterforms vanish into it — which is exactly what a near-white halo
  // would have done to blueprint's white plate text.
  const lightInk = lightInkFor(ink);
  const haloBase = lightInk ? shade(ground, -0.55) : '#FCFAF4';

  // Everything a room is furnished in, held under the wall by `underWall`
  // (WP-85a §1.2). Named up here rather than inline because the highlights
  // below are composited ON these, and a sheen that was measured against the
  // uncapped material would put back exactly the bright hole the cap removed.
  const chairFill = underWall(seat, wall);
  const sofaCushion = underWall(shade(seat, 0.02), wall);
  const fridgeFill = underWall(shade(seat, 0.03), wall);
  const whiteboardSurface = underWall(shade(seat, 0.08), wall);
  const counterTop = underWall(mix(tile, desk, 0.22), wall);
  const rugSage = underWall(mix(carpet, plant, 0.3), wall);
  // The reception's WOOL. Slate since WP-85a (§3.1, owner decision 2) — the one
  // textile on this floor with a hue of its own, and the thing that tells you
  // the waiting area is not the corridor. It is still carried into place by the
  // carpet, so it cannot leave the floor's luminance band and a name drawn on it
  // is as readable as a name drawn on the floor; only its temperature is its own.
  const rugCream = underWall(
    mix(shade(carpet, lightInk ? 0 : -0.132), WOOL_SLATE, lightInk ? 0.15 : 0.33),
    wall,
  );

  return {
    // ---- herringbone: one plank colour, four tones, a seam and a sheen ----
    // WP-85a §3.2. The spread is `BOARD_TONE_SPREAD` rather than the ±0.09 this
    // shipped with, and the fourth tone is a third of that rather than a fifth
    // of the way to the far end, so the four boards are one material seen under
    // one light instead of four woods laid in a zigzag.
    woodHerringboneA: wood,
    woodHerringboneB: shade(wood, -BOARD_TONE_SPREAD),
    woodHerringboneC: shade(wood, BOARD_TONE_SPREAD),
    woodHerringboneD: shade(wood, -BOARD_TONE_SPREAD / 3),
    woodHerringboneSeam: alpha(shade(wood, -0.55), BOARD_SEAM_ALPHA),
    // A sheen is what says "finished timber"; at 0.10 it was also the widest
    // value step on the board, which put the loudest edge inside the quietest
    // surface. A third of it still reads as a finish at a 2x crop.
    woodHerringboneSheen: sheenOver(shade(wood, BOARD_TONE_SPREAD), wall, lightInk ? 0.035 : 0.045),

    // ---- circulation ----
    circulationBase: screed,
    circulationSpeckle: alpha(shade(screed, -0.45), 0.13),
    circulationEdge: alpha(shade(screed, -0.45), 0.2),
    circulationSheen: sheenOver(screed, wall, lightInk ? 0.12 : 0.16),

    // ---- carpet ----
    // WP-85a §3.2: a WEAVE, not salt. Two hairline passes rather than six
    // thousand single pixels — directional, low-frequency, gone at fit scale
    // and still a weave under a 2x crop. `paintCarpet` owns the pitch.
    carpetBase: carpet,
    carpetWeaveLight: alpha('#FFFFFF', 0.03),
    carpetWeaveDark: alpha(shade(carpet, -0.5), 0.09),

    // ---- kitchen tile ----
    tileBase: tile,
    tileGrout: alpha(shade(tile, -0.45), 0.16),
    // The counter is a worktop in a tiled bay, not a light source: the tile
    // carried a fifth of the way toward the building's own timber. It was
    // `shade(tile, +0.06)`, which made the brightest surface in the café the
    // one horizontal plane nobody looks at.
    counterTop,

    // ---- the ground, and the room nobody is in ----
    floorGround: ground,
    roomDimmed: lightInk ? 'rgba(0, 0, 0, 0.22)' : 'rgba(58, 48, 38, 0.10)',

    // ---- walls, partitions, doors ----
    wallFill: wall,
    wallEdge: shade(wall, -0.14),
    wallShadow: alpha(shade(wall, -0.7), 0.13),
    wallAmbientOcclusion: alpha(shade(wall, -0.75), 0.16),
    partitionFill: partition,
    partitionEdge: shade(partition, -0.14),
    doorSwingArc: alpha(ink, 0.45),

    // ---- the room slab (WP-72) ----
    // The rim comes off the WALL, the same source as `wallAmbientOcclusion`
    // above, because the two meet at every corner of every room and two
    // different darks meeting there reads as a smudge. The shadow it throws
    // comes off the SCREED it lands on, so a dark floor gets a shadow it can
    // still show rather than black on near-black.
    slabEdge: alpha(shade(wall, -0.75), 0.22),
    slabShadow: alpha(shade(screed, -0.7), 0.3),

    // ---- rugs ----
    // A rug is derived from the CARPET, not from the foliage it borrows its
    // hue from, and that is a legibility decision rather than a taste one. An
    // agent's name is drawn wherever the agent stands, which is very often on
    // a rug — so a rug that drifted out of the floor's luminance band would
    // leave a themed floor's labels unreadable while every contrast test in
    // the suite passed, because nothing measures text against a rug. Blueprint
    // did exactly that in its first capture: pale mint rugs under white names.
    // Deriving from the carpet means anything readable on the floor is
    // readable on the rug, and `assertThemeContrast` measures that.
    //
    // `rugSage` is the TASK rug in a project room and `rugCream` the reception
    // and lounge WOOL; both are derived above, where the cap can reach them.
    rugSage,
    rugCream,
    // One border token lies on both rugs, so it is sized against whichever of
    // them has the least headroom left under the wall.
    rugBorder: sheenOver(
      relativeLuminance(rugSage) > relativeLuminance(rugCream) ? rugSage : rugCream,
      wall,
      lightInk ? 0.22 : 0.36,
    ),
    rugEdge: alpha(shade(ground, -0.45), 0.28),

    // ---- plants ----
    plantLeafA: plant,
    plantLeafB: shade(plant, 0.14),
    plantLeafC: shade(plant, -0.14),
    plantPot: shade(seat, -0.1),

    // ---- desks, benches, tables ----
    deskTop: desk,
    deskEdge: shade(desk, -0.16),
    // §3.4: "every table shows its edge" — a darker band on the light-away
    // side and a sheen on the lit one. Held under the wall like every other
    // highlight, which the near-white divider it replaces was not.
    deskSheen: sheenOver(desk, wall, lightInk ? 0.1 : 0.16),
    tableWood: wood,

    // ---- chairs and sofas ----
    chairFill,
    chairEdge: shade(seat, -0.12),
    chairBackrest: shade(seat, -0.07),
    chairCushion: sheenOver(chairFill, wall, lightInk ? 0.14 : 0.24),
    sofaFill: shade(seat, -0.03),
    // §3.4's silhouette rule, as far as a TOKEN can carry it: the frame band is
    // a real step below the cushion it holds, so a sofa run reads as a piece of
    // furniture with a back rather than as a row of near-white boxes.
    sofaFrame: shade(seat, -0.24),
    sofaCushion,
    sofaSeam: alpha(shade(seat, -0.5), 0.35),
    fridgeFill,
    whiteboardSurface,
    whiteboardSheen: sheenOver(whiteboardSurface, wall, lightInk ? 0.18 : 0.22),

    // ---- the line work ----
    inkWarm: ink,
    inkCool: shade(ink, lightInk ? -0.08 : 0.08),
    inkSoft: lightInk ? shade(ink, -0.32) : shade(ink, 0.32),
    plateHalo: alpha(haloBase, 0.92),
    plateInk: ink,
    plateInkSecondary: lightInk ? shade(ink, -0.12) : shade(ink, 0.12),
    plusRest: alpha(ink, 0.55),
    plusHover: ink,
    plusHoverHalo: alpha(ink, lightInk ? 0.16 : 0.1),

    // ---- the pool of light (WP-85a §3.2) ----
    // One token, two alphas: a dark theme's floor has much less headroom above
    // it, so the same pool at the light theme's strength would wash a night
    // corridor out to the colour of its own line work.
    lightPool: alpha(LIGHT_POOL_COLOR, lightInk ? LIGHT_POOL_ALPHA_DARK : LIGHT_POOL_ALPHA_LIGHT),
  };
}

// ------------------------------------------------------------- shipped themes

/**
 * The default floor and chrome, stated as a theme document so the picker can
 * show it, `deckhq layout export` can name it, and a round trip through the
 * schema proves the schema can express what ships.
 *
 * These values are QUOTED from `palette.js` and `style.css`, and applying this
 * theme does not run the derivation above — see `applyTheme`, which restores
 * the shipped materials rather than re-deriving them.
 *
 * WP-85a CLOSED THE GAP THAT USED TO SIT HERE. Until this package the default
 * herringbone's four tones were hand-tuned and no single-colour derivation
 * reproduced them, so "the default floor" and "the derivation" were two
 * different statements of the same floor that were allowed to disagree. §3.1
 * says three themes are one system, so they are: `DEFAULT_PALETTE` now holds
 * exactly `materialTokensFor(THEMES[0])`, byte for byte, and the guard at the
 * bottom of this file proves it for EVERY derived token rather than for the
 * eleven anchors. The reset stays because it is faster and because it puts the
 * props a theme does not touch back as well.
 */
const DEFAULT_FLOOR = Object.freeze({
  wood: '#DCC9AE',
  carpet: '#E7E2D7',
  screed: '#D2CDC1',
  ground: '#DFDAD0',
  tile: '#E3DFD6',
  wall: '#F4F1EA',
  partition: '#E0DACD',
  desk: '#C8AC84',
  seat: '#DCD5C6',
  plant: '#6C8F63',
  ink: '#32281D',
});

const DEFAULT_CHROME = Object.freeze({
  bg: '#131419',
  surface: '#1a1c23',
  'surface-2': '#23262f',
  'surface-3': '#2d313c',
  line: '#333846',
  ink: '#eceef3',
  'ink-2': '#b8bdc9',
  muted: '#8a92a3',
});

/**
 * The themes this build ships. Two beside the default, both free and neither
 * gated — the Supporter pack (`docs/plan/03-BUSINESS-MODEL.md` §5) sells MORE
 * themes later and gates nothing here.
 *
 * @type {ReadonlyArray<{name:string, version:number, blurb:string,
 *   floor:Record<string,string>, chrome:Record<string,string>}>}
 */
export const THEMES = Object.freeze(
  [
    {
      name: DEFAULT_THEME_NAME,
      version: THEME_VERSION,
      blurb: 'Warm wood on a cold studio ground. The floor as it ships.',
      floor: { ...DEFAULT_FLOOR },
      chrome: { ...DEFAULT_CHROME },
    },
    {
      name: 'night shift',
      version: THEME_VERSION,
      blurb: 'The same office after hours: cooler, dimmer, lights low.',
      floor: {
        // WP-85a §3.1. The wood goes UNDER the carpet rather than over it: on a
        // dark theme the boards are the thing a working desk's pool of light is
        // read against, and a floor that started brighter than the room it runs
        // into had the value hierarchy the same way round as the day theme's.
        wood: '#40454D',
        carpet: '#31353D',
        screed: '#2A2E35',
        ground: '#22262D',
        tile: '#373C44',
        wall: '#4E545D',
        partition: '#3C414A',
        desk: '#4A4F58',
        // Measured, not chosen: at `#666C75` this theme's own ink was 4.43:1
        // on a chair, and an agent's name is drawn where the agent sits.
        // `assertThemeContrast` refused it at import.
        seat: '#4F555F',
        plant: '#6E9E86',
        ink: '#E8EBF1',
      },
      chrome: {
        bg: '#0e0f13',
        surface: '#15161b',
        'surface-2': '#1d1f26',
        'surface-3': '#262932',
        line: '#2e323d',
        ink: '#e9ebf1',
        'ink-2': '#b4bac7',
        muted: '#8a92a3',
      },
    },
    {
      name: 'blueprint',
      version: THEME_VERSION,
      blurb: 'The floor as a drawing: drafting-table blue, white line work.',
      floor: {
        wood: '#1C3D5F',
        carpet: '#173553',
        screed: '#132C47',
        ground: '#112941',
        tile: '#20466C',
        wall: '#2C5885',
        partition: '#1F4265',
        desk: '#245079',
        seat: '#2A5580',
        plant: '#7FB8A2',
        ink: '#F2F6FB',
      },
      chrome: {
        bg: '#0a1421',
        surface: '#101e2e',
        'surface-2': '#182a40',
        'surface-3': '#21374f',
        line: '#2c4763',
        ink: '#eef3fa',
        'ink-2': '#b6c4d6',
        muted: '#8fa0b8',
      },
    },
  ].map((t) =>
    Object.freeze({ ...t, floor: Object.freeze(t.floor), chrome: Object.freeze(t.chrome) }),
  ),
);

/** Every shipped theme's name, in picker order. @type {ReadonlyArray<string>} */
export const THEME_NAMES = Object.freeze(THEMES.map((t) => t.name));

// ------------------------------------------------------- themes from a pack

/**
 * Themes that arrived from an installed asset pack (WP-45).
 *
 * A separate list rather than an append to `THEMES`, and that is the whole
 * safety property of this seam: `THEMES` stays frozen, stays the shipped
 * table, and stays what the goldens and `state-visuals.test.mjs` measure. A
 * pack adds rows to a SECOND list that is empty on every install that has not
 * bought one, and `clearPackThemes()` puts the product back exactly where it
 * was — which is what makes "run the acceptance surface with and without the
 * pack and diff" a thing a test can do in one process.
 *
 * @type {Array<{name:string, version:number, blurb?:string,
 *   floor:Record<string,string>, chrome:Record<string,string>, pack:string}>}
 */
const PACK_THEMES = [];

/**
 * Add an installed pack's themes to the picker.
 *
 * Every document is held to `assertThemeContrast` HERE as well as in
 * `src/core/packs.mjs`, because this is the last line before a theme can be
 * painted and the renderer is the half that is loaded in a browser. A theme
 * that fails is refused with its reason and the others are still added —
 * `docs/DEVIATIONS.md` §125.9's open door, opened exactly this far.
 *
 * A pack may not shadow a shipped theme, or one another pack already
 * registered: `settings.theme` stores a NAME, so two rows with one name would
 * make which floor you got a function of load order.
 *
 * @param {string} packName
 * @param {ReadonlyArray<any>} themes
 * @returns {{added:string[], rejected:string[]}}
 */
export function registerPackThemes(packName, themes) {
  /** @type {string[]} */
  const added = [];
  /** @type {string[]} */
  const rejected = [];
  for (const theme of themes || []) {
    const name = String(theme?.name ?? '')
      .trim()
      .toLowerCase();
    if (!name) {
      rejected.push('a theme with no name');
      continue;
    }
    if (THEME_NAMES.includes(name)) {
      rejected.push(`"${name}" is a theme this build ships`);
      continue;
    }
    if (PACK_THEMES.some((t) => t.name === name)) {
      rejected.push(`"${name}" is already registered by another pack`);
      continue;
    }
    try {
      assertThemeContrast(theme);
    } catch (err) {
      rejected.push(`"${name}": ${(err && /** @type {any} */ (err).message) || err}`);
      continue;
    }
    PACK_THEMES.push({ ...theme, name, pack: String(packName || '') });
    added.push(name);
  }
  return { added, rejected };
}

/** Forget every pack theme. For the daemon's reload, and for tests. */
export function clearPackThemes() {
  PACK_THEMES.length = 0;
}

/**
 * Every theme the picker may offer: what ships, then what a pack brought.
 * Shipped first, always, so the default floor is the first row on every
 * install whether or not anybody has bought anything.
 * @returns {Array<any>}
 */
export function allThemes() {
  return [...THEMES, ...PACK_THEMES];
}

/** Every offerable theme's name. @returns {string[]} */
export function themeNames() {
  return allThemes().map((t) => t.name);
}

/**
 * A theme by name, or `null`. Case- and space-insensitive on the way in,
 * because `night shift`, `Night Shift` and `night-shift` are the same request
 * and only one of them is what the picker wrote.
 *
 * Shipped themes are searched first: a pack cannot get in front of one even
 * if registration were ever to let it in.
 * @param {unknown} name
 */
export function themeByName(name) {
  const key = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');
  return THEMES.find((t) => t.name === key) || PACK_THEMES.find((t) => t.name === key) || null;
}

// --------------------------------------------------------------- the contract

/**
 * The WCAG floors every theme has to clear, measured rather than promised.
 * Throws with the failing pair named, which is what "rejected at load" means.
 *
 * The thresholds are the ones `test/unit/state-visuals.test.mjs` already held
 * the default chrome to. They are re-stated here because the TEST proves the
 * shipped themes and this proves an imported one, and a theme document that
 * reached the floor unmeasured would be the one way this feature could break
 * the product's accessibility promise.
 *
 * `--accent`, `--accent-ink` and `--focus` are not themeable, so their
 * literals are the only fixed colours in this function.
 *
 * @param {{name?:string, floor:Record<string,string>, chrome:Record<string,string>}} theme
 */
export function assertThemeContrast(theme) {
  const where = theme.name ? `theme "${theme.name}"` : 'theme';
  const chrome = { ...DEFAULT_CHROME, ...(theme.chrome || {}) };
  const floor = { ...DEFAULT_FLOOR, ...(theme.floor || {}) };
  /** @param {number} ratio @param {number} floorRatio @param {string} what */
  const need = (ratio, floorRatio, what) => {
    if (ratio + 1e-9 < floorRatio) {
      throw new Error(
        `${where}: ${what} is ${ratio.toFixed(2)}:1, and needs >= ${floorRatio}:1. ` +
          'The ground moves, never a state colour — docs/03-VISUAL-SPEC.md §5.',
      );
    }
  };

  for (const ground of ['bg', 'surface']) {
    for (const [state, colour] of Object.entries(STATE_COLORS)) {
      need(contrastRatio(colour, chrome[ground]), 3, `${state} on --${ground}`);
    }
    for (const ink of ['ink', 'ink-2']) {
      need(contrastRatio(chrome[ink], chrome[ground]), 4.5, `--${ink} on --${ground}`);
    }
  }
  for (const ground of ['bg', 'surface', 'surface-2']) {
    need(contrastRatio(chrome.muted, chrome[ground]), 4.5, `--muted on --${ground}`);
  }
  // --focus is fixed, but the grounds it lands on are not.
  for (const ground of ['bg', 'surface', 'surface-2', 'surface-3']) {
    need(contrastRatio('#eceef3', chrome[ground]), 3, `--focus on --${ground}`);
  }
  // The line work, on every ground the floor draws it on.
  for (const key of GROUND_KEYS) {
    need(contrastRatio(floor.ink, floor[key]), 4.5, `floor ink on the ${key}`);
    // AND ON THAT GROUND UNDER A POOL OF LIGHT, AT ITS BRIGHTEST POINT (WP-85a).
    //
    // §3.2's pools are baked into the backdrop over the manager's desk, every
    // working desk and every corridor threshold — which is to say, over exactly
    // the places a room plate and a name are drawn. A pool is a lightening, so
    // on a dark theme it eats into the headroom the theme's white line work
    // needs, and measuring the bare ground alone would measure the one part of
    // the floor the label is NOT on.
    need(
      contrastRatio(floor.ink, pooled(floor[key], lightInkFor(floor.ink))),
      4.5,
      `floor ink on the ${key} under a pool of light`,
    );
  }
  // AND ON THE CARPET A PROJECT ROOM IS ACTUALLY PAINTED IN (WP-72).
  //
  // The carpet token is not the surface: a project room's carpet is washed six
  // per cent toward that project's identity colour, and the room plate, the
  // agents' names and the in-room "+" are all read on the WASH. Fourteen
  // identities means fourteen grounds per theme that `floor.carpet` alone
  // cannot speak for, and eyeballing one screenshot per theme would have
  // measured three of the forty-two.
  for (const identity of PROJECT_IDENTITIES) {
    const washed = washedCarpet(floor.carpet, identity.accent);
    need(
      contrastRatio(floor.ink, washed),
      4.5,
      `floor ink on the carpet washed toward ${identity.accent} (${washed})`,
    );
  }
  // And on the derived surfaces a LABEL can land on. An agent's name is drawn
  // where the agent stands, which is very often on a rug, a desk or a seat —
  // surfaces a theme does not name and therefore could not otherwise be held
  // to. Blueprint's first capture is the reason this exists: pale mint rugs
  // under white names, with every other measurement in this file green.
  //
  // For the default theme the derivation below is not what ships (that theme
  // is applied as a reset — see `DEFAULT_FLOOR`), so this is a check on the
  // derivation rather than on the shipped floor. It costs nothing and a
  // default that could not survive its own derivation would say the
  // derivation was wrong.
  const derived = materialTokensFor({ floor });
  for (const key of ['rugSage', 'rugCream', 'deskTop', 'chairFill', 'sofaFill']) {
    need(contrastRatio(floor.ink, derived[key]), 4.5, `floor ink on the derived ${key}`);
  }

  // THE BOARD STAYS INSIDE ONE VALUE PLATEAU (WP-85a §3.2).
  //
  // A herringbone is the largest surface in this building and it carries no
  // information; §2's first principle is that the ground is quiet so the
  // objects can speak. The spread is a constant, so this is really a check on
  // the THEME: a wood dark enough that `shade(±0.03)` opens further than the
  // ceiling would put the loudest edge in the product back inside its quietest
  // surface, and it is refused rather than shipped.
  const boardSpread = contrastRatio(derived.woodHerringboneB, derived.woodHerringboneC);
  if (boardSpread > BOARD_MAX_INTERNAL_CONTRAST + 1e-9) {
    throw new Error(
      `${where}: the herringbone's internal contrast is ${boardSpread.toFixed(2)}:1, over the ` +
        `${BOARD_MAX_INTERNAL_CONTRAST}:1 ceiling. A floor lives in a narrow luminance band and ` +
        'everything worth looking at lives outside it — docs/plan/10-INTERIOR-DESIGN.md §3.2.',
    );
  }

  // NOTHING INSIDE A ROOM IS BRIGHTER THAN THE WALL AROUND IT (WP-85a §5).
  //
  // The audit's third finding, as a property rather than as a screenshot: the
  // brightest surfaces in the product were a whiteboard, a sofa and a chair, at
  // the highest local contrast inside any room. The wall is the lit edge of the
  // building and the top of the interior's value range; a material that climbs
  // past it has taken the eye off the people. Composites are measured too — a
  // sheen is a material's brightest pixel, not a decoration on top of it.
  const wallLuminance = relativeLuminance(floor.wall);
  for (const [name, colour] of Object.entries(interiorHighlights(derived, floor))) {
    if (relativeLuminance(colour) > wallLuminance + 1e-9) {
      throw new Error(
        `${where}: ${name} (${colour}) is brighter than the wall (${floor.wall}). The wall is the ` +
          'top of a room’s value range and the people are the loud thing in it — ' +
          'docs/plan/10-INTERIOR-DESIGN.md §1.2.',
      );
    }
  }
  // COLOUR DISCIPLINE. Crimson means "standing in your office" and a theme may
  // not spend it, in either table — not the literal, and not a near-miss.
  // `palette.js`'s `assertMaterialDiscipline` catches this again when the
  // materials are applied; it is checked HERE too because a theme's chrome
  // never passes through that function, and a surface that read as red would
  // be the same failure one layer out.
  const crimson = rgb(STATE_COLORS.for_review);
  // The washed carpets are held to the same bar and named the same way. A
  // theme is free to choose a carpet; it is not free to choose one that,
  // washed toward an identity it cannot see, arrives at the accent.
  /** @type {Array<[string, Record<string,string>]>} */
  const tables = [
    ['floor', floor],
    ['chrome', chrome],
    [
      'washed carpet',
      Object.fromEntries(
        PROJECT_IDENTITIES.map((identity) => [
          identity.accent,
          washedCarpet(floor.carpet, identity.accent),
        ]),
      ),
    ],
  ];
  for (const [table, tokens] of tables) {
    for (const [key, colour] of Object.entries(tokens)) {
      const c = rgb(colour);
      const d = Math.hypot(c[0] - crimson[0], c[1] - crimson[1], c[2] - crimson[2]);
      if (d < CRIMSON_MIN_DISTANCE) {
        throw new Error(
          `${where}: ${table}.${key} (${colour}) is ${d.toFixed(1)} from the reserved crimson ` +
            `(${STATE_COLORS.for_review}). Nothing decorative may approach the one colour that ` +
            'means "standing in your office" — docs/03-VISUAL-SPEC.md §5.',
        );
      }
    }
  }

  // The chrome ground is cold on purpose (docs/DEVIATIONS.md §69). A theme may
  // choose its temperature, but it may not go warm: the floor is the lit
  // thing in this window and a warm studio competes with it.
  for (const key of CHROME_KEYS) {
    if (key === 'ink' || key === 'ink-2') continue;
    const [r, , b] = rgb(chrome[key]);
    if (b <= r) {
      throw new Error(
        `${where}: --${key} (${chrome[key]}) is warm (r=${r} >= b=${b}). The chrome ` +
          'neutrals carry a cool bias so the floor reads as lit — docs/DEVIATIONS.md §69.',
      );
    }
  }
}

// ------------------------------------------------------------------- applying

/**
 * Repaint the floor's materials for a theme. Pure with respect to the DOM —
 * it mutates `PALETTE` and nothing else, so a caller decides when to re-bake.
 *
 * The default theme is applied as a RESET rather than through the derivation:
 * see `DEFAULT_FLOOR`.
 *
 * @param {unknown} name a shipped theme's name; anything else is the default
 * @returns {string} the theme name that was actually applied
 */
export function applyFloorTheme(name) {
  const theme = themeByName(name);
  if (!theme || theme.name === DEFAULT_THEME_NAME) {
    resetPalette();
    return DEFAULT_THEME_NAME;
  }
  assertThemeContrast(theme);
  overridePalette(materialTokensFor(theme));
  return theme.name;
}

/**
 * Repaint the chrome. Writes the theme's tokens as inline custom properties on
 * the root element, which beat the stylesheet's `:root` block without editing
 * it — so `public/style.css` stays the one readable statement of the default,
 * and `test/unit/state-visuals.test.mjs` can go on reading its literals.
 *
 * The default theme REMOVES the properties rather than setting them to the
 * same values, so an untouched install has an untouched `style` attribute and
 * the goldens see the stylesheet exactly as they always have.
 *
 * @param {unknown} name
 * @param {{style?: {setProperty:Function, removeProperty:Function}, dataset?: any}} root
 * @returns {string} the theme name that was actually applied
 */
export function applyChromeTheme(name, root) {
  const theme = themeByName(name);
  const applied = theme ? theme.name : DEFAULT_THEME_NAME;
  if (!root || !root.style) return applied;
  const isDefault = applied === DEFAULT_THEME_NAME;
  if (!isDefault) assertThemeContrast(/** @type {any} */ (theme));
  for (const key of CHROME_KEYS) {
    if (isDefault) root.style.removeProperty(`--${key}`);
    else root.style.setProperty(`--${key}`, /** @type {any} */ (theme).chrome[key]);
  }
  if (root.dataset) {
    if (isDefault) delete root.dataset.theme;
    else root.dataset.theme = applied;
  }
  return applied;
}

/**
 * Both halves at once, for the client. Returns the applied name so a caller
 * can tell whether the theme it asked for was the one it got.
 * @param {unknown} name
 * @param {any} [root] `document.documentElement`, or nothing in a test
 */
export function applyTheme(name, root) {
  const applied = applyFloorTheme(name);
  if (root) applyChromeTheme(applied, root);
  return applied;
}

/**
 * Three colours that stand for a theme in a picker: the ground it is mostly
 * made of, the carpet, and the chrome behind the window. Enough to tell two
 * themes apart at 14 px, which is all a swatch has to do.
 * @param {{floor:Record<string,string>, chrome:Record<string,string>}} theme
 * @returns {string[]}
 */
export function swatchesFor(theme) {
  const floor = { ...DEFAULT_FLOOR, ...(theme.floor || {}) };
  const chrome = { ...DEFAULT_CHROME, ...(theme.chrome || {}) };
  return [floor.wood, floor.carpet, chrome.surface];
}

// Every shipped theme is measured at import time. A theme that cannot clear
// the floors this product promises must not be reachable from the picker, and
// finding that out at start-up beats finding it out in a screenshot.
for (const theme of THEMES) assertThemeContrast(theme);

// And the halo, once, for the whole product.
assertFigureHaloContrast();

// THREE THEMES, ONE SYSTEM (WP-85a §3.10).
//
// The default theme is applied as a reset rather than through the derivation,
// so "what ships" and "what the derivation says" are two statements of one
// floor. Before this package they were allowed to disagree — the herringbone's
// four tones were hand-tuned — and the eleven-anchor check below was the whole
// of what held them together, which left every derived tone, seam, sheen, rug
// and halo free to drift. Now EVERY derived token is compared, so the default
// floor cannot stop being the default theme's own derivation, and a change to
// the derivation that somebody forgets to carry into `palette.js` fails at
// import rather than in a screenshot.
for (const [token, derived] of Object.entries(materialTokensFor(THEMES[0]))) {
  const shipped = DEFAULT_PALETTE[token];
  if (String(shipped).toLowerCase() !== String(derived).toLowerCase()) {
    throw new Error(
      `themes.js: PALETTE.${token} (${shipped}) is not what the default theme derives ` +
        `(${derived}). The floor that ships and the default theme must be one floor — ` +
        'docs/plan/10-INTERIOR-DESIGN.md §3.10.',
    );
  }
}
