/**
 * THE LOOK CATALOGUE — WP-88a. `docs/plan/11-LOOK-CONTROL-CENTRE.md` §1.
 *
 * The owner, 15 September 2026: *"We do not flood everything with too many
 * options; the interior designer carefully crafts options that can be mixed and
 * matched or customised."* This file is that craft, as a table.
 *
 * ============================================================================
 * WHAT A LOOK CANNOT DO, AND WHY IT CANNOT DO IT
 *
 * The same construction `themes.js` uses: **the option tables ARE the
 * allowlist.** There is no key here that names a state colour, the reserved
 * crimson, a project identity, the figure halo, room geometry, who sits where,
 * plate content, the camera or a type size — so a look document cannot carry
 * one. No colour picker, no image upload, no per-prop placement: a choice is a
 * named thing an interior designer would name, and every one of them is
 * measured (`look-guards.js`) before it is offered.
 *
 * A look is also not a theme. A floor material derives from the theme's own
 * eleven tokens and nothing else, and a colour SCHEME is a transform over those
 * eleven, so all three themes still apply on top and a pack theme gets the six
 * schemes for free.
 * ============================================================================
 *
 * ## The count, said out loud
 *
 * §1 promises *"52 options over ten pickers"*, and this is how the two numbers
 * are reached — stated here because the arithmetic is not obvious and a later
 * reader should not have to rediscover it:
 *
 *   four floor pickers, one per zone          5 + 4 + 5 + 6 = 20
 *   the colour scheme                                          6
 *   the furniture set                                          3
 *   the wool rug        3 tones + 2 patterns                   5
 *   the task rug        3 tones + 2 patterns                   5
 *   the planting        3 families + 3 densities               6
 *   the prop density                                           3
 *   ------------------------------------------------ ten pickers, 48 options
 *   the lounge kit      four checkboxes, not a picker (§1.g)    4
 *                                                             ---
 *                                                              52
 *
 * `LOOK_OPTION_COUNT` is computed from the tables rather than written down, so
 * the two can never disagree and a package that adds an option has to say so.
 *
 * Pure data and pure functions. No DOM, no canvas — safe to import under
 * `node --test` and from `src/core/look.mjs`, which is where the schema that
 * validates an imported document lives.
 */

import { mix, shade, RUG_TONE_IDS } from './themes.js';

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

// --------------------------------------------------------- colour schemes

/**
 * SIX SCHEMES, AS A TRANSFORM OVER THE THEME'S OWN ELEVEN TOKENS (§1.b).
 *
 * A scheme is not a theme, and that is owner decision 4: as themes they would be
 * eighteen palettes maintained by hand and a pack theme would get none of them.
 *
 * Each of the nine SURFACE tokens is mixed toward an anchor hue held at that
 * token's own lightness, its chroma is scaled, and the result is pushed back to
 * the token's original relative luminance by bisection — the device `underWall`
 * already uses. `ink` is untouched; `plant` takes the chroma factor but never
 * the hue, because foliage is not a finish.
 *
 * **The luminance lock is the whole safety argument.** A WCAG ratio depends only
 * on relative luminance, so a scheme that moves none leaves every measurement in
 * `assertThemeContrast` unchanged by construction, and the option space does not
 * have to be enumerated to be safe. `warm` is the identity transform: one of the
 * six has to be the door back, and it is the one the goldens are shot in.
 *
 * @type {Readonly<Record<string, {id:string, label:string, anchor:number|null,
 *   weight:number, chroma:number}>>}
 */
export const SCHEMES = Object.freeze(
  /** @type {any} */ (
    Object.fromEntries(
      [
        { id: 'warm', label: 'Warm', anchor: null, weight: 0, chroma: 1 },
        { id: 'cool', label: 'Cool', anchor: 205, weight: 0.55, chroma: 1.15 },
        { id: 'mono', label: 'Mono', anchor: null, weight: 0, chroma: 0.12 },
        { id: 'forest', label: 'Forest', anchor: 128, weight: 0.45, chroma: 1.05 },
        { id: 'clay', label: 'Clay', anchor: 18, weight: 0.55, chroma: 1.15 },
        { id: 'ink', label: 'Ink', anchor: 230, weight: 0.6, chroma: 0.85 },
      ].map((s) => [s.id, Object.freeze(s)]),
    )
  ),
);

