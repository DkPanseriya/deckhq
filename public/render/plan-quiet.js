/**
 * A QUIET FLOOR: a floor of few project rooms, laid round the rooms.
 *
 * `plan-grid.js` lays a floor of many rooms as a grid with the reception and
 * the lounge at the ends of its rows. With one or two rooms that grid is
 * mostly its two service rooms, and what the rooms could not take was a hall a
 * quarter of the building wide. Here the rooms are the building and the two
 * service rooms are a STRIP down one side of it (`plan-proportions.js` (j)):
 *
 *     +--------+-+-----------+
 *     | office | |           |
 *     |        |s|   room    |
 *     +--------+p|           |
 *     | lounge |i+-----------+
 *     |        |n|   room    |
 *     +--------+e+-----------+
 *
 * The reception stands over the lounge down the left, each at the size of who
 * is in it, the spine beside them, and the rooms one over the other across
 * the rest: every door in the building is on the spine. It is the grid's
 * COLUMN with the reception on its side, one room to a row and no corridor
 * between the rows, and it is recorded as one.
 *
 * WHAT IS TRIED BEFORE A HALL, in this order: the rooms as wide as a room may
 * be; a lone room one module up, and a second where one still leaves it short
 * of the majority (`loneModules`); the strip to its cap. What is left after
 * all three is a hall along the spine, and the floor that leaves the least of
 * it is the floor.
 *
 * THREE ROOMS ARE LAID HERE ONLY IN A TALL WINDOW. In a wide one they are each
 * too shallow, one over the other, to be a room (no floor is found, and the
 * grid's is the floor); and the floor that does hold them — two across the top and the
 * strip in the row behind — stands the reception's sofa on the building's foot
 * wall, where the names of the people on it are drawn off the window. They are
 * the grid's, in bands, where the two service rooms already are the left end
 * of the building.
 *
 * Nothing is searched for but the building's width: at a width this is one
 * floor, in closed form. Two are compared by how far each is from the three
 * things a quiet floor is held to (`shortOf`) and then by what is in them that
 * is not a room.
 *
 * Pure geometry. No DOM, no clock, no randomness.
 */

import { buildCandidate } from './plan-grid-build.js';
import { buildOfficeRow } from './plan-office.js';
import { CORRIDOR, PLATE_BAND } from './plan-units.js';
import {
  HALL_AREA_MAX,
  LOUNGE_AREA_MAX,
  MODULE_WEIGHTS,
  OFFICE_AREA_MAX,
  QUIET_PX_PER_UNIT,
  QUIET_ROOMS_MAX,
  ROOMS_AREA_MIN,
  ROOM_FURNISHED_MIN,
  ROOM_RATIO_MAX,
  ROOM_RATIO_MIN,
  SERVICE_STRIP_MAX,
  loneModules,
  roomCeilings,
  roomsHold,
} from './plan-proportions.js';
import { AGENT_SCALE } from './plan-scale.js';

const EPS = 1e-6;

/** How far the building's width steps between one floor tried and the next. */
const WIDTH_STEP = 1.005;
/** Two floors this close to the rules are the same to the eye. */
const SHORT_TIE = 0.004;
/**
 * A floor this close to every rule — its people at their size among them, so
 * only where the window's pixels are known — is taken without the grid being
 * asked for its own.
 */
const SHORT_SURE = 0.002;
/** How many of the best floors are built before the grid's own is taken. */
const BUILD_TRIES = 16;
/** A building too wide for its people's size counts twice what a share does. */
const WIDE_WEIGHT = 2;

/**
 * How far a laid floor is from what a quiet floor is held to, as one number:
 * what the rooms are short of the majority, what its halls are over a tenth,
 * and how much wider the building is than the one its people are drawn at
 * forty-six pixels in. Nought for a floor that keeps all three.
 *
 * @param {Laid} c
 * @param {number} widest the widest building that keeps the figure's size; 0 for none
 */
export function shortOf(c, widest) {
  const { rooms, halls } = sharesOf(c);
  return (
    Math.max(0, ROOMS_AREA_MIN - rooms) +
    Math.max(0, halls - HALL_AREA_MAX) +
    (widest > 0 ? Math.max(0, c.W / widest - 1) * WIDE_WEIGHT : 0)
  );
}

/**
 * @typedef {{W:number, H:number, spine?:number, grid:{cells:{w:number,h:number}[]},
 *   halls:{w:number,h:number}[]}} Laid
 */

/**
 * What the rooms and the halls of one floor are of its building. A spine wider
 * than a corridor is a corridor and a hall beside it, and is counted as both.
 * @param {Laid} c
 */
function sharesOf(c) {
  const area = Math.max(EPS, c.W * c.H);
  const sum = (/** @type {{w:number,h:number}[]} */ list) =>
    list.reduce((a, r) => a + r.w * r.h, 0);
  const beside = Math.max(0, (c.spine ?? CORRIDOR) - CORRIDOR) * c.H;
  return { rooms: sum(c.grid.cells) / area, halls: (sum(c.halls) + beside) / area };
}

