/**
 * Terminal emulators, and how each one is asked to run a command in a
 * directory. WP-04 in `docs/plan/06-ENGINEERING-WORKPLAN.md`.
 *
 * `openInTerminal()` used to know one way to open a terminal per platform: on
 * macOS a `.command` file handed to Terminal.app, on Linux four `-e` guesses.
 * The audience for this product does not use Terminal.app, and neither path had
 * ever been run (`docs/DEVIATIONS.md` §9). This module is the replacement: a
 * table of emulators, each with its own documented launch form, a detection
 * order per platform, and a settings pin that overrides both.
 *
 * THREE RULES GOVERN EVERY ENTRY IN THE TABLE.
 *
 * 1. **Argv arrays, never shell strings.** A session id and a working
 *    directory are user data. They travel as individual argv elements from
 *    here to `spawn()` and no shell ever parses them. `docs/DEVIATIONS.md`
 *    §28 is why that rule is absolute in this area.
 * 2. **Where a shell line is unavoidable, we write it, escaped, to a file.**
 *    Terminal.app, iTerm2 and Warp have no argv surface for "run this
 *    command": they take a shell line, or a file to run. For those three we
 *    write a `#!/bin/sh` wrapper with every value single-quoted for sh
 *    (`shQuote`), and only its absolute path is ever passed as an argument.
 *    The id never reaches a shell unquoted, and never reaches AppleScript's
 *    script text at all — `osascript` gets the path as `argv`, and the
 *    AppleScript does its own quoting with `quoted form of`.
 * 3. **Every launch form is a pure function of its context**, so the exact
 *    argv array for every (platform, emulator) pair is asserted in
 *    `test/unit/terminals.test.mjs` rather than reasoned about. That matters
 *    more here than usual: this file was written on Windows and, as of this
 *    commit, NO launch form in it has been run on a real Mac or Linux
 *    desktop. See `docs/DEVIATIONS.md` §9 and §91.
 *
 * It lived under `src/adapters/claude-code/` until the Codex adapter became
 * its second caller, which is the condition §91 set for moving it here. It
 * imports only node builtins and knows nothing about any runtime, so it does
 * not invert `02-ARCHITECTURE.md` §2's layering. See `docs/DEVIATIONS.md`
 * §94; `src/adapters/claude-code/terminals.mjs` remains as a re-export.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';

/**
 * The value of the `terminal` setting that means "work it out". Anything else
 * is one of the ids below.
 */
export const TERMINAL_AUTO = 'auto';

// ---------------------------------------------------------------------------
// Quoting, and the wrapper script
// ---------------------------------------------------------------------------

/**
 * POSIX single-quote escaping, for the one place a value has to become part of
 * a shell line: the wrapper script written for the three macOS emulators that
 * accept nothing else. `'` closes the quote, escapes a literal quote, and
 * reopens — the form `sh` has always accepted and the same transformation
 * AppleScript's `quoted form of` performs.
 * @param {unknown} s
 * @returns {string}
 */
export function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * The wrapper script's text. One `cd`, one `exec`, every value quoted.
 *
 * `|| exit 1` on the `cd` is not decoration: without it a working directory
 * that has been deleted since the scan would run the agent in whatever
 * directory the launching shell happened to be in, which is a different
 * project. Better to open nothing.
 *
 * @param {string[]} command argv of the command to run, e.g.
 *   `['claude', '--resume', '<id>']`
 * @param {string} cwd absolute path to run it in
 * @returns {string}
 */
export function launcherScript(command, cwd) {
  const line = command.map(shQuote).join(' ');
  return (
    '#!/bin/sh\n' +
    '# Written by DeckHQ to hand one command to a terminal that takes no argv.\n' +
    '# Safe to delete.\n' +
    `cd ${shQuote(cwd)} || exit 1\n` +
    `exec ${line}\n`
  );
}

