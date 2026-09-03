/**
 * The Claude Code desktop app's own session store.
 *
 * The app keeps one small JSON file per session at
 * `%APPDATA%/Claude/claude-code-sessions/<install>/<profile>/local_<id>.json`,
 * holding the metadata the app's sidebar shows. Two fields matter here:
 *
 *   - `isArchived` — the user archived the session in the app. DeckHQ reads
 *     this as "let go", and un-archiving as "rehired".
 *   - `cliSessionId` — the join key. The app's own `sessionId` is
 *     `local_<uuid>` and is NOT the transcript's name; the transcript is
 *     `<cliSessionId>.jsonl` under `~/.claude/projects/`. Everything else in
 *     DeckHQ is keyed by that id, so this is the only usable link between the
 *     two stores. Verified on this machine: 43 of 51 app sessions join to a
 *     transcript, 14 of those archived.
 *
 * This is a read-only observation of a store DeckHQ does not own, so it is
 * defensive throughout: a missing directory, an unreadable file or a JSON
 * parse failure yields no entry rather than an error. The app is free to
 * change this format; if it does, the archive mapping quietly goes empty and
 * everything else still works.
 *
 * ## Why there is a cache in here
 *
 * `scanSessions()` calls this once per poll, forever, and the store on the
 * reference machine is 61 files and 8.8 MB. Reading and parsing all of it
 * every 5 s cost 78 ms on a quiet machine and up to 170 ms on a busy one — on
 * its own more than the whole < 50 ms warm-scan budget in
 * docs/02-ARCHITECTURE.md §8, and about 96% of what a warm scan spent
 * (docs/DEVIATIONS.md §78; §68 and §77 both measured it and left it).
 *
 * So each file's *parsed* result is kept, keyed by `(path, mtime, size)` —
 * the same invalidation rule `src/core/summary-cache.mjs` uses. Archiving a
 * session rewrites its file, so the flag still changes on the very next poll.
 *
 * This is deliberately NOT folded into the summary cache. That cache is keyed
 * by the *transcript's* mtime, and archiving never touches a transcript, so a
 * flag cached there would go stale until the conversation happened to change
 * — which for a finished session is never. `archived` drives `let_go`, and a
 * stale `true` re-fires an agent the user rehired, on every poll, forever
 * (docs/DEVIATIONS.md §46, §68). The flag has to stay keyed to the file that
 * actually carries it, and that file is this one.
 *
 * In memory only, and never persisted: the whole point of the ordering above
 * is that this answer is re-derived from the app's own store on every run.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Where the desktop app keeps its session metadata. Overridable for tests.
 * On Windows this is %APPDATA%; the app uses the same relative path under the
 * platform config dir elsewhere.
 */
export function desktopSessionsDir() {
  if (process.env.DECKHQ_DESKTOP_SESSIONS_DIR) {
    return process.env.DECKHQ_DESKTOP_SESSIONS_DIR;
  }
  const home = os.homedir();
  const appData =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : path.join(home, '.config'));
  return path.join(appData, 'Claude', 'claude-code-sessions');
}

/** Depth guard: the real layout is <install>/<profile>/<file>.json. */
const MAX_DEPTH = 4;

/** Sanity cap so a pathological directory cannot stall a poll. */
const MAX_FILES = 5000;

/**
 * Every `*.json` under `dir`, to a bounded depth. Never throws.
 * @param {string} dir
 * @param {number} [depth]
 * @param {string[]} [out]
 * @returns {string[]}
 */
function collectJson(dir, depth = 0, out = []) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJson(full, depth + 1, out);
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

/**
 * @typedef {object} DesktopSession
 * @property {boolean} archived
 * @property {string} [title]  the title the app's sidebar shows
 */

/**
 * One file's parsed result, plus the (mtime, size) it was parsed from.
 * @typedef {object} CacheEntry
 * @property {number} mtimeMs
 * @property {number} size
 * @property {string|null} cli  null when the file held nothing joinable
 * @property {DesktopSession|null} session
 */

/** @type {Map<string, CacheEntry>} */
const cache = new Map();

/**
 * Counters, for tests and for anyone measuring. Deliberately not surfaced in
 * the product — `reads` is the only one that costs anything, and it is the
 * number of files actually opened.
 */
export const desktopCacheStats = { hits: 0, misses: 0, reads: 0, evicted: 0 };

