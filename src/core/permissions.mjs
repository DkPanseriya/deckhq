/**
 * The permission holds: HTTP responses this daemon is keeping open because a
 * runtime is waiting on a human.
 *
 * WP-19, `docs/DEVIATIONS.md` §86 and §94, `docs/plan/08-PLAN-V2-100X.md` B4.
 *
 * A `PermissionRequest` hook fires only when a tool call would otherwise raise
 * a prompt in the terminal, and the runtime waits on the HTTP response for up
 * to its own timeout (600 s on the build measured in §86.4). This class is the
 * whole of that wait: one entry per held socket, keyed by the runtime's
 * `tool_use_id`, resolved by exactly one thing — a person pressing a button.
 *
 * ============================================================================
 * WHAT THIS MUST NEVER DO. Each has a named `INVARIANT:` test in
 * test/unit/permission-route.test.mjs:
 *
 *   1. Never allow anything by itself. No mode, no allowlist, no tool, no
 *      "the user usually allows this". `decide()` is reachable only from the
 *      panel's own POST.
 *   2. Never answer a DECISION on a timer. The hold expires into an empty
 *      body, which the runtime reads as "no decision" and falls through to the
 *      terminal prompt it has been showing the whole time (§86.4). Same on
 *      daemon shutdown.
 *   3. Never touch `ackState`, `reviewSince` or `needsInputSince`. A permission
 *      decision is a statement about one tool call, not about whether the user
 *      is done with a session; routing it into the user-owned half of the model
 *      would let an observed event clear a user-owned state, which is the
 *      `08` §1.1 rule 1 invariant. This module holds no reference to the store
 *      and calls nothing on the registry but the two pending-permission
 *      methods, which are themselves write-only into observed state.
 *   4. Never set `interrupt: true`, and never send a `destination` other than
 *      `"session"` — see `permissionDecisionBody` in the Claude Code adapter,
 *      which is where the response body is actually spelled.
 * ============================================================================
 */

import { createLog } from './log.mjs';
import { agentId } from './model.mjs';

/**
 * The margin taken off the runtime's own timeout. We want the socket released
 * from this side a little before the runtime gives up on it, so the withdrawal
 * is ours and orderly rather than a reset the log has to explain.
 */
export const HOLD_MARGIN_MS = 15_000;

/** Runtime timeout (§86.4: `var Ng = 600000`) minus {@link HOLD_MARGIN_MS}. */
export const DEFAULT_HOLD_MS = 600_000 - HOLD_MARGIN_MS;

/**
 * Held sockets are the only new resource this feature introduces, so the map
 * is capped and sheds its oldest rather than growing without bound (§86.5).
 * A shed entry is answered with nothing, so it falls through to the terminal
 * exactly like a timeout.
 */
export const MAX_PENDING = 32;

/**
 * @typedef {object} Held
 * @property {string} id
 * @property {string} agentId
 * @property {string} tool
 * @property {string} summary
 * @property {any[]} suggestions
 * @property {boolean} requiresUserInteraction
 * @property {number} since
 * @property {import('node:http').ServerResponse} res
 * @property {ReturnType<typeof setTimeout>|null} timer
 */

export class Permissions {
  /**
   * @param {object} opts
   * @param {{setPendingPermission:Function, clearPendingPermission:Function}} opts.registry
   * @param {import('./log.mjs').Log} [opts.log]
   * @param {number} [opts.holdMs] how long to hold one request. Configurable
   *   so a test can prove the fall-through in milliseconds rather than ten
   *   minutes, and so a machine whose runtime uses a shorter timeout can be
   *   brought back under it.
   * @param {number} [opts.maxPending]
   */
  constructor({ registry, log, holdMs, maxPending } = /** @type {any} */ ({})) {
    this.registry = registry;
    this.log = log || createLog('permissions');
    this.holdMs = Number.isFinite(holdMs) && Number(holdMs) > 0 ? Number(holdMs) : DEFAULT_HOLD_MS;
    this.maxPending = Number.isInteger(maxPending) && maxPending > 0 ? maxPending : MAX_PENDING;
    /** @type {Map<string, Held>} insertion-ordered, which is what shedding uses */
    this._held = new Map();
    this._closed = false;
  }

  /** How many requests are being held right now. */
  get size() {
    return this._held.size;
  }

