/**
 * THE LOOK CATALOGUE, THE DERIVATION, AND THE ONE PROPERTY EVERYTHING RESTS ON
 * (WP-88a). `docs/plan/11-LOOK-CONTROL-CENTRE.md` §1, §3, §5.
 *
 * The property is **the default look is the shipped floor**, byte for byte:
 * §3's owner decision 2, and the reason `goldens:check` is allowed to stay at
 * 0 px through a package that touched every painter on this floor. It is
 * asserted three ways here — the material tokens, the emitted plan, and the
 * source of the painters themselves — and once more in the goldens.
 *
 * IT PRINTS ITS MEASUREMENTS, in `interior.test.mjs`'s style, so a change that
 * moves a number shows you what it moved rather than only that it moved.
 */

// A machine of our own, before anything under `src/` is loaded.
// `docs/DEVIATIONS.md` §124.
import '../helpers/isolate.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPlan } from '../../public/render/plan.js';
import {
  CARPET_IDENTITY_WASH,
  DEFAULT_PALETTE,
  LIGHT_DIR,
  PALETTE,
} from '../../public/render/palette.js';
import {
  LIGHT_POOL_ALPHA_DARK,
  LIGHT_POOL_ALPHA_LIGHT,
  LIGHT_POOL_COLOR,
  THEMES,
} from '../../public/render/themes.js';
import {
  AGENT_SIZES,
  ALL_LOOK_PICKERS,
  ALL_PRESETS,
  DEFAULT_LOOK,
  LIGHT_MOODS,
  LIGHT_MOOD_IDS,
  LOOK_OFFERED_OPTION_COUNT,
  PARTITION_STYLE_IDS,
  PRESET_IDS,
  ROOM_TINTS,
  ROOM_TINT_IDS,
  pendingPaths,
  FLOOR_MATERIALS,
  FLOOR_MATERIAL_IDS,
  FLOOR_OPTIONS,
  FURNITURE_SET_IDS,
  LOOK_OPTION_COUNT,
  LOOK_PICKERS,
  LOOK_ZONES,
  LOUNGE_KIT_BAYS,
  PLANT_DENSITIES,
  PLANT_FAMILIES,
  PLANT_FAMILY_IDS,
  PROP_DENSITIES,
  PRESETS,
  RUG_PATTERN_IDS,
  RUG_ROLES,
  SCHEME_IDS,
  SCHEMES,
  ZONE_ADJACENCY,
  lookForPreset,
  normalizeLook,
  presetById,
  sameLook,
} from '../../public/render/look-options.js';
import { applyLook, resetLook, resolveLook } from '../../public/render/look-derive.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDER = path.join(HERE, '..', '..', 'public', 'render');
const NOW = 1_800_000_000_000;

/** One table, printed. @param {string} title @param {Array<[string, string]>} rows */
function report(title, rows) {
  const w = rows.reduce((a, [k]) => Math.max(a, k.length), 0);
  console.log(`\n  ${title}`);
  for (const [k, v] of rows) console.log(`    ${k.padEnd(w)}  ${v}`);
}

/** A plan over a fixed population — the `demo` shape every geometry suite uses. */
function demoPlan() {
  const sizes = [4, 3, 2, 2, 1, 1];
  /** @type {any[]} */
  const agents = [];
  const projects = sizes.map((n, i) => ({
    id: `p${i}`,
    name: `p${i}`,
    sessionCount: n,
    tokens: 1000 * (i + 1),
    needsYou: 0,
  }));
  /** @param {string} id @param {any} over */
  const at = (id, over) => ({
    id,
    projectId: 'p0',
    activityState: 'working',
    ackState: 'active',
    reviewSince: null,
    lastActivityAt: NOW - 60_000,
    ...over,
  });
  sizes.forEach((n, i) => {
    for (let k = 0; k < n; k++) agents.push(at(`p${i}-${k}`, { projectId: `p${i}` }));
  });
  for (let k = 0; k < 6; k++)
    agents.push(at(`b${k}`, { ackState: 'benched', activityState: 'ended' }));
  for (let k = 0; k < 4; k++)
    agents.push(at(`w${k}`, { activityState: 'for_review', reviewSince: 1_000_000 + k }));
  return buildPlan(projects, agents, { now: NOW, stage: { w: 1600, h: 1000 } });
}

/** A plan's hash: its whole emitted geometry, as one string. @param {any} plan */
function planHash(plan) {
  return JSON.stringify(plan);
}

// ------------------------------------------------------- catalogue integrity