/**
 * A filename for the wrapper script, built from a caller-supplied prefix and a
 * session id.
 *
 * The id is stripped to `[A-Za-z0-9._-]` first. It is normally a UUID, but it
 * arrives from a request body, and an id of `../../../etc/cron.d/x` would
 * otherwise have chosen where in the filesystem the script was written. The
 * timestamp keeps two resumes of the same session from racing on one file.
 * @param {string} prefix
 * @param {string} sessionId
 * @param {number} [now]
 * @returns {string}
 */
export function launcherFileName(prefix, sessionId, now = Date.now()) {
  const safe =
    String(sessionId)
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .slice(0, 64) || 'session';
  return `deckhq-${prefix}-${safe}-${now}.command`;
}

/**
 * Write the wrapper script and return its path. Executable, in the OS temp
 * directory, and only ever referenced by that path.
 * @param {{command:string[], cwd:string, prefix?:string, sessionId?:string,
 *          dir?:string, now?:number}} opts
 * @returns {Promise<string>}
 */
export async function writeLauncherScript(opts) {
  const dir = opts.dir || os.tmpdir();
  const file = path.join(
    dir,
    launcherFileName(opts.prefix || 'run', opts.sessionId || '', opts.now),
  );
  await fsp.writeFile(file, launcherScript(opts.command, opts.cwd), { mode: 0o755 });
  return file;
}

// ---------------------------------------------------------------------------
// The AppleScript
// ---------------------------------------------------------------------------

/**
 * iTerm2's only documented way to run something is `write text`, which types a
 * line into a shell. So this script receives the wrapper script's PATH as
 * `argv` — never interpolated into the script source — and quotes it with
 * `quoted form of`, StandardAdditions' own POSIX single-quoter. The session id
 * and the working directory are inside the wrapper, already quoted by
 * `launcherScript`; nothing user-supplied appears in this text or in the line
 * it types beyond that one generated path.
 *
 * Newlines inside a single `-e` argument are how `osascript` takes a
 * multi-line script, and the path passed after it is absolute, so it can never
 * be mistaken for an option by `osascript`'s own argument parsing.
 */
export const ITERM_SCRIPT = [
  'on run argv',
  '\tset target to quoted form of (item 1 of argv)',
  '\ttell application "iTerm"',
  '\t\tactivate',
  '\t\tset w to (create window with default profile)',
  '\t\ttell current session of w to write text target',
  '\tend tell',
  'end run',
].join('\n');

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/**
 * One emulator.
 *
 * @typedef {object} Terminal
 * @property {string} id stable slug; also the value of the `terminal` setting
 * @property {string} label what `deckhq doctor` prints
 * @property {string[]} [termProgram] `$TERM_PROGRAM` values, lowercased, that
 *   mean DeckHQ is itself running inside this emulator
 * @property {string[]} [envKeys] environment variables this emulator exports
 *   into its own shells; a second, more reliable "we are inside it" signal for
 *   the emulators that set no `$TERM_PROGRAM`
 * @property {string} [bin] the name to look for on `PATH`
 * @property {string} [app] the macOS bundle name, without `.app`
 * @property {boolean} [always] present on every machine of this platform, so
 *   no probe is run and it can serve as the final fallback
 * @property {boolean} [needsScript] takes a shell line rather than an argv, so
 *   a wrapper script is written and its path handed over
 * @property {{bin?: (ctx:LaunchContext) => Launch, app?: (ctx:LaunchContext) => Launch}} launch
 */

/**
 * @typedef {object} LaunchContext
 * @property {string[]} command argv of the command to run in the terminal
 * @property {string} cwd absolute working directory
 * @property {string|null} [scriptPath] the wrapper script, for `needsScript`
 */

/**
 * @typedef {object} Launch
 * @property {string} cmd
 * @property {string[]} args
 */

/**
 * macOS, in the preference order WP-04 sets. Ghostty first because it is what
 * this audience has moved to; Terminal.app last because it is the only one
 * that is certainly installed.
 *
 * Two launch forms per emulator where both are possible. `bin` is the CLI on
 * `PATH` and is preferred: it is the documented interface and it takes an argv
 * array. `app` is `open`, for a machine where the app is installed but its CLI
 * was never symlinked — everything after `--args` is handed to the
 * application unparsed, so the argv discipline survives `open`.
 *
 * @type {Terminal[]}
 */
