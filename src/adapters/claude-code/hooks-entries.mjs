/**
 * The hook entries this product writes, and the script behind them
 * (WP-22 follow-up).
 *
 * Split out of `hooks.mjs` unchanged: the events hooked, the one-line
 * command each one runs, the port it posts to, and WP-19's permission entry
 * with its timeout.
 *
 * Every entry is tagged `"_deckhq": true`, which is what makes removal exact
 * and is why nothing this product writes can be confused with something the
 * user (or another tool) put there.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_DIR } from './parse.mjs';

/** `true` — Claude Code supports the hook mechanism this module implements. */
export const supported = true;

/** Absolute path to the settings file we read and write. */
export const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');

/**
 * The port the daemon listens on by default. Every function here takes the
 * real port, because the daemon walks forward when 4317 is taken and accepts
 * `--port`: a hook pointing at the wrong port posts into a void, and the
 * header would go on claiming state is exact while nothing arrives.
 */
export const DEFAULT_PORT = 4317;

export const HOOK_EVENTS = [
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  // WP-52. These two carry no lifecycle meaning at all: they only say which
  // tool is running right now, so the floor can show what an agent is doing
  // rather than only that it is busy. Neither may move a user-owned field —
  // see `applyHook` in src/core/state-machine.mjs.
  'PreToolUse',
  'PostToolUse',
  // WP-19. The only entry in this block that is not a `command` hook, and the
  // only one the runtime waits on: it fires when a tool call would otherwise
  // raise a prompt in the terminal, and its HTTP response can answer that
  // prompt. Everything about it is in `docs/DEVIATIONS.md` §86 and §97.
  'PermissionRequest',
];

/**
 * How long, in seconds, the runtime is told to wait for an answer.
 *
 * Written explicitly rather than relying on the runtime's own default (600 s
 * on 2.1.231, `docs/DEVIATIONS.md` §86.4), so a future change to that default
 * cannot silently shorten the hold under a card the user is still looking at.
 */
export const PERMISSION_TIMEOUT_SECONDS = 600;

/** The path the `PermissionRequest` hook posts to. Its own route, never `/api/hook`. */
export const PERMISSION_PATH = '/api/permission';

/**
 * The `node -e` one-liner every hook entry runs. Reads the hook's JSON
 * payload from stdin and POSTs it verbatim to the daemon's loopback-only
 * `/api/hook` endpoint (node:http, no dependency on `curl` existing).
 * Exits 0 on any error and never blocks Claude Code waiting on the daemon.
 *
 * The whole script is embedded as a single double-quoted shell argument so
 * it survives both POSIX shells and cmd.exe unmodified: it deliberately
 * contains no `$`, backtick, `%` or embedded double-quote character, since
 * each of those is interpreted differently (or specially) by one shell or
 * the other.
 */
export function hookScript(port) {
  return (
    "const http=require('node:http');" +
    'let d=[];' +
    "process.stdin.on('data',function(c){d.push(c);});" +
    "process.stdin.on('error',function(){process.exit(0);});" +
    "process.stdin.on('end',function(){" +
    'try{' +
    'var body=Buffer.concat(d);' +
    `var req=http.request({host:'127.0.0.1',port:${port},path:'/api/hook',method:'POST',` +
    "headers:{'Content-Type':'application/json','Content-Length':body.length},timeout:300}," +
    'function(res){res.resume();process.exit(0);});' +
    "req.on('error',function(){process.exit(0);});" +
    "req.on('timeout',function(){try{req.destroy();}catch(e){}process.exit(0);});" +
    'req.end(body);' +
    '}catch(e){process.exit(0);}' +
    '});' +
    'process.stdin.resume();'
  );
}

/** This package's root: this file is three folders below it. */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * THE APP'S OWN NODE, when the app is what is running this daemon.
 *
 * The Windows app carries a Node of its own and is laid out as
 * `<app>/node/node.exe` beside `<app>/core/`, which is this package. A hook
 * written as `node -e …` runs whatever `node` the user's shell finds — and on
 * a PC that has the app and no Node of its own it finds none, so every hook
 * the app installed did nothing and said nothing. Where this process IS that
 * bundled Node, its path is the one thing known to exist.
 *
 * Pure: two paths in, a path or null out.
 * @param {string} [execPath] the Node running this process
 * @param {string} [packageRoot] this package's root
 * @returns {string|null} the bundled Node's path, or null for any other Node
 */
export function bundledNode(execPath = process.execPath, packageRoot = PACKAGE_ROOT) {
  const dir = path.dirname(String(execPath || ''));
  if (path.basename(dir).toLowerCase() !== 'node') return null;
  const same = (/** @type {string} */ a, /** @type {string} */ b) =>
    path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  return same(path.resolve(dir, '..', 'core'), packageRoot) ? String(execPath) : null;
}

/**
 * What a hook command starts with: `node`, or the app's own Node by path.
 *
 * The path is written with forward slashes, which every shell a hook may be
 * run by reads the same way, and bare where it can be: a quoted program name
 * is not a command to PowerShell. A path with a space is quoted, because
 * nothing else can carry it. A path with a character that some shell would
 * expand inside quotes (`$`, a backtick, `%`, `!`, a quote) is not written at
 * all: the command falls back to `node`, which is what it always was.
 * @param {string} [execPath] @param {string} [packageRoot]
 * @returns {string}
 */
