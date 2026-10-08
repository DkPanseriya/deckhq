/**
 * A QUIET FLOOR IS LAID ROUND ITS ROOMS (`public/render/plan-quiet.js`,
 * `plan-proportions.js` (j)).
 *
 * One or two projects: the reception over the lounge is a strip down the left
 * of the building, the spine is beside it, and the rooms are the rest. A lone
 * room is laid a module up so that it is the majority of its floor; what the
 * rooms and the strip cannot take is a hall along the spine, and it is
 * measured. And on a floor of one to three rooms the reception's sofa runs
 * and the lounge's bays come back one at a time as people arrive.
 *
 * Held at the two windows the pictures are taken on, and — for the floors this
 * may not touch — at all four, rectangle for rectangle.
 */

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { buildPlan } from '../../public/render/plan.js';
import { bareFloorShare } from '../../public/render/plan-interior.js';
import {
  OFFICE_COMPACT_MAX,
  OFFICE_TWO_RUNS_MAX,
  buildOffice,
  buildOfficeRow,
  officeRunsFor,
} from '../../public/render/plan-office.js';
import {
  HALL_AREA_MAX,
  MODULE_AREA_MAX,
  MODULE_WEIGHTS,
  QUIET_PX_PER_UNIT,
  QUIET_ROOMS_MAX,
  ROOMS_AREA_MIN,
  ROOM_FURNISHED_MIN,
  ROOM_RATIO_MAX,
  ROOM_RATIO_MIN,
  SERVICE_STRIP_MAX,
  loneModules,
  roomsHold,
} from '../../public/render/plan-proportions.js';
import { resetAgentScale } from '../../public/render/plan-scale.js';
import {
  LOUNGE_BAY_STEPS,
  LOUNGE_QUIET_MAX,
  buildLounge,
  loungeBaysFor,
} from '../../public/render/plan-service.js';
import { CORRIDOR } from '../../public/render/plan-units.js';
import { BODY_HEIGHT_U, RIG_UNIT_U } from '../../public/render/rig-metrics.js';
import { computeFill } from '../../public/render/scene-camera.js';
import { LARGE_NOW, populationFloor } from '../helpers/large-floor.mjs';

const EPS = 1e-6;
const CHROME_H = 130;
/** The two windows the pictures are taken on, and the two others. */
const SHOWN = [
  [1600, 1000],
  [1920, 1080],
];
const WINDOWS = [...SHOWN, [2000, 1185], [1366, 768]];
/** A person at a desk, crown to floor, in units: the figure less a desk seat's drop. */
const SEATED_U = BODY_HEIGHT_U - 0.1 * RIG_UNIT_U;

/** @param {string} name @param {number[]} win */
function planAt(name, [winW, winH]) {
  const floor = populationFloor(name);
  const stage = { w: winW, h: winH - CHROME_H };
  const plan = buildPlan(floor.projects, floor.agents, { stage, now: LARGE_NOW });
  const fill = computeFill(plan.width, plan.height, stage.w, stage.h);
  return { plan, fill, seatedPx: SEATED_U * fill.scale };
}
const kind = (/** @type {any} */ plan, /** @type {string} */ k) =>
  plan.rooms.filter((/** @type {any} */ r) => r.kind === k);
const one = (/** @type {any} */ plan, /** @type {string} */ k) => kind(plan, k)[0];
const spineOf = (/** @type {any} */ plan) =>
  plan.rooms.find((/** @type {any} */ r) => r.id === '__spine__');
const near = (/** @type {number} */ a, /** @type {number} */ b) => Math.abs(a - b) < 0.01;
/** Every project room, the reception and the lounge of a plan, as eight hex digits. */
const rectHash = (/** @type {any} */ plan) =>
  createHash('sha1')
    .update(
      plan.rooms
        .filter((/** @type {any} */ r) => ['project', 'office', 'lounge'].includes(r.kind))
        .map((/** @type {any} */ r) =>
          [r.id, r.x.toFixed(3), r.y.toFixed(3), r.w.toFixed(3), r.h.toFixed(3)].join(','),
        )
        .join(';'),
    )
    .digest('hex')
    .slice(0, 8);

