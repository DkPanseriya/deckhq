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
 *   - `derivePlacement()` USED TO mirror `placement()` in `src/core/model.mjs`,
 *     and they had drifted. WP-22 made it an alias of the one copy in
 *     `public/floor-rule.js`, which `model.mjs` imports too. That module is
 *     pure — no DOM, no `node:` import, no top-level side effect — so it is
 *     legal on both sides of the boundary and this file stays loadable on its
 *     own under `node --test`.
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

/**
 * The plan's own shapes, by reference rather than by copy.
 *
 * These were hand-written duplicates of `plan.js`'s typedefs, and they had
 * drifted: `Room` was missing `door`, `navEntry` and `navLineId` (every one of
 * which `planWalk` reads), `Plan` was missing `hidden` (which `assignSeats`
 * reads on its first line), and `Room.kind` did not know about corridors — so
 * `scene.js`, which passes ONE plan to both modules, was passing a value of a
 * type that did not match the parameter (WP-22).
 *
 * A JSDoc `import()` is a comment. It compiles to nothing, so the rule in the
 * header above — this module never statically imports `./plan.js`, and stays
 * loadable on its own under `node --test` — is untouched.
 *
 * ============================================================================
 * WP-22 follow-up · this file is the runtime: one record per agent, stepped
 * once per frame. The rest is four modules, every name re-exported from here:
 *
 *   agents-core.js      the constants, the seeded randomness, the camera
 *   agents-nav.js       doors, corridors, and planWalk
 *   agents-seats.js     derivePlacement, and who sits where
 *   agents-activity.js  which activity comes next, and its clip
 *
 * All five are pure — no `node:` import, no `document`, no `window` — which
 * is the rule this file's header states above and which the split had to
 * keep: nine test files load this side of the renderer directly under
 * `node --test`.
 * ============================================================================
 */
import {
  WALK_SPEED,
  ROTATION_MIN_S,
  PAIRED_ACTIVITIES,
  EPS,
  hashString,
  mulberry32,
  ACTIVITY_PICK_ATTEMPTS,
  spotAt,
} from './agents-core.js';
import { planWalk, doorFor } from './agents-nav.js';
import { derivePlacement } from './agents-seats.js';
import { pickNextActivity, pickNextActivityFromClips, initialClipFor } from './agents-activity.js';

export * from './agents-core.js';
export * from './agents-nav.js';
export * from './agents-seats.js';
export * from './agents-activity.js';

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

export function samePoint(a, b) {
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
      return null;
    };

    const hidden = (plan && plan.hidden) || null;
    const seen = new Set();
    for (const agent of agents) {
      const placement = derivePlacement(agent);
      // An archived session is off the floor: it has no room, no seat and
      // nothing drawn, so it gets no record either. Keeping one would fall
      // through to the no-seat fallback and park every one of them on the
      // floor's origin — which on a real machine stacked seventeen bodies and
      // their labels into one illegible smear in the top-left corner.
      //
      // The same is true of anyone the plan hides (`plan.hidden`): an agent
      // who went home, and an agent at a desk in a project with no room.
      if (placement === 'let_go') continue;
      if (hidden && hidden.has(agent.id)) continue;
      const seat = seatMap ? seatMap.get(agent.id) || null : null;
      // WP-41. A junior with no seat has no parent on the floor to stand
      // beside (`assignSeats` places one only when the parent has a seat).
      // Same rule as an archived session: no seat, no record, nothing drawn —
      // rather than falling through to the room-centre fallback, which would
      // stack every orphaned junior on one spot.
      if (agent.subagent === true && !seat) continue;
      seen.add(agent.id);
      const rec = this._ensure(agent.id);
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
   * @param {{reduced?: boolean, plan?: Plan,
   *   makeActivityRotation?: (rng: () => number) => {pick: (opts?: {partnerFree?: (activity:string)=>boolean}) => {activity:string, holdMs:number, degraded:boolean}}}} [opts]
   *   `makeActivityRotation` was declared as a bare `Function`, which says
   *   nothing about what `pickNextActivityFromClips` then calls it with (WP-22).
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
