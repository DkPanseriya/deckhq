/**
 * WP-45 — floor replay, "watch yesterday".
 *
 * ============================================================================
 * INVARIANT: watching what happened cannot change what happened.
 *
 * `docs/01-PRODUCT.md` §2. A replay is a READ of the ledger and of nothing
 * else. This file drives a whole day through it, frame by frame to the end,
 * against a ledger whose records include acknowledgements — and asserts that
 * the `Store`'s ack state is byte-identical afterwards, that the ledger
 * directory has not been written to, and that `reconstructQueue`'s own answer
 * is unchanged by having been asked. There is no writer anywhere in
 * `src/core/replay.mjs` or `src/http/routes/replay.mjs`; this is the test that
 * says so out loud, so a later change that added one fails here.
 * ============================================================================
 *
 * The second thing this file holds is the free-core decision. Floor replay is
 * listed in the Supporter pack in `08` §5 and ships FREE, because a feature
 * that reads the user's own ledger cannot be sold without becoming a gate on
 * data they already own (`08` §1.1 rule 2). Nothing in the replay path
 * mentions a pack, and a test asserts it.
 *
 * The machine is pinned before `src/` is imported (`docs/DEVIATIONS.md` §124).
 */
import { ROOT } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { buildReplay, readReplay, replayDays, MAX_FRAMES, REPLAY_SPEED } =
  await import('../../src/core/replay.mjs');
const { dayKey, dayStart, projectKeyFor, reconstructQueue } =
  await import('../../src/core/ledger.mjs');
