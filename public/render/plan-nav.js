/**
 * Walls, corridors and doors — everything about how the floor is traversed.
 *
 * Split out of `plan.js` by WP-22. `deriveWalls` reads the shared edges of the
 * tiled rooms, so two zones either side of a partition get ONE wall and the
 * floor reads as a divided building rather than a row of huts. `buildNavLines`
 * and `assignDoors` then give every room a door onto a corridor, which is what
 * `agents.js`'s `planWalk` routes along.
 */

import { CORRIDOR, clamp } from './plan-units.js';

/** @typedef {import('./plan-units.js').Wall} Wall */
/** @typedef {import('./plan-units.js').NavLine} NavLine */
/** @typedef {import('./plan-units.js').Room} Room */

/**
 * Derive the wall segments from the zone rectangles.
 *
 * Walls belong to the FLOOR, not to a room: two zones either side of a
 * partition share one wall. Deriving them from shared edges — rather than
 * letting every room draw its own outline — is what makes the plan read as
 * one building that has been divided, instead of a row of separate huts.
 *
 * @param {Room[]} rooms
 * @param {number} W
 * @param {number} H
 * @returns {Wall[]}
 */
export function deriveWalls(rooms, W, H) {
  /** @type {Map<string, Wall>} */
  const byKey = new Map();
  const key = (x1, y1, x2, y2) => [x1, y1, x2, y2].map((v) => Math.round(v * 100) / 100).join(':');

  for (const room of rooms) {
    const solid = room.walls === 'full';
    const edges = [
      { x1: room.x, y1: room.y, x2: room.x + room.w, y2: room.y },
      { x1: room.x, y1: room.y + room.h, x2: room.x + room.w, y2: room.y + room.h },
      { x1: room.x, y1: room.y, x2: room.x, y2: room.y + room.h },
      { x1: room.x + room.w, y1: room.y, x2: room.x + room.w, y2: room.y + room.h },
    ];
    for (const e of edges) {
      const onEdge =
        Math.abs(e.x1) < 0.01 ||
        Math.abs(e.y1) < 0.01 ||
        Math.abs(e.x2 - W) < 0.01 ||
        Math.abs(e.y2 - H) < 0.01;
      const exterior =
        onEdge &&
        ((Math.abs(e.x1 - e.x2) < 0.01 && (Math.abs(e.x1) < 0.01 || Math.abs(e.x1 - W) < 0.01)) ||
          (Math.abs(e.y1 - e.y2) < 0.01 && (Math.abs(e.y1) < 0.01 || Math.abs(e.y1 - H) < 0.01)));
      const k = key(e.x1, e.y1, e.x2, e.y2);
      const existing = byKey.get(k);
      /** @type {'exterior'|'solid'|'partition'} */
      const kind = exterior ? 'exterior' : solid ? 'solid' : 'partition';
      // A shared edge is emitted once. Where two rooms disagree, the stronger
      // wall wins — an office's solid wall is not downgraded by the open-plan
      // zone on its other side.
      const rank = { partition: 0, solid: 1, exterior: 2 };
      if (!existing || rank[kind] > rank[existing.kind]) {
        byKey.set(k, { ...e, kind });
      }
    }
  }
  return [...byKey.values()];
}

// ------------------------------------------------------------ the nav graph

/**
 * The walkable network: corridor centrelines, plus a door and an entry point
 * for every room.
 *
 * Agents may only travel along these lines. Before this existed the router did
 * generic obstacle avoidance and, when a direct path was blocked, swept around
 * the *bounding box of the obstacles* — which is outside the building. That is
 * why agents were seen leaving the floor in an arbitrary direction and
 * reappearing on the far side: they were taking a legal route through a model
 * that had no idea where the walls were.
 *
 * The lines are deliberately not the same objects as the corridor ROOMS. A
 * cross corridor's room starts at the spine's right edge, but its centreline
 * is extended left to meet the spine's centreline so the two actually
 * intersect — the overlap lies inside the spine, which is walkable floor.
 *
 * @param {Room[]} rooms
 * @param {number} W
 * @param {number} H
 * @returns {{lines: NavLine[], spineId: string|null}}
 */
