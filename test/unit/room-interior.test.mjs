/**
 * A ROOM IS FURNISHED INTO THE FLOOR IT WAS GIVEN (`plan-interior.js`).
 *
 * The floor's rulebook made the rooms the majority of the building, and a room
 * came out much larger than its one desk with nothing on the rest of it. The
 * rules this file holds, asked of real plans:
 *
 *   - at most 45% of a room's floor is bare, per module, where bare is floor
 *     farther than a lane from everything in the room;
 *   - a module is owed its kit, and gets each piece of it where it fits;
 *   - nothing is stood in the plate band, inside the door, behind the desks
 *     where a junior stands, or on a crew's floor, and the zones keep a lane
 *     between them;
 *   - a meeting chair is furniture: nobody is ever seated on one;
 *   - nothing is random, and the plan can re-derive every position it wrote.
 *
 * IT PRINTS ITS MEASUREMENTS, before and after, so a change that moves a room's
 * furnishing shows what it moved.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LARGE_NOW, ownerShapedFloor, populationFloor } from '../helpers/large-floor.mjs';
import { buildPlan } from '../../public/render/plan.js';
import { resolveAnchors } from '../../public/render/plan-anchors.js';
import {
  BARE_FLOOR_MAX,
  DOOR_CLEAR_DEPTH,
  DOOR_CLEAR_W,
  HALL_FLOOR_U2,
  ROOM_KITS,
  ROOM_LANE,
  WORK_BACK,
  bareFloorShare,
  crewFloorOf,
  meetingFootprint,
  seatingFootprint,
  workZoneOf,
} from '../../public/render/plan-interior.js';
import { MODULE_L_DESKS, MODULE_M_DESKS } from '../../public/render/plan-proportions.js';
import { PROP_HEIGHT, isTallProp } from '../../public/render/backdrop-paint.js';
import { LIT_PROP_KINDS } from '../../public/render/backdrop-floor.js';
import { SEAT_FOOTPRINTS } from '../../public/render/plan-furniture.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDER = path.join(HERE, '..', '..', 'public', 'render');

/** One table, printed. @param {string} title @param {Array<[string, string]>} rows */
function report(title, rows) {
  const w = rows.reduce((a, [k]) => Math.max(a, k.length), 0);
  console.log(`\n  ${title}`);
  for (const [k, v] of rows) console.log(`    ${k.padEnd(w)}  ${v}`);
}

/**
 * A floor of teams: one project per entry, that many people at its desks.
 * @param {number[]} sizes @returns {{projects:any[], agents:any[]}}
 */
function teams(sizes) {
  const projects = sizes.map((n, i) => ({
    id: `p${i}`,
    name: `p${i}`,
    sessionCount: n,
    tokens: 1,
  }));
  const agents = [];
  const at = (id, over) => ({
    id,
    activityState: 'working',
    ackState: 'active',
    reviewSince: null,
    lastActivityAt: LARGE_NOW - 60_000,
    ...over,
  });
  sizes.forEach((n, i) => {
    for (let k = 0; k < n; k++) agents.push(at(`p${i}-${k}`, { projectId: `p${i}` }));
  });
  for (let k = 0; k < 5; k++)
    agents.push(at(`b${k}`, { projectId: 'p0', ackState: 'benched', activityState: 'ended' }));
  for (let k = 0; k < 2; k++)
    agents.push(
      at(`w${k}`, { projectId: 'p0', activityState: 'for_review', reviewSince: 1_000_000 + k }),
    );
  return { projects, agents };
}

/** The floors the rule is held on: the named populations, and teams of every module. */
const FLOORS = /** @type {const} */ ([
  ['crowded', () => ownerShapedFloor(), [2000, 1055]],
  ['pair', () => populationFloor('pair'), [1440, 870]],
  ['demo', () => populationFloor('demo'), [1600, 870]],
  ['three', () => populationFloor('three'), [1600, 870]],
  ['wide', () => populationFloor('three'), [1920, 950]],
  ['away', () => populationFloor('away'), [1600, 870]],
  ['large', () => populationFloor('large'), [2000, 1024]],
  ['teams 6·2·1', () => teams([6, 2, 1]), [1600, 870]],
  ['teams 9·5·3·1', () => teams([9, 5, 3, 1]), [2000, 1055]],
  ['teams 3·2·2', () => teams([3, 2, 2]), [1600, 870]],
  ['teams 21·5·3·1', () => teams([21, 5, 3, 1]), [1600, 870]],
  ['teams 5×6', () => teams([5, 5, 5, 5, 5, 5]), [1600, 870]],
]);

