/**
 * Starting the daemon from a `SessionStart` hook — the half of WP-37 that
 * makes "plugin install to an exact-state floor with no other command" true.
 *
 * Three rules govern everything in this file:
 *
 *   1. **Exactly one daemon.** Ten terminals opened at once fire ten
 *      `SessionStart` hooks within the same second. A second daemon beside the
 *      first binds 4318, receives no hook events, and reports a floor that is
 *      quietly wrong — the failure `docs/DEVIATIONS.md` §83 exists to prevent.
 *      So: probe first, then an exclusive lock file, then probe again inside
 *      the lock, and only then spawn.
 *   2. **Argv arrays, never a shell string.** `docs/plan/07-AGENT-HANDOVERS.md`,
 *      Agent Backend: nothing this file spawns is assembled by string
 *      concatenation, and no value that came from a hook payload is passed to a
 *      child process at all.
 *   3. **Silence beats failure.** A machine with no `deckhq` on its PATH, a
 *      read-only home directory, or a daemon that takes longer than the budget
 *      all end the same way: exit 0, print nothing, leave the session alone.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { dataDir, findDaemon } from './deckhq.mjs';

/** How long a start lock is believed before it is treated as abandoned. */
export const LOCK_STALE_MS = 60_000;

/** How long to wait for a daemon we started (or someone else did) to answer. */
export const START_TIMEOUT_MS = 15_000;

/**
 * How DeckHQ would be launched on this machine, as an argv array, or null if
 * it cannot be found.
 *
 * The order matters. `DECKHQ_BIN` is the escape hatch for a checkout, a
 * pnpm store or a Nix profile. After that we look for the package's own entry
 * point beside the shim rather than the shim itself, because on Windows the
 * shim is a `.cmd` and running one means going through `cmd.exe`; spawning
 * `node bin/deckhq.mjs` skips that whole class of quoting problem. The shim is
 * the last resort, not the first.
 *
 * `platform` is injectable, and everything below reads it rather than
 * `process.platform` — the Windows answer (a `.cmd` shim behind `cmd.exe`) is
 * the one worth asserting hardest, and a test that can only run it on a
 * Windows host is a test two thirds of CI silently skips. Path rules follow
 * the *target* platform too, for the same reason: a PATH of `C:\tools` is not
 * split on `:` just because the host happens to be Linux.
 *
 * @param {{env?:any, platform?:string, exists?:(p:string) => boolean}} [opts]
 * @returns {{command:string, args:string[], via:string}|null}
 */
export function resolveLauncher(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const exists = opts.exists || ((p) => fs.existsSync(p));
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;

  const named = String(env.DECKHQ_BIN || '').trim();
  if (named) return launcherFor(named, 'DECKHQ_BIN', platform, env);

  const dirs = String(env.PATH || env.Path || '')
    .split(p.delimiter)
    .map((d) => d.trim())
    .filter(Boolean);

  // Pass one: the package entry point npm installs beside its shim.
  for (const dir of dirs) {
    const entry = p.join(dir, 'node_modules', 'deckhq', 'bin', 'deckhq.mjs');
    if (exists(entry)) return { command: process.execPath, args: [entry], via: 'package' };
  }

  // Pass two: whatever `deckhq` on the PATH actually is.
  const names = win ? ['deckhq.exe', 'deckhq.cmd', 'deckhq.bat', 'deckhq'] : ['deckhq'];
  for (const dir of dirs) {
    for (const name of names) {
      const file = p.join(dir, name);
      if (exists(file)) return launcherFor(file, 'path', platform, env);
    }
  }
  return null;
}

/**
 * One resolved file, as something `spawn` can run without a shell.
 * @param {string} file
 * @param {string} via
 * @param {string} platform
 * @param {any} env
 */
function launcherFor(file, via, platform, env) {
  const ext = (platform === 'win32' ? path.win32 : path.posix).extname(file).toLowerCase();
  if (ext === '.mjs' || ext === '.js' || ext === '.cjs') {
    return { command: process.execPath, args: [file], via };
  }
  if (ext === '.cmd' || ext === '.bat') {
    // Node refuses to spawn a batch file directly since 18.20.2. Running it as
    // an argument to the interpreter is the supported route, and every
    // argument here is a literal this file wrote.
    const comspec = env.ComSpec || env.COMSPEC || process.env.ComSpec || 'cmd.exe';
    return { command: comspec, args: ['/d', '/s', '/c', file], via };
  }
  return { command: file, args: [], via };
}

