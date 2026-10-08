/**
 * The furniture: what each piece is drawn with at each scale, which way a seat
 * faces, and the two rules that keep furniture quieter than the people at it.
 *
 * IT PRINTS ITS MEASUREMENTS, as `interior.test.mjs` does: the contrast of the
 * loudest detail, the fill nearest each state colour, and the path operations
 * a sheet of every prop costs at three scales.
 *
 * Painting is recorded rather than rasterised. `makeRecorder` is a 2D context
 * that keeps its own transform, so a test can ask where on the floor a stroke
 * landed as well as what colour it was.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_PALETTE,
  ON_FLOOR_STATES,
  PALETTE,
  STATE_COLORS,
  colourDistance,
} from '../../public/render/palette.js';
import { THEMES, contrastRatio, mix } from '../../public/render/themes.js';
import { PROP_HEIGHT, U_DEFAULT, alphaScaled } from '../../public/render/backdrop-paint.js';
import { SHORT_CONTACT_ALPHA } from '../../public/render/backdrop-paint.js';
import { paintProp } from '../../public/render/backdrop.js';
import { setDeviceScale } from '../../public/render/device-px.js';
import { applyLook, resetLook } from '../../public/render/look-derive.js';
import { DEFAULT_LOOK, FURNITURE_SET_IDS, SCHEME_IDS } from '../../public/render/look-options.js';
import {
  FURNITURE_ALERT_STATES,
  FURNITURE_BEZEL,
  FURNITURE_DETAIL_MAX,
  FURNITURE_DETAILS,
  FURNITURE_FILL_EXEMPT,
  FURNITURE_STATE_MIN_DISTANCE,
  furnitureTonesFor,
  quietOn,
} from '../../public/render/furniture-tones.js';
import {
  assertFurnitureQuiet,
  furnitureFills,
  furnitureQuietGrid,
  furnitureQuietProblems,
  furnitureStateDistances,
} from '../../public/render/look-guards.js';
import {
  LOD_FULL_PPU,
  LOD_MID_PPU,
  chairSwivel,
  detailOf,
  tones,
} from '../../public/render/backdrop-props-kit.js';
import {
  CREDENZA_OBJECT_U,
  DRAWER_U,
  MEETING_TUCK,
} from '../../public/render/backdrop-props-room.js';
import { FURNITURE_SHEET, SHEET_CELL, SHEET_SCALES } from '../../scripts/lib/furniture-sheet.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDER = path.join(HERE, '..', '..', 'public', 'render');

/** The five painters, and the kit they share. */
const PAINTERS = [
  'backdrop-props-desk.js',
  'backdrop-props-lounge.js',
  'backdrop-props-room.js',
  'backdrop-props-play.js',
  'backdrop-props-plant.js',
];
const KIT = 'backdrop-props-kit.js';

