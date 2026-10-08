/**
 * The taskbar pin, and why it showed the browser's icon.
 *
 * `deckhq app` opens Chrome or Edge with `--app=`. Windows groups a taskbar
 * button, and resolves a pin, by an AppUserModelID, and the browser gives the
 * app window one of its own. When the user pins that window, Windows looks for
 * a Start Menu shortcut carrying the SAME id and pins that — its icon, its
 * command. When no shortcut carries it, Windows pins the window's executable:
 * the browser, with the browser's icon, which then opens the browser.
 *
 * MEASURED on Windows 11 with Chrome 154 and Edge 154, against a window this
 * package opened itself, with `src/core/taskbar.ps1`:
 *
 *   - the window's id is `Chrome.127.0.0.1_/.appprofile.Default` in Chrome and
 *     `MSEdge.127.0.0.1_/.appprofile.Default` in Edge;
 *   - it is made of the browser, the URL's host and path, the NAME of the
 *     `--user-data-dir` folder with everything but letters, digits and dots
 *     removed, and the profile inside it;
 *   - it does not change with the port, nor with where that folder lives;
 *   - the window carries no relaunch command, icon or name of its own;
 *   - no command-line switch tried changes it (`--app-id`,
 *     `--app-user-model-id`);
 *   - the `DeckHQ.lnk` this package wrote carried no id at all.
 *
 * So the id cannot be chosen, and it is not guessed either: it is read off the
 * window, and written into the shortcuts this package wrote. One property, on
 * files that are recorded in `installed.json` and still carry the tag; a
 * shortcut that is not ours is refused, in this module and again in the
 * script. `deckhq shortcut --remove` deletes the shortcut and the property
 * with it.
 *
 * WHAT IS NOT PROVED HERE. That the id on the window equals the id in the
 * shortcut, and that the shortcut's icon is the DeckHQ `.ico`, are both read
 * back from Windows. That the taskbar then draws that icon for a pin can only
 * be seen by pinning, and this package does not touch a taskbar.
 *
 * This file is the decisions, which are pure, and one function that runs them.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { DATA_DIR } from './paths.mjs';
import { appProfileDir } from './app-window.mjs';
import { TAG } from './launcher.mjs';
import { readAppFlags, recordedEntries, writeAppFlags } from './launcher-apply.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The fixed script. Its text never varies. */
export const TASKBAR_SCRIPT = path.join(HERE, 'taskbar.ps1');

/** The key in `installed.json`'s `app` object. */
export const TASKBAR_FLAG = 'taskbar';

/**
 * The exact argv for one run of the script. Pure.
 *
 * `-File` and named parameters, and the only values on the command line are
 * the script's own path, a fixed word and the path of a spec file under the
 * state directory.
 *
 * @param {'look'|'stamp'} action
 * @param {string} specFile
 * @param {string} [powershell]
 * @returns {{command:string, args:string[]}}
 */
export function taskbarCommand(action, specFile, powershell = 'powershell.exe') {
  return {
    command: powershell,
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      TASKBAR_SCRIPT,
      '-Action',
      action,
      '-SpecFile',
      specFile,
    ],
  };
}

/**
 * Run the script with a spec file, and parse the one JSON document it prints.
 *
 * @param {'look'|'stamp'} action
 * @param {Record<string, any>} spec
 * @param {{dataDir?:string, exec?:typeof execFile, powershell?:string}} [deps]
 * @returns {Promise<any>}
 */
export async function runTaskbarScript(action, spec, deps = {}) {
  const dataDir = deps.dataDir || DATA_DIR;
  const exec = deps.exec || execFile;
  const file = path.join(dataDir, `taskbar-${process.pid}-${Date.now()}.json`);
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(file, JSON.stringify(spec, null, 2), 'utf8');
  const { command, args } = taskbarCommand(action, file, deps.powershell);
  try {
    const stdout = await new Promise((resolve, reject) => {
      exec(
        command,
        args,
        { windowsHide: true, timeout: 30_000, encoding: 'utf8' },
        (err, out, stderr) => {
          if (err) reject(new Error(String(stderr || err.message).trim() || 'powershell failed'));
          else resolve(String(out || '').trim());
        },
      );
    });
    return JSON.parse(stdout);
  } finally {
    try {
      await fsp.unlink(file);
    } catch {
      /* already gone */
    }
  }
}