/**
 * Lay a quiet floor, or say that this is not one.
 *
 * @param {object} floor
 * @param {any[]} floor.needs each room's project, desks, module and footprints
 * @param {number} floor.targetAspect the window's shape
 * @param {{w?:number, h?:number}} [floor.stage] the canvas, in pixels
 * @param {number} floor.least the narrowest building worth laying
 * @param {number} floor.nominal the widest: the window at the nominal scale
 * @param {any} floor.service what the two service rooms ask (`measureService`)
 * @param {number} floor.waitingCount @param {number} floor.benchedCount
 * @param {number} floor.goneHomeCount
 * @returns {null | {built: any, short: number, sure: boolean,
 *   beats: (rival: any) => boolean}} the floor built, how far it is from the
 *   rules, whether that is near enough to take unasked, and whether it is at
 *   least as near them as another way of laying the same floor in a building
 *   no smaller than this one
 */
export function layQuiet(floor) {
  const { needs, targetAspect: aspect, service, waitingCount, benchedCount, goneHomeCount } = floor;
  const n = needs.length;
  if (!n || n > QUIET_ROOMS_MAX) return null;
  const px = Number(floor.stage?.w) > 0 && Number(floor.stage?.h) > 0 ? Number(floor.stage?.w) : 0;
  const widest = (px * AGENT_SCALE.s) / QUIET_PX_PER_UNIT;

  // The reception on its side at its contents, and the lounge at a width.
  const desk = buildOfficeRow(waitingCount, { w: 0, h: 0 }, { compact: true, graded: true }).room;
  const loungeAt = (/** @type {number} */ w) => {
    const got = service.loungeAt(Math.floor(w), false, Infinity);
    return got.seats >= service.seatsWanted ? got : null;
  };

  // A LONE ROOM IS LAID AT ITS OWN MODULE, THEN THE NEXT, THEN THE LARGEST:
  // every other floor at the modules its rooms have.
  const lone = n === 1 && !needs[0].pinned;
  // (A room with worktree benches and no crew carries a crew of no size.)
  const crewed = Number(needs[0].crew?.w) > 0 || Number(needs[0].crew?.h) > 0;
  const kits = lone ? loneModules(needs[0].module, crewed) : [undefined];
  const floors = kits.map((kit, rank) => {
    const rooms = kit ? [{ ...needs[0], kit }] : needs;
    return {
      rank,
      rooms,
      caps: roomCeilings(rooms.map((r) => ({ ...r, module: r.kit ?? r.module }))),
    };
  });

  /**
   * How wide one room may be in a row of a depth: its shape, its furniture, its
   * module's kit and its ceiling. Null where no width is all four.
   * @param {any} need @param {number} cap @param {number} d
   */
  const span = (need, cap, d) => {
    let furniture = 0;
    if (Array.isArray(need.footprints) && need.footprints.length) {
      furniture = Infinity;
      for (const f of need.footprints) if (f.h <= d + EPS) furniture = Math.min(furniture, f.w);
    }
    // And no smaller than its module is furnished at: a team's room too small
    // for its table is a one-desk room with more desks in it.
    const module = /** @type {'S'|'M'|'L'} */ (need.kit ?? need.module ?? 'S');
    const kit = need.pinned ? 0 : ROOM_FURNISHED_MIN * MODULE_WEIGHTS[module];
    const lo = Math.max(ROOM_RATIO_MIN * d, furniture, kit / d);
    const hi = Math.min(ROOM_RATIO_MAX * d, cap / d);
    return hi >= lo - EPS ? { lo, hi: Math.max(lo, hi) } : null;
  };
  /**
   * A hall is a corridor wide or it is not there: a sliver is made up to one
   * out of what stands beside it. Null where nothing beside it can give.
   * @param {number} hall @param {number} give how much may be taken
   */
  const widened = (hall, give) => {
    if (hall < EPS) return { hall: 0, took: 0 };
    if (hall >= CORRIDOR - EPS) return { hall, took: 0 };
    return give >= CORRIDOR - hall - EPS ? { hall: CORRIDOR, took: CORRIDOR - hall } : null;
  };
  const record = (/** @type {object} */ c) =>
    /** @type {any} */ ({
      deep: -1,
      capped: false,
      lane: 0,
      hold: false,
      games: Infinity,
      kept: service.wholeKept,
      ...c,
    });

  /**
   * THE COLUMN at one width: the strip down the left, the spine, the rooms one
   * over the other and each as wide as the narrowest of them may be.
   * @param {number} W @param {{rooms:any[], caps:number[]}} kit
   */
  const columnAt = (W, kit) => {
    const H = W / aspect;
    const area = W * H;
    const d = H / n;
    if (!(d > PLATE_BAND * 2)) return null;
    const spans = kit.rooms.map((need, i) => span(need, kit.caps[i], d));
    if (spans.some((s) => !s)) return null;
    const lo = Math.max(...spans.map((s) => /** @type {{lo:number}} */ (s).lo));
    const hi = Math.min(...spans.map((s) => /** @type {{hi:number}} */ (s).hi));
    if (hi < lo - EPS) return null;
    // The narrowest strip that holds the reception over the lounge.
    const cap = SERVICE_STRIP_MAX * W;
    let least = 0;
    let rest = null;
    for (let w = Math.ceil(desk.w - EPS); w <= cap + EPS && !rest; w++) {
      const got = loungeAt(w);
      if (got && got.w <= w + EPS && desk.h + got.h <= H + EPS) {
        least = Math.max(desk.w, got.w);
        rest = got;
      }
    }
    if (!rest || least > cap + EPS) return null;
    // The rooms first, as wide as they may be; then the strip, to its cap; and
    // what neither takes is a hall along the spine: one floor with it, planted
    // down both walls (`plan-margin.js`), and every door still on the one way.
    let roomW = Math.min(hi, W - CORRIDOR - least);
    if (roomW < lo - EPS) return null;
    let strip = Math.min(W - CORRIDOR - roomW, cap);
    const left = widened(W - CORRIDOR - roomW - strip, strip - least + (roomW - lo));
    if (!left) return null;
    const fromStrip = Math.min(left.took, strip - least);
    strip -= fromStrip;
    roomW -= left.took - fromStrip;
    // The column's depth between the two, each inside its own share.
    const officeMax = Math.min((OFFICE_AREA_MAX * area) / strip, H - rest.h);
    const officeMin = Math.max(desk.h, H - (LOUNGE_AREA_MAX * area) / strip);
    if (officeMin > officeMax + EPS) return null;
    const officeH = Math.min(officeMax, Math.max(officeMin, H / 2));
    const x = W - roomW;
    return record({
      family: 'column',
      officeRow: true,
      rows: n,
      W,
      H,
      depths: Array(n).fill(d),
      under: Array(n - 1).fill(false),
      tops: Array.from({ length: n }, (_, k) => k * d),
      grid: {
        cells: kit.rooms.map((_, i) => ({ x, y: i * d, w: roomW, h: d })),
        taken: Array(n).fill(roomW),
        flatten: 0,
      },
      office: { x: 0, y: 0, w: strip, h: officeH },
      lounge: { x: 0, y: officeH, w: strip, h: H - officeH },
      spine: CORRIDOR + left.hall,
      halls: [],
    });
  };

  /** Whether the rooms of one floor have what is theirs (`roomsHold`). */
  const holds = (/** @type {any} */ c, /** @type {number[]} */ caps) => {
    const area = c.W * c.H;
    const { rooms, halls } = sharesOf(c);
    return roomsHold({
      rooms: n,
      ceilingReach: (rooms * area) / caps.reduce((a, v) => a + v, 0),
      shares: {
        rooms,
        office: (c.office.w * c.office.h) / area,
        lounge: (c.lounge.w * c.lounge.h) / area,
        halls,
      },
    });
  };

  // ---- every floor between the narrowest building and the nominal one.
  /** @type {{c:any, kit:{rank:number, rooms:any[], caps:number[]}, short:number}[]} */
  const found = [];
  const limit = Math.max(floor.nominal, floor.least * 1.5);
  for (let W = floor.least; W <= limit + EPS; W *= WIDTH_STEP) {
    for (const kit of floors) {
      const c = columnAt(W, kit);
      if (c && holds(c, kit.caps)) found.push({ c, kit, short: shortOf(c, widest) });
    }
  }
  // The nearest the rules; then the smaller step up for a lone room; then the
  // building with the least in it that is not a room — its width, by the part
  // of it the rooms do not have, a hall counted twice. The smaller building is
  // the one drawn larger, and a fuller one is worth a little of that.
  const tier = (/** @type {number} */ short) => Math.round(short / SHORT_TIE);
  const spent = (/** @type {any} */ c) => {
    const { rooms, halls } = sharesOf(c);
    return c.W * (1 - rooms + halls);
  };
  found.sort(
    (a, b) => tier(a.short) - tier(b.short) || a.kit.rank - b.kit.rank || spent(a.c) - spent(b.c),
  );
  for (const { c, kit, short } of found.slice(0, BUILD_TRIES)) {
    const built = buildCandidate(c, {
      needs: kit.rooms,
      caps: kit.caps,
      waitingCount,
      benchedCount,
      goneHomeCount,
      contentsW: 0,
      nominal: floor.nominal,
      ceilings: true,
      quiet: true,
      graded: true,
    });
    if (!built) continue;
    return {
      built,
      short,
      sure: widest > 0 && short < SHORT_SURE,
      // AND WHERE THE GRID IS ASKED, NEVER A LARGER BUILDING THAN ITS. A lone room beside a lounge
      // of thirteen is a strip so deep that the building grows to hold it, and
      // everybody in it is drawn smaller for the sake of the plan.
      beats: (rival) =>
        !rival || (c.W <= rival.W + EPS && tier(short) <= tier(shortOf(rival, widest))),
    };
  }
  return null;
}
