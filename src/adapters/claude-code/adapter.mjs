/**
 * Claude Code runtime adapter. Implements the `RuntimeAdapter` interface from
 * docs/02-ARCHITECTURE.md §2. All transcript parsing is delegated to
 * ./parse.mjs; nothing here reads a `.jsonl` line directly.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { agentId, splitAgentId } from '../../core/model.mjs';
import { cacheFileFor } from '../../core/paths.mjs';
import { SummaryCache } from '../../core/summary-cache.mjs';
import {
  CLAUDE_DIR,
  PROJECTS_DIR,
  HEAD_BYTES,
  TAIL_BYTES,
  readHead,
  readTail,
  parseSummary,
  parseConversation,
} from './parse.mjs';
import * as hooksImpl from './hooks.mjs';
import { readDesktopSessions } from './desktop.mjs';
import { launchTerminal, trySpawnDetached } from '../../core/terminals.mjs';

const RUNTIME_ID = 'claude-code';

/**
 * Run `fn` over `items` with at most `limit` calls in flight at once,
 * returning results in the original order regardless of completion order.
 * @template T,R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item:T, index:number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}

/** @param {string} cmd */
function commandExists(cmd) {
  return new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    execFile(finder, [cmd], { windowsHide: true, timeout: 5000 }, (err) => resolve(!err));
  });
}

let availableCache = null;

/**
 * Is Claude Code present on this machine? Cheap, cached for the process
 * lifetime. True if `~/.claude/projects` exists (history to show) or the
 * `claude` binary resolves on PATH (a live roster is possible). Never throws.
 * @returns {Promise<boolean>}
 */
async function available() {
  if (availableCache !== null) return availableCache;
  availableCache = await computeAvailable();
  return availableCache;
}

async function computeAvailable() {
  try {
    if (fs.existsSync(PROJECTS_DIR)) return true;
  } catch {
    // fall through to the binary check
  }
  try {
    return await commandExists('claude');
  } catch {
    return false;
  }
}

/**
 * Ask Claude Code itself, via its supported CLI surface, which sessions are
 * alive right now. This spawns the whole CLI, so it is the expensive half of
 * `liveSessions()` below and is called only when that decides a fresh answer
 * is actually needed. Never throws — a missing/failing CLI resolves to [].
 * @returns {Promise<import('../../core/model.mjs').LiveSession[]>}
 */
function probeLiveSessions() {
  return new Promise((resolve) => {
    execFile(
      'claude',
      ['agents', '--json'],
      { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          resolve([]);
          return;
        }
        if (!Array.isArray(parsed)) {
          resolve([]);
          return;
        }
        const out = [];
        for (const item of parsed) {
          if (!item || typeof item !== 'object' || typeof item.sessionId !== 'string') continue;
          out.push({
            id: agentId(RUNTIME_ID, item.sessionId),
            runtime: RUNTIME_ID,
            cwd: typeof item.cwd === 'string' ? item.cwd : '',
            name: typeof item.name === 'string' ? item.name : null,
            startedAt: typeof item.startedAt === 'number' ? item.startedAt : null,
            pid: typeof item.pid === 'number' ? item.pid : null,
          });
        }
        resolve(out);
      },
    );
  });
}

/**
 * How stale the cached live roster is allowed to get before the CLI is asked
 * again. See `liveSessions` for why this is not the poll interval.
 *
 * Chosen against the budget rather than by taste. One probe costs 406-984 ms
 * of child CPU (609 ms median), so a probe every 30 s would still spend ~2%
 * of a core at idle — the whole of docs/02-ARCHITECTURE.md §8's allowance,
 * on one question. At 60 s it is ~1%, and the extra 30 s of staleness lands
 * only on the case `noteScanEvidence` cannot see anyway: a session that is
 * alive and writing nothing.
 */
const LIVE_PROBE_TTL_MS = 60_000;

/**
 * Floor on how often disk evidence may drag a probe forward (below). Without
 * it, a transcript that is being appended to by something the roster never
 * lists — a `claude -p` run, a subagent, an editor touching the file — would
 * force a spawn on every single poll, which is the behaviour this cache
 * exists to remove.
 */
const LIVE_PROBE_MIN_INTERVAL_MS = 10_000;