test('the rulebook of a quiet floor: three rooms, a strip of 35%, a hall of a tenth, 46 px seated', () => {
  resetAgentScale();
  assert.equal(QUIET_ROOMS_MAX, 3);
  assert.equal(SERVICE_STRIP_MAX, 0.35);
  assert.equal(HALL_AREA_MAX, 0.1);
  // The scale it is laid for is a seated figure forty-six pixels tall, to the pixel.
  const px = SEATED_U * QUIET_PX_PER_UNIT;
  assert.ok(px >= 46 && px < 46.5, `${px.toFixed(2)} px`);
  // A lone room: its own module, the next, the largest. Never with a crew in it.
  assert.deepEqual(loneModules('S'), ['S', 'M', 'L']);
  assert.deepEqual(loneModules('M'), ['M', 'L']);
  assert.deepEqual(loneModules('L'), ['L']);
  assert.deepEqual(loneModules(undefined), ['S', 'M', 'L']);
  assert.deepEqual(loneModules('M', true), ['M']);
  // The rooms have what is theirs: the majority, four fifths of their
  // ceilings, or — with three rooms or fewer — strips beside them.
  const m = (/** @type {object} */ over) => ({
    rooms: 2,
    ceilingReach: 0.6,
    shares: { rooms: 0.49, office: 0.17, lounge: 0.17, halls: 0.1, ...over },
  });
  assert.equal(roomsHold(m({})), true);
  assert.equal(roomsHold(m({ office: 0.2 })), false, 'a strip of 37%');
  assert.equal(roomsHold(m({ halls: 0.16 })), false, 'a hall of 16%');
  assert.equal(roomsHold({ ...m({}), rooms: 4 }), false, 'four rooms are not a quiet floor');
  assert.equal(roomsHold({ ...m({ halls: 0.3 }), ceilingReach: 0.8 }), true);
});

test('one project: the strip down the left, the spine, and a room that is the majority', () => {
  for (const win of SHOWN) {
    const { plan, seatedPx } = planAt('single', win);
    const where = `single at ${win[0]}x${win[1]}`;
    const office = one(plan, 'office');
    const lounge = one(plan, 'lounge');
    const spine = spineOf(plan);
    const [room] = kind(plan, 'project');
    assert.equal(plan.arrangement, 'column', where);
    assert.deepEqual(plan.proportions.faults, [], where);
    // The reception over the lounge, one width, from the building line.
    assert.ok(office.x === 0 && office.y === 0 && lounge.x === 0, where);
    assert.ok(near(office.w, lounge.w) && near(lounge.y, office.h), where);
    assert.ok(near(office.h + lounge.h, plan.height), `${where}: the strip is not the height`);
    // The spine beside them, top to bottom, and the room from it to the wall.
    assert.ok(near(spine.x, office.w) && near(spine.h, plan.height), where);
    assert.ok(near(room.x, spine.x + spine.w) && near(room.x + room.w, plan.width), where);
    assert.ok(room.y === 0 && near(room.h, plan.height), where);
    // Its door is on the spine, in its west wall.
    assert.ok(near(room.door.x, room.x), `${where}: the door is not on the spine`);
    // The majority; no hall; a strip; and nobody lost in it.
    const { shares } = plan.proportions;
    assert.ok(
      shares.rooms >= ROOMS_AREA_MIN - EPS,
      `${where}: ${(shares.rooms * 100).toFixed(1)}%`,
    );
    assert.ok(shares.halls <= EPS, `${where}: a hall of ${(shares.halls * 100).toFixed(1)}%`);
    assert.ok(shares.office + shares.lounge <= SERVICE_STRIP_MAX + EPS, where);
    assert.ok(seatedPx >= 46, `${where}: seated ${seatedPx.toFixed(1)} px`);
    // It is one desk's room still, laid and furnished as a large one's, under
    // that module's ceiling, and it is a room: not bare, and not a showroom.
    assert.equal(room.module, 'S', where);
    assert.equal(room.kit, 'L', where);
    assert.ok(room.w * room.h <= MODULE_AREA_MAX.L + 1e-3, where);
    assert.ok(room.w * room.h > MODULE_AREA_MAX.M, `${where}: a module up would have done`);
    const ratio = room.w / room.h;
    assert.ok(ratio >= ROOM_RATIO_MIN - EPS && ratio <= ROOM_RATIO_MAX + EPS, where);
    assert.ok(bareFloorShare(room) <= 0.45 + 1e-9, `${where}: bare`);
    const count = (/** @type {string} */ k) =>
      room.props.filter((/** @type {any} */ p) => p.kind === k).length;
    assert.ok(count('meeting_table') === 1 && count('sofa') <= 1, `${where}: a showroom`);
  }
  resetAgentScale();
});