export const MAC_TERMINALS = [
  {
    id: 'ghostty',
    label: 'Ghostty',
    termProgram: ['ghostty'],
    envKeys: ['GHOSTTY_RESOURCES_DIR', 'GHOSTTY_BIN_DIR'],
    bin: 'ghostty',
    app: 'Ghostty',
    launch: {
      bin: ({ command, cwd }) => ({
        cmd: 'ghostty',
        args: [`--working-directory=${cwd}`, '-e', ...command],
      }),
      app: ({ command, cwd }) => ({
        cmd: 'open',
        args: ['-na', 'Ghostty', '--args', `--working-directory=${cwd}`, '-e', ...command],
      }),
    },
  },
  {
    id: 'iterm2',
    label: 'iTerm2',
    // iTerm2 reports itself as `iTerm.app`, and its bundle is `iTerm.app` —
    // the "2" is in the product name only.
    termProgram: ['iterm.app'],
    envKeys: ['ITERM_SESSION_ID'],
    app: 'iTerm',
    needsScript: true,
    launch: {
      app: ({ scriptPath }) => ({ cmd: 'osascript', args: ['-e', ITERM_SCRIPT, scriptPath] }),
    },
  },
  {
    id: 'warp',
    label: 'Warp',
    termProgram: ['warpterminal'],
    envKeys: ['WARP_IS_LOCAL_SHELL_SESSION', 'WARP_HONOR_PS1'],
    app: 'Warp',
    // Warp's URL scheme (`warp://action/new_tab?path=…`) can open a tab in a
    // directory but carries no command, which is the whole job here. So it
    // gets the wrapper script, exactly as WP-04 says to do when the scheme
    // cannot take one.
    needsScript: true,
    launch: {
      app: ({ scriptPath }) => ({ cmd: 'open', args: ['-a', 'Warp', scriptPath] }),
    },
  },
  {
    id: 'kitty',
    label: 'kitty',
    // kitty sets no `$TERM_PROGRAM`; `KITTY_WINDOW_ID` is the real signal.
    termProgram: ['kitty'],
    envKeys: ['KITTY_WINDOW_ID', 'KITTY_PID'],
    bin: 'kitty',
    app: 'kitty',
    launch: {
      bin: ({ command, cwd }) => ({ cmd: 'kitty', args: ['--directory', cwd, ...command] }),
      app: ({ command, cwd }) => ({
        cmd: 'open',
        args: ['-na', 'kitty', '--args', '--directory', cwd, ...command],
      }),
    },
  },
  {
    id: 'wezterm',
    label: 'WezTerm',
    termProgram: ['wezterm'],
    envKeys: ['WEZTERM_PANE', 'WEZTERM_UNIX_SOCKET'],
    bin: 'wezterm',
    app: 'WezTerm',
    launch: {
      bin: ({ command, cwd }) => ({
        cmd: 'wezterm',
        args: ['start', '--cwd', cwd, '--', ...command],
      }),
      app: ({ command, cwd }) => ({
        cmd: 'open',
        args: ['-na', 'WezTerm', '--args', 'start', '--cwd', cwd, '--', ...command],
      }),
    },
  },
  {
    id: 'terminal-app',
    label: 'Terminal.app',
    termProgram: ['apple_terminal'],
    app: 'Terminal',
    always: true,
    needsScript: true,
    launch: {
      app: ({ scriptPath }) => ({ cmd: 'open', args: ['-a', 'Terminal', scriptPath] }),
    },
  },
];

/**
 * Linux and the other POSIX desktops, in WP-04's order. `$TERMINAL` is
 * honoured before any of this — see `detectTerminals`.
 *
 * Every entry sets the working directory with its own flag AND is spawned with
 * `cwd`, which is belt and braces on purpose: `xterm` and
 * `x-terminal-emulator` have no such flag at all, so `cwd` is the only thing
 * putting the agent in the right project for those two.
 *
 * @type {Terminal[]}
 */
