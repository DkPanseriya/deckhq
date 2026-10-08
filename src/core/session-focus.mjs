/**
 * Asking the operating system where a session is, and raising that window
 * (WP-100). The half of "go to session" that touches the machine.
 *
 * `session-window.mjs` decides; this file fetches what it decides FROM — the
 * process table and the windows — and carries out the one act the decision
 * leads to. Three rules:
 *
 * 1. **Argv arrays, never shell strings**, and on Windows a fixed script run
 *    with `-File` (`focus.ps1`), exactly as `taskbar.ps1` and `notify.ps1` are.
 *    The only values on any command line here are numbers this module made
 *    into strings itself; `intArg()` refuses anything else.
 * 2. **Nothing is killed, signalled or written to.** The table is a read. The
 *    one change is which window is in front — and, in a tabbed terminal,
 *    which tab is showing.
 * 3. **It runs only when somebody clicked.** There is no timer in here and no
 *    caller that is not an HTTP route answering a button; a product that
 *    watches agents must never decide for itself to pull a window forward.
 *
 * WHAT HAS BEEN RUN, AND WHAT HAS NOT. The Windows path was measured on
 * Windows 11 against windows this package opened itself: Windows Terminal
 * (a tab it started and a tab Windows handed it), a classic console, and the
 * Claude desktop app. The macOS and Linux paths below are written from each
 * platform's documented interface and have **never been run** — the same
 * position `terminals.mjs` is in for its macOS and Linux launch forms, and
 * said in the same place: `focusSupport()` reports `verified: false` for
 * both, and `deckhq doctor` prints it.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The fixed script. Its text never varies. */
export const FOCUS_SCRIPT = path.join(HERE, 'focus.ps1');

/** Long enough for PowerShell to start and compile; short enough for a click. */
const TIMEOUT_MS = 15_000;

/**
 * A whole positive number as an argv element, or a thrown error. A pid and a
 * window handle are the only things this module ever puts on a command line.
 * @param {unknown} value @param {string} what
 * @returns {string}
 */
export function intArg(value, what) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new Error(`${what} must be a positive whole number`);
  return String(n);
}

/**
 * The exact argv for one run of `focus.ps1`. Pure.
 * @param {'table'|'focus'} action
 * @param {{pid?:number, hwnd?:number|string, consolePid?:number}} [opts]
 * @param {string} [powershell]
 * @returns {{command:string, args:string[]}}
 */
export function focusCommand(action, opts = {}, powershell = 'powershell.exe') {
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    FOCUS_SCRIPT,
    '-Action',
    action === 'focus' ? 'focus' : 'table',
  ];
  if (action === 'focus') {
    args.push('-Hwnd', intArg(opts.hwnd, 'hwnd'), '-ProcessId', intArg(opts.pid, 'pid'));
    if (opts.consolePid) args.push('-ConsolePid', intArg(opts.consolePid, 'consolePid'));
  } else if (opts.pid) {
    args.push('-ProcessId', intArg(opts.pid, 'pid'));
  }
  return { command: powershell, args };
}

/**
 * The AppleScript that brings one application forward, by the pid of its main
 * process. Three fixed `-e` statements; the pid is the trailing argv element
 * and is never part of any statement — the same `on run argv` form
 * `notify.mjs` uses.
 * @param {number} pid
 * @returns {{command:string, args:string[]}}
 */
export function macFocusCommand(pid) {
  return {
    command: 'osascript',
    args: [
      '-e',
      'on run argv',
      '-e',
      'tell application "System Events" to set frontmost of (first process whose unix id is ((item 1 of argv) as integer)) to true',
      '-e',
      'end run',
      intArg(pid, 'pid'),
    ],
  };
}

/**
 * `ps -axo pid=,ppid=,comm=` as a process table. Pure.
 *
 * On macOS `comm` is the executable's full path, and a windowed program is one
 * inside an application bundle: `/Applications/iTerm.app/Contents/MacOS/iTerm2`
 * is named `iTerm` and marked `app`. The OUTERMOST bundle names it, so an
 * editor's helper (`…/Visual Studio Code.app/Contents/Frameworks/Code Helper
 * .app/…`) is the editor.
 * @param {string} text
 * @returns {import('./session-window.mjs').Proc[]}
 */
export function parsePsTable(text) {
  /** @type {import('./session-window.mjs').Proc[]} */
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const comm = m[3];
    const bundle = /\/([^/]+)\.app\//.exec(comm);
    /** @type {import('./session-window.mjs').Proc} */
    const proc = {
      pid: Number(m[1]),
      ppid: Number(m[2]),
      name: bundle ? bundle[1] : comm.split('/').pop() || comm,
    };
    if (bundle) proc.app = true;
    out.push(proc);
  }
  return out;
}

/**
 * `wmctrl -lp` as a window list. Pure. Columns: id, desktop, pid, host, title.
 * @param {string} text
 * @returns {import('./session-window.mjs').Win[]}
 */
export function parseWmctrl(text) {
  /** @type {import('./session-window.mjs').Win[]} */
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = /^(0x[0-9a-fA-F]+)\s+(-?\d+)\s+(\d+)\s+(\S+)\s?(.*)$/.exec(line);
    if (!m || Number(m[3]) <= 0) continue;
    out.push({ hwnd: m[1].toLowerCase(), pid: Number(m[3]), title: m[5] || '' });
  }
  return out;
}