test('two projects: the same strip, and the rooms one over the other on the spine', () => {
  /** Rooms' share and hall, at the least each window gives: [rooms, hall]. */
  const held = { 1600: [0.48, 0.115], 1920: [0.44, 0.165] };
  for (const win of SHOWN) {
    const { plan, seatedPx } = planAt('pair', win);
    const where = `pair at ${win[0]}x${win[1]}`;
    const office = one(plan, 'office');
    const lounge = one(plan, 'lounge');
    const spine = spineOf(plan);
    const rooms = kind(plan, 'project');
    assert.equal(plan.arrangement, 'column', where);
    assert.deepEqual(plan.proportions.faults, [], where);
    assert.ok(near(office.w, lounge.w) && near(spine.x, office.w), where);
    assert.equal(rooms.length, 2);
    assert.ok(near(rooms[0].y + rooms[0].h, rooms[1].y), `${where}: not one over the other`);
    for (const room of rooms) {
      assert.ok(near(room.x, spine.x + spine.w) && near(room.x + room.w, plan.width), where);
      assert.ok(near(room.door.x, room.x), `${where}: ${room.id}'s door is not on the spine`);
      const ratio = room.w / room.h;
      assert.ok(ratio >= ROOM_RATIO_MIN - EPS && ratio <= ROOM_RATIO_MAX + EPS, where);
      // A team's room, no smaller than a team's room is furnished at.
      assert.equal(room.module, 'M');
      assert.ok(room.w * room.h >= ROOM_FURNISHED_MIN * MODULE_WEIGHTS.M - 1e-3, where);
      assert.ok(room.w * room.h <= room.areaMax + 1e-3, where);
      assert.ok(bareFloorShare(room) <= 0.45 + 1e-9, `${where}: ${room.id} is bare`);
    }
    const { shares } = plan.proportions;
    const [least, hall] = held[/** @type {1600|1920} */ (win[0])];
    assert.ok(shares.rooms >= least, `${where}: rooms ${(shares.rooms * 100).toFixed(1)}%`);
    assert.ok(shares.halls <= hall, `${where}: a hall of ${(shares.halls * 100).toFixed(1)}%`);
    assert.ok(shares.office + shares.lounge <= SERVICE_STRIP_MAX + EPS, where);
    assert.ok(seatedPx >= 46, `${where}: seated ${seatedPx.toFixed(1)} px`);
    // THE HALL IS ALONG THE SPINE and is one floor with it: what the spine is
    // wider than a corridor, top to bottom, is what the plan calls its hall.
    assert.ok(spine.w >= CORRIDOR - EPS, where);
    const along = ((spine.w - CORRIDOR) * spine.h) / (plan.width * plan.height);
    assert.ok(Math.abs(shares.halls - along) < 1e-6, `${where}: a hall not on the spine`);
    assert.equal(spine.thoroughfare, true, `${where}: open floor nobody walks`);
  }
  // On the window the pair's own picture is taken on: the rooms within a point
  // of the majority, and the hall a corridor's width.
  const shown = planAt('pair', [1440, 1000]);
  assert.ok(shown.plan.proportions.shares.rooms >= 0.54, 'pair at 1440x1000');
  assert.ok(shown.plan.proportions.shares.halls <= 0.06, 'pair at 1440x1000');
  assert.ok(shown.seatedPx >= 46, `pair at 1440x1000: ${shown.seatedPx.toFixed(1)} px`);
  resetAgentScale();
});

