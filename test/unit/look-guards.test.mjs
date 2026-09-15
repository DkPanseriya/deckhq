/**
 * THE 162, ENUMERATED (WP-88a). `docs/plan/11-LOOK-CONTROL-CENTRE.md` §5.
 *
 * *"All 162 material × scheme × theme combinations pass `assertThemeContrast`
 * and `assertMaterialDiscipline` unmodified, enumerated by a test rather than
 * asserted in prose."* This is that test.
 *
 * It is not looking for a failure. §1 rule 1 — no choice changes lightness —
 * makes the option space safe by CONSTRUCTION, and the enumeration exists
 * because a safety argument nobody re-measured is a hypothesis
 * (`08-PLAN-V2-100X.md` §1.1 rule 11). What it would catch is the day somebody
 * adds a material whose derivation escapes the lock.
 *
 * The other half is the refusals. A guard that never says no is a guard nobody
 * tested, so the two failures §1.d names are constructed here and the exact
 * sentence each produces is asserted.
 */

// A machine of our own, before anything under `src/` is loaded.
// `docs/DEVIATIONS.md` §124.
import '../helpers/isolate.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';

import { assertMaterialDiscipline } from '../../public/render/palette.js';
import {
  BOARD_MAX_INTERNAL_CONTRAST,
  RUG_BAND_MAX,
  RUG_BAND_MIN,
  THEMES,
  assertThemeContrast,
  contrastRatio,
  lightInkFor,
  pooled,
  relativeLuminance,
  themeByName,
} from '../../public/render/themes.js';
import {
  DEFAULT_LOOK,
  FLOOR_MATERIALS,
  FLOOR_OPTIONS,
  PRESETS,
  SCHEMES,
  SCHEME_IDS,
  SCHEME_MAX_LUMINANCE_DRIFT,
  SCHEME_SURFACES,
} from '../../public/render/look-options.js';
import { materialColours, schemeColour, schemeFloor } from '../../public/render/look-derive.js';
import {
  SPECK_MAX_CONTRAST,
  ZONE_EDGE_MAX,
  materialSchemeThemeGrid,
  validateLook,
} from '../../public/render/look-guards.js';

/** One table, printed. @param {string} title @param {Array<[string, string]>} rows */
function report(title, rows) {
  const w = rows.reduce((a, [k]) => Math.max(a, k.length), 0);
  console.log(`\n  ${title}`);
  for (const [k, v] of rows) console.log(`    ${k.padEnd(w)}  ${v}`);
}

test('§5: all 162 material × scheme × theme combinations pass, and the worst of each is printed', () => {
  const grid = materialSchemeThemeGrid();
  assert.equal(grid.length, 162, 'nine materials × six schemes × three themes');

  let worstField = 0;
  let worstFieldAt = '';
  let worstSpeck = 0;
  let worstSpeckAt = '';
  let worstInk = Infinity;
  let worstInkAt = '';
  /** @type {string[]} */
  const failures = [];

  for (const { material, scheme, theme } of grid) {
    const doc = /** @type {any} */ (themeByName(theme));
    const floor = schemeFloor(doc.floor, scheme);
    const m = materialColours(material, floor);
    const where = `${theme} / ${scheme} / ${material}`;

    // The WP-85a guards, unmodified, over the schemed floor.
    try {
      assertThemeContrast({ name: where, floor, chrome: doc.chrome });
    } catch (err) {
      failures.push(`${where}: ${/** @type {any} */ (err).message}`);
    }
    try {
      assertMaterialDiscipline(
        Object.fromEntries([['field', m.field], ...m.specks.map((s, i) => [`chip${i}`, s])]),
        where,
      );
    } catch (err) {
      failures.push(`${where}: ${/** @type {any} */ (err).message}`);
    }

    // §5: every material's field contrast <= 1.14:1.
    for (let i = 0; i < m.tones.length; i++) {
      for (let j = i + 1; j < m.tones.length; j++) {
        const ratio = contrastRatio(m.tones[i], m.tones[j]);
        if (ratio > worstField) {
          worstField = ratio;
          worstFieldAt = where;
        }
        if (ratio > BOARD_MAX_INTERNAL_CONTRAST + 1e-9) {
          failures.push(`${where}: field contrast ${ratio.toFixed(3)}`);
        }
      }
    }
    // §5: every speck <= 2.0:1.
    for (const speck of m.specks) {
      const ratio = contrastRatio(speck, m.field);
      if (ratio > worstSpeck) {
        worstSpeck = ratio;
        worstSpeckAt = where;
      }
      if (ratio > SPECK_MAX_CONTRAST + 1e-9) {
        failures.push(`${where}: speck contrast ${ratio.toFixed(3)}`);
      }
    }
    // §5: none brighter than its theme's wall.
    const wall = relativeLuminance(floor.wall);
    for (const colour of [m.field, ...m.tones, ...m.specks]) {
      if (relativeLuminance(colour) > wall + 1e-9) {
        failures.push(`${where}: ${colour} is brighter than the wall`);
      }
    }
    // And the ink on it, bare and under a pool of light.
    for (const ground of [m.field, pooled(m.field, lightInkFor(floor.ink))]) {
      const ratio = contrastRatio(floor.ink, ground);
      if (ratio < worstInk) {
        worstInk = ratio;
        worstInkAt = where;
      }
      if (ratio + 1e-9 < 4.5) failures.push(`${where}: floor ink ${ratio.toFixed(2)}`);
    }
  }

  report('§5 the 162, measured', [
    ['combinations', String(grid.length)],
    [
      'worst field contrast',
      `${worstField.toFixed(3)}:1  (${worstFieldAt}) — ceiling ${BOARD_MAX_INTERNAL_CONTRAST}`,
    ],
    [
      'worst speck contrast',
      `${worstSpeck.toFixed(3)}:1  (${worstSpeckAt}) — ceiling ${SPECK_MAX_CONTRAST}`,
    ],
    ['worst floor ink', `${worstInk.toFixed(2)}:1  (${worstInkAt}) — bar 4.5`],
  ]);
  assert.deepEqual(failures, []);
});

