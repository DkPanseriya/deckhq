/**
 * WHERE THE WAITING SIT AND STAND in the user's office.
 *
 * Split out of `plan-office.js`, which builds the room: these are the places
 * in it. Three rules about how close two waiting people may be drawn, each one
 * measured on a reception of sixteen where the names and the wait badges of
 * neighbours ran into each other:
 *
 *   1. **Once somebody has to stand, the corner cushions seat nobody.** The
 *      run that spans between two others gives up a body's width at each end,
 *      so the last person on one run and the first on the next are not corner
 *      neighbours. While everybody waiting still fits on the sofas they all
 *      sit, corners included: the owner's rule is that the waiting sit.
 *   2. **A standing row in front of a sofa stands in the gaps.** Its places
 *      are the sofa's own pitch apart and half a pitch along from the people
 *      sitting behind them, so a standing badge falls between two sitters and
 *      a sitter's name between two people standing.
 *   3. **The second standing row is half a pitch along from the first**, and
 *      so on back: no two rows of names line up.
 *
 * Pure geometry. `seatOffice` reads the office's own resolved furniture, so it
 * must run after `resolveAnchors`.
 */

import {
  OFFICE_QUEUE_PITCH,
  OFFICE_QUEUE_ROW,
  OFFICE_SEAT_PITCH,
  OFFICE_SOFA_PITCH,
  SOFA_SEAT_BIAS,
  angleTo,
} from './plan-units.js';

/** @typedef {import('./plan-units.js').Prop} Prop */
/** @typedef {import('./plan-units.js').Room} Room */
/** @typedef {import('./plan-units.js').Seat} Seat */

/** The prefix every standing queue place carries, as a zone id. */
export const OFFICE_QUEUE_ZONE = 'office-queue-';
/** The prefix every visitor chair carries, as a prop and a zone id. */
export const OFFICE_VISITOR_ZONE = 'office-visitor-';

/**
 * How much of a run's end is the corner cushion, where that run stands between
 * two others: one body's width (`OFFICE_SEAT_PITCH`, the pitch that spaces
 * bodies). Read through a function because the pitch moves with the agent size.
 */
export function cornerCushion() {
  return OFFICE_SEAT_PITCH;
}

/**
 * How many waiting sessions a sofa run of this length seats (WP-93).
 *
 * One expression, called from two places that must agree: `buildOffice`, which
 * sizes the standing queue off it before the furniture exists, and
 * `sofaPlacesOn`, which lays the places out once it does. Two copies of this
 * arithmetic is a room whose queue is one longer than its empty cushions.
 *
 * The `1e-9` is not decoration. `SOFA_MIN_RUN` and `OFFICE_SOFA_PITCH` are both
 * 5.2, so the shortest run the room will build divides EXACTLY once — and
 * `5.2 / 5.2` in binary floating point is not reliably 1.
 * @param {number} runLen
 * @param {boolean} [between] the run spans between two others, and both its
 *   ends are corner cushions
 */
export function sofaPlaceCount(runLen, between = false) {
  const n = Number(runLen) - (between ? cornerCushion() * 2 : 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.floor(n / OFFICE_SOFA_PITCH + 1e-9));
}

/**
 * Does another run stand past this end of `sofa`? Each run stops where the
 * next one's depth begins, so the two touch at a corner and nothing overlaps:
 * the test is a half-unit reach past the end.
 * @param {Prop} sofa @param {Prop[]} runs every sofa in the room
 * @param {boolean} far the end at the larger coordinate
 */
function meetsAt(sofa, runs, far) {
  const vertical = sofa.h > sofa.w;
  const reach = 0.5;
  const depth = vertical ? sofa.w : sofa.h;
  const at = vertical
    ? far
      ? sofa.y + sofa.h
      : sofa.y - depth
    : far
      ? sofa.x + sofa.w
      : sofa.x - depth;
  const box = vertical
    ? { x: sofa.x - reach, y: at, w: sofa.w + reach * 2, h: depth }
    : { x: at, y: sofa.y - reach, w: depth, h: sofa.h + reach * 2 };
  return runs.some(
    (o) =>
      o !== sofa &&
      o.x < box.x + box.w &&
      o.x + o.w > box.x &&
      o.y < box.y + box.h &&
      o.y + o.h > box.y,
  );
}

/**
 * Where people sit on ONE sofa run, in the room's own resolved frame.
 *
 * Evenly along the run rather than packed from one end, so a half-full sofa
 * reads as a sofa somebody is sitting on rather than as one with a gap at the
 * end; and forward of the centre line by `SOFA_SEAT_BIAS` of the run's depth,
 * because the back cushion occupies the far third of it (`backdrop.js`'s sofa
 * case) and a body drawn on the centre line is sitting on the back.
 *
 * With `clearCorners`, a run between two others (rule 1) is laid over what is
 * left of it inside its two corner cushions.
 *
 * The rect says which way the run lies and the angle says which way it faces,
 * exactly as they do for the painter — so this is correct for the portrait
 * reception and for the transposed row one without being told which it has.
 * @param {Prop} sofa
 * @param {Prop[]} [runs] every sofa run in the room, this one among them
 * @param {boolean} [clearCorners] somebody is standing in this room
 * @returns {{x:number, y:number}[]}
 */
