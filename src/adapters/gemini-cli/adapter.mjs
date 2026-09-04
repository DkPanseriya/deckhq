/**
 * Gemini CLI runtime adapter. WP-24. Implements `RuntimeAdapter`
 * (`docs/02-ARCHITECTURE.md` §2).
 *
 * CRITICAL, and the same statement the Codex adapter opens with: **Gemini CLI
 * is not installed on the reference build machine.** `~/.gemini` does not
 * exist there — checked read-only on 4 September 2026. Every exported method
 * must be safe to call in that situation: `available()` resolves false and
 * every other method degrades to an empty or failed result rather than
 * throwing. The same code must also be a correct, complete implementation for
 * a machine where Gemini CLI *is* present; it is written and reasoned about as
 * such, and has never been exercised end to end. `docs/DEVIATIONS.md` §123.
 *
 * All Gemini-CLI-specific file-format knowledge lives in ./parse.mjs, and its
 * header carries the provenance of every field name. This file only does I/O —
 * directory walking, bounded reads, child-process spawning — and shapes the
 * results into the contracts in `src/core/model.mjs`.
 *
 * EVERY PROCESS THIS FILE STARTS TAKES AN ARGV ARRAY. There is no shell
 * anywhere in it: no `bash -lc`, no `sh -c`, no `shell: true`. A session id and
 * a working directory arrive from a request body (`docs/DEVIATIONS.md` §28),
 * and `08` §1.1 rule 8 keeps runtime CLI knowledge in here — so the argv
 * discipline has to be kept in here too. Opening a terminal is delegated whole
 * to `src/core/terminals.mjs` (§95).
 */

import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { agentId, clampText, splitAgentId } from '../../core/model.mjs';
import { estimateCost } from '../../core/rates.mjs';
import { launchTerminal } from '../../core/terminals.mjs';
import { hooks } from './hooks.mjs';
import {
  HEAD_BYTES,
  SESSION_FILE_PREFIX,
  TAIL_BYTES,
  digestRecords,
  extractSessionMeta,
  linesFromChunk,
  mergeMeta,
  parseLine,
  projectDirLooksLegacy,
  readHead,
  readTail,
  reverseProjectRegistry,
  sessionIdFromFilename,
  truncateTitle,
} from './parse.mjs';

/** Bound on how many file heads we will open looking for one session id. */
const MAX_ID_LOOKUP_SCAN = 500;

/** Bound on recursion depth under one project's `chats/` directory. */
const MAX_WALK_DEPTH = 4;

/** Bound on the projects registry read: it is a small map, never a transcript. */
const MAX_REGISTRY_BYTES = 4 * 1024 * 1024;

/**
 * The Gemini CLI home directory.
 *
 * `GEMINI_CLI_HOME` overrides the *parent*, not the directory: the CLI's own
 * `homedir()` wrapper returns it in place of `os.homedir()` and still appends
 * `.gemini` (`packages/core/src/utils/paths.ts`, read 4 September 2026).
 * Getting that wrong would point DeckHQ at a directory the runtime never uses
 * and report "not installed" on exactly the machines that customised it.
 * @returns {string}
 */
function geminiHome() {
  const override = process.env.GEMINI_CLI_HOME;
  const base = override && String(override).trim() ? String(override).trim() : os.homedir();
  return path.join(base, '.gemini');
}

/** `~/.gemini/tmp` — one subdirectory per project. @returns {string} */
function tmpDir() {
  return path.join(geminiHome(), 'tmp');
}

/** `~/.gemini/projects.json` — absolute path → project slug. @returns {string} */
function projectsFile() {
  return path.join(geminiHome(), 'projects.json');
}

/** Cached across the process lifetime, per docs/02-ARCHITECTURE.md §2. */
let availableCache = null;

/**
 * Is Gemini CLI present on this machine? Cheap, cached, never throws.
 * @returns {Promise<boolean>}
 */
async function available() {
  if (!availableCache) {
    availableCache = fsp
      .access(geminiHome())
      .then(() => true)
      .catch(() => false);
  }
  return availableCache;
}

