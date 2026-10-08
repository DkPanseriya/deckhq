/**
 * THE PROPORTIONED FLOOR: a building laid to the designer's rulebook.
 *
 * `plan-proportions.js` is the rules. This is the building they are laid
 * into — the smallest one of the window's shape in which every one of them
 * holds, so the people on it are drawn as large as the rules allow.
 *
 * THREE FAMILIES, and each is a grid of rooms and the two service rooms:
 *
 *     bands                        column                  front
 *     +--------+-------------+     +--------+-+-------+    +--------+--------+
 *     | office | rooms       |     | office | | rooms |    | office | lounge |
 *     +--------+-------------+     |        |s+-------+    +--------+--------+
 *     |     the corridor     |     +--------+p| a corr|    |  the corridor   |
 *     +-----------+----------+     | lounge |i+-------+    +--------+--------+
 *     | lounge    | rooms    |     |        |n| rooms |    | rooms  | rooms  |
 *     +-----------+----------+     +--------+e+-------+    +--------+--------+
 *
 * In BANDS the office is the left end of the top row and the lounge the left
 * end of the bottom one, each as wide as what is in it, and the rooms take the
 * rest of every row. In a COLUMN the two stand one over the other down the
 * left and the rooms are a plain grid beside them. In a FRONT they are side by
 * side across the top and the rooms are the rows behind: the floor for two or
 * three rooms in a window neither wide nor tall, where one over the other each
 * is too wide to be a room and side by side beside a column each is too narrow
 * until the building is enormous (`FRONT_GAIN`). Rows of rooms are one depth
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
 * which row is the deep one. What the two service rooms ask of it is measured
 * in `plan-grid-service.js`.
 *
 * Pure geometry. No DOM, no clock, no randomness.
 */

import { buildProjectRoom } from './plan-rooms.js';
import { DESK_ASPECTS, buildCandidate } from './plan-grid-build.js';
import { OFFICE_FULL, measureService } from './plan-grid-service.js';
import {
  CORRIDOR,
  LOUNGE_MIN_H,
  OFFICE_MIN_W,
  OFFICE_ROW_ASPECT_MAX,
  PLATE_BAND,
} from './plan-units.js';
import {
  LOUNGE_AREA_MAX,
  MODULE_WEIGHTS,
  OFFICE_AREA_MAX,
  ROOMS_AREA_MIN,
  ROOM_RATIO_MIN,
  ROWS_LIMIT,
  ROWS_MAX,
  ROW_DEPTH_SPREAD_MAX,
  corridorsBetween,
  layGrid,
  moduleFor,
  nominalWidth,
  pinnedWeight,
  roomAreaMax,
  widthAtLargestScale,
} from './plan-proportions.js';
import { AGENT_SCALE } from './plan-scale.js';

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
/** How far `within` steps down from the building the rooms' ceilings allow. */
const WITHIN_STEP = 1.03;
/** And how far down it looks before the floor is laid the other way. */
const WITHIN_REACH = 0.75;
/**
 * And on a floor whose rooms are not the majority, how near their ceilings
 * they are laid: a row too shallow for its rooms to be the size they may be
 * is a row of strips beside a hall, and the next building up is the floor.
 */
const CEILING_REACH = 0.8;
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
 * And THE FRONT replaces bands or a column only by being this much smaller. It
 * spends a whole band of the building on the two service rooms, so it is the
 * floor for where the other two cannot be had at a sensible size — two rooms
 * in a window neither wide nor tall — and not a third taste.
 */
