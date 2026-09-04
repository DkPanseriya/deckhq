/**
 * Which terminal is actually on this machine (WP-22 follow-up).
 *
 * Split out of `terminals.mjs` unchanged: the lookup by id, the launch
 * builder, the two probes — a binary on `PATH`, an app bundle installed —
 * their cache, the "are we running inside one already" check, and
 * `detectTerminals`, which puts the answers in preference order.
 *
 * Every probe is cached and every one of them fails soft: a terminal that
 * cannot be detected is simply not offered.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

/** @typedef {import('./terminals-catalog.mjs').Terminal} Terminal */
/** @typedef {import('./terminals-catalog.mjs').LaunchContext} LaunchContext */
/** @typedef {import('./terminals-catalog.mjs').Launch} Launch */
import {
  TERMINAL_AUTO,
  MAC_TERMINALS,
  LINUX_TERMINALS,
  WINDOWS_TERMINALS,
} from './terminals-catalog.mjs';

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
export function binOnPath(cmd) {
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
export async function appInstalled(name) {
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
export const probeCache = new Map();

/** @param {string} key @param {() => Promise<boolean>} run */
export function cachedProbe(key, run) {
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
export async function probe(terminal, platform, probes) {
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
export const REAL_PROBES = {
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
