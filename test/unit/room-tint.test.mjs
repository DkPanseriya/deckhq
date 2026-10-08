/**
 * ROOM COLOURS, AS THEY ARE PAINTED.
 *
 * `look-ambience.test.mjs` measures the three levels of room tint as colours:
 * what the six hues come out as on every room floor, how far apart they are and
 * what they keep away from. This file is the other half — that the floor
 * painter lays a project room in exactly the colour that was measured:
 *
 *   - `subtle` hands the painter the project's identity accent and nothing
 *     else, so the room is the washed carpet it has always been;
 *   - `zoned` lays the n-th project's room in the n-th of six tints, whatever
 *     the room's floor is made of, and every tone of that floor stays on its
 *     own luminance;
 *   - `off` hands the painter nothing;
 *   - two rooms whose projects are consecutive are at least 12 RGB apart.
 *
 * IT PRINTS ITS MEASUREMENTS: the Colour plan style's rooms on the three
 * shipped themes, beside the bars each number is held to.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { paintRecorder } from '../helpers/paint-recorder.mjs';
import {
  CRIMSON_MIN_DISTANCE,
  ON_FLOOR_STATES,
  PALETTE,
  RESERVED_CRIMSON,
  STATE_COLORS,
  colourDistance,
  identityFor,
  washedCarpet,
} from '../../public/render/palette.js';
import { THEMES, contrastRatio, relativeLuminance } from '../../public/render/themes.js';
import {
  ALL_LOOK_PICKERS,
  DEFAULT_LOOK,
  FLOOR_OPTIONS,
  LOOK_PICKERS,
  PRESETS,
  ZONE_HUES,
  lookForPreset,
} from '../../public/render/look-options.js';
import {
  ZONE_TINT_MAX_LUMINANCE_DRIFT,
  ZONE_TINT_MIN_SEPARATION,
  ZONE_TINT_MIN_STATE_DISTANCE,
} from '../../public/render/look-ambience.js';
import {
  LOOK,
  applyLook,
  baseboardOf,
  liveMaterial,
  resetLook,
  resolveLook,
  roomAccentFor,
  roomFloorFor,
  roomGroundFor,
  zoneTint,
} from '../../public/render/look-derive.js';
import { roomTintProblems } from '../../public/render/look-guards.js';
import { paintFloorMaterial } from '../../public/render/backdrop-floor-look.js';
import { seededRng } from '../../public/render/backdrop-paint.js';

/** One table, printed. @param {string} title @param {Array<[string, string]>} rows */
function report(title, rows) {
  const w = rows.reduce((a, [k]) => Math.max(a, k.length), 0);
  console.log(`\n  ${title}`);
  for (const [k, v] of rows) console.log(`    ${k.padEnd(w)}  ${v}`);
}

/**
 * Lay one room's floor on a recorder and say what it was filled with.
 * @param {string} material @param {any} tint
 * @returns {{ground:string, fills:string[]}} the first fill, and every opaque one
 */
