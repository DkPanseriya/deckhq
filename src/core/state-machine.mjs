/**
 * The `Registry`: the merge of scanned sessions, live sessions, persisted ack
 * state and hook events into the `Agent[]` the rest of the product renders.
 *
 * docs/02-ARCHITECTURE.md §3, §4, §5.1.
 *
 * THE INVARIANT: no observed event — no scan, no poll, no live/dead
 * transition, no hook event other than the one documented exception below,
 * no conversation read, no hover, no selection — may clear `reviewSince`,
 * `needsInputSince` or mutate `ackState`. Only `act()` does that, plus the
 * one-time bootstrap from a persisted `reviewSince` on a brand-new in-memory
 * record (restoring state across a daemon restart, never clearing it).
 *
 * Three places deliberately depart from a literal reading of the §4.1/§4.2
 * tables, each made in favour of docs/01-PRODUCT.md §2 per docs/04-BUILD-PLAN
 * rule 1 ("inviolable... rejected regardless of how convenient"). Flagged
 * here and again in the delivery report — this is a judgment call, not a
 * silent one:
 *   1. `SessionEnd` / a poll-observed liveness loss: the table says
 *      unconditionally `activityState = ended`. Applied literally, a process
 *      dying after finishing its turn would walk the item out of the office
 *      — exactly the bug §2 exists to prevent. `for_review` is sticky
 *      through death; only `live` flips to false. See `endedOr`.
 *   2. `SessionStart`: the table says unconditionally `activityState =
 *      working`. A restart/resume of an id already `for_review` (e.g. the
 *      user reopened it via the F8 terminal escape hatch, not the
 *      acknowledge button) must not silently clear it either. Same guard.
 *   3. `UserPromptSubmit` is kept exactly as tabled (including the explicit
 *      "clear reviewSince and needsInputSince"): unlike the two above, this
 *      fires because the user just typed into this exact session — direct,
 *      first-person action on the agent, not passive observation. This is
 *      the one hook event excluded from the blanket "unchanged" assertion in
 *      the invariant test below.
 *   4. Degraded/poll path, §4.2: when a session is live and its transcript's
 *      last turn flips from assistant to user, that is this path's only
 *      available signal for the same thing UserPromptSubmit reports directly
 *      — the user already replied. Treated the same way, for consistency:
 *      activityState moves off for_review AND reviewSince/needsInputSince
 *      are cleared together, rather than leaving a stale reviewSince behind
 *      in the store once nothing shows it in the UI any more.
 *
 * WP-19's pending permissions ride along beside all of this and touch none of
 * it: `setPendingPermission`/`clearPendingPermission` write into one map that
 * only `_computeAgents` reads, and a permission being raised, answered or
 * withdrawn changes no activity state and no ack field. A raised hand on the
 * floor is put there by `Notification` and stays until the runtime says
 * otherwise, whatever the panel did with the card.
 *
 * To make that structural rather than aspirational, the observed merge
 * (`_computeAgents`) never touches the store's ack fields directly except
 * through `_markForReview` / `_markNeedsInput`, which are strictly
 * set-only-if-unset. Every other user-owned mutation happens in `act()`.
 *
 * THE LEDGER (WP-17), and why it cannot break any of the above:
 * `_noteLedger()` runs at the very END of `_rebuild()`, after the agents are
 * already computed and assigned. It is handed the previous and the current
 * `Agent[]` — plain values — and it may do exactly two things with them:
 * compare them, and hand the difference to `Ledger.record()`, which is
 * synchronous, buffers in memory and cannot throw. It never calls
 * `store.getAck`, never calls `store.setAck`, and every call site here is
 * inside a `try` that swallows. A ledger that is absent, broken, or throwing
 * on every call therefore produces byte-identical agents and byte-identical
 * ack state — asserted by the `INVARIANT:` test in
 * `test/unit/ledger-invariant.test.mjs`, which drives the same script through
 * two registries and diffs both.
 *
 * ============================================================================
 * WP-22 follow-up · this file is the constructor and `act()` — the ONE
 * function in the daemon that may move a user-owned state. It is here, beside
 * the invariant this header states, rather than in any of the parts. The rest
 * of the class is a chain of base classes, each holding the class body's own
 * lines character for character:
 *
 *   RegistryBase → RegistrySnapshot → RegistryCompute → RegistryScan
 *     → RegistryHooks → Registry
 *
 *   state-machine-base.mjs      the instance shape, declared once
 *   state-machine-rules.mjs     the scan bounds, the orderings, LEGAL_FROM
 *   state-machine-snapshot.mjs  agents, the snapshot, the subscribers, the
 *                               ledger writes
 *   state-machine-compute.mjs   `_computeAgents`: the merge
 *   state-machine-scan.mjs      refresh, the dashboards, the tick, start/stop
 *   state-machine-hooks.mjs     `applyHook`, and the three documented
 *                               departures above
 *
 * A chain rather than a prototype mixin because the type checker follows a
 * chain, and this repository has no `@ts-ignore` anywhere
 * (docs/DEVIATIONS.md §122). The order is the call graph's own: nothing in it
 * calls upwards, which is why the three settings writes that ask for a
 * rebuild sit with the scan rather than with the snapshot.
 *
 * The one consequence for a body is the `super()` on the constructor's first
 * line, which a derived class requires.
 * ============================================================================
 */

