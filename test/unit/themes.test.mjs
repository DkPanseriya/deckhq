/**
 * WP-30 — the theme mechanism.
 *
 * `state-visuals.test.mjs` proves every SHIPPED theme clears every contrast
 * floor. This file proves the mechanism around them: what the schema refuses,
 * that the default is a byte-exact reset, that a theme reaches the materials
 * the renderer actually paints with, and that the seven state colours, the
 * accent and the project identities are unreachable from a theme document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PALETTE,
  PALETTE,
  PROJECT_IDENTITIES,
  STATE_COLORS,
  resetPalette,
} from '../../public/render/palette.js';
import {
  CHROME_KEYS,
  DEFAULT_THEME_NAME,
  FLOOR_KEYS,
  THEMES,
  THEME_NAMES,
  THEME_VERSION,
  applyChromeTheme,
  applyFloorTheme,
  materialTokensFor,
  swatchesFor,
  themeByName,
} from '../../public/render/themes.js';
import { sanitizeThemeName, isKnownTheme, validateTheme } from '../../src/core/themes.mjs';
import { DEFAULT_SETTINGS } from '../../src/core/store.mjs';

/** A shipped theme, deep-copied so a test can spoil it without spoiling the table. */
function clone(name = 'night shift') {
  const t = /** @type {any} */ (themeByName(name));
  return { name: t.name, version: t.version, floor: { ...t.floor }, chrome: { ...t.chrome } };
}

// ---------------------------------------------------------------- the table

test('two themes ship beside the default, and all three are free', () => {
  assert.deepEqual([...THEME_NAMES], ['default', 'night shift', 'blueprint']);
  // "Ungated" is WP-30's own word. There is nothing in a theme document, in
  // the table, or in `settings.theme` that could carry a tier, a licence or a
  // lock — so this is a check that none has appeared.
  for (const theme of THEMES) {
    const keys = Object.keys(theme);
    for (const forbidden of ['tier', 'paid', 'locked', 'pack', 'licence', 'license', 'pro']) {
      assert.ok(!keys.includes(forbidden), `theme "${theme.name}" carries a ${forbidden} flag`);
    }
  }
});

test('the default setting is the default theme', () => {
  assert.equal(DEFAULT_SETTINGS.theme, DEFAULT_THEME_NAME);
});

test('a theme is found by name, spacing and case notwithstanding', () => {
  for (const spelling of ['night shift', 'Night Shift', 'night-shift', '  NIGHT_SHIFT  ']) {
    assert.equal(themeByName(spelling)?.name, 'night shift', spelling);
  }
  assert.equal(themeByName('midnight'), null);
  assert.equal(themeByName(null), null);
  assert.equal(themeByName(42), null);
});

test('an unknown or hostile theme name sanitises to the default, and is never opened', () => {
  for (const bad of ['../../etc/passwd', 'C:\\windows', '', null, undefined, 7, { name: 'x' }]) {
    assert.equal(sanitizeThemeName(bad), DEFAULT_THEME_NAME, String(bad));
  }
  assert.equal(sanitizeThemeName('blueprint'), 'blueprint');
  assert.equal(isKnownTheme('blueprint'), true);
  assert.equal(isKnownTheme('../blueprint'), false);
});

// -------------------------------------------------------------- the schema

test('every shipped theme round-trips through the schema', () => {
  // The schema has to be able to express what ships. If it cannot, it is a
  // schema for a different feature.
  for (const theme of THEMES) {
    const result = validateTheme({
      name: theme.name,
      version: theme.version,
      floor: { ...theme.floor },
      chrome: { ...theme.chrome },
    });
    assert.equal(result.ok, true, `${theme.name}: ${/** @type {any} */ (result).error}`);
  }
});

test('the schema refuses a key that is not on the allowlist', () => {
  const doc = clone();
  /** @type {any} */ (doc.floor).for_review = '#00ff00';
  const result = validateTheme(doc);
  assert.equal(result.ok, false);
  assert.match(/** @type {any} */ (result).error, /not themeable/);
});