const { Store } = await import('../../src/core/store.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const HOUR = 60 * 60 * 1000;
const KEY = projectKeyFor('/work/api');

/** @param {number} t @param {string} kind @param {object} rest */
function rec(t, kind, rest) {
  return { t, machineId: 'm', projectKey: KEY, kind, ...rest };
}

/** A day with two sessions, one of which is acknowledged mid-afternoon. */
function aDay(t0) {
  return [
    rec(t0 + HOUR, 'session', {
      sessionId: 'a',
      event: 'first_seen',
      activity: 'working',
      ack: 'active',
      since: t0 + HOUR,
    }),
    rec(t0 + HOUR, 'session', {
      sessionId: 'b',
      event: 'first_seen',
      activity: 'working',
      ack: 'active',
      since: t0 + HOUR,
    }),
    rec(t0 + 2 * HOUR, 'state', {
      sessionId: 'a',
      dim: 'activity',
      from: 'working',
      to: 'for_review',
    }),
    rec(t0 + 3 * HOUR, 'state', {
      sessionId: 'b',
      dim: 'activity',
      from: 'working',
      to: 'needs_input',
    }),
    // The user acts. This is the record a replay must be able to READ and must
    // never be able to WRITE.
    rec(t0 + 5 * HOUR, 'state', {
      sessionId: 'a',
      dim: 'activity',
      from: 'for_review',
      to: 'working',
    }),
    rec(t0 + 6 * HOUR, 'state', { sessionId: 'b', dim: 'ack', from: 'active', to: 'benched' }),
    // A record that changes nothing the queue can show. It must not become a
    // frame that redraws the identical floor.
    rec(t0 + 6.5 * HOUR, 'tokens', { sessionId: 'a', input: 100, output: 40 }),
  ];
}

test('a frame lands on every change of the queue, and nowhere else', () => {
  const t0 = dayStart('2026-09-03');
  const day = '2026-09-03';
  const replay = buildReplay(aDay(t0), { day, now: t0 + 12 * HOUR });

  assert.equal(replay.day, day);
  assert.equal(replay.from, t0);
  assert.equal(replay.speed, REPLAY_SPEED);

  // Open, a enters, b enters, a leaves, b is benched. The token record adds
  // nothing and the two `first_seen`s at the same instant are one moment.
  assert.deepEqual(
    replay.frames.map((f) => [f.t - t0, f.queue.map((q) => q.sessionId)]),
    [
      [0, []],
      [2 * HOUR, ['a']],
      [3 * HOUR, ['a', 'b']],
      [5 * HOUR, ['b']],
      [6 * HOUR, []],
    ],
  );
  assert.equal(replay.thinned, false);
  assert.equal(replay.sessions, 2);
  assert.deepEqual(replay.projects, [KEY]);
});

test('every frame is exactly what reconstructQueue answers at that moment', () => {
  const t0 = dayStart('2026-09-03');
  const records = aDay(t0);
  const replay = buildReplay(records, { day: '2026-09-03', now: t0 + 12 * HOUR });
  for (const frame of replay.frames) {
    assert.deepEqual(
      frame.queue,
      reconstructQueue(records, frame.t),
      `frame at +${(frame.t - t0) / HOUR}h is not the ledger's own answer`,
    );
  }
});

test('the window opens with what yesterday left behind, not with an empty floor', () => {
  const yesterday = dayStart('2026-09-02');
  const today = dayStart('2026-09-03');
  const records = [
    rec(yesterday + 20 * HOUR, 'session', {
      sessionId: 'late',
      event: 'first_seen',
      activity: 'for_review',
      ack: 'active',
      since: yesterday + 20 * HOUR,
    }),
  ];
  const replay = buildReplay(records, { day: '2026-09-03', now: today + 6 * HOUR });
  assert.deepEqual(
    replay.frames[0].queue.map((q) => q.sessionId),
    ['late'],
  );
});

test('a day that has not finished replays up to now, never past it', () => {
  const t0 = dayStart('2026-09-03');
  const replay = buildReplay(aDay(t0), { day: '2026-09-03', now: t0 + 7 * HOUR });
  assert.equal(replay.to, t0 + 7 * HOUR);
  assert.ok(replay.frames.every((f) => f.t <= replay.to));
});

test('a day with more changes than can be watched is thinned, and says so', () => {
  const t0 = dayStart('2026-09-03');
  /** @type {any[]} */
  const records = [];
  for (let i = 0; i < MAX_FRAMES * 2; i++) {
    records.push(
      rec(t0 + i * 30_000, 'session', {
        sessionId: `s${i}`,
        event: 'first_seen',
        activity: 'for_review',
        ack: 'active',
        since: t0 + i * 30_000,
      }),
    );
  }
  const replay = buildReplay(records, { day: '2026-09-03', now: t0 + 23 * HOUR });
  assert.equal(replay.thinned, true);
  assert.ok(replay.frames.length <= MAX_FRAMES);
});

test('a day that is not a day is refused rather than guessed at', () => {
  assert.throws(() => buildReplay([], { day: 'yesterday' }), /YYYY-MM-DD/);
  assert.throws(() => buildReplay([], { day: '' }), /YYYY-MM-DD/);
});

test('replayDays lists newest first and names today and yesterday', async () => {
  const dir = path.join(ROOT, 'replay-ledger');
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.parse('2026-09-03T12:00:00Z');
  const days = ['2026-09-01', '2026-09-02', '2026-09-03'];
  for (const day of days) fs.writeFileSync(path.join(dir, `${day}.jsonl`), '');
  const listed = await replayDays(dir, { now });
  assert.deepEqual(
    listed.map((d) => d.day),
    [dayKey(now), ...days.filter((d) => d !== dayKey(now))].slice(0, days.length).sort().reverse(),
  );
  const today = listed.find((d) => d.day === dayKey(now));
  const yesterday = listed.find((d) => d.day === dayKey(now - 24 * HOUR));
  assert.equal(today?.label, 'today');
  assert.equal(yesterday?.label, 'yesterday');
});

test('INVARIANT: replaying a whole day changes no acknowledgement and writes nothing', async () => {
  const dir = path.join(ROOT, 'invariant-ledger');
  fs.mkdirSync(dir, { recursive: true });
  const t0 = dayStart('2026-09-03');
  const day = '2026-09-03';
  const file = path.join(dir, `${day}.jsonl`);
  fs.writeFileSync(
    file,
    aDay(t0)
      .map((r) => JSON.stringify(r))
      .join('\n') + '\n',
  );

  // A real store, with a real user-owned decision in it.
  const stateFile = path.join(ROOT, 'invariant-state.json');
  const store = new Store(stateFile);
  await store.load();
  store.setAck('claude-code:a', { state: 'benched' });
  await store.flush();
  const ackBefore = fs.readFileSync(stateFile, 'utf8');
  const ledgerBefore = fs.readFileSync(file, 'utf8');
  const ledgerStatBefore = fs.statSync(file).mtimeMs;

  // Drive the whole day, frame by frame, to the end — which is what the
  // client's transport does at 60x.
  const replay = await readReplay(dir, { day, now: t0 + 23 * HOUR });
  assert.ok(replay.frames.length > 1, 'there has to be something to watch');
  for (const frame of replay.frames) {
    assert.deepEqual(frame.queue, reconstructQueue(await recordsOf(file), frame.t));
  }

  // Nothing moved. Not the acknowledgement, not the ledger, not the file's
  // modification time.
  assert.equal(fs.readFileSync(stateFile, 'utf8'), ackBefore, 'a replay wrote to state.json');
  assert.equal(fs.readFileSync(file, 'utf8'), ledgerBefore, 'a replay wrote to the ledger');
  assert.equal(fs.statSync(file).mtimeMs, ledgerStatBefore, 'a replay touched the ledger file');

  const after = new Store(stateFile);
  await after.load();
  assert.equal(after.getAck('claude-code:a')?.state, 'benched', 'a replay changed an ackState');
});

/** @param {string} file */
async function recordsOf(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// ------------------------------------------------- the client's pure half

const { clockOf, frameIndexAt, frameToSnapshot, noteFor } = await import('../../public/replay.js');

test('a frame becomes a snapshot the floor can draw, and invents nothing', () => {
  const t = Date.parse('2026-09-03T14:07:00');
  const snapshot = frameToSnapshot(
    {
      t,
      queue: [
        { sessionId: 'a', projectKey: 'k1', activityState: 'for_review', since: t - 1000 },
        { sessionId: 'b', projectKey: 'k1', activityState: 'needs_input', since: t - 2000 },
        { sessionId: 'c', projectKey: 'k2', activityState: 'stalled', since: t - 3000 },
      ],
    },
    { projects: { k1: 'orbital-api' }, settings: { theme: 'blueprint' } },
  );

  assert.equal(snapshot.agents.length, 3);
  assert.equal(snapshot.projects.length, 2);
  assert.equal(snapshot.counts.needsYou, 3);
  assert.equal(snapshot.counts.working, 0);
  // The theme is the user's own, because it is still their floor.
  assert.equal(snapshot.settings.theme, 'blueprint');
  // `demo: true` is what keeps a replayed arrival from raising a notification,
  // playing a sound, or counting towards the office-cleared moment.
  assert.equal(snapshot.demo, true);

  // A ledger record carries no title, model, token count or cost, so the
  // snapshot carries none either. An invented number is worse than no number.
  for (const agent of snapshot.agents) {
    assert.equal(agent.title, '');
    assert.equal(agent.model, null);
    assert.equal(agent.tokens, 0);
    assert.equal(agent.costEstimate, null);
    assert.equal(agent.cwd, '', 'a replay must never put a path on the floor');
    assert.equal(agent.ackState, 'active');
  }

  // A project the registry could name is named; one it could not stays a
  // short slice of its hash, and never a path.
  const named = snapshot.projects.find((p) => p.id === 'k1');
  const unnamed = snapshot.projects.find((p) => p.id === 'k2');
  assert.equal(named.name, 'orbital-api');
  assert.match(unnamed.name, /^project k2$/);
  assert.equal(named.sessionCount, 2);
  assert.equal(named.needsYou, 2);
});

test('the scrub finds the frame covering any moment, including before the first', () => {
  const frames = [{ t: 10 }, { t: 20 }, { t: 30 }];
  assert.equal(frameIndexAt(frames, 5), -1);
  assert.equal(frameIndexAt(frames, 10), 0);
  assert.equal(frameIndexAt(frames, 19), 0);
  assert.equal(frameIndexAt(frames, 20), 1);
  assert.equal(frameIndexAt(frames, 999), 2);
  assert.equal(frameIndexAt([], 1), -1);
});

test('the clock reads in the machine’s own timezone — the ledger’s', () => {
  assert.equal(clockOf(Date.parse('2026-09-03T14:07:00')), '14:07');
  assert.equal(clockOf(Date.parse('2026-09-03T00:05:00')), '00:05');
});

test('the note says the floor is the QUEUE, not a reconstruction of the day', () => {
  assert.match(noteFor({}, 0), /Nobody was waiting on you/);
  assert.match(noteFor({}, 1), /One session was waiting/);
  assert.match(noteFor({}, 4), /4 sessions were waiting/);
  for (const n of [0, 1, 4]) {
    assert.match(noteFor({}, n), /not a reconstruction of the whole floor/);
  }
  assert.match(noteFor({ thinned: true }, 2), /thinned/);
});

test('the replay path is FREE: nothing in it knows what a pack is', () => {
  for (const file of ['src/core/replay.mjs', 'src/http/routes/replay.mjs', 'public/replay.js']) {
    const text = fs.readFileSync(path.join(REPO, file), 'utf8');
    // The word appears in the prose that explains WHY it is free. What must
    // not appear is a call into the pack machinery.
    assert.doesNotMatch(text, /from '.*packs\.mjs'/, `${file} imports the pack loader`);
    assert.doesNotMatch(text, /currentPacks|installPack|loadPacks/, `${file} reaches for a pack`);
  }
});

test('the replay routes are two GETs, and there is no writer among them', () => {
  const text = fs.readFileSync(path.join(REPO, 'src/http/routes/replay.mjs'), 'utf8');
  assert.equal((text.match(/router\.get\(/g) || []).length, 2);
  assert.equal(text.includes('router.post('), false, 'a replay route may never write');
  assert.doesNotMatch(text, /setAck|store\./, 'a replay route may never touch the store');
});
