/**
 * THE WORKTREE BENCHES: the table in the corner (`floor-worktrees.js`).
 *
 * A worktree is not a project, so it has no room. Inside its repository's room
 * the sessions working in one linked worktree share one bench: a narrow table
 * against the foot wall, its chairs on the room's side, and the worktree's name
 * on it. The main checkout keeps the desks in the middle of the room.
 *
 * WHERE THEY STAND. Along the foot wall, from the east corner westward, one
 * bench per worktree with a gap between them. That wall is the one nothing else
 * in a project room is anchored to: the plate is across the top, the board and
 * the shelf are on the side walls, the desks are in the middle and a crew's
 * floor is on the plate's side of them. `buildProjectRoom` keeps a strip of
 * floor there for exactly this (`benchFloorFor`) and holds the desks and the
 * break-out pair above it, so a room with benches is deeper and, where they
 * need it, wider — the room grows, by the rulebook, rather than the benches
 * squeezing in.
 *
 * WHAT A BENCH NEVER DOES. It never stands in the floor inside the door, under
 * the plate, in the work zone or on a crew's floor: every bench is laid in the
 * first stretch of wall clear of all of those, and of everything that was in
 * the room before it. This pass runs before `furnishRoom`, which then treats
 * the benches as furniture that was already there and furnishes round them.
 *
 * Reused, not new: a bench is a `desk` top, `chair`s and `monitor`s — the kinds
 * the desks are made of. Pure data and pure functions. No DOM, no canvas.
 */

import { CHAIR, CHAIR_GAP, CORNER_PLANT_INSET, SEAT_PITCH, TABLE_DEPTH } from './plan-units.js';
import { MONITOR_H, MONITOR_W } from './plan-furniture.js';
import { BOOKCASE_W, CHAR_CLEAR_U, PLANT_TREE } from './plan-props.js';
import {
  CREDENZA_DEPTH,
  DOOR_CLEAR_DEPTH,
  DOOR_CLEAR_W,
  ROOM_LANE,
  WALL_GAP,
  WALL_INSET,
  crewFloorOf,
  workZoneOf,
} from './plan-interior.js';

/** @typedef {import('./plan-units.js').Prop} Prop */
/** @typedef {import('./plan-units.js').Room} Room */
/** @typedef {import('./plan-units.js').Seat} Seat */
/** @typedef {import('../floor-worktrees.js').WorktreeBench} WorktreeBench */
/** @typedef {{x:number, y:number, w:number, h:number}} Rect */

/**
 * A bench is never shorter than this many seat pitches, whoever is at it. It
 * is a SHARED bench — the next session in that worktree sits down beside the
 * first — and its name has to fit on it: a one-seat top is narrower than any
 * branch name worth writing.
 */
export const BENCH_MIN_SEATS = 3;

/**
 * How far in from the wall edge of the top the name is written, as a share of
 * the top's depth. The near half is under the occupants' own names; the name of
 * the worktree is on the far half, against the wall.
 */
export const BENCH_LABEL_INSET = 0.24;

/**
 * The edge of a bench its people sit at. A bench stands against the room's
 * foot wall, so its chairs are on the room's side of it — north — and a screen
 * on it faces that way.
 */
export const BENCH_SEAT_EDGE = 'N';

/** Props a bench may be laid over when no wall is clear, and take away. */
const DECOR = /^(plant_|planter$|rug_round$|side_table$|tub_chair$)/;

/** A bench top's depth, wall to chair: a desk's, so two names fit down it. */
export function benchDepth() {
  return TABLE_DEPTH;
}

/** How far a bench and its chairs reach into the room from the foot wall. */
export function benchReach() {
  return WALL_INSET + benchDepth() + CHAIR_GAP + CHAIR;
}

/**
 * How far a bench stops short of a side wall: the depth of the storage that
 * may be stood against that wall afterwards, and the gap it is used from. A
 * bench in the very corner would have a bookcase's end in its chair row.
 */
export function benchSide() {
  return WALL_INSET + Math.max(BOOKCASE_W, CREDENZA_DEPTH) + WALL_GAP;
}

/** One bench's run along the wall: a seat pitch a person, and never a short one. */
export function benchRun(/** @type {number} */ seats) {
  return Math.max(BENCH_MIN_SEATS, seats) * SEAT_PITCH;
}