import { isSubagent, ACK_ACTIONS } from './model.mjs';
import { createLog } from './log.mjs';
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

import { RegistryHooks } from './state-machine-hooks.mjs';
import { LEGAL_FROM } from './state-machine-rules.mjs';

export * from './state-machine-rules.mjs';
export * from './state-machine-base.mjs';
export * from './state-machine-snapshot.mjs';
export * from './state-machine-compute.mjs';
export * from './state-machine-scan.mjs';
export * from './state-machine-hooks.mjs';

export class Registry extends RegistryHooks {
  /**
   * `identity` and `ledger` are destructured below and were never declared;
   * `daemon.mjs` has been passing `identity` since WP-20 (WP-22).
   * @param {{store: Store, adapters: RuntimeAdapter[], log?: import('./log.mjs').Log,
   *         identity?: any, ledger?: any}} opts
   */
  constructor({ store, adapters, log, identity, ledger }) {
    // Required of a derived class before `this`. Nothing above this one
    // declares a constructor; the chain is method bodies and the field
    // declarations in `state-machine-base.mjs`.
    super();
    this.store = store;
    this.adapters = adapters || [];
    this.log = log || createLog('state-machine');
    /**
     * The event ledger (WP-17), or null. Optional everywhere: a Registry
     * without one behaves identically, which is both what the unit suite
     * relies on and what the invariant guarantees.
     * @type {import('./ledger.mjs').Ledger|null}
     */
    this.ledger = ledger || null;
    /**
     * Assigns the stable MK tags the floor draws. Optional so the unit suite
     * can build a Registry without one; the daemon always supplies it.
     * @type {import('./identity.mjs').Identity|null}
     */
    this.identity = identity || null;

    /**
     * Project ids known to have a runnable dashboard. Recomputed on each
     * scan; the floor draws a screen only for these.
     * @type {Set<string>}
     */
    this._dashboards = new Set();

    /** @type {Map<string, ReturnType<typeof import('./state-machine-rules.mjs').freshObserved>>} */
    this._observed = new Map();
    /** @type {SessionSummary[]} */
    this._lastSummaries = [];
    /** @type {LiveSession[]} */
    this._lastLive = [];
    /** @type {Agent[]} */
    this._agents = [];
    this._lastKey = '';
    this._changed = false;
    this._scannedAt = null;

    /** @type {Record<string, {supported:boolean, installed:boolean}>} */
    this._hookStatus = {};

    /**
     * WP-41. Juniors a `SubagentStop` has named as finished, by agent id.
     *
     * Without hooks a junior leaves the floor when its transcript stops moving
     * — five minutes at the worst (`SUBAGENT_IDLE_MS` in the Claude Code
     * adapter). With hooks the runtime says so at once, and this is where that
     * is remembered until the next scan drops the summary too.
     *
     * It is observed state and it is about a session the user does not own:
     * nothing in this set is persisted, nothing in it reaches `store.setAck`,
     * and it is pruned against `_lastSummaries` on every rebuild so it cannot
     * grow without bound. Subagent ids are never reused.
     * @type {Set<string>}
     */
    this._stoppedJuniors = new Set();

    /**
     * WP-19. Permission prompts this daemon is holding open, by agent id.
     *
     * Observed and transient, exactly like `currentTool`: set when a
     * `PermissionRequest` arrives, cleared when it is answered, withdrawn or
     * times out. It never touches `activityState` — the raised hand on the
     * floor belongs to the runtime's own `Notification`, and stays up until
     * the runtime moves on — and it never touches a user-owned field.
     * @type {Map<string, import('./model.mjs').PendingPermission>}
     */
    this._pendingPermissions = new Map();

    /**
     * Evidence that installed hooks are actually reaching us.
     *
     * "Installed" is a statement about a settings file, not about delivery: a
     * hook aimed at the wrong port, or blocked by a security tool, leaves the
     * file looking perfect while nothing ever arrives. The port mismatch is
     * caught deterministically by the adapter; this is the residual signal for
     * everything else, surfaced in the hooks screen rather than guessed at.
     * @type {Map<string, {eventsSeen:number, lastEventAt:number|null}>}
     */
    this._hookHealth = new Map();
    this._startedAt = Date.now();

    /** @type {Set<(snapshot: ReturnType<Registry['snapshot']>) => void>} */
    this._subscribers = new Set();

    this._refreshing = null;
    this._refreshPending = false;

    this._pollTimer = null;
    this._tickTimer = null;
  }

