/**
 * WHERE THE WAITING SIT AND STAND in the user's office.
 *
 * Split out of `plan-office.js`, which builds the room: these are the places
 * in it. The owner's rule, stated twice: _"They all should sit on the sofa.
 * Only the agent I open walks up to the manager desk."_ A reception of sixteen
 * once stood five of them in the middle of the rug in front of cushions nobody
 * was sitting on, because a run was counted in label pitches rather than in
 * cushions. So:
 *
 *   1. **A run seats one person per cushion.** The count is the one the sofa
 *      is drawn with (`sofaCushionCount`, carried on the prop as `cushions`),
 *      and a place is the middle of a cushion.
 *   2. **Nobody stands while a cushion is free.** Corner cushions included.
 *   3. **The runs fill together, nearest the manager first.** The oldest wait
 *      takes the cushion nearest the desk, the next takes the nearest on the
 *      next run, and so round. Every other cushion is taken first and the ones
 *      between them after, so two people sit shoulder to shoulder only once a
 *      run has nowhere else to put them — and a run across the screen, where
 *      two names can be set at two levels, closes up before one down it.
 *   4. **Whoever is left stands in one file along the wall**, at the head of
 *      the room beside the seating: never on the rug, never between the sofas
 *      and the desk.
 *
 * Pure geometry. `seatOffice` reads the office's own resolved furniture, so it
 * must run after `resolveAnchors`.
 */

import { OFFICE_SOFA_PITCH, SOFA_DEPTH, SOFA_SEAT_BIAS, angleTo } from './plan-units.js';

/** @typedef {import('./plan-units.js').Prop} Prop */
/** @typedef {import('./plan-units.js').Room} Room */
/** @typedef {import('./plan-units.js').Seat} Seat */

/** The prefix every standing queue place carries, as a zone id. */
export const OFFICE_QUEUE_ZONE = 'office-queue-';
/** The prefix every visitor chair carries, as a prop and a zone id. */
export const OFFICE_VISITOR_ZONE = 'office-visitor-';

/**
 * The arm at each end of a sofa run, in plan units: the painter's own
 * `SOFA_ARM_U`, restated here because a plan does not import a painter.
 * `test/unit/occupancy.test.mjs` holds the two equal.
 */
export const SOFA_ARM = 0.6;

/** The arm a run of this depth is drawn with: never more than a third of it. */
function armOf(depth) {
  return Math.min(depth * 0.34, SOFA_ARM);
}

/**
 * How many seat cushions a sofa run has, which is how many it seats.
 *
 * A cushion is about as wide as the sofa is deep, between the two arms: the
 * painter's own rule (`backdrop-props-lounge.js`), in plan units so that it is
 * the same number at every zoom. `buildOffice` writes it on each run as
 * `cushions` and the painter draws that many, so a person is never seated on a
 * seam.
 * @param {number} runLen @param {number} [depth]
 */
export function sofaCushionCount(runLen, depth = SOFA_DEPTH) {
  const len = Number(runLen);
  const d = Number(depth);
  if (!Number.isFinite(len) || !(len > 0) || !(d > 0)) return 0;
  return Math.max(1, Math.round(Math.max(0, len - armOf(d) * 2) / d + 1e-9));
}

/**
 * Where people sit on ONE sofa run, in the room's own resolved frame: the
 * middle of each cushion, in order along the run.
 *
 * Forward of the centre line by `SOFA_SEAT_BIAS` of the run's depth, because
 * the back cushion occupies the far third of it (`backdrop.js`'s sofa case)
 * and a body drawn on the centre line is sitting on the back.
 *
 * The rect says which way the run lies and the angle says which way it faces,
 * exactly as they do for the painter — so this is correct for the portrait
 * reception and for the transposed row one without being told which it has.
 * @param {Prop} sofa
 * @returns {{x:number, y:number}[]}
 */
export function sofaPlacesOn(sofa) {
  const vertical = sofa.h > sofa.w;
  const len = vertical ? sofa.h : sofa.w;
  const depth = vertical ? sofa.w : sofa.h;
  const n = sofa.cushions && sofa.cushions > 0 ? sofa.cushions : sofaCushionCount(len, depth);
  if (n === 0) return [];
  const arm = armOf(depth);
  const cushion = (len - arm * 2) / n;
  const forward = depth * SOFA_SEAT_BIAS;
  const bias = {
    x: vertical ? Math.cos(sofa.angle || 0) * forward : 0,
    y: vertical ? 0 : Math.sin(sofa.angle || 0) * forward,
  };
  /** @type {{x:number, y:number}[]} */
  const out = [];
  for (let i = 0; i < n; i++) {
    const along = arm + (i + 0.5) * cushion;
    out.push(
      vertical
        ? { x: sofa.x + sofa.w / 2 + bias.x, y: sofa.y + along }
        : { x: sofa.x + along, y: sofa.y + sofa.h / 2 + bias.y },
    );
  }
  return out;
}

