/**
 * Every terminal this product knows how to open, and the launcher it writes
 * for one (WP-22 follow-up).
 *
 * Split out of `terminals.mjs` unchanged: the shell quoting, the launcher
 * script and where it is written, the AppleScript iTerm needs, and the three
 * per-platform catalogues — macOS, Linux, Windows — plus the Windows console
 * refusal that keeps a `cmd.exe` command line honest.
 *
 * A catalogue entry is data about a terminal, never a command that runs on
 * its own: everything here is quoted through `cmdline.mjs` before it reaches
 * a shell.
 */

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { assertCmdSafe, cmdQuote, cmdRefusal, isCmdBareWord } from './cmdline.mjs';

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
 * @property {object} [spawnOptions] extra `spawn()` options this form needs.
 *   Only the Windows console sets it, and only to `windowsVerbatimArguments`,
 *   because it builds its own command line — see `windowsConsoleLaunch`.
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
 * What the user is told when a session id or a working directory cannot be put
 * on a `cmd.exe` command line. The rule is in `core/cmdline.mjs`; this is the
 * sentence, and it says why the refusal is almost certainly not about them.
 */
export const WINDOWS_CMD_REFUSAL =
  'DeckHQ will not open a Windows console for this session: its id or its folder contains a ' +
  'double quote or a percent sign, which cmd.exe reads as syntax rather than as text, and ' +
  'there is no way to quote either one safely. A Claude Code session id is a UUID and never ' +
  'contains them, and a project folder with a "%" in its name is rare — so this is worth ' +
  'looking at rather than working around. Open the session from a terminal you start yourself.';

/**
 * The Windows console launch, as one command line.
 *
 * ```text
 * cmd.exe /d /s /c start "" /d "<cwd>" cmd /d /s /k <program> "<arg>" "<arg>"
 * ```
 *
 * Every piece of that is load-bearing, and every claim below was checked on
 * Windows 11 (`docs/DEVIATIONS.md` §98), not read in documentation:
 *
 * - **`windowsVerbatimArguments`.** Node's win32 quoting wraps a value only
 *   when it holds a space, a tab or a quote, so an id of `x&calc` reached
 *   `cmd.exe` bare and became two commands. The line is built here instead.
 * - **`/d`, twice, meaning two different things.** On `cmd.exe` it suppresses
 *   the AutoRun registry commands, so nothing in the user's registry runs
 *   inside a window DeckHQ opened. On `start` it is the working directory.
 * - **`/s`.** Documented as: if the first character after `/c` (or `/k`) is a
 *   quote, strip it and the last quote on the line. Neither of our two lines
 *   starts with a quote — `start` and the program name are bare words — so
 *   nothing is stripped and every argument keeps the quotes it was given.
 *   That is why the program name must be a bare word (`isCmdBareWord`), and
 *   it is why this needs none of the doubled-quote trick `editor.mjs` uses.
 * - **The empty `""` after `start`.** It is the window title. Without it,
 *   `start` reads the next quoted argument as one and opens nothing.
 * - **`/d "<cwd>"`.** The working directory is also passed to `spawn()`, and
 *   was previously inherited that way alone. Naming it is belt and braces, the
 *   same as every Linux row, and it means the directory is stated rather than
 *   depending on `start` inheriting it through two processes.
 * - **The quotes.** `&`, `|`, `^`, `<`, `>` and `()` are literal inside them;
 *   `"` and `%` are refused by `cmdQuote` because nothing can make them safe.
 *
 * @param {LaunchContext} ctx
 * @returns {Launch}
 */
export function windowsConsoleLaunch({ command, cwd }) {
  const argv = (command || []).map(String);
  const program = argv[0] || '';
  if (!isCmdBareWord(program)) {
    // Never user data — DeckHQ's own adapters pass `claude` and `codex` — so
    // this is a guard against a future caller, not against the browser.
    throw cmdRefusal(
      `The Windows console can only start a plain command name, and "${program}" is not one.`,
    );
  }
  const args = argv.slice(1);
  const dir = String(cwd || '');
  assertCmdSafe([...args, dir], WINDOWS_CMD_REFUSAL);

  const inner = [program, ...args.map((a) => cmdQuote(a, WINDOWS_CMD_REFUSAL))].join(' ');
  const workdir = dir ? `/d ${cmdQuote(dir, WINDOWS_CMD_REFUSAL)} ` : '';
  return {
    cmd: 'cmd.exe',
    args: ['/d', '/s', '/c', `start "" ${workdir}cmd /d /s /k ${inner}`],
    spawnOptions: { windowsVerbatimArguments: true },
  };
}

/**
 * Windows. One entry, and it is the only row in this table that has actually
 * been run on a real machine.
 * @type {Terminal[]}
 */
export const WINDOWS_TERMINALS = [
  {
    id: 'windows-console',
    label: 'the Windows console',
    always: true,
    launch: { bin: windowsConsoleLaunch },
  },
];
