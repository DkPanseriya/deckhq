/**
 * DeckHQ persistence layer. `state.json`, atomic writes, corruption recovery.
 * See docs/02-ARCHITECTURE.md §7 and the orchestrator CONTRACTS.md.
 *
 * No I/O happens outside `load()`, `save()` and `flush()`. Every other method
 * mutates the in-memory copy and schedules a debounced save.
 */

import { promises as fsp } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createLog } from './log.mjs';
import { now as clockNow } from './clock.mjs';
import { migrateState, STATE_VERSION } from './state-migrations.mjs';
import {
  DEFAULT_SETTINGS,
  isPlainObject,
  PROJECT_ID_RE,
  sanitizeMachineId,
  sanitizePins,
  sanitizeRoomOrder,
  sanitizeSettings,
  sanitizeStudioConsent,
  sanitizeStudioPlanner,
} from './store-settings.mjs';

// WP-92l. The settings schema and its sanitisers moved to the module above.
// Every importer of `store.mjs` still sees them from here, so the split is
// invisible to the twenty-three files that read this one.
export * from './store-settings.mjs';

/** @typedef {import('./model.mjs').AckState} AckState */
/** @typedef {import('./store-settings.mjs').Settings} Settings */

/**
 * @typedef {object} AckRecord
 * @property {AckState} state
 * @property {number|null} reviewSince
 * @property {number|null} needsInputSince
 * @property {number} updatedAt
 */

/**
 * The two timer functions `save()` and `flush()` use, in the shape of the
 * globals. Anything that returns a handle `clearTimeout` accepts back will do.
 * @typedef {object} Timers
 * @property {(fn: () => void, ms: number) => any} setTimeout
 * @property {(handle: any) => void} clearTimeout
 */

/**
 * How long `save()` waits for further mutations before it writes. Exported so
 * the test suite can assert the window it schedules rather than sleep past it.
 */
export const SAVE_DEBOUNCE_MS = 250;

function defaultData() {
  return {
    // WP-86. A file this build writes is already current, so a machine that has
    // never run DeckHQ migrates nothing — see `core/state-migrations.mjs`
    // rule 4, and the goldens' fixture, which is rebuilt from nothing.
    version: STATE_VERSION,
    // What each versioned pass did, and when: `id → {at, version, ...}`. Empty
    // on a fresh install and on any machine no pass has had anything to do on.
    migrations: {},
    seededAt: null,
    // WP-48. Minted on first use, never sent anywhere. See `get machineId`.
    machineId: null,
    settings: { ...DEFAULT_SETTINGS },
    ack: {},
    // MK numbering and user-chosen names. Assigned once and kept forever, so
    // a tag the user has learned never moves. See core/identity.mjs.
    // `juniors` (audit F6): each parent's junior numbers, `parent id → {next, of}`.
    identity: { projects: {}, agents: {}, projectOf: {}, names: {}, nextProject: 1, juniors: {} },
    // Project ids the user has collapsed off the floor. Purely a view
    // preference — it never affects what is captured or what any agent is
    // doing, and an id in here that no longer exists is harmless.
    archivedProjects: {},
    // WP-77. Project ids the user has PINNED: they keep a room on the floor
    // with nothing running in them, at a third of a live room's footprint.
    // Empty on every install, and only a user action ever writes here — see
    // `sanitizePins`.
    pins: {},
    // WP-30. The order the floor deals rooms in, as project ids. Empty on
    // every install that has never imported a layout, and empty means "the
    // order the scan produced" — which is why an untouched floor is laid out
    // byte for byte as it always was. A view preference like the line above:
    // it moves rooms, it never touches a session.
    layout: { rooms: [] },
    // WP-66. Which projects have granted Studio permission to write inside
    // `<project>/.deckhq/studio/`, and when. Empty on every install: Studio is
    // opt-in per project and disabled is the default everywhere
    // (`docs/07-STUDIO-DESIGN.md` §1). See `sanitizeStudioConsent`.
    // WP-67 adds `planner`, which is empty for the same reason and stays
    // empty until a planner session has been found by the ordinary scan.
    studio: { consent: {}, planner: {} },
  };
}

/**
 * Fill in anything missing from a parsed-but-partial state object. Called
 * only on data that already parsed as a JSON object; genuinely corrupt or
 * mis-shaped top-level data is handled by the caller before this runs.
 * @param {any} parsed
 */
