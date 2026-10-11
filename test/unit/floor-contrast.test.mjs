/**
 * EVERY KIND OF TEXT ON THE FLOOR READS, IN EVERY LIGHT AND STYLE A PERSON CAN
 * REACH — four lights by eleven styles, forty-four floors.
 *
 * The owner's screenshot: the night shift, an office full of waiting agents,
 * and their names white inside a heavy white halo — blurred, doubled, and
 * unreadable. The halo was a constant; the ink was the theme's. Nothing
 * measured the pair.
 *
 * This does. For each of the forty-four it resolves the floor the way the tab
 * does (`applyLook`), asks `floor-type.js` what each kind of text is painted
 * with — the same function the painters call — and holds the ink to 4.5:1
 * against what is ACTUALLY behind its glyphs: the backing (a halo, a soft
 * plate, a chip's fill) composited over the darkest and over the lightest
 * surface on that floor, because a name is drawn wherever its agent stands and
 * a leader line carries it over a table.
 *
 * Pure arithmetic over the palette: no canvas and no pixels.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE } from '../../public/render/palette.js';
import { contrastRatio, mix, relativeLuminance } from '../../public/render/themes-derive.js';
import { PRESETS, lookForPreset } from '../../public/render/look-options.js';
import { applyLook, resetLook } from '../../public/render/look-derive.js';
import { TEXT_KINDS, opaqueOf, textPaint } from '../../public/render/floor-type.js';
import { barSymbolInk } from '../../public/render/room-header.js';
import { LIGHTINGS } from '../../public/look-ui-store.js';

/** WCAG's floor for text. */
const AA = 4.5;
/** The states whose figure wears a wait badge: the two that ask for a person. */
const BADGE_STATES = Object.freeze(['needs_input', 'for_review']);

/** The alpha of an `rgba()`, or 1 for anything opaque. */
function alphaOf(/** @type {string} */ colour) {
  const m = /^rgba\([^)]*,\s*([\d.]+)\s*\)$/.exec(String(colour));
  return m ? Number(m[1]) : 1;
}

/** A backing as it is seen: its own colour, at its alpha, over a ground. */
const seenOver = (/** @type {string} */ backing, /** @type {string} */ ground) =>
  mix(ground, opaqueOf(backing), alphaOf(backing));

