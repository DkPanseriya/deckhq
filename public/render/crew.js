/**
 * THE CREW — WP-89, `docs/plan/12-MOTION-AND-CREW.md` §3.
 *
 * Three or more juniors live at once turn a parent's desk into a formation:
 * juniors seated on the floor in an arc around the chair, a laptop each, and one
 * cable per junior running back to a port on the desk's front edge. This file is
 * the whole of the geometry and the whole of the motion — where each body sits,
 * where its laptop goes, what route its cable takes, how many pulses run up it
 * and how a cable dies. It draws nothing and reads no clock of its own.
 *
 * FOUR RULES, ALL OF THEM §1's AND §3's.
 *
 *   1. **Pure, and deterministic.** No `Date.now()`, no `Math.random()`, no DOM,
 *      no canvas, no `node:` import. Every position is a function of the seat,
 *      the room and the member count; every phase is a function of the injected
 *      clock and a real timestamp. `node --test` loads it directly (§122).
 *   2. **Nothing animates that was not observed.** A pulse runs only while that
 *      junior's transcript grew inside the stall window (`juniorActive`), and it
 *      runs junior → parent and never the other way, *"because that is the only
 *      direction data goes"*. A junior whose file has stopped gets a grey cable
 *      and no pulses.
 *   3. **No body is drawn outside its room.** The arc is offered and can be
 *      REFUSED: `crewArc` reports `fits: false` when any seat would land outside
 *      the walls, and `assignSeats` falls back to WP-59d's wrapping rows.
 *   4. **No allocation per frame.** The arc and the cable routes are a function
 *      of seat geometry, which only moves when the plan does, so they are
 *      computed in the seating pass and stored. Per frame a cable costs one
 *      stroke and at most four pulse positions, each read out of a shared
 *      scratch (`pulseAt`).
 */

import { JUNIOR_PAD } from './agents-core.js';
import { CREW_DRAW_CAP, CREW_ACTIVE_MS, juniorActive } from '../floor-rule.js';
import { registerBodyScale, scaleAll } from './plan-scale.js';

export { CREW_DRAW_CAP, CREW_THRESHOLD, CREW_ACTIVE_MS, juniorActive } from '../floor-rule.js';

// ---------------------------------------------------------------- constants

/**
 * HOW BIG A CREW MEMBER IS DRAWN, as a fraction of its parent.
 *
 * The brief asks for 0.60–0.70 and §3.2 chose 0.66; this ships **0.65**, the
 * middle of the band, and the difference between the two is under a pixel at
 * every scale this floor draws at. It goes through `characterScaleFor` like
 * every other body, so §96's 16 px legibility floor still binds and a crew at a
 * tight fit stops shrinking rather than becoming texture.
 *
 * It applies to a member OF A FORMATION only. A parent with one or two juniors
 * keeps `JUNIOR_SCALE`, which is what keeps every committed golden at 0 px: the
 * `demo` floor's senior has two.
 */
export const CREW_SCALE = 0.65;

/**
 * How wide the arc opens, in radians, measured about the direction away from
 * the desk. 0.62π is 112°: wide enough that twelve juniors are an arc rather
 * than a queue, and narrow enough that the outermost member still sits BEHIND
 * the port line — which is what lets every cable route with two bends and no
 * crossings (see `cableLanes`).
 */
export const CREW_ARC_SPAN = Math.PI * 0.62;

/**
 * The chord between two neighbours on the arc: one crew member's own body
 * width, which is `JUNIOR_ROW` (one body's clearance) taken at `CREW_SCALE`.
 * The radius grows until the arc is at least this loose, which is why a crew of
 * twelve asks for a bigger circle than a crew of three rather than a denser one.
 */
export let CREW_PITCH = 1.82;

/**
 * The smallest radius the arc is ever drawn at: one body's clearance from the
 * parent's chair (`JUNIOR_BACK`, 2.8) plus the half-body every position on this
 * floor keeps from anything else (`JUNIOR_PAD`, 1.4). Below it a junior is
 * sitting in its parent's lap.
 */
export let CREW_R_MIN = 4.2;

