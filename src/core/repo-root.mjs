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
 *                     `.git/modules/`. A submodule is its own repository.
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
 * Reads files only, never throws, and remembers its answers: an answer is kept
 * for as long as the `.git` it was read from has not changed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { samePath } from './same-path.mjs';

/**
 * @typedef {object} RepoInfo
 * @property {string} root  the repository's working directory. The directory
 *   that was asked about when no repository could be found for it.
 * @property {'main'|'worktree'|'submodule'|'guess'|'none'} kind  how it was
 *   found: `guess` is the path heuristic, `none` is the fallback.
 * @property {{name: string, path: string}|null} worktree  set when the
 *   directory is inside a LINKED worktree of `root`; null in the main checkout.
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
 * @param {string} dir the directory holding the `.git` file
 * @param {string} gitdir the path inside it, as written
 * @returns {{kind: 'worktree', root: string, bare: boolean}|{kind: 'submodule'|'main'}}
 */
function readGitdir(dir, gitdir) {
  const target = resolveFrom(dir, gitdir);
  const linked = /^(.+)\/worktrees\/[^/]+$/.exec(target);
  // A submodule's git directory lives under `.git/modules/`, and so does the
  // git directory of a worktree OF a submodule. Neither is a worktree of the
  // repository above it.
  if (/\/\.git\/modules\//i.test(`${target}/`)) return { kind: 'submodule' };
  // `git init --separate-git-dir`: a main checkout whose `.git` lives elsewhere.
  if (!linked) return { kind: 'main' };
  let common = linked[1];
  try {
    const text = fs.readFileSync(`${target}/commondir`, 'utf8').slice(0, MAX_GIT_FILE).trim();
    if (text) common = resolveFrom(target, text);
  } catch {
    // The repository moved or is gone. `commondir` is `../..` unless somebody
    // set it by hand, which is what the path already said.
  }
  if (/\/\.git\/modules\//i.test(`${common}/`)) return { kind: 'submodule' };
  if (baseOf(common).toLowerCase() === '.git') {
    return { kind: 'worktree', root: parentOf(common), bare: false };
  }
  // A bare repository has no checkout to name. `project.git` is named for
  // itself; anything else (`project/.bare`) for the directory that holds it.
  const named = /^(.+)\.git$/i.exec(baseOf(common));
  return {
    kind: 'worktree',
    root: named ? `${parentOf(common)}/${named[1]}`.replace(/^\/\//, '/') : parentOf(common),
    bare: true,
  };
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

/** `cwd → {info, at, mtimeMs, type}`: the answer and the `.git` it came from. */
const cache = new Map();
const CACHE_MAX = 4096;

/** Forget every remembered answer. For tests, and for nothing else. */
export function clearRepoCache() {
  cache.clear();
}

/** Is the `.git` an answer was read from still what it was? */
function stillTrue(/** @type {{at: string, mtimeMs: number, type: string}} */ entry) {
  let st = null;
  try {
    st = fs.statSync(entry.at);
  } catch {
    /* gone, or never there */
  }
  if (entry.type === 'absent') return st === null || st.mtimeMs === entry.mtimeMs;
  if (!st) return false;
  const type = st.isDirectory() ? 'dir' : 'file';
  return type === entry.type && st.mtimeMs === entry.mtimeMs;
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
  const none = { root: asked, kind: 'none', worktree: null, bare: false };
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

  /** @param {RepoInfo} info @param {string} at @param {{type:string, mtimeMs:number}|null} p */
  const answer = (info, at, p) => ({
    info,
    at: `${at}/.git`,
    mtimeMs: p ? p.mtimeMs : 0,
    type: p ? (p.type === 'dir' ? 'dir' : 'file') : 'absent',
  });
  /** @param {string} root @param {RepoInfo['kind']} kind @param {RepoInfo['worktree']} worktree */
  const info = (root, kind, worktree, bare = false) => ({
    root: respell(root, asked),
    kind,
    worktree: worktree && { name: worktree.name, path: respell(worktree.path, asked) },
    bare,
  });
  /** `asked`, not `start`, at depth 0: a main checkout keeps the id it had. */
  const spelt = (/** @type {string} */ dir, /** @type {number} */ depth) =>
    depth === 0 ? asked.replace(/(.)[\\/]+$/, '$1') : dir;

  let dir = start;
  for (let depth = 0; dir && depth < MAX_DEPTH; depth++, dir = parentOf(dir)) {
    const p = probe(dir);
    if (!p) continue;
    // Below a worktree that is gone, the first `.git` up the tree belongs to
    // whatever holds it — the repository itself for Claude Code's layout, an
    // unrelated one for Studio's. The path is the better witness in both.
    const above = marked && !within(dir, marked);
    if (above) break;
    if (p.type === 'dir') return answer(info(spelt(dir, depth), 'main', null), dir, p);
    const gitdir = p.type === 'file' ? parseGitFile(p.text || '') : null;
    if (!gitdir) return answer(info(asked, 'none', null), dir, p);
    const read = readGitdir(dir, gitdir);
    if (read.kind === 'worktree') {
      const wt = { name: baseOf(dir), path: dir };
      return answer(info(read.root, 'worktree', wt, read.bare), dir, p);
    }
    return answer(info(spelt(dir, depth), read.kind, null), dir, p);
  }

  if (claude) {
    // The repository may itself be a worktree's checkout; ask once more.
    const up = repoRootFor(claude.root, opts);
    const wt = { name: claude.name, path: claude.path };
    return answer(info(up.kind === 'none' ? claude.root : up.root, 'guess', wt), start, null);
  }
  if (studio && studio.root) {
    const wt = { name: studio.name, path: studio.path };
    return answer(info(studio.root, 'guess', wt), start, null);
  }
  return answer(info(asked, 'none', null), start, null);
}

/** Is `dir` the directory `inside`, or below it? Spelling-insensitive. */
function within(/** @type {string} */ dir, /** @type {string} */ inside) {
  const [a, b] = [slashed(dir).toLowerCase(), slashed(inside).toLowerCase()];
  return a === b || a.startsWith(`${b}/`) || samePath(dir, inside);
}