/**
 * Which of the browser's windows is the floor.
 *
 * The script has already narrowed them to the browser that was started with
 * our profile directory. That browser can hold other windows — a link opened
 * from the floor lands in an ordinary one — and those carry the browser's own
 * id, not the app window's. The app window's id names the host it was opened
 * on, measured as `<host>_<path>`, so that is what is looked for; a window set
 * that holds none answers null rather than a guess.
 *
 * @param {Array<{aumid?:string|null}>} windows
 * @param {string} url
 * @returns {{aumid:string}|null}
 */
export function pickAppWindow(windows, url) {
  let host = '';
  try {
    host = new URL(String(url)).hostname;
  } catch {
    return null;
  }
  if (!host) return null;
  for (const w of Array.isArray(windows) ? windows : []) {
    const aumid = typeof w?.aumid === 'string' ? w.aumid : '';
    if (aumid && aumid.includes(`${host}_`)) return { ...w, aumid };
  }
  return null;
}

/**
 * What to do about one shortcut. Pure, and the whole rule:
 *
 *   `refuse`   it is not in our record, or it no longer carries our tag. It is
 *              somebody else's file and it is not touched.
 *   `unknown`  there is no window id to compare with. Nothing is written.
 *   `same`     it already carries the window's id. Nothing is written.
 *   `rewrite`  it is ours and its id is missing or different.
 *
 * @param {{recorded?:boolean, description?:string|null, current?:string|null,
 *          wanted?:string|null, tag?:string}} link
 * @returns {'refuse'|'unknown'|'same'|'rewrite'}
 */
export function stampDecision(link) {
  const tag = link.tag || TAG;
  if (!link.recorded || !String(link.description || '').includes(tag)) return 'refuse';
  if (!link.wanted) return 'unknown';
  return link.current === link.wanted ? 'same' : 'rewrite';
}

/**
 * Everything the id and the shortcuts depend on, as one short string.
 *
 * The id was measured to follow the browser and the profile folder, so a
 * different browser, a browser that has been updated, or a moved profile makes
 * a different fingerprint — and so does a shortcut whose file has changed
 * since it was last stamped. When the fingerprint is the one recorded, the
 * check has already been made and `deckhq app` runs nothing; that is what
 * keeps this off the path of every ordinary launch.
 *
 * @param {{browser?:string|null, profileDir:string, paths:string[]}} what
 * @param {(p:string) => {mtimeMs:number, size:number}|null} [stat]
 * @returns {string}
 */
export function taskbarFingerprint(what, stat = statOrNull) {
  const seen = (p) => {
    const s = p ? stat(p) : null;
    return s ? `${Math.trunc(s.mtimeMs)}:${s.size}` : 'absent';
  };
  const parts = [
    `browser=${what.browser || ''}|${seen(what.browser || '')}`,
    `profile=${what.profileDir}`,
    ...[...what.paths].sort().map((p) => `lnk=${p}|${seen(p)}`),
  ];
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 24);
}

/** @param {string} p */
function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

/**
 * The shortcuts this package wrote that are still on disk.
 * @param {string} dataDir
 * @returns {string[]}
 */
export function ourShortcutPaths(dataDir = DATA_DIR) {
  return recordedEntries('shortcut', dataDir)
    .filter((e) => e.proof === 'lnk' && fs.existsSync(e.path))
    .map((e) => e.path);
}

