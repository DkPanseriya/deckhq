/**
 * WP-18 — the daily postcard.
 *
 * Three things this suite is for, in the order they matter:
 *
 *   1. **The copy never addresses the reader.** `docs/plan/08-PLAN-V2-100X.md`
 *      §1.1 rule 6 and `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §5. The
 *      failure mode is not a designed feature — it is one sentence written in
 *      the wrong person during a later edit — so the generator is driven over
 *      synthetic stats spanning every branch it has, and every string literal
 *      in the file is scanned as well, exactly as `records.test.mjs` does.
 *   2. **It appears once per local day, at most.** §3.3: "it appears once, it
 *      does not nag".
 *   3. **The numbers reconcile with the ledger.** The window digest is asserted
 *      against a hand-built ledger whose answer can be counted by eye.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CARDS_OFF,
  EVENING_HOUR,
  dayKeyOf,
  lightsOut,
  postcardCopy,
  roomName,
  spendToday,
  startOfDay,
} from '../../public/postcard.js';
import { windowDigest } from '../../src/core/ledger.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A local timestamp on a fixed day, so the tests do not depend on when they run. */
function at(hour, minute = 0) {
  return new Date(2026, 8, 8, hour, minute, 0, 0).getTime(); // Tuesday 8 Sep 2026
}

// ----------------------------------------------------------- when it appears

test('the card waits for the configured hour', () => {
  assert.equal(lightsOut({ now: at(21, 59), lightsOutHour: 22, liveCount: 3 }).show, false);
  const out = lightsOut({ now: at(22, 0), lightsOutHour: 22, liveCount: 3 });
  assert.equal(out.show, true);
  assert.equal(out.reason, 'hour');
  assert.equal(out.day, '2026-09-08');
});

test('a floor that empties in the evening is lights out, and one that empties at lunchtime is not', () => {
  // §3.3's other trigger: "when the last live session ends".
  assert.equal(
    lightsOut({ now: at(EVENING_HOUR), lightsOutHour: 22, liveCount: 0 }).reason,
    'quiet',
  );
  assert.equal(
    lightsOut({ now: at(EVENING_HOUR - 1), lightsOutHour: 22, liveCount: 0 }).show,
    false,
  );
  // Somebody still working in the evening is not the end of the day.
  assert.equal(lightsOut({ now: at(20), lightsOutHour: 22, liveCount: 1 }).show, false);
});

test('once per local day, and never twice', () => {
  const first = lightsOut({ now: at(22), lightsOutHour: 22, liveCount: 0 });
  assert.equal(first.show, true);
  assert.equal(
    lightsOut({ now: at(23, 30), lightsOutHour: 22, liveCount: 0, shownDay: first.day }).show,
    false,
    'the same day must not earn a second card',
  );
  // A new day does.
  const tomorrow = new Date(2026, 8, 9, 22).getTime();
  assert.equal(lightsOut({ now: tomorrow, lightsOutHour: 22, shownDay: first.day }).show, true);
});

test('the marker `off` switches the card off for good', () => {
  assert.equal(lightsOut({ now: at(22), lightsOutHour: 22, shownDay: CARDS_OFF }).show, false);
  assert.equal(
    lightsOut({ now: new Date(2027, 0, 1, 23).getTime(), shownDay: CARDS_OFF }).show,
    false,
  );
});

test('a floor that has not loaded yet shows nothing', () => {
  assert.equal(lightsOut({ now: at(23), ready: false }).show, false);
});

test('an hour outside 0..23 in settings still produces a card', () => {
  // The store clamps, but a client reading a hand-edited state.json must not
  // silently stop producing the one thing this feature promises.
  assert.equal(lightsOut({ now: at(23), lightsOutHour: 'nonsense', liveCount: 0 }).show, true);
});

test('midnight is the day boundary, and it is local', () => {
  const noon = at(12);
  const midnight = startOfDay(noon);
  assert.equal(new Date(midnight).getHours(), 0);
  assert.equal(new Date(midnight).getDate(), new Date(noon).getDate());
  assert.equal(dayKeyOf(noon), '2026-09-08');
});

// ------------------------------------------------------ the numbers it says

/** One `state` record. */
function state(t, sessionId, projectKey, from, to) {
  return { t, sessionId, projectKey, kind: 'state', dim: 'activity', from, to };
}

