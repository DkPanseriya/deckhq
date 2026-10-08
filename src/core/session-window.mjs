/**
 * Which window a running session is in, and what the one button says (WP-100).
 *
 * The owner, 8 October: _"wherever that session is running — a separate
 * terminal, the Claude Code app, anything — can we open that particular
 * session, so one click and you are back to your working window."_
 *
 * A transcript does not say which window its session is in. The process does:
 * every session the runtime reports alive has a pid, every pid has a parent,
 * and somewhere above an agent process is the program whose window the person
 * was typing into. This module is the two DECISIONS, and both are pure:
 *
 *   resolveSessionWindow()  a pid, a process table and a list of windows in;
 *                           one window out, or the reason there is none
 *   goToPlan()              what the button does and what it is called
 *
 * Nothing here spawns, reads a file or touches a window. The table comes from
 * `session-focus.mjs`, which is the only part that asks the operating system
 * anything, and it is handed in — so every rule below is asserted against a
 * table written out in `test/unit/session-window.test.mjs`, not reasoned about.
 *
 * WHAT WAS MEASURED, AND WHERE (Windows 11, 8 October):
 *
 *   - A shell Windows Terminal started itself has Windows Terminal as its
 *     parent. A shell Windows HANDED to the terminal (the default-terminal
 *     path: PowerShell or cmd opened from Start) does not — its parent is
 *     whatever launched it, and the walk upward never reaches the terminal.
 *   - The console a process is attached to answers both. Under a pseudoconsole
 *     its window is a hidden stand-in whose root owner is the terminal's real
 *     window; for a classic console it is the console window itself.
 *   - One Windows Terminal process owns every one of its windows, so the walk
 *     alone cannot say WHICH window; the console can.
 *   - A classic console window reports the shell as its owning process, not
 *     `conhost.exe`.
 *   - A session in the Claude desktop app is a child of the app's main
 *     process, which owns the one window titled `Claude`.
 *
 * So the console's answer is preferred where there is one, and the walk is
 * what is left: it is what finds an editor (whose terminals are pseudoconsoles
 * nobody owns) and the desktop app (whose sessions have no console window).
 */

/**
 * @typedef {object} Proc
 * @property {number} pid
 * @property {number} ppid
 * @property {string} name    the image name: `WindowsTerminal.exe`, `Code.exe`,
 *   or on macOS the application bundle's name where the process is in one
 * @property {boolean} [app]  macOS: this process is inside an application
 *   bundle, so it is a windowed program and not a command of the same name —
 *   the Claude desktop app and the `claude` CLI are both called `claude`
 *
 * @typedef {object} Win
 * @property {number|string} hwnd  the platform's window id
 * @property {number} pid
 * @property {string} title
 * @property {string} [windowClass]
 *
 * @typedef {object} ConsoleAnswer
 * @property {number} hwnd
 * @property {number} root     the window that hosts it; `hwnd` for a classic one
 * @property {number} pid      the process that owns `root`
 * @property {string} [windowClass]
 * @property {string} [title]  the console's own title — a tab's name, unless
 *   somebody renamed the tab
 *
 * @typedef {object} ProcessTable
 * @property {Proc[]} processes
 * @property {Win[]|null} windows   null where the platform has no cheap list
 *   of windows (macOS): the catalogue alone then decides
 * @property {ConsoleAnswer|null} [console]
 *
 * @typedef {'terminal'|'editor'|'app'|'console'|'window'} HostKind
 *
 * @typedef {object} WindowTarget
 * @property {true} ok
 * @property {HostKind} kind
 * @property {string} label        `Windows Terminal`, `VS Code`, …
 * @property {number} hostPid      the process that owns the window
 * @property {number|string|null} hwnd   null where windows are not listed
 * @property {string} windowTitle
 * @property {boolean} exact       false when the host has several windows and
 *   nothing said which one — the front-most was taken, and the caller says so
 * @property {boolean} tabbed      the host puts sessions in tabs
 * @property {string} tabTitle     the tab to look for, when one is known
 * @property {'console'|'ancestor'} via
 * @property {number} sessionPid
 *
 * @typedef {object} NoWindow
 * @property {false} ok
 * @property {'gone'|'headless'|'no-window'} reason
 * @property {string} message      a sentence a person can act on
 */