/**
 * Where this machine stands, from the record and the disk alone. Starts
 * nothing, so `deckhq doctor` can ask.
 *
 *   `no-shortcut`  nothing of ours for a pin to resolve to.
 *   `matched`      the shortcuts were stamped with a window's id, and nothing
 *                  the id depends on has changed since.
 *   `stale`        they were stamped once, and something has changed.
 *   `unmatched`    they have never been stamped.
 *
 * @param {{dataDir?:string, platform?:string, browser?:string|null,
 *          profileDir:string}} opts
 * @returns {{state:'no-shortcut'|'matched'|'stale'|'unmatched', aumid:string|null,
 *            at:number|null, paths:string[], fingerprint:string}|null}
 */
export function taskbarState(opts) {
  if ((opts.platform || process.platform) !== 'win32') return null;
  const dataDir = opts.dataDir || DATA_DIR;
  const paths = ourShortcutPaths(dataDir);
  const fingerprint = taskbarFingerprint({ ...opts, paths });
  const base = { aumid: null, at: null, paths, fingerprint };
  if (paths.length === 0) return { ...base, state: 'no-shortcut' };
  const flag = readAppFlags(dataDir)[TASKBAR_FLAG];
  if (!flag || typeof flag.aumid !== 'string' || !flag.aumid)
    return { ...base, state: 'unmatched' };
  return {
    ...base,
    aumid: flag.aumid,
    at: Number(flag.at) || null,
    state: flag.fingerprint === fingerprint ? 'matched' : 'stale',
  };
}

/**
 * Make our shortcuts carry the id the app window has.
 *
 * Reads the window and the shortcuts in one run of the script, decides per
 * shortcut, and writes only the ones `stampDecision` says to. When the record
 * says this has been done and nothing has changed, it returns without running
 * anything.
 *
 * `checked` says whether Windows was actually asked.
 *
 * @param {{dataDir?:string, platform?:string, browser?:string|null,
 *          profileDir:string, url:string, waitMs?:number, force?:boolean}} opts
 * @param {{exec?:typeof execFile, powershell?:string, now?:number,
 *          run?:typeof runTaskbarScript}} [deps]
 * @returns {Promise<{state:'unsupported'|'no-shortcut'|'matched'|'no-window',
 *                    checked:boolean, aumid:string|null, stamped:string[],
 *                    same:string[], refused:string[]}>}
 */
export async function matchTaskbar(opts, deps = {}) {
  const none = { checked: false, aumid: null, stamped: [], same: [], refused: [] };
  const before = taskbarState(opts);
  if (!before) return { ...none, state: 'unsupported' };
  if (before.state === 'no-shortcut') return { ...none, state: 'no-shortcut' };
  if (before.state === 'matched' && !opts.force) {
    return { ...none, state: 'matched', aumid: before.aumid, same: before.paths };
  }

  const dataDir = opts.dataDir || DATA_DIR;
  const run = deps.run || runTaskbarScript;
  const io = { dataDir, exec: deps.exec, powershell: deps.powershell };
  const seen = await run(
    'look',
    { profileDir: opts.profileDir, waitMs: Math.max(0, opts.waitMs ?? 0), paths: before.paths },
    io,
  );
  const links = Array.isArray(seen?.links) ? seen.links : [];
  const window = pickAppWindow(seen?.windows, opts.url);
  // No window to read: the one id this machine has measured before is still
  // the best statement of what a window here is called, but only for deciding
  // that nothing needs writing. It is never written from memory.
  const wanted = window ? window.aumid : null;
  const remembered = before.aumid;

  const result = { ...none, checked: true, aumid: wanted };
  /** @type {string[]} */
  const toStamp = [];
  for (const p of before.paths) {
    const link = links.find((l) => l && samePath(l.path, p));
    const decision = stampDecision({
      recorded: true,
      description: link?.description,
      current: link?.aumid,
      wanted: wanted || remembered,
    });
    if (decision === 'refuse') result.refused.push(p);
    else if (decision === 'same') result.same.push(p);
    else if (decision === 'rewrite' && wanted) toStamp.push(p);
  }

  if (toStamp.length > 0) {
    const after = await run('stamp', { paths: toStamp, aumid: wanted, tag: TAG }, io);
    for (const p of toStamp) {
      const link = (Array.isArray(after) ? after : []).find((l) => l && samePath(l.path, p));
      if (link && link.aumid === wanted) result.stamped.push(p);
    }
  }

  const done = [...result.stamped, ...result.same];
  // Every recorded shortcut has lost its tag: there is nothing of ours here.
  if (done.length === 0 && result.refused.length === before.paths.length) {
    return { ...result, state: 'no-shortcut' };
  }
  if (!wanted && !(remembered && done.length === before.paths.length)) {
    return { ...result, state: 'no-window' };
  }
  const aumid = wanted || remembered;
  if (done.length > 0) {
    writeAppFlags(
      {
        [TASKBAR_FLAG]: {
          aumid,
          at: deps.now ?? Date.now(),
          paths: done,
          // Taken after the write, so it describes the files as they now are.
          fingerprint: taskbarFingerprint({ ...opts, paths: before.paths }),
        },
      },
      { dataDir },
    );
  }
  return { ...result, state: 'matched', aumid };
}

