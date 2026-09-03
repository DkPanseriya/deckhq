/**
 * WP-27 — Wrapped, weekly and annual.
 *
 * What this suite holds:
 *
 *   1. **When it arrives**, and that it arrives once. Monday after 06:00 for
 *      the week; on or after 1 December for the year; never twice for the same
 *      window (`docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §3.4, `08` §7).
 *   2. **The window is a real window.** The comparison window is exactly as
 *      long as the window, or "the longest wait fell" is arithmetic rather
 *      than a fact.
 *   3. **Every number reconciles with the ledger**, and each line carries the
 *      window it was computed over.
 *   4. **Nothing addresses the reader** — the same detector, with the same
 *      single allowance, as `records.test.mjs` and `postcard.test.mjs`.
 *   5. **The derived stat is true.** The phrase counter counts what an
 *      assistant wrote inside the window and nothing else: not a user quoting
 *      it back, not a record from before the window in a file touched inside
 *      it, not a tool result that happens to contain it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatHour,
  formatRange,
  weekKeyOf,
  wrappedCopy,
  wrappedDue,
} from '../../public/wrapped.js';
import { CARDS_OFF } from '../../public/postcard.js';
import { projectKeyFor, windowDigest } from '../../src/core/ledger.mjs';
import {
  WRAPPED_KINDS,
  weekKey,
  windowSpend,
  wrappedWindow,
} from '../../src/http/routes/wrapped.mjs';
import {
  CATCHPHRASE,
  countCatchphrase,
  countIn,
  countInRecord,
} from '../../src/adapters/claude-code/catchphrase.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 2026: 7 Sep is a Monday, 8 Sep a Tuesday. */
const MONDAY = new Date(2026, 8, 7, 9, 0, 0, 0).getTime();
const TUESDAY = new Date(2026, 8, 8, 9, 0, 0, 0).getTime();

// -------------------------------------------------------------- when it comes

test('Monday morning, and not Monday midnight', () => {
  assert.equal(wrappedDue({ now: new Date(2026, 8, 7, 5, 59).getTime() }).kind, null);
  const due = wrappedDue({ now: MONDAY });
  assert.equal(due.kind, 'week');
  assert.equal(due.key, weekKeyOf(MONDAY));
});

test('no card on a Tuesday', () => {
  assert.equal(wrappedDue({ now: TUESDAY }).kind, null);
});

test('a week is never wrapped twice', () => {
  const due = wrappedDue({ now: MONDAY });
  assert.equal(wrappedDue({ now: MONDAY + 4 * HOUR, shownKey: due.key }).kind, null);
  // Next Monday is a different week and a different key.
  const next = wrappedDue({ now: MONDAY + 7 * DAY, shownKey: due.key });
  assert.equal(next.kind, 'week');
  assert.notEqual(next.key, due.key);
});

test('the annual card arrives on 1 December and outranks the week', () => {
  const dec1 = new Date(2026, 11, 1, 10).getTime();
  assert.deepEqual(wrappedDue({ now: dec1 }), { kind: 'annual', key: '2026-annual' });
  // A December Monday spends its card on the year first...
  const decMonday = new Date(2026, 11, 7, 9).getTime();
  assert.equal(wrappedDue({ now: decMonday }).kind, 'annual');
  // ...and once the year has been seen, the week still gets its own.
  assert.equal(wrappedDue({ now: decMonday, shownKey: '2026-annual' }).kind, 'week');
  // November is not December. (30 Nov 2026 is itself a Monday, so what it
  // gets is the week — never the year.)
  assert.equal(wrappedDue({ now: new Date(2026, 10, 30, 10).getTime() }).kind, 'week');
  assert.equal(wrappedDue({ now: new Date(2026, 10, 25, 10).getTime() }).kind, null);
});

test('the marker `off` switches Wrapped off for good', () => {
  assert.equal(wrappedDue({ now: MONDAY, shownKey: CARDS_OFF }).kind, null);
  assert.equal(
    wrappedDue({ now: new Date(2026, 11, 25, 10).getTime(), shownKey: CARDS_OFF }).kind,
    null,
  );
});

// ------------------------------------------------------------- the window