export const LINUX_TERMINALS = [
  {
    id: 'alacritty',
    label: 'Alacritty',
    termProgram: ['alacritty'],
    envKeys: ['ALACRITTY_WINDOW_ID', 'ALACRITTY_SOCKET'],
    bin: 'alacritty',
    launch: {
      bin: ({ command, cwd }) => ({
        cmd: 'alacritty',
        args: ['--working-directory', cwd, '-e', ...command],
      }),
    },
  },
  {
    id: 'foot',
    label: 'foot',
    // foot takes the command as trailing arguments — no `-e` at all.
    envKeys: ['FOOT_PID'],
    bin: 'foot',
    launch: {
      bin: ({ command, cwd }) => ({
        cmd: 'foot',
        args: [`--working-directory=${cwd}`, ...command],
      }),
    },
  },
  {
    id: 'kitty',
    label: 'kitty',
    termProgram: ['kitty'],
    envKeys: ['KITTY_WINDOW_ID', 'KITTY_PID'],
    bin: 'kitty',
    launch: {
      bin: ({ command, cwd }) => ({ cmd: 'kitty', args: ['--directory', cwd, ...command] }),
    },
  },
  {
    id: 'wezterm',
    label: 'WezTerm',
    termProgram: ['wezterm'],
    envKeys: ['WEZTERM_PANE', 'WEZTERM_UNIX_SOCKET'],
    bin: 'wezterm',
    launch: {
      bin: ({ command, cwd }) => ({
        cmd: 'wezterm',
        args: ['start', '--cwd', cwd, '--', ...command],
      }),
    },
  },
  {
    id: 'gnome-terminal',
    label: 'GNOME Terminal',
    envKeys: ['GNOME_TERMINAL_SERVICE', 'GNOME_TERMINAL_SCREEN'],
    bin: 'gnome-terminal',
    launch: {
      bin: ({ command, cwd }) => ({
        cmd: 'gnome-terminal',
        args: [`--working-directory=${cwd}`, '--', ...command],
      }),
    },
  },
  {
    id: 'konsole',
    label: 'Konsole',
    envKeys: ['KONSOLE_VERSION', 'KONSOLE_DBUS_SESSION'],
    bin: 'konsole',
    launch: {
      bin: ({ command, cwd }) => ({
        cmd: 'konsole',
        args: ['--workdir', cwd, '-e', ...command],
      }),
    },
  },
  {
    id: 'xfce4-terminal',
    label: 'Xfce Terminal',
    bin: 'xfce4-terminal',
    launch: {
      // `-x` takes the rest of the command line as an argv; `-e` would take a
      // single string and re-split it, which is the shell-string form this
      // module exists to avoid.
      bin: ({ command, cwd }) => ({
        cmd: 'xfce4-terminal',
        args: [`--working-directory=${cwd}`, '-x', ...command],
      }),
    },
  },
  {
    id: 'xterm',
    label: 'xterm',
    bin: 'xterm',
    launch: {
      bin: ({ command }) => ({ cmd: 'xterm', args: ['-e', ...command] }),
    },
  },
  {
    id: 'x-terminal-emulator',
    label: "the desktop's default terminal",
    // Not in WP-04's list. Kept, last, because on Debian and its derivatives
    // this alternatives symlink is how a user's chosen emulator is reached
    // when it is not one of the eight above — dropping it would have been a
    // regression against the code this replaces. See docs/DEVIATIONS.md §91.
    bin: 'x-terminal-emulator',
    launch: {
      bin: ({ command }) => ({ cmd: 'x-terminal-emulator', args: ['-e', ...command] }),
    },
  },
];

/**
 * Windows. One entry, and it is the path that has actually been exercised on a
 * real machine — the empty string after `start` is the window title, without
 * which `start` reads the next quoted argument as one.
 * @type {Terminal[]}
 */
export const WINDOWS_TERMINALS = [
  {
    id: 'windows-console',
    label: 'the Windows console',
    always: true,
    launch: {
      bin: ({ command }) => ({ cmd: 'cmd', args: ['/c', 'start', '', 'cmd', '/k', ...command] }),
    },
  },
];

/**
 * The emulators this platform can use, in preference order.
 * @param {string} platform a `process.platform` value
 * @returns {Terminal[]}
 */