/**
 * Every cushion in the room, in the order the queue takes them (rule 3).
 *
 * Each run is read nearest the desk first, and split in two: every other
 * cushion starting from that nearest one, and the cushions between them. The
 * runs are then dealt round, one cushion each, nearest run first — all the
 * first halves, then the cushions between on the runs that lie ACROSS the
 * screen, then those on the runs that lie down it. A cushion of the second
 * half on a run across the screen carries `nameRow: 1`: both its neighbours
 * are taken by then, and its name is set a line under theirs.
 *
 * @param {Prop[]} runs every sofa run in the room, resolved
 * @param {{x:number, y:number}} desk what "nearest" is measured from
 * @returns {{x:number, y:number, nameRow?:number}[]}
 */
export function cushionOrder(runs, desk) {
  const near = (p) => Math.hypot(p.x - desk.x, p.y - desk.y);
  const byNear = (a, b) => near(a) - near(b) || a.x - b.x || a.y - b.y;
  const lines = runs
    .map((run) => {
      const sorted = sofaPlacesOn(run)
        .map((p, index) => ({ ...p, index }))
        .sort(byNear);
      const across = run.w >= run.h;
      // ON A RUN DOWN THE SCREEN the next person is ABOVE this one, and the
      // wait badge over a head needs a body's height and its own clear of
      // them: a sofa place, whatever the cushions came to. Where two cushions
      // are shorter than that — a run cut to a shallower room — the first
      // half is every THIRD cushion, and a badge never lands on a neighbour.
      const cushion =
        sorted.length > 1 ? (Math.max(run.w, run.h) - SOFA_ARM * 2) / sorted.length : Infinity;
      const stride = across || cushion * 2 >= OFFICE_SOFA_PITCH - 1e-6 ? 2 : 3;
      const parity = sorted.length ? sorted[0].index % stride : 0;
      const place = ({ x, y }) => ({ x, y });
      return {
        across,
        first: sorted.filter((p) => p.index % stride === parity).map(place),
        between: sorted
          .filter((p) => p.index % stride !== parity)
          .map((p) => (across ? { ...place(p), nameRow: 1 } : place(p))),
      };
    })
    .filter((line) => line.first.length > 0)
    .sort((a, b) => byNear(a.first[0], b.first[0]));
  /** @param {{x:number, y:number, nameRow?:number}[][]} hands */
  const deal = (hands) => {
    const out = [];
    for (let k = 0; hands.some((h) => k < h.length); k++) {
      for (const h of hands) if (k < h.length) out.push(h[k]);
    }
    return out;
  };
  return [
    ...deal(lines.map((l) => l.first)),
    ...deal(lines.filter((l) => l.across).map((l) => l.between)),
    ...deal(lines.filter((l) => !l.across).map((l) => l.between)),
  ];
}

// ------------------------------------------------------- the standing queue

/**
 * How far along its wall each of `queued` people stands, from the head of the
 * file (rule 4): `pitch` apart while the wall has the room, and closed up
 * evenly once it has not, so the file never leaves the wall for the rug.
 * @param {number} queued @param {number} run the wall the file has
 * @param {number} pitch @returns {number[]}
 */
export function queueAlong(queued, run, pitch) {
  const n = Math.max(0, Math.floor(queued));
  const step = n > 1 ? Math.min(pitch, Math.max(0, run) / (n - 1)) : 0;
  return Array.from({ length: n }, (_, i) => i * step);
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
 * place nearest the manager. The cushions come first, in `cushionOrder` - the
 * three runs filling together from the desk outward - and then, only once
 * every cushion is taken, the file along the wall, in the order `buildOffice`
 * laid it out.
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

  /** @param {number} x @param {number} y @param {boolean} [standing] @param {number} [nameRow] */
  const place = (x, y, standing, nameRow) => {
    if (seats.length >= waitingCount) return;
    /** @type {Seat} */
    const seat = { x, y, angle: angleTo({ x, y }, deskCentre) };
    // A queue place has no chair under it, and a character drawn seated over
    // bare carpet is a character sitting on the floor. `agents.js` reads this.
    if (standing) seat.standing = true;
    if (nameRow) seat.nameRow = nameRow;
    seats.push(seat);
  };

  // Rules 1 to 3: every cushion, and nobody on their feet while one is free.
  const runs = room.props.filter((p) => p.kind === 'sofa');
  for (const c of cushionOrder(runs, deskCentre)) place(c.x, c.y, false, c.nameRow);

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
