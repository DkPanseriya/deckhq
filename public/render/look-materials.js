/**
 * THE NINE FLOOR MATERIALS, AND THE FOUR ZONES THEY ARE CHOSEN FOR — WP-88a.
 * `docs/plan/11-LOOK-CONTROL-CENTRE.md` §1.a.
 *
 * Split out of `look-options.js` unchanged, for the reason `plan-shapes.js` was
 * split out of `plan-units.js`: the catalogue is the whole of §1 and the
 * material table alone is a third of it, which put one file over WP-22's
 * 900-line ceiling. `look-options.js` re-exports every name here, so nothing
 * that reads the catalogue has to know the split happened.
 *
 * Pure data and pure functions. No DOM, no canvas.
 */

import { mix, shade } from './themes.js';

// --------------------------------------------------------------- the zones

/**
 * THE FOUR ZONES A FLOOR MATERIAL IS CHOSEN FOR (§1.a).
 *
 * Not four rooms: four USES. The office is the reception and its well, `rooms`
 * is every project room, `corridor` is the circulation between them, and
 * `lounge` is the break room including the bays inside it. The café's tile is
 * not on this list and cannot be — it is a kitchen, and a kitchen has a floor
 * the rest of a lounge does not.
 * @type {ReadonlyArray<string>}
 */
export const LOOK_ZONES = Object.freeze(['office', 'corridor', 'rooms', 'lounge']);

/**
 * WHICH ZONES ACTUALLY TOUCH, stated rather than inferred (§1 rule 3).
 *
 * *"Two adjacent zones may not use the same floor option — the corridor would
 * vanish into the office."* Which pairs are adjacent is a fact about the PLAN:
 * `plan.js` deals rooms into bands with circulation between them, so the
 * corridor touches everything and nothing else touches anything. An office that
 * shared a material with a project room two bands away is two rooms that look
 * alike, which is fine; an office that shared one with the corridor outside its
 * door is a floor with no door in it.
 * @type {ReadonlyArray<readonly [string, string]>}
 */
export const ZONE_ADJACENCY = Object.freeze([
  Object.freeze(/** @type {const} */ (['office', 'corridor'])),
  Object.freeze(/** @type {const} */ (['corridor', 'rooms'])),
  Object.freeze(/** @type {const} */ (['corridor', 'lounge'])),
]);

// ---------------------------------------------------------- floor materials

/**
 * NINE PAINTERS, EACH A PATTERN RULE IN PLAN UNITS (§1.a).
 *
 * A unit is about 0.30 m, so every number in `pattern` is a claim about a real
 * floor anybody can check against a real building — and stating them in units
 * rather than in baked pixels means a bake at any `u` lays the same floor rather
 * than the same bitmap (`backdrop-floor.js`'s own rule, WP-85a).
 *
 * `from` is the whole of a material's colour: it takes the theme's eleven
 * tokens, already transformed by the scheme, and returns the field this floor is
 * painted in. **Nothing else may enter.** A material with a colour of its own
 * would be a material that survived a theme, which is the one thing the floor
 * is not allowed to have.
 *
 * `tones` is the family the pattern lays in that field and `specks` the flecks
 * and chips it scatters over it. They are separate because they are held to
 * different ceilings: a tone is a FIELD and lives under 1.14:1, a speck under
 * 0.3 U is a speck the eye integrates rather than a field and lives under 2.0:1.
 *
 * `source` is the token a material is mostly made of, and it exists for one
 * clause of one rule: §1 rule 3's *"if they share a tone source their edge must
 * still reach 1.04:1"*. Two materials off the same token separate by pattern
 * alone unless somebody measures, and pattern is the first thing the fit scale
 * takes away. Two materials off DIFFERENT tokens are already two materials, and
 * holding them to the same floor would refuse the shipped floor, whose screed
 * corridor sits 1.02:1 from its oak office and has since the first capture.
 *
 * @type {Readonly<Record<string, {
 *   id:string, label:string, zones:ReadonlyArray<string>, painter:string,
 *   source:string, pattern:Readonly<Record<string, number>>,
 *   from:(f:Record<string,string>) => string,
 *   tones:(field:string) => string[],
 *   specks:(field:string, f:Record<string,string>) => string[]}>>}
 */
