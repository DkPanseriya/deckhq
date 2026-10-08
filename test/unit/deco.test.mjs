/**
 * A ROOM IS DRESSED, BY RULE (`plan-deco.js`, `backdrop-props-deco.js`).
 *
 * A furnished room had the right pieces in it and nothing that said anybody
 * worked there. It is dressed now — a bin at its desks, a coat stand at its
 * door, panels on its walls, a lamp over a table, and a second place where one
 * desk was laid in a room with a void in it. This file holds the rules that
 * dressing may not break, asked of the three fixture floors — `demo`,
 * `crowded` and `large` — as real plans:
 *
 *   - nothing that was there moved: every seat, room rectangle and door is
 *     byte for byte what it was before the dressing existed;
 *   - one free-standing prop per `PROP_CLEAR_U2` of clear floor;
 *   - no two of a kind within `SILHOUETTE_SPACING`;
 *   - NOTHING within `CHAR_CLEAR_U` of a seat, inside a door, or on the line
 *     somebody walks from the door to their seat;
 *   - no wall panel within `PANEL_PLATE_CLEAR` of the plate's corner, on
 *     glazing, or on a partition of glass; never more than one per
 *     `PANEL_SHARE` of wall;
 *   - one coat stand per project room at least `COAT_ROOM_MIN_W` wide, and one
 *     bin per desk cluster;
 *   - the look's density sets how much: Calm is the bin and the coat stand.
 *
 * And the painters: every kind is drawn from tokens, quietly, at three levels
 * of detail, and a lamp's pool lands on nobody's desk.
 *
 * IT PRINTS ITS COUNTS, per fixture and per density.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { LARGE_NOW, ownerShapedFloor, populationFloor } from '../helpers/large-floor.mjs';
import { paintRecorder } from '../helpers/paint-recorder.mjs';
import { buildPlan } from '../../public/render/plan.js';
import { resolveAnchors } from '../../public/render/plan-anchors.js';
import {
  DECO_ZONE,
  decorateRoom,
  doorSideOf,
  gapBetween,
  segmentToRect,
  wallOf,
} from '../../public/render/plan-deco.js';
import {
  CHAR_CLEAR_U,
  COAT_ROOM_MIN_W,
  DECO_KINDS,
  DECO_LEVELS,
  DECO_OFF_THE_FLOOR,
  PANEL_PLATE_CLEAR,
  PANEL_SHARE,
  PROP_CLEAR_U2,
  SILHOUETTE_SPACING,
  WALK_CLEAR_U,
  decoLevel,
} from '../../public/render/plan-props.js';
import {
  BIN,
  BOOTH_D,
  BOOTH_W,
  COAT_STAND,
  PENDANT,
  STANDING_TABLE_D,
  STANDING_TABLE_W,
  WALL_PANEL_DEPTH,
  WALL_PANEL_RUN,
} from '../../public/render/plan-furniture.js';
import { doorBoxOf } from '../../public/render/plan-worktrees.js';
import { PROP_HEIGHT, U_DEFAULT, isTallProp } from '../../public/render/backdrop-paint.js';
import { LIT_PROP_KINDS } from '../../public/render/backdrop-floor.js';
import { paintProp } from '../../public/render/backdrop.js';
import { LAMP_POOL_U, paintDecoProps } from '../../public/render/backdrop-props-deco.js';
import { setDeviceScale } from '../../public/render/device-px.js';
import { STATE_COLORS, colourDistance } from '../../public/render/palette.js';
import { THEMES } from '../../public/render/themes.js';
import { DEFAULT_LOOK, SCHEME_IDS, lookForPreset } from '../../public/render/look-options.js';
import { LOOK, applyLook, resetLook, resolveLook } from '../../public/render/look-derive.js';
import {
  FURNITURE_ALERT_STATES,
  FURNITURE_STATE_MIN_DISTANCE,
} from '../../public/render/furniture-tones.js';

/** One table, printed. @param {string} title @param {Array<[string, string]>} rows */
function report(title, rows) {
  const w = rows.reduce((a, [k]) => Math.max(a, k.length), 0);
  console.log(`\n  ${title}`);
  for (const [k, v] of rows) console.log(`    ${k.padEnd(w)}  ${v}`);
}

/** The three fixture floors, and the stage each is laid for. */
const FLOORS = /** @type {const} */ ([
  ['demo', () => populationFloor('demo'), [1600, 870]],
  ['crowded', () => ownerShapedFloor(), [2000, 1055]],
  ['large', () => populationFloor('large'), [2000, 1024]],
]);