/** How far in front of a member — toward the desk — its laptop sits. */
export let CREW_LAPTOP_GAP = 0.9;

/** Pitch between two ports along the desk's front edge, in seat order. */
export let CREW_PORT_PITCH = 0.55;

/** The first cable lane, measured back from the port line. */
export let CREW_LANE_0 = 0.3;

/** The gap between one cable's lane and the next. */
export let CREW_LANE_STEP = 0.22;

/** How far beside the desk the `+N` chip sits when a crew is over the cap. */
export let CREW_CHIP_OUT = 2.4;

// ------------------------------------------------------------------ motion

/**
 * How long a cable takes to draw on when a junior arrives, and to retract when
 * one leaves. §3.2's own 0.30 s, and the same figure the fold uses.
 */
export const CREW_CABLE_MS = 300;

/**
 * How long the cable takes to go grey and the laptop to fold once a junior's
 * transcript stops moving.
 *
 * It is keyed to the file going quiet rather than to the id leaving the
 * snapshot, and that is §3.1's own sentence: *"the only honest end signal is
 * that the file stopped moving"*. A junior that leaves the snapshot outright
 * still gets the retract, through the figure's own `despawn`.
 */
export const CREW_FOLD_MS = 300;

/**
 * How many pulses run up one cable per loop, and how long a loop is.
 *
 * §3.2 asks for *"the junior's own observed events per minute over a trailing
 * window, quantised to 1, 2 or 4 per loop and capped at 4"*. **What is built is
 * the recency band rather than a rate**, and the reason is in §3.1: the daemon
 * polls, so the finest honest statement about a junior is *this file moved
 * between two polls*. A rate would need a history of polls, that history would
 * live in the browser, and a golden would then be a function of how many polls
 * happened while the capture settled. The band is a pure function of the
 * snapshot and of the injected clock, it carries the same information at poll
 * resolution, and it quantises to the same 1 / 2 / 4. Recorded in
 * `docs/DEVIATIONS.md` §178.
 */
export const CREW_PULSE_MS = 1400;
export const CREW_PULSE_MAX = 4;

// ----------------------------------------------------------------- the arc

/**
 * THE SEAT'S OWN FRAME: `(u, v)` to world, where `u` runs along the desk and `v`
 * runs back from it into the open floor of the room — which is where
 * `juniorSpots` has put a junior since WP-41. One function, so the arc, the
 * laptops, the ports, the lanes and every reroute are all in the same axes and
 * cannot disagree about which way is out.
 * @param {{x:number,y:number,angle?:number}} anchor
 * @returns {(u:number, v:number) => {x:number, y:number}}
 */
export function crewFrame(anchor) {
  const facing = typeof anchor.angle === 'number' ? anchor.angle : 0;
  const ax = Math.cos(facing + Math.PI / 2);
  const ay = Math.sin(facing + Math.PI / 2);
  const bx = -Math.cos(facing);
  const by = -Math.sin(facing);
  return (u, v) => ({ x: anchor.x + ax * u + bx * v, y: anchor.y + ay * u + by * v });
}

/** @param {number} n @returns {number} radians between two neighbours */
function pitchAngle(n) {
  return n > 1 ? CREW_ARC_SPAN / (n - 1) : 0;
}

/**
 * The radius an arc of `n` has to open to before its neighbours are a body
 * apart. Never below `CREW_R_MIN`, so a crew of three is not drawn in its
 * parent's chair.
 * @param {number} n
 * @returns {number} plan units
 */
export function crewRadius(n) {
  const count = Math.max(1, Math.floor(n) || 1);
  if (count < 2) return CREW_R_MIN;
  const half = pitchAngle(count) / 2;
  const chord = Math.sin(half);
  const needed = chord > 1e-9 ? CREW_PITCH / (2 * chord) : CREW_R_MIN;
  return Math.max(CREW_R_MIN, needed);
}

