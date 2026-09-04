/**
 * OpenCode runtime adapter. WP-25. Implements `RuntimeAdapter`
 * (`docs/02-ARCHITECTURE.md` §2).
 *
 * CRITICAL, and the same statement the Codex adapter opens with: **OpenCode is
 * not installed on the reference build machine.** `opencode --version` is not
 * on PATH and `~/.local/share/opencode` does not exist — both checked,
 * read-only, on 4 September 2026. Every exported method must be safe to call in
 * that situation: `available()` resolves false and every other method degrades
 * to an empty or failed result rather than throwing. The same code must also be
 * a correct, complete implementation for a machine where OpenCode *is*
 * present; it is written and reasoned about as such, and has never been
 * exercised end to end. `docs/DEVIATIONS.md` §123.
 *
 * All OpenCode-specific format knowledge — the JSON shapes AND the SQL — lives
 * in ./parse.mjs, whose header carries the provenance of every field name and
 * the argument for why there is no SQLite reader in this directory. This file
 * only does I/O: directory walking, bounded reads, child-process spawning.
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
  SQL,
  latestMessagePerSession,
  parseExport,
  parseJson,
  parseRows,
  sessionFromInfoJson,
  sessionFromListRow,
  sessionFromSqlRow,
  truncateTitle,
} from './parse.mjs';

/**
 * How stale the cached session roster is allowed to get before OpenCode's CLI
 * is asked again.
 *
 * **This is the §77 lesson, applied before it could become a bug rather than
 * after.** Claude Code's `claude agents --json` was being spawned on every
 * 5 s poll and cost ~12% of a core at idle; PR #1 put a 60 s TTL on it and the
 * cost went to 2-3 spawns per two minutes. Every read this adapter performs is
 * a child process — that is the price of going through OpenCode's own
 * commands instead of parsing its SQLite file (see ./parse.mjs) — so an
 * uncached `scanSessions` would reintroduce exactly the cost §77 removed, on a
 * runtime that spawns a Bun binary rather than a Node one.
 *
 * 60 s matches the Claude Code figure deliberately: the two adapters are
 * answering the same question on the same poll loop, and a session that
 * appears up to a minute late is the accepted deviation there already. It is
 * NOT the poll interval, and nothing here may shorten it to become one.
 * `docs/DEVIATIONS.md` §123.
 */
export const ROSTER_TTL_MS = 60_000;

/** How long any one OpenCode CLI call may take before it is killed. */
const CLI_TIMEOUT_MS = 10_000;

/** Bound on directory recursion while walking a legacy JSON storage tree. */
const MAX_WALK_DEPTH = 6;

/** Bound on one legacy session-info file. These are small objects, not transcripts. */
const MAX_INFO_BYTES = 1024 * 1024;

/**
 * OpenCode's data directory.
 *
 * `xdg-basedir` semantics, which OpenCode uses unmodified: `$XDG_DATA_HOME` if
 * set, else `~/.local/share`. It has **no Windows special case** — a Windows
 * install puts this under the user profile at `.local/share` rather than in
 * `%APPDATA%`, which is worth stating because guessing `%APPDATA%` here would
 * report "not installed" on every Windows machine that has it.
 * @returns {string}
 */
function dataDir() {
  const override = process.env.XDG_DATA_HOME;
  const base =
    override && String(override).trim()
      ? String(override).trim()
      : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'opencode');
}

/** Cached across the process lifetime, per docs/02-ARCHITECTURE.md §2. */
let availableCache = null;

/**
 * Is OpenCode present on this machine? Cheap, cached, never throws.
 *
 * The data directory, not the binary. `available()` is called on the poll path
 * and is documented as cheap, so it may not spawn anything — and the question
 * DeckHQ actually needs answered is "are there sessions to show", which a
 * missing data directory settles. A machine with the binary installed and no
 * data directory has never run a session and has nothing to contribute.
 * @returns {Promise<boolean>}
 */
async function available() {
  if (!availableCache) {
    availableCache = fsp
      .access(dataDir())
      .then(() => true)
      .catch(() => false);
  }
  return availableCache;
}

