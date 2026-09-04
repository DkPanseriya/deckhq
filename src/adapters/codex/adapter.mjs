/**
 * Codex runtime adapter. Implements `RuntimeAdapter` (docs/02-ARCHITECTURE.md §2).
 *
 * CRITICAL: every exported method here must be safe to call on a machine with
 * no Codex at all — `available()` resolves false, and every other method
 * degrades to an empty/failed result rather than throwing. That was the
 * reference build machine's own situation until 4 September 2026, when the
 * Codex desktop app was installed on it (`docs/DEVIATIONS.md` §135); the read
 * path has still never been checked against a session somebody actually had,
 * so §8 stands and this file is still written and reasoned about rather than
 * exercised end to end.
 *
 * The app's arrival did settle one thing this file had wrong. `~/.codex`
 * existing and `codex` being runnable are two different questions, because the
 * app installs a complete CLI it does not put on `PATH` — so `available()`
 * answers the first (transcripts readable) and `./binary.mjs` answers the
 * second, at the three moments that need a program. §136.1.
 *
 * All Codex-specific file-format knowledge lives in ./parse.mjs. This file
 * only does I/O (directory walking, bounded reads, child-process spawning)
 * and shapes the results into the contracts from src/core/model.mjs.
 *
 * EVERY PROCESS THIS FILE STARTS TAKES AN ARGV ARRAY. There is no shell
 * anywhere in it: no `bash -lc`, no `sh -c`, no AppleScript with a session id
 * in its text, no `shell: true`. A session id and a working directory arrive
 * from a request body (`docs/DEVIATIONS.md` §28), and `08-PLAN-V2-100X.md`
 * §1.1 rule 8 keeps runtime CLI knowledge in here — so the argv discipline has
 * to be kept in here too. Opening a terminal is delegated whole to
 * `src/core/terminals.mjs`, which owns the per-emulator argv and is the only
 * place a shell line can exist at all (a quoted `#!/bin/sh` wrapper file, for
 * the three macOS applications that accept nothing else). §95.
 */

import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { agentId, clampText, splitAgentId } from '../../core/model.mjs';
import { estimateCost } from '../../core/rates.mjs';
import { launchTerminal } from '../../core/terminals.mjs';
import { CODEX_COMMAND, describeMissingBinary, resolveCodexBinary } from './binary.mjs';
import { hooks } from './hooks.mjs';
import {
  HEAD_BYTES,
  TAIL_BYTES,
  extractMessage,
  extractModelHint,
  extractSessionMeta,
  extractUsage,
  linesFromChunk,
  parseLine,
  readHead,
  readTail,
  sessionIdFromFilename,
  truncateTitle,
} from './parse.mjs';

/** Bound on how many file heads we are willing to open for an id lookup. */
const MAX_ID_LOOKUP_SCAN = 500;

/** Bound on directory recursion depth while walking the sessions tree. */
const MAX_WALK_DEPTH = 8;

/** @returns {string} */
function codexHome() {
  return path.join(os.homedir(), '.codex');
}

/** @returns {string} */
function sessionsDir() {
  return path.join(codexHome(), 'sessions');
}

/** Cached across the process lifetime, per docs/02-ARCHITECTURE.md §2. */
let availableCache = null;

/**
 * Is Codex present on this machine? Cheap, cached, never throws.
 *
 * **This answers "are transcripts readable", and nothing else** (WP-23a,
 * `docs/DEVIATIONS.md` §136.1). `~/.codex` is where the rollout files live, so
 * its presence is exactly the condition for the read path — the scan, the
 * conversation, the floor — and no process is needed for any of it.
 *
 * It is deliberately NOT a claim that the `codex` program exists. The Codex
 * desktop app creates `~/.codex` and installs a CLI it does not put on `PATH`,
 * so those two questions have different answers on a real machine. The write
 * path (`version()`, `send()`, resume) asks the second one for itself, through
 * `./binary.mjs`; adding a second probe here would put it on the poll path,
 * which is the cost §77 removed.
 * @returns {Promise<boolean>}
 */
async function available() {
  if (!availableCache) {
    availableCache = fsp
      .access(codexHome())
      .then(() => true)
      .catch(() => false);
  }
  return availableCache;
}

