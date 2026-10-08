/**
 * WHO IS RESTING, AND IN WHAT ORDER — the lounge's people, as a list.
 *
 * The lounge draws its seats and one row of people standing, and everybody
 * past that is a number on a chip: `+N resting` (`render/plan-proportions.js`
 * (g)). Two things then have to agree about the same people. The PLAN decides
 * who is behind the chip, and the DECK is where they are still a row each —
 * clicking the chip opens it on them. A rule about who is resting with two
 * implementations is a chip and a list that count differently, so there is
 * one, here, imported by both sides like everything in `floor-rule.js`.
 *
 * THE ORDER IS MOST RECENT FIRST. The people the lounge draws are the ones who
 * stopped most recently — the session that finished five minutes ago is the
 * one somebody looks for — and the longest-rested are the ones behind the
 * chip. Ties break on the id, so the order is total and the same on every
 * machine.
 *
 * Pure functions over a snapshot. No DOM, no network, no clock except the one
 * the caller hands over.
 */

import { agentIndex, awayRooms, floorPopulation, offTheFloor, placement } from './floor-rule.js';

/** @typedef {import('./floor-rule.js').FloorAgent} FloorAgent */

/**
 * The people in the lounge, most recently active first.
 *
 * @param {FloorAgent[]} agents
 * @param {Set<string>} hidden the ids the floor draws nobody for
 *   (`offTheFloor`): gone home, or finished in a repo with no room
 * @returns {FloorAgent[]}
 */
export function restingOrder(agents, hidden) {
  const all = Array.isArray(agents) ? agents : [];
  // The same question the floor asks, with the same index (`placement`).
  const byId = agentIndex(all);
  const list = all.filter(
    (a) => a && placement(a, byId) === 'lounge' && !(hidden && hidden.has(String(a.id))),
  );
  const at = (/** @type {any} */ a) => Number(a.lastActivityAt) || 0;
  return list.sort((a, b) => at(b) - at(a) || String(a.id).localeCompare(String(b.id)));
}

/**
 * Who of them is behind the chip: everybody past the places the lounge laid.
 *
 * @param {FloorAgent[]} agents
 * @param {Set<string>} hidden
 * @param {number} places how many people the lounge has a place drawn for
 * @returns {Set<string>} ids, the longest-rested
 */
export function behindTheChip(agents, hidden, places) {
  const room = Math.max(0, Math.floor(Number(places) || 0));
  return new Set(
    restingOrder(agents, hidden)
      .slice(room)
      .map((a) => String(a.id)),
  );
}

/**
 * The same people, straight off a snapshot — what the deck's Resting tab
 * lists. It asks the floor's own rule who has a room (`awayRooms`) and who is
 * drawn nowhere (`offTheFloor`), so the tab and the lounge plate count the
 * same sessions.
 *
 * @param {{projects?:any[], agents?:FloorAgent[], settings?:{goneHomeDays?:number}}} snapshot
 * @param {{now?:number}} [opts]
 * @returns {FloorAgent[]}
 */
export function restingAgentsOf(snapshot, opts = {}) {
  const snap = snapshot || {};
  const agents = Array.isArray(snap.agents) ? snap.agents : [];
  const pop = floorPopulation(agents, {
    now: opts.now,
    goneHomeDays: (snap.settings || {}).goneHomeDays,
  });
  const idOf = (/** @type {any} */ p) => String(p.id ?? p.projectId ?? 'unknown');
  const roomIds = new Set(awayRooms(snap.projects || [], pop).onFloor.map(idOf));
  return restingOrder(agents, offTheFloor(agents, roomIds, pop));
}
