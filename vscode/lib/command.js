/**
 * How a configured start command becomes a `child_process.spawn` call without
 * ever becoming a shell string.
 *
 * DeckHQ's standing rule for spawning is that user data never reaches a shell
 * as part of a command string (`src/adapters/claude-code/terminals.mjs`, and
 * the argv-array discipline in `docs/plan/07-AGENT-HANDOVERS.md`). That rule
 * is harder to keep here than in the CLI, for two reasons:
 *
 *   1. **The command is a setting**, and a setting can come from a workspace.
 *      A repository you cloned to look at could ship `.vscode/settings.json`
 *      naming any program it liked. `readStartCommand()` therefore reads the
 *      **user** value and the default only, and ignores the workspace and
 *      workspace-folder scopes entirely. A hostile repository has no way in.
 *   2. **`npx` on Windows is `npx.cmd`**, and Node refuses to spawn a `.cmd`
 *      without a shell (it is the fix for CVE-2024-27980). So on Windows the
 *      command does go through `cmd.exe` — and `windowsCommandLine()` is the
 *      whole of what makes that safe: every token is wrapped in double quotes,
 *      inside which `& | < > ( )` are literal to `cmd`, and any token holding
 *      a character quoting cannot neutralise — `"`, `%`, `!`, `^`, a newline —
 *      is **refused** rather than escaped. A command that cannot be expressed
 *      safely does not run.
 *
 * The command is an array in the settings schema for the same reason: there is
 * no string for us to split, so there is no splitting to get wrong.
 */
const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

/** What `deckhq.startCommand` is when the user has not set it. */
const DEFAULT_START_COMMAND = ['npx', '--yes', 'deckhq', '--no-open'];

/**
 * Characters `cmd.exe` still acts on inside a double-quoted argument, or that
 * end the command line outright.
 *
 *   `"` ends the quoted run · `%` and `!` expand variables · `^` escapes ·
 *   CR/LF and NUL terminate or split the line.
 */
const CMD_UNSAFE = /["%!^\r\n\0]/;

/**
 * Build the `cmd.exe /d /s /c` command line for an argv array, or throw.
 * Exported for the test that asserts a `%PATH%` or a `&& del` in a setting is
 * refused rather than quoted.
 *
 * @param {string[]} argv
 * @returns {string}
 */
function windowsCommandLine(argv) {
  if (!Array.isArray(argv) || argv.length === 0) throw new Error('empty command');
  for (const token of argv) {
    if (typeof token !== 'string' || token === '') {
      throw new Error('every part of deckhq.startCommand must be a non-empty string');
    }
    if (CMD_UNSAFE.test(token)) {
      throw new Error(
        `deckhq.startCommand contains a character that cannot be quoted safely for cmd.exe ` +
          `(one of " % ! ^ or a line break), in: ${token}`,
      );
    }
  }
  // The outer pair is not decoration. `cmd /s /c` strips the first and last
  // character of its command line when the first one is a quote, and then
  // parses what is left — so without a pair to sacrifice, `"code" "--flag"`
  // arrives as `code" "--flag` and nothing runs. It is what Node's own
  // `shell: true` builds, and the reason `/s` is passed at all: the stripping
  // rule is then one rule instead of several.
  return `"${argv.map((token) => `"${token}"`).join(' ')}"`;
}

/** The extensions Windows will actually execute, in the order cmd prefers. */
const WINDOWS_EXECUTABLE_EXTENSIONS = ['.cmd', '.exe', '.bat', '.com'];

/**
 * Resolve a bare program name to a Windows executable on `PATH`.
 *
 * npm ships `npx`, `npx.cmd` and `npx.ps1` side by side, and VS Code ships
 * `code` beside `code.cmd`; the extensionless file in each pair is a POSIX
 * shell script for Git Bash. Handed a bare `npx`, `cmd.exe` can pick that one
 * up and try to run a shell script as a batch file, which fails with a message
 * about a program nobody named. Naming the `.cmd` outright removes the guess.
 *
 * Falls back to the name unchanged: a program that cannot be found here is
 * `spawn`'s problem to report, not this function's to invent an error for.
 *
 * **`path.win32`, never the host's `path`** — §114's rule, applied to a module
 * that had not been swept for it. This answers "what will Windows run", so a
 * `PATH` of `C:\tools;C:\bin` must be split on `;` and joined with `\` whether
 * the process asking is on Windows or on the Linux runner that has to prove
 * the answer. The host's `path` would split that on `:` into three directories
 * that do not exist and then join with `/`, and the function would silently
 * return the bare name — which is exactly the outcome it exists to prevent.
 *
 * @param {string} name
 * @param {{path?:string, pathext?:string, exists?:(p:string) => boolean}} [env]
 * @returns {string}
 */
function resolveWindowsExecutable(name, env = {}) {
  const win = path.win32;
  if (win.extname(name)) return name;
  const exists = env.exists || ((p) => fs.existsSync(p));
  const extensions = env.pathext
    ? env.pathext.split(';').filter(Boolean)
    : WINDOWS_EXECUTABLE_EXTENSIONS;
  const dirs = win.isAbsolute(name)
    ? [win.dirname(name)]
    : (env.path == null ? process.env.PATH || '' : env.path).split(win.delimiter).filter(Boolean);
  const base = win.isAbsolute(name) ? win.basename(name) : name;
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = win.join(dir, base + ext);
      if (exists(candidate)) return candidate;
    }
  }
  return name;
}

