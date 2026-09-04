/**
 * What the Registry hands out, and where it writes what it saw
 * (WP-22 follow-up).
 *
 * Split out of `state-machine.mjs` unchanged: the agent list, the snapshot
 * the HTTP layer serialises, the degraded-runtime notice, the subscriber
 * list and the two emits — plus the three ledger calls.
 *
 * Every ledger call here is inside a `try` that swallows, and the ledger is
 * write-only from this side: a ledger that is absent, broken, or throwing on
 * every call produces byte-identical agents and byte-identical ack state.
 * `test/unit/ledger-invariant.test.mjs` drives the same script through two
 * registries and diffs both.
 */

import { counts, projects as projectsOf } from './model.mjs';
import { projectKeyFor } from './ledger.mjs';
import { buildDemoSnapshot } from './demo-fixture.mjs';
import { rateCardVersion } from './rates.mjs';

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

import { RegistryBase } from './state-machine-base.mjs';
import { orderRooms, todaySpendFor } from './state-machine-rules.mjs';

export class RegistrySnapshot extends RegistryBase {
  /** @returns {Agent[]} */
  get agents() {
    return this._agents;
  }

  /**
   * The snapshot every surface reads — with one substitution.
   *
   * A machine with nothing on it gets the actors instead of an empty room
   * (WP-13; `docs/plan/05-GUI-UX-SPEC.md` §7). The substitution happens here,
   * at the one place a snapshot is produced, so the SSE stream, the initial
   * `GET /api/state` and every internal subscriber agree — and so the actors
   * cannot leak anywhere else: `this._agents` is still empty, so nothing in
   * `act()`, the store, the identity file or the scan ever sees them.
   *
   * The substitution ends the moment the scan finds anybody, which is what
   * makes "run `claude` and a real one walks in" true within one poll rather
   * than after a reload.
   *
   * @returns {{agents: Agent[], projects: ReturnType<typeof projectsOf>, counts: ReturnType<typeof counts>, settings: import('./store.mjs').Settings, hooks: Record<string,{supported:boolean,installed:boolean}>, degraded: Record<string, boolean|string>, scannedAt: number|null, demo?: boolean, demoNote?: string}}
   */
  snapshot() {
    if (this._agents.length === 0 && this._scannedAt !== null) {
      return buildDemoSnapshot({
        settings: this.store.settings,
        takenNames: this.identity ? this.identity.takenNames() : [],
        hooks: { ...this._hookStatus },
        writeError: this.store.writeError || null,
        scannedAt: this._scannedAt,
      });
    }
    return this._realSnapshot();
  }

