/**
 * WP-84 · the clause that was always true, and the queue that never expired.
 *
 * `src/http/routes/actions.mjs` matched a name queued by "start a session
 * here" like this:
 *
 *     registry.agents.filter((a) => path.resolve(a.cwd) === p.cwd && !a.displayName)
 *
 * `registry.agents` is `_agents` — the merged scan — and `displayName` is
 * applied in `snapshot()`, not in the merge. So `!a.displayName` was
 * `!undefined`: always true. The clause that read as "only a session the user
 * has not already named" matched every session in the directory, and the `+`
 * button's queued name could overwrite one the user had typed. Found in
 * passing by §155 and recorded, unfixed, in `docs/plan/BUG-DUPLICATE-AGENT.md`
 * §4; fixed by §156.
 *
 * The expiry was five minutes on `Date.now()`, which no test could reach
 * without sleeping for five minutes. It is ten minutes on the injected clock
 * now, and this file moves that clock.
 *
 * `src/core/pending-identity.mjs` exists so these are decisions this file can
 * make directly rather than through an HTTP route and a spawned terminal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  PENDING_IDENTITY_TTL_MS,
  createPendingIdentities,
} from '../../src/core/pending-identity.mjs';

const CWD = path.resolve('/projects/orbital-api');
const OTHER = path.resolve('/projects/billing');

/** A clock a test owns. Never `Date.now()`. */
function fakeClock(at = 1_760_000_000_000) {
  const clock = { at };
  return { now: () => clock.at, advance: (ms) => void (clock.at += ms), clock };
}

/** A described agent — the shape `snapshot()` produces, `displayName` and all. */
function agent(id, over = {}) {
  return {
    id,
    identityId: id,
    cwd: CWD,
    displayName: null,
    givenName: 'Wren',
    lastActivityAt: 1_000,
    ...over,
  };
}

test('WP-84: a queued name attaches to the newest unnamed session in its directory', () => {
  const { now } = fakeClock();
  const q = createPendingIdentities({ now });
  assert.equal(q.queue(CWD, 'Ada', '🦊'), true);
  assert.equal(q.size, 1);

  const applied = q.settle([
    agent('claude-code:old', { lastActivityAt: 10 }),
    agent('claude-code:new', { lastActivityAt: 99 }),
    agent('claude-code:elsewhere', { cwd: OTHER, lastActivityAt: 500 }),
  ]);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].agent.id, 'claude-code:new', 'the + button meant the session it started');
  assert.equal(applied[0].name, 'Ada');
  assert.equal(applied[0].avatar, '🦊');
  assert.equal(q.size, 0, 'a matched entry leaves the queue and can never attach twice');
});

test('WP-84: THE BUG — a session the user has already named is never overwritten', () => {
  const { now } = fakeClock();
  const q = createPendingIdentities({ now });
  q.queue(CWD, 'Ada', null);

  // The newest session in the directory wears a name the USER chose. Before
  // the fix this matched it anyway, because the filter was reading a field
  // the raw merge does not carry.
  const applied = q.settle([
    agent('claude-code:named', { lastActivityAt: 99, displayName: 'Hopper' }),
  ]);
  assert.deepEqual(applied, [], 'a queued name outranked a name the user typed');
  assert.equal(q.size, 1, 'and the queued name is still waiting for a session of its own');

  // It lands on the next session that arrives without one, and leaves the
  // named one exactly as it was.
  const later = q.settle([
    agent('claude-code:named', { lastActivityAt: 99, displayName: 'Hopper' }),
    agent('claude-code:fresh', { lastActivityAt: 120 }),
  ]);
  assert.equal(later.length, 1);
  assert.equal(later[0].agent.id, 'claude-code:fresh');
});

test('WP-84: a daemon-given name is not a user-chosen one', () => {
  // Every agent has a `givenName` — the daemon assigns one on sight — so a
  // match that looked at THAT would match nobody, which is the mirror of the
  // bug above and just as wrong.
  const { now } = fakeClock();
  const q = createPendingIdentities({ now });
  q.queue(CWD, 'Ada', null);
  const applied = q.settle([agent('claude-code:a', { givenName: 'Marco', displayName: null })]);
  assert.equal(applied.length, 1, 'a session wearing only a daemon-given name is still unnamed');
});

