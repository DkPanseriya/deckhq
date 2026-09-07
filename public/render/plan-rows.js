/**
 * ARRANGEMENT B — the building as two rows (WP-59d).
 *
 * `docs/DEVIATIONS.md` §141 (WP-59c) pulled every lever the COLUMN
 * arrangement has and proved, by arithmetic rather than by eye, that it is not
 * enough on the owner's own floor: a reception over a lounge holding
 * twenty-three benched agents is seventy units tall, four one-desk rooms and a
 * fourteen-line board want about thirty between them, and 43% of the working
 * side stayed open plan with the rooms at their bare-carpet cap, the strip on
 * its last rung and the lounge at its densest. The floor it left is the
 * picture this module exists to replace: a tall service column down the left,
 * a shallow band of rooms across the top of the rest, and a bare block filling
 * the bottom two fifths of the building.
 *
 * THE SHAPE. The same furniture, turned through ninety degrees:
 *
 *     +---------------+-------------------------------+
 *     | the office    | the project rooms, across     |  row 1
 *     +---------------+-------------------------------+
 *     |            one corridor, wall to wall         |
 *     +-----------------------------------------------+
 *     | the lounge, the whole width                   |  row 2
 *     +-----------------------------------------------+
 *
 * ROW TWO USED TO BE SHARED with a strip of idle repos down its right
 * (WP-59d). WP-60 took that strip off the floor and made it a popover, so the
 * lounge is the whole of row two: full width, short, and no corner of open
 * floor beside it that nothing stands on.
 *
 * The reception is WIDE and not tall — its waiting area runs along its width
 * and its desk is at one end (`buildOfficeRow`) — and the lounge is wide and
 * short, its clusters and its benched population packed along the width rather
 * than down a column. Both rows fill their width exactly, so the building's
 * height is row one plus the corridor plus row two, and no side of it is left
 * over to become open floor.
 *
 * WHY ONE ROW OF ROOMS, ALWAYS. The corridor between the rows is the whole nav
 * graph: every room in row one takes a door on its bottom edge and every room
 * in row two on its top edge, and one line is trivially connected. A SECOND
 * band of rooms inside row one would need an aisle of its own to reach that
 * corridor — a third piece of circulation this plan has never had, and one
 * that would run PARALLEL to the corridor it was trying to meet, which is a
 * graph in two pieces. So a floor whose rooms will not stand in one row is not
 * offered this arrangement at all and is laid as a column, which is what a
 * column is for.
 *
 * It is `docs/DEVIATIONS.md` §131's SHAPE 3, a closure, for the same reason
 * `plan-envelope.js` is one: every measurement in here reads `naturalOf(i)`,
 * what a room's furniture needs at the size it was last built, and the fit
 * loop rebuilds that underneath it.
 */

import { better, score } from './plan-search.js';
import {
  CORRIDOR,
  LOUNGE_PACKS,
  LOUNGE_ROW_ASPECT_MAX,
  LOUNGE_ROW_MIN_W,
  MARGIN,
  MIN_PROJECT_ROOM_W,
  OFFICE_MAX_W,
  OFFICE_MIN_W,
  OFFICE_ROW_MAX_DEPTH,
  OFFICE_ROW_MAX_W,
  OFFICE_SEAT_PITCH,
  PLATE_BAND,
  ROOM_FILL_COLUMN_MAX,
  ROOM_FILL_MAX,
  ROOM_HEIGHT_STRETCH_MAX,
  ROOM_PAD,
  SERVICE_W_STEP,
  WORKING_OPEN_MAX,
} from './plan-units.js';

/** @typedef {import('./plan-units.js').Room} Room */

/**
 * @param {object} deps
 * @param {{room: Room}[]} deps.projectRooms
 * @param {(i:number) => {w:number,h:number}} deps.naturalOf
 * @param {(w:number, depth:number) => {room: Room, officeSeats: any[]}} deps.office
 *   the reception laid on its side, that wide and at least that deep
 * @param {(w:number, h:number, pack:number) => {room: Room, loungeSpots: any[]}} deps.lounge
 * @param {number} deps.waiting agents in the reception's queue
 * @param {ReturnType<typeof import('./plan-envelope.js').createWorkingFloor>} deps.floor
 */
