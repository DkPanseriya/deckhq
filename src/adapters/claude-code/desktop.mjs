/**
 * The Claude Code desktop app's own session store.
 *
 * The app keeps one JSON file per session at
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
 * everything else still works. The directory also holds JSON that is not a
 * session at all (a `scheduled-tasks.json` here); anything without a
 * `cliSessionId` is skipped.
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
 *
 * ## What the cache does not cover
 *
 * A cache hit costs nothing, but a miss still had to read and parse a whole
 * ~155 KB file, synchronously, on the event loop — so a process's first scan
 * barely moved in §78 (99.8–120.5 ms before, 94.2–100.0 ms after), and every
 * archive flip paid full price again. Two further bounds, added in
 * docs/DEVIATIONS.md §79: the reads are asynchronous, and a miss takes its
 * fields from a bounded head window rather than parsing the file. 99.1% of
 * every byte in these files is one field, `remoteMcpServersConfig`, which
 * this module has no use for.
 */

import fsp from 'node:fs/promises';
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
 * How much of a session file to read before giving up and taking the whole
 * thing. Measured across the 57 session files here, the LAST of the three
 * fields this module wants sits at byte 397 (median), 507 (p95), 626 (worst)
 * — the app writes them before the large ones. 8 KB is thirteen times the
 * worst case observed and still a twentieth of a typical file.
 */
const HEAD_BYTES = 8 * 1024;

/** Matches the transcript scan's read concurrency; same disk, same reasoning. */
const READ_CONCURRENCY = 8;

/** The only fields this module reads out of a session file. */
const WANTED = ['cliSessionId', 'isArchived', 'title'];

/**
 * Run `fn` over `items` with at most `limit` calls in flight, returning
 * results in the original order regardless of completion order. Ordering is
 * load-bearing: two files claiming the same `cliSessionId` must resolve to
 * the same winner on every poll, not to whichever read finished first — which
 * is what the sequential loop this replaced gave for free.
 * @template T,R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item:T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()),
  );
  return results;
}

/**
 * Every `*.json` under `dir`, to a bounded depth. Never throws.
 * @param {string} dir
 * @param {number} [depth]
 * @param {string[]} [out]
 * @returns {Promise<string[]>}
 */
async function collectJson(dir, depth = 0, out = []) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return out;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectJson(full, depth + 1, out);
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

// --- A JSON object's top-level fields, without building the object ---------
//
// `JSON.parse` on one of these files allocates a ~155 KB object graph to
// answer two questions. The scanner below walks the text instead: it records
// only the fields it was asked for, skips every other value without
// materialising it, and stops as soon as it has them all.

const TAB = 9,
  NEWLINE = 10,
  RETURN = 13,
  SPACE = 32,
  QUOTE = 34,
  COMMA = 44,
  COLON = 58,
  LBRACKET = 91,
  BACKSLASH = 92,
  RBRACKET = 93,
  LBRACE = 123,
  RBRACE = 125;

/** @param {number} c */
function isWs(c) {
  return c === SPACE || c === NEWLINE || c === RETURN || c === TAB;
}

/**
 * Index just past the string literal whose opening quote is at `i`,
 * or -1 if it does not close within `text`.
 * @param {string} text
 * @param {number} i
 */
function endOfString(text, i) {
  for (i++; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === BACKSLASH) i++;
    else if (c === QUOTE) return i + 1;
  }
  return -1;
}

/**
 * Index just past the value starting at `i`, or -1 if it does not end within
 * `text` — which, for a bounded head read, means "you need more bytes".
 * @param {string} text
 * @param {number} i
 */
function endOfValue(text, i) {
  const first = text.charCodeAt(i);
  if (first === QUOTE) return endOfString(text, i);
  if (first === LBRACE || first === LBRACKET) {
    let depth = 0;
    for (; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === QUOTE) {
        const end = endOfString(text, i);
        if (end < 0) return -1;
        i = end - 1; // the loop's i++ steps past the closing quote
      } else if (c === LBRACE || c === LBRACKET) depth++;
      else if (c === RBRACE || c === RBRACKET) {
        if (--depth === 0) return i + 1;
      }
    }
    return -1;
  }
  // A number, `true`, `false` or `null`: ends at the first structural
  // character. Running off the end means the literal itself may be cut short.
  for (; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === COMMA || c === RBRACE || c === RBRACKET || isWs(c)) return i;
  }
  return -1;
}

