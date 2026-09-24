/**
 * Tracking — WP-71, `docs/07-STUDIO-DESIGN.md` §7 and §10 acceptance (1), (2).
 *
 * Every figure below is compared against a sum written out by hand in the
 * comment above it, on `test/unit/usage.test.mjs`'s discipline: a fold that
 * is checked only against itself proves nothing.
 *
 * THE FIXTURE (all times in ms; minutes are 60 000):
 *
 *   card c1, role `backend` → agent A (from the roster, not the card)
 *     moves  backlog → in_progress at 1 000 000
 *            in_progress → review  at 2 800 000        → 1 800 000 ms = 30 min
 *     A's tokens records
 *       t=  500 000  delta 999                           OUTSIDE the stretch
 *       t=1 200 000  in 100 out 50 cacheRead 1000 cacheWrite 200, opus
 *       t=2 000 000  in  10 out  5,                                  opus
 *       t=3 000 000  delta 777                           OUTSIDE the stretch
 *                    total   = 150 + 1200 + 15 = 1365
 *                    input 110, output 55, cacheRead 1000, cacheWrite 200
 *     A's state records: for_review at 1 500 000, working at 1 560 000
 *                    review  = 60 000 ms, one episode
 *     cost at $15 / $75 / $1.50 / $18.75 per million:
 *        110×15 + 55×75 + 1000×1.5 + 200×18.75 = 1650 + 4125 + 1500 + 3750
 *        = 11 025 per million = $0.011025, and `costOf` rounds to $0.011
 *
 *   card c2 — no role, no agent, no moves, no criteria: `no data` throughout
 *
 *   card c3, milestone m1, agent B on the card, budget 1000 tokens
 *     B's one record: delta 1200, no breakdown, no model  → total 1200,
 *     crossed; and unpriceable, because no model was named
 */
import '../helpers/isolate.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NOTHING,
  agentOfCard,
  crossedBudget,
  trackBoard,
  trackCard,
  workStretches,
} from '../../src/studio/tracking.mjs';
import { appendMove, validateBoard } from '../../src/studio/schema.mjs';
import { parseRateCard } from '../../src/core/rates.mjs';

const A = 'claude-code:aaa';
const B = 'claude-code:bbb';
const NOW = 5_000_000;

const tok = (t, sessionId, extra) => ({ t, sessionId, projectKey: 'p', kind: 'tokens', ...extra });
const split = (t, sessionId, n, model) =>
  tok(t, sessionId, {
    v: 2,
    split: true,
    delta: n.in + n.out,
    cacheDelta: (n.cacheRead || 0) + (n.cacheWrite || 0),
    in: n.in,
    out: n.out,
    cacheRead: n.cacheRead || 0,
    cacheWrite: n.cacheWrite || 0,
    model,
  });

const RECORDS = [
  tok(500_000, A, { delta: 999, cacheDelta: 0 }),
  split(1_200_000, A, { in: 100, out: 50, cacheRead: 1000, cacheWrite: 200 }, 'claude-opus-4'),
  { t: 1_500_000, sessionId: A, projectKey: 'p', kind: 'state', dim: 'activity', to: 'for_review' },
  { t: 1_560_000, sessionId: A, projectKey: 'p', kind: 'state', dim: 'activity', to: 'working' },
  split(2_000_000, A, { in: 10, out: 5 }, 'claude-opus-4'),
  tok(3_000_000, A, { delta: 777, cacheDelta: 0 }),
  tok(4_000_000, B, { delta: 1200, cacheDelta: 0 }),
];

const ROSTER = { roles: [{ name: 'backend', agentId: A }] };

const CARDS = [
  {
    id: 'c1',
    title: 'one',
    acceptance: ['a failing test first', 'npm test green'],
    acceptanceDone: ['npm test green'],
    milestone: 'm1',
    role: 'backend',
    column: 'review',
    budget: null,
    agentId: null,
    flags: [],
    moves: [
      { from: 'backlog', to: 'in_progress', at: 1_000_000 },
      { from: 'in_progress', to: 'review', at: 2_800_000 },
    ],
  },
  { id: 'c2', title: 'two', acceptance: [], milestone: null, role: null, column: 'backlog' },
  {
    id: 'c3',
    title: 'three',
    acceptance: ['one', 'two', 'three', 'four'],
    acceptanceDone: ['one'],
    milestone: 'm1',
    role: null,
    agentId: B,
    column: 'in_progress',
    budget: { tokens: 1000, minutes: null },
  },
];

