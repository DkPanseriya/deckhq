/**
 * How a character gets from one room to another (WP-22 follow-up).
 *
 * Split out of `agents.js` unchanged: the door a room is left by, the
 * corridor centrelines a route runs along, the segment intersection that
 * finds where two of them meet, and `planWalk`, which is why a trip now goes
 * door → corridor → door rather than cutting straight across the floor.
 *
 * Pure, like every `agents-*` module and `agents.js` itself: no `node:`
 * import, no `document`, no `window`, no canvas. That is what lets
 * `test/unit/*.mjs` load this side of the renderer directly under
 * `node --test` (docs/DEVIATIONS.md §122).
 */
import { clampNum } from './agents-core.js';

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
 * Distance from (x,y) to the nearest point on `rect`'s perimeter. Zero exactly
 * on the boundary. Used to find which room a `Door` belongs to, since the
 * `Plan.doors` array (per CONTRACTS.md) carries no room id of its own.
 * @param {{x:number,y:number,w:number,h:number}} rect
 */
export function distanceToRectPerimeter(rect, x, y) {
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
export function lineIntersection(a, b) {
  if (a.axis === b.axis) return null;
  const v = a.axis === 'v' ? a : b;
  const h = a.axis === 'h' ? a : b;
  if (h.c < v.min - 1e-6 || h.c > v.max + 1e-6) return null;
  if (v.c < h.min - 1e-6 || v.c > h.max + 1e-6) return null;
  return { x: v.c, y: h.c };
}

/** The nav line a point sits on, or the nearest one. */
export function lineFor(lines, p) {
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
export function routeOnLines(lines, a, b) {
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
