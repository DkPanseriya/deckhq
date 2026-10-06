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
 * each — near-equal: one row may be up to `ROW_DEPTH_SPREAD_MAX` deeper than
 * the rest, for a room or a lounge that needs it — and every row has a
 * corridor along one of its edges (`corridorsBetween`).
 *
 * WHAT DECIDES THE SIZE, in two steps.
 *
 * First the floor is laid at its CONTENTS: the reception at the sofa runs its
 * queue needs, the lounge at the bays that seat its people, the rooms at no
 * less than their furniture. The building grows until the budget holds —
 * rooms at least `ROOMS_AREA_MIN` of it, the office at most `OFFICE_AREA_MAX`,
 * the lounge at most `LOUNGE_AREA_MAX` — and whatever that leaves spare is the
 * rooms', by module (`layGrid`). A service room is handed width only where the
 * rooms beside it are already as wide as a room may be, and never past its
 * cap; what is left after that is a hall, which is circulation.
 *
 * Then, where that building is wider than the window is at the scale the
 * floor is designed for (`nominalWidth`), it is laid again AT that width with
 * the service rooms held to their caps: the lounge gives up games tables and
 * shows a chip, and the building is only larger than that where the ROOMS
 * need it to be. A crowd in the lounge never makes the rooms small.
 *
 * Nothing here is scored. A candidate keeps every rule or it is not a
 * candidate, and among the ones that do the smallest building wins — which is
 * a search over one number, the building's width, per family, row count and
 * which row is the deep one.
 *
 * Pure geometry. No DOM, no clock, no randomness.
 */