test('§1.b: no scheme moves a token’s relative luminance by more than 0.01', () => {
  let worst = 0;
  let worstAt = '';
  for (const theme of THEMES) {
    for (const id of SCHEME_IDS) {
      for (const key of [...SCHEME_SURFACES, 'plant']) {
        const before = relativeLuminance(theme.floor[key]);
        const after = relativeLuminance(
          schemeColour(theme.floor[key], SCHEMES[id], key !== 'plant'),
        );
        const drift = Math.abs(after - before);
        if (drift > worst) {
          worst = drift;
          worstAt = `${theme.name} / ${id} / ${key}`;
        }
      }
    }
  }
  report('§1.b the luminance lock', [
    ['scheme × theme pairs', String(THEMES.length * SCHEME_IDS.length)],
    ['worst ΔL', `${worst.toFixed(5)}  (${worstAt}) — bar ${SCHEME_MAX_LUMINANCE_DRIFT}`],
  ]);
  assert.ok(worst <= SCHEME_MAX_LUMINANCE_DRIFT, `${worst} > ${SCHEME_MAX_LUMINANCE_DRIFT}`);
});

test('§3: every preset passes on every theme, and the zone edges are printed', () => {
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const preset of PRESETS) {
    /** @type {string[]} */
    const edges = [];
    for (const theme of THEMES) {
      const result = validateLook(preset.look, theme.name);
      assert.ok(
        result.ok,
        `${preset.id} on ${theme.name}: ${result.problems.map((p) => p.reason).join('; ')}`,
      );
      const zones = result.resolved.zones;
      edges.push(
        Math.max(
          contrastRatio(zones.office.field, zones.corridor.field),
          contrastRatio(zones.corridor.field, zones.rooms.field),
          contrastRatio(zones.corridor.field, zones.lounge.field),
        ).toFixed(2),
      );
    }
    rows.push([preset.label, `worst zone edge ${edges.join(' / ')} — ceiling ${ZONE_EDGE_MAX}`]);
  }
  report('§3 the six presets (default / night shift / blueprint)', rows);
});

// ------------------------------------------------------------- the refusals

test('§1.d: a rug that would not read is REFUSED, with the ratio, and nothing is clamped', () => {
  // §1.d, verbatim: *"sage on polished concrete is 1.01:1 — the rug would not
  // read"*.
  //
  // THE CASE THE SOLVER CANNOT FIX, and that is why it is this one. A rug is cut
  // against the floor it lies on, so most bad pairings solve themselves — but
  // the WOOL rug lies in TWO zones, the reception and the lounge, and a look
  // that gives those zones different floors is asking one textile to read on
  // both. Here the office is ash and the lounge is concrete, the rug is solved
  // against the ash, and the lounge is where it disappears.
  const look = {
    ...DEFAULT_LOOK,
    floors: { ...DEFAULT_LOOK.floors, office: 'wide-ash', lounge: 'polished-concrete' },
    rugs: { wool: { tone: 'sage', pattern: 'plain' }, task: { tone: 'sage', pattern: 'plain' } },
  };
  const result = validateLook(look, 'default');
  const rug = result.problems.find((p) => p.picker === 'rug.wool');
  assert.ok(rug, `expected a wool-rug refusal; got ${JSON.stringify(result.problems)}`);
  assert.equal(rug.option, 'sage');
  assert.match(rug.rule, /rug on floor/);
  assert.ok(typeof rug.measured === 'number' && typeof rug.needed === 'number');
  assert.ok(rug.measured < RUG_BAND_MIN || rug.measured > RUG_BAND_MAX);
  assert.match(rug.reason, /Polished concrete/);
  assert.match(rug.reason, /would not read/);
  // NOTHING IS CLAMPED. The resolved look still carries what was asked for, so
  // the caller can show the refusal beside the control that caused it and leave
  // the control where it was.
  assert.equal(result.resolved.look.floors.lounge, 'polished-concrete');
  assert.equal(result.resolved.look.rugs.wool.tone, 'sage');
  console.log(`\n    refused: ${rug.reason}`);
});