/** Every scheme's id, in picker order. @type {ReadonlyArray<string>} */
export const SCHEME_IDS = Object.freeze(Object.keys(SCHEMES));

/** The nine surface tokens a scheme transforms. `ink` and `plant` are not in it. */
export const SCHEME_SURFACES = Object.freeze([
  'wood',
  'carpet',
  'screed',
  'ground',
  'tile',
  'wall',
  'partition',
  'desk',
  'seat',
]);

/** How far a scheme is allowed to move a token's relative luminance (§5). */
export const SCHEME_MAX_LUMINANCE_DRIFT = 0.01;

// ---------------------------------------------------------- furniture sets

/**
 * THREE SETS, SILHOUETTES ONLY (§1.c).
 *
 * *"Footprints, anchors and tokens do not move"*, so §3.4's sizes survive
 * intact and a plan-hash test proves the emitted plan is byte-identical across
 * the three. A set is PAINT, exactly as WP-85a was.
 *
 * Every field is a number or a flag a painter reads instead of a constant:
 * `radius` is a fraction of a piece's minimum dimension, `frame` the dark frame
 * line an industrial piece carries on every edge, `edgeBand` the lit band on a
 * table top, `arms` whether a sofa and an armchair are rolled, `brace` the
 * cross-brace under a desk, `uprights` whether a shelf shows its ends.
 *
 * @type {Readonly<Record<string, {id:string, label:string, radius:number,
 *   frame:number, edgeBand:number, arms:boolean, brace:boolean,
 *   uprights:boolean, seams:number, boardFelt:boolean}>>}
 */
export const FURNITURE_SETS = Object.freeze(
  /** @type {any} */ (
    Object.fromEntries(
      [
        {
          id: 'scandi',
          label: 'Scandi',
          radius: 0.18,
          frame: 0,
          edgeBand: 0.15,
          arms: false,
          brace: false,
          uprights: false,
          seams: 2,
          boardFelt: false,
        },
        {
          id: 'industrial',
          label: 'Industrial',
          radius: 0.1,
          frame: 0.2,
          edgeBand: 0.15,
          arms: false,
          brace: true,
          uprights: true,
          seams: 1,
          boardFelt: false,
        },
        {
          id: 'soft',
          label: 'Soft',
          radius: 0.42,
          frame: 0,
          edgeBand: 0.15,
          arms: true,
          brace: false,
          uprights: false,
          seams: 3,
          boardFelt: true,
        },
      ].map((s) => [s.id, Object.freeze(s)]),
    )
  ),
);

/** Every set's id, in picker order. @type {ReadonlyArray<string>} */
export const FURNITURE_SET_IDS = Object.freeze(Object.keys(FURNITURE_SETS));

// ------------------------------------------------------------------- rugs

/**
 * TWO PATTERNS (§1.d). **Plain** is the field plus a 0.4 U border — the rug as
 * it ships — and **banded** lays three 0.5 U bands at a sixth, a half and five
 * sixths of the short axis, each 0.02 off the field.
 *
 * The TONES are `RUG_TONES` in `themes.js` rather than here, because a tone is a
 * colour derivation and the derivation is where the bisection that makes it read
 * against its floor lives (§1.d, WP-88a's first job).
 *
 * @type {Readonly<Record<string, {id:string, label:string, borderU:number,
 *   bands:ReadonlyArray<number>, bandU:number, bandShade:number}>>}
 */
export const RUG_PATTERNS = Object.freeze(
  /** @type {any} */ (
    Object.fromEntries(
      [
        { id: 'plain', label: 'Plain', borderU: 0.4, bands: [], bandU: 0, bandShade: 0 },
        {
          id: 'banded',
          label: 'Banded',
          borderU: 0.4,
          bands: Object.freeze([1 / 6, 1 / 2, 5 / 6]),
          bandU: 0.5,
          bandShade: 0.02,
        },
      ].map((p) => [p.id, Object.freeze(p)]),
    )
  ),
);