test('the window digest counts what a person would count by hand', () => {
  const day = startOfDay(at(12));
  const recs = [
    // orbital-api: two turns, both finished and both cleared.
    state(day + 9 * HOUR, 's1', 'orb', 'ended', 'working'),
    state(day + 9 * HOUR + 20 * MINUTE, 's1', 'orb', 'working', 'for_review'),
    state(day + 10 * HOUR, 's1', 'orb', 'for_review', 'ended'),
    state(day + 11 * HOUR, 's2', 'orb', 'ended', 'working'),
    state(day + 11 * HOUR + 5 * MINUTE, 's2', 'orb', 'working', 'for_review'),
    state(day + 11 * HOUR + 35 * MINUTE, 's2', 'orb', 'for_review', 'ended'),
    // checkout-flow: one turn, still waiting.
    state(day + 9 * HOUR, 's3', 'chk', 'ended', 'working'),
    state(day + 9 * HOUR + 30 * MINUTE, 's3', 'chk', 'working', 'for_review'),
    // A stall coming back is NOT a turn (`docs/DEVIATIONS.md` §107 rule 1).
    state(day + 12 * HOUR, 's1', 'orb', 'stalled', 'working'),
    { t: day + 9 * HOUR, sessionId: 's1', projectKey: 'orb', kind: 'tokens', delta: 40_000 },
    { t: day + 9 * HOUR, sessionId: 's3', projectKey: 'chk', kind: 'send', chars: 20 },
  ];
  const w = windowDigest(recs, { since: day, until: day + 14 * HOUR });

  assert.equal(w.turns, 3, 'three real turns; the stall resuming is not a fourth');
  assert.equal(w.roomCount, 2);
  assert.equal(w.tokens, 40_000);
  assert.equal(w.sends, 1);
  assert.equal(w.discharges, 2);
  const orb = w.rooms.find((r) => r.projectKey === 'orb');
  assert.equal(orb.turns, 2);
  assert.equal(orb.discharges, 2);
  // The longest wait of the day is checkout-flow's, which has not ended.
  assert.equal(w.longestWait.projectKey, 'chk');
  assert.equal(w.longestWait.cleared, false);
  assert.equal(w.longestWait.ms, 4 * HOUR + 30 * MINUTE);
  assert.equal(w.busiestHour.hour, 9);
  assert.equal(w.mostSent.sessionId, 's3');
});

test('an open wait is measured to the end of the window, not to now', () => {
  const day = startOfDay(at(12));
  const recs = [state(day + HOUR, 's1', 'orb', 'working', 'for_review')];
  const a = windowDigest(recs, { since: day, until: day + 3 * HOUR });
  const b = windowDigest(recs, { since: day, until: day + 9 * HOUR });
  assert.equal(a.longestWait.ms, 2 * HOUR);
  assert.equal(b.longestWait.ms, 8 * HOUR);
});

test('a ledger younger than the window says where it starts', () => {
  const day = startOfDay(at(12));
  const recs = [state(day + 15 * HOUR, 's1', 'orb', 'ended', 'working')];
  const w = windowDigest(recs, { since: day - 7 * 24 * HOUR, until: day + 20 * HOUR });
  assert.equal(w.covered, false);
  assert.equal(w.firstDay, '2026-09-08');
  assert.equal(w.effectiveSince, day + 15 * HOUR);
});

// ------------------------------------------------------------------ the copy

/** A `/api/stats` body shaped like the spec's example. */
function statsFixture(now) {
  const day = startOfDay(now);
  return {
    since: day,
    now,
    projects: { orb: 'orbital-api', chk: 'checkout-flow' },
    window: {
      since: day,
      until: now,
      covered: true,
      firstDay: '2026-09-01',
      turns: 14,
      tokens: 2_400_000,
      roomCount: 4,
      rooms: [
        {
          projectKey: 'orb',
          turns: 8,
          discharges: 3,
          longestWaitMs: 30 * MINUTE,
          tokens: 1_000_000,
        },
        { projectKey: 'chk', turns: 6, discharges: 0, longestWaitMs: 4 * HOUR, tokens: 400_000 },
      ],
      longestWait: { ms: 26 * HOUR, projectKey: 'orb', cleared: true },
    },
  };
}

const FLOOR = {
  rateCardVersion: '2026-09-04',
  projects: [
    { id: 'orb', name: 'orbital-api', todaySpend: 12.4, costRated: true },
    { id: 'chk', name: 'checkout-flow', todaySpend: 6, costRated: true },
  ],
  agents: [
    { id: 'a', ackState: 'active', activityState: 'working' },
    { id: 'b', ackState: 'active', activityState: 'needs_input' },
    { id: 'c', ackState: 'active', activityState: 'for_review' },
    { id: 'd', ackState: 'benched', activityState: 'working' },
  ],
};

test('the card reads the way the spec writes it', () => {
  const now = at(22);
  const copy = postcardCopy({ stats: statsFixture(now), snapshot: FLOOR, now });
  assert.equal(copy.weekday, 'Tuesday');
  assert.match(copy.text, /^Tuesday\. 14 turns across 4 rooms\./);
  assert.match(copy.text, /orbital-api shipped 3/);
  assert.match(copy.text, /checkout-flow waited 4h/);
  assert.match(copy.text, /2 agents still up/);
  assert.match(copy.text, /≈ \$18\.40 list price, rate card 2026-09-04/);
  assert.match(copy.text, /Longest wait today: 1d 2h → cleared/);
});

