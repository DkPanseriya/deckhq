/**
 * The interior: materials, palette, floors, walls, and the halo under people.
 *
 * `docs/plan/10-INTERIOR-DESIGN.md` §3 is the design this guards and §5's
 * WP-85a list is the acceptance surface. It is worth its own suite because
 * every defect it exists to prevent was live on the committed goldens and
 * measurable there, and not one of them was reachable from any existing test:
 * `assertThemeContrast` measured state colours against the CHROME and never
 * against the floor, and nothing at all measured a pattern's scale, a seam's
 * weight or a material against the wall it stands under.
 *
 * IT PRINTS ITS MEASUREMENTS. Every ratio the design document quotes is
 * re-derived here and written to the runner's output, so a change that moves a
 * material shows you what it moved rather than only that it moved — and the
 * numbers in §3.1 stop being a claim somebody made once.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FIGURE_HALO,
  FIGURE_HALO_POOL_ALPHA,
  FIGURE_HALO_POOL_SPAN,
  FIGURE_HALO_RIM_PX,
  ON_FLOOR_STATES,
  PROJECT_IDENTITIES,
  STATE_COLORS,
  figureHaloMode,
  relativeLuminanceOf,
  washedCarpet,
} from '../../public/render/palette.js';
import {
  assertFigureHaloContrast,
  assertThemeContrast,
  BOARD_MAX_INTERNAL_CONTRAST,
  BOARD_SEAM_ALPHA,
  BOARD_TONE_SPREAD,
  contrastRatio,
  GROUND_KEYS,
  interiorHighlights,
  LIGHT_POOL_ALPHA_DARK,
  LIGHT_POOL_ALPHA_LIGHT,
  LIGHT_POOL_COLOR,
  lightInkFor,
  materialTokensFor,
  over,
  plateGroundOver,
  pooled,
  relativeLuminance,
  shade,
  THEMES,
} from '../../public/render/themes.js';
import {
  BREAKOUT_BAND,
  BREAKOUT_CLEAR_RATIO,
  SEAT_FOOTPRINTS,
  breakoutFits,
} from '../../public/render/plan-furniture.js';
import {
  CHAIR_GAP,
  CORNER_PLANT_INSET,
  ROOM_PAD,
  RUG_MAX_OVER_CLUSTER,
} from '../../public/render/plan-units.js';
import {
  CARPET_WEAVE_PITCH_U,
  DOOR_POOL_R_U,
  HERRINGBONE_BLOCK_L,
  HERRINGBONE_BLOCK_W,
  HERRINGBONE_CELL_U,
  HERRINGBONE_SEAM_U,
  TILE_CELL_U,
} from '../../public/render/backdrop-floor.js';
import { SHADOW_RX, SHADOW_RY } from '../../public/render/rig-metrics.js';
import { TABLE_EDGE_U, U_DEFAULT } from '../../public/render/backdrop-paint.js';
import { BODY_HEIGHT_U } from '../../public/render/rig-metrics.js';
import { buildPlan } from '../../public/render/plan.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDER = path.join(HERE, '..', '..', 'public', 'render');

/** @param {number} n */
const r2 = (n) => n.toFixed(2);

/** One table, printed. @param {string} title @param {Array<[string, string]>} rows */
function report(title, rows) {
  const w = rows.reduce((a, [k]) => Math.max(a, k.length), 0);
  console.log(`\n  ${title}`);
  for (const [k, v] of rows) console.log(`    ${k.padEnd(w)}  ${v}`);
}

// ---------------------------------------------------------------- the tokens

test('the eleven tokens are §3.1’s, and every theme fans them out through one derivation', () => {
  // §3.10: "the same building at three hours, and it stays so because it is the
  // same eleven tokens through the same derivation". A theme that named a
  // twelfth, or a derivation that special-cased one theme, would be a second
  // renderer wearing a theme's name — which is exactly what the default floor
  // was until this package (see `DEFAULT_FLOOR`'s comment in themes.js).
  const expected = {
    default: {
      wood: '#DCC9AE',
      carpet: '#E7E2D7',
      screed: '#D2CDC1',
      ground: '#DFDAD0',
      tile: '#E3DFD6',
      wall: '#F4F1EA',
      partition: '#E0DACD',
      desk: '#C8AC84',
      seat: '#DCD5C6',
      plant: '#6C8F63',
      ink: '#32281D',
    },
    'night shift': {
      wood: '#40454D',
      carpet: '#31353D',
      screed: '#2A2E35',
      ground: '#22262D',
      tile: '#373C44',
      wall: '#4E545D',
      partition: '#3C414A',
      desk: '#4A4F58',
      seat: '#4F555F',
      plant: '#6E9E86',
      ink: '#E8EBF1',
    },
    blueprint: {
      wood: '#1C3D5F',
      carpet: '#173553',
      screed: '#132C47',
      ground: '#112941',
      tile: '#20466C',
      wall: '#2C5885',
      partition: '#1F4265',
      desk: '#245079',
      seat: '#2A5580',
      plant: '#7FB8A2',
      ink: '#F2F6FB',
    },
  };
  for (const theme of THEMES) {
    assert.deepEqual(
      theme.floor,
      expected[theme.name],
      `${theme.name} has drifted from docs/plan/10-INTERIOR-DESIGN.md §3.1`,
    );
  }
});

test('CONTRAST: the ink clears 4.5:1 on every ground, and §3.1’s numbers are these numbers', () => {
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const theme of THEMES) {
    const measured = GROUND_KEYS.map((key) => contrastRatio(theme.floor.ink, theme.floor[key]));
    rows.push([`${theme.name}`, measured.map(r2).join(' / ')]);
    for (const [i, key] of GROUND_KEYS.entries()) {
      assert.ok(
        measured[i] >= 4.5,
        `${theme.name}: ink on the ${key} is ${r2(measured[i])}:1, under 4.5:1`,
      );
    }
  }
  report(`ink on ${GROUND_KEYS.join(' / ')}`, rows);
  // The three lines §3.1 quotes, to two places, so a token that drifts is
  // caught here rather than in a document nobody re-measures.
  assert.equal(
    rows.map(([, v]) => v).join(' | '),
    '8.93 / 11.16 / 9.09 / 10.35 / 10.84 | ' +
      '8.08 / 10.30 / 11.41 / 12.71 / 9.29 | ' +
      '10.28 / 11.58 / 13.08 / 13.65 / 8.98',
    'the measured ink ratios have moved away from docs/plan/10-INTERIOR-DESIGN.md §3.1',
  );
});