export function terminalsFor(platform) {
  if (platform === 'win32') return WINDOWS_TERMINALS;
  if (platform === 'darwin') return MAC_TERMINALS;
  return LINUX_TERMINALS;
}

/**
 * Every id the `terminal` setting may be pinned to, across all platforms,
 * plus `auto`. Exported for the settings route, which rejects a value outside
 * this set rather than storing something no platform can resolve.
 * @returns {string[]}
 */
export function terminalIds() {
  const ids = new Set([TERMINAL_AUTO]);
  for (const t of [...MAC_TERMINALS, ...LINUX_TERMINALS, ...WINDOWS_TERMINALS]) ids.add(t.id);
  return [...ids];
}

/**
 * @param {string} platform
 * @param {string} id
 * @returns {Terminal|null}
 */
export function findTerminal(platform, id) {
  return terminalsFor(platform).find((t) => t.id === id) || null;
}

// ---------------------------------------------------------------------------
// Building the argv
// ---------------------------------------------------------------------------

/**
 * The exact argv for one emulator. Pure: same inputs, same array, no I/O, no
 * environment. This is the function the per-pair tests assert against.
 *
 * @param {Terminal} terminal
 * @param {LaunchContext & {via?: 'bin'|'app'}} ctx
 * @returns {Launch}
 */
export function buildLaunch(terminal, ctx) {
  const via = ctx.via || (terminal.launch.bin ? 'bin' : 'app');
  const build = terminal.launch[via];
  if (!build) {
    throw new Error(`${terminal.label} has no "${via}" launch form`);
  }
  if (terminal.needsScript && !ctx.scriptPath) {
    throw new Error(`${terminal.label} needs a wrapper script and none was written`);
  }
  const command = ctx.command || [];
  const cwd = String(ctx.cwd || '');
  return build({ command, cwd, scriptPath: ctx.scriptPath || null });
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** @param {string} cmd @returns {Promise<boolean>} */
function binOnPath(cmd) {
  return new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    execFile(finder, [cmd], { windowsHide: true, timeout: 5000 }, (err) => resolve(!err));
  });
}

/**
 * Is `<name>.app` installed?
 *
 * Two standard locations are checked with `existsSync` first, because that is
 * a stat and covers every ordinary install. Only when both miss does this
 * spend a process on `open -Ra <name>`, which asks LaunchServices and so finds
 * an app anywhere — `~/Downloads`, a second volume, a Homebrew cask that put
 * it somewhere unusual. `open -Ra` REVEALS rather than launches; it is used
 * here purely for its exit code, and it is an argv probe, not a shell one.
 * @param {string} name bundle name without `.app`
 * @returns {Promise<boolean>}
 */
async function appInstalled(name) {
  for (const dir of ['/Applications', path.join(os.homedir(), 'Applications')]) {
    try {
      if (fs.existsSync(path.join(dir, `${name}.app`))) return true;
    } catch {
      // an unreadable directory is not an answer; keep looking
    }
  }
  return new Promise((resolve) => {
    execFile('open', ['-Ra', name], { windowsHide: true, timeout: 5000 }, (err) => resolve(!err));
  });
}

/**
 * Probe results for this process, so a floor where the user resumes twenty
 * sessions does not re-stat `/Applications` twenty times. Terminals are not
 * installed mid-session often enough for this to be wrong in a way anyone
 * notices, and the decision itself is recomputed every call — only the
 * evidence is cached.
 * @type {Map<string, Promise<boolean>>}
 */
const probeCache = new Map();

/** @param {string} key @param {() => Promise<boolean>} run */
function cachedProbe(key, run) {
  let p = probeCache.get(key);
  if (!p) {
    p = run().catch(() => false);
    probeCache.set(key, p);
  }
  return p;
}

/** Test seam. The daemon never needs this — the cache only holds evidence. */
export function _resetTerminalProbeCache() {
  probeCache.clear();
}

