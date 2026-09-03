/**
 * The office-cleared moment.
 *
 * WP-15. `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §2 calls this "the one
 * deliberate celebration in the product", and `docs/plan/05-GUI-UX-SPEC.md` §9
 * says what it is: the light warms 6% over 1.2 s, a two-note chime plays, and
 * one line fades in and out over 3 s.
 *
 * > Office clear. 7 discharged today, longest wait 26h.
 *
 * **The rule that stops it becoming noise** is borrowed from Munder Difflin
 * (`04` §2, `08` §3.5): a celebration fires only after the office has been
 * non-empty for at least sixty seconds, so a session that finishes and is
 * discharged in the same breath does not earn a cheer. Vercel's first-deploy
 * confetti works because it marks a real milestone; the same animation on
 * every save would be the reason people uninstall it.
 *
 * **What it never does.** It never scores the human (`04` §1). The line
 * records the *team's* work — how many were discharged, and how long the
 * longest one waited — in the third person, and there is no version of it
 * that says what you failed to do. `test/unit/office-cleared.test.mjs` scans
 * the generated copy for second-person fault.
 *
 * The numbers come from this tab's own counters until the ledger lands
 * (WP-17), which is stated plainly in `docs/DEVIATIONS.md` §110 rather than
 * implied to be a permanent record.
 *
 * Everything here is pure: `createClearedTracker` holds counters and is
 * driven by `update(snapshot, now)`, and returns what the caller should do.
 * There is no DOM, no audio and no timer in this file.
 */

import { formatWait } from './snapshot.js';

/** §2's rule: the office must have been non-empty this long to earn the moment. */
export const MIN_BUSY_MS = 60_000;

/**
 * Which agents count as "waiting on you" — the same three states the header's
 * numeral counts, so the moment fires exactly when that numeral reaches zero.
 * @param {any} snapshot
 * @returns {any[]}
 */
export function waitingAgents(snapshot) {
  return (snapshot?.agents || []).filter(
    (a) =>
      a.ackState === 'active' &&
      (a.activityState === 'for_review' ||
        a.activityState === 'needs_input' ||
        a.activityState === 'stalled'),
  );
}

/**
 * The line. Singular and plural both read, and a clearing with no measurable
 * wait drops the clause rather than printing `longest wait just now`.
 *
 * @param {{discharged:number, longestWaitMs:number}} o
 * @returns {string}
 */
export function clearedLine(o) {
  const n = Math.max(0, Math.round(o.discharged) || 0);
  const head = n === 1 ? 'Office clear. 1 discharged today' : `Office clear. ${n} discharged today`;
  if (!(o.longestWaitMs > 0)) return `${head}.`;
  return `${head}, longest wait ${formatWait(o.longestWaitMs)}.`;
}

/** Local midnight before `now` — the day boundary "today" means to a person. */
function dayOf(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Track the queue across snapshots and say when the office has just cleared.
 *
 * @param {{minBusyMs?: number}} [opts]
 */
export function createClearedTracker(opts = {}) {
  const minBusyMs = opts.minBusyMs ?? MIN_BUSY_MS;

  /** @type {Map<string, number>} agent id -> when it started waiting */
  let waiting = new Map();
  /** When the office last went from empty to non-empty; null while empty. */
  let busySince = null;
  let day = null;
  let dischargedToday = 0;
  let longestWaitToday = 0;
  let started = false;

  return {
    /**
     * Fold in one snapshot.
     *
     * @param {any} snapshot
     * @param {number} now
     * @returns {{fire:boolean, line:string, discharged:number, longestWaitMs:number, waiting:number}}
     */
    update(snapshot, now) {
      const today = dayOf(now);
      if (day !== today) {
        // A new day resets the counters, not the queue: an agent that has been
        // waiting since yesterday is still waiting.
        day = today;
        dischargedToday = 0;
        longestWaitToday = 0;
      }

      /** @type {Map<string, number>} */
      const next = new Map();
      for (const a of waitingAgents(snapshot)) {
        // Its own clock if it has one, else the moment this tab first saw it
        // waiting. Never `now` for an agent already in the map, or a session
        // that has waited a day would read as having waited a second.
        const since = a.reviewSince || a.needsInputSince || waiting.get(a.id) || now;
        next.set(a.id, since);
      }

      // Everyone who was in the queue and is not any more was discharged —
      // by a button, by a reply landing in the terminal, or by being benched.
      // All three are the user acting, which is what the count is about.
      let discharged = 0;
      for (const [id, since] of waiting) {
        if (next.has(id)) continue;
        discharged += 1;
        longestWaitToday = Math.max(longestWaitToday, Math.max(0, now - since));
      }
      dischargedToday += discharged;

      const wasWaiting = waiting.size;
      waiting = next;

      // The first snapshot only establishes the baseline. Without this, a tab
      // opened onto an already-empty floor would count the whole page load as
      // a clearing, and a tab opened onto a busy one would date the office's
      // "busy since" to the page load rather than admit it does not know.
      if (!started) {
        started = true;
        busySince = next.size > 0 ? now : null;
        return { fire: false, line: '', discharged: 0, longestWaitMs: 0, waiting: next.size };
      }

      if (next.size > 0 && busySince === null) busySince = now;

      const cleared = wasWaiting > 0 && next.size === 0;
      const busyFor = busySince === null ? 0 : now - busySince;
      const fire = cleared && busyFor >= minBusyMs;
      if (next.size === 0) busySince = null;

      return {
        fire,
        line: fire
          ? clearedLine({ discharged: dischargedToday, longestWaitMs: longestWaitToday })
          : '',
        discharged: dischargedToday,
        longestWaitMs: longestWaitToday,
        waiting: next.size,
      };
    },

    /** For tests and for the report: what this tab has counted today. */
    counters() {
      return { dischargedToday, longestWaitToday, waiting: waiting.size, busySince };
    },
  };
}