test('CONTRAST: the ink still clears 4.5:1 on a ground at a pool of light’s brightest point', () => {
  // WP-85a's new device, held to the same bar as the bare floor. A pool lands
  // over the manager's desk, over every working desk and on every threshold —
  // which is to say, over exactly the places a plate and a name are drawn — so
  // measuring only the unlit ground would measure the part of the floor the
  // label is NOT on. On a dark theme it is the harder case of the two: a pool
  // lightens, and a dark theme's white line work has the least headroom.
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const theme of THEMES) {
    const lightInk = lightInkFor(theme.floor.ink);
    for (const key of GROUND_KEYS) {
      const lit = pooled(theme.floor[key], lightInk);
      const ratio = contrastRatio(theme.floor.ink, lit);
      rows.push([`${theme.name} · ${key} (${lit})`, `${r2(ratio)}:1`]);
      assert.ok(
        ratio >= 4.5,
        `${theme.name}: ink on the lit ${key} is ${r2(ratio)}:1, under 4.5:1`,
      );
    }
  }
  report('ink on a lit ground', rows);
});

test('the light pool is one colour and two alphas, and the dark themes get the weaker one', () => {
  assert.equal(LIGHT_POOL_COLOR, '#FFE9C4', '§3.2 names the pool colour');
  assert.equal(LIGHT_POOL_ALPHA_LIGHT, 0.1);
  assert.equal(LIGHT_POOL_ALPHA_DARK, 0.055);
  assert.ok(LIGHT_POOL_ALPHA_DARK < LIGHT_POOL_ALPHA_LIGHT);
  for (const theme of THEMES) {
    const wanted = lightInkFor(theme.floor.ink) ? LIGHT_POOL_ALPHA_DARK : LIGHT_POOL_ALPHA_LIGHT;
    assert.equal(
      materialTokensFor(theme).lightPool,
      `rgba(255,233,196,${wanted})`,
      `${theme.name} got the wrong pool strength`,
    );
  }
});

// ---------------------------------------------------------------- the floors

test('§3.2: the herringbone block is at most 2.6 U long and sits inside one value plateau', () => {
  const blockL = HERRINGBONE_CELL_U * HERRINGBONE_BLOCK_L;
  const blockW = HERRINGBONE_CELL_U * HERRINGBONE_BLOCK_W;
  /** @type {Array<[string,string]>} */
  const rows = [
    [
      'cell',
      `${(HERRINGBONE_CELL_U * U_DEFAULT).toFixed(0)} px / ${HERRINGBONE_CELL_U.toFixed(2)} U`,
    ],
    ['block', `${blockL.toFixed(2)} U × ${blockW.toFixed(2)} U`],
    ['block, in metres', `${(blockL * 0.3).toFixed(2)} m × ${(blockW * 0.3).toFixed(2)} m`],
  ];
  // The audit's first number: it was 4.67 U x 1.58 U, twelve times the area of
  // a real herringbone block, and the loudest thing in the product.
  assert.ok(blockL <= 2.6, `a block is ${blockL.toFixed(2)} U long, over §5's 2.6 U ceiling`);
  assert.ok(blockW <= 1.0, `a block is ${blockW.toFixed(2)} U wide`);

  for (const theme of THEMES) {
    const d = materialTokensFor(theme);
    const spread = contrastRatio(d.woodHerringboneB, d.woodHerringboneC);
    rows.push([`${theme.name} B:C`, `${spread.toFixed(3)}:1`]);
    assert.ok(
      spread <= BOARD_MAX_INTERNAL_CONTRAST,
      `${theme.name}: the board's internal contrast is ${spread.toFixed(3)}:1, over ` +
        `${BOARD_MAX_INTERNAL_CONTRAST}:1`,
    );
  }
  report('the boards', rows);
  assert.equal(BOARD_TONE_SPREAD, 0.03, '§3.2 states the spread');
  // Was 1.27 / 1.43 / 1.40 on default / night shift / blueprint.
  const spreads = THEMES.map((t) => {
    const d = materialTokensFor(t);
    return contrastRatio(d.woodHerringboneB, d.woodHerringboneC).toFixed(2);
  });
  assert.deepEqual(spreads, ['1.08', '1.13', '1.13'], '§3.2 quotes 1.08 / 1.13 / 1.13');
});

test('§3.2: the seam is at most 0.9 px at at most 0.22 alpha', () => {
  const px = HERRINGBONE_SEAM_U * U_DEFAULT;
  assert.ok(px <= 0.9, `the seam is ${px} px, over §5's 0.9 px`);
  assert.ok(BOARD_SEAM_ALPHA <= 0.22, `the seam is at ${BOARD_SEAM_ALPHA} alpha, over §5's 0.22`);
  for (const theme of THEMES) {
    const seam = materialTokensFor(theme).woodHerringboneSeam;
    const alpha = Number(/,\s*([\d.]+)\s*\)$/.exec(seam)[1]);
    assert.ok(alpha <= 0.22, `${theme.name}: the seam is at ${alpha} alpha`);
  }
  report('the seam', [
    ['width', `${px} px (was 1.6)`],
    ['alpha', `${BOARD_SEAM_ALPHA} (was 0.55)`],
  ]);
});

test('§3.2: the carpet is a weave, and paintCarpet emits no 1 × 1 px fills', () => {
  // A source-reading test, in the style of `lighting.test.mjs`'s: the defect is
  // "this function scatters six thousand single pixels", and no amount of
  // measuring its OUTPUT colours would ever find that. It scattered up to 6000
  // `fillRect(x, y, 1, 1)` calls per room, which reads as a dirty surface at 1x
  // and as sensor noise at 2x.
  const src = fs.readFileSync(path.join(RENDER, 'backdrop-floor.js'), 'utf8');
  const body = src.slice(src.indexOf('export function paintCarpet'));
  const fn = body.slice(0, body.indexOf('\nexport function', 1));
  assert.ok(fn.includes('paintCarpet'), 'paintCarpet was not found in backdrop-floor.js');
  assert.equal(
    /fillRect\([^)]*,\s*1\s*,\s*1\s*\)/.test(fn),
    false,
    'paintCarpet is emitting 1 × 1 px fills again — a weave is directional, salt is not',
  );
  assert.ok(fn.includes('carpetWeaveLight') && fn.includes('carpetWeaveDark'));
  // Two passes, one each way: a weave that ran only one way is a corduroy.
  assert.equal((fn.match(/ctx\.stroke\(\)/g) || []).length, 2);
  assert.ok(CARPET_WEAVE_PITCH_U * U_DEFAULT === 3, '§3.2 states a 3 px pitch');
});