/**
 * THE FLOOR A ROOM'S BENCHES ASK FOR, or nothing.
 *
 * `h` is depth added at the foot of the room: the benches, their chairs, and a
 * body's clearance behind the chairs. `w` is a floor under the room's WIDTH,
 * wall to wall: every bench end to end, the gaps between them, and what the
 * foot wall may already owe to a door and to the corner plant — so the wall is
 * long enough whichever of them turns out to be on it.
 *
 * @param {ReadonlyArray<WorktreeBench>|null|undefined} benches
 * @returns {{w:number, h:number}|undefined}
 */
export function benchFloorFor(benches) {
  if (!benches || !benches.length) return undefined;
  const runs = benches.reduce((a, b) => a + benchRun(b.ids.length), 0);
  const gaps = (benches.length - 1) * CHAR_CLEAR_U;
  const plant = CORNER_PLANT_INSET + PLANT_TREE + CHAR_CLEAR_U;
  const door = DOOR_CLEAR_W + CHAR_CLEAR_U * 2;
  return {
    w: runs + gaps + plant + door + benchSide() * 2 + ROOM_LANE,
    h: benchReach() + CHAR_CLEAR_U,
  };
}

/** @param {Rect} a @param {Rect} b @param {number} [pad] */
function hits(a, b, pad = 0) {
  return (
    a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y
  );
}

/** The floor inside a room's door, or null. @param {Room} room @returns {Rect|null} */
export function doorBoxOf(room) {
  const door = room.door;
  if (!door) return null;
  const band = room.plateBand ?? 0;
  const top = room.y + band;
  const bottom = room.y + room.h;
  const near = (/** @type {number} */ a, /** @type {number} */ b) => Math.abs(a - b) < 0.01;
  if (near(door.y, bottom) || near(door.y, room.y)) {
    return {
      x: door.x - DOOR_CLEAR_W / 2,
      y: near(door.y, bottom) ? bottom - DOOR_CLEAR_DEPTH : top,
      w: DOOR_CLEAR_W,
      h: DOOR_CLEAR_DEPTH,
    };
  }
  return {
    x: near(door.x, room.x) ? room.x : room.x + room.w - DOOR_CLEAR_DEPTH,
    y: door.y - DOOR_CLEAR_W / 2,
    w: DOOR_CLEAR_DEPTH,
    h: DOOR_CLEAR_W,
  };
}

/**
 * LAY ONE ROOM'S BENCHES, in place: the tops, chairs and monitors are added to
 * its props and each bench is a zone (`worktree-<n>`).
 *
 * @param {Room} room placed, anchors resolved, `door` set, not yet furnished
 * @param {ReadonlyArray<WorktreeBench>} benches this room's, in key order
 * @returns {{seatOf: Map<string, Seat>, benches: {key:string, name:string,
 *   label:string, projectId:string, seats:number, x:number, y:number, w:number,
 *   h:number, labelAt:{x:number, y:number}}[]}} who sits where, and each bench
 *   as it stands — its top's rectangle and where its name is written
 */
