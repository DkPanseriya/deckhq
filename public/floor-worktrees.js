/**
 * A WORKTREE IS NOT A PROJECT — who sits at a worktree's bench.
 *
 * The owner: _"Sometimes when I start work in a different worktree, it shows on
 * my GUI as a new room. Treat it as the same repository. You could add a table
 * in the corner or something, but do not make a new room for it. Rooms are only
 * for completely new projects, not new worktrees or new branches."_
 *
 * The daemon resolves every session to its repository (`src/core/repo-root.mjs`),
 * so `projectId` is already the repository's and the room is already one room.
 * What is left for the floor is the table in the corner: inside that room, the
 * sessions working in one LINKED worktree share one bench, named for it.
 *
 * THE RULE, and the whole of it:
 *
 *   - a session the user started, at a desk (working or stalled), whose
 *     `worktree` is set, sits at that worktree's bench;
 *   - a session in the main checkout keeps an ordinary desk;
 *   - a junior is placed as a junior always is — beside its parent or in its
 *     crew — whatever directory it runs in;
 *   - a worktree session with juniors at work keeps an ordinary desk, because
 *     that is where its helpers have floor to stand on;
 *   - a bench exists only while somebody is working at it. A worktree whose
 *     sessions are all waiting or resting has no bench: they are in the office
 *     and the lounge like anyone else, and their panel says which worktree.
 *
 * Like `floor-rule.js`, this is the rule and not the drawing: no canvas, no
 * DOM, no clock, and the same answer in the daemon's tests as in the browser.
 */

import { isDeskAgent, isSubagent } from './floor-rule.js';

/**
 * @typedef {object} WorktreeBench
 * @property {string} key    which worktree, stable across snapshots
 * @property {string} name   the worktree's directory name
 * @property {string} label  what is written on the bench: the branch when the
 *                           session reported one, else the directory name
 * @property {string[]} ids  who sits at it, in seat order
 */

/** The longest label a bench carries before it is cut with an ellipsis. */
export const WORKTREE_LABEL_MAX = 18;

/**
 * Which worktree an agent is in, as a key two sessions in the same one share.
 * @param {{worktree?: {name?: string, path?: string}|null}|null|undefined} agent
 * @returns {string} empty in the main checkout
 */
export function worktreeKey(agent) {
  const wt = agent && agent.worktree;
  if (!wt || typeof wt !== 'object') return '';
  const at = String(wt.path || wt.name || '')
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
  return at;
}

/**
 * A name short enough to write on a bench.
 * @param {string} text
 * @param {number} [max]
 */
export function clipLabel(text, max = WORKTREE_LABEL_MAX) {
  const s = String(text || '').trim();
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
}

/**
 * What a worktree is called: its branch if the session knows one, else its
 * directory name. Not clipped — the panel has room for the whole of it.
 * @param {{name?: string, path?: string, branch?: string|null}|null|undefined} wt
 * @returns {string}
 */
export function worktreeName(wt) {
  if (!wt || typeof wt !== 'object') return '';
  const branch = typeof wt.branch === 'string' ? wt.branch.trim() : '';
  if (branch && branch !== 'HEAD') return branch;
  return String(wt.name || '').trim();
}

/**
 * Where a session is, for a header: `repo`, or `repo · worktree-name` in a
 * linked worktree. The directory name rather than the branch, which the header
 * already says beside it.
 * @param {{projectName?: string, repoName?: string,
 *   worktree?: {name?: string}|null}|null|undefined} agent
 * @returns {string[]} the parts, in order, empty ones left out
 */
export function whereOf(agent) {
  if (!agent) return [];
  const repo = String(agent.repoName || agent.projectName || '').trim();
  const wt = agent.worktree && typeof agent.worktree === 'object' ? agent.worktree : null;
  return [repo, wt ? String(wt.name || '').trim() : ''].filter(Boolean);
}

/**
 * The benches of every room: one per worktree somebody is working in.
 *
 * @param {any[]} sitters top-level sessions AT A DESK whose `worktree` is set
 *   (`floorPopulation` picks them)
 * @param {Set<string>} leading ids of sessions with juniors at work
 * @returns {Map<string, WorktreeBench[]>} room id → its benches, in key order
 */
export function benchesFor(sitters, leading) {
  /** @type {Map<string, Map<string, any[]>>} */
  const byRoom = new Map();
  for (const a of Array.isArray(sitters) ? sitters : []) {
    const key = worktreeKey(a);
    if (!key || a.id == null || a.projectId == null) continue;
    if (leading && leading.has(String(a.id))) continue;
    const pid = String(a.projectId);
    const room = byRoom.get(pid) || new Map();
    room.set(key, [...(room.get(key) || []), a]);
    byRoom.set(pid, room);
  }
  /** @type {Map<string, WorktreeBench[]>} */
  const out = new Map();
  for (const [pid, room] of byRoom) {
    const benches = [...room.keys()].sort().map((key) => {
      const members = [...(room.get(key) || [])].sort((x, y) =>
        String(x.id).localeCompare(String(y.id)),
      );
      // The branch of whoever moved last, so a bench is not named for a branch
      // a session left an hour ago; by id where nobody can be dated.
      const newest = [...members].sort(
        (x, y) =>
          (Number(y.lastActivityAt) || 0) - (Number(x.lastActivityAt) || 0) ||
          String(x.id).localeCompare(String(y.id)),
      );
      const named = newest.find((m) => worktreeName(m.worktree)) || members[0];
      const name = String((members[0].worktree && members[0].worktree.name) || '');
      return {
        key,
        name,
        label: clipLabel(worktreeName(named.worktree) || name),
        ids: members.map((m) => String(m.id)),
      };
    });
    out.set(pid, benches);
  }
  return out;
}

/**
 * The benches of a whole floor, from its agents and the population counted
 * from them. `buildPlan` keeps the answer on the population as `benches`.
 * @param {any[]} agents
 * @param {{leading?: Set<string>}} pop a `floorPopulation` result
 * @returns {Map<string, WorktreeBench[]>}
 */
export function worktreeBenches(agents, pop) {
  const sitters = (Array.isArray(agents) ? agents : []).filter(
    (a) => a && !isSubagent(a) && isDeskAgent(a) && worktreeKey(a) !== '',
  );
  return benchesFor(sitters, (pop && pop.leading) || new Set());
}

/**
 * How many of a room's desk agents sit at a bench rather than at a desk.
 * @param {{benches?: Map<string, WorktreeBench[]>}|null|undefined} pop
 * @param {string} projectId
 */
export function benchSeatsIn(pop, projectId) {
  const list = pop && pop.benches ? pop.benches.get(String(projectId)) : null;
  return (list || []).reduce((n, b) => n + b.ids.length, 0);
}