test('every pattern is a size in plan units, so a bake at any u lays the same floor', () => {
  // Not a size in baked pixels, which is what these all were. A unit is about
  // 0.30 m, so each of these is a claim about a real floor.
  const rows = [
    ['herringbone cell', HERRINGBONE_CELL_U],
    ['herringbone seam', HERRINGBONE_SEAM_U],
    ['carpet weave pitch', CARPET_WEAVE_PITCH_U],
    ['tile cell', TILE_CELL_U],
    ['threshold pool radius', DOOR_POOL_R_U],
  ];
  for (const [name, value] of rows) {
    assert.ok(Number.isFinite(value) && value > 0, `${name} is not a unit length`);
  }
  report(
    'pattern sizes, in units',
    rows.map(([k, v]) => [k, `${v.toFixed(3)} U · ${(v * 0.3).toFixed(2)} m`]),
  );
  assert.equal(TILE_CELL_U * U_DEFAULT, 22, '§3.2 states a 22 px tile grid');
});

// ------------------------------------------------------------ the hierarchy

test('§1.2: nothing inside a room is brighter than that theme’s wall, on any theme', () => {
  // The audit's third finding, inverted into a property. The brightest surfaces
  // in the product were `wall`, `chairFill` and the derived `whiteboardSurface`
  // at 2.14:1 against the office wood — the highest local contrast inside any
  // room, spent on a whiteboard, a sofa and a chair while the people it was for
  // came fourth and fifth.
  //
  // Composites are measured as well as flat materials: a sheen IS a material's
  // brightest pixel, and a rule that only looked at the fill would have passed
  // a whiteboard whose gloss was the brightest thing in the building.
  for (const theme of THEMES) {
    const d = materialTokensFor(theme);
    const wall = relativeLuminance(theme.floor.wall);
    /** @type {Array<[string,string]>} */
    const rows = [];
    for (const [name, colour] of Object.entries(interiorHighlights(d, theme.floor))) {
      const l = relativeLuminance(colour);
      rows.push([name, `${colour}  ${(l / wall).toFixed(3)} × the wall`]);
      assert.ok(l <= wall + 1e-9, `${theme.name}: ${name} (${colour}) is brighter than the wall`);
    }
    report(`${theme.name}: every interior surface, against its wall`, rows);
  }
});

test('§3.4: a sofa shows its frame, and the whiteboard stopped out-shouting the room', () => {
  for (const theme of THEMES) {
    const d = materialTokensFor(theme);
    // The frame band is a real step below the cushion it holds, which is what
    // makes a sofa run read as furniture with a back rather than as a row of
    // boxes. It was `shade(seat, -0.08)` against a `+0.05` cushion.
    const step = contrastRatio(d.sofaFrame, d.sofaCushion);
    assert.ok(step >= 1.25, `${theme.name}: the sofa frame is ${r2(step)}:1 from its cushion`);
    // And the seat left the near-white band: on the default theme it was
    // `#FBFAF7`, four counts off the wall and the second brightest thing in
    // the building. `<=` rather than `<` because `underWall` will park a seat
    // that wanted to be brighter exactly ON the wall, which is the ceiling
    // being enforced rather than a seat still over it.
    assert.ok(
      relativeLuminance(d.chairFill) <= relativeLuminance(theme.floor.wall) + 1e-9,
      `${theme.name}: the seat is still at the top of the room's value range`,
    );
  }
});

// ----------------------------------------------------------------- the halo

test('§10: every state colour clears 3:1 against the figure halo, on every theme', () => {
  // THE PROMISE 03-VISUAL-SPEC.md §10 NOW MAKES, and the one it used to make is
  // the test below this one.
  //
  // The halo is theme-independent by construction — it is a separate export
  // that no floor key names, exactly like the state colours — so this is one
  // measurement rather than three. It is written out per theme anyway, because
  // "it does not depend on the theme" is the property being claimed.
  assertFigureHaloContrast();
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const state of ON_FLOOR_STATES) {
    const ratio = contrastRatio(STATE_COLORS[state], FIGURE_HALO);
    rows.push([state, `${r2(ratio)}:1`]);
    assert.ok(ratio >= 3, `${state} is ${r2(ratio)}:1 against the halo, under 3:1`);
  }
  report(`every on-floor state against the halo ${FIGURE_HALO}`, rows);
  // §3.9 quotes these six. `benched` is the worst case and the reason the halo
  // is this particular near-white rather than a brighter one.
  assert.deepEqual(
    Object.fromEntries(rows),
    {
      working: '4.44:1',
      needs_input: '3.39:1',
      stalled: '3.53:1',
      for_review: '4.87:1',
      benched: '3.28:1',
      ended: '4.81:1',
    },
    'the halo has drifted from docs/plan/10-INTERIOR-DESIGN.md §3.9',
  );
});

test('FOR THE RECORD: no floor clears 3:1 against the state colours, and none ever could', () => {
  // §10's OLD promise, measured rather than deleted quietly. Every failure
  // below is known and accepted: the state palette is mid-tone — `benched
  // #7B8794` and `needs_input #B87333` both near L* 53 — so a floor clearing
  // 3:1 against all six would have to be near paper or near black, and would
  // not be a floor anybody would want to look at. This is why §10 moved the
  // promise onto the character (§3.9) instead of onto the ground.
  //
  // It is a test rather than a comment because the numbers are the argument. If
  // somebody ever does find a floor that clears the bar on its own, this fails
  // and the halo can be reconsidered on evidence.
  let failures = 0;
  let total = 0;
  for (const theme of THEMES) {
    /** @type {Array<[string,string]>} */
    const rows = [];
    for (const key of GROUND_KEYS) {
      const cells = ON_FLOOR_STATES.map((state) => {
        const ratio = contrastRatio(STATE_COLORS[state], theme.floor[key]);
        total += 1;
        if (ratio < 3) failures += 1;
        return `${state} ${r2(ratio)}`;
      });
      rows.push([key, cells.join('  ')]);
    }
    report(`${theme.name}: state colours on the bare floor (known failures)`, rows);
  }
  assert.ok(failures > 0, 'a floor now clears 3:1 on its own — re-open §10 with the numbers');
  console.log(`\n    ${failures} of ${total} state-on-floor pairs are under 3:1, all accepted.`);
  // And the halo is what makes the same six readable anyway.
  for (const state of ON_FLOOR_STATES) {
    assert.ok(contrastRatio(STATE_COLORS[state], FIGURE_HALO) >= 3);
  }
});

