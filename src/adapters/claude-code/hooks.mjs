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
import { CLAUDE_DIR } from './parse.mjs';
import { BACKUP_DIR } from '../../core/paths.mjs';
import { MAX_TOOL_SUMMARY } from '../../core/model.mjs';

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
];

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
 * The port a `_deckhq`-tagged command posts to, or null if it does not look
 * like one of ours.
 * @param {unknown} command
 * @returns {number|null}
 */
function portOfCommand(command) {
  const m = /port:(\d+),path:'\/api\/hook'/.exec(String(command || ''));
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
      'computer. Remove it any time from this screen — removal deletes only what was added here.',
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
        if (!h || h._deckhq !== true) continue;
        const port = portOfCommand(h.command);
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