const FRONT_GAIN = 0.12;
/** The rows of rooms a front is laid over: past two it is corridors. */
const FRONT_ROWS = Object.freeze([1, 2]);
/** The shallowest a front is tried at: a lounge is never shallower. */
const FRONT_DEPTH_MIN = Math.ceil(LOUNGE_MIN_H);
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
 * @param {(p: ProjectLike) => number} [input.benchSeatsIn] people at its worktree benches
 * @returns {null | {W:number, H:number, rows:false, arrangement:'bands'|'column'|'front',
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
    // A worktree's bench seats are people at desks: they count toward the module.
    const seated = desks + (input.benchSeatsIn ? input.benchSeatsIn(project) : 0);
    const module = moduleFor({ desks: seated, crew: input.crewSizeIn(project) });
    /** @type {{w:number,h:number}[]} */
    const footprints = [];
    for (const aspect of DESK_ASPECTS) {
      const n = buildProjectRoom(project, desks, aspect, undefined, crew).room.natural;
      if (n && !footprints.some((f) => Math.abs(f.w - n.w) < 0.01 && Math.abs(f.h - n.h) < 0.01)) {
        footprints.push({ w: n.w, h: n.h });
      }
    }
    const weight = MODULE_WEIGHTS[module];
    return { project, pinned: false, desks, crew, module, weight, footprints };
  });
  const small = pinnedWeight(needs.filter((n) => !n.pinned).map((n) => n.weight));
  for (const n of needs) if (n.pinned) n.weight = small;
  const weights = needs.map((n) => n.weight);
  const footprints = needs.map((n) => n.footprints);
  const empty = needs.map((n) => n.pinned);
  // A ROOM HAS A CEILING (`roomAreaMax`), and no way of laying the floor is
  // let past it. `margin` is the floor whose rooms are all at theirs and still
  // not the majority: what a row's rooms leave is then its service room's to
  // its cap and, past that, a hall as wide as it comes.
  const desksOf = (/** @type {{w:number,h:number}[]|undefined} */ list) =>
    list && list.length ? Math.min(...list.map((f) => f.w * f.h)) : 0;
  const caps = needs.map((n) => roomAreaMax(n.module, desksOf(n.footprints)));
  const capsTotal = caps.reduce((a, v) => a + v, 0);
  let margin = false;
  /** Set while a probe asks whether a floor could be laid with no ceilings. */
  let lifted = false;
  /** Set while the floor is laid as if no room had one (the first look). */
  let free = true;
  /** Set where a row of rooms at their ceilings may leave a hall beside it. */
  let roomy = false;
  /** What such a row may leave: nothing, or whatever it does. */
  const hallBeside = () => (roomy ? Infinity : 0);
  /** No building whose rooms are the majority is wider than their ceilings allow. */
  const widest = Math.min(WIDTH_MAX, Math.sqrt((targetAspect * capsTotal) / ROOMS_AREA_MIN));
  /** Rooms that are the majority, or — on a `margin` floor — all they may be. */
  const enough = (/** @type {{cells:{w:number,h:number}[], full:boolean}} */ grid, area = 0) =>
    areaOf(grid.cells) >= ROOMS_AREA_MIN * area - EPS ||
    (margin && grid.full && areaOf(grid.cells) >= CEILING_REACH * capsTotal);

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
   * What each row's rooms left untaken, at its left end: a hall. Null where
   * one of them is a sliver — narrower than a corridor is a gap, not a way in.
   * @param {{taken:number[]}} grid @param {number[]} tops @param {number[]} depths
   * @param {(k:number) => number} from where row k starts @param {number} W
   */
  const leftOf = (grid, tops, depths, from, W) => {
    const out = tops.map((y, k) => {
      const w = W - from(k) - grid.taken[k];
      return { x: from(k), y, w: w > EPS ? w : 0, h: depths[k] };
    });
    return out.some((r) => r.w > 0 && r.w < CORRIDOR - EPS) ? null : out;
  };

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
        const hall = margin ? Infinity : HALL_MAX;
        const bands = tops.map((y, k) => {
          const d = depths[k];
          if (k === 0) {
            const give = Math.max(0, officeMax - desk.w) + hall;
            return { x: desk.w, y, w: W - desk.w, d, give, spare: hallBeside() };
          }
          if (k === rows - 1) {
            const give = Math.max(0, loungeMax - option.w) + hall;
            return { x: option.w, y, w: W - option.w, d, give, spare: hallBeside() };
          }
          return { x: lane, y, w: W - lane, d, give: margin ? Infinity : 0, spare: hallBeside() };
        });
        const got = layGrid(weights, bands, footprints, empty, free || lifted ? [] : caps);
        if (!got || !enough(got, area)) continue;
        office = desk;
        lounge = option;
        grid = got;
        break;
      }
      if (grid) break;
    }
    if (!office || !lounge || !grid) return null;
    const taken = (/** @type {number} */ k) => grid.taken[k];
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
    // The rows between them have no service room: what they leave is a hall.
    const between = leftOf(grid, tops, depths, (k) => (k % (rows - 1) ? lane : W - taken(k)), W);
    if (!top || !bottom || !between) return null;
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
        ...between,
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
      if (!margin && roomsW * total < ROOMS_AREA_MIN * area - EPS) break;
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
      const give = margin ? Infinity : 0;
      const bands = tops.map((y, k) => ({
        x: sw + CORRIDOR,
        y,
        w: roomsW,
        d: depths[k],
        give,
        spare: hallBeside(),
      }));
      const grid = layGrid(weights, bands, footprints, empty, free || lifted ? [] : caps);
      const halls =
        grid && enough(grid, area) && leftOf(grid, tops, depths, () => sw + CORRIDOR, W);
      if (!grid || !halls) continue;
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
        halls: halls.filter((r) => r.w > 0),
      };
      if (best.kept >= wholeKept) break;
    }
    return best;
  };

  /**
   * THE FRONT at one width: the reception and the lounge side by side across
   * the top — front of house — the spine under them, and the rooms in the rows
   * behind. It is the floor for a FEW rooms in a window neither wide nor tall.
   * Two rooms one over the other are each too wide to be a room there; side by
   * side beside a column they are too narrow until the building is enormous.
   * Here they stand side by side in a row as deep as their shape wants, and
   * the service rooms have the band that is left.
   *
   * The front is tried shallowest first, so the first depth that holds its
   * contents is the one that leaves the rooms the most; held to its caps, the
   * fullest service rooms any depth of it has room for.
   * @param {number} W @param {number} rows @param {number} deep
   * @param {boolean} capped @param {number} [least] the least it may keep
   *   of its service rooms (`keptOf`)
   */
  const frontAt = (W, rows, deep, capped, least = 0) => {
    if (!FRONT_ROWS.includes(rows) || needs.length < rows) return null;
    // At ANY width: the rows are at least the rooms' share of the depth, a room
    // is at least `ROOM_RATIO_MIN` of its row's depth wide, and a row is no
    // wider than the building. More rooms than that allows is not a front.
    const most = (rows * rows * targetAspect * DEEP_ROW) / (ROOM_RATIO_MIN * ROOMS_AREA_MIN);
    if (needs.length > most) return null;
    const H = W / targetAspect;
    const area = W * H;
    // The front is the first band of `rows + 1`, and is cut like one.
    const under = corridorsBetween(rows + 1);
    const ways = CORRIDOR * under.filter(Boolean).length;
    // Two rows behind it are joined by a lane beside the first of them.
    const lane = rows >= 2 ? CORRIDOR : 0;
    // The deepest a front may be is what the rooms' share leaves it — or, on a
    // floor whose rooms are held under that share, what a row of them needs.
    const deepest = H - ways - (margin ? PLATE_BAND * 2 : ROOMS_AREA_MIN * H);
    let best = null;
    for (let d = FRONT_DEPTH_MIN; d <= deepest + EPS; d++) {
      const lounges = loungesInBand(d, area, capped, 0);
      // The fullest reception, and the fullest lounge that fits beside it.
      let desk = null;
      let option = null;
      for (const o of lounges.length ? officesInBand(d, area, capped) : []) {
        option = lounges.find((l) => o.w + l.w <= W + EPS) || null;
        if (option) {
          desk = o;
          break;
        }
      }
      const kept = desk && option ? keptOf(desk.tier, option.kept) : -1;
      if (!desk || !option || kept < least || (best && kept <= best.kept)) continue;
      const depths = [d, ...depthsOf(H - ways - d, rows, deep)];
      if (!(Math.min(...depths) > PLATE_BAND)) break;
      const tops = rowTops(under, depths);
      const bands = depths.slice(1).map((depth, k) => {
        const x = k === 0 ? lane : 0;
        const give = margin ? Infinity : 0;
        return { x, y: tops[k + 1], w: W - x, d: depth, give, spare: hallBeside() };
      });
      const grid = layGrid(weights, bands, footprints, empty, free || lifted ? [] : caps);
      const behind = grid && leftOf(grid, tops.slice(1), depths.slice(1), (k) => (k ? 0 : lane), W);
      if (!grid || !behind || !enough(grid, area)) continue;
      // What the two do not need of the band is the lounge's first, then the
      // reception's, each to its cap; past both caps it is a hall between
      // them, at least a corridor wide.
      const officeMax = Math.min(
        (OFFICE_AREA_MAX * area) / d,
        (d - PLATE_BAND) * OFFICE_ROW_ASPECT_MAX,
      );
      let hall = W - desk.w - option.w;
      let loungeW = option.w + Math.min(hall, Math.max(0, (LOUNGE_AREA_MAX * area) / d - option.w));
      hall = W - desk.w - loungeW;
      const officeW = desk.w + Math.min(hall, Math.max(0, officeMax - desk.w));
      hall = W - officeW - loungeW;
      if (hall > EPS && hall < CORRIDOR) {
        loungeW -= CORRIDOR - hall;
        hall = CORRIDOR;
      }
      if (loungeW < option.w - EPS) continue;
      best = {
        family: /** @type {const} */ ('front'),
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
        office: { x: 0, y: 0, w: officeW, h: d },
        lounge: { x: W - loungeW, y: 0, w: loungeW, h: d },
        hold: desk.hold,
        games: option.games,
        kept,
        halls: [{ x: officeW, y: 0, w: hall > EPS ? hall : 0, h: d }, ...behind].filter(
          (r) => r.w > 0,
        ),
      };
      if (kept >= wholeKept) break;
    }
    return best;
  };

  /** The ways of laying a floor, by the name a candidate carries. */
  const ways = { bands: bandsAt, column: columnAt, front: frontAt };
  /** @typedef {NonNullable<ReturnType<typeof bandsAt>|ReturnType<typeof columnAt>|ReturnType<typeof frontAt>>} Candidate */

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
   * @param {(typeof bandsAt)[]} [among] the ways of laying it to look at
   */
  const search = (
    rowCounts,
    capped,
    from,
    held = null,
    by = WIDTH_TIE,
    ceiling = WIDTH_MAX,
    among = [bandsAt, columnAt],
  ) => {
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
      // And that is asked with the ceilings lifted, which are what make any
      // floor too wide for its rooms sooner or later.
      const eases = needs.length >= MANY_ROOMS || rows > ROWS_MAX;
      lifted = eases;
      const never = eases && !at(limit, rows, deep, capped);
      lifted = false;
      if (never) return;
      const got = smallest((W) => at(W, rows, deep, capped), from, limit);
      if (!got) return;
      const smaller = !best || got.W < best.W * (1 - gain);
      const fuller = best && best !== held && got.W <= best.W + EPS && got.kept > best.kept;
      if (smaller || fuller) best = got;
    };
    for (const rows of rowCounts) {
      for (const at of among) {
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

  const nominal = nominalWidth(input.stage, targetAspect);
  /** How wide the floor comes out laid at its contents; 0 where it cannot be. */
  let contentsW = 0;

  /** Every room of one candidate, built and placed (`plan-grid-build.js`). */
  const build = (/** @type {Candidate} */ c) =>
    buildCandidate(c, {
      needs,
      caps,
      waitingCount,
      benchedCount,
      goneHomeCount,
      contentsW,
      nominal,
    });

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
  const laid = (/** @type {boolean} */ capped, /** @type {number} */ from, ceiling = WIDTH_MAX) => {
    const usual = search(order, capped, from, null, WIDTH_TIE, ceiling);
    const front = search([...FRONT_ROWS], capped, from, usual, FRONT_GAIN, ceiling, [frontAt]);
    return search(more, capped, from, front, ROWS_EXTRA_GAIN, ceiling);
  };

  // FIRST AT ITS CONTENTS, and that is the floor wherever it is no wider than
  // the window is at the scale the floor is designed for.
  //
  // No building is smaller than its rooms' furniture, so the search starts
  // there rather than at a width nothing could fit in.
  const furniture = needs.reduce(
    (a, n) => a + Math.min(Infinity, ...(n.footprints || [{ w: 0, h: 0 }]).map((f) => f.w * f.h)),
    0,
  );
  // Nor is one drawn past the largest scale: a window too large for its floor
  // is given a larger building, not ground round a small one.
  const least = Math.max(
    WIDTH_MIN,
    Math.sqrt(targetAspect * furniture),
    widthAtLargestScale(input.stage, AGENT_SCALE.s),
  );

  /**
   * A FLOOR OF FEW ROOMS. Their ceilings come to less than the majority of any
   * building its service rooms stand in at their contents, so there is none to
   * find above. The building is then the one the rooms AT their ceilings are
   * the majority of — or the widest under it that can be laid — with the
   * service rooms held to their caps in it: that is the floor drawn largest
   * with nothing given up but a games table. And where even the service
   * rooms' least does not fit in that (one room, two), the smallest building
   * that holds them, its rooms at their ceilings and the rest a hall.
   * @param {number} from the narrowest building worth looking at
   */
  const within = (from) => {
    const top = Math.min(nominal, widest);
    roomy = true;
    for (let W = top; W >= Math.max(from, top * WITHIN_REACH) - EPS; W /= WITHIN_STEP) {
      for (const loose of [false, true]) {
        margin = loose;
        /** @type {Candidate|null} */
        let best = null;
        for (const rows of order) {
          for (const way of [bandsAt, columnAt, frontAt]) {
            for (let deep = -1; deep < (rows > 1 ? rows : 0); deep++) {
              const got = way(W, rows, deep, true);
              if (got && (!best || got.kept > best.kept)) best = got;
            }
          }
        }
        if (best) return best;
      }
    }
    margin = true;
    return laid(true, Math.max(from, top));
  };

  /** The floor with its rooms the majority, as it has always been looked for. */
  const majority = () => {
    let chosen = laid(false, least, free ? WIDTH_MAX : widest);
    if (free) contentsW = chosen ? chosen.W : 0;
    if (!chosen || chosen.W > nominal + EPS) {
      // THEN AT THE NOMINAL WIDTH, the service rooms held to their caps. Wider
      // than that only as far as the rooms themselves need.
      let held = laid(
        true,
        Math.max(nominal, least),
        chosen ? chosen.W : free ? WIDTH_MAX : widest,
      );
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
          for (const way of [bandsAt, columnAt, frontAt]) {
            for (let deep = -1; deep < (rows > 1 ? rows : 0); deep++) {
              const got = way(limit, rows, deep, true, (fuller || held).kept + 1);
              if (got) fuller = got;
            }
          }
        }
        if (fuller) {
          const way = ways[fuller.family];
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
    return chosen;
  };
  // FIRST AS IF NO ROOM HAD A CEILING, and that is the floor wherever none of
  // its rooms came out over one: a floor of many rooms is laid as it always
  // was. Otherwise with the ceilings: every row filled to the unit; then with
  // a hall beside any row whose rooms are all at theirs, which is the floor
  // only where it is plainly the smaller building; and where the ceilings
  // leave no building the rooms are the majority of, `within`.
  let chosen = majority();
  if (!chosen || chosen.grid.cells.some((c, i) => c.w * c.h > caps[i] + 1e-6)) {
    free = false;
    chosen = majority();
    roomy = true;
    const halled = majority();
    if (halled && (!chosen || halled.W < chosen.W * (1 - WIDTH_TIE))) chosen = halled;
    else roomy = false;
    if (!chosen) chosen = within(least);
  }
  if (!chosen) return null;

  // A room built into its cell can come out a hair past what it bid with. The
  // same way of laying it, a little larger, until every room fits.
  const at = ways[chosen.family];
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
