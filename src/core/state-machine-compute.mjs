/**
 * The merge itself (WP-22 follow-up).
 *
 * Split out of `state-machine.mjs` unchanged: `_computeAgents`, which turns
 * scanned sessions, live sessions, persisted ack state and hook events into
 * the `Agent[]` the rest of the product renders, plus the four small writes
 * around it.
 *
 * THE INVARIANT (docs/01-PRODUCT.md §2) is what shapes every branch here: no
 * observed event may clear `reviewSince` or `needsInputSince`, or move
 * `ackState`. `_markForReview` and `_markNeedsInput` only ever SET a
 * timestamp that was absent; nothing in this file clears one.
 */

import { splitAgentId, projectIdFromCwd, projectNameFromCwd, clampText } from './model.mjs';

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

import { RegistrySnapshot } from './state-machine-snapshot.mjs';
import { freshObserved, toAgentId, endedOr, compareAgents } from './state-machine-rules.mjs';

export class RegistryCompute extends RegistrySnapshot {
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

  _computeAgents() {
    /** @type {Map<string, SessionSummary>} */
    const summaryMap = new Map();
    for (const s of this._lastSummaries) summaryMap.set(toAgentId(s.runtime, s.id), s);

    /** @type {Map<string, LiveSession>} */
    const liveMap = new Map();
    for (const l of this._lastLive) liveMap.set(toAgentId(l.runtime, l.id), l);

    const ids = new Set([...summaryMap.keys(), ...liveMap.keys()]);

    // WP-41. Two things about juniors, both decided here so nothing further
    // down has to re-derive them:
    //
    //   1. A junior a `SubagentStop` has already named is gone. It leaves the
    //      floor now rather than when its file stops moving, and its
    //      observation record goes with it — there is no session left to be
    //      the state of.
    //   2. The set is pruned to what this scan actually found, so it holds at
    //      most the juniors currently on disk and never grows.
    if (this._stoppedJuniors.size) {
      for (const id of [...this._stoppedJuniors]) {
        if (!summaryMap.has(id)) this._stoppedJuniors.delete(id);
        else {
          ids.delete(id);
          this._observed.delete(id);
        }
      }
    }

    /** @type {Agent[]} */
    const agents = [];
    /** How many juniors each parent has on the floor. @type {Map<string, number>} */
    const juniorsByParent = new Map();

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
        obs.costEstimate = summary.costEstimate ?? null;
        obs.lastRole = summary.lastRole ?? null;
        obs.turnEnded = summary.turnEnded === true;
        obs.lastText = clampText(summary.lastText);
        obs.lastActivityAt = Math.max(obs.lastActivityAt || 0, summary.lastActivityAt || 0);
      } else if (liveSession) {
        obs.title = obs.title || liveSession.name || '';
        obs.lastActivityAt = Math.max(obs.lastActivityAt || 0, liveSession.startedAt || 0);
      }

      // WP-41. Decided before liveness, because it changes what liveness
      // means. See the `for_review` note below the state derivation.
      const junior = summary ? summary.subagent === true : false;

      const hooksOn = this._hooksInstalled(runtime);

      // Liveness: once a hook lifecycle event has fired for this session,
      // it is authoritative (the "accurate path"). Until then, fall back to
      // the poll-reported liveness.
      //
      // WP-41 — A JUNIOR'S ONLY WITNESS IS ITS OWN FILE. Neither of the two
      // normal sources can see one: every hook event fires on the PARENT's
      // session id (§89), and `claude agents --json` lists sessions, not
      // subagents. So a junior would read `hookLive == null` and
      // `polledLive === false` on every machine that has hooks installed —
      // permanently `ended`, drawn in the finished colour, while it was
      // visibly working. Its transcript is the evidence instead, and the
      // adapter has already applied it: a junior reaches this list only
      // because its own file moved inside `SUBAGENT_IDLE_MS`. So it is live,
      // on both paths, and the shape of its last record says what it is
      // doing — the same rule the degraded path uses for everybody else.
      const live = junior ? true : hooksOn && obs.hookLive != null ? obs.hookLive : polledLive;
      obs.live = live;

      if (junior) {
        obs.activityState = obs.turnEnded === true ? 'ended' : 'working';
      } else if (hooksOn) {
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

      // WP-41. A JUNIOR IS NEVER `for_review`.
      //
      // `for_review` means "this turn ended and it is waiting on you", and it
      // is the one state the product invariant makes sticky — it survives the
      // process dying, and only the user can clear it. None of that is true
      // of a junior: its finished turn is handed to its PARENT, the parent
      // reads it in the same second, and no keystroke of the user's was ever
      // going to discharge it. Left alone, every junior that ever finished
      // would queue in the office for ever with a crimson badge over its head.
      //
      // So a finished junior is `ended`, which is what it is: it stops, and
      // the adapter stops reporting it, and it walks off the floor. Nothing
      // about it reaches `store.setAck` — `_markForReview` WRITES
      // `reviewSince`, a user-owned field, keyed by an id that will never be
      // seen again. The parent's own fields are untouched either way, and the
      // `INVARIANT:` test in `test/unit/subagents.test.mjs` drives a whole
      // junior lifecycle past a parent and deep-compares every one of them.
      //
      // The derivation above already produces `working` or `ended` and never
      // `for_review` for a junior; this catches the one path that reaches
      // around it, `_ensureObserved` restoring a state from a persisted ack.
      // There should be no such record for a junior — nothing ever writes one
      // — and if a hand-edited state file carries one it is ignored here
      // rather than trusted.
      if (junior && obs.activityState === 'for_review') {
        obs.activityState = obs.turnEnded === true ? 'ended' : 'working';
      }
      if (!junior && obs.activityState === 'for_review') {
        this._markForReview(id, obs.lastActivityAt || Date.now());
      }

      // A junior is never benched, never let go and never acknowledged: the
      // interface offers none of those buttons for one (`act()` refuses them
      // outright), so its ack record is a constant rather than a store read.
      // This is also what stops a stale ack from a previous life of the same
      // id — there is no such thing, ids are per spawn — reaching the floor.
      const ack = junior
        ? { state: /** @type {const} */ ('active'), reviewSince: null, needsInputSince: null }
        : this.store.getAck(id) || {
            state: 'active',
            reviewSince: null,
            needsInputSince: null,
            updatedAt: 0,
          };

      const parentId =
        junior && summary && summary.parentSessionId
          ? toAgentId(runtime, summary.parentSessionId)
          : null;
      if (parentId) juniorsByParent.set(parentId, (juniorsByParent.get(parentId) || 0) + 1);

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
        // WP-41. Present on every agent so a consumer never has to ask
        // whether the field exists; `juniorCount` is filled in below, once
        // every junior on this floor has been seen.
        subagent: junior,
        parentId,
        subagentType: junior && summary ? (summary.subagentType ?? null) : null,
        subagentDescription: junior && summary ? (summary.subagentDescription ?? null) : null,
        spawnedAt: junior && summary ? (summary.spawnedAt ?? null) : null,
        juniorCount: 0,
      };
      agents.push(agent);
    }

    // Second pass: a parent cannot know how many juniors it has until every
    // junior has been read, and a junior's parent may sort after it.
    if (juniorsByParent.size) {
      for (const a of agents) {
        const n = juniorsByParent.get(a.id);
        if (n) a.juniorCount = n;
      }
    }

    agents.sort(compareAgents);
    return agents;
  }
}
