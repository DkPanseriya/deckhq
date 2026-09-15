/**
 * PROPS, PLANTS, DENSITY, AND THE TWO ROOMS THAT ARE PLACES (WP-85c).
 *
 * `docs/plan/10-INTERIOR-DESIGN.md` §3.5, §3.6 and §3.7 are four density rules,
 * a planting budget, four named bays and a reception with three zones. Every
 * one of them is stated as something checkable on an EMITTED PLAN — §3.5 says
 * so in its first line — and this file is that check.
 *
 * Its own suite rather than more of `interior.test.mjs` for the reason that
 * file gives for existing at all: it guards WP-85a's materials, and a suite
 * that guards two packages tells you which one broke only by accident.
 *
 * IT PRINTS ITS MEASUREMENTS, in `interior.test.mjs`'s style, so a change that
 * moves a density shows you what it moved rather than only that it moved.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPlan } from '../../public/render/plan.js';
import { buildLounge } from '../../public/render/plan-service.js';
import {
  DESK_CLUTTER_SETS,
  LOUNGE_BAYS,
  LOUNGE_BAY_DROP_ORDER,
  LOUNGE_BAY_NAMES,
  LOUNGE_BAY_ROW_MIN,
  PLANTS_PER_LOUNGE_BAY,
  PLANTS_PER_PROJECT_ROOM,
  PLANT_FOOTPRINTS,
  PLANT_RUN_KINDS,
  PROP_CLEAR_U2,
  SILHOUETTE_SPACING,
  CLEAR_PATCH_MAX,
  deskClutterFor,
  loungeBayNames,
  plantRun,
} from '../../public/render/plan-props.js';
import {
  GAME_HUES,
  GAME_MUTE,
  GAME_MUTE_MAX,
  GAME_MUTE_MIN,
  MUTED_GAME_TOKENS,
  DEFAULT_PALETTE,
} from '../../public/render/palette.js';
import { PROP_HEIGHT } from '../../public/render/backdrop-paint.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDER = path.join(HERE, '..', '..', 'public', 'render');
const NOW = 1_800_000_000_000;

/** One table, printed. @param {string} title @param {Array<[string, string]>} rows */
function report(title, rows) {
  const w = rows.reduce((a, [k]) => Math.max(a, k.length), 0);
  console.log(`\n  ${title}`);
  for (const [k, v] of rows) console.log(`    ${k.padEnd(w)}  ${v}`);
}

/**
 * THE SIX POPULATIONS THE GOLDENS PHOTOGRAPH, as plans.
 *
 * `scripts/demo-populations.mjs` builds the real ones out of a fixture
 * directory and a clock, which is a great deal of machinery for a question
 * about rectangles. These are the same SHAPES — the same room counts, the same
 * benched and waiting numbers, the same two stages — built straight out of
 * `buildPlan`, which is what every geometry suite in this repo already does.
 */
const POPULATIONS = /** @type {const} */ ([
  ['empty', [], 0, 0, { w: 1600, h: 1000 }],
  ['single', [1], 0, 0, { w: 1600, h: 1000 }],
  ['three', [3, 2, 2], 5, 1, { w: 1600, h: 1000 }],
  ['pinned', [3, 2, 2], 5, 1, { w: 1600, h: 1000 }],
  ['wide', [3, 2, 2], 5, 1, { w: 1920, h: 1080 }],
  ['demo', [4, 3, 2, 2, 1, 1], 6, 4, { w: 1600, h: 1000 }],
  ['reference', [21, 5, 3, 1], 12, 9, { w: 1600, h: 1000 }],
]);

/**
 * @param {readonly number[]} sizes @param {number} benched @param {number} waiting
 * @param {{w:number,h:number}} stage
 */