/**
 * The programs whose window a session can be in. Matched on the image name,
 * lower-cased, with any `.exe` removed. `tabbed` is what makes the caller name
 * a tab; `kind` is what the button's second line says.
 *
 * Not a list of what was TESTED — `docs/GUIDE.md` and `deckhq doctor` say that
 * — but of what is recognised by name. A program that is not here and owns a
 * window above the session is still found; it is called by its own name.
 * @type {{kind:HostKind, label:string, tabbed?:boolean, names:string[]}[]}
 */
export const WINDOW_HOSTS = [
  {
    kind: 'terminal',
    label: 'Windows Terminal',
    tabbed: true,
    names: ['windowsterminal', 'windowsterminalpreview', 'wt'],
  },
  { kind: 'terminal', label: 'WezTerm', tabbed: true, names: ['wezterm-gui', 'wezterm'] },
  { kind: 'terminal', label: 'Alacritty', names: ['alacritty'] },
  { kind: 'terminal', label: 'kitty', tabbed: true, names: ['kitty'] },
  { kind: 'terminal', label: 'Ghostty', tabbed: true, names: ['ghostty'] },
  { kind: 'terminal', label: 'Warp', tabbed: true, names: ['warp'] },
  { kind: 'terminal', label: 'iTerm', tabbed: true, names: ['iterm', 'iterm2'] },
  { kind: 'terminal', label: 'Terminal', tabbed: true, names: ['terminal'] },
  { kind: 'terminal', label: 'Hyper', tabbed: true, names: ['hyper'] },
  { kind: 'terminal', label: 'Tabby', tabbed: true, names: ['tabby'] },
  { kind: 'terminal', label: 'ConEmu', tabbed: true, names: ['conemu64', 'conemu'] },
  { kind: 'terminal', label: 'mintty', names: ['mintty'] },
  {
    kind: 'terminal',
    label: 'GNOME Terminal',
    tabbed: true,
    names: ['gnome-terminal-server', 'gnome-terminal', 'kgx', 'ptyxis'],
  },
  { kind: 'terminal', label: 'Konsole', tabbed: true, names: ['konsole'] },
  { kind: 'terminal', label: 'xterm', names: ['xterm'] },
  { kind: 'terminal', label: 'foot', names: ['foot'] },
  { kind: 'terminal', label: 'Tilix', tabbed: true, names: ['tilix'] },
  { kind: 'terminal', label: 'Xfce Terminal', tabbed: true, names: ['xfce4-terminal'] },
  {
    kind: 'editor',
    label: 'VS Code',
    tabbed: true,
    names: ['code', 'code - insiders', 'visual studio code', 'visual studio code - insiders'],
  },
  { kind: 'editor', label: 'Cursor', tabbed: true, names: ['cursor'] },
  { kind: 'editor', label: 'Windsurf', tabbed: true, names: ['windsurf'] },
  { kind: 'editor', label: 'VSCodium', tabbed: true, names: ['vscodium', 'codium'] },
  { kind: 'editor', label: 'Zed', tabbed: true, names: ['zed'] },
  {
    kind: 'editor',
    label: 'a JetBrains IDE',
    tabbed: true,
    names: [
      'idea64',
      'idea',
      'intellij idea',
      'intellij idea ce',
      'pycharm64',
      'pycharm',
      'webstorm64',
      'webstorm',
      'goland64',
      'goland',
      'clion64',
      'clion',
      'rider64',
      'rider',
      'phpstorm64',
      'phpstorm',
      'rubymine64',
      'rubymine',
      'datagrip64',
      'datagrip',
      'rustrover64',
      'rustrover',
      'studio64',
      'android studio',
    ],
  },
  { kind: 'app', label: 'the Claude desktop app', names: ['claude'] },
];

/**
 * Where the walk upward stops. Each of these owns windows — a desktop, a file
 * manager, a login — and none of them is where anybody was typing: a session
 * started from the Run box has Explorer as its grandparent, and "go to
 * session" must not answer with a folder.
 */
