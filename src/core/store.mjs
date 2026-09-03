/**
 * DeckHQ persistence layer. `state.json`, atomic writes, corruption recovery.
 * See docs/02-ARCHITECTURE.md §7 and the orchestrator CONTRACTS.md.
 *
 * No I/O happens outside `load()`, `save()` and `flush()`. Every other method
 * mutates the in-memory copy and schedules a debounced save.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { createLog } from './log.mjs';

/** @typedef {import('./model.mjs').AckState} AckState */

/**
 * @typedef {object} AckRecord
 * @property {AckState} state
 * @property {number|null} reviewSince
 * @property {number|null} needsInputSince
 * @property {number} updatedAt
 */

/**
 * @typedef {'app'|'terminal'} ResumeTarget
 */

/**
 * The two timer functions `save()` and `flush()` use, in the shape of the
 * globals. Anything that returns a handle `clearTimeout` accepts back will do.
 * @typedef {object} Timers
 * @property {(fn: () => void, ms: number) => any} setTimeout
 * @property {(handle: any) => void} clearTimeout
 */

/**
 * Where "resume this session" opens by default. `'app'` may not be
 * installed on every machine; `'terminal'` always works, which is why it is
 * the default rather than a guess at what the user has.
 */
export const RESUME_TARGETS = /** @type {const} */ (['app', 'terminal']);

/**
 * @typedef {object} Settings
 * @property {number} stallWindowMs
 * @property {boolean} notifications
 * @property {boolean} sound
 * @property {number} zoom
 * @property {number} pollIntervalMs
 * @property {boolean} showLetGo
 * @property {ResumeTarget} resumeIn
 */

export const DEFAULT_SETTINGS = Object.freeze({
  stallWindowMs: 600000,
  notifications: true,
  sound: false,
  zoom: 0,
  pollIntervalMs: 5000,
  showLetGo: false,
  resumeIn: 'terminal',
});

/**
 * How long `save()` waits for further mutations before it writes. Exported so
 * the test suite can assert the window it schedules rather than sleep past it.
 */
export const SAVE_DEBOUNCE_MS = 250;
const MIN_STALL_WINDOW_MS = 2 * 60 * 1000;
const MAX_STALL_WINDOW_MS = 120 * 60 * 1000;

/** @param {unknown} v */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** @param {unknown} ms */
function clampStallWindow(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.stallWindowMs;
  return Math.min(MAX_STALL_WINDOW_MS, Math.max(MIN_STALL_WINDOW_MS, n));
}

/**
 * An out-of-set value (a stray string, a stale value from an older build, a
 * hand-edited state.json) falls back to the default rather than being
 * stored as-is — same discipline as `clampStallWindow` above.
 * @param {unknown} v
 * @returns {import('./store.mjs').ResumeTarget}
 */
function sanitizeResumeIn(v) {
  return /** @type {readonly string[]} */ (RESUME_TARGETS).includes(/** @type {string} */ (v))
    ? /** @type {import('./store.mjs').ResumeTarget} */ (v)
    : DEFAULT_SETTINGS.resumeIn;
}

function defaultData() {
  return {
    version: 1,
    seededAt: null,
    settings: { ...DEFAULT_SETTINGS },
    ack: {},
    // MK numbering and user-chosen names. Assigned once and kept forever, so
    // a tag the user has learned never moves. See core/identity.mjs.
    identity: { projects: {}, agents: {}, projectOf: {}, names: {}, nextProject: 1 },
    // Project ids the user has collapsed off the floor. Purely a view
    // preference — it never affects what is captured or what any agent is
    // doing, and an id in here that no longer exists is harmless.
    archivedProjects: {},
  };
}

/**
 * Fill in anything missing from a parsed-but-partial state object. Called
 * only on data that already parsed as a JSON object; genuinely corrupt or
 * mis-shaped top-level data is handled by the caller before this runs.
 * @param {any} parsed
 */
