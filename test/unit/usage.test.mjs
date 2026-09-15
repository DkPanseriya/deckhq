/**
 * WP-83 — token usage instead of money.
 *
 * What these tests are protecting:
 *
 *   1. **Every figure is reconstructible from ledger records.** The fixture
 *      below is eight `tokens` lines; every total, every ranking and every
 *      counter is compared against a sum written out by hand underneath it. If
 *      `aggregate()` ever starts inferring anything, this is where it fails.
 *   2. **A window is day-aligned on an injected clock.** "Today", "7 days" and
 *      "30 days" are the same strings on a CI runner in June as on the
 *      reference machine in September, and a record one millisecond either
 *      side of a boundary lands on the side the boundary says.
 *   3. **`no data`, never `0`.** A counter no record in the window named comes
 *      back in `absent`, and an empty window says so rather than showing an
 *      empty table of zeros. The trend is a number only when BOTH weeks were
 *      lived through.
 *   4. **No currency anywhere with `showCost` off**, which is how it ships —
 *      asserted over the rendered Usage tab, the panel's own bottom line and
 *      the room plate's third line, as literal text.
 *   5. **A ledger written before WP-83 still loads and still totals.** The v1
 *      `tokens` record had no `v`, no `split` and no four-way fields; it is a
 *      total with no breakdown, and that is exactly what a runtime that gives
 *      only a total produces today.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COUNTERS,
  NO_DATA,
  aggregate,
  breakdownDelta,
  copyBreakdown,
  movementOf,
  trend,
  usageReport,
  windowFor,
} from '../../src/core/usage.mjs';
import { LEDGER_TOKENS_VERSION, dayStart, parseRecords } from '../../src/core/ledger.mjs';
import { renderUsageView, counterCell, trendLine, sortRows } from '../../public/usage.js';
import { usageLineParts, costVisible } from '../../public/panel-format.js';
import { plateLinesFor } from '../../public/render/scene-labels.js';

const DAY = 24 * 3600_000;

/**
 * Noon on 14 September 2026, LOCAL — the instant every window below is
 * measured from. Local and not UTC for the reason `dayKey` gives: the rest of
 * this product's day arithmetic is local midnight, and a usage table whose
 * "today" disagreed with the postcard's would be a table nobody could
 * reconcile.
 */
const NOW = new Date(2026, 8, 14, 12, 0, 0).getTime();
const TODAY = dayStart('2026-09-14');

// --------------------------------------------------------------- DOM stub
//
// The same stub `deck-view.test.mjs` uses, for the same reason: it records
// exactly what the renderer asked for and nothing else, so what is asserted is
// what ships rather than a parse of it.

class StubNode {
  /** @param {string} tagName */
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = '';
    this.style = {};
    this.attrs = /** @type {Record<string,string>} */ ({});
    this._text = null;
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  append(...kids) {
    for (const k of kids) this.appendChild(k);
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v);
  }
  get textContent() {
    if (this._text !== null) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }
}
const doc = { createElement: (/** @type {string} */ tag) => new StubNode(tag) };

/** @param {any} node */
function all(node, out = []) {
  out.push(node);
  for (const c of node.children || []) all(c, out);
  return out;
}
const byTag = (/** @type {any} */ root, /** @type {string} */ tag) =>
  all(root).filter((n) => n.tagName === tag.toUpperCase());

// ------------------------------------------------------------- the fixture
//
// Eight records, hand-built so every number below can be added up on paper.
//
//   p1 / claude-code:a   opus, Bash   today      100 in,  200 w,  500 r,  200 out
//   p1 / claude-code:a   opus, Edit   today       10 in,    0 w,   90 r,   40 out
//   p1 / claude-code:b   opus         yesterday   50 in,   50 w,  100 r,  100 out
//   p2 / codex:c         gpt-5        today       30 in,    —     10 r,   20 out
//   p2 / codex:c         gpt-5        3 days ago  70 in,    —     30 r,   10 out
//   p3 / opencode:d      (no model)   9 days ago  11 in,    1 w,    2 r,    3 out
//   p1 / claude-code:a   (v1 record)  today       total only: 300 + 700
//   p2 / codex:c         gpt-5        40 days ago  5 in,    —      5 r,    5 out
//
// The codex rows carry NO `cacheWrite` key at all, which is what the adapter
// writes for a runtime that never reports one — the difference between "none"
// and "not measured" is the whole of rule 3.

