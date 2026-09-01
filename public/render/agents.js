/**
 * DeckHQ — per-agent runtime.
 *
 * Pure logic module: no canvas access, no DOM at module scope, so it can be
 * unit-tested under Node (see test/unit/scene-math.test.mjs). `scene.js` is the
 * only file that touches a canvas or `document`; it drives this module with a
 * plan and a snapshot and reads the resulting per-agent records to draw.
 *
 * Two intentional "mirrors" of code that lives elsewhere, both because a
 * browser module cannot reach past the static-file boundary (docs/02-ARCHITECTURE.md
 * §9 — static serving is confined to `publicDir`, so `public/render/*.js` cannot
 * `import` from `src/core/*.mjs` at runtime even though Node can for tests):
 *
 *   - `derivePlacement()` mirrors `placement()` in `src/core/model.mjs` exactly.
 *     Do not let these drift; if `model.mjs`'s rule changes, update both.
 *   - `clipForActivity()` is a minimal stand-in for `clipForState()`, which is
 *     specified to live in `./clips.js` (docs/03-VISUAL-SPEC.md §5). `clips.js`
 *     did not exist at the time this file was written (it is owned by another
 *     engineer and was being written concurrently — see CONTRACTS.md). This
 *     file intentionally never statically imports `./clips.js`, `./plan.js`,
 *     `./backdrop.js`, `./rig.js` or `./palette.js`: a missing sibling file
 *     would otherwise crash `import` at module-load time, and this module must
 *     stay loadable under `node --test` on its own. `scene.js` is the
 *     integration point that imports those siblings once they exist.
 */

/** @typedef {{x:number,y:number,angle:number}} Seat */
/** @typedef {{id:string,kind:'pool'|'table_tennis'|'board_game'|'arcade'|'coffee'|'eat'|'chat'|'lounge_idle',x:number,y:number,angle:number,capacity:number,partnerOf?:string}} LoungeSpot */
/** @typedef {{x:number,y:number,angle:number,width:number}} Door */
/** @typedef {{kind:'office'|'project'|'lounge',id:string,name:string,x:number,y:number,w:number,h:number,walls:'full'|'partial',plateLines:[string,string]}} Room */
/**
 * @typedef {object} Plan
 * @property {number} width
 * @property {number} height
 * @property {Room[]} rooms
 * @property {Map<string, Seat[]>} seats
 * @property {Seat[]} officeSeats
 * @property {LoungeSpot[]} loungeSpots
 * @property {Door[]} doors
 */

/**
 * The subset of `Agent` (src/core/model.mjs) this module reads.
 * @typedef {object} AgentLike
 * @property {string} id
 * @property {string} projectId
 * @property {'working'|'needs_input'|'stalled'|'for_review'|'ended'} activityState
 * @property {'active'|'benched'|'let_go'} ackState
 * @property {number|null} reviewSince
 */

/**
 * @typedef {object} WalkPoint
 * @property {number} x
 * @property {number} y
 * @property {Room|null} [room]   the room this point sits inside, or null/undefined for open
 *   circulation space (corridor, or a room whose `walls` are `'partial'`, which has no fixed
 *   doorway — see `doorFor`).
 * @property {{x:number,y:number,angle?:number}|null} [door]  the door to use when `room.walls
 *   === 'full'`. Compute with `doorFor(room, plan.doors)`.
 */

/**
 * @typedef {object} Pose
 * (docs/03-VISUAL-SPEC.md §3 — not constructed here; agents.js only tracks the
 * clip *name* and *start time*. `rig.js`/`clips.js` turn that into a Pose.)
 */

/**
 * @typedef {object} AgentRecord
 * @property {string} id
 * @property {number} x                 plan units
 * @property {number} y                 plan units
 * @property {number} angle             radians
 * @property {string|null} roomId       id of the room the agent last settled in
 * @property {Seat|LoungeSpot|null} targetSeat
 * @property {{x:number,y:number}[]} path   remaining waypoints (plan units)
 * @property {string|null} clip
 * @property {number} clipStartedAt     ms epoch
 * @property {string|null} pendingClip  clip to switch to on arrival
 * @property {boolean} seated
 * @property {number} seed              32-bit hash of `id`
 * @property {() => number} rng         seeded PRNG, [0,1)
 * @property {{activity:string|null, remaining:number, pairedWith:string|null}} rotation
 * @property {boolean} initialised
 */

// ---------------------------------------------------------------- constants

