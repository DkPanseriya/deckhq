/**
 * WP-46 — the team's records.
 *
 * Five things this file exists to hold:
 *
 *   1. **Each record is the record it claims to be.** Longest wait ever,
 *      busiest day, most turns in a week, the room that never slept, the
 *      fastest discharge day — each over a synthetic ledger built so the
 *      right answer is known by construction, and each carrying the day it
 *      was set.
 *   2. **A ledger younger than a week degrades rather than lies.** Every
 *      record carries `since`, the first day the ledger holds, and `partial`
 *      while that is less than a week ago.
 *   3. **The copy never scores the human.** `docs/plan/08-PLAN-V2-100X.md`
 *      §1.1 rule 6 and `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §5. The
 *      second person does not appear in any record's copy, in either surface,
 *      with exactly one allowance: "waiting on you" is the product's own noun
 *      phrase for the queue, not a reproach.
 *   4. **A record reaches the panel only when it is about that agent or its
 *      room**, and it says nothing at all otherwise.
 *   5. **Both surfaces publish it.** `GET /api/stats` and `deckhq stats
 *      --json` carry the same `records` object over the same directory.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MIN_DISCHARGES_FOR_FASTEST_DAY,
  RECORD_WINDOW_DAYS,
  addDays,
  dayKey,
  projectKeyFor,
  records,
} from '../../src/core/ledger.mjs';
import { renderRecords, runStats } from '../../src/cli/stats.mjs';
import { register as registerStats } from '../../src/http/routes/stats.mjs';
import { Router } from '../../src/http/server.mjs';
import { formatDay, formatDuration, recordLineFor } from '../../public/records.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIN = 60_000;
const HOUR = 60 * MIN;

const ALPHA = projectKeyFor('C:\\work\\orbital-api');
const BETA = projectKeyFor('C:\\work\\ground-station');

/**
 * Local noon today. Every fixture timestamp is built from calendar
 * components off this, so no test straddles a midnight or a clock change no
 * matter what hour the suite is run at.
 */
const NOON = (() => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.getTime();
})();

/** `daysAgo` days back from today, at a local hour. */
function at(daysAgo, hour = 12, minute = 0) {
  const d = new Date(NOON);
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() - daysAgo,
    hour,
    minute,
    0,
    0,
  ).getTime();
}

const day = (daysAgo) => dayKey(at(daysAgo));

/** One turn: a session starting work. */
function turn(t, { sessionId = 'claude-code:a', projectKey = ALPHA, from = 'ended' } = {}) {
  return {
    t,
    machineId: 'm',
    projectKey,
    sessionId,
    kind: 'state',
    dim: 'activity',
    from,
    to: 'working',
  };
}

/** A stretch in `for_review`, opened and closed. `end` null leaves it open. */
function wait(sessionId, projectKey, start, end) {
  const out = [
    {
      t: start,
      machineId: 'm',
      projectKey,
      sessionId,
      kind: 'state',
      dim: 'activity',
      from: 'working',
      to: 'for_review',
    },
  ];
  if (end != null) {
    // Discharged by being benched — an ack transition, so it closes the
    // episode without also counting as a turn.
    out.push({
      t: end,
      machineId: 'm',
      projectKey,
      sessionId,
      kind: 'state',
      dim: 'ack',
      from: 'active',
      to: 'benched',
    });
  }
  return out;
}

/** A token delta: activity at an hour, attributable to a project. */
function tokens(t, projectKey, sessionId = 'claude-code:a') {
  return { t, machineId: 'm', projectKey, sessionId, kind: 'tokens', delta: 100, tokens: 100 };
}

// ---------------------------------------------------------------------------
// Each record is the record it claims to be
// ---------------------------------------------------------------------------

test('an empty ledger has no records and says so without inventing a day', () => {
  const r = records([], { now: NOON });
  assert.equal(r.days, 0);
  assert.equal(r.partial, true);
  assert.equal(r.since, dayKey(NOON));
  for (const key of [
    'longestWait',
    'busiestDay',
    'busiestWeek',
    'neverSlept',
    'fastestDischargeDay',
  ]) {
    assert.equal(r[key], null, `${key} should be absent`);
  }
});

