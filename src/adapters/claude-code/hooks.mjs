/**
 * Claude Code hook install / remove. docs/02-ARCHITECTURE.md §6.
 *
 * We write one command hook per event into `~/.claude/settings.json`, each
 * tagged `"_deckhq": true` so removal is exact and never touches anything the
 * user (or another tool) put there. Every write is preceded by a backup of
 * the file's exact original bytes so `remove()` can restore them verbatim
 * when nothing else has changed in the meantime.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { CLAUDE_DIR } from './parse.mjs';
import { BACKUP_DIR } from '../../core/paths.mjs';
import { MAX_TOOL_SUMMARY, MAX_PERMISSION_SUMMARY } from '../../core/model.mjs';

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

const HOOK_EVENTS = [
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
function hookScript(port) {
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
function hookCommand(port) {
  return `node -e "${hookScript(port)}"`;
}

/**
 * The port one of our hook entries posts to, or null if it does not look like
 * one of ours. Handles both kinds: the `command` one-liner every lifecycle
 * event runs, and WP-19's `http` entry, whose port lives in its literal URL.
 * @param {any} entry
 * @returns {number|null}
 */
function portOfEntry(entry) {
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
function hookEntry(port) {
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
function permissionEntry(port) {
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
function buildHooksBlock(port) {
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

// ------------------------------------------------------- the tool summary

/** The most of a `Bash` command line the floor will ever carry (WP-52). */
const MAX_COMMAND = 80;

/**
 * One line of plain text, at most `max` characters.
 *
 * Hook payloads are text this project did not write: a command can contain
 * newlines, tabs, ANSI escapes or a lone control byte, and all of it ends up
 * on a canvas and in the panel header. Everything outside the printable range
 * becomes a space, runs of whitespace collapse, and the result is cut to
 * length. (The renderer draws it with `fillText`/`textContent` and never as
 * markup — see `docs/DEVIATIONS.md` §89.)
 * @param {string} value
 * @param {number} max
 */
function oneLine(value, max) {
  const flat = String(value ?? '')
    // `\p{C}` is every control, format and surrogate code point: a raw ESC
    // from a shell command, an embedded newline, a bidi override that would
    // reorder the rest of the line. None of it may reach a canvas.
    .replace(/\p{C}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

/**
 * A file path as the floor should show it: relative to the session's own
 * working directory, or — for anything outside it — its basename alone.
 *
 * The bubble hangs over a floor that gets screenshotted and pasted into
 * issues; "never contains project paths outside the session's cwd" is the
 * WP-52 acceptance criterion, so a path that escapes the cwd loses everything
 * but its last segment rather than being shown or dropped.
 * @param {string} file
 * @param {string} cwd
 */
function relativePath(file, cwd) {
  const raw = String(file ?? '').trim();
  if (!raw) return '';
  const basename = path.basename(raw.replace(/[\\/]+$/, '')) || raw;
  if (!cwd) return oneLine(basename, MAX_TOOL_SUMMARY);
  try {
    const abs = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
    const rel = path.relative(cwd, abs);
    if (!rel || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) {
      return oneLine(basename, MAX_TOOL_SUMMARY);
    }
    return oneLine(rel.replace(/\\/g, '/'), MAX_TOOL_SUMMARY);
  } catch {
    return oneLine(basename, MAX_TOOL_SUMMARY);
  }
}

/**
 * What a `PreToolUse` payload says the session is doing, as a name plus a
 * summary of at most {@link MAX_TOOL_SUMMARY} characters (WP-52,
 * `docs/plan/08-PLAN-V2-100X.md` §9).
 *
 * Parsing lives here rather than in the HTTP route because the payload shape
 * is Claude Code's, and nothing outside `src/adapters/` may know a runtime's
 * format (`docs/02-ARCHITECTURE.md` §2).
 *
 *   Bash  -> `Bash npm test` (first 80 characters of the command line)
 *   Edit  -> `Edit src/foo.ts` (relative to cwd; basename if outside it)
 *   Read  -> `Read src/foo.ts`
 *   other -> the tool name on its own
 *
 * @param {Record<string, any>} payload
 * @returns {{name:string, summary:string}|null} null when the payload names
 *   no tool at all — there is then nothing honest to draw.
 */
export function toolSummary(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const name = oneLine(payload.tool_name ?? payload.toolName ?? '', 40);
  if (!name) return null;
  const input =
    payload.tool_input && typeof payload.tool_input === 'object'
      ? payload.tool_input
      : payload.toolInput && typeof payload.toolInput === 'object'
        ? payload.toolInput
        : {};
  const cwd = String(payload.cwd || payload.workspace || '');

  let summary = name;
  if (name === 'Bash') {
    const command = oneLine(input.command ?? '', MAX_COMMAND);
    if (command) summary = `${name} ${command}`;
  } else if (name === 'Edit' || name === 'Read') {
    const file = relativePath(input.file_path ?? input.filePath ?? '', cwd);
    if (file) summary = `${name} ${file}`;
  }
  return { name, summary: oneLine(summary, MAX_TOOL_SUMMARY) };
}

// ------------------------------------------------- the permission request

/**
 * Tools whose approval card IS the interaction surface. The runtime discards
 * a hook allow for these and makes the user answer in the session:
 * `if (!g.updatedInput && e.requiresUserInteraction?.()) return null`
 * (`docs/DEVIATIONS.md` §86.3). The panel must therefore offer no buttons for
 * them, and say where to answer instead.
 *
 * MCP tools carry the same property through their own `anthropic/…` metadata,
 * which the hook payload does not currently include; `requires_user_interaction`
 * is read from the payload as well so that the day the runtime starts sending
 * it, DeckHQ is already honouring it.
 */
const REQUIRES_USER_INTERACTION = new Set(['AskUserQuestion', 'ExitPlanMode']);

/**
 * A file path as a permission card should show it: relative to the session's
 * own working directory when it is inside it, and **unchanged** when it is
 * not.
 *
 * This is deliberately the opposite of {@link relativePath}, which reduces an
 * outside path to its basename so a screenshot of the floor cannot carry
 * somebody else's directory tree. Here the reader is deciding whether to let
 * a write happen, and a write landing outside the project is precisely the
 * case where hiding the location would be the dangerous choice. The card is a
 * review surface, not a wall decoration.
 * @param {string} file
 * @param {string} cwd
 */
function permissionPath(file, cwd) {
  const raw = String(file ?? '').trim();
  if (!raw || !cwd) return raw;
  try {
    const abs = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
    const rel = path.relative(cwd, abs);
    if (!rel || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) return raw;
    return rel.replace(/\\/g, '/');
  } catch {
    return raw;
  }
}

/**
 * The one line the card puts under the tool name: what this call would
 * actually do.
 * @param {string} name
 * @param {Record<string, any>} input
 * @param {string} cwd
 */
function permissionSummary(name, input, cwd) {
  const one = (v) => oneLine(v, MAX_PERMISSION_SUMMARY);
  if (name === 'Bash') return one(input.command ?? '');
  const file = input.file_path ?? input.filePath ?? input.notebook_path ?? input.path;
  if (typeof file === 'string' && file.trim()) return one(permissionPath(file, cwd));
  if (typeof input.url === 'string' && input.url.trim()) return one(input.url);
  if (typeof input.command === 'string' && input.command.trim()) return one(input.command);
  // Anything else: the input's own keys, so the card never claims to know
  // more about a tool than it does.
  const parts = [];
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    parts.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  return one(parts.join(' · '));
}

/**
 * A human label for one `addRules` suggestion — the runtime's own rule text,
 * never one DeckHQ minted.
 * @param {any} suggestion
 */
function suggestionLabel(suggestion) {
  const rules = Array.isArray(suggestion.rules) ? suggestion.rules : [];
  const parts = rules
    .map((r) => {
      const tool = oneLine(r?.toolName ?? '', 40);
      const content = oneLine(r?.ruleContent ?? '', 80);
      if (!tool) return content;
      return content ? `${tool}(${content})` : tool;
    })
    .filter(Boolean);
  return oneLine(parts.join(', '), MAX_TOOL_SUMMARY);
}

/**
 * What a `PermissionRequest` payload says, in the shape the daemon and the
 * panel use (WP-19). Parsing lives here, not in the HTTP route, because the
 * payload shape is Claude Code's and nothing outside `src/adapters/` may know
 * a runtime's format (`docs/02-ARCHITECTURE.md` §2).
 *
 * `permission_suggestions` is the field that earns the third button: it is the
 * set of permission updates the terminal prompt itself would have offered, so
 * "Allow for this session" retargets one of the runtime's own rules rather
 * than inventing rule syntax (`docs/DEVIATIONS.md` §86.2). Only `addRules` is
 * kept: `setMode` and `addDirectories` are wider grants than the button says.
 *
 * @param {Record<string, any>} payload
 * @returns {{id:string, sessionId:string, cwd:string, tool:string, summary:string,
 *   suggestions:any[], requiresUserInteraction:boolean}|null} null when the
 *   payload names no tool — there is then nothing honest to ask about.
 */
export function permissionRequest(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const tool = oneLine(payload.tool_name ?? payload.toolName ?? '', 60);
  if (!tool) return null;
  const input =
    payload.tool_input && typeof payload.tool_input === 'object'
      ? payload.tool_input
      : payload.toolInput && typeof payload.toolInput === 'object'
        ? payload.toolInput
        : {};
  const cwd = String(payload.cwd || payload.workspace || '');
  const rawSuggestions = Array.isArray(payload.permission_suggestions)
    ? payload.permission_suggestions
    : [];
  const suggestions = rawSuggestions
    .filter((s) => s && typeof s === 'object' && s.type === 'addRules' && Array.isArray(s.rules))
    .map((s) => ({ ...s, label: suggestionLabel(s) }));

  return {
    id: String(payload.tool_use_id || payload.toolUseId || ''),
    sessionId: String(payload.session_id || payload.sessionId || ''),
    cwd,
    tool,
    summary: permissionSummary(tool, input, cwd),
    suggestions,
    requiresUserInteraction:
      REQUIRES_USER_INTERACTION.has(tool) || payload.requires_user_interaction === true,
  };
}

/**
 * The body that answers a held `PermissionRequest`, in the shape the installed
 * runtime's parser actually accepts — a `behavior`-discriminated OBJECT, not
 * the bare string the prose documentation shows (`docs/DEVIATIONS.md` §86.3).
 * A body in the documented shape fails validation silently and the prompt just
 * sits there, so this function is the single place that spelling lives.
 *
 * Three things it will never emit, each with an `INVARIANT:` test:
 *   - `interrupt: true` on a deny. Denying one command is not stopping the
 *     agent, and the runtime's `interrupt` aborts the whole turn.
 *   - a `destination` other than `"session"`. `userSettings`, `projectSettings`
 *     and `localSettings` write a permanent grant into the user's settings
 *     files, and that is not a button this panel has.
 *   - anything at all on a timeout. Silence is how "let the terminal decide"
 *     is expressed; there is no `ask` behaviour to send.
 *
 * @param {'allow'|'deny'|'session'} decision
 * @param {any[]} [suggestions] the `addRules` suggestions from the request
 * @returns {Record<string, any>}
 */
export function permissionDecisionBody(decision, suggestions = []) {
  if (decision === 'deny') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'denied from DeckHQ' },
      },
    };
  }
  /** @type {Record<string, any>} */
  const inner = { behavior: 'allow' };
  if (decision === 'session') {
    const updates = (Array.isArray(suggestions) ? suggestions : [])
      .filter((s) => s && s.type === 'addRules')
      // `label` is ours, for the panel; it never goes back to the runtime.
      .map(({ label: _label, ...rest }) => ({ ...rest, destination: 'session' }));
    if (updates.length > 0) inner.updatedPermissions = updates;
  }
  return {
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: inner },
  };
}

/**
 * Exactly what would be written and where, for the consent screen.
 * docs §6: "The consent screen shows the literal JSON that will be written
 * and the file it will be written to."
 * @param {number} [port]
 * @returns {import('../../core/model.mjs').HookPlan}
 */
export function describe(port = DEFAULT_PORT) {
  const block = { hooks: buildHooksBlock(port) };
  return {
    file: SETTINGS_FILE,
    json: JSON.stringify(block, null, 2),
    events: HOOK_EVENTS.slice(),
    note:
      'DeckHQ adds one command hook per event below to your Claude Code settings so it can ' +
      'show exact, real-time state instead of polling. Each hook POSTs the event payload to ' +
      `DeckHQ on your own machine (127.0.0.1:${port}) and nothing else. Nothing leaves this ` +
      'computer. Remove it any time from this screen — removal deletes only what was added here.\n\n' +
      'PermissionRequest is the one entry that is different, and it is the one to read twice. ' +
      'It fires only when a tool call is about to ask your permission in the terminal, and it ' +
      'lets DeckHQ answer that prompt: the request is held open for up to ' +
      `${PERMISSION_TIMEOUT_SECONDS} seconds while the panel shows you the tool and its input, ` +
      'and it is answered only when you press Allow, Deny or Allow for this session. DeckHQ ' +
      'never allows anything by itself, never answers on a timer and never writes a permanent ' +
      'permission rule into your settings files — "Allow for this session" lasts as long as that ' +
      'session and no longer. The terminal prompt stays on screen the whole time: if DeckHQ is ' +
      'closed, or you answer in the terminal first, the terminal is what decides.',
  };
}

/** @param {unknown} v */
function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Order-independent deep equality over JSON-compatible values.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return a === b;
}

