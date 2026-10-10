/**
 * Which repository a working directory belongs to.
 *
 * A WORKTREE IS NOT A PROJECT. A project used to be the directory a session was
 * started in, so `git worktree add` — which is what Claude Code does for an
 * isolated agent, and what Studio does for every hire — put a new room on the
 * floor for what was one more checkout of a repository that already had one.
 * The room is the repository. This file is the one place that answers "which
 * repository is this directory in", and everything that keys on a project keys
 * on its answer.
 *
 * HOW A WORKTREE SAYS WHAT IT IS. Git writes it down in files, so nothing here
 * runs git:
 *
 *   main checkout     `<root>/.git` is a DIRECTORY. The root is the repository.
 *   linked worktree   `<wt>/.git` is a FILE: `gitdir: <repo>/.git/worktrees/<name>`.
 *                     That directory holds `commondir` (usually `../..`), which
 *                     names the repository's own `.git`; its parent is the root.
 *   submodule         `<sub>/.git` is a FILE too, but its gitdir sits under
 *                     `<outer>/.git/modules/`. It is its own repository, held
 *                     by the one that path names.
 *
 * A REPOSITORY INSIDE A REPOSITORY IS NOT A PROJECT EITHER, in exactly two
 * cases. The owner's floor had a room called `internal`: a private clone
 * mounted inside this checkout, which to him is part of this project.
 *
 *   submodule         as above. The outer repository is read off the gitdir,
 *                     and has to be there.
 *   mounted clone     `<dir>/.git` is a DIRECTORY, the nearest `.git` above
 *                     `<dir>` is another repository's, and that repository
 *                     NAMES `<dir>` by a literal line in its root `.gitignore`
 *                     or its `info/exclude`: `/internal/`, `internal`,
 *                     `/vendor/tools/`. The line is the directory's whole path
 *                     from the outer root. A pattern (`*`, `?`, `[`) names
 *                     nothing, because people keep a home directory in git
 *                     with `*` ignored and every project below it would
 *                     become one room. `repo-ignores.mjs` is that rule.
 *
 * Either way `root` is the OUTER repository, which is the room, and the nested
 * one stays visible as what it is: `worktree` is `{ name, path, kind }` with
 * the nested repository's own directory as `path` and `kind` `nested` or
 * `submodule` (a linked worktree's is `linked`), and `own` is its root. It is
 * followed outward — a clone in a submodule in a repository ends at the
 * repository, and so does a clone mounted in one of its linked worktrees — one
 * holder at a time, for no more steps than a walk up the tree is given. A clone
 * nobody names, and a submodule whose outer repository is not there, stay the
 * projects they were.
 *
 * WHAT IT DOES WHEN IT CANNOT READ. A `.git` nobody can read, a directory with
 * no repository above it and a directory that no longer exists all fall back to
 * what DeckHQ did before: the directory is its own project. Two layouts are
 * recognised from the PATH alone, because a worktree is usually removed when
 * its session ends and the session is still on the floor: Claude Code's
 * `<repo>/.claude/worktrees/<name>` and Studio's
 * `<state>/worktrees/<project>-<role>`. Without them every finished worktree
 * session would come back as a project of its own.
 *
 * An outer `.gitignore` that is missing, unreadable or bigger than
 * `MAX_IGNORE_FILE` names nothing, so the clone below it stays its own project.
 *
 * Reads files only, never throws, and remembers its answers: an answer is kept
 * for as long as the `.git` it was read from, and the ignore files of whatever
 * repository was asked about it, have not changed. A repository that appears
 * ABOVE one already answered for is noticed the next time that one's own `.git`
 * changes, not before.
 */
import fs from 'node:fs';
import path from 'node:path';
import { namedIn, witnessOf, witnessStill } from './repo-ignores.mjs';
import { samePath } from './same-path.mjs';

/**
 * @typedef {object} RepoInfo
 * @property {string} root  the ROOM's repository: its working directory. The
 *   outermost repository that holds the one the directory is in, and the
 *   directory that was asked about when no repository could be found for it.
 * @property {'main'|'worktree'|'submodule'|'nested'|'guess'|'none'} kind  how
 *   it was found: `nested` is a mounted clone its outer repository names,
 *   `submodule` one whether or not its outer repository could be found,
 *   `guess` the path heuristic and `none` the fallback.
 * @property {{name: string, path: string, kind: 'linked'|'nested'|'submodule'}|null} worktree
 *   the checkout the directory is in when that is not `root` itself: a LINKED
 *   worktree, or a repository NESTED in `root` (a mounted clone, a submodule).
 *   `path` is where anything that runs for the session runs. Null in the main
 *   checkout of a repository nothing holds.
 * @property {string} own  the repository the directory is in by git's own
 *   account. `root`, except inside a nested repository, where `root` is the
 *   outer one and this is the nested one's.
 * @property {boolean} bare  the worktree hangs off a bare repository, so
 *   `root` is a name to show rather than a checkout.
 */

