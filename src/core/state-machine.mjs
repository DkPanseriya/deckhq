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
 */

import {
  agentId,
  splitAgentId,
  projectIdFromCwd,
  projectNameFromCwd,
  clampText,
  counts,
  projects as projectsOf,
  ACK_ACTIONS,
} from './model.mjs';
import { seedIfNeeded } from './seed.mjs';
import { createLog } from './log.mjs';
import { discoverActions } from './actions.mjs';
import { projectKeyFor } from './ledger.mjs';

/** @typedef {import('./model.mjs').Agent} Agent */
/** @typedef {import('./model.mjs').ActivityState} ActivityState */
/** @typedef {import('./model.mjs').SessionSummary} SessionSummary */
/** @typedef {import('./model.mjs').LiveSession} LiveSession */
/** @typedef {import('./store.mjs').Store} Store */

/**
 * @typedef {object} RuntimeAdapter
 * @property {string} id
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
 * @property {number} [at] ms epoch; defaults to Date.now() — override in tests
 */

// Sessions on disk must never be dropped by an arbitrary window (§01-PRODUCT
// "capture is absolute"); these bound a single scan only for pathological
// machines, not for normal use.
const SCAN_MAX_AGE_DAYS = 36500;
const SCAN_LIMIT = 5000;

const TICK_INTERVAL_MS = 1000;

/**
 * States that can only be reached by staying there — i.e. an observed
 * liveness loss must not stomp them. Only `for_review` qualifies: it is the
 * one state the product invariant guarantees survives the process dying.
 * @param {ActivityState|undefined} prev
 * @returns {ActivityState}
 */
function endedOr(prev) {
  return prev === 'for_review' ? 'for_review' : 'ended';
}

/**
 * Normalise an id that may or may not already carry its runtime prefix.
 * @param {string} runtime
 * @param {string} rawId
 */
function toAgentId(runtime, rawId) {
  const prefix = `${runtime}:`;
  const bare = String(rawId).startsWith(prefix)
    ? String(rawId).slice(prefix.length)
    : String(rawId);
  return agentId(/** @type {any} */ (runtime), bare);
}

