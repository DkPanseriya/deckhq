/**
 * WP-46's team records (WP-22 follow-up).
 *
 * Split out of `ledger.mjs` unchanged: the seven-day window, the floor on
 * how many discharges make a "fastest day" worth naming, and `records()`
 * itself.
 *
 * A record is a grace note about the team's work, in the third person, never
 * a score on the person reading it (`docs/plan/08-PLAN-V2-100X.md` §1.1
 * rule 6) — which is why the thresholds are here, written down, rather than
 * implied by a query.
 */

import { dayKey, dayStart, finiteNumber } from './ledger-record.mjs';
import { reviewEpisodes, percentile } from './ledger-stats.mjs';

// ---------------------------------------------------------------------------
// WP-46 — team records
// ---------------------------------------------------------------------------

/**
 * The window the rolling records look back over: a week.
 *
 * A ledger younger than this still answers — every record carries the day the
 * ledger starts, so a two-day-old install reads "since 1 Sep" rather than
 * pretending to a week it has not lived through.
 */
export const RECORD_WINDOW_DAYS = 7;

/**
 * How many discharges a day needs before it can hold the fastest-discharge
 * record.
 *
 * Without a floor the record is always held by whichever day happened to
 * contain exactly one two-second discharge, which is not a fact about the
 * team's day — it is a fact about a single click. Three is the smallest
 * number for which "the median" is a median of anything.
 */
export const MIN_DISCHARGES_FOR_FASTEST_DAY = 3;

/** Ceiling on how many calendar days a record scan will walk. */
export const MAX_DAYS_SCANNED = 4000;

/**
 * `YYYY-MM-DD`, n days on. Component arithmetic, not `+ n * DAY_MS`: adding
 * 24 hours to a local midnight lands at 23:00 the same day when the clocks go
 * back, and the resulting day key would silently repeat.
 * @param {string} day
 * @param {number} n
 * @returns {string}
 */
export function addDays(day, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return '';
  return dayKey(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n).getTime());
}

/**
 * Calendar days from `first` to `last`, inclusive. Bounded, because a single
 * mis-stamped record from 1970 must not turn a report into a walk.
 * @param {string} first
 * @param {string} last
 */
export function countDays(first, last) {
  if (!first || !last || last < first) return first ? 1 : 0;
  let n = 1;
  let day = first;
  while (day < last && n < MAX_DAYS_SCANNED) {
    day = addDays(day, 1);
    n += 1;
  }
  return n;
}

/**
 * Is this record a turn?
 *
 * A turn is a session starting work: a recorded transition of the observed
 * activity into `working`. That counts turns typed in the terminal as well as
 * ones DeckHQ sent, which is the point — the ledger's `send` records only
 * know about the half that came through this product, and "the busiest day"
 * is a fact about the floor, not about the panel.
 *
 * `stalled` → `working` is excluded and is the only exclusion. A stall is
 * inferred from silence, so coming out of one is the same turn resuming, and
 * counting it would make a long quiet turn look like several short ones.
 *
 * @param {any} rec
 */
export function isTurn(rec) {
  return (
    rec &&
    rec.kind === 'state' &&
    rec.dim === 'activity' &&
    rec.to === 'working' &&
    rec.from !== 'working' &&
    rec.from !== 'stalled'
  );
}

/**
 * The team's records — `docs/plan/08-PLAN-V2-100X.md` §7, WP-46.
 *
 * Five facts about the floor's own history, computed from the ledger and from
 * nothing else:
 *
 * | record | what it is |
 * |---|---|
 * | `longestWait` | the longest a session ever sat in `for_review`, and the day that stretch began |
 * | `busiestDay` | the local day with the most turns |
 * | `busiestWeek` | the seven-day window with the most turns, and the day it ended |
 * | `neverSlept` | the project with activity in the most distinct hours of the day, over the last week |
 * | `fastestDischargeDay` | the day with the lowest median time in review, of the days that discharged enough to have a median |
 *
 * **None of them is a score on the human** (§1.1 rule 6). Every one is a fact
 * about the team's work — how long a session waited, how many turns a day
 * held, which room had someone in it at 4am. There is no count of the user's
 * days, no streak, nothing that can fall, and no record whose subject is the
 * person reading it. The copy that renders them is asserted to contain no
 * second person in a fault sense; see `test/unit/records.test.mjs`.
 *
 * **They degrade rather than lie.** Every record carries `since` — the first
 * day the ledger holds — and `partial`, true while that is less than a week
 * ago. A floor two days old reports two days of records and says so, rather
 * than reporting a week that did not happen or reporting nothing at all.
 *
 * @param {any[]} recordList
 * @param {{now?:number}} [opts]
 */
