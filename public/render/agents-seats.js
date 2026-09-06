/**
 * Who sits where (WP-22 follow-up).
 *
 * Split out of `agents.js` unchanged: `derivePlacement` — which is the one
 * shared rule from `floor-rule.js`, kept under its old name because six call
 * sites and four test files use it — the hashed assignment that gives an
 * agent the same chair on every rebuild, and `assignSeats`, which writes the
 * five fields that turn a plan's chair into a chair somebody is sitting in.
 *
 * Pure, like every `agents-*` module and `agents.js` itself: no `node:`
 * import, no `document`, no `window`, no canvas. That is what lets
 * `test/unit/*.mjs` load this side of the renderer directly under
 * `node --test` (docs/DEVIATIONS.md §122).
 */

import { placement } from '../floor-rule.js';
import {
  hashString,
  JUNIOR_BACK,
  JUNIOR_OFFSET,
  JUNIOR_PACKS,
  JUNIOR_PAD,
  JUNIOR_ROW,
  OVERFLOW_RING_R,
  spotAt,
} from './agents-core.js';

/** @typedef {import('./agents-core.js').Room} Room */
/** @typedef {import('./agents-core.js').Door} Door */
/** @typedef {import('./agents-core.js').Plan} Plan */
/** @typedef {import('./agents-core.js').Seat} Seat */
/** @typedef {import('./agents-core.js').PlacedSeat} PlacedSeat */
/** @typedef {import('./agents-core.js').LoungeSpot} LoungeSpot */
/** @typedef {import('./agents-core.js').NavLine} NavLine */
/** @typedef {import('./agents-core.js').WalkPoint} WalkPoint */
/** @typedef {import('./agents-core.js').AgentLike} AgentLike */
/** @typedef {import('./agents-core.js').AgentRecord} AgentRecord */

// -------------------------------------------------------- seat assignment

/**
 * Where an agent stands. WP-22: this WAS a hand-written copy of `placement()`
 * in `src/core/model.mjs`, with a comment asking the next person not to let
 * the two drift. There is one copy now — `public/floor-rule.js` — and
 * `model.mjs` imports the same file. The name is kept because six call sites
 * and four test files use it.
 * @param {AgentLike} agent
 * @returns {'desk'|'office'|'lounge'|'let_go'}
 */
export const derivePlacement = placement;

/**
 * Deterministic seat index for an id among `n` seats, with linear-probe
 * collision resolution. The same set of ids always resolves the same way
 * (agents are pre-sorted by id before probing) regardless of the order they
 * arrive in from a fresh snapshot, which is what keeps desk/lounge seating
 * stable across refreshes: an agent's seat only moves if its own hash slot is
 * actually contested, never merely because the input array order changed.
 */
export function assignHashed(agents, seats, result) {
  if (!seats || !seats.length) return;
  const n = seats.length;
  // A seat may hold more than one person where the furniture says so — a
  // three-seat sofa is one lounge spot with `capacity: 3`. Anything without a
  // declared capacity holds one. Ignoring this both wasted sofas and, once the
  // spots ran out, silently sat two agents in the same place.
  const capacity = seats.map((seat) => Math.max(1, Math.floor(seat.capacity ?? 1)));
  const room = capacity.slice();
  const ordered = [...agents].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  /** @type {AgentLike[]} */
  const unplaced = [];
  for (const agent of ordered) {
    let idx = hashString(agent.id) % n;
    let probes = 0;
    while (room[idx] <= 0 && probes < n) {
      idx = (idx + 1) % n;
      probes++;
    }
    if (room[idx] <= 0) {
      unplaced.push(agent);
      continue;
    }
    const seat = seats[idx];
    const cap = capacity[idx];
    if (cap === 1) {
      room[idx]--;
      result.set(agent.id, seat);
      continue;
    }

    // A spot that seats three is a sofa, not a single point. Occupants spread
    // ALONG the furniture — perpendicular to the way they are facing — so
    // three people on one sofa are three people, not one body drawn three
    // times with its labels stacked on top of each other.
    const k = cap - room[idx];
    room[idx]--;
    result.set(agent.id, spotAt(seat, k));
  }
  // Genuinely more people than places. Rather than stack bodies exactly on top
  // of one another — which is what the old linear probe did once every slot
  // was taken — the remainder stand in a ring around their nominal spot, so
  // each is still visible, still clickable, and still obviously "extra".
  unplaced.forEach((agent, k) => {
    const seat = seats[hashString(agent.id) % n];
    const angle = (k / Math.max(1, unplaced.length)) * Math.PI * 2;
    result.set(agent.id, {
      x: seat.x + Math.cos(angle) * OVERFLOW_RING_R,
      y: seat.y + Math.sin(angle) * OVERFLOW_RING_R,
      angle: seat.angle,
      kind: seat.kind,
      overflow: true,
    });
  });
}