/**
 * slug → absolute project path, read from `~/.gemini/projects.json`.
 *
 * Not cached for the process lifetime: a user creating a new project while
 * DeckHQ is running would otherwise have every session in it filed under
 * "unknown" until they restarted, and the file is a few kilobytes read once
 * per scan rather than once per session. Missing or corrupt reads as empty,
 * which costs an unknown cwd and nothing else.
 * @returns {Promise<Map<string, string>>}
 */
async function loadProjectPaths() {
  try {
    const st = await fsp.stat(projectsFile());
    if (st.size > MAX_REGISTRY_BYTES) return new Map();
    const raw = await fsp.readFile(projectsFile(), 'utf8');
    return reverseProjectRegistry(JSON.parse(raw));
  } catch {
    return new Map();
  }
}

/**
 * Gemini CLI exposes no supported surface for enumerating *live* sessions.
 * `gemini --list-sessions` lists what is on disk for the current project — the
 * same thing `scanSessions` reads, minus the parsing — and says nothing about
 * which of them has a process attached. Per `docs/02-ARCHITECTURE.md` §2.1 we
 * prefer a supported surface where one exists; none does here, and we do not
 * scan the process table to guess.
 *
 * The daemon's degraded polling path (§4.2) infers `live` from file mtime.
 * @returns {Promise<import('../../core/model.mjs').LiveSession[]>}
 */
async function liveSessions() {
  return [];
}

/**
 * Every session file under `~/.gemini/tmp/*​/chats/`, with the project slug and
 * the parent session id (for a junior) recovered from the path.
 *
 * Only `chats/` is walked. `checkpoints/`, `logs/`, `otel/`, `logs.json`,
 * `checkpoint-<tag>.json` and `shell_history` are siblings of it and are not
 * sessions: `logs.json` records prompts and never replies, and a checkpoint is
 * a named tag with no session id, no timestamps and no usage. Reading either
 * as a session would put a row on the floor that no `--resume` could open.
 *
 * @returns {Promise<Array<{file:string, projectDir:string, parentSessionId:string|null}>>}
 */
async function walkSessionFiles() {
  /** @type {Array<{file:string, projectDir:string, parentSessionId:string|null}>} */
  const out = [];

  let projects;
  try {
    projects = await fsp.readdir(tmpDir(), { withFileTypes: true });
  } catch {
    return out;
  }

  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const chats = path.join(tmpDir(), project.name, 'chats');

    /** @param {string} dir @param {number} depth @param {string|null} parent */
    async function walk(dir, depth, parent) {
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
          // A directory inside `chats/` is named for the session that spawned
          // the juniors inside it (`chats/<parentSessionId>/<sessionId>.jsonl`).
          await walk(full, depth + 1, parent || entry.name);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) {
          out.push({ file: full, projectDir: project.name, parentSessionId: parent });
        }
      }
    }

    await walk(chats, 0, null);
  }
  return out;
}

/**
 * Build one SessionSummary from a session file, using bounded head/tail reads
 * only — never a full-file read (CONTRACTS.md).
 *
 * @param {{file:string, projectDir:string, parentSessionId:string|null}} found
 * @param {number} mtimeMs
 * @param {Map<string,string>} projectPaths slug → absolute path
 * @returns {Promise<import('../../core/model.mjs').SessionSummary>}
 */