test('the week the Monday card is about is the week that just ended', () => {
  const w = wrappedWindow('week', MONDAY);
  assert.equal(new Date(w.until).getDay(), 1, 'the window ends on a Monday midnight');
  assert.equal(new Date(w.until).getHours(), 0);
  assert.equal(w.until - w.since, 7 * DAY, 'seven days, not eight');
  assert.equal(new Date(w.since).getDate(), 31, 'it starts on Monday 31 August');
});

test('the comparison window is exactly as long as the window', () => {
  // Otherwise "the longest wait fell" is a fact about the arithmetic.
  const w = wrappedWindow('week', MONDAY);
  assert.equal(w.since - w.previousSince, w.until - w.since);
});

test('the annual window is the year so far, and says so', () => {
  const w = wrappedWindow('annual', new Date(2026, 11, 3, 10).getTime());
  assert.equal(new Date(w.since).getFullYear(), 2026);
  assert.equal(new Date(w.since).getMonth(), 0);
  assert.equal(w.key, '2026-annual');
  assert.match(w.label, /so far/);
});

test('the client and the server agree on which week a Monday is about', () => {
  for (let i = 0; i < 8; i++) {
    const monday = MONDAY + i * 7 * DAY;
    assert.equal(weekKeyOf(monday), wrappedWindow('week', monday).key, `week ${i}`);
  }
});

test('only two kinds exist, and an unknown one is not silently a week', () => {
  assert.deepEqual([...WRAPPED_KINDS], ['week', 'annual']);
  // The key format is what the settings sanitizer accepts.
  assert.match(weekKey(MONDAY), /^[0-9A-Za-z-]{1,32}$/);
});

// ------------------------------------------------------------------ the money

test("the window's tokens are priced at each room's own average rate", () => {
  // `docs/DEVIATIONS.md` §111 decision 6: a `tokens` record carries no model.
  const projects = [
    {
      cwd: '/code/orbital-api',
      tokens: 1_000_000,
      cacheTokens: 0,
      costEstimate: 20,
      costRated: true,
    },
  ];
  const key = projectKeyFor('/code/orbital-api');
  // Half the room's lifetime tokens moved in the window, so half its estimate.
  assert.deepEqual(windowSpend({ [key]: 500_000 }, projects), {
    estimate: 10,
    rated: 1,
    unrated: 0,
  });
  // Clamped: a window cannot cost more than the sessions in it ever cost.
  assert.equal(windowSpend({ [key]: 9_000_000 }, projects).estimate, 20);
});

test('a room with no rate is null, never zero', () => {
  const key = projectKeyFor('/code/x');
  const out = windowSpend({ [key]: 100 }, [
    { cwd: '/code/x', tokens: 1000, cacheTokens: 0, costEstimate: 0, costRated: false },
  ]);
  assert.equal(out.estimate, null, 'zero is a claim about the money we do not have');
  assert.equal(out.unrated, 1);
});

test('a room with no movement in the window contributes nothing', () => {
  // The room plate falls back to the project's lifetime total; here that would
  // add a project's whole history to a week.
  const out = windowSpend({}, [
    { cwd: '/code/x', tokens: 1000, cacheTokens: 0, costEstimate: 99, costRated: true },
  ]);
  assert.equal(out.estimate, null);
  assert.equal(out.rated, 0);
});

// ------------------------------------------------------------------- the copy

/** A `/api/wrapped` body over a window whose numbers can be counted by eye. */
function bodyFixture(overrides = {}) {
  const bounds = wrappedWindow('week', MONDAY);
  const state = (t, sessionId, projectKey, from, to) => ({
    t,
    sessionId,
    projectKey,
    kind: 'state',
    dim: 'activity',
    from,
    to,
  });
  const recs = [];
  for (let d = 0; d < 5; d++) {
    const day = bounds.since + d * DAY;
    recs.push(state(day + 10 * HOUR, 's1', 'orb', 'ended', 'working'));
    recs.push(state(day + 10 * HOUR + 30 * MINUTE, 's1', 'orb', 'working', 'for_review'));
    recs.push(state(day + 12 * HOUR, 's1', 'orb', 'for_review', 'ended'));
    recs.push({
      t: day + 11 * HOUR,
      sessionId: 's1',
      projectKey: 'orb',
      kind: 'tokens',
      delta: 100_000,
    });
    recs.push({ t: day + 11 * HOUR, sessionId: 's1', projectKey: 'orb', kind: 'send', chars: 40 });
  }
  recs.push(state(bounds.since + 3 * HOUR, 's2', 'chk', 'ended', 'working'));
  // A wait in the PREVIOUS window that was longer, so the card can say it fell.
  const prevRecs = [
    state(bounds.previousSince + 2 * HOUR, 's9', 'orb', 'working', 'for_review'),
    state(bounds.previousSince + 2 * DAY, 's9', 'orb', 'for_review', 'ended'),
  ];
  const all = [...prevRecs, ...recs].sort((a, b) => a.t - b.t);
  return {
    kind: 'week',
    label: bounds.label,
    since: bounds.since,
    until: bounds.until,
    key: bounds.key,
    window: windowDigest(all, { since: bounds.since, until: bounds.until }),
    previous: windowDigest(all, { since: bounds.previousSince, until: bounds.since }),
    spend: { estimate: 41.2, rated: 2, unrated: 0, rateCardVersion: '2026-09-04' },
    catchphrase: { supported: true, phrase: CATCHPHRASE, count: 11, truncated: false },
    projects: { orb: 'orbital-api', chk: 'checkout-flow' },
    ...overrides,
  };
}