/**
 * Read + parse the current settings file.
 * @returns {Promise<{existed:boolean, raw:string|null, parsed:any}>}
 */
async function readSettings() {
  let raw = null;
  try {
    raw = await fsp.readFile(SETTINGS_FILE, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { existed: false, raw: null, parsed: {} };
    }
    throw err;
  }
  let parsed;
  try {
    parsed = raw.trim() === '' ? {} : JSON.parse(raw);
  } catch {
    throw new Error(
      `Cannot read Claude Code hooks: ${SETTINGS_FILE} is not valid JSON. Fix or remove it by ` +
        'hand, then try again. Nothing was changed.',
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Cannot read Claude Code hooks: ${SETTINGS_FILE} does not contain a JSON object at its ` +
        'top level. Nothing was changed.',
    );
  }
  return { existed: true, raw, parsed };
}

/** Atomic write: temp file in the same directory, then rename. */
async function writeFileAtomic(file, content) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.deckhq-${process.pid}-${Date.now()}.tmp`;
  await fsp.writeFile(tmp, content, 'utf8');
  await fsp.rename(tmp, file);
}

/**
 * The port of the first `_deckhq`-tagged entry in a settings object, or null
 * if there is none. All of ours are written in one pass, so the first is
 * representative of the set.
 * @param {any} settings
 * @returns {number|null}
 */
function firstDeckhqPort(settings) {
  const hooks = settings && settings.hooks;
  if (!isPlainObject(hooks)) return null;
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const list = group && Array.isArray(group.hooks) ? group.hooks : [];
      for (const h of list) {
        const port = portOfEntry(h);
        if (port != null) return port;
      }
    }
  }
  return null;
}

