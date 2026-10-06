/**
 * A ROOM IS FURNISHED INTO THE FLOOR IT WAS GIVEN.
 *
 * The floor's rulebook (`plan-proportions.js`) makes the rooms the majority of
 * the building, so a room is much larger than its one desk — and what it did
 * with the rest was nothing. A project room came out as a hall: a desk on a
 * rug, two tub chairs, two plants, and carpet.
 *
 * `buildProjectRoom` still lays the desks, and still bids for exactly what the
 * desks need. This runs afterwards, once the room has its final rectangle, its
 * furniture has real coordinates and its door is known, and furnishes what is
 * left by two things:
 *
 *   - **the room's module** sets the kit it is owed (`ROOM_KITS`): a team's
 *     room has a meeting table and a credenza, a big team's a larger table, a
 *     shelving wall and planting;
 *   - **its actual clear floor** sets how far past the kit it goes: pieces are
 *     added, quietest first, while more than `BARE_FLOOR_MAX` of the floor is
 *     bare (`bareFloorShare`). A room laid at the size of its desks gets
 *     nothing, and a one-desk room laid as a hall is furnished as one.
 *
 * HOW IT IS COMPOSED. The desks are the work zone, on the plate's side of the
 * room. Free-standing groups stand in rows on the far side of it, a lane apart
 * (`ROOM_LANE`), the meeting table first; storage hugs the side walls; planting
 * stays in the corners it already had. Nothing stands in the plate band, in
 * front of the door, where a junior stands behind a desk, or on a crew's floor
 * — a crew is the room's second place, so a room with one has no meeting table.
 *
 * NOBODY SITS HERE. A meeting chair is furniture: the plan lays no seat on it,
 * so the floor never draws anybody in one.
 *
 * Nothing is random: every choice is a function of the room's own rectangle.
 * Pure data and pure functions. No DOM, no canvas.
 */

import { CHAIR, CHAIR_GAP, DOOR_WIDTH, SEAT_PITCH } from './plan-units.js';
import { SEAT_ARMCHAIR, SHELF_MAX_H, WHITEBOARD_W } from './plan-furniture.js';
import {
  BOOKCASE_W,
  CHAR_CLEAR_U,
  PLANTER_W,
  PLANT_RUN_KINDS,
  SILHOUETTE_SPACING,
} from './plan-props.js';
import { moduleFor } from './plan-proportions.js';
import { registerBodyScale, scaleAll } from './plan-scale.js';

/** @typedef {import('./plan-units.js').Prop} Prop */
/** @typedef {import('./plan-units.js').Room} Room */
/** @typedef {import('./plan-units.js').Seat} Seat */
/** @typedef {{x:number, y:number, w:number, h:number}} Rect */

// ----------------------------------------------------------------- the rule

/**
 * At most this much of a room's floor is bare. Bare is floor farther than one
 * lane from every piece of furniture, rug and fixture in the room: floor
 * nobody has a reason to be standing on.
 */
export const BARE_FLOOR_MAX = 0.45;

/**
 * A HALL: more floor than this, which is a building one or two projects share
 * between them. It is given everything on the list and the list runs out before
 * the floor does, so the rule above is not promised of it.
 */
export const HALL_FLOOR_U2 = 2400;

/** The grid the bare floor is counted on, in units. */
export const BARE_FLOOR_CELL = 0.5;

/**
 * THE KIT EACH MODULE IS OWED, beyond the desks, the break-out pair and the
 * corner planting every room already has. Laid in this order, each piece only
 * where it fits.
 *
 * `meeting` is the seat counts tried, largest first. A team's room that cannot
 * hold its table gets a second seating group in its place.
 */
export const ROOM_KITS = Object.freeze({
  S: Object.freeze({ meeting: Object.freeze([]), pieces: Object.freeze([]) }),
  M: Object.freeze({
    meeting: Object.freeze([4]),
    pieces: Object.freeze(['credenza', 'meeting']),
  }),
  L: Object.freeze({
    meeting: Object.freeze([8, 6]),
    pieces: Object.freeze(['credenza', 'meeting', 'shelving', 'troughs']),
  }),
});

/**
 * What a room is given past its kit while its floor is still too bare, in the
 * order it is tried: storage against a wall before anything in the open, a
 * table before a sofa, and a second of either only after one of each. A number
 * is how many of that group the room has once the step is done.
 */