export function sofaPlacesOn(sofa, runs = [], clearCorners = false) {
  const vertical = sofa.h > sofa.w;
  const between = clearCorners && meetsAt(sofa, runs, false) && meetsAt(sofa, runs, true);
  const trim = between ? cornerCushion() : 0;
  const runLen = (vertical ? sofa.h : sofa.w) - trim * 2;
  const n = sofaPlaceCount(vertical ? sofa.h : sofa.w, between);
  if (n === 0) return [];
  const depth = vertical ? sofa.w : sofa.h;
  const forward = depth * SOFA_SEAT_BIAS;
  const bias = {
    x: vertical ? Math.cos(sofa.angle || 0) * forward : 0,
    y: vertical ? 0 : Math.sin(sofa.angle || 0) * forward,
  };
  /** @type {{x:number, y:number}[]} */
  const out = [];
  for (let i = 0; i < n; i++) {
    const along = trim + ((i + 0.5) * runLen) / n;
    out.push(
      vertical
        ? { x: sofa.x + sofa.w / 2 + bias.x, y: sofa.y + along }
        : { x: sofa.x + along, y: sofa.y + sofa.h / 2 + bias.y },
    );
  }
  return out;
}

// ------------------------------------------------------- the standing queue

/**
 * How a standing queue of `queued` is laid in a floor `major` long and `minor`
 * deep (rules 2 and 3).
 *
 * `lanes` places stand along the first row, `pitch` apart; the row behind has
 * one fewer and stands half a pitch along, then a full row again. `beside` is
 * the sofa the first row stands in front of: its place count and its length,
 * which give the row the sofa's own pitch and as many places as it has gaps.
 * Without it the pitch is the queue's own, closed up by `tight`.
 *
 * @param {number} queued
 * @param {number} major the floor along the rows
 * @param {number} minor the floor the rows stack into
 * @param {number} [tight] 1 as laid, down to 0.5 in a room held at its cap
 * @param {{places:number, run:number}} [beside]
 * @param {boolean} [grid] every row full and in line: the most a floor holds,
 *   for a room too full to stand in the gaps
 * @returns {{lanes:number, files:number, tight:number, pitch:number, row:number,
 *   fits:boolean, beside:boolean, grid:boolean}}
 */
export function queueLay(queued, major, minor, tight = 1, beside = undefined, grid = false) {
  const along = beside && beside.places >= 3;
  const pitch = along ? beside.run / beside.places : OFFICE_QUEUE_PITCH * tight;
  // `+ 1` because a lane count is places, not gaps: a run of exactly one pitch
  // holds two people, at either end of it.
  const lanes = along ? beside.places - 1 : Math.max(1, Math.floor(major / pitch) + 1);
  let files = 0;
  for (let left = Math.max(0, queued); left > 0; files++) left -= rowPlaces(lanes, files, grid);
  const row = OFFICE_QUEUE_ROW * tight;
  return {
    lanes,
    files: Math.max(1, files),
    tight,
    pitch,
    row,
    fits: (Math.max(1, files) - 1) * row <= minor,
    beside: !!along,
    grid,
  };
}

/** How many stand in row `file` of a queue `lanes` wide: one fewer in every other row. */
function rowPlaces(lanes, file, grid = false) {
  return !grid && lanes > 1 && file % 2 === 1 ? lanes - 1 : lanes;
}

/**
 * Where the `i`-th person in a laid queue stands: how far along its row, and
 * how many rows back, both from the first place of the first row.
 * @param {number} i @param {ReturnType<typeof queueLay>} lay
 * @returns {{along:number, back:number}}
 */
export function queuePlace(i, lay) {
  let file = 0;
  let k = Math.max(0, Math.floor(i));
  while (k >= rowPlaces(lay.lanes, file, lay.grid)) k -= rowPlaces(lay.lanes, file++, lay.grid);
  const half = !lay.grid && lay.lanes > 1 && file % 2 === 1 ? 0.5 : 0;
  return { along: (k + half) * lay.pitch, back: file * lay.row };
}

// ---------------------------------------------------------------- the seats

/**
 * The manager's desk centre — what everybody in this room faces, and what the
 * queue is ordered by. Falls back to the head of the room for a reception that
 * somehow has no desk in it, so ordering never divides by a missing prop.
 * @param {Room} room
 */
function deskCentreOf(room) {
  const desk = (room.props || []).find((p) => p.id === 'user-desk');
  return desk
    ? { x: desk.x + desk.w / 2, y: desk.y + desk.h / 2 }
    : { x: room.x + room.w / 2, y: room.y };
}

