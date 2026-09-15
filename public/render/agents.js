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
  RUN_SPEED,
  ROTATION_MIN_S,
  PAIRED_ACTIVITIES,
  EPS,
  hashString,
  mulberry32,
  ACTIVITY_PICK_ATTEMPTS,
  IDLE_TYPE_MIN_S,
  IDLE_TYPE_MAX_S,
  spotAt,
} from './agents-core.js';
import { planWalk, doorFor } from './agents-nav.js';
import { derivePlacement } from './agents-seats.js';
import { pickNextActivity, pickNextActivityFromClips, initialClipFor } from './agents-activity.js';
// WP-87. `./life.js` is the one new static import this file takes, and it does
// not break the rule the header states above: `life.js` is pure, imports only
// `./agents-core.js` (which imports nothing), and touches no canvas and no DOM,
// so this module still loads on its own under `node --test`. The rules it
// carries — which trip runs, which activity a bay deals, how long a hold is —
// belong beside the animation table they are stated in rather than as a fourth
// copy here.
import {
  ACTIVITY_BAY,
  FLICKER_MIN_GAP_MS,
  LIFE,
  loungeActivityFor,
  loungeHoldMs,
  tripRuns,
} from './life.js';

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

/**
 * Write down what this agent's real STATE says it should be doing at its desk,
 * and cancel whatever idle variation the director was playing over the top of
 * it (WP-28).
 *
 * This is the director rule in one function: **any real state change cancels
 * it.** The trait weighting can put `drink` on screen for 2.6 s while an agent
 * is typing; it can never keep a raised hand off the floor, delay one, or
 * survive one. `deskDesired` is what `sync` compares against on every
 * snapshot, so a variation is left alone while the state is unchanged and
 * discarded the instant it is not.
 *
 * @param {AgentRecord} rec
 * @param {string} placement
 * @param {string|null} clip
 */
function setDeskDesired(rec, placement, clip) {
  const desired = placement === 'desk' ? clip : null;
  rec.deskDesired = desired;
  rec.deskIdle.clip = null;
  // Type for a full stretch before the first variation. That is what makes a
  // state change read as work resuming, and it is why nothing but `type` can
  // be on screen in the seconds after one.
  rec.deskIdle.remaining =
    desired === 'type' ? IDLE_TYPE_MIN_S + rec.idleRng() * (IDLE_TYPE_MAX_S - IDLE_TYPE_MIN_S) : 0;
}

/**
 * IS THE OCCUPANT OF THIS PLACE SITTING DOWN? (WP-78)
 *
 * A desk has a chair; so does a visitor chair at the manager's desk. A place in
 * the office QUEUE does not - it is a mark on the carpet beside the desk - and
 * a character drawn seated over bare carpet is a character sitting on the
 * floor. Stated once because three places used to answer it, all with the same
 * expression, which is the kind of agreement that lasts until it does not.
 *
 * @param {string} placement
 * @param {import('./agents-core.js').PlacedSeat|null} [seat]
 */
export function seatedAt(placement, seat) {
  if (placement === 'desk') return true;
  if (placement !== 'office') return false;
  return !(seat && /** @type {{standing?: boolean}} */ (seat).standing === true);
}

export function samePoint(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y;
}

/**
 * WHAT THIS BENCHED AGENT DOES NEXT, as a pure function of (id, bay, cycle).
 *
 * §2: *"The activity is `BAY_ACTIVITIES[bay][hash(sessionId) % n]` and the hold
 * is `hash(sessionId, cycleIndex)` mapped into 45–90 s — never `Math.random`,
 * so two tabs on one floor show the same lounge."* Which bay is the same hash
 * over the bays the plan actually laid, so a narrow lounge that gave up its
 * games bay deals nobody a pool shot.
 *
 * @param {string} id the session id
 * @param {string[]} bays the bay names this plan laid
 * @param {number} cycle the rotation's cycle index
 * @returns {{activity:string, duration:number, paired:boolean}}
 */