/**
 * THE FLOOR A CREW ASKS FOR, as a box in plan units — the arc's bounding box
 * plus one body's clearance, which is §3.2's own `crewFootprint(n)`.
 *
 * `plan.js` adds it to the room's bid and WP-50's packing does the rest, exactly
 * as a break-out group grows a room in WP-85b. Measured off the ANCHOR, so `h`
 * is the depth behind the parent's chair and `w` is the width across it.
 *
 * At medium: a crew of three or five is 8.8 × 6.0 U at radius 4.2; a crew of
 * twelve is 18.8 × 12.1 U at radius 10.3.
 * @param {number} n
 * @returns {{w:number, h:number, radius:number}}
 */
export function crewFootprint(n) {
  const count = Math.max(0, Math.floor(n) || 0);
  if (count <= 0) return { w: 0, h: 0, radius: 0 };
  const radius = crewRadius(count);
  return {
    w: 2 * radius * Math.sin(CREW_ARC_SPAN / 2) + CREW_PITCH,
    h: radius + CREW_PITCH,
    radius,
  };
}

/**
 * THE SEATS, THE LAPTOPS, THE PORTS AND THE CABLE LANES — everything the draw
 * needs, in world coordinates, computed once per plan.
 *
 * The frame is the seat's own: `along` is the way the parent faces turned a
 * quarter, and `back` is the reverse of the way it faces — the open floor of the
 * room, which is where `juniorSpots` already puts a junior. A member sits at
 * `(radius, theta)` in that frame and faces its parent; its laptop sits one
 * `CREW_LAPTOP_GAP` nearer along the same ray; its port is the `i`-th place
 * along the desk's front edge, in the same order, so no two cables cross.
 *
 * @param {{x:number,y:number,angle?:number}} anchor the parent's own seat
 * @param {{x:number,y:number,w:number,h:number}|null} room the room it is in
 * @param {number} n how many members are DRAWN (already capped)
 * @param {{x:number,y:number,w:number,h:number}[]} [obstacles] world-space
 *   furniture footprints a cable may not run through — the room's own zones,
 *   which is every table in it. Baked into the route here rather than checked
 *   per frame, because a route is a function of seat geometry and furniture and
 *   both move only when the plan does (§1.3).
 * @returns {{fits:boolean, radius:number, seats:{x:number,y:number,angle:number,
 *   laptop:{x:number,y:number,angle:number}, port:{x:number,y:number},
 *   route:{x:number,y:number}[], lane:number, u:number}[]}}
 */
export function crewArc(anchor, room, n, obstacles) {
  const count = Math.max(0, Math.floor(n) || 0);
  const world = crewFrame(anchor);
  const radius = crewRadius(count);
  const step = pitchAngle(count);
  const start = count > 1 ? -CREW_ARC_SPAN / 2 : 0;
  /** @type {any[]} */
  const seats = [];
  let fits = true;
  for (let i = 0; i < count; i++) {
    const theta = start + step * i;
    const u = radius * Math.sin(theta);
    const v = radius * Math.cos(theta);
    const at = world(u, v);
    if (room && !insideRoom(at, room)) fits = false;
    const lapR = Math.max(0.1, radius - CREW_LAPTOP_GAP);
    const lap = world(lapR * Math.sin(theta), lapR * Math.cos(theta));
    // A member faces its parent, and its laptop faces the same way it does.
    const toParent = Math.atan2(anchor.y - at.y, anchor.x - at.x);
    const port = world((i - (count - 1) / 2) * CREW_PORT_PITCH, 0);
    seats.push({
      ...at,
      angle: toParent,
      laptop: { ...lap, angle: toParent, u: lapR * Math.sin(theta), v: lapR * Math.cos(theta) },
      port: { ...port, u: (i - (count - 1) / 2) * CREW_PORT_PITCH },
      u,
      lane: 0,
    });
  }
  const lanes = cableLanes(seats);
  const rects = Array.isArray(obstacles) ? obstacles : [];
  seats.forEach((s, i) => {
    s.lane = lanes[i];
    s.route = routeFor(s, world);
    if (rects.length) s.route = reroute(rects, s, world);
  });
  return { fits, radius, seats };
}

