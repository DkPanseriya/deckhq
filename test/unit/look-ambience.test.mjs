/**
 * THE LIGHT, THE PARTITIONS AND THE ROOM TINT, MEASURED (G6a).
 * `docs/plan/graphics/04-options.md` §2.
 *
 * Three options no painter reads yet. That is exactly why they are measured
 * here first: the day a painter lands, what it is handed has already been held
 * to its numbers on every material, under every scheme, on every shipped theme.
 *
 * Two halves, as in `look-guards.test.mjs`. The enumerations are not looking
 * for a failure — they print the worst of each measure so a change that moves
 * one shows what it moved. The refusals are the other half: each of the three
 * guard groups is made to say no, and the sentence it says is asserted.
 */

// A machine of our own, before anything under `src/` is loaded.
// `docs/DEVIATIONS.md` §124.
import '../helpers/isolate.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CRIMSON_MIN_DISTANCE,
  LIGHT_DIR,
  PROJECT_IDENTITIES,
  RESERVED_CRIMSON,
  colourDistance,
  washedCarpet,
} from '../../public/render/palette.js';
import {
  THEMES,
  contrastRatio,
  lightInkFor,
  over,
  pooled,
  relativeLuminance,
} from '../../public/render/themes.js';
import {
  DEFAULT_LOOK,
  FLOOR_OPTIONS,
  LIGHT_MOOD_IDS,
  PARTITION_STYLES,
  ROOM_TINT_IDS,
  SCHEME_IDS,
  ZONE_HUES,
  lookForPreset,
} from '../../public/render/look-options.js';
import {
  DAYLIGHT_FALLOFF_MAX_CONTRAST,
  DAYLIGHT_MAX_CONTRAST,
  FRAME_ON_FLOOR_MIN,
  INK_OVER_FRAME_MIN,
  LOW_PARTITION_READS_MIN,
  ZONE_TINT_MAX_LUMINANCE_DRIFT,
  ZONE_TINT_MIN_SEPARATION,
  ZONE_TINT_MIN_STATE_DISTANCE,
} from '../../public/render/look-ambience.js';
import {
  lightFor,
  materialColours,
  partitionsFor,
  resolveLook,
  roomFloorFor,
  roomTintFor,
  schemeFloor,
} from '../../public/render/look-derive.js';
import {
  daylightOn,
  daylightProblems,
  materialSchemeThemeGrid,
  partitionProblems,
  roomFloors,
  roomTintProblems,
  validateLook,
} from '../../public/render/look-guards.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** One table, printed. @param {string} title @param {Array<[string, string]>} rows */
function report(title, rows) {
  const w = rows.reduce((a, [k]) => Math.max(a, k.length), 0);
  console.log(`\n  ${title}`);
  for (const [k, v] of rows) console.log(`    ${k.padEnd(w)}  ${v}`);
}

/** A theme's eleven, through a scheme. @param {string} theme @param {string} scheme */
function floorOf(theme, scheme) {
  const doc = /** @type {any} */ (THEMES.find((t) => t.name === theme));
  return schemeFloor({ ...THEMES[0].floor, ...doc.floor }, scheme);
}

/**
 * ONE MATERIAL, EVERYWHERE: a resolved look in which every zone is the same
 * floor. Not a look anybody could choose — two adjacent zones may not share a
 * floor — and that is the point: it measures a MATERIAL under an option, as
 * every zone it could be in and as a project room, without the option space of
 * whole looks being multiplied in.
 *
 * @param {string} material @param {Record<string,string>} floor
 * @param {{light?:string, partitions?:string, roomTint?:string}} [choice]
 * @returns {any}
 */
function everywhere(material, floor, choice = {}) {
  const m = materialColours(material, floor);
  return {
    look: DEFAULT_LOOK,
    floor,
    zones: { office: m, corridor: m, rooms: m, lounge: m },
    light: lightFor(choice.light || DEFAULT_LOOK.light, floor),
    partitions: partitionsFor(choice.partitions || DEFAULT_LOOK.partitions, floor),
    roomTint: roomTintFor(choice.roomTint || DEFAULT_LOOK.roomTint, m.field, floor),
  };
}

// --------------------------------------------- the default is still the floor