test('every content §3.4 asks for is on the card, and each carries its window', () => {
  const body = bodyFixture();
  const copy = wrappedCopy(body);
  const labels = copy.rows.map((r) => r.label);
  assert.deepEqual(labels, [
    'Turns',
    'Tokens',
    'Spend',
    'Longest wait',
    'Never slept',
    'Sent the most',
    'Busiest hour',
    `"${CATCHPHRASE}"`,
  ]);
  // The window, on the card, once — every row is under it.
  assert.equal(copy.subtitle, formatRange(body.since, body.until));
  const text = copy.rows.map((r) => r.value).join(' | ');
  assert.match(text, /orbital-api 5/);
  assert.match(text, /500k/);
  assert.match(text, /≈ \$41\.20 list price, rate card 2026-09-04/);
  assert.match(text, /5 messages to one session in orbital-api/);
  assert.match(text, /10:00/);
  assert.match(text, /11 times/);
});

test('the longest wait says whether it fell, against the window before', () => {
  const copy = wrappedCopy(bodyFixture());
  const wait = copy.rows.find((r) => r.label === 'Longest wait');
  assert.match(wait.value, /1h 30m/);
  assert.match(wait.value, /down from 1d 22h/);
});

test('a level or rising wait is said plainly, not softened', () => {
  const body = bodyFixture();
  body.previous = { longestWait: { ms: 30 * MINUTE } };
  assert.match(wrappedCopy(body).rows.find((r) => r.label === 'Longest wait').value, /up from 30m/);
  body.previous = { longestWait: { ms: body.window.longestWait.ms } };
  assert.match(wrappedCopy(body).rows.find((r) => r.label === 'Longest wait').value, /level/);
});

test('a young ledger says where it starts rather than claiming the week', () => {
  const body = bodyFixture();
  body.window = { ...body.window, covered: false, firstDay: '2026-09-04' };
  assert.match(wrappedCopy(body).subtitle, /since 4 Sep, where this ledger starts/);
});

test('a phrase nobody said is "not once", and a truncated read says "at least"', () => {
  const body = bodyFixture();
  body.catchphrase = { supported: true, phrase: CATCHPHRASE, count: 0, truncated: false };
  assert.match(wrappedCopy(body).rows.at(-1).value, /not once this week/);
  body.catchphrase = { supported: true, phrase: CATCHPHRASE, count: 40, truncated: true };
  assert.match(wrappedCopy(body).rows.at(-1).value, /at least 40 times/);
  // A runtime that cannot answer costs the line, never a zero.
  body.catchphrase = { supported: false, phrase: '', count: 0 };
  assert.equal(
    wrappedCopy(body).rows.some((r) => r.label.includes('absolutely')),
    false,
  );
});

test('an empty week produces a card with a window and no invented rows', () => {
  const bounds = wrappedWindow('week', MONDAY);
  const copy = wrappedCopy({
    kind: 'week',
    since: bounds.since,
    until: bounds.until,
    window: windowDigest([], { since: bounds.since, until: bounds.until }),
    previous: windowDigest([], { since: bounds.previousSince, until: bounds.since }),
    spend: { estimate: null, rated: 0, unrated: 0, rateCardVersion: '2026-09-04' },
    catchphrase: { supported: false },
    projects: {},
  });
  assert.deepEqual(copy.rows, []);
  assert.ok(copy.subtitle);
  assert.match(copy.footer, /Nothing left it/);
});