const RATES = parseRateCard({
  version: '2026-09-01',
  rates: [{ match: 'claude-opus-4', input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }],
});

const HANDOVERS = [
  { cardId: 'c1', path: '/p/.deckhq/studio/handovers/c1.md', quote: 'the handover says 43 passed' },
  { cardId: null, path: '/p/.deckhq/studio/handovers/c9.md', quote: 'the handover says 1 passed' },
];

test('a card’s figures equal the sums written out by hand', () => {
  const t = trackCard(CARDS[0], {
    records: RECORDS,
    roster: ROSTER,
    handovers: HANDOVERS,
    now: NOW,
  });
  assert.equal(t.agentId, A, 'the session comes from the roster, by the card’s role');
  assert.equal(t.status, 'ok');
  assert.deepEqual(t.tokens, {
    status: 'ok',
    total: 1365,
    input: 110,
    cacheWrite: 200,
    cacheRead: 1000,
    output: 55,
    absent: [],
    records: 2,
    scope: 'card',
  });
  assert.deepEqual(t.time, {
    status: 'ok',
    ms: 1_800_000,
    minutes: 30,
    open: false,
    since: 1_000_000,
    stretches: 1,
  });
  assert.deepEqual(t.review, { status: 'ok', ms: 60_000, episodes: 1, open: false });
  assert.deepEqual(t.tests, {
    status: 'ok',
    quote: 'the handover says 43 passed',
    path: '/p/.deckhq/studio/handovers/c1.md',
  });
  assert.deepEqual(t.acceptance, { status: 'ok', ticked: 1, total: 2 });
  assert.equal('cost' in t, false, 'with showCost off there is no cost field at all');
  assert.equal(t.crossed, null);
});

test('INVARIANT: a card with no records reads `no data`, and no digit appears in it', () => {
  const t = trackCard(CARDS[1], {
    records: RECORDS,
    roster: ROSTER,
    handovers: HANDOVERS,
    now: NOW,
  });
  assert.equal(t.status, 'no data');
  for (const key of ['tokens', 'time', 'review', 'tests', 'acceptance']) {
    assert.deepEqual(t[key], NOTHING, `${key} is no data`);
  }
  // Not one number anywhere in what is said about it — not even a zero. The
  // card's own id is its name, and it is the one field left out of the scan.
  const { cardId: _name, ...said } = t;
  assert.equal(/\d/.test(JSON.stringify(said)), false, JSON.stringify(said));
  // And with the money switched on, still nothing to price.
  const priced = trackCard(CARDS[1], {
    records: RECORDS,
    now: NOW,
    showCost: true,
    rateCard: RATES,
  });
  assert.deepEqual(priced.cost, NOTHING);
});

test('cost is the dated rate card’s list price, and an unpriceable model prints no number', () => {
  const opts = { records: RECORDS, roster: ROSTER, now: NOW, showCost: true, rateCard: RATES };
  const c1 = trackCard(CARDS[0], opts);
  assert.deepEqual(c1.cost, {
    status: 'ok',
    usd: 0.011,
    rateCard: '2026-09-01',
    label: 'list price',
  });
  const c3 = trackCard(CARDS[2], opts);
  assert.deepEqual(c3.cost, { status: 'no rate', rateCard: '2026-09-01', label: 'list price' });
  assert.equal('usd' in c3.cost, false);
});

test('a card with no stretches is measured over its session, and says so', () => {
  const t = trackCard(CARDS[2], { records: RECORDS, now: NOW });
  assert.equal(t.tokens.total, 1200);
  assert.equal(t.tokens.scope, 'session');
  assert.deepEqual(t.tokens.absent, ['input', 'cacheWrite', 'cacheRead', 'output']);
  assert.deepEqual(t.time, NOTHING, 'no move into in_progress was recorded, so no time');
});