test('§1: fourteen pickers and 72 options, and every one of them is offered', () => {
  // Ten and 52 through WP-88b; WP-88c's agent size is the eleventh, and its four
  // settings take the count to 56. Both numbers are computed from the tables, so
  // a package that adds an option has to come here and say so.
  //
  // G6a came here: the light, the partitions and the room tint are three
  // pickers and nine options. The light and the partitions were painted first
  // and offered first; the room tint waited for its painter and is offered now
  // that a project room's floor is laid in it. Three more floor materials add
  // seven options across the zones that offer them. Nothing is pending: what
  // the catalogue names and what a surface offers are the same fourteen.
  assert.equal(ALL_LOOK_PICKERS.length, 14);
  assert.equal(LOOK_OPTION_COUNT, 72);
  assert.equal(LOOK_PICKERS.length, 14);
  assert.equal(LOOK_OFFERED_OPTION_COUNT, 72);
  const pending = ALL_LOOK_PICKERS.filter((p) => p.pending);
  assert.deepEqual(
    pending.map((p) => p.id),
    [],
  );
  assert.equal(
    pending.reduce((n, p) => n + p.options.length, 0),
    LOOK_OPTION_COUNT - LOOK_OFFERED_OPTION_COUNT,
  );
  // The offered list is the catalogue minus the pending ones, in catalogue
  // order — not a second list somebody has to keep in step.
  assert.deepEqual(
    LOOK_PICKERS,
    ALL_LOOK_PICKERS.filter((p) => !p.pending),
  );
  report(
    'the fourteen pickers',
    ALL_LOOK_PICKERS.map((p) => [
      p.id,
      `${p.options.length} options${p.pending ? '  (pending: no painter reads it yet)' : ''}`,
    ]),
  );
});

test('every id in the catalogue is unique inside its own picker', () => {
  for (const picker of ALL_LOOK_PICKERS) {
    const ids = picker.options.map((o) => o.id);
    assert.equal(new Set(ids).size, ids.length, `${picker.id} repeats an option id`);
    for (const option of picker.options) {
      assert.ok(option.label && option.label.trim(), `${picker.id}/${option.id} has no label`);
    }
  }
  assert.equal(new Set(FLOOR_MATERIAL_IDS).size, FLOOR_MATERIAL_IDS.length);
});

test('§1.a: twelve materials, and each zone offers exactly the ones the table gives it', () => {
  assert.equal(FLOOR_MATERIAL_IDS.length, 12);
  assert.deepEqual(
    LOOK_ZONES.map((z) => FLOOR_OPTIONS[z].length),
    [8, 4, 7, 8],
  );
  // No carpet of any kind in the lounge.
  for (const id of FLOOR_OPTIONS.lounge) assert.notEqual(FLOOR_MATERIALS[id].source, 'carpet');
  // *"No broadloom in the lounge, because a lounge is a hard floor with rugs
  // on it."*
  assert.ok(!FLOOR_OPTIONS.lounge.includes('wool-broadloom'));
  for (const id of FLOOR_MATERIAL_IDS) {
    const material = FLOOR_MATERIALS[id];
    assert.ok(material.zones.length > 0, `${id} is offered nowhere`);
    assert.ok(material.source, `${id} names no tone source`);
    assert.ok(Object.keys(material.pattern).length > 0, `${id} has no pattern rule`);
  }
  report(
    '§1.a the twelve materials',
    FLOOR_MATERIAL_IDS.map((id) => [
      id,
      `${FLOOR_MATERIALS[id].zones.join(' ')} · from ${FLOOR_MATERIALS[id].source}`,
    ]),
  );
});