function normalize(parsed) {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(isPlainObject(parsed.settings) ? parsed.settings : {}),
  };
  settings.stallWindowMs = clampStallWindow(settings.stallWindowMs);
  settings.resumeIn = sanitizeResumeIn(settings.resumeIn);
  const ack = isPlainObject(parsed.ack) ? { ...parsed.ack } : {};
  const rawIdentity = isPlainObject(parsed.identity) ? parsed.identity : {};
  const identity = {
    projects: isPlainObject(rawIdentity.projects) ? { ...rawIdentity.projects } : {},
    agents: isPlainObject(rawIdentity.agents) ? { ...rawIdentity.agents } : {},
    projectOf: isPlainObject(rawIdentity.projectOf) ? { ...rawIdentity.projectOf } : {},
    names: isPlainObject(rawIdentity.names) ? { ...rawIdentity.names } : {},
    nextProject: typeof rawIdentity.nextProject === 'number' ? rawIdentity.nextProject : 1,
  };
  const archivedProjects = isPlainObject(parsed.archivedProjects)
    ? { ...parsed.archivedProjects }
    : {};
  return {
    version: 1,
    seededAt: typeof parsed.seededAt === 'number' ? parsed.seededAt : null,
    settings,
    ack,
    identity,
    archivedProjects,
  };
}

export class Store {
  /**
   * @param {string} file absolute path to state.json
   * @param {{log?: import('./log.mjs').Log, timers?: Timers}} [opts]
   */
  constructor(file, opts = {}) {
    this.file = file;
    this._log = opts.log || createLog('store');
    this._data = defaultData();
    /**
     * The clock the debounce is scheduled on. Production uses the real timer
     * wheel; the test suite hands in one it cranks by hand, so proving the
     * debounce never depends on how promptly a loaded CI runner services a
     * 250 ms setTimeout.
     * @type {Timers}
     */
    this._timers = opts.timers || { setTimeout, clearTimeout };
    this._saveTimer = null;
    /** @type {Promise<void>|null} chain of in-flight/queued disk writes, serialized */
    this._writing = null;
    /**
     * The last disk write that failed, or null. Read by the daemon and shown
     * in the interface: a store that cannot write is a store whose
     * acknowledgements vanish on restart, and the user has to be told rather
     * than left to discover it.
     * @type {{file:string, message:string, at:number}|null}
     */
    this.writeError = null;
  }

  /**
   * Load state.json. A corrupt or unparseable file never prevents startup:
   * it is backed up alongside itself and the store starts from defaults.
   * @returns {Promise<void>}
   */
  async load() {
    let raw;
    try {
      raw = await fsp.readFile(this.file, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        this._data = defaultData();
        return;
      }
      this._log.warn(`could not read ${this.file}; starting from defaults`, err);
      this._data = defaultData();
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      await this._backupCorrupt(raw);
      this._log.warn(
        `corrupt state file at ${this.file}; backed up and starting from defaults`,
        err,
      );
      this._data = defaultData();
      return;
    }

    if (!isPlainObject(parsed)) {
      await this._backupCorrupt(raw);
      this._log.warn(
        `state file at ${this.file} has an invalid shape; backed up and starting from defaults`,
      );
      this._data = defaultData();
      return;
    }

    this._data = normalize(parsed);
  }

  /** @param {string} raw */
  async _backupCorrupt(raw) {
    const backupPath = `${this.file}.corrupt-${Date.now()}`;
    try {
      await fsp.writeFile(backupPath, raw, 'utf8');
    } catch (err) {
      this._log.warn(`failed to back up corrupt state file to ${backupPath}`, err);
    }
  }

  /** @returns {Settings} */
  /**
   * The identity block, returned live rather than copied: `Identity` assigns
   * MK numbers into it and calls `touch()` to persist.
   */
  get identity() {
    return this._data.identity;
  }

  /** Mark the state dirty after a direct mutation of a live sub-object. */
  touch() {
    this.save();
  }

  get settings() {
    return { ...this._data.settings };
  }

