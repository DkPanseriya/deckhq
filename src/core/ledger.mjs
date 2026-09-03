/**
 * WP-17 + WP-48 — the event ledger.
 *
 * An append-only record of what happened on this floor, one JSON object per
 * line, one file per local day, under `~/.deckhq/ledger/YYYY-MM-DD.jsonl`.
 * It is what finally measures `docs/01-PRODUCT.md` §6 — a product whose first
 * success criterion is "sessions sitting in `for_review` longer than 24h: 0,
 * sustained" had, until now, no way of knowing whether that was true — and it
 * is the substrate for the postcard (WP-18), the rate card (WP-26), team
 * records (WP-46) and Wrapped (WP-27).
 *
 * ## The four rules this file exists to keep
 *
 * 1. **Nothing in the ledger path may read or mutate ack state.** This module
 *    imports nothing from `store.mjs` and nothing from `state-machine.mjs`.
 *    It is handed values; it never goes looking for them, and it has no way
 *    to write one back. The direction of the dependency IS the guarantee.
 *    There is an `INVARIANT:` test that drives the state machine twice — once
 *    with a working ledger, once with one whose every write throws — and
 *    asserts the resulting agents and the whole ack map are identical.
 * 2. **A write failure never blocks the state machine.** `record()` is
 *    synchronous, does no I/O, and cannot throw: it pushes onto an in-memory
 *    buffer and (at most every 2 s) schedules a flush. The flush is fire and
 *    forget. A disk that has stopped accepting writes costs one log line, in
 *    total, for the life of the process.
 * 3. **It is measurement, not state.** Nothing here is user-owned, so nothing
 *    here can be wrong in a way that violates the product invariant — it can
 *    only be incomplete. That is what licenses every "drop it and carry on"
 *    branch below: a truncated line is skipped, an unwritable directory is
 *    logged once, a buffer that outgrows its ceiling drops its oldest records
 *    rather than growing without bound.
 * 4. **No network, ever, and no path in a record.** `projectKey` is a hash of
 *    the project's directory, never the directory. WP-48 puts a `machineId`
 *    on every record so a BYOS team floor can merge two machines' ledgers
 *    later; it is random, generated once, stored in `state.json`, and sent
 *    nowhere by anything in this repository.
 *
 * ## The record
 *
 *     {t, machineId, projectKey, sessionId, kind, ...}
 *
 * `t` is ms epoch. `sessionId` is the product's own agent id
 * (`runtime:session-uuid`), so a record joins directly to an `Agent`.
 * `kind` is one of:
 *
 * | kind | fields | when |
 * |---|---|---|
 * | `session` | `event`, and for `first_seen` also `activity`, `ack`, `since` | a session enters this day's ledger, or the desktop app archives/unarchives it |
 * | `state` | `dim` (`activity`\|`ack`), `from`, `to` | an observed activity transition, or a change of ack state |
 * | `action` | `action` | one of the six `act()` actions the user took |
 * | `send` | `chars` | a turn was sent to a session from DeckHQ |
 * | `tokens` | `delta`, `tokens`, `cacheDelta`, `cacheTokens` | a scan saw this session's token total move |
 *
 * ### Why `first_seen` is per day, and why it carries `since`
 *
 * WP-17's acceptance is "a day's ledger reconstructs the needs-you queue at
 * any past timestamp". A day file that only held that day's *transitions*
 * could not do that: a session that went `for_review` on Tuesday and is still
 * waiting on Friday has no Friday transition, so Friday's file would show an
 * empty queue. So the first time each local day that this process sees a
 * session, it writes one `first_seen` carrying that session's current
 * `activity`, `ack` **and the timestamp it entered that state** — a carry-over
 * snapshot that makes every day file self-contained. `since` is what keeps
 * durations honest across midnight: an episode that began on Tuesday is still
 * measured from Tuesday in Friday's file, so "longest wait ever" is a real
 * number and not an artifact of when the file rolled over.
 *
 * A restart inside the same day re-reads the day file and does not re-emit,
 * so a daemon that is bounced ten times does not look like ten new sessions.
 *
 * ## The write discipline
 *
 * Buffered, flushed at most every 2 s, exactly the shape of
 * `src/core/summary-cache.mjs`: a live floor changes state far faster than a
 * disk should be asked to care about.
 *
 * The flush opens the day file with `O_APPEND` and issues **one** `write()`
 * for the whole batch. Under `O_APPEND` the kernel positions every write at
 * the current end of file as part of the write itself, so two DeckHQ
 * processes sharing a state directory interleave whole batches rather than
 * corrupting each other — which is why this is an append and not the
 * temp-then-rename `store.mjs` uses. A rename-based append would have to read
 * the whole day back, and a second writer would silently lose the first
 * writer's records.
 *
 * **fsync policy: none.** Nothing is flushed to stable storage explicitly. A
 * machine that loses power drops up to 2 s of buffered records and, in the
 * worst case, leaves a torn final line — which `parseRecords` skips. That is
 * the correct trade for this file and it is the deliberate difference from
 * `state.json`: acknowledgements are the user's and must survive, whereas a
 * missing measurement is a slightly wrong median. Paying an `fsync` every 2 s
 * for the life of the daemon to protect a statistic would be the wrong bill.
 */

import { promises as fsp } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';

import { createLog } from './log.mjs';
import { ACK_STATES, ACTIVITY_STATES, NEEDS_YOU_STATES } from './model.mjs';

