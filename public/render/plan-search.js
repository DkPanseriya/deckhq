/**
 * How the envelope search ranks two arrangements of the same floor.
 *
 * `plan.js` enumerates candidates — a service-column width, a band count, a
 * strip width, a band depth and a lounge density — and this decides which of
 * them is the better answer to the window it is being drawn in. Split out of
 * `plan.js` by WP-59c, which took that file past `model.test.mjs`'s 900-line
 * ceiling for the second time; §139 split `plan-envelope.js` off the first.
 *
 * It is `docs/DEVIATIONS.md` §131's SHAPE 1 — pure functions of their
 * arguments — because that is what a comparator is. Nothing in here reads a
 * room, a plan or a closure: `score` turns one candidate envelope into the
 * handful of numbers the order is expressed over, and `better` is the order.
 * Two files' worth of the same ranking is how a search comes to prefer one
 * thing while its comments describe another, so there is exactly one copy and
 * `plan.js` imports it.
 */

import {
  ASPECT_SETTLE,
  ASPECT_TOLERANCE,
  FLOOR_OPEN_MAX,
  OPEN_FLOOR_MAX,
  SERVICE_COLUMN_MAX,
  WORKING_OPEN_MAX,
} from './plan-units.js';

/** How far past `ASPECT_SETTLE` a shape has to be before the search chases it. */
const SETTLED = Math.log(1 + ASPECT_SETTLE);

/**
 * Price one candidate envelope: the numbers `better` orders them by.
 *
 * @param {{W:number, H:number, bandSkew:number, open:number, workOpen:number,
 *   pack:number, bandOpen:number, gridErr:number,
 *   serviceShare:number}} candidate
 * @param {number} targetAspect the stage's shape
 * @param {number} roomCount project rooms on this floor
 */
export function score(candidate, targetAspect, roomCount) {
  const aspectErr = Math.abs(Math.log(candidate.W / candidate.H / targetAspect));
  // How far past `ASPECT_SETTLE` this shape is. Inside that band, zero: a
  // floor already the shape of the window has nothing left to buy, and what it
  // competes on is how little of itself is empty.
  const miss = Math.max(0, aspectErr - SETTLED);
  // The two emptiness budgets, as a flag and as a quantity. A row of rooms
  // that could not be filled is the empty lot beside them and is the defect,
  // so it is worth twice a building that is merely emptier overall than
  // `FLOOR_OPEN_MAX`. `overrun` is the same two facts as a magnitude, and
  // `better` reads it only when both arrangements are already illegal.
  const illegal =
    (candidate.bandSkew > OPEN_FLOOR_MAX ? 2 : 0) + (candidate.open > FLOOR_OPEN_MAX ? 1 : 0);
  const overrun =
    2 * Math.max(0, candidate.bandSkew - OPEN_FLOOR_MAX) +
    Math.max(0, candidate.open - FLOOR_OPEN_MAX);
  // And a service column that has taken more than its share of a floor whose
  // subject is the rooms. Only once there is more than one room: a reception,
  // a lounge and a single two-desk project honestly IS mostly service, and
  // saying otherwise would draw the one room three times the size its desks
  // need.
  //
  // Stated as the AREA share since WP-59d, because arrangement B's service
  // rooms are two ends of two rows rather than one full-height column. On a
  // column the two are the same number — a column spans the building's height,
  // so its area share IS its width share — which is what lets one rank serve
  // both arrangements without moving any floor the column ever chose.
  const cramped = roomCount >= 2 && candidate.serviceShare > SERVICE_COLUMN_MAX ? 1 : 0;
  // And how much of the WORKING SIDE nobody stands on, past its own budget
  // (WP-59c). Inside the budget it is zero for every candidate, so a floor
  // that fills its own side has already paid and competes on the rest — the
  // same shape as `miss` above, and for the same reason.
  const spare = Math.max(0, candidate.workOpen - WORKING_OPEN_MAX);
  return { ...candidate, aspectErr, miss, illegal, overrun, cramped, spare };
}

