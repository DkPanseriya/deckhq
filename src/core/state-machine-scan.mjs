/**
 * The loop: scan, poll, tick, and the settings writes that ask for a rebuild
 * (WP-22 follow-up).
 *
 * Split out of `state-machine.mjs` unchanged: `refresh` and its coalescing,
 * the archived-project sync, the dashboards, the room order, WP-19's pending
 * permissions, the one-second tick, and start/stop.
 *
 * Every one of these is an OBSERVATION or a setting. None of them may clear
 * `reviewSince`, `needsInputSince` or move `ackState` — only `act()` does
 * that (docs/01-PRODUCT.md §2).
 */

import { seedIfNeeded } from './seed.mjs';
import { discoverActions } from './actions.mjs';
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

import { RegistryCompute } from './state-machine-compute.mjs';
import { SCAN_MAX_AGE_DAYS, SCAN_LIMIT, TICK_INTERVAL_MS } from './state-machine-rules.mjs';

export class RegistryScan extends RegistryCompute {
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
   * The order the floor deals rooms in (WP-30). A view preference on exactly
   * the same terms as `setProjectArchived` above: it moves rooms, it touches
   * no session and it clears nothing.
   * @param {string[]} ids project ids, in floor order
   */
  setRoomOrder(ids) {
    this.store.setRoomOrder(ids);
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