function normalize(parsed) {
  const settings = sanitizeSettings(isPlainObject(parsed.settings) ? parsed.settings : {});
  const ack = isPlainObject(parsed.ack) ? { ...parsed.ack } : {};
  const rawIdentity = isPlainObject(parsed.identity) ? parsed.identity : {};
  const identity = {
    projects: isPlainObject(rawIdentity.projects) ? { ...rawIdentity.projects } : {},
    agents: isPlainObject(rawIdentity.agents) ? { ...rawIdentity.agents } : {},
    projectOf: isPlainObject(rawIdentity.projectOf) ? { ...rawIdentity.projectOf } : {},
    names: isPlainObject(rawIdentity.names) ? { ...rawIdentity.names } : {},
    nextProject: typeof rawIdentity.nextProject === 'number' ? rawIdentity.nextProject : 1,
    juniors: sanitizeJuniorBooks(rawIdentity.juniors),
  };
  const archivedProjects = isPlainObject(parsed.archivedProjects)
    ? { ...parsed.archivedProjects }
    : {};
  const pins = sanitizePins(parsed.pins);
  const layout = {
    rooms: sanitizeRoomOrder(isPlainObject(parsed.layout) ? parsed.layout.rooms : []),
  };
  const studio = {
    consent: sanitizeStudioConsent(isPlainObject(parsed.studio) ? parsed.studio.consent : {}),
    planner: sanitizeStudioPlanner(isPlainObject(parsed.studio) ? parsed.studio.planner : {}),
  };
  return {
    // The version the FILE carries, not this build's: `migrateState` needs to
    // know how old what it just read is, and a normalize that stamped the
    // current version on everything would have made every file look current.
    version: Number.isInteger(parsed.version) && parsed.version > 0 ? parsed.version : 1,
    migrations: isPlainObject(parsed.migrations) ? { ...parsed.migrations } : {},
    seededAt: typeof parsed.seededAt === 'number' ? parsed.seededAt : null,
    machineId: sanitizeMachineId(parsed.machineId),
    settings,
    ack,
    identity,
    archivedProjects,
    pins,
    layout,
    studio,
  };
}

/**
 * The identity block's junior books (audit F6), read back from disk. Additive:
 * a file without the key — every file before this build — reads as no books,
 * which is what an in-memory build would have started from, so no version bump.
 * A malformed book is dropped rather than guessed at.
 * @param {unknown} raw
 * @returns {Record<string, {next: number, of: Record<string, number>}>}
 */
