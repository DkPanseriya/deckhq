/**
 * Hired at its place, held a moment when it has finished, then gone.
 *
 * The floor is driven the way the scene drives it — `syncFloor`, then a frame
 * at a time — so what is asked is what is drawn: where each record is, whether
 * it is walking, what its cable is stroked in, and when it stops being there.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { JUNIOR_DONE_HOLD_MS } from '../../public/render/junior-hold.js';
import { LIFE, characterLife } from '../../public/render/life.js';
import { crewCableExtent } from '../../public/render/crew.js';
import { STATE_COLORS } from '../../public/render/palette.js';
import {
  LEAD,
  cablesOf,
  drivenFloor,
  inside,
  jid,
  junior,
  withOne,
} from '../helpers/junior-floor.mjs';

const FOLD_MS = LIFE.despawn.period * 1000;

/** One lead and `n` juniors, driven as the scene drives them, and their room. */
function floor(n, opts = {}) {
  const f = drivenFloor(n, opts);
  return Object.assign(f, { career: f.room('project', 'career-ops') });
}

/** How one record is drawn this instant: its size and its opacity. */
const lifeOf = (rec, t, reduced = false) => {
  const life = characterLife(rec.agent, {
    nowMs: t,
    state: rec.agent.activityState,
    lod: 2,
    reduced,
    spawnAt: rec.spawnAt,
    leftAt: rec.leftAt,
  });
  return { scale: life.scale, fade: life.fade };
};

test('hired: a junior appears at its place in the formation, with no walk from a door', () => {
  const f = floor(3, { roomFor: 4 });
  f.run(1000);
  f.t += 100;
  const four = [...f.agents, junior(jid(3))];
  const seats = f.sync(four);
  const rec = f.rt.get(jid(3));
  assert.equal(rec.path.length, 0, 'it does not walk in');
  assert.deepEqual(f.at(jid(3)), { x: seats.get(jid(3)).x, y: seats.get(jid(3)).y });
  assert.ok(inside(rec, f.career));
  assert.equal(rec.spawnAt, f.t, 'it arrives by the arrival animation');
  assert.ok(lifeOf(rec, f.t).scale < 1, 'small and faint on its first frame');
  assert.equal(crewCableExtent(f.t, rec, {}), 0, 'and its cable has not left the desk yet');
  assert.deepEqual(lifeOf(rec, f.t + LIFE.spawn.period * 1000), { scale: 1, fade: 1 });
  assert.equal(crewCableExtent(f.t + 300, rec, {}), 1, 'the cable has drawn itself to it');
});

for (const how of ['its turn ends', 'it leaves the snapshot']) {
  test(`fired: when ${how} a junior stays for the hold, cable grey, then is not drawn`, () => {
    const f = floor(4);
    f.run(1000);
    const before = new Map([0, 1, 2, 3].map((i) => [jid(i), f.at(jid(i))]));
    const list =
      how === 'its turn ends'
        ? withOne(f.agents, jid(1), { activityState: 'ended' })
        : f.agents.filter((a) => a.id !== jid(1));
    f.t += 100;
    f.sync(list);
    assert.equal(f.hold.dueAt, f.t + JUNIOR_DONE_HOLD_MS, 'one hold, and it is the named one');
    // The whole of the hold: nobody gets up, nobody moves, one cable is grey.
    for (let ms = 500; ms < JUNIOR_DONE_HOLD_MS; ms += 500) {
      f.run(500);
      f.sync(list);
      for (const [id, at] of before) {
        assert.deepEqual(f.at(id), at, `${id} moved during the hold`);
        assert.equal(f.rt.get(id).path.length, 0, `${id} is walking during the hold`);
      }
      assert.equal(f.rt.get(jid(1)).leftAt, null, 'it has not started to leave');
      const cables = cablesOf(f.rt.all(), list, { nowMs: f.t });
      assert.equal(cables.length, 4, 'every member of the formation is cabled');
      assert.equal(cables.filter((c) => c.style === STATE_COLORS.ended).length, 1, 'one is grey');
      assert.equal(cables.filter((c) => c.style === STATE_COLORS.working).length, 3);
    }
    // The hold is over: it folds away where it sat, and then there is no record.
    f.run(f.hold.dueAt - f.t);
    assert.ok(f.hold.dueAt <= f.t);
    f.sync(list);
    const rec = f.rt.get(jid(1));
    assert.equal(rec.leftAt, f.t, 'it leaves by the leaving animation');
    assert.deepEqual(f.at(jid(1)), before.get(jid(1)), 'from where it sat');
    assert.equal(rec.path.length, 0, 'it does not get up');
    f.run(FOLD_MS + 100);
    assert.equal(f.rt.get(jid(1)), undefined, 'and then it is not drawn');
    assert.equal(cablesOf(f.rt.all(), list, { nowMs: f.t }).length, 3);
    for (const rec of f.rt.all()) assert.ok(inside(rec, f.career) || !rec.agent.subagent);
  });
}

test('a junior that starts again inside the hold simply carries on', () => {
  const f = floor(4);
  f.run(1000);
  const at = f.at(jid(2));
  f.t += 100;
  f.sync(withOne(f.agents, jid(2), { activityState: 'ended' }));
  f.run(1500);
  f.sync(f.agents);
  const rec = f.rt.get(jid(2));
  assert.equal(f.hold.dueAt, Infinity, 'nothing is held any more');
  assert.equal(rec.leftAt, null);
  assert.equal(rec.spawnAt, null, 'it never left, so it does not arrive');
  assert.deepEqual(f.at(jid(2)), at);
  f.run(JUNIOR_DONE_HOLD_MS + 1000);
  f.sync(f.agents);
  assert.ok(f.rt.get(jid(2)), 'and it is still there after the hold would have ended');
  const cables = cablesOf(f.rt.all(), f.agents, { nowMs: f.t });
  assert.equal(cables.filter((c) => c.style === STATE_COLORS.working).length, 4);
});

test('reduced motion: a junior is simply there, then not', () => {
  const f = floor(3, { roomFor: 4 });
  f.run(1000, true);
  f.t += 100;
  const four = [...f.agents, junior(jid(3))];
  f.sync(four);
  const born = f.rt.get(jid(3));
  assert.deepEqual(lifeOf(born, f.t, true), { scale: 1, fade: 1 }, 'whole on its first frame');
  assert.equal(crewCableExtent(f.t, born, { reduced: true }), 1, 'and so is its cable');
  const done = withOne(four, jid(3), { activityState: 'ended' });
  f.t += 100;
  f.sync(done);
  f.run(JUNIOR_DONE_HOLD_MS, true);
  f.sync(done);
  const rec = f.rt.get(jid(3));
  assert.equal(rec.leftAt, f.t);
  assert.deepEqual(lifeOf(rec, f.t, true), { scale: 0, fade: 0 }, 'gone on the same frame');
  const cables = cablesOf(f.rt.all(), done, { nowMs: f.t, reduced: true });
  assert.equal(cables.length, 3, 'and no cable is left reaching for it');
  assert.equal(f.rt.get(LEAD).path.length, 0);
});