/**
 * Plan units walked per second.
 *
 * Raised from 4.5: routes now go door -> corridor -> door rather than cutting
 * straight across the floor, so the same journey covers noticeably more
 * ground. At the old speed a trip from a project room to the lounge was long
 * enough to read as the agent being stuck rather than walking.
 */
export const WALK_SPEED = 13;

/** Activity rotation hold time, seconds (VISUAL-SPEC §4.3). */
export const ROTATION_MIN_S = 45;
export const ROTATION_MAX_S = 90;

/** Lounge clips (VISUAL-SPEC §4.2). Fallback for `LOUNGE_CLIPS` from `./clips.js`. */
export const LOUNGE_CLIPS = [
  'pool',
  'table_tennis',
  'board_game',
  'arcade',
  'coffee',
  'eat',
  'chat',
  'lounge_idle',
];

/**
 * Activities that need a partner (VISUAL-SPEC §4.2 explicitly tags these "Paired" /
 * "Paired or group"; `pool` mentions two agents alternating turns but is not tagged
 * Paired, so it is treated as solo-capable — a judgment call, see the report).
 */
export const PAIRED_ACTIVITIES = new Set(['table_tennis', 'board_game', 'chat']);
export const SOLO_ACTIVITIES = LOUNGE_CLIPS.filter((a) => !PAIRED_ACTIVITIES.has(a));

const EPS = 1e-6;

/**
 * How far from a spot an overflow occupant stands, in plan units. Only ever
 * used when there are more agents than places — see `assignHashed`.
 */
const OVERFLOW_RING_R = 1.3;

/** Pitch between two people sharing one piece of furniture, in plan units. */
const SEAT_SPREAD = 2.2;

/**
 * The `index`-th place on a seat, spread ALONG the furniture (perpendicular to
 * the way its occupants face). A single-capacity spot is its own only place.
 * @param {Seat|LoungeSpot} seat
 * @param {number} index
 */
function spotAt(seat, index) {
  const cap = Math.max(1, Math.floor(seat.capacity ?? 1));
  if (cap === 1) return seat;
  // NOT `index <= 0 -> seat`: place 0 of a three-seat sofa is its LEFT end,
  // not its centre. Returning the bare seat for index 0 put the first and the
  // second occupant on the same cushion, because place 1 is the centre.
  const slot = clampNum(Math.floor(index), 0, cap - 1);
  const spread = (slot - (cap - 1) / 2) * SEAT_SPREAD;
  const perp = (seat.angle ?? 0) + Math.PI / 2;
  return {
    ...seat,
    // Which place on the furniture this is. Carried on the seat so a later
    // rotation can see WHICH cushions are taken rather than only how many —
    // counting alone let a newcomer pick the place somebody was already in.
    seatIndex: slot,
    x: seat.x + Math.cos(perp) * spread,
    y: seat.y + Math.sin(perp) * spread,
  };
}

/** How many times an agent will re-roll for an activity it can actually do. */
const ACTIVITY_PICK_ATTEMPTS = 4;

// ------------------------------------------------------------- seeded RNG

/**
 * Deterministic 32-bit hash of a string (FNV-1a). Used to seed each agent's PRNG
 * from its id so behaviour reproduces across reloads (same id -> same seed ->
 * same first draw), per the work order.
 * @param {string} str
 * @returns {number}
 */
export function hashString(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * mulberry32 — small, fast, seedable PRNG. Good enough for cosmetic randomness
 * (activity choice, rotation duration); not cryptographic.
 * @param {number} seed
 * @returns {() => number} function returning a float in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- geometry

/**
 * Convert a world (plan-unit) point to screen pixels.
 * @param {{x:number,y:number}} point
 * @param {{zoom:number, panX:number, panY:number, U:number}} camera
 * @returns {{x:number,y:number}}
 */
export function worldToScreen(point, camera) {
  const s = camera.U * camera.zoom;
  return { x: point.x * s + camera.panX, y: point.y * s + camera.panY };
}

/**
 * Inverse of {@link worldToScreen}.
 * @param {{x:number,y:number}} point
 * @param {{zoom:number, panX:number, panY:number, U:number}} camera
 * @returns {{x:number,y:number}}
 */
export function screenToWorld(point, camera) {
  const s = camera.U * camera.zoom;
  return { x: (point.x - camera.panX) / s, y: (point.y - camera.panY) / s };
}

/**
 * Level of detail band for a given zoom. docs/03-VISUAL-SPEC.md §1.1.
 * @param {number} zoom
 * @returns {0|1|2}
 */
export function lodForZoom(zoom) {
  if (zoom < 0.7) return 0;
  if (zoom <= 1.4) return 1;
  return 2;
}

/**
 * Distance from (x,y) to the nearest point on `rect`'s perimeter. Zero exactly
 * on the boundary. Used to find which room a `Door` belongs to, since the
 * `Plan.doors` array (per CONTRACTS.md) carries no room id of its own.
 * @param {{x:number,y:number,w:number,h:number}} rect
 */
function distanceToRectPerimeter(rect, x, y) {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.w));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.h));
  if (dx === 0 && dy === 0) {
    return Math.min(x - rect.x, rect.x + rect.w - x, y - rect.y, rect.y + rect.h - y);
  }
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Find the door (from `plan.doors`) that belongs to `room`, i.e. the one
 * sitting on its perimeter. Rooms with `walls !== 'full'` are open on some
 * sides and do not need a literal door to exit safely, so this returns `null`
 * for them even if a door happens to be nearby.
 * @param {Room|null|undefined} room
 * @param {Door[]|undefined} doors
 * @returns {Door|null}
 */