export function createRowFloor(deps) {
  const { projectRooms, naturalOf, office, waiting, floor } = deps;
  const { bandDepthCeiling, bandsOf, costWorkingFloor, layWorkingFloor, workingShape } = floor;

  /**
   * Can this floor be laid in two rows at all?
   *
   * ONE ROW OF ROOMS, and `dealBands` is the judge of it: its DEPTH rule
   * (`HEIGHT_BAND_RATIO`) starts a new row for a room much shallower than the
   * one it would share with, whatever row count it was asked for, because a
   * shallow room in a deep band is the bare-carpet defect one level down. A
   * floor it splits has no single row, and there is nothing this module could
   * honestly do about that — so it says no, and the column takes it.
   */
  const oneRow = () => projectRooms.length === 0 || bandsOf(1).length === 1;

  /**
   * The lounge at the end of row two, and the two things a row asks of it that
   * a column does not.
   *
   * IT TAKES THE WIDTH IT WAS GIVEN whatever its blocks packed to — open floor
   * in a lounge is a lounge, and the alternative is a strip of circulation
   * beside it doing the same job less honestly — AND IT KEEPS ITS PROPORTION,
   * which is §139's rule for the column lounge read on the row's axis: eighty
   * units with a television at one end and a pool table at the other is a
   * corridor with sofas in it.
   *
   * The measurement is cached on a 2 U grid and always ROUNDED DOWN, which is
   * what makes the cache safe rather than merely fast: a lounge shelf-packed
   * into a narrower budget is as tall or taller, so the height the search
   * prices a row at is an upper bound on the height that row will need.
   * Rounding the other way would report a row shorter than the lounge in it.
   * @type {Map<string, {room:Room, loungeSpots:any[]}>}
   */
  const loungeCache = new Map();
  const lounge = (w, h, pack) => {
    const grid = Math.floor(w / 2) * 2;
    const key = h > 0 ? '' : `${grid}@${pack}`;
    const hit = key ? loungeCache.get(key) : null;
    if (hit) return hit;
    const built = deps.lounge(key ? grid : w, h, pack);
    built.room.w = w;
    // The proportion, AS FAR AS ITS CONTENTS REACH. A lounge padded past
    // `ROOM_FILL_MAX` of what is in it is the bare-carpet defect §106 removed,
    // and a wide row can ask for a great deal of padding: at 250 units the
    // proportion alone would make it 78 deep for nineteen units of furniture.
    built.room.h = Math.max(
      built.room.h,
      Math.min(w / LOUNGE_ROW_ASPECT_MAX, built.room.natural.h * ROOM_FILL_MAX),
    );
    if (key) loungeCache.set(key, built);
    return built;
  };

  /**
   * The reception at a width, filling a depth.
   *
   * A row office has a shape bound of its own (`OFFICE_ROW_ASPECT_MAX`), so a
   * deep row can hand back a room WIDER than the width it was asked for. That
   * width is real — it is the narrowest that room may honestly be — so it is
   * taken rather than argued with, and the row is measured from what came
   * back. Asking again at that width returns the same room, so this settles in
   * one step.
   */
  const frontFor = (w, depth) => {
    const built = office(w, depth);
    return built.room.w > w + 1e-6 ? office(built.room.w, depth) : built;
  };
  /**
   * The same, remembered, for the thousands of times the search asks.
   *
   * Only ever read for its SIZE — `layRows` builds the reception it actually
   * places with `frontFor`, uncached, because a room that is placed is
   * translated and anchored and must not be shared with the next candidate.
   */
  const frontCache = new Map();
  const measureFront = (w, depth) => {
    const key = `${Math.round(w * 4)}@${Math.round(depth * 4)}`;
    let hit = frontCache.get(key);
    if (!hit) {
      hit = frontFor(w, depth);
      frontCache.set(key, hit);
    }
    return hit;
  };

  /**
   * The whole envelope implied by one two-row arrangement, or `null` where
   * this floor cannot be laid in two rows.
   *
   * The choices are the same three the column has, less the band count (there
   * is one) and read on different axes: how wide the reception is, how deep the
   * rooms are laid, and how densely the lounge is packed. There was a fourth —
   * how wide the idle strip asked to be — and WP-60 took it away with the
   * strip.
   *
   * @param {number} askedW the width asked of the reception
   * @param {number} bandDepth multiple of the depth the rooms need
   * @param {number} pack how densely the lounge is laid (WP-59c step (c))
   */
  const envelopeFor = (askedW, bandDepth, pack) => {
    const shape = workingShape(1);
    const roomsW = projectRooms.length ? Math.max(shape.w, MIN_PROJECT_ROOM_W) : 0;
    const asked = projectRooms.length ? shape.h * bandDepth : 0;
    const row = rowOne(askedW, roomsW, asked);
    if (!row) return null;
    const back = rowTwo(row.W, pack);
    const { W, h1, bandH, forced, ow } = row;
    const H = h1 + CORRIDOR + back.h2;

    const cost = costWorkingFloor(1, roomsW, bandH, forced ? ROOM_FILL_COLUMN_MAX : ROOM_FILL_MAX);
    // WHAT NOBODY STANDS ON, measured against the same thing the column
    // measures it against: the part of the building that holds the rooms. The
    // reception fills its own end of row one and the lounge fills the whole of
    // row two — each is given its row's depth and lays its furniture into it —
    // so neither is open floor, which is the identical treatment `plan.js`'s
    // `envelopeFor` gives the service column.
    //
    // ROW TWO IS NO LONGER IN IT AT ALL (WP-60). It used to be, because the
    // idle strip took the right of it and a strip is content with a corner of
    // open floor under it; the lounge is now the whole row, and a lounge is a
    // room that fills its own rectangle rather than a side to be filled.
    const filled = cost.area;
    const workArea = roomsW * h1;
    const workOpen = workArea > 1e-6 ? Math.max(0, (workArea - filled) / workArea) : 0;
    return {
      arrangement: /** @type {const} */ ('two-rows'),
      W,
      H,
      h1,
      ow,
      roomsW,
      asked,
      bandH,
      forced,
      pack,
      rowCount: 1,
      askedW,
      ...back,
      open: Math.max(0, (workArea - filled) / Math.max(1e-6, W * H)),
      workOpen,
      bandSkew: cost.bandSkew,
      bandOpen: cost.bandOpen,
      gridErr: cost.gridErr,
      // THE RECEPTION'S SHARE OF THE ROW THE ROOMS ARE IN, which is the exact
      // analogue of what `SERVICE_COLUMN_MAX` bounds on a column: the service
      // furniture that is BESIDE the rooms, against the width they share.
      //
      // Row two is deliberately not in it. A column's lounge takes width away
      // from the rooms and this is the rule that stops it; a row's lounge is
      // UNDER them and takes nothing from them, and a floor with thirty-two
      // people in its service rooms and four at desks honestly is mostly
      // service — §139's own words about a reception, a lounge and one
      // two-desk project. Counting row two here rejected every arrangement of
      // the owner's own floor, which is the floor this package is for.
      serviceShare: ow / Math.max(1e-6, W),
      workingW: roomsW,
    };
  };

  /**
   * ROW ONE: the reception, and the rooms across the rest of the width.
   *
   * The reception takes what it was asked for and the rooms take what their
   * furniture needs — the same rule the column uses one axis over, and nothing
   * here is padded to a target. Step (a) of WP-59c's fill order then applies
   * unchanged: the rooms grow DEEPER into the row the reception set, and what
   * stops them is the bare carpet rather than an axis bound.
   */
  const rowOne = (askedW, roomsW, asked) => {
    // BOTH ROWS FILL ONE WIDTH, so row one is as wide as row two needs it to
    // be — which since WP-60 is the narrowest a lounge may be laid, and nothing
    // else. The reception absorbs the difference exactly as the lounge absorbs
    // row two's.
    //
    // Row two used to ask for more: the narrowest board its idle repos could
    // honestly take, beside that same minimum lounge. What the strip ASKED for
    // was spent inside the row rather than added to the building, because a
    // board with two lines on it will happily ask for two columns of
    // twenty-eight and the reception is what would have paid for them — a hall,
    // to widen a footnote. With the strip gone, so is the whole question.
    const w1 = Math.max(OFFICE_MIN_W, askedW) + roomsW;
    const owWanted = Math.max(w1, LOUNGE_ROW_MIN_W) - roomsW;
    let front = measureFront(owWanted, 0);
    let h1 = Math.max(front.room.h, asked, MARGIN * 4);
    // A row deeper than a reception can be is not a row this arrangement can
    // lay: the office would leave a strip of nothing under it, which is the
    // one thing the service side has never done. The column takes that floor.
    if (h1 > OFFICE_ROW_MAX_DEPTH + PLATE_BAND + 1e-6) return null;
    front = measureFront(Math.max(owWanted, front.room.w), h1);
    h1 = Math.max(h1, front.room.h);
    const ow = front.room.w;
    const ceiling = projectRooms.length ? bandDepthCeiling(1, roomsW, ROOM_FILL_COLUMN_MAX) : 0;
    const bandH = projectRooms.length ? Math.min(h1, Math.max(asked, ceiling)) : 0;
    return { ow, h1, W: ow + roomsW, bandH, forced: bandH > asked + 1e-6 };
  };

  /**
   * ROW TWO: the lounge, the whole width.
   *
   * It used to be shared with the idle strip down its right (WP-59d), which
   * took the width its own ladder asked for and left the lounge the rest, with
   * a corner of open floor under it. WP-60 took the strip off the floor, and
   * what is left is the plainest room in the building: the lounge is given the
   * row's full width and lays its clusters and its benched population along it.
   *
   * ITS HEIGHT IS STILL ITS OWN (§106). The row's depth is what the lounge's
   * contents need at that width, not a target it is padded to — see `lounge`
   * above, where the proportion is held only AS FAR AS THE CONTENTS REACH. A
   * lounge padded past `ROOM_FILL_MAX` of what is in it is the bare-carpet
   * defect §106 removed, and on a wide row the padding on offer is enormous.
   * Which is exactly what WP-60 wants of it: row two takes what its benched
   * population is worth, and row one's rooms get the rest of the building.
   */
  const rowTwo = (W, pack) => {
    const back = lounge(W, 0, pack);
    return { loungeW: W, h2: Math.max(back.room.h, MARGIN * 4) };
  };

  /**
   * Lay one two-row candidate for real: the rooms into row one's band, the
   * lounge across row two, and the fit loop over both.
   *
   * The same shape as `plan.js`'s `settle`, and for the same reason — a room
   * rebuilt to the cell it was given needs a different amount of floor from
   * the one it bid with — with the rows' arithmetic in place of the column's.
   *
   * @param {NonNullable<ReturnType<typeof envelopeFor>>} chosen
   * @param {(i:number, cell:{w:number,h:number}, aspect:number) => void} rebuild
   */
  const layRows = (chosen, rebuild) => {
    let roomsW = chosen.roomsW;
    let asked = chosen.asked;
    let row = rowOne(chosen.askedW, roomsW, asked);
    let laid = { cells: [], corridors: [] };
    for (let pass = 0; pass < 8; pass++) {
      floor.invalidateBands();
      row = rowOne(chosen.askedW, roomsW, asked) || row;
      laid = projectRooms.length
        ? layWorkingFloor(
            { x: row.ow, y: 0, w: roomsW, h: row.bandH },
            1,
            row.forced ? ROOM_FILL_COLUMN_MAX : ROOM_FILL_MAX,
          )
        : { cells: [], corridors: [] };
      let worstW = 1;
      let worstH = 1;
      projectRooms.forEach((pr, i) => {
        const cell = laid.cells[i];
        if (!cell) return;
        // NEVER DEEPER THAN A ROOM THE PLAN WOULD HAVE CHOSEN (WP-59c). The
        // depth a row's reception forces on a room goes to its rug, its board
        // and its planting, never to a second row of desks.
        const natural0 = naturalOf(i);
        const flowH = Math.min(cell.h, natural0.h * ROOM_HEIGHT_STRETCH_MAX);
        const aspect =
          Math.max(1, cell.w - ROOM_PAD * 2) / Math.max(1, flowH - ROOM_PAD * 2 - PLATE_BAND);
        rebuild(i, cell, aspect);
        const natural = naturalOf(i);
        worstW = Math.max(worstW, natural.w / cell.w);
        worstH = Math.max(worstH, natural.h / cell.h);
      });
      if (worstW <= 1.0005 && worstH <= 1.0005) break;
      roomsW *= Math.min(worstW, 1.25);
      asked *= Math.min(worstH, 1.25);
    }

    const back = rowTwo(row.W, chosen.pack);
    return {
      W: row.W,
      H: row.h1 + CORRIDOR + back.h2,
      h1: row.h1,
      ow: row.ow,
      roomsW,
      bandH: row.bandH,
      forced: row.forced,
      laid,
      ...back,
      // Built at the size they are drawn at, so `place` has no slack to centre
      // their contents in and a wall-anchored sofa cannot drift from the rug
      // it surrounds — the two-frames defect §57 removed.
      office: frontFor(row.ow, row.h1),
      lounge: lounge(back.loungeW, back.h2, chosen.pack),
    };
  };

  /**
   * The best two-row arrangement of this floor, or `null` where there is not
   * one.
   *
   * SEARCH, SETTLE, AND SEARCH AGAIN — WP-59b's rule, for its own reason and
   * applied to the same rooms: every candidate is priced from what a room's
   * furniture wanted before anything had been laid anywhere, and the fit loop
   * then rebuilds it into the cell it was given, so the first answer is about
   * a different floor from the one that would be drawn.
   *
   * The rooms are left laid to the answer's cells, which is what makes this
   * comparable with the column at all: `plan.js` re-asks whichever arrangement
   * loses, because the loser's numbers are then about a floor that no longer
   * exists.
   *
   * @param {{targetAspect:number, bandDepths:readonly number[],
   *   rebuild:(i:number, cell:any, aspect:number)=>void}} opts
   */
  const searchRows = (opts) => {
    if (!oneRow()) return null;
    // THE RECEPTION IS AS WIDE AS ITS QUEUE, AND THE SEARCH MAY NOT ASK FOR
    // MORE. Its C of sofas runs along its width, so `OFFICE_SEAT_PITCH` a head
    // is exactly what the extra width buys; without this the search found the
    // cheapest way to fill a wide window, which was an empty reception ninety
    // units across. A wider ROW may still hand it more (see `rowOne`) — that
    // width is not the reception's choice, and a padded room is furnished to
    // the size it is given.
    const owMax = Math.min(OFFICE_ROW_MAX_W, OFFICE_MAX_W + waiting * OFFICE_SEAT_PITCH);
    const best = () => {
      let found = null;
      for (const pack of LOUNGE_PACKS) {
        for (let ow = OFFICE_MIN_W; ow <= owMax; ow += SERVICE_W_STEP) {
          for (const bandDepth of opts.bandDepths) {
            const candidate = envelopeFor(ow, bandDepth, pack);
            if (candidate) {
              const scored = score(candidate, opts.targetAspect, projectRooms.length);
              // AND THE ROOMS ARE THE WIDER HALF OF ROW ONE, once there are
              // three of them.
              //
              // That is `the working side is the wider half once it holds
              // three rooms` — §140's own acceptance — used as a REFUSAL here
              // rather than as a preference, because a reception that has
              // taken more than half of row one cannot be argued back down by
              // anything ranked below it: the rooms beside it have nowhere
              // else to be. `SERVICE_COLUMN_MAX` is deliberately not the bound
              // used: it is stated on a column, which is the office AND the
              // lounge, and half of that beside the rooms is a different
              // quantity from a reception beside them. Held to 40% instead of
              // to half, the owner's own floor could not reach 2.02:1 — the
              // width was there, in a reception 48% of a row whose rooms were
              // still the wider half of it.
              if (projectRooms.length >= 3 && candidate.ow >= candidate.W / 2) continue;
              if (!found || better(scored, found)) found = scored;
            }
          }
        }
        if (found && found.workOpen <= WORKING_OPEN_MAX + 1e-6) break;
      }
      return found;
    };
    floor.invalidateBands();
    const bid = best();
    if (!bid) return null;
    layRows(bid, opts.rebuild);
    floor.invalidateBands();
    return oneRow() ? best() : null;
  };

  return { envelopeFor, layRows, oneRow, searchRows };
}