/**
 * Take the start lock, or report that somebody else holds a live one.
 * @param {{file?:string, now?:number, staleMs?:number}} [opts]
 * @returns {{held:boolean, file:string}}
 */
export function acquireLock(opts = {}) {
  const file = opts.file || path.join(dataDir(), 'daemon.start.lock');
  const now = opts.now ?? Date.now();
  const staleMs = opts.staleMs ?? LOCK_STALE_MS;
  const take = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(file, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: now }));
    fs.closeSync(fd);
  };
  try {
    take();
    return { held: true, file };
  } catch {
    // Somebody holds it. A hook process that was killed mid-start would hold
    // it forever, so a lock older than the stale window is broken open once.
    try {
      const stat = fs.statSync(file);
      if (now - stat.mtimeMs < staleMs) return { held: false, file };
      fs.unlinkSync(file);
      take();
      return { held: true, file };
    } catch {
      return { held: false, file };
    }
  }
}

/** @param {string} file */
export function releaseLock(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    /* already gone */
  }
}

/**
 * Make sure a DeckHQ daemon is running, and say what happened.
 *
 * @param {{env?:any, platform?:string, timeoutMs?:number, startTimeoutMs?:number,
 *          pollMs?:number, lockFile?:string, find?:typeof findDaemon,
 *          resolve?:typeof resolveLauncher, spawn?:typeof spawn,
 *          sleep?:(ms:number) => Promise<void>}} [opts]
 * @returns {Promise<{port:number|null, started:boolean, reason:string}>}
 *   `reason` is one of `running` (one was already up), `started` (we spawned
 *   it), `waited` (another hook was starting one and it came up), `busy`
 *   (another hook is starting one and it has not answered yet), `no-deckhq`
 *   (nothing to spawn) or `timeout`.
 */
export async function ensureDaemon(opts = {}) {
  const find = opts.find || findDaemon;
  const spawnFn = opts.spawn || spawn;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? 250;
  const startTimeoutMs = opts.startTimeoutMs ?? START_TIMEOUT_MS;
  const findOpts = { env: opts.env, timeoutMs: opts.timeoutMs ?? 1000 };

  const already = await find(findOpts);
  if (already) return { port: already.port, started: false, reason: 'running' };

  const lock = acquireLock({ file: opts.lockFile });
  if (!lock.held) {
    // Another session's hook is starting one right now. Wait for it rather
    // than racing it: two daemons is the failure, one late floor is not.
    const found = await waitFor(find, findOpts, startTimeoutMs, pollMs, sleep);
    return found
      ? { port: found.port, started: false, reason: 'waited' }
      : { port: null, started: false, reason: 'busy' };
  }

  try {
    // Between the first probe and the lock, another hook may have finished.
    const raced = await find(findOpts);
    if (raced) return { port: raced.port, started: false, reason: 'running' };

    const launcher = (opts.resolve || resolveLauncher)({
      env: opts.env,
      platform: opts.platform,
    });
    if (!launcher) return { port: null, started: false, reason: 'no-deckhq' };

    const child = spawnFn(launcher.command, [...launcher.args, '--no-open'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: opts.env || process.env,
    });
    child.unref?.();

    const found = await waitFor(find, findOpts, startTimeoutMs, pollMs, sleep);
    return found
      ? { port: found.port, started: true, reason: 'started' }
      : { port: null, started: true, reason: 'timeout' };
  } finally {
    releaseLock(lock.file);
  }
}

/**
 * Poll for a daemon until one answers or the budget runs out.
 * @param {typeof findDaemon} find
 * @param {any} findOpts
 * @param {number} budgetMs
 * @param {number} pollMs
 * @param {(ms:number) => Promise<void>} sleep
 */
async function waitFor(find, findOpts, budgetMs, pollMs, sleep) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const found = await find(findOpts);
    if (found) return found;
    if (Date.now() + pollMs > deadline) return null;
    await sleep(pollMs);
  }
}
