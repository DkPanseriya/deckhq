/**
 * In-flight sends, and the events they produce.
 *
 * WP-09. `POST /api/send` used to hold the socket open for the whole turn —
 * up to ten minutes — and answer once. It now answers 202 with a send id and
 * the turn's progress arrives over the SSE channel the page is already on.
 * This is the bit in between: the route publishes here, `GET /api/events`
 * subscribes here, and the daemon's `close()` calls `shutdown()`.
 *
 * Deliberately format-blind. Everything that reaches `publish()` has already
 * been through the runtime's own adapter and is in DeckHQ's vocabulary
 * (src/adapters/claude-code/stream.mjs); nothing in `src/core/` may know what
 * a Claude Code event looks like (docs/02-ARCHITECTURE.md §2).
 *
 * It owns no user state and touches none. A send is an explicit user action,
 * so it may move OBSERVED state — the registry records it — but nothing here
 * writes anything at all.
 */

/**
 * How many finished sends are remembered, so a page that connects a moment
 * after a turn finished can still be told how it ended rather than waiting on
 * a reply that already arrived. Small on purpose: this is a hand-off window,
 * not a log. The ledger is where sends are recorded (WP-17).
 */
const RECENT_LIMIT = 20;

/** Monotonic within one daemon; the id is opaque to the client. */
let counter = 0;

export class SendHub {
  /**
   * @param {{log?:{debug:Function, warn:Function}}} [opts]
   */
  constructor({ log } = {}) {
    this.log = log || { debug() {}, warn() {} };
    /** @type {Set<(event:any)=>void>} */
    this._subscribers = new Set();
    /** @type {Map<string, {id:string, agentId:string, controller:AbortController, startedAt:number}>} */
    this._live = new Map();
    /** @type {any[]} */
    this._recent = [];
    this._closed = false;
  }

  /**
   * Listen to every send event from now on. The returned function
   * unsubscribes and is safe to call twice.
   * @param {(event:any)=>void} fn
   */
  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }

  /** The last few finished sends, oldest first. Copied out. */
  recent() {
    return this._recent.map((e) => ({ ...e }));
  }

  /** Send ids currently running. */
  liveIds() {
    return [...this._live.keys()];
  }

  /**
   * Start tracking a turn. Returns the id the route hands the browser and
   * the signal the adapter's child is bound to.
   * @param {{agentId:string}} info
   * @returns {{sendId:string, signal:AbortSignal}}
   */
  begin({ agentId }) {
    const sendId = `s${++counter}`;
    const controller = new AbortController();
    this._live.set(sendId, { id: sendId, agentId, controller, startedAt: Date.now() });
    return { sendId, signal: controller.signal };
  }

  /**
   * Publish one event for a send. `phase` is the client-facing name; the
   * adapter's own event `type` is carried through unchanged beside it.
   * @param {string} sendId
   * @param {any} event one of the neutral adapter events, or `{type:'error'}`
   */
  publish(sendId, event) {
    const entry = this._live.get(sendId);
    const payload = {
      ...event,
      sendId,
      agentId: entry ? entry.agentId : (event && event.agentId) || null,
    };
    if (payload.type === 'result' || payload.type === 'error') {
      this._recent.push(payload);
      if (this._recent.length > RECENT_LIMIT) this._recent.shift();
    }
    for (const fn of this._subscribers) {
      try {
        fn(payload);
      } catch (err) {
        this.log.debug('send subscriber threw', err);
      }
    }
  }

  /**
   * The turn is over, however it ended. Drops the abort controller so a later
   * `shutdown()` has nothing to cancel.
   * @param {string} sendId
   */
  end(sendId) {
    this._live.delete(sendId);
  }

  /**
   * Cancel every running send. Called by the daemon's `close()` BEFORE the
   * server stops, so each adapter gets the chance to kill its child while
   * this process is still alive to do it.
   *
   * What this can and cannot promise, stated plainly: the children are
   * spawned with `detached: false`, so a graceful shutdown kills them here,
   * and an interrupt in the terminal the daemon runs in reaches them through
   * the shared process group. A `SIGKILL` of the daemon itself runs no
   * JavaScript at all, on any platform, and a child of a hard-killed parent
   * is reparented rather than reaped. That case is not closed by this and is
   * not claimed to be (docs/DEVIATIONS.md §115).
   */
  shutdown() {
    if (this._closed) return;
    this._closed = true;
    for (const [sendId, entry] of this._live) {
      try {
        entry.controller.abort();
      } catch (err) {
        this.log.debug('aborting send failed', sendId, err);
      }
    }
    this._live.clear();
    this._subscribers.clear();
  }
}