/**
 * Is envelope `a` a better answer to this stage than envelope `b` (WP-59,
 * reordered by WP-59b)?
 *
 * In order, and the order is the design:
 *
 *   1. **Legal first, and there are two budgets.** A band of rooms past
 *      `OPEN_FLOOR_MAX` is a row that could not be filled — the empty lot
 *      beside the rooms, which is the defect — and is worth twice a building
 *      past `FLOOR_OPEN_MAX`, which is merely a hangar. WP-59 had one bound,
 *      over the whole envelope; the band's is WP-59b's, and it is the one that
 *      shapes the picture.
 *   1a. **Then, ONLY between two illegal arrangements, by how much.** A flag
 *      alone is what made a monster of this rank once: on a floor where
 *      nothing is inside both budgets every candidate is equally illegal, the
 *      rank collapses, and the next one picks whichever hangar is closest to
 *      the window's shape — twelve rooms in one row 226 units wide with 76% of
 *      the building open floor, which is a real arrangement this search
 *      returned. Between two LEGAL arrangements the excess is zero for both
 *      and this decides nothing, which is the point: a floor inside its budget
 *      has already paid, and making it compete on tightness again is how a
 *      tiny building beats one that fills the window.
 *   2. **The shape of the window.** `miss` is how far past `ASPECT_SETTLE`
 *      the envelope's aspect sits, so every arrangement already close enough
 *      ties here and competes on the rest.
 *   3. **The subject of the floor.** Of the arrangements that are the window's
 *      shape, one whose service column has taken more than
 *      `SERVICE_COLUMN_MAX` is a picture of a lounge with some work going on
 *      beside it, and loses to one that has not.
 *
 *      BELOW the shape, and that is a decision rather than an oversight. A
 *      WIDER column is a SHORTER one — the reception and the lounge pack into
 *      fewer, longer rows — so a narrower column makes a TALLER building, and
 *      a floor with two small rooms beside a full lounge that is forced to
 *      keep its column under 40% comes out 0.85:1 on a 1.6:1 window, which is
 *      47% of it. Measured, at three stages, over every population in
 *      `floor-integrity.test.mjs`: ranking this above the shape cost four of
 *      them between 23 and 33 points of coverage. So the rule holds wherever
 *      it is free — which on the owner's floor is everywhere, because there
 *      the widest column the search wants is 37.6% — and gives way where the
 *      price is the window.
 *   4. **How empty the WORKING SIDE is (WP-59c).** `spare` is how far past
 *      `WORKING_OPEN_MAX` the rooms and the strip leave their own side of the
 *      building, so every arrangement already inside the budget ties here and
 *      competes on the rest. This is the rank the third pass at this picture
 *      turns on: §140's budgets are both satisfied by a floor whose three
 *      rooms fill their row, whose strip fills its width, and whose bottom
 *      two fifths is one bare open-plan block, because a lounge full of
 *      benched agents set the height and nothing on the working side grew to
 *      meet it. That block is what the owner saw.
 *
 *      BELOW the shape and below the column's share, and both of those are
 *      deliberate. Above the shape it would buy fill with the window, which
 *      is the regression §139 exists to have fixed; above `cramped` it would
 *      buy fill by making the working side NARROWER — a fat service column is
 *      an easy way to have less floor to fill, and it is the exact picture
 *      §140 removed.
 *   5. **The loosest lounge that does the job (WP-59c).** Step (c): a denser
 *      lounge is a shorter service column and therefore a working side there
 *      is less of to fill, and it is bought ONLY where it buys fill. Ranked
 *      under `spare`, so a lounge is packed to fill the floor beside it and
 *      never to chase a ratio.
 *   6. **How far across its row each row of rooms reaches.** `bandOpen`, the
 *      absolute measure the legality above could not be: of two arrangements
 *      the same shape, the one whose rooms reach further across the working
 *      side. It is what decides between laying the band shallow and wide or
 *      deep and narrow, and on the owner's floor it is 24% of the row against
 *      12% (WP-59b).
 *   7. **The grid the rooms want.** Of what is left, the grid whose cells are
 *      closest to the shape the rooms themselves are — three across rather
 *      than three stacked, `2 x 2` rather than a row of four in a band deep
 *      enough for two (WP-59b).
 *   8. **The least empty of those.** WP-55's rule, unchanged.
 *   9. **Then closest to the shape, then smallest.** Both pure tie-breaks, and
 *      the last one is there so the search is a function of its inputs rather
 *      than of the order the loops happen to run in.
 *
 * @param {{illegal:number, overrun:number, miss:number, cramped:number,
 *   spare:number, pack:number, bandOpen:number, gridErr:number, open:number,
 *   aspectErr:number, W:number, H:number}} a
 * @param {{illegal:number, overrun:number, miss:number, cramped:number,
 *   spare:number, pack:number, bandOpen:number, gridErr:number, open:number,
 *   aspectErr:number, W:number, H:number}} b
 */
