/**
 * YOUR OFFICE IS SIZED BY WHAT IS IN IT, INSIDE A FIFTH OF THE BUILDING
 * (`plan-proportions.js` (f)).
 *
 * On the owner's floor the reception had 17% of the building and the lounge
 * 40%, so the two rooms nobody works in were the larger half. The office is
 * laid at its contents — a sofa place for everybody waiting, its desk, its
 * queue — wherever that is inside its cap and the floor fits the window at the
 * scale it is held to. Where it is not, the office is laid AT its share: its
 * sofa runs are as long as that room's walls, and everybody they cannot seat
 * stands in the queue beside them. Nobody waiting is ever without a place.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { LARGE_NOW, ownerShapedFloor, populationFloor } from '../helpers/large-floor.mjs';
import { buildPlan } from '../../public/render/plan.js';
import { assignSeats } from '../../public/render/agents.js';
import { buildOffice, buildOfficeRow, seatOffice } from '../../public/render/plan-office.js';
import { OFFICE_AREA_MAX } from '../../public/render/plan-proportions.js';
import { placement } from '../../public/floor-rule.js';

const STAGES = [
  [1600, 870],
  [2000, 1055],
  [1366, 638],
];

/** The owner-shaped floor with `count` people waiting instead of sixteen. */
function waitingFloor(count) {
  const base = ownerShapedFloor();
  const one = base.agents.find((a) => a.activityState === 'for_review');
  const extra = Array.from({ length: Math.max(0, count - 16) }, (_, i) => ({
    ...one,
    id: `waiting-${i}`,
    reviewSince: LARGE_NOW - (i + 1) * 60_000,
  }));
  return { projects: base.projects, agents: [...base.agents, ...extra] };
}

const planAt = (
  /** @type {{projects:any[], agents:any[]}} */ floor,
  /** @type {number[]} */ stage,
) =>
  buildPlan(floor.projects, floor.agents, { stage: { w: stage[0], h: stage[1] }, now: LARGE_NOW });

test('a held reception is the size it is given, and its queue stands inside it', () => {
  for (const waiting of [16, 30, 60]) {
    const want = buildOfficeRow(waiting, { w: 0, h: 28 }).room;
    // Three fifths of the width its queue would like, at the same depth.
    const cell = { w: Math.max(28, want.w * 0.6), h: 28 };
    const held = buildOfficeRow(waiting, cell, { hold: true }).room;
    assert.ok(
      held.w <= cell.w + 1e-6 && held.h <= cell.h + 1e-6,
      `${waiting}: ${held.w}x${held.h}`,
    );
    assert.ok(held.w < want.w, `${waiting} waiting: held and no narrower`);
    const { officeSeats } = seatOffice(held, waiting);
    assert.equal(officeSeats.length, waiting, 'somebody waiting has no place');
    assert.ok(
      officeSeats.some((s) => s.standing),
      'nobody stands in a room three fifths its size',
    );
    assert.ok(
      officeSeats.some((s) => !s.standing),
      'its sofas seat nobody',
    );
    // Every place is in the room and is somebody's own.
    const seen = new Set();
    for (const s of officeSeats) {
      assert.ok(s.x >= 0 && s.x <= held.w && s.y >= 0 && s.y <= held.h, 'a place outside the room');
      const key = `${s.x.toFixed(2)}:${s.y.toFixed(2)}`;
      assert.ok(!seen.has(key), `${waiting} waiting: two people at ${key}`);
      seen.add(key);
    }
  }
});

test('without `hold` the reception is what it always was', () => {
  for (const waiting of [0, 3, 16, 40]) {
    assert.deepEqual(buildOffice(waiting, undefined, { hold: false }), buildOffice(waiting));
    const cell = { w: 0, h: 30 };
    assert.deepEqual(buildOfficeRow(waiting, cell, { hold: false }), buildOfficeRow(waiting, cell));
  }
});

