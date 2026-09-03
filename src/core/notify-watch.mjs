/**
 * The interruption budget, spent — WP-16.
 *
 * `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §6 puts a number on what an
 * interruption costs (about 23 minutes of refocus) and then names exactly two
 * events worth one:
 *
 *   | a session raises its hand (`needs_input`) | OS notification |
 *   | a session dies unexpectedly while working | OS notification |
 *   | a session finishes a turn (`for_review`)  | **badge only**  |
 *   | stalled                                    | **badge only**  |
 *   | everything else                            | nothing         |
 *
 * That table is this file. `for_review` and `stalled` are deliberately absent
 * from `NOTIFYING_ENTRY` and `test/unit/notify.test.mjs` asserts their absence
 * rather than trusting the omission — they are the two states most likely to
 * be added back by someone who thinks more notification is more product.
 *
 * WHAT "DIED UNEXPECTEDLY" MEANS HERE. The process is gone and the runtime
 * never said goodbye: no `Stop` (which would have left the session
 * `for_review`, and `for_review` survives death by design — see
 * `state-machine.mjs`'s `endedOr`) and no `SessionEnd` (which is the user
 * closing their own session, their action, not an event to interrupt them
 * about). `Registry.wasClosedCleanly()` reports that; on a machine with no
 * hooks installed it is always false, and the signal reduces to the only one
 * the degraded path has — a live session whose transcript's last turn had not
 * ended, now not live. See `docs/DEVIATIONS.md` §101 for what that costs.
 *
 * NOTHING IN HERE TOUCHES STATE. It reads snapshots and spawns a notifier.
 * The invariant (`docs/01-PRODUCT.md` §2) is not at risk from this file, and
 * must never become so: a notification is an observation about the floor, and
 * observations do not move user-owned state.
 */

import { oneLine, sendNotification } from './notify.mjs';

/** @typedef {import('./store.mjs').Timers} Timers */

/**
 * One notification per window, however many sessions moved inside it. The
 * client has used the same 10 s window since WP-15 and the two surfaces must
 * not disagree about what "one notification" means.
 */
export const COALESCE_WINDOW_MS = 10_000;

/**
 * Activity states whose *entry* is worth interrupting for, and the setting
 * that governs each. `for_review` and `stalled` are not here, and that is the
 * whole point of the file.
 */
export const NOTIFYING_ENTRY = Object.freeze({
  needs_input: 'notifyHandsUp',
});

/**
 * States a session can die *out of* and have it mean something went wrong.
 * A session that dies out of `for_review` never reaches here — `for_review`
 * is sticky through death — and one that dies out of `needs_input` keeps its
 * raised hand and the notification it already got.
 */
const WORKING_STATES = new Set(['working', 'stalled']);

/**
 * Compose the one line a batch becomes.
 *
 * COPY RULE (`docs/plan/08-PLAN-V2-100X.md` §7, WP-18's acceptance): no
 * second-person fault. The notification says what an agent did — "Ada raised
 * a hand in orbital-api" — never what the reader failed to do. "You left this
 * for six hours" is the shape of message this product refuses to send, and
 * `test/unit/notify.test.mjs` greps every line this function can produce for
 * "you", "your" and "forgot".
 *
 * @param {{kind:'hands_up'|'died', label:string, projectName:string}[]} batch
 * @returns {{title:string, body:string}}
 */
export function composeNotification(batch) {
  if (batch.length === 1) {
    const e = batch[0];
    const where = e.projectName ? ` in ${e.projectName}` : '';
    const body =
      e.kind === 'hands_up'
        ? `${e.label} raised a hand${where}`
        : `${e.label} stopped mid-task${where}`;
    return { title: 'DeckHQ', body: oneLine(body) };
  }
  const n = batch.length;
  const kinds = new Set(batch.map((e) => e.kind));
  let body;
  if (kinds.size === 1 && kinds.has('hands_up')) body = `${n} sessions raised a hand`;
  else if (kinds.size === 1 && kinds.has('died')) body = `${n} sessions stopped mid-task`;
  else body = `${n} sessions are waiting`;
  return { title: 'DeckHQ', body };
}

/**
 * Diff two snapshots and return the events worth an interruption.
 *
 * Pure, and exported for the tests: every transition rule in the table above
 * is asserted against this function directly, with no timers and no spawning.
 *
 * @param {Map<string, {activityState:string, live:boolean}>} previous
 * @param {{agents: any[]}} snapshot
 * @param {{settings?: any, wasClosedCleanly?: (id:string) => boolean}} [ctx]
 * @returns {{kind:'hands_up'|'died', id:string, label:string, projectName:string}[]}
 */
export function interruptingEvents(previous, snapshot, ctx = {}) {
  const settings = ctx.settings || {};
  const wasClosedCleanly = ctx.wasClosedCleanly || (() => false);
  /** @type {{kind:'hands_up'|'died', id:string, label:string, projectName:string}[]} */
  const events = [];

  for (const agent of snapshot.agents || []) {
    // A benched or let-go session is not owed anything. It still shows on the
    // floor; it does not get to ring a bell.
    if (agent.ackState !== 'active') continue;
    const prev = previous.get(agent.id);
    // No previous record means this is the first snapshot this session has
    // appeared in — a daemon that has just started, or a session that has
    // just been discovered. Its state is news to us, not a transition, and a
    // daemon restart must not replay every raised hand on the floor.
    if (!prev) continue;

    const setting = NOTIFYING_ENTRY[agent.activityState];
    if (setting && prev.activityState !== agent.activityState && settings[setting] !== false) {
      events.push({
        kind: 'hands_up',
        id: agent.id,
        // The same label the panel and the client's notification use: the
        // display name if the user gave one, else the MK tag.
        label: label(agent),
        projectName: agent.projectName || '',
      });
      continue;
    }

    const died =
      prev.live === true &&
      agent.live === false &&
      WORKING_STATES.has(prev.activityState) &&
      agent.activityState === 'ended' &&
      !wasClosedCleanly(agent.id);
    if (died) {
      events.push({
        kind: 'died',
        id: agent.id,
        label: label(agent),
        projectName: agent.projectName || '',
      });
    }
  }
  return events;
}

