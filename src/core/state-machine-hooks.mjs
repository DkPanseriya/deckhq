/**
 * One hook event, applied (WP-22 follow-up).
 *
 * Split out of `state-machine.mjs` unchanged. This is the file the three
 * documented departures from the §4.1/§4.2 tables live in, and the header of
 * `state-machine.mjs` states each one: `SessionEnd` and `SessionStart` are
 * guarded by `endedOr` so a restart or a process death cannot walk a
 * `for_review` item out of the office, and `UserPromptSubmit` is the one
 * hook event that MAY clear `reviewSince` — because it fires when the user
 * typed into this exact session, which is first-person action rather than
 * passive observation.
 */

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

import { RegistryScan } from './state-machine-scan.mjs';
import { toAgentId, endedOr } from './state-machine-rules.mjs';

export class RegistryHooks extends RegistryScan {
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

    // WP-16. Any event that is evidence the session is still going clears the
    // goodbye; `Stop` and `SessionEnd` set it below. Done once, here, so a
    // future hook event cannot forget to — the failure mode is a spurious
    // "stopped mid-task" toast, which is exactly the interruption §6 budgets
    // against. An event this build does not recognise counts as evidence of
    // life too: something is running to have sent it.
    if (event.hookEvent !== 'Stop' && event.hookEvent !== 'SessionEnd') {
      obs.closedCleanly = false;
    }

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
        obs.closedCleanly = true;
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
        // WP-41. The event fires on the PARENT's session id — that is why
        // §89's bubbles attribute a junior's tools to its parent — so the
        // only thing that can say WHICH junior finished is the payload, and
        // only the runtime's own adapter is allowed to read that
        // (standing rule 8). `event.subagent` is null whenever the payload
        // names none, and then this event does exactly what it did before
        // this package: it moves the parent's stall clock and nothing else.
        //
        // Note what is NOT here. No `activityState`, no `ackState`, no
        // `reviewSince`, on either the parent or the junior. A junior leaving
        // is the runtime tidying up after itself; it is not a thing that
        // happened to the user.
        if (event.subagent && event.subagent.agentId) {
          this._stoppedJuniors.add(toAgentId(runtime, event.subagent.agentId));
        }
        break;

      case 'SessionEnd':
        obs.hookLive = false;
        obs.activityState = endedOr(obs.activityState);
        obs.currentTool = null;
        // The user closed their own session. Their action, not an accident —
        // so nothing interrupts them about it (WP-16).
        obs.closedCleanly = true;
        break;

      default:
        this.log.debug(`ignoring unknown hook event: ${event.hookEvent}`);
        return;
    }

    this._rebuild();
    this._emitIfChanged();
  }
}