/** Every pattern's id, in picker order. @type {ReadonlyArray<string>} */
export const RUG_PATTERN_IDS = Object.freeze(Object.keys(RUG_PATTERNS));

/** The two rug ROLES a look sets independently: reception and lounge, project rooms. */
export const RUG_ROLES = Object.freeze(['wool', 'task']);

// ----------------------------------------------------------------- plants

/**
 * THREE FAMILIES (§1.e), each supplying §3.6's three kinds at §3.6's footprints
 * — 2.0 / 2.4 / 3.2 U — and differing in SILHOUETTE and in a ±0.06 shade of
 * `plant`. A family may not change a footprint: the footprints are what
 * `interior.test.mjs` measures the density rules over.
 *
 * @type {Readonly<Record<string, {id:string, label:string, shade:number,
 *   broad:string, blade:string, tree:string}>>}
 */
export const PLANT_FAMILIES = Object.freeze(
  /** @type {any} */ (
    Object.fromEntries(
      [
        { id: 'leafy', label: 'Leafy', shade: 0, broad: 'lobes', blade: 'fronds', tree: 'canopy' },
        {
          id: 'architectural',
          label: 'Architectural',
          shade: -0.06,
          broad: 'discs',
          blade: 'blades',
          tree: 'dracaena',
        },
        { id: 'dry', label: 'Dry', shade: 0.06, broad: 'fine', blade: 'tuft', tree: 'column' },
      ].map((p) => [p.id, Object.freeze(p)]),
    )
  ),
);

/** Every family's id, in picker order. @type {ReadonlyArray<string>} */
export const PLANT_FAMILY_IDS = Object.freeze(Object.keys(PLANT_FAMILIES));

/**
 * THREE DENSITIES, AND EACH IS A CEILING RATHER THAN A QUOTA (§1.e).
 *
 * WP-85c's rules bind FIRST — one free-standing prop per 9 U² of clear floor, no
 * two identical silhouettes within 8 U, nothing within 1.2 U of a character — so
 * a small room never reaches `lush`. `normal` is what ships.
 *
 * @type {Readonly<Record<string, {id:string, label:string, room:number, bay:number,
 *   reception:number}>>}
 */
export const PLANT_DENSITIES = Object.freeze(
  /** @type {any} */ (
    Object.fromEntries(
      [
        { id: 'sparse', label: 'Sparse', room: 1, bay: 3, reception: 1 },
        { id: 'normal', label: 'Normal', room: 2, bay: 6, reception: 2 },
        { id: 'lush', label: 'Lush', room: 3, bay: 8, reception: 4 },
      ].map((d) => [d.id, Object.freeze(d)]),
    )
  ),
);

/** Every density's id, in picker order. @type {ReadonlyArray<string>} */
export const PLANT_DENSITY_IDS = Object.freeze(Object.keys(PLANT_DENSITIES));

// ------------------------------------------------------------ prop density

/**
 * THREE DENSITIES, AS CLEAR FLOOR PER FREE-STANDING PROP (§1.f).
 *
 * Quiet 1 per 14 U², normal 1 per 9 U² (shipped), busy 1 per 6 U². **Anchored**
 * props — monitor, tray, pinboard, whiteboard, shelf — are furniture, not
 * decoration, and are unaffected; `busy` never overrides the
 * no-two-identical-silhouettes-within-8 U rule.
 *
 * @type {Readonly<Record<string, {id:string, label:string, clearU2:number}>>}
 */
export const PROP_DENSITIES = Object.freeze(
  /** @type {any} */ (
    Object.fromEntries(
      [
        { id: 'quiet', label: 'Quiet', clearU2: 14 },
        { id: 'normal', label: 'Normal', clearU2: 9 },
        { id: 'busy', label: 'Busy', clearU2: 6 },
      ].map((d) => [d.id, Object.freeze(d)]),
    )
  ),
);