test('§3.9: the halo is one constant, not themeable, and picks its device off the ink', () => {
  assert.equal(FIGURE_HALO, '#F6F2E9');
  assert.ok(FIGURE_HALO_POOL_ALPHA > 0 && FIGURE_HALO_POOL_ALPHA < 1);
  assert.equal(FIGURE_HALO_POOL_SPAN, 0.58);
  assert.equal(FIGURE_HALO_RIM_PX, 1.1);
  // A pool that did not reach past the body would be a disc under the feet
  // rather than a flattening of the ground the body stands on.
  assert.ok(FIGURE_HALO_POOL_SPAN * BODY_HEIGHT_U > 1.2);
  // No theme document can name it: the derivation never emits a halo token, so
  // there is nothing for `overridePalette` to write.
  for (const theme of THEMES) {
    for (const [key, value] of Object.entries(materialTokensFor(theme))) {
      // `plateHalo` is the lift behind a room plate's letterforms and
      // `plusHoverHalo` the faint disc behind a hovered "+". Neither is the
      // FIGURE halo, and no third halo may appear in the derivation.
      assert.ok(
        !/halo/i.test(key) || key === 'plateHalo' || key === 'plusHoverHalo',
        `${theme.name} derives ${key}, which reaches the figure halo`,
      );
      assert.notEqual(
        String(value).toLowerCase(),
        FIGURE_HALO.toLowerCase(),
        `${theme.name}.${key} is the figure halo`,
      );
    }
  }
  // And the device follows the floor's own line work: a pool on a light floor,
  // a rim on a dark one.
  const src = fs.readFileSync(path.join(RENDER, 'palette-colors.js'), 'utf8');
  assert.match(src, /plateInk\) > 0\.5 \? 'rim' : 'pool'/);
  assert.equal(figureHaloMode(), 'pool', 'the default floor is light, so it gets a ground pool');
  assert.equal(relativeLuminanceOf('#FFFFFF') > 0.5, true);
});

test('§3.9: the halo is drawn under every character, and never at L0', () => {
  const rig = fs.readFileSync(path.join(RENDER, 'rig.js'), 'utf8');
  // Both figures on this floor: every agent, and the user's own avatar.
  assert.equal(
    (rig.match(/drawFigureHalo\(/g) || []).length,
    2,
    'drawCharacter and drawManagerFigure must each lay a halo',
  );
  // Under the body, not over it: inside `drawCharacter` the halo call precedes
  // the contact shadow, and the rim pass precedes the first part of the figure
  // (WP-79: the base, where it used to be the legs). Measured on the function's
  // own text, because the import block at the top of the file names all three
  // in a different order and would answer the question wrongly.
  const fn = rig.slice(rig.indexOf('export function drawCharacter'));
  assert.ok(fn.indexOf('drawFigureHalo(') < fn.indexOf('drawContactShadow('));
  assert.ok(fn.indexOf('drawFigureRim(') < fn.indexOf('drawRigBase(ctx)'));
  const body = fs.readFileSync(path.join(RENDER, 'rig-body.js'), 'utf8');
  assert.match(body, /if \(lod < 1\) return false;/);
});

// ------------------------------------------------------ the plan did not move

/**
 * THE ROOM RECTANGLES, AS ONE NUMBER.
 *
 * WP-85a's golden diff was PAINT ONLY (§5): it touched no plan geometry, so no
 * room rectangle on any golden could have moved, and this hash over a ladder of
 * populations was that claim rather than a promise.
 *
 * WP-85b IS A FURNITURE PACKAGE, and furniture sizes what a room bids for: a
 * whiteboard capped at 8 U, a rug at `cluster + 1.0`, a tub chair at 2.4 and a
 * lounge whose pool table grew to §3.4's 13.5 x 7 all move the envelope the
 * search settles on. So the constant moved ONCE, deliberately, and the test
 * kept its job — it is the thing that says a later package which claims to move
 * paint has moved a wall.
 *
 * AND WP-85c IS THE SECOND TIME, for one reason and not for its props: §3.7's
 * four named bays are a packing constraint on the lounge, so the lounge is a
 * different rectangle and every envelope that contains one moved with it.
 * Nothing in this package moves a PROJECT room by itself — the desk clutter
 * stands inside a seat's own cell and the planting lost two of its four corners
 * — which is why the hash moved and the rooms did not change shape.
 * `docs/DEVIATIONS.md` §164.
 */
const PLAN_HASH = 'bd8c7a47';

/** FNV-1a over a string, as eight hex digits. @param {string} s */
function hash32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const PLAN_NOW = 1_800_000_000_000;

/**
 * @param {number[]} sizes @param {number} benched
 * @param {{w:number,h:number}} [stage] the window the floor is laid for — the
 *   goldens' 1600 x 1000 by default, and a second shape wherever a property has
 *   to hold on a room the packer sized differently.
 */
function planFor(sizes, benched, stage = { w: 1600, h: 1000 }) {
  const agents = [];
  const projects = sizes.map((n, i) => ({
    id: `p${i}`,
    name: `p${i}`,
    sessionCount: n,
    tokens: 1000 * (i + 1),
    needsYou: 0,
  }));
  sizes.forEach((n, i) => {
    for (let k = 0; k < n; k++) {
      agents.push({
        id: `p${i}-${k}`,
        projectId: `p${i}`,
        activityState: 'working',
        ackState: 'active',
        reviewSince: null,
        lastActivityAt: PLAN_NOW - 60_000,
      });
    }
  });
  for (let k = 0; k < benched; k++) {
    agents.push({
      id: `b${k}`,
      projectId: 'p0',
      activityState: 'ended',
      ackState: 'benched',
      reviewSince: null,
      lastActivityAt: PLAN_NOW - 60_000,
    });
  }
  return buildPlan(projects, agents, { now: PLAN_NOW, stage });
}

test('the room rectangles are the ones WP-85b left, over eighteen populations', () => {
  /** @type {string[]} */
  const lines = [];
  for (const sizes of [[1], [3], [2, 2], [3, 2, 2], [4, 3, 2, 1], [5, 4, 3, 2, 1]]) {
    for (const benched of [0, 5, 12]) {
      const plan = planFor(sizes, benched);
      lines.push(`${sizes.join(',')}|${benched}|${plan.width}x${plan.height}`);
      for (const room of plan.rooms) {
        lines.push(`  ${room.kind}:${room.floor}:${room.x},${room.y},${room.w},${room.h}`);
      }
    }
  }
  const got = hash32(lines.join('\n'));
  assert.equal(
    got,
    PLAN_HASH,
    'a room rectangle moved. If that is deliberate, say so in docs/DEVIATIONS.md and re-take ' +
      'this constant; if it is not, a paint change has moved a wall.',
  );
  console.log(`\n    ${lines.length} room rectangles over 18 populations, hash ${got}`);
});

// --------------------------------------------------- the guards still refuse

test('a theme whose interior out-shines its wall is refused at import', () => {
  const base = THEMES[0];
  const hostile = {
    name: 'hostile',
    version: base.version,
    // A wall darker than the carpet it surrounds: the value hierarchy inverted
    // on purpose, which is the shape of the defect §1.2 found.
    floor: { ...base.floor, wall: '#6B6255' },
    chrome: { ...base.chrome },
  };
  assert.throws(() => assertThemeContrast(hostile), /brighter than the wall|4\.5:1/);
});

test('the board ceiling is the bar the floor this product shipped could not clear', () => {
  // The ceiling is not decoration. At the ±0.09 spread this floor shipped with,
  // every one of the three themes is over it — which is the audit's first
  // finding restated as an assertion, so nobody can widen the spread back out
  // without this saying exactly what they have done.
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const theme of THEMES) {
    const was = contrastRatio(shade(theme.floor.wood, -0.09), shade(theme.floor.wood, 0.09));
    const now = contrastRatio(shade(theme.floor.wood, -0.03), shade(theme.floor.wood, 0.03));
    rows.push([theme.name, `${was.toFixed(2)}:1 at ±0.09  ->  ${now.toFixed(2)}:1 at ±0.03`]);
    assert.ok(
      was > BOARD_MAX_INTERNAL_CONTRAST,
      `${theme.name}: ±0.09 measures ${was.toFixed(2)}:1, which the ceiling would have allowed`,
    );
    assert.ok(now <= BOARD_MAX_INTERNAL_CONTRAST);
  }
  report('the board spread, before and after', rows);
  // And the floor as it actually shipped, on the tones it actually had. The
  // default pair is quoted rather than derived because it was HAND-TUNED and
  // no derivation reproduced it — which is the thing §3.10 and `DEFAULT_FLOOR`'s
  // comment fixed, and the reason the audit had to measure three floors to
  // describe one.
  const shipped = [
    ['default', '#BE9868', '#D6B98A'],
    ['night shift', shade('#4E5259', -0.09), shade('#4E5259', 0.09)],
    ['blueprint', shade('#23486E', -0.09), shade('#23486E', 0.09)],
  ];
  report(
    'the board spread on the floor that shipped before WP-85a',
    shipped.map(([name, b, c]) => [name, `${b} / ${c}  ${contrastRatio(b, c).toFixed(2)}:1`]),
  );
  for (const [name, b, c] of shipped) {
    assert.ok(
      contrastRatio(b, c) > BOARD_MAX_INTERNAL_CONTRAST,
      `${name}: the shipped board spread already cleared the ceiling, so it is the wrong ceiling`,
    );
  }
});