import { corridorRoom } from './plan-nav.js';
import { buildOffice, buildOfficeRow } from './plan-office.js';
import { buildPinnedRoom, buildProjectRoom } from './plan-rooms.js';
import { OFFICE_FULL, measureService } from './plan-grid-service.js';
import { buildLounge } from './plan-service.js';
import {
  CORRIDOR,
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
  ROW_DEPTH_SPREAD_MAX,
  corridorsBetween,
  layGrid,
  moduleFor,
  nominalWidth,
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
 * How much wider than the rooms strictly need a building is laid so that a
 * service room keeps its furniture. Six per cent is one pixel in sixteen of a
 * figure; under it, a lounge that could have had its tables has them.
 */
const SERVICE_SLACK = 0.06;

/**
 * How much deeper the one deep row is laid. A point inside the bound, so a
 * row's depth can be rounded by a float and still measure under it.
 */
const DEEP_ROW = 1 + ROW_DEPTH_SPREAD_MAX - 0.01;

/**
 * The widest a HALL is laid: the circulation between a service room at its cap
 * and a row of rooms already as wide as rooms may be. Four corridors; a floor
 * that would need more is a floor for another row count.
 */
const HALL_MAX = CORRIDOR * 4;

/**
 * How many rooms make a floor that only gets easier to lay as it grows: with
 * this many, no row is ever short of rooms to fill it.
 */
const MANY_ROOMS = 8;

/** The shapes a room's desks are tried at, widest first. */
const DESK_ASPECTS = Object.freeze([4, ROOM_ASPECT_MAX, 1, 0.5]);

/**
 * Lay one floor to the rulebook, or say that no building keeps it.
 *
 * @param {object} input
 * @param {number} input.targetAspect the window's shape, already clamped
 * @param {{w?:number, h?:number}} [input.stage] the canvas, in pixels: what
 *   the nominal scale makes of it is the building the caps are held in
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
 *   office:{room:Room, officeSeats:any[]},
 *   lounge:{room:Room, loungeSpots:any[], behindChip:number},
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
  const empty = needs.map((n) => n.pinned);

  // ---- what the service rooms need, measured off their own builders
  // (`plan-grid-service.js`).
  const service = measureService(waitingCount, benchedCount, goneHomeCount);
  const { officeWide, officeColAt, officesInBand, loungeAt, loungesInBand } = service;
  const { whole, seatsWanted, keptOf, wholeKept } = service;

  /**
   * The depth of each row: equal, or one of them `DEEP_ROW` of the rest.
   * @param {number} total the depth the rows share @param {number} rows
   * @param {number} deep which row is the deep one, or -1 for none
   */
  const depthsOf = (total, rows, deep) => {
    if (deep < 0 || rows < 2) return Array(rows).fill(total / rows);
    const d = total / (rows - 1 + DEEP_ROW);
    return Array.from({ length: rows }, (_, k) => (k === deep ? d * DEEP_ROW : d));
  };
  /** Where each row starts. @param {boolean[]} under @param {number[]} depths */
  const rowTops = (under, depths) => {
    const tops = [];
    let y = 0;
    for (let k = 0; k < depths.length; k++) {
      tops.push(y);
      y += depths[k] + (under[k] ? CORRIDOR : 0);
    }
    return tops;
  };
  const areaOf = (/** @type {{w:number,h:number}[]} */ cells) =>
    cells.reduce((a, c) => a + c.w * c.h, 0);

  /**
   * BANDS at one width: the office and the lounge at the left ends of the top
   * and bottom rows, the rooms across the rest of every row.
   * @param {number} W @param {number} rows @param {number} deep
   * @param {boolean} capped @param {number} [least] the least it may keep
   *   of its service rooms (`keptOf`)
   */
  const bandsAt = (W, rows, deep, capped, least = 0) => {
    if (rows < 2 || needs.length < rows) return null;
    const H = W / targetAspect;
    const area = W * H;
    const under = corridorsBetween(rows);
    const depths = depthsOf(H - CORRIDOR * under.filter(Boolean).length, rows, deep);
    if (!(Math.min(...depths) > PLATE_BAND)) return null;
    const dTop = depths[0];
    const dBottom = depths[rows - 1];
    const tops = rowTops(under, depths);
    // Past two rows the corridors are joined by a lane down the left edge.
    const lane = rows >= 3 ? CORRIDOR : 0;
    // The widest a service room may be handed: its cap, and for the office the
    // shape past which it stops being a room.
    const officeMax = Math.min(
      (OFFICE_AREA_MAX * area) / dTop,
      (dTop - PLATE_BAND) * OFFICE_ROW_ASPECT_MAX,
    );
    const loungeMax = (LOUNGE_AREA_MAX * area) / dBottom;
    // The fullest reception, and then the fullest lounge, that the rooms beside
    // them leave the width for: the lounge gives up its games before the
    // reception gives up a seat.
    const lounges = loungesInBand(dBottom, area, capped, 0);
    let office = null;
    let lounge = null;
    let grid = null;
    for (const desk of lounges.length ? officesInBand(dTop, area, capped) : []) {
      for (const option of lounges) {
        if (keptOf(desk.tier, option.kept) < least) continue;
        const bands = tops.map((y, k) => {
          const d = depths[k];
          if (k === 0) {
            const give = Math.max(0, officeMax - desk.w) + HALL_MAX;
            return { x: desk.w, y, w: W - desk.w, d, give };
          }
          if (k === rows - 1) {
            const give = Math.max(0, loungeMax - option.w) + HALL_MAX;
            return { x: option.w, y, w: W - option.w, d, give };
          }
          return { x: lane, y, w: W - lane, d };
        });
        const got = layGrid(weights, bands, footprints, empty);
        if (!got || areaOf(got.cells) < ROOMS_AREA_MIN * area - EPS) continue;
        office = desk;
        lounge = option;
        grid = got;
        break;
      }
      if (grid) break;
    }
    if (!office || !lounge || !grid) return null;
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
    const top = beside(0, office.w, Math.max(office.w, officeMax));
    const bottom = beside(rows - 1, lounge.w, loungeMax);
    if (!top || !bottom) return null;
    return {
      family: /** @type {const} */ ('bands'),
      rows,
      deep,
      capped,
      W,
      H,
      depths,
      under,
      tops,
      lane,
      grid,
      office: { x: 0, y: 0, w: top.room, h: dTop },
      lounge: { x: 0, y: tops[rows - 1], w: bottom.room, h: dBottom },
      hold: office.hold,
      games: lounge.games,
      kept: keptOf(office.tier, lounge.kept),
      halls: [
        { x: top.room, y: 0, w: top.hall, h: dTop },
        { x: bottom.room, y: tops[rows - 1], w: bottom.hall, h: dBottom },
      ].filter((r) => r.w > 0),
    };
  };

  /**
   * A COLUMN at one width: the office over the lounge down the left, the
   * spine, and a plain grid of rooms. The column is tried narrowest first, so
   * the first one that holds its contents is the one that leaves the rooms the
   * most; held to its caps, the fullest lounge any width of it has room for.
   * @param {number} W @param {number} rows @param {number} deep
   * @param {boolean} capped @param {number} [least] the least it may keep
   *   of its service rooms (`keptOf`)
   */
  const columnAt = (W, rows, deep, capped, least = 0) => {
    if (needs.length < rows) return null;
    const H = W / targetAspect;
    const area = W * H;
    const under = corridorsBetween(rows);
    const total = H - CORRIDOR * under.filter(Boolean).length;
    const depths = depthsOf(total, rows, deep);
    if (!(Math.min(...depths) > PLATE_BAND)) return null;
    const tops = rowTops(under, depths);
    let best = null;
    // The reception at its contents: a column as wide as its queue asks, where
    // that is inside its cap. Where it is not, and the floor is being held to
    // its caps, the reception is HELD to whatever width the column is.
    const hold = capped && officeColAt(officeWide).h * officeWide > OFFICE_AREA_MAX * area + EPS;
    const narrowest = hold ? OFFICE_MIN_W : Math.max(OFFICE_MIN_W, officeWide);
    for (let sw = narrowest; sw + CORRIDOR < W; sw++) {
      const roomsW = W - sw - CORRIDOR;
      // A wider column only leaves the rooms less.
      if (roomsW * total < ROOMS_AREA_MIN * area - EPS) break;
      const officeMax = (OFFICE_AREA_MAX * area) / sw;
      const loungeMax = (LOUNGE_AREA_MAX * area) / sw;
      const office = officeColAt(sw, hold);
      const tier = hold ? 0 : OFFICE_FULL;
      if (office.w > sw + EPS || office.h > officeMax + EPS) continue;
      // The lounge with everything in it, or — where the floor is held to its
      // caps — the one with the most games tables that the column has room for.
      let lounge = null;
      for (let games = whole.games; games >= 0 && !lounge; games--) {
        const all = games === whole.games;
        const got = loungeAt(sw, false, all ? Infinity : games);
        const fits = got.w <= sw + EPS && office.h + got.h <= H + EPS && got.h <= loungeMax + EPS;
        if (fits && (!all || got.seats >= seatsWanted)) {
          lounge = { h: got.h, games: all ? Infinity : games, kept: games };
        }
        if (!capped) break;
      }
      // A wider column is only worth laying for fuller service rooms.
      const kept = lounge ? keptOf(tier, lounge.kept) : -1;
      if (!lounge || kept < least || (best && kept <= best.kept)) continue;
      // What the column has past its contents is the lounge's first, then the
      // reception's, each to its cap. A column with floor left after both is
      // wider than the service rooms may be, and the next one is wider still.
      let spare = H - office.h - lounge.h;
      const toLounge = Math.min(spare, loungeMax - lounge.h);
      spare -= toLounge;
      const toOffice = Math.min(spare, officeMax - office.h);
      spare -= toOffice;
      if (spare > EPS) break;
      const bands = tops.map((y, k) => ({ x: sw + CORRIDOR, y, w: roomsW, d: depths[k] }));
      const grid = layGrid(weights, bands, footprints, empty);
      if (!grid) continue;
      const officeH = office.h + toOffice;
      best = {
        family: /** @type {const} */ ('column'),
        rows,
        deep,
        capped,
        W,
        H,
        depths,
        under,
        tops,
        lane: 0,
        grid,
        office: { x: 0, y: 0, w: sw, h: officeH },
        lounge: { x: 0, y: officeH, w: sw, h: H - officeH },
        hold,
        games: lounge.games,
        kept,
        halls: /** @type {{x:number,y:number,w:number,h:number}[]} */ ([]),
      };
      if (best.kept >= wholeKept) break;
    }
    return best;
  };

  /** @typedef {NonNullable<ReturnType<typeof bandsAt>|ReturnType<typeof columnAt>>} Candidate */

  /**
   * The smallest building one way of laying it keeps every rule in, looking
   * from `from` and no wider than `limit`.
   * @param {(W:number) => Candidate|null} at @param {number} from @param {number} limit
   */
  const smallest = (at, from, limit) => {
    let below = from;
    let found = null;
    for (let W = from; W <= limit; W *= WIDTH_STEP) {
      found = at(W);
      if (found) break;
      below = W;
    }
    if (!found || found.W <= from + EPS) return found;
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
   * The best building over some row counts: bands before a column, equal rows
   * before a deep one, and a later one only by being `WIDTH_TIE` smaller — or,
   * at the same width, by keeping more of the lounge.
   * @param {number[]} rowCounts @param {boolean} capped @param {number} from
   * @param {Candidate|null} [held] the building to beat, and @param {number} [by] how far
   * @param {number} [ceiling] the widest building worth finding at all
   */
  const search = (rowCounts, capped, from, held = null, by = WIDTH_TIE, ceiling = WIDTH_MAX) => {
    let best = held;
    /** @param {typeof bandsAt} at @param {number} rows @param {number} deep */
    const consider = (at, rows, deep) => {
      const first = best === held;
      const gain = first ? by : WIDTH_TIE;
      // Nothing wider than what it has to beat is worth looking for.
      const limit = Math.min(ceiling, !best ? WIDTH_MAX : first ? best.W * (1 - gain) : best.W);
      if (limit < from) return;
      // A floor of many rooms only gets easier to lay as it grows, so one that
      // does not fit at the limit does not fit under it either. A floor of a
      // few can be too WIDE for them, and is looked for the long way.
      const eases = needs.length >= MANY_ROOMS || rows > ROWS_MAX;
      if (eases && !at(limit, rows, deep, capped)) return;
      const got = smallest((W) => at(W, rows, deep, capped), from, limit);
      if (!got) return;
      const smaller = !best || got.W < best.W * (1 - gain);
      const fuller = best && best !== held && got.W <= best.W + EPS && got.kept > best.kept;
      if (smaller || fuller) best = got;
    };
    for (const rows of rowCounts) {
      for (const at of [bandsAt, columnAt]) {
        consider(at, rows, -1);
        // One row deeper than the rest: every row in turn inside the norm, and
        // past it only for the way of laying the floor that is already ahead.
        const ahead = best && best !== held && best.rows === rows && best.deep === -1;
        if (rows > 1 && (rows <= ROWS_MAX || ahead)) {
          for (let deep = 0; deep < rows; deep++) consider(at, rows, deep);
        }
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

  const nominal = nominalWidth(input.stage, targetAspect);
  /** How wide the floor comes out laid at its contents; 0 where it cannot be. */
  let contentsW = 0;

  /** Every room of one candidate, built and placed; null if one did not fit. */
  const build = (/** @type {Candidate} */ c) => {
    const held = { hold: c.hold };
    const office =
      c.family === 'bands'
        ? buildOfficeRow(waitingCount, { w: c.office.w, h: c.office.h }, held)
        : buildOffice(waitingCount, c.office, { maxW: c.office.w, ...held });
    if (office.room.w > c.office.w + 0.01 || office.room.h > c.office.h + 0.01) return null;
    const cell = { w: c.lounge.w, h: c.lounge.h };
    const lounge = buildLounge(benchedCount, cell, goneHomeCount, 1, { maxGames: c.games });
    const inLounge = lounge.room.natural || lounge.room;
    if (inLounge.w > c.lounge.w + 0.01 || inLounge.h > c.lounge.h + 0.01) return null;
    Object.assign(office.room, c.office);
    Object.assign(lounge.room, c.lounge);

    /** @type {{room:Room, seats:Seat[]}[]} */
    const projectRooms = [];
    /** @type {Room[]} */
    const stripRooms = [];
    for (const [i, need] of needs.entries()) {
      const at = { ...c.grid.cells[i] };
      const rect = { x: at.x, y: at.y, w: at.w, h: at.h };
      if (need.pinned) {
        const { room } = buildPinnedRoom(need.project, rect);
        Object.assign(room, rect);
        stripRooms.push(room);
        continue;
      }
      const built = roomInto(need, rect);
      if (!built) return null;
      Object.assign(built.room, rect);
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
          y: c.tops[k] + c.depths[k],
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
        const last = served[i + 1];
        corridors.push(
          corridorRoom({
            id: `__lane-${i}__`,
            x: 0,
            y: top,
            w: c.lane,
            h: c.tops[last] + c.depths[last] - top,
          }),
        );
      }
    }
    c.halls.forEach((hall, i) => corridors.push(corridorRoom({ id: `__hall-${i}__`, ...hall })));

    const bare = projectRooms.map(({ room }) => {
      const n = room.natural || room;
      return 1 - (n.w * n.h) / Math.max(1e-6, room.w * room.h);
    });
    const left = Math.min(...c.grid.cells.map((cell0) => cell0.x));
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
        /** The service rooms were held to their caps at the nominal scale. */
        capped: c.capped,
        /** The width this floor would be at its contents, and at that scale. */
        contentsW: contentsW,
        nominalW: nominal,
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
  const laid = (/** @type {boolean} */ capped, /** @type {number} */ from, ceiling = WIDTH_MAX) =>
    search(
      more,
      capped,
      from,
      search(order, capped, from, null, WIDTH_TIE, ceiling),
      ROWS_EXTRA_GAIN,
      ceiling,
    );

  // FIRST AT ITS CONTENTS, and that is the floor wherever it is no wider than
  // the window is at the scale the floor is designed for.
  //
  // No building is smaller than its rooms' furniture, so the search starts
  // there rather than at a width nothing could fit in.
  const furniture = needs.reduce(
    (a, n) => a + Math.min(Infinity, ...(n.footprints || [{ w: 0, h: 0 }]).map((f) => f.w * f.h)),
    0,
  );
  const least = Math.max(WIDTH_MIN, Math.sqrt(targetAspect * furniture));
  let chosen = laid(false, least);
  contentsW = chosen ? chosen.W : 0;
  if (!chosen || chosen.W > nominal + EPS) {
    // THEN AT THE NOMINAL WIDTH, the service rooms held to their caps. Wider
    // than that only as far as the rooms themselves need.
    let held = laid(true, Math.max(nominal, least), chosen ? chosen.W : WIDTH_MAX);
    // AND WHERE THE ROOMS TOOK IT PAST THE NOMINAL WIDTH, THE LOUNGE IS NOT
    // WHAT PAYS FOR THEIR LAST FEW PER CENT. The smallest building the rooms
    // fit in is the one where every service room has given up everything it
    // can; a building `SERVICE_SLACK` wider is the same picture to the eye,
    // and may be the difference between a lounge and a sofa with a chip on it.
    // So: the fullest lounge any way of laying that slightly wider building
    // has, at the smallest width that still has it.
    if (held && held.W > nominal + EPS && held.kept < wholeKept) {
      const limit = Math.min(held.W * (1 + SERVICE_SLACK), chosen ? chosen.W : Infinity);
      /** @type {Candidate|null} */
      let fuller = null;
      for (const rows of [...order, ...more]) {
        for (const way of [bandsAt, columnAt]) {
          for (let deep = -1; deep < (rows > 1 ? rows : 0); deep++) {
            const got = way(limit, rows, deep, true, (fuller || held).kept + 1);
            if (got) fuller = got;
          }
        }
      }
      if (fuller) {
        const way = fuller.family === 'bands' ? bandsAt : columnAt;
        const kept = fuller.kept;
        let below = held.W;
        let above = limit;
        for (let i = 0; i < WIDTH_REFINE; i++) {
          const mid = (below + above) / 2;
          const got = way(mid, fuller.rows, fuller.deep, true, kept);
          if (got) {
            fuller = got;
            above = mid;
          } else below = mid;
        }
        held = fuller;
      }
    }
    if (held && (!chosen || held.W < chosen.W - EPS)) chosen = held;
  }
  if (!chosen) return null;

  // A room built into its cell can come out a hair past what it bid with. The
  // same way of laying it, a little larger, until every room fits.
  const at = chosen.family === 'bands' ? bandsAt : columnAt;
  let width = chosen.W;
  for (let grow = 0; grow < 12; grow++) {
    const built = build(chosen);
    if (built) return built;
    /** @type {Candidate|null} */
    let next = null;
    for (let step = 0; step < 8 && !next; step++) {
      width *= 1.02;
      next = at(width, chosen.rows, chosen.deep, chosen.capped, chosen.kept);
    }
    if (!next) return null;
    chosen = next;
  }
  return null;
}