/**
 * OpenCode exposes no surface for enumerating *live* sessions. `session list`
 * reports what is stored, not what has a process attached, and `opencode
 * serve`'s HTTP API is an opt-in server the user has to have started — DeckHQ
 * will not assume a port on somebody's machine. Per §2.1 we prefer a supported
 * surface where one exists; none does for liveness here, and we do not scan the
 * process table to guess.
 *
 * The daemon's degraded polling path (§4.2) infers `live` from recency.
 * @returns {Promise<import('../../core/model.mjs').LiveSession[]>}
 */
async function liveSessions() {
  return [];
}

/** @param {unknown} err */
function describeSpawnError(err) {
  if (err && typeof err === 'object' && /** @type {any} */ (err).code === 'ENOENT') {
    return 'OpenCode is not installed';
  }
  return (err && /** @type {any} */ (err).message) || 'failed to spawn opencode';
}

/**
 * Spawn `opencode` with an argv array (never a shell string) and collect its
 * result. Always resolves — a missing binary, a non-zero exit or a timeout all
 * produce `{ok:false, error}` rather than a rejection.
 * @param {string[]} args
 * @param {{cwd?:string, timeoutMs?:number}} [opts]
 * @returns {Promise<import('../../core/model.mjs').SendResult>}
 */
function runOpencode(args, { cwd, timeoutMs = CLI_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('opencode', args, {
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
        finish({ ok: false, error: `opencode timed out after ${timeoutMs}ms` });
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
      if (code === 0) finish({ ok: true, text: stdout });
      else finish({ ok: false, error: stderr.trim() || `opencode exited with code ${code}` });
    });
  });
}

/**
 * The argv for the two read-only queries and the two fallbacks. Pure and
 * exported so the test suite can assert the exact arrays — the SQL is a
 * constant from ./parse.mjs and nothing from a request body is anywhere near
 * these.
 */
export const CLI = {
  /** @returns {string[]} */
  sessionsQuery: () => ['db', SQL.sessions, '--format', 'json'],
  /** @returns {string[]} */
  recentMessagesQuery: () => ['db', SQL.recentMessages, '--format', 'json'],
  /** @returns {string[]} */
  sessionList: () => ['session', 'list', '--format', 'json'],
  /** @param {string} sessionId @returns {string[]} */
  exportSession: (sessionId) => ['export', String(sessionId)],
};

/**
 * The last roster this adapter built, and when. Copies out, so a caller
 * holding a roster can never write into the cache (the rule
 * `src/core/summary-cache.mjs` rule 3 exists for).
 * @type {{at:number, summaries:import('../../core/model.mjs').SessionSummary[]}}
 */
let roster = { at: 0, summaries: [] };

/**
 * Drop the cached roster. Test seam only — the daemon never needs this, and
 * nothing on the poll path calls it.
 * @returns {void}
 */
export function resetRosterCache() {
  roster = { at: 0, summaries: [] };
}

/**
 * Walk a legacy pre-v1.2.0 JSON storage tree for session-info files.
 *
 * **Only ever called when the CLI answered nothing**, and that condition is the
 * whole point rather than an optimisation. v1.2.0 (14 Feb 2026) migrated these
 * files into SQLite and did not delete them, so on an install that has since
 * upgraded they are stale copies of sessions the database already holds.
 * Reading them unconditionally would put every migrated session on the floor
 * twice — once current, once frozen at the migration — which is worse than not
 * reading them at all. They are the answer for exactly one machine: an install
 * still running a version older than v1.2.0, where the CLI has no `db`
 * subcommand and `session list` predates `--format json`.
 *
 * Both generations are walked, since the layout changed once before the
 * database landed:
 *   gen 1  <data>/project/<slug>/storage/session/info/<sessionID>.json
 *   gen 2  <data>/storage/session/<projectID>/<sessionID>.json
 *
 * @returns {Promise<Array<{file:string, mtimeMs:number}>>}
 */