test('the washed carpets a project room is really painted in are still readable and still not red', () => {
  // WP-72's fourteen grounds per theme, re-measured against WP-85a's carpet.
  for (const theme of THEMES) {
    const worst = PROJECT_IDENTITIES.map((identity) =>
      contrastRatio(theme.floor.ink, washedCarpet(theme.floor.carpet, identity.accent)),
    ).reduce((a, b) => Math.min(a, b));
    assert.ok(worst >= 4.5, `${theme.name}: worst washed carpet is ${r2(worst)}:1`);
  }
  report(
    'worst ink on any of the fourteen washed carpets',
    THEMES.map((theme) => [
      theme.name,
      `${r2(
        PROJECT_IDENTITIES.map((identity) =>
          contrastRatio(theme.floor.ink, washedCarpet(theme.floor.carpet, identity.accent)),
        ).reduce((a, b) => Math.min(a, b)),
      )}:1`,
    ]),
  );
});

// ------------------------------------------------- WP-85b: the furniture set

/**
 * A ladder of populations, and the rooms they produce.
 *
 * The same shape `planFor` above builds, asked of floors either side of the
 * ones the goldens photograph. Stated once here because every acceptance in §5
 * is a property over EVERY emitted plan, and a property measured on one floor
 * is an anecdote.
 */
const GOLDEN_STAGE = { w: 1600, h: 1000 };
/** A small window, where a room comes out too shallow for a second destination. */
const SMALL_STAGE = { w: 800, h: 600 };

const FURNITURE_POPULATIONS = /** @type {const} */ ([
  [[1], 0, GOLDEN_STAGE],
  [[3], 0, GOLDEN_STAGE],
  [[3], 5, GOLDEN_STAGE],
  [[2, 2], 0, GOLDEN_STAGE],
  [[3, 2, 2], 5, GOLDEN_STAGE],
  [[4, 3, 2, 1], 0, GOLDEN_STAGE],
  [[5, 4, 3, 2, 1], 12, GOLDEN_STAGE],
  [[15], 3, GOLDEN_STAGE],
  [[2, 2], 0, SMALL_STAGE],
  [[3, 2, 2], 5, SMALL_STAGE],
  [[5, 4, 3, 2, 1], 12, SMALL_STAGE],
]);

/** Every live project room on every floor of the ladder. @returns {any[]} */
function projectRoomLadder() {
  /** @type {any[]} */
  const out = [];
  for (const [sizes, benched, stage] of FURNITURE_POPULATIONS) {
    for (const room of planFor([...sizes], benched, stage).rooms) {
      if (room.kind === 'project' && !room.pinned) out.push(room);
    }
  }
  return out;
}

test('§3.4: the four seat kinds have four distinct footprints, in every emitted plan', () => {
  // *"No two seat kinds in one room share a footprint"* — the silhouette rule
  // stated as an arithmetic one, because at 34 px a reader tells two seats
  // apart by how much floor they take and not by their upholstery. Measured on
  // what the PLAN emits rather than on `plan-furniture.js`'s own constants: the
  // reception's visitor chair was a task chair wearing a second name for four
  // packages, and nothing could see it.
  const declared = Object.values(SEAT_FOOTPRINTS);
  assert.equal(new Set(declared).size, declared.length, 'two seat kinds share a footprint');
  assert.deepEqual(
    declared.slice().sort((a, b) => a - b),
    [1.4, 2, 2.4, 3],
    '§3.4 names these four footprints',
  );

  /** @type {Set<string>} */
  const seen = new Set();
  for (const [sizes, benched, stage] of FURNITURE_POPULATIONS) {
    for (const room of planFor([...sizes], benched, stage).rooms) {
      for (const prop of room.props || []) {
        const want = SEAT_FOOTPRINTS[prop.kind];
        if (want === undefined) continue;
        assert.equal(
          Math.max(prop.w, prop.h),
          want,
          `${room.kind}/${prop.kind} is ${Math.max(prop.w, prop.h)} U, not §3.4's ${want}`,
        );
        seen.add(prop.kind);
      }
    }
  }
  // And all four are actually drawn somewhere, or three of them are a table of
  // numbers nothing reads.
  for (const kind of Object.keys(SEAT_FOOTPRINTS)) {
    assert.ok(seen.has(kind), `no floor in the ladder emits a ${kind}`);
  }
  report(
    'the four seat kinds',
    Object.entries(SEAT_FOOTPRINTS).map(([k, v]) => [k, `${v.toFixed(1)} U · ${v * U_DEFAULT} px`]),
  );
});

