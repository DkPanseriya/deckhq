/**
 * DeckHQ — the team's records, as one quiet line. WP-46.
 *
 * `GET /api/stats` publishes five records of the team's work (see
 * `records()` in `src/core/ledger.mjs`). Most of them are facts about the
 * whole floor and belong in the report; two of them have a *subject* — a
 * session, or a project — and when that subject is the agent you are looking
 * at, the panel says so in one line under the identity area:
 *
 *     longest wait ever was here: 2d 12h, 1 Sep
 *
 * ## What this module will not say
 *
 * Nothing here addresses the reader. `docs/plan/08-PLAN-V2-100X.md` §1.1 rule
 * 6 and `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §5: the agents are the
 * characters, the human is the manager, and the manager is never scored. So
 * the copy is in the third person about the team's work — *"longest wait ever
 * was here"*, never *"you left this waiting"*; *"the room that never slept"*,
 * never *"you never stopped"*. There is no streak, no count of the reader's
 * days, and nothing that can be broken. `test/unit/records.test.mjs` asserts
 * the second person never appears in this file's copy at all, with one
 * allowance: **"waiting on you"** is the product's own noun phrase for the
 * queue and is not a reproach.
 *
 * ## Why it is its own module
 *
 * It is a pure function of `(agent, stats)` with no DOM at module scope, so
 * `node --test` can run it directly — the same discipline as
 * `public/render/agents.js`. It cannot import from `src/core/*.mjs` at
 * runtime (`docs/02-ARCHITECTURE.md` §9: static serving is confined to
 * `publicDir`), so the day-key parsing below is a small local mirror and not
 * a shared helper; there is nothing here that could drift into a different
 * *answer*, only a different *rendering*, which is the safe half.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `2026-09-01` → `1 Sep`. No `Intl`: this string has to read the same on a
 * Node build without a full ICU as it does in a browser, and a date the user
 * cannot parse is worse than one that is not localised.
 * @param {string} day
 * @returns {string}
 */
export function formatDay(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return String(day || '');
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return String(day);
  return `${Number(m[3])} ${month}`;
}

/**
 * A duration in the deck's own two-unit shape — `2d 12h`, `4h 05m`, `18m`.
 * Mirrors `waited()` in `src/cli/deck.mjs`; see the header for why it cannot
 * simply import it.
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'under a minute';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24)
    return hours < 10 ? `${hours}h ${String(mins % 60).padStart(2, '0')}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/**
 * The display name a project key resolves to, or null.
 *
 * The ledger holds hashes by design (WP-48), and this is a lookup, never a
 * reverse: a project the floor has no session for stays unresolved and simply
 * does not match, which is the correct failure — a record attributed to the
 * wrong room would be worse than one nobody sees.
 *
 * @param {{projects?:Record<string,string>}|null|undefined} stats
 * @param {string} key
 * @returns {string|null}
 */
function projectName(stats, key) {
  if (!key) return null;
  const name = stats?.projects?.[key];
  return typeof name === 'string' && name ? name : null;
}

/**
 * One line for the agent in front of you, or null when no record involves it.
 *
 * Exactly one line, never a list: it is a grace note beside an identity, not
 * a report. Priority is narrowest subject first — this session, then this
 * session's room — so the line is about the thing you are actually looking at
 * whenever it can be.
 *
 * When the ledger is younger than the records' window, the line carries the
 * first day the ledger holds, because "the room that never slept" over two
 * days is a smaller claim than the same words over a week and must not be
 * allowed to read as the larger one.
 *
 * @param {{id?:string, projectName?:string}|null|undefined} agent
 * @param {any} stats a `GET /api/stats` body
 * @returns {string|null}
 */
export function recordLineFor(agent, stats) {
  const rec = stats?.records;
  if (!agent || !rec || typeof rec !== 'object') return null;

  const suffix = rec.partial && rec.since ? ` · since ${formatDay(rec.since)}` : '';
  const wait = rec.longestWait;
  const room = rec.neverSlept;

  if (wait && wait.sessionId && agent.id && wait.sessionId === agent.id) {
    const when = wait.open ? 'still going' : formatDay(wait.date);
    return `longest wait ever was this session: ${formatDuration(wait.ms)}, ${when}${suffix}`;
  }

  const here = agent.projectName || null;
  if (wait && here && projectName(stats, wait.projectKey) === here) {
    const when = wait.open ? 'still going' : formatDay(wait.date);
    return `longest wait ever was here: ${formatDuration(wait.ms)}, ${when}${suffix}`;
  }

  if (room && here && projectName(stats, room.projectKey) === here) {
    const hours = Number(room.hours) || 0;
    return `the room that never slept: ${hours} hour${hours === 1 ? '' : 's'} of the day${suffix}`;
  }

  return null;
}