/** @param {() => any} floor @param {readonly number[]} stage @param {object} [extra] */
function planOf(floor, stage, extra = {}) {
  const f = floor();
  return buildPlan(f.projects, f.agents, {
    stage: { w: stage[0], h: stage[1] },
    now: LARGE_NOW,
    ...extra,
  });
}

/** FNV-1a over a string, as eight hex digits. @param {string} s */
function hash32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Everything the dressing may not move, as one value. @param {any} plan */
function geometryOf(plan) {
  const seat = (/** @type {any} */ s) => [s.x, s.y, s.angle ?? null, s.capacity ?? null];
  return {
    size: [plan.width, plan.height],
    rooms: plan.rooms.map((/** @type {any} */ r) => [
      r.id,
      r.kind,
      r.x,
      r.y,
      r.w,
      r.h,
      r.door ? [r.door.x, r.door.y] : null,
    ]),
    seats: [...plan.seats].map(([id, list]) => [id, list.map(seat)]),
    office: (plan.officeSeats || []).map(seat),
    chair: plan.officeChair ? seat(plan.officeChair) : null,
    lounge: (plan.loungeSpots || []).map(seat),
    worktree: [...(plan.worktreeSeats || [])].map(([id, s]) => [id, seat(s)]),
    doors: (plan.doors || []).map((/** @type {any} */ d) => [d.x, d.y, d.angle, d.width]),
  };
}

/** Each fixture's plan, dressed and as its furnishing left it. */
const PLANS = FLOORS.map(([name, floor, stage]) => ({
  name,
  plan: planOf(floor, stage),
  bare: planOf(floor, stage, { dress: false }),
}));

/** Every project room of the fixtures, with what the dressing added to it. */
const ROOMS = PLANS.flatMap(({ name, plan, bare }) =>
  plan.rooms
    .filter((/** @type {any} */ r) => r.kind === 'project')
    .map((/** @type {any} */ room) => {
      const before = bare.rooms.find((/** @type {any} */ r) => r.id === room.id);
      const benched = [...plan.worktreeSeats.values()].filter(
        (s) => s.x >= room.x && s.x <= room.x + room.w && s.y >= room.y && s.y <= room.y + room.h,
      );
      return {
        where: `${name}/${room.id}`,
        name,
        plan,
        room,
        before,
        added: room.props.slice(before.props.length),
        people: [...(plan.seats.get(room.id) || []), ...benched],
      };
    }),
);

const interiorOf = (/** @type {any} */ room) => ({
  x: room.x,
  y: room.y + (room.plateBand ?? 0),
  w: room.w,
  h: room.h - (room.plateBand ?? 0),
});
const count = (/** @type {any[]} */ props, /** @type {string} */ kind) =>
  props.filter((p) => p.kind === kind).length;

test.afterEach(() => resetLook());

// ------------------------------------------------------- nothing was moved

test('INVARIANT: the dressing moves no seat, no room and no door — the three floors, hashed before it existed', () => {
  // Taken at 485ff27, the commit before a room was dressed: every seat (desk,
  // bench, reception and lounge), every room's rectangle and its door, and
  // every door the plan draws, as written by `JSON.stringify` — so a seat that
  // moved by one bit is a different hash.
  const before = { demo: '4fb9bfc9', crowded: '758119df', large: 'ede02d96' };
  /** @type {Array<[string, string]>} */
  const rows = [];
  for (const { name, plan, bare } of PLANS) {
    const geometry = geometryOf(plan);
    const got = hash32(JSON.stringify(geometry));
    assert.equal(
      got,
      before[name],
      `${name}: a seat, a room rectangle or a door is not where it was before the dressing`,
    );
    // And against the same floor furnished and not dressed, value for value.
    assert.deepEqual(geometry, geometryOf(bare), `${name}: dressing a floor moved it`);
    const seats =
      geometry.seats.reduce((a, [, list]) => a + list.length, 0) +
      geometry.office.length +
      geometry.lounge.length +
      geometry.worktree.length;
    rows.push([name, `${got} · ${seats} seats · ${geometry.rooms.length} rooms`]);
  }
  for (const r of ROOMS) {
    // What the furnishing laid is where it laid it, to the bit, and in the
    // same order: the dressing only appends.
    assert.deepEqual(
      r.room.props.slice(0, r.before.props.length).map((p) => [p.kind, p.x, p.y, p.w, p.h]),
      r.before.props.map((/** @type {any} */ p) => [p.kind, p.x, p.y, p.w, p.h]),
      `${r.where}: the dressing moved something that was there`,
    );
    // Its zones too; a second place is a zone of its own, named for the dressing.
    assert.deepEqual(
      r.room.zones.slice(0, r.before.zones.length),
      r.before.zones,
      `${r.where}: the dressing changed a zone`,
    );
    for (const z of r.room.zones.slice(r.before.zones.length)) {
      assert.match(z.id, new RegExp(`^${DECO_ZONE}-[a-z]+-[0-9]+$`), `${r.where}: zone ${z.id}`);
    }
  }
  report('seats, rooms and doors, hashed', rows);
});

