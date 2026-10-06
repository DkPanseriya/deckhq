/**
 * THE CLASSIC FLOOR: the envelope search, and the two arrangements it lays.
 *
 * Moved whole out of `plan.js` — which stood at 899 of WP-22's 900 lines — so
 * that the assembly step has room for a second way of laying a floor. Every
 * statement below is the one that was in `buildPlan`, in the order it was in,
 * with its comments; the only edits are the function wrapped round it, the
 * names it is handed, and the record it hands back.
 *
 * WHAT IT IS. The search over a service column's width, a band count and a band
 * depth (WP-59), run twice (WP-59b); the second arrangement, the office beside
 * the rooms over the lounge (WP-59d); the stretch to the window (audit F2, F3);
 * and then the rectangles: the service rooms, the spine, the cross corridors,
 * the open floor and the pinned strip (WP-77).
 *
 * Pure geometry. No DOM, no clock, no randomness.
 */

import { createWorkingFloor } from './plan-envelope.js';
import { corridorRoom } from './plan-nav.js';
import { buildProjectRoom, layPinnedStrip } from './plan-rooms.js';
import { createRowFloor, workingMinWidth } from './plan-rows.js';
import { better, betterArrangement, score } from './plan-search.js';
import { buildOffice, buildOfficeRow } from './plan-office.js';
import { buildLounge } from './plan-service.js';
import {
  BAND_DEPTHS,
  BAND_STRETCH_MAX,
  CORRIDOR,
  LOUNGE_PACKS,
  MARGIN,
  MAX_WORKING_ROWS,
  OFFICE_ASPECT_MIN,
  OFFICE_COLUMN_MIN,
  OFFICE_MAX_W,
  OFFICE_MIN_W,
  OFFICE_SURPLUS_SHARE,
  PINNED_AREA_SHARE,
  ROOM_ASPECT_MAX,
  ROWS_ASPECT_MIN,
  SERVICE_MAX_W,
  SERVICE_W_STEP,
  WORKING_OPEN_MAX,
  clamp,
  loungeCeiling,
  pinnedBandHeight,
  pinnedPerRow,
} from './plan-units.js';

/** @typedef {import('./plan-units.js').Room} Room */
/** @typedef {import('./plan-units.js').Seat} Seat */
/** @typedef {import('./plan-units.js').ProjectLike} ProjectLike */

/**
 * Lay one floor the classic way.
 *
 * @param {object} input
 * @param {number} input.targetAspect the window's shape, already clamped
 * @param {number} input.waitingCount agents in the reception's queue
 * @param {number} input.benchedCount people drawn in the lounge
 * @param {number} input.goneHomeCount benched and not drawn; the lounge plate's
 * @param {ProjectLike[]} input.activeProjects the repos that earn a room
 * @param {ProjectLike[]} input.pinnedProjects the repos that keep an empty one
 * @param {(p: ProjectLike) => number} input.desksIn agents at desks in a repo
 * @param {(p: ProjectLike) => ({w:number,h:number}|undefined)} input.crewIn
 *   the floor a repo's largest crew formation asks for (WP-89)
 * @returns {{W:number, H:number, rows:boolean,
 *   office:{room:Room, officeSeats:any[]}, lounge:{room:Room, loungeSpots:any[]},
 *   projectRooms:{room:Room, seats:Seat[]}[], stripRooms:Room[], corridors:Room[],
 *   working:any}} every rectangle placed; `corridors` is the spine, then the
 *   cross corridors, then the open floor and the pinned strip's gaps
 */