/** Windows paths, compared the way Windows compares them. */
function samePath(a, b) {
  return (
    path.win32.normalize(String(a)).toLowerCase() === path.win32.normalize(String(b)).toLowerCase()
  );
}

/**
 * The lines printed after a match, for `deckhq app` and `deckhq shortcut`.
 * Pure. An empty string when there is nothing worth a line.
 *
 * @param {Awaited<ReturnType<typeof matchTaskbar>>} result
 * @returns {string}
 */
export function describeMatch(result) {
  if (!result || !result.checked) return '';
  if (result.state === 'no-window') {
    return (
      '  Taskbar: no DeckHQ window is open, so the shortcut does not know what Windows calls it\n' +
      '  yet. `deckhq app` sets that the next time it opens the window; pin the window after.\n\n'
    );
  }
  if (result.state !== 'matched' || result.stamped.length === 0) return '';
  return (
    '  Taskbar: the DeckHQ shortcut now carries the name Windows gives this window, so a pin\n' +
    '  of the window keeps the DeckHQ icon. A pin made before now is a copy with the\n' +
    "  browser's icon: unpin it, and pin the window again, once.\n\n"
  );
}

/**
 * `matchTaskbar` for the one window this package opens, and what to print.
 *
 * The two commands that call this never fail because of it: a pin that keeps
 * the browser's icon is not a window that did not open, nor a shortcut that
 * was not written.
 *
 * @param {{dataDir?:string, platform?:string, browser?:string|null, url:string,
 *          waitMs?:number, force?:boolean}} opts
 * @param {Parameters<typeof matchTaskbar>[1]} [deps]
 * @returns {Promise<string>}
 */
export async function matchAppWindow(opts, deps = {}) {
  try {
    const profileDir = appProfileDir(opts.dataDir || DATA_DIR);
    return describeMatch(await matchTaskbar({ ...opts, profileDir }, deps));
  } catch {
    return '';
  }
}

/**
 * The `deckhq doctor` row. Pure.
 * @param {ReturnType<typeof taskbarState>} state
 * @returns {string|null}
 */
export function describeTaskbar(state) {
  if (!state) return null;
  if (state.state === 'no-shortcut') {
    return (
      "no DeckHQ shortcut, so a pinned window shows the browser's icon " +
      '— `deckhq shortcut --install`'
    );
  }
  if (state.state === 'matched') {
    return `a pinned window keeps the DeckHQ icon — the shortcut carries the window's id, ${state.aumid}`;
  }
  return (
    (state.state === 'stale'
      ? 'the browser or the shortcut has changed since the window was last matched'
      : "the shortcut does not carry the window's id yet") +
    ' — run `deckhq app` once, then pin the window'
  );
}