  /**
   * @param {Partial<Settings>} patch
   * @returns {Settings}
   */
  setSettings(patch) {
    const next = { ...this._data.settings, ...(patch || {}) };
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'stallWindowMs')) {
      next.stallWindowMs = clampStallWindow(patch.stallWindowMs);
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'resumeIn')) {
      next.resumeIn = sanitizeResumeIn(patch.resumeIn);
    }
    this._data.settings = next;
    this.save();
    return this.settings;
  }

  /** @returns {number|null} */
  get seededAt() {
    return this._data.seededAt;
  }

  /** @param {number} ts */
  markSeeded(ts) {
    this._data.seededAt = ts;
    this.save();
  }

  /**
   * @param {string} id
   * @returns {AckRecord|undefined}
   */
  getAck(id) {
    const rec = this._data.ack[id];
    return rec ? { ...rec } : undefined;
  }

  /**
   * @param {string} id
   * @param {Partial<AckRecord>} patch
   * @returns {AckRecord}
   */
  setAck(id, patch) {
    const prev = this._data.ack[id] || {
      state: 'active',
      reviewSince: null,
      needsInputSince: null,
      updatedAt: 0,
    };
    const next = { ...prev, ...(patch || {}), updatedAt: Date.now() };
    this._data.ack[id] = next;
    this.save();
    return { ...next };
  }

  /**
   * Is this project collapsed off the floor?
   * @param {string} projectId
   */
  isProjectArchived(projectId) {
    return this._data.archivedProjects[projectId] === true;
  }

  /**
   * Collapse or restore a project room. Storing `false` would leave a growing
   * record of every project ever restored, so restoring deletes the key.
   * @param {string} projectId
   * @param {boolean} archived
   */
  setProjectArchived(projectId, archived) {
    const id = String(projectId || '');
    if (!id) return;
    if (archived) this._data.archivedProjects[id] = true;
    else delete this._data.archivedProjects[id];
    this.save();
  }

  /** @returns {string[]} */
  archivedProjects() {
    return Object.keys(this._data.archivedProjects);
  }

  /** @returns {Record<string, AckRecord>} */
  allAck() {
    /** @type {Record<string, AckRecord>} */
    const out = {};
    for (const [id, rec] of Object.entries(this._data.ack)) {
      out[id] = { ...rec };
    }
    return out;
  }

  /**
   * Schedule a debounced, atomic write. Safe to call as often as you like;
   * at most one disk write happens per 250ms, always with the freshest
   * in-memory data at the moment it actually runs.
   */
  save() {
    if (this._saveTimer) return;
    this._saveTimer = this._timers.setTimeout(() => {
      this._saveTimer = null;
      this._triggerWrite();
    }, SAVE_DEBOUNCE_MS);
    if (typeof this._saveTimer.unref === 'function') this._saveTimer.unref();
  }

  /** Chain the next write onto any in-flight one so writes never overlap. */
  _triggerWrite() {
    const prior = this._writing || Promise.resolve();
    const p = prior
      .then(() => this._writeNow())
      .then(() => {
        this.writeError = null;
      })
      .catch((err) => {
        // A failed write means every acknowledgement made since the last good
        // one is gone at the next restart — the user-owned half of the model,
        // silently discarded. A log line is not enough: this is surfaced in
        // the interface. See `writeError`.
        this.writeError = {
          file: this.file,
          message: (err && err.message) || String(err),
          at: Date.now(),
        };
        this._log.error(`failed to write ${this.file}`, err);
      })
      .finally(() => {
        if (this._writing === p) this._writing = null;
      });
    this._writing = p;
  }

  /** Atomic write: temp file, then rename. */
  async _writeNow() {
    const tmp = `${this.file}.tmp-${process.pid}`;
    const json = JSON.stringify(this._data, null, 2);
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.writeFile(tmp, json, 'utf8');
    await fsp.rename(tmp, this.file);
  }

  /**
   * Await any pending or in-flight save. The daemon calls this on shutdown
   * so a debounced write is never lost.
   * @returns {Promise<void>}
   */
  async flush() {
    if (this._saveTimer) {
      this._timers.clearTimeout(this._saveTimer);
      this._saveTimer = null;
      this._triggerWrite();
    }
    while (this._writing) {
      await this._writing;
    }
  }
}