/**
 * The last answer `probeLiveSessions()` gave, and when. `ids` is the same
 * roster as a set, kept alongside so the scan can test membership without
 * rebuilding it every poll.
 * @type {{at:number, sessions:import('../../core/model.mjs').LiveSession[], ids:Set<string>}}
 */
let liveProbe = { at: 0, sessions: [], ids: new Set() };

/** Set by `scanSessions` when the transcripts disagree with `liveProbe`. */
let liveProbeForced = false;

/**
 * Is this pid still a running process? `signal 0` delivers nothing; it only
 * runs the permission and existence checks, so this is a syscall and no more
 * — measured at 0.055 ms for a whole roster, against 400-1000 ms of child CPU
 * for one CLI spawn.
 *
 * `EPERM` means the process exists but is not ours to signal, which is alive,
 * not dead. Only `ESRCH` (and anything else unexpected) is treated as gone.
 * A non-positive pid is never passed through: on POSIX `kill(0, sig)` signals
 * the entire process group.
 *
 * Verified on Windows, where libuv answers signal 0 with `OpenProcess` plus
 * `GetExitCodeProcess` rather than a real signal (docs/DEVIATIONS.md §82): a
 * pid that has exited, a pid that never existed, and a child that has exited
 * while this process still holds its handle all throw `ESRCH`; the protected
 * System process (pid 4) throws `EPERM`. So the same two-way reading holds on
 * every platform this runs on.
 *
 * What this cannot tell is WHICH process holds the pid. A session that exits
 * and whose pid the OS hands to some other process inside one poll interval
 * reads alive until the next probe replaces the roster — see `liveSessions`
 * for the size of that window and why it is accepted rather than closed.
 * @param {number} pid
 * @returns {boolean}
 */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return !!err && err.code === 'EPERM';
  }
}

/** Copy out, so a caller holding a roster can never write into the cache. */
function copyRoster(sessions) {
  return sessions.map((s) => ({ ...s }));
}

/**
 * Sessions Claude Code reports as currently alive. Never throws.
 *
 * `probeLiveSessions()` above boots the entire Claude Code CLI to answer
 * this. Measured on this machine, per call: 521-721 ms median wall, and
 * 406-984 ms of the child's OWN processor time (609 ms median). The daemon
 * polls every 5 s forever, so calling it per poll spent ~12% of a core on a
 * question whose answer almost never changes — six times the idle budget in
 * docs/02-ARCHITECTURE.md §8, and out of process, so nothing measuring this
 * daemon's own CPU could see it. See docs/DEVIATIONS.md §77.
 *
 * So the probe is cached, and the cache is corrected between probes by the
 * two things that are cheap:
 *
 *   - **A session that exits** is caught by a pid check on every call, so a
 *     dead session still leaves the roster within one poll, exactly as
 *     before. This is the common transition and it costs nothing.
 *   - **A session that comes alive** is caught by `scanSessions`: a
 *     transcript with activity newer than the last probe, belonging to a
 *     session the roster does not list, drags the next probe forward instead
 *     of waiting out the TTL. This matters on the degraded path, where the
 *     poll is the only liveness signal there is (§4.2); with hooks installed
 *     `SessionStart` already reports it directly and authoritatively.
 *
 * What is left stale is the one case neither covers: a session that starts
 * or resumes and then writes nothing at all — a terminal opened and left
 * sitting at the prompt. It reads as `ended` for up to `LIVE_PROBE_TTL_MS`.
 * That is the price, and it is bounded, self-correcting, and cannot move any
 * user-owned state: `live` is observed, and `for_review` is sticky through a
 * liveness loss either way (see the Registry's invariant).
 *
 * An entry with no pid is kept until the next probe. Nothing cheap can say
 * otherwise, and the probe is what is authoritative for it.
 *
 * A pid the check has once called dead is retired for good: it leaves the
 * cached roster and nothing short of the next probe can bring that session
 * back, so a pid the OS later hands to some other process cannot revive it.
 * The one exposure that leaves is a session that exits AND has its pid reused
 * inside a single poll interval, before any check saw it dead — that impostor
 * reads alive until the TTL probe. Measured on the reference machine (Windows
 * 11), a pid recurs only after 123–155 further process creations, so it takes
 * ~25 spawns a second during the 5 s the check is blind; and `live` is an
 * observation, never a user-owned state, so the worst outcome is a desk drawn
 * occupied for up to 60 s. No cheap cross-platform identity for a pid exists
 * without spawning — the exact cost this cache removes — so the window is
 * accepted and recorded (docs/DEVIATIONS.md §82) rather than closed. With
 * hooks installed it does not arise at all: `SessionEnd` is authoritative and
 * the registry prefers it over this roster.
 *
 * @param {{probe?: () => Promise<import('../../core/model.mjs').LiveSession[]>,
 *          now?: number, alive?: (pid:number) => boolean}} [opts] test seams,
 *   in the same shape as `openInApp`'s: `probe` stands in for the CLI spawn so
 *   a test can count how many times it actually happened, `now` stands in for
 *   the clock so the TTL can be crossed without sleeping through it, and
 *   `alive` stands in for the pid check so a pid can be made to die and come
 *   back on cue. The daemon passes none of them.
 * @returns {Promise<import('../../core/model.mjs').LiveSession[]>}
 */
