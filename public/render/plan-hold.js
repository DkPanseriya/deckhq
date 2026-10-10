/**
 * A ROOM IS NOT REARRANGED THE MOMENT SOMEBODY STANDS UP.
 *
 * `buildPlan` furnishes a room for the people at its desks, and it is a pure
 * function: one person fewer is a smaller desk, a meeting table somewhere else
 * and a crew's floor given back, in the frame the snapshot arrives. On the
 * floor that read as a room re-laying itself around somebody who had only just
 * stood up, with the walker crossing a table that was not there a frame before.
 *
 * THE RULE. A room is furnished for the most people it has held in the last
 * `FURNISH_HOLD_MS`: it grows the moment it has to, gives furniture back only
 * after its headcount has stayed lower for that long, and does neither while
 * anybody is walking to it or from it.
 *
 * WHAT IS HELD is what the plan reads of a room's people and nothing else: how
 * many desks, the sizes of its crews, and its worktree benches. Who is in the
 * room, where anybody sits, whether its lights are on and what its plate says
 * are all still the snapshot's, to the frame.
 *
 * WHERE IT IS KEPT. In the page, on the scene, and nowhere else: a reload is a
 * floor furnished for who is on it now. Nothing here reads a clock — the
 * caller hands in the injected one (`public/clock.js`), so a pinned clock never
 * gives anything back and a stepped one does so on the same frame every time.
 *
 * Pure data and pure functions. No DOM, no canvas, no storage.
 */

import {
  CREW_THRESHOLD,
  agentIndex,
  floorPopulation,
  homeProjectOf,
  isDeskAgent,
  isSubagent,
  placement,
} from '../floor-rule.js';
import { benchSeatsIn, worktreeBenches } from '../floor-worktrees.js';

/** How long a room's headcount stays lower before it gives furniture back. */
export const FURNISH_HOLD_MS = 5 * 60_000;

/**
 * What one room is furnished for.
 * @typedef {{desks:number, crews:number[], benches:any[], loose:number}} Headcount
 *   `desks`: the agents at its desks, as `buildPlan` counts them; `crews`: its
 *   formations' sizes, largest first; `benches`: its worktree benches;
 *   `loose`: how many of `desks` are juniors on the floor beside a lead who is
 *   at a desk — counted so a table is sized for them, and needing no chair
 */

/**
 * What every live room on a snapshot is furnished for.
 * @param {any[]} agents
 * @param {{now?:number, goneHomeDays?:number}} [opts] as `floorPopulation`
 * @returns {Map<string, Headcount>} by project id; a repo nobody is active in
 *   has no entry, and so no hold
 */
export function roomHeadcounts(agents, opts = {}) {
  const list = Array.isArray(agents) ? agents : [];
  const pop = floorPopulation(list, opts);
  const benches = worktreeBenches(list, pop);
  const byId = agentIndex(list);
  /** @type {Map<string, number>} desk juniors per `<room> NUL <parent>` */
  const perParent = new Map();
  for (const a of list) {
    if (!a || !isSubagent(a) || a.parentId == null || !isDeskAgent(a, byId)) continue;
    const key = `${homeProjectOf(a, byId)}\u0000${String(a.parentId)}`;
    perParent.set(key, (perParent.get(key) || 0) + 1);
  }
  /** @type {Map<string, number>} */
  const loose = new Map();
  for (const [key, n] of perParent) {
    if (n >= CREW_THRESHOLD) continue;
    const cut = key.indexOf('\u0000');
    const parent = byId.get(key.slice(cut + 1));
    if (!parent || placement(parent, byId) !== 'desk') continue;
    loose.set(key.slice(0, cut), (loose.get(key.slice(0, cut)) || 0) + n);
  }
  /** @type {Map<string, Headcount>} */
  const out = new Map();
  for (const [pid, active] of pop.active) {
    if (!(active > 0)) continue;
    out.set(pid, {
      desks: Math.max(0, (pop.desks.get(pid) ?? 0) - benchSeatsIn({ benches }, pid)),
      crews: [...(pop.crews.get(pid) || [])],
      benches: benches.get(pid) || [],
      loose: loose.get(pid) || 0,
    });
  }
  return out;
}

const sum = (/** @type {number[]} */ xs) => xs.reduce((a, n) => a + n, 0);

/**
 * The benches of two headcounts as one list: every worktree either has a bench
 * for, as long as the longer of the two. The people are `now`'s; a place
 * nobody is at any more keeps a seat under a name no session has.
 * @param {any[]} held @param {any[]} now
 */
function widerBenches(held, now) {
  const byKey = new Map(now.map((b) => [b.key, b]));
  const keys = [...new Set([...held.map((b) => b.key), ...byKey.keys()])].sort();
  return keys.map((key) => {
    const was = held.find((b) => b.key === key);
    const is = byKey.get(key);
    if (!was || (is && is.ids.length >= was.ids.length)) return is;
    const ids = is ? [...is.ids] : [];
    while (ids.length < was.ids.length) ids.push(`held:${key}:${ids.length}`);
    return { ...was, ...(is || {}), ids };
  });
}

/**
 * The larger of two headcounts, piece by piece: what a room furnished for
 * `held` has to become to hold `now` as well.
 *
 * ONE PIECE IS NOT TAKEN AT ITS WORD. A crew that falls under three is no
 * longer a formation, and its juniors are counted as desks again so a fresh
 * room is given a table to sit round. A room that still has that crew's floor
 * has their place already, so they are not also a reason to lay a longer desk.
 * @param {Headcount} held @param {Headcount} now
 * @returns {Headcount}
 */
export function largerHeadcount(held, now) {
  const spare = Math.max(0, sum(held.crews) - sum(now.crews));
  const crews = Array.from({ length: Math.max(held.crews.length, now.crews.length) }, (_, i) =>
    Math.max(held.crews[i] ?? 0, now.crews[i] ?? 0),
  );
  return {
    desks: Math.max(held.desks, now.desks - Math.min(now.loose, spare)),
    crews,
    benches: widerBenches(held.benches, now.benches),
    loose: now.loose,
  };
}

/** One headcount as a string: two that furnish a room alike say the same. */
export function headcountKey(h) {
  const benches = h.benches.map((b) => `${b.key}*${b.ids.length}`).join(',');
  return `${h.desks}:${h.crews.join(',')}:${benches}`;
}
