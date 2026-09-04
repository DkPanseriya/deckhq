/**
 * Reading one conversation, and sending a turn into it (WP-22 follow-up).
 *
 * Split out of `adapter.mjs` unchanged: finding a session's file, reading
 * its tail, the argument list and spawn options for a send, and `send`
 * itself.
 *
 * A send reaches the runtime and nothing else. The review is discharged by
 * the daemon when the runtime records the user turn — the documented
 * UserPromptSubmit exception — never by this adapter guessing
 * (docs/01-PRODUCT.md §2).
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { splitAgentId } from '../../core/model.mjs';
import { PROJECTS_DIR, TAIL_BYTES, readTail, parseConversation } from './parse.mjs';
import { createStreamParser } from './stream.mjs';
import { subagentFiles } from './adapter-scan.mjs';

/**
 * Find the on-disk transcript file for a raw (unprefixed) session id by
 * checking each project directory. Never throws; returns null if not found.
 * @param {string} sessionId
 * @returns {Promise<string|null>}
 */
export async function findSessionFile(sessionId) {
  // WP-41. A junior's transcript is not a top-level session file, so the loop
  // below would never find it. The scan already knows where every junior on
  // the floor lives; asking it is one map lookup and needs no extra walk.
  const junior = subagentFiles.get(sessionId);
  if (junior) return junior;
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
 * @param {{maxMessages?:number}} [opts] optional at runtime: the `= {}`
 *   default means a bare call is legal (WP-22).
 * @returns {Promise<import('../../core/model.mjs').Message[]>}
 */
export async function conversation(id, { maxMessages } = {}) {
  const { sessionId } = splitAgentId(id);
  const file = await findSessionFile(sessionId);
  if (!file) return [];
  try {
    const tail = await readTail(file, TAIL_BYTES);
    // WP-41. In a junior's own transcript every record carries
    // `isSidechain: true`; keeping the usual filter would hand the panel an
    // empty conversation for a session that plainly said things.
    const sidechain = subagentFiles.has(sessionId);
    return parseConversation(tail, { maxMessages, sidechain });
  } catch {
    return [];
  }
}

/**
 * The exact argv one streamed turn is spawned with. Pure and exported so the
 * flags can be asserted without a process, and so there is one place to look
 * when Claude Code's CLI moves.
 *
 * Every flag was checked against `claude --help` on Claude Code 2.1.231:
 *
 *   -p, --print                    non-interactive; required by the other two
 *   --output-format stream-json    "realtime streaming" (only with --print)
 *   --verbose                      stream-json in --print mode is verbose-only
 *   --include-partial-messages     "Include partial message chunks as they
 *                                  arrive (only works with --print and
 *                                  --output-format=stream-json)" — this is
 *                                  what makes a reply appear a word at a
 *                                  time rather than a message at a time.
 *
 * `--resume <id>` is the existing contract from docs/DEVIATIONS.md §9: it
 * appends to the same transcript and comes back with the same session id.
 *
 * The session id and the user's text are argv ELEMENTS. Neither is ever
 * interpolated into a command string (docs/02-ARCHITECTURE.md §9).
 *
 * @param {string} sessionId
 * @param {string} text
 * @returns {string[]}
 */
export function sendArgs(sessionId, text) {
  return [
    '--resume',
    sessionId,
    '-p',
    text,
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];
}

/**
 * The child-process options one streamed turn is spawned with. Exported for
 * the same reason as `sendArgs`, and because ONE of these fields is a
 * product promise rather than a detail:
 *
 *   detached: false — the child stays in this process's group. Closing the
 *   daemon kills it (see `send`'s abort handling), and a Ctrl+C in the
 *   terminal the daemon was started from reaches it too. A detached child
 *   would outlive both and go on writing into the user's transcript with
 *   nothing left to read it.
 *
 * @param {string|undefined} cwd
 * @param {Record<string,string>} [env] left undefined in production, so the
 *   child inherits this process's environment exactly as it always has. The
 *   `bin` test seam sets it, which is how the fake CLI is configured without
 *   putting anything into the daemon's own environment.
 */
export function sendSpawnOptions(cwd, env) {
  /** @type {any} */
  const opts = {
    cwd,
    windowsHide: true,
    detached: false,
    // stdin is closed rather than inherited: `claude -p` must never be able
    // to sit waiting on a terminal this process does not have.
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  if (env) opts.env = env;
  return opts;
}

/** How much of a failing run's stderr is kept for the error message. */
export const SEND_STDERR_BYTES = 8 * 1024;

/**
 * Send a turn into a session and report what comes back as it comes back.
 *
 * WP-09. This used to be one `execFile` that resolved when the whole turn was
 * over — up to ten minutes with the composer disabled and nothing on screen.
 * It now spawns the CLI in `stream-json` mode and hands each event to
 * `onEvent` the moment the line arrives, so the caller can push it at the
 * browser (docs/plan/05-GUI-UX-SPEC.md §4.3). The returned promise still
 * resolves to the same `SendResult` it always did, so a caller that only
 * wants the answer is unchanged.
 *
 * Never throws and never rejects: every failure — a missing binary, a
 * non-zero exit, a timeout, an abort, output that is not JSON — comes back as
 * `{ok:false, error}`.
 *
 * @param {string} id
 * @param {string} text
 * @param {{cwd?:string, timeoutMs?:number,
 *          onEvent?:(event:any)=>void,
 *          signal?:AbortSignal,
 *          bin?:{command:string, args?:string[], env?:Record<string,string>},
 *          spawnFn?:typeof spawn}} [opts]
 *   `onEvent` receives the neutral events described in ./stream.mjs.
 *   `signal` aborts the run and kills the child — this is how a closing
 *   daemon guarantees it leaves nothing behind.
 *   `bin` and `spawnFn` are test seams in the same shape as `liveSessions`'
 *   `probe` and `openInApp`'s `checkAvailable`: they stand in for the CLI so
 *   the whole path can be driven against a recorded stream without a login.
 *   The daemon passes neither.
 * @returns {Promise<import('../../core/model.mjs').SendResult>}
 */
export function send(id, text, opts = {}) {
  const { sessionId } = splitAgentId(id);
  const { cwd, timeoutMs = 120_000, onEvent, signal } = opts;
  const bin = opts.bin || { command: 'claude', args: [] };
  const spawnChild = opts.spawnFn || spawn;
  const argv = [...(bin.args || []), ...sendArgs(sessionId, text)];

  return new Promise((resolve) => {
    let settled = false;
    /** @type {import('node:child_process').ChildProcess|null} */
    let child = null;
    let timer = null;
    let stderr = '';
    /** @type {{ok:boolean, text:string, error:string|null}|null} */
    let result = null;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      resolve(value);
    };

    /** Kill the child, and everything this function holds open with it. */
    const kill = () => {
      if (!child || child.killed || child.exitCode !== null) return;
      try {
        child.kill();
      } catch {
        // Already gone. Nothing to clean up.
      }
    };

    function onAbort() {
      kill();
      finish({ ok: false, error: 'the send was cancelled' });
    }

    if (signal?.aborted) {
      resolve({ ok: false, error: 'the send was cancelled' });
      return;
    }

    const parser = createStreamParser((event) => {
      if (event.type === 'result') {
        result = { ok: event.ok, text: event.text, error: event.error };
      }
      if (typeof onEvent === 'function') {
        try {
          onEvent(event);
        } catch {
          // A listener's failure must not fail the send.
        }
      }
    });

    try {
      child = spawnChild(bin.command, argv, sendSpawnOptions(cwd, bin.env));
    } catch (err) {
      resolve({ ok: false, error: err && err.message ? err.message : 'could not start claude' });
      return;
    }

    signal?.addEventListener?.('abort', onAbort, { once: true });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        kill();
        finish({ ok: false, error: `claude timed out after ${timeoutMs}ms and was killed` });
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    }

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => parser.push(String(chunk)));
    child.stdout?.on('error', () => {
      /* the exit handler below is what settles this */
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => {
      if (stderr.length >= SEND_STDERR_BYTES) return;
      stderr += String(chunk).slice(0, SEND_STDERR_BYTES - stderr.length);
    });
    child.stderr?.on('error', () => {});

    child.on('error', (err) => {
      finish({
        ok: false,
        error: err && err.message ? err.message : 'claude could not be started',
      });
    });

    child.on('close', (code, sig) => {
      parser.end();
      if (result) {
        finish(
          result.ok
            ? { ok: true, text: result.text }
            : { ok: false, error: result.error || 'claude reported an error' },
        );
        return;
      }
      // No `result` line. Say what actually happened rather than inventing a
      // reply: the stderr tail if there is one, the signal if it was killed,
      // the exit code otherwise.
      const tail = stderr.trim().split('\n').slice(-4).join(' ').trim();
      if (sig) {
        finish({ ok: false, error: tail || `claude was killed (${sig})` });
        return;
      }
      if (code !== 0) {
        finish({ ok: false, error: tail || `claude exited with code ${code}` });
        return;
      }
      finish({
        ok: false,
        error: tail || 'claude produced no result event',
      });
    });
  });
}