/** A `.git` file is one line. Anything longer than this is not one. */
const MAX_GIT_FILE = 4096;

/** How far up a tree a walk goes before giving up. */
const MAX_DEPTH = 64;

/** Forward slashes, no trailing one. Case is left alone, and so is a UNC `//`. */
function slashed(/** @type {string} */ p) {
  const s = String(p || '');
  const unc = /^[\\/]{2}[^\\/]/.test(s) ? '/' : '';
  return unc + s.replace(/[\\/]+/g, '/').replace(/(.)\/+$/, '$1');
}

/** `root` with the separators `asked` was spelt with, so one repository reads one way. */
function respell(/** @type {string} */ root, /** @type {string} */ asked) {
  return asked.includes('\\') && !asked.includes('/') ? root.replace(/\//g, '\\') : root;
}

/** Is this spelt as an absolute path on EITHER platform? */
const isAbsolute = (/** @type {string} */ p) => /^([a-z]:)?[\\/]/i.test(p);

/** The parent, textually, so a path that does not exist still has one. */
function parentOf(/** @type {string} */ p) {
  const s = slashed(p);
  const i = s.lastIndexOf('/');
  if (i < 0) return '';
  if (i === 0) return s.length > 1 ? '/' : '';
  const up = s.slice(0, i);
  return /^[a-z]:$/i.test(up) ? (s.length > i + 1 ? up + '/' : '') : up;
}

const baseOf = (/** @type {string} */ p) => slashed(p).split('/').pop() || '';

/** Join a relative `gitdir`/`commondir` onto the directory it was written in. */
function resolveFrom(/** @type {string} */ base, /** @type {string} */ rel) {
  if (isAbsolute(rel)) return slashed(rel);
  const out = slashed(base).split('/');
  for (const part of slashed(rel).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length > 1) out.pop();
    } else out.push(part);
  }
  return out.join('/') || '/';
}

/**
 * The path a `.git` FILE points at, or null when it is not one.
 * @param {string} text the file's contents
 * @returns {string|null}
 */
export function parseGitFile(text) {
  const m = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(String(text || '').slice(0, MAX_GIT_FILE));
  return m && m[1] ? m[1] : null;
}

/**
 * A worktree recognised by where it is, with nothing read.
 *
 * `<repo>/.claude/worktrees/<name>` is how Claude Code lays out the worktrees
 * it makes; the LAST such marker in the path wins, so a directory that merely
 * has `.claude` somewhere above it is not mistaken for one.
 *
 * @param {string} cwd
 * @returns {{root: string, name: string, path: string}|null}
 */
export function claudeWorktreeOf(cwd) {
  const s = slashed(cwd);
  const m = /^(.+)\/\.claude\/worktrees\/([^/]+)(?:\/.*)?$/i.exec(s);
  if (!m) return null;
  return { root: m[1], name: m[2], path: `${m[1]}/.claude/worktrees/${m[2]}` };
}

/**
 * A Studio hire's worktree, `<state>/worktrees/<project>-<role>`, recognised by
 * where it is. The directory name does not say where `<project>` stops and
 * `<role>` starts — both may carry a dash — so it is matched against the
 * repositories already known: the one whose own directory name is the longest
 * prefix of it. None known, none claimed.
 *
 * @param {string} cwd
 * @param {string} stateDir DeckHQ's data directory
 * @param {string[]} knownRoots repositories found by reading, this scan
 * @returns {{root: string|null, name: string, path: string}|null}
 */
export function studioWorktreeOf(cwd, stateDir, knownRoots = []) {
  if (!stateDir) return null;
  const s = slashed(cwd);
  const base = `${slashed(stateDir)}/worktrees/`;
  if (s.length <= base.length || s.slice(0, base.length).toLowerCase() !== base.toLowerCase()) {
    return null;
  }
  const dir = s.slice(base.length).split('/')[0];
  if (!dir) return null;
  let best = '';
  let bestLen = 0;
  for (const root of knownRoots) {
    const slug = studioSlug(baseOf(root));
    if (slug.length > bestLen && dir.toLowerCase().startsWith(`${slug}-`)) {
      best = root;
      bestLen = slug.length;
    }
  }
  const name = best ? dir.slice(bestLen + 1) : dir;
  return { root: best || null, name, path: `${base}${dir}` };
}