test('the same floor is dressed the same way twice, and every piece is where its anchor says', () => {
  const [name, floor, stage] = FLOORS[1];
  const again = planOf(floor, stage);
  const shape = (/** @type {any} */ plan) =>
    plan.rooms.map((/** @type {any} */ r) => r.props.map((p) => [p.kind, p.x, p.y, p.w, p.h]));
  assert.deepEqual(shape(again), shape(PLANS[1].plan), `${name} was dressed differently twice`);
  let checked = 0;
  for (const r of ROOMS) {
    const was = r.added.map((p) => [p.x, p.y]);
    resolveAnchors(r.room);
    r.added.forEach((p, i) => {
      checked++;
      assert.ok(
        Math.abs(p.x - was[i][0]) < 1e-9 && Math.abs(p.y - was[i][1]) < 1e-9,
        `${r.where}/${p.kind} is not where its own anchor says`,
      );
    });
  }
  assert.ok(checked > 150, `only ${checked} pieces were checked`);
});

// ----------------------------------------------------------- the four rules

test('one free-standing prop per 9 U² of clear floor, with the dressing counted', () => {
  // `props.test.mjs` states the rule and its three exemptions; the two kinds
  // the dressing hangs — a panel on a wall, a lamp from a ceiling — join them.
  const off = new Set([
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
    ...DECO_OFF_THE_FLOOR,
  ]);
  let tightest = Infinity;
  for (const r of ROOMS) {
    const at = interiorOf(r.room);
    const standing = r.room.props.filter((/** @type {any} */ p) => !off.has(p.kind));
    const taken = standing.reduce(
      (/** @type {number} */ a, /** @type {any} */ p) => a + p.w * p.h,
      0,
    );
    const allowed = Math.floor(Math.max(0, at.w * at.h - taken) / PROP_CLEAR_U2);
    assert.ok(
      standing.length <= allowed,
      `${r.where}: ${standing.length} free-standing props, and its clear floor allows ${allowed}`,
    );
    tightest = Math.min(tightest, allowed - standing.length);
  }
  console.log(`\n    ${ROOMS.length} rooms, the tightest ${tightest} props under its ceiling`);
});

test('no two of a kind within 8 U: bins, stands, panels, lamps, booths, high tables', () => {
  const kinds = [...DECO_KINDS, 'board_stand'];
  let pairs = 0;
  let nearest = Infinity;
  for (const r of ROOMS) {
    for (const kind of kinds) {
      const same = r.room.props.filter((/** @type {any} */ p) => p.kind === kind);
      for (let i = 0; i < same.length; i++) {
        for (let j = i + 1; j < same.length; j++) {
          // Two of them the dressing did not lay are another package's rule.
          if (!r.added.includes(same[i]) && !r.added.includes(same[j])) continue;
          const d = gapBetween(same[i], same[j]);
          pairs++;
          nearest = Math.min(nearest, d);
          assert.ok(
            d >= SILHOUETTE_SPACING - 1e-6,
            `${r.where}: two ${kind} are ${d.toFixed(2)} U apart`,
          );
        }
      }
    }
  }
  assert.ok(pairs >= 20, `only ${pairs} same-kind pairs were measured`);
  console.log(`\n    ${pairs} same-kind pairs, the nearest ${nearest.toFixed(2)} U apart`);
});

