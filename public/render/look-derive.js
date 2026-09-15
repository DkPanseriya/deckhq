/**
 * THE LOOK DERIVATION — WP-88a. `docs/plan/11-LOOK-CONTROL-CENTRE.md` §1.
 *
 * `look-options.js` is the catalogue; this is what a choice from it becomes.
 * One function does the work — `resolveLook(look, theme)` — and it returns the
 * whole of what a painter needs: the eleven floor tokens after the scheme, the
 * material tokens WP-85a fans those out into, one material per zone with its
 * colours and its pattern rule, both rugs, the furniture set, the planting, the
 * prop density and the lounge kit.
 *
 * ## Why the painters read a resolved look rather than a constant
 *
 * Before this package every one of those numbers was a literal inside the
 * painter that used it, which is the shape of defect this product keeps finding:
 * a value stated in two places drifts, and the one the floor is painted from is
 * never the one the test measures. `applyLook` writes ONE object — `LOOK`, the
 * same device `PALETTE` already is — and every painter reads it. The default
 * look resolves to exactly the constants that were there before, which is what
 * keeps `goldens:check` at 0 px through a package that touched every painter.
 *
 * ## The luminance lock
 *
 * A scheme moves hue and chroma and then puts the token back on its own relative
 * luminance by bisection. A WCAG ratio depends only on relative luminance, so
 * every measurement `assertThemeContrast` makes is unchanged by construction and
 * the 162 combinations do not have to be enumerated to be SAFE — only to be
 * proved safe, which `look-guards.test.mjs` does anyway.
 *
 * Pure with respect to the DOM: `applyLook` mutates `PALETTE` and `LOOK` and
 * nothing else, so a caller decides when to re-bake.
 */

import { PALETTE, overridePalette, resetPalette } from './palette.js';
import {
  DEFAULT_THEME_NAME,
  THEMES,
  applyChromeTheme,
  materialTokensFor,
  mix,
  relativeLuminance,
  contrastRatio,
  shade,
  themeByName,
  underWall,
} from './themes.js';
import {
  DEFAULT_LOOK,
  FLOOR_MATERIALS,
  FURNITURE_SETS,
  LOOK_ZONES,
  LOUNGE_KIT_BAYS,
  PLANT_DENSITIES,
  PLANT_FAMILIES,
  PROP_DENSITIES,
  RUG_PATTERNS,
  RUG_ROLES,
  SCHEMES,
  SCHEME_SURFACES,
  normalizeLook,
  sameLook,
} from './look-options.js';

// ------------------------------------------------------------ colour maths
//
// HSL, because a SCHEME is a statement about hue and chroma and `themes.js`'s
// `mix` and `shade` are statements about value. Two of the three axes of a
// colour are not reachable from the other file's arithmetic, so they are here
// — and only here, so nothing else on this floor grows a second opinion about
// what a hue is.