test('a lone room with a crew in it is laid at its own module, and is not a showroom', () => {
  const { plan } = planAt('crew', [1600, 1000]);
  const [room] = kind(plan, 'project');
  assert.equal(plan.arrangement, 'column');
  assert.equal(room.kit, undefined, 'a crew’s room was laid a module up');
  assert.ok(room.w * room.h <= room.areaMax + 1e-3);
  const sofas = room.props.filter((/** @type {any} */ p) => p.kind === 'sofa').length;
  assert.ok(sofas <= 1, `${sofas} sofa groups round a crew`);
  assert.deepEqual(plan.proportions.faults, []);
  resetAgentScale();
});

test('the sofa runs come back one at a time: one to four waiting, two to nine, three past it', () => {
  assert.equal(OFFICE_COMPACT_MAX, 4);
  assert.equal(OFFICE_TWO_RUNS_MAX, 9);
  const graded = { compact: true, graded: true };
  assert.deepEqual(
    [0, 4, 5, 9, 10, 25].map((n) => officeRunsFor(n, graded)),
    [1, 1, 2, 2, 3, 3],
  );
  // Without it — a floor of more than three rooms — the second and the third
  // arrive together, as they did; and a reception held to its cap is all three.
  assert.deepEqual(
    [4, 5, 9, 10].map((n) => officeRunsFor(n, { compact: true })),
    [1, 3, 3, 3],
  );
  assert.equal(officeRunsFor(2, { ...graded, hold: true }), 3);
  assert.equal(officeRunsFor(2, {}), 3);

  const runsOf = (/** @type {any} */ room) =>
    room.props.filter((/** @type {any} */ p) => p.kind === 'sofa');
  const standing = (/** @type {any} */ room) =>
    room.zones.filter((/** @type {any} */ z) => String(z.id).startsWith('office-queue-')).length;
  let area = 0;
  for (let waiting = 0; waiting <= 14; waiting++) {
    const want = waiting <= 4 ? 1 : waiting <= 9 ? 2 : 3;
    for (const build of [buildOffice, buildOfficeRow]) {
      const { room } = build(waiting, undefined, graded);
      const runs = runsOf(room);
      assert.equal(runs.length, want, `${waiting} waiting: ${runs.length} runs`);
      // Everybody waiting has a cushion: nobody stands beside a quiet sofa.
      const cushions = runs.reduce(
        (/** @type {number} */ a, /** @type {any} */ r) => a + r.cushions,
        0,
      );
      assert.ok(cushions >= Math.max(4, waiting), `${waiting} waiting: ${cushions} cushions`);
      assert.equal(standing(room), 0, `${waiting} waiting: somebody stands`);
    }
    // And the room never shrinks as its queue grows.
    const { room } = buildOffice(waiting, undefined, graded);
    assert.ok(room.w * room.h >= area - EPS, `the reception shrank at ${waiting} waiting`);
    area = room.w * room.h;
  }
  // A second run is across the foot of the room, and the first comes down to
  // meet it: an L, corner to corner, with the well's width under both.
  for (const waiting of [5, 9]) {
    const { room } = buildOffice(waiting, undefined, graded);
    const side = room.props.find((/** @type {any} */ p) => p.id === 'wait-sofa-e');
    const back = room.props.find((/** @type {any} */ p) => p.id === 'wait-sofa-s');
    assert.ok(side && back && !room.props.some((/** @type {any} */ p) => p.id === 'wait-sofa-w'));
    assert.ok(near(side.y + side.h, back.y), `${waiting} waiting: the runs do not meet`);
    assert.ok(near(back.x + back.w, side.x), `${waiting} waiting: the back run stops short`);
  }
  // Two runs are a smaller room than three were for the same queue.
  for (const waiting of [5, 9]) {
    const two = buildOffice(waiting, undefined, graded).room;
    const three = buildOffice(waiting, undefined, { compact: true }).room;
    assert.ok(two.w * two.h < three.w * three.h, `${waiting} waiting`);
  }
});