test('NOTHING within 1.2 U of a seat, inside a door, or on the way from the door to a seat', () => {
  let checked = 0;
  let nearestSeat = Infinity;
  let nearestPath = Infinity;
  for (const r of ROOMS) {
    const at = interiorOf(r.room);
    const doorBox = doorBoxOf(r.room);
    assert.ok(r.room.door && doorBox, `${r.where} has no door`);
    // Every place in this room the floor can draw somebody seated.
    const feet = r.people.map((s) => ({ x: s.x - 0.5, y: s.y - 0.5, w: 1, h: 1 }));
    for (const p of r.added) {
      checked++;
      const what = `${r.where}/${p.kind}`;
      assert.ok(
        p.x >= at.x - 1e-6 &&
          p.y >= at.y - 1e-6 &&
          p.x + p.w <= at.x + at.w + 1e-6 &&
          p.y + p.h <= at.y + at.h + 1e-6,
        `${what} is through a wall or in the plate band`,
      );
      for (const foot of feet) {
        const d = gapBetween(p, foot);
        nearestSeat = Math.min(nearestSeat, d);
        assert.ok(d >= CHAR_CLEAR_U - 1e-6, `${what} is ${d.toFixed(2)} U from somebody's feet`);
      }
      // The floor a door swings over, and the floor inside it.
      const inDoor =
        p.x < doorBox.x + doorBox.w &&
        p.x + p.w > doorBox.x &&
        p.y < doorBox.y + doorBox.h &&
        p.y + p.h > doorBox.y;
      assert.equal(inDoor, false, `${what} stands inside the door`);
      // A panel is on a wall and a pendant over a table: nobody walks through
      // either. Everything else keeps off the line to every seat.
      if (DECO_OFF_THE_FLOOR.includes(p.kind)) continue;
      for (const seat of r.people) {
        const d = segmentToRect(r.room.door, seat, p);
        nearestPath = Math.min(nearestPath, d);
        assert.ok(
          d >= WALK_CLEAR_U - 1e-6,
          `${what} is ${d.toFixed(2)} U from the way to the seat at ${seat.x.toFixed(1)}, ${seat.y.toFixed(1)}`,
        );
      }
    }
  }
  // And the other rooms' people: nothing was laid in the reception or the lounge.
  for (const { name, plan, bare } of PLANS) {
    for (const room of plan.rooms.filter((/** @type {any} */ q) => q.kind !== 'project')) {
      const was = bare.rooms.find((/** @type {any} */ q) => q.id === room.id);
      assert.equal(room.props.length, was.props.length, `${name}/${room.id} was dressed`);
    }
  }
  assert.ok(checked > 150, `only ${checked} pieces were checked`);
  console.log(
    `\n    ${checked} pieces: the nearest to a seat ${nearestSeat.toFixed(2)} U (≥ ${CHAR_CLEAR_U}), ` +
      `to a walked line ${nearestPath.toFixed(2)} U (≥ ${WALK_CLEAR_U})`,
  );
});

// --------------------------------------------------------------- the pieces

test('no wall panel within 6 U of a plate, on glazing, or more than one per 8 U of wall', () => {
  let panels = 0;
  for (const r of ROOMS) {
    const at = interiorOf(r.room);
    const hung = r.added.filter((p) => p.kind === 'wall_panel');
    for (const p of hung) {
      panels++;
      const side = p.anchor.side;
      assert.ok(['W', 'E', 'S'].includes(side), `${r.where}: a panel under the plate`);
      // Flush to its wall, and as deep as a panel is.
      const off =
        side === 'W'
          ? p.x - at.x
          : side === 'E'
            ? at.x + at.w - p.x - p.w
            : at.y + at.h - p.y - p.h;
      assert.ok(off >= 0 && off <= 0.31, `${r.where}: a panel ${off.toFixed(2)} U off its wall`);
      assert.ok(Math.abs(Math.min(p.w, p.h) - WALL_PANEL_DEPTH) < 1e-9);
      const d = gapBetween(p, { x: r.room.x, y: r.room.y, w: 0, h: 0 });
      assert.ok(
        d >= PANEL_PLATE_CLEAR - 1e-6,
        `${r.where}: a panel ${d.toFixed(1)} U from its plate`,
      );
      const wall = wallOf(r.room, side, r.plan.walls, 'solid');
      assert.equal(
        wall.hangs,
        true,
        `${r.where}: a panel on a ${wall.kind} wall it cannot hang on`,
      );
      // Never on the glazing: the building's top and left walls are windows.
      if (wall.kind === 'exterior') {
        assert.ok(side === 'S' ? r.room.y + r.room.h > 1 : r.room.x + r.room.w > 1);
        assert.notEqual(side === 'W' && r.room.x < 0.02, true, `${r.where}: a panel on a window`);
      }
      assert.equal(p.mk, r.room.projectMk, 'a panel knows whose room it hangs in');
    }
    for (const side of ['W', 'E', 'S']) {
      const on = hung.filter((p) => p.anchor.side === side);
      const length = side === 'S' ? at.w : at.h;
      assert.ok(
        on.length <= Math.ceil(length / PANEL_SHARE),
        `${r.where}: ${on.length} panels on ${length.toFixed(0)} U of its ${side} wall`,
      );
    }
    assert.ok(hung.length <= DECO_LEVELS.normal.panels, `${r.where}: ${hung.length} panels`);
  }
  assert.ok(panels >= 20, `only ${panels} panels on three floors`);
});