async function liveSessions(opts = {}) {
  const probe = opts.probe || probeLiveSessions;
  const isAlive = opts.alive || pidAlive;
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const age = now - liveProbe.at;
  const due =
    liveProbe.at === 0 ||
    age >= LIVE_PROBE_TTL_MS ||
    (liveProbeForced && age >= LIVE_PROBE_MIN_INTERVAL_MS);

  if (due) {
    liveProbeForced = false;
    const sessions = await probe();
    // Stamped after the probe returns, not before it: the roster describes
    // the moment the CLI answered, and `scanSessions` compares transcript
    // timestamps against exactly that moment.
    const at = typeof opts.now === 'number' ? opts.now : Date.now();
    liveProbe = { at, sessions, ids: new Set(sessions.map((s) => s.id)) };
    return copyRoster(sessions);
  }

  const alive = liveProbe.sessions.filter((s) => s.pid == null || isAlive(s.pid));
  if (alive.length !== liveProbe.sessions.length) {
    liveProbe.sessions = alive;
    liveProbe.ids = new Set(alive.map((s) => s.id));
  }
  return copyRoster(alive);
}

/**
 * Does this scan's evidence contradict the cached roster? A session whose
 * transcript has moved since the last probe, and which that probe did not
 * list, is either newly alive or newly resumed — either way the roster is
 * out of date and the next `liveSessions()` should pay for a fresh one.
 *
 * Only ever sets the flag. Clearing it is `liveSessions`' job, so a forced
 * probe that the minimum interval defers is not lost.
 * @param {import('../../core/model.mjs').SessionSummary[]} summaries sorted
 *   newest-first, so the common case exits on the first entry.
 */
function noteScanEvidence(summaries) {
  if (!liveProbe.at || liveProbeForced) return;
  for (const s of summaries) {
    if ((s.lastActivityAt || 0) <= liveProbe.at) break; // sorted: nothing newer follows
    if (!liveProbe.ids.has(s.id)) {
      liveProbeForced = true;
      return;
    }
  }
}

/**
 * Drop the cached live roster. Test seam only — the daemon never needs this,
 * because the cache is keyed on time and self-corrects.
 */
export function _resetLiveProbeCache() {
  liveProbe = { at: 0, sessions: [], ids: new Set() };
  liveProbeForced = false;
}

/**
 * Every top-level session file directly under a project directory:
 * `~/.claude/projects/<slug>/<sessionId>.jsonl`. Deliberately not recursive —
 * subagent workflow transcripts live several levels deeper and are not
 * top-level sessions (CONTRACTS.md: "Do not reverse-engineer the cwd from
 * the directory name — read cwd from a record.").
 * @returns {Promise<{file:string, sessionId:string, mtimeMs:number}[]>}
 */