test('§3: eleven presets, all of them offered, each referencing only options this build has', () => {
  assert.equal(ALL_PRESETS.length, 11);
  assert.equal(PRESETS.length, 11);
  assert.equal(new Set(ALL_PRESETS.map((p) => p.id)).size, 11);
  assert.deepEqual(
    PRESET_IDS,
    ALL_PRESETS.map((p) => p.id),
  );
  for (const preset of ALL_PRESETS) {
    assert.ok(preset.blurb && preset.blurb.trim(), `${preset.id} has no blurb`);
    const look = preset.look;
    assert.equal(look.preset, preset.id);
    assert.ok(LIGHT_MOOD_IDS.includes(look.light));
    assert.ok(PARTITION_STYLE_IDS.includes(look.partitions));
    assert.ok(ROOM_TINT_IDS.includes(look.roomTint));
    for (const zone of LOOK_ZONES) {
      assert.ok(
        FLOOR_OPTIONS[zone].includes(look.floors[zone]),
        `${preset.id}: ${look.floors[zone]} is not offered in the ${zone}`,
      );
    }
    assert.ok(SCHEME_IDS.includes(look.scheme));
    assert.ok(FURNITURE_SET_IDS.includes(look.furniture));
    assert.ok(PLANT_FAMILY_IDS.includes(look.plants.family));
    assert.ok(AGENT_SIZES.includes(look.agentSize));
    for (const role of RUG_ROLES) assert.ok(RUG_PATTERN_IDS.includes(look.rugs[role].pattern));
    for (const bay of LOUNGE_KIT_BAYS) assert.equal(typeof look.lounge[bay], 'boolean');
    assert.equal(look.lounge.sitting, true, `${preset.id} turned the sitting bay off`);
    // §1 rule 3, at the level a preset can break it without any measurement.
    for (const [a, b] of ZONE_ADJACENCY) {
      assert.notEqual(
        look.floors[a],
        look.floors[b],
        `${preset.id}: the ${a} and the ${b} are the same floor`,
      );
    }
  }
});

test('a look normalises to itself, and an unknown option is dropped rather than kept', () => {
  assert.deepEqual(normalizeLook(DEFAULT_LOOK), { ...DEFAULT_LOOK });
  const hostile = normalizeLook({
    floors: { office: '../../etc/passwd', corridor: 'poured-screed' },
    scheme: '<script>',
    furniture: 42,
    rugs: { wool: { tone: 'neon', pattern: 'plaid' } },
    plants: { family: null, density: 'lush' },
    props: { density: 'busy' },
    lounge: { sitting: false, games: false, hovercraft: true },
    agentSize: 'enormous',
    somethingElse: 1,
  });
  assert.equal(hostile.floors.office, DEFAULT_LOOK.floors.office);
  assert.equal(hostile.scheme, 'warm');
  assert.equal(hostile.furniture, 'scandi');
  assert.equal(hostile.rugs.wool.tone, 'wool');
  assert.equal(hostile.plants.family, 'leafy');
  // What WAS legal survives, which is what makes this a sanitiser rather than a
  // reset: the corridor, the lush planting and the busy props are all real.
  assert.equal(hostile.floors.corridor, 'poured-screed');
  assert.equal(hostile.plants.density, 'lush');
  assert.equal(hostile.props.density, 'busy');
  assert.equal(hostile.lounge.games, false);
  // §1.g: the sitting bay may not be turned off.
  assert.equal(hostile.lounge.sitting, true);
  assert.ok(!('somethingElse' in hostile));
});

test('`?look=` resolves a preset by name, in any case and with any separator', () => {
  assert.equal(presetById('Night_Lab')?.id, 'night-lab');
  assert.equal(presetById('night lab')?.id, 'night-lab');
  assert.equal(presetById('not-a-preset'), null);
  assert.ok(sameLook(lookForPreset('not-a-preset'), DEFAULT_LOOK));
});

// ------------------------------------------- G6a: the three keys, and pending

test('G6a: the default look names the light, the partitions and the room tint it always had', () => {
  assert.equal(DEFAULT_LOOK.light, 'noon');
  assert.equal(DEFAULT_LOOK.partitions, 'solid');
  assert.equal(DEFAULT_LOOK.roomTint, 'subtle');
  // NOON IS THE SHIPPED LIGHT BY REFERENCE, not by a second copy of its numbers:
  // the direction is `LIGHT_DIR` itself and the patch is the desk pool.
  assert.equal(LIGHT_MOODS.noon.dir, LIGHT_DIR);
  assert.equal(LIGHT_MOODS.noon.cast, 1);
  assert.equal(LIGHT_MOODS.noon.patch, LIGHT_POOL_COLOR);
  assert.equal(LIGHT_MOODS.noon.alphaLight, LIGHT_POOL_ALPHA_LIGHT);
  assert.equal(LIGHT_MOODS.noon.alphaDark, LIGHT_POOL_ALPHA_DARK);
  // …and `subtle` is the identity wash at the ceiling the floor already holds.
  assert.equal(ROOM_TINTS.subtle.wash, CARPET_IDENTITY_WASH);
  // Nothing is pending about the floor as it ships.
  assert.deepEqual(pendingPaths(DEFAULT_LOOK), []);
});

