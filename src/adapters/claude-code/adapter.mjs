/**
 * Claude Code runtime adapter. Implements the `RuntimeAdapter` interface from
 * docs/02-ARCHITECTURE.md §2. All transcript parsing is delegated to
 * ./parse.mjs; nothing here reads a `.jsonl` line directly.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
 * Sessions Claude Code reports as currently alive, via its supported CLI
 * surface. Never throws — a missing/failing CLI resolves to [].
 * @returns {Promise<import('../../core/model.mjs').LiveSession[]>}
 */
function liveSessions() {
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
    desktop = readDesktopSessions();
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
  return out.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
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

/** POSIX single-quote escaping for embedding a value in a shell script file. */
function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Try to spawn a detached terminal command; resolve true only if the child
 * actually spawned (the binary was found), false otherwise. Never throws.
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} cwd
 */
function trySpawnDetached(cmd, args, cwd) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, detached: true, stdio: 'ignore' });
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    child.once('error', () => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    });
    child.once('spawn', () => {
      if (!settled) {
        settled = true;
        child.unref();
        resolve(true);
      }
    });
  });
}

/**
 * Spawn an interactive terminal attached to this session. Platform-specific;
 * always an argv array, never a shell string with interpolated user data.
 * @param {string} id
 * @param {string} cwd
 * @returns {Promise<void>}
 */
async function openInTerminal(id, cwd) {
  const { sessionId } = splitAgentId(id);

  if (process.platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '', 'cmd', '/k', 'claude', '--resume', sessionId], {
      cwd,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return;
  }

  if (process.platform === 'darwin') {
    // Write a small shell wrapper file rather than interpolating user data
    // into a shell command string; only its path is ever passed as an argv
    // element.
    const scriptPath = path.join(os.tmpdir(), `deckhq-resume-${sessionId}-${Date.now()}.command`);
    const script = `#!/bin/sh\ncd ${shQuote(cwd)}\nexec claude --resume ${shQuote(sessionId)}\n`;
    await fsp.writeFile(scriptPath, script, { mode: 0o755 });
    const child = spawn('open', ['-a', 'Terminal', scriptPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return;
  }

  // Linux and other POSIX desktops: try common terminal emulators in order.
  const candidates = [
    ['x-terminal-emulator', ['-e', 'claude', '--resume', sessionId]],
    ['gnome-terminal', ['--', 'claude', '--resume', sessionId]],
    ['konsole', ['-e', 'claude', '--resume', sessionId]],
    ['xterm', ['-e', 'claude', '--resume', sessionId]],
  ];
  for (const [cmd, args] of candidates) {
    // Tried in order, on purpose: stop at the first emulator that spawns.
    const ok = await trySpawnDetached(cmd, args, cwd);
    if (ok) return;
  }
  throw new Error(
    'No supported terminal emulator found (tried x-terminal-emulator, gnome-terminal, konsole, xterm).',
  );
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
 * @param {{instructions?: string}} [opts] an optional first prompt
 * @returns {Promise<void>}
 */
async function openNewSession(cwd, opts = {}) {
  // An initial prompt is passed as one argv element. It is user text and must
  // never reach a shell as part of a command string.
  const prompt = String(opts.instructions || '').trim();
  const args = prompt ? ['claude', prompt] : ['claude'];

  if (process.platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '', 'cmd', '/k', ...args], {
      cwd,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return;
  }

  if (process.platform === 'darwin') {
    const scriptPath = path.join(os.tmpdir(), `deckhq-new-${Date.now()}.command`);
    const script = `#!/bin/sh\ncd ${shQuote(cwd)}\nexec claude\n`;
    await fsp.writeFile(scriptPath, script, { mode: 0o755 });
    const child = spawn('open', ['-a', 'Terminal', scriptPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return;
  }

  const candidates = [
    ['x-terminal-emulator', ['-e', ...args]],
    ['gnome-terminal', ['--', ...args]],
    ['konsole', ['-e', ...args]],
    ['xterm', ['-e', ...args]],
  ];
  for (const [cmd, args] of candidates) {
    const ok = await trySpawnDetached(cmd, args, cwd);
    if (ok) return;
  }
  throw new Error(
    'No supported terminal emulator found (tried x-terminal-emulator, gnome-terminal, konsole, xterm).',
  );
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
  },
};

export default adapter;

// Re-exported for tests and tooling that want the raw settings-file path
// without reaching into hooks.mjs directly.
export { CLAUDE_DIR };

// buildAppResumeUri is already a named export at its declaration above —
// tests import it directly (it's the pure half of openInApp, factored out
// so the deep link's shape can be checked without spawning anything).
