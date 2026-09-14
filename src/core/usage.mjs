/**
 * WP-83 — where the tokens went.
 *
 * The owner, 14 September 2026:
 *
 * > "Maybe we do not want today cost etc. because mostly people will have
 * >  subscriptions, so they have a different billing system. But it should
 * >  help them track their token usage: where are they going, how much, in
 * >  which sessions, how much input, cached, output, so they can make smart
 * >  decisions."
 *
 * `docs/plan/08-PLAN-V2-100X.md` §1.1 rule 7 has always said cost is an
 * estimate and never a bill, and that is still true — but a dollar figure at
 * public list prices is not a subscriber's bill and not their budget either.
 * Tokens are what they actually spend and the one number a rate card cannot
 * get wrong. So the rate card moves behind `settings.showCost`, which ships
 * **off**, and this module is what stands where it was.
 *
 * ## The four rules this file exists to keep
 *
 * 1. **Every number is reconstructible from ledger records.** Nothing here
 *    reads a disk, a registry or a clock it was not handed. Records in,
 *    numbers out — `test/unit/usage.test.mjs` aggregates a fixture and
 *    compares it against sums written out by hand.
 * 2. **A counter nobody reported is `no data`, never `0`.** `TokenBreakdown`
 *    in `src/core/model.mjs` carries a key only when the runtime named it, and
 *    every bucket below carries `absent` — the counters that no contributing
 *    record named. A Codex-only window has no cache-write column because Codex
 *    does not write one down, and a confident `0` there would be a measurement
 *    nobody made. This is `src/core/rates.mjs`'s `NO_RATE` rule, applied to
 *    tokens.
 * 3. **A window is day-aligned on an injected clock.** `windowFor` takes
 *    `now` and nothing else, so "today", "7 days" and "30 days" are the same
 *    strings on a CI runner in June as on the reference machine in September.
 *    Local midnight and not UTC, for the reason `dayKey` gives.
 * 4. **An empty window says so.** `aggregate()` sets `empty` and every ranked
 *    list comes back `[]`; `trend()` returns `no data` unless BOTH weeks have
 *    records, because a ratio against a week that was not lived through is a
 *    number with no meaning and a direction anyway.
 *
 * ## The record this reads
 *
 * `ledger.mjs`'s `tokens` kind, at `v: 2` (WP-83):
 *
 *     {t, machineId, projectKey, sessionId, kind:'tokens', v:2,
 *      delta, tokens, cacheDelta, cacheTokens,     // v1, unchanged
 *      split, in, out, cacheRead, cacheWrite,      // the four-way movement
 *      model, tool}                                // what spent it, on what
 *
 * A v1 record — anything without `split: true` — is a total and no breakdown,
 * which is exactly the "runtime gave only a total" case. It still counts
 * toward `total`; it contributes to none of the four columns, and it is why
 * `absent` is computed from what was SEEN rather than from what is missing.
 */

import { DAY_MS, dayKey, dayStart, finiteNumber } from './ledger-record.mjs';
import { now as clockNow } from './clock.mjs';

/**
 * The four counters, in the order every table prints them: the order a turn
 * actually happens in. Input is what you sent, a cache write is what was
 * stored off the back of it, a cache read is what came back free next time,
 * and output is what the model said.
 */
export const COUNTERS = /** @type {const} */ (['input', 'cacheWrite', 'cacheRead', 'output']);

/** What a bucket prints where no record named that counter. Rule 2. */
export const NO_DATA = 'no data';

/** The windows the Usage tab offers, and the only three it offers. */
export const WINDOWS = /** @type {const} */ (['today', '7d', '30d']);

/** How many days each side of the trend covers. */
export const TREND_DAYS = 7;

/**
 * The `tokens` record fields that carry each counter's movement. Named once,
 * here, so the writer in `state-machine-snapshot.mjs` and every reader below
 * cannot drift — `in` and `out` are short because a ledger line is written
 * once per scan per session and read for ninety days.
 */
export const COUNTER_FIELDS = Object.freeze({
  input: 'in',
  cacheWrite: 'cacheWrite',
  cacheRead: 'cacheRead',
  output: 'out',
});

/**
 * A breakdown copied key by key, dropping anything that is not a finite
 * number, or `null` when there is nothing to copy.
 *
 * A COPY and not the object it was given: a `SessionSummary` can come out of
 * the summary cache, and handing the registry a live handle on a cached object
 * is the defect `summary-cache.mjs` rule 3 exists to prevent.
 *
 * @param {any} raw
 * @returns {import('./model.mjs').TokenBreakdown|null}
 */