export function bayActivityChoice(id, bays, cycle) {
  const bay = bays[hashString(`${id}:bay:${cycle}`) % bays.length];
  const activity = loungeActivityFor(id, bay, cycle);
  return {
    activity,
    duration: loungeHoldMs(id, cycle) / 1000,
    paired: PAIRED_ACTIVITIES.has(activity),
  };
}

/**
 * WHEN THIS CLIP STARTED, AND IT IS THE AGENT'S OWN TIMESTAMP WHEREVER THERE
 * IS ONE (WP-87, `docs/plan/12-MOTION-AND-CREW.md` §1.1).
 *
 * *"`clipStartedAt` becomes a phase offset derived from a real timestamp on the
 * agent … rather than from when this tab noticed, so two tabs draw the same
 * frame and a reload does not restart a cycle."* That is the whole of this
 * function: a hand has been up since `needsInputSince`, a review has been
 * waiting since `reviewSince`, and a session has been working since its last
 * observed activity. Each is a fact the daemon reported, so two browsers
 * looking at one floor agree about which frame of the wave they are on.
 *
 * The fallback is the caller's `now` — the injected clock — and it is used for
 * exactly the things the model has no timestamp for: a walk (which started when
 * THIS tab saw the seat change) and a lounge activity (which the rotation
 * itself chose).
 *
 * @param {AgentLike & {needsInputSince?:number|null, reviewSince?:number|null,
 *   lastActivityAt?:number, spawnedAt?:number|null}} agent
 * @param {string} placement
 * @param {number} now the injected clock
 * @returns {number} ms epoch
 */
