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
  pooled,
  relativeLuminance,
  shade,
  THEMES,
} from '../../public/render/themes.js';
import {
  CARPET_WEAVE_PITCH_U,
  DOOR_POOL_R_U,
  HERRINGBONE_BLOCK_L,
  HERRINGBONE_BLOCK_W,
  HERRINGBONE_CELL_U,
  HERRINGBONE_SEAM_U,
  TILE_CELL_U,
} from '../../public/render/backdrop-floor.js';
import { U_DEFAULT } from '../../public/render/backdrop-paint.js';
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
 * WP-85a's golden diff is PAINT ONLY (§5): it touches no plan geometry, so no
 * room rectangle on any golden may have moved. This is that claim, as a hash
 * over a ladder of populations rather than as a promise.
 *
 * The constant below was taken with `public/render/plan*.js` byte-identical to
 * their state before this package — `git diff` over that directory is the
 * independent check on it — and it will keep being the right constant until
 * somebody deliberately changes the layout, at which point this fails and says
 * so rather than letting a paint package quietly move a wall.
 */
const PLAN_HASH = '708e9f8e';

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

/** @param {number[]} sizes @param {number} benched */
function planFor(sizes, benched) {
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
  return buildPlan(projects, agents, { now: PLAN_NOW, stage: { w: 1600, h: 1000 } });
}

test('WP-85a moves paint and nothing else: no room rectangle moved', () => {
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
    'a room rectangle moved. WP-85a is a paint package — if this is deliberate, it is not WP-85a.',
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