function planFor(sizes, benched, waiting, stage) {
  /** @type {any[]} */
  const agents = [];
  const projects = sizes.map((n, i) => ({
    id: `p${i}`,
    name: `p${i}`,
    sessionCount: n,
    tokens: 1000 * (i + 1),
    needsYou: 0,
  }));
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
  for (let k = 0; k < benched; k++)
    agents.push(at(`b${k}`, { ackState: 'benched', activityState: 'ended' }));
  for (let k = 0; k < waiting; k++)
    agents.push(at(`w${k}`, { activityState: 'for_review', reviewSince: 1_000_000 + k }));
  return buildPlan(projects, agents, { now: NOW, stage });
}

/** Every population's plan, built once. */
const PLANS = POPULATIONS.map(([name, sizes, benched, waiting, stage]) => ({
  name,
  plan: planFor(sizes, benched, waiting, stage),
}));

// --------------------------------------------------------------- the props

/**
 * WHAT COUNTS AS A FREE-STANDING PROP (§3.5).
 *
 * The density rule is about things standing ON the floor, so three groups are
 * not in it, and each for a reason rather than for convenience:
 *
 *   - **Floor coverings.** A rug is not a thing on the floor; it is the floor
 *     wearing something. §3.5 says so itself — *"a bigger rug"* is what the
 *     clear-patch rule refuses as an answer.
 *   - **Wall fixtures.** A whiteboard, a shelf, a pinboard, a framed print and
 *     an exit sign hang on a wall and take no floor at all.
 *   - **Things on a surface.** A mug, a notebook, a sticky note, a tray, a
 *     monitor and a fruit bowl stand on a desk or a counter that is already
 *     counted. §3.5's own sentence about desks is a density rule on a SURFACE,
 *     and `DESK_CLUTTER_SETS` is what bounds that.
 */
const NOT_ON_THE_FLOOR = new Set([
  'rug',
  'rug_round',
  'doormat',
  'whiteboard',
  'shelf',
  'bookshelf',
  'pinboard',
  'art',
  'tv',
  'screen',
  'exit_sign',
  'mug',
  'notebook',
  'sticky',
  'desk_tray',
  'monitor',
  'fruit_bowl',
  'coffee_machine',
]);

/** @param {{kind:string}} p */
const onTheFloor = (p) => !NOT_ON_THE_FLOOR.has(p.kind);

/** @param {{x:number,y:number,w:number,h:number}} a @param {any} b */
function gapBetween(a, b) {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
  return Math.hypot(dx, dy);
}

test('§3.5 at most one free-standing prop per 9 U² of clear floor, on every population', () => {
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const { name, plan } of PLANS) {
    for (const room of plan.rooms) {
      if (room.kind === 'corridor') continue;
      const standing = room.props.filter(onTheFloor);
      if (!standing.length) continue;
      const area = room.w * (room.h - (room.plateBand ?? 0));
      const taken = standing.reduce((a, p) => a + p.w * p.h, 0);
      const clear = Math.max(0, area - taken);
      const allowed = Math.max(1, Math.floor(clear / PROP_CLEAR_U2));
      rows.push([
        `${name}/${room.id}`,
        `${standing.length} props · ${clear.toFixed(0)} U² clear · ≤ ${allowed}`,
      ]);
      assert.ok(
        standing.length <= allowed,
        `${name}/${room.id}: ${standing.length} free-standing props on ${clear.toFixed(1)} U² ` +
          `of clear floor — §3.5 allows one per ${PROP_CLEAR_U2} U², so ${allowed}`,
      );
    }
  }
  assert.ok(rows.length >= 20, 'sanity: the populations should exercise many rooms');
  report('§3.5 density, per room', rows.slice(0, 12));
  console.log(`    … ${rows.length} rooms over ${PLANS.length} populations`);
});

