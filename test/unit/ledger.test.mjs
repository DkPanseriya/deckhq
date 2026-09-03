/**
 * WP-17 + WP-48 — the event ledger, on its own.
 *
 * What these tests are protecting:
 *
 *   1. **No path ever reaches a record.** `projectKey` is a hash, and the
 *      hash agrees across Windows and POSIX spellings of the same directory
 *      so a ledger carried between machines still says "one project".
 *   2. **The write discipline.** Buffered, flushed at most every 2 s on a
 *      clock the test cranks by hand (the `store.mjs` lesson,
 *      `docs/DEVIATIONS.md` §80: never prove a debounce by sleeping), and an
 *      append rather than a rewrite, so a second writer cannot erase the
 *      first.
 *   3. **A failure is survivable and quiet.** An unwritable directory costs
 *      one log line for the life of the process and never throws.
 *   4. **A torn line costs one record, not the file.**
 *   5. **Retention prunes days and nothing else** in a directory that lives
 *      in the user's home.
 *   6. **The replay is the model's own rule.** `reconstructQueue` answers
 *      with `needsYou()`'s definition and nothing more, and an episode that
 *      spans midnight is still measured from where it started.
 *   7. **A signed export verifies, and a changed byte does not.**
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_RETENTION_DAYS,
  FLUSH_INTERVAL_MS,
  Ledger,
  clampRetentionDays,
  computeStats,
  dayKey,
  dayStart,
  keyFingerprint,
  listDays,
  loadOrCreateKey,
  parseRecords,
  percentile,
  projectKeyFor,
  readAll,
  readDay,
  reconstructQueue,
  reviewEpisodes,
  signBytes,
  verifyBytes,
} from '../../src/core/ledger.mjs';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

async function tmpDir(tag = 'ledger') {
  return fsp.mkdtemp(path.join(os.tmpdir(), `deckhq-${tag}-`));
}

async function cleanup(dir) {
  await fsp.rm(dir, { recursive: true, force: true });
}

/**
 * A clock the test cranks by hand, exactly as `store.test.mjs` does. A
 * 2-second flush proved by sleeping 2 seconds is a test that fails on a
 * loaded CI runner and teaches nothing.
 */
function fakeTimers() {
  /** @type {Set<{fn:() => void}>} */
  const pending = new Set();
  return {
    setTimeout(fn) {
      const handle = { fn, unref() {} };
      pending.add(handle);
      return handle;
    },
    clearTimeout(handle) {
      pending.delete(handle);
    },
    get size() {
      return pending.size;
    },
    run() {
      const all = [...pending];
      pending.clear();
      for (const h of all) h.fn();
    },
  };
}

function fakeLog() {
  const calls = { info: [], warn: [], error: [], debug: [] };
  return {
    calls,
    info: (...a) => calls.info.push(a),
    warn: (...a) => calls.warn.push(a),
    error: (...a) => calls.error.push(a),
    debug: (...a) => calls.debug.push(a),
  };
}

// ---------------------------------------------------------------------------
// 1. Keys, days and the promise that no path is written down
// ---------------------------------------------------------------------------

test('projectKeyFor is a hash, not a path, and it agrees across separators and case', () => {
  const a = projectKeyFor('C:\\Work\\orbital-api');
  const b = projectKeyFor('c:/work/orbital-api/');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.ok(!a.includes('orbital'));
  assert.ok(!a.includes('work'));
});

test('projectKeyFor separates two projects, and an empty cwd is "unknown"', () => {
  assert.notEqual(projectKeyFor('/work/a'), projectKeyFor('/work/b'));
  assert.equal(projectKeyFor(''), 'unknown');
  assert.equal(projectKeyFor(null), 'unknown');
});

test('PRIVACY: no field of a written record contains a path segment', async () => {
  const dir = await tmpDir();
  try {
    const led = new Ledger(dir, { machineId: 'm'.repeat(32), flushIntervalMs: 0 });
    led.record('state', {
      sessionId: 'claude-code:abc',
      projectKey: projectKeyFor('C:\\Users\\ada\\secret-startup'),
      dim: 'activity',
      from: 'working',
      to: 'for_review',
    });
    await led.flush();
    const raw = fs.readFileSync(led.dayFile(dayKey(Date.now())), 'utf8');
    for (const needle of ['Users', 'ada', 'secret-startup', 'C:\\', 'C:/']) {
      assert.ok(!raw.includes(needle), `${needle} leaked into the ledger`);
    }
  } finally {
    await cleanup(dir);
  }
});

