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
import { EDITOR_NAMES } from './editor.mjs';
import { clampRetentionDays, DEFAULT_RETENTION_DAYS } from './ledger.mjs';

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
 * The `terminal` setting's "work it out" value, and its default. Which
 * emulators exist, and how each is launched, belongs to
 * `src/adapters/claude-code/terminals.mjs`; the store deliberately does not
 * know — see `sanitizeTerminal` below.
 */
export const TERMINAL_AUTO = 'auto';

/**
 * How the floor and the chrome treat motion. `'system'` defers to the
 * browser's own `prefers-reduced-motion`; the other two are an explicit
 * override in either direction, for a machine whose OS setting is wrong for
 * this one window. docs/plan/05-GUI-UX-SPEC.md §5.4, §9.
 */
export const MOTION_MODES = /** @type {const} */ (['system', 'reduce', 'no-preference']);

/**
 * Every persisted setting, and nothing else. A key in here that no code reads
 * is a defect, not a placeholder: the header shipped a "Show let go" toggle
 * for four months that wrote `showLetGo` and changed nothing, and `zoom` was
 * written by no one and read by no one. Both are gone (WP-07,
 * docs/DEVIATIONS.md §94), and `test/unit/settings-keys.test.mjs` now fails
 * on the next orphan.
 *
 * @typedef {object} Settings
 * @property {number} stallWindowMs      how long silence means "stalled", 2–120 min
 * @property {number} pollIntervalMs     how often the registry rescans
 * @property {boolean} notifications     the OS-notification master switch
 * @property {boolean} notifyHandsUp     notify when a session raises its hand
 * @property {boolean} notifyForReview   notify when a session finishes and waits
 * @property {boolean} osNotify          let the DAEMON raise OS notifications (WP-16)
 * @property {boolean} sound             the sound master switch
 * @property {number} soundVolume        0–1, deliberately low by default
 * @property {'system'|'reduce'|'no-preference'} reducedMotion
 * @property {ResumeTarget} resumeIn     where "resume this session" opens
 * @property {string} approveText        what the panel's `2 Approve` sends
 * @property {string} editor             which editor "open in editor" launches (WP-47)
 * @property {string} terminal           pinned emulator id, or `auto` to detect (WP-04)
 * @property {number} goneHomeDays       days of no activity after which a benched
 *                                       agent is not DRAWN on the floor (WP-50). A
 *                                       display filter only — see
 *                                       `public/render/plan.js`'s `isGoneHome`.
 *                                       0 disables it.
 * @property {number} ledgerRetentionDays how many days of event ledger to keep (WP-17)
 * @property {boolean} onboarded         first run is over
 */

export const DEFAULT_SETTINGS = Object.freeze({
  stallWindowMs: 600000,
  pollIntervalMs: 5000,
  notifications: true,
  notifyHandsUp: true,
  notifyForReview: true,
  // WP-16. The daemon's own OS notifications — the ones that arrive with
  // every browser window closed. OFF until the owner decides otherwise
  // (`docs/DEVIATIONS.md` §101): `notifications` above governs a permission the
  // browser asked for and the user granted, and this one governs a process
  // this machine's user never opted into. `deckhq --notify` turns it on for a
  // single run without writing anything here.
  osNotify: false,
  sound: false,
  soundVolume: 0.3,
  reducedMotion: 'system',
  resumeIn: 'terminal',
  approveText: 'Yes, go ahead.',
  // Blank means "decide for me": `$EDITOR` when it names an allowlisted
  // editor, else the first one found on PATH. A guess at install time would
  // be wrong on any machine that later installs a different editor.
  editor: '',
  terminal: TERMINAL_AUTO,
  goneHomeDays: 7,
  // WP-17. Ninety days is a quarter: long enough for "falling week over week"
  // to mean something and for an annual Wrapped to have most of its material,
  // short enough that the directory stays a few megabytes on a busy machine.
  ledgerRetentionDays: DEFAULT_RETENTION_DAYS,
  onboarded: false,
});

/** The keys above whose value is a plain boolean, so a stray string cannot land. */
const BOOLEAN_SETTINGS = Object.freeze([
  'notifications',
  'notifyHandsUp',
  'notifyForReview',
  'osNotify',
  'sound',
  'onboarded',
]);

/** An approval is one line the user would have typed; anything longer is a reply. */
const MAX_APPROVE_TEXT = 500;

/**
 * A gone-home window past a year is indistinguishable from "never", and a
 * negative one is meaningless. `0` is the honest way to say "draw everybody".
 */
const MAX_GONE_HOME_DAYS = 365;

/**
 * How long `save()` waits for further mutations before it writes. Exported so
 * the test suite can assert the window it schedules rather than sleep past it.
 */
export const SAVE_DEBOUNCE_MS = 250;
const MIN_STALL_WINDOW_MS = 2 * 60 * 1000;
const MAX_STALL_WINDOW_MS = 120 * 60 * 1000;
/**
 * The poll interval's floor is a courtesy to the machine — every scan reads
 * transcripts — and its ceiling is a courtesy to the user: past a minute the
 * floor stops being a live picture. Hooks make the interval close to
 * irrelevant; without them it is the whole latency budget.
 */
const MIN_POLL_INTERVAL_MS = 1000;
const MAX_POLL_INTERVAL_MS = 60 * 1000;

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

/** @param {unknown} ms */
function clampPollInterval(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.pollIntervalMs;
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, Math.round(n)));
}