  /**
   * @param {string} id
   * @param {typeof ACK_ACTIONS[number]} action
   * @returns {Promise<Agent|undefined>} the agent as it now stands
   */
  async act(id, action) {
    if (!ACK_ACTIONS.includes(action)) {
      throw new Error(`Unknown action "${action}"`);
    }
    const agent = this._agents.find((a) => a.id === id);
    if (!agent) {
      throw new Error(`No such agent "${id}"`);
    }
    // WP-41. A junior has no user-owned state and the interface offers no
    // button that would write one. Refused here rather than only in the
    // client, because `POST /api/ack` and `deckhq bench <id>` reach this same
    // method and a subagent's `ackState` must not become a thing that exists:
    // it would persist past the junior's life, into a store keyed by an id
    // that will never be seen again.
    if (isSubagent(agent)) {
      throw new Error(`Action "${action}" is not available for a subagent ("${id}")`);
    }
    if (!LEGAL_FROM[action](agent)) {
      throw new Error(
        `Action "${action}" is not legal for "${id}" (ackState=${agent.ackState}, activityState=${agent.activityState})`,
      );
    }

    const now = Date.now();
    switch (action) {
      case 'acknowledge': {
        this.store.setAck(id, { reviewSince: null, needsInputSince: null });
        const obs = this._observed.get(id);
        if (obs) obs.activityState = obs.live ? 'working' : 'ended';
        break;
      }
      case 'review': {
        const obs = this._ensureObserved(id, agent.runtime, agent.cwd);
        obs.activityState = 'for_review';
        this._markForReview(id, now);
        break;
      }
      case 'bench':
        this.store.setAck(id, { state: 'benched' });
        break;
      case 'recall':
        this.store.setAck(id, { state: 'active' });
        break;
      case 'let_go':
        this.store.setAck(id, { state: 'let_go' });
        break;
      case 'rehire':
        this.store.setAck(id, { state: 'active' });
        break;
      default:
        throw new Error(`Unknown action "${action}"`);
    }

    // Recorded after the store has already been written, and before the
    // rebuild that will record the state change it caused: the action is the
    // user's decision, the transitions are its consequences, and the ledger
    // wants both. An illegal action never reaches here — it threw above — so
    // the ledger never claims an action that did not happen.
    this._ledger('action', {
      sessionId: id,
      projectKey: projectKeyFor(agent.cwd),
      action,
      t: now,
    });

    this._rebuild();
    this._emitIfChanged();
    return this._agents.find((a) => a.id === id);
  }
}
