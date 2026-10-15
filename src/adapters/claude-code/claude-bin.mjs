/**
 * WHERE `claude` IS, AS A PATH, BEFORE IT IS STARTED.
 *
 * A command started by bare name is looked for in the working folder first on
 * Windows (`CreateProcess`, and libuv after it), and a reply from the panel
 * starts `claude` in the session's own project folder. A `claude.exe`
 * committed to a repository would have run in place of Claude Code (security
 * review, 15 October 2026). So `claude` is found on `PATH` here, in absolute
 * folders only, and started by that path; where `PATH` has none, nothing is
 * started, because the only other place a bare name could be found is the
 * folder that must not supply it.
 *
 * Only the extensions `spawn()` can start without a shell are tried on
 * Windows: a `claude.cmd` shim was never startable this way, and still is not.
 */

import { findOnPath } from '../../core/editor.mjs';

/** What `spawn()` can start on Windows without a shell. */
const SPAWNABLE = Object.freeze(['.exe', '.com']);

/**
 * @param {{env?: NodeJS.ProcessEnv, platform?: string, isFile?: (p:string)=>boolean}} [opts]
 * @returns {string|null} the absolute path of `claude`, or null when PATH has none
 */
export function claudeBin(opts = {}) {
  return findOnPath('claude', { ...opts, exts: SPAWNABLE });
}