/**
 * Is DeckHQ itself running inside this emulator? `$TERM_PROGRAM` is the
 * documented signal and is checked case-insensitively; `envKeys` covers the
 * emulators that set none (kitty, foot, Konsole, GNOME Terminal).
 * @param {Terminal} terminal
 * @param {Record<string, string|undefined>} env
 * @returns {boolean}
 */
export function runningInside(terminal, env) {
  const tp = String(env.TERM_PROGRAM || '').toLowerCase();
  if (tp && (terminal.termProgram || []).includes(tp)) return true;
  for (const key of terminal.envKeys || []) {
    if (env[key]) return true;
  }
  return false;
}

/**
 * @typedef {object} TerminalChoice
 * @property {Terminal} terminal
 * @property {'bin'|'app'} via which launch form to use
 * @property {'pinned'|'env'|'TERMINAL'|'installed'|'fallback'} reason how it
 *   was chosen — printed by `deckhq doctor`, so it says only what was checked
 * @property {boolean} present whether a probe actually found it. Always true
 *   except for a pin that names something this machine does not have, which
 *   is honoured anyway (below) and reported as missing.
 */

/**
 * Which launch form is usable, and is the emulator here at all.
 * @param {Terminal} terminal
 * @param {string} platform
 * @param {{bin:(name:string) => Promise<boolean>, app:(name:string) => Promise<boolean>}} probes
 * @returns {Promise<{present:boolean, via:'bin'|'app'}>}
 */
async function probe(terminal, platform, probes) {
  // What to use when no probe hits and the emulator is launched anyway (a pin,
  // or `$TERM_PROGRAM` saying we are inside it). On macOS that is `open`: the
  // usual reason a probe misses on a machine that plainly has the app is that
  // its CLI was never symlinked onto `PATH`, and `open` does not need one.
  const preferred = /** @type {'bin'|'app'} */ (
    platform === 'darwin' && terminal.launch.app ? 'app' : terminal.launch.bin ? 'bin' : 'app'
  );
  if (terminal.always) return { present: true, via: preferred };

  if (terminal.bin && terminal.launch.bin) {
    if (await probes.bin(terminal.bin)) return { present: true, via: 'bin' };
  }
  if (platform === 'darwin' && terminal.app && terminal.launch.app) {
    if (await probes.app(terminal.app)) return { present: true, via: 'app' };
  }
  return { present: false, via: preferred };
}

/**
 * The real machine. Both are cached per process — see `cachedProbe`.
 * @type {{bin:(name:string) => Promise<boolean>, app:(name:string) => Promise<boolean>}}
 */
const REAL_PROBES = {
  bin: (name) => cachedProbe(`bin:${name}`, () => binOnPath(name)),
  app: (name) => cachedProbe(`app:${name}`, () => appInstalled(name)),
};

/**
 * A `$TERMINAL` value that names nothing in the table. It is still the user's
 * stated choice, so it is used — with `-e`, which is the convention the great
 * majority of X11 emulators follow, and the same form the code this replaces
 * used for `x-terminal-emulator`. An emulator that wants something else will
 * fail visibly rather than silently opening the wrong thing.
 * @param {string} value the raw `$TERMINAL`
 * @returns {Terminal}
 */
export function terminalFromEnvVar(value) {
  const bin = String(value);
  const label = path.basename(bin) || bin;
  return {
    id: 'terminal-env',
    label,
    bin,
    launch: { bin: ({ command }) => ({ cmd: bin, args: ['-e', ...command] }) },
  };
}