/**
 * Codex exposes no supported CLI surface for enumerating live sessions (no
 * equivalent of `claude agents --json`). Per docs/02-ARCHITECTURE.md §2.1,
 * "prefer supported surfaces over file parsing wherever both exist" — none
 * exists here, and we deliberately do NOT shell out to guess at liveness
 * (e.g. scanning the process table), since that would be unreliable and
 * platform-specific.
 *
 * The daemon's degraded polling path (§4.2) infers `live` from transcript
 * file mtime instead — that inference happens in the daemon, not here.
 * @returns {Promise<import('../../core/model.mjs').LiveSession[]>}
 */
async function liveSessions() {
  return [];
}

/**
 * Recursively collect `.jsonl` file paths under `root`, bounded by depth.
 * Missing or unreadable directories are treated as empty, never thrown.
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function walkSessionFiles(root) {
  const out = [];
  /** @param {string} dir @param {number} depth */
  async function walk(dir, depth) {
    if (depth > MAX_WALK_DEPTH) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) {
        out.push(full);
      }
    }
  }
  await walk(root, 0);
  return out;
}

/**
 * Build one SessionSummary from a rollout file, using bounded head/tail
 * reads only — never a full-file read (CONTRACTS.md).
 * @param {string} filePath
 * @param {number} mtimeMs
 * @returns {Promise<import('../../core/model.mjs').SessionSummary>}
 */
async function buildSessionSummary(filePath, mtimeMs) {
  const head = await readHead(filePath, HEAD_BYTES);
  const headRecords = linesFromChunk(head.text, { dropLastPartial: head.truncated })
    .map(parseLine)
    .filter(Boolean);

  let meta = null;
  let firstUserText = '';
  for (const rec of headRecords) {
    if (!meta) {
      const m = extractSessionMeta(rec);
      if (m) meta = m;
    }
    if (!firstUserText) {
      const msg = extractMessage(rec);
      if (msg && msg.role === 'user' && msg.text) firstUserText = msg.text;
    }
    if (meta && firstUserText) break;
  }

  const tail = await readTail(filePath, TAIL_BYTES);
  const tailRecords = linesFromChunk(tail.text, { dropFirstPartial: tail.truncated })
    .map(parseLine)
    .filter(Boolean);

  let lastRole = null;
  let lastText = '';
  let lastMsgAt = null;
  let usage = null;
  let model = null;

  for (const rec of tailRecords) {
    if (!meta) {
      const m = extractSessionMeta(rec);
      if (m) meta = m;
    }
    const msg = extractMessage(rec);
    if (msg) {
      lastRole = msg.role;
      lastText = msg.text;
      if (msg.at) lastMsgAt = msg.at;
      if (!firstUserText && msg.role === 'user') firstUserText = msg.text;
    }
    const u = extractUsage(rec);
    if (u) usage = u; // last one wins: assumed cumulative, see parse.mjs
    const m2 = extractModelHint(rec);
    if (m2) model = m2;
  }

  const filename = path.basename(filePath);
  const sessionId = (meta && meta.id) || sessionIdFromFilename(filename);
  const cwd = (meta && meta.cwd) || 'unknown';
  const lastActivityAt = lastMsgAt || mtimeMs;
  const inputTokens = usage ? usage.inputTokens : 0;
  const outputTokens = usage ? usage.outputTokens : 0;
  const cachedInputTokens = usage ? usage.cachedInputTokens : 0;

  return {
    id: agentId('codex', sessionId),
    runtime: 'codex',
    title: truncateTitle(firstUserText, 60),
    hasCustomTitle: false,
    cwd,
    gitBranch: null,
    model,
    lastActivityAt,
    tokens: inputTokens + outputTokens,
    cacheTokens: cachedInputTokens,
    costEstimate: estimateCost({
      input: inputTokens,
      output: outputTokens,
      cacheRead: cachedInputTokens,
      cacheWrite: 0,
      model,
    }),
    lastRole,
    lastText: clampText(lastText),
    // The codex rollout format carries no per-record tool boundaries to read
    // the way the Claude Code transcript does, so this stays the old, weaker
    // test: the assistant having spoken last.
    turnEnded: lastRole === 'assistant',
  };
}

/**
 * Every Codex session on disk, newest first, bounded by opts. A parse
 * failure on one session is logged and skipped; it never fails the scan
 * (docs/02-ARCHITECTURE.md §2.1, CONTRACTS.md rule 6).
 * @param {{maxAgeDays?:number, limit?:number}} [opts] optional at runtime: the
 *   `= {}` default means a bare call is legal (WP-22).
 * @returns {Promise<import('../../core/model.mjs').SessionSummary[]>}
 */