/** One or two projects on a whole building: every room a hall. */
const HALLS = /** @type {const} */ ([
  ['single', () => populationFloor('single'), [1600, 870]],
  ['reference', () => populationFloor('reference'), [1600, 870]],
  ['crew', () => populationFloor('crew'), [1600, 870]],
  ['teams 12·2', () => teams([12, 2]), [1600, 870]],
]);

/**
 * Every project room of a list of floors, furnished and as its desks left it.
 * @param {ReadonlyArray<readonly [string, () => any, readonly number[]]>} floors
 */
function roomsOf(floors) {
  const out = [];
  for (const [name, floor, stage] of floors) {
    const f = floor();
    const opts = { stage: { w: stage[0], h: stage[1] }, now: LARGE_NOW };
    const plan = buildPlan(f.projects, f.agents, opts);
    const plain = buildPlan(f.projects, f.agents, { ...opts, furnish: false });
    for (const room of plan.rooms) {
      if (room.kind !== 'project' || room.pinned) continue;
      const before = plain.rooms.find((r) => r.id === room.id);
      const floorU2 = room.w * (room.h - (room.plateBand ?? 0));
      const seats = plan.seats.get(room.id) || [];
      out.push({ name, plan, room, before, floorU2, seats, where: `${name}/${room.id}` });
    }
  }
  return out;
}

const ROOMS = roomsOf(FLOORS);
const HALL_ROOMS = roomsOf(HALLS);
const pct = (/** @type {number} */ v) => `${(v * 100).toFixed(1)}%`;
const hits = (a, b, pad = 0) =>
  a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
/** What the furnishing added: everything the room did not have as its desks left it. */
const addedTo = (r) => r.room.props.slice(r.before.props.length);
const interiorOf = (room) => ({
  x: room.x,
  y: room.y + (room.plateBand ?? 0),
  w: room.w,
  h: room.h - (room.plateBand ?? 0),
});

test('at most 45% of a room’s floor is bare, on every module', () => {
  assert.equal(BARE_FLOOR_MAX, 0.45);
  /** @type {Record<string, {before:number[], after:number[]}>} */
  const by = {
    S: { before: [], after: [] },
    M: { before: [], after: [] },
    L: { before: [], after: [] },
  };
  for (const r of ROOMS) {
    assert.ok(r.floorU2 <= HALL_FLOOR_U2, `${r.where} is a hall: ${r.floorU2.toFixed(0)} U²`);
    const after = bareFloorShare(r.room);
    const before = bareFloorShare(r.before);
    by[r.room.module].before.push(before);
    by[r.room.module].after.push(after);
    assert.ok(
      after <= BARE_FLOOR_MAX + 1e-9,
      `${r.where} (${r.room.module}, ${r.room.w.toFixed(1)} × ${r.room.h.toFixed(1)} U): ` +
        `${pct(after)} of its floor is bare, where it was ${pct(before)}`,
    );
    assert.ok(after <= before + 1e-9, `${r.where}: furnishing it made it barer`);
  }
  const mean = (list) => list.reduce((a, v) => a + v, 0) / list.length;
  const rows = [];
  for (const [module, m] of Object.entries(by)) {
    assert.ok(m.after.length >= 6, `only ${m.after.length} ${module} rooms were measured`);
    rows.push([
      `${module} · ${m.after.length} rooms`,
      `bare ${pct(mean(m.before))} → ${pct(mean(m.after))} on average, ` +
        `the barest ${pct(Math.max(...m.before))} → ${pct(Math.max(...m.after))}`,
    ]);
  }
  report('bare floor by module, as the desks left it → furnished', rows);
  const over = ROOMS.filter((r) => bareFloorShare(r.before) > BARE_FLOOR_MAX);
  assert.ok(over.length >= 12, `only ${over.length} rooms needed furnishing: not a test of it`);
  report(
    `the ${over.length} rooms that were over ${pct(BARE_FLOOR_MAX)}`,
    over
      .slice(0, 14)
      .map((r) => [
        `${r.where} ${r.room.module}`,
        `${r.room.w.toFixed(0)} × ${(r.room.h - 3.4).toFixed(0)} U  ` +
          `${pct(bareFloorShare(r.before))} → ${pct(bareFloorShare(r.room))}`,
      ]),
  );
});

