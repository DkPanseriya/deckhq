/**
 * The persistent scan cache: parsed session summaries, keyed by
 * `(path, mtime, size)`, kept across daemon restarts.
 *
 * ## Why
 *
 * A cold scan is CPU-bound JSON parsing of every transcript on the machine —
 * 0.8–1.4 s for 66 sessions on the reference machine, and it grows linearly
 * with the session count (docs/DEVIATIONS.md §11, §68). The in-memory cache
 * that already existed removed that cost from every poll but not from the
 * first one, so every daemon start paid it again and the user watched a blank
 * floor while it ran. Almost every transcript on disk is finished and can
 * never change again; only the live handful can. A file whose mtime and size
 * are both unchanged cannot have changed content in any way the parser would
 * see, so its summary from the previous run is still exactly right.
 *
 * ## The rules this file exists to keep
 *
 * 1. **It is an optimisation, not state.** A corrupt, truncated, unreadable,
 *    foreign or schema-mismatched file is discarded in silence and rebuilt.
 *    It must never prevent startup and must never reach the user as an error.
 *    Nothing here is user-owned, so nothing here can violate the product
 *    invariant by being wrong — it can only be slow.
 * 2. **It never changes what the user sees.** A cache hit must be
 *    indistinguishable from a fresh parse. That is asserted directly in the
 *    tests: a scan served from this cache is deep-equal to an uncached scan.
 * 3. **Copies in, copies out.** Callers must never be handed the object this
 *    map is holding. See `get`/`set` — this is load-bearing, not hygiene:
 *    docs/DEVIATIONS.md §46 has the adapter stamp the desktop app's `archived`
 *    flag onto each summary *after* the cache, precisely so a cached summary
 *    cannot hold a stale one. Handing out the stored object let that stamp
 *    land in the cache; persisting the cache would then have carried a stale
 *    archive flag across restarts, and an archive flag drives `let_go`.
 * 4. **Bounded.** Entries for files that no longer exist are evicted, and the
 *    file is capped by entry count and by bytes — the least recently active
 *    entries are dropped first, since dropping one costs a re-parse and
 *    nothing else.
 *
 * Written atomically (temp file + rename), the same discipline as
 * `src/core/store.mjs`: a half-written cache would be a corrupt cache, and
 * while a corrupt cache is survivable it is still a wasted scan.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * Bumping this discards every cache file on the next start rather than
 * migrating it. Migration code for a derived, re-computable file is pure
 * liability: the rebuild costs one slow scan, and a migration bug costs
 * wrong data on the floor. Bump this whenever `parseSummary`'s output shape
 * or meaning changes.
 */
export const CACHE_SCHEMA_VERSION = 1;

/** Hard ceiling on entries kept. Well past any real machine's session count. */
const MAX_ENTRIES = 2000;

/** Hard ceiling on the serialised file. ~66 real sessions weigh ~50 KB. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Floor on how often the file is rewritten. The first write of a process is
 * always allowed (that is the cold scan, the one whose result is worth
 * keeping); after that a live session churning on a 5 s poll would otherwise
 * rewrite the whole file every 5 s forever.
 */
const MIN_WRITE_INTERVAL_MS = 30_000;

/** @param {unknown} v */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** @param {unknown} n */
function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * A copy of `summary` that cannot carry an archive state.
 *
 * Applied at BOTH ingress points — `set`, and every entry read off disk — and
 * that second one is the point. `set` stripping it means this build never
 * writes the flag down; stripping on load means no file we did not write can
 * make us read one. A cache file is not a trusted input: it can be
 * hand-edited, restored from a backup, copied between machines, or written by
 * a build that had the copy-out bug docs/DEVIATIONS.md §68 describes. Any of
 * those would otherwise hand a stale `archived: true` straight back to the
 * registry, which reads it as `let_go` and re-fires an agent the user rehired
 * — on every poll, forever, with nothing on the floor to say why.
 *
 * `archived` is the desktop app's to answer, freshly, on every scan.
 * @param {object} summary
 */
function withoutArchived(summary) {
  const copy = { ...summary };
  delete (/** @type {any} */ (copy).archived);
  return copy;
}

