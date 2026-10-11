/**
 * A junior is hired at its place and fired from it. It never walks to the
 * Lounge, and its cable never leaves its lead's room.
 *
 * The owner's picture: a junior in the corridor on its way back from the
 * Lounge, its green cable stretched across two rooms to the desk, and its
 * crew's tag in the Lounge. A junior's turn ends and starts again many times
 * inside one turn of its lead's, and each end sent it to the Lounge to rest
 * "like anyone else". It is not anyone else: it is its lead's helper for one
 * job, so it appears at its place, and when it has finished it stays there a
 * few seconds with its cable grey and is then not drawn.
 *
 * Everything here is asked of the real plan, the real seating pass and the
 * real runtime, stepped a frame at a time.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { AgentRuntime, assignSeats } from '../../public/render/agents.js';
import { agentIndex, crewsFrom, floorPopulation, placement } from '../../public/floor-rule.js';
import { restingOrder } from '../../public/floor-resting.js';
import { counts } from '../../src/core/model.mjs';
import {
  LEAD,
  MIN,
  NOW,
  agent,
  cablesOf,
  crewFloor,
  inside,
  jid,
  junior,
  planFor,
  roomOf,
} from '../helpers/junior-floor.mjs';

/** The same floor with one agent's fields changed. */
const withOne = (agents, id, over) => agents.map((a) => (a.id === id ? { ...a, ...over } : a));

test('the owner’s picture: a junior that stops and starts again is never between rooms, cabled', () => {
  const { agents, projects } = crewFloor(4);
  const plan = planFor(projects, agents);
  const career = roomOf(plan, 'project', 'career-ops');
  const diagonal = Math.hypot(career.w, career.h);
  const rt = new AgentRuntime();
  let t = NOW;
  const sync = (list) => rt.sync(list, plan, assignSeats(plan, list), { now: t });
  sync(agents);
  for (const state of ['ended', 'working', 'ended', 'working']) {
    const list = withOne(agents, jid(0), { activityState: state });
    sync(list);
    for (let i = 0; i < 300; i++) {
      t += 100;
      rt.step(0.1, { plan, now: t });
      for (const rec of rt.all()) {
        if (rec.agent.subagent !== true) continue;
        assert.ok(
          inside(rec, career),
          `${rec.id} is outside its lead's room (${state}, frame ${i})`,
        );
      }
      for (const cable of cablesOf(rt.all(), list, { nowMs: t })) {
        assert.ok(
          cable.pts.every((p) => inside(p, career)),
          `a cable leaves the room (${state}, frame ${i})`,
        );
        assert.ok(cable.length <= diagonal, `a cable is longer than its room (${state}, ${i})`);
      }
    }
  }
});

test('a finished junior is nowhere in the Lounge: no seat, no count, no name', () => {
  const { agents, projects } = crewFloor(4);
  const done = withOne(agents, jid(1), { activityState: 'ended' });
  const byId = agentIndex(done);
  const finished = done.find((a) => a.id === jid(1));
  assert.equal(placement(finished, byId), 'done');
  // Whatever else is said of it, a junior is never placed in the Lounge.
  for (const activityState of ['working', 'stalled', 'needs_input', 'for_review', 'ended']) {
    for (const ackState of ['active', 'benched']) {
      assert.notEqual(
        placement(junior('claude-code:x', LEAD, { activityState, ackState })),
        'lounge',
      );
    }
  }
  const plan = planFor(projects, done);
  const seats = assignSeats(plan, done);
  assert.equal(seats.get(jid(1)), undefined, 'it has no seat anywhere');
  const pop = floorPopulation(done, { now: NOW });
  assert.equal(pop.resting.get('career-ops') ?? 0, 0, 'the Lounge does not count it');
  assert.deepEqual(restingOrder(done, plan.hidden), [], 'nor name it');
  const lounge = roomOf(plan, 'lounge');
  assert.ok(lounge.plateLines[1].startsWith('0 resting'), lounge.plateLines[1]);
  // The crew that is left is the three still at work.
  assert.deepEqual(pop.crews.get('career-ops'), [3]);
});

test('the header’s buckets still sum to the total, with finished juniors in one of their own', () => {
  const { agents } = crewFloor(5);
  let list = withOne(agents, jid(0), { activityState: 'ended' });
  list = withOne(list, jid(1), { activityState: 'ended' });
  list = withOne(list, jid(2), { activityState: 'needs_input', needsInputSince: NOW - MIN });
  list.push(agent('claude-code:rest', { activityState: 'ended' }));
  list.push(agent('claude-code:bench', { ackState: 'benched' }));
  list.push(agent('claude-code:gone', { ackState: 'let_go' }));
  const c = counts(list, { now: NOW });
  assert.equal(c.drawn.juniorsDone, 2, 'the two finished juniors');
  assert.equal(c.drawn.lounge, 2, 'the ended senior and the benched one, and no junior');
  assert.equal(c.drawn.waiting, 1, 'the junior with its hand up');
  assert.equal(c.drawn.atDesk, 4, 'the lead, two juniors and the bystander');
  assert.equal(
    c.drawn.atDesk +
      c.drawn.waiting +
      c.drawn.lounge +
      c.drawn.finished +
      c.drawn.wentHome +
      c.drawn.juniorsDone,
    c.total - c.letGo,
    'every session lands in exactly one bucket',
  );
});

test('nothing about a junior is lost from the lists: a finished one is still in its crew', () => {
  const { agents } = crewFloor(4);
  const list = withOne(agents, jid(2), { activityState: 'ended' });
  const [crew] = crewsFrom(list, { now: NOW });
  assert.equal(crew.parentId, LEAD);
  assert.equal(crew.count, 4, 'the panel and the deck list all four');
  assert.ok(crew.members.some((m) => m.id === jid(2)));
});