test('the office is never past a fifth of the building, with nobody waiting or a hundred', () => {
  for (const waiting of [16, 30, 60, 100]) {
    const floor = waitingFloor(waiting);
    for (const stage of STAGES) {
      const plan = planAt(floor, stage);
      const where = `${waiting} waiting at ${stage.join('x')}`;
      const office = plan.rooms.find((r) => r.kind === 'office');
      const share = (office.w * office.h) / (plan.width * plan.height);
      assert.ok(
        share <= OFFICE_AREA_MAX + 1e-6,
        `${where}: the office is ${(share * 100).toFixed(1)}%`,
      );
      assert.deepEqual(plan.proportions.faults, [], where);
      // Everybody waiting has a place, and it is their own.
      assert.equal(
        plan.officeSeats.length,
        waiting,
        `${where}: places for ${plan.officeSeats.length}`,
      );
      const seats = assignSeats(plan, floor.agents);
      const seen = new Map();
      for (const a of floor.agents.filter((x) => placement(x) === 'office')) {
        const at = seats.get(a.id);
        assert.ok(at, `${where}: ${a.id} is waiting and is not drawn`);
        assert.ok(
          at.x >= office.x &&
            at.x <= office.x + office.w &&
            at.y >= office.y &&
            at.y <= office.y + office.h,
          `${where}: ${a.id} waits outside the office`,
        );
        const key = `${at.x.toFixed(2)}:${at.y.toFixed(2)}`;
        assert.ok(!seen.has(key), `${where}: ${a.id} and ${seen.get(key)} stand in one place`);
        seen.set(key, a.id);
      }
    }
  }
});

test('where the queue fits its sofas inside the cap, everybody sits and the office is its contents', () => {
  // Sixteen waiting on a 2000 px window: the floor is laid at its contents.
  const plan = planAt(ownerShapedFloor(), [2000, 1055]);
  assert.equal(plan.working.capped, false);
  const office = plan.rooms.find((r) => r.kind === 'office');
  const contents = buildOfficeRow(16, { w: 0, h: office.h }).room.w;
  assert.ok(
    Math.abs(office.w - contents) < 1e-6,
    `a ${office.w} U office for ${contents} U of sofas`,
  );
});

test('a queue never makes the rooms small: a hundred waiting hold the building at the window', () => {
  // On a 1366 px window the floor is held at the nominal scale either way.
  const sixteen = planAt(waitingFloor(16), [1366, 638]);
  const hundred = planAt(waitingFloor(100), [1366, 638]);
  assert.equal(hundred.working.capped, true);
  assert.ok(
    hundred.width <= sixteen.width + 1e-6,
    `a hundred waiting drew a ${hundred.width.toFixed(1)} U building, sixteen a ${sixteen.width.toFixed(1)} U one`,
  );
  // The rooms kept their floor: nothing the queue did took it from them.
  const rooms = (/** @type {any} */ p) =>
    p.rooms
      .filter((/** @type {any} */ r) => r.kind === 'project')
      .reduce((/** @type {number} */ a, /** @type {any} */ r) => a + r.w * r.h, 0);
  assert.ok(rooms(hundred) >= 0.55 * hundred.width * hundred.height - 1e-6);
  // And at its contents that floor would have been a third as wide again. (It
  // was half as wide again while a queue also grew the room it stood in; the
  // file along the wall asks for no floor of its own.)
  assert.ok(hundred.working.contentsW > hundred.width * 1.3, `${hundred.working.contentsW}`);
  // The overflow stands: more standing than sitting, and every one drawn.
  const standing = hundred.officeSeats.filter((s) => s.standing).length;
  assert.ok(standing > 50 && standing < 100, `${standing} of a hundred standing`);
});

test('the demo floors, whose queues are short, are laid exactly at their contents', () => {
  for (const name of ['demo', 'three', 'crew', 'reference']) {
    const floor = populationFloor(name);
    const plan = planAt(floor, [1600, 870]);
    assert.equal(plan.working.capped, false, `${name} was held to its caps`);
    assert.ok(
      plan.officeSeats.every((s) => !s.standing) || plan.officeSeats.length > 8,
      `${name}: somebody stands in an office laid at its contents`,
    );
  }
});
