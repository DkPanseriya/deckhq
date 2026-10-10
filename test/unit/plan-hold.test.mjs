/**
 * A room is furnished for the most people it has held lately, not for whoever
 * is in it this frame (`public/render/plan-hold.js`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FURNISH_HOLD_MS,
  FurnishingHold,
  headcountKey,
  largerHeadcount,
  roomHeadcounts,
} from '../../public/render/plan-hold.js';

import { AgentRuntime, assignSeats, deskSeatsOf, samePoint } from '../../public/render/agents.js';
import { Scene } from '../../public/render/scene.js';
import { adoptSnapshotClock, now as clockNow } from '../../public/clock.js';
import { buildPlan } from '../../public/render/plan.js';

const NOW = Date.UTC(2026, 8, 1, 12, 0, 0);
const STAGE = { w: 1600, h: 900 };
const PROJECTS = ['api', 'web'].map((id) => ({ id, name: id, sessionCount: 2 }));

/** Everything a room is drawn from, as one string: its box and all it stands on. */
const laid = (plan, id) => {
  const room = plan.rooms.find((r) => r.id === id);
  const n = (v) => Math.round(v * 1000) / 1000;
  return JSON.stringify([
    [room.x, room.y, room.w, room.h].map(n),
    room.props.map((p) => [p.kind, n(p.x), n(p.y), n(p.w), n(p.h)]),
    (plan.seats.get(id) || []).map((s) => [n(s.x), n(s.y)]),
  ]);
};
const MIN = 60_000;

/** One session, working at a desk in `projectId` unless told otherwise. */
const agent = (id, projectId, over = {}) => ({
  id,
  projectId,
  projectName: projectId,
  label: id,
  ackState: 'active',
  activityState: 'working',
  lastActivityAt: NOW - MIN,
  ...over,
});

/** A headcount of `desks` desks and nothing else. */
const desks = (n, crews = []) => ({ desks: n, crews, benches: [], loose: 0 });

test('a room is counted by its desks, its crews and its juniors beside a lead', () => {
  const lead = agent('lead', 'api');
  const junior = (i, over = {}) =>
    agent(`j${i}`, 'api', { subagent: true, parentId: 'lead', subagentType: 'Explore', ...over });
  const two = roomHeadcounts([lead, junior(1), junior(2)], { now: NOW }).get('api');
  assert.deepEqual([two.desks, two.crews, two.loose], [3, [], 2]);
  const three = roomHeadcounts([lead, junior(1), junior(2), junior(3)], { now: NOW }).get('api');
  assert.deepEqual([three.desks, three.crews, three.loose], [1, [3], 0]);
  // A repo nobody is active in has no room to hold anything for.
  const ended = roomHeadcounts([agent('a', 'api', { activityState: 'ended' })], { now: NOW });
  assert.equal(ended.has('api'), false);
});

test('a room grows at once and gives furniture back only after the hold', () => {
  const hold = new FurnishingHold();
  const at = (n, t, busy) => hold.update(new Map([['api', desks(n)]]), NOW + t, busy);
  assert.equal(at(2, 0).size, 0, 'the first snapshot is furnished for who is there');
  assert.equal(headcountKey(at(1, MIN).get('api')), headcountKey(desks(2)), 'one stood up');
  assert.equal(hold.dueAt, NOW + MIN + FURNISH_HOLD_MS);
  assert.equal(hold.key(), 'api=2::');
  assert.equal(at(3, 2 * MIN).size, 0, 'three is more: grown the same snapshot');
  assert.equal(hold.key(), '');
  assert.equal(at(1, 3 * MIN).get('api').desks, 3);
  assert.equal(at(2, 4 * MIN).get('api').desks, 3, 'still lower: the clock keeps running');
  assert.equal(at(1, 3 * MIN + FURNISH_HOLD_MS - 1).get('api').desks, 3);
  // Five minutes lower: it shrinks to the most it held while they ran.
  assert.equal(at(1, 3 * MIN + FURNISH_HOLD_MS).get('api').desks, 2);
  assert.equal(at(1, 3 * MIN + 2 * FURNISH_HOLD_MS).size, 0, 'and then to who is there');
  // The same snapshots at the same instants are the same answers.
  const again = new FurnishingHold();
  again.update(new Map([['api', desks(2)]]), NOW);
  assert.equal(again.update(new Map([['api', desks(1)]]), NOW + MIN).get('api').desks, 2);
  // A pinned clock never gives anything back.
  for (let i = 0; i < 50; i++) again.update(new Map([['api', desks(1)]]), NOW + MIN);
  assert.equal(again.key(), 'api=2::');
});

