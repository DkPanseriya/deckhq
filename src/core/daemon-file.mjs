/**
 * `~/.deckhq/daemon.json` — where a running daemon records the port it bound.
 *
 * WP-37. The Claude Code plugin ships hooks whose command is fixed at package
 * time and installed by a copy into `~/.claude/plugins/cache`: there is no
 * install-time step in which a port could be baked into them, and
 * `docs/DEVIATIONS.md` §86.6 established that an `http` hook cannot interpolate
 * one either (`url` is a literal). So the daemon publishes where it is, and the
 * hook command looks it up.
 *
 * Three properties this file has to hold:
 *
 *   1. **It is not `state.json`.** Nothing here is user-owned — port, pid and
 *      start time are all re-derivable by looking at the process table — and
 *      `state.json` is the half of the model the product is made of. A second
 *      writer against it on every daemon start is exactly the class of change
 *      `docs/DEVIATIONS.md` §93 refused for the CLI.
 *   2. **A stale file is not a lie.** The daemon removes it on a clean
 *      shutdown, but a killed daemon leaves it behind, so every reader treats
 *      the port as a *hint* and confirms with a loopback probe before believing
 *      it. `pid` is recorded for the same reason: a reader can tell a fresh
 *      record from one left by a machine that rebooted.
 *   3. **It never fails a start.** Every function here swallows its errors. A
 *      read-only home directory must cost the plugin its discovery shortcut and
 *      nothing else.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { DAEMON_FILE } from './paths.mjs';

/**
 * Record this daemon's bound address. Called once, after the listener is up.
 *
 * Written through a temp file and renamed, so a reader never sees half a
 * record — the hook command reads this on every single hook event and a torn
 * read would cost a whole session's events.
 *
 * @param {{port:number, url:string, file?:string, pid?:number, now?:number}} opts
 * @returns {string|null} the file written, or null if it could not be
 */
export function writeDaemonFile(opts) {
  const file = opts.file || DAEMON_FILE;
  const record = {
    port: Number(opts.port),
    url: String(opts.url || ''),
    pid: opts.pid ?? process.pid,
    startedAt: opts.now ?? Date.now(),
  };
  const tmp = `${file}.${record.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return file;
  } catch {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* nothing to clean up */
    }
    return null;
  }
}

/**
 * The record, or null. Never throws; a malformed or portless file reads as no
 * file at all.
 * @param {string} [file]
 * @returns {{port:number, url:string, pid:number, startedAt:number}|null}
 */
export function readDaemonFile(file = DAEMON_FILE) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return {
    port,
    url: typeof parsed.url === 'string' ? parsed.url : `http://127.0.0.1:${port}/`,
    pid: Number.isInteger(parsed.pid) ? parsed.pid : 0,
    startedAt: Number.isFinite(parsed.startedAt) ? Number(parsed.startedAt) : 0,
  };
}

/**
 * Remove the record, but only if it is still ours.
 *
 * A daemon that is shutting down must not delete the record of the daemon that
 * replaced it: on a restart the new process writes the file before the old one
 * finishes closing its sockets, and an unconditional unlink there would leave
 * the machine with a live daemon and no way for a hook to find it.
 *
 * @param {{file?:string, pid?:number}} [opts]
 */
export function clearDaemonFile(opts = {}) {
  const file = opts.file || DAEMON_FILE;
  const pid = opts.pid ?? process.pid;
  try {
    const current = readDaemonFile(file);
    if (current && current.pid && current.pid !== pid) return;
    fs.unlinkSync(file);
  } catch {
    /* already gone, or never written */
  }
}