test('no wall panel hangs on a glass partition, or on a low one', () => {
  // Glass between rooms, and a waist-high run between rooms: neither is a wall.
  for (const preset of ['daylight-studio', 'nordic-wool']) {
    applyLook(lookForPreset(preset), 'default');
    assert.notEqual(LOOK.partitions.id, 'solid');
    let panels = 0;
    for (const [name, floor, stage] of FLOORS) {
      const plan = planOf(floor, stage);
      for (const room of plan.rooms.filter((/** @type {any} */ r) => r.kind === 'project')) {
        for (const p of room.props.filter((/** @type {any} */ q) => q.kind === 'wall_panel')) {
          panels++;
          const wall = wallOf(room, p.anchor.side, plan.walls, LOOK.partitions.id);
          assert.notEqual(wall.kind, 'partition', `${preset} ${name}/${room.id}: a panel on glass`);
          assert.equal(wall.hangs, true);
        }
      }
    }
    console.log(`    ${preset} (${LOOK.partitions.id} partitions): ${panels} panels, none on one`);
    resetLook();
  }
  // What a wall is, said once: a partition carries a panel only where it is solid.
  const room = { x: 10, y: 10, w: 20, h: 20 };
  const walls = [
    { x1: 10, y1: 10, x2: 10, y2: 30, kind: 'partition' },
    { x1: 30, y1: 10, x2: 30, y2: 30, kind: 'solid' },
  ];
  assert.deepEqual(wallOf(room, 'W', walls, 'solid'), { kind: 'partition', hangs: true });
  assert.deepEqual(wallOf(room, 'W', walls, 'glass'), { kind: 'partition', hangs: false });
  assert.deepEqual(wallOf(room, 'W', walls, 'low'), { kind: 'partition', hangs: false });
  assert.deepEqual(wallOf(room, 'E', walls, 'glass'), { kind: 'solid', hangs: true });
  const edge = { x: 0, y: 5, w: 20, h: 20 };
  const outer = [{ x1: 0, y1: 5, x2: 0, y2: 25, kind: 'exterior' }];
  assert.deepEqual(wallOf(edge, 'W', outer, 'solid'), { kind: 'exterior', hangs: false });
});

test('one coat stand per project room at least 16 U wide, beside its door and off the wall', () => {
  let stands = 0;
  let narrow = 0;
  let farthest = 0;
  for (const r of ROOMS) {
    const at = interiorOf(r.room);
    const n = count(r.room.props, 'coat_stand');
    if (r.room.w < COAT_ROOM_MIN_W) {
      narrow++;
      assert.equal(n, 0, `${r.where} is ${r.room.w.toFixed(1)} U wide and has a coat stand`);
      continue;
    }
    assert.equal(n, 1, `${r.where} is ${r.room.w.toFixed(1)} U wide and has ${n} coat stands`);
    stands++;
    const stand = r.room.props.find((/** @type {any} */ p) => p.kind === 'coat_stand');
    const side = doorSideOf(r.room);
    assert.equal(stand.anchor.side, side, `${r.where}: its stand is not on the door's wall`);
    const door = r.room.door;
    const along =
      side === 'S' || side === 'N'
        ? stand.x + stand.w / 2 - door.x
        : stand.y + stand.h / 2 - door.y;
    // Beside the door, or a few steps along the wall where a plant has that floor.
    farthest = Math.max(farthest, Math.abs(along));
    assert.ok(
      Math.abs(along) <= 9.4,
      `${r.where}: its stand is ${Math.abs(along).toFixed(1)} U from the door`,
    );
    const off =
      side === 'S'
        ? at.y + at.h - stand.y - stand.h
        : side === 'N'
          ? stand.y - at.y
          : side === 'W'
            ? stand.x - at.x
            : at.x + at.w - stand.x - stand.w;
    assert.ok(
      Math.abs(off - 1) < 1e-6,
      `${r.where}: its stand is ${off.toFixed(2)} U off the wall`,
    );
  }
  assert.ok(stands >= 25, `only ${stands} rooms wide enough for a stand`);
  console.log(
    `\n    ${stands} coat stands in ${stands} rooms of 16 U or more, the farthest ` +
      `${farthest.toFixed(1)} U along from its door; ${narrow} narrower, none`,
  );
});