const WALK_STOPS = new Set([
  'explorer',
  'system',
  'services',
  'svchost',
  'wininit',
  'winlogon',
  'sihost',
  'launchd',
  'systemd',
  'init',
  'finder',
  'loginwindow',
  'gnome-shell',
  'plasmashell',
]);

/** The walk is a tree, but a pid table read mid-change can be a loop. */
const MAX_DEPTH = 64;

/** @param {string} name */
function key(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\.exe$/, '')
    .trim();
}

/**
 * The catalogue entry for an image name, or null.
 * @param {string} name
 */
export function hostFor(name) {
  const k = key(name);
  if (!k) return null;
  return WINDOW_HOSTS.find((h) => h.names.includes(k)) || null;
}

/**
 * What an unrecognised program with a window is called: its own name.
 * @param {Proc} proc @param {Win|null} win
 * @returns {{kind:HostKind, label:string, tabbed:boolean}}
 */
function describeHost(proc, win) {
  if (win && win.windowClass === 'ConsoleWindowClass') {
    const k = key(proc.name);
    const label =
      k === 'powershell' || k === 'pwsh'
        ? 'a PowerShell window'
        : k === 'cmd'
          ? 'a Command Prompt window'
          : 'a console window';
    return { kind: 'console', label, tabbed: false };
  }
  const known = hostFor(proc.name);
  if (known) return { kind: known.kind, label: known.label, tabbed: known.tabbed === true };
  return {
    kind: 'window',
    label: String(proc.name || 'a window').replace(/\.exe$/i, ''),
    tabbed: false,
  };
}

/**
 * The last segment of a directory, for matching a window title against it.
 * @param {string} cwd
 */
function folderName(cwd) {
  const parts = String(cwd || '')
    .split(/[\\/]+/)
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1].toLowerCase() : '';
}

/**
 * Which of a host's windows. One window is the answer. Several, and a title
 * that names the session's folder is taken — an editor titles its window with
 * the folder it has open. Otherwise the first, which is the front-most the
 * platform listed, and `exact` is false so the caller can say it guessed.
 * @param {Win[]} wins @param {string} cwd
 * @returns {{win:Win, exact:boolean}}
 */
function pickWindow(wins, cwd) {
  if (wins.length === 1) return { win: wins[0], exact: true };
  const folder = folderName(cwd);
  if (folder) {
    const named = wins.filter((w) =>
      String(w.title || '')
        .toLowerCase()
        .includes(folder),
    );
    if (named.length === 1) return { win: named[0], exact: true };
    if (named.length > 1) return { win: named[0], exact: false };
  }
  return { win: wins[0], exact: false };
}

/**
 * The window a session's process is in.
 *
 * @param {object} input
 * @param {number} input.pid            the session's own process
 * @param {ProcessTable} input.table
 * @param {string} [input.cwd]          the session's directory, for choosing
 *   between an editor's windows
 * @param {number} [input.selfPid]      THIS daemon. A session that is a child
 *   of the daemon is a turn the daemon is running itself, with no window of
 *   its own — and the walk upward from it would arrive at the terminal
 *   `deckhq` was started in, which is the wrong window stated confidently.
 * @returns {WindowTarget|NoWindow}
 */