test('the budget crosses on a measured figure only, tokens or minutes', () => {
  const c3 = trackCard(CARDS[2], { records: RECORDS, now: NOW });
  assert.deepEqual(c3.crossed, {
    which: 'tokens',
    spent: 1200,
    cap: 1000,
    text: '1,200 of 1,000 tokens spent, 1/4 criteria met',
  });
  // Minutes: 30 on the card against a cap of 30.
  const timed = trackCard(
    { ...CARDS[0], budget: { tokens: null, minutes: 30 } },
    { records: [], roster: ROSTER, now: NOW },
  );
  assert.equal(timed.crossed?.which, 'minutes');
  assert.equal(timed.crossed?.text, '30 of 30 minutes on the card, 1/2 criteria met');
  // No records and no moves: nothing was spent that anybody recorded.
  assert.equal(
    crossedBudget(trackCard({ ...CARDS[1], budget: { tokens: 1, minutes: 1 } }, { now: NOW })),
    null,
  );
  // A cap of zero is no cap.
  assert.equal(
    trackCard({ ...CARDS[2], budget: { tokens: 0, minutes: null } }, { records: RECORDS, now: NOW })
      .crossed,
    null,
  );
});

test('the milestone burn-down is ticked criteria against cards left', () => {
  const out = trackBoard({ cards: CARDS }, { records: RECORDS, roster: ROSTER, now: NOW });
  assert.equal(out.cards.length, 3);
  // m1 holds c1 (review) and c3 (in_progress): two cards, both left. Criteria
  // 2 + 4 = 6, ticked 1 + 1 = 2. Tokens 1365 + 1200 = 2565 over two cards.
  assert.deepEqual(out.milestones, [
    {
      milestone: 'm1',
      cards: 2,
      left: 2,
      burnDown: { status: 'ok', ticked: 2, criteria: 6, left: 2 },
      tokens: { status: 'ok', total: 2565, cards: 2 },
    },
  ]);
});

test('an open stretch runs to now, and a move out with no move in counts nothing', () => {
  assert.deepEqual(workStretches([{ from: 'ready', to: 'in_progress', at: 10 }], 70), [
    { since: 10, until: 70, open: true },
  ]);
  assert.deepEqual(workStretches([{ from: 'in_progress', to: 'review', at: 10 }], 70), []);
  assert.deepEqual(
    workStretches(
      [
        { from: 'ready', to: 'in_progress', at: 10 },
        { from: 'in_progress', to: 'blocked', at: 20 },
        { from: 'blocked', to: 'in_progress', at: 50 },
        { from: 'in_progress', to: 'done', at: 65 },
      ],
      100,
    ),
    [
      { since: 10, until: 20, open: false },
      { since: 50, until: 65, open: false },
    ],
  );
});

test('the session is the card’s own agent, else its role’s, else none', () => {
  assert.equal(agentOfCard({ agentId: B, role: 'backend' }, ROSTER), B);
  assert.equal(agentOfCard({ role: 'Backend' }, ROSTER), A);
  assert.equal(agentOfCard({ role: 'frontend' }, ROSTER), null);
  assert.equal(agentOfCard({}, ROSTER), null);
});

test('the schema keeps ticks that name a criterion, and moves that name two columns', () => {
  const key = '0123456789abcdef';
  const ok = validateBoard({
    version: 1,
    projectKey: key,
    cards: [
      {
        id: 'c1',
        column: 'review',
        acceptance: ['a', 'b'],
        acceptanceDone: ['b', 'not a criterion', 'b'],
        moves: [{ from: 'backlog', to: 'review', at: 5 }],
      },
      { id: 'c2', column: 'backlog' },
    ],
  });
  assert.ok('board' in ok);
  assert.deepEqual(ok.board.cards[0].acceptanceDone, ['b']);
  assert.deepEqual(ok.board.cards[0].moves, [{ from: 'backlog', to: 'review', at: 5 }]);
  // Absent when empty, so a board from before this build writes back the same.
  assert.equal('acceptanceDone' in ok.board.cards[1], false);
  assert.equal('moves' in ok.board.cards[1], false);

  const bad = validateBoard({
    version: 1,
    projectKey: key,
    cards: [{ id: 'c1', column: 'review', moves: [{ from: 'nowhere', to: 'review', at: 5 }] }],
  });
  assert.ok('error' in bad);
  assert.equal(bad.path, 'cards[0].moves[0]');

  assert.deepEqual(appendMove(undefined, 'ready', 'ready', 1), [], 'staying put is not a move');
  assert.deepEqual(appendMove([], 'ready', 'in_progress', 7), [
    { from: 'ready', to: 'in_progress', at: 7 },
  ]);
});