test('one bin per desk cluster: at the desks’ light-away end, and at each worktree bench', () => {
  let bins = 0;
  for (const r of ROOMS) {
    const group = r.room.zones.find((/** @type {any} */ z) => z.id === 'desk-group');
    assert.ok(group, `${r.where} has no desks`);
    const mine = r.room.props.filter(
      (/** @type {any} */ p) => p.kind === 'bin' && p.anchor.of === 'desk-group',
    );
    assert.equal(mine.length, 1, `${r.where}: ${mine.length} bins at its desks`);
    bins++;
    const [bin] = mine;
    // Half a unit off the cluster, on its light-away side where that is clear.
    const off = Math.max(bin.x - (group.x + group.w), group.x - (bin.x + bin.w));
    assert.ok(
      Math.abs(off - 0.5) < 1e-6,
      `${r.where}: its bin is ${off.toFixed(2)} U off the desks`,
    );
    assert.ok(Math.abs(bin.w - BIN) < 1e-9 && Math.abs(bin.h - BIN) < 1e-9);
    const benches = r.room.zones.filter((/** @type {any} */ z) => /^worktree-\d+$/.test(z.id));
    assert.equal(count(r.room.props, 'bin'), 1 + benches.length, `${r.where}: bins and benches`);
  }
  // A worktree's bench is a cluster of its own.
  const at = (/** @type {string} */ id, /** @type {string|null} */ wt) => ({
    id,
    projectId: 'career-ops',
    worktree: wt ? { name: wt, path: `/w/career-ops/.claude/worktrees/${wt}`, branch: null } : null,
    activityState: 'working',
    ackState: 'active',
    reviewSince: null,
    lastActivityAt: LARGE_NOW - 60_000,
  });
  const agents = [at('a', null), at('b0', 'w1'), at('b1', 'w1'), at('b2', 'w2')];
  const projects = [
    { id: 'career-ops', name: 'career-ops', sessionCount: 4, activeCount: 4, tokens: 1 },
  ];
  const plan = buildPlan(projects, agents, { stage: { w: 1600, h: 870 }, now: LARGE_NOW });
  const room = plan.rooms.find((/** @type {any} */ q) => q.kind === 'project');
  const benches = room.zones.filter((/** @type {any} */ z) => /^worktree-\d+$/.test(z.id));
  assert.equal(benches.length, 2);
  for (const bench of benches) {
    assert.equal(
      room.props.filter((/** @type {any} */ p) => p.kind === 'bin' && p.anchor.of === bench.id)
        .length,
      1,
      `the bench ${bench.id} has no bin of its own`,
    );
  }
  assert.ok(bins >= 30, `only ${bins} desk clusters`);
  console.log(
    `\n    ${bins} desk clusters, one bin each; and one at each of ${benches.length} benches`,
  );
});

// --------------------------------------------------------------- how much

test('the density sets how much: Calm is a bin and a coat stand, Lively more than Normal', () => {
  /** @type {Record<string, Record<string, Record<string, number>>>} */
  const counts = {};
  for (const density of ['quiet', 'normal', 'busy']) {
    applyLook({ ...DEFAULT_LOOK, props: { density } }, 'default');
    assert.equal(decoLevel(), DECO_LEVELS[density]);
    counts[density] = {};
    for (const [name, floor, stage] of FLOORS) {
      const dressed = planOf(floor, stage);
      const bare = planOf(floor, stage, { dress: false });
      /** @type {Record<string, number>} */
      const kinds = {};
      for (const room of dressed.rooms) {
        const was = bare.rooms.find((/** @type {any} */ q) => q.id === room.id);
        for (const p of room.props.slice(was.props.length)) {
          kinds[p.kind] = (kinds[p.kind] || 0) + 1;
        }
      }
      counts[density][name] = kinds;
      // Whatever the density, the building is the building.
      assert.deepEqual(geometryOf(dressed), geometryOf(bare), `${density} ${name} moved`);
    }
    resetLook();
  }
  const total = (/** @type {Record<string, number>} */ kinds) =>
    Object.values(kinds).reduce((a, n) => a + n, 0);
  /** @type {Array<[string, string]>} */
  const rows = [];
  for (const [name] of FLOORS) {
    const quiet = counts.quiet[name];
    const normal = counts.normal[name];
    const busy = counts.busy[name];
    // Calm: the two things a room is owed, and nothing else at all.
    assert.deepEqual(Object.keys(quiet).sort(), ['bin', 'coat_stand'], `${name}, calm`);
    assert.equal(quiet.bin, normal.bin, 'a bin is not decoration');
    assert.equal(quiet.coat_stand, normal.coat_stand, 'nor is a coat stand');
    assert.ok(total(normal) > total(quiet) * 2, `${name}: Normal is hardly more than Calm`);
    assert.ok(total(busy) > total(normal), `${name}: Lively is no more than Normal`);
    assert.ok(normal.wall_panel > 0, `${name}: no panels at Normal`);
    assert.ok((normal.lamp || 0) + (normal.pendant || 0) > 0, `${name}: no lamps at Normal`);
    for (const density of ['quiet', 'normal', 'busy']) {
      const kinds = counts[density][name];
      rows.push([
        `${name} · ${density}`,
        `${total(kinds)} — ` +
          Object.entries(kinds)
            .sort()
            .map(([k, n]) => `${k} ${n}`)
            .join(', '),
      ]);
    }
  }
  report('what the dressing adds, by floor and density', rows);
});