export const ROOM_EXTRAS = Object.freeze([
  'credenza',
  'meeting:1',
  'shelving',
  'seating:1',
  'troughs',
  'south',
  'meeting:2',
  'seating:2',
  'south',
  'meeting:3',
  'seating:3',
]);

/** The most runs of storage a room's foot wall carries. */
export const FOOT_RUNS_MAX = 2;

// ----------------------------------------------------------------- the sizes

/** The clear lane between two zones, and how far from furniture floor stops being bare. */
export let ROOM_LANE = 2.2;
/** Clear floor behind the desks' rug: where a junior stands behind its senior. */
export let WORK_BACK = 2.7;
/** A meeting table's depth, and how far it runs past its end chairs. */
export let MEETING_DEPTH = 3.0;
export let MEETING_END = 0.5;
/** A credenza: waist-high storage, 1.4 U deep, along a wall. */
export let CREDENZA_DEPTH = 1.4;
export let CREDENZA_MIN_RUN = 4;
export let CREDENZA_MAX_RUN = 10.4;
/** The longest a shelving wall runs. Its depth is the bookcase's. */
export let SHELVING_MAX_RUN = 14;
/** A standing whiteboard: a board on feet, at the head of a meeting table. */
export let BOARD_STAND_RUN = 4.4;
export let BOARD_STAND_DEPTH = 0.6;
export let BOARD_STAND_GAP = 1.2;
/** The second seating group: a three-seat sofa, a low table, two armchairs. */
export let SEATING_SOFA_RUN = 7.8;
export let SEATING_SOFA_DEPTH = 2.6;
export let SEATING_TABLE_W = 4.4;
export let SEATING_TABLE_D = 2.2;
export let SEATING_GAP = 0.9;
/** A planter trough beside a corner plant: together, a plant group. */
export let TROUGH_RUN = 5.2;
/** How far a wall piece stands off its wall, and a free-standing group off any wall. */
export let WALL_INSET = 0.3;
export let ZONE_SIDE = 4.0;
/** And off the foot wall, where the corner planting is deeper than a shelf. */
export let ZONE_FOOT = 4.6;
/** Clear wall left between two things that stand against it. */
export let WALL_GAP = 0.8;

/** The clear floor inside a door: its width past the leaf, and its depth. */
export const DOOR_CLEAR_W = DOOR_WIDTH + 1.5;
export const DOOR_CLEAR_DEPTH = 4.4;

/** A meeting table for `seats`, chairs and all: `w` along the table. */
export function meetingFootprint(seats) {
  const perSide = Math.max(1, Math.ceil(seats / 2));
  return {
    w: perSide * SEAT_PITCH + MEETING_END * 2,
    h: MEETING_DEPTH + (CHAIR + CHAIR_GAP) * 2,
  };
}

/** The seating group: the sofa's run wide, and sofa, table and chairs deep. */
export function seatingFootprint() {
  return {
    w: SEATING_SOFA_RUN,
    h: SEATING_SOFA_DEPTH + SEATING_TABLE_D + SEAT_ARMCHAIR + SEATING_GAP * 2,
  };
}

// --------------------------------------------------------------- the measure

/** @param {Rect} a @param {Rect} b @param {number} [pad] */
function hits(a, b, pad = 0) {
  return (
    a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y
  );
}

/** The room less the strip its plate is written in. @param {Room} room @returns {Rect} */
function interiorOf(room) {
  const band = room.plateBand ?? 0;
  return { x: room.x, y: room.y + band, w: room.w, h: Math.max(0, room.h - band) };
}

/**
 * The floor of one room as a half-unit grid, each cell marked once something
 * stands within a lane of it.
 * @param {Rect} at the room's interior
 * @param {Uint8Array|null} [from] another grid of the same floor, to start from
 */
function floorGrid(at, from = null) {
  const cell = BARE_FLOOR_CELL;
  // A cell is counted where its centre is on the floor, so a last row that is
  // mostly wall is not a row of bare floor.
  const cols = Math.max(0, Math.ceil(at.w / cell - 0.5 - 1e-9));
  const rows = Math.max(0, Math.ceil(at.h / cell - 0.5 - 1e-9));
  const cells = from ? Uint8Array.from(from) : new Uint8Array(cols * rows);
  return {
    cells,
    /** @param {Rect} p */
    mark(p) {
      const reach = ROOM_LANE;
      // A cell is counted at its centre.
      const c0 = Math.max(0, Math.ceil((p.x - reach - at.x) / cell - 0.5 - 1e-9));
      const c1 = Math.min(cols - 1, Math.floor((p.x + p.w + reach - at.x) / cell - 0.5 + 1e-9));
      const r0 = Math.max(0, Math.ceil((p.y - reach - at.y) / cell - 0.5 - 1e-9));
      const r1 = Math.min(rows - 1, Math.floor((p.y + p.h + reach - at.y) / cell - 0.5 + 1e-9));
      for (let r = r0; r <= r1; r++) cells.fill(1, r * cols + c0, r * cols + c1 + 1);
    },
    bare() {
      let n = 0;
      for (let i = 0; i < cells.length; i++) n += cells[i] ? 0 : 1;
      return cells.length ? n / cells.length : 0;
    },
  };
}

