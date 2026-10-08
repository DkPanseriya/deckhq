/**
 * A CHAIR SOMEBODY IS IN, AND A SCREEN SOMEBODY IS AT.
 *
 * Two things the baked floor says about a person's place, each asked of real
 * plans and of the painter:
 *
 *   - a task chair somebody is seated in is square to its desk, and only an
 *     empty one is left a few degrees askew (`plan-seated.js`, `chairSwivel`);
 *   - a screen on a worktree's bench names the edge its occupant sits at, so
 *     its keyboard is on their side of it whatever shape its rect is.
 *
 * IT PRINTS ITS COUNTS, per floor: chairs taken and chairs empty.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { LARGE_NOW, ownerShapedFloor, populationFloor } from '../helpers/large-floor.mjs';
import { paintRecorder } from '../helpers/paint-recorder.mjs';
import { buildPlan } from '../../public/render/plan.js';
import { assignSeats } from '../../public/render/agents-seats.js';
import { markOccupiedChairs } from '../../public/render/plan-seated.js';
import { BENCH_SEAT_EDGE } from '../../public/render/plan-worktrees.js';
import { chairSwivel } from '../../public/render/backdrop-props-kit.js';
import { paintProp } from '../../public/render/backdrop.js';
import { U_DEFAULT } from '../../public/render/backdrop-paint.js';
import { setDeviceScale } from '../../public/render/device-px.js';

/** One table, printed. @param {string} title @param {Array<[string, string]>} rows */
function report(title, rows) {
  const w = rows.reduce((a, [k]) => Math.max(a, k.length), 0);
  console.log(`\n  ${title}`);
  for (const [k, v] of rows) console.log(`    ${k.padEnd(w)}  ${v}`);
}

/**
 * One repository with somebody in its main checkout and four sessions in three
 * linked worktrees of it: a desk, and three benches against the foot wall.
 * @returns {{projects:any[], agents:any[]}}
 */
function worktreeFloor() {
  const at = (/** @type {string} */ id, /** @type {string|null} */ wt) => ({
    id,
    projectId: 'career-ops',
    projectName: 'career-ops',
    repoId: 'career-ops',
    repoName: 'career-ops',
    worktree: wt ? { name: wt, path: `/w/career-ops/.claude/worktrees/${wt}`, branch: null } : null,
    activityState: 'working',
    ackState: 'active',
    reviewSince: null,
    lastActivityAt: LARGE_NOW - 60_000,
  });
  const agents = [at('a', null), at('b0', 'w1'), at('b1', 'w1'), at('b2', 'w2'), at('b3', 'w3')];
  const projects = [
    { id: 'career-ops', name: 'career-ops', sessionCount: 5, activeCount: 5, tokens: 1 },
  ];
  return { projects, agents };
}

const FLOORS = /** @type {const} */ ([
  ['demo', () => populationFloor('demo'), [1600, 870]],
  ['crowded', () => ownerShapedFloor(), [2000, 1055]],
  ['large', () => populationFloor('large'), [2000, 1024]],
  ['worktrees', worktreeFloor, [1600, 870]],
  ['crew-waiting', () => populationFloor('crew-waiting'), [1600, 870]],
  ['away', () => populationFloor('away'), [1600, 870]],
]);

/** @param {() => any} floor @param {readonly number[]} stage */
function planOf(floor, stage) {
  const f = floor();
  const plan = buildPlan(f.projects, f.agents, {
    stage: { w: stage[0], h: stage[1] },
    now: LARGE_NOW,
  });
  return { plan, agents: f.agents };
}

/** Every task chair in a project room. @param {any} plan */
const chairsOf = (plan) =>
  plan.rooms
    .filter((/** @type {any} */ r) => r.kind === 'project')
    .flatMap((/** @type {any} */ r) =>
      r.props.filter((/** @type {any} */ p) => p.kind === 'chair'),
    );

/** Paint one prop at 32 px to the unit and say how it was turned. @param {any} prop */
function turnsOf(prop) {
  const ctx = paintRecorder();
  setDeviceScale(ctx, 32 / U_DEFAULT);
  paintProp(ctx, prop, U_DEFAULT);
  return ctx.turns;
}