/**
 * @param {any} settings
 * @returns {boolean} true if any `_deckhq`-tagged hook entry is present
 */
function hasDeckhqEntries(settings) {
  const hooks = settings && settings.hooks;
  if (!isPlainObject(hooks)) return false;
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const list = group && Array.isArray(group.hooks) ? group.hooks : [];
      if (list.some((h) => h && h._deckhq === true)) return true;
    }
  }
  return false;
}

/**
 * The plugin's name, as `.claude-plugin/plugin.json` declares it. Claude Code
 * records an enabled plugin under `<name>@<marketplace>`, and the marketplace
 * half depends on where the user got it from, so only the left half is ours to
 * recognise.
 */
export const PLUGIN_NAME = 'deckhq';

/**
 * Is DeckHQ installed and enabled as a Claude Code *plugin* (WP-37)?
 *
 * This is a second, entirely separate way for the same hooks to be present.
 * The plugin carries its own `hooks/hooks.json`; nothing of ours appears in
 * `settings.json`, so `installed()` above — which reads that file — reports
 * `false` on a machine where every hook event is arriving perfectly. Left
 * uncorrected, the floor would put its reinstall banner up over an install
 * that is working, and `_hooksInstalled()` in the registry would keep running
 * the inference path beside exact events.
 *
 * `enabledPlugins` is the key Claude Code writes on `plugin install` and flips
 * on `plugin disable`, which makes it the honest signal: installed but
 * disabled has to read as not installed, because a disabled plugin's hooks do
 * not run.
 *
 * Never throws: a missing or malformed settings file reads as "no plugin".
 *
 * @param {string} [file] the settings file to read; for tests
 * @returns {Promise<boolean>}
 */
