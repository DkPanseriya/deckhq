/**
 * WHERE `git` IS, AS A PATH, BEFORE IT IS STARTED.
 *
 * DeckHQ runs `git` in a session's own project folder: opening the review card
 * asks it what changed, before anybody clicks anything. On Windows a bare name
 * is looked for in that folder before `PATH` (`CreateProcess`, and libuv after
 * it), so a `git.exe` committed to a repository somebody cloned would run in
 * place of git. The same rule as `claudeBin()`: on Windows `git` is found on
 * `PATH`, in absolute folders only, and started by that path; where `PATH` has
 * none, nothing is started. Elsewhere the search is `PATH` only, and the bare
 * name is safe.
 */

import { findOnPath } from './editor.mjs';

/** What `execFile()` can start on Windows without a shell. */
const SPAWNABLE = Object.freeze(['.exe', '.com']);

/** The message for a machine where git cannot be found. */
export const GIT_NOT_FOUND = 'git was not found on PATH.';

/**
 * @param {{env?: NodeJS.ProcessEnv, platform?: string, isFile?: (p:string)=>boolean}} [opts]
 * @returns {string|null} the program to start, or null when Windows' PATH has no git
 */
export function gitBin(opts = {}) {
  const platform = opts.platform || process.platform;
  if (platform !== 'win32') return 'git';
  return findOnPath('git', { ...opts, platform, exts: SPAWNABLE });
}