/** Every `kind` this module writes. Anything else on a line is ignored. */
export const LEDGER_KINDS = /** @type {const} */ (['session', 'state', 'action', 'send', 'tokens']);

/** How often the buffer is written, at most. WP-17: "at most every 2 s". */
export const FLUSH_INTERVAL_MS = 2000;

/**
 * Ceiling on buffered records. Reached only when the disk has stopped
 * accepting writes: at that point the choice is between dropping the oldest
 * measurements and growing a daemon's heap until it dies, and a daemon that
 * dies takes the acknowledgements with it.
 */
const MAX_BUFFERED = 10_000;

/** Longest string any single field may carry into a record. */
const MAX_FIELD = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `settings.ledgerRetentionDays`, the default and its bounds. */
export const DEFAULT_RETENTION_DAYS = 90;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;

const DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

// ---------------------------------------------------------------------------
// Keys and days
// ---------------------------------------------------------------------------

/**
 * The stable, path-free identifier for a project.
 *
 * A truncated SHA-256 of the directory, normalised the way
 * `model.projectIdFromCwd` normalises it (separators and case) so Windows and
 * POSIX agree, and so `C:\Work\api` and `c:/work/api/` are one project. The
 * hash is the whole point of WP-48: a ledger that a team merges in somebody
 * else's storage must be able to say "these two machines worked on the same
 * repository" without either machine's directory layout leaving the machine.
 *
 * @param {string} cwd
 * @returns {string} 16 hex characters
 */
export function projectKeyFor(cwd) {
  const normalised = String(cwd || '')
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
  if (!normalised) return 'unknown';
  return createHash('sha256').update(normalised, 'utf8').digest('hex').slice(0, 16);
}

/**
 * The local day a timestamp belongs to, `YYYY-MM-DD`.
 *
 * Local, not UTC: "discharges per day" and "the office cleared" are facts
 * about the user's day, and a ledger that rolled over at 01:00 local would
 * split one evening's work across two cards.
 *
 * @param {number} ms
 */
