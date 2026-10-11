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
import { PLATE_KINDS, PLATE_ROLES, PLATE_ROWS } from '../../public/render/scene-labels.js';
import {
  DEFAULT_LOOK,
  FONT_PICKER,
  LOOK_PICKERS,
  normalizeLook,
} from '../../public/render/look-options.js';
import { applyLook, resetLook } from '../../public/render/look-derive.js';
import { buildLookDocument, parseLookDocument } from '../../src/core/look.mjs';
import { advancedOf, group, world } from '../helpers/look-surfaces.mjs';

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
  for (const name of ['roomCount', 'roomTokens', 'badge']) assert.ok(TYPE_ROLES[name].tabular);
  assert.deepEqual(
    Object.entries(TYPE_ROLES)
      .filter(([, r]) => r.family === 'mono')
      .map(([n]) => n),
    ['bubble'],
  );
});

test('a font is three families, and no family it names needs a file this build does not ship', () => {
  assert.deepEqual([...FONT_IDS], ['system'], 'one font today');
  assert.equal(DEFAULT_FONT, 'system');
  for (const [id, font] of Object.entries(FONT_FAMILIES)) {
    for (const key of ['sans', 'numeric', 'mono']) {
      assert.ok(font[key].split(',').length >= 3, `${id}.${key} has no fallbacks`);
      assert.doesNotMatch(
        font[key],
        /IBM Plex|JetBrains/,
        `${id}.${key} names a face nobody ships`,
      );
    }
    assert.match(font.mono, /monospace\s*$/);
    assert.match(font.sans, /sans-serif\s*$/);
    // The numeric family leads with faces whose default figures are tabular.
    assert.match(font.numeric, /^'Segoe UI', Roboto/);
  }
  // NO FONT FILE AND NO DOWNLOAD: nothing declares a face or fetches one.
  for (const file of ['public/style.css', 'public/index.html', 'public/render/floor-type.js']) {
    const text = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(text, /@font-face|fonts\.googleapis|\.woff2?\b/, file);
  }
});

test('every floor painter asks a role for its face: the canvas font is the role’s weight, size and family', () => {
  const f = FONT_FAMILIES.system;
  assert.equal(typeFont('roomName', 12.5, true), `700 12.50px ${f.sans}`);
  assert.equal(typeFont('roomCount', 14, true), `700 14.00px ${f.numeric}`);
  assert.equal(typeFont('agentName', 11.4), `600 11px ${f.sans}`);
  assert.equal(typeFont('bubble', 9), `500 9px ${f.mono}`);
  // The two helpers every older call site used are roles now, not faces.
  assert.equal(sansFont(12), typeFont('agentName', 12));
  assert.equal(monoFont(13), typeFont('badge', 13));
  assert.match(monoFont(13), /^700 13px 'Segoe UI'/, 'a wait is no longer a monospace');
  // A plate's four rows are four roles and four kinds of text, in step.
  assert.equal(PLATE_ROLES.length, PLATE_ROWS.length);
  assert.equal(PLATE_KINDS.length, PLATE_ROWS.length);
  for (const name of PLATE_ROLES) assert.ok(TYPE_ROLES[name], name);
  // And no painter names a family of its own any more.
  for (const file of fs.readdirSync(path.join(REPO, 'public/render'))) {
    if (!file.endsWith('.js') || file === 'floor-type.js') continue;
    const code = read(`public/render/${file}`).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, /sans-serif|monospace|system-ui/, `${file} names a font family`);
  }
});

test('the look carries a font: `system` by default, one of the fonts, and it survives export and import', () => {
  assert.equal(DEFAULT_LOOK.font, 'system');
  assert.equal(
    normalizeLook({}).font,
    'system',
    'a look saved before the key is the face it always was',
  );
  assert.equal(normalizeLook({ font: 'comic' }).font, 'system', 'an unknown font is the default');
  assert.deepEqual(
    FONT_PICKER.options.map((o) => o.id),
    [...FONT_IDS],
  );
  assert.ok(!LOOK_PICKERS.some((p) => p.id === 'font'), 'the font is counted among the materials');
  // Export, then import: the same document, the font in it.
  const doc = buildLookDocument({ look: DEFAULT_LOOK });
  assert.equal(doc.font, 'system');
  const back = parseLookDocument(JSON.stringify(doc));
  assert.ok('ok' in back, /** @type {any} */ (back).error);
  assert.equal(back.look.font, 'system');
  // A font this build does not have is REFUSED on import, as every key is.
  const odd = parseLookDocument(JSON.stringify({ ...doc, font: 'comic' }));
  assert.ok(!('ok' in odd) || odd.ok === false, 'an unknown font was imported');
});

test('applying a look sets the floor in its font, and an id that is not there is the default', () => {
  try {
    assert.equal(applyLook({ ...DEFAULT_LOOK, font: 'system' }, 'default').font, 'system');
    assert.equal(floorFont(), 'system');
    assert.equal(setFloorFont('nonsense'), 'system');
    assert.equal(setFloorFont(null), 'system');
  } finally {
    resetLook();
  }
});

test('the Font row is drawn only where there is more than one font: today, nowhere', () => {
  const w = world();
  const root = w.sheet();
  assert.equal(FONT_PICKER.options.length, 1);
  assert.equal(group(root, 'Font'), undefined, 'a control with one answer was drawn');
  w.bar.open();
  assert.equal(group(w.popoverEl, 'Font'), undefined);
  assert.ok(advancedOf(root), 'and Advanced is still there for the rest');
});