test('G6a: every mood lights the floor from the same quadrant, and is a unit vector', () => {
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const id of LIGHT_MOOD_IDS) {
    const mood = LIGHT_MOODS[id];
    // Down and to the right, all three: the floor has one light, and a mood
    // moves it along an arc rather than to the other side of the building.
    assert.ok(mood.dir.x > 0 && mood.dir.y > 0, `${id} does not point down-right`);
    assert.ok(Math.abs(Math.hypot(mood.dir.x, mood.dir.y) - 1) < 1e-12, `${id} is not a unit`);
    const angle = (Math.atan2(mood.dir.y, mood.dir.x) * 180) / Math.PI;
    assert.ok(Math.abs(angle - mood.angle) < 1e-9, `${id}: ${angle}° is not ${mood.angle}°`);
    assert.ok(mood.cast >= 1, `${id} casts shorter than noon`);
    assert.match(mood.patch, /^#[0-9a-f]{6}$/i);
    rows.push([
      id,
      `${mood.angle}°  cast ×${mood.cast}  ${mood.patch} at ${mood.alphaLight} / ${mood.alphaDark}`,
    ]);
  }
  report('G6a the three moods (patch alpha: light theme / dark theme)', rows);
});

test('G6a: a missing key is the default, and an unknown one is dropped', () => {
  // The whole of backward compatibility, at the level of the model: a look that
  // was stored before the three keys existed has none of them.
  const { light: _l, partitions: _p, roomTint: _t, ...before } = DEFAULT_LOOK;
  assert.deepEqual(normalizeLook(before), { ...DEFAULT_LOOK });
  const hostile = normalizeLook({ light: 'midnight', partitions: 42, roomTint: { zoned: true } });
  assert.equal(hostile.light, 'noon');
  assert.equal(hostile.partitions, 'solid');
  assert.equal(hostile.roomTint, 'subtle');
  const chosen = normalizeLook({ light: 'evening', partitions: 'glass', roomTint: 'zoned' });
  assert.deepEqual(
    [chosen.light, chosen.partitions, chosen.roomTint],
    ['evening', 'glass', 'zoned'],
  );
  assert.ok(!sameLook(chosen, DEFAULT_LOOK), 'a different light is a different floor');
});

test('G6a: a preset is pending exactly while it asks for an option no painter reads', () => {
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const preset of ALL_PRESETS) {
    const waiting = pendingPaths(preset.look);
    assert.equal(preset.pending, waiting.length > 0, `${preset.id}: pending is not computed`);
    assert.equal(PRESETS.includes(preset), !preset.pending);
    rows.push([preset.label, waiting.length ? `pending: ${waiting.join(', ')}` : 'offered']);
  }
  // The six that shipped ask for nothing new and come first, as they were.
  // The five new ones ask for a light, a partition style and a room tint, and
  // all three are painted, so all five are offered — in catalogue order.
  const shipped = [
    'studio-oak',
    'night-lab',
    'paper-office',
    'terrazzo-hall',
    'garden-floor',
    'workshop',
  ];
  assert.deepEqual(
    PRESETS.map((p) => p.id),
    [
      ...shipped,
      'daylight-studio',
      'graphite-loft',
      'nordic-wool',
      'colour-plan',
      'walnut-executive',
    ],
  );
  for (const preset of PRESETS.filter((p) => shipped.includes(p.id))) {
    assert.deepEqual(
      [preset.look.light, preset.look.partitions, preset.look.roomTint],
      ['noon', 'solid', 'subtle'],
      `${preset.id} moved a pending option`,
    );
  }
  report('G6a the eleven presets', rows);
});

test('G6a: no preset is pending any more, so a chooser reaches all eleven', () => {
  // `presetById` is what `?look=` and the cards ask. A pending style was not on
  // offer; the last three waited for the room tint, and its painter has landed.
  const waiting = ALL_PRESETS.filter((p) => p.pending);
  assert.equal(waiting.length, 0);
  for (const preset of ALL_PRESETS) {
    assert.equal(presetById(preset.id), preset, `${preset.id} is catalogued and not choosable`);
    // A look that ARRIVES with that name — in a file, from another build —
    // keeps it, and resolves to the look the name means.
    assert.equal(normalizeLook({ preset: preset.id }).preset, preset.id);
    assert.deepEqual(lookForPreset(preset.id), { ...preset.look });
  }
  // The three that asked for a room colour are among them, and a look that
  // moves the room tint has nothing waiting on a painter.
  for (const id of ['graphite-loft', 'colour-plan', 'walnut-executive']) {
    assert.notEqual(lookForPreset(id).roomTint, DEFAULT_LOOK.roomTint);
    assert.deepEqual(pendingPaths(lookForPreset(id)), []);
  }
  // A name nobody has ever heard of is still nobody.
  assert.equal(presetById('chartreuse-basement'), null);
});

