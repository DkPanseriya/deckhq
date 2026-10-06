/**
 * AWAY ROOMS: a repo whose sessions are all waiting in the office keeps a
 * narrow room (the owner's floor of 6 October).
 *
 * Five repos had everybody on the reception sofas and nobody at a desk, and
 * each of them still kept a full room beside the one room somebody was working
 * in. The rule (`awayRooms` in `public/floor-rule.js`): such a repo keeps a
 * room, laid as a pinned one is — in the strip, one desk, at most a third of
 * the smallest live room — with a live room's plate, and it grows back the
 * moment one of its sessions works. Asked of the real plan over the `away`
 * demo population (`test/helpers/large-floor.mjs`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { awayFloor, LARGE_NOW } from '../helpers/large-floor.mjs';
import { buildPlan } from '../../public/render/plan.js';
import { assignSeats } from '../../public/render/agents.js';
import { computeFill } from '../../public/render/scene-camera.js';
import { layoutPlate, platePlanFor } from '../../public/render/scene-labels.js';
import { plateHeroLine } from '../../public/render/plan-plate.js';
import { buildOfficeRow } from '../../public/render/plan-office.js';
import { awayRooms, floorPopulation } from '../../public/floor-rule.js';
import { adoptSnapshotClock } from '../../public/clock.js';

const AWAY = ['orbital-api', 'checkout-flow', 'design-system', 'data-pipeline', 'infra-terraform'];
const STAGES = [
  [2000, 970],
  [1600, 870],
  [1420, 690],
];

/** @param {{projects:any[], agents:any[]}} floor @param {number} w @param {number} h */
function planAt(floor, w, h) {
  return buildPlan(floor.projects, floor.agents, { stage: { w, h }, now: LARGE_NOW });
}

const area = (r) => r.w * r.h;

test('five away repos beside one working repo: the working room is at least 3x each away room', () => {
  for (const [w, h] of STAGES) {
    const plan = planAt(awayFloor(), w, h);
    const rooms = plan.rooms.filter((r) => r.kind === 'project');
    const working = rooms.find((r) => r.id === 'mobile-app');
    assert.ok(working && working.away !== true && working.pinned !== true, `${w}x${h}`);
    const away = rooms.filter((r) => r.away === true);
    assert.deepEqual(away.map((r) => r.id).sort(), [...AWAY].sort(), `${w}x${h}`);
    for (const r of away) {
      assert.ok(
        area(working) >= 3 * area(r) - 1e-6,
        `${w}x${h}: ${r.id} is ${area(r).toFixed(0)} U² beside a ${area(working).toFixed(0)} U² working room`,
      );
      assert.notEqual(r.pinned, true, 'an away room is not a pinned one');
      // One desk, and nobody seated in the room: its people are on the sofas.
      assert.ok(r.props.filter((p) => p.kind === 'desk').length <= 1, `${r.id} has one desk`);
      assert.equal((plan.seats.get(r.id) || []).length, 0, `${r.id} seats nobody`);
    }
  }
});

test('an away room keeps its plate: the need-you line is the one a live room would say', () => {
  adoptSnapshotClock({ now: LARGE_NOW, nowFixed: true });
  try {
    const floor = awayFloor();
    const [w, h] = STAGES[0];
    const plan = planAt(floor, w, h);
    const { scale } = computeFill(plan.width, plan.height, w, h);
    const camera = { zoom: scale / 14, panX: 0, panY: 0, U: 14 };
    const ctx = {
      font: '10px x',
      measureText(t) {
        const px = parseFloat(/(\d[\d.]*)px/.exec(this.font)?.[1] ?? '10');
        return { width: String(t).length * px * 0.58 };
      },
    };
    const snapshot = { projects: floor.projects, agents: floor.agents };
    for (const id of AWAY) {
      const room = plan.rooms.find((r) => r.id === id);
      const project = floor.projects.find((p) => p.id === id);
      const plate = platePlanFor(room, snapshot, plan);
      // Exactly the plan a live room of this repo gets.
      const { away: _away, ...asLive } = room;
      assert.deepEqual(plate, platePlanFor(asLive, snapshot, plan), id);
      assert.equal(plate.heroHead, plateHeroLine(project), id);
      assert.match(plate.lines[1], new RegExp(`^${project.needsYou} need you`), id);
      // And the narrow room still draws it, at the owner's window.
      const hero = layoutPlate(ctx, room, plate, camera).rows.find((r) => r.i === 1);
      assert.ok(
        hero && hero.text.startsWith(`${project.needsYou} need you`),
        `${id}: ${hero?.text}`,
      );
    }
  } finally {
    adoptSnapshotClock(null);
  }
});