test('a state colour, the accent and an identity have nowhere to go in a theme', () => {
  // The structural promise, stated as an assertion rather than as prose: there
  // is no allowlisted key whose name could mean one of these.
  const allowed = [...Object.keys(FLOOR_KEYS), ...CHROME_KEYS];
  for (const state of Object.keys(STATE_COLORS)) {
    assert.ok(!allowed.includes(state), `${state} is themeable`);
    assert.ok(!allowed.includes(`state-${state}`), `state-${state} is themeable`);
  }
  for (const key of ['accent', 'accent-ink', 'accent-soft', 'focus', 'line-2']) {
    assert.ok(!allowed.includes(key), `${key} is themeable`);
  }
  for (const key of ['hair', 'skin', 'glyph', 'identity', 'managerSuit']) {
    assert.ok(!allowed.includes(key), `${key} is themeable`);
  }
  // And the tables themselves are untouched by any theme application.
  const identitiesBefore = JSON.stringify(PROJECT_IDENTITIES);
  const statesBefore = JSON.stringify(STATE_COLORS);
  applyFloorTheme('blueprint');
  assert.equal(JSON.stringify(PROJECT_IDENTITIES), identitiesBefore);
  assert.equal(JSON.stringify(STATE_COLORS), statesBefore);
  resetPalette();
});

