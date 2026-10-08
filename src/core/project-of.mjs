/**
 * The project a session belongs to: its REPOSITORY, not its directory.
 *
 * `repo-root.mjs` answers "which repository is this directory in". This file
 * turns that answer into the fields a session carries, and it is the only
 * place that does, so the daemon's scan, the offline CLI and a test all group
 * the same sessions into the same room.
 *
 *   projectId / projectName   the room key and the name on its plate. They are
 *                             the repository's, and `repoId` / `repoName` are
 *                             the same two values under the name that says so.
 *   repoRoot                  the repository's working directory: where the
 *                             room's actions run and what its ledger key hashes.
 *   worktree                  `{ name, path, branch }` when the session is in a
 *                             LINKED worktree of that repository, else null.
 *
 * A session used to be a project of its own whenever its directory was. Two
 * things were written down under that old id and are still on disk: pins in
 * `state.json` and `projectKey` in every ledger record. Neither is rewritten.
 * `legacyId` and `legacyKey` are what a session's project WAS called, and
 * `aliasesOf` is the map from those to the repository, applied on read.
 */
import { projectIdFromCwd, projectNameFromCwd } from './model.mjs';
import { projectKeyFor } from './ledger-record.mjs';
import { repoRootFor } from './repo-root.mjs';

/**
 * @typedef {object} ProjectOf
 * @property {string} projectId
 * @property {string} projectName
 * @property {string} repoRoot
 * @property {{name: string, path: string}|null} worktree
 * @property {string} legacyId  `projectIdFromCwd(cwd)`: the id before this
 */

/**
 * @param {string} cwd
 * @param {{stateDir?: string, knownRoots?: string[]}} [opts]
 * @returns {ProjectOf}
 */
export function projectOf(cwd, opts = {}) {
  const repo = repoRootFor(cwd, opts);
  const root = repo.root || String(cwd || '');
  return {
    projectId: projectIdFromCwd(root),
    projectName: projectNameFromCwd(root),
    // A bare repository has no checkout; the session's own directory is the
    // only place there is to run anything.
    repoRoot: repo.bare ? String(cwd || '') : root,
    worktree: repo.worktree ? { name: repo.worktree.name, path: repo.worktree.path } : null,
    legacyId: projectIdFromCwd(cwd),
  };
}

/**
 * Every directory of one scan, resolved together.
 *
 * Together, because a Studio worktree that has been removed is recognised by
 * matching its directory name against the repositories the SAME scan found by
 * reading (`repo-root.mjs`, `studioWorktreeOf`). So the readable ones go first.
 *
 * @param {Iterable<string>} cwds
 * @param {{stateDir?: string}} [opts]
 * @returns {Map<string, ProjectOf>}
 */
export function resolveProjects(cwds, opts = {}) {
  /** @type {Map<string, ProjectOf>} */
  const out = new Map();
  /** @type {Map<string, string>} */
  const roots = new Map();
  /** @type {string[]} */
  const unplaced = [];
  for (const cwd of new Set(cwds)) {
    if (!cwd) continue;
    const p = projectOf(cwd, { stateDir: opts.stateDir });
    out.set(cwd, p);
    if (p.worktree || p.legacyId !== p.projectId) roots.set(p.projectId, p.repoRoot);
    else unplaced.push(cwd);
  }
  if (!opts.stateDir) return out;
  // A directory that is its own project may be a repository too. Sorted, so
  // which one wins a tie is a fact about the scan and not about its order.
  for (const cwd of unplaced) {
    const p = /** @type {ProjectOf} */ (out.get(cwd));
    if (!roots.has(p.projectId)) roots.set(p.projectId, p.repoRoot);
  }
  // Not Studio's own worktrees: one of them is never the repository of another.
  const hires = `${String(opts.stateDir)
    .replace(/[\\/]+/g, '/')
    .toLowerCase()}/worktrees/`;
  const knownRoots = [...roots.values()]
    .filter(
      (r) =>
        !r
          .replace(/[\\/]+/g, '/')
          .toLowerCase()
          .startsWith(hires),
    )
    .sort();
  for (const cwd of unplaced) {
    const again = projectOf(cwd, { stateDir: opts.stateDir, knownRoots });
    if (again.worktree) out.set(cwd, again);
  }
  return out;
}

/**
 * What the sessions' projects used to be called, mapped to their repository.
 *
 * `ids` is `old project id → repository id`, for `state.json`'s pins. `keys`
 * is `old ledger projectKey → the repository's`, for records already written.
 * Only sessions whose project actually changed appear in either.
 *
 * @param {Iterable<{cwd?: string, projectId?: string, repoRoot?: string}>} agents
 * @returns {{ids: Record<string, string>, keys: Record<string, string>}}
 */
export function aliasesOf(agents) {
  /** @type {Record<string, string>} */
  const ids = {};
  /** @type {Record<string, string>} */
  const keys = {};
  for (const a of agents) {
    if (!a || !a.cwd || !a.projectId || !a.repoRoot) continue;
    const legacy = projectIdFromCwd(a.cwd);
    if (legacy === a.projectId || Object.prototype.hasOwnProperty.call(ids, legacy)) continue;
    ids[legacy] = a.projectId;
    keys[projectKeyFor(a.cwd)] = projectKeyFor(a.repoRoot);
  }
  return { ids, keys };
}

/**
 * The old project ids that now mean this repository — the pins to honour, and
 * the pins to take back with it.
 * @param {Record<string, string>} ids `aliasesOf(...).ids`
 * @param {string} repoId
 * @returns {string[]}
 */
export function legacyIdsOf(ids, repoId) {
  return Object.keys(ids || {}).filter((old) => ids[old] === repoId);
}

/**
 * A per-project tally keyed by ledger `projectKey`, with every worktree's
 * figures added into its repository's.
 * @param {Record<string, {tokens?: number, cache?: number}>} tally
 * @param {Record<string, string>} keys `aliasesOf(...).keys`
 * @returns {Record<string, {tokens: number, cache: number}>}
 */
export function foldByRepo(tally, keys) {
  /** @type {Record<string, {tokens: number, cache: number}>} */
  const out = {};
  for (const [key, v] of Object.entries(tally || {})) {
    const to = (keys && keys[key]) || key;
    const cur = out[to] || { tokens: 0, cache: 0 };
    cur.tokens += Number(v && v.tokens) || 0;
    cur.cache += Number(v && v.cache) || 0;
    out[to] = cur;
  }
  return out;
}

/**
 * Ledger records as they should be READ: a record written under a worktree's
 * old key is counted under its repository's. A copy of each record that moves;
 * the file on disk is append-only and is never rewritten.
 * @param {any[]} records
 * @param {Record<string, string>} keys `aliasesOf(...).keys`
 * @returns {any[]}
 */
export function rekeyRecords(records, keys) {
  if (!keys || !Object.keys(keys).length) return records;
  return records.map((rec) =>
    rec && typeof rec.projectKey === 'string' && keys[rec.projectKey]
      ? { ...rec, projectKey: keys[rec.projectKey] }
      : rec,
  );
}