test('an occupied chair faces its desk squarely, and only an empty one is left askew', () => {
  /** @type {Array<[string, string]>} */
  const rows = [];
  let taken = 0;
  let empty = 0;
  for (const [name, floor, stage] of FLOORS) {
    const { plan, agents } = planOf(floor, stage);
    // Where the scene will draw somebody seated, asked the way the scene asks.
    const seated = [...assignSeats(plan, agents).values()].filter(
      (s) => !s.overflow && !s.standing,
    );
    let here = 0;
    let bare = 0;
    for (const chair of chairsOf(plan)) {
      const cx = chair.x + chair.w / 2;
      const cy = chair.y + chair.h / 2;
      const sitter = seated.find((s) => Math.abs(s.x - cx) < 0.01 && Math.abs(s.y - cy) < 0.01);
      const where = `${name}: the chair at ${cx.toFixed(1)}, ${cy.toFixed(1)}`;
      if (sitter) {
        here++;
        assert.equal(chair.occupied, true, `${where} has somebody in it and is not marked`);
        assert.equal(chairSwivel(chair), 0, `${where} is turned under the person in it`);
        // Square on: the chair faces exactly the way the person in it does.
        assert.equal(chair.angle, sitter.angle, `${where} faces another way than its occupant`);
        // And it is PAINTED square: its facing, then the quarter turn that puts
        // the back behind the occupant, and not a degree more.
        assert.deepEqual(turnsOf(chair), [chair.angle, -Math.PI / 2], where);
      } else {
        bare++;
        assert.equal(chair.occupied, undefined, `${where} is empty and marked occupied`);
        const deg = Math.abs((chairSwivel(chair) * 180) / Math.PI);
        assert.ok(deg >= 8 && deg <= 15, `${where} is empty and turned ${deg.toFixed(1)}°`);
        const [, turn] = turnsOf(chair);
        assert.ok(Math.abs(turn + Math.PI / 2) > 0.13, `${where} is empty and painted square`);
      }
    }
    // Every desk seat somebody was given is a chair that was marked.
    const marked = chairsOf(plan).filter((/** @type {any} */ c) => c.occupied).length;
    assert.equal(marked, here);
    taken += here;
    empty += bare;
    rows.push([name, `${here} taken, square · ${bare} empty, askew`]);
  }
  assert.ok(taken >= 30, `only ${taken} occupied chairs over the floors`);
  assert.ok(empty >= 5, `only ${empty} empty chairs over the floors`);
  report('task chairs, by floor', rows);
});

test('marking the chairs moves nothing, and is the same on a second pass', () => {
  const { plan, agents } = planOf(() => populationFloor('demo'), [1600, 870]);
  const before = JSON.stringify(plan.rooms);
  const again = markOccupiedChairs(plan, agents);
  assert.equal(JSON.stringify(plan.rooms), before, 'a second pass changed the plan');
  assert.equal(again, chairsOf(plan).filter((/** @type {any} */ c) => c.occupied).length);
  // A plan with nobody on it marks nothing, and a missing plan is not an error.
  assert.equal(markOccupiedChairs(plan, []), 0);
  assert.equal(markOccupiedChairs(/** @type {any} */ (null), agents), 0);
});

test('a screen on a worktree’s bench names the edge its occupant sits at, and faces them', () => {
  const { plan } = planOf(worktreeFloor, [1600, 870]);
  assert.equal(BENCH_SEAT_EDGE, 'N', 'a bench stands against the foot wall: its chairs are north');
  assert.ok(plan.worktreeSeats.size >= 2, 'the worktrees floor seats nobody at a bench');
  let screens = 0;
  for (const room of plan.rooms) {
    const benches = (room.zones || []).filter((/** @type {any} */ z) =>
      /^worktree-\d+$/.test(z.id),
    );
    for (const bench of benches) {
      const on = (/** @type {any} */ p) => p.anchor.type === 'zone' && p.anchor.of === bench.id;
      const monitors = room.props.filter((/** @type {any} */ p) => p.kind === 'monitor' && on(p));
      for (const monitor of monitors) {
        screens++;
        assert.equal(monitor.anchor.edge, BENCH_SEAT_EDGE, 'a bench screen names no edge');
        // Somebody sits at it: a bench seat, in line with the screen and on
        // the side of it the edge names.
        const mid = monitor.x + monitor.w / 2;
        const seat = [...plan.worktreeSeats.values()].find((s) => Math.abs(s.x - mid) < 0.01);
        assert.ok(seat, 'a bench screen with nobody at it');
        assert.ok(seat.y < monitor.y, 'the occupant is not north of their screen');
        // Painted for that edge: no turn at all, so the keyboard is the north
        // strip of the rect and the screen the south — as on a desk's N side.
        const desk = { ...monitor, anchor: { type: 'attached', to: 't', edge: 'N', along: 0 } };
        assert.deepEqual(turnsOf(monitor), turnsOf(desk));
        // WHAT THE EDGE IS FOR. Left to guess, the painter reads the rect's
        // shape, and a screen deeper than it is wide would be laid for somebody
        // sitting to the WEST of it. Named, it faces the seat whatever its shape.
        const deep = { ...monitor, w: monitor.h, h: monitor.w };
        const { edge: _edge, ...unnamed } = deep.anchor;
        assert.deepEqual(turnsOf(deep), turnsOf(monitor), 'a named edge depends on the rect');
        assert.notDeepEqual(turnsOf({ ...deep, anchor: unnamed }), turnsOf(monitor));
      }
      // The chairs at it are on that same side of the top.
      const top = room.props.find((/** @type {any} */ p) => p.kind === 'desk' && on(p));
      for (const chair of room.props.filter(
        (/** @type {any} */ p) => p.kind === 'chair' && on(p),
      )) {
        assert.ok(chair.y + chair.h <= top.y + 1e-9, 'a bench chair is not north of the bench');
      }
    }
  }
  assert.ok(screens >= 2, `only ${screens} bench screens on the worktrees floor`);
  console.log(`\n    ${screens} bench screens, each facing the seat to its north`);
});
