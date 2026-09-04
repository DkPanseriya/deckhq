/**
 * What the ledger adds up to (WP-22 follow-up).
 *
 * Split out of `ledger.mjs` unchanged: the fold that replays a day's records
 * into per-session state, `reconstructQueue` — what the queue looked like at
 * an instant — `reviewEpisodes`, the percentile, and `computeStats`, which
 * is what finally measures docs/01-PRODUCT.md §6's first success criterion.
 *
 * All pure: records in, numbers out. Nothing here reads a disk and nothing
 * here can touch ack state.
 */

import { ACK_STATES, ACTIVITY_STATES, NEEDS_YOU_STATES } from './model.mjs';
import { DAY_MS, dayKey, finiteNumber } from './ledger-record.mjs';

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/** @param {unknown} s */
export function isActivity(s) {
  return /** @type {readonly string[]} */ (ACTIVITY_STATES).includes(/** @type {string} */ (s));
}

/** @param {unknown} s */
export function isAck(s) {
  return /** @type {readonly string[]} */ (ACK_STATES).includes(/** @type {string} */ (s));
}

/**
 * Fold a stream of records into what each session looked like, and every
 * stretch it spent waiting.
 *
 * **One fold, not two.** The queue at a timestamp and the list of `for_review`
 * episodes are the same walk over the same records asked two questions, and
 * `docs/DEVIATIONS.md` has five separate entries (§16, §35, §38, §52, §55)
 * whose single root cause is two representations of one thing allowed to
 * disagree. Two folds here would eventually answer "who was waiting" and "how
 * long did they wait" from different rules, and the second number would be the
 * one nobody checked.
 *
 * The state per session is the model's own pair — an observed `activity` and a
 * user-owned `ack` — plus the timestamp each was entered. Nothing is inferred:
 * a `first_seen` restates a standing state and is deliberately NOT a
 * transition, so a stretch already open stays open with the start it had, which
 * is what carries an episode across midnight.
 *
 * @param {any[]} records
 * @param {{until?:number, now?:number}} [opts]
 * @returns {{state: Map<string, any>, episodes: any[]}}
 */
export function fold(records, opts = {}) {
  const until = opts.until ?? Infinity;
  const now = opts.now ?? Date.now();
  /** @type {Map<string, any>} */
  const state = new Map();
  /** @type {any[]} */
  const episodes = [];

  const queued = (s) =>
    s.ack === 'active' && /** @type {readonly string[]} */ (NEEDS_YOU_STATES).includes(s.activity);
  const waiting = (s) => s.ack === 'active' && s.activity === 'for_review';

  for (const rec of Array.isArray(records) ? records : []) {
    if (!(rec.t <= until)) continue;
    const id = String(rec.sessionId || '');
    if (!id) continue;
    let s = state.get(id);
    if (!s) {
      s = {
        sessionId: id,
        projectKey: String(rec.projectKey || 'unknown'),
        activity: 'ended',
        ack: 'active',
        since: rec.t,
        queueSince: null,
        reviewStart: null,
      };
      state.set(id, s);
    }
    if (rec.projectKey && rec.projectKey !== 'unknown') s.projectKey = String(rec.projectKey);

    const wasQueued = queued(s);
    const wasWaiting = waiting(s);

    if (rec.kind === 'session' && rec.event === 'first_seen') {
      if (isActivity(rec.activity)) s.activity = rec.activity;
      if (isAck(rec.ack)) s.ack = rec.ack;
      s.since = finiteNumber(rec.since) ?? rec.t;
    } else if (rec.kind === 'state' && rec.dim === 'activity' && isActivity(rec.to)) {
      s.activity = rec.to;
      s.since = rec.t;
    } else if (rec.kind === 'state' && rec.dim === 'ack' && isAck(rec.to)) {
      s.ack = rec.to;
    } else {
      continue;
    }

    // The needs-you queue: any of the three states, while on the payroll.
    const isQueued = queued(s);
    if (!wasQueued && isQueued) s.queueSince = s.since;
    else if (wasQueued && !isQueued) s.queueSince = null;
    else if (isQueued && s.queueSince == null) s.queueSince = s.since;

    // The narrower one the §6 metrics are about: `for_review` specifically.
    // Leaving it by ANY route is a discharge, benching and letting go
    // included, because all three are the user acting.
    const isWaiting = waiting(s);
    if (!wasWaiting && isWaiting) s.reviewStart = s.since;
    else if (wasWaiting && !isWaiting) {
      if (s.reviewStart != null) {
        episodes.push({
          sessionId: id,
          projectKey: s.projectKey,
          start: s.reviewStart,
          end: rec.t,
          ms: Math.max(0, rec.t - s.reviewStart),
        });
      }
      s.reviewStart = null;
    } else if (isWaiting && s.reviewStart == null) s.reviewStart = s.since;
  }

  for (const [id, s] of state) {
    if (!waiting(s) || s.reviewStart == null) continue;
    episodes.push({
      sessionId: id,
      projectKey: s.projectKey,
      start: s.reviewStart,
      end: null,
      ms: Math.max(0, now - s.reviewStart),
    });
  }
  episodes.sort((a, b) => a.start - b.start || a.sessionId.localeCompare(b.sessionId));
  return { state, episodes };
}

/**
 * The needs-you queue exactly as it stood at `t`.
 *
 * WP-17's acceptance criterion, and the reason `first_seen` carries `since`.
 * The rule is the model's own (`needsYou()`): `ackState` is `active` and
 * `activityState` is one of `needs_input`, `stalled`, `for_review`. There is
 * deliberately no second opinion here — this replays what the machine
 * recorded, it does not re-derive what the machine should have said.
 *
 * @param {any[]} records
 * @param {number} t
 * @returns {Array<{sessionId:string, projectKey:string, activityState:string, since:number}>}
 */