async function buildSessionSummary(found, mtimeMs, projectPaths) {
  const { file, projectDir, parentSessionId } = found;

  const head = await readHead(file, HEAD_BYTES);
  const headRecords = linesFromChunk(head.text, { dropLastPartial: head.truncated })
    .map(parseLine)
    .filter(Boolean);

  /** @type {ReturnType<typeof extractSessionMeta>} */
  let meta = null;
  for (const rec of headRecords) {
    const m = extractSessionMeta(rec);
    // Later `$set` updates overwrite field by field: the first line carries the
    // session id, and a summary may only arrive several turns in.
    if (m) meta = meta ? mergeMeta(meta, m) : m;
  }
  const headDigest = digestRecords(headRecords);

  const tail = await readTail(file, TAIL_BYTES);
  const tailRecords = linesFromChunk(tail.text, { dropFirstPartial: tail.truncated })
    .map(parseLine)
    .filter(Boolean);
  for (const rec of tailRecords) {
    const m = extractSessionMeta(rec);
    if (m) meta = meta ? mergeMeta(meta, m) : m;
  }
  const digest = digestRecords(tailRecords);

  const sessionId =
    (meta && meta.sessionId) || sessionIdFromFilename(path.basename(file)) || projectDir;

  // The project slug resolves to a real path through the registry. A legacy
  // sha256 directory cannot be reversed at all, and `directories[0]` — the
  // dirs a user added with `/dir add` — is a workspace root rather than the
  // session's cwd, so it is the last resort rather than the first.
  const cwd =
    (!projectDirLooksLegacy(projectDir) ? projectPaths.get(projectDir) : null) ||
    (meta && meta.directories.length ? meta.directories[0] : null) ||
    'unknown';

  const firstUserText = headDigest.firstUserText || digest.firstUserText;
  const title = truncateTitle((meta && meta.summary) || firstUserText, 60);
  const inputTokens = Math.max(headDigest.inputTokens, digest.inputTokens);
  const cachedTokens = Math.max(headDigest.cachedTokens, digest.cachedTokens);
  const outputTokens = digest.outputTokens;
  const model = digest.model || headDigest.model;
  const lastActivityAt = digest.lastAt || (meta && meta.lastUpdated) || mtimeMs;

  /** @type {import('../../core/model.mjs').SessionSummary} */
  const summary = {
    id: agentId('gemini-cli', sessionId),
    runtime: 'gemini-cli',
    title,
    // `summary` is written by the model, not typed by the user, so it is not a
    // custom title. Reporting it as one would let a generated string outrank a
    // name the user actually chose, everywhere the two compete.
    hasCustomTitle: false,
    cwd,
    gitBranch: null,
    model,
    lastActivityAt,
    tokens: inputTokens + outputTokens,
    cacheTokens: cachedTokens,
    costEstimate: estimateCost({
      input: inputTokens,
      output: outputTokens,
      cacheRead: cachedTokens,
      cacheWrite: 0,
      model,
    }),
    lastRole: digest.lastRole,
    lastText: clampText(digest.lastText),
    turnEnded: digest.turnEnded,
  };

  // WP-41's fields. A junior is `kind: 'subagent'` in its own metadata, or a
  // file sitting in a directory named for the session that spawned it; either
  // is enough, and the path is the one that survives a missing metadata line.
  if (parentSessionId || (meta && meta.kind === 'subagent')) {
    summary.subagent = true;
    if (parentSessionId) summary.parentSessionId = parentSessionId;
  }

  return summary;
}

/**
 * Every Gemini CLI session on disk, newest first, bounded by opts. A parse
 * failure on one session is logged and skipped; it never fails the scan
 * (`docs/02-ARCHITECTURE.md` §2.1, CONTRACTS.md rule 6).
 * @param {{maxAgeDays?:number, limit?:number}} [opts]
 * @returns {Promise<import('../../core/model.mjs').SessionSummary[]>}
 */