/** @param {string} hex @returns {[number,number,number]} */
function rgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`look-derive.js: ${hex} is not a #rrggbb colour`);
  return /** @type {[number,number,number]} */ (
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

/** @param {string} colour @returns {{h:number, s:number, l:number}} */
function hslOf(colour) {
  const [r, g, b] = rgb(colour).map((n) => n / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

/** @param {number} h @param {number} s @param {number} l @returns {string} */
function hslHex(h, s, l) {
  const sat = Math.min(1, Math.max(0, s));
  const lit = Math.min(1, Math.max(0, l));
  if (sat === 0) return hex([lit * 255, lit * 255, lit * 255]);
  const q = lit < 0.5 ? lit * (1 + sat) : lit + sat - lit * sat;
  const p = 2 * lit - q;
  /** @param {number} t */
  const channel = (t) => {
    let u = t;
    if (u < 0) u += 1;
    if (u > 1) u -= 1;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  const hue = (((h % 360) + 360) % 360) / 360;
  return hex([channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255]);
}

/**
 * Put a colour back on a relative luminance, by bisection.
 *
 * The device `underWall` uses, pointed at an equality rather than at a ceiling.
 * `shade` is monotone in its parameter from black at −1 to white at +1, so a
 * target luminance in [0, 1] is always reachable and the answer is unique.
 * Twenty-four halvings put it inside a sixteen-millionth of the range, which is
 * far under one channel count, so the result is the same on every machine.
 *
 * @param {string} colour @param {number} target
 */
export function lockLuminance(colour, target) {
  if (Math.abs(relativeLuminance(colour) - target) < 1e-9) return colour;
  let lo = -1;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (relativeLuminance(shade(colour, mid)) < target) lo = mid;
    else hi = mid;
  }
  return shade(colour, (lo + hi) / 2);
}

// ------------------------------------------------------- the scheme transform

/**
 * One token, through one scheme (§1.b).
 *
 * Mixed toward an anchor hue held at the token's OWN lightness — so the scheme
 * is a temperature rather than a repaint — its chroma scaled, and the result
 * pushed back to the token's original relative luminance.
 *
 * `warm` returns the colour untouched rather than round-tripping it through
 * HSL, and that is load-bearing: a round trip through `hslOf`/`hslHex` can move
 * a channel by one count, and `warm` is the transform the goldens are shot in.
 *
 * @param {string} colour
 * @param {{anchor:number|null, weight:number, chroma:number}} scheme
 * @param {boolean} [hue] false for `plant`, which takes the chroma and never the
 *   hue: foliage is not a finish.
 */
export function schemeColour(colour, scheme, hue = true) {
  const wantsHue = hue && scheme.anchor !== null && scheme.weight > 0;
  if (!wantsHue && scheme.chroma === 1) return colour;
  const target = relativeLuminance(colour);
  const start = hslOf(colour);
  let out = colour;
  if (wantsHue) {
    out = mix(
      colour,
      hslHex(/** @type {number} */ (scheme.anchor), start.s, start.l),
      scheme.weight,
    );
  }
  if (scheme.chroma !== 1) {
    const now = hslOf(out);
    out = hslHex(now.h, now.s * scheme.chroma, now.l);
  }
  return lockLuminance(out, target);
}

/**
 * A theme's eleven floor tokens, through a scheme.
 *
 * `ink` is untouched — the line work is the one thing on this floor that is not
 * a finish — and `plant` takes the chroma factor and not the hue.
 *
 * @param {Record<string,string>} floor
 * @param {string} schemeId
 * @returns {Record<string,string>}
 */
export function schemeFloor(floor, schemeId) {
  const scheme = SCHEMES[schemeId] || SCHEMES.warm;
  /** @type {Record<string,string>} */
  const out = { ...floor };
  for (const key of SCHEME_SURFACES) out[key] = schemeColour(floor[key], scheme);
  out.plant = schemeColour(floor.plant, scheme, false);
  return out;
}

// -------------------------------------------------------- material colours

/**
 * One floor material's colours, off one set of floor tokens.
 *
 * `field` is what the eye reads the zone as, `tones` the family the pattern lays
 * in it, `specks` the chips and flecks scattered over it. The three are separate
 * because the guards hold them to different ceilings (§1.a): a tone is a field
 * and lives under 1.14:1, a speck under 0.3 U is integrated by the eye rather
 * than read and lives under 2.0:1.
 *
 * @param {string} id a key of `FLOOR_MATERIALS`
 * @param {Record<string,string>} floor the eleven, after the scheme
 */
export function materialColours(id, floor) {
  const material = FLOOR_MATERIALS[id] || FLOOR_MATERIALS['herringbone-oak'];
  const field = underWall(material.from(floor), floor.wall);
  // Every tone and every chip is held under the wall, exactly as WP-85a holds
  // the furniture: a terrazzo chip is a material's brightest pixel, not a
  // decoration on top of it, and a chip that climbed past the wall on a dark
  // theme would be the bright hole §1.2 found, with the field itself green.
  /** @param {string} c */
  const cap = (c) => underWall(c, floor.wall);
  return {
    id: material.id,
    label: material.label,
    painter: material.painter,
    source: material.source,
    pattern: material.pattern,
    field,
    tones: material.tones(field).map(cap),
    specks: material.specks(field, floor).map(cap),
  };
}

// ------------------------------------------------------------- the zones

/**
 * WHICH MATERIAL A ROOM IS PAINTED IN.
 *
 * `plan.js` says what a room IS — its kind, and the ground it was dealt
 * (`wood`, `carpet`, `tile`, `circulation`) — and the look says what that ground
 * is made of. Two clauses are not a zone lookup and both are deliberate:
 *
 *   - **A lobby takes the room's own material.** A corridor whose ground is
 *     `wood` is the open floor beside the reception and reads as one space with
 *     it (`backdrop.js`'s own comment); giving it the corridor's material would
 *     put a threshold where there is no door.
 *   - **`tile` is the café and is not a picker.** §1.a's zones are four uses;
 *     the kitchen bay inside the lounge is a fifth, and a kitchen has a floor
 *     the rest of a lounge does not. It is the ceramic tile, always.
 *
 * @param {{kind?:string, floor?:string}} room
 * @param {Record<string,string>} zones the look's four material ids
 * @returns {string} a key of `FLOOR_MATERIALS`
 */
export function materialForRoom(room, zones) {
  switch (room?.floor) {
    case 'tile':
      return 'ceramic-tile';
    case 'wood':
      return room.kind === 'lounge' ? zones.lounge : zones.office;
    case 'circulation':
      return zones.corridor;
    case 'carpet':
      return zones.rooms;
    default:
      return room?.kind === 'corridor' ? zones.corridor : zones.rooms;
  }
}

/**
 * The contrast across every adjacency in `ZONE_ADJACENCY`, measured on the
 * fields the zones are actually painted in. §1 rule 2's *"zone edge ≤ 1.60:1"*
 * is measured over exactly this, and so is WP-88b's live preview, so the number
 * under the preview is the number the guard refused on.
 *
 * @param {Record<string,{field:string}>} materials zone -> resolved material
 * @param {ReadonlyArray<readonly [string,string]>} adjacency
 * @returns {Array<{zones:[string,string], ratio:number}>}
 */
export function zoneEdges(materials, adjacency) {
  return adjacency.map(([a, b]) => ({
    zones: /** @type {[string,string]} */ ([a, b]),
    ratio: contrastRatio(materials[a].field, materials[b].field),
  }));
}

// ---------------------------------------------------------- resolve a look

/**
 * @typedef {object} ResolvedLook
 * @property {import('./look-options.js').Look} look   the normalised document
 * @property {string} theme                            the theme it was resolved against
 * @property {Record<string,string>} floor             the eleven, after the scheme
 * @property {Record<string,string>} tokens            what `overridePalette` takes
 * @property {Record<string,any>} zones                zone -> resolved material
 * @property {Record<string,any>} materials            material id -> resolved material
 * @property {Record<string,any>} rugs                 role -> tone, pattern, colour
 * @property {any} furniture
 * @property {{family:any, density:any}} plants
 * @property {{density:any, clearU2:number}} props
 * @property {{bays:string[], on:Record<string,boolean>}} lounge
 * @property {string} agentSize
 */

/**
 * A look and a theme, resolved into everything a painter reads.
 *
 * @param {unknown} look
 * @param {unknown} [theme] a theme name, or a theme document
 * @returns {ResolvedLook}
 */
export function resolveLook(look, theme) {
  const l = normalizeLook(look);
  const doc =
    theme && typeof theme === 'object' && /** @type {any} */ (theme).floor
      ? /** @type {any} */ (theme)
      : themeByName(theme) || THEMES[0];
  const floor = schemeFloor({ ...THEMES[0].floor, ...doc.floor }, l.scheme);

  /** @type {Record<string,any>} */
  const zones = {};
  /** @type {Record<string,any>} */
  const materials = {};
  for (const zone of LOOK_ZONES) {
    zones[zone] = materialColours(l.floors[zone], floor);
    materials[zones[zone].id] = zones[zone];
  }

  // The two rugs are cut against the floors they actually lie on — the wool in
  // the reception and the lounge, the task rug in a project room — which is why
  // the zones are resolved before the tokens are. A wool rug solved against the
  // theme's boards and then laid on terrazzo is the failure §1.d found, one
  // material further out.
  const tokens = materialTokensFor(
    { floor },
    {
      rugs: { wool: l.rugs.wool.tone, task: l.rugs.task.tone },
      rugGrounds: { wool: zones.office.field, task: zones.rooms.field },
    },
  );
  // The café's tile is not a picker and is still painted, so it is resolved
  // here rather than left for a painter to find missing.
  materials['ceramic-tile'] = materials['ceramic-tile'] || materialColours('ceramic-tile', floor);

  /** @type {Record<string,any>} */
  const rugs = {};
  for (const role of RUG_ROLES) {
    rugs[role] = {
      role,
      tone: l.rugs[role].tone,
      pattern: RUG_PATTERNS[l.rugs[role].pattern],
      colour: role === 'wool' ? tokens.rugCream : tokens.rugSage,
    };
  }

  const on = { ...l.lounge };
  return {
    look: l,
    theme: doc.name || DEFAULT_THEME_NAME,
    floor,
    tokens,
    zones,
    materials,
    rugs,
    furniture: FURNITURE_SETS[l.furniture],
    plants: { family: PLANT_FAMILIES[l.plants.family], density: PLANT_DENSITIES[l.plants.density] },
    props: {
      density: PROP_DENSITIES[l.props.density],
      clearU2: PROP_DENSITIES[l.props.density].clearU2,
    },
    lounge: { bays: LOUNGE_KIT_BAYS.filter((b) => on[b]), on },
    agentSize: l.agentSize,
  };
}

// ------------------------------------------------------------- the live look

/**
 * THE LOOK THE FLOOR IS CURRENTLY PAINTED IN.
 *
 * The same device `PALETTE` is, and for the same reason: a renderer reads
 * properties off this object at paint time, so replacing a value changes the
 * next bake and nothing else. It starts as `DEFAULT_LOOK` resolved against the
 * default theme, which is to say as the floor this product has always shipped.
 *
 * @type {ResolvedLook}
 */
export const LOOK = /** @type {any} */ (resolveLook(DEFAULT_LOOK, DEFAULT_THEME_NAME));

/** @param {ResolvedLook} next */
function adopt(next) {
  for (const key of Object.keys(LOOK)) delete (/** @type {any} */ (LOOK)[key]);
  Object.assign(LOOK, next);
  return LOOK;
}

/**
 * Repaint the floor for a look and a theme.
 *
 * THE DEFAULT LOOK ON THE DEFAULT THEME IS A RESET, exactly as `applyFloorTheme`
 * already treats the default theme: the shipped materials are restored rather
 * than re-derived. It costs nothing, it puts back the props a theme does not
 * touch, and it is the one path that cannot drift from `DEFAULT_PALETTE` by a
 * channel count — which is what `goldens:check` is measuring when it says 0 px.
 *
 * @param {unknown} look
 * @param {unknown} themeName
 * @param {any} [root] `document.documentElement`, or nothing in a test
 * @returns {ResolvedLook}
 */
export function applyLook(look, themeName, root) {
  const theme = themeByName(themeName) || THEMES[0];
  const resolved = resolveLook(look, theme);
  if (theme.name === DEFAULT_THEME_NAME && sameLook(resolved.look, DEFAULT_LOOK)) resetPalette();
  else overridePalette(resolved.tokens);
  if (root) applyChromeTheme(theme.name, root);
  return adopt(resolved);
}

/** Put the floor back exactly as it ships. For the daemon's reload, and for tests. */
export function resetLook() {
  resetPalette();
  return adopt(resolveLook(DEFAULT_LOOK, DEFAULT_THEME_NAME));
}

/**
 * The colour a material's field is painted in RIGHT NOW, for a painter that has
 * a material id and no resolved record — which happens exactly once, when the
 * café's tile is painted inside a lounge whose own material is something else.
 * @param {string} id
 */
export function liveMaterial(id) {
  return LOOK.materials[id] || materialColours(id, LOOK.floor);
}

/** The live palette, for a painter that wants a token rather than a material. */
export { PALETTE };
