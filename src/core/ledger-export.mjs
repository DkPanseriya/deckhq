/**
 * WP-48's window digest — what one machine tells another (WP-22 follow-up).
 *
 * Split out of `ledger.mjs` unchanged: the summary a team floor can merge
 * without either machine handing over its ledger. `ledger-sign.mjs` signs it.
 *
 * Rule 4 still holds through all of it: no network, ever, and no path in a
 * record — the digest carries project keys, which are hashes, and never a
 * directory.
 */

import { DAY_MS, dayKey, finiteNumber } from './ledger-record.mjs';
import { reviewEpisodes } from './ledger-stats.mjs';
import { isTurn } from './ledger-records.mjs';

// ---------------------------------------------------------------------------
// WP-18 / WP-27 — one window, read once
// ---------------------------------------------------------------------------

/**
 * Everything the daily postcard (WP-18) and Wrapped (WP-27) say about a
 * stretch of time, from one walk over the ledger.
 *
 * `computeStats` answers `docs/01-PRODUCT.md` §6's questions and `records()`
 * answers WP-46's; neither answers "what happened between these two
 * timestamps, room by room", which is the only question a card about a day or
 * a week asks. Writing it as a third function rather than widening either of
 * those keeps their contracts alone — and writing it as ONE function used by
 * both cards is the same discipline `fold()`'s header states: a day and a week
 * differ by their bounds and by nothing else, so they must not be able to
 * disagree about what a turn is.
 *
 * **Every field is a fact about the window it was given**, and the window
 * travels back with the answer (`since`, `until`) so no caller can label a
 * number with a period it was not computed over. `docs/plan/04` §3.4 asks for
 * exactly that: each Wrapped line carries its own window.
 *
 * **Episodes are attributed by where they END, plus the ones still open.** A
 * wait that began on Sunday and was cleared on Monday is Monday's clearing —
 * that is the moment the user acted, and the card's "26h → cleared" is about
 * the clearing. A wait still open at `until` is counted too, as `open`, so a
 * day that ends with somebody still waiting says so rather than reporting the
 * best of what happened to close.
 *
 * @param {any[]} recordList
 * @param {{since:number, until?:number}} opts
 */
