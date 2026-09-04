/**
 * Where the `codex` program actually is on this machine.
 *
 * WP-23a. `docs/DEVIATIONS.md` §136.1, `docs/plan/CODEX-VERIFICATION.md` §3.2
 * and §4.3.
 *
 * **The defect this file exists for.** The OpenAI Codex desktop app installs a
 * complete `codex` CLI — 250 MB, the real thing, `codex-cli 0.153.1` on the
 * reference machine — and does **not** put it on `PATH`. `available()` answers
 * "does `~/.codex` exist", which is the documented pattern and is right for the
 * READ path: the rollout files are there or they are not, and no process is
 * needed to read them. It is wrong for the WRITE path. So `send()` got past its
 * guard, `spawn('codex', …)` came back `ENOENT`, and the user was told **"Codex
 * is not installed"** while Codex was running in the next window.
 *
 * `available()` does not change — a second probe on the poll path is the cost
 * `docs/DEVIATIONS.md` §77 removed, and it would answer a question the poll path
 * never asks. The binary is resolved here instead, at the three moments that
 * genuinely need a program: `version()`, `send()` and resume.
 *
 * **The order, and why.**
 *
 *   1. `settings.codexBin` — the user said which one. A setting that names a
 *      program is `editor`'s class of setting (WP-47), so it gets `editor`'s
 *      discipline: the HTTP route checks it is an existing file before storing
 *      it, the store sanitises its shape, and it is checked again here before
 *      anything is spawned. A pin that has since stopped being a file does not
 *      silently fall through to a different program — it is reported.
 *   2. `codex` on `PATH` — the durable install (`npm i -g @openai/codex`), and
 *      the one a user would expect to win over a copy hidden inside an app.
 *   3. The app's bundled copy. On Windows this is MEASURED:
 *      `%LOCALAPPDATA%\OpenAI\Codex\bin\<build-hash>\codex.exe`, where the hash
 *      directory changes when the app updates — so the newest one wins rather
 *      than the first one read. On macOS it is **not** measured; see below.
 *
 * **The macOS paths are DOCS-only and have never been seen.** No macOS machine
 * has been in reach of this package (`docs/DEVIATIONS.md` §9), so the two
 * candidates below are the mirror of the Windows layout and the conventional
 * place an Electron app keeps a helper binary. They are marked here, in §136,
 * and in the CHANGELOG rather than being presented as knowledge. If neither is
 * right the failure is the honest one — "not found", with the places named —
 * and a user can pin the binary with `codexBin` in one POST.
 *
 * Nothing here spawns anything. It stats files and reads directory names, and
 * every dependency is injectable so the whole search is exercised for both
 * platforms from one test run on one machine.
 */