export async function pluginInstalled(file = SETTINGS_FILE) {
  let parsed;
  try {
    parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return false;
  }
  const enabled = parsed && parsed.enabledPlugins;
  if (!isPlainObject(enabled)) return false;
  for (const [key, value] of Object.entries(enabled)) {
    if (value !== true) continue;
    if (String(key).split('@')[0] === PLUGIN_NAME) return true;
  }
  return false;
}

// ------------------------------------------------------ the managed policy

/**
 * Where Claude Code reads a `managed-settings.json` from on this platform.
 *
 * Verified against the Claude Code documentation (Deploy managed settings,
 * read 4 September 2026): macOS `/Library/Application Support/ClaudeCode/`,
 * Linux and WSL `/etc/claude-code/`, Windows `C:\Program Files\ClaudeCode\`.
 * The same page states that the legacy Windows path
 * `C:\ProgramData\ClaudeCode\managed-settings.json` is **not** read, so this
 * does not look there — a policy file sitting at a path the runtime ignores is
 * not a policy, and reporting one would be the same class of error as §74.
 *
 * `%ProgramFiles%` rather than a literal `C:` so a machine whose Windows
 * install is not on the system drive is read correctly.
 *
 * @param {string} [platform]
 * @param {Record<string, string|undefined>} [env]
 * @returns {string}
 */