/**
 * Seat the waiting agents on the reception furniture, after that furniture has
 * been placed for real.
 *
 * This runs late on purpose. The sofas and the queue are anchored to the room's
 * own frame, so their final coordinates are not known until the room has been
 * sized, tiled and had its anchors resolved. An earlier version computed seats
 * from the pre-anchor layout, and agents appeared to sit on the floor beside
 * the furniture rather than on it - the two frames simply were not the same.
 *
 * THE WAITING SIT ON THE SOFAS (WP-93). The owner, 15 September: _"They all
 * should sit on the sofa. Only the agent I open walks up to the manager desk."_
 * WP-78 had put the whole queue in a row of chairs at the desk and left the
 * three runs seating nobody; this is that package's departure taken back.
 *
 * THE ORDER IS THE QUEUE, AND THE QUEUE IS ARRIVAL ORDER. `assignSeats` hands
 * this array the waiting agents sorted oldest first, so seat 0 has to be the
 * place nearest the manager. The sofa places come first, sorted by distance
 * from the desk centre - which fills the two runs from their open ends inward
 * and the back run last, exactly as a real waiting room fills - and then the
 * standing queue, in the order `buildOffice` laid it out.
 *
 * THE VISITOR CHAIR IS NOT IN `officeSeats`. It holds one person, it is chosen
 * by the user rather than by the clock, and putting it at index 0 would give it
 * to the longest wait by default - which is the thing WP-93 removes. It comes
 * back beside the queue as `officeChair`, and `assignSeats` reaches for it only
 * for the session whose panel is open.
 *
 * @param {Room} room the office, with anchors already resolved
 * @param {number} waitingCount
 * @returns {{officeSeats: Seat[], officeChair: Seat|null}} the plan's own two
 *   fields, named as the plan names them, so `buildPlan` spreads the result
 *   rather than unpacking two answers to the same question.
 */
export function seatOffice(room, waitingCount) {
  /** @type {Seat[]} */
  const seats = [];
  const officeChair = officeChairSeat(room);
  if (waitingCount <= 0) return { officeSeats: seats, officeChair };

  const deskCentre = deskCentreOf(room);

  /** @param {number} x @param {number} y @param {boolean} [standing] */
  const place = (x, y, standing) => {
    if (seats.length >= waitingCount) return;
    /** @type {Seat} */
    const seat = { x, y, angle: angleTo({ x, y }, deskCentre) };
    // A queue place has no chair under it, and a character drawn seated over
    // bare carpet is a character sitting on the floor. `agents.js` reads this.
    if (standing) seat.standing = true;
    seats.push(seat);
  };

  const near = (p) => Math.hypot(p.x - deskCentre.x, p.y - deskCentre.y);
  const runs = room.props.filter((p) => p.kind === 'sofa');
  // Rule 1: everybody sits while the sofas hold them, and the first person who
  // has to stand empties the corner cushions.
  const full = runs.flatMap((p) => sofaPlacesOn(p, runs));
  const cushions = (
    waitingCount > full.length ? runs.flatMap((p) => sofaPlacesOn(p, runs, true)) : full
  ).sort((a, b) => near(a) - near(b) || a.x - b.x || a.y - b.y);
  for (const c of cushions) place(c.x, c.y);

  const index = (z) => Number(String(z.id).slice(OFFICE_QUEUE_ZONE.length));
  const queue = (room.zones || [])
    .filter((z) => typeof z.id === 'string' && z.id.startsWith(OFFICE_QUEUE_ZONE))
    .sort((a, b) => index(a) - index(b));
  for (const z of queue) place(z.x + z.w / 2, z.y + z.h / 2, true);

  return { officeSeats: seats, officeChair };
}

/**
 * The one place at the manager's desk, for the session the user has OPEN
 * (WP-93).
 *
 * Derived from the same resolved furniture `seatOffice` reads, and returned
 * separately from the waiting places for the reason stated above: it is the
 * only thing on the floor that a user's selection decides, and it must not be
 * reachable by waiting long enough. `null` for a reception without a chair,
 * so a caller may ask without a guard.
 *
 * Nothing here is stored. The chair is a coordinate; whether anybody is in it
 * is `assignSeats`'s answer, recomputed from the selection every time it is
 * asked, and no observed event can reach it — `test/unit/occupancy.test.mjs`
 * holds that as an `INVARIANT:` test.
 *
 * @param {Room} room the office, with anchors already resolved
 * @returns {Seat|null}
 */
export function officeChairSeat(room) {
  const chair = (room.props || []).find(
    (p) =>
      p.kind === 'tub_chair' && typeof p.id === 'string' && p.id.startsWith(OFFICE_VISITOR_ZONE),
  );
  if (!chair) return null;
  const at = { x: chair.x + chair.w / 2, y: chair.y + chair.h / 2 };
  return { x: at.x, y: at.y, angle: angleTo(at, deskCentreOf(room)) };
}
