/**
 * A LEAD AND ITS JUNIORS, AND WHAT THE FLOOR STROKES FOR THEM.
 *
 * The fixtures the junior tests share: one lead in `career-ops` with a crew, a
 * bystander in another repo so the building is not one room, and a context
 * that keeps every cable it is asked to stroke as the points it was given.
 * The camera is one screen pixel a plan unit, so a stroked point IS a plan
 * point and can be asked which room it is in.
 */

import { buildPlan } from '../../public/render/plan.js';
import { drawCrews } from '../../public/render/crew-draw.js';
import { AgentRuntime } from '../../public/render/agents.js';
import { JuniorHold, syncFloor } from '../../public/render/junior-hold.js';
import { sameBuilding } from '../../public/render/plan-hold.js';

export const NOW = 1_800_000_000_000;
export const MIN = 60_000;
export const STAGE = { w: 1600, h: 1000 };
export const LEAD = 'claude-code:lead';

/** One screen pixel a plan unit: a stroked point is a plan point. */
export const CAMERA = { U: 1, zoom: 1, panX: 0, panY: 0 };

/** @param {string} id @param {object} [over] */
export function agent(id, over = {}) {
  return {
    id,
    projectId: 'career-ops',
    activityState: 'working',
    ackState: 'active',
    reviewSince: null,
    needsInputSince: null,
    lastActivityAt: NOW - MIN,
    ...over,
  };
}

/** A junior of `parentId`, working, its transcript moving. */
export const junior = (id, parentId = LEAD, over = {}) =>
  agent(id, {
    subagent: true,
    parentId,
    subagentType: 'general-purpose',
    lastGrowthAt: NOW - 5_000,
    ...over,
  });

/** Zero-padded, so id order is number order. */
export const jid = (i) => `claude-code:j${String(i).padStart(2, '0')}`;

/**
 * One lead with `n` working juniors, and a bystander elsewhere.
 * @param {number} n @param {object} [leadOver]
 */
export function crewFloor(n, leadOver = {}) {
  const agents = [agent(LEAD, leadOver)];
  for (let i = 0; i < n; i++) agents.push(junior(jid(i)));
  agents.push(agent('claude-code:other', { projectId: 'elsewhere' }));
  const projects = [
    { id: 'career-ops', name: 'career-ops', sessionCount: 1, activeCount: 1 },
    { id: 'elsewhere', name: 'elsewhere', sessionCount: 1, activeCount: 1 },
  ];
  return { agents, projects };
}

/** @param {any[]} projects @param {any[]} agents */
export const planFor = (projects, agents) =>
  buildPlan(projects, agents, { stage: STAGE, now: NOW });

/** The same floor with one agent's fields changed. */
export const withOne = (agents, id, over) =>
  agents.map((a) => (a.id === id ? { ...a, ...over } : a));

/**
 * A FLOOR DRIVEN THE WAY THE SCENE DRIVES IT: one lead and `n` juniors, the
 * runtime, the junior hold, and `syncFloor` on every snapshot.
 *
 * `roomFor` furnishes the room for a larger crew than it starts with, as the
 * furnishing hold does on a live floor. `sync(list, true)` plans the building
 * again for that snapshot first, and bridges it as `Scene#setState` does:
 * everybody seated where they were in the new plan, then the snapshot.
 * @param {number} n @param {{roomFor?:number}} [opts]
 */
export function drivenFloor(n, opts = {}) {
  const { agents, projects } = crewFloor(n);
  const rt = new AgentRuntime();
  const hold = new JuniorHold();
  const f = {
    agents,
    plan: planFor(projects, crewFloor(Math.max(n, opts.roomFor ?? n)).agents),
    rt,
    hold,
    t: NOW,
    last: agents,
    room: (kind, id) => roomOf(f.plan, kind, id),
    sync(list, replan = false) {
      if (replan) {
        const old = f.plan;
        f.plan = planFor(projects, list);
        syncFloor(rt, hold, f.plan, f.last, { now: f.t, steady: sameBuilding(old, f.plan) });
      }
      f.last = list;
      return syncFloor(rt, hold, f.plan, list, { now: f.t });
    },
    /** Run `ms` of frames, a tenth of a second each; `each` is asked after every one. */
    run(ms, reduced = false, each = null) {
      for (let left = ms; left > 0; left -= 100) {
        f.t += 100;
        rt.step(0.1, { plan: f.plan, now: f.t, reduced });
        if (each) each();
      }
    },
    at: (id) => ({ x: rt.get(id).x, y: rt.get(id).y }),
  };
  f.sync(agents);
  return f;
}

/** @param {any} plan @param {string} kind @param {string} [id] */
export const roomOf = (plan, kind, id) =>
  plan.rooms.find((r) => r.kind === kind && (id === undefined || r.id === id));

/** @param {{x:number,y:number}} p @param {any} rect @param {number} [pad] */
export const inside = (p, rect, pad = 0.01) =>
  !!p &&
  !!rect &&
  p.x >= rect.x - pad &&
  p.x <= rect.x + rect.w + pad &&
  p.y >= rect.y - pad &&
  p.y <= rect.y + rect.h + pad;

/**
 * Every cable one frame strokes: its colour and the points it runs through.
 * @param {Iterable<any>} records the runtime's records
 * @param {any[]} agents the snapshot the frame is drawn from
 * @param {{nowMs?:number, reduced?:boolean}} [opts]
 * @returns {{style:string, pts:{x:number,y:number}[], length:number}[]}
 */
export function cablesOf(records, agents, opts = {}) {
  /** @type {{style:string, pts:{x:number,y:number}[], length:number}[]} */
  const out = [];
  /** @type {{x:number,y:number}[]} */
  let pts = [];
  const state = { strokeStyle: '', font: '10px x' };
  const own = {
    beginPath: () => (pts = []),
    moveTo: (x, y) => pts.push({ x, y }),
    lineTo: (x, y) => pts.push({ x, y }),
    measureText: (t) => ({ width: String(t).length * 6 }),
    stroke: () => {
      let length = 0;
      for (let i = 0; i + 1 < pts.length; i++)
        length += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      out.push({ style: String(state.strokeStyle), pts, length });
    },
  };
  const ctx = new Proxy(state, {
    get: (target, key) => (key in own ? own[key] : key in target ? target[key] : () => {}),
    set: (target, key, value) => ((target[key] = value), true),
  });
  const list = [...records];
  drawCrews(/** @type {any} */ (ctx), {
    records: list,
    agentsById: new Map(agents.map((a) => [a.id, a])),
    camera: CAMERA,
    scale: 20,
    // A figure one unit to the unit, as the camera is: the last run of a cable
    // goes into the laptop at its junior's knees, and that is measured in this.
    charU: 1,
    lod: 2,
    reduced: opts.reduced === true,
    pinned: null,
    nowMs: opts.nowMs ?? NOW,
    seatOf: (id) => list.find((r) => r.id === id)?.targetSeat ?? null,
    crewCounts: new Map(),
  });
  return out;
}