export function buildNavLines(rooms, W, H) {
  /** @type {NavLine[]} */
  const lines = [];
  const spine = rooms.find((r) => r.id === '__spine__');
  const spineC = spine ? spine.x + spine.w / 2 : null;

  if (spine) {
    lines.push({ id: spine.id, axis: 'v', c: spineC, min: spine.y, max: spine.y + spine.h });
  }

  for (const r of rooms) {
    if (r.kind !== 'corridor' || r.id === '__spine__') continue;
    if (r.thoroughfare === false) continue;
    // A corridor's own shape says which way people walk down it. The working
    // floor now has one horizontal corridor across the middle and a vertical
    // aisle beside every column of rooms; both are routes, and a room deep in
    // a stack reaches the floor through the aisle next to it rather than by
    // cutting through its neighbour.
    if (r.h > r.w) {
      const c = r.x + r.w / 2;
      // Extended half a corridor past each end so it actually meets the
      // corridor centreline it opens onto — a line that stops exactly at the
      // corridor's edge never intersects it, and the graph comes apart into
      // one component per row.
      lines.push({
        id: r.id,
        axis: 'v',
        c,
        min: Math.max(0, r.y - CORRIDOR / 2),
        max: Math.min(H, r.y + r.h + CORRIDOR / 2),
      });
      continue;
    }
    const c = r.y + r.h / 2;
    // Extended left to the spine centreline so the graph is connected.
    const min = spineC !== null ? Math.min(spineC, r.x) : r.x;
    lines.push({ id: r.id, axis: 'h', c, min, max: Math.min(W, r.x + r.w) });
  }

  // A floor with no corridors at all (a single project, say) still needs one
  // walkable line, or nothing can move.
  if (lines.length === 0) {
    lines.push({ id: '__fallback__', axis: 'v', c: W / 2, min: 0, max: H });
  }
  return { lines, spineId: spine ? spine.id : null };
}

/** Distance from a point to a nav line, and the closest point on it. */
export function projectOntoLine(line, p) {
  if (line.axis === 'v') {
    const y = clamp(p.y, line.min, line.max);
    return { point: { x: line.c, y }, dist: Math.hypot(p.x - line.c, p.y - y) };
  }
  const x = clamp(p.x, line.min, line.max);
  return { point: { x, y: line.c }, dist: Math.hypot(p.x - x, p.y - line.c) };
}

/**
 * Give every room a door on its own boundary and an entry point on the
 * corridor that door opens onto.
 *
 * @param {Room[]} rooms
 * @param {NavLine[]} lines
 */
export function assignDoors(rooms, lines) {
  for (const room of rooms) {
    if (room.kind === 'corridor') continue;
    const centre = { x: room.x + room.w / 2, y: room.y + room.h / 2 };

    let best = null;
    for (const line of lines) {
      const { point, dist } = projectOntoLine(line, centre);
      if (!best || dist < best.dist) best = { line, point, dist };
    }
    if (!best) continue;

    // The door sits on the room edge that faces the corridor, level with the
    // entry point, so leaving a room is always one straight step through its
    // own wall rather than a diagonal across furniture.
    const e = best.point;
    let door;
    if (best.line.axis === 'v') {
      const y = clamp(e.y, room.y + 1, room.y + room.h - 1);
      door = { x: e.x < centre.x ? room.x : room.x + room.w, y };
    } else {
      const x = clamp(e.x, room.x + 1, room.x + room.w - 1);
      door = { x, y: e.y < centre.y ? room.y : room.y + room.h };
    }
    room.door = door;
    room.navEntry = { x: e.x, y: e.y };
    room.navLineId = best.line.id;
  }
}
