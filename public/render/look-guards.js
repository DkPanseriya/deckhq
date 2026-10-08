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

import {
  assertMaterialDiscipline,
  colourDistance,
  DEFAULT_PALETTE,
  ON_FLOOR_STATES,
  PROJECT_IDENTITIES,
  STATE_COLORS,
} from './palette.js';
import {
  BOARD_MAX_INTERNAL_CONTRAST,
  RUG_BAND_MAX,
  RUG_BAND_MIN,
  THEMES,
  assertThemeContrast,
  contrastRatio,
  interiorHighlights,
  lightInkFor,
  over,
  pooled,
  relativeLuminance,
  themeByName,
} from './themes.js';
import {
  FLOOR_MATERIALS,
  FURNITURE_SET_IDS,
  LOOK_ZONES,
  LOUNGE_KIT_REQUIRED,
  SCHEMES,
  SCHEME_MAX_LUMINANCE_DRIFT,
  SCHEME_SURFACES,
  ZONE_ADJACENCY,
} from './look-options.js';
import {
  DAYLIGHT_FALLOFF_MAX_CONTRAST,
  DAYLIGHT_MAX_CONTRAST,
  FRAME_ON_FLOOR_MIN,
  INK_OVER_FRAME_MIN,
  LOW_PARTITION_READS_MIN,
  ZONE_TINT_MAX_LUMINANCE_DRIFT,
  ZONE_TINT_MIN_SEPARATION,
  ZONE_TINT_MIN_STATE_DISTANCE,
} from './look-ambience.js';
import { resolveLook, roomFloorFor, schemeColour } from './look-derive.js';
import {
  FURNITURE_ALERT_STATES,
  FURNITURE_BEZEL,
  FURNITURE_DETAIL_MAX,
  FURNITURE_DETAILS,
  FURNITURE_FILL_EXEMPT,
  FURNITURE_FILL_TOKENS,
  FURNITURE_STATE_MIN_DISTANCE,
  furnitureTonesFor,
} from './furniture-tones.js';

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
    // Which washes those are is the room tint's to say (G6a): the fourteen at
    // `subtle`, which is what ships, the six zone tints at `zoned`, none at `off`.
    /** @type {string[]} */
    const grounds = [material.field, pooled(material.field, lightInk)];
    if (zone === 'rooms') grounds.push(...roomFloors(resolved));
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

  // ---- G6a: the light, the partitions and the room tint. Three groups, each
  // its own function below, because each is a different question and the
  // refusals belong in three different rows.
  for (const problem of [
    ...daylightProblems(resolved),
    ...partitionProblems(resolved),
    ...roomTintProblems(resolved),
  ]) {
    fail(problem);
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

// ------------------------------------------- G6a: light, partitions, room tint
//
// `docs/plan/graphics/04-options.md` §2. Each group takes a RESOLVED look, so
// it measures the colours a painter would be handed rather than re-deriving
// them, and each returns rows in the shape `validateLook` already speaks.
//
// The floor as it ships passes all three on every shipped theme, and so does
// every material under every scheme and every mood — `look-guards.test.mjs`
// enumerates it. What these refuse is a pack theme's floor that daylight would
// outshine, a divider nobody could see, and a room colour a figure wears.

/**
 * Every floor a PROJECT ROOM may be painted in, under the look's room tint: the
 * fourteen identity washes at `subtle`, the six zone tints at `zoned`, and none
 * at `off`, where a room is its bare material and the zone already says so.
 *
 * @param {ReturnType<typeof resolveLook>} resolved
 * @returns {string[]}
 */
export function roomFloors(resolved) {
  const tint = resolved.roomTint;
  if (tint.zoned) return tint.tints.map((_, i) => roomFloorFor(resolved, i + 1));
  if (tint.wash <= 0) return [];
  return PROJECT_IDENTITIES.map((identity) => roomFloorFor(resolved, 1, identity.accent));
}

/**
 * DAYLIGHT, ON THE WORST FLOOR IT CAN LAND ON.
 *
 * Three numbers over every zone floor and every project-room floor: how bright
 * a patch is against its own ground, how much contrast a name keeps when it is
 * drawn across one, and the brightest pixel any patch makes. And two for the
 * far side of a room, where the floor falls away from its windows: how dark
 * that is against the bare floor, and what a name keeps on it. The guard
 * refuses on these and a preview may print them, so the two cannot disagree.
 *
 * @param {ReturnType<typeof resolveLook>} resolved
 */
export function daylightOn(resolved) {
  const grounds = [
    ...LOOK_ZONES.map((zone) => ({
      where: `${resolved.zones[zone].label} in the ${zone}`,
      ground: resolved.zones[zone].field,
    })),
    ...roomFloors(resolved).map((ground) => ({ where: 'a project room', ground })),
  ];
  const worst = {
    ratio: { value: 0, where: '', colour: '' },
    ink: { value: Infinity, where: '', colour: '' },
    luminance: { value: 0, where: '', colour: '' },
    falloff: { value: 0, where: '', colour: '' },
    shadeInk: { value: Infinity, where: '', colour: '' },
  };
  for (const { where, ground } of grounds) {
    const far = over(ground, resolved.light.falloff);
    const drop = contrastRatio(far, ground);
    const farInk = contrastRatio(resolved.floor.ink, far);
    if (drop > worst.falloff.value) worst.falloff = { value: drop, where, colour: far };
    if (farInk < worst.shadeInk.value) worst.shadeInk = { value: farInk, where, colour: far };
    const colour = over(ground, resolved.light.layer);
    const ratio = contrastRatio(colour, ground);
    const ink = contrastRatio(resolved.floor.ink, colour);
    const luminance = relativeLuminance(colour);
    if (ratio > worst.ratio.value) worst.ratio = { value: ratio, where, colour };
    if (ink < worst.ink.value) worst.ink = { value: ink, where, colour };
    if (luminance > worst.luminance.value) worst.luminance = { value: luminance, where, colour };
  }
  return worst;
}

/**
 * The light. A patch of daylight is never brighter than the wall, never costs a
 * name its 4.5:1, and never lifts a floor by more than `DAYLIGHT_MAX_CONTRAST`.
 *
 * @param {ReturnType<typeof resolveLook>} resolved
 * @returns {LookProblem[]}
 */
export function daylightProblems(resolved) {
  /** @type {LookProblem[]} */
  const out = [];
  const { light, floor } = resolved;
  const wall = relativeLuminance(floor.wall);
  const day = daylightOn(resolved);
  const base = { picker: 'light', option: light.id };
  const name = `${light.label} light`;
  if (day.luminance.value > wall + 1e-9) {
    out.push({
      ...base,
      rule: 'light — nothing is brighter than the wall',
      measured: Number(day.luminance.value.toFixed(4)),
      needed: Number(wall.toFixed(4)),
      reason: `${name} on ${day.luminance.where} (${day.luminance.colour}) is brighter than the wall (${floor.wall}); daylight lands on a floor, it does not outshine the room`,
    });
  }
  if (day.ink.value + 1e-9 < 4.5) {
    out.push({
      ...base,
      rule: 'light — ink >= 4.5:1 in daylight',
      measured: Number(day.ink.value.toFixed(2)),
      needed: 4.5,
      reason: `a name in ${name.toLowerCase()} on ${day.ink.where} (${day.ink.colour}) is ${day.ink.value.toFixed(2)}:1; an agent's name is drawn wherever the agent stands`,
    });
  }
  if (day.falloff.value > DAYLIGHT_FALLOFF_MAX_CONTRAST + 1e-9) {
    out.push({
      ...base,
      rule: `light — the far side of a room <= ${DAYLIGHT_FALLOFF_MAX_CONTRAST}:1 on its floor`,
      measured: Number(day.falloff.value.toFixed(3)),
      needed: DAYLIGHT_FALLOFF_MAX_CONTRAST,
      reason: `away from its windows ${day.falloff.where} is ${day.falloff.value.toFixed(2)}:1 against itself; a room falls away from its light, it does not become a second floor`,
    });
  }
  if (day.shadeInk.value + 1e-9 < 4.5) {
    out.push({
      ...base,
      rule: 'light — ink >= 4.5:1 away from the windows',
      measured: Number(day.shadeInk.value.toFixed(2)),
      needed: 4.5,
      reason: `a name on the far side of ${day.shadeInk.where} (${day.shadeInk.colour}) is ${day.shadeInk.value.toFixed(2)}:1; an agent's name is drawn wherever the agent stands`,
    });
  }
  if (day.ratio.value > DAYLIGHT_MAX_CONTRAST + 1e-9) {
    out.push({
      ...base,
      rule: `light — daylight <= ${DAYLIGHT_MAX_CONTRAST}:1 on its floor`,
      measured: Number(day.ratio.value.toFixed(3)),
      needed: DAYLIGHT_MAX_CONTRAST,
      reason: `${name} is ${day.ratio.value.toFixed(2)}:1 on ${day.ratio.where}; a patch of daylight is a lit floor, not the loudest thing on it`,
    });
  }
  return out;
}

/** The two floors a wall between rooms stands on. */
export const PARTITION_ZONES = Object.freeze(['rooms', 'corridor']);

/**
 * The partitions. A style that draws a frame has to draw a VISIBLE one, on both
 * floors it divides, and still leave the line work the strongest mark there; a
 * sheet of glass may not be brighter than the wall; and a new style that draws
 * no frame has to read by its top alone.
 *
 * The shipped style has no frame and is held to none of this: it is the band
 * the floor has always drawn, and a guard that began refusing it would be
 * refusing floors people already have.
 *
 * @param {Pick<ReturnType<typeof resolveLook>, 'look'|'floor'|'zones'|'partitions'>} resolved
 * @param {string} [shipped] the style no rule here applies to
 * @returns {LookProblem[]}
 */
export function partitionProblems(resolved, shipped = 'solid') {
  /** @type {LookProblem[]} */
  const out = [];
  const { partitions, floor } = resolved;
  if (partitions.id === shipped) return out;
  const base = { picker: 'partitions', option: partitions.id };
  const name = `a ${partitions.label.toLowerCase()} partition`;
  for (const zone of PARTITION_ZONES) {
    const material = resolved.zones[zone];
    if (partitions.frame) {
      const ratio = contrastRatio(partitions.glassFrame, material.field);
      if (ratio + 1e-9 < FRAME_ON_FLOOR_MIN) {
        out.push({
          ...base,
          rule: `partitions — a frame is >= ${FRAME_ON_FLOOR_MIN}:1 on both floors`,
          measured: Number(ratio.toFixed(2)),
          needed: FRAME_ON_FLOOR_MIN,
          reason: `the frame of ${name} (${partitions.glassFrame}) is ${ratio.toFixed(2)}:1 on ${material.label} in the ${zone}; the line that draws the divider would not be there`,
        });
      }
    } else {
      const ratio = contrastRatio(partitions.top, material.field);
      if (ratio + 1e-9 < LOW_PARTITION_READS_MIN) {
        out.push({
          ...base,
          rule: `partitions — a divider with no frame is >= ${LOW_PARTITION_READS_MIN}:1 on its floor`,
          measured: Number(ratio.toFixed(3)),
          needed: LOW_PARTITION_READS_MIN,
          reason: `${name} (${partitions.top}) is ${ratio.toFixed(2)}:1 on ${material.label} in the ${zone} and carries no frame line; nothing would say where one room ends`,
        });
      }
    }
    if (partitions.glazed) {
      const sheet = over(material.field, partitions.glassFill);
      if (relativeLuminance(sheet) > relativeLuminance(floor.wall) + 1e-9) {
        out.push({
          ...base,
          rule: 'partitions — nothing is brighter than the wall',
          measured: Number(relativeLuminance(sheet).toFixed(4)),
          needed: Number(relativeLuminance(floor.wall).toFixed(4)),
          reason: `the glass of ${name} over ${material.label} in the ${zone} (${sheet}) is brighter than the wall (${floor.wall})`,
        });
      }
    }
  }
  if (partitions.frame) {
    const ratio = contrastRatio(floor.ink, partitions.glassFrame);
    if (ratio + 1e-9 < INK_OVER_FRAME_MIN) {
      out.push({
        ...base,
        rule: `partitions — ink is >= ${INK_OVER_FRAME_MIN}:1 over a frame`,
        measured: Number(ratio.toFixed(2)),
        needed: INK_OVER_FRAME_MIN,
        reason: `the frame of ${name} (${partitions.glassFrame}) is ${ratio.toFixed(2)}:1 under the line work; a frame may not compete with a name`,
      });
    }
  }
  return out;
}

/**
 * The room tint, where it is zoned. Each of the six is the room's floor at the
 * floor's own luminance — re-measured, because the whole safety of a colour
 * that strong is that it moves no contrast — keeps away from every colour a
 * figure on the floor wears, crimson first among them, stays under the wall,
 * and is far enough from the next room's that two rooms are two rooms.
 *
 * @param {ReturnType<typeof resolveLook>} resolved
 * @returns {LookProblem[]}
 */
export function roomTintProblems(resolved) {
  /** @type {LookProblem[]} */
  const out = [];
  const tint = resolved.roomTint;
  if (!tint.zoned) return out;
  const material = resolved.zones.rooms;
  const base = { picker: 'roomTint', option: tint.id };
  const wall = relativeLuminance(resolved.floor.wall);
  const target = relativeLuminance(material.field);
  /** One row per rule, for the worst room: six sentences saying one thing is noise. */
  const worst = {
    drift: { value: 0, i: 0 },
    wall: { value: 0, i: 0 },
    state: { value: Infinity, i: 0, state: '' },
    next: { value: Infinity, i: 0 },
  };
  tint.tints.forEach((colour, i) => {
    const luminance = relativeLuminance(colour);
    const drift = Math.abs(luminance - target);
    if (drift > worst.drift.value) worst.drift = { value: drift, i };
    if (luminance > worst.wall.value) worst.wall = { value: luminance, i };
    for (const state of ON_FLOOR_STATES) {
      const d = colourDistance(colour, /** @type {any} */ (STATE_COLORS)[state]);
      if (d < worst.state.value) worst.state = { value: d, i, state };
    }
    const d = colourDistance(colour, tint.tints[(i + 1) % tint.tints.length]);
    if (d < worst.next.value) worst.next = { value: d, i };
  });
  /** @param {number} i */
  const room = (i) => `the ${tint.hues[i].id} room (${tint.tints[i]})`;
  if (worst.drift.value > ZONE_TINT_MAX_LUMINANCE_DRIFT) {
    out.push({
      ...base,
      rule: 'room tint — a tint does not change lightness',
      measured: Number(worst.drift.value.toFixed(5)),
      needed: ZONE_TINT_MAX_LUMINANCE_DRIFT,
      reason: `${room(worst.drift.i)} is ${worst.drift.value.toFixed(4)} off the relative luminance of ${material.label}; a room colour is a hue, not a brighter or a darker floor`,
    });
  }
  if (worst.wall.value > wall + 1e-9) {
    out.push({
      ...base,
      rule: 'room tint — nothing is brighter than the wall',
      measured: Number(worst.wall.value.toFixed(4)),
      needed: Number(wall.toFixed(4)),
      reason: `${room(worst.wall.i)} is brighter than the wall (${resolved.floor.wall})`,
    });
  }
  if (worst.state.value < ZONE_TINT_MIN_STATE_DISTANCE) {
    const state = worst.state.state;
    out.push({
      ...base,
      rule: `room tint — >= ${ZONE_TINT_MIN_STATE_DISTANCE} from every colour a figure wears`,
      measured: Number(worst.state.value.toFixed(1)),
      needed: ZONE_TINT_MIN_STATE_DISTANCE,
      reason: `on ${material.label}, ${room(worst.state.i)} is only ${worst.state.value.toFixed(0)} from the ${state.replace('_', ' ')} colour (${/** @type {any} */ (STATE_COLORS)[state]}); a room may not wear what a figure standing in it wears`,
    });
  }
  if (worst.next.value < ZONE_TINT_MIN_SEPARATION) {
    const i = worst.next.i;
    out.push({
      ...base,
      rule: `room tint — neighbouring rooms are >= ${ZONE_TINT_MIN_SEPARATION} apart`,
      measured: Number(worst.next.value.toFixed(1)),
      needed: ZONE_TINT_MIN_SEPARATION,
      reason: `on ${material.label}, ${room(i)} and ${room((i + 1) % tint.tints.length)} are only ${worst.next.value.toFixed(0)} apart; two rooms side by side would be one room`,
    });
  }
  return out;
}

/**
 * THE SEVEN NUMBERS UNDER THE LIVE PREVIEW (§4) — three zone edges, two rugs,
 * the worst ink and the worst daylight — and they are the numbers the guards
 * above refuse on rather than a second measurement of the same floor.
 *
 * Added by WP-88b, which needed them, and put HERE rather than in the section
 * for the reason every other number in this file is here: a measurement the
 * interface computes for itself is a measurement that can disagree with the
 * guard that refused it, and then the user is told a ratio that is not the one
 * the refusal was about.
 *
 * @param {unknown} look
 * @param {unknown} [theme] a theme name or document
 * @returns {Array<{id:string, label:string, ratio:number}>}
 */
export function lookMetrics(look, theme) {
  const { resolved } = validateLook(look, theme);
  const lightInk = lightInkFor(resolved.floor.ink);
  /** @type {Array<{id:string, label:string, ratio:number}>} */
  const out = [];
  for (const [a, b] of ZONE_ADJACENCY) {
    out.push({
      id: `edge.${a}.${b}`,
      label: `${a} | ${b}`,
      ratio: contrastRatio(resolved.zones[a].field, resolved.zones[b].field),
    });
  }
  for (const [role, zones] of Object.entries(RUG_ZONES)) {
    const material = resolved.zones[zones[0]];
    out.push({
      id: `rug.${role}`,
      label: `${role} rug on the ${material.label.toLowerCase()}`,
      ratio: contrastRatio(resolved.rugs[role].colour, material.field),
    });
  }
  // The WORST of them, because a preview that reported the best one would be
  // saying nothing: rule 6 is a floor, and a floor is only as good as its
  // weakest ground.
  let worstInk = Infinity;
  for (const zone of LOOK_ZONES) {
    const field = resolved.zones[zone].field;
    for (const ground of [field, pooled(field, lightInk)]) {
      worstInk = Math.min(worstInk, contrastRatio(resolved.floor.ink, ground));
    }
  }
  out.push({ id: 'ink', label: 'worst floor ink', ratio: worstInk });
  // And the daylight: the brightest a patch is against the floor it lands on,
  // over every zone and every project room's colour — `daylightOn`'s own
  // number, the one the light is refused on.
  out.push({
    id: 'daylight',
    label: 'daylight on the floor',
    ratio: daylightOn(resolved).ratio.value,
  });
  return out.map((m) => ({ ...m, ratio: Number(m.ratio.toFixed(2)) }));
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

// ------------------------------------------------- furniture is quieter than people

/** A flat `#rrggbb`, which is the only kind of colour a distance can be taken from. */
const FLAT = /^#[0-9a-f]{6}$/i;

/**
 * EVERY FILL A PIECE OF FURNITURE IS LAID IN, for a set of material tokens: the
 * shipped tokens (`FURNITURE_FILL_TOKENS`, and the three exempt ones), every
 * derived tone, and — where the furniture set carries one — the dark frame line.
 *
 * @param {Record<string, string>} tokens
 * @param {string} [set] a furniture set id
 * @returns {Record<string, string>}
 */
export function furnitureFills(tokens, set = 'scandi') {
  /** @type {Record<string, string>} */
  const out = {};
  for (const name of [...FURNITURE_FILL_TOKENS, ...Object.keys(FURNITURE_FILL_EXEMPT)]) {
    if (FLAT.test(tokens[name])) out[name] = tokens[name];
  }
  for (const [name, value] of Object.entries(furnitureTonesFor(tokens))) {
    if (FLAT.test(value)) out[`tone.${name}`] = value;
  }
  // An industrial piece is framed in the cool ink, on every edge. It is an
  // EDGE, so the detail ceiling is not its rule; it is still a fill.
  if (set === 'industrial') out['frame.industrial'] = tokens.inkCool;
  return out;
}

/**
 * MEASURE THE FURNITURE: no detail more than `FURNITURE_DETAIL_MAX`:1 against
 * the surface it sits on, the monitor excepted, and no fill within
 * `FURNITURE_STATE_MIN_DISTANCE` of a colour that asks for the user.
 *
 * @param {Record<string, string>} tokens material tokens, as the palette holds them
 * @param {string} [set] a furniture set id
 * @returns {Array<{rule:string, name:string, measured:number, needed:number, reason:string}>}
 */
export function furnitureQuietProblems(tokens, set = 'scandi') {
  /** @type {Array<{rule:string, name:string, measured:number, needed:number, reason:string}>} */
  const out = [];
  const tones = furnitureTonesFor(tokens);
  for (const [detail, surface] of FURNITURE_DETAILS) {
    if (FURNITURE_BEZEL.includes(detail)) continue;
    const ratio = contrastRatio(tones[detail], tones[surface]);
    if (ratio > FURNITURE_DETAIL_MAX + 1e-9) {
      out.push({
        rule: 'a detail is quieter than its surface',
        name: detail,
        measured: Number(ratio.toFixed(3)),
        needed: FURNITURE_DETAIL_MAX,
        reason: `${detail} (${tones[detail]}) is ${ratio.toFixed(2)}:1 on ${surface} (${tones[surface]}); a detail may be ${FURNITURE_DETAIL_MAX}:1 at most`,
      });
    }
  }
  for (const [name, value] of Object.entries(furnitureFills(tokens, set))) {
    for (const state of FURNITURE_ALERT_STATES) {
      const d = colourDistance(value, /** @type {any} */ (STATE_COLORS)[state]);
      const exempt = FURNITURE_FILL_EXEMPT[name];
      const needed = exempt && exempt.state === state ? exempt.floor : FURNITURE_STATE_MIN_DISTANCE;
      if (d < needed) {
        out.push({
          rule: 'no fill approaches a colour that asks for the user',
          name,
          measured: Number(d.toFixed(1)),
          needed,
          reason: `${name} (${value}) is ${d.toFixed(0)} from the ${state.replace('_', ' ')} colour (${/** @type {any} */ (STATE_COLORS)[state]}); furniture keeps ${needed} away`,
        });
      }
    }
  }
  return out;
}

/**
 * The same measurement as a refusal, beside `assertMaterialDiscipline`.
 * @param {Record<string, string>} tokens @param {string} [set] @param {string} [where]
 */
export function assertFurnitureQuiet(tokens, set = 'scandi', where = 'PALETTE') {
  const problems = furnitureQuietProblems(tokens, set);
  if (problems.length) {
    throw new Error(`furniture: ${where}: ${problems.map((p) => p.reason).join('; ')}`);
  }
}

/**
 * FOR THE RECORD: how close the furniture comes to EVERY colour a figure wears,
 * the four that are not alerts included. Not a rule — see
 * `FURNITURE_ALERT_STATES` for why it cannot be one.
 *
 * @param {Record<string, string>} tokens @param {string} [set]
 * @returns {Record<string, {distance:number, fill:string}>} per state, the nearest fill
 */
export function furnitureStateDistances(tokens, set = 'scandi') {
  /** @type {Record<string, {distance:number, fill:string}>} */
  const out = {};
  for (const state of ON_FLOOR_STATES) {
    out[state] = { distance: Infinity, fill: '' };
    for (const [name, value] of Object.entries(furnitureFills(tokens, set))) {
      const d = colourDistance(value, /** @type {any} */ (STATE_COLORS)[state]);
      if (d < out[state].distance) out[state] = { distance: Number(d.toFixed(1)), fill: name };
    }
  }
  return out;
}

/**
 * Every theme × scheme × furniture set the furniture is measured over, with the
 * tokens each one paints in: three themes, six schemes, three sets.
 *
 * @returns {Array<{theme:string, scheme:string, set:string, tokens:Record<string,string>}>}
 */
export function furnitureQuietGrid() {
  /** @type {Array<{theme:string, scheme:string, set:string, tokens:Record<string,string>}>} */
  const out = [];
  for (const theme of THEMES) {
    for (const scheme of Object.keys(SCHEMES)) {
      for (const set of FURNITURE_SET_IDS) {
        const resolved = resolveLook({ scheme, furniture: set }, theme);
        out.push({
          theme: theme.name,
          scheme,
          set,
          tokens: { ...DEFAULT_PALETTE, ...resolved.tokens },
        });
      }
    }
  }
  return out;
}