async function listSessionFiles() {
  let projectDirs;
  try {
    projectDirs = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const perDir = await Promise.all(
    projectDirs
      .filter((d) => d.isDirectory())
      .map(async (d) => {
        const dirPath = path.join(PROJECTS_DIR, d.name);
        let files;
        try {
          files = await fsp.readdir(dirPath, { withFileTypes: true });
        } catch {
          return [];
        }
        const out = [];
        for (const f of files) {
          if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
          const full = path.join(dirPath, f.name);
          let stat;
          try {
            stat = await fsp.stat(full);
          } catch {
            continue;
          }
          out.push({
            file: full,
            sessionId: f.name.slice(0, -'.jsonl'.length),
            mtimeMs: stat.mtimeMs,
            // Size pairs with mtime to invalidate the summary cache.
            size: stat.size,
          });
        }
        return out;
      }),
  );

  return perDir.flat();
}

/**
 * Every Claude Code session on disk, newest first, bounded by `opts`.
 * @param {{maxAgeDays:number, limit:number}} opts
 * @returns {Promise<import('../../core/model.mjs').SessionSummary[]>}
 */
/**
 * Parsed-summary cache, keyed by file path and invalidated by (mtime, size).
 *
 * The daemon re-scans every few seconds, forever, on a machine where a single
 * transcript reaches 74 MB. Re-reading and re-parsing every session on every
 * poll cost roughly 100 MB of file I/O every 5 s and pinned about a fifth of
 * a core — an order of magnitude over the idle-CPU budget in
 * docs/02-ARCHITECTURE.md §8. Almost every session on disk is finished and
 * will never change again; only the handful that are live do.
 *
 * A file whose mtime and size are both unchanged cannot have changed content
 * in any way this parser would see, so its previous summary is reused.
 *
 * It persists to `~/.deckhq/cache/claude-code.json`, so the *first* scan after
 * a daemon start is served from it too and the floor is populated immediately
 * rather than after a second of parsing. See src/core/summary-cache.mjs for
 * why a corrupt one is discarded in silence, and for the copy-in/copy-out rule
 * that keeps the desktop archive flag out of it (docs/DEVIATIONS.md §46).
 */
const summaryCache = new SummaryCache(cacheFileFor(RUNTIME_ID), { runtime: RUNTIME_ID });

/**
 * Measured: the cold scan is dominated by JSON parsing, not by disk, so
 * raising this above 8 bought no wall-clock time and did raise peak memory
 * (concurrency x TAIL_BYTES of live buffers). Left at 8 deliberately.
 */
const SCAN_CONCURRENCY = 8;

async function scanSessions({ maxAgeDays, limit }) {
  // Reading the cache file is a one-off per process and never throws; a
  // missing or unusable one simply leaves every lookup below a miss, which is
  // exactly the behaviour before it existed.
  const [all] = await Promise.all([listSessionFiles(), summaryCache.load()]);
  const cutoff = Date.now() - maxAgeDays * 86400_000;
  const candidates = all
    .filter((f) => f.mtimeMs >= cutoff)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);

  // Drop cache entries for transcripts that are no longer on disk, so neither
  // the map nor the file can grow without bound over a long-lived machine.
  // Measured against every file that EXISTS, not against this scan's
  // candidates: a session outside this call's age window or limit is still a
  // session, and evicting it would only buy a re-parse later.
  //
  // An empty listing is not evidence that every transcript was deleted — it is
  // also what an unreadable or momentarily missing projects directory returns.
  // Emptying the cache on that would throw away a perfectly good one and buy a
  // full cold scan next start, for nothing.
  if (all.length) summaryCache.retain(new Set(all.map((f) => f.file)));

  const summaries = await mapWithConcurrency(candidates, SCAN_CONCURRENCY, async (entry) => {
    const cached = summaryCache.get(entry.file, entry.mtimeMs, entry.size);
    if (cached) return cached;
    try {
      // The full 2 MB tail window is read deliberately, even though a few
      // hundred KB would be enough for state. Token totals are summed over
      // whatever is read, and a smaller window undersamples exactly the
      // largest sessions — which inverts the per-project comparison that
      // token accounting exists to answer (docs/01-PRODUCT.md F9). The cost
      // of this is paid once per file: the summary cache above means an
      // unchanged transcript is never re-read on later polls.
      const [head, tail] = await Promise.all([
        readHead(entry.file, HEAD_BYTES),
        readTail(entry.file, TAIL_BYTES),
      ]);
      const summary = parseSummary(head, tail, {
        id: entry.sessionId,
        file: entry.file,
        mtimeMs: entry.mtimeMs,
      });
      const prefixed = { ...summary, id: agentId(RUNTIME_ID, summary.id) };
      if (entry.size !== undefined) {
        summaryCache.set(entry.file, entry.mtimeMs, entry.size, prefixed);
      }
      return prefixed;
    } catch (err) {
      // A parse failure on one session must never fail the scan.
      // docs/02-ARCHITECTURE.md §2.1 / CONTRACTS.md rule 6.
      console.error(
        `[claude-code] failed to parse session ${entry.sessionId}:`,
        err && err.message ? err.message : err,
      );
      return null;
    }
  });

  // Everything that could change is now parsed, so this is the moment the
  // cache is worth keeping. Rate-limited and silent — see `persist`. Awaited
  // rather than fired and forgotten so a daemon killed straight after a scan
  // still leaves a usable cache behind; it only writes when a parse actually
  // happened, so a warm scan pays nothing for this line.
  await summaryCache.persist();

  // The desktop app's archive flag, joined on `cliSessionId`. Applied AFTER
  // the summary cache on purpose: archiving a session does not touch its
  // transcript, so a cached summary would keep a stale flag until the
  // conversation happened to change. Read once per scan, not per session.
  //
  // Persisting the cache makes that ordering sharper, not softer: the flag
  // would otherwise survive restarts, and `archived` drives `let_go`, so a
  // stale `true` would re-fire an agent the user had rehired on every poll,
  // forever. The stamp below therefore lands on summaries the cache hands out
  // by value — `SummaryCache.get` returns a copy and `set` strips `archived`
  // — so it can never reach the stored entry. Both halves are asserted.
  let desktop;
  try {
    desktop = await readDesktopSessions();
  } catch {
    desktop = null; // the app's own store; unreadable is not an error here
  }

  const out = summaries.filter((s) => s !== null);
  if (desktop && desktop.size) {
    for (const summary of out) {
      const meta = desktop.get(splitAgentId(summary.id).sessionId);
      if (meta) summary.archived = meta.archived;
    }
  }

  // File mtime (used above to pick which candidates are even worth reading,
  // since it's the only signal available before we've read anything) is not
  // a reliable proxy for true conversation recency: verified on this machine
  // that a large fraction of transcripts have an mtime that diverges from
  // their newest in-file timestamp by days to months (likely disturbed by
  // something outside Claude Code touching the file, e.g. an editor, backup
  // tool or sync client). Once parsed, we know the real answer, so the
  // result is re-sorted by the content-derived `lastActivityAt` before
  // returning — this is what "newest first" should mean to a caller.
  out.sort((a, b) => b.lastActivityAt - a.lastActivityAt);

  // Cheap by-product of a scan we were doing anyway: if a transcript has
  // moved since the cached live roster was taken and that roster does not
  // list its session, the roster is stale and the next `liveSessions()`
  // should re-probe rather than wait out its TTL. Reads the sorted list, so
  // it must come after the sort.
  noteScanEvidence(out);

  return out;
}