async function scanSessions({ maxAgeDays, limit } = {}) {
  if (!(await available())) return [];

  let files;
  try {
    files = await walkSessionFiles(sessionsDir());
  } catch {
    return [];
  }
  if (files.length === 0) return [];

  const maxAgeMs =
    Number.isFinite(maxAgeDays) && maxAgeDays > 0 ? maxAgeDays * 24 * 60 * 60 * 1000 : Infinity;
  const cap = Number.isFinite(limit) && limit > 0 ? limit : Infinity;
  const now = Date.now();

  const stated = [];
  for (const file of files) {
    try {
      const st = await fsp.stat(file);
      if (now - st.mtimeMs <= maxAgeMs) stated.push({ file, mtimeMs: st.mtimeMs });
    } catch {
      // File vanished between readdir and stat (e.g. rotated mid-scan). Skip it.
    }
  }
  stated.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const out = [];
  for (const { file, mtimeMs } of stated.slice(0, cap)) {
    try {
      out.push(await buildSessionSummary(file, mtimeMs));
    } catch (err) {
      console.error('[codex adapter] skipping unreadable session file:', file, err && err.message);
    }
  }
  return out;
}

/**
 * Locate the newest file among candidates without reading their contents.
 * @param {string[]} files
 * @returns {Promise<string|null>}
 */
async function newestOf(files) {
  let best = null;
  let bestMtime = -Infinity;
  for (const file of files) {
    try {
      const st = await fsp.stat(file);
      if (st.mtimeMs > bestMtime) {
        bestMtime = st.mtimeMs;
        best = file;
      }
    } catch {
      // skip
    }
  }
  return best;
}

/**
 * Find the rollout file for a bare Codex session id. Tries a fast filename
 * match first (rollout files embed the session's uuid in their name), then
 * falls back to a bounded scan of file heads for a matching meta.id.
 * @param {string} sessionId
 * @returns {Promise<string|null>}
 */
async function findSessionFile(sessionId) {
  let files;
  try {
    files = await walkSessionFiles(sessionsDir());
  } catch {
    return null;
  }
  if (files.length === 0) return null;

  const byName = files.filter((f) => path.basename(f).includes(sessionId));
  if (byName.length > 0) return newestOf(byName);

  const stated = [];
  for (const file of files) {
    try {
      const st = await fsp.stat(file);
      stated.push({ file, mtimeMs: st.mtimeMs });
    } catch {
      // skip
    }
  }
  stated.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const { file } of stated.slice(0, MAX_ID_LOOKUP_SCAN)) {
    try {
      const head = await readHead(file, HEAD_BYTES);
      const lines = linesFromChunk(head.text, { dropLastPartial: head.truncated });
      for (const line of lines) {
        const rec = parseLine(line);
        const meta = rec && extractSessionMeta(rec);
        if (meta && meta.id === sessionId) return file;
      }
    } catch {
      // skip this file, keep looking
    }
  }
  return null;
}

/**
 * Full message list for one session, most recent last. Text only — no tool
 * calls, no reasoning/thinking items (see parse.mjs's extractMessage).
 * @param {string} id
 * @param {{maxMessages?:number}} [opts] every field is optional at runtime:
 *   the `= {}` default means a bare call is legal (WP-22).
 * @returns {Promise<import('../../core/model.mjs').Message[]>}
 */
async function conversation(id, { maxMessages } = {}) {
  if (!(await available())) return [];

  const { sessionId } = splitAgentId(id);
  let file;
  try {
    file = await findSessionFile(sessionId);
  } catch {
    return [];
  }
  if (!file) return [];

  let tail;
  try {
    tail = await readTail(file, TAIL_BYTES);
  } catch {
    return [];
  }
  const records = linesFromChunk(tail.text, { dropFirstPartial: tail.truncated })
    .map(parseLine)
    .filter(Boolean);

  let fallbackAt = Date.now();
  try {
    const st = await fsp.stat(file);
    fallbackAt = st.mtimeMs;
  } catch {
    // keep Date.now() fallback
  }

  const messages = [];
  for (const rec of records) {
    const msg = extractMessage(rec);
    if (!msg) continue;
    messages.push({ role: msg.role, text: msg.text, at: msg.at ?? fallbackAt });
  }

  const cap = Number.isFinite(maxMessages) && maxMessages > 0 ? maxMessages : messages.length;
  return messages.slice(-cap);
}