/** Every density's id, in picker order. @type {ReadonlyArray<string>} */
export const PROP_DENSITY_IDS = Object.freeze(Object.keys(PROP_DENSITIES));

// ------------------------------------------------------------- lounge kit

/**
 * FOUR CHECKBOXES OVER §3.7'S BAYS (§1.g), and eight legal kits.
 *
 * `sitting` is ALWAYS ON — it is the fallback, and a lounge with no place to sit
 * is a field again. §3.7's width rule is unchanged, so a narrow lounge still
 * drops bays from the right and the kit is also a ceiling rather than a
 * guarantee. Turning `games` off is how a user gets a floor with no saturated
 * accent on it at all.
 * @type {ReadonlyArray<string>}
 */
export const LOUNGE_KIT_BAYS = Object.freeze(['sitting', 'quiet', 'cafe', 'games']);

/** The one bay a kit may not turn off. */
export const LOUNGE_KIT_REQUIRED = 'sitting';

// ------------------------------------------------------------- agent size

/**
 * §2's four settings, carried by the model and NOT YET APPLIED — WP-88c is the
 * package that makes `RIG_UNIT_U` read this, and it supersedes WP-80.
 *
 * It is in the document now rather than later for one reason: a look that gained
 * a key in a second package would be a look file exported today that a build
 * tomorrow refuses, and `layout-io`'s whole-or-one-error discipline makes that a
 * refusal rather than a shrug. `auto` is the default (owner decision 3).
 * @type {ReadonlyArray<string>}
 */
export const AGENT_SIZES = Object.freeze(['auto', 'small', 'medium', 'large']);

// ---------------------------------------------------------- the ten pickers

/**
 * The catalogue, as the ten groups a settings section shows — WP-88b builds the
 * section and reads this rather than restating it, so a picker cannot offer an
 * option the guards have never seen.
 *
 * @type {ReadonlyArray<{id:string, label:string, path:string,
 *   options:ReadonlyArray<{id:string, label:string}>}>}
 */
export const LOOK_PICKERS = Object.freeze(
  [
    ...LOOK_ZONES.map((zone) => ({
      id: `floor.${zone}`,
      label: `${zone[0].toUpperCase()}${zone.slice(1)} floor`,
      path: `floors.${zone}`,
      options: FLOOR_OPTIONS[zone].map((id) => ({ id, label: FLOOR_MATERIALS[id].label })),
    })),
    {
      id: 'scheme',
      label: 'Colour scheme',
      path: 'scheme',
      options: SCHEME_IDS.map((id) => ({ id, label: SCHEMES[id].label })),
    },
    {
      id: 'furniture',
      label: 'Furniture set',
      path: 'furniture',
      options: FURNITURE_SET_IDS.map((id) => ({ id, label: FURNITURE_SETS[id].label })),
    },
    ...RUG_ROLES.map((role) => ({
      id: `rug.${role}`,
      label: role === 'wool' ? 'Wool rug' : 'Task rug',
      path: `rugs.${role}`,
      options: [
        ...RUG_TONE_IDS.map((id) => ({ id, label: `${id[0].toUpperCase()}${id.slice(1)}` })),
        ...RUG_PATTERN_IDS.map((id) => ({ id, label: RUG_PATTERNS[id].label })),
      ],
    })),
    {
      id: 'plants',
      label: 'Planting',
      path: 'plants',
      options: [
        ...PLANT_FAMILY_IDS.map((id) => ({ id, label: PLANT_FAMILIES[id].label })),
        ...PLANT_DENSITY_IDS.map((id) => ({ id, label: PLANT_DENSITIES[id].label })),
      ],
    },
    {
      id: 'props',
      label: 'Prop density',
      path: 'props.density',
      options: PROP_DENSITY_IDS.map((id) => ({ id, label: PROP_DENSITIES[id].label })),
    },
  ].map((p) => Object.freeze({ ...p, options: Object.freeze(p.options) })),
);