/**
 * Find the on-disk transcript file for a raw (unprefixed) session id by
 * checking each project directory. Never throws; returns null if not found.
 * @param {string} sessionId
 * @returns {Promise<string|null>}
 */
async function findSessionFile(sessionId) {
  let entries;
  try {
    entries = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(PROJECTS_DIR, entry.name, `${sessionId}.jsonl`);
    try {
      await fsp.access(candidate, fs.constants.R_OK);
      return candidate;
    } catch {
      // not in this project directory; keep looking
    }
  }
  return null;
}

/**
 * Full message list for one session, most recent last.
 * @param {string} id
 * @param {{maxMessages:number}} opts
 * @returns {Promise<import('../../core/model.mjs').Message[]>}
 */
async function conversation(id, { maxMessages } = {}) {
  const { sessionId } = splitAgentId(id);
  const file = await findSessionFile(sessionId);
  if (!file) return [];
  try {
    const tail = await readTail(file, TAIL_BYTES);
    return parseConversation(tail, { maxMessages });
  } catch {
    return [];
  }
}

/**
 * Send a turn into a session via `claude --resume <id> -p <text>`. Argument
 * list is always an argv array — never a shell string (docs §9).
 * @param {string} id
 * @param {string} text
 * @param {{cwd:string, timeoutMs:number}} opts
 * @returns {Promise<import('../../core/model.mjs').SendResult>}
 */