test('§3.4: a task rug is never more than 1.35× its desk cluster, on either axis', () => {
  // WP-85b's first acceptance. §1.4 measured what the old rule drew — *"a pale
  // mint slab ~20 U across holding one 6 U desk, the largest shape in the
  // room"* — and the remedy is a rug that is a SIZE rather than a fill.
  let worst = 0;
  let rooms = 0;
  for (const room of projectRoomLadder()) {
    const group = (room.zones || []).find((z) => z.id === 'desk-group');
    const rug = (room.props || []).find((p) => p.kind === 'rug');
    if (!group || !rug) continue;
    rooms++;
    for (const [axis, got, base] of /** @type {const} */ ([
      ['width', rug.w, group.w],
      ['depth', rug.h, group.h],
    ])) {
      const over2 = got / base;
      worst = Math.max(worst, over2);
      assert.ok(
        over2 <= RUG_MAX_OVER_CLUSTER + 1e-9,
        `${room.id}: the rug's ${axis} is ${over2.toFixed(2)}× its cluster, over ` +
          `${RUG_MAX_OVER_CLUSTER}×`,
      );
    }
  }
  assert.ok(rooms >= 20, `expected a real ladder of rooms, measured ${rooms}`);
  report('the task rug', [
    ['rooms measured', String(rooms)],
    ['worst over its cluster', `${worst.toFixed(3)}× (ceiling ${RUG_MAX_OVER_CLUSTER})`],
  ]);
});

test('§3.4: the break-out corner appears exactly where the threshold says it does', () => {
  // Owner decision 4 — *"a second small destination is furniture, so the room is
  // still the size of what is in it"* — with the rule stated once, in
  // `plan-furniture.js`, and asserted here in both directions: every room that
  // has a group could hold one, and every room that could hold one has one.
  let withGroup = 0;
  let without = 0;
  for (const room of projectRoomLadder()) {
    const group = (room.zones || []).find((z) => z.id === 'desk-group');
    const zone = (room.zones || []).find((z) => z.id === 'breakout');
    const rug = (room.props || []).find((p) => p.kind === 'rug');
    if (!group || !rug) continue;
    const band0 = room.plateBand ?? 0;
    const interiorH = room.h - band0;
    const clusterArea = group.w * group.h;
    const clearRatio = (room.w * interiorH - clusterArea) / clusterArea;
    // The band the group would stand in: under the rug, clear of the planting in
    // the two south corners. The same arithmetic `buildProjectRoom` does, read
    // off the finished room rather than off the frame it was laid in.
    const bandTop = group.y - room.y - band0 + group.h / 2 + rug.h / 2 + 1.2;
    const band = interiorH - CORNER_PLANT_INSET - 0.4 - bandTop;
    const fits = breakoutFits(room.w - ROOM_PAD * 2, band, clearRatio);
    if (zone) {
      withGroup++;
      assert.ok(fits, `${room.id} has a break-out group in a ${band.toFixed(1)} U band`);
      // And the whole group is inside the room and clear of the desks' own rug —
      // a destination drawn through the desks is not a second destination.
      const chairs = (room.props || []).filter((p) => p.kind === 'tub_chair');
      assert.equal(chairs.length, 2, `${room.id}: a break-out corner is two tub chairs`);
      for (const p of [zone, ...chairs]) {
        assert.ok(
          p.x >= room.x - 0.01 &&
            p.x + p.w <= room.x + room.w + 0.01 &&
            p.y + p.h <= room.y + room.h + 0.01,
          `${room.id}: the break-out group is drawn through a wall`,
        );
        assert.ok(
          p.y >= rug.y + rug.h - 0.01,
          `${room.id}: the break-out group is drawn on the desks' rug`,
        );
      }
    } else {
      without++;
      assert.equal(fits, false, `${room.id} could hold a break-out group and has none`);
    }
  }
  assert.ok(withGroup > 0 && without > 0, 'the threshold has to bite both ways to mean anything');
  report('the break-out corner', [
    ['rooms with one', String(withGroup)],
    ['rooms without', String(without)],
    ['threshold', `${BREAKOUT_BAND.toFixed(1)} U clear, over ${BREAKOUT_CLEAR_RATIO}× the cluster`],
  ]);
});

test('§3.4: a seated figure sits ON its chair and never through the desk', () => {
  // THE ONE INVARIANT A FURNITURE PACKAGE CAN BREAK SILENTLY. §5 asks for desks
  // sized to the robot, and a chair pushed one notch closer to its table is a
  // figure standing on the table top. A seat's (x, y) IS the figure's ground
  // contact (`rig-metrics.js`: *"a character's feet point IS (x, y)"*), so the
  // two are checked against each other rather than one against a second
  // estimate of the other.
  let seats = 0;
  for (const [sizes, benched, stage] of FURNITURE_POPULATIONS) {
    const plan = planFor([...sizes], benched, stage);
    for (const room of plan.rooms) {
      if (room.kind !== 'project') continue;
      const chairs = (room.props || []).filter((p) => p.kind === 'chair');
      const desks = (room.props || []).filter((p) => p.kind === 'desk');
      for (const seat of plan.seats.get(room.id) || []) {
        seats++;
        const chair = chairs.find(
          (c) =>
            seat.x >= c.x - 1e-6 &&
            seat.x <= c.x + c.w + 1e-6 &&
            seat.y >= c.y - 1e-6 &&
            seat.y <= c.y + c.h + 1e-6,
        );
        assert.ok(
          chair,
          `${room.id}: a seat at (${seat.x.toFixed(2)}, ${seat.y.toFixed(2)}) has no chair under it`,
        );
        // The figure's own footprint: the contact ellipse `drawContactShadow`
        // lays, centred on the feet point with no offset (`SHADOW_O*` are zero,
        // and `lighting.test.mjs` measures that they are).
        for (const desk of desks) {
          const overlaps =
            seat.x + SHADOW_RX > desk.x &&
            seat.x - SHADOW_RX < desk.x + desk.w &&
            seat.y + SHADOW_RY > desk.y &&
            seat.y - SHADOW_RY < desk.y + desk.h;
          assert.equal(
            overlaps,
            false,
            `${room.id}: a figure at (${seat.x.toFixed(2)}, ${seat.y.toFixed(2)}) has its feet ` +
              'on the desk top',
          );
        }
      }
    }
  }
  assert.ok(seats >= 30, `expected a real ladder of seats, measured ${seats}`);
  report('the seated figure', [
    ['seats measured', String(seats)],
    ['task chair', `${SEAT_FOOTPRINTS.chair} U, at a ${CHAIR_GAP} U desk gap`],
    ['contact ellipse', `${SHADOW_RX} × ${SHADOW_RY} U, centred on the feet`],
  ]);
});