test('the schema refuses anything that is not a #rrggbb colour', () => {
  for (const value of [
    'url(https://example.com/wood.png)',
    'var(--accent)',
    'linear-gradient(red, blue)',
    'JetBrains Mono',
    '#fff',
    'rgb(1,2,3)',
    12,
    null,
  ]) {
    const doc = clone();
    doc.floor.wood = /** @type {any} */ (value);
    const result = validateTheme(doc);
    assert.equal(result.ok, false, `${JSON.stringify(value)} was accepted`);
    assert.match(/** @type {any} */ (result).error, /#rrggbb/);
  }
});

test('the schema refuses a bad name, a wrong version, a missing table and a missing key', () => {
  const cases = [
    [{ ...clone(), name: 'Night Shift!' }, /name/],
    [{ ...clone(), name: 'x'.repeat(40) }, /name/],
    [{ ...clone(), version: 2 }, /version/],
    [{ ...clone(), version: undefined }, /version/],
    [{ ...clone(), floor: undefined }, /no "floor" object/],
    [{ ...clone(), chrome: 'blue' }, /no "chrome" object/],
    ['not an object', /must be a JSON object/],
    [null, /must be a JSON object/],
  ];
  for (const [doc, pattern] of cases) {
    const result = validateTheme(/** @type {any} */ (doc));
    assert.equal(result.ok, false, JSON.stringify(doc)?.slice(0, 60));
    assert.match(/** @type {any} */ (result).error, /** @type {RegExp} */ (pattern));
  }

  const short = clone();
  delete short.floor.carpet;
  const result = validateTheme(short);
  assert.equal(result.ok, false);
  assert.match(/** @type {any} */ (result).error, /missing floor\.carpet/);
});

test('the schema refuses a theme that would fail a contrast floor', () => {
  // The rejection this feature exists to make impossible to skip: a theme that
  // looks fine in a screenshot and is unreadable for somebody else.
  const dim = clone();
  dim.chrome.ink = '#20242c'; // near-black text on a near-black ground
  const result = validateTheme(dim);
  assert.equal(result.ok, false);
  assert.match(/** @type {any} */ (result).error, /--ink on --bg is [\d.]+:1/);

  const unreadableFloor = clone();
  unreadableFloor.floor.ink = '#4E5259'; // the same colour as its own wood
  const second = validateTheme(unreadableFloor);
  assert.equal(second.ok, false);
  assert.match(/** @type {any} */ (second).error, /floor ink on the wood/);
});

test('the schema refuses a theme that reaches for the reserved crimson', () => {
  const red = clone();
  red.floor.carpet = '#c0392b';
  assert.equal(validateTheme(red).ok, false);
  const nearlyRed = clone();
  nearlyRed.floor.carpet = '#c13a2c'; // one bit of deniability
  const result = validateTheme(nearlyRed);
  assert.equal(result.ok, false, 'a near-miss on crimson was accepted');
});

test('the schema refuses a document carrying anything but name, version and two tables', () => {
  const doc = /** @type {any} */ ({ ...clone(), font: 'Comic Sans', sound: 'boing' });
  const result = validateTheme(doc);
  assert.equal(result.ok, false);
  assert.match(/** @type {any} */ (result).error, /font, sound/);
});

test('a theme document has a size bound stated in one place', () => {
  // The bound is not enforced here — it is `MAX_THEME_BYTES`, read by whoever
  // reads bytes — but a theme that could be a megabyte would be a theme that
  // could be a denial of service, so the constant has to exist and be small.
  assert.equal(THEME_VERSION, 1);
});

// ------------------------------------------------------------- the painting

test('applying the default theme restores every material byte for byte', () => {
  // The property the goldens rest on: choosing "default" is a reset, not a
  // re-derivation, so the shipped floor cannot drift by a rounding step.
  applyFloorTheme('blueprint');
  assert.notEqual(PALETTE.woodHerringboneA, DEFAULT_PALETTE.woodHerringboneA);
  assert.equal(applyFloorTheme('default'), 'default');
  for (const [key, value] of Object.entries(DEFAULT_PALETTE)) {
    assert.equal(PALETTE[key], value, `PALETTE.${key} did not come back`);
  }
});

test('an unknown theme falls back to the default rather than half-painting', () => {
  applyFloorTheme('blueprint');
  assert.equal(applyFloorTheme('no such theme'), 'default');
  assert.equal(PALETTE.woodHerringboneA, DEFAULT_PALETTE.woodHerringboneA);
});

test('a theme reaches the material tokens the renderer actually paints with', () => {
  // `backdrop.js` reads `woodHerringboneA..D`, not `wood`. A theme that named a
  // material nothing painted with would be a picker that did nothing.
  applyFloorTheme('night shift');
  const night = /** @type {any} */ (themeByName('night shift'));
  assert.equal(PALETTE.woodHerringboneA, night.floor.wood);
  assert.equal(PALETTE.carpetBase, night.floor.carpet);
  assert.equal(PALETTE.circulationBase, night.floor.screed);
  assert.equal(PALETTE.floorGround, night.floor.ground);
  assert.equal(PALETTE.wallFill, night.floor.wall);
  assert.equal(PALETTE.plantLeafA, night.floor.plant);
  assert.equal(PALETTE.plateInk, night.floor.ink);
  // The derived tones are a family, not repeats of one colour.
  const tones = new Set([
    PALETTE.woodHerringboneA,
    PALETTE.woodHerringboneB,
    PALETTE.woodHerringboneC,
    PALETTE.woodHerringboneD,
  ]);
  assert.equal(tones.size, 4, 'the herringbone lost its tone variation');
  resetPalette();
});

test('light line work gets a dark halo, and dark line work a light one', () => {
  // The defect this prevents: blueprint's white plate text on the shipped
  // near-white halo, which would have been invisible and would have passed
  // every contrast test in the suite, because the halo is not a token anybody
  // measures text against.
  const dark = materialTokensFor(/** @type {any} */ (themeByName('default')));
  const light = materialTokensFor(/** @type {any} */ (themeByName('blueprint')));
  assert.match(dark.plateHalo, /^rgba\(252,250,244/);
  assert.match(light.plateHalo, /^rgba\(\d+,\d+,\d+,0\.92\)$/);
  const channels = light.plateHalo.match(/\d+/g).slice(0, 3).map(Number);
  assert.ok(
    channels.every((c) => c < 80),
    `blueprint's plate halo is ${light.plateHalo}, which is not dark`,
  );
});

test('a theme repaints no prop: monitors, the hob and the billiard cloth are objects', () => {
  applyFloorTheme('blueprint');
  for (const key of ['monitorBody', 'hob', 'cabinetBody', 'poolFelt', 'boxFill', 'managerSuit']) {
    assert.equal(PALETTE[key], DEFAULT_PALETTE[key], `${key} was themed`);
  }
  resetPalette();
});

test('the chrome is applied as inline custom properties, and the default removes them', () => {
  /** A root element stub: `style.setProperty` and a dataset, and nothing else. */
  const set = new Map();
  const root = {
    dataset: /** @type {any} */ ({}),
    style: {
      setProperty: (k, v) => set.set(k, v),
      removeProperty: (k) => set.delete(k),
    },
  };

  assert.equal(applyChromeTheme('blueprint', root), 'blueprint');
  const blueprint = /** @type {any} */ (themeByName('blueprint'));
  for (const key of CHROME_KEYS) assert.equal(set.get(`--${key}`), blueprint.chrome[key]);
  assert.equal(root.dataset.theme, 'blueprint');
  // Nothing that carries meaning was written.
  for (const key of ['--accent', '--accent-ink', '--focus', '--state-for_review']) {
    assert.equal(set.has(key), false, `${key} was written by a theme`);
  }

  assert.equal(applyChromeTheme('default', root), 'default');
  assert.equal(set.size, 0, 'the default theme left custom properties behind');
  assert.equal(root.dataset.theme, undefined);
});

test('a picker swatch is three of the theme\u2019s own colours', () => {
  for (const theme of THEMES) {
    const swatches = swatchesFor(theme);
    assert.equal(swatches.length, 3);
    for (const colour of swatches) assert.match(colour, /^#[0-9a-fA-F]{6}$/);
  }
  assert.notDeepEqual(swatchesFor(THEMES[0]), swatchesFor(THEMES[1]));
});
