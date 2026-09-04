/**
 * The Registry's instance shape, declared once (WP-22 follow-up).
 *
 * `state-machine.mjs` was 1,517 lines and its class was 1,206 of them.
 * Splitting the class into a chain of base classes — each holding the class
 * body's own lines, character for character — needs the fields declared
 * somewhere every link can see them, because the constructor that assigns
 * them is in the last link.
 *
 * So they are declared here and assigned exactly where they always were. A
 * field declaration with no initialiser is `undefined` until the constructor
 * runs, which is what "not yet assigned" already meant.
 *
 * It is also the only written-down list of what a Registry holds. Note which
 * half is which: `store` is the user-owned ack state, `_observed` is
 * everything the runtimes reported, and the invariant in
 * `state-machine.mjs`'s header is the rule about which may move the other.
 */
export class RegistryBase {
  /** @type {any} */ // the persisted ack map and settings
  store;
  /** @type {any} */ // the runtime adapters this registry merges
  adapters;
  /** @type {any} */ // the name and avatar pool
  identity;
  /** @type {any} */ // WP-17s measurement sink, or null
  ledger;
  /** @type {any} */
  log;
  /** @type {any} */ // the last computed Agent[]
  _agents;
  /** @type {any} */ // per-session observed state, the half no user owns
  _observed;
  /** @type {any} */ // the per-project boards
  _dashboards;
  /** @type {any} */ // snapshot listeners
  _subscribers;
  /** @type {any} */ // what the last hook install reported
  _hookStatus;
  /** @type {any} */ // per-runtime hook health
  _hookHealth;
  /** @type {Record<string, string|null>} */ // WP-23a: what each last scan could NOT read
  _readLimits;
  /** @type {any} */ // WP-19's open questions, by session
  _pendingPermissions;
  /** @type {any} */ // WP-41 juniors seen to have stopped
  _stoppedJuniors;
  /** @type {any} */ // the previous liveness roster
  _lastLive;
  /** @type {any} */ // the previous scan
  _lastSummaries;
  /** @type {string|null} */ // the snapshot signature last emitted
  _lastKey;
  /** @type {number|null} */ // when the last scan finished
  _scannedAt;
  /** @type {number} */ // when this registry started
  _startedAt;
  /** @type {boolean} */ // whether anything moved since the last emit
  _changed;
  /** @type {any} */ // the in-flight refresh promise, or null
  _refreshing;
  /** @type {boolean} */ // and another was asked for while it was
  _refreshPending;
  /** @type {any} */
  _pollTimer;
  /** @type {any} */
  _tickTimer;
}