/**
 * §1's 52, counted from the tables rather than written down. The lounge kit's
 * four checkboxes are not a picker (§1.g) and are added here so the promise and
 * the arithmetic are the same number.
 */
export const LOOK_OPTION_COUNT =
  LOOK_PICKERS.reduce((n, p) => n + p.options.length, 0) + LOUNGE_KIT_BAYS.length;

// ----------------------------------------------------------- the document

/**
 * @typedef {object} Look
 * @property {string} preset      which preset this started from
 * @property {Record<string,string>} floors  one material id per zone
 * @property {string} scheme
 * @property {string} furniture
 * @property {Record<string,{tone:string, pattern:string}>} rugs
 * @property {{family:string, density:string}} plants
 * @property {{density:string}} props
 * @property {Record<string,boolean>} lounge
 * @property {string} agentSize
 */

/**
 * STUDIO OAK — the default, and byte-identical to what ships today (§3, owner
 * decision 2).
 *
 * *"A default that changed the shipped floor would move every golden and decide
 * for the majority who never open the section."* Every value below is the
 * constant the painter it replaces used to hold: the office and the lounge are
 * the herringbone, the corridor is the poured screed, a project room is the wool
 * broadloom, the scheme is the identity transform, the set is what WP-85b drew,
 * the rugs are WP-85a's slate and sage, the densities are §3.5's and §3.6's, and
 * every bay is on.
 * @type {Readonly<Look>}
 */
export const DEFAULT_LOOK = Object.freeze({
  preset: 'studio-oak',
  floors: Object.freeze({
    office: 'herringbone-oak',
    corridor: 'poured-screed',
    rooms: 'wool-broadloom',
    lounge: 'herringbone-oak',
  }),
  scheme: 'warm',
  furniture: 'scandi',
  rugs: Object.freeze({
    wool: Object.freeze({ tone: 'wool', pattern: 'plain' }),
    task: Object.freeze({ tone: 'sage', pattern: 'plain' }),
  }),
  plants: Object.freeze({ family: 'leafy', density: 'normal' }),
  props: Object.freeze({ density: 'normal' }),
  lounge: Object.freeze({ sitting: true, quiet: true, cafe: true, games: true }),
  agentSize: 'auto',
});

/**
 * THE SIX PRESETS (§3): complete looks the user may then edit.
 *
 * Each is a starting point rather than a mode — editing any control marks the
 * preset `· edited` and `Reset to preset` puts one group, or the section, back
 * (WP-88b). `studio-oak` is `DEFAULT_LOOK` itself, which is the property that
 * keeps every existing golden still.
 *
 * Every one of the six is measured against `validateLook` on all three themes by
 * `look-guards.test.mjs` — including §1 rule 3, which is why no preset gives the
 * corridor the material the office or the lounge beside it already has.
 *
 * The list is split in two — the definitions, then the frozen normalised table
 * — because `normalizeLook` has to be able to ask whether a preset id exists
 * while the table it would ask is still being built. Definitions first, lookup
 * against the definitions, table second: no temporal dead zone, and one list.
 *
 * @type {ReadonlyArray<{id:string, label:string, blurb:string, look:any}>}
 */