test('§7: no prop is drawn in the strip a room writes its plate in', () => {
  // `03-VISUAL-SPEC.md` §7's *"a label never covers furniture"*, kept the way
  // §3.8 asks for it — as a property of the PLAN rather than as a check in the
  // label pass: *"the band is furniture-free by construction, which turns §7's
  // 'never covers furniture' into a property rather than a check"*. Re-asserted
  // here because WP-85b moves the desks UPWARD in every room that gets a
  // break-out group, which is the one change that could put a desk under a name.
  let checked = 0;
  for (const [sizes, benched, stage] of FURNITURE_POPULATIONS) {
    for (const room of planFor([...sizes], benched, stage).rooms) {
      const band = room.plateBand ?? 0;
      if (!band) continue;
      for (const prop of room.props || []) {
        checked++;
        assert.ok(
          prop.y >= room.y + band - 0.01,
          `${room.id}/${prop.kind} is ${(room.y + band - prop.y).toFixed(2)} U into the plate band`,
        );
      }
    }
  }
  assert.ok(checked > 100, `expected the whole ladder's furniture, saw ${checked}`);
  report('the plate band', [['props checked', String(checked)]]);
});

test('§3.4: a desk no longer carries a near-white line down the middle of it', () => {
  // A source-reading test, in the style of `paintCarpet`'s above, because the
  // defect is a LITERAL and no measurement of the token table could find it:
  // every desk on the floor carried `fillRect(-w/2, -3, w, 6)` in
  // `rgba(255,255,255,0.85)`, which composites brighter than the default theme's
  // own wall. That is §1.2's violation — on the one piece of furniture the
  // person sitting at it is supposed to out-shine — and it survived WP-85a
  // because `interiorHighlights` measures tokens and this was a literal.
  const src = fs.readFileSync(path.join(RENDER, 'backdrop-props-desk.js'), 'utf8');
  // Comments stripped first: this file's own prose quotes the literal it is
  // asserting the absence of, which is a test that can only ever fail.
  const desk = src
    .slice(src.indexOf("case 'desk':"), src.indexOf("case 'desk_tray':"))
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(desk.length > 200, "the desk painter's case block was not found");
  assert.ok(desk.includes('PALETTE.deskSheen'), 'the desk edge must use a capped sheen token');
  assert.equal(
    /rgba\(255,\s*255,\s*255,\s*0\.[5-9]/.test(desk),
    false,
    'a desk is painting a near-white fill again',
  );
  assert.ok(desk.includes('TABLE_EDGE_U'), "§3.4's edge band is a size in units, not in px");
  assert.equal(TABLE_EDGE_U, 0.15, '§3.4 states the band');
  // And the sheen that replaced it is under the wall on every theme by
  // derivation rather than by choice.
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const theme of THEMES) {
    const d = materialTokensFor(theme);
    const lit = over(d.deskTop, d.deskSheen);
    rows.push([
      theme.name,
      `${lit}  ${(relativeLuminance(lit) / relativeLuminance(theme.floor.wall)).toFixed(3)} × the wall`,
    ]);
    assert.ok(
      relativeLuminance(lit) <= relativeLuminance(theme.floor.wall) + 1e-9,
      `${theme.name}: a lit desk edge (${lit}) is brighter than the wall`,
    );
  }
  report('a desk edge, lit', rows);
});

test('§3.4: a prop whose rect is its footprint is not turned by its facing', () => {
  // THE DEFECT THAT ONLY EXISTS IN ONE ROOM, WHICH IS WHY IT SURVIVED SO LONG.
  //
  // `paintProp` clips to a prop's own axis-aligned box and then rotates by
  // `prop.angle`. Every prop on this floor carries `angle` 0 except in the ROW
  // reception, which `buildOfficeRow` builds by reflecting the portrait room in
  // the diagonal and therefore hands every prop a quarter turn. On that floor an
  // 8.8 × 3 user desk, a 24.8 × 14 wool rug, a 3 × 6.4 low table and a 0.4 × 4.8
  // framed print were each drawn turned inside a clip cut to their unturned box,
  // which renders every one of them as a square. `sofa` and `manager` had
  // cancelled the turn by hand since WP-22; nothing else had.
  //
  // Source-reading, like `paintCarpet`'s above, because the defect is a MISSING
  // CALL and no measurement of an output colour will ever find one.
  const sources = {
    'backdrop-props-desk.js': fs.readFileSync(path.join(RENDER, 'backdrop-props-desk.js'), 'utf8'),
    'backdrop-props-lounge.js': fs.readFileSync(
      path.join(RENDER, 'backdrop-props-lounge.js'),
      'utf8',
    ),
  };
  /** The kinds whose `w × h` says how they LIE rather than where they look. */
  const FOOTPRINT_KINDS = /** @type {const} */ ([
    ['backdrop-props-desk.js', 'desk'],
    ['backdrop-props-desk.js', 'desk_tray'],
    ['backdrop-props-desk.js', 'monitor'],
    ['backdrop-props-desk.js', 'art'],
    ['backdrop-props-desk.js', 'pinboard'],
    ['backdrop-props-desk.js', 'rug'],
    ['backdrop-props-lounge.js', 'coffee_table'],
    ['backdrop-props-lounge.js', 'magazine_table'],
    ['backdrop-props-lounge.js', 'side_table'],
  ]);
  for (const [file, kind] of FOOTPRINT_KINDS) {
    const src = sources[file];
    const at = src.indexOf(`case '${kind}':`);
    assert.ok(at >= 0, `${file} has no painter for ${kind}`);
    // A chain of labels shares one block (`case 'desk': case 'user_desk': {`),
    // so the body starts at the brace and ends at the next label.
    const open = src.indexOf('{', at);
    const next = src.indexOf("\n    case '", open);
    const block = src.slice(open, next < 0 ? src.length : next);
    assert.ok(
      /unturn\(ctx, prop\)/.test(block),
      `${file}: ${kind}'s rect is its footprint and its painter does not call unturn()`,
    );
  }
  // And the two that cancel it by hand still do, because both then re-derive
  // which side the back is on from the angle they cancelled.
  assert.match(sources['backdrop-props-lounge.js'], /ctx\.rotate\(-a\);/);
  assert.match(sources['backdrop-props-desk.js'], /ctx\.rotate\(-\(prop\.angle \|\| 0\)\);/);
  report(
    'props whose rect is their footprint',
    FOOTPRINT_KINDS.map(([file, kind]) => [kind, file]),
  );
});