/**
 * HOW MUCH OF A ROOM'S FLOOR IS BARE: the share of its interior, under the
 * plate band, that is farther than `ROOM_LANE` from every prop in it.
 *
 * Counted on a half-unit grid, so it is the same number on every machine. A
 * rug counts: it is what says a patch of floor belongs to a group.
 *
 * @param {Room} room with its props at their final coordinates
 * @returns {number} 0..1
 */
export function bareFloorShare(room) {
  const grid = floorGrid(interiorOf(room));
  for (const p of room.props || []) grid.mark(p);
  // A crew's floor is not bare: it is where the crew sits.
  const crew = crewFloorOf(room);
  if (crew) grid.mark(crew);
  return grid.bare();
}

/**
 * The work zone: the desks, their chairs and the rug under them.
 * @param {Room} room @returns {Rect|null}
 */
export function workZoneOf(room) {
  const desks = (room.zones || []).find((z) => z.id === 'desk-group');
  if (!desks) return null;
  const rug = (room.props || []).find((p) => p.kind === 'rug') || desks;
  const x = Math.min(desks.x, rug.x);
  const y = Math.min(desks.y, rug.y);
  return {
    x,
    y,
    w: Math.max(desks.x + desks.w, rug.x + rug.w) - x,
    h: Math.max(desks.y + desks.h, rug.y + rug.h) - y,
  };
}

/**
 * The floor a room's crew sits on: behind its senior's chair, on the plate's
 * side of desks that `buildProjectRoom` stood at the foot of the room for it.
 * As wide as the formation or the desks, whichever is wider, because any desk
 * in the room may be the senior's.
 * @param {Room} room @returns {Rect|null}
 */
export function crewFloorOf(room) {
  const work = workZoneOf(room);
  if (!work || !room.crew || !(room.crew.h > 0)) return null;
  const w = Math.max(room.crew.w, work.w);
  return { x: work.x + work.w / 2 - w / 2, y: work.y - room.crew.h, w, h: room.crew.h };
}

// ------------------------------------------------------------- the furnishing

/**
 * One free-standing group, as the props it is made of, at an offset from its
 * own top-left. `turned` lays it with its long side down the room.
 * @param {string} kind @param {number} seats @param {boolean} turned
 * @param {'N'|'S'|'E'|'W'} back the wall a sofa has its back to
 * @param {boolean} board a meeting table with a standing whiteboard at its head
 * @returns {{w:number, h:number, parts:any[]}}
 */
function groupOf(kind, seats, turned, back, board) {
  /** @type {any[]} */
  const parts = [];
  /** Lay a part: its box is `along` the group's long side and `across` it. */
  const part = (p, along, across, len, dep) =>
    parts.push({
      ...p,
      x: turned ? across : along,
      y: turned ? along : across,
      w: turned ? dep : len,
      h: turned ? len : dep,
    });
  if (kind === 'meeting') {
    const table = meetingFootprint(seats);
    const lead = board ? BOARD_STAND_DEPTH + BOARD_STAND_GAP : 0;
    if (board) {
      part(
        { kind: 'board_stand', angle: 0, tall: true },
        0,
        (table.h - BOARD_STAND_RUN) / 2,
        BOARD_STAND_DEPTH,
        BOARD_STAND_RUN,
      );
    }
    part({ kind: 'meeting_table', angle: 0, seats, turned }, lead, 0, table.w, table.h);
    return turned
      ? { w: table.h, h: table.w + lead, parts }
      : { w: table.w + lead, h: table.h, parts };
  }
  // The seating group. Along it is the sofa's run; across it, from the sofa's
  // side: the sofa, the low table, the two armchairs facing the sofa.
  const size = seatingFootprint();
  const far = back === 'S' || back === 'E';
  /** A depth measured from the sofa's side, as an offset from the group's top-left. */
  const from = (at, dep) => (far ? size.h - at - dep : at);
  const faces = { N: Math.PI / 2, S: -Math.PI / 2, W: 0, E: Math.PI }[back];
  part({ kind: 'sofa', angle: faces }, 0, from(0, SEATING_SOFA_DEPTH), size.w, SEATING_SOFA_DEPTH);
  const tableAt = SEATING_SOFA_DEPTH + SEATING_GAP;
  part(
    { kind: 'coffee_table', angle: 0 },
    (size.w - SEATING_TABLE_W) / 2,
    from(tableAt, SEATING_TABLE_D),
    SEATING_TABLE_W,
    SEATING_TABLE_D,
  );
  const chairAt = tableAt + SEATING_TABLE_D + SEATING_GAP;
  for (const along of [0.6, size.w - 0.6 - SEAT_ARMCHAIR]) {
    part(
      { kind: 'armchair', angle: faces + Math.PI },
      along,
      from(chairAt, SEAT_ARMCHAIR),
      SEAT_ARMCHAIR,
      SEAT_ARMCHAIR,
    );
  }
  return turned ? { w: size.h, h: size.w, parts } : { w: size.w, h: size.h, parts };
}