export function layClassic(input) {
  const {
    targetAspect,
    waitingCount,
    benchedCount,
    goneHomeCount,
    activeProjects,
    pinnedProjects,
    desksIn,
    crewIn,
  } = input;

  // ---- pass 1: everything at its natural size, purely to bid for space.
  let office = buildOffice(waitingCount);
  let lounge = buildLounge(benchedCount, undefined, goneHomeCount);
  // ARCHIVED SESSIONS ARE OFF THE FLOOR. They get no room and no strip: an
  // archived session is one the user has explicitly put away. They are still
  // counted in the header and still listed in the panel — they simply do not
  // take screen space away from the rooms where work happens.
  //
  // Bid at the shape a ROOM wants, not at a square. `flowBlocks` decides how a
  // project's tables are arranged, and asking it for a square cluster stands a
  // two-table project's benches one above the other — a room twice the depth of
  // its neighbours, dealt a row of its own with a bay beside it (`bandsOf`). One
  // row of tables keeps a band's rooms one depth. WP-89's last argument is the
  // floor this room's largest crew formation asks for, or nothing.
  /** @type {{room: Room, seats: Seat[]}[]} */
  const projectRooms = activeProjects.map((p) =>
    buildProjectRoom(p, desksIn(p), ROOM_ASPECT_MAX, undefined, crewIn(p)),
  );

  // ---- THE SERVICE COLUMN, and the share of the floor it takes.
  //
  // Roughly a third: the user's office above the lounge, with the project
  // rooms — what the product is for — beside them. Earlier revisions let each
  // side ask for what its contents wanted and then tried to reconcile the
  // result, which is how a machine whose sessions are nearly all benched ended
  // up giving 58% of its floor to a reception, a lounge and a room full of
  // archived sessions, and 13% to the rooms with people working in them.
  //
  // The column is what sets the scale: it holds a roughly fixed amount of
  // furniture, so once its width is chosen the rest follows. The search below
  // picks that width.
  const serviceCache = new Map();
  const measureService = (sw, pack = 1, wide = false) => {
    const key = Math.round(sw);
    const cacheKey = `${key}@${pack}${wide ? 'w' : ''}`;
    let got = serviceCache.get(cacheKey);
    if (got) return got;
    // `h: 0` on purpose — this measures what the column NEEDS at that width.
    // Passing a height here makes each room pad itself out to it and the
    // measurement then reports back whatever was asked for.
    // ONE COLUMN WIDTH, and both rooms fill it.
    //
    // The office and the lounge are the same width and each spans the column,
    // so there is no strip of anything beside either of them. A lobby there is
    // a room-shaped piece of nothing next to the room the user reads first,
    // and it was taking width the working floor could have had.
    // The office is NOT packed (WP-59c). The lounge's spacing is a comfort
    // setting; the reception's queue is not, and the room the product is
    // about does not get smaller because the floor beside it is short.
    // `wide` is the stretch (audit F2): the column may pass the office's own cap.
    const o = buildOffice(waitingCount, { w: key, h: 0 }, { maxW: wide ? key : OFFICE_MAX_W });
    const colW = o.room.w;
    const l = buildLounge(benchedCount, { w: colW, h: 0 }, goneHomeCount, pack);
    // The lounge takes the column's width whatever its blocks packed to: open
    // floor in a lounge is a lounge, and the alternative is a strip of
    // circulation beside it doing the same job less honestly.
    l.room.w = colW;
    // AND IT KEEPS ITS PROPORTION (WP-59). The reception has always floored its
    // own height at `IN_W / ROOM_ASPECT_MAX` — a 2:1 reception reads as a
    // corridor with a desk at one end — and the lounge did not, because until
    // the envelope search could spend width on the service column nothing ever
    // asked it to be wide. Now something does: the column at 46 U with twelve
    // benched in it packed to a 19 U lounge, which is a 2.4:1 room. Saying it
    // here rather than in `buildLounge` keeps it beside the width it is a
    // proportion OF, and makes the column self-limiting — a wider column is a
    // taller one, and a taller column stops being what a wide stage wants.
    //
    // AND NOT PAST WHAT ITS OCCUPANTS ARE WORTH (WP-77). The proportion knows
    // nothing about who is in the room, so on a wide column it padded an empty
    // lounge by six units for a ratio. `loungeCeiling` bounds the PADDING; the
    // `max` keeps the contents whatever the ceiling says.
    l.room.h = Math.max(
      l.room.h,
      Math.min(colW / ROOM_ASPECT_MAX, loungeCeiling(benchedCount, o.room.h)),
    );
    got = { w: colW, office: o, lounge: l, h: o.room.h + l.room.h, pack };
    serviceCache.set(cacheKey, got);
    return got;
  };

  /** What a project room's furniture needs, at the size it was last built. */
  const naturalOf = (i) =>
    projectRooms[i].room.natural || { w: projectRooms[i].room.w, h: projectRooms[i].room.h };

  // The working floor — how the rooms are dealt into bands, how wide a band
  // may be laid, and what the whole of it measures. Its own module since
  // WP-59 (`plan-envelope.js`), which is a closure over `naturalOf` because a
  // room’s natural size changes under the fit loop below.
  // OCCUPANCY IS WHAT A CELL'S WIDTH IS SHARED OUT BY (WP-60), and it is the
  // SESSION COUNT rather than the desks.
  //
  // The two are different questions and only one of them is about how much
  // floor a project is worth. `desksIn` is agents AT DESKS RIGHT NOW (`08` B6),
  // which is what the room's furniture is built from and must stay that way —
  // a desk nobody is at is the oldest defect in this file. But on the owner's
  // own machine every active repo had exactly one agent at a desk and the rest
  // finished or benched, so dealt by desks the row came out as four cells of
  // one width — with `24 sessions` on the first plate and `4 sessions` on the
  // last. The number the eye correlates a room's size with is on its door.
  //
  // So: the FURNITURE is desks and the FLOOR is sessions. A project with
  // twenty-four sessions in it is a project twenty-four things have happened in
  // this week, and it earns more room than one with a single session whether or
  // not both have an agent typing at this instant. `CELL_OCCUPANCY_RATIO_MAX`
  // keeps the disparity inside three either way.
  //
  // AND THE PINNED STRIP IS RESERVED OUT OF IT (WP-77): `reserve` is the part
  // of the working side's height that is not the rooms' to grow into. Zero
  // wherever nothing is pinned, so such a floor is laid as WP-60 left it.
  const reserve = (askedBandH, workingW) =>
    pinnedBandHeight(pinnedProjects.length, workingW, askedBandH);
  const minW = workingMinWidth(pinnedProjects.length);
  const workingFloor = createWorkingFloor(
    projectRooms,
    naturalOf,
    (i) => Math.max(1, activeProjects[i].sessionCount ?? desksIn(activeProjects[i])),
    reserve,
  );
  const { costWorkingFloor, fillOrder, invalidateBands, fitColumn, layColumn, workingShape } =
    workingFloor;
  const wideService = (sw, pack) => measureService(sw, pack, true);

  // THE SECOND ARRANGEMENT (WP-59d): the office beside the rooms over the
  // lounge. Its own module for the same reason the working floor is one —
  // every measurement in it reads `naturalOf`, which the fit loop changes
  // underneath it — and handed the two service rooms as BUILDERS rather than
  // as furniture, because a row's reception and lounge are the same two rooms
  // laid at other sizes.
  const rowFloor = createRowFloor({
    projectRooms,
    naturalOf,
    waiting: waitingCount,
    benched: benchedCount,
    reserve,
    minW,
    floor: workingFloor,
    office: (w, depth) => buildOfficeRow(waitingCount, { w, h: depth }),
    lounge: (w, h, pack) => buildLounge(benchedCount, { w, h }, goneHomeCount, pack),
  });

  /**
   * The whole envelope implied by one arrangement: the service column, the
   * spine, and the working floor beside them.
   *
   * THREE CHOICES, AND EVERY ONE OF THEM IS HONEST (WP-59). WP-55 gave the
   * search two — the service column's width and the number of working bands —
   * and pinned the working side's width to the footprint its rooms happened to
   * need. On a machine with one active repo that is about seventeen units, so
   * the envelope came out very nearly square whatever the window was, and the
   * rest of a 1920 x 1080 stage was ground. The third is the depth the room
   * band is laid at; between them they are the difference between a 57 U
   * building and a 90 U one, with nothing stretched and nothing invented.
   *
   * There was a FOURTH — the idle strip's column count — and WP-60 took it
   * away with the strip. A board of repos nobody is in was never a reason to
   * make the building a different shape.
   *
   * @param {number} sw service-column width
   * @param {number} rowCount bands of project rooms
   * @param {number} bandDepth multiple of the depth the rooms need
   * @param {number} pack how densely the lounge is laid (WP-59c, step (c))
   */
  const envelopeFor = (sw, rowCount, bandDepth, pack) => {
    const measured = measureService(sw, pack);
    const shape = workingShape(rowCount);
    const asked = projectRooms.length ? shape.h * bandDepth : 0;
    // A floor with nothing live in it but something PINNED still has a working
    // side: the pinned strip stands on it (WP-77).
    const workingW = projectRooms.length || pinnedProjects.length ? Math.max(shape.w, minW) : 0;
    // The height the working side has to fill is the COLUMN's, and the fill
    // order above is what it may do about it (WP-59c) — less the pinned strip.
    const pinH = reserve(asked, workingW);
    const H = Math.max(measured.h, asked + pinH, MARGIN * 4);
    const { bandH, forced } = fillOrder(rowCount, workingW, Math.max(1, H - pinH), asked);
    const W = measured.w + CORRIDOR + workingW;
    // What of this envelope nobody stands on: the working side less its rooms.
    // The service column fills its own side exactly (see below) and the spine
    // is a route, so neither is open floor.
    const cost = costWorkingFloor(rowCount, workingW, bandH);
    const filled = cost.area;
    const workingArea = workingW * H;
    const open = Math.max(0, (workingArea - filled) / Math.max(1e-6, W * H));
    // The same emptiness read against the side it is ON rather than against
    // the building it is in — the measure §139 and §140 both wanted and
    // neither wrote (WP-59c).
    const workOpen = workingArea > 1e-6 ? Math.max(0, (workingArea - filled) / workingArea) : 0;
    return {
      measured,
      pack,
      W,
      H,
      bandH,
      pinH,
      // The depth this candidate ASKED its band to be laid at, before the fill
      // order grew it. `settle` needs the question and not only the answer:
      // handed `bandH` back it would compare the grown depth against itself,
      // conclude that nothing had stretched the rooms, and lay the band to the
      // 30% bare-carpet bound at a depth that was chosen against the 45% one —
      // which comes out as a bay beside the rooms rather than as wider rooms.
      asked,
      forced,
      open,
      workOpen,
      // The share of the building the service rooms take (WP-59d). A column
      // spans the height, so its area share and its width share are one
      // number and this is the width one stated exactly; arrangement B's two
      // row-ends have to say it as an area, and `score` reads the same field
      // for both.
      serviceShare: measured.w / Math.max(1e-6, W),
      // How much shorter the shortest row of rooms is than the longest — the
      // empty lot, measured row against row (WP-59b; see `costWorkingFloor`).
      bandSkew: cost.bandSkew,
      bandOpen: cost.bandOpen,
      gridErr: cost.gridErr,
      // The rows this candidate ASKED FOR, which is what `layWorkingFloor`
      // must be given back: `bandsOf` is keyed on the request, and the deal it
      // returns may hold more bands than that because the depth rule split one
      // (WP-59b). Handing back `shape.rows` — the bands the deal came out with
      // — re-deals the floor to a different grid from the one that was costed,
      // and a request for one row of four came back as three bands with the
      // last of them two thirds empty.
      rowCount,
      workingW,
      shape,
    };
  };

  // ---- PICK THE ARRANGEMENT THAT IS THE SHAPE OF THE WINDOW.
  //
  // WP-55 minimised `max(W / targetAspect, H)`, which is "draw largest on this
  // stage" and was the right objective while the envelope could only be one
  // shape. It is the wrong one now: on a stage the building already fits into,
  // every candidate is drawn at the same scale, so a floor half the width of
  // the window scored exactly as well as one that filled it and the tie-break
  // picked the smaller. WP-59 makes the aspect the objective and the open floor
  // the price: the search takes the arrangement closest to the stage's shape
  // whose open floor stays inside its budgets — `OPEN_FLOOR_MAX` on a row of
  // rooms and `FLOOR_OPEN_MAX` on the building — and among the ones that are
  // already close enough (`ASPECT_SETTLE`) it takes the tightest.
  //
  // Nothing here stretches a room. Every candidate is a real layout: a wider
  // service column shelf-packs the lounge into fewer, shorter rows; more bands
  // make the working floor deeper and narrower; a shallower band lays the same
  // desks in a wider row.
  const maxRows = Math.max(1, Math.min(projectRooms.length, MAX_WORKING_ROWS));
  const bandDepths = projectRooms.length ? BAND_DEPTHS : [BAND_STRETCH_MAX];
  const searchAt = (pack) => {
    let best = null;
    for (let sw = OFFICE_MIN_W; sw <= SERVICE_MAX_W; sw += SERVICE_W_STEP) {
      for (let rows = 1; rows <= maxRows; rows++) {
        for (const bandDepth of bandDepths) {
          const candidate = envelopeFor(sw, rows, bandDepth, pack);
          const scored = score(candidate, targetAspect, projectRooms.length);
          if (!best || better(scored, best)) best = scored;
        }
      }
    }
    return best;
  };

  // THE LOUNGE IS PACKED TO FILL THE FLOOR BESIDE IT, AND FOR NOTHING ELSE
  // (WP-59c, step (c)). The ladder runs loosest first and stops the moment an
  // arrangement fills its working side, so a floor that was never short of
  // height is laid loose — and one that is short buys the height from the only
  // place left that is not a room.
  const search = () => {
    let best = null;
    for (const pack of LOUNGE_PACKS) {
      const found = searchAt(pack);
      if (found && (!best || better(found, best))) best = found;
      if (best && best.workOpen <= WORKING_OPEN_MAX + 1e-6) break;
    }
    return best || envelopeFor(OFFICE_MIN_W, 1, BAND_STRETCH_MAX, 1);
  };

  // Both fit loops live with the arrangement they lay — `layColumn` in
  // `plan-envelope.js`, `layRows` in `plan-rows.js` — and both need the one
  // step this file owns: rebuilding a project's room into a cell.
  const rebuildInto = (i, cell, aspect) => {
    const p = activeProjects[i];
    return (projectRooms[i] = buildProjectRoom(p, desksIn(p), aspect, cell, crewIn(p)));
  };
  const settle = (chosen) => layColumn(chosen, rebuildInto);

  // ---- THE SEARCH IS RUN TWICE, AND THE SECOND ONE IS THE ANSWER (WP-59b).
  //
  // Every candidate above is priced from `naturalOf(i)` — what a room's
  // furniture needs — and on the first pass those are the sizes `buildProjectRoom`
  // came up with before anything had been laid anywhere: a bid at the shape a
  // room WANTS, which for a fifteen-desk project is 32 x 28 U. The fit loop then
  // rebuilds it into its cell and the same project comes out 32 x 18, so the
  // search was answering a question about a different floor from the one drawn.
  // On a twelve-room machine that took a single row 226 U wide, 58% open floor.
  //
  // So: search, settle, and search again with what settling produced. The second
  // answer is stable because the rooms are, and it costs one more pass of
  // arithmetic over a plan rebuilt when the FLOOR changes, not per frame.
  invalidateBands();
  settle(search());
  invalidateBands();
  let chosen = search();

  // ---- AND THEN THE SECOND ARRANGEMENT (WP-59d), ON EVERY WIDE STAGE
  // (WP-60).
  //
  // ONE condition now, and it is the one that was always a statement about the
  // picture rather than about a number: a tall or square stage is exactly what
  // a column is for, and two rows stacked in one would be wider than the
  // screen.
  //
  // The second condition was `ROWS_OPEN_MIN` — try the fold only where the
  // column left more than 15% of its own working side open — and WP-60 made it
  // a trap. A column's rooms now fill their row's WIDTH edge to edge, so the
  // open floor it reports collapsed towards zero on almost every population;
  // the gate then read that as "this floor has no problem to solve" and never
  // ran the second search, on floors whose column was answering the lounge's
  // height with four rooms at 89% bare carpet. The emptiness had not gone
  // anywhere. It had moved inside the rooms, where the gate could not see it.
  //
  // So the two arrangements are both searched and `betterArrangement` chooses,
  // which is what it is for. The cost is one more pass of arithmetic on a plan
  // that is rebuilt when the FLOOR changes rather than per frame, and the
  // benefit is that a floor is folded whenever folding it is the better
  // picture rather than whenever a proxy said it might be.
  let rows =
    targetAspect >= ROWS_ASPECT_MIN
      ? rowFloor.searchRows({ targetAspect, bandDepths, rebuild: rebuildInto })
      : null;
  if (rows) {
    // The rooms have been laid to the row arrangement's cells to price it, so
    // whichever arrangement wins, the loser's numbers are now about a floor
    // that no longer exists — ask again.
    invalidateBands();
    if (!betterArrangement(rows, chosen)) {
      rows = null;
      chosen = search();
    }
  }

  // The floor, laid — two records, and everything below reads its own branch's
  // fields — AND STRETCHED TO THE WINDOW (audit F2, F3): `stretchColumn`, `fitRows`.
  const col = rows ? null : fitColumn(chosen, rebuildInto, targetAspect, wideService);
  if (col) chosen = col.chosen;
  const fitted = /** @type {any} */ (
    col ? col.fitted : rowFloor.fitRows(rows, rebuildInto, targetAspect)
  );
  const unstretched = col ? col.before : fitted.unstretched;
  const { laid, W, bandH } = fitted;
  const forced = fitted.forced;
  let { H } = fitted;
  office = rows ? fitted.office : chosen.measured.office;
  lounge = rows ? fitted.lounge : chosen.measured.lounge;
  const serviceW = rows ? fitted.ow : chosen.measured.w;
  const serviceX = 0;
  const workingX = rows ? fitted.ow : fitted.workingX;

  // ---- the service column fills its side of the floor exactly.
  //
  // The office above the lounge, both the column's full width, together the
  // building's full height. Any surplus is shared between them rather than
  // left as a strip: a lobby is a room-shaped piece of nothing, and this plan
  // has exactly two pieces of circulation in it — the spine and the cross
  // corridor — by design.
  if (rows) {
    // TWO ROWS, AND EACH ONE FILLS ITS WIDTH (WP-59d). Both service rooms were
    // built at the size they are drawn at — see `layRows` — so there is
    // nothing to reconcile here and nothing to pad: the reception is the left
    // end of row one, the lounge the left end of row two, and the corridor
    // between them is the whole nav graph.
    office.room.x = serviceX;
    office.room.y = 0;
    office.room.w = fitted.ow;
    office.room.h = fitted.h1;
    lounge.room.x = serviceX;
    lounge.room.y = fitted.h1 + CORRIDOR;
    lounge.room.w = fitted.loungeW;
    lounge.room.h = fitted.h2;
  }
  const loungeNaturalH = lounge.room.h;
  const columnSurplus = rows ? 0 : Math.max(0, H - (office.room.h + loungeNaturalH));
  // The reception takes a share of it, up to the point where it would stop
  // being a room, and a floor of the column whatever the lounge needs. It is
  // the room the product is about — the one that answers "is anything waiting
  // on me" — and on a machine where nearly every session is benched the lounge
  // would otherwise have four times its height simply by having more in it.
  const officeH = rows
    ? fitted.h1
    : clamp(
        Math.max(office.room.h + columnSurplus * OFFICE_SURPLUS_SHARE, H * OFFICE_COLUMN_MIN),
        office.room.h,
        Math.max(office.room.h, serviceW / OFFICE_ASPECT_MIN),
      );

  if (!rows) {
    office = buildOffice(waitingCount, { w: serviceW, h: officeH }, { maxW: serviceW });
    office.room.x = serviceX;
    office.room.y = 0;
    office.room.w = serviceW;
    office.room.h = officeH;

    lounge.room.x = serviceX;
    lounge.room.w = serviceW;
    lounge.room.y = officeH;
    lounge.room.h = Math.max(loungeNaturalH, H - officeH);

    // The column is the height of what it holds. Giving the reception a floor
    // of the column can push the two past the building; the building grows to
    // match rather than the rooms overlapping. The working side keeps the room
    // band it was given and the extra becomes open floor, so growing the
    // column can never reach back into a room and turn the difference into
    // carpet.
    const columnH = officeH + lounge.room.h;
    if (columnH > H + 0.01) H = columnH;
  }

  const workingWidth = rows ? fitted.roomsW : Math.max(0, W - workingX);

  // ---- the working floor: bands of squarified rooms, one corridor between.
  //
  // Every project room is rebuilt for the CELL it was given, so its tables
  // flow to that shape rather than being laid out square and centred in
  // something that is not. The cells tile their band exactly, so adjacent
  // rooms share a wall and there is no circulation between them.
  projectRooms.forEach((pr, i) => {
    const cell = laid.cells[i];
    if (!cell) return;
    const room = pr.room;
    room.x = cell.x;
    room.y = cell.y;
    room.w = cell.w;
    room.h = cell.h;
  });

  // THE SPINE: the one corridor everything opens onto.
  //
  // In a column it is VERTICAL, between the service column and the working
  // floor. In two rows it is HORIZONTAL and wall to wall, between row one and
  // row two (WP-59d) — the same thing said on the other axis, and the same
  // one piece of circulation: every room in row one takes a door on its
  // bottom edge and every room in row two on its top edge.
  const spine = corridorRoom({
    id: '__spine__',
    x: rows ? 0 : serviceW,
    y: rows ? fitted.h1 : 0,
    w: rows ? W : CORRIDOR,
    h: rows ? CORRIDOR : H,
  });

  // And the cross corridor, or corridors if the working floor ever grows past
  // two bands. A cross corridor is a thoroughfare; a BAY — the open floor at
  // the end of a band whose rooms did not need the whole width — is not: it is
  // a dead end beside the rooms, and a route down it is one the graph can
  // never leave.
  const crossCorridors = laid.corridors.map((c, i) =>
    corridorRoom({ ...c, id: c.bay ? `__bay-${i}__` : `__corridor-${i}__`, thoroughfare: !c.bay }),
  );

  // WHATEVER THE ROOMS DO NOT NEED IS OPEN FLOOR, NOT A BIGGER ROOM.
  //
  // Two cases, one band. A floor with no rooms at all still needs its working
  // side to be something rather than a hole; and a floor whose service column
  // is taller than its one project room needs somewhere for the difference to
  // go. Before WP-55 the rooms swallowed it and drew it as carpet. IN TWO ROWS
  // IT IS UNDER ROW ONE'S ROOMS rather than at the bottom of the building
  // (WP-59d); row two has none of its own since WP-60.
  //
  // Open floor is NOT a route: there is nothing in it to walk to, and a
  // full-height band beside the spine is a second parallel line the graph
  // cannot reach.
  const open = (id, x, y, w, h) =>
    w > 1 && h > 0.01 ? [corridorRoom({ id, x, y, w, h, thoroughfare: false })] : [];
  const slackY = projectRooms.length ? bandH : 0;
  const workingBottom = rows ? fitted.h1 : H;

  // ---- THE PINNED STRIP, along the bottom of the working side (WP-77).
  // `layPinnedStrip` is the rule; this is its rectangle. `pinH` is zero unless
  // the strip was actually laid: a reservation nothing stood in is a hole, and
  // every rectangle in `rooms` tiles the envelope exactly.
  const pinTop = Math.max(0, workingBottom - slackY);
  const pinAsk = Math.min(Math.max(0, fitted.pinH || 0), pinTop);
  // A sliver the rooms stopped short of is the strip's, not a band of open floor.
  const wantPinH = pinAsk > 0 && pinTop - pinAsk <= CORRIDOR ? pinTop : pinAsk;
  const live = projectRooms.map((pr) => pr.room.w * pr.room.h);
  const strip =
    wantPinH > 0.01
      ? layPinnedStrip(
          pinnedProjects,
          { x: workingX, y: workingBottom - wantPinH, w: workingWidth, h: wantPinH },
          pinnedPerRow(workingWidth),
          live.length ? Math.min(...live) * PINNED_AREA_SHARE : Infinity,
        )
      : { rooms: [], gaps: [] };
  const pinH = strip.rooms.length ? wantPinH : 0;
  const pinnedGaps = strip.gaps.map((g, i) =>
    corridorRoom({ ...g, id: `__pinned-${i}__`, thoroughfare: false }),
  );

  const emptyBand = open(
    rows ? '__open-rooms__' : '__open__',
    workingX,
    slackY,
    workingWidth,
    Math.max(0, workingBottom - pinH - slackY),
  );

  // ---- WHAT THE WORKING SIDE DID WITH THE HEIGHT IT WAS GIVEN (WP-59c).
  //
  // The fill order's answer, written down once, where the integrity test and
  // anyone reading a floor can both find it. It is a RECORD and not a claim:
  // every number in it is re-derivable from `rooms` above, and
  // `floor-integrity.test.mjs` re-derives all of them rather than trusting
  // this — a plan that could report a full working side while drawing an empty
  // one would be a worse defect than the one this package fixes.
  //
  // IN TWO ROWS IT IS ROW ONE (WP-59d, narrowed by WP-60): the part of the
  // building beside the reception that holds the rooms. With the idle strip
  // gone the lounge IS row two, and a lounge is a room that fills its own
  // rectangle rather than a side to be filled.
  const workingArea = rows ? workingWidth * fitted.h1 : Math.max(0, workingWidth) * H;
  // The pinned strip is CONTENT and not open floor: somebody asked for it.
  const takenArea =
    projectRooms.reduce((a, pr) => a + pr.room.w * pr.room.h, 0) +
    strip.rooms.reduce((a, r) => a + r.w * r.h, 0);
  // THE BARE CARPET, REPORTED (WP-60).
  //
  // `ROOM_FILL_MAX` used to be a LIMIT: a band of rooms stopped short of its
  // row rather than let its shallowest room past 30% bare carpet, and what it
  // did not take was drawn as a bay. That bought its tidiness with a hole in
  // the floor — the bay is carpet too, and carpet nothing can ever be put on
  // because it is not inside a room. The rooms fill their row now and this is
  // the number that says what it cost: the worst room's bare fraction, stated
  // where the integrity test and anyone reading a floor can both find it.
  //
  // A metric rather than a bound, and the difference is the whole of WP-60's
  // second half. A bound refuses a floor; a metric describes one, and a floor
  // that has to be described is a floor somebody can argue with.
  const bare = projectRooms.map((pr) => {
    const n = pr.room.natural || { w: pr.room.w, h: pr.room.h };
    return 1 - (n.w * n.h) / Math.max(1e-6, pr.room.w * pr.room.h);
  });
  const working = {
    x: workingX,
    w: Math.max(0, workingWidth),
    /** The fraction of the working side nobody stands on. */
    open: workingArea > 1e-6 ? Math.max(0, (workingArea - takenArea) / workingArea) : 0,
    /**
     * The worst room's bare carpet — floor inside a room that its furniture
     * does not occupy. Reported, never enforced (WP-60).
     */
    bareCarpet: bare.length ? Math.max(...bare) : 0,
    /** (a) — the rooms were made deeper than the plan would have chosen. */
    roomsStretched: Boolean(forced),
    /** (b) — how tightly the lounge was packed; 1 is the room untouched. */
    loungePack: (rows ? rows.pack : chosen.measured.pack) ?? 1,
    /** (c) — the open plan left under the content, in units. */
    openH: Math.max(0, workingBottom - pinH - slackY),
    /** The depth the pinned strip took along the bottom of it (WP-77). */
    pinnedH: pinH,
    /** How far the stretch to the window (audit F2, F3) changed the area. */
    stretched: Math.abs(1 - (unstretched.W * unstretched.H) / Math.max(1e-6, W * H)),
  };

  return {
    W,
    H,
    rows: Boolean(rows),
    office,
    lounge,
    projectRooms,
    stripRooms: strip.rooms,
    corridors: [spine, ...crossCorridors, ...emptyBand, ...pinnedGaps],
    working,
  };
}
