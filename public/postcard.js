/**
 * The daily postcard — lights out. WP-18.
 *
 * `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §3.3 names the model: Stardew
 * Valley's day-end save. **An ending, not a demand.** At the configured hour,
 * or when the last live session ends after the evening begins, the floor dims
 * to night and one card appears:
 *
 * > **Tuesday.** 14 turns across 4 rooms. `orbital-api` shipped 3,
 * > `checkout-flow` waited 4h. 2 agents still up. ≈ $18.40 list price, rate
 * > card 2026-09-04. Longest wait today: 26h → cleared.
 *
 * It appears **once per local day**, it costs one keystroke to dismiss, and
 * nothing anywhere in it addresses the reader. That last one is the whole
 * point and it is asserted rather than reviewed: `08` §1.1 rule 6 and `04` §5
 * — the agents are the characters, the human is the manager, and the manager
 * is never scored. A card that said *"you left 4 waiting"* would be the exact
 * mechanic this product refuses to build, arriving at 10pm.
 *
 * Why a card at all, in a product whose stated job is to let you stop
 * watching (`08` §1.2)? Because it is the thing that makes **not looking**
 * safe. A day you did not open DeckHQ still gets summarised, once, at the end,
 * and then it is over. That is the opposite of a mechanic that pulls you back.
 *
 * Everything in this file is pure: it takes a `GET /api/stats` body, a
 * snapshot and a clock, and returns strings and booleans. There is no DOM, no
 * timer and no fetch in it — `app.js` owns all three. That is what lets
 * `test/unit/postcard.test.mjs` drive the copy generator over synthetic stats
 * in `node --test`.
 */

import { compactTokens, formatMoney, formatWait } from './snapshot.js';

/** The weekday names the card opens with. No `Intl`: see `records.js`. */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The hour after which a floor going quiet counts as the day ending rather
 * than a lull. §3.3: "when the last live session ends, or at a configured
 * hour". Both halves need a floor under them — a floor that empties at 11am
 * is a coffee break, not an evening.
 */
export const EVENING_HOUR = 18;

/**
 * The one value either marker can hold that means "never again".
 *
 * `settings.postcardDay` and `settings.wrappedShown` normally hold the day or
 * the week already shown, so the card appears once and then does not. This
 * sentinel is the opt-out: a marker set to `off` never matches a real key and
 * never expires, so no card arrives at all.
 *
 * It exists because two callers need it. `scripts/demo-floor.mjs` sets it so a
 * floor built to be photographed never has a card over the middle of it — the
 * goldens would otherwise fail after 22:00, on Mondays, and every day in
 * December. And it is the honest answer to "can I turn this off": §6's
 * interruption budget lists the postcard as in-app and silent, so it does not
 * earn a toggle of its own, but a person who wants it gone should not have to
 * be told there is no way.
 */
export const CARDS_OFF = 'off';

/** `2026-09-04` for the local day containing `now`. Mirrors `dayKey` in the ledger. */
export function dayKeyOf(now) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Local midnight before `now` — the boundary the card's `?since=` uses, and
 * the boundary "today" means to a person (`docs/DEVIATIONS.md` §100,
 * decision 2).
 * @param {number} now
 */