const PRESET_DEFS = Object.freeze(
  [
    {
      id: 'studio-oak',
      label: 'Studio oak',
      blurb: 'Warm oak, wool rugs, everything on. The floor exactly as it ships.',
      look: DEFAULT_LOOK,
    },
    {
      id: 'night-lab',
      label: 'Night lab',
      blurb: 'Polished concrete under an ink wash, industrial frames, no games bay.',
      look: {
        floors: {
          office: 'polished-concrete',
          corridor: 'ceramic-tile',
          rooms: 'loop-pile',
          lounge: 'polished-concrete',
        },
        scheme: 'ink',
        furniture: 'industrial',
        rugs: {
          wool: { tone: 'wool', pattern: 'banded' },
          task: { tone: 'wool', pattern: 'plain' },
        },
        plants: { family: 'architectural', density: 'sparse' },
        props: { density: 'normal' },
        lounge: { sitting: true, quiet: true, cafe: true, games: false },
      },
    },
    {
      id: 'paper-office',
      label: 'Paper office',
      blurb:
        'Mono over ash boards; every surface a neutral, so the only colour left is the people.',
      look: {
        floors: {
          office: 'wide-ash',
          corridor: 'poured-screed',
          rooms: 'wide-ash',
          lounge: 'wide-ash',
        },
        scheme: 'mono',
        furniture: 'scandi',
        rugs: {
          wool: { tone: 'sand', pattern: 'plain' },
          task: { tone: 'sand', pattern: 'banded' },
        },
        plants: { family: 'dry', density: 'sparse' },
        props: { density: 'quiet' },
      },
    },
    {
      id: 'terrazzo-hall',
      label: 'Terrazzo hall',
      blurb: 'A civic building — terrazzo, ceramic tile, soft silhouettes, busy shelves.',
      look: {
        floors: {
          office: 'terrazzo',
          corridor: 'ceramic-tile',
          rooms: 'polished-concrete',
          lounge: 'terrazzo',
        },
        scheme: 'warm',
        furniture: 'soft',
        rugs: {
          wool: { tone: 'wool', pattern: 'banded' },
          task: { tone: 'sage', pattern: 'banded' },
        },
        plants: { family: 'leafy', density: 'normal' },
        props: { density: 'busy' },
      },
    },
    {
      id: 'garden-floor',
      label: 'Garden floor',
      blurb: 'Cork and ash under a forest wash, planted as far as the density rules allow.',
      look: {
        floors: {
          office: 'wide-ash',
          corridor: 'loop-pile',
          rooms: 'cork',
          lounge: 'wide-ash',
        },
        scheme: 'forest',
        furniture: 'soft',
        rugs: {
          wool: { tone: 'sage', pattern: 'plain' },
          task: { tone: 'sage', pattern: 'banded' },
        },
        plants: { family: 'leafy', density: 'lush' },
        props: { density: 'normal' },
        agentSize: 'large',
      },
    },
    {
      id: 'workshop',
      label: 'Workshop',
      blurb: 'Clay over concrete, industrial frames — a hundred sessions in a shed.',
      look: {
        floors: {
          office: 'polished-concrete',
          corridor: 'ceramic-tile',
          rooms: 'polished-concrete',
          lounge: 'polished-concrete',
        },
        scheme: 'clay',
        furniture: 'industrial',
        rugs: {
          wool: { tone: 'sand', pattern: 'banded' },
          task: { tone: 'wool', pattern: 'plain' },
        },
        plants: { family: 'dry', density: 'sparse' },
        props: { density: 'busy' },
        agentSize: 'small',
      },
    },
  ].map((p) => Object.freeze(p)),
);

/**
 * The six, whole: every partial above filled out by `normalizeLook` and frozen.
 * @type {ReadonlyArray<{id:string, label:string, blurb:string, look:Readonly<Look>}>}
 */
export const PRESETS = Object.freeze(
  PRESET_DEFS.map((p) =>
    Object.freeze({ ...p, look: Object.freeze({ ...normalizeLook(p.look), preset: p.id }) }),
  ),
);

/** Every preset's id, in card order. @type {ReadonlyArray<string>} */
export const PRESET_IDS = Object.freeze(PRESET_DEFS.map((p) => p.id));

/**
 * A preset id, normalised. `night_lab`, `Night Lab` and `night-lab` are the same
 * request and only one of them is what a URL wrote.
 * @param {unknown} id
 */