/** `studio/worktree.mjs`'s `projectSlug`, restated: this file reads no Studio code. */
function studioSlug(/** @type {string} */ base) {
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 48) || 'project'
  );
}

/**
 * What a `.git` file's `gitdir` says about the directory it sits in.
 *
 * `git` is the directory its `info/exclude` is in: the repository's own git
 * directory, which a linked worktree shares with the main checkout.
 *
 * @param {string} dir the directory holding the `.git` file
 * @param {string} gitdir the path inside it, as written
 * @returns {{kind: 'worktree', root: string, bare: boolean, git: string}
 *   |{kind: 'submodule', outer: string, git: string}|{kind: 'main', git: string}}
 */
function readGitdir(dir, gitdir) {
  const target = resolveFrom(dir, gitdir);
  const linked = /^(.+)\/worktrees\/[^/]+$/.exec(target);
  // A submodule's git directory lives under `.git/modules/`, and so does the
  // git directory of a worktree OF a submodule. Neither is a worktree of the
  // repository above it; both are inside it, and the path says which it is.
  const held = submoduleOf(target);
  if (held) return { kind: 'submodule', outer: held, git: target };
  // `git init --separate-git-dir`: a main checkout whose `.git` lives elsewhere.
  if (!linked) return { kind: 'main', git: target };
  let common = linked[1];
  try {
    const text = fs.readFileSync(`${target}/commondir`, 'utf8').slice(0, MAX_GIT_FILE).trim();
    if (text) common = resolveFrom(target, text);
  } catch {
    // The repository moved or is gone. `commondir` is `../..` unless somebody
    // set it by hand, which is what the path already said.
  }
  const heldBy = submoduleOf(common);
  if (heldBy) return { kind: 'submodule', outer: heldBy, git: common };
  if (baseOf(common).toLowerCase() === '.git') {
    return { kind: 'worktree', root: parentOf(common), bare: false, git: common };
  }
  // A bare repository has no checkout to name. `project.git` is named for
  // itself; anything else (`project/.bare`) for the directory that holds it.
  const named = /^(.+)\.git$/i.exec(baseOf(common));
  return {
    kind: 'worktree',
    root: named ? `${parentOf(common)}/${named[1]}`.replace(/^\/\//, '/') : parentOf(common),
    bare: true,
    git: common,
  };
}

/**
 * The repository whose `.git/modules/` a git directory sits under — the one a
 * submodule is a submodule OF — or '' when it sits under none. The first such
 * marker in the path, so a submodule of a submodule names the outermost; and
 * `.git/worktrees/<name>/modules/` too, which is where a submodule checked out
 * in a linked worktree keeps its own.
 * @param {string} gitDir
 */
function submoduleOf(gitDir) {
  const m = /^(.+?)\/\.git\/(?:worktrees\/[^/]+\/)?modules\//i.exec(`${gitDir}/`);
  return m ? m[1] : '';
}

/**
 * The outermost repository that HOLDS a checkout, followed outward one holder
 * at a time (the header says which two things make one repository hold
 * another). `root` is '' when nothing holds it; `seen` is every file the
 * answer was read from, whichever way it came out.
 *
 * @param {string} dir the checkout: the directory whose `.git` is `p`
 * @param {{type: 'dir'|'file'|'unreadable', text?: string}|null} p
 * @returns {{root: string, seen: import('./repo-ignores.mjs').Witness[]}}
 */
function outward(dir, p) {
  /** @type {import('./repo-ignores.mjs').Witness[]} */
  const seen = [];
  let root = '';
  let at = slashed(dir);
  let git = p;
  for (let left = MAX_DEPTH; git && git.type !== 'unreadable' && left > 0; left--) {
    const gitdir = git.type === 'file' ? parseGitFile(git.text || '') : null;
    if (git.type === 'file' && !gitdir) break;
    const read = gitdir ? readGitdir(at, gitdir) : null;
    let next = '';
    let holder = null;
    if (read && read.kind === 'submodule') next = read.outer;
    else if (read && read.kind === 'worktree') {
      // A linked worktree of a repository: the repository is the room, and may
      // be held in turn. A bare one has no directory to be inside anything.
      if (read.bare) break;
      next = read.root;
    } else {
      // A main checkout. The nearest repository above it holds it only if it
      // names it; one further up never gets a say.
      next = parentOf(at);
      while (next && left > 0) {
        holder = probe(next);
        if (holder) break;
        next = parentOf(next);
        left--;
      }
      if (!holder || holder.type === 'unreadable') break;
      const its = holder.type === 'file' ? parseGitFile(holder.text || '') : null;
      if (holder.type === 'file' && !its) break;
      const gitDir = its ? readGitdir(next, its).git : `${next}/.git`;
      const rel = at.slice(next.length);
      const asked = namedIn([`${gitDir}/info/exclude`, `${next}/.gitignore`], rel);
      seen.push(witnessOf(`${next}/.git`), ...asked.seen);
      if (!asked.named) break;
    }
    if (!holder) {
      holder = next && next !== at ? probe(next) : null;
      if (!holder) break;
      seen.push(witnessOf(`${next}/.git`));
    }
    root = next;
    at = next;
    git = holder;
  }
  return { root, seen };
}

/**
 * One directory's `.git`: a directory, a file's contents, or nothing.
 * @param {string} dir
 * @returns {{type: 'dir'|'file'|'unreadable', mtimeMs: number, text?: string}|null}
 */
function probe(dir) {
  const at = `${dir}/.git`;
  let st;
  try {
    st = fs.statSync(at);
  } catch {
    return null;
  }
  if (st.isDirectory()) return { type: 'dir', mtimeMs: st.mtimeMs };
  if (!st.isFile()) return { type: 'unreadable', mtimeMs: st.mtimeMs };
  try {
    return { type: 'file', mtimeMs: st.mtimeMs, text: fs.readFileSync(at, 'utf8') };
  } catch {
    return { type: 'unreadable', mtimeMs: st.mtimeMs };
  }
}

/**
 * `cwd → {info, at, mtimeMs, type, seen}`: the answer, the `.git` it came from,
 * and the outer repositories' files that were read to place it.
 */
const cache = new Map();
const CACHE_MAX = 4096;

/** Forget every remembered answer. For tests, and for nothing else. */
export function clearRepoCache() {
  cache.clear();
}

/**
 * Are the `.git` an answer was read from, and the ignore files of whatever
 * holds it, still what they were?
 * @param {{at: string, mtimeMs: number, type: string,
 *   seen?: import('./repo-ignores.mjs').Witness[]}} entry
 */
function stillTrue(entry) {
  let st = null;
  try {
    st = fs.statSync(entry.at);
  } catch {
    /* gone, or never there */
  }
  if (entry.type === 'absent') {
    if (st !== null && st.mtimeMs !== entry.mtimeMs) return false;
  } else {
    if (!st) return false;
    const type = st.isDirectory() ? 'dir' : 'file';
    if (type !== entry.type || st.mtimeMs !== entry.mtimeMs) return false;
  }
  return (entry.seen || []).every(witnessStill);
}

/**
 * The repository a working directory belongs to.
 *
 * @param {string} cwd
 * @param {{stateDir?: string, knownRoots?: string[]}} [opts] `stateDir` is
 *   DeckHQ's data directory, and `knownRoots` the repositories already found,
 *   for a Studio worktree that has been removed (`studioWorktreeOf`).
 * @returns {RepoInfo}
 */
export function repoRootFor(cwd, opts = {}) {
  const asked = String(cwd || '');
  /** @type {RepoInfo} */
  const none = { root: asked, kind: 'none', worktree: null, own: asked, bare: false };
  if (!asked.trim()) return none;
  try {
    const key = `${asked}\u0000${opts.stateDir || ''}\u0000${(opts.knownRoots || []).length}`;
    const hit = cache.get(key);
    if (hit && stillTrue(hit)) return hit.info;
    const found = resolve(asked, opts);
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, found);
    return found.info;
  } catch {
    return none;
  }
}