export function resolveSessionWindow(input) {
  const pid = Number(input.pid);
  const table = input.table || { processes: [], windows: [] };
  const processes = Array.isArray(table.processes) ? table.processes : [];
  const windows = Array.isArray(table.windows) ? table.windows : null;
  const cwd = String(input.cwd || '');

  /** @type {Map<number, Proc>} */
  const byPid = new Map();
  for (const p of processes) byPid.set(Number(p.pid), p);
  const self = byPid.get(pid);
  if (!self) {
    return { ok: false, reason: 'gone', message: 'That session’s process has ended.' };
  }

  // The chain upward, the session first.
  /** @type {Proc[]} */
  const chain = [];
  const seen = new Set();
  for (let cur = self; cur && !seen.has(cur.pid) && chain.length < MAX_DEPTH;) {
    seen.add(cur.pid);
    chain.push(cur);
    cur = byPid.get(Number(cur.ppid));
  }

  if (input.selfPid && chain.some((p) => p.pid === input.selfPid)) {
    return {
      ok: false,
      reason: 'headless',
      message: 'DeckHQ is running that turn itself, so it has no window of its own.',
    };
  }

  // 1. The console it is attached to, when that leads to a window on screen.
  const con = table.console || null;
  if (con && con.root && windows) {
    const win = windows.find((w) => Number(w.hwnd) === Number(con.root));
    const owner = win ? byPid.get(Number(win.pid)) : null;
    if (win && owner) {
      const host = describeHost(owner, win);
      return {
        ok: true,
        kind: host.kind,
        label: host.label,
        hostPid: owner.pid,
        hwnd: win.hwnd,
        windowTitle: String(win.title || ''),
        exact: true,
        tabbed: host.tabbed,
        tabTitle: host.tabbed ? String(con.title || '') : '',
        via: 'console',
        sessionPid: pid,
      };
    }
  }

  // 2. The first program above it that has a window.
  for (const proc of chain) {
    if (WALK_STOPS.has(key(proc.name))) break;
    if (windows) {
      const wins = windows.filter((w) => Number(w.pid) === proc.pid);
      if (!wins.length) continue;
      const { win, exact } = pickWindow(wins, cwd);
      const host = describeHost(proc, win);
      return {
        ok: true,
        kind: host.kind,
        label: host.label,
        hostPid: proc.pid,
        hwnd: win.hwnd,
        windowTitle: String(win.title || ''),
        exact,
        tabbed: host.tabbed,
        tabTitle: '',
        via: 'ancestor',
        sessionPid: pid,
      };
    }
    // No list of windows on this platform: a program is taken to have one
    // only if it is one the catalogue knows to be a windowed application. The
    // OUTERMOST process of that program is the one a platform can bring
    // forward — a helper process of an editor is not an application.
    const known = proc.app === true ? hostFor(proc.name) : null;
    if (!known) continue;
    let top = proc;
    for (const above of chain.slice(chain.indexOf(proc) + 1)) {
      if (above.app === true && hostFor(above.name) === known) top = above;
      else break;
    }
    return {
      ok: true,
      kind: known.kind,
      label: known.label,
      hostPid: top.pid,
      hwnd: null,
      windowTitle: '',
      exact: true,
      tabbed: known.tabbed === true,
      tabTitle: '',
      via: 'ancestor',
      sessionPid: pid,
    };
  }

  return {
    ok: false,
    reason: 'no-window',
    message:
      'It is running, but no window on this desktop belongs to it — a headless run, or a terminal on another desktop.',
  };
}

/**
 * One line saying where a session is: `Windows Terminal — tab “fix the parser”`.
 * @param {WindowTarget} target
 * @returns {string}
 */
export function describeTarget(target) {
  const where = target.label;
  if (target.tabbed && target.tabTitle) return `${where} — tab “${target.tabTitle}”`;
  if (target.windowTitle && target.kind !== 'app' && target.kind !== 'console') {
    return `${where} — “${target.windowTitle}”`;
  }
  return where;
}

/**
 * @typedef {object} GoToPlan
 * @property {'focus'|'resume'|'none'} action
 * @property {string} label        what the button says
 * @property {string} detail       one quiet line under it: where, or why not
 * @property {boolean} disabled
 * @property {'app'|'terminal'|null} resumeTarget  for `resume`
 */

/**
 * What the one button does, and what it is called.
 *
 * The rule: a session that is RUNNING is gone to, never started a second time
 * — a second `--resume` of a live session is two processes appending to one
 * transcript. A session that has ended is resumed, in the place the person
 * chose in settings. Where the running session cannot be reached, the button
 * says so and stays where it is: it does not quietly become Resume, because
 * that is precisely the second copy this exists to prevent.
 *
 * The one exception is a runtime that never says which process a session is
 * in. There "running" is itself an inference from a file's age, there is no
 * process to go to, and a permanently dead button would be the product
 * declining to help; so it is Resume, and the line under it says why.
 *
 * @param {object} input
 * @param {{live?:boolean, subagent?:boolean}} input.agent
 * @param {number|null} input.pid              the session's process, when the
 *   runtime reported one
 * @param {boolean} input.reportsPid           whether this runtime ever does
 * @param {string} input.runtimeLabel          `Claude Code`, `Codex`, …
 * @param {{supported:boolean, reason?:string}} input.support  this machine
 * @param {WindowTarget|NoWindow|null} input.target
 * @param {{preference:'app'|'terminal', appAvailable:boolean,
 *          terminalLabel:string|null}} input.resume
 * @returns {GoToPlan}
 */