test('an away room grows back the moment one of its sessions works', () => {
  const floor = awayFloor();
  const before = planAt(floor, 2000, 970).rooms.find((r) => r.id === 'checkout-flow');
  assert.equal(before.away, true);
  const agents = floor.agents.map((a) =>
    a.projectId === 'checkout-flow' && a.activityState === 'for_review'
      ? { ...a, activityState: 'working', reviewSince: null }
      : a,
  );
  const after = planAt({ projects: floor.projects, agents }, 2000, 970);
  const room = after.rooms.find((r) => r.id === 'checkout-flow');
  assert.notEqual(room.away, true);
  assert.notEqual(room.pinned, true);
  assert.ok(area(room) > 3 * area(before), 'a full room again');
  assert.ok((after.seats.get('checkout-flow') || []).length >= 1, 'with a desk to sit at');
});

test('an away repo is still on the floor: its finished sessions rest in the lounge', () => {
  const floor = awayFloor();
  const plan = planAt(floor, 2000, 970);
  const seats = assignSeats(plan, floor.agents);
  const resting = floor.agents.filter(
    (a) => a.projectId === 'orbital-api' && a.activityState === 'ended',
  );
  assert.ok(resting.length > 0);
  for (const a of resting) assert.ok(seats.has(a.id), `${a.id} has no seat`);
});

test('a floor where every repo is away keeps the rooms it had', () => {
  const floor = awayFloor();
  const projects = floor.projects.filter((p) => p.id !== 'mobile-app');
  const agents = floor.agents.filter((a) => a.projectId !== 'mobile-app');
  const pop = floorPopulation(agents, { now: LARGE_NOW });
  const split = awayRooms(projects, pop);
  assert.equal(split.rooms.length, AWAY.length);
  assert.equal(split.strip.length, 0);
  const plan = planAt({ projects, agents }, 2000, 970);
  assert.equal(plan.rooms.filter((r) => r.away === true).length, 0);
});

test('the reception does not take the width the away rooms gave up: its sofas, at most 40%', () => {
  // The fault on this floor at 1600 x 1000: the reception was 92 of 134 U, a
  // bare rug with the sixteen waiting along its two long edges. It is as wide
  // as its contents now, and the building still fills the window.
  const floor = awayFloor();
  const { waiting } = floorPopulation(floor.agents, { now: LARGE_NOW });
  assert.equal(waiting, 16);
  for (const [w, h] of [[1600, 870], ...STAGES]) {
    const plan = planAt(floor, w, h);
    const office = plan.rooms.find((r) => r.kind === 'office');
    const contents = buildOfficeRow(waiting, { w: 0, h: office.h }).room.w;
    const where = `${w}x${h}: a ${office.w.toFixed(1)} U reception in a ${plan.width.toFixed(1)} U building`;
    assert.ok(office.w <= 0.4 * plan.width + 1e-6, where);
    assert.ok(office.w <= contents + 1e-6, `${where}, its sofas need ${contents.toFixed(1)}`);
    const fill = computeFill(plan.width, plan.height, w, h);
    assert.ok(Math.min(fill.coverW, fill.coverH) >= 0.96, `${where} leaves ground showing`);
  }
});
