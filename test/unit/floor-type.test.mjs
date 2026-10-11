/**
 * THE FLOOR'S TYPE (`public/render/floor-type.js`): one place that says which
 * face, weight and figures each kind of floor text is set in, so a bundled
 * family is one entry in one table — and the look key that names it.
 *
 * No canvas: a font is a string, and a look is a document.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FONT,
  FONT_FAMILIES,
  FONT_IDS,
  TYPE_ROLES,
  floorFont,
  setFloorFont,
  typeFont,
} from '../../public/render/floor-type.js';
import { monoFont, sansFont } from '../../public/render/rig-metrics.js';
import {
  DEFAULT_LOOK,
  FONT_PICKER,
  LOOK_PICKERS,
  normalizeLook,
} from '../../public/render/look-options.js';
import { applyLook, resetLook } from '../../public/render/look-derive.js';
import { buildLookDocument, parseLookDocument } from '../../src/core/look.mjs';
import { advancedOf, byRole, group, world } from '../helpers/look-surfaces.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (/** @type {string} */ file) => fs.readFileSync(path.join(REPO, file), 'utf8');

test('every role names a family role, a real weight and whether its figures line up', () => {
  for (const [name, role] of Object.entries(TYPE_ROLES)) {
    assert.ok(['sans', 'numeric', 'mono'].includes(role.family), `${name}: ${role.family}`);
    assert.ok([400, 500, 600, 700].includes(role.weight), `${name}: weight ${role.weight}`);
    assert.ok(Math.abs(role.tracking) <= 0.02, `${name}: tracked by ${role.tracking} em`);
    assert.equal(typeof role.tabular, 'boolean');
    assert.ok(role.size.length > 8, `${name} does not say what sizes it`);
    // TABULAR IS THE NUMERIC FAMILY: a canvas cannot ask for tabular figures,
    // so a role whose figures must line up is set in the family whose do.
    assert.equal(role.tabular, role.family === 'numeric', name);
  }
  // A room's name is the sans at a confident weight, tracked slightly tight.
  assert.deepEqual(
    [TYPE_ROLES.roomName.family, TYPE_ROLES.roomName.weight, TYPE_ROLES.roomName.tracking < 0],
    ['sans', 700, true],
  );
  // Timers and counts keep figures that line up; mono is only where text is code.
  for (const name of ['roomCount', 'badge']) assert.ok(TYPE_ROLES[name].tabular);
  assert.deepEqual(
    Object.entries(TYPE_ROLES)
      .filter(([, r]) => r.family === 'mono')
      .map(([n]) => n),
    ['bubble'],
  );
});

test('a font is three families, and no family it names needs a file this build does not ship', () => {
  assert.deepEqual([...FONT_IDS], ['deckhq', 'system'], 'the product’s own, then the machine’s');
  assert.equal(DEFAULT_FONT, 'deckhq');
  for (const [id, font] of Object.entries(FONT_FAMILIES)) {
    for (const key of ['sans', 'numeric', 'mono']) {
      assert.ok(font[key].split(',').length >= 3, `${id}.${key} has no fallbacks`);
      // A family is named by ROLE (DeckHQ Sans, …) or is the machine's own:
      // naming a typeface here is how the floor came to ask for two it never
      // shipped (`floor-fonts.test.mjs` holds the files to the names).
      assert.doesNotMatch(
        font[key],
        /IBM Plex|JetBrains|Inter\b/,
        `${id}.${key} names a face by its maker's name`,
      );
    }
    assert.match(font.mono, /monospace\s*$/);
    assert.match(font.sans, /sans-serif\s*$/);
  }
  // The machine's numeric family leads with faces whose default figures are
  // tabular; the product's own is a face whose tabular figures are switched on.
  assert.match(FONT_FAMILIES.system.numeric, /^'Segoe UI', Roboto/);
  assert.match(FONT_FAMILIES.deckhq.numeric, /^'DeckHQ Numeric', 'Segoe UI', Roboto/);
  // WHAT FOLLOWS THE PRODUCT'S OWN FACE IS THE MACHINE'S, word for word: a
  // frame painted before a file lands is the `system` floor, not a third one.
  for (const key of /** @type {const} */ (['sans', 'numeric', 'mono'])) {
    assert.ok(
      FONT_FAMILIES.deckhq[key].endsWith(`, ${FONT_FAMILIES.system[key]}`),
      `deckhq.${key} does not fall back to system.${key}`,
    );
    assert.doesNotMatch(FONT_FAMILIES.system[key], /DeckHQ/, `system.${key} names a shipped face`);
  }
  // NOTHING IS FETCHED FROM ELSEWHERE: the table names no address at all.
  const table = read('public/render/floor-type.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(table, /https?:|fonts\.googleapis|\.woff2?\b/);
});

test('every floor painter asks a role for its face: the canvas font is the role’s weight, size and family', () => {
  const f = FONT_FAMILIES[DEFAULT_FONT];
  assert.equal(typeFont('roomName', 12.5, true), `700 12.50px ${f.sans}`);
  assert.equal(typeFont('roomCount', 14, true), `700 14.00px ${f.numeric}`);
  assert.equal(typeFont('agentName', 11.4), `600 11px ${f.sans}`);
  assert.equal(typeFont('bubble', 9), `500 9px ${f.mono}`);
  // The two helpers every older call site used are roles now, not faces.
  assert.equal(sansFont(12), typeFont('agentName', 12));
  assert.equal(monoFont(13), typeFont('badge', 13));
  assert.match(monoFont(13), /^700 13px 'DeckHQ Numeric'/, 'a wait is no longer a monospace');
  // And no painter names a family of its own any more.
  for (const file of fs.readdirSync(path.join(REPO, 'public/render'))) {
    if (!file.endsWith('.js') || file === 'floor-type.js') continue;
    const code = read(`public/render/${file}`).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, /sans-serif|monospace|system-ui/, `${file} names a font family`);
  }
});