test('WP-84: a queued identity expires rather than waiting for ever', () => {
  const { now, advance } = fakeClock();
  const q = createPendingIdentities({ now });
  q.queue(CWD, 'Ada', null);

  // One second inside the window: the session could still arrive.
  advance(PENDING_IDENTITY_TTL_MS - 1000);
  assert.deepEqual(q.settle([]), [], 'nothing is in that directory yet');
  assert.equal(q.size, 1, 'and the name is still waiting');

  // Past it: the terminal never produced a session, and a name that attaches
  // to whatever turns up an hour later is worse than no name at all.
  advance(2000);
  assert.deepEqual(q.settle([agent('claude-code:late', { lastActivityAt: 900 })]), []);
  assert.equal(q.size, 0, 'the expired entry was dropped');
});

test('WP-84: ten minutes, on the injected clock', () => {
  assert.equal(PENDING_IDENTITY_TTL_MS, 10 * 60 * 1000);
  // A queue built with no clock at all still works — it takes the daemon's.
  const q = createPendingIdentities();
  q.queue(CWD, 'Ada', null);
  assert.equal(q.size, 1);
  assert.equal(typeof q.peek()[0].at, 'number');
});

test('WP-84: nothing is queued without a choice to remember', () => {
  const { now } = fakeClock();
  const q = createPendingIdentities({ now });
  assert.equal(q.queue(CWD, null, null), false);
  assert.equal(q.queue(CWD, '', undefined), false);
  assert.equal(q.size, 0);
  assert.equal(q.queue(CWD, null, '🦊'), true, 'an avatar alone is a choice');
});

test('WP-84: two names queued for one directory do not both land on one session', () => {
  const { now } = fakeClock();
  const q = createPendingIdentities({ now });
  q.queue(CWD, 'Ada', null);
  q.queue(CWD, 'Grace', null);

  const one = q.settle([agent('claude-code:first', { lastActivityAt: 50 })]);
  assert.equal(one.length, 1);
  assert.equal(one[0].name, 'Ada', 'the older choice is served first');
  assert.equal(q.size, 1);

  const two = q.settle([
    agent('claude-code:first', { lastActivityAt: 50, displayName: 'Ada' }),
    agent('claude-code:second', { lastActivityAt: 70 }),
  ]);
  assert.equal(two.length, 1);
  assert.equal(two[0].agent.id, 'claude-code:second');
  assert.equal(two[0].name, 'Grace');
});

test('WP-84: a name is written where the floor reads it, across a resume', () => {
  // §155. The live end of a resume chain wears the chain's earliest identity,
  // so the route writes to `identityId`. This queue hands the agent back
  // whole rather than an id, precisely so that stays the route's one rule.
  const { now } = fakeClock();
  const q = createPendingIdentities({ now });
  q.queue(CWD, 'Ada', null);
  const applied = q.settle([
    agent('claude-code:resumed', { identityId: 'claude-code:original', lastActivityAt: 9 }),
  ]);
  assert.equal(applied[0].agent.identityId, 'claude-code:original');
});

test('WP-84: the route reads the source that carries displayName', async () => {
  // The static half of the fix. `registry.agents` never carries `displayName`
  // and never will — identity is applied in `snapshot()` — so a filter on it
  // is a clause that is always true, wearing the words of a real condition.
  const fs = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Comments blanked, for the reason §143's static gate blanks them: the
  // comment above this very code names both `registry.agents` and
  // `displayName`, explaining why they must not meet, and a checker that
  // reads prose as code cries wolf until somebody deletes it.
  const src = fs
    .readFileSync(path.resolve(here, '../../src/http/routes/actions.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
  const block = src.slice(src.indexOf('pendingIdentities'));
  assert.ok(
    !/registry\.agents[\s\S]{0,200}displayName/.test(block),
    'the pending-identity match is reading registry.agents for displayName again',
  );
  assert.match(
    block,
    /registry\.snapshot\(\)\.agents/,
    'the pending-identity match must read the snapshot, which is where identity is applied',
  );
  assert.ok(!/Date\.now\(\)/.test(block), 'the pending-identity queue is back on the wall clock');
});

test('WP-84: settling against nobody costs nothing and keeps the queue', () => {
  const { now } = fakeClock();
  const q = createPendingIdentities({ now });
  q.queue(CWD, 'Ada', null);
  assert.deepEqual(q.settle(undefined), []);
  assert.deepEqual(q.settle([]), []);
  assert.equal(q.size, 1);
});