/**
 * @param {object} spec
 * @returns {any}
 */
function tokenRec(spec) {
  const counters = spec.counters || null;
  const rec = {
    t: spec.t,
    machineId: 'm1',
    projectKey: spec.projectKey,
    sessionId: spec.sessionId,
    kind: 'tokens',
    delta: spec.delta,
    tokens: spec.delta,
    cacheDelta: spec.cacheDelta,
    cacheTokens: spec.cacheDelta,
  };
  if (counters) {
    rec.v = LEDGER_TOKENS_VERSION;
    rec.split = true;
    if ('input' in counters) rec.in = counters.input;
    if ('output' in counters) rec.out = counters.output;
    if ('cacheRead' in counters) rec.cacheRead = counters.cacheRead;
    if ('cacheWrite' in counters) rec.cacheWrite = counters.cacheWrite;
  }
  if (spec.model) rec.model = spec.model;
  if (spec.tool) rec.tool = spec.tool;
  return rec;
}

function fixture() {
  const at = (/** @type {number} */ daysAgo, /** @type {number} */ hour) =>
    TODAY - daysAgo * DAY + hour * 3600_000;
  return [
    tokenRec({
      t: at(0, 9),
      projectKey: 'p1',
      sessionId: 'claude-code:a',
      model: 'claude-opus-5',
      tool: 'Bash',
      delta: 300,
      cacheDelta: 700,
      counters: { input: 100, output: 200, cacheRead: 500, cacheWrite: 200 },
    }),
    tokenRec({
      t: at(0, 10),
      projectKey: 'p1',
      sessionId: 'claude-code:a',
      model: 'claude-opus-5',
      tool: 'Edit',
      delta: 50,
      cacheDelta: 90,
      counters: { input: 10, output: 40, cacheRead: 90, cacheWrite: 0 },
    }),
    tokenRec({
      t: at(1, 15),
      projectKey: 'p1',
      sessionId: 'claude-code:b',
      model: 'claude-opus-5',
      delta: 150,
      cacheDelta: 150,
      counters: { input: 50, output: 100, cacheRead: 100, cacheWrite: 50 },
    }),
    tokenRec({
      t: at(0, 11),
      projectKey: 'p2',
      sessionId: 'codex:c',
      model: 'gpt-5',
      delta: 50,
      cacheDelta: 10,
      counters: { input: 30, output: 20, cacheRead: 10 },
    }),
    tokenRec({
      t: at(3, 11),
      projectKey: 'p2',
      sessionId: 'codex:c',
      model: 'gpt-5',
      delta: 80,
      cacheDelta: 30,
      counters: { input: 70, output: 10, cacheRead: 30 },
    }),
    tokenRec({
      t: at(9, 11),
      projectKey: 'p3',
      sessionId: 'opencode:d',
      delta: 14,
      cacheDelta: 3,
      counters: { input: 11, output: 3, cacheRead: 2, cacheWrite: 1 },
    }),
    // A v1 line: no `v`, no `split`, no four-way fields. This is the shape a
    // ledger written before WP-83 holds, AND the shape a runtime that gives
    // only a total produces today.
    tokenRec({
      t: at(0, 12),
      projectKey: 'p1',
      sessionId: 'claude-code:a',
      delta: 300,
      cacheDelta: 700,
    }),
    tokenRec({
      t: at(40, 11),
      projectKey: 'p2',
      sessionId: 'codex:c',
      model: 'gpt-5',
      delta: 10,
      cacheDelta: 5,
      counters: { input: 5, output: 5, cacheRead: 5 },
    }),
  ];
}

// ------------------------------------------------------------------ windows

test('WP-83: a window is day-aligned on the clock it is handed', () => {
  assert.deepEqual(windowFor('today', NOW), {
    name: 'today',
    since: TODAY,
    until: NOW,
    days: 1,
    label: 'today',
  });
  assert.equal(windowFor('7d', NOW).since, TODAY - 6 * DAY);
  assert.equal(windowFor('30d', NOW).since, TODAY - 29 * DAY);
  // An unknown name is the middle window rather than a throw: this value
  // arrives from a query string.
  assert.equal(windowFor('fortnight', NOW).name, '7d');
});