/** A file's code with its comments taken out. @param {string} file */
function codeOf(file) {
  return fs
    .readFileSync(path.join(RENDER, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** One table, printed. @param {string} title @param {Array<[string, string]>} rows */
function report(title, rows) {
  const w = rows.reduce((a, [k]) => Math.max(a, k.length), 0);
  console.log(`\n  ${title}`);
  for (const [k, v] of rows) console.log(`    ${k.padEnd(w)}  ${v}`);
}

// ------------------------------------------------------------- the recorder

/** What counts as a path operation: everything that builds a path or paints one. */
const PATH_OPS = [
  'beginPath',
  'closePath',
  'moveTo',
  'lineTo',
  'quadraticCurveTo',
  'bezierCurveTo',
  'arc',
  'arcTo',
  'ellipse',
  'rect',
  'roundRect',
  'fill',
  'stroke',
  'fillRect',
  'strokeRect',
  'clip',
];
const PAINT_OPS = ['fill', 'stroke', 'fillRect', 'strokeRect'];

/**
 * A 2D context that remembers what it was told, where, and in what colour.
 *
 * `counts` is how many times each method was called. `paints` is one entry per
 * fill or stroke: its style, the shadow it was painted under, how many times
 * the context had been turned by hand, and the points of the path it painted,
 * in the context's untransformed space.
 */
function makeRecorder() {
  /** @type {Record<string, number>} */
  const counts = {};
  /** @type {any[]} */
  const paints = [];
  /** @type {number[][]} */
  const stack = [];
  /** @type {any[]} */
  const saved = [];
  let m = [1, 0, 0, 1, 0, 0];
  /** @type {Array<[number, number]>} */
  let pts = [];
  let clipped = 0;
  const at = (/** @type {number} */ x, /** @type {number} */ y) =>
    /** @type {[number, number]} */ ([m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const hit = (/** @type {string} */ name) => {
    counts[name] = (counts[name] || 0) + 1;
  };
  const paint = (/** @type {string} */ op, /** @type {any} */ style, /** @type {any} */ points) => {
    paints.push({
      op,
      style,
      points,
      clipped: clipped > 0,
      alpha: ctx.globalAlpha,
      width: ctx.lineWidth,
      shadowBlur: ctx.shadowBlur,
      shadowColor: ctx.shadowColor,
      shadowOffsetX: ctx.shadowOffsetX,
      shadowOffsetY: ctx.shadowOffsetY,
    });
  };
  /** @type {any} */
  const ctx = {
    counts,
    paints,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    globalAlpha: 1,
    shadowBlur: 0,
    shadowColor: '',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save() {
      stack.push(m.slice());
      saved.push({
        clipped,
        shadowBlur: ctx.shadowBlur,
        shadowColor: ctx.shadowColor,
        shadowOffsetX: ctx.shadowOffsetX,
        shadowOffsetY: ctx.shadowOffsetY,
      });
    },
    restore() {
      m = stack.pop() || m;
      const s = saved.pop();
      if (s) {
        clipped = s.clipped;
        ctx.shadowBlur = s.shadowBlur;
        ctx.shadowColor = s.shadowColor;
        ctx.shadowOffsetX = s.shadowOffsetX;
        ctx.shadowOffsetY = s.shadowOffsetY;
      }
    },
    translate(/** @type {number} */ x, /** @type {number} */ y) {
      m = [m[0], m[1], m[2], m[3], m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    },
    rotate(/** @type {number} */ a) {
      const c = Math.cos(a);
      const s = Math.sin(a);
      m = [
        m[0] * c + m[2] * s,
        m[1] * c + m[3] * s,
        m[2] * c - m[0] * s,
        m[3] * c - m[1] * s,
        m[4],
        m[5],
      ];
    },
    scale(/** @type {number} */ x, /** @type {number} */ y) {
      m = [m[0] * x, m[1] * x, m[2] * y, m[3] * y, m[4], m[5]];
    },
    beginPath() {
      hit('beginPath');
      pts = [];
    },
    closePath: () => hit('closePath'),
    moveTo(/** @type {number} */ x, /** @type {number} */ y) {
      hit('moveTo');
      pts.push(at(x, y));
    },
    lineTo(/** @type {number} */ x, /** @type {number} */ y) {
      hit('lineTo');
      pts.push(at(x, y));
    },
    quadraticCurveTo(
      /** @type {number} */ cx,
      /** @type {number} */ cy,
      /** @type {number} */ x,
      /** @type {number} */ y,
    ) {
      hit('quadraticCurveTo');
      pts.push(at(cx, cy), at(x, y));
    },
    arc(
      /** @type {number} */ x,
      /** @type {number} */ y,
      /** @type {number} */ r,
      /** @type {number} */ a0,
      /** @type {number} */ a1,
    ) {
      hit('arc');
      const mid = (a0 + a1) / 2;
      pts.push(at(x + Math.cos(mid) * r, y + Math.sin(mid) * r));
    },
    ellipse(/** @type {number} */ x, /** @type {number} */ y) {
      hit('ellipse');
      pts.push(at(x, y));
    },
    rect(
      /** @type {number} */ x,
      /** @type {number} */ y,
      /** @type {number} */ w,
      /** @type {number} */ h,
    ) {
      hit('rect');
      pts.push(at(x, y), at(x + w, y + h));
    },
    clip() {
      hit('clip');
      clipped++;
    },
    fill() {
      hit('fill');
      paint('fill', ctx.fillStyle, pts.slice());
    },
    stroke() {
      hit('stroke');
      paint('stroke', ctx.strokeStyle, pts.slice());
    },
    fillRect(
      /** @type {number} */ x,
      /** @type {number} */ y,
      /** @type {number} */ w,
      /** @type {number} */ h,
    ) {
      hit('fillRect');
      paint('fillRect', ctx.fillStyle, [at(x, y), at(x + w, y + h)]);
      paints[paints.length - 1].size = [w, h];
    },
    strokeRect() {
      hit('strokeRect');
      paint('strokeRect', ctx.strokeStyle, []);
    },
    setLineDash() {},
    fillText() {},
    measureText: (/** @type {string} */ t) => ({ width: String(t).length * 6 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  return ctx;
}

/**
 * Paint one prop at a scale, the way a bake does: on the design grid, with the
 * context told how many device pixels one of its own is.
 * @param {any} prop @param {number} ppu device pixels per plan unit
 */
function paintAt(prop, ppu) {
  const ctx = makeRecorder();
  setDeviceScale(ctx, ppu / U_DEFAULT);
  paintProp(ctx, { x: 4, y: 6, angle: 0, id: `test-${prop.kind}`, ...prop }, U_DEFAULT);
  return ctx;
}

/** @param {any} ctx @param {string[]} ops */
const total = (ctx, ops) => ops.reduce((a, k) => a + (ctx.counts[k] || 0), 0);
/** Paints in one style. @param {any} ctx @param {string} style @param {string} [op] */
const inStyle = (ctx, style, op) =>
  ctx.paints.filter((/** @type {any} */ p) => p.style === style && (!op || p.op === op));

// ------------------------------------------------------- quieter than people

test('FURNITURE IS QUIET: 3 themes × 6 schemes × 3 sets, and every one passes', () => {
  const grid = furnitureQuietGrid();
  assert.equal(grid.length, THEMES.length * SCHEME_IDS.length * FURNITURE_SET_IDS.length);
  assert.equal(grid.length, 54);
  let worst = { ratio: 0, name: '', at: '' };
  /** @type {Record<string, {distance:number, fill:string, at:string}>} */
  const nearest = {};
  for (const row of grid) {
    const where = `${row.theme} / ${row.scheme} / ${row.set}`;
    assert.deepEqual(furnitureQuietProblems(row.tokens, row.set), [], where);
    assert.doesNotThrow(() => assertFurnitureQuiet(row.tokens, row.set, where));
    const t = furnitureTonesFor(row.tokens);
    for (const [detail, surface] of FURNITURE_DETAILS) {
      const ratio = contrastRatio(t[detail], t[surface]);
      assert.ok(ratio <= FURNITURE_DETAIL_MAX, `${where}: ${detail} is ${ratio.toFixed(3)}:1`);
      if (ratio > worst.ratio) worst = { ratio, name: `${detail} on ${surface}`, at: where };
    }
    for (const [name, value] of Object.entries(furnitureFills(row.tokens, row.set))) {
      for (const state of FURNITURE_ALERT_STATES) {
        const d = colourDistance(value, STATE_COLORS[state]);
        if (!FURNITURE_FILL_EXEMPT[name]) {
          assert.ok(
            d >= FURNITURE_STATE_MIN_DISTANCE,
            `${where}: ${name} is ${d.toFixed(1)} from ${state}`,
          );
        }
        if (!nearest[state] || d < nearest[state].distance) {
          if (!FURNITURE_FILL_EXEMPT[name]) nearest[state] = { distance: d, fill: name, at: where };
        }
      }
    }
  }
  report('furniture, measured over 54 combinations', [
    ['details measured', `${FURNITURE_DETAILS.length} per combination`],
    [
      'loudest detail',
      `${worst.ratio.toFixed(3)}:1 — ${worst.name} (${worst.at}); ceiling ${FURNITURE_DETAIL_MAX}`,
    ],
    ...FURNITURE_ALERT_STATES.map(
      (s) =>
        /** @type {[string, string]} */ ([
          `nearest fill to ${s}`,
          `${nearest[s].distance.toFixed(1)} RGB — ${nearest[s].fill} (${nearest[s].at}); floor ${FURNITURE_STATE_MIN_DISTANCE}`,
        ]),
    ),
  ]);
});

test('the guard has teeth: an amber desk and an unquieted keyboard are both refused', () => {
  const amber = { ...DEFAULT_PALETTE, deskTop: STATE_COLORS.needs_input };
  const found = furnitureQuietProblems(amber);
  assert.ok(
    found.some((p) => p.name === 'deskTop' && /needs input/.test(p.reason)),
    'a desk the colour of "needs input" was not refused',
  );
  assert.throws(() => assertFurnitureQuiet(amber, 'scandi', 'test'), /needs input/);
  // And rule 1 is not a tautology: the keyboard the spec asks for is over the
  // ceiling on the desk as shipped, and `quietOn` is what brings it under.
  const wanted = mix(DEFAULT_PALETTE.chairFill, DEFAULT_PALETTE.wallFill, 0.4);
  const raw = contrastRatio(wanted, DEFAULT_PALETTE.deskTop);
  assert.ok(raw > FURNITURE_DETAIL_MAX, `the raw keyboard is only ${raw.toFixed(2)}:1`);
  const held = quietOn(DEFAULT_PALETTE.deskTop, wanted);
  assert.ok(contrastRatio(held, DEFAULT_PALETTE.deskTop) <= FURNITURE_DETAIL_MAX);
  assert.equal(quietOn(DEFAULT_PALETTE.deskTop, DEFAULT_PALETTE.deskTop), DEFAULT_PALETTE.deskTop);
  report('a keyboard on the shipped desk', [
    ['as asked for', `${wanted}  ${raw.toFixed(2)}:1`],
    ['as drawn', `${held}  ${contrastRatio(held, DEFAULT_PALETTE.deskTop).toFixed(2)}:1`],
  ]);
});

test('an exemption goes stale loudly: three object tokens, each at its measured floor', () => {
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const [name, exempt] of Object.entries(FURNITURE_FILL_EXEMPT)) {
    let least = Infinity;
    for (const row of furnitureQuietGrid()) {
      least = Math.min(least, colourDistance(row.tokens[name], STATE_COLORS[exempt.state]));
    }
    assert.ok(least >= exempt.floor, `${name} moved to ${least.toFixed(1)} from ${exempt.state}`);
    assert.ok(
      least < FURNITURE_STATE_MIN_DISTANCE,
      `${name} now clears ${FURNITURE_STATE_MIN_DISTANCE}; delete its row`,
    );
    assert.ok(
      least - exempt.floor < 1,
      `${name}: the floor (${exempt.floor}) is not what was measured`,
    );
    rows.push([name, `${least.toFixed(1)} from ${exempt.state}; floor ${exempt.floor}`]);
  }
  report('exempt object tokens', rows);
});

test('FOR THE RECORD: timber and neutrals are inside 60 RGB of the four quiet states', () => {
  // The spec's sentence is "no furniture fill within 60 RGB of any on-floor
  // state colour". Against the two that ask for the user it holds, above.
  // Against the tan of `stalled`, the greys of `benched` and `ended` and the
  // dark green of `working` it cannot: the tokens a theme names are already
  // inside it. This prints how far, and asserts only that it is true — the day
  // it stops being true the rule can be widened.
  const quiet = ON_FLOOR_STATES.filter((s) => !FURNITURE_ALERT_STATES.includes(s));
  /** @type {Record<string, {distance:number, fill:string, at:string}>} */
  const nearest = {};
  for (const row of furnitureQuietGrid()) {
    const d = furnitureStateDistances(row.tokens, row.set);
    for (const state of quiet) {
      if (!nearest[state] || d[state].distance < nearest[state].distance) {
        nearest[state] = { ...d[state], at: `${row.theme} / ${row.scheme}` };
      }
    }
  }
  // A token a theme names, not a tone this package derived.
  const seat = colourDistance(
    furnitureQuietGrid().find((r) => r.theme === 'blueprint' && r.scheme === 'clay')?.tokens
      .chairFill || '#000000',
    STATE_COLORS.ended,
  );
  assert.ok(seat < FURNITURE_STATE_MIN_DISTANCE, 'the seat token cleared `ended`; widen the rule');
  for (const state of quiet) {
    assert.ok(
      nearest[state].distance < FURNITURE_STATE_MIN_DISTANCE,
      `${state} is now clear of every fill`,
    );
  }
  report('nearest fill to each quiet state (not a rule)', [
    ...quiet.map(
      (s) =>
        /** @type {[string,string]} */ ([
          s,
          `${nearest[s].distance.toFixed(1)} RGB — ${nearest[s].fill} (${nearest[s].at})`,
        ]),
    ),
    ['the seat token itself', `${seat.toFixed(1)} RGB from ended, on blueprint / clay`],
  ]);
});

test('every tone a painter asks for exists, and every detail is on the measured list', () => {
  const t = furnitureTonesFor(DEFAULT_PALETTE);
  const measured = new Set([...FURNITURE_DETAILS.flat(), ...FURNITURE_BEZEL]);
  /** Tones that are a piece's own body rather than a mark on one. */
  const bodies = new Set([
    'chairBase',
    'sofaFrame',
    'sofaArm',
    'fruitA',
    'fruitB',
    'fruitC',
    'fruitD',
    'ballA',
    'ballB',
    'ballC',
    'ballD',
  ]);
  /** @type {Set<string>} */
  const used = new Set();
  for (const file of [...PAINTERS, KIT]) {
    for (const m of codeOf(file).matchAll(/\b(?:t|tones\(\))\.([a-zA-Z]+)\b/g)) used.add(m[1]);
  }
  assert.ok(used.size > 30, `only ${used.size} tones found in the painters`);
  for (const name of [...used].sort()) {
    assert.ok(
      typeof t[name] === 'string',
      `a painter asks for tones().${name}, which does not exist`,
    );
    assert.ok(
      measured.has(name) || bodies.has(name),
      `tones().${name} is painted and is neither measured against a surface nor a body`,
    );
  }
  for (const name of Object.keys(t)) {
    assert.match(t[name], /^#[0-9a-f]{6}$/i, `${name} is not a flat colour`);
  }
  // The live tones follow the palette the floor is painted in.
  assert.deepEqual(tones(), furnitureTonesFor(PALETTE));
});

test('no furniture painter names a colour of its own, or sets a shadow of its own', () => {
  for (const file of [...PAINTERS, KIT, 'furniture-tones.js']) {
    const code = codeOf(file);
    assert.deepEqual(
      code.match(/#[0-9A-Fa-f]{3,8}\b|rgba?\(/g) || [],
      [],
      `${file} paints a literal colour rather than a token`,
    );
    assert.doesNotMatch(
      code,
      /shadowBlur|shadowColor|shadowOffset|setLightShadow|withShadow/,
      `${file} sets a shadow; a piece meets the floor through grounded() and contactUnder()`,
    );
  }
  // By behaviour, at full detail: every shadowed paint is the piece's contact
  // (no offset) or a tall piece's cast along the light, in the contact colour.
  const contact = [PALETTE.shadowContact, alphaScaled(PALETTE.shadowContact, SHORT_CONTACT_ALPHA)];
  let shadowed = 0;
  for (const cell of FURNITURE_SHEET) {
    for (const prop of cell.props) {
      const ctx = paintAt(prop, 32);
      for (const p of ctx.paints.filter((/** @type {any} */ q) => q.shadowBlur > 0)) {
        shadowed++;
        assert.ok(contact.includes(p.shadowColor), `${prop.kind} casts in ${p.shadowColor}`);
        assert.ok(p.shadowOffsetX >= 0 && p.shadowOffsetY >= 0, `${prop.kind} casts up or left`);
        if (PROP_HEIGHT[prop.kind] === 'short' && prop.tall !== true) {
          assert.equal(p.shadowOffsetX + p.shadowOffsetY, 0, `${prop.kind} is short and casts`);
        }
      }
    }
  }
  assert.ok(shadowed > 100, `only ${shadowed} shadowed paints on the whole sheet`);
});

// ------------------------------------------------------------ level of detail

/**
 * WHAT EVERY PROP COST BEFORE IT HAD LEVELS: path operations and paints, as
 * recorded from the painters at commit b1fe68a (the floor before this redraw),
 * which drew the same thing at every scale. `[kind, w, h, extra, path, paint]`.
 * @type {Array<[string, number, number, any, number, number]>}
 */
const BEFORE = [
  ['desk', 5.2, 2.6, {}, 32, 7],
  ['user_desk', 8.8, 3, {}, 32, 7],
  ['desk_tray', 2.2, 1.2, {}, 51, 4],
  ['monitor', 1.6, 0.5, { anchor: { type: 'attached', edge: 'N' } }, 16, 2],
  ['chair', 2, 2, { angle: Math.PI / 2, anchor: { type: 'attached', edge: 'N' } }, 77, 8],
  ['tub_chair', 2.4, 2.4, {}, 12, 3],
  ['pinboard', 1.2, 2.8, {}, 31, 6],
  ['whiteboard', 2.4, 6.5, {}, 61, 9],
  ['art', 0.4, 4.8, {}, 30, 5],
  ['shelf', 1.2, 6, {}, 43, 15],
  ['bookshelf', 7.2, 1.2, {}, 50, 19],
  ['screen', 2.6, 0.7, {}, 54, 5],
  ['tv', 6, 0.6, {}, 39, 3],
  ['rug', 12, 8, {}, 63, 5],
  ['rug', 12, 8, { tone: 'wool' }, 63, 5],
  ['rug_round', 6.4, 6.4, { tone: 'task' }, 21, 3],
  ['sofa', 8, 2.4, { angle: -Math.PI / 2 }, 137, 13],
  ['sofa', 2.6, 11.6, { angle: Math.PI, cushions: 4 }, 161, 15],
  ['sofa_corner', 2.6, 2.6, {}, 41, 5],
  ['armchair', 3, 3, {}, 41, 5],
  ['coffee_table', 6, 2.7, {}, 41, 5],
  ['side_table', 1.8, 1.8, {}, 41, 5],
  ['magazine_table', 7, 3, {}, 53, 6],
  ['fruit_bowl', 1.6, 1.6, {}, 23, 8],
  ['lamp', 1.6, 1.6, {}, 15, 4],
  ['water_cooler', 1.6, 1.6, {}, 15, 4],
  ['meeting_table', 6.2, 7.3, { seats: 4, turned: false }, 183, 26],
  ['meeting_table', 11.4, 7.3, { seats: 8, turned: false }, 335, 46],
  ['credenza', 10.4, 1.4, {}, 45, 8],
  ['board_stand', 0.6, 4.4, {}, 53, 6],
  ['dining_table', 7.6, 7.6, {}, 14, 5],
  ['board_game_table', 4, 4, {}, 14, 5],
  ['pool_table', 8, 4.5, {}, 118, 20],
  ['table_tennis', 8, 4.4, {}, 33, 5],
  ['foosball', 4, 2.4, {}, 89, 18],
  ['arcade_cabinet', 2, 2, {}, 28, 3],
  ['counter', 11, 2, {}, 41, 5],
  ['fridge', 2.6, 2.4, {}, 29, 4],
  ['coffee_machine', 1.6, 1.2, {}, 27, 2],
  ['reception_desk', 8, 3, {}, 42, 6],
  ['bar_counter', 11, 1.6, {}, 41, 5],
  ['bar_stool', 1.4, 1.4, {}, 14, 5],
  ['box', 1.5, 1.5, {}, 29, 4],
  ['exit_sign', 2, 0.6, {}, 27, 2],
  ['plant_broad', 2, 2, {}, 24, 7],
  ['plant_blade', 2.4, 2.4, {}, 45, 9],
  ['plant_tree', 3.2, 3.2, {}, 24, 7],
  ['planter', 0.9, 5.2, {}, 78, 13],
  ['mug', 0.8, 0.8, {}, 15, 4],
  ['notebook', 1.3, 0.9, {}, 47, 7],
  ['sticky', 0.7, 0.7, {}, 33, 3],
  ['doormat', 4.6, 1.8, {}, 87, 15],
];

test('the three levels are under 10, 10 to 16, and over 16 device pixels to the unit', () => {
  assert.equal(LOD_MID_PPU, 10);
  assert.equal(LOD_FULL_PPU, 16);
  /** @param {number} ppu */
  const at = (ppu) => {
    const ctx = makeRecorder();
    setDeviceScale(ctx, ppu / U_DEFAULT);
    return detailOf(ctx, U_DEFAULT);
  };
  assert.deepEqual([7.5, 8, 9.99].map(at), [0, 0, 0]);
  assert.deepEqual([10, 14, 15.85, 16].map(at), [1, 1, 1, 1]);
  assert.deepEqual([16.01, 18.6, 32].map(at), [2, 2, 2]);
  // A context nobody has spoken for is the design grid, which is the middle.
  assert.equal(detailOf(makeRecorder(), U_DEFAULT), 1);
  assert.deepEqual(
    [...SHEET_SCALES],
    [16, 32],
    'the sheet shows the middle level and the full one',
  );
});

test('LEVEL 0: at 8 px per unit no prop costs more path operations than it did before', () => {
  let before = 0;
  let after = 0;
  let fewer = 0;
  for (const [kind, w, h, extra, pathOps, paintOps] of BEFORE) {
    const ctx = paintAt({ kind, w, h, id: `sheet-${kind}`, ...extra }, 8);
    const p = total(ctx, PATH_OPS);
    const q = total(ctx, PAINT_OPS);
    assert.ok(p <= pathOps, `${kind} ${w}×${h}: ${p} path operations at 8 px, ${pathOps} before`);
    assert.ok(q <= paintOps, `${kind} ${w}×${h}: ${q} paints at 8 px, ${paintOps} before`);
    before += pathOps;
    after += p;
    if (p < pathOps) fewer++;
  }
  assert.equal(BEFORE.length, 52);
  /** @param {number} ppu */
  const sum = (ppu) =>
    BEFORE.reduce(
      (a, [kind, w, h, extra]) =>
        a + total(paintAt({ kind, w, h, id: `sheet-${kind}`, ...extra }, ppu), PATH_OPS),
      0,
    );
  const mid = sum(14);
  const full = sum(32);
  assert.ok(after <= before);
  assert.ok(mid > after && full > mid, 'the levels are not three different drawings');
  report('path operations, one of every prop (52)', [
    ['before, at every scale', String(before)],
    ['now at 8 px per unit', `${after}  (${fewer} props cost fewer, none more)`],
    ['now at 14 px per unit', String(mid)],
    ['now at 32 px per unit', String(full)],
  ]);
});

test('LEVEL 2: a desk has its screen, keyboard, key rows and mouse; level 0 has none of them', () => {
  const t = tones();
  const monitor = { kind: 'monitor', w: 1.6, h: 0.5, anchor: { type: 'attached', edge: 'N' } };
  const full = paintAt(monitor, 32);
  assert.equal(inStyle(full, t.monitorBezel, 'fill').length, 1, 'the screen is one dark bar');
  assert.equal(inStyle(full, PALETTE.monitorScreenGlow, 'fillRect').length, 1, 'lit on one side');
  assert.equal(inStyle(full, t.keyboard, 'fill').length, 2, 'a keyboard and a mouse');
  assert.equal(inStyle(full, t.keyRow, 'stroke').length, 1);
  assert.equal(full.counts.moveTo >= 3, true, 'three rows of keys');
  assert.equal(full.counts.ellipse, 1, 'the foot the screen stands on');
  assert.equal(inStyle(full, t.monitorFoot, 'fill').length, 1);
  // THE KEYBOARD IS ON THE OCCUPANT'S SIDE OF THE SCREEN, whichever edge that is.
  for (const edge of /** @type {const} */ (['N', 'S', 'W', 'E'])) {
    const lying = edge === 'N' || edge === 'S' ? { w: 1.6, h: 0.5 } : { w: 0.5, h: 1.6 };
    const ctx = paintAt({ kind: 'monitor', ...lying, anchor: { type: 'attached', edge } }, 32);
    const centre = [(4 + lying.w / 2) * U_DEFAULT, (6 + lying.h / 2) * U_DEFAULT];
    /** @param {any} p */
    const mid = (p) => {
      const xs = p.points.map((/** @type {number[]} */ q) => q[0]);
      const ys = p.points.map((/** @type {number[]} */ q) => q[1]);
      return [
        (Math.min(...xs) + Math.max(...xs)) / 2 - centre[0],
        (Math.min(...ys) + Math.max(...ys)) / 2 - centre[1],
      ];
    };
    const keys = mid(inStyle(ctx, t.keyboard, 'fill')[0]);
    const screen = mid(inStyle(ctx, t.monitorBezel, 'fill')[0]);
    const toward = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }[edge];
    const k = keys[0] * toward[0] + keys[1] * toward[1];
    const s = screen[0] * toward[0] + screen[1] * toward[1];
    assert.ok(
      k > 0 && s < 0,
      `edge ${edge}: keyboard at ${k.toFixed(1)}, screen at ${s.toFixed(1)}`,
    );
  }
  // The user's own desk has no edge to name: the manager sits to its north.
  const users = paintAt({ kind: 'monitor', w: 1.6, h: 0.5, anchor: { type: 'zone' } }, 32);
  assert.equal(inStyle(users, t.keyboard, 'fill').length, 2);
  // The middle level names the piece and stops: screen and keyboard, no rows.
  const mid = paintAt(monitor, 14);
  assert.equal(inStyle(mid, t.keyboard, 'fill').length, 1);
  assert.equal(inStyle(mid, t.keyRow).length, 0);
  assert.equal(mid.counts.ellipse || 0, 0);
  // And level 0 is the dark bar it always was.
  const low = paintAt(monitor, 8);
  assert.equal(inStyle(low, t.keyboard).length, 0);
  assert.equal(low.paints.length, 2);

  // The desk itself: both shaded edges and both lit ones, inside its outline,
  // and on a bench the spine between its two rows.
  const desk = paintAt({ kind: 'desk', w: 5.2, h: 2.6 }, 32);
  const bands = inStyle(desk, t.deskBand, 'fillRect');
  const lit = inStyle(desk, PALETTE.deskSheen, 'fillRect');
  assert.equal(bands.length, 2);
  assert.equal(lit.length, 2);
  assert.ok(
    [...bands, ...lit].every((p) => p.clipped),
    'an edge is drawn outside the top',
  );
  assert.equal(inStyle(desk, t.deskSpine, 'stroke').length, 1);
  assert.equal(inStyle(paintAt({ kind: 'user_desk', w: 8.8, h: 3 }, 32), t.deskSpine).length, 0);
  assert.equal(inStyle(paintAt({ kind: 'desk', w: 5.2, h: 2.6 }, 14), t.deskSpine).length, 0);
});

test('LEVEL 2: a task chair has five spokes and castors, a seat, two arms and a back', () => {
  const t = tones();
  const chair = {
    kind: 'chair',
    w: 2,
    h: 2,
    angle: Math.PI / 2,
    anchor: { type: 'attached', edge: 'N' },
  };
  const full = paintAt(chair, 32);
  const base = inStyle(full, t.chairBase);
  assert.deepEqual(
    base.map((p) => p.op),
    ['stroke', 'fill'],
    'spokes, then castors',
  );
  assert.equal(base[0].points.length, 10, 'five spokes: ten ends');
  assert.equal(base[1].points.length, 10, 'five castors');
  assert.equal(inStyle(full, t.chairArm, 'fill').length, 2);
  assert.equal(inStyle(full, t.seatLine, 'stroke').length, 1);
  assert.equal(inStyle(full, t.chairBack, 'stroke').length, 1);
  assert.equal(
    inStyle(full, PALETTE.chairFill, 'fill').length,
    2,
    'the seat, once for its contact',
  );
  const mid = paintAt(chair, 14);
  assert.equal(inStyle(mid, t.chairBase).length, 2);
  assert.equal(inStyle(mid, t.chairArm).length, 2);
  assert.equal(inStyle(mid, t.seatLine).length, 0);
  const low = paintAt(chair, 8);
  assert.equal(inStyle(low, t.chairBase).length, 0);
  assert.equal(inStyle(low, t.chairArm).length, 0);
  assert.equal(
    inStyle(low, t.chairBack, 'stroke').length,
    1,
    'a chair is a seat and a back at any scale',
  );
});

test('A SEAT’S BACK IS BEHIND WHOEVER SITS IN IT: task chair, tub chair, armchair, sofa', () => {
  const t = tones();
  /** The mean of a paint's points, relative to the prop's centre. @param {any} p @param {any} prop */
  const offset = (p, prop) => {
    const cx = (4 + prop.w / 2) * U_DEFAULT;
    const cy = (6 + prop.h / 2) * U_DEFAULT;
    const n = p.points.length;
    return [
      p.points.reduce((/** @type {number} */ a, /** @type {number[]} */ q) => a + q[0], 0) / n - cx,
      p.points.reduce((/** @type {number} */ a, /** @type {number[]} */ q) => a + q[1], 0) / n - cy,
    ];
  };
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const [name, angle] of /** @type {Array<[string, number]>} */ ([
    ['east', 0],
    ['south', Math.PI / 2],
    ['west', Math.PI],
    ['north', -Math.PI / 2],
  ])) {
    const facing = [Math.cos(angle), Math.sin(angle)];
    /** How far along the way the seat faces. @param {number[]} o */
    const ahead = (o) => o[0] * facing[0] + o[1] * facing[1];

    const chair = { kind: 'chair', w: 2, h: 2, angle };
    const back = ahead(offset(inStyle(paintAt(chair, 32), t.chairBack, 'stroke')[0], chair));
    assert.ok(
      back < -0.2 * U_DEFAULT,
      `a chair facing ${name} has its back ${back.toFixed(1)} px ahead`,
    );

    const tub = { kind: 'tub_chair', w: 2.4, h: 2.4, angle };
    const painted = paintAt(tub, 32);
    const wrap = ahead(offset(inStyle(painted, t.sofaArm, 'stroke')[0], tub));
    const seat = ahead(offset(inStyle(painted, t.sofaCushion, 'fill')[0], tub));
    assert.ok(
      wrap < 0 && seat > 0,
      `a tub chair facing ${name}: wrap ${wrap.toFixed(1)}, seat ${seat.toFixed(1)}`,
    );

    const arm = { kind: 'armchair', w: 3, h: 3, angle };
    const cushion = ahead(offset(inStyle(paintAt(arm, 32), PALETTE.sofaCushion, 'fill')[0], arm));
    assert.ok(cushion > 0, `an armchair facing ${name} has its cushion behind its back`);
    rows.push([
      `facing ${name}`,
      `chair back ${back.toFixed(1)} px, tub wrap ${wrap.toFixed(1)} px, tub seat +${seat.toFixed(1)} px`,
    ]);
  }
  // A sofa's rect does not turn; its back is the long side away from its facing.
  const sofa = { kind: 'sofa', w: 7.8, h: 2.6, angle: Math.PI / 2 };
  const pads = inStyle(paintAt(sofa, 32), t.sofaBack, 'fill');
  assert.ok(pads.length >= 3);
  assert.ok(
    pads.every((p) => offset(p, sofa)[1] < 0),
    'a sofa facing south has back cushions at its front',
  );
  report('along the way each seat faces (negative is behind)', rows);
});

test('an empty chair is left turned 8 to 15 degrees, the same way on every bake', () => {
  const seen = new Set();
  let left = 0;
  for (let i = 0; i < 200; i++) {
    const prop = {
      kind: 'chair',
      x: i * 2.6,
      y: 3,
      anchor: { type: 'attached', to: 't', edge: 'N' },
    };
    const a = chairSwivel(prop);
    const deg = Math.abs((a * 180) / Math.PI);
    assert.ok(deg >= 8 && deg <= 15, `chair ${i} is turned ${deg.toFixed(1)} degrees`);
    assert.equal(chairSwivel({ ...prop }), a, 'the same chair turned differently twice');
    seen.add(a.toFixed(4));
    if (a < 0) left++;
  }
  assert.ok(seen.size > 150, `only ${seen.size} different turns in 200 chairs`);
  assert.ok(left > 60 && left < 140, `${left} of 200 chairs turn left`);
  // The turn is paint: a chair is still drawn inside its own footprint.
  const ctx = paintAt({ kind: 'chair', w: 2, h: 2, angle: 0 }, 32);
  for (const p of ctx.paints.filter((/** @type {any} */ q) => q.points.length)) {
    for (const [x, y] of p.points) {
      assert.ok(
        Math.abs(x - 5 * U_DEFAULT) <= 1.3 * U_DEFAULT &&
          Math.abs(y - 7 * U_DEFAULT) <= 1.3 * U_DEFAULT,
      );
    }
  }
});

test('LEVEL 2: a meeting table’s chairs are a third under its edge, and it has its runner', () => {
  const t = tones();
  assert.equal(MEETING_TUCK, 0.35);
  for (const seats of [4, 8]) {
    const prop = {
      kind: 'meeting_table',
      w: seats === 4 ? 6.2 : 11.4,
      h: 7.3,
      seats,
      turned: false,
    };
    const ctx = paintAt(prop, 32);
    assert.equal(inStyle(ctx, t.chairBack, 'stroke').length, seats, 'one back per chair');
    assert.equal(inStyle(ctx, t.chairBase).length, 0, 'a meeting chair has no base to look at');
    assert.equal(inStyle(ctx, t.tableStrip, 'fill').length, 1);
    // The table is painted after every chair, so it lies over their fronts.
    const order = ctx.paints.map((/** @type {any} */ p) => p.style);
    assert.ok(order.lastIndexOf(PALETTE.chairFill) < order.indexOf(PALETTE.tableWood));
    // Its top edge, and the seat fronts under it.
    const top = ctx.paints.find((/** @type {any} */ p) => p.style === PALETTE.tableWood);
    const ys = top.points.map((/** @type {number[]} */ q) => q[1]);
    const edge = Math.min(...ys);
    const seatsNorth = inStyle(ctx, PALETTE.chairFill, 'fill')
      .map((p) => Math.max(...p.points.map((/** @type {number[]} */ q) => q[1])))
      .filter((y) => y < (6 + 7.3 / 2) * U_DEFAULT);
    assert.ok(seatsNorth.length >= seats / 2);
    for (const y of seatsNorth) assert.ok(y > edge + 2, 'a chair is not under the table');
  }
  assert.equal(
    inStyle(paintAt({ kind: 'meeting_table', w: 6.2, h: 7.3, seats: 4 }, 8), t.tableStrip).length,
    0,
  );
});

test('LEVEL 2: a sofa has arms, a back, two rows of cushions, seams and one pillow', () => {
  const t = tones();
  const sofa = { kind: 'sofa', w: 7.8, h: 2.6, angle: Math.PI / 2 };
  const full = paintAt(sofa, 32);
  assert.equal(inStyle(full, t.sofaArm, 'fill').length, 3, 'a back and two arms');
  const seats = inStyle(full, PALETTE.sofaCushion, 'fill').length;
  assert.equal(seats, 3, 'one seat cushion for every 1.9 units between the arms');
  assert.equal(inStyle(full, t.sofaBack, 'fill').length, seats, 'a back cushion behind each');
  assert.equal(inStyle(full, t.sofaSeam, 'stroke').length, seats);
  assert.equal(inStyle(full, t.pillow, 'fill').length, 1);
  // A reception run has as many cushions as the plan sat people on it.
  const run = paintAt({ kind: 'sofa', w: 11.6, h: 2.6, angle: Math.PI / 2, cushions: 4 }, 32);
  assert.equal(inStyle(run, PALETTE.sofaCushion, 'fill').length, 4);
  const mid = paintAt(sofa, 14);
  assert.equal(inStyle(mid, t.sofaArm, 'fill').length, 3);
  assert.equal(inStyle(mid, t.sofaBack, 'fill').length, 3);
  assert.equal(inStyle(mid, t.pillow).length + inStyle(mid, t.sofaSeam).length, 0);
  const low = paintAt(sofa, 8);
  assert.equal(inStyle(low, t.sofaArm).length + inStyle(low, t.sofaBack).length, 0);
  assert.equal(inStyle(low, PALETTE.sofaCushion, 'fill').length, 3);

  const arm = paintAt({ kind: 'armchair', w: 3, h: 3 }, 32);
  assert.equal(inStyle(arm, t.sofaArm, 'fill').length, 3, 'the same construction, at one seat');
  assert.equal(inStyle(arm, t.sofaBack, 'fill').length, 1);
  assert.equal(inStyle(arm, PALETTE.sofaCushion, 'fill').length, 1);

  const tub = paintAt({ kind: 'tub_chair', w: 2.4, h: 2.4 }, 32);
  assert.equal(inStyle(tub, t.sofaArm, 'stroke').length, 1, 'one back, wrapped round');
  assert.equal(inStyle(tub, t.sofaSeam, 'stroke').length, 1);

  const booth = paintAt({ kind: 'booth', w: 4.2, h: 3.2, angle: Math.PI / 2 }, 32);
  assert.equal(inStyle(booth, PALETTE.sofaCushion, 'fill').length, 4, 'two cushions down each arm');
  assert.equal(inStyle(booth, PALETTE.tableWood, 'fill').length, 1);
  assert.equal(inStyle(booth, PALETTE.sofaFrame, 'fill').length, 2, 'the U, cast and contact');
  assert.equal(PROP_HEIGHT.booth, 'tall');
});

test('LEVEL 2: storage has drawer fronts, pulls, things on top, and books in three tones', () => {
  const t = tones();
  assert.equal(DRAWER_U, 1.4);
  assert.equal(CREDENZA_OBJECT_U, 3);
  const credenza = paintAt({ kind: 'credenza', w: 10.4, h: 1.4 }, 32);
  const lines = inStyle(credenza, t.tableBand, 'stroke');
  const fronts = Math.round(10.4 / DRAWER_U);
  assert.equal(lines[0].points.length, (fronts - 1) * 2, 'a line between every two fronts');
  assert.equal(lines[1].points.length, fronts * 2, 'a pull on every front');
  const things =
    inStyle(credenza, t.topPot, 'fill').length +
    inStyle(credenza, t.topTray, 'fill').length +
    inStyle(credenza, t.topBook, 'fillRect').length;
  assert.ok(things >= Math.floor(10.4 / CREDENZA_OBJECT_U), `${things} things on 10.4 units`);
  assert.equal(inStyle(paintAt({ kind: 'credenza', w: 10.4, h: 1.4 }, 14), t.topPot).length, 0);

  for (const kind of ['shelf', 'bookshelf']) {
    const prop = { kind, w: 7.2, h: 1.2, id: `${kind}-a` };
    const full = paintAt(prop, 32);
    assert.equal(inStyle(full, t.shelfWell, 'fillRect').length, 1);
    const books = [t.bookA, t.bookB, t.bookC].map((c) => inStyle(full, c, 'fillRect').length);
    assert.ok(
      books.every((n) => n >= 3),
      `${kind}: books per tone ${books.join(', ')}`,
    );
    const count = books.reduce((a, b) => a + b, 0);
    assert.ok(count >= 24, `${kind}: only ${count} spines on 7.2 units`);
    // Seeded: the same shelf holds the same books; another holds others.
    const again = paintAt(prop, 32);
    assert.deepEqual(
      again.paints.map((/** @type {any} */ p) => p.size),
      full.paints.map((/** @type {any} */ p) => p.size),
    );
    const other = paintAt({ ...prop, id: `${kind}-b` }, 32);
    assert.notDeepEqual(
      other.paints.map((/** @type {any} */ p) => p.size),
      full.paints.map((/** @type {any} */ p) => p.size),
    );
    // A smaller bake draws fewer, wider spines, and the smallest draws blocks.
    const mid = [t.bookA, t.bookB, t.bookC].reduce(
      (a, c) => a + inStyle(paintAt(prop, 14), c).length,
      0,
    );
    const low = [t.bookA, t.bookB, t.bookC].reduce(
      (a, c) => a + inStyle(paintAt(prop, 8), c).length,
      0,
    );
    assert.ok(mid < count && low <= 8 && low < mid, `${kind}: ${count} / ${mid} / ${low} spines`);
  }
  // Its rect is its footprint: a case lying on its side is drawn along its run.
  for (const file of ['backdrop-props-room.js']) {
    const src = fs.readFileSync(path.join(RENDER, file), 'utf8');
    for (const kind of ['meeting_table', 'credenza', 'bookshelf', 'board_stand']) {
      const open = src.indexOf('{', src.indexOf(`case '${kind}':`));
      const next = src.indexOf("\n    case '", open);
      assert.match(src.slice(open, next < 0 ? src.length : next), /unturn\(ctx, prop\)/, kind);
    }
  }
});

test('every top shows its edge, and the shade follows the light the look is in', () => {
  const t = tones();
  /** The two shaded bands of a desk: [bottom's height, right's width]. */
  const bandsOf = () => {
    const bands = inStyle(paintAt({ kind: 'desk', w: 5.2, h: 2.6 }, 32), t.deskBand, 'fillRect');
    return [Math.abs(bands[0].size[1]), Math.abs(bands[1].size[0])];
  };
  try {
    const noon = bandsOf();
    assert.ok(Math.abs(noon[0] - noon[1]) < 1e-6, 'at noon the two shaded edges are equal');
    applyLook({ ...DEFAULT_LOOK, light: 'morning' }, 'default');
    const morning = bandsOf();
    assert.ok(
      morning[1] > morning[0] * 1.5,
      `morning: right ${morning[1].toFixed(2)}, bottom ${morning[0].toFixed(2)}`,
    );
    applyLook({ ...DEFAULT_LOOK, light: 'evening' }, 'default');
    const evening = bandsOf();
    assert.ok(
      evening[0] > evening[1] * 1.5,
      `evening: right ${evening[1].toFixed(2)}, bottom ${evening[0].toFixed(2)}`,
    );
    report('a desk’s shaded edges, in design pixels (bottom, right)', [
      ['morning', morning.map((n) => n.toFixed(2)).join(', ')],
      ['noon', noon.map((n) => n.toFixed(2)).join(', ')],
      ['evening', evening.map((n) => n.toFixed(2)).join(', ')],
    ]);
  } finally {
    resetLook();
  }
  // The tables and the counter take the same edge from the middle level up.
  for (const [prop, band] of /** @type {Array<[any, string]>} */ ([
    [{ kind: 'meeting_table', w: 6.2, h: 7.3, seats: 4 }, t.tableBand],
    [{ kind: 'coffee_table', w: 6, h: 2.7 }, t.tableBand],
    [{ kind: 'side_table', w: 1.8, h: 1.8 }, t.tableBand],
    [{ kind: 'credenza', w: 10.4, h: 1.4 }, t.tableBand],
    [{ kind: 'counter', w: 11, h: 2 }, t.counterBand],
  ])) {
    const edges = inStyle(paintAt(prop, 14), band, 'fillRect').filter((p) => p.clipped);
    assert.equal(edges.length, 2, `${prop.kind} does not show its two shaded edges`);
  }
});

test('a rug keeps its border, takes the set’s corners and one device pixel of inner line', () => {
  const rug = { kind: 'rug', w: 12, h: 8, tone: 'wool' };
  const low = paintAt(rug, 8);
  const mid = paintAt(rug, 14);
  assert.equal(mid.counts.stroke, low.counts.stroke + 1, 'the inner line');
  const line = inStyle(mid, PALETTE.rugEdge, 'stroke').find((p) => Math.abs(p.width - 1) < 1e-9);
  assert.ok(line, 'no hairline on the rug');
  // At 32 px per unit the same line is still one device pixel: 14/32 of a design one.
  const fine = inStyle(paintAt(rug, 32), PALETTE.rugEdge, 'stroke').map((p) => p.width);
  assert.ok(
    fine.some((w) => Math.abs(w - U_DEFAULT / 32) < 1e-9),
    `widths ${fine.join(', ')}`,
  );
  // Nothing under a rug but its own contact.
  const shadows = mid.paints.filter((/** @type {any} */ p) => p.shadowBlur > 0);
  assert.equal(shadows.length, 1);
  assert.equal(shadows[0].shadowOffsetX + shadows[0].shadowOffsetY, 0);
});

// ------------------------------------------------------------------ the sheet

test('the furniture sheet holds every kind a painter answers to, inside its cells', () => {
  /** @type {Set<string>} */
  const painted = new Set();
  for (const file of PAINTERS) {
    for (const m of codeOf(file).matchAll(/case '([a-z_0-9]+)':/g)) painted.add(m[1]);
  }
  assert.ok(painted.size >= 50, `only ${painted.size} painted kinds found`);
  /** @type {Set<string>} */
  const shown = new Set();
  for (const cell of FURNITURE_SHEET) {
    assert.ok(cell.label && (cell.floor === 'wood' || cell.floor === 'carpet'));
    for (const prop of cell.props) {
      shown.add(prop.kind);
      assert.ok(painted.has(prop.kind), `the sheet shows "${prop.kind}", which nothing paints`);
      assert.ok(PROP_HEIGHT[prop.kind], `${prop.kind} has no declared height`);
      assert.ok(
        prop.x >= 0 &&
          prop.y >= 1 &&
          prop.x + prop.w <= SHEET_CELL.w &&
          prop.y + prop.h <= SHEET_CELL.h,
        `${cell.label}: ${prop.kind} is outside its cell`,
      );
    }
  }
  // The manager is a person, drawn by the rig, and is not furniture.
  const missing = [...painted].filter((k) => !shown.has(k) && k !== 'manager').sort();
  assert.deepEqual(missing, [], 'a painted kind is not on the sheet');
  // Every one of them paints at both of the sheet's scales without throwing.
  let props = 0;
  for (const ppu of SHEET_SCALES) {
    for (const cell of FURNITURE_SHEET) {
      for (const prop of cell.props) {
        assert.ok(paintAt(prop, ppu).paints.length > 0, `${prop.kind} drew nothing at ${ppu}`);
        props++;
      }
    }
  }
  report('the furniture sheet', [
    ['scenes', String(FURNITURE_SHEET.length)],
    ['kinds', `${shown.size} of ${painted.size - 1} painted (the manager is a person)`],
    ['props painted', `${props} across ${SHEET_SCALES.join(' and ')} px per unit`],
  ]);
});
