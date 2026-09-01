/**
 * Project actions: the things a piece of furniture in a room can do.
 *
 * The floor is a spatial launcher. A shelf opens the repo, a screen runs the
 * project's dashboard — the object IS the verb, and it lives in the room the
 * project lives in, so there is nothing to hunt for in a menu.
 *
 * SAFETY — read before adding anything here.
 *
 * The browser never sends a command. It sends an action id; the daemon looks
 * up what that id resolves to for that project and runs THAT. Two rules make
 * this defensible:
 *
 *   1. Every runnable action resolves to a file that already exists inside the
 *      project directory. Running it is the same trust decision the user makes
 *      by having the file in their own repo and running it themselves.
 *   2. The resolved path is confined to the project directory. A manifest that
 *      points at `../../../something` is rejected, not clamped.
 *
 * Actions come from two places: auto-detection of conventional filenames, and
 * an optional `.deckhq.json` in the repo root, which is the user's own file
 * and lets them bind their own scripts without DeckHQ guessing.
 */
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import process from 'node:process';

/**
 * @typedef {object} ProjectAction
 * @property {string} id          stable, referenced by the client
 * @property {string} label       what the interface calls it
 * @property {'reveal'|'run'|'open'} kind
 * @property {string} [file]      relative to the project root, for `run`
 * @property {string} [url]       opened after a `run`, or on its own for `open`
 * @property {string} [furniture} which prop surfaces it on the floor
 */

/**
 * Filenames DeckHQ recognises without being told, in preference order.
 * Windows first on Windows, since that is where a `.bat` is meaningful.
 */
const CONVENTIONAL_SCRIPTS =
  process.platform === 'win32'
    ? ['dashboard.bat', 'dashboard.cmd', 'dashboard.ps1', 'dashboard.sh']
    : ['dashboard.sh', 'dashboard.bat', 'dashboard.cmd'];

const MANIFEST = '.deckhq.json';

/** @param {string} p @param {string} root */
function isInside(root, p) {
  const rel = path.relative(root, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Everything this project can do, from convention plus its own manifest.
 *
 * Never throws: a project with no directory, no scripts and a malformed
 * manifest simply offers fewer actions.
 *
 * @param {string} cwd
 * @returns {Promise<ProjectAction[]>}
 */
export async function discoverActions(cwd) {
  /** @type {ProjectAction[]} */
  const actions = [];
  if (!cwd) return actions;
  const root = path.resolve(cwd);

  try {
    const info = await stat(root);
    if (!info.isDirectory()) return actions;
  } catch {
    return actions;
  }

  // The shelf is always there: every project has a folder.
  actions.push({ id: 'reveal', label: 'Open folder', kind: 'reveal', furniture: 'shelf' });

  for (const name of CONVENTIONAL_SCRIPTS) {
    try {
      const info = await stat(path.join(root, name));
      if (!info.isFile()) continue;
      actions.push({
        id: 'dashboard',
        label: `Run ${name}`,
        kind: 'run',
        file: name,
        furniture: 'screen',
      });
      break;
    } catch {
      /* not this one */
    }
  }

  // The repo's own manifest wins, and can add actions convention missed.
  try {
    const raw = await readFile(path.join(root, MANIFEST), 'utf8');
    const parsed = JSON.parse(raw);
    const listed = Array.isArray(parsed?.actions) ? parsed.actions : [];
    for (const entry of listed) {
      if (!entry || typeof entry !== 'object') continue;
      const id = String(entry.id || '').trim();
      if (!id || id === 'reveal') continue;
      const kind = entry.file ? 'run' : entry.url ? 'open' : null;
      if (!kind) continue;
      if (entry.file) {
        const target = path.resolve(root, String(entry.file));
        // A manifest pointing outside its own repo is refused outright.
        if (!isInside(root, target)) continue;
        try {
          const info = await stat(target);
          if (!info.isFile()) continue;
        } catch {
          continue;
        }
      }
      const url = entry.url ? String(entry.url) : undefined;
      if (url && !/^https?:\/\//i.test(url)) continue;
      const existing = actions.findIndex((a) => a.id === id);
      /** @type {ProjectAction} */
      const action = {
        id,
        label: String(entry.label || id).slice(0, 40),
        kind,
        file: entry.file ? String(entry.file) : undefined,
        url,
        furniture: String(entry.furniture || 'screen'),
      };
      if (existing >= 0) actions[existing] = action;
      else actions.push(action);
    }
  } catch {
    /* no manifest, or it is not valid JSON: convention alone stands */
  }

  return actions;
}

/**
 * Show a directory in the platform's file manager.
 * @param {string} dir
 */
export async function revealInFileManager(dir) {
  const target = path.resolve(dir);
  const info = await stat(target);
  if (!info.isDirectory()) throw new Error('Not a directory');

  const cmd =
    process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  // argv array, never a shell string — the path is user data.
  const child = spawn(cmd, [target], { detached: true, stdio: 'ignore' });
  child.unref();
}

/**
 * Run one of a project's own scripts.
 *
 * `action` must have come from `discoverActions` for this same directory, so
 * the file has already been proved to exist inside the project.
 *
 * @param {string} cwd
 * @param {ProjectAction} action
 * @returns {Promise<{url?: string}>}
 */
export async function runAction(cwd, action) {
  const root = path.resolve(cwd);
  if (action.kind === 'open') return { url: action.url };
  if (action.kind !== 'run' || !action.file) throw new Error('That action cannot be run');

  const target = path.resolve(root, action.file);
  if (!isInside(root, target)) throw new Error('That script is outside its project');
  const info = await stat(target);
  if (!info.isFile()) throw new Error('That script no longer exists');

  const ext = path.extname(target).toLowerCase();
  /** @type {[string, string[]]} */
  let spawnArgs;
  if (process.platform === 'win32' && (ext === '.bat' || ext === '.cmd')) {
    // `cmd /c` is required to run a batch file, but the path goes in as its
    // own argv element so nothing in it is ever parsed as a command.
    spawnArgs = ['cmd', ['/c', target]];
  } else if (ext === '.ps1') {
    spawnArgs = ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', target]];
  } else if (ext === '.sh') {
    spawnArgs = ['sh', [target]];
  } else {
    spawnArgs = [target, []];
  }

  const child = spawn(spawnArgs[0], spawnArgs[1], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  return { url: action.url };
}

/**
 * Open a URL in the user's browser. Only ever called with a URL that came from
 * a project's own manifest.
 * @param {string} url
 */
export function openUrl(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs can be opened');
  if (process.platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', url], () => {});
  } else if (process.platform === 'darwin') {
    execFile('open', [url], () => {});
  } else {
    execFile('xdg-open', [url], () => {});
  }
}