async function scanSessions({ maxAgeDays, limit } = {}) {
  if (!(await available())) return [];

  let files;
  try {
    files = await walkSessionFiles();
  } catch {
    return [];
  }
  if (files.length === 0) return [];

  const maxAgeMs =
    Number.isFinite(maxAgeDays) && maxAgeDays > 0 ? maxAgeDays * 24 * 60 * 60 * 1000 : Infinity;
  const cap = Number.isFinite(limit) && limit > 0 ? limit : Infinity;
  const now = Date.now();

  const stated = [];
  for (const found of files) {
    try {
      const st = await fsp.stat(found.file);
      if (now - st.mtimeMs <= maxAgeMs) stated.push({ found, mtimeMs: st.mtimeMs });
    } catch {
      // File vanished between readdir and stat. Skip it.
    }
  }
  stated.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (stated.length === 0) return [];

  const projectPaths = await loadProjectPaths();

  const out = [];
  for (const { found, mtimeMs } of stated.slice(0, cap)) {
    try {
      out.push(await buildSessionSummary(found, mtimeMs, projectPaths));
    } catch (err) {
      console.error(
        '[gemini-cli adapter] skipping unreadable session file:',
        found.file,
        err && err.message,
      );
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
 * Find the session file for a bare Gemini CLI session id. Tries a filename
 * match first — a junior's file is literally `<sessionId>.jsonl`, and an
 * auto-recorded file ends in the session's short id — then falls back to a
 * bounded scan of file heads for a matching `sessionId` in the metadata line.
 * @param {string} sessionId
 * @returns {Promise<string|null>}
 */
async function findSessionFile(sessionId) {
  let files;
  try {
    files = await walkSessionFiles();
  } catch {
    return null;
  }
  if (files.length === 0) return null;

  const byName = files
    .filter((f) => {
      const base = path.basename(f.file).replace(/\.jsonl$/i, '');
      return base === sessionId || base.startsWith(`${SESSION_FILE_PREFIX}`);
    })
    .filter((f) => path.basename(f.file).includes(sessionId))
    .map((f) => f.file);
  if (byName.length > 0) return newestOf(byName);

  const stated = [];
  for (const found of files) {
    try {
      const st = await fsp.stat(found.file);
      stated.push({ file: found.file, mtimeMs: st.mtimeMs });
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
        if (meta && meta.sessionId === sessionId) return file;
      }
    } catch {
      // skip this file, keep looking
    }
  }
  return null;
}

/**
 * Full message list for one session, most recent last. Text only — no tool
 * calls, no thoughts, no UI notices (see parse.mjs's `extractMessage`).
 * @param {string} id
 * @param {{maxMessages?:number}} [opts]
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

  const { messages } = digestRecords(records);
  const out = messages.map((m) => ({ role: m.role, text: m.text, at: m.at ?? fallbackAt }));
  const cap = Number.isFinite(maxMessages) && maxMessages > 0 ? maxMessages : out.length;
  return out.slice(-cap);
}

/** @param {unknown} err */
function describeSpawnError(err) {
  if (err && typeof err === 'object' && /** @type {any} */ (err).code === 'ENOENT') {
    return 'Gemini CLI is not installed';
  }
  return (err && /** @type {any} */ (err).message) || 'failed to spawn gemini';
}

/**
 * Spawn `gemini` with an argv array (never a shell string) and collect its
 * result. Always resolves — a missing binary, a non-zero exit or a timeout all
 * produce `{ok:false, error}` rather than a rejection.
 * @param {string[]} args
 * @param {{cwd?:string, timeoutMs?:number}} [opts]
 * @returns {Promise<import('../../core/model.mjs').SendResult>}
 */
function runGemini(args, { cwd, timeoutMs } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('gemini', args, {
        cwd: cwd || undefined,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ ok: false, error: describeSpawnError(err) });
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
        finish({ ok: false, error: `gemini timed out after ${timeoutMs}ms` });
      }, timeoutMs);
    }

    child.on('error', (err) => finish({ ok: false, error: describeSpawnError(err) }));
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      if (code === 0) finish({ ok: true, text: stdout.trim() });
      else finish({ ok: false, error: stderr.trim() || `gemini exited with code ${code}` });
    });
  });
}

/**
 * The argv for one non-interactive turn.
 *
 * `--resume <id>` reopens a recorded session and `-p <text>` runs headless with
 * a prompt; the two are not documented as mutually exclusive (only
 * `--resume` / `--session-id` / `--session-file` are, and `-p` / `-i` are).
 * Without a session id it is a fresh headless turn, which is the honest
 * degradation rather than silently answering into the wrong conversation.
 *
 * Pure — same inputs, same array, no I/O — so the test suite can assert the
 * exact array rather than reason about it, exactly as `buildLaunch` is asserted
 * in `terminals.test.mjs`. The session id and the turn text are user data, and
 * each is ONE element of the returned array, never concatenated into a longer
 * one, so the only thing that ever parses them is `gemini`'s own argument
 * parser.
 * @param {{sessionId?:string, text:string}} opts
 * @returns {string[]}
 */
