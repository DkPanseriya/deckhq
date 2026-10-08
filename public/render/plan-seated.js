/**
 * WHICH CHAIRS SOMEBODY IS SITTING IN.
 *
 * A task chair is baked into the floor, and an empty one is drawn left a few
 * degrees askew: nobody pushes a swivel chair back square. The bake had no way
 * to tell an empty chair from a taken one, so it turned them all — and a chair
 * turned under the person sitting in it reads as a person sitting sideways to
 * their own screen.
 *
 * The plan can tell. Who sits where is `assignSeats`, the same pass the scene
 * runs on the same plan and the same agents, so a chair is marked `occupied`
 * here exactly where a figure will be drawn in it: a desk seat, or a place at a
 * worktree's bench. The painter leaves a marked chair square to its desk.
 *
 * It follows the floor without a second trigger: a session sitting down or
 * getting up changes who is at a desk, which is a new plan and a new bake.
 *
 * Pure. No DOM, no canvas.
 */

import { assignSeats } from './agents-seats.js';

/** @typedef {import('./plan-units.js').Plan} Plan */

/** A point on the floor, to the hundredth of a unit. @param {number} x @param {number} y */
const at = (x, y) => `${Math.round(x * 100)},${Math.round(y * 100)}`;

/**
 * Mark every project-room chair somebody is seated in, in place.
 *
 * @param {Plan} plan a finished plan: its seats, benches and rooms placed
 * @param {ReadonlyArray<any>} agents the agents it was built for
 * @returns {number} how many chairs were marked
 */
export function markOccupiedChairs(plan, agents) {
  if (!plan || !Array.isArray(plan.rooms)) return 0;
  /** @type {Set<string>} */
  const taken = new Set();
  for (const seat of assignSeats(/** @type {any} */ (plan), /** @type {any} */ (agents)).values()) {
    // Somebody standing in a ring round a full table is in nobody's chair.
    if (seat && !seat.overflow && !seat.standing) taken.add(at(seat.x, seat.y));
  }
  let marked = 0;
  for (const room of plan.rooms) {
    if (room.kind !== 'project') continue;
    for (const prop of room.props || []) {
      if (prop.kind !== 'chair') continue;
      if (!taken.has(at(prop.x + prop.w / 2, prop.y + prop.h / 2))) continue;
      prop.occupied = true;
      marked++;
    }
  }
  return marked;
}
