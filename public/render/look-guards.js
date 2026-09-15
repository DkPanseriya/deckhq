/**
 * THE LOOK GUARDS — WP-88a. `docs/plan/11-LOOK-CONTROL-CENTRE.md` §1's
 * mix-and-match rules, as measurements.
 *
 * ## A refusal changes nothing, and says why
 *
 * `validateLook` returns `{ok, problems}` rather than throwing, and every
 * problem names the PICKER it belongs to, the option that caused it, what was
 * measured and what was needed — because the surface this feeds (WP-88b) shows a
 * refusal *in its own row*, next to the control that would have caused it, and
 * leaves the control where it was. That is `validateLayout`'s whole-or-one-error
 * discipline applied to a picker: **a refused combination is refused, never
 * clamped.** A clamp would give the user a floor that matched neither what they
 * chose nor what they had, with nothing said about which.
 *
 * ## Why most of this is not an enumeration
 *
 * §1 rule 1 — *"no choice changes lightness"* — is what makes the option space
 * safe by construction: schemes lock luminance, floors derive from the tokens,
 * sets are paint. So the guards below are not a sweep of 162 combinations
 * looking for one that fails; they are the handful of properties that are NOT
 * tautologies once the lock holds. `look-guards.test.mjs` enumerates all 162
 * anyway, because a safety argument nobody re-measured is a hypothesis
 * (`08-PLAN-V2-100X.md` §1.1 rule 11).
 *
 * Pure data and pure functions. No DOM, no canvas.
 */

import { assertMaterialDiscipline, PROJECT_IDENTITIES, washedCarpet } from './palette.js';
import {
  BOARD_MAX_INTERNAL_CONTRAST,
  RUG_BAND_MAX,
  RUG_BAND_MIN,
  THEMES,
  assertThemeContrast,
  contrastRatio,
  interiorHighlights,
  lightInkFor,
  pooled,
  relativeLuminance,
  themeByName,
} from './themes.js';
import {
  FLOOR_MATERIALS,
  LOOK_ZONES,
  LOUNGE_KIT_REQUIRED,
  SCHEMES,
  SCHEME_MAX_LUMINANCE_DRIFT,
  SCHEME_SURFACES,
  ZONE_ADJACENCY,
} from './look-options.js';
import { resolveLook, schemeColour } from './look-derive.js';

/**
 * §1 rule 2. *"Adjacent zones separate by pattern and temperature, not by
 * value."* The intent is under 1.35; 1.60 is where it is refused.
 */
export const ZONE_EDGE_MAX = 1.6;

/**
 * §1 rule 3's second clause. Two adjacent zones that share a tone source — a
 * loop-pile corridor beside a broadloom room, both off `carpet` — still have to
 * separate by SOMETHING, and at 1.00:1 the pattern is doing all of it. A
 * hairline of value is what makes a boundary survive the fit scale.
 */
export const ZONE_EDGE_MIN = 1.04;

/**
 * §1.a's speck ceiling. A chip under 0.3 U is a speck the eye integrates rather
 * than a field, so it gets its own, looser ceiling than
 * `BOARD_MAX_INTERNAL_CONTRAST`. Measured worst over the 162: 1.93:1, a terrazzo
 * chip against its own ground.
 */
export const SPECK_MAX_CONTRAST = 2;

/** The floor a rug ROLE actually lies on, in ZONES rather than in tokens (§1.d). */
export const RUG_ZONES = Object.freeze({ wool: ['office', 'lounge'], task: ['rooms'] });

/**
 * @typedef {object} LookProblem
 * @property {string} picker   which control this belongs to
 * @property {string} option   the option that caused it
 * @property {string} rule     the rule in §1 it breaks
 * @property {number|null} measured
 * @property {number|null} needed
 * @property {string} reason   one sentence, for the row
 */

/**
 * Measure a look against a theme.
 *
 * @param {unknown} look
 * @param {unknown} [theme] a theme name or document; the default theme if absent
 * @returns {{ok:boolean, problems:LookProblem[], resolved:ReturnType<typeof resolveLook>}}
 */