test('the longest wait ever is the longest, with the day that stretch began', () => {
  const list = [
    ...wait('claude-code:short', ALPHA, at(9, 9), at(9, 10)),
    // 2d 12h, begun on the day 8 days ago.
    ...wait('claude-code:long', BETA, at(8, 6), at(5, 18)),
    ...wait('claude-code:middling', ALPHA, at(3, 9), at(3, 20)),
  ];
  const r = records(list, { now: NOON });
  assert.equal(r.longestWait.sessionId, 'claude-code:long');
  assert.equal(r.longestWait.projectKey, BETA);
  assert.equal(r.longestWait.ms, at(5, 18) - at(8, 6));
  assert.equal(r.longestWait.date, day(8), 'dated by when the wait began, not when it ended');
  assert.equal(r.longestWait.open, false);
});

test('a wait still going is a record, and is marked open', () => {
  const r = records(wait('claude-code:a', ALPHA, at(4, 8), null), { now: NOON });
  assert.equal(r.longestWait.open, true);
  assert.equal(r.longestWait.date, day(4));
  assert.ok(r.longestWait.ms >= 3 * 24 * HOUR);
});

test('the busiest day counts turns, and a stall coming back is not a new turn', () => {
  const list = [
    turn(at(10, 9)),
    turn(at(10, 11)),
    // Three on the day 6 days ago …
    turn(at(6, 8)),
    turn(at(6, 10), { from: 'for_review' }),
    turn(at(6, 15), { from: 'needs_input' }),
    // … plus two resumptions from a stall, which are the same turns going on.
    turn(at(6, 16), { from: 'stalled' }),
    turn(at(6, 17), { from: 'stalled' }),
    // … and one no-op the state machine would never write, guarded anyway.
    turn(at(6, 18), { from: 'working' }),
    turn(at(2, 9)),
  ];
  const r = records(list, { now: NOON });
  assert.equal(r.busiestDay.turns, 3);
  assert.equal(r.busiestDay.date, day(6));
});

test('the busiest day breaks a tie in favour of the day that set the record first', () => {
  const r = records([turn(at(5, 9)), turn(at(5, 10)), turn(at(2, 9)), turn(at(2, 10))], {
    now: NOON,
  });
  assert.equal(r.busiestDay.turns, 2);
  assert.equal(r.busiestDay.date, day(5));
});

test('most turns in a week is a rolling seven days, and names the window', () => {
  /** @type {any[]} */
  const list = [];
  // Two turns a day for twenty days, then a burst of ten on one day: the
  // best window is the one that contains the burst.
  for (let d = 20; d >= 1; d--) {
    list.push(turn(at(d, 9)), turn(at(d, 15)));
  }
  for (let i = 0; i < 10; i++) list.push(turn(at(4, 10, i)));
  const r = records(list, { now: NOON });
  // Seven days at two, plus the ten extra on the day four days ago.
  assert.equal(r.busiestWeek.turns, 24);
  assert.equal(r.busiestWeek.to, r.busiestWeek.date);
  assert.equal(addDays(r.busiestWeek.to, -(RECORD_WINDOW_DAYS - 1)), r.busiestWeek.from);
  // The window has to contain the burst.
  assert.ok(r.busiestWeek.from <= day(4) && day(4) <= r.busiestWeek.to);
});

test('the room that never slept is the project with activity in the most hours of the day', () => {
  /** @type {any[]} */
  const list = [];
  // Alpha, every hour of one night and day inside the window: 24 of 24.
  for (let h = 0; h < 24; h++) list.push(tokens(at(3, h), ALPHA));
  // Beta, office hours only, on every day of the window: 8 of 24.
  for (let d = 6; d >= 0; d--) {
    for (let h = 9; h < 17; h++) list.push(tokens(at(d, h), BETA, 'claude-code:b'));
  }
  // Alpha again, wall to wall, but two weeks ago — outside the window, so it
  // must not be what wins.
  for (let h = 0; h < 24; h++) list.push(tokens(at(14, h), BETA, 'claude-code:b'));
  const r = records(list, { now: NOON });
  assert.equal(r.neverSlept.projectKey, ALPHA);
  assert.equal(r.neverSlept.hours, 24);
  assert.equal(r.neverSlept.to, dayKey(NOON));
  assert.equal(r.neverSlept.from, day(RECORD_WINDOW_DAYS - 1));
});

