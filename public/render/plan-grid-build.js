/**
 * A CHOSEN FLOOR, BUILT: every room of one candidate into its rectangle.
 *
 * `plan-grid.js` searches for the building. This is what turns the one it
 * chose into rooms — the reception and the lounge into theirs, each project's
 * desks into its cell, the corridors, the lane and the halls between them —
 * in `layClassic`'s own shape, so `buildPlan` places either the same way.
 *
 * Moved here whole from `plan-grid.js`, which was at the line ceiling.
 *
 * Pure geometry. No DOM, no clock, no randomness.
 */

import { corridorRoom } from './plan-nav.js';
import { buildOffice, buildOfficeRow } from './plan-office.js';
import { buildPinnedRoom, buildProjectRoom } from './plan-rooms.js';
import { buildLounge } from './plan-service.js';
import { CORRIDOR, PLATE_BAND, ROOM_ASPECT_MAX, ROOM_PAD } from './plan-units.js';

/** @typedef {import('./plan-units.js').Room} Room */
/** @typedef {import('./plan-units.js').Seat} Seat */
/** @typedef {{project: any, pinned: boolean, desks: number, crew: any, module?: 'S'|'M'|'L'}} Need */

/** The shapes a room's desks are tried at, widest first. */
export const DESK_ASPECTS = Object.freeze([4, ROOM_ASPECT_MAX, 1, 0.5]);

/**
 * Build one room into its cell, at the first desk shape that fits it.
 * @param {Need} need @param {{w:number,h:number}} cell
 */
function roomInto(need, cell) {
  const inner =
    Math.max(1, cell.w - ROOM_PAD * 2) / Math.max(1, cell.h - ROOM_PAD * 2 - PLATE_BAND);
  for (const aspect of [inner, ...DESK_ASPECTS]) {
    const built = buildProjectRoom(need.project, need.desks, aspect, cell, need.crew);
    if (built.room.w <= cell.w + 0.01 && built.room.h <= cell.h + 0.01) return built;
  }
  return null;
}

/**
 * Every room of one candidate, built and placed; null if one did not fit.
 * @param {any} c the candidate `plan-grid.js` chose
 * @param {{needs: Need[], caps: number[], waitingCount: number, benchedCount: number,
 *   goneHomeCount: number, contentsW: number, nominal: number}} floor what it is laid for
 */
export function buildCandidate(c, floor) {
  const { needs, caps, waitingCount, benchedCount, goneHomeCount } = floor;
  const held = { hold: c.hold };
  const office =
    c.family === 'column'
      ? buildOffice(waitingCount, c.office, { maxW: c.office.w, ...held })
      : buildOfficeRow(waitingCount, { w: c.office.w, h: c.office.h }, held);
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
      Object.assign(room, rect, { areaMax: caps[i] });
      stripRooms.push(room);
      continue;
    }
    const built = roomInto(need, rect);
    if (!built) return null;
    Object.assign(built.room, rect, { module: need.module, areaMax: caps[i] });
    projectRooms.push({ room: built.room, seats: built.seats });
  }

  // The corridors. In bands the first is the spine and every one of them is
  // the building's width; in a column the spine is the building's height.
  /** @type {Room[]} */
  const corridors = [];
  const across = c.family === 'column' ? c.office.w + CORRIDOR : 0;
  if (c.family === 'column') {
    corridors.push(corridorRoom({ id: '__spine__', x: c.office.w, y: 0, w: CORRIDOR, h: c.H }));
  }
  /** @type {number[]} rows with a corridor under them */
  const served = [];
  c.under.forEach((has, k) => {
    if (!has) return;
    const spine = c.family !== 'column' && !served.length;
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
      contentsW: floor.contentsW,
      nominalW: floor.nominal,
    },
  };
}
