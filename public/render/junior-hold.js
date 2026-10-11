/**
 * A JUNIOR THAT HAS FINISHED STAYS WHERE IT SAT FOR A MOMENT, AND IS THEN GONE.
 *
 * A junior is hired and fired at its place (`floor-rule.js`, `placement`): it
 * never rests in the Lounge and never walks to it. Fired with nothing in
 * between, it would be working in one frame and folding away in the next, and
 * the eye could not tell a junior that finished from one that was never there.
 *
 * THE RULE. A junior that was at its place and has finished — its state is
 * `done`, or it has left the snapshot — keeps that place for
 * `JUNIOR_DONE_HOLD_MS`, powered down, its laptop shut and its cable grey. Its
 * formation does not close up round it while it does. Then it gets no seat, and
 * the runtime folds it away where it sat (`AgentRuntime#sync`, `despawn`). One
 * that starts work again inside the hold was never fired: it carries on.
 *
 * WHERE IT IS KEPT. In the page, on the scene, and nowhere else, like the
 * furnishing hold (`plan-hold.js`) and the open panel: a reload is a floor with
 * no finished junior on it. Nothing here reads a clock; the caller hands in the
 * injected one, so a stepped clock ends a hold on the same frame every time.
 *
 * Pure data and pure functions. No DOM, no canvas, no storage.
 */

import { agentIndex, isSubagent, placement } from '../floor-rule.js';
import { assignSeats } from './agents-seats.js';

/**
 * How long a finished junior stays at its place before it is fired, in ms.
 *
 * Four seconds: long enough that the grey cable is seen and read as "that one
 * is done" on a floor of several crews, and long enough to cover a junior whose
 * turn ended only to start again — which it does between most of its tool
 * calls, and which must not blink it off the floor and back. Short enough that
 * a finished crew is not still sitting round a desk when its lead has moved on.
 */
export const JUNIOR_DONE_HOLD_MS = 4000;

/**
 * THE HOLD: which finished juniors still have their place, remembered between
 * snapshots. One per scene.
 */
export class JuniorHold {
  /** @param {number} [ms] how long a finished junior keeps its place */
  constructor(ms = JUNIOR_DONE_HOLD_MS) {
    this._ms = ms;
    /** @type {Map<string, {since:number, agent:any}>} */
    this._held = new Map();
    /** When the next held junior is fired, ms epoch; `Infinity` for never. */
    this.dueAt = Infinity;
  }

  /**
   * Take a snapshot, and say which finished juniors keep their place in it.
   * @param {Iterable<any>} records the runtime's records, before this snapshot
   *   is synced: where everybody was a moment ago
   * @param {any[]} agents the snapshot
   * @param {number} now the injected clock, ms epoch
   * @returns {Map<string, any>} the held juniors by id, each as the agent the
   *   floor draws for it: the snapshot's own, or — for one that has left the
   *   snapshot — the last one seen, ended
   */
  update(records, agents, now) {
    const byId = agentIndex(agents);
    /** @type {Map<string, any>} */
    const here = new Map();
    for (const rec of records) {
      here.set(String(rec.id), rec);
      if (this._held.has(String(rec.id)) || !startsHold(rec, byId)) continue;
      const last = byId.get(String(rec.id)) || rec.agent;
      this._held.set(String(rec.id), {
        since: now,
        agent: { ...last, activityState: 'ended', currentTool: null },
      });
    }
    /** @type {Map<string, any>} */
    const out = new Map();
    this.dueAt = Infinity;
    for (const [id, h] of this._held) {
      const a = byId.get(id);
      // Back at work, or its own hand up: it was never fired. And once its
      // record has folded away there is nothing left to hold.
      if ((a && placement(a, byId) !== 'done') || !here.has(id)) {
        this._held.delete(id);
        continue;
      }
      if (now - h.since >= this._ms) continue;
      out.set(id, a || h.agent);
      this.dueAt = Math.min(this.dueAt, h.since + this._ms);
    }
    return out;
  }
}

/**
 * Does this record's junior start a hold on this snapshot: at its place a
 * moment ago, and finished now?
 * @param {any} rec @param {Map<string, any>} byId the snapshot's agents
 */
function startsHold(rec, byId) {
  if (!rec.initialised || typeof rec.leftAt === 'number') return false;
  if (rec.placement !== 'desk' || !rec.agent || !isSubagent(rec.agent)) return false;
  const a = byId.get(String(rec.id));
  return !a || placement(a, byId) === 'done';
}

/**
 * SEAT A SNAPSHOT AND SYNC THE RUNTIME TO IT — the one way the floor does it,
 * so the hold cannot be forgotten by one caller and kept by another.
 *
 * In order: the hold is asked who keeps their place, the seating pass seats
 * them with their formations (`assignSeats`, `held`), and the runtime is synced
 * against the snapshot plus whoever is held but no longer on it — a record
 * whose agent is not in the list is one that has left, and it folds away.
 *
 * @param {{all:() => Iterable<any>, sync:Function}} runtime the `AgentRuntime`
 * @param {JuniorHold} hold
 * @param {any} plan @param {any[]} agents the snapshot
 * @param {{now:number, steady?:boolean, selectedId?:string|null,
 *   keep?:Map<string, any>|null}} opts `now`: the injected clock; the rest as
 *   `AgentRuntime#sync` and `assignSeats` take them
 * @returns {Map<string, any>} everybody's seat
 */
export function syncFloor(runtime, hold, plan, agents, opts) {
  const held = hold.update(runtime.all(), agents, opts.now);
  const seatMap = assignSeats(plan, agents, {
    selectedId: opts.selectedId,
    keep: opts.keep,
    held,
  });
  let present = agents;
  if (held.size) {
    const byId = agentIndex(agents);
    present = [...agents, ...[...held].filter(([id]) => !byId.has(id)).map(([, a]) => a)];
  }
  runtime.sync(present, plan, seatMap, { now: opts.now, steady: opts.steady });
  return seatMap;
}