  /**
   * The floor as it actually is. Split out of `snapshot()` so the demo
   * substitution above has something to fall through to, and so a test can
   * assert the empty case really is empty underneath.
   * @returns {any}
   */
  _realSnapshot() {
    // WP-41. Two passes, because a junior's tag is its PARENT's tag with a
    // suffix and the parent may sort after it. Seniors first, then the
    // juniors against the records the first pass produced.
    /** @type {Map<string, any>} */
    const described = new Map();
    const agents = this._agents.map((a) => {
      if (!this.identity || a.subagent === true) return a;
      const id = this.identity.describe(a.id, a.projectId);
      described.set(a.id, id);
      return { ...a, ...id };
    });
    if (this.identity) {
      /** How many juniors of each parent have been numbered. @type {Map<string, number>} */
      const seen = new Map();
      // Sorted by id so `MK1.2j1` is the same junior on every push — the same
      // ordering `assignSeats` uses to decide which side of the desk each one
      // stands on.
      const juniors = agents
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => a.subagent === true)
        .sort((x, y) => String(x.a.id).localeCompare(String(y.a.id)));
      for (const { a, i } of juniors) {
        const key = String(a.parentId ?? '');
        const n = (seen.get(key) || 0) + 1;
        seen.set(key, n);
        const id = this.identity.describeJunior(described.get(key) || null, a.projectId, n);
        agents[i] = { ...a, ...id };
      }
    }
    const todayTokens = this.ledger ? this.ledger.todayTokens() : {};
    // WP-30. `roomOrder?.()` because a Registry is routinely constructed over
    // a hand-rolled store stub in the test suite, and a snapshot must not
    // depend on a method whose absence means "no imported layout" anyway.
    const projects = orderRooms(projectsOf(agents), this.store.roomOrder?.() || []).map((p) => {
      // `hasDashboard` decides whether the room gets a screen to click, so it
      // is refreshed by the scan rather than probed per frame.
      const hasDashboard = this._dashboards.has(p.id);
      // A room the user collapsed. An active agent overrules it — see
      // `buildPlan`: the room pops back open on its own rather than hiding
      // somebody who is working.
      const archived = this.store.isProjectArchived(p.id);
      const today = todaySpendFor(p, todayTokens);
      const base = { ...p, hasDashboard, archived, ...today };
      if (!this.identity) return base;
      const projectMk = this.identity.projectMk(p.id);
      return { ...base, projectMk, mk: `MK${projectMk}` };
    });
    return {
      agents,
      projects,
      // The gone-home window reaches `counts` for the same reason it reaches
      // the renderer: `counts.drawn` describes what the floor shows, and what
      // the floor shows depends on it (WP-55).
      counts: counts(agents, { goneHomeDays: this.store.settings.goneHomeDays }),
      settings: this.store.settings,
      takenNames: this.identity ? this.identity.takenNames() : [],
      hooks: { ...this._hookStatus },
      degraded: this._degraded(),
      // A store that cannot write is losing every acknowledgement made since
      // it last succeeded. Carried in the snapshot so the client can say so.
      writeError: this.store.writeError || null,
      // WP-26. Every cost display carries the date of the table it came from,
      // so a figure nobody can check is at least a figure whose source is
      // dated. The floor reads it from here rather than fetching /api/about
      // for a string that is already in every snapshot.
      rateCardVersion: rateCardVersion(),
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
   *
   * **A value may be `true` or a SENTENCE** (WP-23a). `true` is the original
   * meaning and the only one the banner had: state is inferred because no
   * hooks are installed, and the banner's "Install hooks" button is the fix.
   * A string is a specific thing this runtime could not read — today only
   * Codex's compressed rollouts on a Node with no Zstandard
   * (`docs/DEVIATIONS.md` §136.2) — and it is carried whole rather than
   * flattened to a flag, because "some of your sessions are missing" is not a
   * sentence a banner can reconstruct from a boolean. It takes precedence: it
   * names a cause, and hooks would not fix it.
   * @returns {Record<string, boolean|string>}
   */
  _degraded() {
    /** @type {Record<string, boolean|string>} */
    const out = {};
    const inUse = new Set(this._agents.map((a) => a.runtime));
    for (const adapter of this.adapters) {
      if (!inUse.has(adapter.id)) continue;
      const limit = this._readLimits ? this._readLimits[adapter.id] : null;
      if (typeof limit === 'string' && limit) {
        out[adapter.id] = limit;
        continue;
      }
      const status = this._hookStatus[adapter.id];
      if (status && status.supported === false) continue;
      out[adapter.id] = !this._hooksInstalled(adapter.id);
    }
    return out;
  }

  /**
   * @param {(snapshot: ReturnType<import('./state-machine.mjs').Registry['snapshot']>) => void} fn
   * @returns {() => void} unsubscribe
   */
  on(fn) {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
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

  /**
   * WP-16. Did this session's runtime say goodbye before the process went?
   *
   * Read-only, and deliberately NOT part of the snapshot: it answers one
   * question for the OS notifier (`core/notify-watch.mjs`) and it is not a
   * fact about the agent that any surface renders. On a machine with no hooks
   * installed nothing ever sets it, so it reads false and the notifier falls
   * back to the only signal the degraded path has.
   *
   * @param {string} id
   * @returns {boolean}
   */
  wasClosedCleanly(id) {
    return this._observed.get(id)?.closedCleanly === true;
  }

  /**
   * WP-28. What `traits()` needs about one session that only the transcript
   * can say: the model, the tool mix, and the median reply length.
   *
   * A READ, and a copy. It touches no ack state, and it is deliberately not
   * on the snapshot: the trait line is a grace note that at most one surface
   * asks for at a time, and putting four more fields on every agent in every
   * SSE frame would make the whole floor pay for it.
   *
   * @param {string} id
   * @returns {{model:string|null, toolMix:Record<string,number>, textMedian:number,
   *   textTurns:number}|null} null for a session this process has not observed.
   */
  traitInput(id) {
    const obs = this._observed.get(id);
    if (!obs) return null;
    const mix = obs.toolMix || { files: 0, shell: 0, web: 0, search: 0 };
    return {
      model: obs.model ?? null,
      toolMix: { files: mix.files, shell: mix.shell, web: mix.web, search: mix.search },
      textMedian: obs.textMedian || 0,
      textTurns: obs.textTurns || 0,
    };
  }

  /** @param {string} runtime */
  _hooksInstalled(runtime) {
    return !!(this._hookStatus[runtime] && this._hookStatus[runtime].installed);
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
}