/**
 * Pull the last assistant message out of a `codex exec --json` event stream,
 * reusing the same shape-tolerant parsing as the on-disk rollout format
 * (they are assumed to share an event schema).
 * @param {string} stdout
 * @returns {string}
 */
function extractFinalAssistantText(stdout) {
  const lines = linesFromChunk(stdout);
  let last = '';
  for (const line of lines) {
    const rec = parseLine(line);
    if (!rec) continue;
    const msg = extractMessage(rec);
    if (msg && msg.role === 'assistant' && msg.text) last = msg.text;
  }
  return last;
}

/**
 * @param {unknown} err
 * @param {string} command the path we actually tried to start
 */
function describeSpawnError(err, command) {
  if (err && typeof err === 'object' && /** @type {any} */ (err).code === 'ENOENT') {
    // This used to say "Codex is not installed", which was false on the one
    // machine that had Codex: the app's bundled CLI is not on PATH, so the
    // spawn failed and the message blamed the install (§136.1). It now names
    // the path that was not there, which is a fact rather than a diagnosis.
    return `codex binary not found at ${command}`;
  }
  return (err && /** @type {any} */ (err).message) || 'failed to spawn codex';
}

/**
 * Spawn `codex` with an argv array (never a shell string) and collect its
 * result. Always resolves — a missing binary, a non-zero exit, or a timeout
 * all produce `{ok:false, error}` rather than a rejection.
 *
 * `command` is the resolved program (`./binary.mjs`), NOT the bare name: on a
 * machine where only the desktop app's bundled copy exists there is nothing
 * called `codex` for the OS to find. It defaults to the bare name so a caller
 * that has already decided (the terminal launchers) can still say so.
 * @param {string[]} args
 * @param {{cwd?:string, timeoutMs?:number, command?:string}} [opts]
 * @returns {Promise<import('../../core/model.mjs').SendResult>}
 */
function runCodex(args, { cwd, timeoutMs, command = CODEX_COMMAND } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: cwd || undefined,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ ok: false, error: describeSpawnError(err, command) });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // already gone
        }
        finish({ ok: false, error: `codex timed out after ${timeoutMs}ms` });
      }, timeoutMs);
    }

    child.on('error', (err) => finish({ ok: false, error: describeSpawnError(err, command) }));
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      if (code === 0) {
        finish({ ok: true, text: extractFinalAssistantText(stdout) || stdout.trim() });
      } else {
        finish({ ok: false, error: stderr.trim() || `codex exited with code ${code}` });
      }
    });
  });
}

/**
 * Cached across the process lifetime once determined, per binary: a user who
 * pins a different `codexBin` mid-run gets that binary's answer, not the one
 * before it.
 * @type {Map<string, Promise<boolean>>}
 */
const resumeSupportCache = new Map();

/**
 * Detect whether the installed `codex exec` subcommand supports resuming a
 * session (added in later Codex CLI versions). Falls back to false — a
 * fresh, non-resumed turn — when detection fails for any reason.
 * @param {string} command
 * @returns {Promise<boolean>}
 */
async function detectResumeSupport(command) {
  let found = resumeSupportCache.get(command);
  if (!found) {
    found = runCodex(['exec', '--help'], { timeoutMs: 5000, command })
      .then((res) => `${res.text || ''} ${res.error || ''}`.toLowerCase().includes('resume'))
      .catch(() => false);
    resumeSupportCache.set(command, found);
  }
  return found;
}

/**
 * Which `codex` this machine means, and how it was found. Synchronous, does
 * not spawn, and never throws — `doctor` reads it to say "bundled with the
 * app" / "on PATH" / "pinned" rather than the bare "available" that hid the
 * whole of §136.1.
 * @param {{codexBin?: string}} [opts] the `codexBin` setting, when the caller
 *   has one. The adapter never reads `state.json` itself.
 * @returns {{found:boolean, source:'pinned'|'path'|'bundled'|null, path:string|null,
 *            lookedIn:string[], pinProblem:string|null, shimOnPath:string|null}}
 */
function describeBinary(opts = {}) {
  const bin = resolveCodexBinary({ pinned: opts.codexBin });
  return {
    found: Boolean(bin.command),
    source: bin.source,
    path: bin.command,
    lookedIn: bin.bundleDirs,
    pinProblem: bin.pinProblem,
    shimOnPath: bin.shimOnPath,
  };
}