/**
 * Lay a band's rows: the rows spread down it, the groups of a row spread along
 * it and never nearer each other than a lane.
 * @param {{rect:Rect, rows:any[][]}} band
 */
function layBand(band) {
  const { rect, rows } = band;
  const deep = rows.reduce((a, row) => a + Math.max(...row.map((g) => g.h)), 0);
  const evenY = Math.max(0, rect.h - deep) / (rows.length + 1);
  const gapY = rows.length > 1 ? Math.max(ROOM_LANE, evenY) : evenY;
  let y = rect.y + (rect.h - deep - gapY * (rows.length - 1)) / 2;
  for (const row of rows) {
    row.sort((a, b) => a.rank - b.rank);
    const rowH = Math.max(...row.map((g) => g.h));
    const wide = row.reduce((a, g) => a + g.w, 0);
    const even = (rect.w - wide) / (row.length + 1);
    const gapX = row.length > 1 ? Math.max(ROOM_LANE, even) : even;
    let x = rect.x + (rect.w - wide - gapX * (row.length - 1)) / 2;
    for (const g of row) {
      g.x = x;
      g.y = y + (rowH - g.h) / 2;
      x += g.w + gapX;
    }
    y += rowH + gapY;
  }
}

/** Would this group still fit the band, in a row it has or in a new one? */
function rowFor(band, g) {
  const { rect, rows } = band;
  if (g.w > rect.w + 1e-9 || g.h > rect.h + 1e-9) return -1;
  const depths = rows.map((row) => Math.max(...row.map((m) => m.h)));
  const lanes = (n) => Math.max(0, n - 1) * ROOM_LANE;
  for (const [i, row] of rows.entries()) {
    const wide = row.reduce((a, m) => a + m.w, 0) + g.w + lanes(row.length + 1);
    const deep = depths.reduce((a, d, k) => a + (k === i ? Math.max(d, g.h) : d), 0);
    if (wide <= rect.w + 1e-9 && deep + lanes(rows.length) <= rect.h + 1e-9) return i;
  }
  const deep = depths.reduce((a, d) => a + d, 0) + g.h + lanes(rows.length + 1);
  return deep <= rect.h + 1e-9 ? rows.length : -1;
}

/**
 * FURNISH ONE PROJECT ROOM, in place: props and the zones they stand in are
 * added to it, and its break-out pair may be moved along its row.
 *
 * @param {Room} room placed, anchors resolved, `door` set
 * @param {ReadonlyArray<Seat>} [seats] the room's desk seats, placed
 * @returns {{kit:string, bare:number, added:string[]}} what it did, for a test
 */