export function startOfDay(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Has the day ended, as far as this floor is concerned?
 *
 * Two triggers, and the second is the one the feature is named after:
 *
 *   1. the clock reaches `lightsOutHour` (22 by default);
 *   2. **the last live session ends** after `EVENING_HOUR`. Nobody is working
 *      any more and it is the evening — that is lights out, and waiting until
 *      22:00 to say so would be waiting for a clock rather than for the day.
 *
 * `shownDay` is the local day whose card has already been shown, persisted in
 * settings. It is checked here rather than by the caller so that "once a day"
 * cannot be enforced in two places and disagree.
 *
 * @param {object} o
 * @param {number} o.now
 * @param {number} [o.lightsOutHour]
 * @param {string} [o.shownDay] the day key already carded, from settings
 * @param {number} [o.liveCount] sessions live right now
 * @param {boolean} [o.ready] false while the floor has not loaded yet
 * @returns {{show:boolean, reason:'hour'|'quiet'|null, day:string}}
 */
export function lightsOut(o) {
  const now = Number(o.now) || 0;
  const day = dayKeyOf(now);
  const hour = new Date(now).getHours();
  const configured = Number.isFinite(Number(o.lightsOutHour)) ? Number(o.lightsOutHour) : 22;
  if (o.ready === false) return { show: false, reason: null, day };
  if (o.shownDay === CARDS_OFF) return { show: false, reason: null, day };
  if (o.shownDay === day) return { show: false, reason: null, day };
  if (hour >= configured) return { show: true, reason: 'hour', day };
  // The floor went quiet in the evening. `liveCount` is what the header
  // counts as live; zero of them with the evening under way is the day
  // ending. Before the evening it is a lull and the card stays away.
  if (hour >= EVENING_HOUR && Number(o.liveCount) === 0) {
    return { show: true, reason: 'quiet', day };
  }
  return { show: false, reason: null, day };
}

/**
 * The display name for a ledger project key, or a short hash when the floor
 * has no session for it.
 *
 * A lookup, never a reverse (the same rule `records.js` states): the ledger
 * holds hashes by design, and a room attributed to the wrong name would be
 * worse than one named by six characters of its key.
 * @param {any} stats a `GET /api/stats` body
 * @param {string} key
 */
export function roomName(stats, key) {
  const name = stats?.projects?.[key];
  if (typeof name === 'string' && name) return name;
  const k = String(key || '');
  return k ? k.slice(0, 6) : 'a room';
}

/** `14 turns` / `1 turn`. */
function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Today's spend, from the floor rather than from the ledger.
 *
 * `docs/DEVIATIONS.md` §111 decision 6: a `tokens` ledger record carries a
 * delta and a project key and **not a model**, so the day's tokens cannot be
 * priced from the ledger alone. The state machine already prices them per
 * room at the room's own average rate and puts the result on the snapshot as
 * `todaySpend`, which is the number the room plates draw — so the card sums
 * that rather than inventing a second answer that could differ from the floor
 * the card is sitting on.
 *
 * A room the rate card cannot price contributes nothing and is counted, so
 * the caller can say the total is short instead of implying it is complete.
 *
 * @param {any} snapshot
 * @returns {{spend:number, rated:number, unrated:number}}
 */
export function spendToday(snapshot) {
  let spend = 0;
  let rated = 0;
  let unrated = 0;
  for (const p of snapshot?.projects || []) {
    if (typeof p.todaySpend === 'number' && p.todaySpend > 0) {
      spend += p.todaySpend;
      rated += 1;
    } else if (p.costRated === false) {
      unrated += 1;
    }
  }
  return { spend, rated, unrated };
}

/**
 * The card, as sentences.
 *
 * Returns the pieces rather than one string so the DOM can set the weekday in
 * its own weight and the PNG can lay the same words out differently, without
 * either of them re-deciding what the words are.
 *
 * Every clause is dropped rather than faked when the ledger has nothing to
 * say: a day with no turns does not print `0 turns across 0 rooms`, it prints
 * *"A quiet day on the floor."* — which is true, is not a reproach, and is the
 * shape every other degrade in this product uses.
 *
 * @param {object} o
 * @param {any} o.stats a `GET /api/stats?since=<local midnight>` body
 * @param {any} [o.snapshot] the floor, for "still up" and the day's spend
 * @param {number} o.now
 * @returns {{day:string, weekday:string, lines:string[], text:string}}
 */
export function postcardCopy(o) {
  const now = Number(o.now) || 0;
  const w = o.stats?.window || {};
  const snapshot = o.snapshot || {};
  const weekday = WEEKDAYS[new Date(now).getDay()] || '';
  /** @type {string[]} */
  const lines = [];

  const turns = Number(w.turns) || 0;
  if (turns > 0) {
    // `roomCount` counts every room the window saw activity in, which is what
    // "across 4 rooms" means. Counting only the rooms this card goes on to
    // NAME would be a smaller, quieter number wearing the bigger one's words.
    const rooms = Number(w.roomCount) || (w.rooms || []).length || 1;
    lines.push(`${plural(turns, 'turn', 'turns')} across ${plural(rooms, 'room', 'rooms')}.`);
  } else {
    lines.push('A quiet day on the floor.');
  }

  // Two rooms at most, and each for a different reason: the one that shipped
  // the most and the one that waited the longest. Naming five rooms would be
  // a report; the card is a postcard.
  /** @type {string[]} */
  const clauses = [];
  const shipped = [...(w.rooms || [])]
    .filter((r) => Number(r.discharges) > 0)
    .sort((a, b) => b.discharges - a.discharges)[0];
  if (shipped) {
    clauses.push(`${roomName(o.stats, shipped.projectKey)} shipped ${shipped.discharges}`);
  }
  const waited = [...(w.rooms || [])]
    .filter((r) => Number(r.longestWaitMs) > 0 && r.projectKey !== shipped?.projectKey)
    .sort((a, b) => b.longestWaitMs - a.longestWaitMs)[0];
  if (waited) {
    clauses.push(
      `${roomName(o.stats, waited.projectKey)} waited ${formatWait(waited.longestWaitMs)}`,
    );
  }
  if (clauses.length) lines.push(`${clauses.join(', ')}.`);

  // "2 agents still up" — a fact about the floor at the moment the lights go
  // out, and the one number on the card that does not come from the ledger.
  const stillUp = (snapshot.agents || []).filter(
    (a) =>
      a.ackState === 'active' &&
      (a.activityState === 'working' || a.activityState === 'needs_input'),
  ).length;
  if (stillUp > 0) lines.push(`${plural(stillUp, 'agent', 'agents')} still up.`);

  const tokens = Number(w.tokens) || 0;
  const { spend, rated } = spendToday(snapshot);
  const version = snapshot.rateCardVersion || o.stats?.rateCardVersion || '';
  if (rated > 0 && spend > 0) {
    // Standing rule 7: cost is an estimate, never a bill, and it names the
    // dated table it came from (`docs/DEVIATIONS.md` §111).
    lines.push(`≈ ${formatMoney(spend)} list price${version ? `, rate card ${version}` : ''}.`);
  } else if (tokens > 0) {
    // No priced room: say what moved rather than putting a zero where money
    // goes. Zero is a claim about the money (§111 decision 4).
    lines.push(`${compactTokens(tokens)} tokens, no rate for them.`);
  }

  const wait = w.longestWait;
  if (wait && Number(wait.ms) > 0) {
    lines.push(
      `Longest wait today: ${formatWait(wait.ms)}${wait.cleared ? ' → cleared' : ' → still standing'}.`,
    );
  }

  // The ledger is younger than the day it is being asked about — a floor
  // installed this afternoon. Say so; do not report a morning that was not
  // recorded.
  if (w.covered === false && w.firstDay) {
    lines.push(`Counted since ${w.firstDay}, which is where this ledger starts.`);
  }

  return {
    day: dayKeyOf(now),
    weekday,
    lines,
    text: [weekday ? `${weekday}.` : '', ...lines].filter(Boolean).join(' '),
  };
}