/**
 * Turn an argv array into the arguments `child_process.spawn` should be called
 * with. `shell` is `false` on every platform; on Windows the shell is named
 * explicitly as the program being run, with a command line this module built.
 *
 * `env` exists so a test on any host can decide every input this reads: the
 * `PATH` the resolver walks, whether a candidate exists, and the exact
 * interpreter. §114's rule — the Windows argv is the one worth asserting
 * hardest, so it must not be assertable only on Windows.
 *
 * @param {string[]} argv
 * @param {string} [platform]
 * @param {{path?:string, pathext?:string, comspec?:string,
 *          exists?:(p:string) => boolean}} [env]
 * @returns {{file:string, args:string[], options:object}}
 */
function spawnPlan(argv, platform = process.platform, env = {}) {
  if (!Array.isArray(argv) || argv.length === 0) throw new Error('empty command');
  if (platform !== 'win32') {
    for (const token of argv) {
      if (typeof token !== 'string' || token === '') {
        throw new Error('every part of deckhq.startCommand must be a non-empty string');
      }
    }
    return { file: argv[0], args: argv.slice(1), options: { shell: false } };
  }
  const resolved = [resolveWindowsExecutable(argv[0], env), ...argv.slice(1)];
  return {
    file: env.comspec || process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', windowsCommandLine(resolved)],
    options: { shell: false, windowsVerbatimArguments: true, windowsHide: true },
  };
}

/**
 * The start command as configured, plus the port and `--no-open` flags the
 * extension insists on.
 *
 * `--no-open` is appended when the configured command does not already carry
 * it: this extension opens the floor in a panel, and a browser tab opening
 * behind VS Code as well is not what anybody asked for. A port is appended
 * only when one is configured — with none, the daemon's own rule applies and
 * it prefers wherever the installed hooks already post
 * (`docs/plan/08-PLAN-V2-100X.md` WP-36), which is the behaviour we want.
 *
 * @param {{command?:string[], port?:number|null}} opts
 * @returns {string[]}
 */
function startArgv(opts = {}) {
  const base =
    Array.isArray(opts.command) && opts.command.length
      ? opts.command.slice()
      : DEFAULT_START_COMMAND.slice();
  const argv = base.slice();
  if (!argv.includes('--no-open')) argv.push('--no-open');
  const port = Number(opts.port);
  if (Number.isInteger(port) && port > 0 && port < 65536 && !argv.includes('--port')) {
    argv.push('--port', String(port));
  }
  return argv;
}

/**
 * The port the daemon announced, from a line of its stdout.
 *
 * It prints `  DeckHQ  http://127.0.0.1:4317/` on a normal start and
 * `DeckHQ is already running at http://127.0.0.1:4317/` when it declined to
 * start a second one beside an existing daemon — both of which answer the only
 * question we have, which is where to point the panel.
 *
 * @param {string} text
 * @returns {number|null}
 */
function portFromOutput(text) {
  const match = /http:\/\/127\.0\.0\.1:(\d{1,5})\//.exec(String(text || ''));
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

module.exports = {
  DEFAULT_START_COMMAND,
  CMD_UNSAFE,
  WINDOWS_EXECUTABLE_EXTENSIONS,
  resolveWindowsExecutable,
  windowsCommandLine,
  spawnPlan,
  startArgv,
  portFromOutput,
};