test('§3.5 no two identical silhouettes within 8 U', () => {
  // SCOPED TO THE DECORATION, and §3.5 is the reason: the rule sits in the
  // section about PROPS, three sentences after *"props keep WP13's anchors"*.
  // Furniture is not in it and cannot be — a bench desk's four task chairs are
  // four identical silhouettes 2.6 U apart by construction (§3.4's `SEAT_PITCH`)
  // and that is what a bench desk IS. What the rule is about is the answer a
  // room gives to a spare corner, which before this package was the same
  // rosette four times (§1.6).
  const DECOR = new Set([...PLANT_RUN_KINDS, 'planter', 'lamp', 'box']);
  let checked = 0;
  for (const { name, plan } of PLANS) {
    for (const room of plan.rooms) {
      const decor = room.props.filter((p) => DECOR.has(p.kind));
      for (let i = 0; i < decor.length; i++) {
        for (let j = i + 1; j < decor.length; j++) {
          if (decor[i].kind !== decor[j].kind) continue;
          const d = gapBetween(decor[i], decor[j]);
          assert.ok(
            d >= SILHOUETTE_SPACING - 1e-6,
            `${name}/${room.id}: two ${decor[i].kind} are ${d.toFixed(2)} U apart, ` +
              `and §3.5 keeps identical silhouettes ${SILHOUETTE_SPACING} U apart`,
          );
          checked++;
        }
      }
    }
  }
  console.log(
    `\n    ${checked} same-kind decoration pairs measured, all ≥ ${SILHOUETTE_SPACING} U`,
  );
});

test('§3.5 a clear-floor patch over 10 U × 10 U has a destination in it', () => {
  // *"A clear-floor patch larger than 10 U × 10 U gets a destination, not a
  // bigger rug — a break-out corner, a planter run, or nothing."*
  //
  // TWO ROOMS ARE EXEMPT AND §3.7 EXEMPTS THEM IN WORDS. The reception's middle
  // is clear because *"the middle is where the queue forms"*, and the lounge's
  // promenade is where the benched stand once every seat is taken. Clear floor
  // somebody is standing on is not a clear-floor patch; it is a room.
  const cell = 1;
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const { name, plan } of PLANS) {
    for (const room of plan.rooms) {
      if (room.kind !== 'project') continue;
      const band = room.plateBand ?? 0;
      const cols = Math.floor(room.w / cell);
      const rowsN = Math.floor((room.h - band) / cell);
      if (cols <= 0 || rowsN <= 0) continue;
      const blocked = room.props.filter((p) => p.kind !== 'doormat');
      /** Largest all-empty square, by the classic DP, in cells. */
      let best = 0;
      /** @type {number[]} */
      let prev = new Array(cols).fill(0);
      for (let r = 0; r < rowsN; r++) {
        /** @type {number[]} */
        const cur = new Array(cols).fill(0);
        for (let c = 0; c < cols; c++) {
          const x = room.x + c * cell;
          const y = room.y + band + r * cell;
          const covered = blocked.some(
            (p) => p.x < x + cell && p.x + p.w > x && p.y < y + cell && p.y + p.h > y,
          );
          cur[c] = covered
            ? 0
            : 1 + Math.min(prev[c], c > 0 ? cur[c - 1] : 0, c > 0 ? prev[c - 1] : 0);
          best = Math.max(best, cur[c]);
        }
        prev = cur;
      }
      const hasDestination = room.props.some(
        (p) => p.kind === 'tub_chair' || p.kind === 'armchair' || PLANT_FOOTPRINTS[p.kind],
      );
      rows.push([`${name}/${room.id}`, `${best} U square, destination ${hasDestination}`]);
      if (best > CLEAR_PATCH_MAX) {
        assert.ok(
          hasDestination,
          `${name}/${room.id}: a ${best} U × ${best} U patch of bare floor and nothing in the ` +
            'room to walk to — §3.5 asks for a destination, not a bigger rug',
        );
      }
    }
  }
  report('§3.5 largest bare square, per project room', rows.slice(0, 10));
});

// ------------------------------------------------------------- the clutter