import { constants as FS, accessSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/** The bare command name, for a machine where it is on PATH. */
export const CODEX_COMMAND = 'codex';

/**
 * The subdirectory the app keeps its hashed build directories in, under each
 * root in {@link bundleRoots}. MEASURED on Windows.
 */
const BUNDLE_BIN_DIR = 'bin';

/**
 * How the search describes itself, per source. These strings reach the `doctor`
 * report, so they say which check ran rather than what it implies.
 * @type {Readonly<Record<'pinned'|'path'|'bundled', string>>}
 */
export const BINARY_SOURCE_LABELS = Object.freeze({
  pinned: 'pinned',
  path: 'on PATH',
  bundled: 'bundled with the app',
});

/**
 * @typedef {object} CodexBinary
 * @property {string|null} command  absolute path (or the bare name, when that
 *   is what was found on PATH), or null when nothing was found
 * @property {'pinned'|'path'|'bundled'|null} source
 * @property {string[]} bundleDirs the app directories that were looked in,
 *   whether or not they exist — this is what the failure message names
 * @property {string|null} pinProblem a `codexBin` that is set and is not a file
 * @property {string|null} shimOnPath a `codex.cmd`/`codex.bat` that IS on PATH
 *   and was skipped, because Node cannot start one without a shell
 */

/**
 * The extensions a Windows `spawn()` can actually start.
 *
 * MEASURED, on the reference machine, and the reason this list is not just
 * `PATHEXT`: `npm i -g @openai/codex` installs `codex`, `codex.ps1` and
 * `codex.cmd` and no `.exe`, so `codex` IS on `PATH` here — as a batch shim.
 * Node refuses to spawn a `.cmd` without a shell (CVE-2024-27980) and throws
 * `EINVAL` synchronously, which is what `core/editor.mjs` documents for
 * `code.cmd`. That file answers it with `cmd.exe /d /s /c` and
 * `windowsVerbatimArguments`; this adapter cannot, and must not — a session id
 * and a turn of user text reach `send()` from a request body, and
 * `test/unit/codex-terminal.test.mjs` asserts this file contains no `cmd.exe`,
 * no `shell: true` and nothing else that would parse them (§28, §95).
 *
 * So the PATH search only ever CHOOSES something it can start, and the shim it
 * walked past is carried out in `shimOnPath` so the report can say so rather
 * than leaving the user wondering why the bundled copy won.
 */
const SPAWNABLE_WIN_EXTS = Object.freeze(['.exe', '.com']);

/** The Windows batch shims a `spawn()` cannot start. See above. */
const BATCH_WIN_EXTS = Object.freeze(['.cmd', '.bat']);

/** @param {string} p @param {string} platform @param {(p:string)=>boolean} [isFile] */
function executableAt(p, platform, isFile) {
  if (isFile) return isFile(p);
  try {
    if (!statSync(p).isFile()) return false;
  } catch {
    return false;
  }
  if (platform === 'win32') return true;
  try {
    accessSync(p, FS.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The directories the desktop app is known (Windows) or believed (macOS) to
 * keep its hashed build directories under. Linux has no Codex desktop app to
 * bundle anything, so the list is empty there and the search falls through to
 * PATH alone.
 *
 * @param {{env?: NodeJS.ProcessEnv, platform?: string, homedir?: string}} [opts]
 * @returns {string[]}
 */
export function bundleRoots(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const home = opts.homedir || os.homedir();

  if (platform === 'win32') {
    const local = String(env.LOCALAPPDATA || '').trim();
    if (!local) return [];
    return [path.win32.join(local, 'OpenAI', 'Codex')];
  }
  if (platform === 'darwin') {
    // DOCS / inferred, never observed. See the header.
    return [
      path.posix.join(home, 'Library', 'Application Support', 'OpenAI', 'Codex'),
      '/Applications/Codex.app/Contents/Resources',
    ];
  }
  return [];
}

/**
 * The `bin` directories under {@link bundleRoots}, joined with the TARGET
 * platform's separator so a Windows search reads as a Windows path even when
 * the test running it is on POSIX. This is the list the failure message names.
 *
 * @param {{env?: NodeJS.ProcessEnv, platform?: string, homedir?: string}} [opts]
 * @returns {string[]}
 */
export function bundleBinDirs(opts = {}) {
  const platform = opts.platform || process.platform;
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  return bundleRoots(opts).map((root) => join(root, BUNDLE_BIN_DIR));
}

/**
 * Where a bare command name lives on `PATH`. The same written-out scan
 * `core/editor.mjs` uses and for the same reason — `where`/`which` is one more
 * program between us and a decision that has to be exact — kept here rather
 * than imported so that `08-PLAN-V2-100X.md` §1.1 rule 8's "runtime CLI
 * knowledge lives in its adapter" stays true of `PATHEXT` as well as of argv.
 *
 * @param {string} name
 * @param {{env?: NodeJS.ProcessEnv, platform?: string, isFile?: (p:string)=>boolean,
 *          exts?: readonly string[]}} [opts] `exts` overrides the extensions
 *   tried on Windows; it defaults to the ones `spawn()` can start.
 * @returns {string|null}
 */
export function findOnPath(name, opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const sep = platform === 'win32' ? ';' : ':';
  const dirs = String(env.PATH || env.Path || '')
    .split(sep)
    .map((d) => d.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  const exts = platform === 'win32' ? opts.exts || SPAWNABLE_WIN_EXTS : [''];
  // Join with the TARGET platform's rules, not the host's, so both searches
  // can be exercised from one test run.
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (executableAt(candidate, platform, opts.isFile)) return candidate;
    }
  }
  return null;
}

/**
 * The newest `bin/<hash>/codex[.exe]` under any of {@link bundleRoots}.
 *
 * NEWEST, not first: the directory name is a build hash and a Codex update
 * leaves the previous one in place, so "the first one `readdir` returns" would
 * pin DeckHQ to whichever build the filesystem happened to list first — a bug
 * that would only appear after an update, which is the worst time for one.
 *
 * @param {{env?: NodeJS.ProcessEnv, platform?: string, homedir?: string,
 *          isFile?: (p:string)=>boolean, readdir?: (dir:string)=>string[],
 *          mtime?: (p:string)=>number}} [opts]
 * @returns {string|null}
 */
export function findBundledCodex(opts = {}) {
  const platform = opts.platform || process.platform;
  const read = opts.readdir || /** @param {string} dir */ ((dir) => readdirSync(dir));
  const mtimeOf =
    opts.mtime ||
    ((p) => {
      try {
        return statSync(p).mtimeMs;
      } catch {
        return -Infinity;
      }
    });
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const exe = platform === 'win32' ? 'codex.exe' : 'codex';

  let best = null;
  let bestMtime = -Infinity;
  for (const binDir of bundleBinDirs(opts)) {
    /** @type {string[]} */
    let hashes;
    try {
      hashes = read(binDir);
    } catch {
      continue; // the app is not installed here, which is not an error
    }
    for (const hash of Array.isArray(hashes) ? hashes : []) {
      const candidate = join(binDir, String(hash), exe);
      if (!executableAt(candidate, platform, opts.isFile)) continue;
      const m = mtimeOf(candidate);
      if (m > bestMtime) {
        bestMtime = m;
        best = candidate;
      }
    }
  }
  return best;
}

/**
 * Which `codex` this machine means, right now.
 *
 * Never throws and never spawns. A machine with no Codex at all resolves
 * `{command: null}` with the places it looked, which is what the failure
 * message is built from.
 *
 * @param {{pinned?: string, env?: NodeJS.ProcessEnv, platform?: string,
 *          homedir?: string, isFile?: (p:string)=>boolean,
 *          readdir?: (dir:string)=>string[], mtime?: (p:string)=>number}} [opts]
 * @returns {CodexBinary}
 */
export function resolveCodexBinary(opts = {}) {
  const platform = opts.platform || process.platform;
  const pinned = String(opts.pinned || '').trim();

  /** @type {CodexBinary} */
  const out = {
    command: null,
    source: null,
    bundleDirs: bundleBinDirs(opts),
    pinProblem: null,
    shimOnPath:
      platform === 'win32' ? findOnPath(CODEX_COMMAND, { ...opts, exts: BATCH_WIN_EXTS }) : null,
  };

  if (pinned) {
    if (executableAt(pinned, platform, opts.isFile)) {
      out.command = pinned;
      out.source = 'pinned';
      return out;
    }
    // Recorded rather than ignored: a pin that has stopped resolving is a
    // thing the user did, and silently running a different program instead is
    // exactly what `resolveEditor` refuses to do.
    out.pinProblem = pinned;
  }

  const onPath = findOnPath(CODEX_COMMAND, opts);
  if (onPath) {
    out.command = onPath;
    out.source = 'path';
    return out;
  }

  const bundled = findBundledCodex(opts);
  if (bundled) {
    out.command = bundled;
    out.source = 'bundled';
    return out;
  }
  return out;
}

/**
 * What to tell someone whose `send` just failed because there is no program to
 * run — the sentence that used to be the false "Codex is not installed".
 *
 * It names every place that was checked, because the whole point of the defect
 * is that the binary WAS on the machine and DeckHQ did not say where it had
 * looked. `docs/DEVIATIONS.md` §72–§73: say what was checked, at the size it is.
 *
 * @param {CodexBinary} bin
 * @returns {string}
 */
export function describeMissingBinary(bin) {
  const parts = [];
  if (bin.pinProblem) {
    parts.push(`the codexBin setting points at ${bin.pinProblem}, which is not a file`);
  }
  if (bin.shimOnPath) {
    parts.push(
      `the only codex on your PATH is ${bin.shimOnPath}, a batch shim Windows cannot start ` +
        'without a shell, and DeckHQ will not run one',
    );
  } else {
    parts.push('codex is not on your PATH');
  }
  if (bin.bundleDirs.length) {
    parts.push(`the app's bundled copy was looked for at ${bin.bundleDirs.join(' and ')}`);
  }
  return (
    `codex binary not found; ${parts.join(', and ')}. ` +
    'Install the CLI (npm i -g @openai/codex), or point the codexBin setting at the binary.'
  );
}