test('the default look resolves to the light, the partitions and the tint the floor already has', () => {
  for (const theme of THEMES) {
    const r = resolveLook(DEFAULT_LOOK, theme.name);
    const lightInk = lightInkFor(r.floor.ink);

    // NOON IS THE DESK POOL, to the channel: the same colour at the same alpha
    // composited by the same arithmetic, on every floor in the building.
    assert.equal(r.light.dir, LIGHT_DIR);
    assert.equal(r.light.cast, 1);
    for (const zone of Object.keys(r.zones)) {
      const field = r.zones[zone].field;
      assert.equal(
        over(field, r.light.layer).toLowerCase(),
        pooled(field, lightInk).toLowerCase(),
        `${theme.name}: noon on the ${zone} is not the pool the floor already bakes`,
      );
    }

    // SOLID IS HELD TO NOTHING NEW. It is the band the floor has always drawn.
    assert.equal(r.partitions.id, 'solid');
    assert.deepEqual(partitionProblems(r), []);

    // SUBTLE IS THE IDENTITY WASH, to the channel, for all fourteen projects.
    assert.equal(r.roomTint.id, 'subtle');
    assert.deepEqual(r.roomTint.tints, []);
    PROJECT_IDENTITIES.forEach((identity, i) => {
      assert.equal(
        roomFloorFor(r, i + 1, identity.accent),
        washedCarpet(r.zones.rooms.field, identity.accent),
      );
    });
    assert.equal(roomFloors(r).length, PROJECT_IDENTITIES.length);
    assert.deepEqual(roomTintProblems(r), []);
  }
});

test('a room floor follows the tint: fourteen washes, six hues that come round again, or the bare floor', () => {
  const zoned = resolveLook({ ...DEFAULT_LOOK, roomTint: 'zoned' }, 'default');
  assert.equal(zoned.roomTint.tints.length, ZONE_HUES.length);
  assert.deepEqual(roomFloors(zoned), zoned.roomTint.tints);
  // The seventh project takes the first hue again, and an accent is not asked for.
  assert.equal(roomFloorFor(zoned, 7), roomFloorFor(zoned, 1));
  assert.equal(roomFloorFor(zoned, 6), zoned.roomTint.tints[5]);
  assert.equal(roomFloorFor(zoned, 2, '#123456'), zoned.roomTint.tints[1]);

  const off = resolveLook({ ...DEFAULT_LOOK, roomTint: 'off' }, 'default');
  assert.deepEqual(roomFloors(off), []);
  assert.equal(roomFloorFor(off, 3, PROJECT_IDENTITIES[2].accent), off.zones.rooms.field);
});