/**
 * How far a point may travel along `u` before it leaves `rect`, less `pad`.
 *
 * A ray-box clip, and it has to be one rather than a width: a junior's row
 * runs along the way its parent FACES turned a quarter, which on a chat spot
 * in a lounge is vertical and at a desk is horizontal, and on an overflow ring
 * is neither.
 * @param {{x:number,y:number}} p @param {{x:number,y:number}} u
 * @param {{x:number,y:number,w:number,h:number}} rect @param {number} pad
 */
function reachInside(p, u, rect, pad) {
  const lo = { x: rect.x + pad, y: rect.y + pad };
  const hi = { x: rect.x + rect.w - pad, y: rect.y + rect.h - pad };
  let t = Infinity;
  for (const k of /** @type {const} */ (['x', 'y'])) {
    if (Math.abs(u[k]) < 1e-9) {
      if (p[k] < lo[k] - 1e-9 || p[k] > hi[k] + 1e-9) return 0;
      continue;
    }
    t = Math.min(t, ((u[k] > 0 ? hi[k] : lo[k]) - p[k]) / u[k]);
  }
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/**
 * WHERE A SENIOR'S JUNIORS STAND — inside the room, always (WP-59d).
 *
 * WP-41 put the first junior one seat pitch to its parent's left, the second
 * the same to its right, the third further left, and so on outwards for ever.
 * That is right for the two or three a senior usually has and wrong the moment
 * it is sixteen: on the owner's own floor a benched senior with sixteen
 * juniors drew a packed row forty units wide along the lounge's bottom wall,
 * half of it OUTSIDE the lounge and over the corridor beside it. A body drawn
 * outside the room it belongs to is the one thing the floor may never do, and
 * it is the same defect as a desk on a corridor.
 *
 * So the row wraps. The rule is unchanged where it fits — alternating sides,
 * outwards, one seat pitch apart, which is what keeps the two-junior case in
 * `demo`'s room to the unit — and where the wall arrives, the next junior
 * starts a RANK behind rather than walking through it. If the ranks run out
 * too, `JUNIOR_PACKS` closes the gaps a step at a time; nothing is ever
 * dropped, because a junior is a session and a session nobody draws is one
 * somebody has to go looking for.
 *
 * @param {{x:number,y:number,angle?:number}} anchor the parent's own seat
 * @param {{x:number,y:number,w:number,h:number}|null} room the room it is in
 * @param {number} n how many juniors
 * @returns {{x:number,y:number}[]} one position per junior, in order
 */
export function juniorSpots(anchor, room, n) {
  const angle = typeof anchor.angle === 'number' ? anchor.angle : 0;
  // The seat's `angle` is the way its occupant FACES, so "along the desk" is
  // that direction turned a quarter, and "behind" is the reverse of it.
  const along = { x: Math.cos(angle + Math.PI / 2), y: Math.sin(angle + Math.PI / 2) };
  const back = { x: -Math.cos(angle), y: -Math.sin(angle) };
  const left = { x: -along.x, y: -along.y };
  const lay = (pitch, row, gap) => {
    const perSide = room
      ? [
          Math.floor(reachInside(anchor, left, room, JUNIOR_PAD) / pitch),
          Math.floor(reachInside(anchor, along, room, JUNIOR_PAD) / pitch),
        ]
      : [n, n];
    const ranks = room
      ? Math.max(1, Math.floor((reachInside(anchor, back, room, JUNIOR_PAD) - gap) / row) + 1)
      : n;
    // Alternating sides, outwards, skipping a side that has run out of wall.
    /** @type {number[]} */
    const offsets = [];
    for (let step = 1; offsets.length < perSide[0] + perSide[1]; step++) {
      if (step <= perSide[0]) offsets.push(-step);
      if (step <= perSide[1]) offsets.push(step);
      if (step > perSide[0] && step > perSide[1]) break;
    }
    return offsets.length * ranks >= n ? { offsets, ranks, pitch, row, gap } : null;
  };
  let plan = null;
  for (const shrink of JUNIOR_PACKS) {
    plan = lay(JUNIOR_OFFSET * shrink, JUNIOR_ROW * shrink, JUNIOR_BACK * shrink);
    if (plan) break;
  }
  // Nowhere at all: a room too small to hold them at the tightest pitch. The
  // last rung is still the best answer there is, and the clamp below keeps
  // every one of them inside the walls.
  if (!plan) {
    const last = JUNIOR_PACKS[JUNIOR_PACKS.length - 1];
    plan = {
      offsets: [-1, 1],
      ranks: 1,
      pitch: JUNIOR_OFFSET * last,
      row: JUNIOR_ROW * last,
      gap: JUNIOR_BACK * last,
    };
  }
  const per = Math.max(1, plan.offsets.length);
  /** @type {{x:number,y:number}[]} */
  const out = [];
  for (let i = 0; i < n; i++) {
    const offset = plan.offsets[i % per] ?? (i % 2 === 0 ? -1 : 1);
    const depth = plan.gap + Math.floor(i / per) * plan.row;
    const x = anchor.x + along.x * offset * plan.pitch + back.x * depth;
    const y = anchor.y + along.y * offset * plan.pitch + back.y * depth;
    out.push(
      room
        ? {
            x: Math.min(Math.max(x, room.x + JUNIOR_PAD), room.x + room.w - JUNIOR_PAD),
            y: Math.min(Math.max(y, room.y + JUNIOR_PAD), room.y + room.h - JUNIOR_PAD),
          }
        : { x, y },
    );
  }
  return out;
}

/**
 * Assign every agent a seat/spot on the floor.
 * docs/03-VISUAL-SPEC.md §2, work order for `agents.js`.
 * @param {Plan} plan
 * @param {AgentLike[]} agents
 * @returns {Map<string, PlacedSeat>}
 */
export function assignSeats(plan, agents) {
  /** @type {Map<string, PlacedSeat>} */
  const result = new Map();
  /** @type {Map<string, AgentLike[]>} */
  const deskByProject = new Map();
  const officeAgents = [];
  const loungeAgents = [];
  const letGoAgents = [];

  // Who the floor draws nobody for, decided by `buildPlan` and read here
  // rather than re-derived: an agent who went home (benched, quiet for longer
  // than `settings.goneHomeDays`) and an agent at a desk in a project that has
  // no room. Both are display filters — `ackState` is exactly as the user left
  // it — and both are the plan's call, so there is one answer to "is this
  // person on the floor" instead of two that can disagree.
  const hidden = (plan && plan.hidden) || null;
  /**
   * WP-41. Juniors, by parent id. They are held back from the hashed seating
   * pass on purpose: a junior does not take a chair of its own, it stands
   * beside the person who spawned it, and its position is only knowable once
   * that person has a seat. They still COUNT as occupants — `buildPlan` sized
   * the table with them in it (`plan.js`'s `floorPopulation`), which is what
   * gives a senior with three juniors a four-seater to stand around.
   * @type {Map<string, AgentLike[]>}
   */
  const juniorsByParent = new Map();

  for (const agent of agents) {
    if (hidden && hidden.has(agent.id)) continue;
    if (agent.subagent === true) {
      const parent = agent.parentId == null ? '' : String(agent.parentId);
      const list = juniorsByParent.get(parent) || [];
      list.push(agent);
      juniorsByParent.set(parent, list);
      continue;
    }
    const p = derivePlacement(agent);
    if (p === 'let_go') {
      letGoAgents.push(agent);
    } else if (p === 'desk') {
      const list = deskByProject.get(agent.projectId) || [];
      list.push(agent);
      deskByProject.set(agent.projectId, list);
    } else if (p === 'office') {
      officeAgents.push(agent);
    } else if (p === 'lounge') {
      loungeAgents.push(agent);
    }
  }

  for (const [projectId, list] of deskByProject) {
    const seats = (plan.seats && plan.seats.get(projectId)) || [];
    assignHashed(list, seats, result);
  }

  // Office waiting area is a literal queue: oldest reviewSince first, front seat first.
  officeAgents.sort((a, b) => {
    const ra = a.reviewSince ?? Infinity;
    const rb = b.reviewSince ?? Infinity;
    return ra - rb || String(a.id).localeCompare(String(b.id));
  });
  const officeSeats = plan.officeSeats || [];
  officeAgents.forEach((agent, i) => {
    if (!officeSeats.length) return;
    if (i < officeSeats.length) {
      result.set(agent.id, officeSeats[i]);
      return;
    }
    // More people waiting than the plan was built for — which happens for one
    // frame whenever a session enters `for_review` before the next rebuild.
    // Clamping to the last seat (the old rule) piled every one of them onto
    // the same sofa cushion; standing them behind the back row is honest and
    // legible, and they take a real seat as soon as the plan catches up.
    const anchor = officeSeats[officeSeats.length - 1];
    const extra = i - officeSeats.length;
    result.set(agent.id, {
      x: anchor.x + ((extra % 4) - 1.5) * OVERFLOW_RING_R * 2,
      y: anchor.y - (1 + Math.floor(extra / 4)) * OVERFLOW_RING_R * 2,
      angle: anchor.angle,
      overflow: true,
    });
  });

  assignHashed(loungeAgents, plan.loungeSpots || [], result);

  // WP-41, last: the juniors, once every senior has a seat to stand beside.
  // Deterministic — sorted by id, alternating left and right — so the same
  // three juniors line up the same way on every push and nobody shuffles.
  //
  // WP-59d: INSIDE THE ROOM THE PARENT IS IN, whichever room that is. The row
  // wraps at the walls rather than walking through them (`juniorSpots`), which
  // is the whole of the fix for a benched senior with sixteen juniors drawing
  // half of them outside the lounge.
  const roomAt = (p) =>
    ((plan && plan.rooms) || []).find(
      (r) =>
        r.kind !== 'corridor' &&
        p.x >= r.x - 0.01 &&
        p.x <= r.x + r.w + 0.01 &&
        p.y >= r.y - 0.01 &&
        p.y <= r.y + r.h + 0.01,
    ) || null;
  for (const [parentId, list] of juniorsByParent) {
    const anchor = result.get(parentId);
    // A junior whose parent is not on the floor at all: it went home, it was
    // let go, or the scan caught the junior a poll before its parent. Nothing
    // to stand beside, so nothing is drawn — `sync` drops the record for the
    // same reason it drops an archived session, rather than parking a body on
    // the floor's origin.
    if (!anchor) continue;
    const ordered = [...list].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const spots = juniorSpots(anchor, roomAt(anchor), ordered.length);
    const angle = typeof anchor.angle === 'number' ? anchor.angle : 0;
    ordered.forEach((junior, i) => {
      result.set(junior.id, { ...spots[i], angle, kind: anchor.kind, junior: true });
    });
  }
  // Archived sessions are off the floor entirely — no room, no seat, nothing
  // drawn. They are still counted in the header and still listed in the panel;
  // they simply do not take screen space away from the rooms in play. `sync`
  // drops their records for the same reason.
  void letGoAgents;

  return result;
}