test('every money line says list price and never says bill', () => {
  const copy = wrappedCopy(bodyFixture());
  for (const row of copy.rows.filter((r) => /\$/.test(r.value))) {
    assert.match(row.value, /list price/);
    assert.doesNotMatch(row.value, /(?<!not a )bill/);
  }
});

test('the hour and the range read the way a person reads them', () => {
  assert.equal(formatHour(9), '09:00');
  assert.equal(formatHour(23), '23:00');
  assert.equal(formatHour(24), '');
  assert.equal(formatHour('x'), '');
  assert.equal(formatRange(MONDAY, MONDAY), '7 Sep');
  assert.equal(formatRange(MONDAY, MONDAY + 3 * DAY), '7 Sep – 10 Sep');
});

// ------------------------------------------------------ never scoring the human

/**
 * Two allowances, in one array with a comment saying so — exactly the shape
 * `records.test.mjs` keeps its one in, so widening the list is a visible act.
 *
 *   - **"waiting on you"** is the product's own noun phrase for the queue and
 *     is a description of a state, not a reproach. Inherited from WP-46.
 *   - **the catchphrase itself.** `docs/plan/04` §3.4 asks Wrapped for "the
 *     count of a phrase across all transcripts, in the spirit of the 'you're
 *     absolutely right' tracker" — so the second person here is a QUOTATION of
 *     something the agents said, rendered inside quotation marks, and the
 *     card's own sentence about it ("11 times") addresses nobody. It arrives
 *     from the adapter as data rather than being written in the copy, which is
 *     why the file-literal scan below needs no allowance at all.
 */
const ALLOWED = ['waiting on you', "you're absolutely right", 'you’re absolutely right'];
const SECOND_PERSON = /\b(you|your|yours|you've|you're|you'll|you’ve|you’re|you’ll)\b/i;

/** @param {string} text */
function addressesTheReader(text) {
  let t = String(text).toLowerCase();
  for (const phrase of ALLOWED) t = t.split(phrase).join(' ');
  return SECOND_PERSON.test(t);
}

test('the catchphrase is the ONLY second person Wrapped may carry', () => {
  // Stated as its own assertion so the allowance above cannot quietly become a
  // licence: run the detector with NO allowances and exactly one row survives,
  // which is the proof that nothing else in the card leans on it.
  const strict = (text) => SECOND_PERSON.test(String(text).toLowerCase());
  const copy = wrappedCopy(bodyFixture());
  const flagged = copy.rows.filter((r) => strict(`${r.label} ${r.value}`));
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].label, `"${CATCHPHRASE}"`);
  assert.equal(strict(flagged[0].value), false, 'the sentence about it addresses nobody');
});

test('no generated Wrapped line addresses the reader', () => {
  const bodies = [
    bodyFixture(),
    bodyFixture({ kind: 'annual' }),
    (() => {
      const b = bodyFixture();
      b.catchphrase = { supported: true, phrase: CATCHPHRASE, count: 0, truncated: true };
      b.window = { ...b.window, covered: false, firstDay: '2026-09-04' };
      b.spend = { estimate: 12, rated: 1, unrated: 2, rateCardVersion: '2026-09-04' };
      return b;
    })(),
  ];
  for (const body of bodies) {
    const copy = wrappedCopy(body);
    const all = [
      copy.title,
      copy.subtitle,
      copy.footer,
      ...copy.rows.map((r) => `${r.label} ${r.value}`),
    ];
    for (const line of all) {
      assert.equal(addressesTheReader(line), false, `Wrapped addressed the reader: ${line}`);
    }
  }
});