test('the derived colours, pinned on the default look and printed for each theme', () => {
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const theme of THEMES) {
    const r = resolveLook({ ...DEFAULT_LOOK, partitions: 'glass' }, theme.name);
    const { glassFrame, glassFill, glassTint, top } = r.partitions;
    assert.match(glassFrame, /^#[0-9a-f]{6}$/i);
    assert.match(glassTint, /^#[0-9a-f]{6}$/i);
    // The fill is an `rgba()` `over` can composite — a string it could not read
    // would come back as the bare floor and every glass measurement would pass.
    assert.notEqual(over(r.zones.rooms.field, glassFill), r.zones.rooms.field);
    // The frame sits between the line work and the partition: a line, and a
    // quieter one than a name.
    const [a, b] = [relativeLuminance(r.floor.ink), relativeLuminance(top)].sort((x, y) => x - y);
    const frame = relativeLuminance(glassFrame);
    assert.ok(frame > a && frame < b, `${theme.name}: the frame is not between ink and partition`);
    // A baseboard is its own floor, darker — on every zone.
    for (const zone of Object.keys(r.zones)) {
      const { field, baseboard } = r.zones[zone];
      assert.ok(relativeLuminance(baseboard) < relativeLuminance(field), `${zone} baseboard`);
    }
    rows.push([
      theme.name,
      `frame ${glassFrame}  glass ${glassFill}  baseboard (rooms) ${r.zones.rooms.baseboard}`,
    ]);
  }
  const shipped = resolveLook({ ...DEFAULT_LOOK, partitions: 'glass' }, 'default');
  assert.equal(shipped.partitions.glassFrame, '#746c60');
  report('the frame, the glass and the baseboard, on Studio oak', rows);
});

// ------------------------------------------------------------------ the light

test('daylight: every material × scheme × theme under every mood and every tint, and the worst is printed', () => {
  const grid = materialSchemeThemeGrid();
  /** @type {Record<string, {light:number, dark:number, ink:number, wall:number, at:string}>} */
  const worst = {};
  /** @type {string[]} */
  const failures = [];
  let measured = 0;
  for (const mood of LIGHT_MOOD_IDS) {
    worst[mood] = { light: 0, dark: 0, ink: Infinity, wall: -Infinity, at: '' };
    for (const { material, scheme, theme } of grid) {
      const floor = floorOf(theme, scheme);
      const dark = lightInkFor(floor.ink);
      // A material the rooms cannot have is never washed or tinted.
      const tints = FLOOR_OPTIONS.rooms.includes(material) ? ROOM_TINT_IDS : ['off'];
      for (const roomTint of tints) {
        const resolved = everywhere(material, floor, { light: mood, roomTint });
        const where = `${theme} / ${scheme} / ${material} / ${mood} / ${roomTint}`;
        for (const problem of daylightProblems(resolved)) {
          failures.push(`${where}: ${problem.reason}`);
        }
        const day = daylightOn(resolved);
        const w = worst[mood];
        if (dark) w.dark = Math.max(w.dark, day.ratio.value);
        else w.light = Math.max(w.light, day.ratio.value);
        if (day.ink.value < w.ink) {
          w.ink = day.ink.value;
          w.at = where;
        }
        w.wall = Math.max(w.wall, day.luminance.value - relativeLuminance(floor.wall));
        if (dark) w.farDark = Math.max(w.farDark || 0, day.falloff.value);
        else w.farLight = Math.max(w.farLight || 0, day.falloff.value);
        w.farInk = Math.min(w.farInk ?? Infinity, day.shadeInk.value);
        measured++;
      }
    }
  }
  assert.equal(grid.length * LIGHT_MOOD_IDS.length, 648, '216 combinations × three moods');
  report(
    `daylight on the floor — ${measured} measurements; ceiling ${DAYLIGHT_MAX_CONTRAST}:1, ink bar 4.5`,
    LIGHT_MOOD_IDS.map((mood) => [
      mood,
      `patch ${worst[mood].light.toFixed(3)}:1 light theme, ${worst[mood].dark.toFixed(3)}:1 dark` +
        ` · worst ink ${worst[mood].ink.toFixed(2)}:1 (${worst[mood].at})` +
        ` · nearest the wall ${worst[mood].wall.toFixed(4)}`,
    ]),
  );
  report(
    `away from the windows — ceiling ${DAYLIGHT_FALLOFF_MAX_CONTRAST}:1, ink bar 4.5`,
    LIGHT_MOOD_IDS.map((mood) => [
      mood,
      `far side ${worst[mood].farLight.toFixed(3)}:1 light theme, ${worst[mood].farDark.toFixed(3)}:1 dark` +
        ` · worst ink ${worst[mood].farInk.toFixed(2)}:1`,
    ]),
  );
  assert.deepEqual(failures, []);
  for (const mood of LIGHT_MOOD_IDS) {
    // The far side of a room is a shade of its own floor on every theme, and a
    // name on it keeps far more than the bar.
    assert.ok(worst[mood].farLight <= DAYLIGHT_FALLOFF_MAX_CONTRAST + 1e-9);
    assert.ok(worst[mood].farDark <= worst[mood].farLight, 'a dark floor falls away further');
    assert.ok(
      worst[mood].farInk >= 7,
      `${mood}: a name in shade is ${worst[mood].farInk.toFixed(2)}:1`,
    );
  }
  // A patch on a pale floor is nearly invisible and a patch on a dark one is
  // the desk pool's own strength: no mood is brighter on a light theme.
  for (const mood of LIGHT_MOOD_IDS) assert.ok(worst[mood].light < worst[mood].dark);
});

test('daylight: each of the three rules can say no, in the light row', () => {
  // No shipped theme and no mood can be made to fail — the enumeration above is
  // that statement — so the light is turned up by hand: the same floors, and a
  // patch no table offers.
  const night = resolveLook(DEFAULT_LOOK, 'night shift');
  const glare = daylightProblems({
    ...night,
    light: { ...night.light, layer: 'rgba(255,255,255,0.45)' },
  });
  for (const problem of glare) {
    assert.equal(problem.picker, 'light');
    assert.equal(problem.option, 'noon');
    assert.ok(typeof problem.measured === 'number' && typeof problem.needed === 'number');
    assert.ok(problem.reason.length > 20);
    console.log(`    refused: ${problem.reason}`);
  }
  const rules = glare.map((p) => p.rule).join(' | ');
  assert.match(rules, /nothing is brighter than the wall/);
  assert.match(rules, /ink >= 4\.5:1 in daylight/);
  assert.match(rules, /daylight <= 1\.18:1 on its floor/);
  assert.equal(glare.length, 3, 'one row per rule, for the worst floor — not one per floor');
  // And the light as the table has it is refused by nothing.
  assert.deepEqual(daylightProblems(night), []);
});

// ------------------------------------------------------------- the partitions

test('partitions: the frame is a visible line on every material × scheme × theme', () => {
  const grid = materialSchemeThemeGrid();
  let frame = Infinity;
  let frameAt = '';
  let ink = Infinity;
  let inkAt = '';
  let sheet = -Infinity;
  let top = Infinity;
  let topAt = '';
  /** @type {string[]} */
  const failures = [];
  /** @type {any} */
  let dimmest = null;
  for (const { material, scheme, theme } of grid) {
    const floor = floorOf(theme, scheme);
    const where = `${theme} / ${scheme} / ${material}`;
    for (const style of ['glass', 'low']) {
      const resolved = everywhere(material, floor, { partitions: style });
      for (const problem of partitionProblems(resolved)) {
        failures.push(`${where} / ${style}: ${problem.reason}`);
      }
    }
    const resolved = everywhere(material, floor, { partitions: 'low' });
    const field = resolved.zones.rooms.field;
    const p = resolved.partitions;
    const onFloor = contrastRatio(p.glassFrame, field);
    if (onFloor < frame) [frame, frameAt] = [onFloor, where];
    const under = contrastRatio(floor.ink, p.glassFrame);
    if (under < ink) [ink, inkAt] = [under, where];
    sheet = Math.max(
      sheet,
      relativeLuminance(over(field, p.glassFill)) - relativeLuminance(floor.wall),
    );
    const reads = contrastRatio(p.top, field);
    if (reads < top) {
      [top, topAt] = [reads, where];
      dimmest = resolved;
    }
  }
  assert.equal(grid.length, 216);
  report('partitions — 216 combinations, glass and low', [
    ['frame on its floor', `${frame.toFixed(3)}:1  (${frameAt}) — bar ${FRAME_ON_FLOOR_MIN}`],
    ['ink over the frame', `${ink.toFixed(3)}:1  (${inkAt}) — bar ${INK_OVER_FRAME_MIN}`],
    ['glass, against the wall', `${sheet.toFixed(4)}  — never above 0`],
    [
      'a low top on its floor',
      `${top.toFixed(3)}:1  (${topAt}) — reads at ${LOW_PARTITION_READS_MIN}`,
    ],
  ]);
  assert.deepEqual(failures, []);

  // WHY A LOW PARTITION CARRIES A FRAME. Its top is the partition colour, and
  // on the floor printed above that is the floor's own value: without the
  // hairline there is no divider. So the table gives it one, and the day
  // somebody takes it away the guard says so.
  assert.equal(PARTITION_STYLES.low.frame, true);
  assert.ok(top < LOW_PARTITION_READS_MIN, 'no floor needs the frame; the rule is untested');
  const frameless = partitionProblems({
    ...dimmest,
    partitions: { ...dimmest.partitions, frame: false },
  });
  assert.ok(frameless.length > 0, 'a low partition with no frame and no contrast was accepted');
  assert.equal(frameless[0].picker, 'partitions');
  assert.equal(frameless[0].option, 'low');
  assert.match(frameless[0].reason, /carries no frame line/);
  console.log(`    refused: ${frameless[0].reason}`);
  // …and the shipped band on that same floor is refused by nothing: it is what
  // the floor has always drawn there.
  assert.deepEqual(
    partitionProblems({ ...dimmest, partitions: partitionsFor('solid', dimmest.floor) }),
    [],
  );
});

test('partitions: on a pale pack theme a glass frame is refused, with both numbers, and nothing is clamped', () => {
  // The three shipped themes cannot produce this refusal, and a theme that
  // ships in a pack can: the sample pack's conservatory has dark-green line
  // work on pale floors, so a frame mixed from it is a soft line on cork.
  const pack = JSON.parse(
    fs.readFileSync(path.join(REPO, 'packs', 'supporter-sample', 'pack.json'), 'utf8'),
  );
  const garden = pack.themes.find((/** @type {any} */ t) => t.name === 'garden');
  assert.ok(garden, 'the sample pack no longer carries its garden theme');
  const look = { ...lookForPreset('garden-floor'), partitions: 'glass' };
  // The same floors with the shipped partitions are fine there…
  assert.ok(validateLook({ ...look, partitions: 'solid' }, garden).ok);
  // …and with glass they are not.
  const result = validateLook(look, garden);
  const refused = result.problems.find((p) => p.picker === 'partitions');
  assert.ok(refused, `expected a partitions refusal; got ${JSON.stringify(result.problems)}`);
  assert.equal(refused.option, 'glass');
  assert.equal(refused.needed, FRAME_ON_FLOOR_MIN);
  assert.ok(/** @type {number} */ (refused.measured) < FRAME_ON_FLOOR_MIN);
  assert.match(refused.reason, /:1 on Cork in the rooms; the line that draws the divider/);
  assert.equal(result.resolved.look.partitions, 'glass');
  console.log(`    refused: ${refused.reason}`);
});

// -------------------------------------------------------------- the room tint

test('zoned: the six tints, pinned on Colour plan and measured on every room floor', () => {
  // The preset that was drawn around them, on the theme it was drawn on.
  const plan = resolveLook(lookForPreset('colour-plan'), 'default');
  assert.deepEqual(plan.roomTint.tints, [
    '#d8e8cd',
    '#dce3ee',
    '#eadff0',
    '#cee8e3',
    '#e6e4ca',
    '#efdee9',
  ]);

  let drift = 0;
  let crimson = Infinity;
  let next = Infinity;
  let any = Infinity;
  let ink = Infinity;
  let wall = -Infinity;
  /** @type {string[]} */
  const refused = [];
  /** @type {Set<string>} */
  const rules = new Set();
  let combinations = 0;
  for (const theme of THEMES) {
    for (const scheme of SCHEME_IDS) {
      const floor = floorOf(theme.name, scheme);
      for (const material of FLOOR_OPTIONS.rooms) {
        combinations++;
        const resolved = everywhere(material, floor, { roomTint: 'zoned' });
        const field = resolved.zones.rooms.field;
        const tints = resolved.roomTint.tints;
        const problems = roomTintProblems(resolved);
        if (problems.length) refused.push(`${theme.name} / ${material}`);
        for (const problem of problems) rules.add(problem.rule);
        tints.forEach((/** @type {string} */ colour, /** @type {number} */ i) => {
          drift = Math.max(drift, Math.abs(relativeLuminance(colour) - relativeLuminance(field)));
          crimson = Math.min(crimson, colourDistance(colour, RESERVED_CRIMSON));
          next = Math.min(next, colourDistance(colour, tints[(i + 1) % tints.length]));
          for (let j = i + 1; j < tints.length; j++) {
            any = Math.min(any, colourDistance(colour, tints[j]));
          }
          ink = Math.min(ink, contrastRatio(floor.ink, colour));
          wall = Math.max(wall, relativeLuminance(colour) - relativeLuminance(floor.wall));
        });
      }
    }
  }
  assert.equal(combinations, 126, 'seven room floors × six schemes × three themes');
  report('zoned room colours — 126 combinations', [
    ['luminance drift', `${drift.toFixed(4)} — ceiling ${ZONE_TINT_MAX_LUMINANCE_DRIFT}`],
    ['closest to crimson', `${crimson.toFixed(0)} — bar ${CRIMSON_MIN_DISTANCE}`],
    ['two neighbouring rooms', `${next.toFixed(1)} apart — bar ${ZONE_TINT_MIN_SEPARATION}`],
    ['any two rooms', `${any.toFixed(1)} apart`],
    ['worst name ink', `${ink.toFixed(2)}:1 — bar 4.5`],
    ['against the wall', `${wall.toFixed(4)} — never above 0`],
    ['refused', `${refused.length} of ${combinations}: ${[...new Set(refused)].join(', ')}`],
  ]);
  // The lock holds, nothing nears crimson, and neighbours are told apart —
  // everywhere, by construction and now by measurement.
  assert.ok(drift <= ZONE_TINT_MAX_LUMINANCE_DRIFT);
  assert.ok(crimson >= CRIMSON_MIN_DISTANCE);
  assert.ok(next >= ZONE_TINT_MIN_SEPARATION);
  assert.ok(ink >= 4.5);
  assert.ok(wall <= 1e-9);
  // WHAT IS REFUSED, AND ONLY THAT: ash boards and oak plank in the rooms on night shift,
  // under every scheme, where one tint lands too near a colour a figure wears.
  assert.deepEqual([...new Set(refused)], ['night shift / wide-ash', 'night shift / oak-plank']);
  assert.equal(refused.length, 2 * SCHEME_IDS.length);
  assert.equal(rules.size, 1);
  assert.match([...rules][0], /from every colour a figure wears/);
});

test('zoned: a room may not wear what a figure wears — refused in its own row, and nothing is clamped', () => {
  const look = { ...lookForPreset('daylight-studio'), roomTint: 'zoned' };
  assert.ok(validateLook(look, 'default').ok, 'ash rooms take the six tints on the default theme');
  const result = validateLook(look, 'night shift');
  assert.equal(result.problems.length, 1);
  const [refused] = result.problems;
  assert.equal(refused.picker, 'roomTint');
  assert.equal(refused.option, 'zoned');
  assert.equal(refused.needed, ZONE_TINT_MIN_STATE_DISTANCE);
  assert.ok(/** @type {number} */ (refused.measured) < ZONE_TINT_MIN_STATE_DISTANCE);
  assert.match(
    refused.reason,
    /on Wide ash boards, the lilac room \(#[0-9a-f]{6}\) is only 59 from the ended colour/,
  );
  assert.equal(result.resolved.look.roomTint, 'zoned');
  console.log(`    refused: ${refused.reason}`);
  // The style that was DRAWN zoned is refused nowhere.
  for (const theme of THEMES) {
    assert.ok(validateLook(lookForPreset('colour-plan'), theme.name).ok, theme.name);
  }
});

test('a zone accent is a small-object colour: under the wall and nowhere near crimson, on every theme', () => {
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const theme of THEMES) {
    for (const scheme of SCHEME_IDS) {
      const floor = floorOf(theme.name, scheme);
      const { accents } = roomTintFor('zoned', floor.carpet, floor);
      assert.equal(accents.length, ZONE_HUES.length);
      for (const accent of accents) {
        assert.ok(relativeLuminance(accent) <= relativeLuminance(floor.wall) + 1e-9);
        assert.ok(
          colourDistance(accent, RESERVED_CRIMSON) >= CRIMSON_MIN_DISTANCE,
          `${theme.name} / ${scheme}: ${accent} is too near crimson`,
        );
      }
      if (scheme === 'warm') rows.push([theme.name, accents.join(' ')]);
    }
  }
  report(`the six accents (${ZONE_HUES.map((h) => h.id).join(' · ')})`, rows);
});

test('away from the windows: every style on every theme stays one floor, and a name stays a name', async () => {
  const { ALL_PRESETS } = await import('../../public/render/look-options.js');
  const rows = [];
  let pairs = 0;
  for (const theme of THEMES) {
    let far = 0;
    let ink = Infinity;
    for (const preset of ALL_PRESETS) {
      const day = daylightOn(resolveLook(preset.look, theme));
      far = Math.max(far, day.falloff.value);
      ink = Math.min(ink, day.shadeInk.value);
      pairs++;
    }
    assert.ok(far <= DAYLIGHT_FALLOFF_MAX_CONTRAST + 1e-9, `${theme.name}: ${far.toFixed(3)}:1`);
    assert.ok(ink >= 6.9, `${theme.name}: a name in shade is ${ink.toFixed(2)}:1`);
    rows.push([theme.name, `far side ${far.toFixed(3)}:1 · worst ink ${ink.toFixed(2)}:1`]);
  }
  assert.equal(pairs, ALL_PRESETS.length * THEMES.length);
  report(`away from the windows — ${pairs} style × theme pairs`, rows);
});
