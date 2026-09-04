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
 * FOUR RULES GOVERN EVERY ENTRY IN THE TABLE.
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
 * 3. **Windows is the other place a line is unavoidable, and it is quoted
 *    here rather than by Node.** Opening a console window means `start`,
 *    which is an internal `cmd.exe` command and not a program, so `cmd.exe`
 *    re-parses everything after it. Node's win32 argument quoting does not
 *    escape `&`, `|`, `^`, `<` or `>`, which `cmd.exe` reads as syntax — so
 *    the whole command line is built by `windowsConsoleLaunch()` with
 *    `core/cmdline.mjs`'s rule and handed over with
 *    `windowsVerbatimArguments`. `docs/DEVIATIONS.md` §98.
 * 4. **Every launch form is a pure function of its context**, so the exact
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
 * §95; `src/adapters/claude-code/terminals.mjs` remains as a re-export.
 *
 * ============================================================================
 * WP-22 follow-up · this file is the launch: pick a terminal, say what it is
 * in words a user can act on, and spawn it detached so the daemon is never
 * the parent of a shell it cannot outlive. What a terminal IS, and whether it
 * is here, are two modules — both re-exported, so nothing that imports
 * `terminals.mjs` had to change:
 *
 *   terminals-catalog.mjs  the launcher script and the three catalogues
 *   terminals-detect.mjs   the probes, their cache, and detectTerminals
 * ============================================================================
 */

import { spawn } from 'node:child_process';

import { CMD_UNSAFE_CODE } from './cmdline.mjs';
import { buildLaunch, detectTerminals, terminalsFor } from './terminals-detect.mjs';
import { writeLauncherScript } from './terminals-catalog.mjs';

// `export *` from the detector, which already re-exports the catalogue's
// types; the catalogue's own values are listed so the two `export *` cannot
// disagree about a name they both carry.
export * from './terminals-detect.mjs';
export {
  TERMINAL_AUTO,
  ITERM_SCRIPT,
  MAC_TERMINALS,
  LINUX_TERMINALS,
  WINDOWS_TERMINALS,
  WINDOWS_CMD_REFUSAL,
  shQuote,
  launcherScript,
  launcherFileName,
  writeLauncherScript,
  windowsConsoleLaunch,
} from './terminals-catalog.mjs';

/** @typedef {import('./terminals-detect.mjs').TerminalChoice} TerminalChoice */
/** @typedef {import('./terminals-catalog.mjs').Launch} Launch */

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
 * @param {object} [options] a launch form's own `spawn()` options — in
 *   practice only `windowsVerbatimArguments`, for the one form that builds its
 *   command line itself.
 * @returns {Promise<boolean>}
 */
export function trySpawnDetached(cmd, args, cwd, options) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        cwd: cwd || undefined,
        detached: true,
        stdio: 'ignore',
        ...(options || {}),
      });
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
 *          spawn?:(cmd:string, args:string[], cwd?:string, options?:object) => Promise<boolean>,
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
    } catch (err) {
      // A value that cannot be put on a `cmd.exe` command line is a fact about
      // the id or the folder, not about this emulator: no other terminal can
      // make a `%` safe, and swallowing it here would replace a message that
      // says what is wrong with "Could not open a terminal". Everything else
      // is this emulator's problem, so the walk continues.
      if (err && err.code === CMD_UNSAFE_CODE) throw err;
      tried.push(terminal.label);
      continue;
    }

    tried.push(terminal.label);
    if (await spawnOne(launch.cmd, launch.args, opts.cwd, launch.spawnOptions)) {
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