export function hookRunner(execPath, packageRoot) {
  const own = bundledNode(execPath, packageRoot);
  if (!own) return 'node';
  const p = own.replace(/\\/g, '/');
  if (/["$`%!]/.test(p)) return 'node';
  return /^[A-Za-z0-9_.:/~-]+$/.test(p) ? p : `"${p}"`;
}

/**
 * @param {number} port
 * @param {string} [runner] what starts it; `hookRunner()` unless a test says
 */
export function hookCommand(port, runner = hookRunner()) {
  return `${runner} -e "${hookScript(port)}"`;
}

/**
 * What one of our command entries is started by: `node`, a path, or null for
 * an entry that is not ours, is the `http` one, or is not in a shape we wrote.
 * @param {any} entry
 * @returns {string|null}
 */
export function runnerOfEntry(entry) {
  if (!entry || entry._deckhq !== true || entry.type === 'http') return null;
  const m = /^(?:"([^"]+)"|(\S+)) -e "/.exec(String(entry.command || ''));
  return m ? m[1] || m[2] : null;
}

/**
 * Can a hook started by `runner` start at all, on this machine, now?
 *
 * `node` runs if a `node` is on this process's PATH; a path runs if the file
 * is there. Asked only when an installed entry's runner is not the one this
 * daemon would write (`runnerStale`), so an ordinary status check reads no
 * directory.
 * @param {string|null} runner
 * @param {{env?:Record<string, string|undefined>, platform?:string,
 *   exists?:(file:string) => boolean}} [deps]
 */
export function runnerRuns(runner, deps = {}) {
  if (!runner) return false;
  const exists = deps.exists || fs.existsSync;
  if (runner !== 'node') return exists(runner);
  const env = deps.env || process.env;
  const names =
    (deps.platform || process.platform) === 'win32'
      ? ['node.exe', 'node.cmd', 'node.bat', 'node']
      : ['node'];
  for (const dir of String(env.PATH || env.Path || '').split(path.delimiter)) {
    if (dir && names.some((name) => exists(path.join(dir, name)))) return true;
  }
  return false;
}

/**
 * The port one of our hook entries posts to, or null if it does not look like
 * one of ours. Handles both kinds: the `command` one-liner every lifecycle
 * event runs, and WP-19's `http` entry, whose port lives in its literal URL.
 * @param {any} entry
 * @returns {number|null}
 */
export function portOfEntry(entry) {
  if (!entry || entry._deckhq !== true) return null;
  if (entry.type === 'http') {
    const m = new RegExp(`^http://127\\.0\\.0\\.1:(\\d+)${PERMISSION_PATH}$`).exec(
      String(entry.url || ''),
    );
    return m ? Number(m[1]) : null;
  }
  const m = /port:(\d+),path:'\/api\/hook'/.exec(String(entry.command || ''));
  return m ? Number(m[1]) : null;
}

/**
 * One `{type:'command', ...}` hook entry, tagged for exact removal.
 * @param {number} port @param {string} [runner]
 */
export function hookEntry(port, runner) {
  return { type: 'command', command: hookCommand(port, runner), _deckhq: true };
}

/**
 * WP-19's `PermissionRequest` entry: an `http` hook, tagged the same way.
 *
 * `http` rather than `command` because this one is answered rather than fired
 * and forgotten — no process spawn per raised hand, and a real ten-minute hold
 * on one socket (`docs/DEVIATIONS.md` §86.4, §86.5). The URL is a literal: the
 * `http` schema allows no interpolation, so the port is baked in at install
 * time and the existing `staleAtPort` reinstall is what cures a moved daemon
 * (§86.6). No `matcher` and no `if`: every raised hand appears, which is the
 * product's claim.
 * @param {number} port
 */
export function permissionEntry(port) {
  return {
    type: 'http',
    url: `http://127.0.0.1:${port}${PERMISSION_PATH}`,
    timeout: PERMISSION_TIMEOUT_SECONDS,
    statusMessage: 'Waiting for DeckHQ…',
    _deckhq: true,
  };
}

/**
 * The `hooks` block we merge into settings.json. Notification is split into
 * two matcher entries (docs §4.1: matcher `permission_prompt` or
 * `idle_prompt`) rather than relying on matcher regex/alternation support.
 * @param {number} port
 * @param {string} [runner] what starts each command; `hookRunner()` by default
 * @returns {Record<string, any[]>}
 */
export function buildHooksBlock(port, runner) {
  const entry = () => hookEntry(port, runner);
  return {
    UserPromptSubmit: [{ hooks: [entry()] }],
    Notification: [
      { matcher: 'permission_prompt', hooks: [entry()] },
      { matcher: 'idle_prompt', hooks: [entry()] },
    ],
    Stop: [{ hooks: [entry()] }],
    SubagentStop: [{ hooks: [entry()] }],
    SessionStart: [{ hooks: [entry()] }],
    SessionEnd: [{ hooks: [entry()] }],
    // No matcher: every tool, because "which tool" is the whole point.
    PreToolUse: [{ hooks: [entry()] }],
    PostToolUse: [{ hooks: [entry()] }],
    // WP-19. The one entry the runtime waits on.
    PermissionRequest: [{ hooks: [permissionEntry(port)] }],
  };
}
