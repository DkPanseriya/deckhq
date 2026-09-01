/**
 * First-run seeding. docs/02-ARCHITECTURE.md §4.4.
 *
 * Seeding decides only the initial AckState and reviewSince for sessions that
 * already existed on disk the first time DeckHQ ever runs, so the queue is
 * immediately useful instead of empty. It writes nothing that the state
 * machine cannot also derive on its own from a live scan; it just gives the
 * store a head start.
 */

/** @typedef {import('./model.mjs').SessionSummary} SessionSummary */
/** @typedef {import('./store.mjs').Store} Store */

const HOUR_MS = 60 * 60 * 1000;
const REVIEW_WINDOW_MS = 72 * HOUR_MS;
const ACTIVE_WINDOW_MS = 14 * 24 * HOUR_MS;

/**
 * Pure seeding decision, exposed separately so it is trivial to test at the
 * exact 72h and 14 day boundaries without touching a store.
 *
 * @param {SessionSummary[]} summaries
 * @param {number} now ms epoch
 * @returns {Map<string, {state: import('./model.mjs').AckState, reviewSince: number|null}>}
 */
export function seedPlan(summaries, now) {
  /** @type {Map<string, {state: import('./model.mjs').AckState, reviewSince: number|null}>} */
  const plan = new Map();
  for (const s of summaries) {
    const age = now - s.lastActivityAt;
    if (s.lastRole === 'assistant' && age < REVIEW_WINDOW_MS) {
      plan.set(s.id, { state: 'active', reviewSince: s.lastActivityAt });
    } else if (age < ACTIVE_WINDOW_MS) {
      plan.set(s.id, { state: 'active', reviewSince: null });
    } else {
      plan.set(s.id, { state: 'let_go', reviewSince: null });
    }
  }
  return plan;
}

/**
 * Run seeding exactly once for the lifetime of a state.json. Safe to call on
 * every daemon boot: it is a no-op once `seededAt` is recorded, and it never
 * overwrites an ack record the user (or a prior boot) has already set.
 *
 * @param {Store} store
 * @param {SessionSummary[]} summaries
 * @param {number} now ms epoch
 * @returns {Promise<boolean>} true if seeding actually ran this call
 */
export async function seedIfNeeded(store, summaries, now) {
  if (store.seededAt != null) return false;
  const plan = seedPlan(summaries, now);
  for (const [id, rec] of plan) {
    if (store.getAck(id)) continue;
    store.setAck(id, rec);
  }
  store.markSeeded(now);
  return true;
}