export function reconstructQueue(records, t) {
  const { state } = fold(records, { until: t, now: t });
  /** @type {any[]} */
  const out = [];
  for (const s of state.values()) {
    if (s.ack !== 'active') continue;
    if (!(/** @type {readonly string[]} */ (NEEDS_YOU_STATES).includes(s.activity))) continue;
    out.push({
      sessionId: s.sessionId,
      projectKey: s.projectKey,
      activityState: s.activity,
      since: s.queueSince ?? s.since,
    });
  }
  out.sort((a, b) => a.since - b.since || a.sessionId.localeCompare(b.sessionId));
  return out;
}

/**
 * Every stretch a session spent in `for_review` while still on the payroll —
 * an "episode". Entering is `for_review` with `ackState` `active`; being
 * discharged is leaving that condition by any route, including being benched
 * or let go, because all three are the user acting. An episode still open at
 * `now` is returned with `end: null`.
 *
 * @param {any[]} records
 * @param {{now?:number}} [opts]
 * @returns {Array<{sessionId:string, projectKey:string, start:number,
 *                  end:number|null, ms:number}>}
 */
export function reviewEpisodes(records, opts = {}) {
  return fold(records, { now: opts.now ?? Date.now() }).episodes;
}

/**
 * The p-th percentile of a sorted-in-place copy, by nearest rank.
 * @param {number[]} values
 * @param {number} p 0..1
 */
export function percentile(values, p) {
  const xs = [...values].sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const rank = Math.ceil(p * xs.length);
  return xs[Math.min(xs.length - 1, Math.max(0, rank - 1))];
}

/**
 * Every number `docs/01-PRODUCT.md` §6 names, plus the ones §7 of the plan
 * asks the records for.
 *
 * Windowed values (`median`, `p90`, `dischargesPerDay`, `sendsPerDay`,
 * `tokensPerProjectPerDay`) cover `[since, now]`. `longestWaitEver` and
 * `over24h` deliberately do not: a record is a record, and the whole point of
 * a falling "longest wait ever" is that it is measured against everything the
 * machine has ever done.
 *
 * @param {any[]} records
 * @param {{now?:number, since?:number}} [opts]
 */
export function computeStats(records, opts = {}) {
  const now = opts.now ?? Date.now();
  const since = finiteNumber(opts.since) ?? now - 30 * DAY_MS;
  const list = Array.isArray(records) ? records : [];
  const episodes = reviewEpisodes(list, { now });

  const closedInWindow = episodes.filter((e) => e.end != null && e.end >= since);
  const durations = closedInWindow.map((e) => e.ms);

  const open = episodes.filter((e) => e.end == null);

  /** @type {Record<string, number>} */
  const dischargesPerDay = {};
  for (const e of closedInWindow) {
    const day = dayKey(/** @type {number} */ (e.end));
    dischargesPerDay[day] = (dischargesPerDay[day] || 0) + 1;
  }

  /** @type {Record<string, number>} */
  const sendsPerDay = {};
  /** @type {Record<string, Record<string, number>>} */
  const tokensPerProjectPerDay = {};
  for (const rec of list) {
    if (rec.t < since || rec.t > now) continue;
    const day = dayKey(rec.t);
    if (rec.kind === 'send') {
      sendsPerDay[day] = (sendsPerDay[day] || 0) + 1;
    } else if (rec.kind === 'tokens') {
      const delta = finiteNumber(rec.delta) ?? 0;
      if (delta <= 0) continue;
      const key = String(rec.projectKey || 'unknown');
      if (!tokensPerProjectPerDay[day]) tokensPerProjectPerDay[day] = {};
      tokensPerProjectPerDay[day][key] = (tokensPerProjectPerDay[day][key] || 0) + delta;
    }
  }

  let longest = null;
  for (const e of episodes) {
    if (!longest || e.ms > longest.ms) longest = e;
  }

  const days = Math.max(1, Math.ceil((now - since) / DAY_MS));

  return {
    since,
    now,
    days,
    forReview: {
      medianMs: percentile(durations, 0.5),
      p90Ms: percentile(durations, 0.9),
      discharged: closedInWindow.length,
      open: open.length,
    },
    // §6's first criterion: sessions sitting in for_review longer than 24h,
    // right now. `everOver24h` is the same question asked of history, which
    // is what tells you whether it USED to happen.
    over24h: open.filter((e) => e.ms > DAY_MS).length,
    everOver24h: episodes.filter((e) => e.ms > DAY_MS).length,
    dischargesPerDay,
    dischargesPerDayMean: closedInWindow.length / days,
    sendsPerDay,
    sendsPerDayMean: Object.values(sendsPerDay).reduce((a, b) => a + b, 0) / days,
    tokensPerProjectPerDay,
    longestWaitEver: longest
      ? {
          ms: longest.ms,
          sessionId: longest.sessionId,
          projectKey: longest.projectKey,
          date: dayKey(longest.start),
          open: longest.end == null,
        }
      : null,
    // Enough for a caller to say "these numbers are short" without inventing
    // a reason of its own.
    records: list.length,
    // The same number under a name that does not collide with WP-46's team
    // records, which `GET /api/stats` and `deckhq stats --json` publish as
    // `records`. Both fields are emitted; nothing that read the count has to
    // move, and nothing that wants the records has to say `teamRecords`.
    recordCount: list.length,
  };
}