async function walkLegacySessions() {
  /** @type {Array<{file:string, mtimeMs:number}>} */
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
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        try {
          const st = await fsp.stat(full);
          if (st.size <= MAX_INFO_BYTES) out.push({ file: full, mtimeMs: st.mtimeMs });
        } catch {
          // vanished between readdir and stat
        }
      }
    }
  }

  // Only the two directories that hold session *info*. Walking the whole data
  // directory would sweep up message and part files, which are far more
  // numerous and are not sessions.
  await walk(path.join(dataDir(), 'project'), 0);
  await walk(path.join(dataDir(), 'storage', 'session'), 0);
  return out;
}

/**
 * Every session OpenCode knows about, as normalised rows, plus the latest
 * message per session when that was obtainable.
 *
 * Three paths, in preference order, each a fallback for the one before:
 *
 *   1. `opencode db "<select>" --format json` — the full shape: tokens, cost,
 *      model, parent, archive flag. Two read-only queries, no parameters.
 *   2. `opencode session list --format json` — documented and stable, but
 *      thinner: no tokens, no model, and root sessions only.
 *   3. The legacy JSON files, for a pre-v1.2.0 install only. See
 *      `walkLegacySessions` for why this is last and conditional.
 *
 * @returns {Promise<{rows:Array<NonNullable<ReturnType<typeof sessionFromSqlRow>>>,
 *                    messages:ReturnType<typeof latestMessagePerSession>}>}
 */
async function collectSessions() {
  /** @type {Array<NonNullable<ReturnType<typeof sessionFromSqlRow>>>} */
  let rows = [];
  let messages = latestMessagePerSession([]);

  const sql = await runOpencode(CLI.sessionsQuery());
  if (sql.ok) {
    rows = parseRows(sql.text).map(sessionFromSqlRow).filter(Boolean);
    if (rows.length > 0) {
      // Enrichment only: a failure here costs `lastRole` and `turnEnded` and
      // leaves every row standing, so it is never allowed to fail the scan.
      const recent = await runOpencode(CLI.recentMessagesQuery());
      if (recent.ok) messages = latestMessagePerSession(parseRows(recent.text));
      return { rows, messages };
    }
  }

  const list = await runOpencode(CLI.sessionList());
  if (list.ok) {
    rows = parseRows(list.text).map(sessionFromListRow).filter(Boolean);
    if (rows.length > 0) return { rows, messages };
  }

  for (const { file, mtimeMs } of await walkLegacySessions()) {
    try {
      const parsed = parseJson(await fsp.readFile(file, 'utf8'));
      const row = sessionFromInfoJson(parsed);
      if (!row) continue;
      // A legacy file with no recorded update time still has an mtime, and a
      // session with no time at all sorts to the bottom of the floor forever.
      if (!row.updatedAt) row.updatedAt = mtimeMs;
      rows.push(row);
    } catch {
      // One unreadable session never fails the scan (CONTRACTS.md rule 6).
    }
  }
  return { rows, messages };
}

/**
 * Shape one normalised row into a `SessionSummary`.
 * @param {NonNullable<ReturnType<typeof sessionFromSqlRow>>} row
 * @param {ReturnType<typeof latestMessagePerSession>} messages
 * @returns {import('../../core/model.mjs').SessionSummary}
 */
