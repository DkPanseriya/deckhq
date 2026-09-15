// A machine of our own, before anything under `src/` is loaded.
// `docs/DEVIATIONS.md` §124.
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_RUG_TONES,
  RUG_BAND_MAX,
  RUG_BAND_MIN,
  RUG_GROUNDS,
  RUG_READS_MAX,
  RUG_READS_MIN,
  RUG_TONE_IDS,
  THEMES,
  contrastRatio,
  materialTokensFor,
  rugParameterFor,
} from '../../public/render/themes.js';
import { DEFAULT_PALETTE } from '../../public/render/palette.js';

/** The rug a role is painted in, off a derived token set. @param {any} d @param {string} role */
const rugOf = (d, role) => (role === 'wool' ? d.rugCream : d.rugSage);

test('§1.d: both rugs read against the floor they lie on, on every shipped theme', () => {
  for (const theme of THEMES) {
    const derived = materialTokensFor(theme);
    for (const [role, groundKey] of Object.entries(RUG_GROUNDS)) {
      const ratio = contrastRatio(rugOf(derived, role), theme.floor[groundKey]);
      assert.ok(
        ratio >= RUG_BAND_MIN && ratio <= RUG_BAND_MAX,
        `${theme.name}: the ${role} rug is ${ratio.toFixed(2)}:1 on the ${groundKey}, outside ` +
          `[${RUG_BAND_MIN}, ${RUG_BAND_MAX}]`,
      );
    }
  }
});

test('the two failures §1.d measured are fixed, and by the bisection rather than by hand', () => {
  // The numbers this replaces, so the test says what it is for: the wool rug was
  // 1.00:1 on night shift (invisible) and the task rug 1.69:1 on blueprint (the
  // loudest local contrast in a project room). Both came through a constant.
  const night = materialTokensFor(/** @type {any} */ (THEMES.find((t) => t.name === 'night shift')));
  const blueprint = materialTokensFor(
    /** @type {any} */ (THEMES.find((t) => t.name === 'blueprint')),
  );
  const nightFloor = /** @type {any} */ (THEMES.find((t) => t.name === 'night shift')).floor;
  const blueFloor = /** @type {any} */ (THEMES.find((t) => t.name === 'blueprint')).floor;

  const woolOnNight = contrastRatio(night.rugCream, nightFloor.wood);
  const taskOnBlueprint = contrastRatio(blueprint.rugSage, blueFloor.carpet);
  assert.ok(woolOnNight > 1.06, `night shift's wool rug is still ${woolOnNight.toFixed(2)}:1`);
  assert.ok(
    taskOnBlueprint < 1.45,
    `blueprint's task rug is still ${taskOnBlueprint.toFixed(2)}:1`,
  );
  // And they land inside the narrower band the derivation aims at, so a small
  // change elsewhere cannot push either back over a refusal.
  for (const ratio of [woolOnNight, taskOnBlueprint]) {
    assert.ok(ratio >= RUG_READS_MIN - 0.01 && ratio <= RUG_READS_MAX + 0.01);
  }
});

test('a rug that already reads is returned untouched — which is what keeps the goldens still', () => {
  // The default theme's two rugs are inside the reads band, so the solver must
  // return the shipped constant and the floor must not move by one channel.
  const derived = materialTokensFor(THEMES[0]);
  assert.equal(derived.rugSage, DEFAULT_PALETTE.rugSage);
  assert.equal(derived.rugCream, DEFAULT_PALETTE.rugCream);
  assert.equal(derived.rugBorder, DEFAULT_PALETTE.rugBorder);
});

test('`rugParameterFor` solves for the ratio, and returns `wanted` when nothing can', () => {
  // A colour that does not move with the parameter: no parameter can reach the
  // band, so the derivation hands back what it was asked for and leaves the
  // refusal to `validateLook`. A clamp here would hide the failure.
  const flat = () => '#808080';
  assert.equal(rugParameterFor(flat, 0.3, 0, 0.6, '#808080'), 0.3);
  // And a monotone family lands on the band edge rather than past it.
  const ramp = (/** @type {number} */ p) =>
    `#${Math.round(128 + p * 120)
      .toString(16)
      .padStart(2, '0')
      .repeat(3)}`;
  const p = rugParameterFor(ramp, 1, 0, 1, '#808080');
  assert.ok(contrastRatio(ramp(p), '#808080') <= RUG_READS_MAX + 1e-6);
});

test('the three rug tones are a table, and the shipped pair is two of them', () => {
  assert.deepEqual([...RUG_TONE_IDS], ['wool', 'sage', 'sand']);
  assert.deepEqual({ ...DEFAULT_RUG_TONES }, { wool: 'wool', task: 'sage' });
  // A tone reaches the tokens the renderer paints from, and each ROLE is cut
  // against its own floor — so the same tone in both roles is two colours.
  const sand = materialTokensFor(THEMES[0], { rugs: { wool: 'sand', task: 'sand' } });
  assert.notEqual(sand.rugCream, DEFAULT_PALETTE.rugCream);
  assert.notEqual(sand.rugSage, DEFAULT_PALETTE.rugSage);
  for (const [role, groundKey] of Object.entries(RUG_GROUNDS)) {
    const ratio = contrastRatio(rugOf(sand, role), THEMES[0].floor[groundKey]);
    assert.ok(ratio >= RUG_BAND_MIN && ratio <= RUG_BAND_MAX, `sand in ${role}: ${ratio}`);
  }
});