/** @param {any} agent */
function label(agent) {
  return oneLine(agent.label || agent.mk || agent.title || 'A session', 40);
}

/** @param {{agents:any[]}} snapshot */
export function stateIndex(snapshot) {
  return new Map(
    (snapshot.agents || []).map((a) => [
      a.id,
      { activityState: a.activityState, live: a.live === true },
    ]),
  );
}

/**
 * Watch a registry and spend the interruption budget on its behalf.
 *
 * Off unless the daemon was started with `--notify` or the owner has turned
 * `settings.osNotify` on. Both are read at the moment a notification would
 * fire, so flipping the setting takes effect without a restart, and the
 * master `notifications` switch turns this off along with the browser's.
 */
export class NotificationWatcher {
  /**
   * @param {object} opts
   * @param {any} opts.registry
   * @param {any} opts.store
   * @param {boolean} [opts.flag] the daemon's `--notify`
   * @param {any} [opts.log]
   * @param {(o:any) => boolean} [opts.send] injected by the tests
   * @param {NodeJS.Platform|string} [opts.platform]
   * @param {Timers} [opts.timers]
   */
  constructor({ registry, store, flag = false, log, send = sendNotification, platform, timers }) {
    this.registry = registry;
    this.store = store;
    this.flag = flag === true;
    this.log = log;
    this._send = send;
    this._platform = platform;
    this._timers = timers || { setTimeout, clearTimeout };
    /** @type {Map<string, {activityState:string, live:boolean}>} */
    this._previous = new Map();
    /** @type {{kind:'hands_up'|'died', id:string, label:string, projectName:string}[]} */
    this._pending = [];
    this._timer = null;
    this._lastSentAt = 0;
    /** Notifications actually handed to a notifier. Read by the tests. */
    this.sentCount = 0;
    this._unsubscribe = null;
  }

  /** Is the daemon allowed to interrupt at all, right now? */
  get enabled() {
    const settings = this.store.settings || {};
    if (settings.notifications === false) return false;
    return this.flag === true || settings.osNotify === true;
  }

  start() {
    if (this._unsubscribe) return this;
    this._unsubscribe = this.registry.on((snapshot) => this.observe(snapshot));
    // Seed from whatever is already on the floor, so the first snapshot after
    // start is a diff and not a broadcast of the backlog.
    try {
      this._previous = stateIndex(this.registry.snapshot());
    } catch {
      this._previous = new Map();
    }
    return this;
  }

  stop() {
    if (this._unsubscribe) this._unsubscribe();
    this._unsubscribe = null;
    if (this._timer) this._timers.clearTimeout(this._timer);
    this._timer = null;
    this._pending = [];
  }

  /**
   * One snapshot. Always updates the previous-state index — including while
   * notifications are off — so turning them on does not then fire for
   * everything that happened while they were off.
   * @param {{agents:any[]}} snapshot
   */
  observe(snapshot) {
    const events = interruptingEvents(this._previous, snapshot, {
      settings: this.store.settings,
      wasClosedCleanly: (id) => this.registry.wasClosedCleanly?.(id) === true,
    });
    this._previous = stateIndex(snapshot);
    if (events.length === 0) return;
    if (!this.enabled) return;
    this._queue(events);
  }

  /** @param {any[]} events */
  _queue(events) {
    // One entry per session per window: a session that flaps does not get to
    // buy extra room in the batch.
    for (const e of events) {
      if (!this._pending.some((p) => p.id === e.id && p.kind === e.kind)) this._pending.push(e);
    }
    const elapsed = Date.now() - this._lastSentAt;
    if (elapsed >= COALESCE_WINDOW_MS) {
      this.flush();
    } else if (!this._timer) {
      this._timer = this._timers.setTimeout(() => this.flush(), COALESCE_WINDOW_MS - elapsed);
      if (typeof this._timer?.unref === 'function') this._timer.unref();
    }
  }

  /** Send the batch now, as exactly one notification. */
  flush() {
    if (this._timer) this._timers.clearTimeout(this._timer);
    this._timer = null;
    if (this._pending.length === 0) return;
    const batch = this._pending;
    this._pending = [];
    this._lastSentAt = Date.now();
    if (!this.enabled) return;
    const { title, body } = composeNotification(batch);
    try {
      const launched = this._send({ title, body, platform: this._platform });
      if (launched) this.sentCount += 1;
      else this.log?.debug?.('no OS notifier on this platform; the badge carries it');
    } catch (err) {
      // A notifier that cannot be launched is not a daemon problem.
      this.log?.debug?.('notification suppressed', err);
    }
  }
}

/**
 * @param {ConstructorParameters<typeof NotificationWatcher>[0]} opts
 * @returns {NotificationWatcher}
 */
export function createNotificationWatcher(opts) {
  return new NotificationWatcher(opts).start();
}