test('§1 rule 3: two adjacent zones may not share a floor, and the refusal names both', () => {
  const look = {
    ...DEFAULT_LOOK,
    floors: { ...DEFAULT_LOOK.floors, office: 'polished-concrete', corridor: 'polished-concrete' },
  };
  const result = validateLook(look, 'default');
  const zone = result.problems.find((p) => p.picker === 'floor.corridor');
  assert.ok(zone, 'expected a zone refusal');
  assert.match(zone.reason, /corridor.+office|office.+corridor/);
  assert.match(zone.rule, /rule 3/);
  console.log(`    refused: ${zone.reason}`);
});

test('a refusal has a shape: picker, option, rule, measured, needed, reason', () => {
  const result = validateLook(
    {
      ...DEFAULT_LOOK,
      floors: { ...DEFAULT_LOOK.floors, corridor: 'loop-pile', rooms: 'wool-broadloom' },
    },
    'default',
  );
  assert.ok(!result.ok, 'a loop-pile corridor beside a broadloom room shares a tone source');
  for (const problem of result.problems) {
    assert.equal(typeof problem.picker, 'string');
    assert.equal(typeof problem.option, 'string');
    assert.equal(typeof problem.rule, 'string');
    assert.equal(typeof problem.reason, 'string');
    assert.ok(problem.reason.length > 20, 'a reason is a sentence, not a code');
    assert.ok(problem.measured === null || typeof problem.measured === 'number');
    assert.ok(problem.needed === null || typeof problem.needed === 'number');
  }
});

test('the default look is refused by nothing, on any theme', () => {
  for (const theme of THEMES) {
    const result = validateLook(DEFAULT_LOOK, theme.name);
    assert.ok(result.ok, `${theme.name}: ${result.problems.map((p) => p.reason).join('; ')}`);
  }
});

test('every material can be reached from some legal look, so none is offered and unusable', () => {
  // A material nobody can select is a material nobody measured in practice. The
  // claim is weaker than "every combination is legal" — §1's whole point is that
  // some are not — but a material that is legal NOWHERE would be a catalogue row
  // that only ever produces a refusal.
  //
  // The search varies the CORRIDOR as well as the zone under test, because §1
  // rule 3 is about a PAIR: terrazzo and the poured screed are both off the
  // screed, so a terrazzo office beside a screed corridor is refused and a
  // terrazzo office beside a tiled one is not. A reachability test that held the
  // corridor still would be measuring one neighbour rather than the material.
  // It also moves the office and the lounge together where it can, because the
  // wool rug lies in both and one textile cannot read on two different floors.
  /** @type {string[]} */
  const unreachable = [];
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const id of Object.keys(FLOOR_MATERIALS)) {
    const material = FLOOR_MATERIALS[id];
    let reachable = '';
    for (const zone of material.zones) {
      for (const corridor of FLOOR_OPTIONS.corridor) {
        for (const theme of THEMES) {
          /** @type {Record<string,string>} */
          const floors = { ...DEFAULT_LOOK.floors, corridor, [zone]: id };
          if (
            (zone === 'office' || zone === 'lounge') &&
            FLOOR_OPTIONS.office.includes(id) &&
            FLOOR_OPTIONS.lounge.includes(id)
          ) {
            floors.office = id;
            floors.lounge = id;
          }
          if (validateLook({ ...DEFAULT_LOOK, floors }, theme.name).ok) {
            reachable = reachable || `${zone}, beside a ${corridor} corridor`;
          }
        }
      }
    }
    if (!reachable) unreachable.push(id);
    rows.push([id, reachable || 'NOWHERE']);
  }
  report('every material, somewhere legal', rows);
  assert.deepEqual(unreachable, []);
});
