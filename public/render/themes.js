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

import { DEFAULT_PALETTE, overridePalette, resetPalette, STATE_COLORS } from './palette.js';

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
  const lightInk = relativeLuminance(ink) > 0.5;
  const haloBase = lightInk ? shade(ground, -0.55) : '#FCFAF4';

  return {
    // ---- herringbone: one plank colour, four tones, a seam and a sheen ----
    woodHerringboneA: wood,
    woodHerringboneB: shade(wood, -0.09),
    woodHerringboneC: shade(wood, 0.09),
    woodHerringboneD: shade(wood, -0.03),
    woodHerringboneSeam: alpha(shade(wood, -0.55), 0.55),
    woodHerringboneSheen: alpha(lightInk ? '#FFFFFF' : '#FFFFFF', lightInk ? 0.06 : 0.1),

    // ---- circulation ----
    circulationBase: screed,
    circulationSpeckle: alpha(shade(screed, -0.45), 0.13),
    circulationEdge: alpha(shade(screed, -0.45), 0.2),
    circulationSheen: alpha('#FFFFFF', lightInk ? 0.12 : 0.28),

    // ---- carpet ----
    carpetBase: carpet,
    carpetNoiseLight: alpha('#FFFFFF', lightInk ? 0.18 : 0.55),
    carpetNoiseDark: alpha(shade(carpet, -0.5), 0.16),

    // ---- kitchen tile ----
    tileBase: tile,
    tileGrout: alpha(shade(tile, -0.45), 0.16),
    counterTop: shade(tile, 0.06),

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
    rugSage: mix(carpet, plant, 0.3),
    rugCream: shade(carpet, lightInk ? 0.08 : 0.04),
    rugBorder: alpha('#FFFFFF', lightInk ? 0.22 : 0.6),
    rugEdge: alpha(shade(ground, -0.45), 0.28),

    // ---- plants ----
    plantLeafA: plant,
    plantLeafB: shade(plant, 0.14),
    plantLeafC: shade(plant, -0.14),
    plantPot: shade(seat, -0.08),

    // ---- desks, benches, tables ----
    deskTop: desk,
    deskEdge: shade(desk, -0.16),
    tableWood: wood,

    // ---- chairs and sofas ----
    chairFill: seat,
    chairEdge: shade(seat, -0.12),
    chairBackrest: shade(seat, -0.07),
    chairCushion: alpha('#FFFFFF', lightInk ? 0.14 : 0.42),
    sofaFill: shade(seat, -0.03),
    sofaFrame: shade(seat, -0.08),
    sofaCushion: shade(seat, 0.05),
    sofaSeam: alpha(shade(seat, -0.5), 0.35),
    fridgeFill: shade(seat, 0.03),
    whiteboardSurface: shade(seat, 0.08),
    whiteboardSheen: alpha('#FFFFFF', lightInk ? 0.18 : 0.5),

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
  };
}

// ------------------------------------------------------------- shipped themes

/**
 * The default floor and chrome, stated as a theme document so the picker can
 * show it, `deckhq layout export` can name it, and a round trip through the
 * schema proves the schema can express what ships.
 *
 * These values are QUOTED from `palette.js` and `style.css`, and applying this
 * theme does not run the derivation above — see `applyTheme`. That is the one
 * special case in this file and it exists for a hard reason: the shipped
 * herringbone's four tones are hand-tuned and no single-colour derivation
 * reproduces them byte for byte, and the goldens for the default floor must
 * stay at 0 px.
 */
const DEFAULT_FLOOR = Object.freeze({
  wood: '#CBA87A',
  carpet: '#E4DFD3',
  screed: '#CFC9BC',
  ground: '#E3DED4',
  tile: '#EDEAE4',
  wall: '#FCFBF8',
  partition: '#E7E2D6',
  desk: '#D8BD97',
  seat: '#FBFAF7',
  plant: '#6F8F5E',
  ink: '#33291E',
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
        wood: '#4E5259',
        carpet: '#3A3E46',
        screed: '#33373E',
        ground: '#2A2D34',
        tile: '#41454D',
        wall: '#565B63',
        partition: '#454A52',
        desk: '#5A5F67',
        // Measured, not chosen: at `#666C75` this theme's own ink was 4.43:1
        // on a chair, and an agent's name is drawn where the agent sits.
        // `assertThemeContrast` refused it at import.
        seat: '#5A606A',
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
        wood: '#23486E',
        carpet: '#1F4266',
        screed: '#1A3757',
        ground: '#1B3A5C',
        tile: '#26507A',
        wall: '#2E5C8A',
        partition: '#27507A',
        desk: '#2A527D',
        seat: '#356191',
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
  // COLOUR DISCIPLINE. Crimson means "standing in your office" and a theme may
  // not spend it, in either table — not the literal, and not a near-miss.
  // `palette.js`'s `assertMaterialDiscipline` catches this again when the
  // materials are applied; it is checked HERE too because a theme's chrome
  // never passes through that function, and a surface that read as red would
  // be the same failure one layer out.
  const crimson = rgb(STATE_COLORS.for_review);
  for (const [table, tokens] of Object.entries({ floor, chrome })) {
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

// And the default theme's materials really are the shipped ones: if somebody
// edits `palette.js` without editing `DEFAULT_FLOOR`, the picker's "default"
// swatch would lie about the floor it selects.
for (const [key, token] of Object.entries({
  wood: 'woodHerringboneA',
  carpet: 'carpetBase',
  screed: 'circulationBase',
  ground: 'floorGround',
  tile: 'tileBase',
  wall: 'wallFill',
  partition: 'partitionFill',
  desk: 'deskTop',
  seat: 'chairFill',
  plant: 'plantLeafA',
  ink: 'plateInk',
})) {
  const shipped = DEFAULT_PALETTE[token];
  if (String(shipped).toLowerCase() !== String(DEFAULT_FLOOR[key]).toLowerCase()) {
    throw new Error(
      `themes.js: DEFAULT_FLOOR.${key} (${DEFAULT_FLOOR[key]}) has drifted from ` +
        `PALETTE.${token} (${shipped}). The default theme must describe the floor that ships.`,
    );
  }
}
