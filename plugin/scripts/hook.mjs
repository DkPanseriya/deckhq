#!/usr/bin/env node
/**
 * The command every DeckHQ plugin hook runs.
 *
 *   node scripts/hook.mjs           read the payload on stdin, POST it
 *   node scripts/hook.mjs --start   the same, and start the daemon if none
 *
 * ## Why this exists at all
 *
 * The hooks DeckHQ writes into `settings.json` carry the port as a literal,
 * fixed at install time, because the daemon is running when the user clicks
 * install and can say where it is. A plugin has no such moment: it is copied
 * into `~/.claude/plugins/cache/` by `claude plugin install`, possibly on a
 * machine that has never run DeckHQ, and `docs/DEVIATIONS.md` §86.6 established
 * that an `http` hook cannot interpolate a port either — its `url` is a
 * literal and the only substitution the schema allows is `$VAR` inside
 * `headers`. So the plugin ships a `command` hook, and the command looks the
 * daemon up: `~/.deckhq/daemon.json` first (written by `startDaemon`), then
 * `DECKHQ_PORT`, then any port the settings-file hooks already name, then the
 * ten ports the daemon walks.
 *
 * ## What it must never do
 *
 * Fail loudly. Claude Code shows a hook's stderr and its non-zero exit in the
 * session. This process exits 0 on every path — no daemon, a daemon that
 * refuses, a malformed payload, a closed stdin — and prints nothing at all.
 *
 * It also never interprets the payload. The bytes that arrive on stdin are
 * POSTed to `/api/hook` verbatim; deciding what a `PreToolUse` means is the
 * adapter's job on the daemon's side of the socket
 * (`docs/02-ARCHITECTURE.md` §2).
 */
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { findDaemon, postHook } from '../lib/deckhq.mjs';
import { ensureDaemon } from '../lib/start.mjs';

/**
 * How long the ordinary event may spend looking for a daemon.
 *
 * On the machine with no daemon this costs nothing measurable: every candidate
 * port refuses the TCP connect immediately and the HTTP client is never loaded.
 * The budget only matters on the machine that HAS one, and there it has to
 * cover the ~88 ms Node spends standing `fetch` up in a cold process plus the
 * round trip — a tighter ceiling was tried at 400 ms and dropped events on a
 * loaded Windows box. The ceiling is spent in full only by a stranger holding
 * one of the ports open without answering.
 */
export const FIND_TIMEOUT_MS = 1500;

/** And how long the POST itself may take. `/api/hook` answers before it works. */
export const POST_TIMEOUT_MS = 1000;

/**
 * Everything the stream has, or an empty buffer. Never rejects: a hook whose
 * stdin was closed by a runtime that changed its mind still exits cleanly.
 * @param {any} stream
 * @returns {Promise<Buffer>}
 */
export function readAll(stream) {
  return new Promise((resolve) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    };
    stream.on('data', (c) => {
      const chunk = Buffer.isBuffer(c) ? c : Buffer.from(String(c));
      size += chunk.length;
      // The daemon refuses anything past 512 KB anyway; stop reading rather
      // than buffer a runaway payload in a process that is blocking a session.
      if (size > 512 * 1024) {
        stream.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', done);
    stream.on('error', done);
    stream.on('close', done);
    stream.resume?.();
  });
}

/**
 * One hook event, start to finish.
 *
 * @param {{argv?:string[], stdin?:any, find?:typeof findDaemon,
 *          ensure?:typeof ensureDaemon, post?:typeof postHook}} [deps]
 * @returns {Promise<{port:number|null, posted:boolean, started:boolean}>}
 *   returned for the tests; the process itself says nothing.
 */
export async function runHook(deps = {}) {
  const argv = deps.argv || process.argv.slice(2);
  const start = argv.includes('--start');
  const body = await readAll(deps.stdin || process.stdin);

  let port = null;
  let started = false;
  if (start) {
    // `SessionStart` is the one event that may take its time: the hook is
    // declared `async` in hooks/hooks.json, so Claude Code has already moved
    // on and nothing is waiting for this process.
    const result = await (deps.ensure || ensureDaemon)({});
    port = result.port;
    started = result.started;
  } else {
    const found = await (deps.find || findDaemon)({ timeoutMs: FIND_TIMEOUT_MS });
    port = found ? found.port : null;
  }

  // Nothing listening, and nothing to say about it. A start with no payload is
  // still a success.
  if (port == null || body.length === 0) return { port, posted: false, started };
  const posted = await (deps.post || postHook)(port, body, POST_TIMEOUT_MS);
  return { port, posted, started };
}

// Only run when this file IS the command, so the tests can drive `runHook`
// without a transport attaching itself to the test runner's stdin.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  runHook().then(
    () => {
      process.exitCode = 0;
    },
    () => {
      // Exit 0 on failure too. A hook that reports a problem into a session is
      // worse than a hook that quietly did nothing.
      process.exitCode = 0;
    },
  );
}
