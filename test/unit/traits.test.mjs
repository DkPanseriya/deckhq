/**
 * WP-28 — the agent's traits, over synthetic ledgers.
 *
 * Three kinds of assertion live here.
 *
 * **What the numbers say.** A hand-built ledger for one session, and the line
 * it produces. Synthetic on purpose: the reference machine has no ledger old
 * enough to take a real hand-raise distribution from, so the fixtures here
 * state the shape being described rather than pretending to have measured one.
 *
 * **What the words may never be.** The whole vocabulary is one exported table,
 * and this file reads it: no label carries a digit, nothing anywhere carries a
 * superlative or a `#`, and the second person does not appear. Those are
 * `docs/plan/08-PLAN-V2-100X.md` §1.1 rule 6 and
 * `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §5 turned into tests, because
 * copy that is only protected by a comment drifts.
 *
 * **What happens when there is not enough to say.** Under `MIN_TURNS` observed
 * stops the line is "new here" and nothing else — not a trait line with two
 * traits missing.
 */
import '../helpers/isolate.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_TURNS,
  MIN_TOOL_CALLS,
  TRAIT_COPY,
  traits,
  shortDate,
  traitModel,
} from '../../src/core/traits.mjs';

const ID = 'claude-code:s1';
const OTHER = 'claude-code:s2';
// Built LOCAL rather than from `Date.UTC`, because `shortDate` reads local
// date parts (a day boundary is the user's, `docs/DEVIATIONS.md` §100
// decision 2) and a UTC fixture renders as a different day on a runner far
// enough east or west — which is the shape of failure §121 spent a day on.
const T0 = new Date(2026, 8, 1, 9, 0, 0).getTime(); // 1 September 2026, local

/** One `state` record: an observed activity transition. */
function stop(to, at, id = ID) {
  return {
    t: at,
    kind: 'state',
    sessionId: id,
    projectKey: 'k',
    dim: 'activity',
    from: 'working',
    to,
  };
}

/**
 * A ledger for one session: `raises` hands up and `reviews` clean finishes,
 * plus the `first_seen` carry-over the real writer emits once a day.
 */
function ledger({ raises = 0, reviews = 0, since = T0, id = ID } = {}) {
  const out = [
    {
      t: since + 1000,
      kind: 'session',
      sessionId: id,
      projectKey: 'k',
      event: 'first_seen',
      activity: 'working',
      ack: 'active',
      since,
    },
  ];
  let t = since + 2000;
  for (let i = 0; i < raises; i++) out.push(stop('needs_input', (t += 1000), id));
  for (let i = 0; i < reviews; i++) out.push(stop('for_review', (t += 1000), id));
  return out;
}