export function managedSettingsDir(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    return path.join(env.ProgramFiles || 'C:\\Program Files', 'ClaudeCode');
  }
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  return '/etc/claude-code';
}

/** The drop-in directory Claude Code merges after `managed-settings.json`. */
const MANAGED_DROP_INS = 'managed-settings.d';

/**
 * Every managed settings file on this machine, in the order Claude Code merges
 * them: `managed-settings.json` first, then every `*.json` in
 * `managed-settings.d/` in alphabetical order. Hidden files and anything that
 * is not `.json` are skipped, as the documentation says the runtime does.
 *
 * Read-only and never throws: a missing directory is the normal case on an
 * unmanaged machine and returns the one path, whether or not it exists.
 *
 * @param {string} [dir]
 * @returns {Promise<string[]>}
 */
export async function managedSettingsFiles(dir = managedSettingsDir()) {
  const files = [path.join(dir, 'managed-settings.json')];
  let names;
  try {
    names = await fsp.readdir(path.join(dir, MANAGED_DROP_INS));
  } catch {
    return files;
  }
  const dropIns = names
    .filter((n) => n.endsWith('.json') && !n.startsWith('.'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const name of dropIns) files.push(path.join(dir, MANAGED_DROP_INS, name));
  return files;
}

/**
 * The two hook kill switches, read from the managed settings files on this
 * platform. `docs/DEVIATIONS.md` §86.4 named them and §97.4 left detecting them
 * as a follow-up; this is that follow-up.
 *
 * What is reported, and nothing more:
 *
 *   - `allowManagedHooksOnly` — documented scope **Managed**: when it is true,
 *     "only hooks from managed settings run. User, project, and local hooks are
 *     ignored", with hooks from a plugin force-enabled in the managed
 *     `enabledPlugins` exempted. Both routes DeckHQ installs by are on the
 *     ignored side of that line unless the plugin is the force-enabled one, so
 *     `managedPluginEnabled` is read too.
 *   - `allowedHttpHookUrls` — documented scope **Any file**, and the
 *     documentation says a handler runs only if its URL matches the *merged*
 *     allowlist. So the arrays from every managed source are unioned here, and
 *     `blockedByPolicy()` widens that union with the user's own settings file
 *     before deciding anything.
 *
 * Read-only, and never throws. A file that is absent contributes nothing; a
 * file that exists and cannot be read or parsed is listed in `unreadable`
 * rather than guessed at, because "there is a policy file here we could not
 * read" and "there is no policy here" are different facts.
 *
 * Only the *file* delivery mechanism is read. MDM profiles, the Windows
 * registry and server-managed settings from the claude.ai console deliver the
 * same keys through channels that are not files on disk, and none of them is
 * visible to this process — see `docs/DEVIATIONS.md` §114.
 *
 * @param {{dir?:string}} [opts]
 * @returns {Promise<{dir:string, files:string[], unreadable:string[],
 *   allowManagedHooksOnly:{value:boolean, file:string|null},
 *   allowedHttpHookUrls:{value:string[]|null, file:string|null},
 *   managedPluginEnabled:boolean}>}
 */
export async function managedSettings({ dir = managedSettingsDir() } = {}) {
  const result = {
    dir,
    /** @type {string[]} */ files: [],
    /** @type {string[]} */ unreadable: [],
    allowManagedHooksOnly: { value: false, /** @type {string|null} */ file: null },
    allowedHttpHookUrls: {
      /** @type {string[]|null} */ value: null,
      /** @type {string|null} */ file: null,
    },
    managedPluginEnabled: false,
  };

  for (const file of await managedSettingsFiles(dir)) {
    let parsed;
    try {
      parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch (err) {
      // ENOENT is the normal case and is not worth reporting. Anything else —
      // a permission error, a truncated file, invalid JSON — is a file that
      // exists and whose contents we do not know.
      if (!err || err.code !== 'ENOENT') result.unreadable.push(file);
      continue;
    }
    if (!isPlainObject(parsed)) {
      result.unreadable.push(file);
      continue;
    }
    result.files.push(file);

    if (parsed.allowManagedHooksOnly === true && !result.allowManagedHooksOnly.value) {
      result.allowManagedHooksOnly = { value: true, file };
    }
    if (Array.isArray(parsed.allowedHttpHookUrls)) {
      const urls = parsed.allowedHttpHookUrls.filter((u) => typeof u === 'string');
      result.allowedHttpHookUrls = {
        value: [...(result.allowedHttpHookUrls.value || []), ...urls],
        file: result.allowedHttpHookUrls.file ?? file,
      };
    }
    if (isPlainObject(parsed.enabledPlugins)) {
      for (const [key, value] of Object.entries(parsed.enabledPlugins)) {
        if (value === true && String(key).split('@')[0] === PLUGIN_NAME) {
          result.managedPluginEnabled = true;
        }
      }
    }
  }

  return result;
}

/**
 * Does one entry of an HTTP hook allowlist cover `url`?
 *
 * The documentation names `allowedHttpHookUrls` and says a handler runs only
 * if its URL "matches the merged allowlist"; it does **not** define what
 * matching is, and no managed machine was available to measure it on. So this
 * is deliberately generous — an exact URL, a prefix such as an origin, and a
 * `*` glob all count — because the two errors do not cost the same. Failing to
 * notice a block leaves the report saying exactly what it says today. Claiming
 * a block that is not there would put `doctor` at exit 1 and a banner in the
 * header of a machine whose policy is fine, over a matching rule this project
 * guessed at. See `docs/DEVIATIONS.md` §114.
 *
 * @param {unknown} entry
 * @param {string} url
 * @returns {boolean}
 */
export function allowlistCovers(entry, url) {
  if (typeof entry !== 'string') return false;
  const pattern = entry.trim().toLowerCase();
  const target = String(url).trim().toLowerCase();
  if (!pattern || !target) return false;
  if (pattern === '*' || pattern === target) return true;
  if (pattern.includes('*')) {
    const source = pattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return new RegExp(`^${source}$`).test(target);
  }
  return target.startsWith(pattern);
}

/**
 * A managed policy that stops DeckHQ's installed hooks from running, or null.
 *
 * This is the "looks healthy, delivers nothing" case §75 reserved exit 1 for,
 * and it is the one the user has no way to tell apart from a broken install:
 * the settings file is exactly right, the consent screen is satisfied, the
 * daemon is on the correct port, and no event ever arrives.
 *
 * Two keys, checked in the order of how much they take away:
 *
 *   1. `allowManagedHooksOnly` kills every hook DeckHQ installs by either
 *      route, unless the plugin route is in use *and* the managed policy
 *      force-enables that plugin, which the documentation exempts.
 *   2. `allowedHttpHookUrls` reaches only the one `http` entry — WP-19's
 *      `PermissionRequest` — because that is the only HTTP hook DeckHQ writes
 *      and the plugin route writes none at all. It is reported only when a
 *      *managed* source defines it, since the documented scope is any file and
 *      the allowlist merges: a user's own entry widens the list rather than
 *      narrowing it, so it is read here to avoid claiming a block that a merge
 *      would have lifted, and never to originate one.
 *
 * Never throws: every unreadable file simply contributes nothing, and the
 * caller gets `null`, which is what it would have had before this existed.
 *
 * @param {{port?:number, viaPlugin?:boolean, dir?:string, userSettingsFile?:string}} [opts]
 * @returns {Promise<{key:string, file:string}|null>}
 */
export async function blockedByPolicy(opts = {}) {
  const { port, viaPlugin = false, dir, userSettingsFile = SETTINGS_FILE } = opts;
  let managed;
  try {
    managed = await managedSettings(dir ? { dir } : {});
  } catch {
    return null;
  }

  if (managed.allowManagedHooksOnly.value && !(viaPlugin && managed.managedPluginEnabled)) {
    return {
      key: 'allowManagedHooksOnly',
      file: managed.allowManagedHooksOnly.file ?? path.join(managed.dir, 'managed-settings.json'),
    };
  }

  const allowlist = managed.allowedHttpHookUrls;
  // No managed source defines the allowlist, or there is no `http` entry of
  // ours for it to reach: nothing to say.
  if (!allowlist.value || port == null) return null;

  let userUrls = [];
  try {
    const parsed = JSON.parse(await fsp.readFile(userSettingsFile, 'utf8'));
    if (isPlainObject(parsed) && Array.isArray(parsed.allowedHttpHookUrls)) {
      userUrls = parsed.allowedHttpHookUrls;
    }
  } catch {
    userUrls = []; // absent or unreadable: it widens nothing
  }

  const url = `http://127.0.0.1:${port}${PERMISSION_PATH}`;
  const merged = [...allowlist.value, ...userUrls];
  if (merged.some((entry) => allowlistCovers(entry, url))) return null;
  return {
    key: 'allowedHttpHookUrls',
    file: allowlist.file ?? path.join(managed.dir, 'managed-settings.json'),
  };
}

/**
 * The port the installed hooks currently post to, or null if none are
 * installed. Never throws.
 * @returns {Promise<number|null>}
 */
export async function installedPort() {
  try {
    const { parsed } = await readSettings();
    return firstDeckhqPort(parsed);
  } catch {
    return null;
  }
}

/**
 * True if DeckHQ's hooks are currently installed AND pointing at this
 * daemon. Never throws: a missing or malformed settings file simply reads as
 * "not installed".
 *
 * The port matters. Hooks installed while the daemon was on 4317 keep posting
 * to 4317 after a restart on 4318 or a `--port 4400`, and every event lands
 * nowhere. Reporting that as "installed" would leave the interface promising
 * exact state while it silently ran on the inference path — so a port
 * mismatch reads as not installed, which puts the banner back up and offers
 * the user the one-click reinstall that fixes it.
 *
 * @param {number} [port] omit to ask only whether anything of ours is present
 * @returns {Promise<boolean>}
 */
export async function installed(port) {
  try {
    const { parsed } = await readSettings();
    if (!hasDeckhqEntries(parsed)) return false;
    if (port == null) return true;
    return firstDeckhqPort(parsed) === Number(port);
  } catch {
    return false;
  }
}

/**
 * Install DeckHQ's hooks. Reads the current settings, aborts with a clear
 * error and changes nothing if the file is malformed, otherwise backs up the
 * exact original bytes, merges our tagged entries in, and writes atomically.
 *
 * A no-op if already installed at this port. If ours are present but pointing
 * at a different port, they are removed first and re-added — otherwise the
 * daemon could never recover from a port change.
 *
 * @param {number} [port]
 * @returns {Promise<void>}
 */
export async function install(port = DEFAULT_PORT) {
  {
    const { parsed } = await readSettings();
    if (hasDeckhqEntries(parsed)) {
      if (firstDeckhqPort(parsed) === Number(port)) return; // already correct
      await remove(); // stale port: take ours out, then put them back below
    }
  }

  const { existed, raw, parsed } = await readSettings();

  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(BACKUP_DIR, `settings-backup-${Date.now()}.json`);
  await fsp.writeFile(backupPath, JSON.stringify({ existed, raw }, null, 2), 'utf8');

  const next = { ...parsed };
  const hooks = isPlainObject(next.hooks) ? { ...next.hooks } : {};
  const ours = buildHooksBlock(port);
  for (const event of HOOK_EVENTS) {
    const existing = Array.isArray(hooks[event]) ? hooks[event] : [];
    hooks[event] = [...existing, ...ours[event]];
  }
  next.hooks = hooks;

  await writeFileAtomic(SETTINGS_FILE, JSON.stringify(next, null, 2));
}

/** Most recently created `settings-backup-*.json` in the data dir, or null. */
async function latestBackup() {
  let names;
  try {
    names = await fsp.readdir(BACKUP_DIR);
  } catch {
    return null;
  }
  const backups = names.filter((n) => /^settings-backup-\d+\.json$/.test(n)).sort();
  if (backups.length === 0) return null;
  const file = path.join(BACKUP_DIR, backups[backups.length - 1]);
  try {
    const text = await fsp.readFile(file, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Remove only the hook entries DeckHQ added (`_deckhq: true`), pruning
 * emptied matcher groups and emptied event keys. If the result matches the
 * backed-up pre-install content exactly, the original bytes are restored
 * verbatim so the file comes back byte-identical, even though our own
 * merge/prune cycle does not guarantee identical key ordering on its own.
 * Safe to run if the user hand-edited unrelated parts of the file since
 * install — in that case the pruned object is written as 2-space JSON.
 * A no-op if nothing tagged is present.
 * @returns {Promise<void>}
 */
export async function remove() {
  const { existed, parsed } = await readSettings();
  if (!hasDeckhqEntries(parsed)) return; // nothing to remove

  const next = { ...parsed };
  if (isPlainObject(next.hooks)) {
    const hooks = { ...next.hooks };
    for (const event of Object.keys(hooks)) {
      const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
      const prunedGroups = [];
      for (const group of groups) {
        if (!isPlainObject(group)) {
          prunedGroups.push(group);
          continue;
        }
        const list = Array.isArray(group.hooks) ? group.hooks : [];
        const prunedList = list.filter((h) => !(h && h._deckhq === true));
        if (prunedList.length > 0) {
          prunedGroups.push({ ...group, hooks: prunedList });
        }
        // else: this matcher group had only our hook(s); drop the group.
      }
      if (prunedGroups.length > 0) {
        hooks[event] = prunedGroups;
      } else {
        delete hooks[event];
      }
    }
    if (Object.keys(hooks).length > 0) {
      next.hooks = hooks;
    } else {
      delete next.hooks;
    }
  }

  const backup = await latestBackup();

  if (backup && !backup.existed && Object.keys(next).length === 0) {
    // The settings file did not exist before install, and nothing else has
    // added content since: restore that exact absence.
    try {
      await fsp.unlink(SETTINGS_FILE);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    return;
  }

  if (backup && backup.existed && typeof backup.raw === 'string') {
    let original;
    try {
      original = JSON.parse(backup.raw);
    } catch {
      original = null;
    }
    if (original !== null && deepEqual(next, original)) {
      await writeFileAtomic(SETTINGS_FILE, backup.raw);
      return;
    }
  }

  // No usable backup, or the user changed something else in the meantime:
  // write the pruned object as clean 2-space JSON. If the file did not
  // exist before install (no `existed` info available), write it anyway,
  // since the object still holds other content the user or another tool
  // added after our install.
  if (!existed && Object.keys(next).length === 0) {
    try {
      await fsp.unlink(SETTINGS_FILE);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    return;
  }
  await writeFileAtomic(SETTINGS_FILE, JSON.stringify(next, null, 2));
}
