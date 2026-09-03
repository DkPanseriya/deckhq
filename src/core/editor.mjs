/**
 * "open in editor": the five editors DeckHQ will launch, and nothing else.
 *
 * docs/plan/08-PLAN-V2-100X.md §8.1 ("in-panel diff"), WP-47.
 *
 * SAFETY — read before adding anything here, and read `core/actions.mjs`'s
 * header first, because this file follows the same discipline one step
 * further.
 *
 * The browser never sends a command. It sends a session id, a file and a line
 * number. The daemon decides which program that means, and the decision is a
 * lookup in the frozen table below — never a string from the client, never a
 * string from `state.json`, never `$EDITOR` taken at its word.
 *
 *   1. The editor must be one of `EDITORS`. A settings value outside that set
 *      is refused, not run. `$EDITOR` is consulted only to *choose between*
 *      members of the set; an `$EDITOR` of `rm` selects nothing.
 *   2. The program is resolved by scanning PATH ourselves and is spawned as an
 *      argv array. The file path is user data and always travels as its own
 *      argv element, so nothing in it is ever parsed as a command.
 *   3. The caller has already confined the file inside the session's
 *      repository (see `http/routes/diff.mjs`).
 *
 * WINDOWS. `code` on Windows is `code.cmd`. Node refuses to spawn a `.cmd`
 * without a shell (CVE-2024-27980, EINVAL), and `shell: true` with an args
 * array concatenates without escaping — Node deprecated exactly that as a
 * vulnerability (DEP0190). So a batch launcher goes through `cmd.exe /d /s /c`
 * with `windowsVerbatimArguments`, with the command line quoted by
 * `core/cmdline.mjs` rather than by Node. Two characters can escape a
 * double-quoted `cmd` argument — `"` itself and `%` (variable expansion
 * happens inside quotes) — and a path containing either is refused rather than
 * launched. `&`, `|`, `<`, `>` and `^` were each checked and are literal
 * inside the quotes. That quoting rule moved out of this file when the Windows
 * console launch needed the same one (`docs/DEVIATIONS.md` §96).
 */