export class SummaryCache {
  /**
   * @param {string} file absolute path to this runtime's cache file
   * @param {{runtime?: string, maxEntries?: number, maxBytes?: number,
   *          minWriteIntervalMs?: number, schemaVersion?: number}} [opts]
   */
  constructor(file, opts = {}) {
    this.file = file;
    this.runtime = opts.runtime || '';
    this.maxEntries = opts.maxEntries ?? MAX_ENTRIES;
    this.maxBytes = opts.maxBytes ?? MAX_BYTES;
    this.minWriteIntervalMs = opts.minWriteIntervalMs ?? MIN_WRITE_INTERVAL_MS;
    this.schemaVersion = opts.schemaVersion ?? CACHE_SCHEMA_VERSION;

    /** @type {Map<string, {mtimeMs:number, size:number, summary:object}>} */
    this._entries = new Map();
    /** @type {Promise<void>|null} */
    this._loading = null;
    this._loaded = false;
    this._dirty = false;
    this._lastWriteAt = 0;

    /**
     * Counters, for tests and for anyone measuring. Deliberately not surfaced
     * anywhere in the interface: a cache the user has to think about is a
     * cache that has already failed.
     */
    this.stats = {
      hits: 0,
      misses: 0,
      loadedEntries: 0,
      discarded: /** @type {string|null} */ (null),
    };
  }

  /** How many entries are held in memory right now. */
  get size() {
    return this._entries.size;
  }

  /**
   * Read the cache file, once per process. Idempotent and never throws: every
   * failure path ends with an empty cache, which is exactly a cold start.
   * @returns {Promise<void>}
   */
  load() {
    if (this._loaded) return Promise.resolve();
    if (this._loading) return this._loading;
    this._loading = this._doLoad().finally(() => {
      this._loaded = true;
      this._loading = null;
    });
    return this._loading;
  }

  /** @param {string} why */
  _discard(why) {
    this._entries.clear();
    this.stats.discarded = why;
    // Deliberately NOT deleting the file here. The next successful scan
    // overwrites it atomically anyway, and unlinking gains nothing but one
    // more way for a permissions problem to throw on a start-up path.
  }

  async _doLoad() {
    let raw;
    try {
      raw = await fsp.readFile(this.file, 'utf8');
    } catch (err) {
      // Missing (the normal first run), unreadable, a directory, a permissions
      // problem — all the same answer: start empty. Only the file simply not
      // being there yet is not worth recording as a discard.
      this._entries.clear();
      if (!err || err.code !== 'ENOENT') this.stats.discarded = 'unreadable';
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this._discard('corrupt');
      return;
    }
    if (!isPlainObject(parsed)) {
      this._discard('shape');
      return;
    }
    if (parsed.version !== this.schemaVersion) {
      this._discard('version');
      return;
    }
    if (this.runtime && parsed.runtime !== this.runtime) {
      // A cache file belonging to another runtime cannot be interpreted by
      // this adapter's parser. Same treatment as a version bump.
      this._discard('runtime');
      return;
    }
    if (!isPlainObject(parsed.entries)) {
      this._discard('shape');
      return;
    }

    for (const [file, entry] of Object.entries(parsed.entries)) {
      // One malformed entry does not condemn the file: skip it and keep the
      // rest. It simply becomes a miss and is re-parsed.
      if (!isPlainObject(entry)) continue;
      if (!isFiniteNumber(entry.mtimeMs) || !isFiniteNumber(entry.size)) continue;
      if (!isPlainObject(entry.summary)) continue;
      if (typeof entry.summary.id !== 'string' || !entry.summary.id) continue;
      this._entries.set(file, {
        mtimeMs: entry.mtimeMs,
        size: entry.size,
        // Never trust a file we did not write to be free of an archive flag.
        summary: withoutArchived(entry.summary),
      });
    }
    this.stats.loadedEntries = this._entries.size;
  }

  /**
   * The summary for this exact (path, mtime, size), or undefined.
   *
   * Returns a shallow COPY. Rule 3 in the header: the adapter stamps the
   * desktop archive flag onto the summaries it returns, and that stamp must
   * never reach the stored object.
   *
   * @param {string} file
   * @param {number} mtimeMs
   * @param {number} size
   * @returns {object|undefined}
   */
  get(file, mtimeMs, size) {
    const entry = this._entries.get(file);
    if (!entry || entry.mtimeMs !== mtimeMs || entry.size !== size) {
      this.stats.misses += 1;
      return undefined;
    }
    this.stats.hits += 1;
    return { ...entry.summary };
  }