export function doorFor(room, doors) {
  if (!room || room.walls !== 'full' || !doors || !doors.length) return null;
  let best = null;
  let bestDist = Infinity;
  for (const d of doors) {
    const dist = distanceToRectPerimeter(room, d.x, d.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

/**
 * Plan a walking path from `from` to `to` that never crosses a wall: exit the
 * source room through its door (or open edge), travel the circulation space,
 * enter the destination room through its door (or open edge).
 *
 * `from`/`to` are self-describing {@link WalkPoint}s (carry their own `room`
 * and, where relevant, `door` — see `doorFor`) so this stays a pure function
 * of its two points plus an optional room list for mid-corridor collision
 * avoidance against rooms that are neither the source nor the destination.
 *
 * @param {WalkPoint} from
 * @param {WalkPoint} to
 * @param {Room[]} [rooms]  every room on the floor, for corridor obstacle
 *   avoidance. Defaults to just `from.room`/`to.room` (still correct, just
 *   unaware of a third room sitting between them).
 * @returns {{x:number,y:number}[]} waypoints from (not including) `from` to
 *   (including) `to`.
 */
/**
 * Where two nav lines cross, if they do.
 * @param {NavLine} a
 * @param {NavLine} b
 */
function lineIntersection(a, b) {
  if (a.axis === b.axis) return null;
  const v = a.axis === 'v' ? a : b;
  const h = a.axis === 'h' ? a : b;
  if (h.c < v.min - 1e-6 || h.c > v.max + 1e-6) return null;
  if (v.c < h.min - 1e-6 || v.c > h.max + 1e-6) return null;
  return { x: v.c, y: h.c };
}

/** The nav line a point sits on, or the nearest one. */
function lineFor(lines, p) {
  let best = null;
  for (const line of lines) {
    const d =
      line.axis === 'v'
        ? Math.hypot(p.x - line.c, p.y - clampNum(p.y, line.min, line.max))
        : Math.hypot(p.x - clampNum(p.x, line.min, line.max), p.y - line.c);
    if (!best || d < best.d) best = { line, d };
  }
  return best ? best.line : null;
}

/** @param {number} v @param {number} lo @param {number} hi */
function clampNum(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Travel from one point on the corridor network to another, staying on it.
 *
 * Breadth-first over the lines, which is ample: a floor has a spine and one
 * corridor per row of rooms, so the graph is tiny and always connected
 * through the spine.
 *
 * @param {NavLine[]} lines
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 * @returns {{x:number,y:number}[]} waypoints between a and b, exclusive
 */
function routeOnLines(lines, a, b) {
  if (!lines || lines.length === 0) return [];
  const start = lineFor(lines, a);
  const end = lineFor(lines, b);
  if (!start || !end) return [];
  if (start === end) return [];

  // BFS over lines, remembering how each was reached.
  const prev = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === end) break;
    for (const next of lines) {
      if (prev.has(next)) continue;
      if (!lineIntersection(cur, next)) continue;
      prev.set(next, cur);
      queue.push(next);
    }
  }
  if (!prev.has(end)) return [];

  // Walk the chain back, collecting the crossing points in order.
  /** @type {NavLine[]} */
  const chain = [];
  for (let cur = end; cur; cur = prev.get(cur)) chain.unshift(cur);

  /** @type {{x:number,y:number}[]} */
  const out = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const cross = lineIntersection(chain[i], chain[i + 1]);
    if (cross) out.push(cross);
  }
  return out;
}

/**
 * Route from one point to another, staying inside the building.
 *
 * An agent leaves its room by its own door, joins the corridor that door
 * opens onto, travels the corridor network, then enters the destination the
 * same way. It never crosses a wall and never leaves the floor.
 *
 * The previous router did generic obstacle avoidance and, when a direct line
 * was blocked, swept around the bounding box of the obstacles — a box whose
 * edges lie OUTSIDE the building. That is precisely why agents were seen
 * walking off one side of the screen and reappearing on the other.
 *
 * @param {WalkPoint} from
 * @param {WalkPoint} to
 * @param {Room[]} [rooms] unused by the routing itself; kept for the existing
 *   call signature
 * @param {{nav?: NavLine[], width?: number, height?: number}} [plan]
 * @returns {{x:number,y:number}[]} waypoints from (not including) `from` to
 *   (including) `to`.
 */
export function planWalk(from, to, rooms, plan) {
  if (!from || !to) return [{ x: to ? to.x : 0, y: to ? to.y : 0 }];

  const sameRoom = from.room && to.room && from.room.id === to.room.id;
  if (sameRoom || (!from.room && !to.room)) {
    return [{ x: to.x, y: to.y }];
  }

  const lines = (plan && plan.nav) || [];
  /** @type {{x:number,y:number}[]} */
  const out = [];

  // Out through our own door, onto the corridor it opens on.
  if (from.room && from.room.door) out.push({ ...from.room.door });
  if (from.room && from.room.navEntry) out.push({ ...from.room.navEntry });

  const a = from.room && from.room.navEntry ? from.room.navEntry : from;
  const b = to.room && to.room.navEntry ? to.room.navEntry : to;
  out.push(...routeOnLines(lines, a, b));

  // In through theirs.
  if (to.room && to.room.navEntry) out.push({ ...to.room.navEntry });
  if (to.room && to.room.door) out.push({ ...to.room.door });
  out.push({ x: to.x, y: to.y });

  // Belt and braces: nothing may leave the building, whatever the graph says.
  if (plan && plan.width && plan.height) {
    for (const w of out) {
      w.x = clampNum(w.x, 0.5, plan.width - 0.5);
      w.y = clampNum(w.y, 0.5, plan.height - 0.5);
    }
  }
  return out;
}

// -------------------------------------------------------- seat assignment

/**
 * Mirrors `placement()` in `src/core/model.mjs` exactly. See file header for
 * why this cannot simply import that function.
 * @param {AgentLike} agent
 * @returns {'desk'|'office'|'lounge'|'let_go'}
 */
export function derivePlacement(agent) {
  if (agent.ackState === 'let_go') return 'let_go';
  if (agent.ackState === 'benched') return 'lounge';
  if (agent.activityState === 'for_review') return 'office';
  return 'desk';
}

/**
 * Deterministic seat index for an id among `n` seats, with linear-probe
 * collision resolution. The same set of ids always resolves the same way
 * (agents are pre-sorted by id before probing) regardless of the order they
 * arrive in from a fresh snapshot, which is what keeps desk/lounge seating
 * stable across refreshes: an agent's seat only moves if its own hash slot is
 * actually contested, never merely because the input array order changed.
 */
function assignHashed(agents, seats, result) {
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
 * Assign every agent a seat/spot on the floor.
 * docs/03-VISUAL-SPEC.md §2, work order for `agents.js`.
 * @param {Plan} plan
 * @param {AgentLike[]} agents
 * @returns {Map<string, Seat|LoungeSpot>}
 */
export function assignSeats(plan, agents) {
  /** @type {Map<string, Seat|LoungeSpot>} */
  const result = new Map();
  /** @type {Map<string, AgentLike[]>} */
  const deskByProject = new Map();
  const officeAgents = [];
  const loungeAgents = [];
  const letGoAgents = [];

  for (const agent of agents) {
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
  // Archived sessions are off the floor entirely — no room, no seat, nothing
  // drawn. They are still counted in the header and still listed in the panel;
  // they simply do not take screen space away from the rooms in play. `sync`
  // drops their records for the same reason.
  void letGoAgents;

  return result;
}

// -------------------------------------------------------- activity rotation

/**
 * Decide the next lounge activity for a benched agent. Paired activities
 * degrade to a solo activity when `availability[activity]` is not truthy.
 * Uses the record's own seeded RNG, so a fixed sequence of calls against a
 * fresh record (same agent id) always reproduces the same sequence.
 *
 * Delegates to `makeActivityRotation` from `./clips.js` when the caller
 * supplies one (e.g. once that file exists and `scene.js` wires it through);
 * otherwise this is the fallback implementation of the same §4.3 rule.
 *
 * @param {AgentRecord} record
 * @param {Record<string, boolean>} [availability]  which paired activities
 *   currently have an open partner slot
 * @param {(record:AgentRecord, availability:Record<string,boolean>) => {activity:string,duration:number,paired:boolean}} [makeActivityRotation]
 * @returns {{activity:string, duration:number, paired:boolean}}
 */
export function pickNextActivity(record, availability = {}, makeActivityRotation) {
  if (typeof makeActivityRotation === 'function') {
    return makeActivityRotation(record, availability);
  }
  const rng = record.rng;
  const idx = Math.floor(rng() * LOUNGE_CLIPS.length);
  let activity = LOUNGE_CLIPS[idx];
  let paired = PAIRED_ACTIVITIES.has(activity);
  if (paired && !availability[activity]) {
    const soloIdx = Math.floor(rng() * SOLO_ACTIVITIES.length);
    activity = SOLO_ACTIVITIES[soloIdx];
    paired = false;
  }
  const duration = ROTATION_MIN_S + rng() * (ROTATION_MAX_S - ROTATION_MIN_S);
  return { activity, duration, paired };
}

/**
 * Adapts `clips.js`'s real `makeActivityRotation(rng)` (a factory returning
 * `{ pick({partnerFree}) => {activity, holdMs, degraded} }`) to the
 * `{activity, duration, paired}` shape used internally here. `agents.js`
 * never imports `./clips.js` itself (see file header), so `scene.js` passes
 * the real factory in through `AgentRuntime#step`'s `opts.makeActivityRotation`
 * once it exists; this is the seam that consumes it.
 * @param {AgentRecord} record
 * @param {Record<string, boolean>} availability
 * @param {(rng: () => number) => {pick: (opts?: {partnerFree?: (activity:string)=>boolean}) => {activity:string, holdMs:number, degraded:boolean}}} makeActivityRotationFactory
 */
function pickNextActivityFromClips(record, availability, makeActivityRotationFactory) {
  const picker = makeActivityRotationFactory(record.rng);
  const result = picker.pick({ partnerFree: (activity) => !!availability[activity] });
  return { activity: result.activity, duration: result.holdMs / 1000, paired: !result.degraded };
}

// -------------------------------------------------------------- clip mapping

/**
 * Minimal fallback for `clipForState` (specified to live in `./clips.js`,
 * which this module cannot statically import — see file header). Only covers
 * desk states; office/lounge/let_go are handled by their callers.
 * @param {AgentLike['activityState']} activityState
 */
function clipForActivity(activityState) {
  if (activityState === 'needs_input') return 'hand_raise';
  if (activityState === 'stalled') return 'slump';
  // An ended session is not producing output; it must not appear to type.
  if (activityState === 'ended') return 'slump';
  return 'type';
}

/**
 * The clip an agent should start when it arrives at `placement`.
 * @param {AgentLike} agent
 * @param {'desk'|'office'|'lounge'|'let_go'} placement
 */
function initialClipFor(agent, placement) {
  if (placement === 'desk') return clipForActivity(agent.activityState);
  if (placement === 'office') return 'stand_wait';
  return null; // lounge: chosen once the agent arrives
}

function samePoint(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y;
}

// ------------------------------------------------------------- AgentRuntime

/**
 * Registry of one runtime record per agent id: current position, target seat,
 * walk path, current clip, and activity rotation state. Advanced once per
 * frame via {@link AgentRuntime#step}; reconciled against the latest snapshot
 * via {@link AgentRuntime#sync}.
 */
export class AgentRuntime {
  constructor() {
    /** @type {Map<string, AgentRecord>} */
    this._records = new Map();
    /**
     * The plan the records' coordinates are expressed in. A rebuild produces a
     * new plan object, and every seat in it is somewhere else; see `sync`.
     * @type {Plan|null}
     */
    this._plan = null;
  }

  /** @param {string} id @returns {AgentRecord} */
  _ensure(id) {
    let rec = this._records.get(id);
    if (!rec) {
      const seed = hashString(id);
      rec = {
        id,
        x: 0,
        y: 0,
        angle: 0,
        roomId: null,
        targetSeat: null,
        path: [],
        clip: null,
        clipStartedAt: Date.now(),
        pendingClip: null,
        seated: false,
        seed,
        rng: mulberry32(seed),
        rotation: { activity: null, remaining: 0, pairedWith: null },
        initialised: false,
      };
      this._records.set(id, rec);
    }
    return rec;
  }

  /** @param {string} id @returns {AgentRecord|undefined} */
  get(id) {
    return this._records.get(id);
  }

  /** @returns {IterableIterator<AgentRecord>} */
  all() {
    return this._records.values();
  }

  /** @returns {number} */
  get size() {
    return this._records.size;
  }

  /**
   * Reconcile records against the current agent list and seat assignments.
   * New agents appear already seated (no walk-in, since we have no prior
   * position to walk in from). Existing agents whose seat or placement
   * changed get a fresh `planWalk` path; unaffected agents are left alone —
   * this is what keeps the floor from shuffling on every SSE push.
   * @param {AgentLike[]} agents
   * @param {Plan} plan
   * @param {Map<string, Seat|LoungeSpot>} seatMap
   */
  sync(agents, plan, seatMap) {
    const rooms = (plan && plan.rooms) || [];
    const doors = (plan && plan.doors) || [];
    // A new plan is a new floor: every wall, seat and corridor has moved, and
    // the record's x/y describe a building that no longer exists. Walking from
    // there to the new seat is not a walk, it is the whole population crossing
    // a floor they were never on — which is what a window resize looked like.
    // Snap instead, and let motion mean what it is supposed to mean: this
    // agent's own state changed.
    const replanned = plan !== this._plan;
    this._plan = plan || null;
    const findRoom = (id) => rooms.find((r) => r.id === id) || null;
    const roomFor = (placement, agent) => {
      if (placement === 'desk')
        return rooms.find((r) => r.kind === 'project' && r.id === agent.projectId) || null;
      if (placement === 'office') return rooms.find((r) => r.kind === 'office') || null;
      if (placement === 'lounge') return rooms.find((r) => r.kind === 'lounge') || null;
      if (placement === 'let_go') return rooms.find((r) => r.kind === 'let_go') || null;
      return null;
    };

    const seen = new Set();
    for (const agent of agents) {
      const placement = derivePlacement(agent);
      // An archived session is off the floor: it has no room, no seat and
      // nothing drawn, so it gets no record either. Keeping one would fall
      // through to the no-seat fallback and park every one of them on the
      // floor's origin — which on a real machine stacked seventeen bodies and
      // their labels into one illegible smear in the top-left corner.
      if (placement === 'let_go') continue;
      seen.add(agent.id);
      const rec = this._ensure(agent.id);
      const seat = seatMap ? seatMap.get(agent.id) || null : null;
      const destRoom = roomFor(placement, agent);

      if (!rec.initialised) {
        rec.x = seat ? seat.x : destRoom ? destRoom.x + destRoom.w / 2 : 0;
        rec.y = seat ? seat.y : destRoom ? destRoom.y + destRoom.h / 2 : 0;
        rec.angle = seat && typeof seat.angle === 'number' ? seat.angle : 0;
        rec.roomId = destRoom ? destRoom.id : null;
        rec.targetSeat = seat;
        rec.placement = placement;
        rec.path = [];
        rec.seated = placement === 'desk' || placement === 'office';
        rec.clip = initialClipFor(agent, placement);
        rec.clipStartedAt = Date.now();
        rec.initialised = true;
        continue;
      }

      const placementChanged = rec.placement !== placement;
      const seatChanged = !samePoint(rec.targetSeat, seat);
      if (replanned) {
        rec.x = seat ? seat.x : destRoom ? destRoom.x + destRoom.w / 2 : rec.x;
        rec.y = seat ? seat.y : destRoom ? destRoom.y + destRoom.h / 2 : rec.y;
        if (seat && typeof seat.angle === 'number') rec.angle = seat.angle;
        rec.path = [];
        rec.pendingClip = null;
        rec.targetSeat = seat;
        rec.roomId = destRoom ? destRoom.id : null;
        rec.seated = placement === 'desk' || placement === 'office';
        if (placementChanged) {
          rec.placement = placement;
          rec.clip = initialClipFor(agent, placement);
          rec.clipStartedAt = Date.now();
          if (placement !== 'lounge')
            rec.rotation = { activity: null, remaining: 0, pairedWith: null };
        }
        continue;
      }
      if (placementChanged || seatChanged) {
        if (seat && destRoom) {
          const fromRoom = findRoom(rec.roomId);
          const fromPoint = { x: rec.x, y: rec.y, room: fromRoom, door: doorFor(fromRoom, doors) };
          const toPoint = { x: seat.x, y: seat.y, room: destRoom, door: doorFor(destRoom, doors) };
          rec.path = planWalk(fromPoint, toPoint, rooms, plan);
          rec.pendingClip = initialClipFor(agent, placement);
          rec.roomId = destRoom.id;
        } else {
          // A placement with no seats defined yet in the plan: hold position
          // rather than walking somewhere that does not exist.
          rec.path = [];
          rec.roomId = destRoom ? destRoom.id : null;
        }
        rec.targetSeat = seat;
        rec.placement = placement;
        rec.seated = false;
        if (placement !== 'lounge') {
          rec.rotation = { activity: null, remaining: 0, pairedWith: null };
        }
      } else if (rec.path.length === 0 && placement === 'desk') {
        // Same desk, but the activity state may have changed reaction (e.g. a hand goes up)
        // without a seat/placement change — reflect it immediately, no walk required.
        const desired = initialClipFor(agent, placement);
        if (desired !== rec.clip) {
          rec.clip = desired;
          rec.clipStartedAt = Date.now();
        }
      }
    }

    for (const id of [...this._records.keys()]) {
      if (!seen.has(id)) this._records.delete(id);
    }
  }

  /**
   * Advance every record by `dtSeconds`. Call once per animation frame;
   * simply not calling this while the tab is hidden is what pauses the whole
   * simulation, including activity rotation (VISUAL-SPEC §4.3, §10).
   * @param {number} dtSeconds
   * @param {{reduced?: boolean, plan?: Plan, makeActivityRotation?: Function}} [opts]
   *   `makeActivityRotation`: the real factory from `./clips.js`, if the caller
   *   has it (see `pickNextActivityFromClips`). Falls back to `pickNextActivity`'s
   *   built-in rule otherwise.
   */
  step(dtSeconds, opts = {}) {
    const plan = opts.plan;
    const loungeRoom = plan && plan.rooms ? plan.rooms.find((r) => r.kind === 'lounge') : null;
    const records = [...this._records.values()];

    for (const rec of records) {
      stepAgent(rec, dtSeconds, opts);
    }

    if (opts.reduced) return; // "lounge rotation stops" under reduced motion (VISUAL-SPEC §10)

    // Who is standing where. Two things are read off this: whether a paired
    // activity has a partner to join, and whether a given SPOT is free.
    //
    // The second used to be missing entirely — an agent picked a spot at random
    // from the ones matching its activity, with no idea whether somebody was
    // already standing on it, so two agents regularly occupied the same end of
    // the table-tennis table.
    const occupancy = {};
    /** Which PLACE on each spot is taken, by spot id. @type {Map<string, Set<number>>} */
    const spotSlots = new Map();
    const slotsOf = (id) => {
      let set = spotSlots.get(id);
      if (!set) {
        set = new Set();
        spotSlots.set(id, set);
      }
      return set;
    };
    for (const rec of records) {
      if (rec.placement !== 'lounge') continue;
      if (rec.rotation.activity) {
        occupancy[rec.rotation.activity] = (occupancy[rec.rotation.activity] || 0) + 1;
      }
      const held = rec.targetSeat && rec.targetSeat.id;
      if (held) slotsOf(held).add(rec.targetSeat.seatIndex ?? 0);
    }
    const capacity = { table_tennis: 2, chat: 2, board_game: 4 };
    const availability = {};
    for (const a of PAIRED_ACTIVITIES) {
      availability[a] = (occupancy[a] || 0) > 0 && (occupancy[a] || 0) < (capacity[a] || 2);
    }

    const allSpots = (plan && plan.loungeSpots) || [];
    /** The lowest unoccupied place on a spot, or -1 when it is full. */
    const freeSlot = (sp, self) => {
      const cap = Math.max(1, Math.floor(sp.capacity ?? 1));
      const taken = spotSlots.get(sp.id);
      for (let i = 0; i < cap; i++) {
        if (!taken || !taken.has(i)) return i;
        if (self && self.id === sp.id && (self.seatIndex ?? 0) === i) return i;
      }
      return -1;
    };
    const freeSpots = (kind, self) =>
      allSpots.filter((sp) => sp.kind === kind && freeSlot(sp, self) >= 0);

    // Which activities can actually be performed on THIS floor right now. The
    // lounge only lays out a games table once enough agents are benched to use
    // it, so on a quiet floor most of the clip list has no furniture behind it.
    // Offering those anyway had agents playing pool in the middle of the room
    // with no table in front of them.
    const performable = new Set();
    for (const sp of allSpots) performable.add(sp.kind);

    for (const rec of records) {
      if (rec.placement !== 'lounge' || rec.path.length !== 0) continue;
      rec.rotation.remaining -= dtSeconds;
      if (rec.rotation.activity && rec.rotation.remaining > 0) continue;

      let choice = null;
      // Try a few times for an activity that has both a free spot and, where
      // the clip needs one, a partner. The rotation is cosmetic, so a bounded
      // number of attempts is right — it must never spin.
      for (let attempt = 0; attempt < ACTIVITY_PICK_ATTEMPTS; attempt++) {
        const pick =
          typeof opts.makeActivityRotation === 'function'
            ? pickNextActivityFromClips(rec, availability, opts.makeActivityRotation)
            : pickNextActivity(rec, availability);
        if (allSpots.length === 0) {
          choice = pick;
          break;
        }
        if (performable.has(pick.activity) && freeSpots(pick.activity, rec.targetSeat).length) {
          choice = pick;
          break;
        }
        if (!choice) choice = pick;
      }
      if (!choice) continue;

      const spots = freeSpots(choice.activity, rec.targetSeat);
      if (spots.length === 0 && allSpots.length > 0) {
        // Everything this agent wanted is taken. Stay where it is for a while
        // and try again, rather than walking onto somebody.
        rec.rotation.remaining = ROTATION_MIN_S / 2;
        continue;
      }
      rec.rotation.activity = choice.activity;
      rec.rotation.remaining = choice.duration;

      if (spots.length && loungeRoom) {
        const spot = spots[Math.floor(rec.rng() * spots.length) % spots.length];
        const previous = rec.targetSeat;
        if (previous && previous.id) {
          const set = spotSlots.get(previous.id);
          if (set) set.delete(previous.seatIndex ?? 0);
        }
        const slot = Math.max(0, freeSlot(spot, null));
        slotsOf(spot.id).add(slot);
        // Same rule as `assignHashed`: a spot that seats several people is a
        // piece of furniture, and the newcomer takes a free place along it
        // rather than standing on whoever is already there.
        const target = spotAt(spot, slot);
        const fromPoint = { x: rec.x, y: rec.y, room: loungeRoom };
        const toPoint = { x: target.x, y: target.y, room: loungeRoom };
        rec.path = planWalk(fromPoint, toPoint, plan.rooms, plan);
        rec.pendingClip = choice.activity;
        rec.targetSeat = target;
      } else {
        // No plan/spots supplied (e.g. plan.js not built yet): rotate the clip in place.
        rec.clip = choice.activity;
        rec.clipStartedAt = Date.now();
      }
    }
  }
}

/**
 * Advance one agent's walk, arrival, seating and destination clip by
 * `dtSeconds`. Pure with respect to everything except wall-clock time
 * (`Date.now()`, used for `clipStartedAt` so `clips.js`'s `sampleClip(name, t)`
 * can compute a phase) — movement itself is entirely `dtSeconds`-driven so it
 * is deterministic and testable without real waiting.
 *
 * @param {AgentRecord} rt
 * @param {number} dtSeconds
 * @param {{reduced?: boolean}} [opts]  `reduced`: snap straight to the final
 *   waypoint instead of interpolating (VISUAL-SPEC §10 — reduced motion).
 */
export function stepAgent(rt, dtSeconds, opts = {}) {
  if (rt.path.length === 0) return;

  if (opts.reduced) {
    const last = rt.path[rt.path.length - 1];
    rt.x = last.x;
    rt.y = last.y;
    rt.path = [];
  } else {
    let remaining = Math.max(0, dtSeconds) * WALK_SPEED;
    while (remaining > 0 && rt.path.length > 0) {
      const next = rt.path[0];
      const dx = next.x - rt.x;
      const dy = next.y - rt.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= EPS) {
        rt.path.shift();
        continue;
      }
      rt.angle = Math.atan2(dy, dx);
      if (remaining >= dist) {
        rt.x = next.x;
        rt.y = next.y;
        remaining -= dist;
        rt.path.shift();
      } else {
        const f = remaining / dist;
        rt.x += dx * f;
        rt.y += dy * f;
        remaining = 0;
      }
    }
  }

  if (rt.path.length === 0) {
    // Arrived: seat and start the destination clip. Nobody arrives on the
    // street — `AgentRuntime#step` turns them round and sends them back — so
    // their facing is left as the direction they were travelling in.
    if (rt.targetSeat && typeof rt.targetSeat.angle === 'number') rt.angle = rt.targetSeat.angle;
    rt.seated = rt.placement === 'desk' || rt.placement === 'office';
    if (rt.pendingClip) {
      rt.clip = rt.pendingClip;
      rt.pendingClip = null;
      rt.clipStartedAt = Date.now();
    }
  }
}
