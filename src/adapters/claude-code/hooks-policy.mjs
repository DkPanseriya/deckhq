/**
 * Reading the settings, and what an enterprise policy has already decided
 * (WP-22 follow-up).
 *
 * Split out of `hooks.mjs` unchanged: the settings read and the atomic
 * write, the deep-equality the backup comparison turns on, the plugin check,
 * the managed-settings drop-ins, and whether a policy allowlist already
 * covers the command this product would install.
 *
 * A machine whose policy forbids the hook is a machine this product must
 * decline on rather than fight, and say so in words the user can act on.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  DEFAULT_PORT,
  buildHooksBlock,
  SETTINGS_FILE,
  HOOK_EVENTS,
  PERMISSION_TIMEOUT_SECONDS,
  portOfEntry,
  PERMISSION_PATH,
} from './hooks-entries.mjs';

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
export function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Order-independent deep equality over JSON-compatible values.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function deepEqual(a, b) {
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
export async function readSettings() {
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
export async function writeFileAtomic(file, content) {
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
export function firstDeckhqPort(settings) {
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
export function hasDeckhqEntries(settings) {
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
export const MANAGED_DROP_INS = 'managed-settings.d';

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
 * visible to this process — see `docs/DEVIATIONS.md` §115.
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
 * guessed at. See `docs/DEVIATIONS.md` §115.
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