test('the room that never slept ignores records with no project', () => {
  const list = [];
  for (let h = 0; h < 24; h++) {
    list.push({ ...tokens(at(2, h), ALPHA), projectKey: 'unknown' });
  }
  list.push(tokens(at(2, 9), BETA, 'claude-code:b'));
  const r = records(list, { now: NOON });
  assert.equal(r.neverSlept.projectKey, BETA);
  assert.equal(r.neverSlept.hours, 1);
});

test('the fastest discharge day is a median, and one quick click is not a day', () => {
  /** @type {any[]} */
  const list = [];
  // Nine days ago: one discharge, two minutes. Below the floor, so it cannot
  // hold the record however fast it was.
  list.push(...wait('claude-code:blink', ALPHA, at(9, 9), at(9, 9, 2)));
  // Six days ago: four discharges, median one hour.
  for (let i = 0; i < 4; i++) {
    list.push(...wait(`claude-code:six-${i}`, ALPHA, at(6, 8), at(6, 9)));
  }
  // Three days ago: three discharges, median ten minutes — the record.
  for (let i = 0; i < MIN_DISCHARGES_FOR_FASTEST_DAY; i++) {
    list.push(...wait(`claude-code:three-${i}`, ALPHA, at(3, 8), at(3, 8, 10)));
  }
  const r = records(list, { now: NOON });
  assert.equal(r.fastestDischargeDay.date, day(3));
  assert.equal(r.fastestDischargeDay.medianMs, 10 * MIN);
  assert.equal(r.fastestDischargeDay.discharged, MIN_DISCHARGES_FOR_FASTEST_DAY);
});

test('a ledger with no day above the discharge floor simply has no fastest day', () => {
  const r = records(wait('claude-code:a', ALPHA, at(2, 8), at(2, 9)), { now: NOON });
  assert.equal(r.fastestDischargeDay, null);
  assert.ok(r.longestWait, 'the other records are unaffected');
});

// ---------------------------------------------------------------------------
// Degrading with less than a week of ledger
// ---------------------------------------------------------------------------

test('a ledger younger than a week reports what it has and dates it', () => {
  const list = [
    turn(at(2, 9)),
    turn(at(1, 9)),
    ...wait('claude-code:a', ALPHA, at(2, 10), at(1, 10)),
    tokens(at(1, 3), ALPHA),
  ];
  const r = records(list, { now: NOON });
  assert.equal(r.days, 3, 'two days ago, yesterday and today');
  assert.equal(r.partial, true);
  assert.equal(r.since, day(2));
  // The window the rolling records looked at is clipped to the ledger, not
  // padded out to a week that did not happen.
  assert.equal(r.neverSlept.from, day(2));
  assert.equal(r.busiestWeek.from, day(2));
  // Every record carries it, so one of them can travel on its own.
  for (const key of ['longestWait', 'busiestDay', 'busiestWeek', 'neverSlept']) {
    assert.equal(r[key].since, day(2), `${key} should carry the first day`);
    assert.equal(r[key].partial, true, `${key} should say the week is short`);
  }
});

test('a ledger a week old or more stops calling itself partial', () => {
  const list = [turn(at(RECORD_WINDOW_DAYS - 1, 9)), turn(at(0, 9))];
  const r = records(list, { now: NOON });
  assert.equal(r.days, RECORD_WINDOW_DAYS);
  assert.equal(r.partial, false);
  assert.equal(r.busiestDay.partial, false);
});

test('a day added is a day, across a clock change', () => {
  // Component arithmetic, not +86_400_000: the second is wrong twice a year.
  assert.equal(addDays('2026-03-28', 1), '2026-03-29');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('not a day', 1), '');
});

// ---------------------------------------------------------------------------
// The copy never scores the human
// ---------------------------------------------------------------------------

/**
 * The product's own noun phrase for the queue. It is a description of a
 * state, not an accusation, and it is the one place the second person is
 * allowed anywhere near a record.
 */