export function layWorktreeBenches(room, benches) {
  /** @type {Map<string, Seat>} */
  const seatOf = new Map();
  /** @type {any[]} */
  const laid = [];
  if (!room || room.kind !== 'project' || !benches || !benches.length) {
    return { seatOf, benches: laid };
  }
  const band = room.plateBand ?? 0;
  const left = room.x + benchSide();
  const right = room.x + room.w - benchSide();
  const bottom = room.y + room.h;
  const depth = benchDepth();
  const topY = bottom - WALL_INSET - depth;
  const chairY = topY - CHAIR_GAP - CHAIR;
  /** The strip of floor the benches and their chairs stand in, wall to wall. */
  const strip = { x: room.x, y: chairY, w: room.w, h: bottom - chairY };

  // ---- what may not be stood on, as stretches of the foot wall.
  const work = workZoneOf(room);
  const crew = crewFloorOf(room);
  const doorBox = doorBoxOf(room);
  const plate = { x: room.x, y: room.y, w: room.w, h: band };
  /** @type {Rect[]} never, whatever else gives way */
  const hard = [plate, ...(doorBox ? [doorBox] : []), ...(work ? [work] : [])];
  if (crew) hard.push(crew);
  for (const p of room.props) if (!DECOR.test(p.kind) && p.kind !== 'rug') hard.push(p);
  /** @type {Prop[]} what was here first and would be taken away for a bench */
  const soft = room.props.filter((p) => DECOR.test(p.kind));
  /** @param {Rect[]} solid @returns {number[][]} blocked stretches, as [from, to] */
  const blockedBy = (solid) =>
    solid
      .filter((p) => hits(p, strip, CHAR_CLEAR_U))
      .map((p) => [p.x - CHAR_CLEAR_U, p.x + p.w + CHAR_CLEAR_U]);

  /**
   * Stand every bench against the wall, east to west, clear of `blocked`.
   * @param {number[][]} blocked
   * @returns {number[]|null} each bench's west edge, or null where one will not fit
   */
  const stand = (blocked) => {
    /** @type {number[]} */
    const xs = [];
    let cursor = right;
    for (const b of benches) {
      const run = benchRun(b.ids.length);
      let x = cursor - run;
      for (let moved = true; moved;) {
        moved = false;
        for (const [from, to] of blocked) {
          if (x < to && x + run > from) {
            x = from - run;
            moved = true;
          }
        }
      }
      if (x < left - 1e-9) return null;
      xs.push(x);
      cursor = x - CHAR_CLEAR_U;
    }
    return xs;
  };

  let xs = stand(blockedBy([...hard, ...soft]));
  if (!xs) {
    // No clear wall with the planting where it is: the planting gives way.
    xs = stand(blockedBy(hard));
    if (xs) {
      const taken = xs.map((x, i) => ({
        x,
        y: chairY,
        w: benchRun(benches[i].ids.length),
        h: strip.h,
      }));
      room.props = room.props.filter(
        (p) => !DECOR.test(p.kind) || !taken.some((t) => hits(p, t, CHAR_CLEAR_U / 2)),
      );
    }
  }
  // A wall too short for them all, which `benchFloorFor` exists to prevent:
  // end to end from the east corner, so everybody still has a seat.
  if (!xs) xs = stand([]) || benches.map((_, i) => right - (i + 1) * (SEAT_PITCH + CHAR_CLEAR_U));

  benches.forEach((b, i) => {
    const run = benchRun(b.ids.length);
    const x = xs[i];
    const id = `worktree-${i}`;
    room.zones.push({ id, x, y: chairY, w: run, h: strip.h });
    /** @param {string} kind @param {number} px @param {number} py @param {number} w @param {number} h */
    const put = (kind, px, py, w, h, angle = 0) =>
      room.props.push({
        kind,
        ...(kind === 'desk' ? { id: `${id}-top` } : {}),
        w,
        h,
        angle,
        x: px,
        y: py,
        // A screen names the edge of the bench its occupant sits at, as a desk's
        // does: the chairs stand north of a bench against the foot wall, so the
        // keyboard is on that side and the screen faces it. Without the edge the
        // painter fell back on the rect's shape, which is right only while a
        // monitor is wider than it is deep.
        anchor: {
          type: 'zone',
          of: id,
          dx: px - x,
          dy: py - chairY,
          ...(kind === 'monitor' ? { edge: BENCH_SEAT_EDGE } : {}),
        },
      });
    put('desk', x, topY, run, depth);
    // A chair at every place along it — it is a bench, and the next session
    // in this worktree sits down beside the first — and a screen only where
    // somebody is. The people at it sit together in the middle of the run.
    const places = Math.round(run / SEAT_PITCH);
    const first = Math.floor((places - b.ids.length) / 2);
    // Square on to the bench: the occupant faces the wall their screen is on.
    const angle = Math.PI / 2;
    for (let k = 0; k < places; k++) {
      const cx = x + (k + 0.5) * SEAT_PITCH;
      put('chair', cx - CHAIR / 2, chairY, CHAIR, CHAIR, angle);
      const agentId = b.ids[k - first];
      if (agentId === undefined) continue;
      put('monitor', cx - MONITOR_W / 2, topY, MONITOR_W, MONITOR_H);
      seatOf.set(agentId, { x: cx, y: chairY + CHAIR / 2, angle });
    }
    laid.push({
      key: b.key,
      name: b.name,
      label: b.label,
      projectId: String(room.id),
      seats: b.ids.length,
      x,
      y: topY,
      w: run,
      h: depth,
      // On the far half of the top, against the wall and clear of the names
      // the floor writes under the people sitting at it.
      labelAt: { x: x + run / 2, y: topY + depth * (1 - BENCH_LABEL_INSET) },
    });
  });
  return { seatOf, benches: laid };
}