function toSummary(row, messages) {
  const last = messages.get(row.id) || null;
  const model = row.model || (last && last.model) || null;

  /** @type {import('../../core/model.mjs').SessionSummary} */
  const summary = {
    id: agentId('opencode', row.id),
    runtime: 'opencode',
    title: truncateTitle(row.title, 60),
    // OpenCode generates a title from the first prompt rather than taking one
    // the user typed, so it is not a custom title — the same call the Gemini
    // CLI adapter makes about `summary`, for the same reason.
    hasCustomTitle: false,
    cwd: row.directory || (last && last.cwd) || 'unknown',
    gitBranch: null,
    model,
    lastActivityAt: row.updatedAt || row.createdAt || Date.now(),
    tokens: row.inputTokens + row.outputTokens,
    cacheTokens: row.cacheTokens,
    costEstimate: estimateCost({
      input: row.inputTokens,
      output: row.outputTokens,
      cacheRead: row.cacheTokens,
      cacheWrite: 0,
      model,
    }),
    lastRole: last ? last.role : null,
    // Deliberately empty. Message text lives in the `part` table, one row per
    // fragment, and pulling it on the poll path would mean a third query whose
    // size is the whole conversation rather than one row per session. The
    // panel fills it in from `conversation()` the moment it is opened, which
    // is the only place it is read at full length anyway. Named as a known gap
    // in the changelog rather than left to be discovered.
    lastText: clampText(''),
    // The strongest turn boundary of any runtime here: OpenCode records the
    // moment the assistant finished, so this is read rather than inferred from
    // "the assistant spoke last". No message means no evidence, which is not
    // the same as a turn that ended.
    turnEnded: last ? last.completed : false,
  };

  if (row.parentId) {
    summary.subagent = true;
    summary.parentSessionId = row.parentId;
  }
  // The runtime's own archive flag, answered fresh on every scan and never
  // cached — docs/DEVIATIONS.md §46. Absent rather than `false` when the path
  // that produced this row cannot report it, because an absent flag must never
  // be read as "not archived".
  if (row.archived) summary.archived = true;

  return summary;
}

/**
 * Every OpenCode session, newest first, bounded by opts.
 *
 * The roster is cached for `ROSTER_TTL_MS` — see that constant for why. The
 * cache holds the whole roster and `opts` is applied to a copy of it, so two
 * callers asking for different windows still share one set of spawns.
 * @param {{maxAgeDays?:number, limit?:number}} [opts]
 * @returns {Promise<import('../../core/model.mjs').SessionSummary[]>}
 */
async function scanSessions({ maxAgeDays, limit } = {}) {
  if (!(await available())) return [];

  const now = Date.now();
  if (!roster.at || now - roster.at > ROSTER_TTL_MS) {
    try {
      const { rows, messages } = await collectSessions();
      const summaries = [];
      for (const row of rows) {
        try {
          summaries.push(toSummary(row, messages));
        } catch (err) {
          console.error('[opencode adapter] skipping unreadable session:', row.id, err?.message);
        }
      }
      summaries.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
      // Stamped after the work returns, not before it, so a slow or failed
      // collection cannot make the next call think it has a fresh answer.
      roster = { at: Date.now(), summaries };
    } catch (err) {
      console.error('[opencode adapter] session scan failed:', err?.message);
      // Keep whatever the last good roster was rather than emptying the floor
      // over one failed spawn. It ages out on the next successful call.
    }
  }

  const maxAgeMs =
    Number.isFinite(maxAgeDays) && maxAgeDays > 0 ? maxAgeDays * 24 * 60 * 60 * 1000 : Infinity;
  const cap = Number.isFinite(limit) && limit > 0 ? limit : Infinity;

  return roster.summaries
    .filter((s) => now - s.lastActivityAt <= maxAgeMs)
    .slice(0, cap)
    .map((s) => ({ ...s }));
}

/**
 * Full message list for one session, most recent last, through `opencode
 * export` — a documented command whose whole job is emitting a session as
 * JSON. Text only: tool calls, reasoning and patches are skipped in
 * `parseExport`.
 *
 * Not cached. It runs when a panel is opened, never on the poll path.
 * @param {string} id
 * @param {{maxMessages?:number}} [opts]
 * @returns {Promise<import('../../core/model.mjs').Message[]>}
 */
async function conversation(id, { maxMessages } = {}) {
  if (!(await available())) return [];

  const { sessionId } = splitAgentId(id);
  const res = await runOpencode(CLI.exportSession(sessionId));
  if (!res.ok) return [];

  const messages = parseExport(res.text, Date.now());
  const cap = Number.isFinite(maxMessages) && maxMessages > 0 ? maxMessages : messages.length;
  return messages.slice(-cap);
}