test('WP-83: a record one millisecond either side of the boundary lands where it should', () => {
  const edge = [
    tokenRec({ t: TODAY - 1, projectKey: 'p1', sessionId: 's', delta: 7, cacheDelta: 0 }),
    tokenRec({ t: TODAY, projectKey: 'p1', sessionId: 's', delta: 11, cacheDelta: 0 }),
  ];
  const today = aggregate(edge, { now: NOW, window: 'today' });
  assert.equal(today.totals.total, 11, 'yesterday 23:59:59.999 is not today');
  assert.equal(today.totals.records, 1);
  // And the wider window holds both.
  assert.equal(aggregate(edge, { now: NOW, window: '7d' }).totals.total, 18);
  // `until` is now, so a record in the future is outside every window.
  const future = [
    tokenRec({ t: NOW + 1, projectKey: 'p1', sessionId: 's', delta: 5, cacheDelta: 0 }),
  ];
  assert.equal(aggregate(future, { now: NOW, window: '30d' }).empty, true);
});

// -------------------------------------------------------------- the sums

test('WP-83: the aggregate of the fixture equals the sums done by hand', () => {
  const today = aggregate(fixture(), { now: NOW, window: 'today' });

  // Four records land today: the two claude ones, the codex one, and the v1
  // line. Hand sums over the three that carry a breakdown:
  //   input       100 + 10 + 30 = 140
  //   cacheWrite  200 +  0       = 200   (codex names none)
  //   cacheRead   500 + 90 + 10 = 600
  //   output      200 + 40 + 20 = 260
  // and the total is `delta + cacheDelta` over ALL FOUR, the v1 line included:
  //   (300+700) + (50+90) + (50+10) + (300+700) = 2200
  assert.equal(today.totals.input, 140);
  assert.equal(today.totals.cacheWrite, 200);
  assert.equal(today.totals.cacheRead, 600);
  assert.equal(today.totals.output, 260);
  assert.equal(today.totals.total, 2200);
  assert.equal(today.totals.records, 4);
  assert.deepEqual(today.totals.absent, [], 'every counter was named by something today');

  // By project, ranked. p1 is 1000 + 140 + 1000 = 2140; p2 is 60.
  assert.deepEqual(
    today.byProject.map((r) => [r.projectKey, r.total]),
    [
      ['p1', 2140],
      ['p2', 60],
    ],
  );
  // p2 is codex only, so its cache-write column is `no data` and not zero.
  const p2 = today.byProject.find((r) => r.projectKey === 'p2');
  assert.deepEqual(p2.absent, ['cacheWrite']);
  assert.equal(counterCell(p2, 'cacheWrite'), NO_DATA);
  assert.equal(counterCell(p2, 'cacheRead'), '10');

  // By session: the same tokens, keyed by who spent them.
  assert.deepEqual(
    today.bySession.map((r) => [r.sessionId, r.total]),
    [
      ['claude-code:a', 2140],
      ['codex:c', 60],
    ],
  );
  // The model is the last one a record for that session named — the v1 line
  // names none, and an absent name never overwrites one that was observed.
  assert.equal(today.bySession[0].model, 'claude-opus-5');

  // By model, and by tool. Neither is filed under a made-up key, so the v1
  // line is in neither — and `attributed` says how much each could account for.
  assert.deepEqual(
    today.byModel.map((r) => [r.model, r.total]),
    [
      ['claude-opus-5', 1140],
      ['gpt-5', 60],
    ],
  );
  assert.deepEqual(
    today.byTool.map((r) => [r.tool, r.total]),
    [
      ['Bash', 1000],
      ['Edit', 140],
    ],
  );
  assert.equal(today.attributed.model, 1200);
  assert.equal(today.attributed.tool, 1140);

  // By day reads as a calendar, oldest first, never ranked by size.
  const week = aggregate(fixture(), { now: NOW, window: '7d' });
  assert.deepEqual(
    week.byDay.map((r) => r.key),
    ['2026-09-11', '2026-09-13', '2026-09-14'],
  );
  // 7 days: today's 2200, yesterday's 300, and 110 three days ago.
  assert.equal(week.totals.total, 2610);
  // 30 days adds the nine-day-old opencode line; the 40-day-old one is out.
  assert.equal(aggregate(fixture(), { now: NOW, window: '30d' }).totals.total, 2627);
});