export function validateLook(look, theme) {
  const doc =
    theme && typeof theme === 'object' && /** @type {any} */ (theme).floor
      ? /** @type {any} */ (theme)
      : themeByName(theme) || THEMES[0];
  const resolved = resolveLook(look, doc);
  /** @type {LookProblem[]} */
  const problems = [];
  /** @param {LookProblem} p */
  const fail = (p) => problems.push(p);

  const floor = resolved.floor;
  const wallLuminance = relativeLuminance(floor.wall);
  const lightInk = lightInkFor(floor.ink);

  // ---- rule 1: no choice changes lightness. The scheme, re-measured.
  //
  // A tautology if the bisection in `look-derive.js` is right, and that is
  // exactly why it is measured: the whole safety argument for 162 combinations
  // rests on this one number, and an argument nobody checks is a hypothesis.
  const scheme = SCHEMES[resolved.look.scheme] || SCHEMES.warm;
  const bare = { ...THEMES[0].floor, ...doc.floor };
  for (const key of [...SCHEME_SURFACES, 'plant']) {
    const before = relativeLuminance(bare[key]);
    const after = relativeLuminance(schemeColour(bare[key], scheme, key !== 'plant'));
    const drift = Math.abs(after - before);
    if (drift > SCHEME_MAX_LUMINANCE_DRIFT) {
      fail({
        picker: 'scheme',
        option: resolved.look.scheme,
        rule: '§1 rule 1 — no choice changes lightness',
        measured: Number(drift.toFixed(5)),
        needed: SCHEME_MAX_LUMINANCE_DRIFT,
        reason: `the ${resolved.look.scheme} scheme moves the ${key}'s relative luminance by ${drift.toFixed(4)}; a scheme is a temperature, not a repaint`,
      });
    }
  }

  // ---- the WP-85a guards, over the SCHEMED floor.
  //
  // `assertThemeContrast` throws with the failing pair named, and the one thing
  // a picker must not do is throw — so it becomes a row on the scheme, which is
  // the only control that can move a theme's own tokens.
  try {
    assertThemeContrast({
      name: `${doc.name} + ${resolved.look.scheme}`,
      floor,
      chrome: doc.chrome,
    });
  } catch (err) {
    fail({
      picker: 'scheme',
      option: resolved.look.scheme,
      rule: '§1 rule 6 — ink >= 4.5:1 on every material',
      measured: null,
      needed: null,
      reason: String(/** @type {any} */ (err)?.message || err),
    });
  }
  try {
    assertMaterialDiscipline(resolved.tokens, 'look');
  } catch (err) {
    fail({
      picker: 'scheme',
      option: resolved.look.scheme,
      rule: '§1 rule 5 — the crimson bar',
      measured: null,
      needed: null,
      reason: String(/** @type {any} */ (err)?.message || err),
    });
  }

  // ---- rules 2 and 3: the zone edges.
  for (const [a, b] of ZONE_ADJACENCY) {
    const left = resolved.zones[a];
    const right = resolved.zones[b];
    const ratio = contrastRatio(left.field, right.field);
    if (left.id === right.id) {
      fail({
        picker: `floor.${b}`,
        option: right.id,
        rule: '§1 rule 3 — two adjacent zones may not share a floor',
        measured: 1,
        needed: null,
        reason: `the ${b} and the ${a} are both ${right.label}; the ${b} would vanish into the ${a}`,
      });
    } else if (left.source === right.source && ratio < ZONE_EDGE_MIN - 1e-9) {
      fail({
        picker: `floor.${b}`,
        option: right.id,
        rule: '§1 rule 3 — a shared tone source still needs an edge',
        measured: Number(ratio.toFixed(3)),
        needed: ZONE_EDGE_MIN,
        reason: `${right.label} in the ${b} is ${ratio.toFixed(2)}:1 against ${left.label} in the ${a}; they share a tone source and the boundary would not survive the fit scale`,
      });
    }
    if (ratio > ZONE_EDGE_MAX + 1e-9) {
      fail({
        picker: `floor.${b}`,
        option: right.id,
        rule: '§1 rule 2 — zone edge <= 1.60:1',
        measured: Number(ratio.toFixed(3)),
        needed: ZONE_EDGE_MAX,
        reason: `${right.label} in the ${b} is ${ratio.toFixed(2)}:1 against ${left.label} in the ${a}; adjacent zones separate by pattern and temperature, not by value`,
      });
    }
  }

  // ---- every material: its field spread, its specks, and the wall above it.
  for (const zone of LOOK_ZONES) {
    const material = resolved.zones[zone];
    const tones = material.tones;
    for (let i = 0; i < tones.length; i++) {
      for (let j = i + 1; j < tones.length; j++) {
        const ratio = contrastRatio(tones[i], tones[j]);
        if (ratio > BOARD_MAX_INTERNAL_CONTRAST + 1e-9) {
          fail({
            picker: `floor.${zone}`,
            option: material.id,
            rule: '§1.a — a floor lives in one value plateau',
            measured: Number(ratio.toFixed(3)),
            needed: BOARD_MAX_INTERNAL_CONTRAST,
            reason: `${material.label}'s own tones are ${ratio.toFixed(2)}:1 apart; the ground is quiet so the objects can speak`,
          });
        }
      }
    }
    for (const speck of material.specks) {
      const ratio = contrastRatio(speck, material.field);
      if (ratio > SPECK_MAX_CONTRAST + 1e-9) {
        fail({
          picker: `floor.${zone}`,
          option: material.id,
          rule: '§1.a — a speck is integrated, not read',
          measured: Number(ratio.toFixed(3)),
          needed: SPECK_MAX_CONTRAST,
          reason: `a ${material.label} fleck is ${ratio.toFixed(2)}:1 against its own ground`,
        });
      }
    }
    for (const colour of [material.field, ...material.tones, ...material.specks]) {
      if (relativeLuminance(colour) > wallLuminance + 1e-9) {
        fail({
          picker: `floor.${zone}`,
          option: material.id,
          rule: '§1 rule 5 — nothing is brighter than the wall',
          measured: Number(relativeLuminance(colour).toFixed(4)),
          needed: Number(wallLuminance.toFixed(4)),
          reason: `${material.label} (${colour}) in the ${zone} is brighter than the wall (${floor.wall}); the wall is the top of a room's value range`,
        });
      }
    }
    // ---- rule 6: ink on the material, on its pooled composite, and — where the
    // zone is a project room — on all fourteen identity washes of it.
    /** @type {string[]} */
    const grounds = [material.field, pooled(material.field, lightInk)];
    if (zone === 'rooms') {
      for (const identity of PROJECT_IDENTITIES)
        grounds.push(washedCarpet(material.field, identity.accent));
    }
    for (const ground of grounds) {
      const ratio = contrastRatio(floor.ink, ground);
      if (ratio + 1e-9 < 4.5) {
        fail({
          picker: `floor.${zone}`,
          option: material.id,
          rule: '§1 rule 6 — ink >= 4.5:1 on every material',
          measured: Number(ratio.toFixed(2)),
          needed: 4.5,
          reason: `a name on ${material.label} (${ground}) is ${ratio.toFixed(2)}:1; an agent's name is drawn wherever the agent stands`,
        });
      }
    }
  }

  // ---- rule 4: the rug band, against the floors the rug ACTUALLY lies on.
  //
  // Not against the theme's `wood` and `carpet`, which is what the derivation
  // solves against: a look may have put polished concrete in the project rooms,
  // and *"sage on polished concrete is 1.01:1 — the rug would not read"* is one
  // of the two refusals §1.d names.
  for (const [role, zones] of Object.entries(RUG_ZONES)) {
    const rug = resolved.rugs[role];
    // By MATERIAL rather than by zone: a wool rug lies in the reception and in
    // the lounge, and where those are the same floor it is one measurement and
    // one row, not the same sentence printed twice.
    const seen = new Set();
    for (const zone of zones) {
      const material = resolved.zones[zone];
      if (seen.has(material.id)) continue;
      seen.add(material.id);
      const ratio = contrastRatio(rug.colour, material.field);
      if (ratio + 1e-9 < RUG_BAND_MIN || ratio - 1e-9 > RUG_BAND_MAX) {
        fail({
          picker: `rug.${role}`,
          option: rug.tone,
          rule: '§1 rule 4 — rug on floor in [1.06, 1.45]',
          measured: Number(ratio.toFixed(3)),
          needed: ratio < RUG_BAND_MIN ? RUG_BAND_MIN : RUG_BAND_MAX,
          reason:
            ratio < RUG_BAND_MIN
              ? `${rug.tone} on ${material.label} is ${ratio.toFixed(2)}:1 — the rug would not read`
              : `${rug.tone} on ${material.label} is ${ratio.toFixed(2)}:1 — the rug would be the loudest thing in the room`,
        });
      }
    }
  }

  // ---- and the rest of a furnished room, at its brightest.
  for (const [name, colour] of Object.entries(interiorHighlights(resolved.tokens, floor))) {
    if (relativeLuminance(colour) > wallLuminance + 1e-9) {
      fail({
        picker: 'furniture',
        option: resolved.look.furniture,
        rule: '§1 rule 5 — nothing is brighter than the wall',
        measured: Number(relativeLuminance(colour).toFixed(4)),
        needed: Number(wallLuminance.toFixed(4)),
        reason: `${name} (${colour}) is brighter than the wall (${floor.wall})`,
      });
    }
  }

  // ---- §1.g: the lounge keeps somewhere to sit.
  if (!resolved.lounge.on[LOUNGE_KIT_REQUIRED]) {
    fail({
      picker: 'lounge',
      option: LOUNGE_KIT_REQUIRED,
      rule: '§1.g — the sitting bay is the fallback',
      measured: null,
      needed: null,
      reason: 'a lounge with no place to sit is a field again',
    });
  }

  return { ok: problems.length === 0, problems, resolved };
}

/**
 * Every material × scheme × theme combination §1's measurement covers: nine
 * materials, six schemes, three themes.
 *
 * Stated here rather than in the test so the product and its proof enumerate the
 * same set — the shape of `GROUND_KEYS` and `interiorHighlights`, applied to an
 * option space.
 *
 * @returns {Array<{material:string, scheme:string, theme:string}>}
 */
export function materialSchemeThemeGrid() {
  /** @type {Array<{material:string, scheme:string, theme:string}>} */
  const out = [];
  for (const theme of THEMES) {
    for (const scheme of Object.keys(SCHEMES)) {
      for (const material of Object.keys(FLOOR_MATERIALS)) {
        out.push({ material, scheme, theme: theme.name });
      }
    }
  }
  return out;
}