function summary(over = {}) {
  return {
    model: 'claude-opus-5-20260501',
    toolMix: { files: 0, shell: 0, web: 0, search: 0 },
    textMedian: 0,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The whole line
// ---------------------------------------------------------------------------

test('the line reads "asks often · shell-heavy · terse · opus-5 · since 1 Sep"', () => {
  const set = traits(ID, {
    records: ledger({ raises: 6, reviews: 4 }),
    summary: summary({ toolMix: { files: 3, shell: 20, web: 0, search: 2 }, textMedian: 60 }),
  });
  assert.equal(set.line, 'asks often · shell-heavy · terse · opus-5 · since 1 Sep');
  assert.equal(set.degraded, false);
  assert.equal(set.turns, 10);
});

test('every trait in the list carries a label and a definition', () => {
  const set = traits(ID, {
    records: ledger({ raises: 1, reviews: 9 }),
    summary: summary({ toolMix: { files: 30, shell: 1, web: 0, search: 0 }, textMedian: 900 }),
  });
  assert.deepEqual(
    set.list.map((t) => t.label),
    ['asks sometimes', 'files-heavy', 'expansive'],
  );
  for (const t of set.list) {
    assert.ok(t.key in TRAIT_COPY, `${t.key} is not in the vocabulary`);
    assert.ok(t.definition.length > 8, `${t.key} has no definition`);
  }
});

test('records belonging to other sessions are ignored', () => {
  const mixed = [
    ...ledger({ raises: 6, reviews: 4 }),
    ...ledger({ raises: 40, reviews: 0, id: OTHER }),
  ];
  const set = traits(ID, { records: mixed, summary: summary() });
  assert.equal(set.turns, 10);
  assert.ok(set.line.startsWith('asks often'));
});

// ---------------------------------------------------------------------------
// Hand-raise frequency
// ---------------------------------------------------------------------------

test('hand-raise bands: often, sometimes, self-directed', () => {
  const band = (raises, reviews) =>
    traits(ID, { records: ledger({ raises, reviews }), summary: summary() }).list[0].label;
  assert.equal(band(6, 4), 'asks often'); // 6 per 10
  assert.equal(band(3, 7), 'asks often'); // exactly at the bar
  assert.equal(band(2, 8), 'asks sometimes'); // 2 per 10
  assert.equal(band(1, 9), 'asks sometimes'); // exactly at the bar
  assert.equal(band(0, 10), 'self-directed');
});

test('a stall is not a stop, and neither is an ack transition', () => {
  const records = [
    ...ledger({ raises: 0, reviews: 5 }),
    stop('stalled', T0 + 90_000),
    stop('working', T0 + 91_000),
    {
      t: T0 + 92_000,
      kind: 'state',
      sessionId: ID,
      projectKey: 'k',
      dim: 'ack',
      from: 'active',
      to: 'benched',
    },
  ];
  assert.equal(traits(ID, { records, summary: summary() }).turns, 5);
});

// ---------------------------------------------------------------------------
// Tool mix
// ---------------------------------------------------------------------------

test('tool mix names the leading class, and refuses to when nothing leads', () => {
  const mix = (m) =>
    traits(ID, { records: ledger({ raises: 0, reviews: 8 }), summary: summary({ toolMix: m }) })
      .list.map((t) => t.label)
      .find((l) => l.endsWith('-heavy') || l === 'even mix');
  assert.equal(mix({ files: 10, shell: 1, web: 0, search: 1 }), 'files-heavy');
  assert.equal(mix({ files: 1, shell: 10, web: 0, search: 1 }), 'shell-heavy');
  assert.equal(mix({ files: 1, shell: 1, web: 10, search: 1 }), 'web-heavy');
  assert.equal(mix({ files: 1, shell: 1, web: 0, search: 10 }), 'search-heavy');
  // Four ways, none of them holding 45%.
  assert.equal(mix({ files: 5, shell: 5, web: 5, search: 5 }), 'even mix');
});

test(`fewer than ${MIN_TOOL_CALLS} classified calls says nothing about a mix`, () => {
  const set = traits(ID, {
    records: ledger({ raises: 0, reviews: 8 }),
    summary: summary({ toolMix: { files: 4, shell: 0, web: 0, search: 0 }, textMedian: 60 }),
  });
  assert.deepEqual(
    set.list.map((t) => t.label),
    ['self-directed', 'terse'],
  );
});

// ---------------------------------------------------------------------------
// Verbosity
// ---------------------------------------------------------------------------

test('verbosity bands: terse, measured, expansive', () => {
  const voice = (median) =>
    traits(ID, {
      records: ledger({ raises: 0, reviews: 8 }),
      summary: summary({ textMedian: median }),
    }).list.map((t) => t.label);
  assert.deepEqual(voice(60), ['self-directed', 'terse']);
  assert.deepEqual(voice(99), ['self-directed', 'terse']);
  assert.deepEqual(voice(100), ['self-directed', 'measured']);
  assert.deepEqual(voice(249), ['self-directed', 'measured']);
  assert.deepEqual(voice(250), ['self-directed', 'expansive']);
  // No reply has been read: no word for a voice nobody has heard.
  assert.deepEqual(voice(0), ['self-directed']);
});

// ---------------------------------------------------------------------------
// Degraded
// ---------------------------------------------------------------------------

test(`fewer than ${MIN_TURNS} stops is "new here", and nothing else`, () => {
  for (let stops = 0; stops < MIN_TURNS; stops++) {
    const set = traits(ID, {
      records: ledger({ raises: stops, reviews: 0 }),
      summary: summary({ toolMix: { files: 99, shell: 0, web: 0, search: 0 }, textMedian: 900 }),
    });
    assert.equal(set.line, 'new here', `${stops} stops`);
    assert.equal(set.degraded, true);
    assert.deepEqual(
      set.list.map((t) => t.key),
      ['new_here'],
    );
    assert.equal(set.tendency, null);
  }
});

test('an empty ledger is "new here" rather than an empty line', () => {
  const set = traits(ID, { records: [], summary: null });
  assert.equal(set.line, 'new here');
  assert.equal(set.turns, 0);
});

test('a malformed ledger is survived, not thrown on', () => {
  const junk = [null, undefined, 42, 'nonsense', {}, { kind: 'state' }, { sessionId: ID }];
  const set = traits(ID, { records: /** @type {any} */ (junk), summary: null });
  assert.equal(set.line, 'new here');
});

// ---------------------------------------------------------------------------
// Tenure and model
// ---------------------------------------------------------------------------

test('tenure comes off the earliest evidence, including the first_seen carry-over', () => {
  // The carry-over says the session entered its state well before the record
  // that reports it — a day file that rolled over at midnight.
  const records = ledger({ raises: 0, reviews: 8, since: new Date(2026, 7, 20, 12).getTime() });
  const set = traits(ID, { records, summary: summary() });
  assert.ok(set.line.endsWith('since 20 Aug'), set.line);
});

test('shortDate has no year and no Intl', () => {
  assert.equal(shortDate(new Date(2026, 0, 3, 12).getTime()), '3 Jan');
  assert.equal(shortDate(new Date(2026, 11, 25, 12).getTime()), '25 Dec');
  assert.equal(shortDate(Number.NaN), '');
});

test('the model loses its vendor prefix and its datestamp, and nothing else', () => {
  assert.equal(traitModel('claude-opus-5-20260501'), 'opus-5');
  assert.equal(traitModel('claude-sonnet-4-5'), 'sonnet-4-5');
  assert.equal(traitModel('gpt-5-codex'), 'gpt-5-codex');
  assert.equal(traitModel(null), null);
});

test('a session with no model still gets a line', () => {
  const set = traits(ID, {
    records: ledger({ raises: 0, reviews: 8 }),
    summary: summary({ model: null, textMedian: 60 }),
  });
  assert.equal(set.line, 'self-directed · terse · since 1 Sep');
});

// ---------------------------------------------------------------------------
// The tendency
// ---------------------------------------------------------------------------

test('the idle tendency is one of three words, or none', () => {
  const tendency = (over) =>
    traits(ID, {
      records: ledger(over.records || { raises: 0, reviews: 8 }),
      summary: summary(over.summary),
    }).tendency;
  assert.equal(
    tendency({ summary: { toolMix: { files: 0, shell: 20, web: 0, search: 0 } } }),
    'coffee',
  );
  assert.equal(tendency({ records: { raises: 6, reviews: 4 } }), 'thinking');
  assert.equal(tendency({ summary: { textMedian: 900 } }), 'typing');
  assert.equal(tendency({ summary: { textMedian: 60 } }), null);
});

test('the tendency is stable when an agent qualifies for two of them', () => {
  const set = traits(ID, {
    records: ledger({ raises: 6, reviews: 4 }),
    summary: summary({ toolMix: { files: 0, shell: 20, web: 0, search: 0 }, textMedian: 900 }),
  });
  // shell-heavy wins, every time, on every read.
  assert.equal(set.tendency, 'coffee');
  assert.equal(
    traits(ID, {
      records: ledger({ raises: 6, reviews: 4 }),
      summary: summary({ toolMix: { files: 0, shell: 20, web: 0, search: 0 }, textMedian: 900 }),
    }).tendency,
    'coffee',
  );
});

// ---------------------------------------------------------------------------
// The vocabulary itself
// ---------------------------------------------------------------------------

/** Every string this product will ever say about an agent's behaviour. */
const VOCABULARY = Object.values(TRAIT_COPY).flatMap((c) => [c.label, c.definition]);

test('no trait label carries a digit — nothing here is a level or a score', () => {
  for (const [key, copy] of Object.entries(TRAIT_COPY)) {
    assert.ok(!/\d/.test(copy.label), `"${copy.label}" (${key}) has a number in it`);
  }
});

test('nothing in the vocabulary ranks: no superlative, no comparative, no "#"', () => {
  // "then" is deliberately not in this list and "than" is: one is a sequence,
  // the other is a comparison.
  const banned = [
    '#',
    'best',
    'better',
    'worst',
    'worse',
    'top ',
    'rank',
    'level',
    'score',
    'grade',
    'fastest',
    'slowest',
    'highest',
    'lowest',
    'most',
    'least',
    'than',
    'beats',
    'ahead',
    'behind',
  ];
  for (const phrase of VOCABULARY) {
    const lower = phrase.toLowerCase();
    for (const word of banned) {
      assert.ok(!lower.includes(word), `"${phrase}" contains "${word}"`);
    }
  }
});

test('the human is never named: no second person anywhere in the vocabulary', () => {
  for (const phrase of VOCABULARY) {
    const lower = ` ${phrase.toLowerCase()} `;
    for (const word of [
      ' you ',
      ' your ',
      " you're ",
      ' yours ',
      ' user ',
      ' my ',
      ' me ',
      ' we ',
    ]) {
      assert.ok(!lower.includes(word), `"${phrase}" addresses the reader`);
    }
  }
});

test('a computed line only ever contains vocabulary, a model and a date', () => {
  const set = traits(ID, {
    records: ledger({ raises: 6, reviews: 4 }),
    summary: summary({ toolMix: { files: 3, shell: 20, web: 0, search: 2 }, textMedian: 60 }),
  });
  const labels = new Set(Object.values(TRAIT_COPY).map((c) => c.label));
  const parts = set.line.split(' · ');
  const tail = parts.slice(-2);
  assert.equal(tail[0], 'opus-5');
  assert.match(tail[1], /^since \d{1,2} [A-Z][a-z]{2}$/);
  for (const part of parts.slice(0, -2)) {
    assert.ok(labels.has(part), `"${part}" is not in the vocabulary`);
    assert.ok(!/\d/.test(part), `"${part}" has a number in it`);
  }
});