/**
 * Volume as a 0–1 fraction. A non-number, a NaN or an out-of-range value is
 * clamped rather than rejected: the slider that writes this cannot produce one,
 * but a hand-edited state.json can, and a volume of 40 would be a fright.
 * @param {unknown} v
 */
function clampVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.soundVolume;
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

/**
 * @param {unknown} v
 * @returns {'system'|'reduce'|'no-preference'}
 */
function sanitizeMotion(v) {
  return /** @type {readonly string[]} */ (MOTION_MODES).includes(/** @type {string} */ (v))
    ? /** @type {any} */ (v)
    : DEFAULT_SETTINGS.reducedMotion;
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

/**
 * Which terminal emulator "open in terminal" should use.
 *
 * Validated by SHAPE, not by membership. The list of emulators lives in the
 * adapter that launches them, and `core/` importing from `adapters/` would
 * invert the layering the whole architecture rests on
 * (`docs/02-ARCHITECTURE.md` §2). The three layers each check what they can
 * actually know:
 *
 *   - The HTTP route rejects an id no platform has, so a bad request is
 *     reported rather than quietly ignored (`src/http/routes/settings.mjs`).
 *   - This function rejects anything that is not a plausible id, so a
 *     hand-edited `state.json` cannot put a path, a flag or a shell fragment
 *     into a value the launcher will read.
 *   - Detection treats a pin it cannot resolve on this platform as absent and
 *     carries on, so a state file carried between a Mac and a Linux box still
 *     opens a terminal.
 *
 * @param {unknown} v
 * @returns {string}
 */
function sanitizeTerminal(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[a-z][a-z0-9-]{0,31}$/.test(s) ? s : DEFAULT_SETTINGS.terminal;
}

/**
 * The affirmative `2 Approve` sends. A blank or non-string value falls back
 * to the default — an approve key that sent nothing would be a silent no-op —
 * and it is trimmed and capped so a stray paste cannot turn the key into a
 * prompt injector.
 * @param {unknown} v
 * @returns {string}
 */
function sanitizeApproveText(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, MAX_APPROVE_TEXT) : DEFAULT_SETTINGS.approveText;
}

/**
 * Which editor `open in editor` launches (WP-47). This is the one setting
 * whose value becomes a program, so it is validated here as well as at the
 * route and again in `core/editor.mjs`: only a name on the allowlist, or the
 * empty string for "decide for me", is ever stored. A hand-edited
 * `state.json` asking for `rm` reads back as `''`.
 * @param {unknown} v
 * @returns {string}
 */
function sanitizeEditor(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return /** @type {readonly string[]} */ (EDITOR_NAMES).includes(s) ? s : DEFAULT_SETTINGS.editor;
}

/**
 * How many days of silence make a benched agent stop being drawn (WP-50).
 * Clamped the same way as the stall window: an out-of-range or non-numeric
 * value is a hand-edited state.json or a stale build, and falls back to the
 * default rather than reaching the renderer as a NaN that hides everybody.
 * @param {unknown} v
 * @returns {number}
 */
function clampGoneHomeDays(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.goneHomeDays;
  return Math.min(MAX_GONE_HOME_DAYS, Math.max(0, n));
}

/**
 * Coerce a whole settings object into range, key by key. Every sanitizer is
 * idempotent, so this is safe to run on already-clean data — which is why
 * both `normalize()` (disk) and `setSettings()` (HTTP) run the same pass
 * instead of each remembering its own subset.
 * @param {Record<string, any>} raw
 * @returns {Settings}
 */
function sanitizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  s.stallWindowMs = clampStallWindow(s.stallWindowMs);
  s.pollIntervalMs = clampPollInterval(s.pollIntervalMs);
  s.soundVolume = clampVolume(s.soundVolume);
  s.reducedMotion = sanitizeMotion(s.reducedMotion);
  s.resumeIn = sanitizeResumeIn(s.resumeIn);
  s.approveText = sanitizeApproveText(s.approveText);
  s.editor = sanitizeEditor(s.editor);
  s.terminal = sanitizeTerminal(s.terminal);
  s.goneHomeDays = clampGoneHomeDays(s.goneHomeDays);
  s.ledgerRetentionDays = clampRetentionDays(s.ledgerRetentionDays);
  for (const key of BOOLEAN_SETTINGS) s[key] = Boolean(s[key]);
  // Anything not in DEFAULT_SETTINGS is dropped rather than carried: a key
  // from an older build (`showLetGo`, `zoom`) must not survive a round-trip
  // through the store and reappear in state.json for ever.
  for (const key of Object.keys(s)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) delete s[key];
  }
  return /** @type {Settings} */ (s);
}

/**
 * A hand-edited or absent machine id reads back as absent, and the getter
 * mints a new one. WP-48: 32 hex characters of `randomBytes`, nothing derived
 * from the machine — not its name, not its MAC, not its user. A random id is
 * a join key for two of the user's OWN ledgers; anything derived would be a
 * fingerprint, which is a different thing entirely.
 * @param {unknown} v
 */
function sanitizeMachineId(v) {
  return typeof v === 'string' && /^[0-9a-f]{32}$/.test(v) ? v : null;
}

function defaultData() {
  return {
    version: 1,
    seededAt: null,
    // WP-48. Minted on first use, never sent anywhere. See `get machineId`.
    machineId: null,
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
  const settings = sanitizeSettings(isPlainObject(parsed.settings) ? parsed.settings : {});
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
    machineId: sanitizeMachineId(parsed.machineId),
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
    restore();
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