function lay(material, tint) {
  const ctx = paintRecorder();
  paintFloorMaterial(ctx, material, 0, 0, 280, 210, seededRng('room'), tint, 14);
  const fills = ctx.paints
    .filter((/** @type {any} */ p) => p.op === 'fillRect' && /^#[0-9a-f]{6}$/i.test(p.style))
    .map((/** @type {any} */ p) => String(p.style).toLowerCase());
  return { ground: fills[0], fills: [...new Set(fills)] };
}

test.afterEach(() => resetLook());

test('room colours are offered: the picker, its three levels, and the style drawn around them', () => {
  const picker = LOOK_PICKERS.find((p) => p.id === 'roomTint');
  assert.ok(picker, 'the room-colours picker is catalogued and not offered');
  assert.equal(picker.label, 'Room colours');
  assert.deepEqual(
    picker.options.map((o) => o.id),
    ['subtle', 'zoned', 'off'],
  );
  assert.equal(
    ALL_LOOK_PICKERS.filter((p) => p.pending).length,
    0,
    'a picker is still waiting for a painter',
  );
  assert.ok(
    PRESETS.some((p) => p.id === 'colour-plan'),
    'Colour plan is not on offer',
  );
  assert.equal(lookForPreset('colour-plan').roomTint, 'zoned');
});

test('subtle: the painter is handed the identity accent, and the carpet is the wash it always was', () => {
  const resolved = resolveLook(DEFAULT_LOOK, 'default');
  for (let mk = 1; mk <= 20; mk++) {
    const accent = identityFor(mk).accent;
    // The accent itself, by reference: no second derivation to drift from the first.
    assert.equal(roomGroundFor(resolved, mk, accent), accent);
    const { ground } = lay(DEFAULT_LOOK.floors.rooms, roomGroundFor(LOOK, mk, accent));
    assert.equal(ground, washedCarpet(PALETTE.carpetBase, accent).toLowerCase(), `project ${mk}`);
    assert.equal(ground, roomFloorFor(resolved, mk, accent).toLowerCase(), `project ${mk}`);
  }
  // Nothing in a subtle room is in a colour of the room's own.
  assert.equal(roomAccentFor(resolved, 3), null);
});

test('off: the painter is handed nothing, and the room is the bare material', () => {
  const look = { ...DEFAULT_LOOK, roomTint: 'off' };
  for (const theme of THEMES) {
    applyLook(look, theme.name);
    assert.equal(roomGroundFor(LOOK, 4, identityFor(4).accent), null);
    const { ground } = lay(look.floors.rooms, roomGroundFor(LOOK, 4, identityFor(4).accent));
    assert.equal(ground, String(LOOK.zones.rooms.field).toLowerCase(), theme.name);
    assert.equal(roomAccentFor(LOOK, 4), null);
  }
});

test('zoned: Colour plan’s rooms are painted in the six tints the guard measured, on three themes', () => {
  /** @type {Array<[string, string]>} */
  const rows = [];
  for (const theme of THEMES) {
    const look = lookForPreset('colour-plan');
    applyLook(look, theme.name);
    assert.deepEqual(roomTintProblems(LOOK), [], `${theme.name}: the guard refuses Colour plan`);
    const field = LOOK.zones.rooms.field;
    const ink = LOOK.floor.ink;
    const wall = relativeLuminance(LOOK.floor.wall);
    /** @type {string[]} */
    const painted = [];
    for (let mk = 1; mk <= 13; mk++) {
      const tint = roomGroundFor(LOOK, mk, identityFor(mk).accent);
      assert.equal(typeof tint, 'function', 'a zoned room is handed its tint, not an accent');
      const { ground } = lay(look.floors.rooms, tint);
      // The painter and the guard, on the same colour: the n-th of six.
      assert.equal(ground, LOOK.roomTint.tints[(mk - 1) % 6].toLowerCase(), `project ${mk}`);
      assert.equal(ground, roomFloorFor(LOOK, mk).toLowerCase());
      painted.push(ground);
    }
    let next = Infinity;
    let drift = 0;
    let crimson = Infinity;
    let state = Infinity;
    let name = Infinity;
    let above = -Infinity;
    painted.forEach((colour, i) => {
      // Two consecutive projects, the seventh beside the sixth included.
      if (i > 0) next = Math.min(next, colourDistance(colour, painted[i - 1]));
      drift = Math.max(drift, Math.abs(relativeLuminance(colour) - relativeLuminance(field)));
      crimson = Math.min(crimson, colourDistance(colour, RESERVED_CRIMSON));
      for (const s of ON_FLOOR_STATES) {
        state = Math.min(state, colourDistance(colour, /** @type {any} */ (STATE_COLORS)[s]));
      }
      name = Math.min(name, contrastRatio(ink, colour));
      above = Math.max(above, relativeLuminance(colour) - wall);
    });
    assert.ok(next >= ZONE_TINT_MIN_SEPARATION, `${theme.name}: neighbours ${next.toFixed(1)}`);
    assert.ok(drift <= ZONE_TINT_MAX_LUMINANCE_DRIFT, `${theme.name}: drift ${drift}`);
    assert.ok(crimson >= CRIMSON_MIN_DISTANCE, `${theme.name}: crimson ${crimson}`);
    assert.ok(state >= ZONE_TINT_MIN_STATE_DISTANCE, `${theme.name}: state ${state}`);
    assert.ok(name >= 4.5, `${theme.name}: a name is ${name.toFixed(2)}:1`);
    assert.ok(above <= 1e-9, `${theme.name}: a room is brighter than the wall`);
    rows.push([
      theme.name,
      `ink ${name.toFixed(2)}:1 · drift ${drift.toFixed(4)} · crimson ${crimson.toFixed(0)} · ` +
        `state ${state.toFixed(0)} · consecutive ≥ ${next.toFixed(1)} · brighter than wall 0`,
    ]);
    // A panel on a zoned room's wall is in that room's accent, the n-th of six.
    assert.equal(roomAccentFor(LOOK, 8), LOOK.roomTint.accents[1]);
  }
  report(
    `zoned, as painted — bars: ink 4.5 · drift ${ZONE_TINT_MAX_LUMINANCE_DRIFT} · crimson ` +
      `${CRIMSON_MIN_DISTANCE} · state ${ZONE_TINT_MIN_STATE_DISTANCE} · consecutive ${ZONE_TINT_MIN_SEPARATION}`,
    rows,
  );
});

test('zoned: every floor a room can have takes the room’s colour, each tone on its own luminance', () => {
  /** @type {Array<[string, string]>} */
  const rows = [];
  for (const material of FLOOR_OPTIONS.rooms) {
    applyLook({ ...DEFAULT_LOOK, floors: { ...DEFAULT_LOOK.floors, rooms: material } }, 'default');
    const bare = lay(material, null);
    const base = liveMaterial(material);
    for (const [i, { hue }] of ZONE_HUES.entries()) {
      const tint = /** @type {(c:string)=>string} */ (
        roomGroundFor({ roomTint: { zoned: true, hues: ZONE_HUES } }, i + 1)
      );
      const tinted = lay(material, tint);
      assert.equal(tinted.ground, zoneTint(base.field, hue).toLowerCase(), `${material}/${hue}`);
      assert.notEqual(tinted.ground, bare.ground, `${material}: hue ${hue} left the floor bare`);
      // Every tone it is laid in is one of the bare floor's, through the tint:
      // the pattern is the material's own and nothing in it was left bare.
      const expected = new Set(bare.fills.map((c) => tint(c).toLowerCase()));
      for (const fill of tinted.fills) {
        assert.ok(expected.has(fill), `${material}/${hue}: ${fill} is not a tinted tone`);
      }
      for (const tone of [base.field, ...base.tones]) {
        const d = Math.abs(relativeLuminance(tint(tone)) - relativeLuminance(tone));
        assert.ok(d <= ZONE_TINT_MAX_LUMINANCE_DRIFT, `${material}/${hue}: ${tone} drifts ${d}`);
      }
      // Its baseboard is that floor's, a step darker: never the bare floor's.
      assert.notEqual(baseboardOf(tinted.ground), base.baseboard);
    }
    rows.push([material, `${bare.fills.length} tone(s), six tints each`]);
  }
  assert.equal(rows.length, 7, 'seven floors are offered in a project room');
  report('zoned on every room floor', rows);
});