/**
 * The argv for one non-interactive turn: `opencode run --session <id> <text>`.
 *
 * Pure — same inputs, same array, no I/O — so the test suite can assert the
 * exact array rather than reason about it, exactly as `buildLaunch` is
 * asserted in `terminals.test.mjs`. The session id and the turn text are user
 * data, and each is ONE element of the returned array, never concatenated into
 * a longer one, so the only thing that ever parses them is `opencode`'s own
 * argument parser.
 * @param {{sessionId?:string, text:string}} opts
 * @returns {string[]}
 */
export function opencodeRunArgs({ sessionId, text }) {
  return sessionId ? ['run', '--session', String(sessionId), String(text)] : ['run', String(text)];
}

/**
 * The argv for resuming one session in an interactive terminal. Pure, for the
 * same reason as `opencodeRunArgs`. Handed to `launchTerminal()` as `command`,
 * which distributes it into whichever emulator's own argv the machine has.
 * @param {string} sessionId
 * @returns {string[]}
 */
export function opencodeResumeCommand(sessionId) {
  return ['opencode', '--session', String(sessionId)];
}

/**
 * The argv for a brand-new interactive session: plain `opencode`, plus the
 * first prompt behind `--prompt` when there is one. `--prompt` seeds the TUI
 * and leaves it open; `run` would answer once and exit, leaving the user
 * looking at a terminal that had already closed.
 * @param {unknown} [instructions]
 * @returns {string[]}
 */
export function opencodeNewSessionCommand(instructions) {
  const prompt = String(instructions || '').trim();
  return prompt ? ['opencode', '--prompt', prompt] : ['opencode'];
}

/**
 * Send a turn into an OpenCode session via its non-interactive `run` surface.
 * @param {string} id
 * @param {string} text
 * @param {{cwd?:string, timeoutMs?:number}} [opts]
 * @returns {Promise<import('../../core/model.mjs').SendResult>}
 */
async function send(id, text, { cwd, timeoutMs } = {}) {
  if (!(await available())) return { ok: false, error: 'OpenCode is not installed' };

  const { sessionId } = splitAgentId(id);
  try {
    const res = await runOpencode(opencodeRunArgs({ sessionId, text }), { cwd, timeoutMs });
    // A reply this session's roster has not seen yet is exactly the case the
    // TTL would otherwise hide for a minute, and we know it happened because
    // we caused it.
    if (res.ok) resetRosterCache();
    return res.ok ? { ok: true, text: String(res.text || '').trim() } : res;
  } catch (err) {
    return { ok: false, error: describeSpawnError(err) };
  }
}

/**
 * Spawn an interactive terminal attached to `opencode --session <id>`.
 *
 * Best effort: any failure is swallowed rather than thrown, since there is no
 * result channel for this method and a silently-missing terminal is preferable
 * to crashing the caller. That also means the caller cannot tell "OpenCode is
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
      command: opencodeResumeCommand(sessionId),
      cwd,
      sessionId,
      prefix: 'opencode-resume',
      pin: opts.terminal,
    });
  } catch {
    // Best-effort only — see JSDoc above.
  }
}

/**
 * Open a terminal running a NEW OpenCode session in `cwd`.
 *
 * Unlike `openInTerminal`, a launcher failure is NOT swallowed: the route that
 * calls this reports the message, and "Could not open a terminal. Tried: …" is
 * more useful than a silent nothing.
 * @param {string} cwd absolute path to an existing directory
 * @param {{instructions?: string, terminal?: string}} [opts]
 * @returns {Promise<void>}
 */
async function openNewSession(cwd, opts = {}) {
  if (!(await available())) throw new Error('OpenCode is not installed');
  await launchTerminal({
    command: opencodeNewSessionCommand(opts.instructions),
    cwd,
    prefix: 'opencode-new',
    pin: opts.terminal,
  });
}

/**
 * The OpenCode RuntimeAdapter. See `docs/02-ARCHITECTURE.md` §2 for the
 * interface this satisfies and `docs/ADAPTERS.md` for how to add another.
 */
export const adapter = {
  id: 'opencode',
  label: 'OpenCode',
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

// Exported for tests and tooling that want the resolved path without
// re-deriving the XDG rule.
export { dataDir };
