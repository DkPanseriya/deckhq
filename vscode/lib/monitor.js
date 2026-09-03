/**
 * The extension's model of the daemon: is one up, on which port, and what does
 * it say is waiting.
 *
 * One object owns all of it so that the status bar, the panel and the four
 * commands read the same answer rather than each going and asking. It does not
 * require `vscode`, which is what lets the repository's own `node --test`
 * suite drive it with fakes.
 *
 * **How the count stays current.** The daemon pushes a whole snapshot on every
 * change over `/api/events`, and that is the primary source: the number in the
 * status bar moves the moment an agent's turn ends, not up to five seconds
 * later. A 5 s timer runs alongside it and does three jobs — it finds a daemon
 * when none is connected, it refreshes the counts when the stream is not open
 * (the documented fallback), and it notices a daemon that went away. Neither
 * path writes anything: the status bar cannot discharge a debt by displaying
 * it, the same rule `deckhq statusline` holds itself to.
 */
const { findDaemon, getJson, subscribe } = require('./loopback');

/** The fallback poll, and the daemon's own default poll interval. */
const POLL_MS = 5000;

/** How long a discovery sweep of the loopback range may take. */
const DISCOVER_TIMEOUT_MS = 1000;

/** How long to keep looking for a daemon we just spawned before giving up. */
const START_TIMEOUT_MS = 90_000;

class Monitor {
  /**
   * @param {{
   *   port?: () => number|null,
   *   onChange?: (state:any) => void,
   *   log?: (message:string) => void,
   *   find?: typeof findDaemon,
   *   ask?: typeof getJson,
   *   sse?: typeof subscribe,
   *   setTimer?: (fn:() => void, ms:number) => any,
   *   clearTimer?: (handle:any) => void,
   * }} [deps]
   */
  constructor(deps = {}) {
    this.deps = deps;
    this.port = deps.port || (() => null);
    this.onChange = deps.onChange || (() => {});
    this.log = deps.log || (() => {});
    this.find = deps.find || findDaemon;
    this.ask = deps.ask || getJson;
    this.sse = deps.sse || subscribe;
    this.setTimer = deps.setTimer || ((fn, ms) => setInterval(fn, ms));
    this.clearTimer = deps.clearTimer || ((handle) => clearInterval(handle));

    /** @type {'off'|'starting'|'connected'} */
    this.status = 'off';
    /** @type {number|null} */
    this.connectedPort = null;
    /** @type {any} */
    this.snapshot = null;
    /** @type {any} */
    this.counts = null;
    /** @type {{dispose:() => void}|null} */
    this.stream = null;
    this.streamOpen = false;
    this.timer = null;
    this.disposed = false;
    this.ticking = false;
  }

  /** What every surface reads. */
  get state() {
    return {
      status: this.status,
      port: this.connectedPort,
      counts: this.counts,
      snapshot: this.snapshot,
    };
  }

  /** @param {'off'|'starting'|'connected'} status */
  _set(status, port, snapshot) {
    const before = `${this.status}:${this.connectedPort}:${JSON.stringify(this.counts)}`;
    this.status = status;
    this.connectedPort = port == null ? null : port;
    if (snapshot !== undefined) {
      this.snapshot = snapshot;
      this.counts = snapshot ? snapshot.counts : null;
    }
    if (status !== 'connected') {
      this.snapshot = null;
      this.counts = null;
    }
    const after = `${this.status}:${this.connectedPort}:${JSON.stringify(this.counts)}`;
    if (before !== after) this.onChange(this.state);
  }

  /** Begin discovery and start the 5 s timer. */
  async start() {
    if (this.disposed) return;
    if (!this.timer) this.timer = this.setTimer(() => this.tick(), POLL_MS);
    await this.tick();
  }

  /**
   * One turn of the loop:
   *   - not connected → look for a daemon on the loopback range;
   *   - connected with no stream → poll `/api/state` (the fallback);
   *   - connected with a stream → nothing to do; the stream is the source.
   */
  async tick() {
    if (this.disposed || this.ticking) return;
    this.ticking = true;
    try {
      if (this.status !== 'connected') {
        const found = await this.find({
          port: this.port(),
          timeoutMs: DISCOVER_TIMEOUT_MS,
        });
        if (this.disposed) return;
        if (found) this._attach(found.port, found.snapshot);
        else if (this.status !== 'starting') this._set('off', null, null);
        return;
      }
      if (this.streamOpen) return;
      const snapshot = await this.ask(this.connectedPort, '/api/state', DISCOVER_TIMEOUT_MS);
      if (this.disposed) return;
      if (snapshot && Array.isArray(snapshot.agents) && snapshot.counts) {
        this._set('connected', this.connectedPort, snapshot);
      } else {
        this._detach();
        this._set('off', null, null);
      }
    } finally {
      this.ticking = false;
    }
  }

  /** @param {number} port @param {any} snapshot */
  _attach(port, snapshot) {
    this._detach();
    this._set('connected', port, snapshot);
    this.log(`connected to DeckHQ on 127.0.0.1:${port}`);
    this.stream = this.sse({
      port,
      onSnapshot: (next) => {
        this.streamOpen = true;
        if (this.status === 'connected' && this.connectedPort === port) {
          this._set('connected', port, next);
        }
      },
      onClose: () => {
        this.streamOpen = false;
        if (this.disposed) return;
        // Do not declare the daemon gone here: an SSE stream can be dropped by
        // a sleeping machine while the daemon is perfectly healthy. The next
        // tick polls `/api/state`, and that is what decides.
        this.log('event stream closed; falling back to the 5 s poll');
        this.stream = null;
      },
    });
  }

  _detach() {
    this.streamOpen = false;
    if (this.stream) {
      const stream = this.stream;
      this.stream = null;
      stream.dispose();
    }
  }

  /**
   * Wait for a daemon to appear, for as long as a cold `npx` plausibly takes.
   * @param {number} [timeoutMs]
   * @returns {Promise<number|null>} the port, or null
   */
  async waitForDaemon(timeoutMs = START_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (!this.disposed && Date.now() < deadline) {
      const found = await this.find({ port: this.port(), timeoutMs: DISCOVER_TIMEOUT_MS });
      if (found) {
        this._attach(found.port, found.snapshot);
        return found.port;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return null;
  }

  /** Announce that a daemon is being started, before it answers. */
  starting() {
    if (this.status !== 'connected') this._set('starting', null, null);
  }

  /** Forget the daemon: drop the stream and report nothing listening. */
  markOff() {
    this._detach();
    this._set('off', null, null);
  }

  dispose() {
    this.disposed = true;
    this._detach();
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
  }
}

module.exports = { Monitor, POLL_MS, DISCOVER_TIMEOUT_MS, START_TIMEOUT_MS };
