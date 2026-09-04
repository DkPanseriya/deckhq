/**
 * The scan bounds, the ordering, and what each action is legal from
 * (WP-22 follow-up).
 *
 * Split out of `state-machine.mjs` unchanged: the two scan bounds, the tick
 * interval, the four pure helpers the merge is built on — `endedOr`, which is
 * why `for_review` is sticky through a process death, the freshness rule, the
 * day's spend, the agent ordering and the room ordering — and `LEGAL_FROM`,
 * the table `act()` checks a request against.
 *
 * Pure: nothing here reads a disk, a clock it was not given, or any ack
 * state.
 */

import { agentId } from './model.mjs';
import { projectKeyFor } from './ledger.mjs';

/** @typedef {import('./model.mjs').Agent} Agent */
/** @typedef {import('./model.mjs').ActivityState} ActivityState */
/** @typedef {import('./model.mjs').SessionSummary} SessionSummary */
/** @typedef {import('./model.mjs').LiveSession} LiveSession */
/** @typedef {import('./store.mjs').Store} Store */

/**
 * @typedef {object} RuntimeAdapter
 * @property {import('./model.mjs').RuntimeId} id  the same value that prefixes
 *   every `Agent.runtime` this adapter produces. It was declared as a bare
 *   `string`, so the two could not be compared (WP-22).
 * @property {string} [label]
 * @property {() => Promise<boolean>} available
 * @property {() => Promise<LiveSession[]>} liveSessions
 * @property {(opts: {maxAgeDays:number, limit:number}) => Promise<SessionSummary[]>} scanSessions
 */

/**
 * @typedef {object} HookEvent
 * @property {string} runtime
 * @property {string} sessionId
 * @property {string} hookEvent
 * @property {string} [cwd]
 * @property {any} [payload]
 * @property {{name:string, summary:string}|null} [tool] parsed by the runtime's
 *   own adapter from a `PreToolUse` payload (WP-52); absent for every other event
 * @property {{agentId:string, parentSessionId:string|null}|null} [subagent]
 *   parsed by the runtime's own adapter from a `SubagentStop` payload (WP-41);
 *   null when the payload names no junior, and absent for every other event
 * @property {number} [at] ms epoch; defaults to Date.now() — override in tests
 */

// Sessions on disk must never be dropped by an arbitrary window (§01-PRODUCT
// "capture is absolute"); these bound a single scan only for pathological
// machines, not for normal use.
export const SCAN_MAX_AGE_DAYS = 36500;
export const SCAN_LIMIT = 5000;

export const TICK_INTERVAL_MS = 1000;

/**
 * States that can only be reached by staying there — i.e. an observed
 * liveness loss must not stomp them. Only `for_review` qualifies: it is the
 * one state the product invariant guarantees survives the process dying.
 * @param {ActivityState|undefined} prev
 * @returns {ActivityState}
 */
export function endedOr(prev) {
  return prev === 'for_review' ? 'for_review' : 'ended';
}

/**
 * Normalise an id that may or may not already carry its runtime prefix.
 * @param {string} runtime
 * @param {string} rawId
 */
export function toAgentId(runtime, rawId) {
  const prefix = `${runtime}:`;
  const bare = String(rawId).startsWith(prefix)
    ? String(rawId).slice(prefix.length)
    : String(rawId);
  return agentId(/** @type {any} */ (runtime), bare);
}

export function freshObserved(runtime) {
  return {
    runtime,
    activityState: /** @type {ActivityState} */ ('ended'),
    hookLive: /** @type {boolean|null} */ (null),
    live: false,
    lastOutputAt: /** @type {number|null} */ (null),
    lastActivityAt: 0,
    lastRole: /** @type {'user'|'assistant'|null} */ (null),
    lastText: '',
    /**
     * WP-52. What this session is doing right now, or null. Observed and
     * transient: it is set by `PreToolUse`, cleared by `PostToolUse`, `Stop`,
     * `SessionEnd` and by the stall window passing, and it never reaches a
     * user-owned field.
     * @type {import('./model.mjs').CurrentTool|null}
     */
    currentTool: null,
    /**
     * WP-16. Did the runtime say goodbye? `Stop` and `SessionEnd` set it;
     * every other lifecycle event clears it. It is the difference between a
     * session that finished or was closed and one whose process simply went
     * away mid-task, which is the only death `docs/plan/04-ENGAGEMENT-AND-
     * GAMIFICATION.md` §6 spends an interruption on. Observed, transient, and
     * it never reaches a user-owned field or the snapshot.
     * @type {boolean}
     */
    closedCleanly: false,
    title: '',
    hasCustomTitle: false,
    cwd: '',
    projectId: 'unknown',
    projectName: 'unknown',
    gitBranch: /** @type {string|null} */ (null),
    model: /** @type {string|null} */ (null),
    tokens: 0,
    cacheTokens: 0,
    // null, not 0: an unpriced session is one we have no rate for, and zero
    // would be a claim about the money (WP-26, `src/core/rates.mjs`).
    costEstimate: /** @type {number|null} */ (null),
  };
}