import { constants as FS, accessSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

import { assertCmdSafe, cmdQuote } from './cmdline.mjs';

/**
 * @typedef {object} EditorSpec
 * @property {string} label      what the interface calls it
 * @property {(file: string, line: number) => string[]} args
 */

/**
 * The allowlist. `08` §9 WP-47 names `code`, `cursor`, `zed`, `idea` and
 * `$EDITOR`; `subl` is here because Sublime takes the same `file:line` form
 * and leaving it out would only push that user to a shell.
 * @type {Readonly<Record<string, EditorSpec>>}
 */
export const EDITORS = Object.freeze({
  code: { label: 'VS Code', args: (f, l) => ['-g', `${f}:${l}`] },
  cursor: { label: 'Cursor', args: (f, l) => ['-g', `${f}:${l}`] },
  zed: { label: 'Zed', args: (f, l) => [`${f}:${l}`] },
  idea: { label: 'IntelliJ IDEA', args: (f, l) => ['--line', String(l), f] },
  subl: { label: 'Sublime Text', args: (f, l) => [`${f}:${l}`] },
});

/** Allowlist order, which is also the order `editor: ''` searches PATH in. */
export const EDITOR_NAMES = Object.freeze(Object.keys(EDITORS));

/**
 * What the user is told when a path cannot be quoted for `cmd.exe`. The rule
 * itself, and why it refuses rather than escapes, is in `core/cmdline.mjs`.
 */
const CMD_REFUSAL =
  'That path contains a character Windows cannot pass to a .cmd launcher safely ' +
  '(a quote or a percent sign). Open it from the editor instead.';

/** @param {string} p @returns {boolean} */
function isExecutableFile(p) {
  try {
    if (!statSync(p).isFile()) return false;
  } catch {
    return false;
  }
  if (process.platform === 'win32') return true;
  try {
    accessSync(p, FS.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where a bare command name actually lives. Written out rather than shelled
 * out to, because `where`/`which` is one more program between us and a
 * decision that has to be exact.
 *
 * @param {string} name  a member of EDITOR_NAMES
 * @param {{env?: NodeJS.ProcessEnv, platform?: string, isFile?: (p:string)=>boolean}} [opts]
 * @returns {string|null} absolute path, or null when it is not on PATH
 */
export function findOnPath(name, opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const exists = opts.isFile || isExecutableFile;
  const sep = platform === 'win32' ? ';' : ':';
  const dirs = String(env.PATH || env.Path || '')
    .split(sep)
    .map((d) => d.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  const exts =
    platform === 'win32'
      ? String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean)
      : [''];
  // Join with the target platform's rules, not the host's: the resolver is
  // exercised for both from a single test run.
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * `$EDITOR` is a full command line on some machines (`code --wait`) and a
 * path on others (`/usr/bin/code`). Reduce it to a bare name so it can be
 * compared against the allowlist — and if what comes out is not on the
 * allowlist, it is simply not used.
 * @param {string|undefined} value
 * @returns {string|null}
 */
export function editorNameFromEnv(value) {
  const first = String(value || '')
    .trim()
    .split(/\s+/)[0]
    .replace(/^"|"$/g, '');
  if (!first) return null;
  const base = path
    .basename(first)
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|com)$/, '');
  return Object.prototype.hasOwnProperty.call(EDITORS, base) ? base : null;
}

/**
 * Which program `open in editor` means on this machine, right now.
 *
 * `preference` is the `editor` setting. Blank means "decide for me", and the
 * decision is `$EDITOR` when it names an allowlisted editor, else the first
 * allowlisted editor on PATH in `EDITOR_NAMES` order.
 *
 * Throws rather than falling back when the user named an editor: a silent
 * fallback would open the wrong program, which is worse than an error.
 *
 * @param {{preference?: string, env?: NodeJS.ProcessEnv, platform?: string,
 *          isFile?: (p:string)=>boolean}} [opts]
 * @returns {{name: string, label: string, command: string}}
 */
export function resolveEditor(opts = {}) {
  const env = opts.env || process.env;
  const find = (n) => findOnPath(n, opts);
  const preference = String(opts.preference || '').trim();

  if (preference) {
    if (!Object.prototype.hasOwnProperty.call(EDITORS, preference)) {
      throw new Error(
        `"${preference}" is not an editor DeckHQ will launch. Pick one of ${EDITOR_NAMES.join(', ')}.`,
      );
    }
    const command = find(preference);
    if (!command) throw new Error(`${preference} is not on PATH`);
    return { name: preference, label: EDITORS[preference].label, command };
  }

  const fromEnv = editorNameFromEnv(env.EDITOR ?? env.VISUAL);
  const order = fromEnv ? [fromEnv, ...EDITOR_NAMES.filter((n) => n !== fromEnv)] : EDITOR_NAMES;
  for (const name of order) {
    const command = find(name);
    if (command) return { name, label: EDITORS[name].label, command };
  }
  throw new Error(
    `No editor found on PATH. DeckHQ can open ${EDITOR_NAMES.join(', ')}; install one, ` +
      'or put it on PATH.',
  );
}

/**
 * The exact `[command, argv, options]` a launch would use. Separated from the
 * spawn so a test can assert the argv without starting a program.
 *
 * @param {{name: string, command: string}} editor
 * @param {string} file  absolute path, already confined by the caller
 * @param {number} line
 * @param {{platform?: string}} [opts]
 * @returns {[string, string[], object]}
 */
export function editorArgv(editor, file, line, opts = {}) {
  const platform = opts.platform || process.platform;
  const spec = EDITORS[editor.name];
  if (!spec) throw new Error(`"${editor.name}" is not an editor DeckHQ will launch.`);
  const args = spec.args(file, Math.max(1, Math.floor(Number(line) || 1)));

  const ext = (platform === 'win32' ? path.win32 : path.posix)
    .extname(editor.command)
    .toLowerCase();
  if (platform === 'win32' && (ext === '.cmd' || ext === '.bat')) {
    assertCmdSafe([editor.command, ...args], CMD_REFUSAL);
    // The doubled outer quotes are `cmd /s`'s documented rule: it strips the
    // first and last character of the string after /c, so the real command
    // line needs its own pair inside them.
    const line_ = `""${editor.command}" ${args.map((a) => cmdQuote(a, CMD_REFUSAL)).join(' ')}"`;
    return ['cmd.exe', ['/d', '/s', '/c', line_], { windowsVerbatimArguments: true }];
  }
  return [editor.command, args, {}];
}

/**
 * Open one file at one line, detached, and forget about it. Never waits: an
 * editor is a long-lived program and the HTTP request must not be.
 *
 * @param {{file: string, line?: number, preference?: string, cwd?: string,
 *          env?: NodeJS.ProcessEnv, platform?: string,
 *          isFile?: (p:string)=>boolean, spawnFn?: typeof spawn}} opts
 * @returns {{editor: string, label: string, command: string, argv: string[]}}
 */
export function openInEditor(opts) {
  const editor = resolveEditor(opts);
  const [command, args, extra] = editorArgv(editor, opts.file, opts.line ?? 1, opts);
  const spawnFn = opts.spawnFn || spawn;
  const child = spawnFn(command, args, {
    cwd: opts.cwd || undefined,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    ...extra,
  });
  child.on?.('error', () => {
    /* the editor died on its own time; the request already succeeded */
  });
  child.unref?.();
  return { editor: editor.name, label: editor.label, command, argv: args };
}