/** The darkest and the lightest opaque surface of the floor now in force. */
function extremes() {
  const flats = Object.values(PALETTE).filter((c) => /^#[0-9a-f]{6}$/i.test(String(c)));
  const byLight = [...flats].sort((a, b) => relativeLuminance(a) - relativeLuminance(b));
  return [byLight[0], byLight.at(-1)];
}

/**
 * The floors a room plate is set on: every zone's field as the look resolved
 * it, and each again under that look's patch of daylight — the lightest a
 * floor gets, which is what a pale ink has to survive on a dark one.
 * @param {any} resolved what `applyLook` answered with
 */
function plateFloors(resolved) {
  const fields = Object.values(resolved.zones || {})
    .map((/** @type {any} */ z) => z.field)
    .filter((c) => /^#[0-9a-f]{6}$/i.test(String(c)));
  const layer = resolved.light && resolved.light.layer;
  const lit = layer ? fields.map((f) => seenOver(layer, f)) : [];
  return [...new Set([...fields, ...lit])];
}

/**
 * Every (kind, ground) pair on one floor, measured.
 * @param {any} resolved what `applyLook` answered with
 * @returns {Array<{what:string, ratio:number}>}
 */
function measureFloor(resolved) {
  const out = [];
  const anywhere = extremes();
  const floors = plateFloors(resolved);
  assert.ok(floors.length >= 3, 'a floor has an office, a corridor and rooms');
  for (const kind of TEXT_KINDS) {
    for (const state of kind === 'badge' ? BADGE_STATES : [undefined]) {
      const { ink, backing } = textPaint(kind, state);
      // Backed text is read against its backing, over anything at all. Text
      // set BARE — a room's name and its count — is read against the floor
      // of the room it names, and against nothing else: a plate is never
      // over furniture.
      for (const ground of backing ? anywhere : floors) {
        const behind = backing ? seenOver(backing, ground) : ground;
        out.push({
          what: `${kind}${state ? ` (${state})` : ''}: ${ink} on ${backing || 'the bare floor'} over ${ground}`,
          ratio: contrastRatio(opaqueOf(ink), behind),
        });
      }
    }
  }
  return out;
}

test('4 LIGHTS x 11 STYLES: every kind of floor text is at least 4.5:1 against what is behind it', (t) => {
  assert.equal(LIGHTINGS.length * PRESETS.length, 44, 'the combinations a person can reach');
  /** @type {string[]} */
  const failed = [];
  let worst = { ratio: Infinity, where: '' };
  let floors = 0;
  try {
    for (const mood of LIGHTINGS) {
      for (const preset of PRESETS) {
        const look = lookForPreset(preset.id);
        const resolved = applyLook(mood.light ? { ...look, light: mood.light } : look, mood.theme);
        floors++;
        const where = `${mood.label} x ${preset.label}`;
        const measured = measureFloor(resolved);
        const low = measured.filter((m) => m.ratio < AA);
        for (const m of measured) {
          if (m.ratio < worst.ratio) worst = { ratio: m.ratio, where: `${where} — ${m.what}` };
        }
        if (low.length) {
          const least = low.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
          failed.push(
            `${where}: ${low.length} unreadable, worst ${least.ratio.toFixed(2)}:1 — ${least.what}`,
          );
        }
      }
    }
  } finally {
    resetLook();
  }
  t.diagnostic(`${floors} floors measured; ${failed.length} with text under ${AA}:1`);
  t.diagnostic(`the least readable text anywhere: ${worst.ratio.toFixed(2)}:1 (${worst.where})`);
  assert.deepEqual(failed, [], `${failed.length} of ${floors} floors have unreadable text`);
});

test('THE BACKING RULE: light text sits on a dark backing and dark text on a light one, on every floor', () => {
  try {
    for (const mood of LIGHTINGS) {
      for (const preset of PRESETS) {
        applyLook(lookForPreset(preset.id), mood.theme);
        for (const kind of TEXT_KINDS) {
          const { ink, backing } = textPaint(kind, 'for_review');
          if (!backing) continue; // set bare: measured against its floors, above
          const inkLight = relativeLuminance(opaqueOf(ink)) > relativeLuminance(opaqueOf(backing));
          // The two are on opposite sides of each other, and far apart: a halo
          // the ink's own tone is the bug this file exists for.
          assert.ok(
            contrastRatio(opaqueOf(ink), opaqueOf(backing)) >= AA,
            `${mood.label} x ${preset.label}: ${kind} is ${ink} on ${backing}` +
              ` — ${inkLight ? 'light on light' : 'dark on dark'}`,
          );
        }
      }
    }
  } finally {
    resetLook();
  }
});

// ---------------------------------------------------------- the room header

/** WCAG's floor for a graphic that carries meaning: a symbol, not a letter. */
const GRAPHIC = 3;
/** The states whose own symbol stands in a slot, in that state's colour. */
const SYMBOL_STATES = Object.freeze(['working', 'stalled', 'needs_input', 'for_review']);

test('THE ROOM HEADER: every symbol is 3:1 on its bar, in every light and style, with rooms zoned and not', (t) => {
  let worst = { ratio: Infinity, where: '' };
  let floors = 0;
  try {
    for (const mood of LIGHTINGS) {
      for (const preset of PRESETS) {
        for (const roomTint of ['subtle', 'zoned']) {
          const look = { ...lookForPreset(preset.id), roomTint };
          applyLook(mood.light ? { ...look, light: mood.light } : look, mood.theme);
          floors++;
          const bar = /** @type {string} */ (textPaint('barTitle').backing);
          // What a symbol is drawn in: a state's own colour while its count is
          // not zero, the bar's ink otherwise, and the dim ink at zero.
          const inks = [
            ...SYMBOL_STATES.map((s) => [s, barSymbolInk(s)]),
            ['a count', textPaint('barCount').ink],
            ['a zero', textPaint('barDim').ink],
          ];
          for (const ground of extremes()) {
            const behind = seenOver(bar, ground);
            for (const [what, ink] of inks) {
              const ratio = contrastRatio(opaqueOf(ink), behind);
              const where = `${mood.label} x ${preset.label} x ${roomTint}: ${what} ${ink} on ${behind}`;
              if (ratio < worst.ratio) worst = { ratio, where };
              assert.ok(ratio >= GRAPHIC, `${where} is ${ratio.toFixed(2)}:1`);
            }
          }
        }
      }
    }
  } finally {
    resetLook();
  }
  assert.equal(floors, 88);
  t.diagnostic(`the faintest symbol on any bar: ${worst.ratio.toFixed(2)}:1 (${worst.where})`);
});

test('THE ROOM HEADER does not out-shout the walls: its ground is never brighter than the wall it hangs under', () => {
  try {
    for (const mood of LIGHTINGS) {
      for (const preset of PRESETS) {
        applyLook(lookForPreset(preset.id), mood.theme);
        const bar = opaqueOf(/** @type {string} */ (textPaint('barTitle').backing));
        const wall = PALETTE.wallFill;
        // The same surface on a light floor, and on a dark one no brighter:
        // a header is signage on the wall's own tone, never a lamp.
        assert.ok(
          relativeLuminance(bar) <= relativeLuminance(wall) + 0.02,
          `${mood.label} x ${preset.label}: the bar ${bar} is brighter than the wall ${wall}`,
        );
      }
    }
  } finally {
    resetLook();
  }
});