test('the look carries a font: the product’s own by default, one of the fonts, and it survives export and import', () => {
  assert.equal(DEFAULT_LOOK.font, 'deckhq');
  assert.equal(
    normalizeLook({}).font,
    'deckhq',
    'a look saved before the key named no face, and is set in the default',
  );
  assert.equal(normalizeLook({ font: 'comic' }).font, 'deckhq', 'an unknown font is the default');
  assert.equal(normalizeLook({ font: 'system' }).font, 'system', 'a chosen font was not kept');
  assert.deepEqual(
    FONT_PICKER.options.map((o) => o.id),
    [...FONT_IDS],
  );
  assert.ok(!LOOK_PICKERS.some((p) => p.id === 'font'), 'the font is counted among the materials');
  // Export, then import: the same document, the font in it.
  const doc = buildLookDocument({ look: { ...DEFAULT_LOOK, font: 'system' } });
  assert.equal(doc.font, 'system');
  const back = parseLookDocument(JSON.stringify(doc));
  assert.ok('ok' in back, /** @type {any} */ (back).error);
  assert.equal(back.look.font, 'system');
  assert.equal(buildLookDocument({ look: DEFAULT_LOOK }).font, 'deckhq');
  // A font this build does not have is REFUSED on import, as every key is.
  const odd = parseLookDocument(JSON.stringify({ ...doc, font: 'comic' }));
  assert.ok(!('ok' in odd) || odd.ok === false, 'an unknown font was imported');
});

test('applying a look sets the floor AND the chrome in its font, and an id that is not there is the default', () => {
  /** A root the way `document.documentElement` is one, as far as a look needs. */
  const root = {
    dataset: /** @type {Record<string, string>} */ ({}),
    style: { setProperty() {}, removeProperty() {} },
  };
  try {
    assert.equal(applyLook({ ...DEFAULT_LOOK, font: 'system' }, 'default', root).font, 'system');
    assert.equal(floorFont(), 'system');
    assert.equal(typeFont('agentName', 12), `600 12px ${FONT_FAMILIES.system.sans}`);
    // The chrome follows: the stylesheet's own variables are the default font,
    // and `data-font` names any other.
    assert.equal(root.dataset.font, 'system');
    assert.equal(applyLook(DEFAULT_LOOK, 'default', root).font, 'deckhq');
    assert.equal(floorFont(), 'deckhq');
    assert.equal('font' in root.dataset, false, 'the default font left a mark on the page');
    assert.equal(setFloorFont('nonsense'), 'deckhq');
    assert.equal(setFloorFont(null), 'deckhq');
  } finally {
    resetLook();
  }
  assert.equal(floorFont(), 'deckhq');
});

test('the Font row is under Advanced in the sheet — the product’s own face or the machine’s — and never in the popover', () => {
  const w = world();
  const root = w.sheet();
  assert.deepEqual(
    FONT_PICKER.options.map((o) => [o.id, o.label]),
    [
      ['deckhq', 'DeckHQ'],
      ['system', 'System'],
    ],
  );
  const row = group(root, 'Font');
  assert.ok(row, 'two fonts and no row to choose between them');
  assert.ok(advancedOf(root).contains(row), 'the font is a fine choice: it belongs under Advanced');
  assert.deepEqual(
    byRole(row, 'radio').map((b) => [b.textContent, b.getAttribute('aria-checked')]),
    [
      ['DeckHQ', 'true'],
      ['System', 'false'],
    ],
  );
  w.bar.open();
  assert.equal(group(w.popoverEl, 'Font'), undefined, 'the popover grew a sixth control');
});
