/**
 * THE HALL A FLOOR OF FEW ROOMS IS LEFT WITH, and what stands in it.
 *
 * A room has a ceiling (`plan-proportions.js` (c)). On a floor of one or two
 * projects the rooms at their ceilings, and the reception and the lounge at
 * their caps, do not come to the whole of a building the window's shape; what
 * is left is a HALL — circulation, inside the walls, the way in from the
 * corridor — rather than a larger room with a showroom's furniture in it.
 * `plan-grid.js` cuts the rectangle. This file plants it, and lays it in the
 * reception's floor rather than a corridor's: troughs of low
 * planting along its long walls with a tree between each pair, and nothing on
 * the line people walk down or in front of a door.
 *
 * It is furniture the BUILDING sets, so none of it moves with the body size.
 *
 * Pure geometry. No DOM, no clock, no randomness.
 */

import { SILHOUETTE_SPACING } from './plan-props.js';
import { CORRIDOR } from './plan-units.js';

/** @typedef {import('./plan-units.js').Room} Room */

/** A hall this narrow is a corridor, and a corridor is kept clear. */
export const HALL_PLANTED_MIN = CORRIDOR * 2;

/** One trough: a body and a half long, under a stride across. */
const TROUGH = Object.freeze({ long: 5.2, across: 0.9 });
/** The tree between two troughs, and the floor either side of it. */
const TREE = 2.2;
const GAP = 3;
/** How far a run stands off the wall behind it, and off the hall's ends. */
const WALL_INSET = 1.1;
const END_INSET = 2.4;
/** Half the lane kept clear down the middle of a hall, and round a door. */
const LANE_HALF = 1.8;
const DOOR_CLEAR = 3.2;
/** A hall this deep takes a second run each side, a quarter of the way in. */
const SECOND_RUN_MIN = 18;

/**
 * Plant every hall of a laid floor. Called once the doors are known, so that
 * nothing is stood in front of one.
 *
 * @param {Room[]} rooms every room of the plan, placed, with its door
 * @returns {number} how many pieces were stood
 */
export function landscapeHalls(rooms) {
  const doors = rooms.filter((r) => r.kind !== 'corridor' && r.door).map((r) => r.door);
  let stood = 0;
  for (const hall of rooms) {
    if (hall.kind !== 'corridor') continue;
    // A hall — or a spine with one along it, which is as wide as both.
    const along =
      hall.id === '__spine__' && Math.min(hall.w, hall.h) >= CORRIDOR + HALL_PLANTED_MIN / 2;
    if (!along && !String(hall.id).startsWith('__hall-')) continue;
    const flat = hall.w >= hall.h;
    const long = flat ? hall.w : hall.h;
    const short = flat ? hall.h : hall.w;
    if (short < HALL_PLANTED_MIN - 1e-6) continue;
    // Where a run stands, measured in from the long wall it is against.
    const insets = [WALL_INSET];
    if (short >= SECOND_RUN_MIN) insets.push(short / 4);
    // One period of a run is a trough, a gap, a tree and a gap.
    const period = TROUGH.long + GAP + TREE + GAP;
    const room = long - END_INSET * 2;
    const count = Math.max(0, Math.floor((room + GAP + TREE + GAP) / period));
    if (!count) continue;
    const used = count * period - (GAP + TREE + GAP);
    const start = END_INSET + (room - used) / 2;
    /** A piece along the run, mirrored to both long walls. */
    const stand = (
      /** @type {string} */ piece,
      /** @type {number} */ along,
      /** @type {number} */ size,
      /** @type {number} */ across,
      /** @type {number} */ inset,
    ) => {
      for (const far of [false, true]) {
        const off = far ? short - inset - across : inset;
        const rect = flat
          ? { x: hall.x + along, y: hall.y + off, w: size, h: across }
          : { x: hall.x + off, y: hall.y + along, w: across, h: size };
        // Never on the line a hall is walked by: across it, down its middle
        // (`plan-nav.js`), whichever way it is longer.
        const down = hall.across !== false;
        const lane = down ? hall.x + hall.w / 2 : hall.y + hall.h / 2;
        const lo = down ? rect.x : rect.y;
        const hi = down ? rect.x + rect.w : rect.y + rect.h;
        if (lo < lane + LANE_HALF && hi > lane - LANE_HALF) continue;
        // Anchored to the wall it stands against, as every prop on the floor is.
        /** @type {'N'|'S'|'E'|'W'} */
        const side = flat ? (far ? 'S' : 'N') : far ? 'E' : 'W';
        /** @type {import('./plan-units.js').Anchor} */
        const anchor = { type: 'wall', side, along, inset: far ? inset : off };
        const blocked = doors.some(
          (d) =>
            d.x > rect.x - DOOR_CLEAR &&
            d.x < rect.x + rect.w + DOOR_CLEAR &&
            d.y > rect.y - DOOR_CLEAR &&
            d.y < rect.y + rect.h + DOOR_CLEAR,
        );
        if (blocked) continue;
        // No two identical silhouettes within sight of each other (§3.5): the
        // far wall's plants are the other kind, and a piece that would still
        // stand too near its twin is left out.
        const kind = piece === 'planter' ? piece : far ? 'plant_broad' : 'plant_tree';
        const near = hall.props.some((p) => {
          if (p.kind !== kind) return false;
          const dx = Math.max(0, p.x - rect.x - rect.w, rect.x - p.x - p.w);
          const dy = Math.max(0, p.y - rect.y - rect.h, rect.y - p.y - p.h);
          return Math.hypot(dx, dy) < SILHOUETTE_SPACING;
        });
        if (near) continue;
        const id = `${hall.id}-${kind}-${hall.props.length}`;
        hall.props.push({ kind, id, ...rect, angle: 0, anchor });
        stood += 1;
      }
    };
    // A planted hall is an entry hall: the reception's own floor, not screed.
    hall.floor = 'wood';
    insets.forEach((inset, row) => {
      const tree = inset - (TREE - TROUGH.across) / 2;
      for (let i = 0; i < count - (row % 2); i++) {
        const at = start + i * period;
        // Against the wall, a trough and then a tree. A quarter of the way in,
        // trees alone and half a period along: a grove, not a second hedge.
        if (row === 0) stand('planter', at, TROUGH.long, TROUGH.across, inset);
        const along = row === 0 ? at + TROUGH.long + GAP : at + period / 2 + TROUGH.long / 2;
        if (row || i < count - 1) stand('plant_tree', along, TREE, TREE, tree);
      }
    });
  }
  return stood;
}
