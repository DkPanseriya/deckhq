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

import path from 'node:path';
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

/** @param {number} port */
export function hookCommand(port) {
  return `node -e "${hookScript(port)}"`;
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
 * @param {number} port
 */
export function hookEntry(port) {
  return { type: 'command', command: hookCommand(port), _deckhq: true };
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
 * @returns {Record<string, any[]>}
 */
export function buildHooksBlock(port) {
  return {
    UserPromptSubmit: [{ hooks: [hookEntry(port)] }],
    Notification: [
      { matcher: 'permission_prompt', hooks: [hookEntry(port)] },
      { matcher: 'idle_prompt', hooks: [hookEntry(port)] },
    ],
    Stop: [{ hooks: [hookEntry(port)] }],
    SubagentStop: [{ hooks: [hookEntry(port)] }],
    SessionStart: [{ hooks: [hookEntry(port)] }],
    SessionEnd: [{ hooks: [hookEntry(port)] }],
    // No matcher: every tool, because "which tool" is the whole point.
    PreToolUse: [{ hooks: [hookEntry(port)] }],
    PostToolUse: [{ hooks: [hookEntry(port)] }],
    // WP-19. The one entry the runtime waits on.
    PermissionRequest: [{ hooks: [permissionEntry(port)] }],
  };
}