test('WP-83: the four-way split never exceeds what the records named', () => {
  // A property rather than a hand sum: for every window, each counter is the
  // sum of that field over the records that carried it, and nothing else.
  for (const name of ['today', '7d', '30d']) {
    const win = windowFor(name, NOW);
    const agg = aggregate(fixture(), { now: NOW, window: name });
    for (const counter of COUNTERS) {
      const field = counter === 'input' ? 'in' : counter === 'output' ? 'out' : counter;
      const expected = fixture()
        .filter((r) => r.t >= win.since && r.t <= win.until && r.split === true)
        .reduce((a, r) => a + (typeof r[field] === 'number' ? r[field] : 0), 0);
      assert.equal(agg.totals[counter], expected, `${name} / ${counter}`);
    }
  }
});

// ------------------------------------------------------------- no data

test('WP-83: an empty window says so rather than showing a table of zeros', () => {
  const agg = aggregate([], { now: NOW, window: '7d' });
  assert.equal(agg.empty, true);
  assert.equal(agg.totals.total, 0);
  assert.deepEqual(agg.totals.absent, [...COUNTERS], 'nothing named any counter');
  assert.deepEqual(agg.byProject, []);
  assert.deepEqual(agg.bySession, []);
  assert.deepEqual(agg.byDay, []);

  const view = renderUsageView(agg, { window: '7d' }, doc);
  assert.match(view.textContent, /no data/);
  assert.equal(byTag(view, 'table').length, 0, 'an empty window draws no tables at all');
});

test('WP-83: a window with no cache-write record reads "no data", never 0', () => {
  const codexOnly = fixture().filter((r) => r.sessionId === 'codex:c');
  const agg = aggregate(codexOnly, { now: NOW, window: '30d' });
  assert.equal(agg.totals.cacheWrite, 0);
  assert.deepEqual(agg.totals.absent, ['cacheWrite']);
  assert.equal(counterCell(agg.totals, 'cacheWrite'), NO_DATA);
  // The bar leaves the segment out entirely rather than drawing a zero-width
  // one, and its label says the counter is absent.
  const view = renderUsageView(agg, { window: '30d' }, doc);
  assert.match(view.textContent, /no data/);
});

test('WP-83: the trend is a number only when both weeks were lived through', () => {
  const onlyThisWeek = fixture().filter((r) => r.t >= TODAY - 6 * DAY);
  assert.equal(trend(onlyThisWeek, { now: NOW }).status, NO_DATA);
  assert.equal(trendLine(trend(onlyThisWeek, { now: NOW })), `7 days vs the 7 before · ${NO_DATA}`);

  // Both weeks with records: 200 last week against 100 the week before.
  const both = [
    tokenRec({ t: TODAY - DAY, projectKey: 'p', sessionId: 's', delta: 200, cacheDelta: 0 }),
    tokenRec({ t: TODAY - 8 * DAY, projectKey: 'p', sessionId: 's', delta: 100, cacheDelta: 0 }),
  ];
  const t = trend(both, { now: NOW });
  assert.equal(t.status, 'ok');
  assert.equal(t.current, 200);
  assert.equal(t.previous, 100);
  assert.equal(t.changePct, 100);
  assert.equal(trendLine(t), '7 days vs the 7 before · +100%');
  // The two windows do not overlap by a millisecond.
  assert.equal(t.priorUntil + 1, t.since);
});

// ----------------------------------------------------- backward compatibility