function freshObserved(runtime) {
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
    title: '',
    hasCustomTitle: false,
    cwd: '',
    projectId: 'unknown',
    projectName: 'unknown',
    gitBranch: /** @type {string|null} */ (null),
    model: /** @type {string|null} */ (null),
    tokens: 0,
    cacheTokens: 0,
    costEstimate: 0,
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
function compareAgents(a, b) {
  const aWaiting = a.ackState === 'active' && a.activityState === 'for_review';
  const bWaiting = b.ackState === 'active' && b.activityState === 'for_review';
  if (aWaiting !== bWaiting) return aWaiting ? -1 : 1;
  if (aWaiting && bWaiting) return (a.reviewSince ?? 0) - (b.reviewSince ?? 0);
  return b.lastActivityAt - a.lastActivityAt || a.id.localeCompare(b.id);
}

export class Registry {
  /**
   * @param {{store: Store, adapters: RuntimeAdapter[], log?: import('./log.mjs').Log}} opts
   */
  constructor({ store, adapters, log, identity, ledger }) {
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

    /** @type {Map<string, ReturnType<typeof freshObserved>>} */
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

  /** @returns {Agent[]} */
  get agents() {
    return this._agents;
  }

  /**
   * @returns {{agents: Agent[], projects: ReturnType<typeof projectsOf>, counts: ReturnType<typeof counts>, settings: import('./store.mjs').Settings, hooks: Record<string,{supported:boolean,installed:boolean}>, degraded: Record<string, boolean>, scannedAt: number|null}}
   */
  snapshot() {
    const agents = this._agents.map((a) => {
      if (!this.identity) return a;
      const id = this.identity.describe(a.id, a.projectId);
      return { ...a, ...id };
    });
    const projects = projectsOf(agents).map((p) => {
      // `hasDashboard` decides whether the room gets a screen to click, so it
      // is refreshed by the scan rather than probed per frame.
      const hasDashboard = this._dashboards.has(p.id);
      // A room the user collapsed. An active agent overrules it — see
      // `buildPlan`: the room pops back open on its own rather than hiding
      // somebody who is working.
      const archived = this.store.isProjectArchived(p.id);
      if (!this.identity) return { ...p, hasDashboard, archived };
      const projectMk = this.identity.projectMk(p.id);
      return { ...p, hasDashboard, archived, projectMk, mk: `MK${projectMk}` };
    });
    return {
      agents,
      projects,
      counts: counts(agents),
      settings: this.store.settings,
      takenNames: this.identity ? this.identity.takenNames() : [],
      hooks: { ...this._hookStatus },
      degraded: this._degraded(),
      // A store that cannot write is losing every acknowledgement made since
      // it last succeeded. Carried in the snapshot so the client can say so.
      writeError: this.store.writeError || null,
      scannedAt: this._scannedAt,
    };
  }

  /**
   * Which runtimes are reporting inferred state rather than exact state.
   *
   * Only a runtime that is actually IN USE can be degraded. Flagging every
   * registered adapter meant Codex — which this machine has no sessions for
   * and may not even have installed — kept the "install hooks" banner up
   * permanently, including after Claude Code's hooks were installed. A
   * runtime with no sessions has nothing to report inaccurately, and a
   * runtime that cannot support hooks cannot be improved by installing them.
   */
  _degraded() {
    /** @type {Record<string, boolean>} */
    const out = {};
    const inUse = new Set(this._agents.map((a) => a.runtime));
    for (const adapter of this.adapters) {
      if (!inUse.has(adapter.id)) continue;
      const status = this._hookStatus[adapter.id];
      if (status && status.supported === false) continue;
      out[adapter.id] = !this._hooksInstalled(adapter.id);
    }
    return out;
  }

  /**
   * @param {(snapshot: ReturnType<Registry['snapshot']>) => void} fn
   * @returns {() => void} unsubscribe
   */
  on(fn) {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }

  /**
   * @param {Record<string, {supported:boolean, installed:boolean}>} status
   */
  setHookStatus(status) {
    this._hookStatus = { ...this._hookStatus, ...(status || {}) };
    this._rebuild();
    this._emitIfChanged();
  }

  /**
   * WP-19. A permission prompt is now waiting on this session.
   *
   * Write-only into observed state: it sets nothing but the map below, and
   * `_computeAgents` copies it onto the agent. It must never reach
   * `store.setAck`, `activityState`, or the needs-you count — a request for
   * permission is the runtime asking a question, and answering it is not the
   * same act as acknowledging the session.
   * @param {string} id agent id, runtime-prefixed
   * @param {import('./model.mjs').PendingPermission} pending
   */
  setPendingPermission(id, pending) {
    this._pendingPermissions.set(id, pending);
    this._rebuild();
    this._emitIfChanged();
  }

  /**
   * Take a permission card off a session: answered, withdrawn or expired.
   * @param {string} id agent id
   * @param {string} [requestId] only clear if this is still the card showing
   */
  clearPendingPermission(id, requestId) {
    const current = this._pendingPermissions.get(id);
    if (!current) return;
    if (requestId != null && current.id !== requestId) return;
    this._pendingPermissions.delete(id);
    this._rebuild();
    this._emitIfChanged();
  }

  /**
   * Delivery evidence for one runtime, for the hooks screen.
   * @param {string} runtime
   */
  hookHealthFor(runtime) {
    const h = this._hookHealth.get(runtime);
    return {
      eventsSeen: h ? h.eventsSeen : 0,
      lastEventAt: h ? h.lastEventAt : null,
      daemonStartedAt: this._startedAt,
    };
  }

  /** @param {string} runtime */
  _hooksInstalled(runtime) {
    return !!(this._hookStatus[runtime] && this._hookStatus[runtime].installed);
  }

  /**
   * Full scan + live merge. Re-entrant-safe: a call while one is already in
   * flight is coalesced into exactly one follow-up refresh rather than
   * queuing unboundedly.
   * @returns {Promise<void>}
   */
  async refresh() {
    if (this._refreshing) {
      this._refreshPending = true;
      return this._refreshing;
    }
    this._refreshing = this._doRefresh()
      .catch((err) => {
        this.log.error('refresh failed', err);
      })
      .finally(() => {
        this._refreshing = null;
        if (this._refreshPending) {
          this._refreshPending = false;
          this.refresh();
        }
      });
    return this._refreshing;
  }

  async _doRefresh() {
    /** @type {SessionSummary[]} */
    const summaries = [];
    /** @type {LiveSession[]} */
    const live = [];

    for (const adapter of this.adapters) {
      let avail = true;
      try {
        avail = await adapter.available();
      } catch (err) {
        this.log.warn(`available() failed for adapter ${adapter.id}`, err);
        continue;
      }
      if (!avail) continue;

      try {
        const s = await adapter.scanSessions({ maxAgeDays: SCAN_MAX_AGE_DAYS, limit: SCAN_LIMIT });
        for (const item of s) summaries.push(item);
      } catch (err) {
        this.log.warn(`scanSessions failed for adapter ${adapter.id}`, err);
      }

      try {
        const l = await adapter.liveSessions();
        for (const item of l) live.push(item);
      } catch (err) {
        this.log.warn(`liveSessions failed for adapter ${adapter.id}`, err);
      }
    }

    this._lastSummaries = summaries;
    this._lastLive = live;

    try {
      await seedIfNeeded(this.store, summaries, Date.now());
    } catch (err) {
      this.log.error('seeding failed', err);
    }

    this._scannedAt = Date.now();
    this._syncArchived(summaries);
    this._rebuild();
    await this._refreshDashboards();
    this._emitIfChanged();
  }

  /**
   * Collapse a project room off the floor, or restore it. A view preference
   * only — it never touches agent state.
   * @param {string} projectId
   * @param {boolean} archived
   */
  setProjectArchived(projectId, archived) {
    this.store.setProjectArchived(projectId, archived);
    this._changed = true;
    this._rebuild();
    this._emitIfChanged();
  }

  /**
   * Mirror the Claude Code app's archive into `ackState`.
   *
   * Archiving a session in the app is the user acting on that session in the
   * first person — the same class of signal as `UserPromptSubmit`, which the
   * invariant already admits as its one hook exception (see the module doc,
   * exception 3). It is not passive observation, so honouring it here does
   * not weaken the rule that observation never moves user-owned state.
   *
   * The mapping is deliberately one-dimensional. It governs `let_go` and
   * nothing else:
   *
   *   archived            -> let_go       ("fired")
   *   not archived, let_go -> active      ("rehired")
   *   not archived, other  -> left alone
   *
   * That last line is what keeps it safe: a session you benched in DeckHQ is
   * not archived in the app, and must not be dragged back to `active` on
   * every poll. Only the let-go dimension is the app's to drive.
   *
   * `reviewSince` and `needsInputSince` are never touched here — a rehired
   * agent keeps whatever review debt it had.
   */
  _syncArchived(summaries) {
    for (const summary of summaries || []) {
      // Only a runtime that actually reports the flag may drive this. An
      // adapter that cannot see an archive leaves `archived` undefined, and
      // undefined must never be read as "not archived" — that would rehire
      // every let-go agent on the next poll.
      if (typeof summary.archived !== 'boolean') continue;

      const id = summary.id;
      const ack = this.store.getAck(id);
      const state = ack ? ack.state : 'active';

      if (summary.archived && state !== 'let_go') {
        this.store.setAck(id, { state: 'let_go' });
        this._changed = true;
        this._ledger('session', {
          sessionId: id,
          projectKey: projectKeyFor(summary.cwd),
          event: 'archived',
        });
      } else if (!summary.archived && state === 'let_go') {
        this.store.setAck(id, { state: 'active' });
        this._changed = true;
        this._ledger('session', {
          sessionId: id,
          projectKey: projectKeyFor(summary.cwd),
          event: 'unarchived',
        });
      }
    }
  }

  /**
   * Which projects have something the screen in their room can run.
   *
   * Done once per scan rather than per frame: it touches the filesystem, and
   * a project gaining a dashboard is not something that needs to be noticed
   * within one animation frame.
   */
  async _refreshDashboards() {
    const seen = new Set();
    const byProject = new Map();
    for (const a of this._agents) {
      if (!byProject.has(a.projectId)) byProject.set(a.projectId, a.cwd);
    }
    await Promise.all(
      [...byProject.entries()].map(async ([projectId, cwd]) => {
        try {
          const list = await discoverActions(cwd);
          if (list.some((x) => x.kind === 'run')) seen.add(projectId);
        } catch {
          /* a project with an unreadable directory simply has no screen */
        }
      }),
    );
    const changed =
      seen.size !== this._dashboards.size || [...seen].some((id) => !this._dashboards.has(id));
    this._dashboards = seen;
    if (changed) this._changed = true;
  }

  /**
   * Synchronous, cheap. Called from the HTTP hook endpoint, which must
   * respond in under 200ms and process the rest asynchronously — this does
   * no I/O beyond scheduling a debounced store save.
   * @param {HookEvent} event
   */
  applyHook(event) {
    const runtime = event.runtime;
    const id = toAgentId(runtime, event.sessionId);
    const now = typeof event.at === 'number' ? event.at : Date.now();
    const obs = this._ensureObserved(id, runtime, event.cwd);

    const health = this._hookHealth.get(runtime) || { eventsSeen: 0, lastEventAt: null };
    health.eventsSeen += 1;
    health.lastEventAt = now;
    this._hookHealth.set(runtime, health);

    switch (event.hookEvent) {
      case 'SessionStart':
        // A restart/resume of a session id that was already for_review (e.g.
        // the user reopened it in a terminal via the "open" escape hatch,
        // F8) must not silently walk it out of the office — only an actual
        // submitted prompt (below) or act() does that. A genuinely new
        // session id has no prior state to protect, so this is a no-op
        // deviation from the literal table for the one case the invariant
        // cares about.
        obs.hookLive = true;
        if (obs.activityState !== 'for_review') {
          obs.activityState = 'working';
        }
        break;

      case 'UserPromptSubmit':
        // The one deliberate exception to "no observed event clears
        // reviewSince": this fires because the user just typed into this
        // very session. That is direct user action on the agent, not
        // passive observation — see the module doc comment above. Per
        // docs/02-ARCHITECTURE.md §4.1 this clears both timestamps.
        obs.hookLive = true;
        obs.activityState = 'working';
        obs.lastOutputAt = now;
        obs.lastActivityAt = Math.max(obs.lastActivityAt, now);
        this.store.setAck(id, { reviewSince: null, needsInputSince: null });
        break;

      case 'Notification':
        // Hook installation is scoped to the permission_prompt/idle_prompt
        // matchers (docs/02-ARCHITECTURE.md §4.1); any Notification that
        // reaches us is one of those two by construction.
        obs.hookLive = true;
        obs.activityState = 'needs_input';
        this._markNeedsInput(id, now);
        break;

      case 'Stop':
        obs.hookLive = true;
        obs.activityState = 'for_review';
        obs.currentTool = null;
        this._markForReview(id, now);
        break;

      // WP-52. The two tool events say what a session is doing and nothing
      // else. They deliberately do NOT touch `activityState`, `lastOutputAt`
      // or `lastActivityAt`:
      //   - `activityState`, because moving a needs_input session to working
      //     because it ran a tool would take a raised hand off the floor
      //     without the user ever answering it, and would change the
      //     needs-you count from an observation.
      //   - `lastOutputAt`, because that is the stall clock (§4.3), and a
      //     tool starting is not a turn boundary. Letting tool traffic reset
      //     it would silently redefine "stalled" — and stalled is one of the
      //     three states the needs-you count is made of.
      // `hookLive` is set for the same reason every other hook event sets it:
      // a tool call is proof the process is running. It cannot move a
      // for_review session (see `endedOr` and `_computeAgents`).
      case 'PreToolUse':
        obs.hookLive = true;
        obs.currentTool = event.tool
          ? { name: event.tool.name, summary: event.tool.summary, since: now }
          : null;
        break;

      case 'PostToolUse':
        obs.hookLive = true;
        obs.currentTool = null;
        break;

      case 'SubagentStop':
        // Updates lastOutputAt only; does not change parent state.
        obs.hookLive = true;
        obs.lastOutputAt = now;
        obs.lastActivityAt = Math.max(obs.lastActivityAt, now);
        break;

      case 'SessionEnd':
        obs.hookLive = false;
        obs.activityState = endedOr(obs.activityState);
        obs.currentTool = null;
        break;

      default:
        this.log.debug(`ignoring unknown hook event: ${event.hookEvent}`);
        return;
    }

    this._rebuild();
    this._emitIfChanged();
  }

  /**
   * Stall detection. Only meaningful where hooks are installed — without
   * them `stalled` is not derivable at all (docs/02-ARCHITECTURE.md §4.2/4.3).
   * A stalled agent returns to `working` on its own once fresh output is
   * observed; this is the one activity state allowed to clear itself,
   * because it was never a user-facing debt in the first place.
   * @param {number} now
   */
  tick(now) {
    const windowMs = this.store.settings.stallWindowMs;
    let changed = false;
    for (const [, obs] of this._observed) {
      // WP-52. A `PostToolUse` that never arrives — the runtime was killed
      // mid-tool, the hook was blocked, the machine slept — would otherwise
      // leave "Bash npm test" hanging over a head forever. Past the stall
      // window the bubble is no longer evidence of anything, so it goes.
      // This runs before the hook/liveness guards below on purpose: a stale
      // claim about what a session is doing must expire on the degraded path
      // too, not only where the accurate path is still delivering.
      if (obs.currentTool && now - obs.currentTool.since > windowMs) {
        obs.currentTool = null;
        changed = true;
      }
      if (!this._hooksInstalled(obs.runtime)) continue;
      if (!obs.live) continue;
      if (obs.lastOutputAt == null) continue;
      if (obs.activityState === 'working' && now - obs.lastOutputAt > windowMs) {
        obs.activityState = 'stalled';
        changed = true;
      } else if (obs.activityState === 'stalled' && now - obs.lastOutputAt <= windowMs) {
        obs.activityState = 'working';
        changed = true;
      }
    }
    if (changed) {
      this._rebuild();
      this._emitIfChanged();
    }
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

  /**
   * @param {string} id
   * @param {number} ts
   */
  _markForReview(id, ts) {
    const rec = this.store.getAck(id);
    if (!rec || rec.reviewSince == null) {
      this.store.setAck(id, { reviewSince: ts });
    }
  }

  /**
   * @param {string} id
   * @param {number} ts
   */
  _markNeedsInput(id, ts) {
    const rec = this.store.getAck(id);
    if (!rec || rec.needsInputSince == null) {
      this.store.setAck(id, { needsInputSince: ts });
    }
  }

  /**
   * @param {string} id
   * @param {string} runtime
   * @param {string} [cwd]
   */
  _ensureObserved(id, runtime, cwd) {
    let obs = this._observed.get(id);
    if (!obs) {
      const ackRec = this.store.getAck(id);
      obs = freshObserved(runtime);
      // Bootstrap from a persisted reviewSince/needsInputSince: either
      // first-run seeding or an agent that was already for_review or
      // needs_input when the daemon last stopped. Never invented, only
      // restored — the record already existed. for_review wins if somehow
      // both are set, since it is the more specific, terminal state.
      if (ackRec && ackRec.reviewSince != null) {
        obs.activityState = 'for_review';
      } else if (ackRec && ackRec.needsInputSince != null) {
        obs.activityState = 'needs_input';
      }
      if (cwd) {
        obs.cwd = cwd;
        obs.projectId = projectIdFromCwd(cwd);
        obs.projectName = projectNameFromCwd(cwd);
      }
      this._observed.set(id, obs);
    }
    return obs;
  }

  /** @param {string} runtime */
  _fallbackTitle(runtime, sessionId) {
    const adapter = this.adapters.find((a) => a.id === runtime);
    return (adapter && adapter.label) || String(sessionId).slice(0, 8) || runtime;
  }

  _rebuild() {
    const previous = this._agents;
    const agents = this._computeAgents();
    const key = JSON.stringify(agents);
    if (key !== this._lastKey) {
      this._lastKey = key;
      this._changed = true;
    }
    this._agents = agents;
    // Last, and on the already-assigned result. See the module header.
    this._noteLedger(previous, agents);
  }

  /**
   * Hand one ledger record over, and let nothing that happens to it matter.
   * @param {string} kind
   * @param {Record<string, any>} fields
   */
  _ledger(kind, fields) {
    if (!this.ledger) return;
    try {
      this.ledger.record(/** @type {any} */ (kind), fields);
    } catch (err) {
      // `record()` is documented not to throw; if a future one does, the
      // state machine is still not the place it takes anything down.
      this.log.debug('ledger record failed', err);
    }
  }

  /**
   * Write down what changed between two computed agent lists.
   *
   * Pure comparison of two plain arrays. Reads no store field and writes no
   * store field — see the module header, and the `INVARIANT:` test.
   *
   * @param {Agent[]} prev
   * @param {Agent[]} next
   */
  _noteLedger(prev, next) {
    if (!this.ledger) return;
    try {
      /** @type {Map<string, Agent>} */
      const before = new Map();
      for (const a of prev) before.set(a.id, a);

      for (const a of next) {
        const projectKey = projectKeyFor(a.cwd);
        const base = { sessionId: a.id, projectKey };
        const was = before.get(a.id);

        // One carry-over snapshot per session per local day, whether the
        // session is new to this process or the file simply rolled over at
        // midnight. `since` is what keeps an episode measurable across the
        // roll; the header of ledger.mjs has the reasoning.
        if (this.ledger.markSeen(a.id)) {
          this._ledger('session', {
            ...base,
            event: 'first_seen',
            activity: a.activityState,
            ack: a.ackState,
            since: a.reviewSince ?? a.needsInputSince ?? a.lastActivityAt ?? null,
          });
        }

        if (was && was.activityState !== a.activityState) {
          this._ledger('state', {
            ...base,
            dim: 'activity',
            from: was.activityState,
            to: a.activityState,
          });
        }
        if (was && was.ackState !== a.ackState) {
          this._ledger('state', { ...base, dim: 'ack', from: was.ackState, to: a.ackState });
        }
        const prevTokens = was ? was.tokens || 0 : 0;
        if ((a.tokens || 0) !== prevTokens) {
          this._ledger('tokens', {
            ...base,
            delta: (a.tokens || 0) - prevTokens,
            tokens: a.tokens || 0,
            cacheDelta: (a.cacheTokens || 0) - (was ? was.cacheTokens || 0 : 0),
            cacheTokens: a.cacheTokens || 0,
          });
        }
      }
    } catch (err) {
      this.log.debug('ledger diff failed', err);
    }
  }

  /**
   * A turn was sent to this session from DeckHQ. Called by `POST /api/send`
   * after the adapter accepted it. Observational as far as this class is
   * concerned: it records, and changes nothing.
   * A send the adapter refused is not a send: recording one would inflate
   * "sends per day" with the user's failures, which is the one direction a
   * measurement of your own work must not lean.
   *
   * @param {string} id
   * @param {{chars?:number, ok?:boolean}} [info]
   */
  noteSent(id, info = {}) {
    if (info.ok === false) return;
    const agent = this._agents.find((a) => a.id === id);
    this._ledger('send', {
      sessionId: id,
      projectKey: projectKeyFor(agent ? agent.cwd : ''),
      chars: Number(info.chars) || 0,
    });
  }

  _computeAgents() {
    /** @type {Map<string, SessionSummary>} */
    const summaryMap = new Map();
    for (const s of this._lastSummaries) summaryMap.set(toAgentId(s.runtime, s.id), s);

    /** @type {Map<string, LiveSession>} */
    const liveMap = new Map();
    for (const l of this._lastLive) liveMap.set(toAgentId(l.runtime, l.id), l);

    const ids = new Set([...summaryMap.keys(), ...liveMap.keys()]);

    /** @type {Agent[]} */
    const agents = [];

    for (const id of ids) {
      const summary = summaryMap.get(id);
      const liveSession = liveMap.get(id);
      const polledLive = liveMap.has(id);
      const runtime = summary?.runtime ?? liveSession?.runtime ?? splitAgentId(id).runtime;

      const obs = this._ensureObserved(id, runtime, summary?.cwd ?? liveSession?.cwd);
      obs.runtime = runtime;

      if (summary) {
        obs.title = summary.title;
        obs.hasCustomTitle = !!summary.hasCustomTitle;
        obs.cwd = summary.cwd;
        obs.projectId = projectIdFromCwd(summary.cwd);
        obs.projectName = projectNameFromCwd(summary.cwd);
        obs.gitBranch = summary.gitBranch ?? null;
        obs.model = summary.model ?? null;
        obs.tokens = summary.tokens || 0;
        obs.cacheTokens = summary.cacheTokens || 0;
        obs.costEstimate = summary.costEstimate || 0;
        obs.lastRole = summary.lastRole ?? null;
        obs.turnEnded = summary.turnEnded === true;
        obs.lastText = clampText(summary.lastText);
        obs.lastActivityAt = Math.max(obs.lastActivityAt || 0, summary.lastActivityAt || 0);
      } else if (liveSession) {
        obs.title = obs.title || liveSession.name || '';
        obs.lastActivityAt = Math.max(obs.lastActivityAt || 0, liveSession.startedAt || 0);
      }

      const hooksOn = this._hooksInstalled(runtime);

      // Liveness: once a hook lifecycle event has fired for this session,
      // it is authoritative (the "accurate path"). Until then, fall back to
      // the poll-reported liveness.
      const live = hooksOn && obs.hookLive != null ? obs.hookLive : polledLive;
      obs.live = live;

      if (hooksOn) {
        if (!live) {
          obs.activityState = endedOr(obs.activityState);
        } else if (obs.activityState === 'ended') {
          obs.activityState = 'working';
        }
        // otherwise: keep whatever a hook (or tick) last observed.
      } else {
        // Degraded/poll path — docs/02-ARCHITECTURE.md §4.2. needs_input and
        // stalled are never invented here.
        if (live) {
          // An agent goes to the manager only when its turn has actually
          // ENDED. "Assistant spoke last" is true for the whole of a running
          // tool call (the narration before a `tool_use` is the last text in
          // the file until the tool returns) and again while the model is
          // generating its reply to a tool result — so that test on its own
          // sent hard-at-work agents to the review queue.
          const next = obs.turnEnded === true ? 'for_review' : 'working';
          if (next === 'working' && obs.activityState === 'for_review') {
            // The degraded-path equivalent of the UserPromptSubmit exception
            // above: with no hooks, a new user turn appended to the
            // transcript is the only signal available that the user has
            // already engaged this session again, superseding the pending
            // review. Clear it the same way, rather than leaving reviewSince
            // stale in the store while activityState moves on without it.
            this.store.setAck(id, { reviewSince: null, needsInputSince: null });
          }
          obs.activityState = next;
        } else {
          obs.activityState = endedOr(obs.activityState);
        }
      }

      if (obs.activityState === 'for_review') {
        this._markForReview(id, obs.lastActivityAt || Date.now());
      }

      const ack = this.store.getAck(id) || {
        state: 'active',
        reviewSince: null,
        needsInputSince: null,
        updatedAt: 0,
      };

      /** @type {Agent} */
      const agent = {
        id,
        runtime: /** @type {any} */ (runtime),
        title: obs.title || this._fallbackTitle(runtime, splitAgentId(id).sessionId),
        hasCustomTitle: obs.hasCustomTitle,
        projectId: obs.projectId || 'unknown',
        projectName: obs.projectName || 'unknown',
        cwd: obs.cwd || '',
        gitBranch: obs.gitBranch,
        model: obs.model,
        live,
        activityState: obs.activityState,
        ackState: ack.state,
        reviewSince: ack.reviewSince,
        needsInputSince: ack.needsInputSince,
        lastOutputAt: obs.lastOutputAt,
        lastActivityAt: obs.lastActivityAt,
        tokens: obs.tokens,
        cacheTokens: obs.cacheTokens,
        costEstimate: obs.costEstimate,
        lastRole: obs.lastRole,
        lastText: obs.lastText,
        // WP-52. A copy, not the live record: a snapshot handed to a
        // subscriber must not be a handle on registry state.
        currentTool: obs.currentTool ? { ...obs.currentTool } : null,
        // WP-19. Same discipline: a copy, and null for every session that has
        // no prompt waiting — which is nearly all of them, nearly always.
        pendingPermission: this._pendingPermissions.has(id)
          ? { ...this._pendingPermissions.get(id) }
          : null,
      };
      agents.push(agent);
    }

    agents.sort(compareAgents);
    return agents;
  }

  /**
   * Push a snapshot now, for a change that alters only how agents are
   * PRESENTED — a display name, an avatar. There is no observed state to
   * re-derive and no scan to run, so this must not be a refresh.
   */
  emitNow() {
    this._changed = true;
    this._emitIfChanged();
  }

  _emitIfChanged() {
    if (!this._changed) return;
    this._changed = false;
    const snap = this.snapshot();
    for (const fn of this._subscribers) {
      try {
        fn(snap);
      } catch (err) {
        this.log.error('subscriber threw', err);
      }
    }
  }

  /** Runs a refresh immediately, then on the poll interval, plus a 1s tick. */
  async start() {
    await this.store.load();
    await this.refresh();
    const pollIntervalMs = this.store.settings.pollIntervalMs || 5000;
    this._pollTimer = setInterval(() => {
      this.refresh().catch((err) => this.log.error('scheduled refresh failed', err));
    }, pollIntervalMs);
    if (typeof this._pollTimer.unref === 'function') this._pollTimer.unref();

    this._tickTimer = setInterval(() => {
      try {
        this.tick(Date.now());
      } catch (err) {
        this.log.error('tick failed', err);
      }
    }, TICK_INTERVAL_MS);
    if (typeof this._tickTimer.unref === 'function') this._tickTimer.unref();
  }

  stop() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  }
}

/**
 * Legality per docs/02-ARCHITECTURE.md §5.1. "Any active state" means
 * ackState === 'active' regardless of activityState.
 * @type {Record<string, (agent: Agent) => boolean>}
 */
const LEGAL_FROM = {
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
