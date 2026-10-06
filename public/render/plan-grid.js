/**
 * THE PROPORTIONED FLOOR: a building laid to the designer's rulebook.
 *
 * `plan-proportions.js` is the rules. This is the building they are laid
 * into — the smallest one of the window's shape in which every one of them
 * holds, so the people on it are drawn as large as the rules allow.
 *
 * TWO FAMILIES, and both are grids of rooms beside the two service rooms:
 *
 *     bands                              column
 *     +--------+-------------------+     +--------+-+----------------+
 *     | office | rooms             |     | office | | rooms          |
 *     +--------+-------------------+     |        |s+----------------+
 *     |        the corridor        |     +--------+p|   a corridor   |
 *     +-----------+----------------+     | lounge |i+----------------+
 *     | lounge    | rooms          |     |        |n| rooms          |
 *     +-----------+----------------+     +--------+e+----------------+
 *
 * In BANDS the office is the left end of the top row and the lounge the left
 * end of the bottom one, each as wide as what is in it, and the rooms take the
 * rest of every row. In a COLUMN the two stand one over the other down the
 * left and the rooms are a plain grid beside them. Rows of rooms are one depth
 * each and every row has a corridor along one of its edges
 * (`corridorsBetween`).
 *
 * WHAT DECIDES THE SIZE. The service rooms are laid at their CONTENTS — the
 * reception at the sofa runs its queue needs, the lounge at its bays — and the
 * rooms at no less than their furniture. The building then grows until the
 * budget holds: rooms at least `ROOMS_AREA_MIN` of it, the office at most
 * `OFFICE_AREA_MAX`, the lounge at most `LOUNGE_AREA_MAX`. Whatever that
 * leaves spare is the rooms', by module (`layGrid`); a service room is handed
 * width only where the rooms beside it are already as wide as a room may be,
 * and never past its cap.
 *
 * Nothing here is scored. A candidate keeps every rule or it is not a
 * candidate, and among the ones that do the smallest building wins — which is
 * a search over one number, the building's width, per family and row count.
 *
 * Pure geometry. No DOM, no clock, no randomness.
 */

import { corridorRoom } from './plan-nav.js';
import { buildOffice, buildOfficeRow } from './plan-office.js';
import { buildPinnedRoom, buildProjectRoom } from './plan-rooms.js';
import { buildLounge, loungeOneRowBelow } from './plan-service.js';
import {
  CORRIDOR,
  LOUNGE_MIN_H,
  OFFICE_MIN_W,
  OFFICE_ROW_ASPECT_MAX,
  PLATE_BAND,
  ROOM_ASPECT_MAX,
  ROOM_PAD,
} from './plan-units.js';
import {
  LOUNGE_AREA_MAX,
  MODULE_WEIGHTS,
  OFFICE_AREA_MAX,
  ROOMS_AREA_MIN,
  ROWS_LIMIT,
  ROWS_MAX,
  corridorsBetween,
  layGrid,
  moduleFor,
  pinnedWeight,
} from './plan-proportions.js';

/** @typedef {import('./plan-units.js').Room} Room */
/** @typedef {import('./plan-units.js').Seat} Seat */
/** @typedef {import('./plan-units.js').ProjectLike} ProjectLike */

const EPS = 1e-6;

/** The narrowest and widest building the search looks at, in units. */
const WIDTH_MIN = 40;
const WIDTH_MAX = 480;
/** How far the search steps before it closes in: 4% is under one room's slack. */
const WIDTH_STEP = 1.04;
/** Halvings between the last width that failed and the first that held. */
const WIDTH_REFINE = 7;
/**
 * A later candidate replaces an earlier one only by being this much smaller.
 * The order they are tried in is the order they are preferred in, so two
 * floors within three per cent of each other are laid the same way.
 */
const WIDTH_TIE = 0.03;
/**
 * And a floor of more than `ROWS_MAX` rows replaces one inside it only by
 * being this much smaller: three rows are the norm, and a fourth is taken for
 * a floor that is plainly drawn larger with it, not for a few per cent.
 */