test('§3.5 what is on a desk is a pure function of the desk, and no two desks match', () => {
  const twice = [deskClutterFor('p0-table-0:N0', 0), deskClutterFor('p0-table-0:N0', 0)];
  assert.deepEqual(twice[0], twice[1], 'the same desk laid two different desks');

  // PAIRWISE DISTINCT ACROSS A ROOM, which is arithmetic rather than luck:
  // twelve sets and an ordinal means the first twelve desks in a room cannot
  // repeat, and no room on this floor has twelve desks (§3.4's bench seats
  // four, `TABLE_SIZES` caps a table at eight).
  const { plan } = PLANS.find((p) => p.name === 'demo');
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const room of plan.rooms) {
    if (room.kind !== 'project') continue;
    const desks = new Map();
    for (const p of room.props) {
      if (!['mug', 'sticky', 'notebook', 'desk_tray'].includes(p.kind)) continue;
      const key = `${Math.round(p.x * 100)}`;
      desks.set(key, p.kind);
    }
    // Group the clutter by the seat cell it stands in: 2.6 U apart (SEAT_PITCH).
    const clutter = room.props.filter((p) =>
      ['mug', 'sticky', 'notebook', 'desk_tray'].includes(p.kind),
    );
    /** @type {Map<string, string[]>} */
    const bySeat = new Map();
    for (const p of clutter) {
      const seat = `${Math.round(p.y / 2.6)}:${Math.floor(p.x / 2.6)}`;
      bySeat.set(seat, [...(bySeat.get(seat) || []), p.kind].sort());
    }
    const signatures = [...bySeat.values()].map((v) => v.join('+'));
    rows.push([room.id, `${signatures.length} occupied desks`]);
    assert.ok(
      clutter.length > 0,
      `${room.id}: a room with people at desks and nothing on any of them`,
    );
  }
  assert.ok(rows.length > 0, 'sanity: the demo floor must have project rooms');

  // And the ordinal is what guarantees it, so the guarantee is checked on the
  // function rather than on one floor that happened to come out right.
  const seen = new Set();
  for (let i = 0; i < DESK_CLUTTER_SETS.length; i++) {
    const set = deskClutterFor('one-room-one-table', i)
      .map((p) => p.kind)
      .sort()
      .join('+');
    seen.add(set);
  }
  assert.equal(
    seen.size,
    new Set(DESK_CLUTTER_SETS.map((s) => [...s].sort().join('+'))).size,
    'twelve ordinals should walk the whole list of sets',
  );
  report('desks with something on them', rows);
});

// -------------------------------------------------------------- the plants

test('§3.6 two plants per project room, six per lounge bay, never two alike adjacent', () => {
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const { name, plan } of PLANS) {
    for (const room of plan.rooms) {
      const plants = room.props.filter((p) => PLANT_RUN_KINDS.includes(p.kind));
      if (room.kind === 'project') {
        assert.ok(
          plants.length <= PLANTS_PER_PROJECT_ROOM,
          `${name}/${room.id}: ${plants.length} plants, and §3.6 allows ${PLANTS_PER_PROJECT_ROOM}`,
        );
        const kinds = new Set(plants.map((p) => p.kind));
        assert.equal(
          kinds.size,
          plants.length,
          `${name}/${room.id}: two plants of the same kind in one room`,
        );
      }
      if (room.kind === 'lounge') {
        const bays = room.zones.filter((z) => z.bay);
        for (const bay of bays) {
          const inBay = plants.filter(
            (p) =>
              p.x >= bay.x - 1 &&
              p.x + p.w <= bay.x + bay.w + 1 &&
              p.y >= bay.y - 1 &&
              p.y + p.h <= bay.y + bay.h + 1,
          );
          assert.ok(
            inBay.length <= PLANTS_PER_LOUNGE_BAY,
            `${name}/${room.id}/${bay.bay}: ${inBay.length} plants, §3.6 allows ${PLANTS_PER_LOUNGE_BAY}`,
          );
        }
        rows.push([`${name}/lounge`, `${plants.length} plants over ${bays.length} bays`]);
      }
      if (room.kind === 'project') rows.push([`${name}/${room.id}`, `${plants.length} plants`]);
    }
  }
  report('§3.6 planting', rows.slice(0, 12));

  // The no-repeat rule holds by construction, so it is checked on the function
  // at a length no room will ever ask for.
  const run = plantRun('a-long-run', 200);
  for (let i = 1; i < run.length; i++) {
    assert.notEqual(run[i], run[i - 1], `plantRun repeated ${run[i]} at ${i}`);
  }
});

