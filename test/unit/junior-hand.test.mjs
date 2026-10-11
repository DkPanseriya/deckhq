/**
 * A junior with its own hand up, and the length of every cable.
 *
 * A raised hand is the product's needs-you signal, and a junior's own is the
 * one junior state that counts: it waits in Your Office, as it did. What
 * changed is what is drawn on the way and on the way back — no cable follows
 * it out of its formation, and once answered it is at its place again by the
 * arrival, never by a walk across two rooms.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { assignSeats } from '../../public/render/agents.js';
import { CREW_DRAW_CAP, agentIndex, placement } from '../../public/floor-rule.js';
import { counts } from '../../src/core/model.mjs';
import {
  MIN,
  NOW,
  cablesOf,
  crewFloor,
  drivenFloor,
  inside,
  jid,
  planFor,
  roomOf,
  withOne,
} from '../helpers/junior-floor.mjs';

test('a junior with its hand up waits in Your Office with no cable, and returns by the arrival', () => {
  const f = drivenFloor(4);
  f.run(1000);
  const hand = withOne(f.agents, jid(0), { activityState: 'needs_input', needsInputSince: f.t });
  assert.equal(
    placement(
      hand.find((a) => a.id === jid(0)),
      agentIndex(hand),
    ),
    'office',
  );
  assert.equal(counts(hand, { now: NOW }).handsUp, 1, 'and it is still a hand the header counts');
  f.t += 100;
  f.sync(hand, true);
  const rec = f.rt.get(jid(0));
  assert.ok(rec.path.length > 0, 'it goes to the office, as anybody with a hand up does');
  const career = () => f.room('project', 'career-ops');
  // The whole trip, and the wait after it: three cables, all of them at home.
  f.run(60_000, false, () => {
    const cables = cablesOf(f.rt.all(), hand, { nowMs: f.t });
    assert.equal(cables.length, 3, 'no cable is drawn to the one that left the formation');
    for (const c of cables) assert.ok(c.pts.every((p) => inside(p, career())));
  });
  assert.equal(rec.path.length, 0);
  assert.ok(inside(rec, f.room('office')), 'it waits in Your Office');
  assert.ok(!inside(rec, f.room('lounge')), 'and not in the Lounge');

  // Answered. It is at its place again, there, with no walk back.
  f.t += 100;
  const seats = f.sync(f.agents, true);
  assert.equal(rec.path.length, 0, 'it does not walk back across the floor');
  assert.deepEqual(f.at(jid(0)), { x: seats.get(jid(0)).x, y: seats.get(jid(0)).y });
  assert.ok(inside(rec, career()));
  assert.equal(rec.spawnAt, f.t, 'it arrives by the arrival animation');
  f.run(500);
  assert.equal(cablesOf(f.rt.all(), f.agents, { nowMs: f.t }).length, 4, 'and is cabled again');
});

test('a junior that finishes while it is away from its place is fired where it stands', () => {
  const f = drivenFloor(3);
  const hand = withOne(f.agents, jid(1), { activityState: 'needs_input', needsInputSince: f.t });
  f.t += 100;
  f.sync(hand, true);
  f.run(60_000);
  const at = f.at(jid(1));
  const done = withOne(f.agents, jid(1), { activityState: 'ended' });
  f.t += 100;
  f.sync(done, true);
  const rec = f.rt.get(jid(1));
  assert.equal(f.hold.dueAt, Infinity, 'there is no place to hold it at');
  assert.equal(rec.leftAt, f.t, 'it folds away at once');
  assert.equal(rec.path.length, 0, 'and walks nowhere first');
  assert.deepEqual(f.at(jid(1)), at);
  f.run(1000);
  assert.equal(f.rt.get(jid(1)), undefined);
});

test('a cable is inside its lead’s room and never longer than the room, at every crew size', () => {
  /** @type {Record<string, object>} */
  const leads = {
    working: {},
    waiting: { activityState: 'for_review', reviewSince: NOW - MIN },
    away: { ackState: 'benched' },
  };
  for (const [label, over] of Object.entries(leads)) {
    for (const n of [3, 4, 5, 8, 12, 13]) {
      const { agents, projects } = crewFloor(n, over);
      const plan = planFor(projects, agents);
      const seats = assignSeats(plan, agents);
      const career = roomOf(plan, 'project', 'career-ops');
      const diagonal = Math.hypot(career.w, career.h);
      const records = agents
        .filter((a) => seats.has(a.id))
        .map((a) => ({ ...seats.get(a.id), id: a.id, agent: a, targetSeat: seats.get(a.id) }));
      const cables = cablesOf(records, agents);
      assert.equal(cables.length, Math.min(n, CREW_DRAW_CAP), `${label}/${n}: one cable a member`);
      for (const c of cables) {
        assert.ok(
          c.pts.every((p) => inside(p, career)),
          `${label}/${n}: a cable leaves the room`,
        );
        assert.ok(c.length <= diagonal, `${label}/${n}: ${c.length} > ${diagonal}`);
      }
      // And none at all to a member the seat names but who is not there.
      const lounge = roomOf(plan, 'lounge');
      const astray = records.map((r) =>
        r.id === jid(0) ? { ...r, x: lounge.x + lounge.w / 2, y: lounge.y + lounge.h / 2 } : r,
      );
      assert.equal(cablesOf(astray, agents).length, cables.length - 1, `${label}/${n}: astray`);
    }
  }
});