export function clipEpochFor(agent, placement, now) {
  const ok = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (!agent) return now;
  if (placement === 'desk' || placement === 'office') {
    if (agent.activityState === 'needs_input') {
      return ok(agent.needsInputSince) ?? ok(agent.lastActivityAt) ?? now;
    }
    if (agent.activityState === 'for_review') {
      return ok(agent.reviewSince) ?? ok(agent.lastActivityAt) ?? now;
    }
    return ok(agent.lastActivityAt) ?? ok(agent.spawnedAt) ?? now;
  }
  return now;
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
    /**
     * WP-28 · the last idle tendency map, so a session that arrives after the
     * map does still gets its lean. @type {Record<string, string|null>|null}
     */
    this._tendencies = null;
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
        // WP-87. An instant on the INJECTED clock, and wherever the agent
        // carries a real timestamp for the state it is in, THAT timestamp —
        // never "when this tab first noticed". It used to be `Date.now()`,
        // subtracted from a `performance.now()`, which is an epoch instant
        // taken away from a monotonic counter: about −1.7 billion seconds,
        // survived only because a looping clip wraps and because every golden
        // was the reduced-motion render. See `clipEpochFor` below.
        clipStartedAt: 0,
        pendingClip: null,
        seated: false,
        seed,
        rng: mulberry32(seed),
        rotation: { activity: null, remaining: 0, pairedWith: null },
        // WP-87 · the lounge rotation's cycle index. The activity and the hold
        // are a hash of (id, bay, cycle), so this is what makes the next one
        // different from this one without a random source anywhere near it.
        rotationCycle: 0,
        // WP-87 · the four instants the character-life director reads, all of
        // them on the injected clock and all of them null until the event they
        // name has actually been OBSERVED. `life.js` draws nothing from a null.
        /** @type {number|null} */ toolSince: null,
        /** @type {number|null} */ flickerAt: null,
        /** @type {number|null} */ spawnAt: null,
        /** @type {number|null} */ leftAt: null,
        /** WP-87 · this trip is a run, not a walk. See `tripRuns`. */
        running: false,
        /** The agent this record was last synced against; see `sync`. */
        /** @type {AgentLike|null} */ agent: null,
        // WP-28. The desk idle director's own state, and its own RNG stream.
        // Its own, deliberately: sharing `rng` would mean that adding a
        // variation at somebody's desk re-rolled every benched agent's lounge
        // sequence, which is the same reason WP-20's appearance hash is not
        // `hashString` (docs/DEVIATIONS.md §105).
        //
        // `deskDesired` is the clip the agent's real STATE asks for. The
        // director may play something else over the top of it for a few
        // seconds; the moment the state's own answer changes, `sync` cancels
        // whatever is playing and the state wins. A hand going up is never
        // animated around.
        idleRng: mulberry32((seed ^ 0x9e3779b9) >>> 0),
        deskDesired: /** @type {string|null} */ (null),
        deskIdle: { clip: /** @type {string|null} */ (null), remaining: 0 },
        /** @type {string|null} */
        tendency: (this._tendencies && this._tendencies[id]) || null,
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

  /**
   * WP-28 · which idle clip each agent leans on, keyed by agent id.
   *
   * A hint, and only a hint: an id with no entry, an unknown tendency word and
   * an empty map all mean "no lean", and the director then weights the three
   * variations evenly. It changes nothing about placement, state, or which
   * clips exist — see `makeIdleRotation` in `./clips.js`.
   *
   * @param {Record<string, string|null>|null|undefined} map
   */
  setTendencies(map) {
    for (const rec of this._records.values()) {
      rec.tendency = (map && map[rec.id]) || null;
    }
    this._tendencies = map || null;
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
   * @param {{now?:number}} [opts] WP-87. `now` is the INJECTED clock
   *   (`public/clock.js` through `scene-agent.js`'s `animMs()`), and passing it
   *   is what switches on the two one-shots at the ends of a session's life:
   *   with a real instant a departing figure folds away over `despawn`'s 0.42 s
   *   and a new one pops in over `spawn`'s 0.32 s; without one — a caller that
   *   has no clock to give, which is every unit test that predates this — the
   *   old behaviour holds exactly and a record that left the snapshot is gone
   *   the same frame.
   */
  sync(agents, plan, seatMap, opts = {}) {
    const timed = typeof opts.now === 'number' && Number.isFinite(opts.now);
    const now = timed ? /** @type {number} */ (opts.now) : 0;
    // A FIRST SYNC IS NOT A HUNDRED ARRIVALS. §2's spawn is *"an id in this
    // snapshot that was not in the LAST"*, and on the first snapshot there is
    // no last — so the population a tab opens onto is simply present, and only
    // what appears afterwards pops in.
    //
    // "Has held somebody", not "has been called": `Scene#setState` syncs TWICE
    // on the first snapshot — once with the PREVIOUS agent list, to bridge the
    // re-plan, and that list is empty on the first one. A flag set by the call
    // rather than by the population therefore made the whole floor arrive, and
    // the `demo@motion` capture photographed twenty-seven robots at a third of
    // their size, mid pop-in. That capture is exactly what it is for.
    const hadSnapshot = this._synced === true;
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
      const existed = this._records.has(agent.id);
      const rec = this._ensure(agent.id);
      const destRoom = roomFor(placement, agent);
      // The agent this record is standing in for, kept by reference so a figure
      // that has LEFT the snapshot can still be drawn while it folds away —
      // `scene-draw.js` looks here when the id is no longer in `_agentsById`.
      rec.agent = agent;
      // WP-87 · THE VISOR FLICKER'S ONE GATE, and it is the only place on the
      // floor that can see one `currentTool.since` replace another. §2: the
      // flash fires on a tool call the adapter genuinely observed opening, and
      // is *"capped at one per 0.5 s, because a tool loop opening six calls in
      // a second would otherwise strobe"*. A runtime that reports no tool
      // events at all leaves `since` undefined and nothing ever fires.
      const since = agent.currentTool && agent.currentTool.since;
      if (typeof since === 'number' && Number.isFinite(since) && since !== rec.toolSince) {
        rec.toolSince = since;
        if (rec.flickerAt === null || since - rec.flickerAt >= FLICKER_MIN_GAP_MS) {
          rec.flickerAt = since;
        }
      } else if (!agent.currentTool) {
        rec.toolSince = null;
      }
      // An id that was not in the last snapshot pops in (§2's `spawn`).
      if (!existed && hadSnapshot && timed) rec.spawnAt = now;
      // …and one that came back before its fold-away finished is simply here.
      rec.leftAt = null;

      if (!rec.initialised) {
        rec.x = seat ? seat.x : destRoom ? destRoom.x + destRoom.w / 2 : 0;
        rec.y = seat ? seat.y : destRoom ? destRoom.y + destRoom.h / 2 : 0;
        rec.angle = seat && typeof seat.angle === 'number' ? seat.angle : 0;
        rec.roomId = destRoom ? destRoom.id : null;
        rec.targetSeat = seat;
        rec.placement = placement;
        rec.path = [];
        rec.seated = seatedAt(placement, seat);
        rec.clip = initialClipFor(agent, placement);
        rec.clipStartedAt = clipEpochFor(agent, placement, now);
        setDeskDesired(rec, placement, rec.clip);
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
        rec.seated = seatedAt(placement, seat);
        if (placementChanged) {
          rec.placement = placement;
          rec.clip = initialClipFor(agent, placement);
          rec.clipStartedAt = clipEpochFor(agent, placement, now);
          setDeskDesired(rec, placement, rec.clip);
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
          // WP-87 · WALK, OR RUN. §2, and it is the one piece of motion on this
          // floor that is a CLAIM rather than a state: the only trip that runs
          // is an agent heading for Your Office because it needs input.
          // `for_review` walks — it is waiting on you, but it is not blocked
          // mid-turn — and nothing else on this floor ever runs at all, which
          // is what keeps the claim readable across a room.
          rec.running = tripRuns(placement, agent);
          rec.pendingClip = initialClipFor(agent, placement);
          setDeskDesired(rec, placement, rec.pendingClip);
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
      } else if (rec.path.length === 0 && (placement === 'desk' || placement === 'office')) {
        // Same desk, but the activity state may have changed reaction (e.g. a hand goes up)
        // without a seat/placement change — reflect it immediately, no walk required.
        //
        // WP-78 added `office` to it. A session can now go `needs_input` ->
        // `for_review` without changing seat (the queue order did not move),
        // and the hand has to come down when it does.
        //
        // WP-28 moved the comparison from `rec.clip` to `rec.deskDesired`.
        // `rec.clip` is what is ON SCREEN and the idle director may have put a
        // 2.6 s `drink` there; comparing against it would have snapped every
        // variation away on the next snapshot, which arrives several times a
        // second. `deskDesired` is what the agent's STATE asks for, so this
        // still fires on exactly the changes it fired on before — and only on
        // those. The `else` restores the state's own clip whenever no
        // variation is running, which is what the old comparison did for
        // anything that had drifted.
        const desired = initialClipFor(agent, placement);
        if (desired !== rec.deskDesired) {
          rec.clip = desired;
          rec.clipStartedAt = clipEpochFor(agent, placement, now);
          setDeskDesired(rec, placement, desired);
        } else if (!rec.deskIdle.clip && desired !== rec.clip) {
          rec.clip = desired;
          rec.clipStartedAt = clipEpochFor(agent, placement, now);
        }
      }
    }

    // WHAT LEAVES, AND HOW LONG IT TAKES TO GO (WP-87 §2's `despawn`).
    //
    // A session that is no longer in the snapshot folds away over 0.42 s rather
    // than vanishing between two frames, and its record is kept until it has.
    // It is NOT what an ended session gets: `ended` stays on the floor (§5.1's
    // occupancy rule) and powers down where it sits, because folding one away
    // would say it had left the building.
    //
    // With no injected clock — a caller that gave none — there is no way to
    // time a fold, so the record goes the same frame it always did.
    // See `hadSnapshot` above: the floor has a previous population only once it
    // has actually held one.
    if (seen.size > 0) this._synced = true;

    const gone = LIFE.despawn.period * 1000;
    for (const id of [...this._records.keys()]) {
      if (seen.has(id)) continue;
      const rec = this._records.get(id);
      if (!timed || !rec || !rec.initialised) {
        this._records.delete(id);
        continue;
      }
      if (rec.leftAt === null) rec.leftAt = now;
      if (now - rec.leftAt >= gone) this._records.delete(id);
    }
  }

  /**
   * Advance every record by `dtSeconds`. Call once per animation frame;
   * simply not calling this while the tab is hidden is what pauses the whole
   * simulation, including activity rotation (VISUAL-SPEC §4.3, §10).
   * @param {number} dtSeconds
   * @param {{reduced?: boolean, plan?: Plan, now?: number,
   *   makeActivityRotation?: (rng: () => number) => {pick: (opts?: {partnerFree?: (activity:string)=>boolean}) => {activity:string, holdMs:number, degraded:boolean}},
   *   makeIdleRotation?: (rng: () => number, opts?: {tendency?: string|null}) => {pick: () => {clip:string, holdS:number}}}} [opts]
   *   `now` (WP-87): the INJECTED clock, for every clip phase this pass writes.
   *   `dt` stays the frame clock's, because an interval is a fact about the tab.
   *   `makeActivityRotation` was declared as a bare `Function`, which says
   *   nothing about what `pickNextActivityFromClips` then calls it with (WP-22).
   *   `makeActivityRotation`: the real factory from `./clips.js`, if the caller
   *   has it (see `pickNextActivityFromClips`). Falls back to `pickNextActivity`'s
   *   built-in rule otherwise.
   */
  step(dtSeconds, opts = {}) {
    const plan = opts.plan;
    const now = typeof opts.now === 'number' && Number.isFinite(opts.now) ? opts.now : 0;
    const loungeRoom = plan && plan.rooms ? plan.rooms.find((r) => r.kind === 'lounge') : null;
    const records = [...this._records.values()];

    for (const rec of records) {
      stepAgent(rec, dtSeconds, opts);
    }

    if (opts.reduced) return; // "lounge rotation stops" under reduced motion (VISUAL-SPEC §10)

    // WP-28 · the desk idle director. §4.1 asks for `drink` "occasionally
    // during working" and `stretch` as an "occasional idle variation";
    // `IDLE_VARIATIONS` has named the three since the clips landed and nothing
    // had ever played them. This is that, plus the one mechanical effect a
    // trait has anywhere in the product: a weighting on which of four clips an
    // already-idle agent is a little more likely to reach for.
    //
    // It runs only for an agent that is SEATED AT ITS DESK AND TYPING —
    // `deskDesired === 'type'` — so a raised hand, a stall, a walk and a
    // review are all untouched, and it is below the reduced-motion return, so
    // under `prefers-reduced-motion` no variation is ever picked.
    if (typeof opts.makeIdleRotation === 'function') {
      for (const rec of records) {
        if (rec.placement !== 'desk' || rec.path.length !== 0) continue;
        if (rec.deskDesired !== 'type') continue;
        rec.deskIdle.remaining -= dtSeconds;
        if (rec.deskIdle.remaining > 0) continue;
        const pick = opts.makeIdleRotation(rec.idleRng, { tendency: rec.tendency }).pick();
        rec.clip = pick.clip;
        rec.clipStartedAt = now;
        rec.deskIdle.clip = pick.clip === 'type' ? null : pick.clip;
        rec.deskIdle.remaining = pick.holdS;
      }
    }

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

    // WP-87 · WHICH BAYS THIS LOUNGE ACTUALLY LAID. §3.7 gives up bays on a
    // narrow floor — games first, then quiet — so the set is a fact about this
    // plan rather than about the design, and it is read off the spots because
    // a bay with no spot in it is a bay nobody can be in.
    /** @type {string[]} */
    const bays = [];
    for (const sp of allSpots) {
      const bay = sp.bay || ACTIVITY_BAY[sp.kind];
      if (bay && !bays.includes(bay)) bays.push(bay);
    }

    for (const rec of records) {
      if (rec.placement !== 'lounge' || rec.path.length !== 0) continue;
      rec.rotation.remaining -= dtSeconds;
      if (rec.rotation.activity && rec.rotation.remaining > 0) continue;

      let choice = null;
      let cycle = rec.rotationCycle;
      // Try a few times for an activity that has both a free spot and, where
      // the clip needs one, a partner. The rotation is cosmetic, so a bounded
      // number of attempts is right — it must never spin.
      //
      // WP-87 REPLACED THE ROLL WITH A HASH (§1.1, §2). The activity is
      // `BAY_ACTIVITIES[bay][hash(id, bay, cycle) % n]` and the hold is
      // `hash(id, cycle)` mapped into 45–90 s, so two tabs on one floor show
      // the same lounge, a reload does not re-deal it, and a golden can
      // photograph it. A retry is the NEXT cycle index rather than another
      // draw from a stream, which is what keeps the whole sequence a pure
      // function of the session id. `makeActivityRotation` stays the fallback
      // for a plan that has laid no bays at all.
      for (let attempt = 0; attempt < ACTIVITY_PICK_ATTEMPTS; attempt++) {
        cycle = rec.rotationCycle + attempt;
        const pick = bays.length
          ? bayActivityChoice(rec.id, bays, cycle)
          : typeof opts.makeActivityRotation === 'function'
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
      rec.rotationCycle = cycle + 1;

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
        // WP-87: which of the free places, from the same hash and the same
        // cycle index rather than from the record's PRNG stream. A stream is
        // deterministic but stateful, so an agent that re-rolled once because
        // a table was busy shifted every choice it would ever make afterwards.
        const spot = spots[hashString(`${rec.id}:spot:${cycle}`) % spots.length];
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
        rec.clipStartedAt = now;
      }
    }
  }
}

/**
 * Advance one agent's walk, arrival, seating and destination clip by
 * `dtSeconds`.
 *
 * PURE SINCE WP-87. It used to read `Date.now()` on arrival, for the
 * `clipStartedAt` that `clips.js`'s `sampleClip(name, t)` computes a phase
 * from; that instant is the caller's now, from the injected clock, so nothing
 * under any draw path reads the machine's own clock at all. Movement itself was
 * always entirely `dtSeconds`-driven and is unchanged.
 *
 * @param {AgentRecord} rt
 * @param {number} dtSeconds
 * @param {{reduced?: boolean, now?: number}} [opts]  `reduced`: snap straight to
 *   the final waypoint instead of interpolating (VISUAL-SPEC §10 — reduced
 *   motion). `now`: the injected clock, for the arrival clip's phase.
 */
export function stepAgent(rt, dtSeconds, opts = {}) {
  if (rt.path.length === 0) return;

  if (opts.reduced) {
    const last = rt.path[rt.path.length - 1];
    rt.x = last.x;
    rt.y = last.y;
    rt.path = [];
  } else {
    // WP-87 · `run` covers `RUN_SPEED / WALK_SPEED` more ground per second than
    // `walk` does, which is §2's own 4.6 : 2.6. The absolute figures are this
    // floor's rather than the document's — see `RUN_SPEED`.
    let remaining = Math.max(0, dtSeconds) * (rt.running === true ? RUN_SPEED : WALK_SPEED);
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
    rt.seated = seatedAt(rt.placement, rt.targetSeat);
    // The trip is over, so the claim it carried is over too: nobody stands
    // still and runs.
    rt.running = false;
    if (rt.pendingClip) {
      rt.clip = rt.pendingClip;
      rt.pendingClip = null;
      rt.clipStartedAt =
        typeof opts.now === 'number' && Number.isFinite(opts.now) ? opts.now : rt.clipStartedAt;
    }
  }
}
