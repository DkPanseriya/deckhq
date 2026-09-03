/**
 * WP-26 — the rate card.
 *
 * Four things this suite is here to hold, in the order they matter:
 *
 *   1. **Longest prefix wins**, and nothing else disambiguates. A table that
 *      quietly depended on its own row order would be a table nobody could
 *      safely add a row to.
 *   2. **The user's override merges**, entry by entry, and takes effect
 *      without a restart — the acceptance criterion in
 *      `docs/plan/06-ENGINEERING-WORKPLAN.md`.
 *   3. **An unknown model has no rate**, and "no rate" is not `$0.00`. This is
 *      the behaviour change WP-26 makes: the old table priced anything it did
 *      not recognise as Opus.
 *   4. **Every string that shows a cost says what kind of number it is.**
 *      `docs/plan/08-PLAN-V2-100X.md` §1.1 rule 7 — cost is an estimate, never
 *      a bill — is only true if it is true of the literal text on the screen,
 *      so the display strings are asserted here as text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  BUILTIN_RATES_FILE,
  clearRateCardCache,
  costOf,
  estimateCost,
  loadRateCard,
  matchRate,
  mergeRateCards,
  normaliseModelId,
  normaliseRate,
  parseRateCard,
  rateCardVersion,
} from '../../src/core/rates.mjs';
import { costLineParts } from '../../public/panel.js';
import { payrollLine } from '../../public/render/plan.js';
import { renderStats } from '../../src/cli/stats.mjs';
import { todaySpendFor } from '../../src/core/state-machine.mjs';
import { projectKeyFor } from '../../src/core/ledger.mjs';

/** A scratch directory that cleans itself up. */
function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-rates-'));
}

/** @param {string} file @param {any} doc */
function writeCard(file, doc) {
  fs.writeFileSync(file, JSON.stringify(doc, null, 2), 'utf8');
}

const CARD = {
  version: '2026-01-01',
  rates: [
    { match: 'claude-opus', input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75, per: 1e6 },
    { match: 'claude-opus-5', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, per: 1e6 },
    { match: 'claude-haiku-4-5', input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, per: 1e6 },
  ],
};

// --------------------------------------------------------------- the table