const ROWS_EXTRA_GAIN = 0.12;

/**
 * The widest a HALL is laid: the circulation between a service room at its cap
 * and a row of rooms already as wide as rooms may be. Four corridors; a floor
 * that would need more is a floor for another row count.
 */
const HALL_MAX = CORRIDOR * 4;

/** The lounge is measured on whole units of width, between these. */
const LOUNGE_W_MIN = 20;
const LOUNGE_W_MAX = 240;

/** The shapes a room's desks are tried at, widest first. */
const DESK_ASPECTS = Object.freeze([ROOM_ASPECT_MAX, 1, 0.5]);

/**
 * Lay one floor to the rulebook, or say that no building keeps it.
 *
 * @param {object} input
 * @param {number} input.targetAspect the window's shape, already clamped
 * @param {number} input.waitingCount agents in the reception's queue
 * @param {number} input.benchedCount people the lounge is asked to hold
 * @param {number} input.goneHomeCount benched and not drawn; the lounge plate's
 * @param {{project: ProjectLike, pinned: boolean}[]} input.rooms every repo
 *   with a room, in floor order; `pinned` for one kept with nobody in it
 * @param {(p: ProjectLike) => number} input.desksIn agents at desks in a repo
 * @param {(p: ProjectLike) => ({w:number,h:number}|undefined)} input.crewIn
 *   the floor a repo's largest crew formation asks for (WP-89)
 * @param {(p: ProjectLike) => number} input.crewSizeIn how many are in it
 * @returns {null | {W:number, H:number, rows:false, arrangement:'bands'|'column',
 *   office:{room:Room, officeSeats:any[]}, lounge:{room:Room, loungeSpots:any[]},
 *   projectRooms:{room:Room, seats:Seat[]}[], stripRooms:Room[], corridors:Room[],
 *   working:any}} every rectangle placed, in `layClassic`'s own shape; null
 *   where there is no room to lay or no legal building was found
 */