/** Drop everything held. A test seam; nothing in the product calls it. */
export function clearDesktopCache() {
  cache.clear();
  desktopCacheStats.hits = 0;
  desktopCacheStats.misses = 0;
  desktopCacheStats.reads = 0;
  desktopCacheStats.evicted = 0;
}

/** How many files the cache is holding a parsed result for. */
export function desktopCacheSize() {
  return cache.size;
}

/**
 * Read one file and return the cache entry for it, stamped with the
 * `(mtime, size)` it was read at — or null if it could not be opened at all.
 *
 * The stamp comes from `fstat` on the handle this is already opening, not
 * from a separate `statSync`, and that is a measured decision: on a cold
 * metadata cache a second path lookup per file cost 30–50 ms across the
 * store's 61 files, handing back on a process's first scan much of what the
 * cache saves on every later one (docs/DEVIATIONS.md §78). A miss has to open
 * the file regardless, so it may as well ask the handle.
 *
 * Never throws. An unreadable, foreign or mid-write file yields an entry with
 * `cli: null`, which is "no entry" — exactly what this file did before it had
 * a cache — and that verdict is cached too, so a store full of files this
 * adapter cannot use is not re-parsed on every poll forever.
 *
 * @param {string} file
 * @returns {CacheEntry|null}
 */
function readRecord(file) {
  desktopCacheStats.reads += 1;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return null; // gone, or locked; nothing to stamp, so nothing to cache
  }
  try {
    // fstat BEFORE the read, never after. Stamp-then-read can only attribute
    // *new* content to an *old* stamp, which the next poll re-reads anyway;
    // read-then-stamp attributes old content to the new stamp and pins it in
    // the cache for good.
    const stat = fs.fstatSync(fd);
    const base = { mtimeMs: stat.mtimeMs, size: stat.size, cli: null, session: null };
    let rec;
    try {
      rec = JSON.parse(fs.readFileSync(fd, 'utf8'));
    } catch {
      return base; // unreadable or caught mid-write
    }
    if (!rec || typeof rec !== 'object') return base;
    const cli = rec.cliSessionId;
    if (typeof cli !== 'string' || !cli) return base;
    return {
      ...base,
      cli,
      session: {
        archived: rec.isArchived === true,
        title: typeof rec.title === 'string' && rec.title ? rec.title : undefined,
      },
    };
  } catch {
    return null;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* already closed, or never really open */
    }
  }
}

/**
 * Read the desktop app's view of every session, keyed by `cliSessionId` —
 * i.e. by the same id DeckHQ uses for a claude-code agent.
 *
 * Served per file from the cache above; a file whose mtime or size moved is
 * re-read before it is returned, never served stale.
 *
 * @returns {Map<string, DesktopSession>}
 */
export function readDesktopSessions() {
  /** @type {Map<string, DesktopSession>} */
  const out = new Map();
  const dir = desktopSessionsDir();
  /** @type {Set<string>} */
  const seen = new Set();

  for (const file of collectJson(dir)) {
    const cached = cache.get(file);
    /** @type {CacheEntry|null} */
    let entry = null;

    if (cached) {
      // A stat is only worth paying for when there is something to compare it
      // against. With nothing cached the file has to be opened anyway, and
      // `readRecord` takes the stamp off that handle instead — so a cold run
      // does one path lookup per file, exactly as it did before the cache.
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        cache.delete(file); // vanished between the listing and here
        continue;
      }
      if (cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        desktopCacheStats.hits += 1;
        entry = cached;
      }
    }

    if (!entry) {
      desktopCacheStats.misses += 1;
      entry = readRecord(file);
      if (!entry) continue; // could not be opened; nothing to remember it by
      cache.set(file, entry);
    }

    seen.add(file);
    if (!entry.cli || !entry.session) continue;
    // A COPY, never the held object — the same rule as `SummaryCache.get`,
    // and for the same reason: a caller that mutated what came back would be
    // mutating the cache, and the field it would be mutating is `archived`.
    out.set(entry.cli, { ...entry.session });
  }

  // Files the app deleted lose their entry, so a daemon left running for
  // months cannot accumulate them. Skipped when the listing came back empty:
  // that is also what an unreadable or momentarily missing store directory
  // returns, and emptying a good cache on it buys nothing but a re-read on
  // the next poll. Same stance as `scanSessions`' `retain` call.
  if (seen.size) {
    for (const key of cache.keys()) {
      if (seen.has(key)) continue;
      cache.delete(key);
      desktopCacheStats.evicted += 1;
    }
  }

  return out;
}