test('dayKey is local and dayStart round-trips it', () => {
  const t = new Date(2026, 8, 3, 23, 30).getTime();
  assert.equal(dayKey(t), '2026-09-03');
  assert.equal(dayStart('2026-09-03'), new Date(2026, 8, 3).getTime());
  assert.ok(Number.isNaN(dayStart('not-a-day')));
});

// ---------------------------------------------------------------------------
// 2. The write discipline
// ---------------------------------------------------------------------------

test('record() buffers and does not write; the flush happens on the 2 s timer', async () => {
  const dir = await tmpDir();
  const timers = fakeTimers();
  try {
    const led = new Ledger(dir, { machineId: 'x', timers });
    assert.equal(led.flushIntervalMs, FLUSH_INTERVAL_MS);
    led.record('send', { sessionId: 'a', chars: 3 });
    led.record('send', { sessionId: 'b', chars: 4 });
    assert.equal(led.pending, 2);
    assert.equal(fs.existsSync(led.dayFile(dayKey(Date.now()))), false);
    // Exactly one timer for many records — this is a rate limit, not a queue.
    assert.equal(timers.size, 1);

    timers.run();
    await led.flush();
    const records = await readDay(dir, dayKey(Date.now()));
    assert.equal(records.length, 2);
    assert.deepEqual(
      records.map((r) => r.sessionId),
      ['a', 'b'],
    );
  } finally {
    await cleanup(dir);
  }
});

test('every record carries t, machineId, projectKey, sessionId and kind', async () => {
  const dir = await tmpDir();
  try {
    const led = new Ledger(dir, { machineId: 'abc', now: () => 1700000000000 });
    led.record('action', {
      sessionId: 'claude-code:z',
      projectKey: 'deadbeefdeadbeef',
      action: 'acknowledge',
    });
    await led.flush();
    const [rec] = await readDay(dir, dayKey(1700000000000));
    assert.deepEqual(rec, {
      t: 1700000000000,
      machineId: 'abc',
      projectKey: 'deadbeefdeadbeef',
      sessionId: 'claude-code:z',
      kind: 'action',
      action: 'acknowledge',
    });
  } finally {
    await cleanup(dir);
  }
});

test('a second flush APPENDS rather than replacing the day', async () => {
  const dir = await tmpDir();
  try {
    const led = new Ledger(dir, { machineId: 'x', flushIntervalMs: 0 });
    led.record('send', { sessionId: 'a' });
    await led.flush();
    led.record('send', { sessionId: 'b' });
    await led.flush();
    const records = await readDay(dir, dayKey(Date.now()));
    assert.equal(records.length, 2);
  } finally {
    await cleanup(dir);
  }
});

test('a second Ledger over the same directory does not lose the first one\u2019s records', async () => {
  const dir = await tmpDir();
  try {
    const one = new Ledger(dir, { machineId: 'one' });
    const two = new Ledger(dir, { machineId: 'two' });
    one.record('send', { sessionId: 'a' });
    two.record('send', { sessionId: 'b' });
    await Promise.all([one.flush(), two.flush()]);
    const records = await readDay(dir, dayKey(Date.now()));
    assert.equal(records.length, 2);
    assert.deepEqual(new Set(records.map((r) => r.machineId)), new Set(['one', 'two']));
  } finally {
    await cleanup(dir);
  }
});

