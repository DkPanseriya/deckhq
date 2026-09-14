/**
 * A name and avatar chosen before the session existed.
 *
 * The in-room `+` and "start a new project" both ask for a short name and an
 * avatar, and both then spawn a terminal. The session id is the runtime's to
 * mint, so there is nothing to write the identity to yet: the choice waits
 * here until the scan discovers the session it was made for.
 *
 * ============================================================================
 * WHY THIS IS A MODULE AND NOT SIX LINES IN THE ROUTE (WP-84, §156)
 *
 * It was six lines in the route, and two of them were wrong.
 *
 *   1. **The match was unconditional.** It read
 *      `registry.agents.filter(a => … && !a.displayName)`, and
 *      `registry.agents` is `_agents` — the merged scan, which never carries
 *      `displayName`, because identity is applied in `snapshot()`. So the
 *      clause every reader took for "only a session the user has not already
 *      named" was `!undefined`, which is always true. A name queued by the `+`
 *      button could therefore land on a session the user HAD named, silently
 *      overwriting it. Found in passing by §155 and recorded, unfixed, in
 *      `docs/plan/BUG-DUPLICATE-AGENT.md` §4.
 *
 *   2. **The expiry read the wall clock** (`Date.now()`), so nothing could
 *      test it without sleeping.
 *
 * Both are decisions about a small queue, and a small queue that decides
 * things is a thing to test directly rather than through an HTTP route and a
 * spawned terminal. So the queue is here, pure apart from the clock it is
 * handed, and `src/http/routes/actions.mjs` keeps only the two lines that put
 * something in and take the result out.
 * ============================================================================
 *
 * WHAT "ALREADY NAMED" MEANS. `displayName` is the name the USER chose, and
 * null otherwise — `Identity.describe()` says so in as many words. Every agent
 * has a `givenName` (the daemon assigns one on sight), so asking about
 * `givenName` would match nobody. The caller must therefore hand `settle()`
 * DESCRIBED agents — the ones `snapshot()` produces — and not the raw merge.
 */

import path from 'node:path';
import { now as clockNow } from './clock.mjs';

/**
 * How long a queued identity waits for its session.
 *
 * Ten minutes, because the thing it is waiting for is a terminal window
 * opening and a runtime writing its first transcript line, which is seconds;
 * anything longer than a coffee is a session that never arrived. When it
 * expires the choice is dropped and the session that does eventually appear
 * keeps the name the daemon gave it — which is a name, not a blank.
 */
export const PENDING_IDENTITY_TTL_MS = 10 * 60 * 1000;

/**
 * @typedef {object} PendingIdentity
 * @property {string} cwd        resolved
 * @property {string|null} name
 * @property {string|null} avatar
 * @property {number} at         when it was queued, on the injected clock
 */

/**
 * @param {object} [opts]
 * @param {() => number} [opts.now]   the clock; the daemon's injected one by
 *   default, a fake one in tests. Never `Date.now()` at a call site.
 * @param {number} [opts.ttlMs]
 */
export function createPendingIdentities(opts = {}) {
  const now = opts.now || clockNow;
  const ttlMs = Number.isFinite(opts.ttlMs) ? Number(opts.ttlMs) : PENDING_IDENTITY_TTL_MS;

  /** @type {PendingIdentity[]} */
  const queue = [];

  /**
   * Remember a choice made before the session existed. A call with neither a
   * name nor an avatar is not a choice and queues nothing.
   * @param {string} cwd
   * @param {string|null|undefined} name
   * @param {string|null|undefined} avatar
   * @returns {boolean} whether anything was queued
   */
  function queueIdentity(cwd, name, avatar) {
    if (!name && !avatar) return false;
    queue.push({
      cwd: path.resolve(String(cwd || '')),
      name: name || null,
      avatar: avatar || null,
      at: now(),
    });
    return true;
  }

  /** Drop everything that has waited longer than the TTL. @returns {number} dropped */
  function prune() {
    const at = now();
    let dropped = 0;
    for (let i = queue.length - 1; i >= 0; i--) {
      if (at - queue[i].at > ttlMs) {
        queue.splice(i, 1);
        dropped++;
      }
    }
    return dropped;
  }

  /**
   * Expire what has waited too long, then match what is left.
   *
   * A queued identity attaches to the NEWEST session in its directory that the
   * user has not already named. Newest, because the `+` button's session is
   * the one that just started; not-already-named, because a name the user
   * typed outranks one the user queued for a session that may never have
   * arrived. A matched entry leaves the queue, so it can never attach twice.
   *
   * @param {Array<{id?:string, identityId?:string, cwd?:string,
   *   displayName?:string|null, lastActivityAt?:number}>} agents
   *   DESCRIBED agents — `registry.snapshot().agents`, never `registry.agents`.
   *   See the header.
   * @returns {Array<{agent:any, name:string|null, avatar:string|null}>}
   *   in queue order; the caller writes each one.
   */
  function settle(agents) {
    prune();
    if (queue.length === 0) return [];
    const list = Array.isArray(agents) ? agents : [];
    /** @type {Array<{agent:any, name:string|null, avatar:string|null}>} */
    const applied = [];
    /** Two entries for one directory must not both land on one session. */
    const claimed = new Set();
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i];
      const match = list
        .filter(
          (a) =>
            path.resolve(String(a.cwd || '')) === p.cwd &&
            !a.displayName &&
            !claimed.has(a.id ?? a),
        )
        .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0))[0];
      if (!match) continue;
      claimed.add(match.id ?? match);
      applied.push({ agent: match, name: p.name, avatar: p.avatar });
      queue.splice(i, 1);
      i--;
    }
    return applied;
  }

  return {
    queue: queueIdentity,
    prune,
    settle,
    get size() {
      return queue.length;
    },
    /** A copy, for tests and for nothing else. */
    peek: () => queue.map((p) => ({ ...p })),
  };
}