// -------------------------------------------------- the default is the floor

test('§3 owner decision 2: the default look derives EVERY shipped material token exactly', () => {
  const resolved = resolveLook(DEFAULT_LOOK, 'default');
  /** @type {string[]} */
  const diffs = [];
  for (const [token, value] of Object.entries(resolved.tokens)) {
    const shipped = DEFAULT_PALETTE[token];
    if (String(shipped).toLowerCase() !== String(value).toLowerCase()) {
      diffs.push(`${token}: ${shipped} -> ${value}`);
    }
  }
  assert.deepEqual(diffs, [], 'Studio oak is not the floor that ships');
  report('the default look', [
    ['zones', LOOK_ZONES.map((z) => `${z}=${resolved.zones[z].id}`).join(' ')],
    ['rugs', `wool ${resolved.rugs.wool.colour} · task ${resolved.rugs.task.colour}`],
    ['props', `1 per ${resolved.props.clearU2} U²`],
    ['plants', `${resolved.plants.family.id} · ${resolved.plants.density.id}`],
    ['bays', resolved.lounge.bays.join(', ')],
    ['agent size', resolved.agentSize],
  ]);
});

test('§3: applying the default look on the default theme restores the shipped palette', () => {
  try {
    // A theme, a look, and then back: the reset path is the one that cannot
    // drift from `DEFAULT_PALETTE` by a channel count, and it is what
    // `goldens:check` is measuring when it says 0 px.
    applyLook({ ...DEFAULT_LOOK, scheme: 'ink' }, 'night shift');
    applyLook(DEFAULT_LOOK, 'default');
    for (const [token, shipped] of Object.entries(DEFAULT_PALETTE)) {
      assert.equal(PALETTE[token], shipped, `PALETTE.${token} did not come back`);
    }
  } finally {
    resetLook();
  }
});

test('§1.c: a furniture set is PAINT — the emitted plan is byte-identical across all three', () => {
  const hashes = new Map();
  try {
    for (const set of FURNITURE_SET_IDS) {
      applyLook({ ...DEFAULT_LOOK, furniture: set }, 'default');
      hashes.set(set, planHash(demoPlan()));
    }
  } finally {
    resetLook();
  }
  const [first, ...rest] = [...hashes.values()];
  for (const [i, hash] of rest.entries()) {
    assert.equal(hash, first, `the ${FURNITURE_SET_IDS[i + 1]} set moved the plan`);
  }
});

test('the default look emits the plan this floor has always emitted', () => {
  const before = planHash(demoPlan());
  try {
    applyLook(DEFAULT_LOOK, 'default');
    assert.equal(planHash(demoPlan()), before);
  } finally {
    resetLook();
  }
});

test('§1.e and §1.f: a density is a CEILING the plan honours', () => {
  /** @param {string} density */
  const plantsIn = (density) => {
    applyLook({ ...DEFAULT_LOOK, plants: { ...DEFAULT_LOOK.plants, density } }, 'default');
    const plan = demoPlan();
    return plan.rooms
      .flatMap((/** @type {any} */ r) => r.props || [])
      .filter((/** @type {any} */ p) => String(p.kind).startsWith('plant_')).length;
  };
  try {
    const sparse = plantsIn('sparse');
    const normal = plantsIn('normal');
    const lush = plantsIn('lush');
    report('§1.e planting', [
      ['sparse', String(sparse)],
      ['normal', String(normal)],
      ['lush', String(lush)],
    ]);
    // A ceiling, not a quota: WP-85c's rules bind first, so `lush` is allowed to
    // reach the same number as `normal` on a floor with no room for more — but
    // it may never be FEWER, and `sparse` may never be more.
    assert.ok(sparse <= normal, 'sparse planted more than normal');
    assert.ok(lush >= normal, 'lush planted fewer than normal');
  } finally {
    resetLook();
  }
  // The prop density is a rule the plan is measured against rather than a count
  // it emits (§3.5 — decoration is a function of anchors, not of area), so the
  // claim here is that the number the rule reads is the look's.
  for (const [id, spec] of Object.entries(PROP_DENSITIES)) {
    assert.ok(spec.clearU2 > 0, `${id} has no clear-floor rule`);
  }
  assert.equal(PROP_DENSITIES.normal.clearU2, 9, '§3.5 ships at one prop per 9 U²');
  assert.equal(PLANT_DENSITIES.normal.room, 2, '§3.6 ships at two plants per project room');
  assert.equal(PLANT_DENSITIES.normal.bay, 6, '§3.6 ships at six plants per lounge bay');
});