export function better(a, b) {
  if (a.illegal !== b.illegal) return a.illegal < b.illegal;
  if (a.illegal > 0 && Math.abs(a.overrun - b.overrun) > 1e-4) return a.overrun < b.overrun;
  if (Math.abs(a.miss - b.miss) > 1e-4) return a.miss < b.miss;
  if (a.cramped !== b.cramped) return a.cramped < b.cramped;
  if (Math.abs(a.spare - b.spare) > 1e-4) return a.spare < b.spare;
  if (Math.abs(a.pack - b.pack) > 1e-6) return a.pack > b.pack;
  if (Math.abs(a.bandOpen - b.bandOpen) > 1e-3) return a.bandOpen < b.bandOpen;
  if (Math.abs(a.gridErr - b.gridErr) > 1e-3) return a.gridErr < b.gridErr;
  if (Math.abs(a.open - b.open) > 1e-4) return a.open < b.open;
  if (Math.abs(a.aspectErr - b.aspectErr) > 1e-4) return a.aspectErr < b.aspectErr;
  return a.W * a.H < b.W * b.H - 1e-6;
}

/** How much less open floor makes one arrangement a different answer. */
const OPEN_SETTLE = 0.02;

/**
 * Is ARRANGEMENT `a` a better answer to this stage than arrangement `b`
 * (WP-59d)?
 *
 * A different question from `better`, and a much shorter one. `better` ranks
 * two candidates of the SAME shape, where a dozen things are comparable
 * because everything else about them is the same; this ranks two floors that
 * are not the same building at all — a service column beside a working side
 * against a reception over a lounge — and almost nothing carries across.
 *
 * Three ranks, in this order:
 *
 *   1. **Is it the shape of the window at all?** `ASPECT_TOLERANCE` is
 *      §139's ACCEPTANCE — 15% off the stage's ratio, which is 87% of its
 *      width — and it is used here exactly as it is used there: as a bar to
 *      clear, not as a thing to chase. An arrangement that clears it beats one
 *      that does not, whatever either leaves open, because a building that
 *      does not fill the window is the regression WP-59 exists to have fixed
 *      and no amount of tidiness inside a small building buys it back.
 *      Measured, at three stages over the fifteen populations: without this
 *      rank a reference floor came out 1.07:1 on a 1.78:1 window — 60% of it —
 *      with a working side that was admirably full.
 *   2. **The open floor.** Between two arrangements that both clear the bar,
 *      or two that both miss it, this is the whole of why there is a second
 *      arrangement: §141 left 43% of the owner's working side as open plan
 *      with every lever at its stop, and the only thing that could have fixed
 *      it was a different shape. `OPEN_SETTLE` is the band inside which two
 *      arrangements are the same answer — two points, a tenth of the gap this
 *      exists to close — so a floor does not refold itself to buy a rounding.
 *   3. **And then the shape** (§139), for the two that are equally full.
 *
 * Ranks 2 and 3 are the opposite way round from `better`'s, and deliberately.
 * Inside one arrangement the shape leads all the way, because a column that
 * chases fill buys it by making the building narrower than the window.
 * BETWEEN two arrangements that are both the window's shape there is no such
 * trade: a two-row building is not a narrower one, it is a differently folded
 * one, and the fill is the only reason to prefer it.
 *
 * @param {{workOpen:number, aspectErr:number}} a
 * @param {{workOpen:number, aspectErr:number}} b
 */
export function betterArrangement(a, b) {
  const bar = Math.log(1 + ASPECT_TOLERANCE);
  const offShape = (c) => (c.aspectErr > bar + 1e-9 ? 1 : 0);
  if (offShape(a) !== offShape(b)) return offShape(a) < offShape(b);
  // 1b. AND, BETWEEN TWO THAT BOTH MISS IT, one that misses it by a whole
  // tolerance more still loses. Without this the second rank does the same
  // damage inside the exemption that the first rank exists to prevent outside
  // it: on a floor neither arrangement can shape, a 0.98:1 building with a
  // full working side beat a 1.51:1 one, and covered 55% of a 1.78:1 window
  // against 95%.
  if (Math.abs(a.aspectErr - b.aspectErr) > bar) return a.aspectErr < b.aspectErr;
  if (Math.abs(a.workOpen - b.workOpen) > OPEN_SETTLE) return a.workOpen < b.workOpen;
  return a.aspectErr < b.aspectErr - 1e-4;
}