/**
 * Every emulator worth trying on this machine, best first.
 *
 * The order, and why each step is where it is:
 *
 * 1. **The `terminal` setting.** An explicit choice outranks any amount of
 *    detection, and it is honoured even when the probe cannot find it — a pin
 *    that is quietly ignored is worse than one that fails with the name of the
 *    thing it could not find. It is not, however, the only candidate: the
 *    detected ones follow it, so a pin for a terminal that has since been
 *    uninstalled degrades to a working terminal rather than to nothing.
 * 2. **`$TERMINAL`, on Linux only.** WP-04 puts it first among the detected
 *    candidates, and it is the closest thing that platform has to a stated
 *    preference.
 * 3. **The emulator DeckHQ is itself running inside** (`$TERM_PROGRAM`, or an
 *    emulator-specific variable). If the daemon was started from Ghostty, the
 *    user's terminal is Ghostty.
 * 4. **Installed, in the table's preference order.**
 * 5. **The platform's guaranteed one** (`always`) — Terminal.app on macOS, the
 *    console on Windows. Linux has none, which is why a Linux machine with no
 *    known emulator gets an error rather than a guess.
 *
 * Each candidate appears once: a terminal chosen by an earlier rule is not
 * offered again by a later one.
 *
 * @param {{platform?:string, env?:Record<string,string|undefined>, pin?:string,
 *          probes?:{bin:(name:string) => Promise<boolean>,
 *                   app:(name:string) => Promise<boolean>}}} [opts] `probes`
 *   is the test seam: it stands in for `which` and `/Applications`, so a Mac's
 *   or a Linux box's software can be described from a Windows test run. The
 *   daemon never passes it.
 * @returns {Promise<TerminalChoice[]>}
 */
export async function detectTerminals(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const pin = String(opts.pin || TERMINAL_AUTO);
  const probes = opts.probes || REAL_PROBES;
  const table = terminalsFor(platform);

  /** @type {TerminalChoice[]} */
  const out = [];
  const seen = new Set();
  /**
   * @param {Terminal} terminal
   * @param {TerminalChoice['reason']} reason
   * @param {boolean} [trust] treat it as present whatever the probe says.
   *   Set for `$TERMINAL` and `$TERM_PROGRAM`, and only for those: both are
   *   live evidence about this machine at this moment — an emulator DeckHQ is
   *   demonstrably running inside is installed, whatever `which` and
   *   `/Applications` have to say about where. A pin gets no such benefit; it
   *   is a stored preference and the machine may have changed under it.
   */
  const push = async (terminal, reason, trust = false) => {
    if (seen.has(terminal.id)) return;
    seen.add(terminal.id);
    const { present, via } = await probe(terminal, platform, probes);
    out.push({ terminal, via, reason, present: present || trust });
  };

  if (pin && pin !== TERMINAL_AUTO) {
    const pinned = findTerminal(platform, pin);
    if (pinned) await push(pinned, 'pinned');
  }

  if (platform !== 'win32' && env.TERMINAL) {
    const raw = String(env.TERMINAL).trim();
    if (raw) {
      const known = table.find(
        (t) => t.id === raw || t.bin === raw || t.bin === path.basename(raw),
      );
      if (known) await push(known, 'TERMINAL', true);
      else if (!seen.has('terminal-env')) {
        seen.add('terminal-env');
        const synthetic = terminalFromEnvVar(raw);
        out.push({ terminal: synthetic, via: 'bin', reason: 'TERMINAL', present: true });
      }
    }
  }

  for (const terminal of table) {
    if (runningInside(terminal, env)) await push(terminal, 'env', true);
  }

  for (const terminal of table) {
    if (terminal.always) continue;
    if (seen.has(terminal.id)) continue;
    const { present, via } = await probe(terminal, platform, probes);
    if (!present) continue;
    seen.add(terminal.id);
    out.push({ terminal, via, reason: 'installed', present: true });
  }

  for (const terminal of table) {
    if (terminal.always) await push(terminal, 'fallback');
  }

  // A pin for something this machine does not have, or an emulator whose
  // probe missed after `$TERM_PROGRAM` named it, is kept but demoted: try
  // everything we actually found first.
  return [...out.filter((c) => c.present), ...out.filter((c) => !c.present)];
}

/**
 * The one emulator `deckhq doctor` names. Null when this machine has none,
 * which is a real answer on a headless Linux box.
 * @param {{platform?:string, env?:Record<string,string|undefined>,
 *          pin?:string}} [opts]
 * @returns {Promise<TerminalChoice|null>}
 */
export async function detectTerminal(opts = {}) {
  const all = await detectTerminals(opts);
  return all[0] || null;
}