/**
 * The walk itself: up from `cwd` to the nearest `.git`.
 * @param {string} asked
 * @param {{stateDir?: string, knownRoots?: string[]}} opts
 * @returns {{info: RepoInfo, at: string, mtimeMs: number, type: string}}
 */
function resolve(asked, opts) {
  const start = slashed(path.isAbsolute(asked) || isAbsolute(asked) ? asked : path.resolve(asked));
  const claude = claudeWorktreeOf(start);
  const studio = studioWorktreeOf(start, opts.stateDir || '', opts.knownRoots || []);
  /** The worktree directory a path heuristic names, if either does. */
  const marked = claude ? claude.path : studio ? studio.path : '';

  /**
   * @param {RepoInfo} info @param {string} at
   * @param {{type:string, mtimeMs:number}|null} p
   * @param {import('./repo-ignores.mjs').Witness[]} [seen]
   */
  const answer = (info, at, p, seen = []) => ({
    info,
    at: `${at}/.git`,
    mtimeMs: p ? p.mtimeMs : 0,
    type: p ? (p.type === 'dir' ? 'dir' : 'file') : 'absent',
    seen,
  });
  /**
   * @param {string} root @param {RepoInfo['kind']} kind @param {RepoInfo['worktree']} worktree
   * @param {{bare?: boolean, own?: string}} [more] `own` when it is not `root`
   * @returns {RepoInfo}
   */
  const info = (root, kind, worktree, more = {}) => ({
    root: respell(root, asked),
    kind,
    worktree: worktree && {
      name: worktree.name,
      path: respell(worktree.path, asked),
      kind: worktree.kind,
    },
    own: respell(more.own || root, asked),
    bare: more.bare === true,
  });
  /** `asked`, not `start`, at depth 0: a main checkout keeps the id it had. */
  const spelt = (/** @type {string} */ dir, /** @type {number} */ depth) =>
    depth === 0 ? asked.replace(/(.)[\\/]+$/, '$1') : dir;
  /**
   * A repository read where it stands: in its own room, or — when another
   * repository holds it — at a bench of its own in that one's.
   * @param {string} own its root, as it is to be spelt
   * @param {'main'|'submodule'} kind @param {string} dir
   * @param {NonNullable<ReturnType<typeof probe>>} p
   */
  const placed = (own, kind, dir, p) => {
    const out = outward(dir, p);
    if (!out.root) return answer(info(own, kind, null), dir, p, out.seen);
    /** @type {'nested'|'submodule'} */
    const how = kind === 'submodule' ? 'submodule' : 'nested';
    const bench = { name: baseOf(dir), path: own, kind: how };
    return answer(info(out.root, how, bench, { own }), dir, p, out.seen);
  };

  let dir = start;
  for (let depth = 0; dir && depth < MAX_DEPTH; depth++, dir = parentOf(dir)) {
    const p = probe(dir);
    if (!p) continue;
    // Below a worktree that is gone, the first `.git` up the tree belongs to
    // whatever holds it — the repository itself for Claude Code's layout, an
    // unrelated one for Studio's. The path is the better witness in both.
    const above = marked && !within(dir, marked);
    if (above) break;
    if (p.type === 'dir') return placed(spelt(dir, depth), 'main', dir, p);
    const gitdir = p.type === 'file' ? parseGitFile(p.text || '') : null;
    if (!gitdir) return answer(info(asked, 'none', null), dir, p);
    const read = readGitdir(dir, gitdir);
    if (read.kind === 'worktree') {
      /** @type {RepoInfo['worktree']} */
      const wt = { name: baseOf(dir), path: dir, kind: 'linked' };
      // The repository it is a worktree of may be held by another in turn.
      const out = read.bare ? { root: '', seen: [] } : outward(read.root, probe(read.root));
      const more = { bare: read.bare, own: read.root };
      return answer(info(out.root || read.root, 'worktree', wt, more), dir, p, out.seen);
    }
    return placed(spelt(dir, depth), read.kind, dir, p);
  }

  if (claude) {
    // The repository may itself be a worktree's checkout, or held by another;
    // ask once more, and keep what that answer was read from.
    const up = resolve(claude.root, opts);
    const known = up.info.kind !== 'none';
    /** @type {RepoInfo['worktree']} */
    const wt = { name: claude.name, path: claude.path, kind: 'linked' };
    const more = { own: known ? up.info.own : claude.root };
    const seen = [...up.seen, witnessOf(up.at)];
    return answer(info(known ? up.info.root : claude.root, 'guess', wt, more), start, null, seen);
  }
  if (studio && studio.root) {
    /** @type {RepoInfo['worktree']} */
    const wt = { name: studio.name, path: studio.path, kind: 'linked' };
    return answer(info(studio.root, 'guess', wt), start, null);
  }
  return answer(info(asked, 'none', null), start, null);
}

/** Is `dir` the directory `inside`, or below it? Spelling-insensitive. */
function within(/** @type {string} */ dir, /** @type {string} */ inside) {
  const [a, b] = [slashed(dir).toLowerCase(), slashed(inside).toLowerCase()];
  return a === b || a.startsWith(`${b}/`) || samePath(dir, inside);
}