export function furnishRoom(room, seats = []) {
  const none = { kit: '', bare: 0, added: [] };
  if (!room || room.kind !== 'project' || room.pinned === true) return none;
  const desks = (room.zones || []).find((z) => z.id === 'desk-group');
  if (!desks) return none;
  const module = room.module || moduleFor({ desks: seats.length, crew: 0 });
  const kit = ROOM_KITS[module] || ROOM_KITS.S;
  const at = interiorOf(room);
  const right = at.x + at.w;
  const bottom = at.y + at.h;

  // ---- what is already here, and what may not be stood on.
  const work = workZoneOf(room);
  const breakout = (room.zones || []).find((z) => z.id === 'breakout');
  const crew = crewFloorOf(room);
  const block = crew ? { x: crew.x, y: crew.y, w: crew.w, h: crew.h + work.h } : work;
  /** @type {Rect} the work zone, the crew's floor, and the clear floor round both */
  const keep = {
    x: block.x - ROOM_LANE,
    y: block.y - (crew ? ROOM_LANE : WORK_BACK),
    w: block.w + ROOM_LANE * 2,
    h: block.h + WORK_BACK + (crew ? ROOM_LANE : WORK_BACK),
  };
  const door = room.door || null;
  const near = (a, b) => Math.abs(a - b) < 0.01;
  const doorSide = !door
    ? ''
    : near(door.y, room.y + room.h)
      ? 'S'
      : near(door.x, room.x)
        ? 'W'
        : near(door.x, room.x + room.w)
          ? 'E'
          : 'N';
  /** @type {Rect|null} the floor inside the door */
  const doorBox = !door
    ? null
    : doorSide === 'S' || doorSide === 'N'
      ? {
          x: door.x - DOOR_CLEAR_W / 2,
          y: doorSide === 'S' ? bottom - DOOR_CLEAR_DEPTH : at.y,
          w: DOOR_CLEAR_W,
          h: DOOR_CLEAR_DEPTH,
        }
      : {
          x: doorSide === 'W' ? at.x : right - DOOR_CLEAR_DEPTH,
          y: door.y - DOOR_CLEAR_W / 2,
          w: DOOR_CLEAR_DEPTH,
          h: DOOR_CLEAR_W,
        };

  // ---- the bands free-standing groups stand in: the far side of the desks
  // first, then the floor either side of them.
  const side = (wall) => Math.max(ZONE_SIDE, doorSide === wall ? DOOR_CLEAR_DEPTH + 0.4 : 0);
  const left = at.x + side('W');
  const span = right - side('E') - left;
  const foot = bottom - Math.max(ZONE_FOOT, side('S'));
  const head = at.y + ROOM_LANE / 2;
  /** @type {{rect:Rect, rows:any[][], back:'N'|'S'|'E'|'W'}[]} */
  const bands = [];
  const band = (x, y, w, h, back) => {
    if (w > 0 && h > 0) bands.push({ rect: { x, y, w, h }, rows: [], back });
  };
  const below = keep.y + keep.h;
  band(left, below, span, foot - below, 'S');
  if (crew || !breakout) band(left, head, span, keep.y - head, 'N');
  const flankTop = bands.some((b) => b.back === 'N') ? keep.y : head;
  const flankBottom = bands.some((b) => b.back === 'S') ? below - ROOM_LANE : foot;
  const westAt = at.x + Math.max(side('W'), WALL_INSET + WHITEBOARD_W + ROOM_LANE);
  band(westAt, flankTop, keep.x - westAt, flankBottom - flankTop, 'W');
  band(keep.x + keep.w, flankTop, right - side('E') - keep.x - keep.w, flankBottom - flankTop, 'E');
  const south = bands.find((b) => b.back === 'S');
  // The break-out pair is the first group of the far band's first row, and
  // keeps its place in the order as others arrive either side. Where the band
  // is too small for it, it stays where it was laid and the band is its alone.
  /** @type {any} */
  let pair = null;
  if (breakout && south) {
    pair = {
      kind: 'breakout',
      rank: 1,
      w: breakout.w,
      h: breakout.h,
      x: breakout.x,
      y: breakout.y,
    };
    if (rowFor(south, pair) === 0) south.rows.push([pair]);
    else {
      bands.splice(bands.indexOf(south), 1);
      pair = null;
    }
  }
  const ofPair = (p) => !!pair && p.anchor.type === 'zone' && p.anchor.of === breakout.id;

  /** @type {any[]} every group placed, in the order it was */
  const groups = [];
  /** @type {Prop[]} wall pieces, at their final coordinates */
  const walls = [];
  const count = (kind) => groups.filter((g) => g.kind === kind).length;
  /** What stood here before this pass and does not move: not rugs, not the pair. */
  const fixed = room.props.filter((p) => p.kind !== 'rug' && !ofPair(p));

  /** Every rectangle the groups cover as they stand now, the pair among them. */
  const groupRects = () => {
    // The pair keeps the place it was laid in until a group joins its row.
    const joined = !!pair && groups.some((g) => g.band === south);
    if (pair && !joined) Object.assign(pair, { x: breakout.x, y: breakout.y });
    for (const b of bands) if (b.rows.length && (b !== south || !pair || joined)) layBand(b);
    /** @type {(Rect & {moved?: boolean})[]} */
    const out = [];
    for (const g of groups) {
      for (const p of g.parts) out.push({ x: g.x + p.x, y: g.y + p.y, w: p.w, h: p.h });
    }
    // Last, and marked: it was here first.
    if (pair) out.push({ x: pair.x, y: pair.y, w: pair.w, h: pair.h, moved: joined });
    return out;
  };
  const base = floorGrid(at);
  for (const p of room.props) if (!ofPair(p)) base.mark(p);
  if (crew) base.mark(crew);
  const bare = () => {
    const grid = floorGrid(at, base.cells);
    for (const p of walls) grid.mark(p);
    for (const r of groupRects()) grid.mark(r);
    return grid.bare();
  };
  /** Is every group clear of what was here first, of the walls' pieces and of the door? */
  const clear = () => {
    // The pair is asked only once it has been moved: where it was first laid
    // is `buildProjectRoom`'s answer and is not this pass's to refuse.
    const rects = groupRects().filter((r) => r.moved !== false);
    const solid = [...fixed, ...walls, ...(doorBox ? [doorBox] : [])];
    return !rects.some((r) => solid.some((p) => hits(r, p, CHAR_CLEAR_U)));
  };

  /** Stand a free-standing group in the first band, and the first way round, it fits. */
  const stand = (kind, seatCounts) => {
    // A row that is already there, or a band's first, before a second row
    // anywhere: the floor beside the desks is used before two rows stack.
    for (const stacking of [false, true]) {
      for (const b of bands) {
        if (standIn(b, kind, seatCounts, stacking)) return true;
      }
    }
    return false;
  };
  /** @param {any} b @param {string} kind @param {number[]} seatCounts @param {boolean} stacking */
  const standIn = (b, kind, seatCounts, stacking) => {
    const sideways = b.back === 'W' || b.back === 'E';
    for (const seatsN of seatCounts) {
      for (const turned of sideways ? [true, false] : [false, true]) {
        // A sofa has its back to the wall its band is against; turned the
        // other way it backs on to the nearer side wall.
        const back = turned === sideways ? b.back : sideways ? 'S' : 'W';
        const board = kind === 'meeting' && seatsN >= 6;
        const made = groupOf(kind, seatsN, turned, back, board);
        const g = {
          kind,
          seats: seatsN,
          // A table, the pair, a sofa, a table: never two alike side by side.
          rank: kind === 'meeting' ? count(kind) * 4 : 2 + count(kind) * 4,
          band: b,
          ...made,
        };
        const row = rowFor(b, g);
        if (row < 0) continue;
        const fresh = row === b.rows.length;
        if (fresh && b.rows.length > 0 && !stacking) continue;
        if (fresh) b.rows.push([g]);
        else b.rows[row].push(g);
        groups.push(g);
        // Never two alike side by side: three sofa groups in a line are a
        // showroom, and the same three round a room are three places.
        const line = [...b.rows[row]].sort((p, q) => p.rank - q.rank);
        const alike = line.some((m, i) => i > 0 && m.kind === line[i - 1].kind);
        if (!alike && clear()) return true;
        // It lands on something: take it back out and try the next way.
        groups.pop();
        if (fresh) b.rows.pop();
        else b.rows[row].splice(b.rows[row].indexOf(g), 1);
      }
    }
    return false;
  };

  /**
   * Stand a run against a wall: in the longest clear stretch of it, centred,
   * as long as that allows up to `max`.
   * @param {'W'|'E'|'S'} wall @param {string} kind @param {number} depth
   * @param {number} min @param {number} max
   */
  const run = (wall, kind, depth, min, max) => {
    const upright = wall !== 'S';
    const lo = upright ? at.y + WALL_GAP : at.x + WALL_GAP;
    const hi = upright ? bottom - WALL_GAP : right - WALL_GAP;
    /** @type {Rect} the strip of floor the piece would stand in, wall to wall */
    const strip = upright
      ? {
          x: wall === 'W' ? at.x + WALL_INSET : right - WALL_INSET - depth,
          y: lo,
          w: depth,
          h: hi - lo,
        }
      : { x: lo, y: bottom - WALL_INSET - depth, w: hi - lo, h: depth };
    const taken = [...fixed, ...walls, ...groupRects(), ...(doorBox ? [doorBox] : [])];
    /** @type {number[][]} the stretches of this wall something already stands on */
    const blocked = taken
      .filter((p) => hits(p, strip, WALL_GAP / 2))
      .map((p) =>
        upright ? [p.y - WALL_GAP, p.y + p.h + WALL_GAP] : [p.x - WALL_GAP, p.x + p.w + WALL_GAP],
      )
      .sort((a, b) => a[0] - b[0]);
    let best = [0, 0];
    let cursor = lo;
    for (const [from, to] of [...blocked, [hi, hi]]) {
      if (from - cursor > best[1] - best[0]) best = [cursor, from];
      cursor = Math.max(cursor, to);
    }
    const len = Math.min(max, best[1] - best[0]);
    if (len < min - 1e-9) return false;
    const from = (best[0] + best[1] - len) / 2;
    /** @type {Rect} */
    const rect = upright
      ? { x: strip.x, y: from, w: depth, h: len }
      : { x: from, y: strip.y, w: len, h: depth };
    // Storage is used from a lane in front of it, and never from a crew's floor.
    if (hits(rect, work, ROOM_LANE) || (crew && hits(rect, keep))) return false;
    if (groupRects().some((g) => hits(rect, g, ROOM_LANE))) return false;
    // A shelving wall is bays of one bookcase, end to end.
    const bays = kind === 'bookshelf' ? Math.max(1, Math.ceil(len / SHELF_MAX_H - 1e-9)) : 1;
    for (let i = 0; i < bays; i++) {
      const part = upright
        ? { x: rect.x, y: rect.y + (len / bays) * i, w: depth, h: len / bays }
        : { x: rect.x + (len / bays) * i, y: rect.y, w: len / bays, h: depth };
      walls.push({
        kind,
        ...part,
        angle: 0,
        anchor: {
          type: 'wall',
          side: wall,
          along: upright ? part.y - at.y : part.x - at.x,
          inset: WALL_INSET,
        },
      });
    }
    return true;
  };

  /**
   * A trough beside a corner plant, along the wall the plant stands off: with
   * it, a plant group. The south-west plant's runs east along the foot wall,
   * the north-east one's west under the plate band.
   * @param {Prop} plant
   */
  const trough = (plant) => {
    const west = plant.x + plant.w / 2 < at.x + at.w / 2;
    for (const len of [TROUGH_RUN, TROUGH_RUN * 0.6]) {
      /** @type {Rect} */
      const rect = west
        ? {
            x: plant.x + plant.w + WALL_GAP,
            y: plant.y + plant.h - PLANTER_W,
            w: len,
            h: PLANTER_W,
          }
        : { x: plant.x - WALL_GAP - len, y: plant.y, w: len, h: PLANTER_W };
      if (rect.x < at.x + WALL_GAP || rect.x + rect.w > right - WALL_GAP) continue;
      const solid = [...fixed.filter((p) => p !== plant), ...walls, ...(doorBox ? [doorBox] : [])];
      if (solid.some((p) => hits(rect, p, WALL_GAP / 2))) continue;
      if (hits(rect, work, CHAR_CLEAR_U) || (crew && hits(rect, keep))) continue;
      if (groupRects().some((g) => hits(rect, g, CHAR_CLEAR_U))) continue;
      if (
        seats.some((s) =>
          hits(rect, { x: s.x - 0.5, y: s.y - 0.5, w: 1, h: 1 }, CHAR_CLEAR_U + 0.3),
        )
      )
        continue;
      // Two troughs within sight of each other are one silhouette twice.
      const twin = [...fixed, ...walls].some(
        (p) => p.kind === 'planter' && hits(rect, p, SILHOUETTE_SPACING),
      );
      if (twin) continue;
      walls.push({
        kind: 'planter',
        ...rect,
        angle: 0,
        anchor: west
          ? { type: 'wall', side: 'S', along: rect.x - at.x, inset: bottom - rect.y - rect.h }
          : { type: 'wall', side: 'N', along: rect.x - at.x, inset: rect.y - at.y },
      });
      return true;
    }
    return false;
  };

  let troughs = false;
  /** One piece, by name. @param {string} step @returns {boolean} whether anything was added */
  const add = (step) => {
    const [piece, upTo] = step.split(':');
    if (upTo && count(piece) >= Number(upTo)) return false;
    if (piece === 'credenza') {
      return (
        !walls.some((p) => p.kind === 'credenza' && p.h > p.w) &&
        run('W', 'credenza', CREDENZA_DEPTH, CREDENZA_MIN_RUN, CREDENZA_MAX_RUN)
      );
    }
    if (piece === 'shelving') {
      return (
        !walls.some((p) => p.kind === 'bookshelf') &&
        run('E', 'bookshelf', BOOKCASE_W, CREDENZA_MIN_RUN, SHELVING_MAX_RUN)
      );
    }
    if (piece === 'south') {
      return (
        walls.filter((p) => p.kind === 'credenza' && p.w > p.h).length < FOOT_RUNS_MAX &&
        run('S', 'credenza', CREDENZA_DEPTH, CREDENZA_MIN_RUN, CREDENZA_MAX_RUN)
      );
    }
    if (piece === 'troughs') {
      if (troughs) return false;
      troughs = true;
      let any = false;
      for (const plant of fixed.filter((p) => PLANT_RUN_KINDS.includes(p.kind))) {
        if (trough(plant)) any = true;
      }
      return any;
    }
    if (piece === 'meeting') {
      // A crew is this room's second place: it has no meeting table.
      if (crew) return false;
      const owed = count('meeting') === 0 && kit.meeting.length ? kit.meeting : [4];
      return stand('meeting', count('meeting') === 0 ? owed : [6, 4]);
    }
    if (piece === 'seating') return stand('seating', [0]);
    return false;
  };

  /** @type {string[]} */
  const added = [];
  for (const piece of kit.pieces) {
    if (add(piece)) added.push(piece);
    // A team's room that cannot hold its table has a second sofa instead.
    else if (piece === 'meeting' && add('seating')) added.push('seating');
  }
  for (const step of ROOM_EXTRAS) {
    if (bare() <= BARE_FLOOR_MAX) break;
    if (add(step)) added.push(step.split(':')[0]);
  }

  // ---- write it down: the break-out pair moved along its row, then every
  // group as a zone and the props anchored to it, then the wall pieces.
  groupRects();
  if (pair) {
    const dx = pair.x - breakout.x;
    const dy = pair.y - breakout.y;
    for (const p of room.props) {
      if (p.anchor.type === 'zone' && p.anchor.of === breakout.id) {
        p.x += dx;
        p.y += dy;
      }
    }
    breakout.x += dx;
    breakout.y += dy;
  }
  groups.forEach((g, i) => {
    const id = `${g.kind}-${i}`;
    room.zones.push({ id, x: g.x, y: g.y, w: g.w, h: g.h });
    for (const p of g.parts) {
      room.props.push({
        ...p,
        x: g.x + p.x,
        y: g.y + p.y,
        anchor: { type: 'zone', of: id, dx: p.x, dy: p.y },
      });
    }
  });
  room.props.push(...walls);
  return { kit: module, bare: bareFloorShare(room), added };
}