test('WP-83: a ledger written before this package still loads and still totals', () => {
  // Byte for byte the shape WP-17 wrote: no `v`, no `split`, no `in`/`out`.
  const v1 = [
    '{"t":1789000000000,"machineId":"m","projectKey":"p1","sessionId":"claude-code:a",' +
      '"kind":"tokens","delta":1200,"tokens":1200,"cacheDelta":800,"cacheTokens":800}',
    '{"t":1789000000001,"machineId":"m","projectKey":"p1","sessionId":"claude-code:a",' +
      '"kind":"state","dim":"activity","from":"working","to":"for_review"}',
  ].join('\n');
  const records = parseRecords(v1);
  assert.equal(records.length, 2);

  const agg = aggregate(records, { now: 1789000000002, since: 0, until: 1789000000002 });
  assert.equal(agg.totals.total, 2000, 'a v1 record still totals');
  assert.equal(agg.empty, false);
  // And it contributes to NONE of the four columns, because it named none.
  assert.deepEqual(agg.totals.absent, [...COUNTERS]);
  for (const counter of COUNTERS) assert.equal(agg.totals[counter], 0);

  // `movementOf` is where that decision is made, so assert it directly too.
  assert.deepEqual(movementOf(records[0]), { split: false, counters: {}, total: 2000 });
});

test('WP-83: a breakdown is copied key by key, and a delta never runs backwards', () => {
  assert.equal(copyBreakdown(null), null);
  assert.equal(copyBreakdown({}), null, 'an empty object is not a breakdown');
  assert.deepEqual(copyBreakdown({ input: 5, cacheRead: 'x', nonsense: 1 }), { input: 5 });

  // First sighting: the whole of it is the movement.
  assert.deepEqual(breakdownDelta({ input: 10, output: 4 }, null), { input: 10, output: 4 });
  // A normal step.
  assert.deepEqual(breakdownDelta({ input: 10, output: 4 }, { input: 6, output: 1 }), {
    input: 4,
    output: 3,
  });
  // A transcript that was truncated: the counter goes DOWN, and that is not
  // spend coming back. Clamped at zero, exactly as `Ledger._noteTokens` does.
  assert.deepEqual(breakdownDelta({ input: 2 }, { input: 9 }), { input: 0 });
  // A runtime that gives no breakdown gives no record fields either.
  assert.equal(breakdownDelta(null, { input: 9 }), null);
});

// ------------------------------------------------------------ the surfaces

test('WP-83: the Usage tab is five real tables, sortable, with a row header each', () => {
  const usage = usageReport(fixture(), { now: NOW, window: '30d' });
  const view = renderUsageView(
    usage,
    { window: '30d', projectNames: { p1: 'orbital-api' }, sessionNames: {} },
    doc,
  );

  const tables = byTag(view, 'table');
  assert.equal(tables.length, 5);
  for (const table of tables) {
    assert.ok(byTag(table, 'caption').length === 1, 'every table names itself');
    const headers = byTag(table, 'th').filter((th) => th.getAttribute('scope') === 'col');
    assert.ok(headers.length >= 6, 'the four counters, the key and the total');
    // Every column header is a real button, so sorting is reachable by keyboard.
    for (const th of headers) assert.equal(byTag(th, 'button').length, 1);
    // And every body row leads with a row header, so reading down the Output
    // column still says whose output it is.
    const bodyRows = byTag(table, 'tr').filter((tr) => byTag(tr, 'td').length > 0);
    for (const tr of bodyRows) {
      if (tr.children[0].className === 'usage-empty') continue;
      assert.equal(tr.children[0].tagName, 'TH');
      assert.equal(tr.children[0].getAttribute('scope'), 'row');
    }
  }

  // `aria-sort` is on the sorted column and on nowhere else. BY DAY starts on
  // its day column, ascending — a table of days ranked by size is not a
  // picture of a week, and it is the one table here whose row order carries
  // meaning of its own.
  for (const table of tables) {
    const sorted = byTag(table, 'th').filter((th) => th.getAttribute('aria-sort') !== null);
    assert.equal(sorted.length, 1);
    const day = table.getAttribute('data-table') === 'by-day';
    assert.equal(sorted[0].getAttribute('aria-sort'), day ? 'ascending' : 'descending');
    assert.equal(sorted[0].getAttribute('data-column'), day ? 'day' : 'total');
  }

  // And the days really do arrive as a calendar, oldest first, even though
  // the last of them is by far the largest.
  const byDay = tables.find((t) => t.getAttribute('data-table') === 'by-day');
  const days = byTag(byDay, 'tbody')[0].children.map((tr) => tr.children[0].textContent);
  assert.deepEqual(days, [...days].sort());

  // A project key with a name on the floor reads as the name; one without
  // stays a shortened hash rather than being guessed at.
  assert.match(view.textContent, /orbital-api/);
  assert.match(view.textContent, /p2/);

  // The window picker offers exactly three, with the active one pressed.
  const pressed = all(view).filter((n) => n.getAttribute?.('aria-pressed') === 'true');
  assert.equal(pressed.length, 1);
  assert.equal(pressed[0].getAttribute('data-window'), '30d');
});