function presetKey(id) {
  return String(id ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

/** A preset by id, or `null`. @param {unknown} id */
export function presetById(id) {
  const key = presetKey(id);
  return PRESETS.find((p) => p.id === key) || null;
}

/**
 * Fill a partial look out to a whole one, dropping anything the tables do not
 * name.
 *
 * DROPS RATHER THAN REFUSES, and the two callers want different things from it:
 * `store.mjs` sanitises a hand-edited `state.json` and must end up with a
 * paintable floor whatever it finds, while `src/core/look.mjs` refuses an
 * IMPORTED document with its reason — a file somebody sent you that silently
 * became something else would look like it had been accepted. So this is the
 * sanitiser and `validateLookDocument` is the schema, and neither pretends to be
 * the other.
 *
 * @param {unknown} look
 * @returns {Look}
 */
export function normalizeLook(look) {
  const raw =
    look && typeof look === 'object' && !Array.isArray(look) ? /** @type {any} */ (look) : {};
  /** @param {unknown} v @param {ReadonlyArray<string>} allowed @param {string} fallback */
  const one = (v, allowed, fallback) => (allowed.includes(String(v)) ? String(v) : fallback);

  /** @type {Record<string,string>} */
  const floors = {};
  for (const zone of LOOK_ZONES) {
    floors[zone] = one(raw.floors?.[zone], FLOOR_OPTIONS[zone], DEFAULT_LOOK.floors[zone]);
  }
  /** @type {Record<string,{tone:string, pattern:string}>} */
  const rugs = {};
  for (const role of RUG_ROLES) {
    rugs[role] = {
      tone: one(raw.rugs?.[role]?.tone, RUG_TONE_IDS, DEFAULT_LOOK.rugs[role].tone),
      pattern: one(raw.rugs?.[role]?.pattern, RUG_PATTERN_IDS, DEFAULT_LOOK.rugs[role].pattern),
    };
  }
  /** @type {Record<string,boolean>} */
  const lounge = {};
  for (const bay of LOUNGE_KIT_BAYS) {
    lounge[bay] =
      bay === LOUNGE_KIT_REQUIRED
        ? true
        : raw.lounge?.[bay] === undefined
          ? DEFAULT_LOOK.lounge[bay]
          : Boolean(raw.lounge[bay]);
  }
  // Against the DEFINITIONS rather than against `PRESETS`: this function runs
  // while that table is still being built (see `PRESET_DEFS`).
  const preset = presetKey(raw.preset);
  return {
    preset: PRESET_DEFS.some((p) => p.id === preset) ? preset : DEFAULT_LOOK.preset,
    floors,
    scheme: one(raw.scheme, SCHEME_IDS, DEFAULT_LOOK.scheme),
    furniture: one(raw.furniture, FURNITURE_SET_IDS, DEFAULT_LOOK.furniture),
    rugs,
    plants: {
      family: one(raw.plants?.family, PLANT_FAMILY_IDS, DEFAULT_LOOK.plants.family),
      density: one(raw.plants?.density, PLANT_DENSITY_IDS, DEFAULT_LOOK.plants.density),
    },
    props: { density: one(raw.props?.density, PROP_DENSITY_IDS, DEFAULT_LOOK.props.density) },
    lounge,
    agentSize: one(raw.agentSize, AGENT_SIZES, DEFAULT_LOOK.agentSize),
  };
}

/**
 * The look a preset names, or the default. `?look=` and the preset cards both
 * go through here, so a preset id is the only thing either of them can set —
 * §4's *"a preset NAME only, never an arbitrary object: a URL that could set any
 * look is a link a stranger could send"*.
 * @param {unknown} id
 * @returns {Look}
 */
export function lookForPreset(id) {
  const preset = presetById(id);
  return normalizeLook(preset ? preset.look : DEFAULT_LOOK);
}

/**
 * Are two looks the same floor? Used by the settings section to mark a preset
 * `· edited` and by the round-trip tests, so neither has to re-derive what
 * equality means for a nested document.
 * @param {unknown} a @param {unknown} b
 */
export function sameLook(a, b) {
  const x = normalizeLook(a);
  const y = normalizeLook(b);
  // `preset` is provenance rather than paint: two looks that paint the same
  // floor are the same floor whichever card they started from.
  return JSON.stringify({ ...x, preset: '' }) === JSON.stringify({ ...y, preset: '' });
}