// ----------------------------------------------------- the scaling law (§2)
//
// Every length above is a piece of furniture or the clear floor round a body,
// so every one of them is a body constant and scales with the people.

const BASE = {
  ROOM_LANE,
  WORK_BACK,
  MEETING_DEPTH,
  MEETING_END,
  CREDENZA_DEPTH,
  CREDENZA_MIN_RUN,
  CREDENZA_MAX_RUN,
  SHELVING_MAX_RUN,
  BOARD_STAND_RUN,
  BOARD_STAND_DEPTH,
  BOARD_STAND_GAP,
  SEATING_SOFA_RUN,
  SEATING_SOFA_DEPTH,
  SEATING_TABLE_W,
  SEATING_TABLE_D,
  SEATING_GAP,
  TROUGH_RUN,
  WALL_INSET,
  ZONE_SIDE,
  ZONE_FOOT,
  WALL_GAP,
};

registerBodyScale((s) => {
  ({
    ROOM_LANE,
    WORK_BACK,
    MEETING_DEPTH,
    MEETING_END,
    CREDENZA_DEPTH,
    CREDENZA_MIN_RUN,
    CREDENZA_MAX_RUN,
    SHELVING_MAX_RUN,
    BOARD_STAND_RUN,
    BOARD_STAND_DEPTH,
    BOARD_STAND_GAP,
    SEATING_SOFA_RUN,
    SEATING_SOFA_DEPTH,
    SEATING_TABLE_W,
    SEATING_TABLE_D,
    SEATING_GAP,
    TROUGH_RUN,
    WALL_INSET,
    ZONE_SIDE,
    ZONE_FOOT,
    WALL_GAP,
  } = scaleAll(BASE, s));
});