/**
 * Cached per resolved binary, for the same reason as `resumeSupportCache`.
 * @type {Map<string, Promise<string|null>>}
 */
const versionCache = new Map();

/**
 * The installed Codex CLI's own version string, e.g. `codex-cli 0.153.1`.
 *
 * The adapter interface's optional `version()` (`docs/DEVIATIONS.md` §72),
 * which `doctor` has read through since it was written and which no adapter
 * has ever implemented. It is implementable here now only because the binary
 * is resolvable at all: on a machine where the desktop app bundles the CLI
 * off `PATH`, `spawn('codex', ['--version'])` was `ENOENT`.
 *
 * Never throws, never fails a report: no binary, a non-zero exit or a timeout
 * all resolve `null`.
 * @param {{codexBin?: string}} [opts]
 * @returns {Promise<string|null>}
 */
async function version(opts = {}) {
  const bin = resolveCodexBinary({ pinned: opts.codexBin });
  if (!bin.command) return null;
  const command = bin.command;
  let found = versionCache.get(command);
  if (!found) {
    found = runCodex(['--version'], { timeoutMs: 5000, command })
      .then((res) => {
        if (!res.ok) return null;
        const first = String(res.text || '')
          .split('\n')[0]
          .trim();
        return first || null;
      })
      .catch(() => null);
    versionCache.set(command, found);
  }
  return found;
}

/**
 * The argv for one non-interactive turn. Pure — same inputs, same array, no
 * I/O — so the test suite can assert the exact array rather than reason about
 * it, exactly as `buildLaunch` is asserted in `terminals.test.mjs`.
 *
 * The session id and the turn text are user data. Each is ONE element of the
 * returned array and is never concatenated into a longer one, so the only
 * thing that ever parses them is `codex`'s own argument parser.
 * @param {{sessionId?:string, text:string, canResume?:boolean}} opts
 * @returns {string[]}
 */
export function codexExecArgs({ sessionId, text, canResume }) {
  return canResume
    ? ['exec', 'resume', String(sessionId), '--json', String(text)]
    : ['exec', '--json', String(text)];
}

/**
 * The argv for resuming one session in an interactive terminal. Pure, for the
 * same reason as `codexExecArgs`. Handed to `launchTerminal()` as `command`,
 * which distributes it into whichever emulator's own argv the machine has.
 *
 * `command` is the resolved binary (§136.1). It defaults to the bare name,
 * which is still the right answer for a terminal: the emulator starts a login
 * shell whose `PATH` may well differ from the daemon's, so "we could not find
 * it" is not the same as "the user's shell cannot".
 * @param {string} sessionId
 * @param {string} [command]
 * @returns {string[]}
 */
export function codexResumeCommand(sessionId, command = CODEX_COMMAND) {
  return [command, 'resume', String(sessionId)];
}

/**
 * The argv for a brand-new interactive session: plain `codex`, plus the
 * first prompt as one element when there is one. The prompt is user text
 * from a request body and travels exactly like a session id — one argv
 * element to `spawn()`, or one single-quoted word inside the wrapper script.
 * Pure and exported for the same reason as the two above.
 * @param {unknown} [instructions]
 * @param {string} [command] the resolved binary — see `codexResumeCommand`
 * @returns {string[]}
 */
export function codexNewSessionCommand(instructions, command = CODEX_COMMAND) {
  const prompt = String(instructions || '').trim();
  return prompt ? [command, prompt] : [command];
}

/**
 * Send a turn into a Codex session via its non-interactive exec surface.
 * Two failures, and they are not the same failure. No `~/.codex` at all means
 * Codex really is not installed. `~/.codex` with no runnable `codex` means the
 * transcripts are readable and there is no program to send a turn with — which
 * is the shape a Codex desktop install actually has, and which this method
 * reported as "Codex is not installed" until §136.1.
 * @param {string} id
 * @param {string} text
 * @param {{cwd?:string, timeoutMs?:number, codexBin?:string}} [opts] optional at
 *   runtime: the `= {}` default means a bare call is legal (WP-22).
 * @returns {Promise<import('../../core/model.mjs').SendResult>}
 */