export function geminiPromptArgs({ sessionId, text }) {
  return sessionId ? ['--resume', String(sessionId), '-p', String(text)] : ['-p', String(text)];
}

/**
 * The argv for resuming one session in an interactive terminal. Pure, for the
 * same reason as `geminiPromptArgs`. Handed to `launchTerminal()` as `command`,
 * which distributes it into whichever emulator's own argv the machine has.
 * @param {string} sessionId
 * @returns {string[]}
 */
export function geminiResumeCommand(sessionId) {
  return ['gemini', '--resume', String(sessionId)];
}

/**
 * The argv for a brand-new interactive session: plain `gemini`, plus the first
 * prompt behind `-i` when there is one. `-i` (`--prompt-interactive`) runs the
 * prompt and *stays* interactive; `-p` would run it and exit, leaving the user
 * looking at a terminal that had already closed.
 * @param {unknown} [instructions]
 * @returns {string[]}
 */
export function geminiNewSessionCommand(instructions) {
  const prompt = String(instructions || '').trim();
  return prompt ? ['gemini', '-i', prompt] : ['gemini'];
}

/**
 * Send a turn into a Gemini CLI session via its headless prompt surface.
 * @param {string} id
 * @param {string} text
 * @param {{cwd?:string, timeoutMs?:number}} [opts]
 * @returns {Promise<import('../../core/model.mjs').SendResult>}
 */
async function send(id, text, { cwd, timeoutMs } = {}) {
  if (!(await available())) return { ok: false, error: 'Gemini CLI is not installed' };

  const { sessionId } = splitAgentId(id);
  try {
    return await runGemini(geminiPromptArgs({ sessionId, text }), { cwd, timeoutMs });
  } catch (err) {
    return { ok: false, error: describeSpawnError(err) };
  }
}

/**
 * Spawn an interactive terminal attached to `gemini --resume <id>`.
 *
 * Best effort: any failure is swallowed rather than thrown, since there is no
 * result channel for this method and a silently-missing terminal is preferable
 * to crashing the caller. That also means the caller cannot tell "Gemini CLI is
 * not installed" from "no terminal would open" — see `openNewSession`, which
 * does throw.
 * @param {string} id
 * @param {string} cwd
 * @param {{terminal?: string}} [opts] the user's pinned emulator from settings
 * @returns {Promise<void>}
 */
async function openInTerminal(id, cwd, opts = {}) {
  if (!(await available())) return;
  const { sessionId } = splitAgentId(id);

  try {
    await launchTerminal({
      command: geminiResumeCommand(sessionId),
      cwd,
      sessionId,
      prefix: 'gemini-resume',
      pin: opts.terminal,
    });
  } catch {
    // Best-effort only — see JSDoc above.
  }
}

/**
 * Open a terminal running a NEW Gemini CLI session in `cwd`.
 *
 * Unlike `openInTerminal`, a launcher failure is NOT swallowed: the route that
 * calls this reports the message, and "Could not open a terminal. Tried: …" is
 * more useful than a silent nothing.
 * @param {string} cwd absolute path to an existing directory
 * @param {{instructions?: string, terminal?: string}} [opts]
 * @returns {Promise<void>}
 */
async function openNewSession(cwd, opts = {}) {
  if (!(await available())) throw new Error('Gemini CLI is not installed');
  await launchTerminal({
    command: geminiNewSessionCommand(opts.instructions),
    cwd,
    prefix: 'gemini-new',
    pin: opts.terminal,
  });
}

/**
 * The Gemini CLI RuntimeAdapter. See `docs/02-ARCHITECTURE.md` §2 for the
 * interface this satisfies and `docs/ADAPTERS.md` for how to add another.
 */
export const adapter = {
  id: 'gemini-cli',
  label: 'Gemini CLI',
  available,
  liveSessions,
  scanSessions,
  conversation,
  send,
  openInTerminal,
  openNewSession,
  hooks,
};

export default adapter;

// Exported for tests and tooling that want the resolved paths without
// re-deriving the `GEMINI_CLI_HOME` rule.
export { geminiHome, projectsFile, tmpDir };