test('a second place is laid in a void, by module, and never on a crew or behind the desks', () => {
  let places = 0;
  /** @type {Record<string, number>} */
  const kinds = { standing_table: 0, booth: 0, lamp: 0, board_stand: 0 };
  for (const r of ROOMS) {
    const module = r.room.kit || r.room.module;
    const mine = r.added.filter((p) => p.kind in kinds);
    assert.ok(
      mine.length <= DECO_LEVELS.normal.zones[module],
      `${r.where} (${module}): ${mine.length} second places`,
    );
    for (const p of mine) {
      places++;
      kinds[p.kind]++;
      // Clear of everything that was there: a lane's worth, less a part's inset.
      for (const other of r.before.props) {
        if (/^rug/.test(other.kind) && gapBetween(p, other) > 0) continue;
        assert.ok(
          gapBetween(p, other) >= 1.5,
          `${r.where}: a ${p.kind} is ${gapBetween(p, other).toFixed(2)} U from a ${other.kind}`,
        );
      }
    }
  }
  assert.ok(places >= 40, `only ${places} second places on three floors`);
  assert.ok(
    Object.values(kinds).every((n) => n >= 4),
    JSON.stringify(kinds),
  );
  report(
    'second places on the three floors',
    Object.entries(kinds).map(([k, n]) => [k, String(n)]),
  );
  // A room with nothing in it but a wall of desks is given nothing to stand a
  // place in: the rule is the void, not the count.
  const room = {
    kind: 'project',
    id: 'tight',
    x: 0,
    y: 0,
    w: 9,
    h: 12,
    plateBand: 3.4,
    module: 'S',
    door: { x: 4.5, y: 12 },
    zones: [{ id: 'desk-group', x: 1, y: 4.4, w: 6.9, h: 6.9 }],
    props: [],
  };
  const laid = decorateRoom(/** @type {any} */ (room), [{ x: 4.5, y: 5.4 }], { walls: [] });
  assert.deepEqual(laid.places, []);
  assert.equal(count(laid.added, 'coat_stand'), 0, 'a room nine units wide has no coat stand');
  // And a pinned room, which keeps a room and no desks, is not dressed at all.
  assert.deepEqual(decorateRoom(/** @type {any} */ ({ ...room, pinned: true })).added, []);
});

// ------------------------------------------------------------- the painters

/** One of each kind the dressing adds, at the size the plan lays it. */
const PIECES = /** @type {const} */ ([
  ['bin', BIN, BIN, {}],
  ['coat_stand', COAT_STAND, COAT_STAND, {}],
  ['wall_panel', WALL_PANEL_DEPTH, WALL_PANEL_RUN, { anchor: { type: 'wall', side: 'W' } }],
  [
    'wall_panel',
    WALL_PANEL_RUN,
    WALL_PANEL_DEPTH,
    { anchor: { type: 'wall', side: 'S' }, split: 2 },
  ],
  ['pendant', PENDANT, PENDANT, {}],
  ['standing_table', STANDING_TABLE_W, STANDING_TABLE_D, {}],
  ['booth', BOOTH_D, BOOTH_W, { angle: 0 }],
]);

/** @param {any} prop @param {number} ppu */
function paintAt(prop, ppu) {
  const ctx = paintRecorder();
  setDeviceScale(ctx, ppu / U_DEFAULT);
  paintProp(ctx, { x: 4, y: 6, angle: 0, id: `deco-${prop.kind}`, anchor: {}, ...prop }, U_DEFAULT);
  return ctx;
}