test('WP-83: sorting is total — two equal rows land in the same place every time', () => {
  const rows = [
    { key: 'b', total: 10 },
    { key: 'a', total: 10 },
    { key: 'c', total: 99 },
  ];
  const valueOf = (/** @type {any} */ r, /** @type {string} */ k) => r[k];
  assert.deepEqual(
    sortRows(rows, 'total', 'desc', valueOf).map((r) => r.key),
    ['c', 'a', 'b'],
  );
  assert.deepEqual(
    sortRows(rows, 'total', 'asc', valueOf).map((r) => r.key),
    ['a', 'b', 'c'],
  );
});

test('WP-83: the panel says this session’s four counters, and no data where there are none', () => {
  const full = usageLineParts({
    tokens: 300,
    cacheTokens: 700,
    model: 'claude-opus-5',
    tokenBreakdown: { input: 100, output: 200, cacheRead: 500, cacheWrite: 200 },
  });
  assert.deepEqual(full, [
    '1,000 tok',
    '100 in',
    '200 cache w',
    '500 cache r',
    '200 out',
    'opus-5',
  ]);

  // Codex: three counters, and the fourth says it was not measured.
  const partial = usageLineParts({
    tokens: 50,
    cacheTokens: 10,
    model: 'gpt-5',
    tokenBreakdown: { input: 30, output: 20, cacheRead: 10 },
  });
  assert.ok(partial.includes('cache w no data'));

  // No breakdown at all: the two numbers that ARE measured, and a statement
  // that the split is not one of them.
  const none = usageLineParts({ tokens: 50, cacheTokens: 10, model: null });
  assert.deepEqual(none, ['60 tok', '10 cache', 'split no data']);
});

test('WP-83: no rendered surface carries a currency with showCost off', () => {
  // The shipped default, over the three surfaces that had one: the Usage tab
  // (which never has one under any setting), the panel's bottom line, and the
  // room plate's third line. Asserted as literal text, the way
  // `rates.test.mjs` asserts the opposite direction.
  const money = /\$|≈|list price|no rate|rate card/;

  const snapshot = { settings: {} };
  assert.equal(costVisible(snapshot), false, 'absent reads as off');
  assert.equal(costVisible({ settings: { showCost: true } }), true);

  const view = renderUsageView(usageReport(fixture(), { now: NOW, window: '30d' }), {}, doc);
  assert.doesNotMatch(view.textContent, money);

  const panel = usageLineParts({
    tokens: 300,
    cacheTokens: 700,
    model: 'claude-opus-5',
    tokenBreakdown: { input: 100, output: 200, cacheRead: 500, cacheWrite: 200 },
  }).join(' · ');
  assert.doesNotMatch(panel, money);

  const plate = plateLinesFor(
    { kind: 'project', id: 'p0', name: 'deckhq' },
    {
      settings: {},
      projects: [
        {
          id: 'p0',
          sessionCount: 2,
          tokens: 2_200_000,
          needsYou: 0,
          // Priced, and priced well — the plate still must not say so.
          todaySpend: 18.4,
          todaySpendIsToday: true,
          todayTokens: 412_000,
          todayTokensIsToday: true,
        },
      ],
    },
  );
  assert.doesNotMatch(plate.join(' · '), money);
  // WP-81 ranked the plate's lines: the tokens are its fourth and quietest,
  // under the room's name, the line that needs action and the line that says
  // what is being done. The figure and its qualifier are unchanged.
  assert.equal(plate[3], 'today 412k tok · with cache');
});