async function send(id, text, { cwd, timeoutMs, codexBin } = {}) {
  if (!(await available())) return { ok: false, error: 'Codex is not installed' };

  const bin = resolveCodexBinary({ pinned: codexBin });
  if (!bin.command) return { ok: false, error: describeMissingBinary(bin) };

  const { sessionId } = splitAgentId(id);
  let canResume = false;
  try {
    canResume = await detectResumeSupport(bin.command);
  } catch {
    canResume = false;
  }

  const args = codexExecArgs({ sessionId, text, canResume });

  try {
    return await runCodex(args, { cwd, timeoutMs, command: bin.command });
  } catch (err) {
    return { ok: false, error: describeSpawnError(err, bin.command) };
  }
}

/**
 * Spawn an interactive terminal attached to `codex resume <id>`.
 *
 * SECURITY: this used to build the command as a shell string on both POSIX
 * platforms — an AppleScript `do script "cd \"<cwd>\" && codex resume <id>"`
 * on macOS, and `bash -lc "codex resume <id>"` on Linux — with the session id
 * and the working directory interpolated straight in. The id arrives in a
 * request body, so `x'; rm -rf ~ #` reached a shell that would run it. That is
 * `docs/DEVIATIONS.md` §28's failure with the target moved from the network to
 * the id, and §91 named it as the one shell-string spawn left in the tree.
 *
 * It is now the same three lines as the Claude Code adapter: name the command
 * as an argv array and hand it to `launchTerminal()`, which owns detection,
 * the per-emulator argv, and the one quoted wrapper file the three macOS
 * applications with no argv surface require. Nothing here builds a string.
 * §95, and `test/unit/codex-terminal.test.mjs`.
 *
 * Best effort, unchanged: any failure is swallowed rather than thrown, since
 * there is no result channel for this method and a silently-missing terminal
 * is preferable to crashing the caller. Note that this also means the caller
 * cannot tell "Codex is not installed" from "no terminal would open" — see
 * `openNewSession` below, which does throw.
 * @param {string} id
 * @param {string} cwd
 * @param {{terminal?: string, codexBin?: string}} [opts] `terminal` is the
 *   user's pinned emulator from settings (`auto` when they have not pinned
 *   one), `codexBin` the pinned binary. The HTTP route passes both; a caller
 *   that does not gets detection and the bare `codex` name.
 * @returns {Promise<void>}
 */
async function openInTerminal(id, cwd, opts = {}) {
  if (!(await available())) return;
  const { sessionId } = splitAgentId(id);
  const bin = resolveCodexBinary({ pinned: opts.codexBin });

  try {
    await launchTerminal({
      command: codexResumeCommand(sessionId, bin.command || CODEX_COMMAND),
      cwd,
      sessionId,
      prefix: 'codex-resume',
      pin: opts.terminal,
    });
  } catch {
    // Best-effort only — see JSDoc above.
  }
}

/**
 * The Codex RuntimeAdapter. See docs/02-ARCHITECTURE.md §2 for the interface
 * this must satisfy.
 */

/**
 * Open a terminal running a NEW Codex session in `cwd` — `codex`, plus the
 * first prompt as one argv element when one is given. Unavailable on a
 * machine without Codex, like every other method here.
 *
 * Until §99 this delegated to `openInTerminal('codex:new', …)`, so the argv
 * was literally `['codex', 'resume', 'new']` and `opts.instructions` was
 * dropped (§95, "not fixed"). It now names its own command and hands it to
 * `launchTerminal()`, as the Claude Code adapter does.
 *
 * Unlike `openInTerminal`, a launcher failure is NOT swallowed here: the
 * route that calls this reports the message, and "Could not open a terminal.
 * Tried: …" is more useful than a silent nothing. That is also what the
 * Claude Code adapter does.
 * @param {string} cwd absolute path to an existing directory
 * @param {{instructions?: string, terminal?: string, codexBin?: string}} [opts]
 *   an optional first prompt, the user's pinned emulator, and the pinned binary
 * @returns {Promise<void>}
 */
async function openNewSession(cwd, opts = {}) {
  if (!(await available())) throw new Error('Codex is not installed');
  const bin = resolveCodexBinary({ pinned: opts.codexBin });
  await launchTerminal({
    command: codexNewSessionCommand(opts.instructions, bin.command || CODEX_COMMAND),
    cwd,
    prefix: 'codex-new',
    pin: opts.terminal,
  });
}

export const adapter = {
  id: 'codex',
  label: 'Codex',
  available,
  version,
  describeBinary,
  liveSessions,
  scanSessions,
  conversation,
  send,
  openInTerminal,
  openNewSession,
  hooks,
};

export default adapter;