/** @param {{x:number,y:number}} p @param {{x:number,y:number,w:number,h:number}} room */
function insideRoom(p, room) {
  return (
    p.x >= room.x + JUNIOR_PAD - 1e-9 &&
    p.x <= room.x + room.w - JUNIOR_PAD + 1e-9 &&
    p.y >= room.y + JUNIOR_PAD - 1e-9 &&
    p.y <= room.y + room.h - JUNIOR_PAD + 1e-9
  );
}

/**
 * ONE LANE PER CABLE, AND WHY THEY NEVER CROSS.
 *
 * Every cable is three axis-aligned runs in the seat's own frame: out of the
 * laptop toward the desk, across at its lane, then into the port. Two cables
 * cross only if a run of one meets a run of the other, and the assignment below
 * makes that impossible rather than checking for it afterwards:
 *
 *   - lanes are DISTINCT, so no two crossing runs share one;
 *   - the member furthest from the centre gets the lane NEAREST the desk, so an
 *     inner cable's runs all begin beyond an outer cable's lane;
 *   - ports are dealt in the same left-to-right order the arc is, and are packed
 *     tighter than the arc is wide, so an inner port is never inside an outer
 *     cable's crossing run.
 *
 * `test/unit/crew.test.mjs` asserts the conclusion over every fixture rather
 * than trusting the paragraph.
 * @param {{u:number}[]} seats
 * @returns {number[]} one lane depth per seat, in seat order
 */
export function cableLanes(seats) {
  const order = seats
    .map((s, i) => ({ i, k: Math.abs(s.u), u: s.u }))
    // Furthest from the centre first; a left/right pair at the same distance is
    // split left-before-right so the answer is the same on every rebuild.
    .sort((a, b) => b.k - a.k || a.u - b.u);
  const lanes = new Array(seats.length).fill(CREW_LANE_0);
  order.forEach((o, rank) => {
    lanes[o.i] = CREW_LANE_0 + rank * CREW_LANE_STEP;
  });
  return lanes;
}

/**
 * One cable, as a polyline in world coordinates: laptop, two bends, port.
 * Collinear points are dropped, so a member sitting straight in front of its own
 * port is one straight run rather than four coincident points.
 * @param {any} seat @param {(u:number,v:number)=>{x:number,y:number}} world
 */
function routeFor(seat, world) {
  const lu = seat.laptop.u;
  const lv = seat.laptop.v;
  const pu = seat.port.u;
  const lane = seat.lane;
  /** @type {{x:number,y:number}[]} */
  const pts = [];
  const push = (u, v) => {
    const p = world(u, v);
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9) return;
    pts.push(p);
  };
  push(lu, lv);
  push(lu, lane);
  push(pu, lane);
  push(pu, 0);
  return pts;
}

/**
 * NUDGE ONE CABLE'S LANE OFF A PIECE OF FURNITURE, without letting it swap with
 * its neighbours.
 *
 * §3.2: *"Routed, never straight: … from a route that treats furniture
 * footprints and label boxes as obstacles — the fifth cable in the mockup bends
 * around a plant rather than through it."* The lane may move by up to half a
 * step in either direction, which is the most that keeps the ordering in
 * `cableLanes` — and the ordering is the whole of the no-crossing property.
 *
 * A cable with nowhere clear to go keeps its own lane and is drawn: a cable that
 * is not drawn is a junior with no visible link to the person who spawned it,
 * which is worse than a cable that clips a plant pot.
 *
 * @param {{x:number,y:number,w:number,h:number}[]} obstacles world-space rects
 * @param {any} seat one seat from `crewArc`
 * @param {(u:number,v:number)=>{x:number,y:number}} world
 * @returns {{x:number,y:number}[]} the route to draw
 */
export function reroute(obstacles, seat, world) {
  // The desk the port is ON is not an obstacle to its own cable: §3.2 puts the
  // port on the desk's front edge, so a route that ends there ends inside it by
  // construction. Every other footprint in the room still counts.
  const rects = (Array.isArray(obstacles) ? obstacles : []).filter(
    (r) => !pointInRect(seat.port, r),
  );
  if (!rects.length) return seat.route;
  const half = CREW_LANE_STEP / 2;
  // The lane itself first, then symmetric nudges inside the half-step band.
  const tries = [0, half * 0.5, -half * 0.5, half * 0.9, -half * 0.9];
  for (const d of tries) {
    const candidate = routeFor({ ...seat, lane: seat.lane + d }, world);
    if (routeIsClear(candidate, rects)) return candidate;
  }
  return seat.route;
}