export function layProportioned(input) {
  const { targetAspect, waitingCount, benchedCount, goneHomeCount, desksIn, crewIn } = input;
  const asked = Array.isArray(input.rooms) ? input.rooms : [];
  if (!asked.length) return null;

  // ---- what each room needs: a module, and the ways its desks can stand.
  const needs = asked.map(({ project, pinned }) => {
    if (pinned) return { project, pinned: true, desks: 0, crew: undefined, weight: 0 };
    const desks = desksIn(project);
    const crew = crewIn(project);
    const module = moduleFor({ desks, crew: input.crewSizeIn(project) });
    /** @type {{w:number,h:number}[]} */
    const footprints = [];
    for (const aspect of DESK_ASPECTS) {
      const n = buildProjectRoom(project, desks, aspect, undefined, crew).room.natural;
      if (n && !footprints.some((f) => Math.abs(f.w - n.w) < 0.01 && Math.abs(f.h - n.h) < 0.01)) {
        footprints.push({ w: n.w, h: n.h });
      }
    }
    return { project, pinned: false, desks, crew, weight: MODULE_WEIGHTS[module], footprints };
  });
  const small = pinnedWeight(needs.filter((n) => !n.pinned).map((n) => n.weight));
  for (const n of needs) if (n.pinned) n.weight = small;
  const weights = needs.map((n) => n.weight);
  const footprints = needs.map((n) => n.footprints);

  // ---- what the service rooms need, measured off their own builders.
  //
  // The reception on its side, at a depth: as wide as its queue's sofa runs.
  const officeRowAt = (/** @type {number} */ d) => {
    const r = buildOfficeRow(waitingCount, { w: 0, h: d }).room;
    return { w: r.w, h: r.h };
  };
  // The reception upright, at a width: as deep as its queue needs.
  /** @type {Map<number, {w:number,h:number}>} */
  const officeCols = new Map();
  const officeColAt = (/** @type {number} */ w) => {
    let got = officeCols.get(w);
    if (!got) {
      const r = buildOffice(waitingCount, { w, h: 0 }, { maxW: w }).room;
      got = { w: r.w, h: r.h };
      officeCols.set(w, got);
    }
    return got;
  };
  // The lounge at a width: how deep its bays and its people come out, and how
  // many it SEATS. Two answers per width, because a lounge too shallow for a
  // second shelf gives a bay up rather than wrapping it (§3.7), and a bay
  // given up is seats given up.
  /** @type {Map<string, {w:number,h:number,seats:number}>} */
  const lounges = new Map();
  const loungeAt = (/** @type {number} */ w, /** @type {boolean} */ oneRow) => {
    const key = `${w}|${oneRow ? 1 : 0}`;
    let got = lounges.get(key);
    if (!got) {
      const built = buildLounge(benchedCount, { w, h: oneRow ? LOUNGE_MIN_H : 0 }, goneHomeCount);
      const n = built.room.natural || { w: built.room.w, h: built.room.h };
      const seats = built.loungeSpots.reduce(
        (a, sp) => a + (sp.kind === 'chat' ? 0 : Math.max(1, sp.capacity ?? 1)),
        0,
      );
      got = { w: n.w, h: n.h, seats };
      lounges.set(key, got);
    }
    return got;
  };
  // A LOUNGE IS ITS CONTENTS WHEN IT SEATS ITS PEOPLE: enough bays for everyone
  // resting, or every bay it has where they are more than it can seat. Five
  // people do not need a games room laid for them to be a lounge.
  const seatsWanted = Math.min(benchedCount, loungeAt(LOUNGE_W_MAX, false).seats);
  // The narrowest whole-unit lounge that is its contents inside a depth.
  const loungeWidthFor = (/** @type {number} */ d) => {
    const oneRow = d < loungeOneRowBelow();
    const holds = (/** @type {number} */ w) => {
      const got = loungeAt(w, oneRow);
      return got.h <= d + EPS && got.w <= w + EPS && got.seats >= seatsWanted;
    };
    if (!holds(LOUNGE_W_MAX)) return Infinity;
    let lo = LOUNGE_W_MIN;
    let hi = LOUNGE_W_MAX;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (holds(mid)) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };

  /** Where each row of `rows` starts, for rows of one depth. */
  const rowTops = (/** @type {boolean[]} */ under, /** @type {number} */ d) => {
    const tops = [];
    let y = 0;
    for (let k = 0; k <= under.length; k++) {
      tops.push(y);
      y += d + (under[k] ? CORRIDOR : 0);
    }
    return tops;
  };

  /**
   * BANDS at one width: the office and the lounge at the left ends of the top
   * and bottom rows, the rooms across the rest of every row.
   * @param {number} W @param {number} rows
   */
  const bandsAt = (W, rows) => {
    if (rows < 2 || needs.length < rows) return null;
    const H = W / targetAspect;
    const area = W * H;
    const under = corridorsBetween(rows);
    const d = (H - CORRIDOR * under.filter(Boolean).length) / rows;
    if (!(d > PLATE_BAND)) return null;
    const office = officeRowAt(d);
    if (office.h > d + EPS || office.w * d > OFFICE_AREA_MAX * area + EPS) return null;
    const loungeW = loungeWidthFor(d);
    if (!(loungeW * d <= LOUNGE_AREA_MAX * area + EPS)) return null;
    const tops = rowTops(under, d);
    // Past two rows the corridors are joined by a lane down the left edge.
    const lane = rows >= 3 ? CORRIDOR : 0;
    // The widest a service room may be handed: its cap, and for the office the
    // shape past which it stops being a room.
    const officeMax = Math.min(
      (OFFICE_AREA_MAX * area) / d,
      (d - PLATE_BAND) * OFFICE_ROW_ASPECT_MAX,
    );
    const loungeMax = (LOUNGE_AREA_MAX * area) / d;
    const bands = tops.map((y, k) => {
      if (k === 0) {
        const give = Math.max(0, officeMax - office.w) + HALL_MAX;
        return { x: office.w, y, w: W - office.w, d, give };
      }
      if (k === rows - 1) {
        const give = Math.max(0, loungeMax - loungeW) + HALL_MAX;
        return { x: loungeW, y, w: W - loungeW, d, give };
      }
      return { x: lane, y, w: W - lane, d };
    });
    const grid = layGrid(weights, bands, footprints);
    if (!grid) return null;
    if (grid.cells.reduce((a, c) => a + c.w * c.h, 0) < ROOMS_AREA_MIN * area - EPS) return null;
    // WHAT A ROW'S ROOMS DID NOT TAKE. Its service room first, to its cap; and
    // what is past the cap is a HALL between the two — circulation, the one
    // thing the budget leaves unbounded — at least a corridor wide, so that it
    // is a way in rather than a gap.
    const beside = (
      /** @type {number} */ k,
      /** @type {number} */ own,
      /** @type {number} */ max,
    ) => {
      const left = W - grid.taken[k];
      let room = Math.min(left, Math.max(own, max));
      let hall = left - room;
      if (hall > EPS && hall < CORRIDOR) {
        room -= CORRIDOR - hall;
        hall = CORRIDOR;
      }
      return room >= own - EPS ? { room, hall: hall > EPS ? hall : 0 } : null;
    };
    const top = beside(0, office.w, officeMax);
    const bottom = beside(rows - 1, loungeW, loungeMax);
    if (!top || !bottom) return null;
    return {
      family: /** @type {const} */ ('bands'),
      rows,
      W,
      H,
      d,
      under,
      tops,
      lane,
      grid,
      office: { x: 0, y: 0, w: top.room, h: d },
      lounge: { x: 0, y: tops[rows - 1], w: bottom.room, h: d },
      halls: [
        { x: top.room, y: 0, w: top.hall, h: d },
        { x: bottom.room, y: tops[rows - 1], w: bottom.hall, h: d },
      ].filter((r) => r.w > 0),
    };
  };

  /**
   * A COLUMN at one width: the office over the lounge down the left, the
   * spine, and a plain grid of rooms. The column is tried narrowest first, so
   * the first one that holds is the one that leaves the rooms the most.
   * @param {number} W @param {number} rows
   */
  const columnAt = (W, rows) => {
    if (needs.length < rows) return null;
    const H = W / targetAspect;
    const area = W * H;
    const under = corridorsBetween(rows);
    const deep = H - CORRIDOR * under.filter(Boolean).length;
    const d = deep / rows;
    if (!(d > PLATE_BAND)) return null;
    const tops = rowTops(under, d);
    for (let sw = OFFICE_MIN_W; sw + CORRIDOR < W; sw++) {
      const roomsW = W - sw - CORRIDOR;
      // A wider column only leaves the rooms less.
      if (roomsW * deep < ROOMS_AREA_MIN * area - EPS) break;
      const office = officeColAt(sw);
      const lounge = loungeAt(sw, false);
      if (office.w > sw + EPS || lounge.w > sw + EPS) continue;
      const officeMax = (OFFICE_AREA_MAX * area) / sw;
      const loungeMax = (LOUNGE_AREA_MAX * area) / sw;
      let spare = H - office.h - lounge.h;
      if (spare < -EPS || office.h > officeMax + EPS || lounge.h > loungeMax + EPS) continue;
      // What the column has past its contents is the lounge's first, then the
      // reception's, each to its cap. A column with floor left after both is
      // wider than the service rooms may be, and the next one is wider still.
      const toLounge = Math.min(spare, loungeMax - lounge.h);
      spare -= toLounge;
      const toOffice = Math.min(spare, officeMax - office.h);
      spare -= toOffice;
      if (spare > EPS) break;
      const bands = tops.map((y) => ({ x: sw + CORRIDOR, y, w: roomsW, d }));
      const grid = layGrid(weights, bands, footprints);
      if (!grid) continue;
      const officeH = office.h + toOffice;
      return {
        family: /** @type {const} */ ('column'),
        rows,
        W,
        H,
        d,
        under,
        tops,
        lane: 0,
        grid,
        office: { x: 0, y: 0, w: sw, h: officeH },
        lounge: { x: 0, y: officeH, w: sw, h: H - officeH },
        halls: /** @type {{x:number,y:number,w:number,h:number}[]} */ ([]),
      };
    }
    return null;
  };

  /**
   * The smallest building of one family and row count that keeps every rule,
   * looking no wider than `limit`.
   * @param {(W:number) => any} at @param {number} limit
   */
  const smallest = (at, limit) => {
    let below = WIDTH_MIN;
    let found = null;
    for (let W = WIDTH_MIN; W <= limit; W *= WIDTH_STEP) {
      found = at(W);
      if (found) break;
      below = W;
    }
    if (!found) return null;
    let above = found.W;
    for (let i = 0; i < WIDTH_REFINE; i++) {
      const mid = (below + above) / 2;
      const got = at(mid);
      if (got) {
        found = got;
        above = mid;
      } else below = mid;
    }
    return found;
  };

  /**
   * @param {number[]} rowCounts tried in this order, bands before a column
   * @param {any} [held] the building to beat, and @param {number} [by] how far
   */
  const search = (rowCounts, held = null, by = WIDTH_TIE) => {
    let best = held;
    for (const rows of rowCounts) {
      for (const at of [bandsAt, columnAt]) {
        const gain = best === held ? by : WIDTH_TIE;
        const limit = best ? best.W * (1 - gain) : WIDTH_MAX;
        const got = smallest((/** @type {number} */ W) => at(W, rows), limit);
        if (got && (!best || got.W < limit)) best = got;
      }
    }
    return best;
  };

  /**
   * Build one room into its cell, at the first desk shape that fits it.
   * @param {typeof needs[number]} need @param {{w:number,h:number}} cell
   */
  const roomInto = (need, cell) => {
    const inner =
      Math.max(1, cell.w - ROOM_PAD * 2) / Math.max(1, cell.h - ROOM_PAD * 2 - PLATE_BAND);
    for (const aspect of [inner, ...DESK_ASPECTS]) {
      const built = buildProjectRoom(need.project, need.desks, aspect, cell, need.crew);
      if (built.room.w <= cell.w + 0.01 && built.room.h <= cell.h + 0.01) return built;
    }
    return null;
  };

  /** Every room of one candidate, built and placed; null if one did not fit. */
  const build = (
    /** @type {NonNullable<ReturnType<typeof bandsAt>|ReturnType<typeof columnAt>>} */ c,
  ) => {
    const office =
      c.family === 'bands'
        ? buildOfficeRow(waitingCount, { w: c.office.w, h: c.office.h })
        : buildOffice(waitingCount, { w: c.office.w, h: c.office.h }, { maxW: c.office.w });
    if (office.room.w > c.office.w + 0.01 || office.room.h > c.office.h + 0.01) return null;
    const lounge = buildLounge(benchedCount, { w: c.lounge.w, h: c.lounge.h }, goneHomeCount);
    const inLounge = lounge.room.natural || lounge.room;
    if (inLounge.w > c.lounge.w + 0.01 || inLounge.h > c.lounge.h + 0.01) return null;
    Object.assign(office.room, c.office);
    Object.assign(lounge.room, c.lounge);

    /** @type {{room:Room, seats:Seat[]}[]} */
    const projectRooms = [];
    /** @type {Room[]} */
    const stripRooms = [];
    for (const [i, need] of needs.entries()) {
      const cell = c.grid.cells[i];
      const at = { x: cell.x, y: cell.y, w: cell.w, h: cell.h };
      if (need.pinned) {
        const { room } = buildPinnedRoom(need.project, at);
        Object.assign(room, at);
        stripRooms.push(room);
        continue;
      }
      const built = roomInto(need, at);
      if (!built) return null;
      Object.assign(built.room, at);
      projectRooms.push({ room: built.room, seats: built.seats });
    }

    // The corridors. In bands the first is the spine and every one of them is
    // the building's width; in a column the spine is the building's height.
    /** @type {Room[]} */
    const corridors = [];
    const across = c.family === 'bands' ? 0 : c.office.w + CORRIDOR;
    if (c.family === 'column') {
      corridors.push(corridorRoom({ id: '__spine__', x: c.office.w, y: 0, w: CORRIDOR, h: c.H }));
    }
    /** @type {number[]} rows with a corridor under them */
    const served = [];
    c.under.forEach((has, k) => {
      if (!has) return;
      const spine = c.family === 'bands' && !served.length;
      corridors.push(
        corridorRoom({
          id: spine ? '__spine__' : `__corridor-${served.length}__`,
          x: across,
          y: c.tops[k] + c.d,
          w: c.W - across,
          h: CORRIDOR,
        }),
      );
      served.push(k);
    });
    // And in bands past two rows, the lane that joins one corridor to the next.
    if (c.lane > 0) {
      for (let i = 0; i + 1 < served.length; i++) {
        const top = c.tops[served[i] + 1];
        corridors.push(
          corridorRoom({
            id: `__lane-${i}__`,
            x: 0,
            y: top,
            w: c.lane,
            h: c.tops[served[i + 1]] + c.d - top,
          }),
        );
      }
    }
    c.halls.forEach((hall, i) => corridors.push(corridorRoom({ id: `__hall-${i}__`, ...hall })));

    const bare = projectRooms.map(({ room }) => {
      const n = room.natural || room;
      return 1 - (n.w * n.h) / Math.max(1e-6, room.w * room.h);
    });
    const left = Math.min(...c.grid.cells.map((cell) => cell.x));
    return {
      W: c.W,
      H: c.H,
      rows: /** @type {const} */ (false),
      arrangement: c.family,
      office,
      lounge,
      projectRooms,
      stripRooms,
      corridors,
      // `layClassic`'s record, for a floor with no open floor in it: every
      // rectangle on the rooms' side is a room or a corridor.
      working: {
        x: left,
        w: c.W - left,
        open: 0,
        bareCarpet: bare.length ? Math.max(...bare) : 0,
        roomsStretched: false,
        loungePack: 1,
        openH: 0,
        pinnedH: 0,
        stretched: 0,
        /** How many rows of rooms, and how far the modules were flattened. */
        rows: c.rows,
        flatten: c.grid.flatten,
      },
    };
  };

  // ---- the search: one to three rows, and more only where three cannot hold
  // the rooms at a room's shape without the building growing to do it.
  //
  // Two dozen rooms in three rows are eight to a row, and eight rooms that are
  // each at least 0.7 of their depth wide make a row five and a half depths
  // long: the building has to be enormous before its rows are that long, and
  // everybody in it is drawn tiny. That is the scale dropping for nothing. So
  // a floor past `ROWS_MAX` is taken where it is `ROWS_EXTRA_GAIN` smaller.
  const norm = Array.from({ length: ROWS_MAX }, (_, i) => i + 1);
  // Two rows first: it is the floor with one corridor that everything opens on.
  const order = [2, 1, ...norm.filter((r) => r > 2)];
  const more = Array.from({ length: ROWS_LIMIT - ROWS_MAX }, (_, i) => ROWS_MAX + 1 + i);
  let chosen = search(more, search(order), ROWS_EXTRA_GAIN);
  if (!chosen) return null;

  // A room built into its cell can come out a hair past what it bid with. The
  // same family and row count, a little larger, until every room fits.
  const at = chosen.family === 'bands' ? bandsAt : columnAt;
  let width = chosen.W;
  for (let grow = 0; grow < 12; grow++) {
    const built = build(chosen);
    if (built) return built;
    let next = null;
    for (let step = 0; step < 8 && !next; step++) {
      width *= 1.02;
      next = at(width, chosen.rows);
    }
    if (!next) return null;
    chosen = next;
  }
  return null;
}