  /**
   * Hold one request open and put its card on the session.
   *
   * @param {object} request the adapter's parse of the payload
   * @param {string} request.id
   * @param {string} request.sessionId
   * @param {string} request.runtime
   * @param {string} request.tool
   * @param {string} request.summary
   * @param {any[]} request.suggestions
   * @param {boolean} request.requiresUserInteraction
   * @param {import('node:http').ServerResponse} res the socket to hold
   * @param {number} [now]
   * @returns {Held|null} null when the daemon is closing, in which case the
   *   caller answers with nothing and the terminal prompt wins.
   */
  hold(request, res, now = Date.now()) {
    if (this._closed) return null;

    // A repeat of an id we already hold (a retry, a duplicated hook entry)
    // replaces it: the newer socket is the live one, and the older is answered
    // with nothing rather than left to rot.
    if (this._held.has(request.id)) this._release(request.id, 'superseded');

    while (this._held.size >= this.maxPending) {
      const oldest = this._held.keys().next().value;
      this.log.warn(
        `holding ${this._held.size} permission requests already; letting the oldest fall ` +
          'through to its terminal prompt',
      );
      this._release(String(oldest), 'shed');
    }

    /** @type {Held} */
    const held = {
      id: request.id,
      agentId: agentId(/** @type {any} */ (request.runtime), request.sessionId),
      tool: request.tool,
      summary: request.summary,
      suggestions: request.suggestions || [],
      requiresUserInteraction: Boolean(request.requiresUserInteraction),
      since: now,
      res,
      timer: null,
    };

    // The one timer in this file, and it decides nothing: it answers with an
    // empty body so the runtime falls back to the prompt it is already showing.
    held.timer = setTimeout(() => this._release(held.id, 'timeout'), this.holdMs);
    if (typeof held.timer.unref === 'function') held.timer.unref();

    // The socket dying IS the answer arriving somewhere else — the user
    // answered in the terminal, or the runtime gave up. Drop the card; never
    // write to a dead socket.
    res.on('close', () => {
      if (this._held.get(held.id) === held) this._forget(held.id, 'withdrawn');
    });

    this._held.set(held.id, held);
    this.registry.setPendingPermission(held.agentId, {
      id: held.id,
      tool: held.tool,
      summary: held.summary,
      suggestions: held.suggestions,
      requiresUserInteraction: held.requiresUserInteraction,
      since: held.since,
    });
    return held;
  }

  /**
   * Answer a held request. The ONLY way a decision is ever sent.
   *
   * @param {string} id
   * @param {'allow'|'deny'|'session'} decision
   * @param {(decision:'allow'|'deny'|'session', suggestions:any[]) => any} bodyFor
   *   the adapter's own response-body builder
   * @returns {{ok:true, body:any}|{ok:false, error:string, status:number}}
   */
  decide(id, decision, bodyFor) {
    const held = this._held.get(id);
    if (!held) {
      return {
        ok: false,
        status: 404,
        error:
          'That request is no longer waiting — it was answered in the terminal, or it timed out.',
      };
    }
    if (held.requiresUserInteraction) {
      return {
        ok: false,
        status: 409,
        error: `${held.tool} has to be answered in the session itself; the runtime discards an answer from here.`,
      };
    }
    if (decision === 'session' && held.suggestions.length === 0) {
      return {
        ok: false,
        status: 400,
        error: 'This request carried no rule to add, so there is nothing to allow for the session.',
      };
    }

    const body = bodyFor(decision, held.suggestions);
    this._forget(id, decision);
    try {
      const payload = Buffer.from(JSON.stringify(body));
      held.res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': payload.length,
        'cache-control': 'no-store',
      });
      held.res.end(payload);
    } catch (err) {
      this.log.warn('could not answer a held permission request', err);
      return {
        ok: false,
        status: 409,
        error: 'The session stopped waiting before the answer could be sent.',
      };
    }
    return { ok: true, body };
  }

  /**
   * Let go of every held request, answering each with nothing. Called on
   * daemon shutdown: a closing DeckHQ must never leave a session blocked, and
   * must never spend its last act deciding something.
   */
  shutdown() {
    this._closed = true;
    for (const id of [...this._held.keys()]) this._release(id, 'shutdown');
  }

  /**
   * Answer one held request with an empty JSON object and forget it. An empty
   * body carries no `hookSpecificOutput`, so it is not a decision: the runtime
   * falls out of its loop and the terminal prompt decides (§86.4).
   * @param {string} id
   * @param {string} why
   */
  _release(id, why) {
    const held = this._held.get(id);
    if (!held) return;
    this._forget(id, why);
    try {
      const payload = Buffer.from('{}');
      held.res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': payload.length,
        'cache-control': 'no-store',
      });
      held.res.end(payload);
    } catch {
      /* the socket was already gone; nothing to release */
    }
  }

  /**
   * Drop one entry and take its card off the session, without writing to the
   * socket.
   * @param {string} id
   * @param {string} why
   */
  _forget(id, why) {
    const held = this._held.get(id);
    if (!held) return;
    if (held.timer) clearTimeout(held.timer);
    this._held.delete(id);
    this.registry.clearPendingPermission(held.agentId, id);
    this.log.debug(`permission ${id} (${held.tool}) ${why}`);
  }
}