function sanitizeJuniorBooks(raw) {
  /** @type {Record<string, {next: number, of: Record<string, number>}>} */
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const [parent, book] of Object.entries(/** @type {Record<string, any>} */ (raw))) {
    if (!isPlainObject(book) || !Number.isInteger(book.next) || book.next < 0) continue;
    /** @type {Record<string, number>} */
    const of = {};
    for (const [id, n] of Object.entries(isPlainObject(book.of) ? book.of : {})) {
      if (Number.isInteger(n) && n > 0 && n <= book.next) of[id] = n;
    }
    out[parent] = { next: book.next, of };
  }
  return out;
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
   *
   * An id already minted in this process survives the re-read. `load()` is
   * called more than once on a normal start — `startDaemon()` calls it, and
   * `Registry.start()` calls it again — and the machine id is minted between
   * those two, before the 250 ms debounce has put it on disk. Without this
   * the second read would parse a file with no id, hand back `null`, and the
   * daemon would mint a *different* id on every start: the one field in the
   * file whose entire value is being stable would be the one field that
   * never was. See `docs/DEVIATIONS.md` §100.
   *
   * @returns {Promise<void>}
   */
  async load() {
    const minted = this._data?.machineId || null;
    const restore = () => {
      if (minted && !this._data.machineId) {
        this._data.machineId = minted;
        this.save();
      }
    };
    let raw;
    try {
      raw = await fsp.readFile(this.file, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        this._data = defaultData();
        restore();
        return;
      }
      this._log.warn(`could not read ${this.file}; starting from defaults`, err);
      this._data = defaultData();
      restore();
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
      restore();
      return;
    }

    if (!isPlainObject(parsed)) {
      await this._backupCorrupt(raw);
      this._log.warn(
        `state file at ${this.file} has an invalid shape; backed up and starting from defaults`,
      );
      this._data = defaultData();
      restore();
      return;
    }

    this._data = normalize(parsed);
    this._migrate();
    restore();
  }

  /**
   * Carry a file an older build wrote up to `STATE_VERSION` (WP-86).
   *
   * Runs on every `load()` that read an actual file, and on no fresh one: a
   * default state object is already current, so the loop inside `migrateState`
   * has nothing to do. A pass that changed something schedules the ordinary
   * debounced write — the migration is not worth a synchronous one, because
   * every pass is idempotent and the next start would simply run it again.
   *
   * What ran is logged at `info`, once, with what it did. A name changing
   * underneath somebody is exactly the kind of thing a log has to be able to
   * account for afterwards.
   */
  _migrate() {
    const result = migrateState(this._data, { now: clockNow() });
    if (!result.ran.length) return;
    for (const pass of result.ran) {
      const detail = Object.entries(pass.detail)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      this._log.info(
        `state migration ${pass.id} (v${pass.version})${detail ? ` — ${detail}` : ''}`,
      );
    }
    this.save();
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

  /** @returns {Settings} */
  get settings() {
    return { ...this._data.settings };
  }

  /**
   * @param {Partial<Settings>} patch
   * @returns {Settings}
   */
  setSettings(patch) {
    this._data.settings = sanitizeSettings({ ...this._data.settings, ...(patch || {}) });
    this.save();
    return this.settings;
  }

  /**
   * This machine's random id, minted on first read and kept forever.
   *
   * WP-48. It exists so that two ledgers the same person's two machines
   * wrote can be merged into one team floor without either of them holding a
   * name, a path or an account. It is written to `state.json` and read by
   * `src/core/ledger.mjs`; **nothing in this repository sends it anywhere**,
   * and there is a test that asserts the string never appears in any
   * outbound-facing surface (`doctor --share`).
   *
   * @returns {string}
   */
  get machineId() {
    if (!this._data.machineId) {
      this._data.machineId = randomBytes(16).toString('hex');
      this.save();
    }
    return this._data.machineId;
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
    const next = { ...prev, ...(patch || {}), updatedAt: clockNow() };
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

  /**
   * Is this project pinned — does it keep a room with nothing running in it
   * (WP-77)?
   * @param {string} projectId
   */
  isProjectPinned(projectId) {
    return Object.prototype.hasOwnProperty.call(this._data.pins, String(projectId || ''));
  }

  /**
   * Pin a project's room, or take the pin back.
   *
   * THE ONLY WRITER, and it is only ever reached from `POST /api/pin` — a
   * person clicking. No scan, no hook and no ended session calls this: a pin is
   * user-owned state on `ackState`'s terms (`08` §1.1 rule 1), and
   * `test/unit/pins.test.mjs` holds that as an `INVARIANT:` test.
   *
   * Unpinning DELETES the key rather than storing `false`, for the reason
   * `setProjectArchived` and `revokeStudioConsent` delete: a record of every
   * project ever unpinned is a growing list nobody asked for.
   *
   * @param {string} projectId
   * @param {boolean} pinned
   * @returns {boolean} whether the project is pinned now
   */
  setProjectPinned(projectId, pinned) {
    const id = String(projectId || '');
    if (!PROJECT_ID_RE.test(id)) return false;
    if (pinned) this._data.pins[id] = { at: clockNow() };
    else delete this._data.pins[id];
    this.save();
    return this.isProjectPinned(id);
  }

  /**
   * Every pinned project, as `projectId → { at }`. A copy, for the reason
   * `studioConsent` returns one: a caller that could mutate the map in place
   * would be a second writer.
   * @returns {Record<string, {at:number}>}
   */
  pinnedProjects() {
    /** @type {Record<string, {at:number}>} */
    const out = {};
    for (const [id, rec] of Object.entries(this._data.pins)) out[id] = { ...rec };
    return out;
  }

  /**
   * The order the floor deals rooms in, as project ids (WP-30).
   *
   * Empty is the normal answer and means "however the scan ordered them".
   * Ids that no longer exist are kept rather than pruned: a repo you have not
   * opened this week is not a repo you have deleted, and pruning would make an
   * imported layout decay every time you did not run something.
   * @returns {string[]}
   */
  roomOrder() {
    return [...this._data.layout.rooms];
  }

  /**
   * Set that order. Sanitised here as well as at the route, on the same terms
   * as every other value in this file: a hand-edited `state.json` cannot put a
   * path, a duplicate or ten thousand entries into a list the renderer reads.
   * @param {unknown} ids
   */
  setRoomOrder(ids) {
    this._data.layout.rooms = sanitizeRoomOrder(ids);
    this.save();
    return this.roomOrder();
  }

  /**
   * Every project that has enabled Studio, as `projectKey → { grantedAt, root }`
   * (WP-66). A copy: consent is written by exactly one path — `enable` — and a
   * caller that could mutate the map in place would be a second one.
   * @returns {Record<string, {grantedAt:number, root:string}>}
   */
  studioConsent() {
    /** @type {Record<string, {grantedAt:number, root:string}>} */
    const out = {};
    for (const [key, rec] of Object.entries(this._data.studio.consent)) out[key] = { ...rec };
    return out;
  }

  /**
   * The grant for one project, or null. Null is the answer on every install
   * that has not enabled Studio, which is all of them by default.
   * @param {string} projectKey
   * @returns {{grantedAt:number, root:string}|null}
   */
  studioConsentFor(projectKey) {
    const rec = this._data.studio.consent[String(projectKey || '')];
    return rec ? { ...rec } : null;
  }

  /**
   * Record a grant. Called from `src/studio/consent.mjs` and nowhere else: the
   * grant and the tagged file are written together or not at all.
   * @param {string} projectKey
   * @param {{grantedAt:number, root:string}} record
   */
  grantStudioConsent(projectKey, record) {
    const key = String(projectKey || '');
    if (!/^[0-9a-f]{16}$/.test(key)) return null;
    const next = {
      grantedAt: Number(record?.grantedAt) || clockNow(),
      root: String(record?.root || ''),
    };
    if (!next.root) return null;
    this._data.studio.consent[key] = next;
    this.save();
    return { ...next };
  }

  /**
   * Take one back. Deletes the key rather than storing `false`, for the reason
   * `setProjectArchived` deletes rather than stores: a record of every project
   * ever disabled is a growing list nobody asked for.
   * @param {string} projectKey
   */
  revokeStudioConsent(projectKey) {
    const key = String(projectKey || '');
    const hadPlanner = key in this._data.studio.planner;
    // Studio being off for a project means Studio remembers nothing about it.
    // The session itself is untouched — it is an ordinary session on the floor
    // and stays exactly where it is (§8: DeckHQ does not kill what it did not
    // start, and does not stop what it did).
    if (hadPlanner) delete this._data.studio.planner[key];
    if (!(key in this._data.studio.consent)) {
      if (hadPlanner) this.save();
      return false;
    }
    delete this._data.studio.consent[key];
    this.save();
    return true;
  }

  /**
   * Every project that has a planner recorded, as
   * `projectKey → { agentId, startedAt }`. A copy, on `studioConsent`'s terms.
   * @returns {Record<string, {agentId:string, startedAt:number}>}
   */
  studioPlanner() {
    /** @type {Record<string, {agentId:string, startedAt:number}>} */
    const out = {};
    for (const [key, rec] of Object.entries(this._data.studio.planner)) out[key] = { ...rec };
    return out;
  }

  /**
   * The planner session recorded for one project, or null (WP-67). Null is the
   * answer until a planner has been started AND found by the ordinary scan.
   * @param {string} projectKey
   * @returns {{agentId:string, startedAt:number}|null}
   */
  studioPlannerFor(projectKey) {
    const rec = this._data.studio.planner[String(projectKey || '')];
    return rec ? { ...rec } : null;
  }

  /**
   * Write one down. Called from `POST /api/studio/plan` when the scan hands it
   * a session in the project's directory, and from nowhere else: an id nobody
   * observed would be exactly the guess §4 forbids.
   * @param {string} projectKey
   * @param {{agentId:string, startedAt:number}} record
   */
  recordStudioPlanner(projectKey, record) {
    const key = String(projectKey || '');
    if (!/^[0-9a-f]{16}$/.test(key)) return null;
    const agentId = String(record?.agentId || '');
    if (!agentId) return null;
    const next = { agentId, startedAt: Number(record?.startedAt) || clockNow() };
    this._data.studio.planner[key] = next;
    this.save();
    return { ...next };
  }

  /**
   * Forget one. The session is left alone — this removes DeckHQ's note that it
   * was the planner, which is all the note ever was.
   * @param {string} projectKey
   */
  forgetStudioPlanner(projectKey) {
    const key = String(projectKey || '');
    if (!(key in this._data.studio.planner)) return false;
    delete this._data.studio.planner[key];
    this.save();
    return true;
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