export function records(recordList, opts = {}) {
  const now = opts.now ?? Date.now();
  const list = Array.isArray(recordList) ? recordList : [];

  let firstT = null;
  let lastT = null;
  for (const rec of list) {
    const t = finiteNumber(rec?.t);
    if (t == null) continue;
    if (firstT == null || t < firstT) firstT = t;
    if (lastT == null || t > lastT) lastT = t;
  }

  const today = dayKey(now);
  const since = firstT == null ? today : dayKey(firstT);
  const lastDay =
    firstT == null
      ? today
      : (() => {
          const l = dayKey(/** @type {number} */ (lastT));
          return l > today ? l : today;
        })();
  const days = firstT == null ? 0 : countDays(since, lastDay);
  const partial = days < RECORD_WINDOW_DAYS;

  /** Every record is stamped with the same two, so one of them travels alone. */
  const stamp = (rec) => (rec ? { ...rec, since, partial } : null);

  const base = {
    since,
    days,
    partial,
    windowDays: RECORD_WINDOW_DAYS,
    longestWait: null,
    busiestDay: null,
    busiestWeek: null,
    neverSlept: null,
    fastestDischargeDay: null,
  };
  if (firstT == null) return base;

  const episodes = reviewEpisodes(list, { now });

  // --- the longest anyone ever waited -------------------------------------
  /** @type {any} */
  let longest = null;
  for (const e of episodes) if (!longest || e.ms > longest.ms) longest = e;

  // --- turns, per day, and the busiest of them ----------------------------
  /** @type {Map<string, number>} */
  const turnsPerDay = new Map();
  for (const rec of list) {
    if (!isTurn(rec)) continue;
    const day = dayKey(rec.t);
    turnsPerDay.set(day, (turnsPerDay.get(day) || 0) + 1);
  }
  const turnDays = [...turnsPerDay.keys()].sort();

  /** @type {{date:string, turns:number}|null} */
  let busiestDay = null;
  for (const day of turnDays) {
    const turns = /** @type {number} */ (turnsPerDay.get(day));
    // Ties go to the earlier day: a record belongs to whoever set it first.
    if (!busiestDay || turns > busiestDay.turns) busiestDay = { date: day, turns };
  }

  // --- the busiest week ---------------------------------------------------
  //
  // Rolling, over calendar days, and only windows that END on a day with
  // turns are considered: a window ending on a quiet day sums a subset of the
  // window ending on the last busy day inside it, so it can never win.
  /** @type {{date:string, turns:number, from:string, to:string}|null} */
  let busiestWeek = null;
  for (const end of turnDays) {
    const start = addDays(end, -(RECORD_WINDOW_DAYS - 1));
    let turns = 0;
    for (const [day, n] of turnsPerDay) {
      if (day >= start && day <= end) turns += n;
    }
    if (!busiestWeek || turns > busiestWeek.turns) {
      busiestWeek = { date: end, turns, from: start < since ? since : start, to: end };
    }
  }

  // --- the room that never slept ------------------------------------------
  //
  // Distinct hours OF THE DAY, not distinct hour-slots in the week: the
  // record is "somebody was in that room at 4am and at 4pm", and 24 of 24 is
  // a room that genuinely never slept. Every kind of record counts as
  // activity — a token delta at 03:00 is somebody working at 03:00.
  const windowFrom = (() => {
    const w = addDays(today, -(RECORD_WINDOW_DAYS - 1));
    return w < since ? since : w;
  })();
  const windowStartMs = dayStart(windowFrom);
  /** @type {Map<string, Set<number>>} */
  const hoursPerProject = new Map();
  for (const rec of list) {
    const t = finiteNumber(rec?.t);
    if (t == null || t < windowStartMs || t > now) continue;
    const key = String(rec.projectKey || 'unknown');
    if (key === 'unknown') continue;
    let set = hoursPerProject.get(key);
    if (!set) hoursPerProject.set(key, (set = new Set()));
    set.add(new Date(t).getHours());
  }
  /** @type {{projectKey:string, hours:number, date:string, from:string, to:string}|null} */
  let neverSlept = null;
  for (const key of [...hoursPerProject.keys()].sort()) {
    const hours = /** @type {Set<number>} */ (hoursPerProject.get(key)).size;
    if (!neverSlept || hours > neverSlept.hours) {
      neverSlept = { projectKey: key, hours, date: today, from: windowFrom, to: today };
    }
  }

  // --- the fastest discharge day ------------------------------------------
  /** @type {Map<string, number[]>} */
  const dischargesPerDay = new Map();
  for (const e of episodes) {
    if (e.end == null) continue;
    const day = dayKey(e.end);
    const xs = dischargesPerDay.get(day);
    if (xs) xs.push(e.ms);
    else dischargesPerDay.set(day, [e.ms]);
  }
  /** @type {{date:string, medianMs:number, discharged:number}|null} */
  let fastest = null;
  for (const day of [...dischargesPerDay.keys()].sort()) {
    const xs = /** @type {number[]} */ (dischargesPerDay.get(day));
    if (xs.length < MIN_DISCHARGES_FOR_FASTEST_DAY) continue;
    const medianMs = /** @type {number} */ (percentile(xs, 0.5));
    if (!fastest || medianMs < fastest.medianMs) {
      fastest = { date: day, medianMs, discharged: xs.length };
    }
  }

  return {
    ...base,
    longestWait: stamp(
      longest
        ? {
            ms: longest.ms,
            date: dayKey(longest.start),
            sessionId: longest.sessionId,
            projectKey: longest.projectKey,
            open: longest.end == null,
          }
        : null,
    ),
    busiestDay: stamp(busiestDay),
    busiestWeek: stamp(busiestWeek),
    neverSlept: stamp(neverSlept),
    fastestDischargeDay: stamp(fastest),
  };
}
