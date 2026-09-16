/**
 * The DERIVATION: the colour maths, the interior’s own numbers, and the fan-out
 * from eleven material anchors to the eighty-six tokens the floor is painted
 * with.
 *
 * Split out of `public/render/themes.js` by WP-92n
 * (`docs/plan/13-ARCHITECTURE-AUDIT.md` A-12, `docs/DEVIATIONS.md` §183).
 * Every declaration below is the one that was there, moved whole, with doc
 * comments attached; the only edit inside one is the `export` keyword on
 * `rgb`'s first line, because the contract in `themes.js` measures with it.
 *
 * WHY THE FAN-OUT EXISTS: `palette.js` has 86 material tokens and a theme names
 * eleven. Each floor key is a MATERIAL — "the wood", "the carpet" — and the
 * derivations here open it into the tone variations, edges and seams that make
 * that material read as itself. A theme that had to name `woodHerringboneB`
 * would be a theme nobody could write.
 *
 * Pure functions. No DOM at module scope.
 */

import { FIGURE_HALO, ON_FLOOR_STATES, STATE_COLORS } from './palette.js';
import { DEFAULT_FLOOR } from './themes-tables.js';

// ---------------------------------------------------------------- colour maths

/** @param {string} hex @returns {[number, number, number]} */
export function rgb(hex) {
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
 * THE RUG BAND (WP-88a, `docs/plan/11-LOOK-CONTROL-CENTRE.md` §1.d).
 *
 * A rug must read against the floor under it and stay inside that floor's value
 * plateau, because an agent's name is drawn wherever the agent stands and that
 * is very often a rug. Outside `[RUG_BAND_MIN, RUG_BAND_MAX]` a rug is either
 * invisible or the loudest local contrast in the room, and both are failures a
 * contrast test that only looks at ink would never see.
 *
 * `validateLook` REFUSES outside the band. The derivation below aims at the
 * narrower `[RUG_READS_MIN, RUG_READS_MAX]`, so a rug this file walks back
 * lands with margin rather than on the edge of a refusal.
 */
export const RUG_BAND_MIN = 1.06;
export const RUG_BAND_MAX = 1.45;
export const RUG_READS_MIN = 1.16;
export const RUG_READS_MAX = 1.43;

/**
 * THE TWO RUGS ARE A BISECTION ON THE RATIO, NOT A CONSTANT (WP-88a).
 *
 * §1.d measured the shipped floor and found two real failures, both from the
 * same cause: each rug derived through a CONSTANT — a mix weight toward the
 * foliage for the task rug, a shade of the carpet for the wool — while the gap
 * between the carpet and the floor the rug lies on is not constant across
 * themes. The wool rug came out at 1.00:1 on night shift (a rug you cannot see)
 * and the task rug at 1.69:1 on blueprint (the loudest thing in a project room).
 *
 * So the constant becomes a STARTING POINT and the ratio becomes the thing that
 * is solved for. A parameter whose rug already reads is returned untouched —
 * which is what keeps the default floor byte-identical and every golden still —
 * and one whose rug does not is walked to the nearest parameter that lands on
 * the reads band's edge, by bisection, the device `underWall` already uses.
 *
 * The ratio is V-shaped in the parameter (it has a minimum where the rug and the
 * floor share a luminance), so the crossing is found by a coarse scan outward
 * from `wanted` in both directions, nearest crossing wins, and the bisection
 * then runs inside that one monotone segment. Twenty-four halvings put the
 * answer well inside one channel count, so every machine gets the same rug.
 *
 * @param {(p:number) => string} make the rug, at a parameter
 * @param {number} wanted the shipped constant
 * @param {number} lo @param {number} hi the parameter's range
 * @param {string} ground the floor this rug lies on
 * @returns {number} the parameter to derive the rug at
 */
export function rugParameterFor(make, wanted, lo, hi, ground) {
  /** @param {number} p */
  const at = (p) => contrastRatio(make(p), ground);
  const now = at(wanted);
  if (now >= RUG_READS_MIN - 1e-9 && now <= RUG_READS_MAX + 1e-9) return wanted;
  const target = now < RUG_READS_MIN ? RUG_READS_MIN : RUG_READS_MAX;
  /** @param {number} r */
  const reached = (r) => (now < RUG_READS_MIN ? r >= target - 1e-9 : r <= target + 1e-9);
  /** @type {number|null} */
  let best = null;
  for (const end of [hi, lo]) {
    // A fixed 0.002 scan: fine enough that no crossing between a rug that reads
    // and one that does not is stepped over, coarse enough to cost nothing.
    const steps = Math.max(1, Math.ceil(Math.abs(end - wanted) / 0.002));
    /** @type {number|null} */
    let cross = null;
    for (let i = 1; i <= steps; i++) {
      const p = wanted + ((end - wanted) * i) / steps;
      if (reached(at(p))) {
        cross = p;
        break;
      }
    }
    if (cross === null) continue;
    let a = wanted;
    let b = cross;
    for (let i = 0; i < 24; i++) {
      const mid = (a + b) / 2;
      if (reached(at(mid))) b = mid;
      else a = mid;
    }
    if (best === null || Math.abs(b - wanted) < Math.abs(best - wanted)) best = b;
  }
  // No parameter in range brings this rug into the band. The derivation does
  // not clamp and does not throw: it returns what was asked for, and
  // `validateLook` refuses the combination with the measured ratio in its own
  // row — a refusal says why, a clamp says nothing.
  return best === null ? wanted : best;
}

/**
 * The three rug tones §1.d offers, as derivations rather than as colours.
 *
 * `wool` is WP-85a's slate, `sage` the task rug carried by the room's own
 * carpet, and `sand` the carpet walked toward the building's timber. Each takes
 * ONE parameter — the thing the bisection above solves for — so a tone is a
 * family with a dial rather than a swatch.
 *
 * @type {Readonly<Record<string, {wanted:(lightInk:boolean)=>number, lo:number, hi:number,
 *   make:(p:number, c:{carpet:string, wood:string, plant:string, lightInk:boolean})=>string}>>}
 */
export const RUG_TONES = Object.freeze({
  wool: Object.freeze({
    wanted: (lightInk) => (lightInk ? 0 : -0.132),
    lo: -0.6,
    hi: 0.6,
    make: (p, c) => mix(shade(c.carpet, p), WOOL_SLATE, c.lightInk ? 0.15 : 0.33),
  }),
  sage: Object.freeze({
    wanted: () => 0.3,
    lo: 0,
    hi: 0.6,
    make: (p, c) => mix(c.carpet, c.plant, p),
  }),
  sand: Object.freeze({
    wanted: () => 0.45,
    lo: 0,
    hi: 0.8,
    make: (p, c) => mix(c.carpet, c.wood, p),
  }),
});

/** Every rug tone's id, in picker order. @type {ReadonlyArray<string>} */
export const RUG_TONE_IDS = Object.freeze(Object.keys(RUG_TONES));

/**
 * The two rug ROLES, and the floor key each lies on. `validateLook` measures
 * the same pair the derivation solves for, so a rug the guard passes is the rug
 * the bake puts down.
 */
export const RUG_GROUNDS = Object.freeze({ wool: 'wood', task: 'carpet' });

/** The pair this floor has always shipped: the slate wool and the sage task rug. */
export const DEFAULT_RUG_TONES = Object.freeze({ wool: 'wool', task: 'sage' });

/**
 * One rug, derived: the tone's own family, at the parameter that makes it read
 * against the floor it lies on, held under the wall like every other material.
 *
 * @param {string} tone a key of `RUG_TONES`
 * @param {string} ground the floor this rug lies on
 * @param {{carpet:string, wood:string, plant:string, wall:string, lightInk:boolean}} c
 * @returns {string}
 */
export function rugToneFor(tone, ground, c) {
  const spec = RUG_TONES[tone] || RUG_TONES.wool;
  /** @param {number} p */
  const make = (p) => underWall(spec.make(p, c), c.wall);
  return make(rugParameterFor(make, spec.wanted(c.lightInk), spec.lo, spec.hi, ground));
}

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
 * The opaque colour a room plate's letters are actually read against (WP-81).
 *
 * Not the floor: `_drawRoomPlate` strokes `plateHalo` behind every glyph at
 * 0.92 alpha, so the surface under the ink is the halo composited over the lit
 * ground. Stated once, here, so the guard below and `interior.test.mjs` measure
 * the same pixel the renderer paints.
 *
 * @param {Record<string,string>} floor a theme's eleven floor keys
 * @param {string} ground the ground the room stands on
 */
export function plateGroundOver(floor, ground) {
  const lightInk = lightInkFor(floor.ink);
  const haloBase = lightInk ? shade(floor.ground, -0.55) : floor.wall;
  return mix(pooled(ground, lightInk), haloBase, PLATE_HALO_ALPHA);
}

/** How opaque the halo behind a plate's letterforms is. */
export const PLATE_HALO_ALPHA = 0.92;

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
export function underWall(colour, wall) {
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
 * WP-88a added the second parameter, and it is the seam the Look centre paints
 * through: `rugs` names which of `RUG_TONES` each of the two rug ROLES is cut
 * from, and `rugGrounds` names the floor each one is cut AGAINST. Both default
 * to what this floor has always had — the reception's slate wool on the boards,
 * the project room's sage task rug on the carpet — so every caller that does not
 * know the Look centre exists gets exactly the floor it got before. A look that
 * put polished concrete in the project rooms passes the concrete's own field
 * here, because the rug has to read against the floor it is actually on.
 *
 * @param {{floor: Record<string, string>}} theme
 * @param {{rugs?: {wool?: string, task?: string},
 *          rugGrounds?: {wool?: string, task?: string}}} [look]
 * @returns {Record<string, string>} material tokens, ready for `overridePalette`
 */
export function materialTokensFor(theme, look = {}) {
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
  // WP-81: on a light theme the halo IS THE WALL, not a hard-coded `#FCFAF4`
  // that was brighter than every wall in the product. §1.2 is that the wall is
  // the top of a room's value range; a halo above it spent the floor's last
  // contrast on signage, and it was the one surface `underWall` did not hold.
  // A dark theme keeps the far side of the ground, because there the halo has
  // to go DOWN from light ink and the wall is the wrong direction entirely.
  const lightInk = lightInkFor(ink);
  const haloBase = lightInk ? shade(ground, -0.55) : wall;

  // Everything a room is furnished in, held under the wall by `underWall`
  // (WP-85a §1.2). Named up here rather than inline because the highlights
  // below are composited ON these, and a sheen that was measured against the
  // uncapped material would put back exactly the bright hole the cap removed.
  const chairFill = underWall(seat, wall);
  const sofaCushion = underWall(shade(seat, 0.02), wall);
  const fridgeFill = underWall(shade(seat, 0.03), wall);
  const whiteboardSurface = underWall(shade(seat, 0.08), wall);
  const counterTop = underWall(mix(tile, desk, 0.22), wall);
  // THE TWO RUGS (§1.d). Each is a TONE cut against the floor it actually lies
  // on: the task rug on a project room's carpet, the reception and lounge wool
  // on the boards. Both were constants until WP-88a and both were measured
  // outside the band on a dark theme; `rugToneFor` solves for the ratio instead.
  //
  // The reception's WOOL is slate since WP-85a (§3.1, owner decision 2) — the
  // one textile on this floor with a hue of its own, and the thing that tells
  // you the waiting area is not the corridor. It is still carried into place by
  // the carpet, so it cannot leave the floor's luminance band and a name drawn
  // on it is as readable as a name drawn on the floor; only its temperature is
  // its own.
  const rugContext = { carpet, wood, plant, wall, lightInk };
  const rugSage = rugToneFor(
    look.rugs?.task || DEFAULT_RUG_TONES.task,
    look.rugGrounds?.task || carpet,
    rugContext,
  );
  const rugCream = rugToneFor(
    look.rugs?.wool || DEFAULT_RUG_TONES.wool,
    look.rugGrounds?.wool || wood,
    rugContext,
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
    // A planter is a PARTITION that is planted (§3.6), so its trough is the
    // partition's material and not the pot's, and the soil is the floor's own
    // dark rather than a brown nothing else on this floor uses.
    planterTrough: underWall(partition, wall),
    planterSoil: shade(screed, -0.42),

    // ---- book spines (§3.5) ----
    //
    // *"`bookA/B/C` derive from the desk timber mixed halfway to three muted
    // neutrals"*, and the three neutrals are three depths of the screed this
    // floor is already poured in. HALFWAY is the number §3.5 states, so it is
    // `0.5` in all three and the variation between spines is WHICH neutral.
    //
    // THE SPREAD IS THE POINT. The first cut mixed toward the screed, the wall
    // and a shade of the desk, which put all three within a few counts of the
    // carcass they stand in — a shelf at fit scale came out as a blank pale
    // slab, which is the opposite failure from the marker blues it replaced but
    // just as unreadable. Three real steps of value, still nowhere near a hue.
    bookA: underWall(mix(desk, shade(screed, -0.5), 0.5), wall),
    bookB: underWall(mix(desk, shade(screed, -0.26), 0.5), wall),
    bookC: underWall(mix(desk, screed, 0.5), wall),

    // ---- thresholds (§3.3) ----
    //
    // A screed band across a doorway is SCREED, a shade off the circulation it
    // crosses, because a threshold that is a different material is a step. The
    // mat inside the reception door is the one place on this floor with a pile
    // that is not a rug, so it is the wool mixed to the screed it lies on.
    thresholdBand: shade(screed, -0.06),
    matFill: underWall(mix(rugCream, screed, 0.4), wall),
    matPile: alpha(shade(ground, -0.5), 0.22),

    // ---- what is on a desk (§3.5) ----
    clutterCeramic: underWall(shade(seat, 0.02), wall),
    clutterPaper: underWall(mix(seat, screed, 0.35), wall),
    // The one warm note on a desk, and it is the plant's complement rather than
    // a yellow of its own: mixing the timber halfway to the wall and then a
    // third of the way to the leaf keeps it inside the floor's own family.
    clutterNote: underWall(mix(mix(desk, wall, 0.4), plant, 0.18), wall),

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
    plateHalo: alpha(haloBase, PLATE_HALO_ALPHA),
    plateInk: ink,
    plateInkSecondary: lightInk ? shade(ink, -0.12) : shade(ink, 0.12),
    // WP-81's fourth rank: the spend line, quieter again than the room's own
    // name. `±0.24` is the last step that still clears 4.5:1 on every ground
    // this floor draws a plate on, measured in `interior.test.mjs` rather than
    // chosen — `±0.30` clears the bare grounds and fails under a pool of light.
    plateInkTertiary: lightInk ? shade(ink, -0.24) : shade(ink, 0.24),
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