test('§1.g: the lounge kit is a ceiling over the bays, and `sitting` survives it', () => {
  try {
    applyLook(
      { ...DEFAULT_LOOK, lounge: { sitting: true, quiet: false, cafe: false, games: false } },
      'default',
    );
    const plan = demoPlan();
    const bays = new Set(
      plan.rooms.flatMap((/** @type {any} */ r) =>
        (r.bays || []).map((/** @type {any} */ b) => b.bay),
      ),
    );
    assert.ok(!bays.has('games'), 'the games bay survived a kit that turned it off');
    assert.ok(!bays.has('cafe'), 'the café bay survived a kit that turned it off');
  } finally {
    resetLook();
  }
});

// ------------------------------------------------ the painters read the look

test('no painter holds a floor material of its own', () => {
  // A SOURCE-READING TEST, in `interior.test.mjs`'s style. §1's construction is
  // that a material derives from the theme's eleven tokens and nothing else, and
  // the way that fails is not a bad derivation — it is somebody typing a hex
  // literal into a painter because it looked right in one screenshot.
  //
  // `palette-colors.js` is the shipped default (the one true table), `themes.js`
  // the derivation, and `look-options.js` the catalogue; those three are where
  // colours live. Every other file under `public/render/` may name a token and
  // may not name a colour.
  //
  // THE SET IS THE FLOOR PAINTERS, NAMED. `palette-avatars.js`,
  // `palette-identity.js` and the three `rig-*.js` files are PEOPLE, and
  // `backdrop-props-lounge.js` and `backdrop-props-play.js` hold the pool cloth,
  // the arcade cabinet and the framed art — *"a theme repaints no prop: monitors,
  // the hob and the billiard cloth are objects"* (`themes.test.mjs`). A material
  // is a surface of the building, and the building is what this list covers.
  const painters = [
    'backdrop.js',
    'backdrop-floor.js',
    'backdrop-floor-look.js',
    'backdrop-paint.js',
    'backdrop-props-desk.js',
    'backdrop-props-plant.js',
    'look-derive.js',
    'look-guards.js',
  ];
  /** @type {string[]} */
  const offenders = [];
  for (const file of painters) {
    assert.ok(fs.existsSync(path.join(RENDER, file)), `${file} is gone; update this list`);
    const src = fs
      .readFileSync(path.join(RENDER, file), 'utf8')
      // Comments first: several files explain a colour in prose, and that
      // history is worth keeping. It is a hex literal in CODE that would mean a
      // painter had stopped reading the floor it is painting.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const match of src.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
      // White and black are not materials: they are the ends of `shade` and the
      // stops of a gradient, and every one of them is composited at an alpha a
      // guard has already measured (`sheenOver`).
      if (/^#(ffffff|000000)$/i.test(match[0])) continue;
      offenders.push(`${file}: ${match[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'a painter names a colour of its own; materials come from the theme’s eleven tokens',
  );
});

test('every scheme is a named transform, and `warm` is the identity', () => {
  assert.equal(SCHEME_IDS.length, 6);
  assert.equal(SCHEMES.warm.weight, 0);
  assert.equal(SCHEMES.warm.chroma, 1);
  for (const theme of THEMES) {
    const warm = resolveLook({ ...DEFAULT_LOOK, scheme: 'warm' }, theme.name);
    for (const [key, value] of Object.entries(theme.floor)) {
      assert.equal(warm.floor[key], value, `warm moved ${key} on ${theme.name}`);
    }
  }
});

test('§1.e: a plant family changes the silhouette and never a footprint', () => {
  for (const id of PLANT_FAMILY_IDS) {
    const family = PLANT_FAMILIES[id];
    assert.ok(family.broad.length >= 3, `${id} has no broad silhouette`);
    assert.ok(family.blade.length >= 3, `${id} has no blade silhouette`);
    assert.equal(family.tree.length, 3, `${id}'s tree is not one crown and two masses`);
    assert.ok(Math.abs(family.shade) <= 0.06, `${id} shades the foliage past ±0.06`);
  }
  // The shipped planting is `leafy`, and its shade is zero — which is what makes
  // the default look byte-identical in the one painter a family reaches.
  assert.equal(PLANT_FAMILIES.leafy.shade, 0);
});