test('§3.1: the reception lies on wool and a project room on its own task textile', () => {
  // Owner decision 2 — *"`rugWool` is the one textile on this floor with a hue of
  // its own, a slate wool at `#B5B9B9`… adopt it"* — which WP-85a derived, WP-85a's
  // guards measured and no floor ever drew: both rug painters read one token
  // each, and the rectangular one read the SAGE. The tone is a property of the
  // prop now, because a painter cannot ask which room it is in.
  for (const [sizes, benched, stage] of FURNITURE_POPULATIONS) {
    for (const room of planFor([...sizes], benched, stage).rooms) {
      for (const prop of room.props || []) {
        if (prop.kind !== 'rug' && prop.kind !== 'rug_round') continue;
        if (room.kind === 'office') {
          assert.equal(prop.tone, 'wool', 'the reception waits on wool');
        } else if (room.kind === 'project' && prop.kind === 'rug_round') {
          assert.equal(prop.tone, 'task', "a break-out rug lies on its room's own carpet");
        }
      }
    }
  }
  // The two really are two materials, or the flag is bookkeeping.
  for (const theme of THEMES) {
    const d = materialTokensFor(theme);
    assert.notEqual(d.rugCream, d.rugSage, `${theme.name}: the wool and the task rug are one tone`);
  }
  report(
    'the two textiles',
    THEMES.map((t) => {
      const d = materialTokensFor(t);
      return [t.name, `wool ${d.rugCream} · task ${d.rugSage}`];
    }),
  );
});

test('§3.8/WP-81: every rank of plate text clears 4.5:1 on the halo it is read on', () => {
  // WP-81 gave the plate four ranks — hero, name, doing, spend — and each step
  // quieter is a contrast budget being spent. The surface measured is the one
  // the renderer actually paints: `plateHalo` at 0.92 composited over the lit
  // ground, not the bare floor, because `_drawRoomPlate` strokes the halo
  // behind every glyph before it fills one.
  const RANKS = ['plateInk', 'plateInkSecondary', 'plateInkTertiary'];
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const theme of THEMES) {
    const tokens = materialTokensFor(/** @type {any} */ (theme));
    let worst = Infinity;
    for (const key of GROUND_KEYS) {
      const behind = plateGroundOver(theme.floor, theme.floor[key]);
      for (const rank of RANKS) {
        const ratio = contrastRatio(tokens[rank], behind);
        worst = Math.min(worst, ratio);
        assert.ok(
          ratio >= 4.5,
          `${theme.name}: ${rank} on a plate over the ${key} is ${r2(ratio)}:1, under 4.5:1`,
        );
      }
    }
    rows.push([
      `${theme.name} · worst of ${RANKS.length} ranks × ${GROUND_KEYS.length} grounds`,
      `${r2(worst)}:1`,
    ]);
  }
  report('plate text on its halo', rows);
});

test('§3.8/WP-81: the plate’s state dot clears 3:1, and it is never the only channel', () => {
  // The dot is a GRAPHIC and is held to 3:1 like every other non-text signal
  // on this floor. It could not be held to 4.5 and stay the state colour: the
  // palette is mid-tone by design (§1.3), so an ink clearing 4.5 on a light
  // plate AND a dark one would no longer be `for_review` crimson. The words
  // beside it carry the same fact at 4.5:1, which is why this is allowed.
  const DOTS = ['working', 'needs_input', 'stalled', 'for_review'];
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const theme of THEMES) {
    for (const state of DOTS) {
      let worst = Infinity;
      for (const key of GROUND_KEYS) {
        const behind = plateGroundOver(theme.floor, theme.floor[key]);
        worst = Math.min(worst, contrastRatio(STATE_COLORS[state], behind));
      }
      assert.ok(worst >= 3, `${theme.name}: the ${state} plate dot is ${r2(worst)}:1, under 3:1`);
      rows.push([`${theme.name} · ${state}`, `${r2(worst)}:1`]);
    }
  }
  report('the plate dot on its halo', rows);
  // And the copy carries the state in words wherever the dot carries it in
  // colour, which is the rule `style.css` states for the header's breakdown:
  // "a dot, a tabular number and a neutral-ink word, every time".
  const src = fs.readFileSync(
    path.join(HERE, '..', '..', 'public', 'render', 'scene-labels.js'),
    'utf8',
  );
  assert.match(src, /need you/);
  assert.match(src, /working/);
});

test('§1.2/WP-81: nothing on a plate is brighter than the wall it hangs beside', () => {
  // The audit's second finding, applied to the one surface `underWall` never
  // covered. A light theme's plate halo used to be a hard-coded `#FCFAF4`,
  // above every wall in the product — the contrast budget above the wall spent
  // on signage rather than on people. It is the theme's own wall now.
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const theme of THEMES) {
    const tokens = materialTokensFor(/** @type {any} */ (theme));
    const halo = tokens.plateHalo.match(/\d+/g).slice(0, 3).map(Number);
    const haloHex = `#${halo.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    const lightInk = lightInkFor(theme.floor.ink);
    const wallL = relativeLuminanceOf(theme.floor.wall);
    const haloL = relativeLuminanceOf(haloHex);
    if (lightInk) {
      // A dark theme's halo goes the other way from its ink, so it is under
      // the wall by a mile rather than at it.
      assert.ok(haloL < wallL, `${theme.name}: a dark theme's halo is above its wall`);
    } else {
      assert.equal(haloHex.toLowerCase(), theme.floor.wall.toLowerCase());
    }
    rows.push([
      `${theme.name} · halo ${haloHex} vs wall ${theme.floor.wall}`,
      r2(haloL / (wallL || 1e-9)),
    ]);
  }
  report('the plate halo against the wall', rows);
});