const ALLOWED = ['waiting on you'];

/** @param {string} text */
function secondPerson(text) {
  const stripped = ALLOWED.reduce(
    (s, phrase) => s.split(new RegExp(phrase, 'gi')).join(' '),
    String(text || ''),
  );
  return stripped.match(/\byou(?:r|rs|['\u2019]ve|['\u2019]re|['\u2019]ll)?\b/gi) || [];
}

test('the second-person detector finds what it is for, and lets the noun phrase through', () => {
  assert.deepEqual(secondPerson('you have left 7 agents waiting'), ['you']);
  assert.deepEqual(secondPerson('your streak ended'), ['your']);
  assert.deepEqual(secondPerson('you\u2019ve been away'), ['you\u2019ve']);
  assert.deepEqual(secondPerson('3 waiting on you'), []);
  assert.deepEqual(secondPerson('longest wait ever was here: 3d 12h, 1 Sep'), []);
});

test('no record line addresses the reader', () => {
  const list = [
    ...wait('claude-code:a', ALPHA, at(8, 6), at(5, 18)),
    ...wait('claude-code:b', BETA, at(2, 8), null),
  ];
  for (let h = 0; h < 24; h++) list.push(tokens(at(3, h), ALPHA));
  for (let i = 0; i < 4; i++) list.push(...wait(`claude-code:d${i}`, ALPHA, at(4, 8), at(4, 9)));
  for (let d = 9; d >= 0; d--) list.push(turn(at(d, 9)), turn(at(d, 15)));

  const r = records(list, { now: NOON });
  const names = { [ALPHA]: 'orbital-api', [BETA]: 'ground-station' };

  // Surface one: the terminal.
  const cli = renderRecords(r, { names, color: false }).join('\n');
  assert.ok(cli.includes('longest wait ever'), 'the block rendered');
  assert.deepEqual(secondPerson(cli), [], `second person in: ${cli}`);

  // Surface two: the panel, for every agent a record could be about.
  const stats = { records: r, projects: names };
  for (const agent of [
    { id: 'claude-code:a', projectName: 'orbital-api' },
    { id: 'claude-code:b', projectName: 'ground-station' },
    { id: 'claude-code:z', projectName: 'orbital-api' },
    { id: 'claude-code:z', projectName: 'ground-station' },
  ]) {
    const line = recordLineFor(agent, stats);
    if (!line) continue;
    assert.deepEqual(secondPerson(line), [], `second person in: ${line}`);
  }
});

/**
 * Everything from `from` to the matching close brace at the same depth.
 * @param {string} src
 * @param {string} from
 */
function block(src, from) {
  const start = src.indexOf(from);
  assert.notEqual(start, -1, `${from} not found`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  assert.fail(`${from} has no end`);
}

test('no string literal in the records copy addresses the reader', () => {
  // The rendered lines above cover the branches a fixture reaches; this
  // covers the ones they do not, including a branch added later. Comments
  // are prose about the product and may say "you" — the string literals are
  // what the user reads, and they are what is scanned.
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
  const literalsOf = (src) => src.match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) || [];

  const client = stripComments(
    fs.readFileSync(path.resolve(HERE, '../../public/records.js'), 'utf8'),
  );
  // The CLI file is scoped to the records renderer: the rest of it is
  // WP-17's report and its --help, which are not this package's copy.
  const cliSrc = stripComments(
    fs.readFileSync(path.resolve(HERE, '../../src/cli/stats.mjs'), 'utf8'),
  );
  const cli = block(cliSrc, 'export function renderRecords(');

  for (const [where, src] of [
    ['public/records.js', client],
    ['renderRecords() in src/cli/stats.mjs', cli],
  ]) {
    for (const literal of literalsOf(src)) {
      assert.deepEqual(
        secondPerson(literal),
        [],
        `second person in a string literal of ${where}: ${literal}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// The hover card
//
// WP-46 asked for the record on the hover card as well as in the panel, and
// could not reach `public/app.js` (`docs/DEVIATIONS.md` §107, DEPARTURE). The
// card needs a DOM and `showTooltip()` is not exported, so this reads the
// wiring as source, the way `permission-keys.test.mjs` does — what can be
// checked without a browser is that the card asks the right question of the
// right cache.
// ---------------------------------------------------------------------------

test('the hover card carries the record line, off the panel’s own stats cache', () => {
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
  // WP-22 moved the hover card into app-tooltip.js.
  const app = stripComments(
    fs.readFileSync(path.resolve(HERE, '../../public/app-tooltip.js'), 'utf8'),
  );
  const panel = stripComments(fs.readFileSync(path.resolve(HERE, '../../public/panel.js'), 'utf8'));

  assert.match(app, /import \{ recordLineFor \} from '\.\/records\.js';/);
  const tooltip = block(app, 'function showTooltip(');
  assert.match(
    tooltip,
    /recordLineFor\(agent, panel\.teamRecords\(\)\)/,
    'the hover card does not ask records.js for a line',
  );
  assert.match(tooltip, /tooltipLine\(record\)/, 'the line is computed and never appended');

  // ONE cache, not two. A second fetch here would let the card and the panel
  // show different records at the same moment, and would put a network call
  // on the hover path.
  assert.doesNotMatch(tooltip, /fetch\(/, 'the hover card fetches on hover');
  assert.doesNotMatch(app, /['"`]\/api\/stats['"`]/, 'app.js fetches /api/stats itself');
  assert.match(panel, /function teamRecords\(\)/);
  assert.match(panel, /\bteamRecords,/, 'the panel does not export its records cache');
});

// ---------------------------------------------------------------------------
// The panel line
// ---------------------------------------------------------------------------

test('the panel line names a record only when it is about this session or its room', () => {
  const list = [
    ...wait('claude-code:long', ALPHA, at(8, 6), at(5, 18)),
    ...Array.from({ length: 24 }, (_, h) => tokens(at(3, h), BETA, 'claude-code:night')),
    ...Array.from({ length: 10 }, (_, d) => turn(at(d, 9))),
  ];
  const r = records(list, { now: NOON });
  const stats = { records: r, projects: { [ALPHA]: 'orbital-api', [BETA]: 'ground-station' } };

  assert.equal(r.partial, false, 'this fixture spans more than a week');

  const own = recordLineFor({ id: 'claude-code:long', projectName: 'orbital-api' }, stats);
  assert.match(own, /^longest wait ever was this session: 3d 12h, /);

  const room = recordLineFor({ id: 'claude-code:other', projectName: 'orbital-api' }, stats);
  assert.match(room, /^longest wait ever was here: 3d 12h, /);
  assert.ok(room.includes(formatDay(day(8))));

  const night = recordLineFor({ id: 'claude-code:x', projectName: 'ground-station' }, stats);
  assert.equal(night, 'the room that never slept: 24 hours of the day');

  assert.equal(recordLineFor({ id: 'claude-code:x', projectName: 'telemetry' }, stats), null);
  assert.equal(recordLineFor(null, stats), null);
  assert.equal(recordLineFor({ id: 'a' }, null), null);
  assert.equal(recordLineFor({ id: 'a' }, {}), null);
});

test('a project the floor cannot name never borrows another room\u2019s record', () => {
  const r = records(wait('claude-code:long', ALPHA, at(8, 6), at(5, 18)), { now: NOON });
  // No `projects` map: the key stays a hash, so it matches nothing.
  assert.equal(recordLineFor({ id: 'x', projectName: 'orbital-api' }, { records: r }), null);
  assert.equal(
    recordLineFor({ id: 'x', projectName: 'orbital-api' }, { records: r, projects: {} }),
    null,
  );
});

test('a young ledger says so on the line as well as in the report', () => {
  const r = records(wait('claude-code:a', ALPHA, at(1, 6), at(0, 6)), { now: NOON });
  const stats = { records: r, projects: { [ALPHA]: 'orbital-api' } };
  const line = recordLineFor({ id: 'claude-code:a', projectName: 'orbital-api' }, stats);
  assert.ok(line.endsWith(` \u00b7 since ${formatDay(day(1))}`), line);
});

test('durations and days read the same without an ICU build', () => {
  assert.equal(formatDuration(2 * 24 * HOUR + 12 * HOUR), '2d 12h');
  assert.equal(formatDuration(4 * HOUR + 5 * MIN), '4h 05m');
  assert.equal(formatDuration(11 * HOUR), '11h');
  assert.equal(formatDuration(18 * MIN), '18m');
  assert.equal(formatDuration(10_000), 'under a minute');
  assert.equal(formatDuration(-1), '');
  assert.equal(formatDuration(NaN), '');
  assert.equal(formatDay('2026-09-01'), '1 Sep');
  assert.equal(formatDay('2026-12-25'), '25 Dec');
  assert.equal(formatDay('nonsense'), 'nonsense');
});

// ---------------------------------------------------------------------------
// Both surfaces publish it
// ---------------------------------------------------------------------------

function fakeRes() {
  return {
    status: 0,
    body: '',
    writeHead(status) {
      this.status = status;
    },
    end(body) {
      this.body = body || '';
    },
  };
}

test('GET /api/stats and deckhq stats --json publish the same records', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-records-'));
  try {
    /** @type {any[]} */
    const list = [
      ...wait('claude-code:long', ALPHA, at(8, 6), at(5, 18)),
      ...Array.from({ length: 24 }, (_, h) => tokens(at(3, h), ALPHA)),
    ];
    for (let d = 9; d >= 0; d--) list.push(turn(at(d, 9)), turn(at(d, 15)));
    /** @type {Map<string, string[]>} */
    const byDay = new Map();
    for (const rec of list.sort((a, b) => a.t - b.t)) {
      const k = dayKey(rec.t);
      const lines = byDay.get(k) || [];
      lines.push(JSON.stringify(rec));
      byDay.set(k, lines);
    }
    for (const [k, lines] of byDay) {
      await fsp.writeFile(path.join(dir, `${k}.jsonl`), lines.join('\n') + '\n', 'utf8');
    }

    let cli = '';
    const code = await runStats(['--json'], {
      dir,
      cacheDir: path.join(dir, 'no-cache'),
      now: NOON,
      write: (s) => (cli += s),
    });
    assert.equal(code, 0);
    const fromCli = JSON.parse(cli);

    const router = new Router();
    registerStats(router, {
      registry: { snapshot: () => ({ projects: [] }) },
      ledger: { dir, writeError: null },
      log: { warn() {} },
    });
    const res = fakeRes();
    await router.match('GET', '/api/stats')({}, res, new URL('http://127.0.0.1/api/stats'), {});
    const fromRoute = JSON.parse(res.body);

    // `now` differs by however long the two took, and the open-ended records
    // are the only thing that can move with it. Nothing here is open.
    assert.deepEqual(fromRoute.records, fromCli.records);
    assert.equal(fromRoute.records.longestWait.sessionId, 'claude-code:long');
    assert.equal(fromRoute.records.neverSlept.hours, 24);
    assert.equal(fromRoute.records.busiestDay.turns, 2);
    // The raw count moved out from under `records` and is still published.
    assert.equal(fromRoute.recordCount, list.length);
    assert.equal(fromCli.recordCount, list.length);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('deckhq stats prints the records under the report', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-records-cli-'));
  try {
    /** @type {any[]} */
    const list = [...wait('claude-code:long', ALPHA, at(8, 6), at(5, 18))];
    for (let d = 9; d >= 0; d--) list.push(turn(at(d, 9)), turn(at(d, 15)));
    for (const rec of list) {
      await fsp.appendFile(
        path.join(dir, `${dayKey(rec.t)}.jsonl`),
        JSON.stringify(rec) + '\n',
        'utf8',
      );
    }
    let out = '';
    const code = await runStats([], {
      dir,
      cacheDir: path.join(dir, 'no-cache'),
      now: NOON,
      color: false,
      write: (s) => (out += s),
    });
    assert.equal(code, 0);
    assert.ok(out.includes('the team\u2019s records'), out);
    assert.ok(out.includes('longest wait ever'));
    assert.ok(out.includes('busiest day'));
    assert.ok(out.includes('most turns in a week'));
    assert.ok(out.includes('the room that never slept'));
    // Nine days of ledger, so no caveat.
    assert.ok(!out.includes('since 20'), out);
    assert.deepEqual(secondPerson(out), [], out);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
