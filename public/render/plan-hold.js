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

/**
 * THE HOLD: what each room is furnished for, remembered between snapshots.
 *
 * One per scene. `update` is handed what every room holds now and answers with
 * what each is to be furnished for; nothing else is ever asked of it.
 */
export class FurnishingHold {
  /** @param {number} [ms] how long a lower headcount is held for */
  constructor(ms = FURNISH_HOLD_MS) {
    this._ms = ms;
    /** @type {Map<string, {held:Headcount, lowSince:number|null, peak:Headcount|null}>} */
    this._rooms = new Map();
    /** @type {Map<string, Headcount>} the rooms furnished for more than they hold */
    this._inForce = new Map();
    /** Whether a room is waiting for somebody to finish walking. */
    this.waiting = false;
    /** When the next room gives furniture back, ms epoch; `Infinity` for never. */
    this.dueAt = Infinity;
  }

  /**
   * Take a snapshot's headcounts, and say what each room is furnished for.
   * @param {Map<string, Headcount>} actual `roomHeadcounts` of the snapshot
   * @param {number} now the injected clock, ms epoch
   * @param {Set<string>} [busy] rooms somebody is walking to or from: they
   *   neither grow nor give anything back on this call
   * @returns {Map<string, Headcount>} only the rooms furnished for something
   *   other than what they hold now; empty on a floor nothing is held on
   */
  update(actual, now, busy) {
    this.waiting = false;
    this.dueAt = Infinity;
    this._inForce = new Map();
    for (const pid of [...this._rooms.keys()]) if (!actual.has(pid)) this._rooms.delete(pid);
    for (const [pid, a] of actual) {
      const st = this._rooms.get(pid);
      if (!st) {
        this._rooms.set(pid, { held: a, lowSince: null, peak: null });
        continue;
      }
      const frozen = !!busy && busy.has(pid);
      // Growing is at once, unless somebody is on their way in or out.
      const up = largerHeadcount(st.held, a);
      if (headcountKey(up) === headcountKey(st.held) || !frozen) st.held = up;
      else this.waiting = true;
      if (headcountKey(st.held) === headcountKey(a)) {
        Object.assign(st, { held: a, lowSince: null, peak: null });
        continue;
      }
      // Lower than it is furnished for: the clock runs from the first such
      // snapshot, and what it shrinks to is the most it held while it ran.
      st.peak = st.lowSince === null || !st.peak ? a : largerHeadcount(st.peak, a);
      if (st.lowSince === null) st.lowSince = now;
      if (now - st.lowSince >= this._ms) {
        if (frozen) this.waiting = true;
        else {
          const lower = headcountKey(st.peak) !== headcountKey(a);
          Object.assign(st, {
            held: st.peak,
            lowSince: lower ? now : null,
            peak: lower ? a : null,
          });
        }
      }
      if (headcountKey(st.held) === headcountKey(a)) continue;
      this._inForce.set(pid, st.held);
      if (st.lowSince !== null) this.dueAt = Math.min(this.dueAt, st.lowSince + this._ms);
    }
    return this._inForce;
  }

  /** The rooms a hold is in force in, as one string for the plan's signature. */
  key() {
    return [...this._inForce]
      .map(([pid, h]) => `${pid}=${headcountKey(h)}`)
      .sort()
      .join('|');
  }
}

/**
 * ARE THESE TWO PLANS THE SAME BUILDING? The same envelope, the same rooms in
 * the same rectangles and the same doors — which is what a held floor is after
 * a snapshot that only moved somebody. The walkable lines are a function of
 * exactly those, so a path laid on one is a path on the other, and somebody
 * mid-walk can carry on instead of being stood at their seat (`AgentRuntime`).
 * @param {any} a @param {any} b
 */
export function sameBuilding(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return false;
  const rooms = (/** @type {any} */ p) =>
    (p.rooms || []).map((r) => `${r.id}:${r.kind}:${r.x}:${r.y}:${r.w}:${r.h}`).join('|');
  const doors = (/** @type {any} */ p) => (p.doors || []).map((d) => `${d.x}:${d.y}`).join('|');
  return rooms(a) === rooms(b) && doors(a) === doors(b);
}

/** One headcount as a string: two that furnish a room alike say the same. */
export function headcountKey(h) {
  const benches = h.benches.map((b) => `${b.key}*${b.ids.length}`).join(',');
  return `${h.desks}:${h.crews.join(',')}:${benches}`;
}