// --------------------------------------------------------------- the bays

test('§3.7 the lounge is four bays, each with its own ground and its own centrepiece', () => {
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const benched of [1, 2, 3, 5, 8, 12, 16, 20]) {
    const { room } = buildLounge(benched, { w: 46, h: 34 }, 0, 1);
    const bays = room.zones.filter((z) => z.bay);
    rows.push([`${benched} benched`, bays.map((b) => `${b.bay}:${b.ground}`).join(' · ')]);
    assert.ok(
      bays.length >= 3,
      `${benched} benched: the lounge emitted ${bays.length} named bays, and WP-85c's ` +
        'acceptance asks for at least three at any population ≥ 1',
    );
    for (const bay of bays) {
      assert.ok(bay.ground === 'wood' || bay.ground === 'tile', `${bay.bay} has no ground`);
      const inBay = room.props.filter(
        (p) => p.x + p.w > bay.x && p.x < bay.x + bay.w && p.y + p.h > bay.y && p.y < bay.y + bay.h,
      );
      assert.ok(inBay.length > 0, `${bay.bay} is a named rectangle with nothing in it`);
    }
    // The planter runs divide them: one fewer than the bays on any one row.
    const planters = room.props.filter((p) => p.kind === 'planter');
    assert.ok(planters.length >= 1, `${benched} benched: bays with nothing between them`);
  }
  report('§3.7 the bays, by population', rows);
});

test('§3.7 a narrow lounge drops bays from the right — games first, then quiet', () => {
  assert.deepEqual(
    LOUNGE_BAY_NAMES.slice(),
    ['sitting', 'cafe', 'quiet', 'games'],
    'the lay order is what makes "from the right" mean games then quiet',
  );
  assert.deepEqual(
    LOUNGE_BAY_DROP_ORDER.slice(0, 2),
    ['games', 'quiet'],
    '§3.7 drops games first, then quiet',
  );
  // A one-row lounge that cannot hold four bays gives up the games room, and
  // then the quiet one, and never goes below two.
  const wide = loungeBayNames(200, { oneRow: true });
  assert.deepEqual(wide.slice(), LOUNGE_BAY_NAMES.slice(), 'a wide row keeps every bay');
  const narrow = loungeBayNames(56, { oneRow: true });
  assert.ok(!narrow.includes('games'), 'the games bay survived a 56 U row');
  const tight = loungeBayNames(LOUNGE_BAY_ROW_MIN, { oneRow: true });
  assert.ok(
    tight.length <= 2,
    `§3.7 never spreads three bays across sixty units; this laid ${tight.length}`,
  );
  // And a drop that buys no row is not made: a lounge too narrow for even two
  // bays in a row wraps them instead of giving one up for nothing.
  const hopeless = loungeBayNames(20, { oneRow: true });
  assert.deepEqual(hopeless.slice(), LOUNGE_BAY_NAMES.slice(), 'a drop that buys nothing was made');
  report(
    '§3.7 collapse',
    [200, 80, 56, LOUNGE_BAY_ROW_MIN, 20].map((w) => [
      `${w} U row`,
      loungeBayNames(w, { oneRow: true }).join(' · '),
    ]),
  );
});

test('§3.7 every bay minimum width is the table’s, and the café is the only tile', () => {
  const byName = Object.fromEntries(LOUNGE_BAYS.map((b) => [b.name, b]));
  assert.equal(byName.sitting.minW, 26);
  assert.equal(byName.quiet.minW, 16);
  assert.equal(byName.cafe.minW, 22);
  assert.equal(byName.games.minW, 20);
  assert.deepEqual(
    LOUNGE_BAYS.filter((b) => b.ground === 'tile').map((b) => b.name),
    ['cafe'],
  );
});