test('the lounge’s bays come back one at a time: one to five resting, two to twelve, three to twenty', () => {
  assert.equal(LOUNGE_QUIET_MAX, 5);
  assert.deepEqual([...LOUNGE_BAY_STEPS], [5, 12, 20]);
  assert.deepEqual(
    [0, 5, 6, 12, 13, 20, 21, 60].map((n) => loungeBaysFor(n)),
    [1, 1, 2, 2, 3, 3, 4, 4],
  );
  const baysOf = (/** @type {number} */ resting, /** @type {object} */ opts) =>
    buildLounge(resting, { w: 36, h: 0 }, 0, 1, { maxGames: Infinity, quiet: true, ...opts })
      .room.zones.filter((/** @type {any} */ z) => z.bay)
      .map((/** @type {any} */ z) => z.bay)
      .sort();
  const order = ['sitting', 'cafe', 'quiet', 'games'];
  let seats = 0;
  for (const resting of [0, 5, 6, 12, 13, 20, 21, 30]) {
    const want = order.slice(0, loungeBaysFor(resting)).sort();
    assert.deepEqual(baysOf(resting, { graded: true }), want, `${resting} resting`);
    // Each bay that comes back seats more than the lounge did without it.
    const built = buildLounge(resting, { w: 36, h: 0 }, 0, 1, {
      maxGames: Infinity,
      quiet: true,
      graded: true,
    });
    const places = built.loungeSpots.reduce(
      (/** @type {number} */ a, /** @type {any} */ sp) =>
        a + (sp.kind === 'chat' ? 0 : Math.max(1, sp.capacity ?? 1)),
      0,
    );
    assert.ok(places >= seats, `${resting} resting: ${places} places, fewer than ${seats}`);
    seats = places;
  }
  // Without it they all arrive together at six, as they did.
  assert.deepEqual(baysOf(5, {}), ['sitting']);
  assert.deepEqual(baysOf(6, {}), ['cafe', 'quiet', 'sitting']);
  assert.deepEqual(baysOf(21, {}), ['cafe', 'games', 'quiet', 'sitting']);
});

test('a quiet floor is never a larger building than the grid would have laid', () => {
  // `reference` is one project beside a lounge of thirteen: the reception over
  // that lounge is a strip 51 U deep, the building that holds it is wider than
  // the one the grid lays, and everybody in it would be drawn smaller. So it
  // is the grid's floor still — rectangle for rectangle, as it was.
  const before = ['d09e8a36', '9ef0b80f', '2543ec62', '611d8dd2'];
  assert.deepEqual(
    WINDOWS.map((win) => rectHash(planAt('reference', win).plan)),
    before,
  );
  assert.equal(kind(planAt('reference', [1600, 1000]).plan, 'project').length, 1);
  resetAgentScale();
});

test('a floor of more than three rooms is laid as it was: rooms, reception and lounge', () => {
  // Taken before a quiet floor was laid round its rooms: every project room,
  // the reception and the lounge, to the thousandth of a unit, at four windows.
  const hash = rectHash;
  const before = {
    crowded: ['737f4233', '515364bf', '40c6787b', 'defb2ec6'],
    demo: ['69da0a94', 'd2adcd9b', '008725c4', '65757d70'],
    large: ['bb269d5a', '010daf49', '9f1777d0', '1d7c79b8'],
  };
  for (const [name, hashes] of Object.entries(before)) {
    const got = WINDOWS.map((win) => {
      const { plan } = planAt(name, win);
      assert.ok(kind(plan, 'project').length > QUIET_ROOMS_MAX, `${name} is a quiet floor`);
      return hash(plan);
    });
    assert.deepEqual(got, hashes, name);
  }
  resetAgentScale();
});