test('a room laid at the size of its desks is given nothing', () => {
  const small = ROOMS.filter(
    (r) => bareFloorShare(r.before) <= BARE_FLOOR_MAX && r.room.module === 'S',
  );
  assert.ok(small.length >= 6, `${small.length} small rooms`);
  for (const r of small) {
    assert.equal(r.room.props.length, r.before.props.length, `${r.where} was furnished`);
    assert.deepEqual(
      r.room.props.map((p) => [p.kind, p.x, p.y]),
      r.before.props.map((p) => [p.kind, p.x, p.y]),
      `${r.where}: something in a room that needed nothing was moved`,
    );
  }
});

test('a hall is given everything on the list, and is far less bare than it was', () => {
  const rows = [];
  for (const r of HALL_ROOMS) {
    assert.ok(r.floorU2 > HALL_FLOOR_U2, `${r.where} is not a hall: ${r.floorU2.toFixed(0)} U²`);
    const before = bareFloorShare(r.before);
    const after = bareFloorShare(r.room);
    rows.push([`${r.where} ${r.floorU2.toFixed(0)} U²`, `${pct(before)} → ${pct(after)}`]);
    assert.ok(before - after >= 0.2, `${r.where}: ${pct(before)} → ${pct(after)}`);
    assert.ok(after <= 0.66, `${r.where} is still ${pct(after)} bare`);
    const kinds = new Set(addedTo(r).map((p) => p.kind));
    for (const kind of ['credenza', 'bookshelf', 'sofa', 'armchair', 'coffee_table', 'planter']) {
      assert.ok(kinds.has(kind), `${r.where} is a hall with no ${kind}`);
    }
    assert.equal(kinds.has('meeting_table'), !r.room.crew, `${r.where}: the meeting table`);
  }
  report('halls: one or two projects on a whole building', rows);
});

test('a module is owed its kit: a team’s room a table and a credenza, a big team’s more', () => {
  assert.deepEqual([...ROOM_KITS.S.pieces], []);
  assert.deepEqual([...ROOM_KITS.M.pieces], ['credenza', 'meeting']);
  assert.deepEqual([...ROOM_KITS.L.pieces], ['credenza', 'meeting', 'shelving', 'troughs']);
  assert.deepEqual([...ROOM_KITS.M.meeting], [4]);
  assert.deepEqual([...ROOM_KITS.L.meeting], [8, 6]);
  assert.ok(MODULE_M_DESKS === 2 && MODULE_L_DESKS === 5);

  const kindsIn = (r) => addedTo(r).map((p) => p.kind);
  // A team's room with floor to spare: the pair's, on the owner's window.
  for (const r of ROOMS.filter((x) => x.name === 'pair')) {
    assert.equal(r.room.module, 'M');
    const kinds = kindsIn(r);
    assert.ok(kinds.includes('credenza'), `${r.where} has no credenza`);
    const tables = addedTo(r).filter((p) => p.kind === 'meeting_table');
    assert.ok(
      tables.length >= 1 && tables[0].seats === 4,
      `${r.where}: its first table seats four`,
    );
  }
  // A big team's room: six at desks, on a floor of three projects.
  const big = ROOMS.find((r) => r.where === 'teams 6·2·1/p0');
  assert.equal(big.room.module, 'L');
  const kinds = kindsIn(big);
  const table = addedTo(big).find((p) => p.kind === 'meeting_table');
  assert.ok(table && table.seats >= 6, 'a big team’s table seats six or eight');
  assert.ok(kinds.includes('board_stand'), 'a table of six has a whiteboard at its head');
  assert.ok(
    kinds.includes('credenza') && kinds.includes('bookshelf'),
    'a credenza and a shelving wall',
  );
  assert.equal(kinds.filter((k) => k === 'planter').length, 2, 'two plant groups');
  for (const trough of addedTo(big).filter((p) => p.kind === 'planter')) {
    const plant = big.room.props.find((p) => /^plant_/.test(p.kind) && hits(p, trough, 1.2));
    assert.ok(plant, 'a trough stands beside a plant: together, a plant group');
  }
  // And each piece only where it fits: ten teams on one floor are ten rooms
  // the size of their desks, and none of them is furnished through a wall.
  const tight = roomsOf([['teams 2×10', () => teams(Array(10).fill(2)), [1600, 870]]]);
  assert.ok(tight.every((r) => r.room.module === 'M'));
  assert.ok(tight.every((r) => !kindsIn(r).includes('meeting_table')));
  report('the kits', [
    ['S', 'the desks, the break-out pair, the corner planting'],
    ['M', `+ a credenza, a table for ${ROOM_KITS.M.meeting[0]} (or a second sofa group)`],
    [
      'L',
      `+ a credenza, a table for ${ROOM_KITS.L.meeting.join(' or ')}, a shelving wall, two troughs`,
    ],
    ['a big team’s room', kinds.join(', ')],
  ]);
});

