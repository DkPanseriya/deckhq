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
 *
 * ============================================================================
 * WP-22 follow-up · this file is the writer: the buffer, the 2 s flush, the
 * day rotation and the retention prune. The rest of the ledger is five
 * modules, every name re-exported from here so nothing that imports
 * `ledger.mjs` had to change:
 *
 *   ledger-record.mjs   the kinds, the ceilings, the day arithmetic, the
 *                       project-key hash
 *   ledger-read.mjs     parse a day file, list the days, read a window
 *   ledger-stats.mjs    the fold, the queue reconstruction, computeStats
 *   ledger-records.mjs  WP-46's team records
 *   ledger-export.mjs   WP-48s window digest
 *   ledger-sign.mjs     the key pair, and the signature over a digest
 *
 * The dependency runs one way, record → read → stats → records → export →
 * here, which is the same rule 1 states for the ledger as a whole: the
 * direction of the dependency IS the guarantee.
 * ============================================================================
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { createLog } from './log.mjs';
import {
  DAY_FILE_RE,
  DAY_MS,
  DEFAULT_RETENTION_DAYS,
  FLUSH_INTERVAL_MS,
  LEDGER_KINDS,
  MAX_BUFFERED,
  clampField,
  clampRetentionDays,
  dayKey,
  dayStart,
  finiteNumber,
} from './ledger-record.mjs';
import { parseRecords } from './ledger-read.mjs';

export * from './ledger-record.mjs';
export * from './ledger-read.mjs';
export * from './ledger-stats.mjs';
export * from './ledger-records.mjs';
export * from './ledger-export.mjs';
export * from './ledger-sign.mjs';

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
    /**
     * @type {Promise<boolean>|null} serialises overlapping flushes. It holds
     * whatever `flush()` returns, which is `_flushNow()`'s "were bytes
     * written" — it was annotated `Promise<void>` while `flush()` documented
     * and stored a `Promise<boolean>` (WP-22).
     */
    this._writing = null;

    /**
     * Session ids already present in the current day's file. Rule 3's
     * dedup: a restart inside one day must not look like a new floor.
     * @type {Set<string>}
     */
    this._seen = new Set();
    this._seenDay = '';

    /**
     * Today's token deltas, per project, kept as they are recorded (WP-26).
     *
     * The room plate's payroll line is "what this room has cost TODAY", and
     * the only place that number exists is the day's `tokens` records. Reading
     * the day file back on every snapshot to re-derive it would be a file read
     * per frame for a number this class watches go past anyway, so it is
     * tallied here instead: seeded from the day file by `prime()`, added to by
     * `record()`, and thrown away at the day roll.
     *
     * Still measurement and still derived — this holds no ack state, and
     * losing it costs one line on one plate until the next scan.
     * @type {Map<string, {tokens:number, cache:number}>}
     */
    this._today = new Map();
    this._todayDay = '';

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
    this._today = new Map();
    this._todayDay = day;
    for (const rec of parseRecords(raw)) {
      if (rec.sessionId) this._seen.add(rec.sessionId);
      if (rec.kind === 'tokens') this._noteTokens(rec, day);
    }
  }

  /**
   * Add one `tokens` record to today's per-project tally.
   *
   * Only forward movement counts. A negative delta is a session's total going
   * DOWN, which happens when a transcript is truncated or a scan reads a
   * shorter file than the last one — it is not money coming back, and letting
   * it subtract would make a room's day cheaper because a log rotated.
   *
   * @param {{projectKey?:string, delta?:number, cacheDelta?:number}} rec
   * @param {string} day
   */
  _noteTokens(rec, day) {
    if (day !== this._todayDay) {
      this._today = new Map();
      this._todayDay = day;
    }
    const key = String(rec.projectKey || 'unknown');
    const delta = Math.max(0, finiteNumber(rec.delta) ?? 0);
    const cache = Math.max(0, finiteNumber(rec.cacheDelta) ?? 0);
    if (delta === 0 && cache === 0) return;
    const cur = this._today.get(key) || { tokens: 0, cache: 0 };
    cur.tokens += delta;
    cur.cache += cache;
    this._today.set(key, cur);
  }

  /**
   * What each project has spent tokens on since local midnight.
   *
   * A plain object so a caller can hand it straight to a snapshot. Empty when
   * the day has no `tokens` records yet, which is the signal the room plate
   * uses to fall back to the session totals rather than claiming a project
   * did nothing today.
   *
   * @param {number} [now]
   * @returns {Record<string, {tokens:number, cache:number}>}
   */
  todayTokens(now = this._now()) {
    const day = dayKey(now);
    if (day !== this._todayDay) {
      this._today = new Map();
      this._todayDay = day;
    }
    /** @type {Record<string, {tokens:number, cache:number}>} */
    const out = {};
    for (const [key, v] of this._today) out[key] = { tokens: v.tokens, cache: v.cache };
    return out;
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
      if (kind === 'tokens') this._noteTokens(rec, dayKey(t));
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