function send(id, text, { cwd, timeoutMs = 120_000 } = {}) {
  const { sessionId } = splitAgentId(id);
  return new Promise((resolve) => {
    execFile(
      'claude',
      ['--resume', sessionId, '-p', text, '--output-format', 'json'],
      {
        cwd,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        killSignal: 'SIGTERM',
      },
      (err, stdout) => {
        if (err) {
          if (err.killed || err.signal) {
            resolve({ ok: false, error: `claude timed out after ${timeoutMs}ms and was killed` });
          } else {
            resolve({ ok: false, error: err.message || 'claude exited with an error' });
          }
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          resolve({ ok: false, error: 'could not parse claude --output-format json output' });
          return;
        }
        if (parsed && parsed.is_error) {
          resolve({
            ok: false,
            error: typeof parsed.result === 'string' ? parsed.result : 'claude reported an error',
          });
          return;
        }
        resolve({ ok: true, text: typeof parsed?.result === 'string' ? parsed.result : '' });
      },
    );
  });
}

/**
 * Spawn an interactive terminal attached to this session.
 *
 * Which terminal, and the exact argv each one needs, is
 * `../../core/terminals.mjs`'s
 * job — this function's is only to name the command. The rule it enforces is
 * the one from `docs/DEVIATIONS.md` §28: the session id travels as one argv
 * element of `command` and nothing here builds a shell string out of it.
 *
 * @param {string} id
 * @param {string} cwd
 * @param {{terminal?: string}} [opts] `terminal` is the user's pinned
 *   emulator from settings (`auto` when they have not pinned one). The HTTP
 *   route passes it; a caller that does not gets detection.
 * @returns {Promise<void>}
 */
async function openInTerminal(id, cwd, opts = {}) {
  const { sessionId } = splitAgentId(id);
  await launchTerminal({
    command: ['claude', '--resume', sessionId],
    cwd,
    sessionId,
    prefix: 'resume',
    pin: opts.terminal,
  });
}

let appAvailableCache = null;

/**
 * Is a `claude://` URI handler registered on this machine — i.e. is the
 * Claude desktop app installed? Cached for the process lifetime, like
 * `available()` above.
 *
 * Checked via the Windows registry (`HKCU\SOFTWARE\Classes\claude`), which
 * is where a per-user protocol handler registration lives. macOS
 * (LaunchServices) and Linux (xdg-mime) detection has not been implemented
 * or verified on any machine this has run on, so both report false rather
 * than guess — a false negative here only hides the "Open in app" option;
 * a false positive would hand the user off to an app that cannot actually
 * receive the link.
 * @returns {Promise<boolean>}
 */
async function appAvailable() {
  if (appAvailableCache !== null) return appAvailableCache;
  appAvailableCache = await computeAppAvailable();
  return appAvailableCache;
}

/** @returns {Promise<boolean>} */
function computeAppAvailable() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', 'HKCU\\SOFTWARE\\Classes\\claude'],
      { windowsHide: true, timeout: 5000 },
      (err) => resolve(!err),
    );
  });
}

/**
 * Build the Claude desktop app's deep link to resume one session. Pure and
 * side-effect free on purpose, so it can be unit tested directly instead of
 * through a spawned process.
 *
 * Route found by reading the app's `app.asar`:
 * `claude://code/continue?session=<id>&source=<tag>`. `session=last` is
 * confirmed — it is what the app's own OS-launcher entry sends itself.
 * Whether `session=<uuid>` resolves *this specific* session is UNVERIFIED:
 * the route was found, not the code that consumes the parameter. If the app
 * does not honour an unrecognised session value, this still does no harm —
 * it just opens to whatever the app does by default, same as if no session
 * had been requested at all.
 * @param {string} sessionId
 * @returns {string}
 */
export function buildAppResumeUri(sessionId) {
  return `claude://code/continue?session=${encodeURIComponent(String(sessionId))}&source=deckhq`;
}

