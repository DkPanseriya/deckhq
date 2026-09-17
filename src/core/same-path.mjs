/**
 * Whether two paths name one directory.
 *
 * DeckHQ finds the session it has just started by the directory it started it
 * in: a queued name waits for "the newest session in this `cwd`", a planner and
 * a hired role are recognised the same way, and a worktree is recognised by
 * asking git where its worktrees are. Every one of those used to be `===` on
 * two strings, and the two strings come from different mouths. Ours is spelt
 * however the user, the settings or the temp directory spelt it. The other is
 * the OS's or git's spelling, which is the REAL path.
 *
 * They differ wherever a directory has two names: a symlink (macOS's `/var` is
 * `/private/var`, so every temp directory there has two), a junction, or an 8.3
 * short name (a Windows `TEMP` of `C:\Users\RUNNER~1\…`). On those machines the
 * name was never applied, the role never matched, and a second Hire was refused
 * as `occupied` by the first.
 *
 * Nothing here knows what a session or a worktree is.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * A path as the filesystem spells it.
 *
 * The leaf need not exist — a worktree is looked up before it is made — so the
 * nearest ancestor that does exist is resolved and the rest is joined back on.
 * Never throws: a path nothing can resolve is returned as `path.resolve` has it.
 * @param {string} p
 * @returns {string}
 */
export function canonicalPath(p) {
  const resolved = path.resolve(String(p || ''));
  /** @type {string[]} */ const tail = [];
  let head = resolved;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(head), ...tail);
    } catch {
      const up = path.dirname(head);
      if (up === head) return resolved;
      tail.unshift(path.basename(head));
      head = up;
    }
  }
}

/**
 * Whether two paths name one directory. An empty path names nothing, so it is
 * never the same as anything — `path.resolve('')` is the working directory, and
 * a session with no `cwd` must not match a project that happens to be it.
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 */
export function samePath(a, b) {
  if (!a || !b) return false;
  const [x, y] = [canonicalPath(a), canonicalPath(b)];
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}