  /**
   * Store a freshly parsed summary.
   *
   * `archived` is stripped on the way in, and only ever set by the adapter on
   * the way out. See rule 3: the flag lives in the desktop app's store, not in
   * the transcript, so a cached copy of it would go stale the moment the user
   * archived something and stay stale until the conversation happened to
   * change — which for a finished session is never.
   *
   * @param {string} file
   * @param {number} mtimeMs
   * @param {number} size
   * @param {object} summary
   */
  set(file, mtimeMs, size, summary) {
    if (!isFiniteNumber(mtimeMs) || !isFiniteNumber(size) || !isPlainObject(summary)) return;
    this._entries.set(file, { mtimeMs, size, summary: withoutArchived(summary) });
    this._dirty = true;
  }

  /**
   * Drop every entry whose file is not in `files`, so the cache cannot grow
   * without bound on a machine that has been running for months. Callers pass
   * the set of transcripts that currently exist, not the set they intend to
   * read: an entry for a file that still exists but fell outside this scan's
   * window is worth keeping.
   * @param {Set<string>} files
   * @returns {number} how many were evicted
   */
  retain(files) {
    let evicted = 0;
    for (const key of this._entries.keys()) {
      if (files.has(key)) continue;
      this._entries.delete(key);
      evicted += 1;
    }
    if (evicted) this._dirty = true;
    return evicted;
  }

  /**
   * Keep the most recently active entries that fit inside both ceilings, drop
   * the rest, and return the object to serialise.
   *
   * "Most recently active" is the file's mtime, which is the only recency
   * signal available without re-reading the file. It is a poor proxy for true
   * conversation recency (docs/DEVIATIONS.md §11) but it is a perfectly good
   * proxy for "which entry is cheapest to lose".
   */
  _serialisable() {
    const entries = [...this._entries.entries()].sort((a, b) => b[1].mtimeMs - a[1].mtimeMs);

    /** @type {Record<string, {mtimeMs:number, size:number, summary:object}>} */
    const kept = {};
    /** @type {string[]} */
    const keptKeys = [];
    // Rough running total of the serialised size, so the ceiling is enforced
    // without stringifying the whole object once per candidate.
    let bytes = 128;
    for (const [file, entry] of entries) {
      if (keptKeys.length >= this.maxEntries) break;
      const cost = file.length + JSON.stringify(entry).length + 8;
      if (bytes + cost > this.maxBytes && keptKeys.length > 0) break;
      bytes += cost;
      kept[file] = entry;
      keptKeys.push(file);
    }

    if (keptKeys.length !== this._entries.size) {
      // Keep memory and disk saying the same thing. A dropped entry costs one
      // re-parse if that session is ever looked at again, and nothing else.
      const live = new Set(keptKeys);
      for (const key of this._entries.keys()) if (!live.has(key)) this._entries.delete(key);
    }

    return {
      version: this.schemaVersion,
      runtime: this.runtime,
      updatedAt: Date.now(),
      entries: kept,
    };
  }

  /**
   * Write the cache if anything changed, rate-limited. Never throws, never
   * reports: a cache that cannot be written costs one slow scan next time and
   * nothing else, and telling the user about it would be telling them about a
   * problem they neither caused nor can act on.
   *
   * @param {{force?: boolean, now?: number}} [opts]
   * @returns {Promise<boolean>} whether a write actually happened
   */
  async persist({ force = false, now = Date.now() } = {}) {
    if (!this._dirty) return false;
    if (!force && this._lastWriteAt && now - this._lastWriteAt < this.minWriteIntervalMs) {
      return false;
    }

    const payload = this._serialisable();
    const tmp = `${this.file}.tmp-${process.pid}`;
    try {
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      await fsp.writeFile(tmp, JSON.stringify(payload), 'utf8');
      await fsp.rename(tmp, this.file);
      this._dirty = false;
      this._lastWriteAt = now;
      return true;
    } catch {
      // Leave `_dirty` set so the next scan tries again, and clean up the
      // temp file if it was the rename that failed.
      try {
        await fsp.unlink(tmp);
      } catch {
        /* nothing to clean up */
      }
      return false;
    }
  }
}