/**
 * Hand a session to the Claude desktop app via its `claude://` deep link,
 * through the OS URI handler. Always an argv array, never a shell string —
 * the session id ends up inside a URL and must never be interpolated into a
 * command line.
 *
 * Whether the app actually resumes the requested session, rather than just
 * opening to its own default view, is UNVERIFIED — see `buildAppResumeUri`.
 * This function's job ends at handing the OS a well-formed URI to dispatch.
 *
 * @param {string} sessionId
 * @param {string} cwd used only as the launcher process's own cwd; the deep
 *   link itself carries no directory — the app owns that once it opens.
 * @param {{checkAvailable?: () => Promise<boolean>}} [opts] test seam:
 *   override the availability check in place of the real registry lookup.
 *   Defaults to the real `appAvailable()`. Never spawns anything when the
 *   override reports unavailable, which is what makes this branch testable
 *   without touching the registry or a real process.
 * @returns {Promise<void>}
 */
async function openInApp(sessionId, cwd, opts = {}) {
  const checkAvailable = opts.checkAvailable || appAvailable;
  if (!(await checkAvailable())) {
    throw new Error(
      'No claude:// URI handler is registered on this machine — the Claude desktop app does not appear to be installed.',
    );
  }
  const uri = buildAppResumeUri(sessionId);

  if (process.platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '', uri], { cwd, detached: true, stdio: 'ignore' });
    child.unref();
    return;
  }

  if (process.platform === 'darwin') {
    const child = spawn('open', [uri], { cwd, detached: true, stdio: 'ignore' });
    child.unref();
    return;
  }

  // Linux: appAvailable() always reports false above, so this branch cannot
  // be reached yet — written now so nothing further is needed here once
  // detection is added for this platform too.
  const ok = await trySpawnDetached('xdg-open', [uri], cwd);
  if (!ok) throw new Error('xdg-open was not found; cannot hand off to the desktop app.');
}

/**
 * Open a terminal running a BRAND NEW session in `cwd`.
 *
 * This is how a new room appears on the floor: point DeckHQ at a project
 * directory, it starts a session there, and the next scan discovers it and
 * lays out a room with a table sized to the team. There is deliberately no
 * "create project" concept in the daemon beyond this — the project is the
 * directory, and the session is Claude Code's to own.
 *
 * Same discipline as `openInTerminal`: argv arrays only, never a shell string
 * with user data interpolated into it.
 *
 * @param {string} cwd absolute path to an existing directory
 * @param {{instructions?: string, terminal?: string}} [opts] an optional first
 *   prompt, and the user's pinned emulator from settings
 * @returns {Promise<void>}
 */
async function openNewSession(cwd, opts = {}) {
  // An initial prompt is passed as one argv element. It is user text and must
  // never reach a shell as part of a command string. The macOS wrapper script
  // is the one place it becomes part of a shell line, and `shQuote` there
  // quotes it whole — the old macOS path dropped the prompt entirely rather
  // than face that, which was a silent difference in behaviour between
  // platforms.
  const prompt = String(opts.instructions || '').trim();
  await launchTerminal({
    command: prompt ? ['claude', prompt] : ['claude'],
    cwd,
    prefix: 'new',
    pin: opts.terminal,
  });
}

export const adapter = {
  id: RUNTIME_ID,
  label: 'Claude Code',
  available,
  liveSessions,
  scanSessions,
  conversation,
  send,
  openInTerminal,
  appAvailable,
  openInApp,
  openNewSession,
  hooks: {
    supported: hooksImpl.supported,
    describe: hooksImpl.describe,
    install: hooksImpl.install,
    remove: hooksImpl.remove,
    installed: hooksImpl.installed,
    installedPort: hooksImpl.installedPort,
    // WP-52: the runtime's own `PreToolUse` payload shape is this adapter's
    // business, so the HTTP route asks the adapter what the payload says
    // rather than parsing it itself.
    toolSummary: hooksImpl.toolSummary,
    // WP-19: same rule for the `PermissionRequest` payload and for the body
    // that answers it. The route holds the socket; the adapter owns the
    // spelling on both ends of it.
    permissionRequest: hooksImpl.permissionRequest,
    permissionDecisionBody: hooksImpl.permissionDecisionBody,
  },
};

export default adapter;

// Re-exported for tests and tooling that want the raw settings-file path
// without reaching into hooks.mjs directly.
export { CLAUDE_DIR };

// buildAppResumeUri is already a named export at its declaration above —
// tests import it directly (it's the pure half of openInApp, factored out
// so the deep link's shape can be checked without spawning anything).