test('the shipped rate card parses, is dated, and names where it came from', () => {
  const card = parseRateCard(JSON.parse(fs.readFileSync(BUILTIN_RATES_FILE, 'utf8')));
  assert.equal(card.error, null);
  assert.match(card.version, /^\d{4}-\d{2}-\d{2}$/, 'the version is the date it was checked');
  assert.match(card.retrievedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(card.rates.length >= 15);
  // The families WP-26 names, at the prices the page carried on retrievedAt.
  const by = (m) => card.rates.find((r) => r.match === m);
  assert.deepEqual(
    { input: by('claude-opus-5').input, output: by('claude-opus-5').output },
    { input: 5, output: 25 },
  );
  assert.deepEqual(
    { input: by('claude-sonnet-5').input, output: by('claude-sonnet-5').output },
    { input: 2, output: 10 },
  );
  assert.deepEqual(
    { input: by('claude-haiku-4-5').input, output: by('claude-haiku-4-5').output },
    { input: 1, output: 5 },
  );
});

test('every row we did not read off a published price list is flagged unverified', () => {
  const card = parseRateCard(JSON.parse(fs.readFileSync(BUILTIN_RATES_FILE, 'utf8')));
  const openai = card.rates.filter((r) => !r.match.startsWith('claude-'));
  assert.ok(openai.length > 0, 'the Codex/OpenAI prefixes are in the table');
  for (const row of openai) {
    assert.equal(row.unverified, true, `${row.match} must be marked unverified`);
  }
  for (const row of card.rates.filter((r) => r.match.startsWith('claude-'))) {
    assert.equal(row.unverified, false, `${row.match} was read off the pricing page`);
  }
});

test('a row with no price is not a row', () => {
  assert.equal(normaliseRate({ match: 'x' }), null);
  assert.equal(normaliseRate({ input: 1, output: 2 }), null);
  assert.equal(normaliseRate(null), null);
  // Cache prices are optional and fall back to the published multipliers, so
  // a one-line override is a usable override.
  const partial = normaliseRate({ match: 'mine', input: 4, output: 20 });
  assert.equal(partial.cacheRead, 0.4);
  assert.equal(partial.cacheWrite, 5);
  assert.equal(partial.per, 1e6);
});

test('a malformed card is an empty card with a reason, never a throw', () => {
  assert.equal(parseRateCard(null).error, 'not an object');
  assert.equal(parseRateCard({ version: 'x' }).error, 'rates is not an array');
  assert.deepEqual(parseRateCard({ rates: 'nope' }).rates, []);
});

// ----------------------------------------------------------- prefix matching

test('longest prefix wins', () => {
  const { rates } = parseRateCard(CARD);
  assert.equal(matchRate('claude-opus-5-20260101', rates).match, 'claude-opus-5');
  assert.equal(matchRate('claude-opus-4-1-20250805', rates).match, 'claude-opus');
  assert.equal(matchRate('claude-haiku-4-5', rates).match, 'claude-haiku-4-5');
});

test('longest prefix wins whichever order the rows are in', () => {
  const forward = parseRateCard(CARD).rates;
  const reversed = parseRateCard({ ...CARD, rates: [...CARD.rates].reverse() }).rates;
  assert.equal(
    matchRate('claude-opus-5-x', forward).match,
    matchRate('claude-opus-5-x', reversed).match,
  );
});

test('a provider prefix on a model id is not a different model', () => {
  const { rates } = parseRateCard(CARD);
  assert.equal(normaliseModelId('us.anthropic.claude-opus-5'), 'claude-opus-5');
  assert.equal(normaliseModelId('claude-opus-5@20260101'), 'claude-opus-5');
  assert.equal(normaliseModelId('  CLAUDE-Opus-5  '), 'claude-opus-5');
  assert.equal(matchRate('us.anthropic.claude-opus-5-v1', rates).match, 'claude-opus-5');
});

test('a model the table has never heard of has NO rate, not a zero one', () => {
  const { rates } = parseRateCard(CARD);
  assert.equal(matchRate('llama-4-maverick', rates), null);
  assert.equal(matchRate('', rates), null);
  assert.equal(matchRate(null, rates), null);
});

test('cache reads are priced apart from fresh input, and far below it', () => {
  const { rates } = parseRateCard(CARD);
  const opus = matchRate('claude-opus-5', rates);
  assert.equal(costOf({ input: 1e6 }, opus), 5);
  assert.equal(costOf({ output: 1e6 }, opus), 25);
  assert.equal(costOf({ cacheRead: 1e6 }, opus), 0.5);
  assert.equal(costOf({ cacheWrite: 1e6 }, opus), 6.25);
  assert.ok(costOf({ cacheRead: 1e6 }, opus) < costOf({ input: 1e6 }, opus) / 5);
});

// ------------------------------------------------------------- the override

test('an override merges entry by entry rather than replacing the table', () => {
  const base = parseRateCard(CARD);
  const merged = mergeRateCards(
    base,
    parseRateCard({
      version: '2026-02-02',
      rates: [{ match: 'claude-opus-5', input: 1, output: 2 }],
    }),
  );
  assert.equal(merged.version, '2026-02-02');
  assert.equal(merged.overridden, true);
  assert.equal(merged.rates.length, base.rates.length, 'no row was added or dropped');
  assert.equal(matchRate('claude-opus-5', merged.rates).input, 1);
  // Everything the override did not name is untouched.
  assert.equal(matchRate('claude-haiku-4-5', merged.rates).input, 1);
  assert.equal(matchRate('claude-opus-4-1', merged.rates).input, 15);
});

test('an override can add a model the shipped table has never heard of', () => {
  const merged = mergeRateCards(
    parseRateCard(CARD),
    parseRateCard({ rates: [{ match: 'my-local-model', input: 0, output: 0 }] }),
  );
  assert.equal(matchRate('my-local-model-v2', merged.rates).match, 'my-local-model');
});

test('an undated override is still marked as not the shipped table', () => {
  const merged = mergeRateCards(
    parseRateCard(CARD),
    parseRateCard({ rates: [{ match: 'claude-opus-5', input: 1, output: 2 }] }),
  );
  assert.equal(merged.version, '2026-01-01+local', 'the reader must be told the table was edited');
});

test('no override leaves the shipped table exactly as it is', () => {
  const merged = mergeRateCards(parseRateCard(CARD), null);
  assert.equal(merged.version, '2026-01-01');
  assert.equal(merged.overridden, false);
});

// ------------------------------------------------------------- the hot reload

test('an override takes effect on its next mtime change, with no restart', () => {
  const dir = tmpdir();
  const builtinFile = path.join(dir, 'rates.json');
  const overrideFile = path.join(dir, 'override.json');
  writeCard(builtinFile, CARD);
  clearRateCardCache();

  const opts = { builtinFile, overrideFile, maxAgeMs: 0 };
  assert.equal(estimateCost({ input: 1e6, model: 'claude-opus-5' }, opts), 5);
  assert.equal(rateCardVersion(opts), '2026-01-01');

  // The user writes an override while the daemon is running.
  writeCard(overrideFile, {
    version: 'my-deal',
    rates: [{ match: 'claude-opus-5', input: 1, output: 4 }],
  });
  assert.equal(estimateCost({ input: 1e6, model: 'claude-opus-5' }, opts), 1);
  assert.equal(rateCardVersion(opts), 'my-deal');

  // And edits it again. Same size, so this is the mtime alone doing the work.
  const later = Date.now() / 1000 + 60;
  writeCard(overrideFile, {
    version: 'my-deal',
    rates: [{ match: 'claude-opus-5', input: 2, output: 4 }],
  });
  fs.utimesSync(overrideFile, later, later);
  assert.equal(estimateCost({ input: 1e6, model: 'claude-opus-5' }, opts), 2);

  // And deletes it. The shipped table comes back.
  fs.rmSync(overrideFile);
  assert.equal(estimateCost({ input: 1e6, model: 'claude-opus-5' }, opts), 5);
  assert.equal(rateCardVersion(opts), '2026-01-01');

  fs.rmSync(dir, { recursive: true, force: true });
  clearRateCardCache();
});

test('the card is cached between re-checks so a scan is not a syscall storm', () => {
  const dir = tmpdir();
  const builtinFile = path.join(dir, 'rates.json');
  const overrideFile = path.join(dir, 'missing.json');
  writeCard(builtinFile, CARD);
  clearRateCardCache();

  const at = 1_000_000;
  const first = loadRateCard({ builtinFile, overrideFile, now: at });
  writeCard(builtinFile, { version: 'changed', rates: [] });
  // Inside the recheck window the files are not looked at again.
  assert.equal(loadRateCard({ builtinFile, overrideFile, now: at + 10 }), first);
  // Past it, they are.
  assert.equal(loadRateCard({ builtinFile, overrideFile, now: at + 5000 }).version, 'changed');

  fs.rmSync(dir, { recursive: true, force: true });
  clearRateCardCache();
});

test('a broken override costs the user their overrides and nothing else', () => {
  const dir = tmpdir();
  const builtinFile = path.join(dir, 'rates.json');
  const overrideFile = path.join(dir, 'override.json');
  writeCard(builtinFile, CARD);
  fs.writeFileSync(overrideFile, '{ not json', 'utf8');
  clearRateCardCache();

  const opts = { builtinFile, overrideFile, maxAgeMs: 0 };
  assert.equal(estimateCost({ input: 1e6, model: 'claude-opus-5' }, opts), 5);
  assert.equal(rateCardVersion(opts), '2026-01-01');

  fs.rmSync(dir, { recursive: true, force: true });
  clearRateCardCache();
});

test('a missing table prices nothing rather than pricing everything at zero', () => {
  clearRateCardCache();
  const opts = {
    builtinFile: path.join(tmpdir(), 'not-here.json'),
    overrideFile: path.join(tmpdir(), 'not-here-either.json'),
    maxAgeMs: 0,
  };
  assert.equal(estimateCost({ input: 1e6, model: 'claude-opus-5' }, opts), null);
  clearRateCardCache();
});

test('estimateCost returns null for an unknown model, and a number otherwise', () => {
  clearRateCardCache();
  assert.equal(estimateCost({ input: 1e6, model: 'not-a-model-anyone-ships' }), null);
  assert.equal(estimateCost({}), null, 'no model at all is no rate, not $0.00');
  assert.ok(estimateCost({ input: 1e6, model: 'claude-opus-5' }) > 0);
  clearRateCardCache();
});

// ------------------------------------------------------- the payroll meter

test("today's spend is the day's token movement at the room's own average rate", () => {
  const project = {
    cwd: '/w/api',
    tokens: 800,
    cacheTokens: 200,
    costEstimate: 10,
    costRated: true,
  };
  const today = { [projectKeyFor('/w/api')]: { tokens: 200, cache: 50 } };
  assert.deepEqual(todaySpendFor(project, today), { todaySpend: 2.5, todaySpendIsToday: true });
});

test('a room with no ledger record today falls back to its session totals, and says so', () => {
  const project = {
    cwd: '/w/api',
    tokens: 800,
    cacheTokens: 200,
    costEstimate: 10,
    costRated: true,
  };
  assert.deepEqual(todaySpendFor(project, {}), { todaySpend: 10, todaySpendIsToday: false });
});

test('a room nothing in the rate card can price has no spend at all', () => {
  const project = {
    cwd: '/w/api',
    tokens: 800,
    cacheTokens: 200,
    costEstimate: 0,
    costRated: false,
  };
  assert.deepEqual(todaySpendFor(project, {}), { todaySpend: null, todaySpendIsToday: false });
});

test('a day cannot have cost more than the session ever has', () => {
  const project = { cwd: '/w/api', tokens: 100, cacheTokens: 0, costEstimate: 4, costRated: true };
  const today = { [projectKeyFor('/w/api')]: { tokens: 10_000, cache: 0 } };
  assert.equal(todaySpendFor(project, today).todaySpend, 4);
});

// ------------------------------------------------- rule 7, as literal text
//
// Cost is an estimate, never a bill (`08` §1.1 rule 7). That is only true if
// it is true of the characters on the screen, so every display string the
// product can produce for a cost is collected here and read as text.

/**
 * Every cost string any surface in the product can show, as the reader sees
 * it — `costLineParts` is joined with the `·` the panel joins it with,
 * because a qualifier in the part after the money still reads as attached to
 * the money.
 */
function everyCostDisplay() {
  const version = '2026-09-04';
  const line = (/** @type {any} */ agent) => costLineParts(agent, version).join(' · ');
  return [
    line({ costEstimate: 7.8551 }),
    line({ costEstimate: null }),
    line({ costEstimate: 0 }),
    payrollLine({ todaySpend: 18.4, todaySpendIsToday: true }),
    payrollLine({ todaySpend: 18.4, todaySpendIsToday: false }),
    renderStats({ records: 0 }, { rateCard: version }),
    renderStats(
      {
        records: 4,
        days: 30,
        forReview: { medianMs: 1, p90Ms: 2, discharged: 1, open: 0 },
        dischargesPerDayMean: 0.1,
        sendsPerDay: {},
        sendsPerDayMean: 0,
        over24h: 0,
        longestWaitEver: null,
        tokensPerProjectPerDay: {},
      },
      { rateCard: version, dir: '/w/ledger' },
    ),
  ].filter(Boolean);
}

test('every cost display says what kind of number it is', () => {
  for (const s of everyCostDisplay()) {
    const carriesCost = /\$|no rate/.test(s);
    if (!carriesCost) continue;
    assert.ok(
      /estimate|list price|not a bill/.test(s),
      `a cost figure with no qualifier reads as a bill: ${JSON.stringify(s)}`,
    );
  }
});

test('no cost display says "bill" without "not a" in front of it', () => {
  for (const s of everyCostDisplay()) {
    for (const m of s.matchAll(/bill/g)) {
      const before = s.slice(Math.max(0, m.index - 6), m.index);
      assert.ok(before.endsWith('not a '), `"${s}" says bill without denying it is one`);
    }
  }
});

test('the panel cost line names its rate card, and refuses to invent a figure', () => {
  assert.deepEqual(costLineParts({ costEstimate: 7.8551 }, '2026-09-04'), [
    '≈ $7.86',
    'list price, rate card 2026-09-04',
    'not a bill',
  ]);
  assert.deepEqual(costLineParts({ costEstimate: null }, '2026-09-04'), [
    'no rate for this model',
    'rate card 2026-09-04',
    'estimate unavailable',
  ]);
  assert.match(costLineParts({ costEstimate: 1 }, null).join(' · '), /rate card unknown/);
});

test('deckhq stats prints the rate card version, empty ledger or not', () => {
  assert.match(renderStats({ records: 0 }, { rateCard: '2026-09-04' }), /rate card 2026-09-04/);
  const full = renderStats(
    {
      records: 4,
      days: 30,
      forReview: { medianMs: 1, p90Ms: 2, discharged: 1, open: 0 },
      dischargesPerDayMean: 0.1,
      sendsPerDay: {},
      sendsPerDayMean: 0,
      over24h: 0,
      longestWaitEver: null,
      tokensPerProjectPerDay: {},
    },
    { rateCard: '2026-09-04', dir: '/w/ledger' },
  );
  assert.match(full, /rate card 2026-09-04 — list-price estimate, not a bill/);
});