/** Does this polyline miss every rect? @param {{x:number,y:number}[]} pts */
export function routeIsClear(pts, rects) {
  for (let i = 0; i + 1 < pts.length; i++) {
    for (const r of rects) if (segmentHitsRect(pts[i], pts[i + 1], r)) return false;
  }
  return true;
}

/** @param {{x:number,y:number}} p @param {{x:number,y:number,w:number,h:number}} r */
export function pointInRect(p, r) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/**
 * Does an axis-aligned segment touch a rect? Both runs of a cable are axis
 * aligned by construction, so this is two interval overlaps and no algebra.
 */
export function segmentHitsRect(a, b, r) {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h;
}

// ---------------------------------------------------------------- the pulse

/**
 * HOW MANY PULSES RUN UP THIS CABLE — 0, 1, 2 or 4, never more.
 *
 * Zero unless the junior's transcript grew inside the stall window, which is the
 * honesty gate: a runtime that reports no `lastGrowthAt` never pulses, and a
 * junior whose file has stopped gets a grey cable. Above that it is the recency
 * band described on `CREW_PULSE_MS` — four while the file is moving now, two
 * inside the first half of the window, one for the rest of it.
 * @param {{lastGrowthAt?:number|null}} member
 * @param {number} nowMs
 * @returns {0|1|2|4}
 */
export function crewPulseCount(member, nowMs) {
  if (!juniorActive(member, nowMs)) return 0;
  const age = nowMs - Number(member.lastGrowthAt);
  if (age <= CREW_ACTIVE_MS / 8) return CREW_PULSE_MAX;
  if (age <= CREW_ACTIVE_MS / 2) return 2;
  return 1;
}

/**
 * Where the `k`-th of `count` pulses is along its cable, as a fraction from the
 * junior toward the parent.
 *
 * Junior → parent and never the other way (§3.2). Under reduced motion there are
 * no pulses at all — the count badge on the desk says how many are working — so
 * this is never called with `reduced`.
 * @param {number} phase the loop phase in [0, 1)
 * @param {number} k @param {number} count
 * @returns {number} 0 at the laptop, 1 at the desk
 */
export function pulseAt(phase, k, count) {
  const n = Math.max(1, count);
  const p = (((phase + k / n) % 1) + 1) % 1;
  return p;
}

/**
 * A point at `t` along a polyline, into a caller-owned scratch object so a frame
 * of four pulses on twelve cables allocates nothing.
 * @param {{x:number,y:number}[]} pts @param {number} t @param {{x:number,y:number}} out
 */
export function pointAlong(pts, t, out) {
  out.x = pts.length ? pts[0].x : 0;
  out.y = pts.length ? pts[0].y : 0;
  if (pts.length < 2) return out;
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) total += dist(pts[i], pts[i + 1]);
  if (total <= 0) return out;
  let want = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = dist(pts[i], pts[i + 1]);
    if (want <= d || i + 2 === pts.length) {
      const f = d > 0 ? want / d : 0;
      out.x = pts[i].x + (pts[i + 1].x - pts[i].x) * f;
      out.y = pts[i].y + (pts[i + 1].y - pts[i].y) * f;
      return out;
    }
    want -= d;
  }
  return out;
}

function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * HOW ALIVE THIS CABLE IS — `1` while the junior is writing, falling to `0` over
 * `CREW_FOLD_MS` once its file has been quiet for the whole stall window, and
 * `0` for ever after.
 *
 * It is also the laptop's lid: open at 1, folded at 0. Under reduced motion it
 * is the END value rather than the first frame — §1.2's rule — so a still
 * picture still says who is working and who has finished, which is exactly what
 * §3.2 asks the reduced form to keep.
 * @param {{lastGrowthAt?:number|null}} member
 * @param {number} nowMs
 * @param {{reduced?:boolean}} [opts]
 * @returns {number} 0..1
 */