// ------------------------------------------------------- the reception

test('§3.3 the reception lays a doormat inside its own door, and the queue stays clear', () => {
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const { name, plan } of PLANS) {
    const office = plan.rooms.find((r) => r.kind === 'office');
    if (!office) continue;
    const mat = office.props.find((p) => p.kind === 'doormat');
    assert.ok(mat, `${name}: the reception has no doormat`);
    assert.ok(office.door, `${name}: the reception has no door to put one inside`);
    // Inside the room, and on the side the door is on.
    assert.ok(
      mat.x >= office.x - 1e-6 &&
        mat.y >= office.y - 1e-6 &&
        mat.x + mat.w <= office.x + office.w + 1e-6 &&
        mat.y + mat.h <= office.y + office.h + 1e-6,
      `${name}: the doormat is outside the room it is in`,
    );
    const toDoor = Math.hypot(mat.x + mat.w / 2 - office.door.x, mat.y + mat.h / 2 - office.door.y);
    assert.ok(toDoor <= 8, `${name}: the doormat is ${toDoor.toFixed(1)} U from the door`);
    // §3.7: the middle stays clear, because the middle is where the queue
    // forms. Nothing standing on the floor may sit on a queue place.
    const queue = (office.zones || []).filter((z) => String(z.id).startsWith('office-queue-'));
    for (const z of queue) {
      for (const p of office.props.filter(onTheFloor)) {
        const overlap = p.x < z.x + z.w && p.x + p.w > z.x && p.y < z.y + z.h && p.y + p.h > z.y;
        assert.equal(overlap, false, `${name}: a ${p.kind} is standing in a queue place`);
      }
    }
    rows.push([
      name,
      `mat ${mat.w}×${mat.h} U, ${toDoor.toFixed(1)} U from the door, ${queue.length} queue places`,
    ]);
  }
  report('§3.3 the threshold', rows);
});

// ---------------------------------------------------- heights and materials

test('WP-78: every kind WP-85c adds declares its height', () => {
  const added = [
    'plant_broad',
    'plant_blade',
    'plant_tree',
    'planter',
    'mug',
    'notebook',
    'sticky',
    'doormat',
  ];
  for (const kind of added) {
    assert.ok(PROP_HEIGHT[kind], `${kind} has no declared height`);
  }
  assert.equal(PROP_HEIGHT.plant_tree, 'tall', '§3.6 puts a canopy at head height');
  assert.equal(PROP_HEIGHT.plant_broad, 'short');
  // And the two kinds §1.6 was written about are gone rather than left behind.
  assert.equal(PROP_HEIGHT.plant, undefined, 'the old rosette is still declared');
  assert.equal(PROP_HEIGHT.plant_large, undefined, 'the old rosette is still declared');
  report(
    'WP-78, the new kinds',
    added.map((k) => [k, PROP_HEIGHT[k]]),
  );
});

test('§3.5 the new painters use tokens, never a colour of their own', () => {
  const src = fs.readFileSync(path.join(RENDER, 'backdrop-props-plant.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const literals = code.match(/#[0-9A-Fa-f]{3,8}\b|rgba?\(/g) || [];
  assert.deepEqual(
    literals,
    [],
    `backdrop-props-plant.js paints ${literals.join(', ')} rather than a material token`,
  );
});

test('owner decision 5: the lounge games are muted 22–26 % toward the carpet', () => {
  assert.ok(
    GAME_MUTE >= GAME_MUTE_MIN && GAME_MUTE <= GAME_MUTE_MAX,
    `the mute is ${GAME_MUTE}, outside the ${GAME_MUTE_MIN}–${GAME_MUTE_MAX} the owner set`,
  );
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const token of MUTED_GAME_TOKENS) {
    const hue = GAME_HUES[token];
    const shipped = DEFAULT_PALETTE[token];
    assert.notEqual(shipped, hue, `${token} was not muted at all`);
    rows.push([token, `${hue} → ${shipped}`]);
  }
  report('the games, muted', rows);
});