export function dayKey(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Local midnight at the start of a `YYYY-MM-DD`, or NaN.
 * @param {string} day
 */
export function dayStart(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/** @param {unknown} v */
function clampField(v) {
  const s = String(v ?? '');
  return s.length > MAX_FIELD ? s.slice(0, MAX_FIELD) : s;
}

/** @param {unknown} n */
function finiteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export class Ledger {
  /**
   * @param {string} dir absolute path to the ledger directory
   * @param {{machineId?:string, log?:import('./log.mjs').Log,
   *          timers?:{setTimeout:Function, clearTimeout:Function},
   *          flushIntervalMs?:number, maxBuffered?:number,
   *          now?:() => number}} [opts]
   */
  constructor(dir, opts = {}) {
    this.dir = dir;
    this.machineId = opts.machineId || 'unknown';
    this._log = opts.log || createLog('ledger');
    this._timers = opts.timers || { setTimeout, clearTimeout };
    this.flushIntervalMs = opts.flushIntervalMs ?? FLUSH_INTERVAL_MS;
    this.maxBuffered = opts.maxBuffered ?? MAX_BUFFERED;
    this._now = opts.now || (() => Date.now());

    /** @type {string[]} serialised lines waiting to be written */
    this._buffer = [];
    this._timer = null;
    /** @type {Promise<void>|null} serialises overlapping flushes */
    this._writing = null;

    /**
     * Session ids already present in the current day's file. Rule 3's
     * dedup: a restart inside one day must not look like a new floor.
     * @type {Set<string>}
     */
    this._seen = new Set();
    this._seenDay = '';

    /**
     * The first write failure, if there has been one. Logged exactly once —
     * a daemon whose disk is full must not fill the terminal as well — and
     * exposed so `deckhq doctor` and the stats route can say the numbers are
     * incomplete rather than quietly reporting a short answer.
     * @type {{message:string, at:number}|null}
     */
    this.writeError = null;
    this._warned = false;

    /** Counters, for the tests and for anyone measuring. */
    this.stats = { recorded: 0, written: 0, dropped: 0, flushes: 0 };
  }

  /** @param {string} day */
  dayFile(day) {
    return path.join(this.dir, `${day}.jsonl`);
  }

  /** How many records are buffered right now. */
  get pending() {
    return this._buffer.length;
  }

  /**
   * Read back which sessions today's file already knows about, so a restart
   * does not re-announce the whole floor. Never throws: a missing or
   * unreadable file simply means every session is new to this day.
   * @param {number} [now]
   * @returns {Promise<void>}
   */
  async prime(now = this._now()) {
    const day = dayKey(now);
    this._seen = new Set();
    this._seenDay = day;
    let raw;
    try {
      raw = await fsp.readFile(this.dayFile(day), 'utf8');
    } catch {
      return;
    }
    for (const rec of parseRecords(raw)) {
      if (rec.sessionId) this._seen.add(rec.sessionId);
    }
  }

  /**
   * Has this session already been announced in today's file?
   *
   * Returns `true` the first time it is asked about a session on a given
   * local day and `false` afterwards, so the caller writes exactly one
   * `first_seen` per session per day. The day roll is handled here rather
   * than by a timer: whoever is recording is the one who knows what time it
   * is now.
   *
   * @param {string} sessionId
   * @param {number} [now]
   * @returns {boolean} whether this is the first sighting today
   */
  markSeen(sessionId, now = this._now()) {
    const day = dayKey(now);
    if (day !== this._seenDay) {
      this._seen = new Set();
      this._seenDay = day;
    }
    const id = String(sessionId || '');
    if (!id || this._seen.has(id)) return false;
    this._seen.add(id);
    return true;
  }

  /**
   * Append one record. Synchronous, non-throwing, no I/O.
   *
   * This is the function the state machine calls, so it is the function that
   * carries rule 2. Everything that could fail — the directory, the disk, the
   * encoding — happens later, on a timer, in a promise nobody awaits.
   *
   * @param {typeof LEDGER_KINDS[number]} kind
   * @param {{sessionId?:string, projectKey?:string, t?:number, [k:string]:any}} fields
   * @returns {boolean} whether it was buffered
   */
  record(kind, fields = {}) {
    try {
      if (!(/** @type {readonly string[]} */ (LEDGER_KINDS).includes(kind))) return false;
      const t = finiteNumber(fields.t) ?? this._now();
      /** @type {Record<string, any>} */
      const rec = {
        t,
        machineId: this.machineId,
        projectKey: clampField(fields.projectKey || 'unknown'),
        sessionId: clampField(fields.sessionId || ''),
        kind,
      };
      for (const [k, v] of Object.entries(fields)) {
        if (k === 't' || k === 'projectKey' || k === 'sessionId' || k === 'machineId') continue;
        if (v === undefined || v === null) continue;
        rec[k] = typeof v === 'string' ? clampField(v) : v;
      }
      this._buffer.push(JSON.stringify(rec));
      this.stats.recorded += 1;
      if (this._buffer.length > this.maxBuffered) {
        const over = this._buffer.length - this.maxBuffered;
        this._buffer.splice(0, over);
        this.stats.dropped += over;
      }
      this._schedule();
      return true;
    } catch {
      // A record that cannot even be serialised is a record that is not worth
      // taking the daemon down for.
      return false;
    }
  }

  _schedule() {
    if (this._timer) return;
    this._timer = this._timers.setTimeout(() => {
      this._timer = null;
      this.flush().catch(() => {});
    }, this.flushIntervalMs);
    if (typeof this._timer?.unref === 'function') this._timer.unref();
  }

  /**
   * Write whatever is buffered, now. Serialised against any flush already in
   * flight so two batches can never interleave inside one file.
   * @returns {Promise<boolean>} whether bytes were written
   */
  flush() {
    const prior = this._writing || Promise.resolve();
    const p = prior
      .catch(() => {})
      .then(() => this._flushNow())
      .finally(() => {
        if (this._writing === p) this._writing = null;
      });
    this._writing = p;
    return p;
  }

  /** @returns {Promise<boolean>} */
  async _flushNow() {
    if (this._buffer.length === 0) return false;
    const batch = this._buffer;
    this._buffer = [];
    const day = dayKey(this._now());
    const text = batch.join('\n') + '\n';

    let handle;
    try {
      await fsp.mkdir(this.dir, { recursive: true });
      // O_APPEND, one write for the batch. See the header: this is what lets
      // two processes share a state directory without a lock.
      handle = await fsp.open(this.dayFile(day), 'a');
      let written = 0;
      const buf = Buffer.from(text, 'utf8');
      while (written < buf.length) {
        const res = await handle.write(buf, written, buf.length - written);
        if (!res.bytesWritten) break;
        written += res.bytesWritten;
      }
      this.stats.written += batch.length;
      this.stats.flushes += 1;
      this.writeError = null;
      return true;
    } catch (err) {
      // Rule 2. The batch is dropped rather than retried: retrying would
      // grow the buffer against a disk that has already said no, and the
      // records are measurements, not the user's.
      this.stats.dropped += batch.length;
      this.writeError = { message: (err && err.message) || String(err), at: this._now() };
      if (!this._warned) {
        this._warned = true;
        this._log.warn(
          `cannot write the ledger at ${this.dir}; measurement is off for this run ` +
            '(nothing else is affected)',
          err,
        );
      }
      return false;
    } finally {
      try {
        await handle?.close();
      } catch {
        /* nothing to close */
      }
    }
  }

  /**
   * Delete day files outside the retention window. Called at daemon start.
   *
   * Never throws, and never touches anything that is not a `YYYY-MM-DD.jsonl`
   * of ours (plus its `.sig` sidecar, if a signed export left one beside it):
   * this runs against a directory in the user's home.
   *
   * @param {number} [retentionDays]
   * @param {number} [now]
   * @returns {Promise<{removed:string[], kept:number}>}
   */
  async prune(retentionDays = DEFAULT_RETENTION_DAYS, now = this._now()) {
    const days = clampRetentionDays(retentionDays);
    const cutoff = dayStart(dayKey(now)) - (days - 1) * DAY_MS;
    /** @type {string[]} */
    const removed = [];
    let kept = 0;
    let names;
    try {
      names = await fsp.readdir(this.dir);
    } catch {
      return { removed, kept };
    }
    for (const name of names) {
      const m = DAY_FILE_RE.exec(name);
      if (!m) continue;
      const start = dayStart(m[1]);
      if (!Number.isFinite(start) || start >= cutoff) {
        kept += 1;
        continue;
      }
      try {
        await fsp.unlink(path.join(this.dir, name));
        removed.push(m[1]);
      } catch {
        continue;
      }
      try {
        await fsp.unlink(path.join(this.dir, `${name}.sig`));
      } catch {
        /* there usually is not one */
      }
    }
    return { removed, kept };
  }

  /** Stop the flush timer. Does not write. */
  stop() {
    if (this._timer) {
      this._timers.clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /** Flush what is buffered and stop. The daemon calls this on shutdown. */
  async close() {
    this.stop();
    await this.flush();
    while (this._writing) await this._writing.catch(() => {});
  }
}

/**
 * @param {unknown} v
 * @returns {number}
 */
export function clampRetentionDays(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.floor(n)));
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Lines to records, skipping anything that does not parse.
 *
 * A ledger file is appended to by a live process and can legitimately end
 * mid-line after a power cut. One bad line costs one record; it must never
 * cost the file.
 *
 * @param {string} text
 * @returns {any[]}
 */
export function parseRecords(text) {
  /** @type {any[]} */
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
    if (typeof rec.kind !== 'string' || typeof rec.t !== 'number') continue;
    out.push(rec);
  }
  return out;
}

/**
 * Which days this ledger holds, oldest first.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
export async function listDays(dir) {
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  /** @type {string[]} */
  const days = [];
  for (const name of names) {
    const m = DAY_FILE_RE.exec(name);
    if (m) days.push(m[1]);
  }
  return days.sort();
}

/**
 * One day's records.
 * @param {string} dir
 * @param {string} day
 * @returns {Promise<any[]>}
 */
export async function readDay(dir, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return [];
  try {
    return parseRecords(await fsp.readFile(path.join(dir, `${day}.jsonl`), 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Every record in the ledger, oldest first, optionally from a given day on.
 *
 * The whole ledger rather than a window, because the numbers this feeds are
 * not all windowed: an episode that started before `since` still has to be
 * measured from where it started, and "longest wait ever" means ever. The
 * ceiling is retention: 90 days of a busy floor is a few megabytes.
 *
 * @param {string} dir
 * @param {{fromDay?:string}} [opts]
 * @returns {Promise<any[]>}
 */
export async function readAll(dir, opts = {}) {
  const days = await listDays(dir);
  /** @type {any[]} */
  const out = [];
  for (const day of days) {
    if (opts.fromDay && day < opts.fromDay) continue;
    for (const rec of await readDay(dir, day)) out.push(rec);
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/** @param {unknown} s */
function isActivity(s) {
  return /** @type {readonly string[]} */ (ACTIVITY_STATES).includes(/** @type {string} */ (s));
}

/** @param {unknown} s */
function isAck(s) {
  return /** @type {readonly string[]} */ (ACK_STATES).includes(/** @type {string} */ (s));
}

/**
 * Fold a stream of records into what each session looked like, and every
 * stretch it spent waiting.
 *
 * **One fold, not two.** The queue at a timestamp and the list of `for_review`
 * episodes are the same walk over the same records asked two questions, and
 * `docs/DEVIATIONS.md` has five separate entries (§16, §35, §38, §52, §55)
 * whose single root cause is two representations of one thing allowed to
 * disagree. Two folds here would eventually answer "who was waiting" and "how
 * long did they wait" from different rules, and the second number would be the
 * one nobody checked.
 *
 * The state per session is the model's own pair — an observed `activity` and a
 * user-owned `ack` — plus the timestamp each was entered. Nothing is inferred:
 * a `first_seen` restates a standing state and is deliberately NOT a
 * transition, so a stretch already open stays open with the start it had, which
 * is what carries an episode across midnight.
 *
 * @param {any[]} records
 * @param {{until?:number, now?:number}} [opts]
 * @returns {{state: Map<string, any>, episodes: any[]}}
 */
function fold(records, opts = {}) {
  const until = opts.until ?? Infinity;
  const now = opts.now ?? Date.now();
  /** @type {Map<string, any>} */
  const state = new Map();
  /** @type {any[]} */
  const episodes = [];

  const queued = (s) =>
    s.ack === 'active' && /** @type {readonly string[]} */ (NEEDS_YOU_STATES).includes(s.activity);
  const waiting = (s) => s.ack === 'active' && s.activity === 'for_review';

  for (const rec of Array.isArray(records) ? records : []) {
    if (!(rec.t <= until)) continue;
    const id = String(rec.sessionId || '');
    if (!id) continue;
    let s = state.get(id);
    if (!s) {
      s = {
        sessionId: id,
        projectKey: String(rec.projectKey || 'unknown'),
        activity: 'ended',
        ack: 'active',
        since: rec.t,
        queueSince: null,
        reviewStart: null,
      };
      state.set(id, s);
    }
    if (rec.projectKey && rec.projectKey !== 'unknown') s.projectKey = String(rec.projectKey);

    const wasQueued = queued(s);
    const wasWaiting = waiting(s);

    if (rec.kind === 'session' && rec.event === 'first_seen') {
      if (isActivity(rec.activity)) s.activity = rec.activity;
      if (isAck(rec.ack)) s.ack = rec.ack;
      s.since = finiteNumber(rec.since) ?? rec.t;
    } else if (rec.kind === 'state' && rec.dim === 'activity' && isActivity(rec.to)) {
      s.activity = rec.to;
      s.since = rec.t;
    } else if (rec.kind === 'state' && rec.dim === 'ack' && isAck(rec.to)) {
      s.ack = rec.to;
    } else {
      continue;
    }

    // The needs-you queue: any of the three states, while on the payroll.
    const isQueued = queued(s);
    if (!wasQueued && isQueued) s.queueSince = s.since;
    else if (wasQueued && !isQueued) s.queueSince = null;
    else if (isQueued && s.queueSince == null) s.queueSince = s.since;

    // The narrower one the §6 metrics are about: `for_review` specifically.
    // Leaving it by ANY route is a discharge, benching and letting go
    // included, because all three are the user acting.
    const isWaiting = waiting(s);
    if (!wasWaiting && isWaiting) s.reviewStart = s.since;
    else if (wasWaiting && !isWaiting) {
      if (s.reviewStart != null) {
        episodes.push({
          sessionId: id,
          projectKey: s.projectKey,
          start: s.reviewStart,
          end: rec.t,
          ms: Math.max(0, rec.t - s.reviewStart),
        });
      }
      s.reviewStart = null;
    } else if (isWaiting && s.reviewStart == null) s.reviewStart = s.since;
  }

  for (const [id, s] of state) {
    if (!waiting(s) || s.reviewStart == null) continue;
    episodes.push({
      sessionId: id,
      projectKey: s.projectKey,
      start: s.reviewStart,
      end: null,
      ms: Math.max(0, now - s.reviewStart),
    });
  }
  episodes.sort((a, b) => a.start - b.start || a.sessionId.localeCompare(b.sessionId));
  return { state, episodes };
}

/**
 * The needs-you queue exactly as it stood at `t`.
 *
 * WP-17's acceptance criterion, and the reason `first_seen` carries `since`.
 * The rule is the model's own (`needsYou()`): `ackState` is `active` and
 * `activityState` is one of `needs_input`, `stalled`, `for_review`. There is
 * deliberately no second opinion here — this replays what the machine
 * recorded, it does not re-derive what the machine should have said.
 *
 * @param {any[]} records
 * @param {number} t
 * @returns {Array<{sessionId:string, projectKey:string, activityState:string, since:number}>}
 */
export function reconstructQueue(records, t) {
  const { state } = fold(records, { until: t, now: t });
  /** @type {any[]} */
  const out = [];
  for (const s of state.values()) {
    if (s.ack !== 'active') continue;
    if (!(/** @type {readonly string[]} */ (NEEDS_YOU_STATES).includes(s.activity))) continue;
    out.push({
      sessionId: s.sessionId,
      projectKey: s.projectKey,
      activityState: s.activity,
      since: s.queueSince ?? s.since,
    });
  }
  out.sort((a, b) => a.since - b.since || a.sessionId.localeCompare(b.sessionId));
  return out;
}

/**
 * Every stretch a session spent in `for_review` while still on the payroll —
 * an "episode". Entering is `for_review` with `ackState` `active`; being
 * discharged is leaving that condition by any route, including being benched
 * or let go, because all three are the user acting. An episode still open at
 * `now` is returned with `end: null`.
 *
 * @param {any[]} records
 * @param {{now?:number}} [opts]
 * @returns {Array<{sessionId:string, projectKey:string, start:number,
 *                  end:number|null, ms:number}>}
 */
export function reviewEpisodes(records, opts = {}) {
  return fold(records, { now: opts.now ?? Date.now() }).episodes;
}

/**
 * The p-th percentile of a sorted-in-place copy, by nearest rank.
 * @param {number[]} values
 * @param {number} p 0..1
 */
export function percentile(values, p) {
  const xs = [...values].sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const rank = Math.ceil(p * xs.length);
  return xs[Math.min(xs.length - 1, Math.max(0, rank - 1))];
}

/**
 * Every number `docs/01-PRODUCT.md` §6 names, plus the ones §7 of the plan
 * asks the records for.
 *
 * Windowed values (`median`, `p90`, `dischargesPerDay`, `sendsPerDay`,
 * `tokensPerProjectPerDay`) cover `[since, now]`. `longestWaitEver` and
 * `over24h` deliberately do not: a record is a record, and the whole point of
 * a falling "longest wait ever" is that it is measured against everything the
 * machine has ever done.
 *
 * @param {any[]} records
 * @param {{now?:number, since?:number}} [opts]
 */
export function computeStats(records, opts = {}) {
  const now = opts.now ?? Date.now();
  const since = finiteNumber(opts.since) ?? now - 30 * DAY_MS;
  const list = Array.isArray(records) ? records : [];
  const episodes = reviewEpisodes(list, { now });

  const closedInWindow = episodes.filter((e) => e.end != null && e.end >= since);
  const durations = closedInWindow.map((e) => e.ms);

  const open = episodes.filter((e) => e.end == null);

  /** @type {Record<string, number>} */
  const dischargesPerDay = {};
  for (const e of closedInWindow) {
    const day = dayKey(/** @type {number} */ (e.end));
    dischargesPerDay[day] = (dischargesPerDay[day] || 0) + 1;
  }

  /** @type {Record<string, number>} */
  const sendsPerDay = {};
  /** @type {Record<string, Record<string, number>>} */
  const tokensPerProjectPerDay = {};
  for (const rec of list) {
    if (rec.t < since || rec.t > now) continue;
    const day = dayKey(rec.t);
    if (rec.kind === 'send') {
      sendsPerDay[day] = (sendsPerDay[day] || 0) + 1;
    } else if (rec.kind === 'tokens') {
      const delta = finiteNumber(rec.delta) ?? 0;
      if (delta <= 0) continue;
      const key = String(rec.projectKey || 'unknown');
      if (!tokensPerProjectPerDay[day]) tokensPerProjectPerDay[day] = {};
      tokensPerProjectPerDay[day][key] = (tokensPerProjectPerDay[day][key] || 0) + delta;
    }
  }

  let longest = null;
  for (const e of episodes) {
    if (!longest || e.ms > longest.ms) longest = e;
  }

  const days = Math.max(1, Math.ceil((now - since) / DAY_MS));

  return {
    since,
    now,
    days,
    forReview: {
      medianMs: percentile(durations, 0.5),
      p90Ms: percentile(durations, 0.9),
      discharged: closedInWindow.length,
      open: open.length,
    },
    // §6's first criterion: sessions sitting in for_review longer than 24h,
    // right now. `everOver24h` is the same question asked of history, which
    // is what tells you whether it USED to happen.
    over24h: open.filter((e) => e.ms > DAY_MS).length,
    everOver24h: episodes.filter((e) => e.ms > DAY_MS).length,
    dischargesPerDay,
    dischargesPerDayMean: closedInWindow.length / days,
    sendsPerDay,
    sendsPerDayMean: Object.values(sendsPerDay).reduce((a, b) => a + b, 0) / days,
    tokensPerProjectPerDay,
    longestWaitEver: longest
      ? {
          ms: longest.ms,
          sessionId: longest.sessionId,
          projectKey: longest.projectKey,
          date: dayKey(longest.start),
          open: longest.end == null,
        }
      : null,
    // Enough for a caller to say "these numbers are short" without inventing
    // a reason of its own.
    records: list.length,
    // The same number under a name that does not collide with WP-46's team
    // records, which `GET /api/stats` and `deckhq stats --json` publish as
    // `records`. Both fields are emitted; nothing that read the count has to
    // move, and nothing that wants the records has to say `teamRecords`.
    recordCount: list.length,
  };
}

// ---------------------------------------------------------------------------
// WP-46 — team records
// ---------------------------------------------------------------------------

/**
 * The window the rolling records look back over: a week.
 *
 * A ledger younger than this still answers — every record carries the day the
 * ledger starts, so a two-day-old install reads "since 1 Sep" rather than
 * pretending to a week it has not lived through.
 */
export const RECORD_WINDOW_DAYS = 7;

/**
 * How many discharges a day needs before it can hold the fastest-discharge
 * record.
 *
 * Without a floor the record is always held by whichever day happened to
 * contain exactly one two-second discharge, which is not a fact about the
 * team's day — it is a fact about a single click. Three is the smallest
 * number for which "the median" is a median of anything.
 */
export const MIN_DISCHARGES_FOR_FASTEST_DAY = 3;

/** Ceiling on how many calendar days a record scan will walk. */
const MAX_DAYS_SCANNED = 4000;

/**
 * `YYYY-MM-DD`, n days on. Component arithmetic, not `+ n * DAY_MS`: adding
 * 24 hours to a local midnight lands at 23:00 the same day when the clocks go
 * back, and the resulting day key would silently repeat.
 * @param {string} day
 * @param {number} n
 * @returns {string}
 */
export function addDays(day, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return '';
  return dayKey(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n).getTime());
}

/**
 * Calendar days from `first` to `last`, inclusive. Bounded, because a single
 * mis-stamped record from 1970 must not turn a report into a walk.
 * @param {string} first
 * @param {string} last
 */
function countDays(first, last) {
  if (!first || !last || last < first) return first ? 1 : 0;
  let n = 1;
  let day = first;
  while (day < last && n < MAX_DAYS_SCANNED) {
    day = addDays(day, 1);
    n += 1;
  }
  return n;
}

/**
 * Is this record a turn?
 *
 * A turn is a session starting work: a recorded transition of the observed
 * activity into `working`. That counts turns typed in the terminal as well as
 * ones DeckHQ sent, which is the point — the ledger's `send` records only
 * know about the half that came through this product, and "the busiest day"
 * is a fact about the floor, not about the panel.
 *
 * `stalled` → `working` is excluded and is the only exclusion. A stall is
 * inferred from silence, so coming out of one is the same turn resuming, and
 * counting it would make a long quiet turn look like several short ones.
 *
 * @param {any} rec
 */
function isTurn(rec) {
  return (
    rec &&
    rec.kind === 'state' &&
    rec.dim === 'activity' &&
    rec.to === 'working' &&
    rec.from !== 'working' &&
    rec.from !== 'stalled'
  );
}

/**
 * The team's records — `docs/plan/08-PLAN-V2-100X.md` §7, WP-46.
 *
 * Five facts about the floor's own history, computed from the ledger and from
 * nothing else:
 *
 * | record | what it is |
 * |---|---|
 * | `longestWait` | the longest a session ever sat in `for_review`, and the day that stretch began |
 * | `busiestDay` | the local day with the most turns |
 * | `busiestWeek` | the seven-day window with the most turns, and the day it ended |
 * | `neverSlept` | the project with activity in the most distinct hours of the day, over the last week |
 * | `fastestDischargeDay` | the day with the lowest median time in review, of the days that discharged enough to have a median |
 *
 * **None of them is a score on the human** (§1.1 rule 6). Every one is a fact
 * about the team's work — how long a session waited, how many turns a day
 * held, which room had someone in it at 4am. There is no count of the user's
 * days, no streak, nothing that can fall, and no record whose subject is the
 * person reading it. The copy that renders them is asserted to contain no
 * second person in a fault sense; see `test/unit/records.test.mjs`.
 *
 * **They degrade rather than lie.** Every record carries `since` — the first
 * day the ledger holds — and `partial`, true while that is less than a week
 * ago. A floor two days old reports two days of records and says so, rather
 * than reporting a week that did not happen or reporting nothing at all.
 *
 * @param {any[]} recordList
 * @param {{now?:number}} [opts]
 */
export function records(recordList, opts = {}) {
  const now = opts.now ?? Date.now();
  const list = Array.isArray(recordList) ? recordList : [];

  let firstT = null;
  let lastT = null;
  for (const rec of list) {
    const t = finiteNumber(rec?.t);
    if (t == null) continue;
    if (firstT == null || t < firstT) firstT = t;
    if (lastT == null || t > lastT) lastT = t;
  }

  const today = dayKey(now);
  const since = firstT == null ? today : dayKey(firstT);
  const lastDay =
    firstT == null
      ? today
      : (() => {
          const l = dayKey(/** @type {number} */ (lastT));
          return l > today ? l : today;
        })();
  const days = firstT == null ? 0 : countDays(since, lastDay);
  const partial = days < RECORD_WINDOW_DAYS;

  /** Every record is stamped with the same two, so one of them travels alone. */
  const stamp = (rec) => (rec ? { ...rec, since, partial } : null);

  const base = {
    since,
    days,
    partial,
    windowDays: RECORD_WINDOW_DAYS,
    longestWait: null,
    busiestDay: null,
    busiestWeek: null,
    neverSlept: null,
    fastestDischargeDay: null,
  };
  if (firstT == null) return base;

  const episodes = reviewEpisodes(list, { now });

  // --- the longest anyone ever waited -------------------------------------
  /** @type {any} */
  let longest = null;
  for (const e of episodes) if (!longest || e.ms > longest.ms) longest = e;

  // --- turns, per day, and the busiest of them ----------------------------
  /** @type {Map<string, number>} */
  const turnsPerDay = new Map();
  for (const rec of list) {
    if (!isTurn(rec)) continue;
    const day = dayKey(rec.t);
    turnsPerDay.set(day, (turnsPerDay.get(day) || 0) + 1);
  }
  const turnDays = [...turnsPerDay.keys()].sort();

  /** @type {{date:string, turns:number}|null} */
  let busiestDay = null;
  for (const day of turnDays) {
    const turns = /** @type {number} */ (turnsPerDay.get(day));
    // Ties go to the earlier day: a record belongs to whoever set it first.
    if (!busiestDay || turns > busiestDay.turns) busiestDay = { date: day, turns };
  }

  // --- the busiest week ---------------------------------------------------
  //
  // Rolling, over calendar days, and only windows that END on a day with
  // turns are considered: a window ending on a quiet day sums a subset of the
  // window ending on the last busy day inside it, so it can never win.
  /** @type {{date:string, turns:number, from:string, to:string}|null} */
  let busiestWeek = null;
  for (const end of turnDays) {
    const start = addDays(end, -(RECORD_WINDOW_DAYS - 1));
    let turns = 0;
    for (const [day, n] of turnsPerDay) {
      if (day >= start && day <= end) turns += n;
    }
    if (!busiestWeek || turns > busiestWeek.turns) {
      busiestWeek = { date: end, turns, from: start < since ? since : start, to: end };
    }
  }

  // --- the room that never slept ------------------------------------------
  //
  // Distinct hours OF THE DAY, not distinct hour-slots in the week: the
  // record is "somebody was in that room at 4am and at 4pm", and 24 of 24 is
  // a room that genuinely never slept. Every kind of record counts as
  // activity — a token delta at 03:00 is somebody working at 03:00.
  const windowFrom = (() => {
    const w = addDays(today, -(RECORD_WINDOW_DAYS - 1));
    return w < since ? since : w;
  })();
  const windowStartMs = dayStart(windowFrom);
  /** @type {Map<string, Set<number>>} */
  const hoursPerProject = new Map();
  for (const rec of list) {
    const t = finiteNumber(rec?.t);
    if (t == null || t < windowStartMs || t > now) continue;
    const key = String(rec.projectKey || 'unknown');
    if (key === 'unknown') continue;
    let set = hoursPerProject.get(key);
    if (!set) hoursPerProject.set(key, (set = new Set()));
    set.add(new Date(t).getHours());
  }
  /** @type {{projectKey:string, hours:number, date:string, from:string, to:string}|null} */
  let neverSlept = null;
  for (const key of [...hoursPerProject.keys()].sort()) {
    const hours = /** @type {Set<number>} */ (hoursPerProject.get(key)).size;
    if (!neverSlept || hours > neverSlept.hours) {
      neverSlept = { projectKey: key, hours, date: today, from: windowFrom, to: today };
    }
  }

  // --- the fastest discharge day ------------------------------------------
  /** @type {Map<string, number[]>} */
  const dischargesPerDay = new Map();
  for (const e of episodes) {
    if (e.end == null) continue;
    const day = dayKey(e.end);
    const xs = dischargesPerDay.get(day);
    if (xs) xs.push(e.ms);
    else dischargesPerDay.set(day, [e.ms]);
  }
  /** @type {{date:string, medianMs:number, discharged:number}|null} */
  let fastest = null;
  for (const day of [...dischargesPerDay.keys()].sort()) {
    const xs = /** @type {number[]} */ (dischargesPerDay.get(day));
    if (xs.length < MIN_DISCHARGES_FOR_FASTEST_DAY) continue;
    const medianMs = /** @type {number} */ (percentile(xs, 0.5));
    if (!fastest || medianMs < fastest.medianMs) {
      fastest = { date: day, medianMs, discharged: xs.length };
    }
  }

  return {
    ...base,
    longestWait: stamp(
      longest
        ? {
            ms: longest.ms,
            date: dayKey(longest.start),
            sessionId: longest.sessionId,
            projectKey: longest.projectKey,
            open: longest.end == null,
          }
        : null,
    ),
    busiestDay: stamp(busiestDay),
    busiestWeek: stamp(busiestWeek),
    neverSlept: stamp(neverSlept),
    fastestDischargeDay: stamp(fastest),
  };
}

// ---------------------------------------------------------------------------
// WP-48 — signed export
// ---------------------------------------------------------------------------

/**
 * Where the signing key lives, beside the state it describes.
 * @param {string} stateDir
 */
export function keyPaths(stateDir) {
  return {
    private: path.join(stateDir, 'ledger-key.pem'),
    public: path.join(stateDir, 'ledger-key.pub.pem'),
  };
}

/**
 * The machine's Ed25519 signing key, generated once.
 *
 * Written `0600` where the OS honours a mode — that is POSIX. On Windows the
 * mode argument is effectively ignored by the filesystem, and the file's
 * protection is whatever the user's profile directory already provides; this
 * is stated rather than papered over, and it is why the key signs a ledger
 * rather than authenticating anything.
 *
 * The key never leaves the machine. Only the PUBLIC half is written into a
 * signature sidecar, which is what makes a signed day file verifiable by a
 * team member who has never seen this machine.
 *
 * @param {string} stateDir
 * @returns {{privateKeyPem:string, publicKeyPem:string, created:boolean, mode:number|null}}
 */
export function loadOrCreateKey(stateDir) {
  const paths = keyPaths(stateDir);
  if (fs.existsSync(paths.private)) {
    const privateKeyPem = fs.readFileSync(paths.private, 'utf8');
    const publicKeyPem = createPublicKey(createPrivateKey(privateKeyPem))
      .export({ type: 'spki', format: 'pem' })
      .toString();
    let mode = null;
    try {
      mode = fs.statSync(paths.private).mode & 0o777;
    } catch {
      /* unknowable is fine */
    }
    return { privateKeyPem, publicKeyPem, created: false, mode };
  }

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(paths.private, privateKeyPem, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(paths.public, publicKeyPem, { encoding: 'utf8', mode: 0o644 });
  try {
    fs.chmodSync(paths.private, 0o600);
  } catch {
    /* Windows, and anywhere else that does not do modes */
  }
  let mode = null;
  try {
    mode = fs.statSync(paths.private).mode & 0o777;
  } catch {
    /* unknowable is fine */
  }
  return { privateKeyPem, publicKeyPem, created: true, mode };
}

/** A short, comparable fingerprint of a public key. */
export function keyFingerprint(publicKeyPem) {
  return createHash('sha256')
    .update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .slice(0, 16);
}

/**
 * The signature document written beside an exported day file.
 *
 * It carries the public key so that verification needs nothing but the two
 * files. That proves **integrity and a single signer**, not identity: anyone
 * can mint a key. A BYOS team floor pins the fingerprint it expects for each
 * machine; `deckhq ledger verify` prints it for exactly that reason.
 *
 * @param {Buffer} bytes the day file, verbatim
 * @param {{privateKeyPem:string, publicKeyPem:string}} key
 * @param {{day:string, machineId:string, now?:number}} meta
 */
export function signBytes(bytes, key, meta) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const signature = cryptoSign(null, bytes, createPrivateKey(key.privateKeyPem)).toString('base64');
  return {
    v: 1,
    alg: 'ed25519',
    day: meta.day,
    machineId: meta.machineId,
    bytes: bytes.length,
    sha256,
    publicKey: key.publicKeyPem,
    fingerprint: keyFingerprint(key.publicKeyPem),
    signature,
    signedAt: meta.now ?? Date.now(),
  };
}

/**
 * Check a day file against its signature document.
 * @param {Buffer} bytes
 * @param {any} sig
 * @returns {{ok:boolean, reason?:string, fingerprint?:string, machineId?:string,
 *            day?:string, records?:number}}
 */
export function verifyBytes(bytes, sig) {
  if (!sig || typeof sig !== 'object')
    return { ok: false, reason: 'the signature file is not a signature' };
  if (sig.alg !== 'ed25519') return { ok: false, reason: `unknown algorithm "${sig.alg}"` };
  if (typeof sig.publicKey !== 'string' || typeof sig.signature !== 'string') {
    return { ok: false, reason: 'the signature file is missing its key or its signature' };
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (typeof sig.sha256 === 'string' && sig.sha256 !== sha256) {
    return { ok: false, reason: 'the file does not match the digest it was signed with' };
  }
  let ok = false;
  try {
    ok = cryptoVerify(
      null,
      bytes,
      createPublicKey(sig.publicKey),
      Buffer.from(sig.signature, 'base64'),
    );
  } catch (err) {
    return { ok: false, reason: (err && err.message) || 'the signature could not be checked' };
  }
  if (!ok) return { ok: false, reason: 'the signature does not match the file' };
  return {
    ok: true,
    fingerprint: keyFingerprint(sig.publicKey),
    machineId: typeof sig.machineId === 'string' ? sig.machineId : 'unknown',
    day: typeof sig.day === 'string' ? sig.day : 'unknown',
    records: parseRecords(bytes.toString('utf8')).length,
  };
}