test('a room somebody is walking to or from neither grows nor shrinks', () => {
  const hold = new FurnishingHold();
  const busy = new Set(['api']);
  const at = (n, t, who) => hold.update(new Map([['api', desks(n)]]), NOW + t, who);
  at(2, 0);
  assert.equal(at(3, MIN, busy).get('api').desks, 2, 'not grown under a walker');
  assert.equal(hold.waiting, true);
  assert.equal(at(3, MIN).size, 0, 'grown once they have arrived');
  assert.equal(hold.waiting, false);
  at(1, 2 * MIN);
  assert.equal(at(1, 2 * MIN + FURNISH_HOLD_MS, busy).get('api').desks, 3, 'nor shrunk');
  assert.equal(hold.waiting, true);
  assert.equal(at(1, 2 * MIN + FURNISH_HOLD_MS).size, 0);
});

test('a held room is the room it was: same box, same furniture, same chairs', () => {
  const before = [agent('a1', 'api'), agent('a2', 'api'), agent('w1', 'web'), agent('w2', 'web')];
  // `a1`'s turn ends: it is waiting on the user, on its way to the office.
  const after = before.map((a) =>
    a.id === 'a1' ? { ...a, activityState: 'for_review', reviewSince: NOW } : a,
  );
  const opts = { stage: STAGE, now: NOW };
  const full = buildPlan(PROJECTS, before, opts);
  const bare = buildPlan(PROJECTS, after, opts);
  assert.notEqual(laid(bare, 'api'), laid(full, 'api'), 'unheld, the room is laid again');

  const hold = new FurnishingHold();
  assert.equal(hold.update(roomHeadcounts(before, { now: NOW }), NOW).size, 0);
  const held = hold.update(roomHeadcounts(after, { now: NOW + 1000 }), NOW + 1000);
  assert.deepEqual([...held.keys()], ['api']);
  const kept = buildPlan(PROJECTS, after, { ...opts, held });
  assert.equal(laid(kept, 'api'), laid(full, 'api'));
  assert.equal(laid(kept, 'web'), laid(full, 'web'), 'and so is the room beside it');
  // No hold in force is no `held` at all: the plan is the one it always was.
  const none = buildPlan(PROJECTS, before, { ...opts, held: new Map() });
  assert.equal(laid(none, 'api'), laid(full, 'api'));
});

test('whoever stays keeps the chair they are in while the room still has it', () => {
  const opts = { stage: STAGE, now: NOW };
  const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const all = ids.map((id) => agent(id, 'api'));
  const plan = buildPlan(PROJECTS, all, opts);
  const first = assignSeats(plan, all);
  const keep = deskSeatsOf(plan, first);
  assert.equal(keep.size, 6);
  // The same people, remembered: the seats the population alone gives.
  const same = assignSeats(plan, all, { keep });
  for (const id of ids) assert.equal(same.get(id), first.get(id), id);
  // Each of them leaves in turn; nobody who stays is given another chair.
  let moved = 0;
  for (const gone of ids) {
    const rest = all.filter((a) => a.id !== gone);
    const fresh = assignSeats(plan, rest);
    const kept = assignSeats(plan, rest, { keep });
    for (const a of rest) {
      assert.equal(kept.get(a.id), first.get(a.id), `${a.id} when ${gone} leaves`);
      if (fresh.get(a.id) !== first.get(a.id)) moved++;
    }
  }
  assert.ok(moved > 0, 'unremembered, somebody changes chairs: the test has a case to hold');
  // A room with a different number of chairs is a different room: hashed afresh.
  const two = all.slice(0, 2);
  const small = buildPlan(PROJECTS, two, opts);
  assert.deepEqual(
    [...assignSeats(small, two, { keep })],
    [...assignSeats(small, two)],
    'no chair of the old room is looked for in the new one',
  );
});