export function copyBreakdown(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  /** @type {Record<string, number>} */
  const out = {};
  let any = false;
  for (const counter of COUNTERS) {
    const n = finiteNumber(raw[counter]);
    if (n == null) continue;
    out[counter] = n;
    any = true;
  }
  return any ? out : null;
}

/**
 * How far each counter moved between two breakdowns, or `null` when the
 * runtime gave no breakdown this time round.
 *
 * A key present in `next` and absent from `prev` is the session's FIRST
 * sighting of that counter, so the whole of it is the movement. A key absent
 * from `next` is absent from the result: a runtime that stopped reporting a
 * counter has not spent a negative number of it.
 *
 * Forward movement only, exactly as `Ledger._noteTokens` clamps the totals: a
 * counter going down is a transcript that was truncated or rotated, and
 * letting it subtract would make a room's day cheaper because a log rolled.
 *
 * @param {import('./model.mjs').TokenBreakdown|null|undefined} next
 * @param {import('./model.mjs').TokenBreakdown|null|undefined} prev
 * @returns {Record<string, number>|null}
 */
export function breakdownDelta(next, prev) {
  const to = copyBreakdown(next);
  if (!to) return null;
  const from = copyBreakdown(prev) || {};
  /** @type {Record<string, number>} */
  const out = {};
  for (const counter of COUNTERS) {
    const n = /** @type {any} */ (to)[counter];
    if (typeof n !== 'number') continue;
    const was = /** @type {any} */ (from)[counter];
    out[counter] = Math.max(0, n - (typeof was === 'number' ? was : 0));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/**
 * The half-open window a picker name means, on the clock it is handed.
 *
 * Day-aligned at the near end and open at the far end: "7 days" is the last
 * seven LOCAL DAYS including today, not the last 168 hours, because the rest
 * of this product's day arithmetic is local-midnight (`dayKey`) and a usage
 * table whose "today" column disagreed with the postcard's would be a table
 * nobody could reconcile.
 *
 * @param {typeof WINDOWS[number]|string} name
 * @param {number} [now]
 * @returns {{name:string, since:number, until:number, days:number, label:string}}
 */
export function windowFor(name, now = clockNow()) {
  const todayStart = dayStart(dayKey(now));
  const spec =
    name === 'today'
      ? { days: 1, label: 'today' }
      : name === '30d'
        ? { days: 30, label: 'last 30 days' }
        : { days: 7, label: 'last 7 days' };
  const key = name === 'today' ? 'today' : name === '30d' ? '30d' : '7d';
  return {
    name: key,
    since: todayStart - (spec.days - 1) * DAY_MS,
    until: now,
    days: spec.days,
    label: spec.label,
  };
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

/** A fresh, empty bucket. @param {string} key */
function emptyBucket(key) {
  return {
    key,
    input: 0,
    cacheWrite: 0,
    cacheRead: 0,
    output: 0,
    /** Every token the window saw move, breakdown or not. */
    total: 0,
    /** How many `tokens` records landed in this bucket. */
    records: 0,
    /** @type {Set<string>} which counters any record here actually named */
    _seen: new Set(),
  };
}

/**
 * Turn the working buckets into the plain objects a route serialises: the
 * private `_seen` becomes the public `absent`, which is rule 2 in one field.
 * @param {Map<string, ReturnType<typeof emptyBucket>>} map
 * @param {(key:string) => Record<string, any>} [extra]
 */
function seal(map, extra) {
  /** @type {any[]} */
  const out = [];
  for (const b of map.values()) {
    out.push({
      key: b.key,
      input: b.input,
      cacheWrite: b.cacheWrite,
      cacheRead: b.cacheRead,
      output: b.output,
      total: b.total,
      records: b.records,
      absent: COUNTERS.filter((c) => !b._seen.has(c)),
      ...(extra ? extra(b.key) : {}),
    });
  }
  // Biggest first, then by key, so the order is total: two buckets can share a
  // token count to the token and a ranking that depended on insertion order
  // would put them in a different place on a different machine.
  out.sort((a, b) => b.total - a.total || String(a.key).localeCompare(String(b.key)));
  return out;
}

/**
 * Add one record's movement to one bucket.
 * @param {ReturnType<typeof emptyBucket>} b
 * @param {{split:boolean, counters:Record<string,number>, total:number}} moved
 */
function addTo(b, moved) {
  b.records += 1;
  b.total += moved.total;
  if (!moved.split) return;
  for (const counter of COUNTERS) {
    const n = moved.counters[counter];
    if (typeof n !== 'number') continue;
    b[counter] += n;
    b._seen.add(counter);
  }
}

/**
 * What one `tokens` record says moved.
 *
 * `total` is `delta + cacheDelta` — the v1 fields every record has carried
 * since WP-17, so a ledger written by an older build still totals correctly.
 * The four counters come from the v2 fields and only from them; a record
 * without `split: true` contributes to the total and to nothing else, which is
 * the "runtime gave only a total" case stated as arithmetic.
 *
 * @param {any} rec
 * @returns {{split:boolean, counters:Record<string,number>, total:number}}
 */
export function movementOf(rec) {
  const delta = Math.max(0, finiteNumber(rec?.delta) ?? 0);
  const cacheDelta = Math.max(0, finiteNumber(rec?.cacheDelta) ?? 0);
  /** @type {Record<string, number>} */
  const counters = {};
  let split = rec?.split === true;
  if (split) {
    let any = false;
    for (const counter of COUNTERS) {
      const n = finiteNumber(rec[COUNTER_FIELDS[counter]]);
      if (n == null) continue;
      counters[counter] = Math.max(0, n);
      any = true;
    }
    split = any;
  }
  return { split, counters, total: delta + cacheDelta };
}

/**
 * Every ledger `tokens` record inside `[since, until]`, oldest first.
 * @param {any[]} records
 * @param {{since?:number, until?:number}} [opts]
 */
export function tokenRecords(records, opts = {}) {
  const since = finiteNumber(opts.since) ?? -Infinity;
  const until = finiteNumber(opts.until) ?? Infinity;
  return (Array.isArray(records) ? records : []).filter(
    (r) => r && r.kind === 'tokens' && r.t >= since && r.t <= until,
  );
}

/**
 * The whole answer for one window: totals with the four-way split, and the
 * five rankings — by session, by project, by model, by day and by tool.
 *
 * "Where the tokens went" is `byProject` and `bySession` read top down; they
 * are ranked rather than keyed because the question the owner asked is "where
 * are they going", and a map answers that only after somebody sorts it.
 *
 * @param {any[]} records the whole ledger, or any superset of the window
 * @param {{now?:number, since?:number, until?:number, window?:string}} [opts]
 */
export function aggregate(records, opts = {}) {
  const now = opts.now ?? clockNow();
  const win = opts.window ? windowFor(opts.window, now) : null;
  const since = finiteNumber(opts.since) ?? win?.since ?? now - 7 * DAY_MS;
  const until = finiteNumber(opts.until) ?? win?.until ?? now;

  const list = tokenRecords(records, { since, until });

  const totals = emptyBucket('all');
  /** @type {Map<string, ReturnType<typeof emptyBucket>>} */
  const bySession = new Map();
  const byProject = new Map();
  const byModel = new Map();
  const byDay = new Map();
  const byTool = new Map();
  /** @type {Map<string, {projectKey:string, model:string, lastAt:number}>} */
  const sessionMeta = new Map();

  /**
   * @param {Map<string, ReturnType<typeof emptyBucket>>} map
   * @param {string} key
   */
  const bucket = (map, key) => {
    let b = map.get(key);
    if (!b) {
      b = emptyBucket(key);
      map.set(key, b);
    }
    return b;
  };

  for (const rec of list) {
    const moved = movementOf(rec);
    // A record that moved nothing is a scan that saw no change. It is not
    // evidence about a counter either way, so it does not mark one seen.
    if (moved.total === 0 && !moved.split) continue;

    addTo(totals, moved);

    const sessionId = String(rec.sessionId || '');
    const projectKey = String(rec.projectKey || 'unknown');
    const model = typeof rec.model === 'string' && rec.model ? rec.model : '';
    const tool = typeof rec.tool === 'string' && rec.tool ? rec.tool : '';

    if (sessionId) {
      addTo(bucket(bySession, sessionId), moved);
      const meta = sessionMeta.get(sessionId) || { projectKey, model: '', lastAt: 0 };
      meta.projectKey = projectKey;
      if (model) meta.model = model;
      meta.lastAt = Math.max(meta.lastAt, rec.t);
      sessionMeta.set(sessionId, meta);
    }
    addTo(bucket(byProject, projectKey), moved);
    addTo(bucket(byDay, dayKey(rec.t)), moved);
    // A model or a tool the record did not name is not filed under a made-up
    // key. It still counts toward the totals above, and the surface says how
    // many of the window's tokens it could not attribute.
    if (model) addTo(bucket(byModel, model), moved);
    if (tool) addTo(bucket(byTool, tool), moved);
  }

  const days = seal(byDay);
  // Days read as a calendar, oldest first — a bar chart that ranked its days
  // by size would not be a chart of a week.
  days.sort((a, b) => String(a.key).localeCompare(String(b.key)));

  const modelled = seal(byModel).reduce((a, b) => a + b.total, 0);
  const tooled = seal(byTool).reduce((a, b) => a + b.total, 0);

  return {
    since,
    until,
    window: win ? win.name : null,
    label: win ? win.label : null,
    days: Math.max(1, Math.round((until - since) / DAY_MS) || 1),
    totals: {
      input: totals.input,
      cacheWrite: totals.cacheWrite,
      cacheRead: totals.cacheRead,
      output: totals.output,
      total: totals.total,
      records: totals.records,
      absent: COUNTERS.filter((c) => !totals._seen.has(c)),
    },
    bySession: seal(bySession, (key) => {
      const meta = sessionMeta.get(key) || { projectKey: 'unknown', model: '', lastAt: 0 };
      return {
        sessionId: key,
        projectKey: meta.projectKey,
        model: meta.model,
        lastAt: meta.lastAt,
      };
    }),
    byProject: seal(byProject, (key) => ({ projectKey: key })),
    byModel: seal(byModel, (key) => ({ model: key })),
    byDay: days,
    byTool: seal(byTool, (key) => ({ tool: key })),
    // How much of the window each optional dimension could account for. A
    // table that covers a fifth of the tokens must be able to say so rather
    // than letting a reader add its column up and believe it.
    attributed: { model: modelled, tool: tooled },
    /** Rule 4: an empty window is a stated fact, not an empty table. */
    empty: totals.records === 0,
  };
}

/**
 * This week's tokens against the week before it.
 *
 * `status` is `'no data'` unless BOTH windows hold at least one `tokens`
 * record. A week measured against a week the machine was switched off for is
 * "up 100%", which is true of the arithmetic and false of the work — and the
 * one thing this product must never do is put a number in front of somebody
 * that they cannot check (`08` §1.1 rule 11).
 *
 * @param {any[]} records
 * @param {{now?:number, days?:number}} [opts]
 * @returns {{status:'ok'|'no data', current:number, previous:number,
 *            changePct:number|null, since:number, until:number,
 *            priorSince:number, priorUntil:number, days:number}}
 */
export function trend(records, opts = {}) {
  const now = opts.now ?? clockNow();
  const days = Math.max(1, Math.floor(opts.days ?? TREND_DAYS));
  const todayStart = dayStart(dayKey(now));
  const since = todayStart - (days - 1) * DAY_MS;
  const priorUntil = since - 1;
  const priorSince = since - days * DAY_MS;

  const current = aggregate(records, { now, since, until: now });
  const previous = aggregate(records, { now, since: priorSince, until: priorUntil });

  const both = !current.empty && !previous.empty;
  return {
    status: both ? 'ok' : NO_DATA,
    current: current.totals.total,
    previous: previous.totals.total,
    changePct:
      both && previous.totals.total > 0
        ? Math.round(
            ((current.totals.total - previous.totals.total) / previous.totals.total) * 1000,
          ) / 10
        : null,
    since,
    until: now,
    priorSince,
    priorUntil,
    days,
  };
}

/**
 * Everything a usage surface needs for one window, in one object.
 *
 * `GET /api/stats`, `deckhq stats` and the deck's Usage tab all call this, so
 * the three can never disagree about what "last 7 days" means — the same
 * reason `deckhq stats` and the stats route share `computeStats`.
 *
 * @param {any[]} records
 * @param {{now?:number, window?:string}} [opts]
 */
export function usageReport(records, opts = {}) {
  const now = opts.now ?? clockNow();
  const name = WINDOWS.includes(/** @type {any} */ (opts.window)) ? opts.window : '7d';
  return {
    ...aggregate(records, { now, window: name }),
    trend: trend(records, { now }),
  };
}
