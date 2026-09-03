/**
 * The anchor hierarchy, and the table sizes a headcount needs.
 *
 * Split out of `plan.js` by WP-22. Nothing here is positioned by a bare
 * coordinate: `resolveAnchors` turns every prop's declared relationship —
 * to its zone, a wall, a corner, another prop — into absolute coordinates,
 * once the room's geometry is final. `translateContents` then moves a whole
 * room, contents and all, in one frame.
 */

import { CHAIR, CHAIR_GAP, SEAT_PITCH, TABLE_DEPTH, TABLE_SIZES } from './plan-units.js';

/** @typedef {import('./plan-units.js').Prop} Prop */
/** @typedef {import('./plan-units.js').Wall} Wall */
/** @typedef {import('./plan-units.js').Room} Room */

/**
 * The table sizes a project of `n` people needs.
 *
 * One table per eight people, and the remainder gets the smallest table that
 * seats it — so a team of three sits at a four-seater rather than rattling
 * around an eight. A project that grows past eight gains a second table
 * instead of a longer one, which is what a real office does.
 *
 * @param {number} n
 * @returns {number[]} seat counts, largest first
 */
export function tableSizesFor(n) {
  const total = Math.max(0, Math.floor(n));
  if (total === 0) return [];
  /** @type {number[]} */
  const out = [];
  let left = total;
  while (left > 8) {
    out.push(8);
    left -= 8;
  }
  out.push(
    TABLE_SIZES.slice()
      .reverse()
      .find((s) => s >= left) ?? 8,
  );
  return out;
}

/** Footprint of a table seating `seats` people, seats along both long sides. */
export function tableSize(seats) {
  const perSide = Math.max(1, Math.ceil(seats / 2));
  return { w: perSide * SEAT_PITCH, h: TABLE_DEPTH };
}

/** The full footprint a table needs including its chairs. */
export function tableBlockSize(seats) {
  const t = tableSize(seats);
  return { w: t.w, h: t.h + 2 * (CHAIR_GAP + CHAIR) };
}

// ------------------------------------------------------------- the anchors

/**
 * Resolve every anchored prop in a room to absolute coordinates.
 *
 * Runs after zone geometry is final, so a prop's position is always derived
 * from something real: the zone it stands in, a wall, a corner, another prop,
 * or a declared sub-zone. Props resolve in declaration order, so an anchor
 * target must be declared before whatever hangs off it.
 *
 * @param {Room} room
 * @returns {Prop[]}
 */
export function resolveAnchors(room) {
  /** @type {Map<string, {x:number,y:number,w:number,h:number}>} */
  const byId = new Map();
  for (const z of room.zones || []) byId.set(z.id, z);

  // The room's INTERIOR: the room less the strip its plate is drawn in. Wall
  // and corner anchors measure from here, so a prop against the north wall
  // lands under the plate band rather than under the plate.
  const band = room.plateBand ?? 0;
  const L = room.x;
  const T = room.y + band;
  const R = room.x + room.w;
  const B = room.y + room.h;

  for (const p of room.props) {
    const a = p.anchor;
    switch (a.type) {
      case 'zone': {
        const t = byId.get(a.of);
        if (!t) break;
        p.x = t.x + a.dx;
        p.y = t.y + a.dy;
        break;
      }
      case 'wall': {
        const inset = a.inset ?? 0;
        if (a.side === 'N') {
          p.x = L + a.along;
          p.y = T + inset;
        } else if (a.side === 'S') {
          p.x = L + a.along;
          p.y = B - inset - p.h;
        } else if (a.side === 'W') {
          p.x = L + inset;
          p.y = T + a.along;
        } else {
          p.x = R - inset - p.w;
          p.y = T + a.along;
        }
        break;
      }
      case 'corner': {
        const inset = a.inset ?? 0;
        const east = a.corner === 'NE' || a.corner === 'SE';
        const south = a.corner === 'SE' || a.corner === 'SW';
        p.x = east ? R - inset - p.w : L + inset;
        p.y = south ? B - inset - p.h : T + inset;
        break;
      }
      case 'attached': {
        const t = byId.get(a.to);
        if (!t) break;
        const gap = a.gap ?? 0;
        if (a.edge === 'N') {
          p.x = t.x + a.along;
          p.y = t.y - gap - p.h;
        } else if (a.edge === 'S') {
          p.x = t.x + a.along;
          p.y = t.y + t.h + gap;
        } else if (a.edge === 'W') {
          p.x = t.x - gap - p.w;
          p.y = t.y + a.along;
        } else {
          p.x = t.x + t.w + gap;
          p.y = t.y + a.along;
        }
        break;
      }
      case 'centered': {
        const t = byId.get(a.of);
        if (!t) break;
        p.x = t.x + (t.w - p.w) / 2;
        p.y = t.y + (t.h - p.h) / 2;
        break;
      }
    }
    if (p.id) byId.set(p.id, p);
  }
  return room.props;
}

/** Shift a room's laid-out contents into place. */
export function translateContents(room, dx, dy) {
  for (const z of room.zones) {
    z.x += dx;
    z.y += dy;
  }
  for (const p of room.props) {
    p.x += dx;
    p.y += dy;
  }
}
