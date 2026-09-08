/**
 * Where Studio's artefacts live, and the one function that decides whether a
 * path is allowed to be written — WP-66.
 *
 * `docs/07-STUDIO-DESIGN.md` §3. Everything Studio writes is under
 * `<project>/.deckhq/studio/`, which is **outside the state directory**, so
 * every byte of it is consented to once per project and confined for ever
 * after. This module is the confinement.
 *
 * THE RULE, and why it is a refusal rather than a clamp. `runAction()` already
 * refuses a project script that resolves outside its own repository
 * (`src/core/actions.mjs`) rather than clamping it back inside, because a
 * clamp turns "this path is wrong" into "this path is now a different path"
 * and writes somewhere nobody asked for. Studio does the same thing for the
 * same reason, and names the offending path when it does.
 *
 * Three shapes are refused, and each has a test:
 *
 *   `..`          `handovers/../../../evil.md` resolves outside the directory.
 *   absolute      `/etc/passwd`, `C:\Windows\x`, `\\server\share\x` — a path
 *                 that ignores the root entirely.
 *   symlink       `handovers` replaced by a link to somewhere else. Resolving
 *                 the string alone would pass this one, so the deepest
 *                 EXISTING ancestor is resolved through `realpath` and the
 *                 containment check is made again against the real root.
 *
 * Nothing here writes anything, opens a socket or starts a process.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The directory, relative to a project root, that holds all of it. */
export const STUDIO_REL = path.join('.deckhq', 'studio');

/**
 * The files Studio knows by name. Every one is a file the user may edit, and
 * every one is listed on the consent screen before any of them is written.
 */
export const FILES = /** @type {const} */ ({
  blueprint: 'blueprint.md',
  roster: 'roster.json',
  board: 'board.json',
  rules: 'rules.md',
  readme: 'README.md',
});

/** The two directories, for the same reason. */
export const DIRS = /** @type {const} */ ({
  briefs: 'briefs',
  handovers: 'handovers',
});

/**
 * Raised when a path Studio was asked to touch is not inside the consented
 * directory. Carries the path it refused, so the caller can put it in the
 * message rather than saying "somewhere".
 */
export class StudioPathError extends Error {
  /**
   * @param {string} message
   * @param {string} offending the path as it was given
   * @param {string} [resolved] what it resolved to, when that is known
   */
  constructor(message, offending, resolved) {
    super(message);
    this.name = 'StudioPathError';
    this.offending = offending;
    this.resolved = resolved || '';
  }
}

/**
 * `<project>/.deckhq/studio`, absolute.
 * @param {string} projectRoot
 * @returns {string}
 */
export function studioDirFor(projectRoot) {
  return path.join(path.resolve(String(projectRoot || '')), STUDIO_REL);
}

/**
 * Is `target` inside `base`, or `base` itself?
 *
 * `path.relative` rather than a prefix comparison, for the reason
 * `serveStatic` gives: on Windows, drive letters and case-insensitivity make
 * a string prefix untrustworthy. The first segment is compared exactly, so a
 * sibling directory called `..sneaky` is not mistaken for an escape.
 *
 * @param {string} base
 * @param {string} target
 * @returns {boolean}
 */
export function isInside(base, target) {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false;
  return rel.split(/[\\/]/)[0] !== '..';
}

/**
 * The deepest ancestor of `target` that exists, resolved through `realpath`,
 * with the part that does not exist yet joined back on.
 *
 * A path Studio is about to CREATE has no realpath of its own, so resolving
 * the whole thing would throw on every first write. What matters is the part
 * that already exists: a symlink can only be one of those.
 *
 * @param {string} target absolute
 * @returns {string}
 */
export function realpathDeepest(target) {
  let dir = path.resolve(target);
  /** @type {string[]} */
  const rest = [];
  for (let depth = 0; depth < 64; depth++) {
    try {
      return rest.length ? path.join(fs.realpathSync(dir), ...rest) : fs.realpathSync(dir);
    } catch {
      const parent = path.dirname(dir);
      // The filesystem root does not exist either, on a machine where the
      // whole tree is gone. Nothing left to resolve; answer with the string.
      if (parent === dir) return path.resolve(target);
      rest.unshift(path.basename(dir));
      dir = parent;
    }
  }
  return path.resolve(target);
}

/**
 * Resolve one relative path inside the studio directory, or refuse it.
 *
 * @param {string} root the studio directory, absolute
 * @param {string} relative a path relative to it — `board.json`, `briefs/api.md`
 * @returns {string} the absolute path, which is inside `root`
 * @throws {StudioPathError} when it is not
 */
export function resolveInside(root, relative) {
  const base = path.resolve(String(root || ''));
  const raw = String(relative ?? '');

  if (!raw.trim()) {
    throw new StudioPathError('Studio was asked for an empty path', raw);
  }
  if (raw.includes('\0')) {
    throw new StudioPathError('Studio will not open a path containing a NUL byte', raw);
  }
  if (path.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) {
    throw new StudioPathError(
      `Studio writes only inside ${base}, and "${raw}" is an absolute path. Refused.`,
      raw,
    );
  }

  const target = path.resolve(base, raw);
  if (!isInside(base, target)) {
    throw new StudioPathError(
      `Studio writes only inside ${base}, and "${raw}" resolves to ${target}, which is outside it. Refused.`,
      raw,
      target,
    );
  }

  // And again through the filesystem, because the two checks answer different
  // questions: the one above is about the string, this one is about the disk.
  const realBase = realpathDeepest(base);
  const realTarget = realpathDeepest(target);
  if (!isInside(realBase, realTarget)) {
    throw new StudioPathError(
      `Studio writes only inside ${base}, and "${raw}" leads through a link to ${realTarget}, ` +
        'which is outside it. Refused.',
      raw,
      realTarget,
    );
  }

  return target;
}
