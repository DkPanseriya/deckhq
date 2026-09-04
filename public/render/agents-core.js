/**
 * The floor's constants, its two seeded-randomness primitives, and the
 * camera transform (WP-22 follow-up).
 *
 * Split out of `agents.js` unchanged: walk speed, the rotation window, the
 * lounge clip list, WP-41's junior offsets, the FNV hash and mulberry32 that
 * make every per-agent choice deterministic, world/screen conversion, and the
 * level-of-detail step.
 *
 * Pure, like every `agents-*` module and `agents.js` itself: no `node:`
 * import, no `document`, no `window`, no canvas. That is what lets
 * `test/unit/*.mjs` load this side of the renderer directly under
 * `node --test` (docs/DEVIATIONS.md §122).
 */

/** @typedef {import('./plan.js').Seat} Seat */
/** @typedef {import('./plan.js').LoungeSpot} LoungeSpot */
/** @typedef {import('./plan.js').Door} Door */
/** @typedef {import('./plan.js').Room} Room */
/** @typedef {import('./plan.js').NavLine} NavLine */
/** @typedef {import('./plan.js').Plan} Plan */

/**
 * A seat AFTER `assignSeats` has placed somebody in it.
 *
 * The plan hands out bare `Seat`s and identified `LoungeSpot`s; the seating
 * pass adds which place along a bench somebody took, whether they overflowed
 * past the last chair, and whether they are a junior standing beside a parent.
 * Those five fields were being written and read with nothing declaring them.
 *
 * @typedef {((Seat|LoungeSpot) & {
 *   id?: string,
 *   kind?: string,
 *   capacity?: number,
 *   seatIndex?: number,
 *   overflow?: boolean,
 *   junior?: boolean,
 *   partnerOf?: string,
 * })} PlacedSeat
 */

/**
 * The subset of `Agent` (src/core/model.mjs) this module reads.
 * @typedef {object} AgentLike
 * @property {string} id
 * @property {string} projectId
 * @property {'working'|'needs_input'|'stalled'|'for_review'|'ended'} activityState
 * @property {'active'|'benched'|'let_go'} ackState
 * @property {number|null} reviewSince
 * @property {boolean} [subagent]   WP-41: this is a junior. Read by
 *   `derivePlacement`, and it was not declared here even though the whole
 *   junior seating pass turns on it.
 * @property {string|null} [parentId]  the senior it stands beside.
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
 * @property {PlacedSeat|null} targetSeat
 * @property {{x:number,y:number}[]} path   remaining waypoints (plan units)
 * @property {string|null} clip
 * @property {number} clipStartedAt     ms epoch
 * @property {string|null} pendingClip  clip to switch to on arrival
 * @property {boolean} seated
 * @property {number} seed              32-bit hash of `id`
 * @property {() => number} rng         seeded PRNG, [0,1)
 * @property {{activity:string|null, remaining:number, pairedWith:string|null}} rotation
 * @property {() => number} idleRng     WP-28. The desk idle director's own
 *   seeded PRNG. Its own so that adding a variation at a desk cannot re-roll
 *   anybody's lounge rotation.
 * @property {string|null} deskDesired  WP-28. The clip this agent's real STATE
 *   asks for at its desk, or null off a desk. The director may play a
 *   variation over the top of it; a change to THIS cancels that.
 * @property {{clip:string|null, remaining:number}} deskIdle  WP-28. The
 *   variation currently playing over `deskDesired`, and how long is left of
 *   the current hold.
 * @property {string|null} tendency     WP-28. Which idle clip this agent leans
 *   on, from `GET /api/traits`, or null. A weighting and nothing else.
 * @property {boolean} initialised
 * @property {string} [placement] what `derivePlacement()` said when this
 *   record was last synced. Written by `sync` and read by the rotation and
 *   the walk planner; it was never declared (WP-22).
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

/**
 * How long a working agent types between idle variations, seconds (WP-28).
 * Mirrors `IDLE_TYPE_MIN_S`/`IDLE_TYPE_MAX_S` in `./clips.js` for the same
 * reason `LOUNGE_CLIPS` is mirrored below: `agents.js` never imports
 * `./clips.js` (see its header), and the director's first hold is set in
 * `sync`, where the injected factory is not in hand. `test/unit/clips.test.mjs`
 * asserts the two copies agree.
 */
export const IDLE_TYPE_MIN_S = 20;
export const IDLE_TYPE_MAX_S = 45;

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

export const EPS = 1e-6;

/**
 * How far from a spot an overflow occupant stands, in plan units. Only ever
 * used when there are more agents than places — see `assignHashed`.
 */
export const OVERFLOW_RING_R = 1.3;

/** Pitch between two people sharing one piece of furniture, in plan units. */
export const SEAT_SPREAD = 2.2;

/**
 * How far to the side of its parent a junior stands, in plan units (WP-41).
 *
 * One seat pitch, and that is not a coincidence: WP-50 sizes a room's table by
 * the agents at desks in it, and juniors are counted among them, so a senior
 * with two juniors already has two extra seats' worth of table. Standing each
 * junior at one of them is the same arithmetic read back out.
 *
 * It has to be at least this. Measured at the demo floor's fit scale
 * (~12 px/U), the first attempt at 1.5 U put two junior labels 36 px apart
 * with about 45 px of text in each, and the collision pass had to stack them.
 * At a seat pitch the two juniors are 5.2 U apart — the first is on the
 * parent's left and the second on its right — and both labels sit clear.
 *
 * `SEAT_PITCH` in `plan.js` is the same 2.6; the two files are either side of
 * the static-file boundary and cannot import from one another, which is the
 * same reason `derivePlacement` exists twice.
 */
export const JUNIOR_OFFSET = 2.6;

/**
 * How far BEHIND its parent's chair a junior stands, in plan units.
 *
 * Zero would put a junior in the seat line, which reads as three people trying
 * to sit on one chair; the juniors are standing at the desk, not sitting at
 * it, which is the picture `08` B7 asks for.
 *
 * A chair is 2 U deep and sits 0.15 U off the table, so 1.6 U would already
 * clear the back of it — and 1.6 U was wrong. A junior is one seat pitch to
 * the side, which is exactly where the NEXT chair is, and on the demo floor
 * that chair has somebody in it: at 1.6 U the junior was drawn standing
 * through its neighbour. A body is `BODY_HEIGHT_U` ≈ 2.52 U, so 2.8 U puts a
 * whole body's clearance between the standing row and the seated one.
 */
export const JUNIOR_BACK = 2.8;

/**
 * The `index`-th place on a seat, spread ALONG the furniture (perpendicular to
 * the way its occupants face). A single-capacity spot is its own only place.
 * @param {PlacedSeat} seat
 * @param {number} index
 */
export function spotAt(seat, index) {
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
export const ACTIVITY_PICK_ATTEMPTS = 4;

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

/** @param {number} v @param {number} lo @param {number} hi */
export function clampNum(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