/**
 * @typedef {object} FocusSupport
 * @property {boolean} supported   a window can be found and raised here
 * @property {boolean} verified    this path has been RUN on such a machine
 * @property {string} how          what it does, in a sentence
 * @property {string} [reason]     when not supported: why, in a sentence
 */

/**
 * Whether "go to session" can work on this machine, and whether that claim
 * has ever been tested. Pure, apart from `hasWmctrl`, which the caller found
 * out. `docs/ADAPTERS.md` §6 is the rule: where something cannot be measured
 * on the machine at hand, the code says so.
 *
 * @param {{platform?:string, env?:Record<string,string|undefined>, hasWmctrl?:boolean}} [opts]
 * @returns {FocusSupport}
 */
export function focusSupport(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  if (platform === 'win32') {
    return {
      supported: true,
      verified: true,
      how: 'finds the window from the session’s process and console, and raises it (measured on Windows 11: Windows Terminal, a classic console, the Claude desktop app)',
    };
  }
  if (platform === 'darwin') {
    return {
      supported: true,
      verified: false,
      how: 'asks System Events to bring the terminal, editor or app forward — written, never run on a Mac; macOS will ask once for permission to control System Events',
    };
  }
  if (env.WAYLAND_DISPLAY && !env.DISPLAY) {
    return {
      supported: false,
      verified: false,
      how: '',
      reason:
        'Wayland gives no program a way to raise another program’s window, so there is nothing for DeckHQ to call.',
    };
  }
  if (!opts.hasWmctrl) {
    return {
      supported: false,
      verified: false,
      how: '',
      reason: 'Raising a window on X11 needs `wmctrl`, and it is not installed.',
    };
  }
  return {
    supported: true,
    verified: false,
    how: 'raises the window with `wmctrl` on X11 — written, never run on a Linux desktop',
  };
}

/**
 * @typedef {object} FocusRunner
 * @property {() => Promise<FocusSupport>} support
 * @property {(pid:number) => Promise<import('./session-window.mjs').ProcessTable>} table
 * @property {(target:import('./session-window.mjs').WindowTarget) =>
 *   Promise<{foreground:boolean|null, flashed?:boolean, restored?:boolean,
 *            tab?:string, tabs?:number, tabTitle?:string}>} focus
 */

/**
 * The runner for this platform.
 *
 * @param {{platform?:string, env?:Record<string,string|undefined>,
 *          exec?:typeof execFile, powershell?:string}} [deps] test seams, in
 *   the shape `runTaskbarScript` takes them: `exec` in place of a real
 *   process, so no test ever raises a window on somebody's desktop.
 * @returns {FocusRunner}
 */
export function createFocusRunner(deps = {}) {
  const platform = deps.platform || process.platform;
  const env = deps.env || process.env;
  const exec = deps.exec || execFile;

  /** @param {string} command @param {string[]} args @returns {Promise<string>} */
  const run = (command, args) =>
    new Promise((resolve, reject) => {
      exec(
        command,
        args,
        { windowsHide: true, timeout: TIMEOUT_MS, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
        (err, out, stderr) => {
          if (err) reject(new Error(String(stderr || err.message).trim() || `${command} failed`));
          else resolve(String(out || ''));
        },
      );
    });

  /** @type {Promise<boolean>|null} */
  let wmctrl = null;
  const hasWmctrl = () => {
    if (platform === 'win32' || platform === 'darwin') return Promise.resolve(false);
    if (!wmctrl)
      wmctrl = run('which', ['wmctrl']).then(
        () => true,
        () => false,
      );
    return wmctrl;
  };

  return {
    async support() {
      return focusSupport({ platform, env, hasWmctrl: await hasWmctrl() });
    },

    async table(pid) {
      if (platform === 'win32') {
        const { command, args } = focusCommand('table', { pid }, deps.powershell);
        const parsed = JSON.parse(await run(command, args));
        return {
          processes: Array.isArray(parsed.processes) ? parsed.processes : [],
          windows: Array.isArray(parsed.windows) ? parsed.windows : [],
          console: parsed.console || null,
        };
      }
      const processes = parsePsTable(await run('ps', ['-axo', 'pid=,ppid=,comm=']));
      if (platform === 'darwin') return { processes, windows: null, console: null };
      return { processes, windows: parseWmctrl(await run('wmctrl', ['-lp'])), console: null };
    },

    async focus(target) {
      if (platform === 'win32') {
        const { command, args } = focusCommand(
          'focus',
          {
            hwnd: /** @type {number} */ (target.hwnd),
            pid: target.hostPid,
            // Only a tabbed terminal found through its console has a tab to
            // pick; an editor's terminals are not tabs UI Automation names by
            // console title, and a guess there would select the wrong file.
            consolePid: target.tabbed && target.kind === 'terminal' ? target.sessionPid : 0,
          },
          deps.powershell,
        );
        const parsed = JSON.parse(await run(command, args));
        return {
          foreground: parsed.foreground === true,
          flashed: parsed.flashed === true,
          restored: parsed.restored === true,
          tab: String(parsed.tab || 'none'),
          tabs: Number(parsed.tabs) || 0,
          tabTitle: String(parsed.tabTitle || ''),
        };
      }
      if (platform === 'darwin') {
        const { command, args } = macFocusCommand(target.hostPid);
        await run(command, args);
        // Not read back: nothing here asks macOS which application is in front.
        return { foreground: null };
      }
      if (!/^0x[0-9a-f]+$/.test(String(target.hwnd))) throw new Error('not a window id');
      await run('wmctrl', ['-ia', String(target.hwnd)]);
      return { foreground: null };
    },
  };
}