/**
 * The `wanted` fields of the JSON object in `text`, read at the TOP LEVEL
 * only — a `cliSessionId` nested inside some other object is not this
 * session's id and must not be mistaken for it. The app's own
 * `backgroundTaskSuggestions` does carry nested session records, so a regex
 * over the text would take the wrong one.
 *
 * Returns null when `text` cannot answer: it is not an object, it is cut off
 * before the object closes, or it is shaped in some way this scanner does not
 * follow. Null means "read more, or fall back", never "no such field" — a
 * complete object simply missing a field returns an object without that key.
 *
 * @param {string} text
 * @param {string[]} wanted
 * @returns {Record<string, any> | null}
 */
function readTopLevelFields(text, wanted) {
  /** @type {Record<string, any>} */
  const out = Object.create(null);
  let left = wanted.length;
  let i = 0;
  const n = text.length;

  while (i < n && isWs(text.charCodeAt(i))) i++;
  if (text.charCodeAt(i) !== LBRACE) return null;
  i++;

  for (;;) {
    while (i < n && isWs(text.charCodeAt(i))) i++;
    if (i >= n) return null;
    if (text.charCodeAt(i) === RBRACE) return out; // object closed cleanly
    if (text.charCodeAt(i) !== QUOTE) return null;

    const keyEnd = endOfString(text, i);
    if (keyEnd < 0) return null;
    // The raw key text. An escaped key would not match a name in `wanted`,
    // which costs nothing: none of the three are spellable with escapes.
    const key = text.slice(i + 1, keyEnd - 1);
    i = keyEnd;

    while (i < n && isWs(text.charCodeAt(i))) i++;
    if (text.charCodeAt(i) !== COLON) return null;
    i++;
    while (i < n && isWs(text.charCodeAt(i))) i++;
    if (i >= n) return null;

    const valueStart = i;
    const valueEnd = endOfValue(text, i);
    if (valueEnd < 0) return null;
    if (!(key in out) && wanted.includes(key)) {
      try {
        out[key] = JSON.parse(text.slice(valueStart, valueEnd));
      } catch {
        return null; // not the shape we assumed; let the caller fall back
      }
      if (--left === 0) return out; // everything asked for; stop scanning
    }
    i = valueEnd;

    while (i < n && isWs(text.charCodeAt(i))) i++;
    if (i >= n) return null;
    const c = text.charCodeAt(i);
    if (c === COMMA) {
      i++;
      continue;
    }
    if (c === RBRACE) return out;
    return null;
  }
}

/**
 * The scanner, exposed for tests only. Nothing in the product calls it: the
 * product goes through `readDesktopSessions`, whose `fullReads` counter shows
 * which path answered. This exists so the three ways a head window can end
 * mid-value — inside a string, inside a number, on a trailing escape — can be
 * pinned as "answer null, never guess" without building a file for each.
 * @param {string} text
 * @param {string[]} [wanted]
 */