/** A scene with no canvas: `setState` and the hold are real, the bake is not. */
function bareScene() {
  const scene = Object.create(Scene.prototype);
  Object.assign(scene, {
    canvas: { setAttribute() {} },
    _snapshot: { agents: [], projects: [], counts: {} },
    _plan: null,
    _planSignature: null,
    _planGeometry: null,
    _runtime: new AgentRuntime(),
    _selectedId: null,
    _running: true,
    _stateGen: 0,
    _paintGen: 0,
    _fadeFrom: null,
    plans: 0,
    _rebuildPlan() {
      this.plans++;
      this._plan = buildPlan(this._snapshot.projects, this._snapshot.agents, {
        stage: STAGE,
        now: clockNow(),
        held: this._held || undefined,
      });
    },
    _bakeFloor() {},
    _draw() {},
  });
  return scene;
}

test('the page holds a room through a walk, grows it after, and shrinks it in five minutes', () => {
  adoptSnapshotClock({ now: NOW, nowFixed: true });
  const scene = bareScene();
  const snap = (agents) => ({ projects: PROJECTS, agents, counts: {}, settings: {} });
  const before = [agent('a1', 'api'), agent('a2', 'api'), agent('w1', 'web'), agent('w2', 'web')];
  scene.setState(snap(before));
  const first = laid(scene._plan, 'api');
  const chair = scene._runtime.get('a2').targetSeat;
  assert.equal(scene._held, null, 'a floor at rest holds nothing');

  // `a1`'s turn ends. The room is the room it was, and `a1` walks out of it.
  const left = before.map((a) =>
    a.id === 'a1' ? { ...a, activityState: 'for_review', reviewSince: NOW } : a,
  );
  scene.setState(snap(left));
  assert.equal(laid(scene._plan, 'api'), first, 'not re-laid when one of two stands up');
  assert.ok(scene._runtime.get('a1').path.length > 0, 'a1 is walking to the office');
  assert.ok(samePoint(scene._runtime.get('a2').targetSeat, chair), 'a2 kept its chair');
  assert.ok(scene._walkingRooms().has('api'));

  // Two more start in that room while a1 is still on its way out of it.
  const more = [...left, agent('a3', 'api'), agent('a4', 'api')];
  scene.setState(snap(more));
  assert.equal(laid(scene._plan, 'api'), first, 'not re-laid under a walker');
  assert.equal(scene._hold.waiting, true);
  assert.ok(
    scene._runtime.get('a1').path.length > 0,
    'and a1 is still walking, not stood at its seat',
  );
  const plans = scene.plans;
  scene._settleHold();
  assert.equal(scene.plans, plans, 'and nothing is asked again while the walker is the same');

  // The walk ends: the room is laid for the three now in it, the same tick.
  for (const rec of scene._runtime.all()) rec.path = [];
  scene._settleHold();
  assert.equal(scene._plan.seats.get('api').length >= 3, true);
  assert.notEqual(laid(scene._plan, 'api'), first);
  assert.equal(scene._hold.waiting, false);

  // Two of the three leave. Nothing moves for five minutes of the injected
  // clock, and then the room is the one a fresh floor would lay for one.
  const one = more.filter((a) => a.id !== 'a3' && a.id !== 'a4');
  scene.setState(snap(one));
  for (const rec of scene._runtime.all()) rec.path = [];
  const three = laid(scene._plan, 'api');
  adoptSnapshotClock({ now: NOW + FURNISH_HOLD_MS - 1, nowFixed: true });
  scene._settleHold();
  assert.equal(laid(scene._plan, 'api'), three, 'held to the last millisecond');
  adoptSnapshotClock({ now: NOW + FURNISH_HOLD_MS, nowFixed: true });
  scene._settleHold();
  const fresh = buildPlan(PROJECTS, one, { stage: STAGE, now: clockNow() });
  assert.equal(laid(scene._plan, 'api'), laid(fresh, 'api'));
  assert.equal(scene._held, null);
  adoptSnapshotClock({ now: NOW, nowFixed: true });
});

test('a crew that falls under three keeps its floor and lays no longer desk', () => {
  const crew = desks(1, [3]);
  const pair = { desks: 3, crews: [], benches: [], loose: 2 };
  assert.equal(headcountKey(largerHeadcount(crew, pair)), headcountKey(crew));
  // Three sessions of their own are three desks, crew floor or not.
  assert.equal(largerHeadcount(crew, desks(3)).desks, 3);
  // And a room a hold is gone from is forgotten.
  const hold = new FurnishingHold();
  hold.update(new Map([['api', desks(2)]]), NOW);
  hold.update(new Map(), NOW + MIN);
  assert.equal(hold.update(new Map([['api', desks(1)]]), NOW + 2 * MIN).size, 0);
});