export const FLOOR_MATERIALS = Object.freeze(
  /** @type {any} */ (
    Object.fromEntries(
      [
        {
          id: 'herringbone-oak',
          label: 'Herringbone oak',
          zones: ['office', 'lounge'],
          painter: 'herringbone',
          source: 'wood',
          // 1.71 U cell, block 2.43 x 0.82 U at 45 degrees, four tones +/-0.03,
          // seam 0.8 px at 0.20. The floor as it ships (WP-85a §3.2).
          pattern: { cellU: 24 / 14, blockL: 1.42, blockW: 0.48, seamU: 0.8 / 14, seam: 0.2 },
          from: (f) => f.wood,
          tones: (c) => [c, shade(c, -0.03), shade(c, 0.03), shade(c, -0.01)],
          specks: () => [],
        },
        {
          id: 'wide-ash',
          label: 'Wide ash boards',
          zones: ['office', 'rooms', 'lounge'],
          painter: 'boards',
          source: 'wood',
          // Planks 9 x 1.6 U on the long axis, ends staggered a third.
          pattern: { plankL: 9, plankW: 1.6, stagger: 1 / 3, seam: 0.16 },
          from: (f) => mix(f.wood, f.tile, 0.35),
          tones: (c) => [c, shade(c, -0.025), shade(c, 0.025), shade(c, 0.008)],
          specks: () => [],
        },
        {
          id: 'terrazzo',
          label: 'Terrazzo',
          zones: ['office', 'lounge'],
          painter: 'terrazzo',
          source: 'screed',
          // 220 seeded chips per 100 U^2, each 0.10-0.22 U, three chip tones,
          // no grid. A grid would make it tile; terrazzo is poured.
          pattern: { chipsPer100U2: 220, chipMinU: 0.1, chipMaxU: 0.22 },
          from: (f) => f.screed,
          tones: (c) => [c],
          // Three chips, and the ceiling they are held to is the SPECK ceiling.
          // §1.a measured the worst of them at 1.93:1 against its own ground.
          specks: (c, f) => [shade(c, 0.2), shade(c, -0.22), mix(c, f.desk, 0.45)],
        },
        {
          id: 'polished-concrete',
          label: 'Polished concrete',
          zones: ['office', 'corridor', 'rooms', 'lounge'],
          painter: 'concrete',
          source: 'screed',
          // One diagonal sheen, saw-cut joints on a 12 U grid at 0.10.
          pattern: { jointU: 12, joint: 0.1 },
          from: (f) => shade(f.screed, -0.04),
          tones: (c) => [c],
          specks: () => [],
        },
        {
          id: 'wool-broadloom',
          label: 'Wool broadloom',
          zones: ['office', 'rooms'],
          painter: 'carpet',
          source: 'carpet',
          // WP-85a's carpet: two hairline weave passes at a 0.21 U pitch.
          pattern: { pitchU: 3 / 14 },
          from: (f) => f.carpet,
          tones: (c) => [c],
          specks: () => [],
        },
        {
          id: 'loop-pile',
          label: 'Loop-pile tile',
          zones: ['corridor', 'rooms'],
          painter: 'loop-pile',
          source: 'carpet',
          // The same weave under a 6 U checker of alternating pile, +/-0.012.
          pattern: { pitchU: 3 / 14, checkerU: 6, pile: 0.012 },
          from: (f) => f.carpet,
          tones: (c) => [c, shade(c, 0.012), shade(c, -0.012)],
          specks: () => [],
        },
        {
          id: 'ceramic-tile',
          label: 'Ceramic tile',
          zones: ['corridor', 'lounge'],
          painter: 'tile',
          source: 'tile',
          // 1.57 U grid, hairline grout at 0.16 — the café's floor, offered to
          // the whole lounge and to the circulation.
          pattern: { cellU: 22 / 14, grout: 0.16 },
          from: (f) => f.tile,
          tones: (c) => [c],
          specks: () => [],
        },
        {
          id: 'poured-screed',
          label: 'Poured screed',
          zones: ['corridor'],
          painter: 'screed',
          source: 'screed',
          // Flat, one long sheen, speckle at 0.13. The circulation as it ships.
          pattern: { speckle: 0.13 },
          from: (f) => f.screed,
          tones: (c) => [c],
          specks: () => [],
        },
        {
          id: 'cork',
          label: 'Cork',
          zones: ['rooms', 'lounge'],
          painter: 'cork',
          source: 'wood',
          // Flat, seeded 0.16 x 0.07 U grain flecks at 0.14.
          pattern: { fleckLU: 0.16, fleckWU: 0.07, fleck: 0.14 },
          from: (f) => shade(mix(f.wood, f.carpet, 0.35), -0.03),
          tones: (c) => [c],
          specks: (c) => [shade(c, -0.16)],
        },
      ].map((m) => [m.id, Object.freeze({ ...m, zones: Object.freeze(m.zones) })]),
    )
  ),
);

/** Every material's id, in catalogue order. @type {ReadonlyArray<string>} */
export const FLOOR_MATERIAL_IDS = Object.freeze(Object.keys(FLOOR_MATERIALS));

/**
 * §1.a's zone column, inverted: what each picker may offer. Office 5, corridor
 * 4, rooms 5, lounge 6 — **no broadloom in the lounge**, because a lounge is a
 * hard floor with rugs on it.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const FLOOR_OPTIONS = Object.freeze(
  Object.fromEntries(
    LOOK_ZONES.map((zone) => [
      zone,
      Object.freeze(FLOOR_MATERIAL_IDS.filter((id) => FLOOR_MATERIALS[id].zones.includes(zone))),
    ]),
  ),
);