test('no string literal in wrapped.js addresses the reader', () => {
  const src = fs
    .readFileSync(path.join(ROOT, 'public', 'wrapped.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const literals = src.match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) || [];
  // The phrase itself is a quotation of something an AGENT says, and it is
  // handed in by the adapter rather than written here — but assert the file
  // does not contain it either way, so the allowance never has to exist.
  const offenders = literals.filter((l) => addressesTheReader(l));
  assert.deepEqual(offenders, [], 'Wrapped copy must never address the reader');
});

// ----------------------------------------------- the derived stat, and its truth

test('the phrase is counted in both apostrophes and neither case', () => {
  assert.equal(countIn("You're absolutely right"), 1);
  assert.equal(countIn('you’re absolutely right, and you’re absolutely right'), 2);
  assert.equal(countIn('You are absolutely right'), 0);
  assert.equal(countIn(''), 0);
});

test('only an assistant, and only inside the window, counts', () => {
  const w = { since: 1000, until: 2000 };
  const rec = (over) => ({
    type: 'assistant',
    timestamp: new Date(1500).toISOString(),
    message: { content: [{ type: 'text', text: "You're absolutely right" }] },
    ...over,
  });
  assert.equal(countInRecord(rec(), w), 1);
  // A user quoting it back is not the agent saying it.
  assert.equal(countInRecord(rec({ type: 'user' }), w), 0);
  // A record from before the window, in a file touched inside it.
  assert.equal(countInRecord(rec({ timestamp: new Date(10).toISOString() }), w), 0);
  // A subagent's records appear in its own transcript too; counting both
  // would double it.
  assert.equal(countInRecord(rec({ isSidechain: true }), w), 0);
  // A tool result that happens to contain the phrase is not the agent saying
  // it, and neither is a thought.
  assert.equal(
    countInRecord(
      rec({ message: { content: [{ type: 'tool_result', content: "You're absolutely right" }] } }),
      w,
    ),
    0,
  );
  assert.equal(
    countInRecord(
      rec({ message: { content: [{ type: 'thinking', thinking: "You're absolutely right" }] } }),
      w,
    ),
    0,
  );
  assert.equal(countInRecord(null, w), 0);
});

test('the counter reads a real directory of transcripts, bounded', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-catchphrase-'));
  try {
    const now = Date.now();
    const proj = path.join(dir, 'C--code-orbital');
    fs.mkdirSync(proj, { recursive: true });
    const line = (over) =>
      JSON.stringify({
        type: 'assistant',
        timestamp: new Date(now - HOUR).toISOString(),
        message: { content: [{ type: 'text', text: "You're absolutely right, that is the bug." }] },
        ...over,
      });
    fs.writeFileSync(
      path.join(proj, 'a.jsonl'),
      [
        line(),
        line(),
        // Outside the window.
        line({ timestamp: new Date(now - 40 * DAY).toISOString() }),
        // A user quoting it.
        line({ type: 'user' }),
        // A torn final record, which must be skipped and never thrown.
        '{"type":"assistant","message":{"content":[{"type":"text","text":"You',
      ].join('\n') + '\n',
      'utf8',
    );
    // A transcript last written before the window cannot hold a record in it.
    const old = path.join(dir, 'C--code-stale');
    fs.mkdirSync(old, { recursive: true });
    const stale = path.join(old, 'b.jsonl');
    fs.writeFileSync(stale, line() + '\n', 'utf8');
    const then = new Date(now - 60 * DAY);
    fs.utimesSync(stale, then, then);

    const out = await countCatchphrase({ dir, since: now - 7 * DAY, until: now });
    assert.equal(out.count, 2);
    assert.equal(out.files, 1, 'the stale transcript was never opened');
    assert.equal(out.truncated, false);
    assert.equal(out.phrase, CATCHPHRASE);

    // A second in-window transcript, so the file ceiling has something to
    // refuse: over it, the count is reported as a floor rather than as a fact.
    const second = path.join(dir, 'C--code-second');
    fs.mkdirSync(second, { recursive: true });
    fs.writeFileSync(path.join(second, 'c.jsonl'), `${line()}\n`, 'utf8');
    const all = await countCatchphrase({ dir, since: now - 7 * DAY, until: now });
    assert.equal(all.count, 3);
    const capped = await countCatchphrase({ dir, since: now - 7 * DAY, until: now, maxFiles: 1 });
    assert.equal(capped.truncated, true, 'a ceiling that was hit must say so');
    assert.equal(capped.files, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing transcript directory is not an error', async () => {
  const out = await countCatchphrase({
    dir: path.join(os.tmpdir(), 'deckhq-does-not-exist-' + Date.now()),
    since: Date.now() - DAY,
  });
  assert.equal(out.count, 0);
  assert.equal(out.files, 0);
});

test('a window with no start counts nothing rather than everything', () => {
  return countCatchphrase({ since: NaN }).then((out) => assert.equal(out.count, 0));
});
