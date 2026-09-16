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
  overridePalette,
  PROJECT_IDENTITIES,
  resetPalette,
  STATE_COLORS,
  washedCarpet,
} from './palette.js';
import {
  CHROME_KEYS,
  CRIMSON_MIN_DISTANCE,
  DEFAULT_CHROME,
  DEFAULT_FLOOR,
  DEFAULT_THEME_NAME,
  THEME_NAMES,
  THEMES,
} from './themes-tables.js';
import {
  assertFigureHaloContrast,
  BOARD_MAX_INTERNAL_CONTRAST,
  contrastRatio,
  GROUND_KEYS,
  interiorHighlights,
  lightInkFor,
  materialTokensFor,
  plateGroundOver,
  pooled,
  relativeLuminance,
  rgb,
  RUG_BAND_MAX,
  RUG_BAND_MIN,
  RUG_GROUNDS,
} from './themes-derive.js';

// WP-92n. The tables are `./themes-tables.js` and the derivation is
// `./themes-derive.js`. Both are re-exported here, so the nine modules that
// import `themes.js` — four under `src/core/`, four under `public/render/`
// and the shell — are untouched by the split.
export * from './themes-tables.js';
export * from './themes-derive.js';

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

  // AND EACH RUG READS AGAINST THE FLOOR IT LIES ON, WITHOUT SHOUTING (WP-88a,
  // §1.d). Two failures on the shipped floor were found by measuring exactly
  // this and by nothing else: a wool rug at 1.00:1 on night shift and a task rug
  // at 1.69:1 on blueprint, with every other number in this function green. Both
  // rugs are now solved for rather than derived through a constant, so this is a
  // check on the solver for any theme the derivation produced — and a real
  // refusal for one whose carpet and boards leave no parameter that reads.
  for (const [role, groundKey] of Object.entries(RUG_GROUNDS)) {
    const rug = role === 'wool' ? derived.rugCream : derived.rugSage;
    const ratio = contrastRatio(rug, floor[groundKey]);
    if (ratio + 1e-9 < RUG_BAND_MIN || ratio - 1e-9 > RUG_BAND_MAX) {
      throw new Error(
        `${where}: the ${role} rug (${rug}) is ${ratio.toFixed(2)}:1 against the ${groundKey} ` +
          `it lies on, outside [${RUG_BAND_MIN}, ${RUG_BAND_MAX}]. A name is drawn wherever an ` +
          'agent stands and that is very often a rug — docs/plan/11-LOOK-CONTROL-CENTRE.md §1.d.',
      );
    }
  }

  // AND EVERY RANK OF PLATE TEXT, ON THE HALO IT IS ACTUALLY READ ON (WP-81).
  //
  // A plate is now four ranks — hero, name, doing, spend — each a step quieter
  // than the last, and "quieter" is a contrast budget being spent. The backdrop
  // is not the bare floor either: `plateHalo` is stroked behind the glyphs at
  // 0.92, so what a reader sees a plate's letters against is the halo
  // COMPOSITED over whichever ground the room stands on, under a pool of light.
  // That composite is the only honest surface to measure, and the quietest ink
  // on the darkest of them is the number that decides whether the fourth rank
  // exists at all.
  for (const key of GROUND_KEYS) {
    const behind = plateGroundOver(floor, floor[key]);
    for (const rank of ['plateInk', 'plateInkSecondary', 'plateInkTertiary']) {
      need(contrastRatio(derived[rank], behind), 4.5, `${rank} on a plate over the ${key}`);
    }
    // The hero's state dot is a GRAPHIC, not text, and is held to 3:1 like
    // every other non-text signal on this floor. It could not be held to 4.5
    // and stay the state colour: the palette is mid-tone by design (§1.3), so
    // an ink that cleared 4.5 on both a light and a dark plate would no longer
    // be `for_review` crimson or `needs_input` amber. The words beside it carry
    // the same fact at 4.5:1, which is why colour is never alone here.
    for (const state of ['working', 'needs_input', 'stalled', 'for_review']) {
      need(contrastRatio(STATE_COLORS[state], behind), 3, `the ${state} plate dot on the ${key}`);
    }
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