export function windowDigest(recordList, opts) {
  const until = finiteNumber(opts?.until) ?? Date.now();
  const since = finiteNumber(opts?.since) ?? until - DAY_MS;
  const list = Array.isArray(recordList) ? recordList : [];
  const inWindow = (t) => typeof t === 'number' && t >= since && t <= until;

  /** @type {Map<string, {projectKey:string, turns:number, tokens:number, sends:number, discharges:number, longestWaitMs:number, hours:Set<number>}>} */
  const rooms = new Map();
  const room = (key) => {
    let r = rooms.get(key);
    if (!r) {
      rooms.set(
        key,
        (r = {
          projectKey: key,
          turns: 0,
          tokens: 0,
          sends: 0,
          discharges: 0,
          longestWaitMs: 0,
          hours: new Set(),
        }),
      );
    }
    return r;
  };

  let turns = 0;
  let tokens = 0;
  let sends = 0;
  /** @type {number[]} turns per hour of the day, 0–23 */
  const turnsPerHour = new Array(24).fill(0);
  /** @type {Map<string, {sessionId:string, projectKey:string, sends:number}>} */
  const sentTo = new Map();
  let firstT = null;

  for (const rec of list) {
    const t = finiteNumber(rec?.t);
    if (t == null) continue;
    if (firstT == null || t < firstT) firstT = t;
    if (!inWindow(t)) continue;
    const key = String(rec.projectKey || 'unknown');
    // Any record at all is somebody in that room at that hour — the same rule
    // `records()`'s "never slept" uses, and for the same reason: a token delta
    // at 03:00 is somebody working at 03:00.
    if (key !== 'unknown') room(key).hours.add(new Date(t).getHours());

    if (isTurn(rec)) {
      turns += 1;
      turnsPerHour[new Date(t).getHours()] += 1;
      if (key !== 'unknown') room(key).turns += 1;
    } else if (rec.kind === 'send') {
      sends += 1;
      if (key !== 'unknown') room(key).sends += 1;
      const id = String(rec.sessionId || '');
      if (id) {
        const s = sentTo.get(id) || { sessionId: id, projectKey: key, sends: 0 };
        s.sends += 1;
        if (key !== 'unknown') s.projectKey = key;
        sentTo.set(id, s);
      }
    } else if (rec.kind === 'tokens') {
      const delta = finiteNumber(rec.delta) ?? 0;
      if (delta > 0) {
        tokens += delta;
        if (key !== 'unknown') room(key).tokens += delta;
      }
    }
  }

  // Episodes: measured with the window's own end as "now", so an open wait is
  // as long as it was at the moment the card is about and not a second longer.
  const episodes = reviewEpisodes(list, { now: until });
  /** @type {any} */
  let longestWait = null;
  let discharges = 0;
  for (const e of episodes) {
    const ended = e.end != null;
    const counts = ended ? inWindow(e.end) : e.start <= until;
    if (!counts) continue;
    if (ended) {
      discharges += 1;
      if (e.projectKey && e.projectKey !== 'unknown') room(e.projectKey).discharges += 1;
    }
    if (e.projectKey && e.projectKey !== 'unknown') {
      const r = room(e.projectKey);
      if (e.ms > r.longestWaitMs) r.longestWaitMs = e.ms;
    }
    if (!longestWait || e.ms > longestWait.ms) {
      longestWait = {
        ms: e.ms,
        sessionId: e.sessionId,
        projectKey: e.projectKey,
        start: e.start,
        end: e.end,
        // "26h → cleared" is only true of a wait that actually ended. One that
        // is still standing says so instead of borrowing the nicer ending.
        cleared: ended,
      };
    }
  }

  const roomList = [...rooms.values()]
    .map((r) => ({
      projectKey: r.projectKey,
      turns: r.turns,
      tokens: r.tokens,
      sends: r.sends,
      discharges: r.discharges,
      longestWaitMs: r.longestWaitMs,
      hours: r.hours.size,
    }))
    // Ties go to the room whose key sorts first, so the same ledger always
    // produces the same card.
    .sort(
      (a, b) =>
        b.turns - a.turns ||
        b.discharges - a.discharges ||
        b.tokens - a.tokens ||
        a.projectKey.localeCompare(b.projectKey),
    );

  /** @type {{projectKey:string, hours:number}|null} */
  let neverSlept = null;
  for (const r of [...roomList].sort((a, b) => a.projectKey.localeCompare(b.projectKey))) {
    if (!neverSlept || r.hours > neverSlept.hours) {
      neverSlept = { projectKey: r.projectKey, hours: r.hours };
    }
  }

  /** @type {{hour:number, turns:number}|null} */
  let busiestHour = null;
  for (let h = 0; h < 24; h++) {
    if (turnsPerHour[h] > 0 && (!busiestHour || turnsPerHour[h] > busiestHour.turns)) {
      busiestHour = { hour: h, turns: turnsPerHour[h] };
    }
  }

  /** @type {{sessionId:string, projectKey:string, sends:number}|null} */
  let mostSent = null;
  for (const s of [...sentTo.values()].sort((a, b) => a.sessionId.localeCompare(b.sessionId))) {
    if (!mostSent || s.sends > mostSent.sends) mostSent = s;
  }

  /** @type {Record<string, number>} */
  const tokensPerProject = {};
  for (const r of roomList) if (r.tokens > 0) tokensPerProject[r.projectKey] = r.tokens;

  return {
    since,
    until,
    // The first day the ledger holds anything at all. A window that starts
    // before it is a window the machine did not live through, and the card
    // says "since <this>" rather than claiming the week (§3.4's degrade).
    firstDay: firstT == null ? null : dayKey(firstT),
    // Where the window really starts, once the ledger's own beginning is
    // taken into account. This is the date a card labels itself with.
    effectiveSince: firstT == null ? since : Math.max(since, firstT),
    covered: firstT != null && firstT <= since,
    turns,
    tokens,
    tokensPerProject,
    sends,
    discharges,
    rooms: roomList,
    roomCount: roomList.length,
    busiestHour,
    mostSent,
    longestWait,
    neverSlept,
  };
}