test('every kind the dressing lays has a height, a painter and three levels of detail', () => {
  assert.equal(PROP_HEIGHT.coat_stand, 'tall');
  assert.equal(PROP_HEIGHT.wall_panel, 'tall');
  assert.equal(PROP_HEIGHT.standing_table, 'tall');
  assert.equal(PROP_HEIGHT.booth, 'tall');
  assert.equal(PROP_HEIGHT.bin, 'short');
  assert.equal(PROP_HEIGHT.pendant, 'short');
  for (const kind of DECO_KINDS) assert.ok(PROP_HEIGHT[kind], `${kind} declares no height`);
  /** @type {Array<[string, string]>} */
  const rows = [];
  for (const [kind, w, h, extra] of PIECES) {
    const [low, mid, full] = [8, 14, 32].map((ppu) => paintAt({ kind, w, h, ...extra }, ppu));
    assert.ok(low.paints.length > 0, `${kind} paints nothing at 8 px to the unit`);
    // Level 0 is a silhouette: a handful of path operations, and never more
    // than the fuller levels spend. (The booth's painter is the furniture
    // redraw's, and its level 0 is held by `furniture.test.mjs`.)
    if (kind !== 'booth') {
      assert.ok(low.pathOps() <= 30, `${kind}: ${low.pathOps()} path operations at 8 px`);
    }
    assert.ok(low.pathOps() <= mid.pathOps() && mid.pathOps() <= full.pathOps(), kind);
    assert.ok(full.pathOps() > low.pathOps(), `${kind} has one level of detail`);
    rows.push([`${kind} ${w}×${h}`, `${low.pathOps()} · ${mid.pathOps()} · ${full.pathOps()}`]);
    // It meets the floor through `grounded` and nothing else: a tall piece
    // casts down and to the right, a short one presses straight down.
    for (const p of full.paints.filter((/** @type {any} */ q) => q.shadowBlur > 0)) {
      assert.ok(p.shadowOffsetX >= 0 && p.shadowOffsetY >= 0, `${kind} casts up or left`);
      if (!isTallProp({ kind })) {
        assert.equal(p.shadowOffsetX + p.shadowOffsetY, 0, `${kind} is short and casts`);
      }
    }
  }
  // A pendant hangs: it has no contact with a floor it does not touch.
  const pendant = paintAt({ kind: 'pendant', w: PENDANT, h: PENDANT }, 32);
  assert.equal(pendant.paints.filter((/** @type {any} */ p) => p.shadowBlur > 0).length, 0);
  // An unknown kind is not this painter's to answer for.
  assert.equal(
    paintDecoProps(paintRecorder(), { kind: 'desk' }, 14, 28, 28, () => {}),
    false,
  );
  report('path operations at 8 · 14 · 32 px to the unit', rows);
});

test('a panel is in its room’s colour where rooms have one, and a room’s colour asks for nobody', () => {
  const panel = { kind: 'wall_panel', w: 3.2, h: 0.7, mk: 2, anchor: { type: 'wall', side: 'S' } };
  const plain = new Set(paintAt(panel, 32).paints.map((/** @type {any} */ p) => p.style));
  applyLook(lookForPreset('colour-plan'), 'default');
  const accent = LOOK.roomTint.accents[1];
  const zoned = new Set(paintAt(panel, 32).paints.map((/** @type {any} */ p) => p.style));
  assert.ok(zoned.has(accent), 'a panel in a zoned room is not in the room’s accent');
  assert.equal(plain.has(accent), false, 'a panel in a subtle room is in a colour of its own');
  resetLook();
  // The six accents, on every theme and scheme: none near a colour that asks
  // for the user — the same bar every furniture fill is held to.
  let nearest = Infinity;
  for (const theme of THEMES) {
    for (const scheme of SCHEME_IDS) {
      const resolved = resolveLook({ ...DEFAULT_LOOK, scheme, roomTint: 'zoned' }, theme);
      for (const colour of resolved.roomTint.accents) {
        for (const state of FURNITURE_ALERT_STATES) {
          const d = colourDistance(colour, /** @type {any} */ (STATE_COLORS)[state]);
          nearest = Math.min(nearest, d);
          assert.ok(
            d >= FURNITURE_STATE_MIN_DISTANCE,
            `${theme.name}/${scheme}: the accent ${colour} is ${d.toFixed(0)} from ${state}`,
          );
        }
      }
    }
  }
  console.log(
    `\n    the nearest a room's accent comes to an alert colour: ${nearest.toFixed(0)} RGB`,
  );
});

test('a lamp lays a pool on the floor, and never on a desk that has its own', () => {
  assert.deepEqual(Object.keys(LAMP_POOL_U).sort(), ['lamp', 'pendant']);
  for (const kind of Object.keys(LAMP_POOL_U)) {
    assert.equal(LIT_PROP_KINDS.includes(kind), false, `${kind} is lit as a desk is`);
  }
  let lamps = 0;
  for (const r of ROOMS) {
    const desks = r.room.props.filter((/** @type {any} */ p) => LIT_PROP_KINDS.includes(p.kind));
    for (const lamp of r.added.filter((p) => p.kind in LAMP_POOL_U)) {
      lamps++;
      const reach = /** @type {Record<string, number>} */ (LAMP_POOL_U)[lamp.kind];
      const centre = { x: lamp.x + lamp.w / 2, y: lamp.y + lamp.h / 2, w: 0, h: 0 };
      for (const desk of desks) {
        assert.ok(
          gapBetween(centre, desk) >= reach,
          `${r.where}: a ${lamp.kind}'s pool reaches a desk ${gapBetween(centre, desk).toFixed(1)} U away`,
        );
      }
    }
  }
  assert.ok(lamps >= 20, `only ${lamps} lamps on three floors`);
});
