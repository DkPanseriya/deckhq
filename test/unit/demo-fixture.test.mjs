/**
 * The actor floor a machine with no sessions gets (WP-13).
 *
 * Two things have to be true of it and are easy to get wrong: it has to be
 * shaped exactly like a real snapshot, so nothing downstream needs a second
 * code path; and it has to be inert — unaddressable, uncounted by every
 * terminal surface, and incapable of touching the user-owned half of the
 * model.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEMO_NOTE, buildDemoSnapshot, withoutDemoAgents } from '../../src/core/demo-fixture.mjs';
import { counts as countsOf } from '../../src/core/model.mjs';

const NOW = 1_756_900_000_000;

test('the fixture is shaped exactly like a real snapshot', () => {
  const snap = buildDemoSnapshot({ now: NOW });
  for (const key of [
    'agents',
    'projects',
    'counts',
    'settings',
    'takenNames',
    'hooks',
    'degraded',
    'writeError',
    'scannedAt',
  ]) {
    assert.ok(key in snap, `the demo snapshot is missing ${key}`);
  }
  assert.equal(snap.demo, true);
  assert.equal(snap.demoNote, DEMO_NOTE);
  // The counts are computed by the same function the real floor uses, so the
  // header cannot disagree with the floor.
  assert.deepEqual(snap.counts, countsOf(snap.agents));
});

test('the floor shows the two states the product is about', () => {
  const snap = buildDemoSnapshot({ now: NOW });
  const states = snap.agents.map((a) => a.activityState);
  assert.ok(states.includes('for_review'), 'nobody is standing in the office');
  assert.ok(states.includes('needs_input'), 'nobody has their hand up');
  assert.ok(snap.counts.needsYou > 0, 'the numeral the first coach mark points at reads zero');
  assert.ok(snap.projects.length >= 3, 'a one-room floor does not read as an office');
  assert.ok(snap.agents.length <= 12, 'the actor floor is meant to be legible, not big');
});

test('every actor carries the identity fields the client and renderer read', () => {
  for (const a of buildDemoSnapshot({ now: NOW }).agents) {
    for (const key of ['id', 'mk', 'label', 'projectMk', 'agentMk', 'projectId', 'projectName']) {
      assert.ok(a[key] !== undefined, `actor ${a.id} has no ${key}`);
    }
    assert.match(a.mk, /^MK\d+\.\d+$/);
    assert.equal(a.displayName, null, 'an actor must not take a real name from names.js');
  }
});

test('the fixture is a pure function of the clock it is given', () => {
  const a = buildDemoSnapshot({ now: NOW });
  const b = buildDemoSnapshot({ now: NOW });
  assert.deepEqual(a, b, 'two calls at the same instant produced different floors');
  const later = buildDemoSnapshot({ now: NOW + 60_000 });
  // Only the timestamps move; who is on the floor and what state they are in
  // does not, which is what lets the goldens photograph it.
  assert.deepEqual(
    later.agents.map((x) => [x.id, x.activityState, x.ackState]),
    a.agents.map((x) => [x.id, x.activityState, x.ackState]),
  );
});

test('INVARIANT: the actors are not addressable and carry no real session id', () => {
  const snap = buildDemoSnapshot({ now: NOW });
  for (const a of snap.agents) {
    // A real agent id is `<runtime>:<session uuid>`. These are neither, so
    // `/api/ack`, `/api/send` and `/api/resume` cannot resolve one: the
    // registry's own agent list is empty whenever this fixture is served.
    assert.match(a.id, /^demo:actor-\d+$/);
    assert.ok(!a.cwd.includes(process.cwd()), 'an actor points at a real directory');
    assert.match(a.cwd, /^\/deckhq-demo\//);
  }
});

test('the actor floor never raises the degraded banner', () => {
  // Nothing has run on this machine, so there is nothing for hooks to report
  // exactly. Telling a first-time user their state is degraded would be
  // false and would be the first thing they saw.
  assert.deepEqual(buildDemoSnapshot({ now: NOW }).degraded, {});
});

test('the real settings and write error are carried through, not invented', () => {
  const snap = buildDemoSnapshot({
    now: NOW,
    settings: { onboarded: true, sound: false },
    writeError: { file: 'C:/x/state.json', message: 'EACCES' },
  });
  assert.equal(snap.settings.onboarded, true);
  // A store that cannot write must still say so on a demo floor: it is a fact
  // about the machine, not about the floor.
  assert.equal(snap.writeError.message, 'EACCES');
});

test('withoutDemoAgents empties an actor floor and leaves a real one alone', () => {
  const demo = withoutDemoAgents(buildDemoSnapshot({ now: NOW }));
  assert.deepEqual(demo.agents, []);
  assert.deepEqual(demo.projects, []);
  assert.equal(demo.counts.needsYou, 0);
  assert.equal(demo.counts.total, 0);
  assert.equal(demo.demo, true, 'the caller still needs to know why it is empty');

  const real = { demo: false, agents: [{ id: 'claude-code:x' }], counts: { needsYou: 1 } };
  assert.equal(withoutDemoAgents(real), real, 'a real snapshot was copied instead of passed on');
  assert.equal(withoutDemoAgents(undefined), undefined);
});

test('the note says what the actors are and what to do about it', () => {
  assert.match(DEMO_NOTE, /actors/i);
  assert.match(DEMO_NOTE, /claude/);
  // No second-person fault (docs/plan/04 §5).
  assert.doesNotMatch(DEMO_NOTE, /you have not|you haven't|you'?ve not/i);
});