export function _scanTopLevelFields(text, wanted = WANTED) {
  return readTopLevelFields(text, wanted);
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
 * number of files actually opened. `fullReads` is the subset of those that
 * could not be answered from the head window and had to take the whole file.
 */
export const desktopCacheStats = { hits: 0, misses: 0, reads: 0, fullReads: 0, evicted: 0 };

/** Drop everything held. A test seam; nothing in the product calls it. */
export function clearDesktopCache() {
  cache.clear();
  desktopCacheStats.hits = 0;
  desktopCacheStats.misses = 0;
  desktopCacheStats.reads = 0;
  desktopCacheStats.fullReads = 0;
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
 * from a separate `stat`, and that is a measured decision: on a cold
 * metadata cache a second path lookup per file cost 30–50 ms across the
 * store's 61 files, handing back on a process's first scan much of what the
 * cache saves on every later one (docs/DEVIATIONS.md §78). A miss has to open
 * the file regardless, so it may as well ask the handle — and the head read
 * below comes off that same handle for the same reason.
 *
 * Never throws. An unreadable, foreign or mid-write file yields an entry with
 * `cli: null`, which is "no entry" — exactly what this file did before it had
 * a cache — and that verdict is cached too, so a store full of files this
 * adapter cannot use is not re-parsed on every poll forever.
 *
 * @param {string} file
 * @returns {Promise<CacheEntry|null>}
 */
async function readRecord(file) {
  desktopCacheStats.reads += 1;
  let handle;
  try {
    handle = await fsp.open(file, 'r');
  } catch {
    return null; // gone, or locked; nothing to stamp, so nothing to cache
  }
  try {
    // fstat BEFORE the read, never after. Stamp-then-read can only attribute
    // *new* content to an *old* stamp, which the next poll re-reads anyway;
    // read-then-stamp attributes old content to the new stamp and pins it in
    // the cache for good.
    const stat = await handle.stat();
    const base = { mtimeMs: stat.mtimeMs, size: stat.size, cli: null, session: null };

    // Positional reads, so the handle's own offset never moves and the
    // fallback below starts from byte 0 whatever the head read did.
    const window = Math.min(stat.size, HEAD_BYTES);
    const head = await readAt(handle, window);
    if (head === null) return base;

    // A multi-byte character split by the window boundary decodes to a
    // replacement character, which the scanner reads as unparseable text at
    // the end of the window — i.e. as "read more", which is the right answer.
    let rec = readTopLevelFields(head, WANTED);
    if (rec === null && window < stat.size) {
      // The fields sit past the head window, or the file is shaped in a way
      // the scanner does not follow. Neither is observed on this machine's
      // store; pay for the whole file rather than lose the session.
      desktopCacheStats.fullReads += 1;
      const whole = await readAt(handle, stat.size);
      if (whole === null) return base;
      rec = readTopLevelFields(whole, WANTED);
      if (rec === null) {
        // Last resort on a store DeckHQ does not own: anything the scanner
        // cannot read but `JSON.parse` can should still count, so the scanner
        // can only ever be slower than what it replaced, never blinder.
        try {
          rec = JSON.parse(whole);
        } catch {
          return base; // unreadable or caught mid-write
        }
      }
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
    await handle.close().catch(() => {
      /* already closed, or never really open */
    });
  }
}

/**
 * `bytes` from the start of an open handle, decoded as UTF-8, or null if the
 * read failed. Positional, so the handle's offset is left where it was.
 * @param {import('node:fs/promises').FileHandle} handle
 * @param {number} bytes
 * @returns {Promise<string|null>}
 */
async function readAt(handle, bytes) {
  if (bytes <= 0) return '';
  try {
    const buf = Buffer.allocUnsafe(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.toString('utf8', 0, bytesRead);
  } catch {
    return null;
  }
}

/**
 * Read the desktop app's view of every session, keyed by `cliSessionId` —
 * i.e. by the same id DeckHQ uses for a claude-code agent.
 *
 * Served per file from the cache above; a file whose mtime or size moved is
 * re-read before it is returned, never served stale.
 *
 * @returns {Promise<Map<string, DesktopSession>>}
 */
export async function readDesktopSessions() {
  const files = await collectJson(desktopSessionsDir());

  const entries = await mapWithConcurrency(files, READ_CONCURRENCY, async (file) => {
    const cached = cache.get(file);
    if (cached) {
      // A stat is only worth paying for when there is something to compare it
      // against. With nothing cached the file has to be opened anyway, and
      // `readRecord` takes the stamp off that handle instead — so a cold run
      // does one path lookup per file, exactly as it did before the cache.
      let stat;
      try {
        stat = await fsp.stat(file);
      } catch {
        cache.delete(file); // vanished between the listing and here
        return null;
      }
      if (cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        desktopCacheStats.hits += 1;
        return { file, entry: cached };
      }
    }

    desktopCacheStats.misses += 1;
    const entry = await readRecord(file);
    if (!entry) return null; // could not be opened; nothing to remember it by
    cache.set(file, entry);
    return { file, entry };
  });

  /** @type {Map<string, DesktopSession>} */
  const out = new Map();
  /** @type {Set<string>} */
  const seen = new Set();
  // In listing order, not completion order: see `mapWithConcurrency`.
  for (const result of entries) {
    if (!result) continue;
    seen.add(result.file);
    const { entry } = result;
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