export function goToPlan(input) {
  const { agent, pid, reportsPid, support, target, resume } = input;
  const running = pid != null;

  if (running) {
    if (!support.supported) {
      return {
        action: 'focus',
        label: 'Go to session',
        detail: support.reason || 'Not supported on this machine.',
        disabled: true,
        resumeTarget: null,
      };
    }
    if (!target || target.ok !== true) {
      const none = /** @type {NoWindow|null} */ (target);
      return {
        action: 'focus',
        label: 'Go to session',
        detail: none ? none.message : 'Looking for its window…',
        disabled: Boolean(none),
        resumeTarget: null,
      };
    }
    return {
      action: 'focus',
      label: 'Go to session',
      detail:
        describeTarget(target) +
        (target.exact ? '' : ' — it has several windows; the front one is raised'),
      disabled: false,
      resumeTarget: null,
    };
  }

  if (agent.live && reportsPid) {
    return {
      action: 'focus',
      label: 'Go to session',
      detail: 'It is running, but DeckHQ has not been told its process yet. Try again in a moment.',
      disabled: true,
      resumeTarget: null,
    };
  }

  const wantsApp = resume.preference === 'app' && resume.appAvailable;
  const where = wantsApp ? 'the desktop app' : resume.terminalLabel || 'a terminal';
  let detail = '';
  if (agent.live && !reportsPid) {
    detail = `${input.runtimeLabel} does not say which process a session runs in, so DeckHQ cannot find its window. This opens it in ${where}.`;
  } else if (resume.preference === 'app' && !resume.appAvailable) {
    detail = 'The desktop app cannot open this session, so it opens in a terminal.';
  }
  return {
    action: 'resume',
    label: `Resume in ${where}`,
    detail,
    disabled: false,
    resumeTarget: wantsApp ? 'app' : 'terminal',
  };
}

/**
 * What to tell the person after the window was raised.
 *
 * @param {WindowTarget} target
 * @param {{foreground?:boolean|null, flashed?:boolean, tab?:string, tabs?:number,
 *          tabTitle?:string, opened?:boolean}} result  `opened` is the desktop
 *   app having been handed the session's own link
 * @returns {string}
 */
export function describeOutcome(target, result) {
  const where = target.label;
  const Where = `${where.charAt(0).toUpperCase()}${where.slice(1)}`;
  // Three answers, and only one of them is a claim. `true` was read back from
  // the system after the attempt; `false` was too; `null` is a platform this
  // could not ask, so it says what was asked for and not what happened.
  const front =
    result.foreground === false
      ? `Windows would not let DeckHQ bring ${where} forward — its taskbar button is flashing`
      : result.foreground === true
        ? `${Where} is in front`
        : `${Where} was asked to come forward`;
  if (target.kind === 'app') {
    return result.opened
      ? `${front}, on this session.`
      : `${front}. This session is not one the app lists, so pick it there.`;
  }
  const title = result.tabTitle || target.tabTitle;
  switch (result.tab) {
    case 'selected':
    case 'already':
    case 'only':
      return `${front}, on this session’s tab.`;
    case 'ambiguous':
      return `${front}. ${result.tabs} tabs there, and more than one is called “${title}” — it is one of those.`;
    case 'unmatched':
      return title
        ? `${front}. Its tab could not be picked out of ${result.tabs}; the session’s own title is “${title}”.`
        : `${front}. Its tab could not be picked out of ${result.tabs}.`;
    default:
      if (target.tabbed && target.kind === 'editor') {
        return `${front}. The session is in one of its terminals.`;
      }
      return target.exact
        ? `${front}.`
        : `${front} — it has several windows, and this is the front one.`;
  }
}