/**
 * The doctor row's data. Kept separate from `TerminalChoice` so nothing in the
 * report holds a function, and so the row survives `JSON.stringify` in
 * `--json`.
 * @param {{platform?:string, env?:Record<string,string|undefined>,
 *          pin?:string}} [opts]
 * @returns {Promise<{id:string|null, label:string|null,
 *   reason:TerminalChoice['reason']|null, present:boolean, pinned:boolean}>}
 */
export async function describeTerminal(opts = {}) {
  const choice = await detectTerminal(opts);
  if (!choice) return { id: null, label: null, reason: null, present: false, pinned: false };
  return {
    id: choice.terminal.id,
    label: choice.terminal.label,
    reason: choice.reason,
    present: choice.present,
    pinned: choice.reason === 'pinned',
  };
}

// ---------------------------------------------------------------------------
// Launching
// ---------------------------------------------------------------------------

/**
 * Try to spawn a detached terminal; resolve true only if the child actually
 * spawned (the binary was found), false otherwise. Never throws.
 *
 * `detached` plus `unref` is what lets the terminal outlive the daemon: a
 * terminal that dies when DeckHQ is restarted would take the agent with it.
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {Promise<boolean>}
 */
export function trySpawnDetached(cmd, args, cwd) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd: cwd || undefined, detached: true, stdio: 'ignore' });
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    child.once('error', () => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    });
    child.once('spawn', () => {
      if (!settled) {
        settled = true;
        child.unref();
        resolve(true);
      }
    });
  });
}

/**
 * Open a terminal running `command` in `cwd`. Walks the detected candidates
 * and stops at the first one that actually spawns, so a stale pin or an app
 * that is installed but broken costs one failed spawn rather than the feature.
 *
 * Throws when nothing spawned, naming what was tried — this is called from an
 * HTTP route that reports the message back to the user, so the message is the
 * whole diagnostic they get.
 *
 * @param {{command:string[], cwd:string, sessionId?:string, prefix?:string,
 *          pin?:string, platform?:string, env?:Record<string,string|undefined>,
 *          spawn?:(cmd:string, args:string[], cwd?:string) => Promise<boolean>,
 *          writeScript?:(opts:any) => Promise<string>,
 *          detect?:(opts:any) => Promise<TerminalChoice[]>}} opts the last
 *   three are test seams: `spawn` in place of a real process, `writeScript` in
 *   place of a real file, `detect` in place of probing the machine. The daemon
 *   passes none of them.
 * @returns {Promise<{id:string, label:string, cmd:string, args:string[],
 *   scriptPath:string|null}>}
 */
export async function launchTerminal(opts) {
  const platform = opts.platform || process.platform;
  const spawnOne = opts.spawn || trySpawnDetached;
  const write = opts.writeScript || writeLauncherScript;
  const detect = opts.detect || detectTerminals;

  const candidates = await detect({ platform, env: opts.env, pin: opts.pin });
  if (!candidates.length) {
    throw new Error(
      'No supported terminal emulator was found. Set $TERMINAL, or pin one in DeckHQ settings ' +
        `(terminal: one of ${terminalsFor(platform)
          .map((t) => t.id)
          .join(', ')}).`,
    );
  }

  /** @type {string[]} */
  const tried = [];
  for (const { terminal, via } of candidates) {
    let scriptPath = null;
    try {
      if (terminal.needsScript) {
        scriptPath = await write({
          command: opts.command,
          cwd: opts.cwd,
          prefix: opts.prefix || 'run',
          sessionId: opts.sessionId || '',
        });
      }
    } catch {
      tried.push(terminal.label);
      continue; // could not write the wrapper; the next emulator may not need one
    }

    /** @type {Launch} */
    let launch;
    try {
      launch = buildLaunch(terminal, { command: opts.command, cwd: opts.cwd, scriptPath, via });
    } catch {
      tried.push(terminal.label);
      continue;
    }

    tried.push(terminal.label);
    if (await spawnOne(launch.cmd, launch.args, opts.cwd)) {
      return {
        id: terminal.id,
        label: terminal.label,
        cmd: launch.cmd,
        args: launch.args,
        scriptPath,
      };
    }
  }

  throw new Error(`Could not open a terminal. Tried: ${tried.join(', ')}.`);
}