test('every money line says it is an estimate and names its rate card', () => {
  // Standing rule 7, asserted as literal text — the same discipline
  // `rates.test.mjs` applies to every other cost surface.
  const now = at(22);
  const copy = postcardCopy({ stats: statsFixture(now), snapshot: FLOOR, now });
  const money = copy.lines.filter((l) => /\$/.test(l));
  assert.equal(money.length, 1);
  for (const line of money) {
    assert.match(line, /list price/);
    assert.doesNotMatch(line, /(?<!not a )bill/);
    assert.match(line, /rate card \d{4}-\d{2}-\d{2}/);
  }
});

test('a room with no rate produces tokens, never a zero where money goes', () => {
  const now = at(22);
  const stats = statsFixture(now);
  const copy = postcardCopy({
    stats,
    snapshot: { ...FLOOR, projects: [{ id: 'orb', name: 'orbital-api', costRated: false }] },
    now,
  });
  assert.equal(
    copy.lines.some((l) => /\$/.test(l)),
    false,
    'zero is a claim about the money we do not have',
  );
  assert.match(copy.text, /2\.4M tokens, no rate for them/);
});

test('a quiet day says so rather than printing zeroes', () => {
  const now = at(22);
  const copy = postcardCopy({
    stats: {
      projects: {},
      window: { turns: 0, rooms: [], roomCount: 0, tokens: 0, covered: true },
    },
    snapshot: { agents: [], projects: [] },
    now,
  });
  assert.equal(copy.lines[0], 'A quiet day on the floor.');
  assert.doesNotMatch(copy.text, /0 turns/);
});

test('a wait that is still standing does not borrow the nicer ending', () => {
  const now = at(22);
  const stats = statsFixture(now);
  stats.window.longestWait = { ms: 3 * HOUR, projectKey: 'chk', cleared: false };
  const copy = postcardCopy({ stats, snapshot: FLOOR, now });
  assert.match(copy.text, /Longest wait today: 3h → still standing/);
  assert.doesNotMatch(copy.text, /cleared/);
});

test('a young ledger says where it starts', () => {
  const now = at(22);
  const stats = statsFixture(now);
  stats.window.covered = false;
  stats.window.firstDay = '2026-09-08';
  const copy = postcardCopy({ stats, snapshot: FLOOR, now });
  assert.match(copy.text, /Counted since 2026-09-08, which is where this ledger starts/);
});

test('a room the floor cannot name stays a hash and never a wrong name', () => {
  assert.equal(roomName({ projects: { orb: 'orbital-api' } }, 'orb'), 'orbital-api');
  assert.equal(roomName({ projects: {} }, 'abc1234567'), 'abc123');
  assert.equal(roomName(null, ''), 'a room');
});

test('the day’s spend counts only rooms that have one', () => {
  assert.deepEqual(spendToday(FLOOR), { spend: 18.4, rated: 2, unrated: 0 });
  assert.deepEqual(spendToday({ projects: [{ costRated: false }] }), {
    spend: 0,
    rated: 0,
    unrated: 1,
  });
  assert.deepEqual(spendToday(null), { spend: 0, rated: 0, unrated: 0 });
});

// ------------------------------------------ never scoring the human, as a test

/**
 * The same detector `records.test.mjs` uses, with the same single allowance.
 * "waiting on you" is the product's own noun phrase for the queue and is a
 * description of a state, not a reproach.
 */
const ALLOWED = ['waiting on you'];
const SECOND_PERSON = /\b(you|your|yours|you've|you're|you'll|you’ve|you’re|you’ll)\b/i;

/** @param {string} text */
function addressesTheReader(text) {
  let t = String(text).toLowerCase();
  for (const phrase of ALLOWED) t = t.split(phrase).join(' ');
  return SECOND_PERSON.test(t);
}

test('no generated postcard line addresses the reader', () => {
  const now = at(22);
  /** Every branch the generator has, driven rather than inspected. */
  const bodies = [
    { stats: statsFixture(now), snapshot: FLOOR },
    {
      stats: { projects: {}, window: { turns: 0, rooms: [], roomCount: 0, covered: true } },
      snapshot: { agents: [], projects: [] },
    },
    {
      stats: (() => {
        const s = statsFixture(now);
        s.window.covered = false;
        s.window.longestWait.cleared = false;
        return s;
      })(),
      snapshot: { ...FLOOR, projects: [{ id: 'orb', name: 'orbital-api', costRated: false }] },
    },
  ];
  for (const b of bodies) {
    const copy = postcardCopy({ ...b, now });
    assert.equal(
      addressesTheReader(copy.text),
      false,
      `the postcard addressed the reader: ${copy.text}`,
    );
  }
});

test('no string literal in postcard.js addresses the reader', () => {
  // The fixture cannot reach every branch, and the failure this guards against
  // is a sentence added later. So the file's own copy is read whole.
  const src = fs
    .readFileSync(path.join(ROOT, 'public', 'postcard.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const literals = src.match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) || [];
  const offenders = literals.filter((l) => addressesTheReader(l));
  assert.deepEqual(offenders, [], 'postcard copy must never address the reader');
});