test('an unknown kind is refused rather than written', async () => {
  const dir = await tmpDir();
  try {
    const led = new Ledger(dir, { machineId: 'x' });
    assert.equal(led.record(/** @type {any} */ ('nonsense'), { sessionId: 'a' }), false);
    assert.equal(led.pending, 0);
  } finally {
    await cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// 3. Failure is survivable and quiet
// ---------------------------------------------------------------------------

test('a directory that cannot be written costs one warning, never a throw', async () => {
  const parent = await tmpDir();
  try {
    // A file where the directory should be: mkdir and open both fail.
    const blocker = path.join(parent, 'ledger');
    fs.writeFileSync(blocker, 'not a directory');
    const log = fakeLog();
    const led = new Ledger(blocker, { machineId: 'x', log, flushIntervalMs: 0 });

    for (let i = 0; i < 5; i++) {
      assert.equal(led.record('send', { sessionId: `s${i}` }), true);
      await led.flush();
    }
    assert.equal(log.calls.warn.length, 1, 'exactly one warning for the life of the process');
    assert.ok(led.writeError);
    assert.equal(led.stats.dropped, 5);
    // And it is still usable: nothing latched shut.
    assert.equal(led.record('send', { sessionId: 'again' }), true);
  } finally {
    await cleanup(parent);
  }
});

test('the buffer is bounded: a dead disk drops the oldest records, it does not grow', async () => {
  const dir = await tmpDir();
  try {
    const timers = fakeTimers();
    const led = new Ledger(dir, { machineId: 'x', timers, maxBuffered: 10 });
    for (let i = 0; i < 50; i++) led.record('send', { sessionId: `s${i}` });
    assert.equal(led.pending, 10);
    assert.equal(led.stats.dropped, 40);
    timers.run();
    await led.flush();
    const records = await readDay(dir, dayKey(Date.now()));
    // The survivors are the most recent, which is the useful half.
    assert.deepEqual(records[records.length - 1].sessionId, 's49');
  } finally {
    await cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// 4. Reading is tolerant
// ---------------------------------------------------------------------------

test('a torn or foreign line costs one record, not the file', () => {
  const text = [
    JSON.stringify({ t: 1, kind: 'send', sessionId: 'a' }),
    '{"t":2,"kind":"sen', // a power cut mid-append
    'null',
    '[]',
    '{"kind":"send"}', // no t
    '',
    JSON.stringify({ t: 3, kind: 'send', sessionId: 'b' }),
  ].join('\n');
  const records = parseRecords(text);
  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map((r) => r.sessionId),
    ['a', 'b'],
  );
});

test('readDay and readAll are empty rather than throwing on a missing directory', async () => {
  assert.deepEqual(await readDay(path.join(os.tmpdir(), 'deckhq-nope-xyz'), '2026-01-01'), []);
  assert.deepEqual(await readAll(path.join(os.tmpdir(), 'deckhq-nope-xyz')), []);
  assert.deepEqual(
    await readDay(path.join(os.tmpdir(), 'deckhq-nope-xyz'), '../../etc/passwd'),
    [],
  );
});

// ---------------------------------------------------------------------------
// 5. Retention
// ---------------------------------------------------------------------------

test('retention defaults to 90 days and is clamped, not trusted', () => {
  assert.equal(DEFAULT_RETENTION_DAYS, 90);
  assert.equal(clampRetentionDays(undefined), 90);
  assert.equal(clampRetentionDays('nonsense'), 90);
  assert.equal(clampRetentionDays(0), 1);
  assert.equal(clampRetentionDays(-5), 1);
  assert.equal(clampRetentionDays(1e9), 3650);
  assert.equal(clampRetentionDays(7.9), 7);
});

test('prune removes day files past the window and touches nothing else', async () => {
  const dir = await tmpDir();
  try {
    const now = Date.now();
    const write = (offsetDays, name) => {
      const day = dayKey(now - offsetDays * DAY);
      fs.writeFileSync(path.join(dir, name ?? `${day}.jsonl`), '{}\n');
      return day;
    };
    const today = write(0);
    const old = write(10);
    write(2);
    fs.writeFileSync(path.join(dir, `${old}.jsonl.sig`), '{}');
    fs.writeFileSync(path.join(dir, 'ledger-key.pem'), 'PRIVATE');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'mine');

    const led = new Ledger(dir, { machineId: 'x' });
    const result = await led.prune(3, now);

    assert.deepEqual(result.removed, [old]);
    assert.equal(result.kept, 2);
    assert.equal(fs.existsSync(path.join(dir, `${today}.jsonl`)), true);
    assert.equal(fs.existsSync(path.join(dir, `${old}.jsonl`)), false);
    assert.equal(fs.existsSync(path.join(dir, `${old}.jsonl.sig`)), false);
    // Anything that is not one of ours survives, whatever its age.
    assert.equal(fs.existsSync(path.join(dir, 'ledger-key.pem')), true);
    assert.equal(fs.existsSync(path.join(dir, 'notes.txt')), true);
  } finally {
    await cleanup(dir);
  }
});

test('prune on a directory that does not exist is a no-op, not an error', async () => {
  const led = new Ledger(path.join(os.tmpdir(), 'deckhq-nope-abc'), { machineId: 'x' });
  assert.deepEqual(await led.prune(90), { removed: [], kept: 0 });
});

// ---------------------------------------------------------------------------
// 6. prime() and one first_seen per session per day
// ---------------------------------------------------------------------------

test('a restart inside one day does not re-announce the floor', async () => {
  const dir = await tmpDir();
  try {
    const one = new Ledger(dir, { machineId: 'x', flushIntervalMs: 0 });
    await one.prime();
    assert.equal(one.markSeen('claude-code:a'), true);
    assert.equal(one.markSeen('claude-code:a'), false);
    one.record('session', {
      sessionId: 'claude-code:a',
      event: 'first_seen',
      activity: 'working',
      ack: 'active',
    });
    await one.close();

    const two = new Ledger(dir, { machineId: 'x', flushIntervalMs: 0 });
    await two.prime();
    assert.equal(two.markSeen('claude-code:a'), false, 'already in today\u2019s file');
    assert.equal(two.markSeen('claude-code:b'), true);
  } finally {
    await cleanup(dir);
  }
});

test('the day roll re-announces, so each day file stands on its own', async () => {
  const dir = await tmpDir();
  try {
    const t0 = new Date(2026, 8, 3, 23, 59).getTime();
    let now = t0;
    const led = new Ledger(dir, { machineId: 'x', now: () => now });
    await led.prime();
    assert.equal(led.markSeen('claude-code:a'), true);
    now = new Date(2026, 8, 4, 0, 1).getTime();
    assert.equal(led.markSeen('claude-code:a'), true, 'a new day is a new file');
  } finally {
    await cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// 7. Replay
// ---------------------------------------------------------------------------

const KEY = projectKeyFor('/work/api');

/** @param {number} t @param {string} kind @param {object} rest */
function rec(t, kind, rest) {
  return { t, machineId: 'm', projectKey: KEY, kind, ...rest };
}

test('reconstructQueue answers with needsYou()\u2019s rule and at the timestamp asked for', () => {
  const t0 = Date.parse('2026-09-03T09:00:00Z');
  const records = [
    rec(t0, 'session', {
      sessionId: 'a',
      event: 'first_seen',
      activity: 'working',
      ack: 'active',
      since: t0,
    }),
    rec(t0, 'session', {
      sessionId: 'b',
      event: 'first_seen',
      activity: 'working',
      ack: 'active',
      since: t0,
    }),
    rec(t0 + HOUR, 'state', { sessionId: 'a', dim: 'activity', from: 'working', to: 'for_review' }),
    rec(t0 + 2 * HOUR, 'state', {
      sessionId: 'b',
      dim: 'activity',
      from: 'working',
      to: 'needs_input',
    }),
    rec(t0 + 3 * HOUR, 'state', {
      sessionId: 'a',
      dim: 'activity',
      from: 'for_review',
      to: 'working',
    }),
  ];

  assert.deepEqual(reconstructQueue(records, t0).length, 0);
  assert.deepEqual(
    reconstructQueue(records, t0 + 90 * 60_000).map((x) => x.sessionId),
    ['a'],
  );
  assert.deepEqual(
    reconstructQueue(records, t0 + 2.5 * HOUR).map((x) => x.sessionId),
    ['a', 'b'],
  );
  assert.deepEqual(
    reconstructQueue(records, t0 + 4 * HOUR).map((x) => x.sessionId),
    ['b'],
  );
});

test('a benched or let-go session leaves the queue even while for_review', () => {
  const t0 = 1_700_000_000_000;
  const records = [
    rec(t0, 'session', {
      sessionId: 'a',
      event: 'first_seen',
      activity: 'for_review',
      ack: 'active',
      since: t0,
    }),
    rec(t0 + HOUR, 'state', { sessionId: 'a', dim: 'ack', from: 'active', to: 'benched' }),
  ];
  assert.equal(reconstructQueue(records, t0 + 10).length, 1);
  assert.equal(reconstructQueue(records, t0 + 2 * HOUR).length, 0);
  // ... and coming back off the bench puts the debt back, because benching
  // never cleared reviewSince.
  records.push(
    rec(t0 + 2 * HOUR, 'state', { sessionId: 'a', dim: 'ack', from: 'benched', to: 'active' }),
  );
  assert.equal(reconstructQueue(records, t0 + 3 * HOUR).length, 1);
});

test('an episode that spans midnight is measured from where it started', () => {
  const start = new Date(2026, 8, 3, 22, 0).getTime();
  const nextDay = new Date(2026, 8, 4, 0, 0, 1).getTime();
  const end = new Date(2026, 8, 4, 10, 0).getTime();
  const records = [
    // Tuesday's file
    rec(start - HOUR, 'session', {
      sessionId: 'a',
      event: 'first_seen',
      activity: 'working',
      ack: 'active',
      since: start - HOUR,
    }),
    rec(start, 'state', { sessionId: 'a', dim: 'activity', from: 'working', to: 'for_review' }),
    // Wednesday's file: the carry-over snapshot, with the real `since`
    rec(nextDay, 'session', {
      sessionId: 'a',
      event: 'first_seen',
      activity: 'for_review',
      ack: 'active',
      since: start,
    }),
    rec(end, 'state', { sessionId: 'a', dim: 'activity', from: 'for_review', to: 'working' }),
  ];
  const episodes = reviewEpisodes(records, { now: end });
  assert.equal(episodes.length, 1, 'one episode, not one per day');
  assert.equal(episodes[0].start, start);
  assert.equal(episodes[0].ms, end - start);

  // And Wednesday's file ALONE still reconstructs the queue and the wait.
  const wednesday = records.filter((r) => r.t >= nextDay);
  const queue = reconstructQueue(wednesday, nextDay + HOUR);
  assert.deepEqual(
    queue.map((x) => x.sessionId),
    ['a'],
  );
  assert.equal(queue[0].since, start);
});

test('percentile is nearest-rank and survives one value and none', () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([7], 0.9), 7);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
});

// ---------------------------------------------------------------------------
// 8. The numbers docs/01-PRODUCT.md §6 names
// ---------------------------------------------------------------------------

test('computeStats produces every number \u00a76 asks for', () => {
  const t0 = new Date(2026, 8, 1, 9, 0).getTime();
  const now = new Date(2026, 8, 4, 9, 0).getTime();
  const open = (id, at) =>
    rec(at, 'state', { sessionId: id, dim: 'activity', from: 'working', to: 'for_review' });
  const close = (id, at) =>
    rec(at, 'state', { sessionId: id, dim: 'activity', from: 'for_review', to: 'working' });

  const records = [
    rec(t0, 'session', {
      sessionId: 'a',
      event: 'first_seen',
      activity: 'working',
      ack: 'active',
      since: t0,
    }),
    rec(t0, 'session', {
      sessionId: 'b',
      event: 'first_seen',
      activity: 'working',
      ack: 'active',
      since: t0,
    }),
    rec(t0, 'session', {
      sessionId: 'c',
      event: 'first_seen',
      activity: 'working',
      ack: 'active',
      since: t0,
    }),
    open('a', t0),
    close('a', t0 + HOUR), // 1h
    open('b', t0),
    close('b', t0 + 3 * HOUR), // 3h
    open('c', t0),
    close('c', t0 + 30 * HOUR), // 30h — over a day
    // and one still open, 2 days old
    rec(now - 2 * DAY, 'session', {
      sessionId: 'd',
      event: 'first_seen',
      activity: 'working',
      ack: 'active',
      since: now - 2 * DAY,
    }),
    open('d', now - 2 * DAY),
    // traffic
    rec(t0 + HOUR, 'send', { sessionId: 'a', chars: 12 }),
    rec(t0 + 2 * HOUR, 'send', { sessionId: 'b', chars: 30 }),
    rec(t0 + HOUR, 'tokens', { sessionId: 'a', delta: 1000, tokens: 1000 }),
    rec(t0 + 2 * HOUR, 'tokens', { sessionId: 'b', delta: 500, tokens: 500 }),
  ];

  const stats = computeStats(records, { now, since: now - 7 * DAY });

  assert.equal(stats.forReview.discharged, 3);
  assert.equal(stats.forReview.medianMs, 3 * HOUR);
  assert.equal(stats.forReview.p90Ms, 30 * HOUR);
  assert.equal(stats.forReview.open, 1);
  // §6's first criterion: what is sitting there over 24h right now.
  assert.equal(stats.over24h, 1);
  // and the same question asked of history, which is what tells you it used
  // to happen: c's 30h episode plus d's open one.
  assert.equal(stats.everOver24h, 2);
  assert.equal(stats.dischargesPerDay[dayKey(t0)], 2);
  assert.equal(stats.dischargesPerDay[dayKey(t0 + 30 * HOUR)], 1);
  assert.equal(stats.sendsPerDay[dayKey(t0)], 2);
  assert.equal(stats.tokensPerProjectPerDay[dayKey(t0)][KEY], 1500);
  assert.equal(stats.longestWaitEver.ms, 2 * DAY);
  assert.equal(stats.longestWaitEver.sessionId, 'd');
  assert.equal(stats.longestWaitEver.date, dayKey(now - 2 * DAY));
  assert.equal(stats.longestWaitEver.open, true);
});

test('computeStats on an empty ledger reports nothing rather than a zero it invented', () => {
  const stats = computeStats([], { now: 1_700_000_000_000 });
  assert.equal(stats.forReview.medianMs, null);
  assert.equal(stats.forReview.p90Ms, null);
  assert.equal(stats.over24h, 0);
  assert.equal(stats.longestWaitEver, null);
  assert.equal(stats.records, 0);
});

test('a negative token delta is not counted as spend', () => {
  const t = 1_700_000_000_000;
  const stats = computeStats([rec(t, 'tokens', { sessionId: 'a', delta: -500, tokens: 0 })], {
    now: t + 1000,
    since: t - DAY,
  });
  assert.deepEqual(stats.tokensPerProjectPerDay, {});
});

// ---------------------------------------------------------------------------
// 9. WP-48 — the signed export
// ---------------------------------------------------------------------------

test('the signing key is generated once and reused, and asks for 0600', async () => {
  const dir = await tmpDir('key');
  try {
    const first = loadOrCreateKey(dir);
    assert.equal(first.created, true);
    assert.ok(first.privateKeyPem.includes('PRIVATE KEY'));
    assert.ok(first.publicKeyPem.includes('PUBLIC KEY'));
    const second = loadOrCreateKey(dir);
    assert.equal(second.created, false);
    assert.equal(second.privateKeyPem, first.privateKeyPem);
    assert.equal(second.publicKeyPem, first.publicKeyPem);
    assert.equal(keyFingerprint(first.publicKeyPem), keyFingerprint(second.publicKeyPem));
    // Windows does not enforce a mode; asserting one there would be asserting
    // a fiction. docs/DEVIATIONS.md §100.
    if (process.platform !== 'win32') assert.equal(first.mode, 0o600);
  } finally {
    await cleanup(dir);
  }
});

test('a signed day verifies, and one changed byte does not', async () => {
  const dir = await tmpDir('key');
  try {
    const key = loadOrCreateKey(dir);
    const bytes = Buffer.from(
      [JSON.stringify(rec(1, 'send', { sessionId: 'a' })), ''].join('\n'),
      'utf8',
    );
    const sig = signBytes(bytes, key, { day: '2026-09-03', machineId: 'a'.repeat(32), now: 1 });
    assert.equal(sig.alg, 'ed25519');
    assert.equal(sig.day, '2026-09-03');

    const good = verifyBytes(bytes, sig);
    assert.equal(good.ok, true);
    assert.equal(good.machineId, 'a'.repeat(32));
    assert.equal(good.records, 1);
    assert.equal(good.fingerprint, keyFingerprint(key.publicKeyPem));

    const tampered = Buffer.from(bytes.toString('utf8').replace('"a"', '"b"'), 'utf8');
    assert.equal(verifyBytes(tampered, sig).ok, false);
    assert.equal(verifyBytes(bytes, { ...sig, alg: 'rsa' }).ok, false);
    assert.equal(verifyBytes(bytes, null).ok, false);
    assert.equal(verifyBytes(bytes, { ...sig, sha256: 'nope' }).ok, false);
  } finally {
    await cleanup(dir);
  }
});

test('a signature from another key does not verify against this one', async () => {
  const a = await tmpDir('key-a');
  const b = await tmpDir('key-b');
  try {
    const keyA = loadOrCreateKey(a);
    const keyB = loadOrCreateKey(b);
    const bytes = Buffer.from('{"t":1,"kind":"send","sessionId":"a"}\n', 'utf8');
    const sigA = signBytes(bytes, keyA, { day: '2026-09-03', machineId: 'm', now: 1 });
    // Same signature document, somebody else's public key pasted in.
    const forged = { ...sigA, publicKey: keyB.publicKeyPem };
    assert.equal(verifyBytes(bytes, forged).ok, false);
  } finally {
    await cleanup(a);
    await cleanup(b);
  }
});

test('listDays returns only our day files, sorted oldest first', async () => {
  const dir = await tmpDir();
  try {
    for (const name of ['2026-09-03.jsonl', '2026-01-01.jsonl', 'notes.txt', 'x.jsonl']) {
      fs.writeFileSync(path.join(dir, name), '');
    }
    assert.deepEqual(await listDays(dir), ['2026-01-01', '2026-09-03']);
  } finally {
    await cleanup(dir);
  }
});