export function crewCableLive(member, nowMs, opts) {
  const at = Number(member && member.lastGrowthAt);
  if (!Number.isFinite(at) || at <= 0) return 0;
  const quiet = nowMs - at - CREW_ACTIVE_MS;
  if (quiet <= 0) return 1;
  if (opts && opts.reduced) return 0;
  if (quiet >= CREW_FOLD_MS) return 0;
  return 1 - quiet / CREW_FOLD_MS;
}

/**
 * HOW MUCH OF THIS CABLE IS DRAWN — the draw-on when a junior arrives and the
 * retract when one leaves, both 0.30 s (§3.2).
 *
 * `spawnAt`/`leftAt` are the record's own, set by `AgentRuntime#sync` from the
 * injected clock, so this is the same instant every tab sees. Reduced motion
 * draws the finished state: a whole cable, or none.
 * @param {number} nowMs
 * @param {{spawnAt?:number|null, leftAt?:number|null}} rec
 * @param {{reduced?:boolean, pinned?:number|null}} [opts]
 * @returns {number} 0..1, from the desk outwards
 */
export function crewCableExtent(nowMs, rec, opts) {
  const reduced = !!(opts && opts.reduced);
  const pin = opts ? opts.pinned : null;
  const pinned = typeof pin === 'number' && Number.isFinite(pin);
  const left = rec && typeof rec.leftAt === 'number' ? rec.leftAt : null;
  if (left !== null) {
    if (reduced) return 0;
    const t = pinned ? ((pin % 1) + 1) % 1 : (nowMs - left) / CREW_CABLE_MS;
    return Math.max(0, 1 - Math.min(1, t));
  }
  const born = rec && typeof rec.spawnAt === 'number' ? rec.spawnAt : null;
  if (born === null || reduced) return 1;
  const t = pinned ? ((pin % 1) + 1) % 1 : (nowMs - born) / CREW_CABLE_MS;
  return Math.min(1, Math.max(0, t));
}

/**
 * THE `+N` CHIP'S PLACE, beside the desk, when a crew is over the cap.
 *
 * Beside rather than on the arc: the chip stands for members that are not drawn,
 * so hanging it off a body that IS drawn would attach it to the wrong person.
 * @param {{x:number,y:number,angle?:number}} anchor
 * @returns {{x:number,y:number}}
 */
export function crewChipAt(anchor) {
  const facing = typeof anchor.angle === 'number' ? anchor.angle : 0;
  const along = { x: Math.cos(facing + Math.PI / 2), y: Math.sin(facing + Math.PI / 2) };
  return { x: anchor.x + along.x * CREW_CHIP_OUT, y: anchor.y + along.y * CREW_CHIP_OUT };
}

/**
 * How many members are drawn, and how many the chip stands for.
 * @param {number} n
 * @returns {{drawn:number, overflow:number}}
 */
export function crewSplit(n) {
  const count = Math.max(0, Math.floor(n) || 0);
  const drawn = Math.min(count, CREW_DRAW_CAP);
  return { drawn, overflow: count - drawn };
}

// ----------------------------------------------------- the scaling law (§2)
//
// Seven lengths, and every one of them is set by a person: the chord between two
// seated juniors is a junior's own width, the smallest radius is a body's
// clearance from a chair, the laptop gap is a lap, and the three cable spacings
// are the gaps between people the cables run between. §177's law, applied to a
// package that adds a dimension.
//
// `CREW_SCALE` and `CREW_ARC_SPAN` are not here: a fraction and an angle are
// ratios, and a crew of larger people is the same arc drawn larger.

const BASE = {
  CREW_PITCH,
  CREW_R_MIN,
  CREW_LAPTOP_GAP,
  CREW_PORT_PITCH,
  CREW_LANE_0,
  CREW_LANE_STEP,
  CREW_CHIP_OUT,
};

registerBodyScale((s) => {
  ({
    CREW_PITCH,
    CREW_R_MIN,
    CREW_LAPTOP_GAP,
    CREW_PORT_PITCH,
    CREW_LANE_0,
    CREW_LANE_STEP,
    CREW_CHIP_OUT,
  } = scaleAll(BASE, s));
});