test('the three new pieces have a size in units and a height, and are the quiet ones', () => {
  assert.deepEqual(meetingFootprint(4), { w: 6.2, h: 7.3 });
  assert.deepEqual(meetingFootprint(6), { w: 8.8, h: 7.3 });
  assert.deepEqual(meetingFootprint(8), { w: 11.4, h: 7.3 });
  const seating = seatingFootprint();
  assert.ok(Math.abs(seating.w - 7.8) < 1e-9 && Math.abs(seating.h - 9.6) < 1e-9);
  assert.equal(PROP_HEIGHT.meeting_table, 'tall');
  assert.equal(PROP_HEIGHT.credenza, 'short');
  assert.equal(PROP_HEIGHT.board_stand, 'tall');
  assert.equal(isTallProp({ kind: 'credenza' }), false);
  // No pool of light on any of it: the light is the working desks'.
  for (const kind of ['meeting_table', 'credenza', 'board_stand', 'sofa', 'armchair']) {
    assert.equal(LIT_PROP_KINDS.includes(kind), false, `${kind} is lit`);
  }
  // A meeting chair is drawn at a task chair's size, and no seat kind is added.
  assert.deepEqual(Object.keys(SEAT_FOOTPRINTS).sort(), [
    'armchair',
    'bar_stool',
    'chair',
    'tub_chair',
  ]);
  // Tokens only, and none of the desk's own: a painter with a colour of its
  // own is a piece no theme can repaint.
  const src = fs.readFileSync(path.join(RENDER, 'backdrop-props-room.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.deepEqual(code.match(/#[0-9A-Fa-f]{3,8}\b|rgba?\(/g) || [], []);
  assert.equal(
    /PALETTE\.deskTop\b/.test(code),
    false,
    'a quiet piece is cut from the desk’s timber',
  );
  const tokens = [...new Set([...code.matchAll(/PALETTE\.([A-Za-z]+)/g)].map((m) => m[1]))].sort();
  report('the new pieces', [
    ['meeting table', '6.2, 8.8 or 11.4 × 7.3 U for 4, 6 or 8 · tall'],
    ['credenza', '1.4 U deep, 4 to 10.4 U long · short'],
    ['standing whiteboard', '0.6 × 4.4 U · tall'],
    ['tokens', tokens.join(', ')],
  ]);
});

test('nothing is stood in the plate band, inside the door, behind the desks or on a crew', () => {
  let checked = 0;
  let crews = 0;
  for (const r of [...ROOMS, ...HALL_ROOMS]) {
    const at = interiorOf(r.room);
    const added = addedTo(r);
    const work = workZoneOf(r.room);
    const crew = crewFloorOf(r.room);
    if (crew) crews++;
    const door = r.room.door;
    assert.ok(door, `${r.where} has no door`);
    const south = Math.abs(door.y - (r.room.y + r.room.h)) < 0.01;
    const north = Math.abs(door.y - r.room.y) < 0.01;
    const west = Math.abs(door.x - r.room.x) < 0.01;
    const doorBox =
      south || north
        ? {
            x: door.x - DOOR_CLEAR_W / 2,
            y: south ? at.y + at.h - DOOR_CLEAR_DEPTH : at.y,
            w: DOOR_CLEAR_W,
            h: DOOR_CLEAR_DEPTH,
          }
        : {
            x: west ? at.x : at.x + at.w - DOOR_CLEAR_DEPTH,
            y: door.y - DOOR_CLEAR_W / 2,
            w: DOOR_CLEAR_DEPTH,
            h: DOOR_CLEAR_W,
          };
    for (const p of added) {
      checked++;
      const what = `${r.where}/${p.kind}`;
      assert.ok(
        p.x >= at.x - 1e-6 &&
          p.y >= at.y - 1e-6 &&
          p.x + p.w <= at.x + at.w + 1e-6 &&
          p.y + p.h <= at.y + at.h + 1e-6,
        `${what} is through a wall or in the plate band`,
      );
      assert.equal(hits(p, doorBox), false, `${what} stands inside the door`);
      // Behind the desks' rug is where a junior stands; a trough against the
      // wall is the one thing low enough to be near it.
      const back = p.kind === 'planter' ? 0 : WORK_BACK - 1e-6;
      assert.equal(
        hits(p, { x: work.x, y: work.y - back, w: work.w, h: work.h + back * 2 }),
        false,
        `${what} stands in the work zone`,
      );
      if (crew) assert.equal(hits(p, crew), false, `${what} stands on the crew's floor`);
      for (const seat of r.seats) {
        assert.equal(
          hits(p, { x: seat.x - 0.5, y: seat.y - 0.5, w: 1, h: 1 }, 1.2 - 1e-6),
          false,
          `${what} is within a body of somebody's feet`,
        );
      }
    }
    // A crew is the room's second place, so it has no meeting table.
    if (crew)
      assert.ok(!added.some((p) => p.kind === 'meeting_table'), `${r.where}: a crew and a table`);
  }
  assert.ok(checked > 150, `only ${checked} added props were checked`);
  assert.ok(crews >= 2, `only ${crews} crew rooms were checked`);
});

test('the zones keep a lane between them, and storage hugs a wall', () => {
  let zones = 0;
  let runs = 0;
  for (const r of [...ROOMS, ...HALL_ROOMS]) {
    const at = interiorOf(r.room);
    const work = workZoneOf(r.room);
    const groups = r.room.zones.filter((z) => /^(meeting|seating)-\d+$/.test(z.id));
    const breakout = r.room.zones.find((z) => z.id === 'breakout');
    const all = breakout ? [...groups, breakout] : groups;
    for (const [i, g] of groups.entries()) {
      zones++;
      assert.equal(hits(g, work, ROOM_LANE - 1e-6), false, `${r.where}/${g.id} crowds the desks`);
      for (const other of all) {
        if (other === g || all.indexOf(other) < i) continue;
        assert.equal(
          hits(g, other, ROOM_LANE - 1e-6),
          false,
          `${r.where}: ${g.id} and ${other.id} are under a lane apart`,
        );
      }
    }
    for (const p of addedTo(r).filter((x) => x.kind === 'credenza' || x.kind === 'bookshelf')) {
      runs++;
      const off = Math.min(p.x - at.x, at.x + at.w - p.x - p.w, at.y + at.h - p.y - p.h);
      assert.ok(off <= 0.3 + 1e-6, `${r.where}/${p.kind} stands ${off.toFixed(2)} U off its wall`);
    }
  }
  assert.ok(zones >= 30 && runs >= 30, `${zones} zones and ${runs} runs`);
});

test('nobody is ever seated on a meeting chair, and the desks are the desks they were', () => {
  for (const r of [...ROOMS, ...HALL_ROOMS]) {
    const before = (r.before.props || []).filter((p) => p.kind === 'chair' || p.kind === 'desk');
    const after = r.room.props.filter((p) => p.kind === 'chair' || p.kind === 'desk');
    assert.deepEqual(
      after.map((p) => [p.kind, p.x, p.y]),
      before.map((p) => [p.kind, p.x, p.y]),
      `${r.where}: a desk or its chair moved`,
    );
    assert.equal(r.seats.length, after.filter((p) => p.kind === 'chair').length, r.where);
    for (const table of r.room.props.filter((p) => p.kind === 'meeting_table')) {
      for (const seat of r.seats) {
        assert.equal(hits({ x: seat.x, y: seat.y, w: 0, h: 0 }, table), false, r.where);
      }
    }
    // The break-out pair is still one pair, wherever its row put it.
    if (r.room.zones.some((z) => z.id === 'breakout')) {
      assert.equal(r.room.props.filter((p) => p.kind === 'tub_chair').length, 2, r.where);
    }
  }
});

test('the same floor is furnished the same way twice, and every position can be re-derived', () => {
  const f = populationFloor('pair');
  const opts = { stage: { w: 1440, h: 870 }, now: LARGE_NOW };
  const a = buildPlan(f.projects, f.agents, opts);
  const b = buildPlan(f.projects, f.agents, opts);
  const shape = (plan) =>
    plan.rooms
      .filter((r) => r.kind === 'project')
      .map((r) => r.props.map((p) => [p.kind, p.x, p.y, p.w, p.h]));
  assert.deepEqual(shape(a), shape(b));
  let checked = 0;
  for (const r of [...ROOMS, ...HALL_ROOMS]) {
    const was = r.room.props.map((p) => [p.x, p.y]);
    resolveAnchors(r.room);
    r.room.props.forEach((p, i) => {
      checked++;
      assert.ok(
        Math.abs(p.x - was[i][0]) < 1e-6 && Math.abs(p.y - was[i][1]) < 1e-6,
        `${r.where}/${p.kind} is not where its own anchor says`,
      );
    });
  }
  assert.ok(checked > 1000);
});