/**
 * What one project has spent TODAY, in USD, at list prices (WP-26).
 *
 * The room plate's payroll line. Three things it is, and one it is not:
 *
 * **It is derived from the ledger.** `todayTokens` is the day's `tokens`
 * records folded per project — how far each room's token counters actually
 * moved since local midnight — and the day's share of the project's own
 * lifetime estimate is that movement over the lifetime total. The blend is
 * deliberate and it is why this is an estimate of an estimate: a `tokens`
 * record carries a delta and a project key, not a model, so the day's tokens
 * are priced at the room's own average rate rather than at whichever model
 * produced them. On a room running one model — which is nearly every room —
 * the two are the same number.
 *
 * **It falls back rather than lying.** A project with no `tokens` record today
 * (a fresh install, a ledger that cannot be written, a daemon started five
 * minutes ago) gets its session total instead, flagged with
 * `todaySpendIsToday: false` so the plate can say "to date" rather than
 * claiming a day's figure it does not have.
 *
 * **It is null when nothing in the room has a rate.** Not zero. See
 * `src/core/rates.mjs`.
 *
 * **It is not a bill.** Rule 7. Every display of it says so.
 *
 * @param {{cwd?:string, tokens?:number, cacheTokens?:number, costEstimate?:number, costRated?:boolean}} project
 * @param {Record<string, {tokens?:number, cache?:number}>} todayTokens
 * @returns {{todaySpend:number|null, todaySpendIsToday:boolean}}
 */
export function todaySpendFor(project, todayTokens) {
  if (!project || project.costRated !== true) {
    return { todaySpend: null, todaySpendIsToday: false };
  }
  const lifetime = Number(project.costEstimate) || 0;
  const round = (/** @type {number} */ n) => Math.round(n * 10000) / 10000;
  const total = (Number(project.tokens) || 0) + (Number(project.cacheTokens) || 0);
  const entry = (todayTokens || {})[projectKeyFor(project.cwd || '')];
  const moved = entry ? (Number(entry.tokens) || 0) + (Number(entry.cache) || 0) : 0;
  if (moved <= 0 || total <= 0) {
    return { todaySpend: round(lifetime), todaySpendIsToday: false };
  }
  // Clamped: a day cannot have cost more than the session has ever cost, and
  // a scan that read a longer transcript than the totals it is blended
  // against would otherwise produce a plate line larger than the whiteboard's.
  return {
    todaySpend: round(Math.min(lifetime, (moved / total) * lifetime)),
    todaySpendIsToday: true,
  };
}

/**
 * Canonical order for the flat agent list: the review queue oldest-first,
 * then everything else by most recent activity. Per-placement grouping for
 * the floor itself happens client-side; this just gives a stable, useful
 * default order.
 * @param {Agent} a
 * @param {Agent} b
 */
export function compareAgents(a, b) {
  const aWaiting = a.ackState === 'active' && a.activityState === 'for_review';
  const bWaiting = b.ackState === 'active' && b.activityState === 'for_review';
  if (aWaiting !== bWaiting) return aWaiting ? -1 : 1;
  if (aWaiting && bWaiting) return (a.reviewSince ?? 0) - (b.reviewSince ?? 0);
  return b.lastActivityAt - a.lastActivityAt || a.id.localeCompare(b.id);
}

/**
 * Put the rooms in the order an imported layout asked for (WP-30).
 *
 * The floor has no room COORDINATES to restore — `public/render/plan.js` deals
 * projects into bands and treemaps each band, so a room's place is a function
 * of the order it arrives in and of how big its neighbours are
 * (`docs/DEVIATIONS.md` §96, §106). Order is therefore the whole of what a
 * layout can carry, and this is where it lands.
 *
 * Two rules, both chosen so an ordering can never lose a room:
 *   - a project the order names keeps its position in the order;
 *   - a project the order has never heard of — a repo opened since the layout
 *     was written — follows, in the order the scan produced.
 *
 * An empty order (every install that has never imported a layout) returns the
 * list untouched, which is what keeps the default floor's goldens at 0 px.
 *
 * @template {{id:string}} T
 * @param {T[]} projects
 * @param {string[]} order
 * @returns {T[]}
 */
export function orderRooms(projects, order) {
  if (!Array.isArray(order) || order.length === 0) return projects;
  const rank = new Map(order.map((id, i) => [id, i]));
  return projects
    .map((p, i) => ({
      p,
      i,
      rank: rank.has(p.id) ? /** @type {number} */ (rank.get(p.id)) : Infinity,
    }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((entry) => entry.p);
}

/**
 * Legality per docs/02-ARCHITECTURE.md §5.1. "Any active state" means
 * ackState === 'active' regardless of activityState.
 * @type {Record<string, (agent: Agent) => boolean>}
 */
export const LEGAL_FROM = {
  acknowledge: (a) =>
    a.ackState === 'active' &&
    (a.activityState === 'for_review' ||
      a.activityState === 'needs_input' ||
      a.activityState === 'stalled'),
  review: (a) => a.ackState === 'active',
  bench: (a) => a.ackState === 'active',
  recall: (a) => a.ackState === 'benched',
  let_go: () => true,
  rehire: (a) => a.ackState === 'let_go',
};
