/**
 * DeckHQ floor plan generator — pure geometry, no canvas calls, so it is
 * unit-testable in plain Node. Coordinates are UNITS, not pixels.
 *
 * THE MODEL: one continuous floor, partially divided.
 *
 * The office is a single building envelope, subdivided by walls into zones
 * that TILE it exactly. Zones share their boundaries; there is no gap between
 * them and no zone floats free. That is the difference between an open-plan
 * office and a set of sheds in a field, and earlier revisions of this file
 * built the sheds: rooms were sized to their furniture and then scattered,
 * which left every room ringed by dead space.
 *
 * THE ANCHOR HIERARCHY, in order. Nothing is positioned by a bare coordinate:
 *
 *     floor
 *       walls        on zone boundaries
 *       tables       anchored in their zone
 *         chairs     anchored to their table edge
 *           agents   seated on their chair
 *         plants     anchored beside their table
 *
 * A project's furniture follows its headcount: tables come in 2, 4, 6 and 8
 * seat sizes, a project too big for one table gets several, and its zone
 * grows to hold them. Add a project and the floor re-tiles to make room.
 *
 * No DOM access anywhere — this file must import cleanly under `node --test`.
 */

/** @typedef {'working'|'needs_input'|'stalled'|'for_review'|'ended'} ActivityState */
/** @typedef {'active'|'benched'|'let_go'} AckState */

/**
 * @typedef {object} AgentLike
 * @property {AckState} [ackState]
 * @property {ActivityState} [activityState]
 */

/**
 * @typedef {object} ProjectLike
 * @property {string} [id]
 * @property {string} [projectId]
 * @property {string} [name]
 * @property {string} [projectName]
 * @property {number} [sessionCount]
 * @property {number} [tokens]
 * @property {number} [needsYou]
 * @property {boolean} [hasDashboard] the project has a runnable dashboard
 */

/**
 * How a prop's position was derived. Every prop carries one.
 * @typedef {{type:'zone', of:string, dx:number, dy:number}
 *   | {type:'wall', side:'N'|'S'|'E'|'W', along:number, inset?:number}
 *   | {type:'corner', corner:'NE'|'NW'|'SE'|'SW', inset?:number}
 *   | {type:'attached', to:string, edge:'N'|'S'|'E'|'W', along:number, gap?:number}
 *   | {type:'centered', of:string}} Anchor
 */

/**
 * A furniture instance the backdrop paints.
 *
 * `x, y` is the TOP-LEFT corner, in absolute units — the same convention as
 * `Room`, `Zone` and `Wall`, so every rectangle in the renderer means the same
 * thing. `backdrop.js` translates to the rect centre before drawing.
 *
 * @typedef {object} Prop
 * @property {string} kind
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {number} angle
 * @property {Anchor} anchor
 * @property {string} [id] required on anchor targets
 */

/**
 * A structural rectangle inside a room — a table's footprint, a sofa group, an
 * activity slice. Never painted; it exists so anchors have something real to
 * refer to.
 * @typedef {object} Zone
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

/**
 * A wall segment on a zone boundary. Walls are properties of the FLOOR, not of
 * a room: two zones either side of a partition share one wall, which is what
 * makes the plan read as one building.
 * @typedef {object} Wall
 * @property {number} x1
 * @property {number} y1
 * @property {number} x2
 * @property {number} y2
 * @property {'exterior'|'solid'|'partition'} kind
 * @property {{at:number, width:number}} [door] gap along the segment
 */

/**
 * @typedef {object} Room
 * @property {'office'|'project'|'lounge'} kind
 * @property {string} id
 * @property {string} name
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {'full'|'partial'} walls
 * @property {[string, string]} plateLines
 * @property {Prop[]} props
 * @property {Zone[]} zones
 * @property {'wood'|'carpet'|'tile'|'circulation'} floor
 * @property {{x:number,y:number,w:number,h:number}} [kitchenZone]
 */

/**
 * @typedef {object} Seat
 * @property {number} x
 * @property {number} y
 * @property {number} angle radians; the occupant faces this direction
 */

/**
 * @typedef {object} LoungeSpot
 * @property {string} id
 * @property {'pool'|'table_tennis'|'board_game'|'arcade'|'coffee'|'eat'|'chat'|'lounge_idle'} kind
 * @property {number} x
 * @property {number} y
 * @property {number} angle
 * @property {number} capacity
 * @property {string} [partnerOf]
 */

/**
 * @typedef {object} Door
 * @property {number} x
 * @property {number} y
 * @property {number} angle
 * @property {number} width
 */

/**
 * @typedef {object} Plan
 * @property {number} width
 * @property {number} height
 * @property {number} targetAspect
 * @property {Room[]} rooms tiling the envelope, sharing boundaries
 * @property {Wall[]} walls
 * @property {NavLine[]} nav corridor centrelines; the only walkable routes
 * @property {Map<string, Seat[]>} seats keyed by projectId
 * @property {Seat[]} officeSeats
 * @property {LoungeSpot[]} loungeSpots
 * @property {Door[]} doors
 */

/** Pixels per unit at scale 1. */
export const U = 14;

/** Clear floor kept between a zone's furniture and its walls. */
const MARGIN = 2.5;

/**
 * Clear strip across the top of every room, where its plate is drawn.
 *
 * The plate is live text on the floor (no card, no fill — CONTRACTS-WP15.md
 * §3), so anything under it competes with it. Reserving the strip in the PLAN
 * rather than hoping the furniture happens to miss it is the only way to be
 * sure: the room's interior simply starts below it, and every anchor —
 * including the wall anchors — measures from there.
 */
const PLATE_BAND = 3.4;

/** The building is the shape of the screen, within reason. */
const ASPECT_MIN = 1.2;
const ASPECT_MAX = 2.2;
const DEFAULT_ASPECT = 1.7;

/**
 * Width of the circulation corridors, in units.
 *
 * A central spine runs the full height of the building between the service
 * side (the user's office above the lounge) and the working floor, and a
 * corridor separates each row of project rooms from the next. Together they
 * mean an agent can leave any desk and reach the lounge or the office without
 * walking through somebody else's room.
 */
const CORRIDOR = 4;

/** Table geometry. Seats sit along the two long sides. */
const SEAT_PITCH = 2.6;
const TABLE_DEPTH = 2.6;
const CHAIR = 2;
const CHAIR_GAP = 0.15;
const TABLE_GAP = 3.2;
const TABLE_SIZES = [8, 6, 4, 2];

const PLANT_SIZE = 2;
const PLANT_GAP = 0.4;

/** Footprint of a collapsed project room, before its headcount scales it. */
const COLLAPSED_W = 12;
const COLLAPSED_H = 2.6;

/**
 * Where the shelf and the dashboard screen start down a project room's east
 * wall — clear of the in-room "+" that sits in the corner above them.
 */
const FIXTURE_TOP = 0.6;

/** How much of a project room's west wall its whiteboard takes. */
const WHITEBOARD_H = 5.2;

/** How far a corner plant sits from the two walls it stands between. */
const CORNER_PLANT_INSET = 1.2;

/** Shortest sofa run worth sitting on, in units. */
const SOFA_MIN_RUN = 5.2;

/** The reception's smallest useful interior, before the queue grows it. */
const OFFICE_MIN_H = 20;

/**
 * How much the reception grows per agent waiting in it. A queue of one gets a
 * small room; a queue of twenty gets the full reception, and past that the
 * loose chairs in the middle take over (see `buildOffice`).
 */
const OFFICE_GROWTH_W = 0.8;
const OFFICE_GROWTH_H = 0.55;

const OFFICE_MIN_W = 22;
const OFFICE_MAX_W = 38;
const OFFICE_MAX_H = 36;

/** Pitch between two people sitting on the same sofa run. */
const OFFICE_SEAT_PITCH = 2.6;

/** Grid of the reception's overflow chairs. */
const OFFICE_CHAIR_PITCH = 3.2;
const OFFICE_CHAIR_ROW = 2.8;

/**
 * How much of the column's leftover height the reception takes before the
 * lounge does. The reception is the room the user reads first and the one the
 * product is about, so it takes the larger share of the slack; the lounge is
 * where nothing is happening and gives the room up.
 */
const OFFICE_SURPLUS_SHARE = 0.55;

/**
 * Gap between two furniture groups in the lounge, and the pitch of the
 * standing-room band along its promenade.
 */
const LOUNGE_GAP = 2;
const MINGLE_PITCH = 2.4;
const MINGLE_ROW = 2.4;

/** Most games tables the lounge will ever lay out. */
const LOUNGE_MAX_GAMES = 5;

/**
 * Widest the service column may get, and the step the search walks it in.
 * Past this the office and the lounge start to dominate a floor whose subject
 * is the working rooms.
 */
const SERVICE_MAX_W = 72;
const SERVICE_W_STEP = 2;

/**
 * The working floor is two bands with ONE corridor between them, once there
 * are enough rooms to fill both. Within a band the rooms tile it exactly and
 * share their walls; there is no other circulation on that side of the plan.
 */
const WORKING_ROWS = 2;
const WORKING_ROWS_MIN_ROOMS = 3;

/**
 * The most floor one project may be worth relative to the least. Unclamped, a
 * twenty-one desk repo beside a dozen single-session ones turns the small
 * rooms into splinters, and a splinter is not a room whatever its area says.
 */
const WEIGHT_MAX_RATIO = 2.5;

/**
 * How far from square a project room may be before it stops being a room. Past
 * this the floor will give up its two-band plan rather than draw a splinter.
 */
const PROJECT_ASPECT_LIMIT = 2.4;

/**
 * Clear floor the working side keeps beyond its furniture, as a fraction. Some
 * is necessary — people walk between the desks — and the treemap spends it as
 * margin inside each room rather than as corridor between them.
 */
const WORKING_HEADROOM = 0.55;

/** Squarest the reception may be before it stops reading as a room. */
const OFFICE_ASPECT_MIN = 0.6;

/** Least of the service column the reception takes, however full the lounge. */
const OFFICE_COLUMN_MIN = 0.32;

/**
 * A room may be up to this much wider than it is tall before it stops reading
 * as a room (05-LAYOUT-REWORK.md §2.2, VISUAL-SPEC acceptance 8).
 */
const ROOM_ASPECT_MAX = 1.8;

/**
 * How far from a sofa's centre line its occupant sits, as a fraction of the
 * sofa's depth — forward of centre, clear of the back cushion.
 */
const SOFA_SEAT_BIAS = 0.15;

/** Door opening width, in units. */
const DOOR_WIDTH = 3.5;

/**
 * Angle from `from` pointing at `to`. 0 faces +x (east), PI/2 faces +y.
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 */
function angleTo(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Compact token formatting, e.g. `2200000 -> '2.2M'`.
 * @param {number} n
 */
export function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1000)}k`;
  return `${Math.round(v)}`;
}

/**
 * The table sizes a project of `n` people needs.
 *
 * One table per eight people, and the remainder gets the smallest table that
 * seats it — so a team of three sits at a four-seater rather than rattling
 * around an eight. A project that grows past eight gains a second table
 * instead of a longer one, which is what a real office does.
 *
 * @param {number} n
 * @returns {number[]} seat counts, largest first
 */
export function tableSizesFor(n) {
  const total = Math.max(0, Math.floor(n));
  if (total === 0) return [];
  /** @type {number[]} */
  const out = [];
  let left = total;
  while (left > 8) {
    out.push(8);
    left -= 8;
  }
  out.push(
    TABLE_SIZES.slice()
      .reverse()
      .find((s) => s >= left) ?? 8,
  );
  return out;
}

/** Footprint of a table seating `seats` people, seats along both long sides. */
function tableSize(seats) {
  const perSide = Math.max(1, Math.ceil(seats / 2));
  return { w: perSide * SEAT_PITCH, h: TABLE_DEPTH };
}

/** The full footprint a table needs including its chairs. */
function tableBlockSize(seats) {
  const t = tableSize(seats);
  return { w: t.w, h: t.h + 2 * (CHAIR_GAP + CHAIR) };
}

// ------------------------------------------------------------- the anchors

/**
 * Resolve every anchored prop in a room to absolute coordinates.
 *
 * Runs after zone geometry is final, so a prop's position is always derived
 * from something real: the zone it stands in, a wall, a corner, another prop,
 * or a declared sub-zone. Props resolve in declaration order, so an anchor
 * target must be declared before whatever hangs off it.
 *
 * @param {Room} room
 * @returns {Prop[]}
 */
export function resolveAnchors(room) {
  /** @type {Map<string, {x:number,y:number,w:number,h:number}>} */
  const byId = new Map();
  for (const z of room.zones || []) byId.set(z.id, z);

  // The room's INTERIOR: the room less the strip its plate is drawn in. Wall
  // and corner anchors measure from here, so a prop against the north wall
  // lands under the plate band rather than under the plate.
  const band = room.plateBand ?? 0;
  const L = room.x;
  const T = room.y + band;
  const R = room.x + room.w;
  const B = room.y + room.h;

  for (const p of room.props) {
    const a = p.anchor;
    switch (a.type) {
      case 'zone': {
        const t = byId.get(a.of);
        if (!t) break;
        p.x = t.x + a.dx;
        p.y = t.y + a.dy;
        break;
      }
      case 'wall': {
        const inset = a.inset ?? 0;
        if (a.side === 'N') {
          p.x = L + a.along;
          p.y = T + inset;
        } else if (a.side === 'S') {
          p.x = L + a.along;
          p.y = B - inset - p.h;
        } else if (a.side === 'W') {
          p.x = L + inset;
          p.y = T + a.along;
        } else {
          p.x = R - inset - p.w;
          p.y = T + a.along;
        }
        break;
      }
      case 'corner': {
        const inset = a.inset ?? 0;
        const east = a.corner === 'NE' || a.corner === 'SE';
        const south = a.corner === 'SE' || a.corner === 'SW';
        p.x = east ? R - inset - p.w : L + inset;
        p.y = south ? B - inset - p.h : T + inset;
        break;
      }
      case 'attached': {
        const t = byId.get(a.to);
        if (!t) break;
        const gap = a.gap ?? 0;
        if (a.edge === 'N') {
          p.x = t.x + a.along;
          p.y = t.y - gap - p.h;
        } else if (a.edge === 'S') {
          p.x = t.x + a.along;
          p.y = t.y + t.h + gap;
        } else if (a.edge === 'W') {
          p.x = t.x - gap - p.w;
          p.y = t.y + a.along;
        } else {
          p.x = t.x + t.w + gap;
          p.y = t.y + a.along;
        }
        break;
      }
      case 'centered': {
        const t = byId.get(a.of);
        if (!t) break;
        p.x = t.x + (t.w - p.w) / 2;
        p.y = t.y + (t.h - p.h) / 2;
        break;
      }
    }
    if (p.id) byId.set(p.id, p);
  }
  return room.props;
}

/** Shift a room's laid-out contents into place. */
function translateContents(room, dx, dy) {
  for (const z of room.zones) {
    z.x += dx;
    z.y += dy;
  }
  for (const p of room.props) {
    p.x += dx;
    p.y += dy;
  }
}

/** Bounding box of a set of rects. */
function boundsOf(items) {
  if (items.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const it of items) {
    minX = Math.min(minX, it.x);
    minY = Math.min(minY, it.y);
    maxX = Math.max(maxX, it.x + it.w);
    maxY = Math.max(maxY, it.y + it.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Flow blocks into the column count whose bounding box best matches
 * `targetAspect`, never exceeding `maxW` when any column count can respect it.
 *
 * The width budget is not optional dressing: a room is given a fixed width by
 * the packer, and a flow that ignores that produced a lounge whose games
 * tables resolved outside its own walls.
 *
 * @param {{w:number,h:number}[]} blocks
 * @param {number} gap
 * @param {number} [targetAspect]
 * @param {number} [maxW] hard width budget for the resulting bounding box
 */
function flowBlocks(blocks, gap, targetAspect = 1, maxW = Infinity) {
  let best = null;
  let fallback = null;
  for (let cols = 1; cols <= Math.max(1, blocks.length); cols++) {
    /** @type {{x:number,y:number}[]} */
    const out = [];
    let x = 0;
    let y = 0;
    let rowH = 0;
    let rowWidest = 0;
    let col = 0;
    for (const b of blocks) {
      if (col === cols) {
        x = 0;
        y += rowH + gap;
        rowH = 0;
        col = 0;
      }
      out.push({ x, y });
      x += b.w + gap;
      rowWidest = Math.max(rowWidest, x - gap);
      rowH = Math.max(rowH, b.h);
      col++;
    }
    const h = y + rowH;
    const width = rowWidest;
    // With a width budget the goal is simply to be SHORT: the room's width is
    // already decided, so every column count that fits is equally wide as far
    // as the packer is concerned, and the shortest one wastes the least floor.
    // Only an unbounded flow has a shape to aim for.
    const err = maxW === Infinity ? Math.abs(Math.log((width || 1) / (h || 1) / targetAspect)) : h;
    const candidate = { err, out, w: width, h };
    if (!fallback || width < fallback.w) fallback = candidate;
    if (width > maxW + 1e-6) continue;
    if (!best || err < best.err) best = candidate;
  }
  return best || fallback || { out: [], w: 0, h: 0 };
}

/**
 * Shelf-pack blocks of differing sizes into a width budget.
 *
 * `flowBlocks` puts a fixed number of blocks in every row, which is right for
 * a project's tables — they are all the same size — and wrong for the lounge,
 * whose blocks run from a 7 x 8 arcade to a 15 x 11 living room. A fixed column
 * count there wastes width on the narrow rows and height on the short ones:
 * measured at 44% of the lounge's own bounding box.
 *
 * A shelf pack fills each row to the budget and starts a new one, with the
 * tallest blocks first so a row's height is set once and then used. Same
 * furniture, same spacing, materially less floor.
 *
 * @param {{w:number,h:number}[]} blocks
 * @param {number} gap
 * @param {number} maxW
 * @returns {{out:{x:number,y:number}[], w:number, h:number}}
 */
export function shelfPack(blocks, gap, maxW) {
  const order = blocks.map((b, i) => ({ b, i })).sort((a, z) => z.b.h - a.b.h || z.b.w - a.b.w);
  /** @type {{x:number,y:number}[]} */
  const out = new Array(blocks.length);
  let x = 0;
  let y = 0;
  let rowH = 0;
  let widest = 0;
  for (const { b, i } of order) {
    if (x > 0 && x + b.w > maxW + 1e-6) {
      y += rowH + gap;
      x = 0;
      rowH = 0;
    }
    out[i] = { x, y };
    x += b.w + gap;
    widest = Math.max(widest, x - gap);
    rowH = Math.max(rowH, b.h);
  }
  return { out, w: widest, h: y + rowH };
}

/**
 * Tile `rect` exactly with one cell per item, areas proportional to weight and
 * every cell as close to square as the weights allow.
 *
 * The squarified treemap, Bruls/Huizing/van Wijk. `03-VISUAL-SPEC.md` §2.2 asked
 * for one and an earlier revision of this file rejected it, on the grounds that
 * a treemap "honours each item's AREA and lets the aspect fall where it may".
 * That is true of a plain slice-and-dice treemap and is exactly what the
 * squarified variant fixes: it accumulates items into a row only while doing so
 * makes the worst aspect in that row BETTER, and starts a new row the moment it
 * would make it worse.
 *
 * It is the right structure here for three reasons the shelf packer could not
 * give: the cells tile the rectangle exactly, so rooms share walls instead of
 * being separated by strips of circulation; a small project gets a small square
 * rather than a full-height splinter; and the floor can be told what size to be
 * rather than reporting what size it turned out to be.
 *
 * @param {{weight:number, i:number}[]} items
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @returns {{x:number,y:number,w:number,h:number}[]} indexed by each item's `i`
 */
export function squarify(items, rect) {
  /** @type {{x:number,y:number,w:number,h:number}[]} */
  const out = [];
  if (!items.length || rect.w <= 0 || rect.h <= 0) return out;

  const total = items.reduce((a, it) => a + Math.max(1e-6, it.weight), 0);
  const scale = (rect.w * rect.h) / total;
  const queue = items.map((it) => ({ i: it.i, area: Math.max(1e-6, it.weight) * scale }));

  let free = { ...rect };

  /** Worst aspect ratio in `row` if it were laid along a side of length `side`. */
  const worst = (row, side) => {
    if (!row.length || side <= 0) return Infinity;
    const sum = row.reduce((a, it) => a + it.area, 0);
    if (sum <= 0) return Infinity;
    let min = Infinity;
    let max = 0;
    for (const it of row) {
      if (it.area < min) min = it.area;
      if (it.area > max) max = it.area;
    }
    const s2 = sum * sum;
    const side2 = side * side;
    return Math.max((side2 * max) / s2, s2 / (side2 * min));
  };

  /** Lay `row` along the shorter side of `free` and shrink `free` by it. */
  const layoutRow = (row, last) => {
    const sum = row.reduce((a, it) => a + it.area, 0);
    // The row runs along the SHORTER side, which is what keeps cells square.
    if (free.w <= free.h) {
      const h = last ? free.h : Math.min(free.h, sum / free.w);
      let x = free.x;
      row.forEach((it, k) => {
        const w = k === row.length - 1 ? free.x + free.w - x : (it.area / sum) * free.w;
        out[it.i] = { x, y: free.y, w, h };
        x += w;
      });
      free = { x: free.x, y: free.y + h, w: free.w, h: free.h - h };
    } else {
      const w = last ? free.w : Math.min(free.w, sum / free.h);
      let y = free.y;
      row.forEach((it, k) => {
        const h = k === row.length - 1 ? free.y + free.h - y : (it.area / sum) * free.h;
        out[it.i] = { x: free.x, y, w, h };
        y += h;
      });
      free = { x: free.x + w, y: free.y, w: free.w - w, h: free.h };
    }
  };

  let row = [];
  for (let k = 0; k < queue.length; k++) {
    const it = queue[k];
    const side = Math.min(free.w, free.h);
    if (row.length === 0 || worst([...row, it], side) <= worst(row, side)) {
      row.push(it);
      continue;
    }
    layoutRow(row, false);
    row = [it];
  }
  if (row.length) layoutRow(row, true);
  return out;
}

// ------------------------------------------------------------ project zones

/**
 * Lay out one project's tables, chairs and plant in local coordinates.
 *
 * @param {ProjectLike} project
 * @param {number} sessionCount
 * @param {number} [targetAspect] shape the tables should aim to fill
 * @returns {{ room: Room, seats: Seat[], size: {w:number,h:number} }}
 */
/**
 * A collapsed project room: the repo is there, but nobody is working in it.
 *
 * A project whose agents are all benched or let go has an empty room — desks,
 * chairs, a plant and no people. On a real machine that was eleven of
 * thirteen rooms, which is a lot of floor spent on nothing. Collapsed rooms
 * keep their name, their MK tag and their click target, and cost a strip.
 *
 * Deliberately still ON the floor rather than hidden: the repo exists, and
 * being able to see it (and start an agent in it) is the point. Only an
 * explicit archive removes a room from view altogether.
 *
 * @param {ProjectLike} project
 * @param {number} sessionCount
 */
function buildCollapsedRoom(project, sessionCount) {
  const id = String(project.id ?? project.projectId ?? 'unknown');
  const name = String(project.name ?? project.projectName ?? id);
  /** @type {Room} */
  return {
    kind: 'project',
    id,
    name,
    collapsed: true,
    x: 0,
    y: 0,
    // Sized to the repo it stands for, not to a fixed strip. A project with
    // fifteen idle sessions is not the same thing as one with one, and drawing
    // both as the same 13 x 5 card made the working floor a stack of identical
    // slivers beside a reception and a lounge many times their size.
    w: COLLAPSED_W + Math.min(5, Math.sqrt(Math.max(1, sessionCount)) * 1.1),
    h: COLLAPSED_H + PLATE_BAND + Math.min(2.5, Math.sqrt(Math.max(1, sessionCount)) * 0.6),
    walls: 'partial',
    // The same carpet as an open project room, not tile: a collapsed room is
    // the SAME room with nobody in it, and giving it a different material made
    // a column of them read as a stack of blank cards rather than as part of
    // the building. `backdrop.js` dims it instead, which is what "the lights
    // are off in here" actually looks like from above.
    floor: 'carpet',
    plateLines: [name, `${sessionCount} idle`],
    props: [],
    zones: [],
    plateBand: PLATE_BAND,
    natural: { w: COLLAPSED_W, h: COLLAPSED_H },
  };
}

function buildProjectRoom(project, sessionCount, targetAspect = 1) {
  const id = String(project.id ?? project.projectId ?? 'unknown');
  const name = String(project.name ?? project.projectName ?? id);

  /** @type {Prop[]} */
  const props = [];
  /** @type {Zone[]} */
  const zones = [];
  /** @type {Seat[]} */
  const seats = [];

  const sizes = tableSizesFor(Math.max(1, sessionCount));
  const blocks = sizes.map((s) => tableBlockSize(s));
  const flow = flowBlocks(blocks, TABLE_GAP, targetAspect);

  let remaining = Math.max(1, sessionCount);
  sizes.forEach((seatCount, i) => {
    const at = flow.out[i];
    const t = tableSize(seatCount);
    const tableId = `${id}-table-${i}`;
    // The table's own footprint is a zone: chairs hang off it, the plant
    // stands beside it, and both stay attached however the floor re-tiles.
    const tx = at.x;
    const ty = at.y + CHAIR_GAP + CHAIR;
    zones.push({ id: tableId, x: tx, y: ty, w: t.w, h: t.h });

    props.push({
      kind: 'desk',
      id: tableId + '-top',
      w: t.w,
      h: t.h,
      angle: 0,
      x: tx,
      y: ty,
      anchor: { type: 'centered', of: tableId },
    });

    const perSide = Math.max(1, Math.ceil(seatCount / 2));
    for (const side of [
      { key: /** @type {'N'} */ ('N'), sign: -1 },
      { key: /** @type {'S'} */ ('S'), sign: 1 },
    ]) {
      for (let k = 0; k < perSide && remaining > 0; k++) {
        const cx = tx + (k + 0.5) * SEAT_PITCH;
        const cy = side.sign < 0 ? ty - CHAIR_GAP - CHAIR / 2 : ty + t.h + CHAIR_GAP + CHAIR / 2;
        // Square on to the table, so each occupant faces their own monitor
        // rather than converging on the table's centre point.
        const angle = angleTo({ x: cx, y: cy }, { x: cx, y: ty + t.h / 2 });
        seats.push({ x: cx, y: cy, angle });
        props.push({
          kind: 'chair',
          w: CHAIR,
          h: CHAIR,
          angle,
          x: cx - CHAIR / 2,
          y: cy - CHAIR / 2,
          anchor: {
            type: 'attached',
            to: tableId,
            edge: side.key,
            along: (k + 0.5) * SEAT_PITCH - CHAIR / 2,
            gap: CHAIR_GAP,
          },
        });
        props.push({
          kind: 'monitor',
          w: 1.6,
          h: 0.5,
          // The rect already says the screen is wide and shallow, sitting
          // across the table edge. Rotating it by the occupant's facing on
          // top of that stood it on end — the same mistake the reception
          // sofa made. `angle` is not how a prop LIES; its rect is.
          angle: 0,
          x: cx - 0.8,
          y: side.sign < 0 ? ty : ty + t.h - 0.5,
          anchor: {
            type: 'attached',
            to: tableId,
            edge: side.key,
            along: (k + 0.5) * SEAT_PITCH - 0.8,
            gap: -0.5,
          },
        });
        remaining--;
      }
    }

    // One plant per table, standing at its end where it cannot be adrift.
    if (i === 0) {
      props.push({
        kind: 'plant',
        w: PLANT_SIZE,
        h: PLANT_SIZE,
        angle: 0,
        x: tx + t.w + PLANT_GAP,
        y: ty,
        anchor: {
          type: 'attached',
          to: tableId,
          edge: 'E',
          along: (t.h - PLANT_SIZE) / 2,
          gap: PLANT_GAP,
        },
      });
    }
  });

  // The floor is a spatial launcher: a shelf opens the repo's folder, a screen
  // runs its dashboard.
  //
  // Both are ATTACHED to the first table rather than anchored to a wall.
  // A project room is the one room the tiler is allowed to stretch (it has to
  // absorb the slack in its row), so a wall anchor here would slide away from
  // the desks every time the row got wider while the desk cluster stayed put —
  // the exact two-frames defect this file exists to prevent. Attached to the
  // furniture, they travel with it at a fixed offset whatever the room does.
  const firstTable = zones[0];
  if (firstTable) {
    // Against the room's EAST wall, stacked below the in-room "+" that sits in
    // its top-right corner. Wall furniture belongs on a wall; the desks are
    // centred in the room and these are not part of that composition, so
    // nothing is lost by anchoring them to the geometry they actually touch.
    props.push({
      kind: 'shelf',
      id: 'shelf',
      w: 1.2,
      h: 3.6,
      angle: 0,
      x: firstTable.x,
      y: firstTable.y,
      anchor: { type: 'wall', side: 'E', along: FIXTURE_TOP, inset: 0.3 },
    });
    if (project.hasDashboard) {
      props.push({
        kind: 'screen',
        id: 'screen',
        w: 0.9,
        h: 2.4,
        angle: 0,
        x: firstTable.x,
        y: firstTable.y,
        anchor: { type: 'wall', side: 'E', along: FIXTURE_TOP + 3.6 + 0.8, inset: 0.3 },
      });
    }
    // The project's whiteboard, on the WEST wall facing the room. Every
    // project room has one and clicking it opens the board — the numbers a
    // team keeps written up where everyone can see them.
    props.push({
      kind: 'whiteboard',
      id: 'whiteboard',
      // Deeper than a board is thick: the rect has to contain the face the
      // painter projects into the room (see backdrop.js's `whiteboard` case).
      w: 2.4,
      h: WHITEBOARD_H,
      angle: 0,
      x: firstTable.x,
      y: firstTable.y,
      anchor: { type: 'wall', side: 'W', along: FIXTURE_TOP, inset: 0.3 },
    });
  }

  // A rug under the desk cluster, sized to it. A project room is given its
  // cell by the treemap and is usually larger than its desks need — an
  // interior with a group of desks adrift in the middle of it is unfinished,
  // and a rug is what defines the group as a group.
  const deskBlock = boundsOf(zones);
  if (zones.length) {
    zones.push({
      id: 'desk-group',
      x: deskBlock.x - CHAIR - CHAIR_GAP,
      y: deskBlock.y - CHAIR - CHAIR_GAP,
      w: deskBlock.w + (CHAIR + CHAIR_GAP) * 2,
      h: deskBlock.h + (CHAIR + CHAIR_GAP) * 2,
    });
    props.unshift({
      kind: 'rug',
      w: deskBlock.w + (CHAIR + CHAIR_GAP) * 2 + 1.6,
      h: deskBlock.h + (CHAIR + CHAIR_GAP) * 2 + 1.6,
      angle: 0,
      x: deskBlock.x - CHAIR - CHAIR_GAP - 0.8,
      y: deskBlock.y - CHAIR - CHAIR_GAP - 0.8,
      anchor: { type: 'centered', of: 'desk-group' },
    });
  }

  // Planting in the corners the plate and the wall fixtures leave free. Never
  // the north-west corner: that is where the room's name is written.
  for (const corner of /** @type {const} */ (['SW', 'SE', 'NE'])) {
    props.push({
      kind: 'plant_large',
      w: 2.4,
      h: 2.4,
      angle: 0,
      x: deskBlock.x,
      y: deskBlock.y,
      anchor: { type: 'corner', corner, inset: CORNER_PLANT_INSET },
    });
  }

  const box = boundsOf([...props, ...zones]);
  // Contents land at MARGIN inside the room's own frame, never at its very
  // corner. THE ONE FRAME RULE: a room's props, zones and seats are all
  // expressed relative to the room's top-left, so `resolveAnchors` — which
  // measures wall and corner anchors from that same corner — cannot disagree
  // with them. Translating to 0 and then centring the contents separately is
  // what put the reception's sofas on the walls and its rug fifteen units
  // away in the middle of the floor.
  translateContents({ props, zones }, -box.x + MARGIN, -box.y + MARGIN);

  /** @type {Room} */
  const room = {
    kind: 'project',
    id,
    name,
    x: 0,
    y: 0,
    w: box.w + MARGIN * 2,
    h: box.h + MARGIN * 2,
    // What the furniture actually needs. The tiler may widen a project room to
    // fill its row; `place` uses this to centre the desks in the result rather
    // than leaving them against the left wall.
    natural: { w: box.w + MARGIN * 2, h: box.h + MARGIN * 2 },
    walls: 'partial',
    floor: 'carpet',
    plateLines: [
      name,
      `${sessionCount} session${sessionCount === 1 ? '' : 's'} · ${formatTokens(project.tokens || 0)} tok · ${project.needsYou || 0} need you`,
    ],
    props,
    zones,
  };
  for (const s of seats) {
    s.x += -box.x + MARGIN;
    s.y += -box.y + MARGIN;
  }
  return { room, seats, size: { w: room.w, h: room.h } };
}

// --------------------------------------------------------------- the office

/**
 * The user's office: their desk at the head of the room, and a reception
 * seated around the walls.
 *
 * Three rules shape it, all from how a real office actually works:
 *
 *   1. **The seating is against the walls.** A sofa run hugs the west, south
 *      and east walls, which leaves the middle of the room clear. An earlier
 *      version floated a C-shaped group in the centre and the room read as
 *      cramped, because the only circulation left was the gap between the
 *      furniture and the wall.
 *   2. **Nobody sits across from the manager except the person being seen.**
 *      There is exactly one guest chair at the desk, and it belongs to the
 *      front of the queue — the agent that has waited longest. Everyone else
 *      waits on the sofas until they are called.
 *   3. **The room is laid out for the size it is actually given.** `fit` is
 *      the interior the tiler ended up handing this room; the furniture is
 *      designed into it rather than laid out at some natural size and then
 *      centred inside a larger box. Centring was the old behaviour and it is
 *      what decoupled the wall-anchored sofas from the free-standing rug and
 *      coffee table by up to fifteen units.
 *
 * Local coordinates are the ROOM's own frame: (0, 0) is the room's top-left
 * corner, so `resolveAnchors` — which measures wall and corner anchors from
 * that same corner — can never disagree with the coordinates written here.
 *
 * @param {number} waitingCount
 * @param {{w:number,h:number}} [fit] the interior this room has been given
 */
function buildOffice(waitingCount, fit) {
  /** @type {Prop[]} */
  const props = [];
  /** @type {Zone[]} */
  const zones = [];

  // On the first pass `fit` is absent and the room bids for space at its
  // minimum size; the packer then re-runs this function with whatever the
  // service column actually granted.
  // The reception is sized for the queue it holds. A fixed 28 x 24 floor is a
  // large room to give one waiting agent, and on a real machine the queue is
  // usually one or two — so the room grew with the floor and never with its
  // purpose, and read as the biggest thing on a plan whose subject is the
  // working rooms. It still never shrinks below a room somebody could stand a
  // desk and a sofa in.
  const want = Math.max(0, waitingCount);
  const wantW = clamp(OFFICE_MIN_W + want * OFFICE_GROWTH_W, OFFICE_MIN_W, OFFICE_MAX_W);
  const wantH = clamp(OFFICE_MIN_H + want * OFFICE_GROWTH_H, OFFICE_MIN_H, OFFICE_MAX_H);
  const IN_W = clamp(
    Math.max(wantW, fit ? Math.min(fit.w, OFFICE_MAX_W) : 0),
    OFFICE_MIN_W,
    OFFICE_MAX_W,
  );
  // Never wider than a room: the reception is the one room the user looks at
  // first, and a 2:1 reception reads as a corridor with a desk at one end.
  // `fit.h` is a ROOM height and a room carries a plate band at the top, so
  // the interior is what is left under it. Taking `fit.h` as the interior
  // added a band on every pass and the reception grew a little taller each
  // time the plan was rebuilt.
  const IN_H = Math.max(wantH, IN_W / ROOM_ASPECT_MAX, fit ? fit.h - PLATE_BAND : 0);
  const SOFA_D = 2.6;
  const PAD = 0.4;

  // --- the desk, at the head of the room
  const deskW = clamp(IN_W * 0.4, 8, 14);
  const deskX = (IN_W - deskW) / 2;
  const deskY = 3.6;
  zones.push({ id: 'office-desk', x: deskX, y: deskY, w: deskW, h: 3 });
  props.push({
    kind: 'user_desk',
    id: 'user-desk',
    w: deskW,
    h: 3,
    angle: 0,
    x: deskX,
    y: deskY,
    anchor: { type: 'centered', of: 'office-desk' },
  });
  // The manager sits BEHIND the desk, between it and the north wall, looking
  // down the room at whoever is in the guest chair.
  props.push({
    kind: 'manager',
    id: 'manager',
    w: 2.6,
    h: 2.6,
    angle: Math.PI / 2,
    x: deskX + deskW / 2 - 1.3,
    y: deskY - 0.3 - 2.6,
    anchor: { type: 'attached', to: 'office-desk', edge: 'N', along: deskW / 2 - 1.3, gap: 0.3 },
  });
  props.push({
    kind: 'plant_large',
    w: 2.6,
    h: 2.6,
    angle: 0,
    x: deskX + deskW + 1.2,
    y: deskY + 0.2,
    anchor: { type: 'attached', to: 'office-desk', edge: 'E', along: 0.2, gap: 1.2 },
  });
  // Art on the EAST wall, beside the desk rather than above it. The strip
  // across the top of every room belongs to its plate (`PLATE_BAND`), and a
  // picture hung there would be read through the room's own name.
  const artH = Math.min(6, deskW * 0.55);
  props.push({
    kind: 'art',
    w: 0.4,
    h: artH,
    angle: 0,
    x: IN_W - 0.55,
    y: deskY,
    anchor: { type: 'wall', side: 'E', along: deskY, inset: 0.15 },
  });

  // --- the guest chair: one seat, facing the desk across it
  const guestX = deskX + deskW / 2 - CHAIR / 2;
  const guestY = deskY + 3 + 1.4;
  zones.push({ id: 'office-guest', x: guestX, y: guestY, w: CHAIR, h: CHAIR });
  props.push({
    kind: 'waiting_chair',
    id: 'guest-chair',
    w: CHAIR,
    h: CHAIR,
    angle: -Math.PI / 2,
    x: guestX,
    y: guestY,
    anchor: { type: 'centered', of: 'office-guest' },
  });

  // --- seating around the walls, sized to the room it is actually in
  //
  // The room's HEIGHT is settled here, before anything is anchored to it,
  // because the reception has to hold its whole queue. A first pass says how
  // many the wall seating takes; whatever is left needs loose chairs, and the
  // room grows to hold those rather than laying them out past its own south
  // wall. Growing only ever increases the wall seating, so one pass converges.
  const bandTop = guestY + CHAIR + 2.4;
  const backW = Math.max(4, IN_W - (PAD + SOFA_D) * 2);
  const chairCols = Math.max(1, Math.floor((IN_W - 2 * (PAD + SOFA_D) - 2) / OFFICE_CHAIR_PITCH));
  const seatsFor = (height) => {
    const run = Math.max(SOFA_MIN_RUN, height - bandTop - SOFA_D - PAD * 2);
    return (
      1 +
      Math.max(2, Math.floor(run / OFFICE_SEAT_PITCH)) * 2 +
      Math.max(2, Math.floor(backW / OFFICE_SEAT_PITCH))
    );
  };
  const chairRowsFor = (height) =>
    Math.ceil(Math.max(0, waitingCount - seatsFor(height)) / chairCols);
  // The room is at least as tall as its own contents: the desk band, a sofa
  // run somebody can actually sit on, the back run and the wall pad. Clamping
  // the RUN instead (the old rule) let a short room overlap its own back sofa.
  const IN_H_FINAL = Math.max(
    IN_H,
    bandTop + SOFA_MIN_RUN + SOFA_D + PAD * 2,
    bandTop + chairRowsFor(IN_H) * OFFICE_CHAIR_ROW + 2.8 + SOFA_D + PAD * 2,
  );
  // The three runs form a continuous C: the side runs come down to meet the
  // back run, and the back run spans exactly between them. Leaving each run to
  // its own arithmetic left the corners two units short at both ends, so the
  // seating read as three separate benches rather than as one reception.
  const sofaRunH = IN_H_FINAL - PAD - SOFA_D - bandTop;

  props.push({
    kind: 'sofa',
    id: 'wait-sofa-w',
    w: SOFA_D,
    h: sofaRunH,
    // Back to the west wall, seat facing east into the room.
    angle: 0,
    x: PAD,
    y: bandTop,
    anchor: { type: 'wall', side: 'W', along: bandTop, inset: PAD },
  });
  props.push({
    kind: 'sofa',
    id: 'wait-sofa-e',
    w: SOFA_D,
    h: sofaRunH,
    angle: Math.PI,
    x: IN_W - PAD - SOFA_D,
    y: bandTop,
    anchor: { type: 'wall', side: 'E', along: bandTop, inset: PAD },
  });
  props.push({
    kind: 'sofa',
    id: 'wait-sofa-s',
    w: backW,
    h: SOFA_D,
    angle: -Math.PI / 2,
    x: PAD + SOFA_D,
    y: IN_H_FINAL - PAD - SOFA_D,
    anchor: { type: 'wall', side: 'S', along: PAD + SOFA_D, inset: PAD },
  });

  // The middle of the room: the floor the three sofa runs enclose. A rug
  // covers it and a low table is centred on it, both `centered` on that zone,
  // so neither can drift away from the seating however wide the room becomes.
  const wellX = PAD + SOFA_D;
  const wellY = bandTop;
  const wellW = Math.max(4, IN_W - 2 * (PAD + SOFA_D));
  const wellH = Math.max(4, IN_H_FINAL - PAD - SOFA_D - wellY);
  zones.push({ id: 'office-well', x: wellX, y: wellY, w: wellW, h: wellH });
  // A rug defines the seating group; it is not floor covering. Held to a
  // sensible proportion so a wide reception gets a rug rather than a stripe,
  // and inset enough that the boards read all the way round it.
  // Wide enough to reach the seating it belongs to. Capping the rug's aspect
  // at 2.4:1 left a shallow reception with a rug stranded nine units clear of
  // the sofas on either side of it — the floating-prop defect, in the one room
  // the user looks at first.
  const rugH = Math.max(3, wellH - 2.4);
  const rugW = Math.max(4, wellW - 2.4);
  props.push({
    kind: 'rug',
    w: rugW,
    h: rugH,
    angle: 0,
    x: wellX + (wellW - rugW) / 2,
    y: wellY + 1.2,
    anchor: { type: 'centered', of: 'office-well' },
  });
  props.push({
    kind: 'magazine_table',
    w: clamp(wellW * 0.4, 3, 7),
    h: 3,
    angle: 0,
    x: wellX,
    y: wellY,
    anchor: { type: 'centered', of: 'office-well' },
  });
  // The small pieces bracket the head of the seating band. Each is attached
  // to the sofa run it stands beside, so it travels with it.
  props.push({
    kind: 'side_table',
    id: 'office-side-table',
    w: 1.8,
    h: 1.8,
    angle: 0,
    x: PAD + 0.4,
    y: bandTop - 2.2,
    anchor: { type: 'attached', to: 'wait-sofa-w', edge: 'N', along: 0.4, gap: 0.4 },
  });
  props.push({
    kind: 'lamp',
    w: 1.6,
    h: 1.6,
    angle: 0,
    x: IN_W - PAD - 2,
    y: bandTop - 2.2,
    anchor: { type: 'attached', to: 'wait-sofa-e', edge: 'N', along: 0.5, gap: 0.4 },
  });
  props.push({
    kind: 'water_cooler',
    w: 1.4,
    h: 1.4,
    angle: 0,
    x: PAD + 0.7,
    y: bandTop - 4.4,
    anchor: { type: 'attached', to: 'office-side-table', edge: 'N', along: 0.2, gap: 0.4 },
  });
  // Planting in the two corners the seating leaves open, so the head of the
  // room is furnished rather than bare either side of the desk.
  props.push({
    kind: 'plant',
    w: 2,
    h: 2,
    angle: 0,
    x: PAD + 0.6,
    y: PAD + 0.6,
    anchor: { type: 'corner', corner: 'NW', inset: PAD + 0.6 },
  });
  props.push({
    kind: 'plant',
    w: 2,
    h: 2,
    angle: 0,
    x: IN_W - PAD - 2.6,
    y: PAD + 0.6,
    anchor: { type: 'corner', corner: 'NE', inset: PAD + 0.6 },
  });

  // --- how many people the room can seat, and the loose chairs for the rest
  //
  // Only the COUNT is decided here. Where each agent actually sits is worked
  // out later, in `seatOffice`, from the furniture's resolved positions.
  const deskCentre = { x: deskX + deskW / 2, y: deskY + 1.5 };
  const perSide = Math.max(2, Math.floor(sofaRunH / OFFICE_SEAT_PITCH));
  const backCount = Math.max(2, Math.floor(backW / OFFICE_SEAT_PITCH));
  const seatedCapacity = 1 + perSide * 2 + backCount;

  // Overflow chairs, in rows across the well and facing the desk. They are
  // laid out INSIDE the well, so a loose chair can never land on a sofa.
  let overflow = Math.max(0, waitingCount - seatedCapacity);
  const chairRows = Math.max(1, Math.ceil(overflow / chairCols));
  const chairX0 = wellX + Math.max(1, (wellW - chairCols * OFFICE_CHAIR_PITCH) / 2) + 1.6;
  const chairY0 = wellY + Math.max(1.4, (wellH - chairRows * OFFICE_CHAIR_ROW) / 2) + 1.4;
  for (let r = 0; overflow > 0; r++) {
    for (let c = 0; c < chairCols && overflow > 0; c++) {
      const cx = chairX0 + c * OFFICE_CHAIR_PITCH;
      const cy = chairY0 + r * OFFICE_CHAIR_ROW;
      const id = `office-chair-${r}-${c}`;
      zones.push({ id, x: cx - CHAIR / 2, y: cy - CHAIR / 2, w: CHAIR, h: CHAIR });
      props.push({
        kind: 'waiting_chair',
        id,
        w: CHAIR,
        h: CHAIR,
        angle: angleTo({ x: cx, y: cy }, deskCentre),
        x: cx - CHAIR / 2,
        y: cy - CHAIR / 2,
        anchor: { type: 'centered', of: id },
      });
      overflow--;
    }
  }

  zones.push({ id: 'office-room', x: 0, y: 0, w: IN_W, h: IN_H_FINAL });

  /** @type {Room} */
  const room = {
    kind: 'office',
    id: '__office__',
    name: 'Your Office',
    x: 0,
    y: 0,
    w: IN_W,
    h: IN_H_FINAL + PLATE_BAND,
    plateBand: PLATE_BAND,
    natural: { w: IN_W, h: IN_H_FINAL + PLATE_BAND },
    walls: 'full',
    floor: 'wood',
    plateLines: ['Your Office', `${waitingCount} waiting`],
    props,
    zones,
  };
  // Seats are derived from the resolved furniture, later, by `seatOffice`.
  return { room, officeSeats: [] };
}

// --------------------------------------------------------------- the lounge

/**
 * The lounge: a rest area, a games room and a coffee spot in one.
 *
 * Unlike the project rooms, this is furnished whether or not anyone is in it —
 * an empty lounge should still read as somewhere you would want to go, because
 * a cleared queue is the reward and an empty grey box is not much of one. What
 * scales with the benched population is the GAMES: a table appears when there
 * are enough people to use it, so a busy lounge fills up rather than starting
 * out sparse.
 *
 * @param {number} benchedCount
 * @param {{w:number,h:number}} [fit] the interior this room has been given
 */
function buildLounge(benchedCount, fit) {
  /** @type {Prop[]} */
  const props = [];
  /** @type {Zone[]} */
  const zones = [];
  /** @type {LoungeSpot[]} */
  const spots = [];
  /** @type {{id:string, w:number, h:number, place:(x:number,y:number)=>void}[]} */
  const blocks = [];

  /** Shorthand: a prop positioned by an offset inside a zone. */
  const at = (zone, kind, dx, dy, w, h, angle = 0, id = undefined) => {
    props.push({
      kind,
      id,
      w,
      h,
      angle,
      x: zone.x + dx,
      y: zone.y + dy,
      anchor: { type: 'zone', of: zone.id, dx, dy },
    });
  };

  // ---- the lounge proper: sofas facing a television, on a round rug
  blocks.push({
    id: 'living',
    w: 15,
    h: 11,
    place(x, y) {
      const z = { id: 'living-zone', x, y, w: 15, h: 11 };
      zones.push(z);
      at(z, 'rug_round', 1.5, 1.5, 12, 8);
      at(z, 'tv', 4.5, 0, 6, 0.6);
      at(z, 'sofa', 3.5, 7.6, 8, 2.4, -Math.PI / 2, 'lounge-sofa-main');
      at(z, 'sofa', 0.4, 3.2, 2.4, 5, 0, 'lounge-sofa-side');
      at(z, 'coffee_table', 5.5, 4.2, 4.5, 2.2);
      at(z, 'side_table', 12.4, 3.4, 1.8, 1.8);
      at(z, 'lamp', 12.6, 6, 1.6, 1.6);
      at(z, 'plant_large', 12.4, 8.4, 2.4, 2.4);
      spots.push({
        id: 'lounge-sofa-a',
        kind: 'lounge_idle',
        x: x + 7.5,
        y: y + 8.8,
        angle: -Math.PI / 2,
        capacity: 3,
      });
      spots.push({
        id: 'lounge-sofa-b',
        kind: 'lounge_idle',
        x: x + 1.6,
        y: y + 5.7,
        angle: 0,
        capacity: 2,
      });
    },
  });

  // ---- the coffee spot: counter, machine, fridge, and stools to sit at
  blocks.push({
    id: 'coffee',
    w: 13,
    h: 8,
    place(x, y) {
      const z = { id: 'kitchen-zone', x, y, w: 13, h: 8 };
      zones.push(z);
      at(z, 'counter', 1, 0.4, 11, 2, 0, 'kitchen-counter');
      at(z, 'coffee_machine', 1.6, 2.7, 1.6, 1.2);
      at(z, 'fridge', 10, 2.6, 2.2, 2.2);
      // A fruit bowl and a mug on the counter: the small domestic cues that
      // make this read as a kitchen at a glance rather than as more office
      // furniture with a different outline.
      at(z, 'fruit_bowl', 5.2, 0.9, 1.6, 1.6);
      at(z, 'bar_counter', 1, 5, 11, 1.6, 0, 'bar-counter');
      for (let i = 0; i < 4; i++) at(z, 'bar_stool', 2 + i * 2.8, 7, 1.6, 1.6);
      at(z, 'fruit_bowl', 8.4, 5.2, 1.4, 1.4);
      at(z, 'plant_large', 11.2, 6.4, 2.2, 2.2);
      spots.push({
        id: 'lounge-coffee',
        kind: 'coffee',
        x: x + 2.4,
        y: y + 3.6,
        angle: -Math.PI / 2,
        capacity: 1,
      });
      for (let i = 0; i < 3; i++) {
        spots.push({
          id: `lounge-bar-${i}`,
          kind: 'eat',
          x: x + 2.8 + i * 2.8,
          y: y + 7.8,
          angle: -Math.PI / 2,
          capacity: 1,
        });
      }
    },
  });

  // ---- a quiet corner, always present: books and a plant
  blocks.push({
    id: 'quiet',
    w: 9,
    h: 6,
    place(x, y) {
      const z = { id: 'quiet-zone', x, y, w: 9, h: 6 };
      zones.push(z);
      at(z, 'bookshelf', 0.5, 0.3, 8, 1.3);
      at(z, 'sofa', 1, 3.4, 6, 2.2, Math.PI / 2);
      at(z, 'side_table', 7.4, 3.6, 1.8, 1.8);
      at(z, 'plant_large', 7.2, 0.4, 2.2, 2.2);
      spots.push({
        id: 'lounge-quiet',
        kind: 'lounge_idle',
        x: x + 4,
        y: y + 4.5,
        angle: -Math.PI / 2,
        capacity: 2,
      });
    },
  });

  /**
   * A games table, added only once there are enough people to want it.
   * @param {string} id
   * @param {string} kind
   * @param {number} w
   * @param {number} h
   * @param {(z: Zone) => void} addSpots
   */
  // Standing room between a game table and the edge of its block. Players
  // stand OUTSIDE the table; an earlier version derived spots from the zone
  // rather than the table, which put every player on top of the furniture
  // they were supposedly using — 14 of 23 lounge spots, including all four
  // diners sitting in the middle of the dining table.
  const GAME_INSET = 1.6;
  const STAND_OFF = 1.2;

  /**
   * A standing spot just clear of a table edge, facing the table.
   *
   * `bodyAngle` 0 faces +x, so each side faces back across the table:
   * standing south of it means looking north, and so on.
   *
   * @param {{x:number,y:number,w:number,h:number}} t the table's own rect
   * @param {'N'|'S'|'W'|'E'} side which side of it to stand on
   * @param {number} frac 0..1 along that side
   */
  const atTable = (t, side, frac) => {
    if (side === 'S') return { x: t.x + t.w * frac, y: t.y + t.h + STAND_OFF, angle: -Math.PI / 2 };
    if (side === 'N') return { x: t.x + t.w * frac, y: t.y - STAND_OFF, angle: Math.PI / 2 };
    if (side === 'W') return { x: t.x - STAND_OFF, y: t.y + t.h * frac, angle: 0 };
    return { x: t.x + t.w + STAND_OFF, y: t.y + t.h * frac, angle: Math.PI };
  };

  /**
   * A game: one piece of furniture, plus the places people stand to use it.
   *
   * `tw`/`th` are the TABLE's size, not the block's — the block grows by the
   * standing margin on every side. `addSpots` receives the table's resolved
   * rect, so spots are always positioned relative to the thing they belong
   * to rather than to a zone that merely contains it.
   */
  const game = (id, kind, tw, th, addSpots) => {
    blocks.push({
      id,
      w: tw + GAME_INSET * 2,
      h: th + GAME_INSET * 2,
      place(x, y) {
        const z = { id: `${id}-zone`, x, y, w: tw + GAME_INSET * 2, h: th + GAME_INSET * 2 };
        zones.push(z);
        const t = { x: x + GAME_INSET, y: y + GAME_INSET, w: tw, h: th };
        at(z, kind, GAME_INSET, GAME_INSET, tw, th, 0, id);
        addSpots(z, t);
      },
    });
  };

  // How many games this lounge lays out, whatever the benched population.
  //
  // The thresholds below were written for a handful of benched agents. On a
  // real machine nearly every session ends up benched, so every threshold
  // fires and the lounge becomes a games arcade — measured at six tables and
  // 630 square units of blocks, half the room, on a floor whose subject is the
  // project rooms. A lounge with four games still reads as a games room.
  let games = 0;
  const wants = (threshold) => benchedCount >= threshold && games++ < LOUNGE_MAX_GAMES;

  if (wants(1)) {
    game('dining', 'dining_table', 7.2, 6.2, (z, t) => {
      const seats = [
        ['S', 0.28],
        ['S', 0.72],
        ['N', 0.28],
        ['N', 0.72],
      ];
      seats.forEach(([side, frac], i) => {
        spots.push({ id: `lounge-eat-t${i}`, kind: 'eat', capacity: 1, ...atTable(t, side, frac) });
      });
    });
  }
  if (wants(3)) {
    game('pool', 'pool_table', 11.2, 7.2, (z, t) => {
      at(z, 'lamp', 0.4, z.h - 2, 1.4, 1.4);
      // Opposite sides, offset along the table rather than face to face —
      // how two people actually stand around a pool table.
      spots.push({
        id: 'lounge-pool-a',
        kind: 'pool',
        capacity: 1,
        partnerOf: 'lounge-pool-b',
        ...atTable(t, 'S', 0.32),
      });
      spots.push({
        id: 'lounge-pool-b',
        kind: 'pool',
        capacity: 1,
        partnerOf: 'lounge-pool-a',
        ...atTable(t, 'N', 0.68),
      });
    });
  }
  if (wants(5)) {
    game('tt', 'table_tennis', 10.2, 6.2, (z, t) => {
      // One at each end, across the net.
      spots.push({
        id: 'lounge-tt-a',
        kind: 'table_tennis',
        capacity: 1,
        partnerOf: 'lounge-tt-b',
        ...atTable(t, 'W', 0.5),
      });
      spots.push({
        id: 'lounge-tt-b',
        kind: 'table_tennis',
        capacity: 1,
        partnerOf: 'lounge-tt-a',
        ...atTable(t, 'E', 0.5),
      });
    });
  }
  if (wants(7)) {
    game('foos', 'foosball', 8.2, 5.2, (z, t) => {
      spots.push({
        id: 'lounge-foos-a',
        kind: 'board_game',
        capacity: 1,
        partnerOf: 'lounge-foos-b',
        ...atTable(t, 'W', 0.5),
      });
      spots.push({
        id: 'lounge-foos-b',
        kind: 'board_game',
        capacity: 1,
        partnerOf: 'lounge-foos-a',
        ...atTable(t, 'E', 0.5),
      });
    });
  }
  if (wants(9)) {
    game('arcade', 'arcade_cabinet', 4.2, 5.2, (z, t) => {
      // In front of the cabinet, facing the screen.
      spots.push({ id: 'lounge-arcade', kind: 'arcade', capacity: 1, ...atTable(t, 'S', 0.5) });
    });
  }
  if (wants(11)) {
    game('board', 'board_game_table', 7.2, 6.2, (z, t) => {
      const seats = [
        ['S', 0.28],
        ['S', 0.72],
        ['N', 0.28],
        ['N', 0.72],
      ];
      seats.forEach(([side, frac], i) => {
        spots.push({
          id: `lounge-board-${i}`,
          kind: 'board_game',
          capacity: 1,
          ...atTable(t, side, frac),
        });
      });
    });
  }

  // Flow the blocks to the shape of the room this lounge has been given, so
  // it fills its column rather than leaving a band of bare floor beside it.
  const budgetW = fit && fit.w > 0 ? fit.w - MARGIN * 2 : Infinity;
  // The lounge's blocks are all different sizes, so it shelf-packs rather than
  // flowing into a fixed column count (see `shelfPack`).
  const budget = Number.isFinite(budgetW)
    ? budgetW
    : Math.max(...blocks.map((b) => b.w)) * Math.max(1, Math.round(Math.sqrt(blocks.length)));
  const flow = shelfPack(blocks, LOUNGE_GAP, budget);
  blocks.forEach((b, i) => b.place(flow.out[i].x, flow.out[i].y));

  // Standing conversations need no furniture, so they take the promenade
  // along the bottom of the lounge once every seat is spoken for.
  //
  // The count is a HARD guarantee, not a decoration: `assignSeats` gives one
  // agent one spot, so a lounge with fewer spots than benched agents stacks
  // the remainder on top of each other. The band therefore grows until every
  // benched agent has somewhere of their own to stand.
  const furniture = boundsOf([...props, ...zones]);
  const seated = spots.reduce((a, sp) => a + sp.capacity, 0);
  const missing = Math.max(0, benchedCount - seated);
  if (missing > 0) {
    const bandW = Math.min(furniture.w, budgetW);
    const perRow = Math.max(2, 2 * Math.floor(bandW / (MINGLE_PITCH * 2)));
    const rows = Math.ceil(missing / perRow);
    const bandY = furniture.y + furniture.h + LOUNGE_GAP;
    zones.push({
      id: 'lounge-mingle',
      x: furniture.x,
      y: bandY - 1.2,
      w: furniture.w,
      h: rows * MINGLE_ROW + 2.4,
    });
    let made = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c + 1 < perRow && made < missing; c += 2) {
        const bx = furniture.x + 1.2 + c * MINGLE_PITCH;
        const by = bandY + r * MINGLE_ROW;
        const a = `lounge-chat-${r}-${c}a`;
        const b = `lounge-chat-${r}-${c}b`;
        spots.push({ id: a, kind: 'chat', x: bx, y: by, angle: 0, capacity: 1, partnerOf: b });
        made++;
        if (made < missing) {
          spots.push({
            id: b,
            kind: 'chat',
            x: bx + 1.8,
            y: by,
            angle: Math.PI,
            capacity: 1,
            partnerOf: a,
          });
          made++;
        }
      }
    }
  }

  const box = boundsOf([...props, ...zones]);
  // One frame: contents sit MARGIN inside the room's own top-left corner, and
  // every anchor is measured from that same corner.
  const dx = -box.x + MARGIN;
  const dy = -box.y + MARGIN;
  translateContents({ props, zones }, dx, dy);
  for (const sp of spots) {
    sp.x += dx;
    sp.y += dy;
  }
  const kitchen = zones.find((z) => z.id === 'kitchen-zone');

  /** @type {Room} */
  const room = {
    kind: 'lounge',
    id: '__lounge__',
    name: 'Lounge',
    x: 0,
    y: 0,
    // Its own size. `fit` is a BUDGET for the flow above, not a size to pad
    // out to: a room padded to a budget it did not need is a room with a bay
    // of empty floor in it, which is the whole defect this layer exists to
    // prevent. The packer gives the leftover to circulation instead.
    w: box.w + MARGIN * 2,
    h: Math.max(box.h + MARGIN * 2, fit ? fit.h - PLATE_BAND : 0) + PLATE_BAND,
    plateBand: PLATE_BAND,
    natural: { w: box.w + MARGIN * 2, h: box.h + MARGIN * 2 + PLATE_BAND },
    walls: 'partial',
    floor: 'wood',
    plateLines: ['Lounge', `${benchedCount} benched`],
    props,
    zones,
    kitchenZone: kitchen ? { x: kitchen.x, y: kitchen.y, w: kitchen.w, h: kitchen.h } : undefined,
  };
  return { room, loungeSpots: spots };
}

// -------------------------------------------------------------- the tiling

/**
 * Tile `rect` with one cell per item, in rows, keeping each cell close to the
 * shape of the item it must hold.
 *
 * A pure area-based subdivision (a treemap) was tried first and is wrong here.
 * It honours each item's AREA and lets the aspect fall where it may, which on
 * a real floor produced cells like 38 x 10 for a zone whose furniture is
 * 5 x 5. Nothing can be laid out sensibly in a cell that shape, so the fitting
 * loop grew the whole building instead — measured at five to ten times the
 * space the furniture actually needed.
 *
 * Rows fix that: a row is as tall as the tallest thing in it, and widths
 * inside a row are shared in proportion to what each zone needs. Every cell
 * ends up within a factor of the shape it wanted, and the building stays the
 * size of its contents.
 *
 * @param {{w:number,h:number}[]} items natural sizes
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @returns {{x:number,y:number,w:number,h:number}[]}
 */
export function tileRows(items, rect, gap = 0) {
  if (items.length === 0) return { cells: [], corridors: [] };

  /** Split into `rowCount` rows, balancing each row's natural width. */
  const split = (rowCount) => {
    const totalW = items.reduce((a, it) => a + it.w, 0);
    const perRow = totalW / rowCount;
    /** @type {{w:number,h:number,i:number}[][]} */
    const rows = [[]];
    let acc = 0;
    items.forEach((it, i) => {
      const row = rows[rows.length - 1];
      if (row.length > 0 && acc + it.w / 2 > perRow && rows.length < rowCount) {
        rows.push([{ ...it, i }]);
        acc = it.w;
      } else {
        row.push({ ...it, i });
        acc += it.w;
      }
    });
    return rows;
  };

  /** Lay rows into the rect and report the worst shape distortion. */
  const layout = (rows) => {
    const rowNatural = rows.map((row) => Math.max(...row.map((it) => it.h)));
    const totalNatural = rowNatural.reduce((a, b) => a + b, 0) || 1;
    /** @type {{x:number,y:number,w:number,h:number}[]} */
    const cells = new Array(items.length);
    /** @type {{x:number,y:number,w:number,h:number}[]} */
    const corridors = [];
    // Every row is separated from the next by a corridor, so an agent can
    // leave any desk and reach the spine without walking through someone
    // else's room.
    const usableH = Math.max(1, rect.h - gap * Math.max(0, rows.length - 1));
    let worst = 0;
    let y = rect.y;
    rows.forEach((row, r) => {
      // The last row absorbs any rounding so the rect is covered exactly.
      const h =
        r === rows.length - 1 ? rect.y + rect.h - y : (usableH * rowNatural[r]) / totalNatural;
      const rowW = row.reduce((a, it) => a + it.w, 0) || 1;
      let x = rect.x;
      row.forEach((it, k) => {
        const w = k === row.length - 1 ? rect.x + rect.w - x : (rect.w * it.w) / rowW;
        cells[it.i] = { x, y, w, h };
        worst = Math.max(worst, Math.abs(Math.log(w / h / (it.w / it.h))));
        x += w;
      });
      y += h;
      if (r < rows.length - 1) {
        corridors.push({ x: rect.x, y, w: rect.w, h: gap });
        y += gap;
      }
    });
    return { cells, corridors, worst };
  };

  let best = null;
  for (let rowCount = 1; rowCount <= items.length; rowCount++) {
    const out = layout(split(rowCount));
    if (!best || out.worst < best.worst) best = out;
  }
  const chosen = best || layout(split(1));
  return { cells: chosen.cells, corridors: chosen.corridors };
}

/**
 * Derive the wall segments from the zone rectangles.
 *
 * Walls belong to the FLOOR, not to a room: two zones either side of a
 * partition share one wall. Deriving them from shared edges — rather than
 * letting every room draw its own outline — is what makes the plan read as
 * one building that has been divided, instead of a row of separate huts.
 *
 * @param {Room[]} rooms
 * @param {number} W
 * @param {number} H
 * @returns {Wall[]}
 */
function deriveWalls(rooms, W, H) {
  /** @type {Map<string, Wall>} */
  const byKey = new Map();
  const key = (x1, y1, x2, y2) => [x1, y1, x2, y2].map((v) => Math.round(v * 100) / 100).join(':');

  for (const room of rooms) {
    const solid = room.walls === 'full';
    const edges = [
      { x1: room.x, y1: room.y, x2: room.x + room.w, y2: room.y },
      { x1: room.x, y1: room.y + room.h, x2: room.x + room.w, y2: room.y + room.h },
      { x1: room.x, y1: room.y, x2: room.x, y2: room.y + room.h },
      { x1: room.x + room.w, y1: room.y, x2: room.x + room.w, y2: room.y + room.h },
    ];
    for (const e of edges) {
      const onEdge =
        Math.abs(e.x1) < 0.01 ||
        Math.abs(e.y1) < 0.01 ||
        Math.abs(e.x2 - W) < 0.01 ||
        Math.abs(e.y2 - H) < 0.01;
      const exterior =
        onEdge &&
        ((Math.abs(e.x1 - e.x2) < 0.01 && (Math.abs(e.x1) < 0.01 || Math.abs(e.x1 - W) < 0.01)) ||
          (Math.abs(e.y1 - e.y2) < 0.01 && (Math.abs(e.y1) < 0.01 || Math.abs(e.y1 - H) < 0.01)));
      const k = key(e.x1, e.y1, e.x2, e.y2);
      const existing = byKey.get(k);
      /** @type {'exterior'|'solid'|'partition'} */
      const kind = exterior ? 'exterior' : solid ? 'solid' : 'partition';
      // A shared edge is emitted once. Where two rooms disagree, the stronger
      // wall wins — an office's solid wall is not downgraded by the open-plan
      // zone on its other side.
      const rank = { partition: 0, solid: 1, exterior: 2 };
      if (!existing || rank[kind] > rank[existing.kind]) {
        byKey.set(k, { ...e, kind });
      }
    }
  }
  return [...byKey.values()];
}

/**
 * Seat the waiting agents on the reception furniture, after that furniture has
 * been placed for real.
 *
 * This runs late on purpose. The sofas are anchored to the room's walls, so
 * their final coordinates are not known until the room has been sized, tiled
 * and had its anchors resolved. An earlier version computed seats from the
 * pre-anchor layout, and agents appeared to sit on the floor beside the
 * furniture rather than on it — the two frames simply were not the same.
 *
 * Order matters: the guest chair at the desk is the front of the queue, then
 * the west run, the south run, the east run, and finally any loose chairs.
 *
 * @param {Room} room the office, with anchors already resolved
 * @param {number} waitingCount
 * @returns {Seat[]}
 */
function seatOffice(room, waitingCount) {
  /** @type {Seat[]} */
  const seats = [];
  if (waitingCount <= 0) return seats;

  const byId = new Map();
  for (const p of room.props) if (p.id) byId.set(p.id, p);
  const desk = byId.get('user-desk');
  const deskCentre = desk
    ? { x: desk.x + desk.w / 2, y: desk.y + desk.h / 2 }
    : { x: room.x + room.w / 2, y: room.y };

  const place = (x, y) => {
    if (seats.length >= waitingCount) return;
    seats.push({ x, y, angle: angleTo({ x, y }, deskCentre) });
  };

  const guest = byId.get('guest-chair');
  if (guest) place(guest.x + guest.w / 2, guest.y + guest.h / 2);

  // Along each sofa run, spaced by seat pitch. A run's rectangle says which
  // way it lies, exactly as it does for the painter.
  const SEAT_ALONG = OFFICE_SEAT_PITCH;
  for (const id of ['wait-sofa-w', 'wait-sofa-s', 'wait-sofa-e']) {
    const sofa = byId.get(id);
    if (!sofa) continue;
    const vertical = sofa.h > sofa.w;
    const runLen = vertical ? sofa.h : sofa.w;
    const n = Math.max(1, Math.floor(runLen / SEAT_ALONG));
    // Sit on the SEAT, not on the back. The back occupies the far third of the
    // sofa's depth from the direction it faces (`backdrop.js`'s sofa case), so
    // the occupant is nudged that far toward the front of it.
    const depth = vertical ? sofa.w : sofa.h;
    const forward = depth * SOFA_SEAT_BIAS;
    const bias = {
      x: vertical ? Math.cos(sofa.angle || 0) * forward : 0,
      y: vertical ? 0 : Math.sin(sofa.angle || 0) * forward,
    };
    for (let i = 0; i < n; i++) {
      const along = ((i + 0.5) * runLen) / n;
      if (vertical) place(sofa.x + sofa.w / 2 + bias.x, sofa.y + along);
      else place(sofa.x + along, sofa.y + sofa.h / 2 + bias.y);
    }
  }

  // Loose chairs last, in the order they were laid out.
  for (const p of room.props) {
    if (p.kind !== 'waiting_chair' || p.id === 'guest-chair') continue;
    place(p.x + p.w / 2, p.y + p.h / 2);
  }
  return seats;
}

// ------------------------------------------------------------ the nav graph

/**
 * The walkable network: corridor centrelines, plus a door and an entry point
 * for every room.
 *
 * Agents may only travel along these lines. Before this existed the router did
 * generic obstacle avoidance and, when a direct path was blocked, swept around
 * the *bounding box of the obstacles* — which is outside the building. That is
 * why agents were seen leaving the floor in an arbitrary direction and
 * reappearing on the far side: they were taking a legal route through a model
 * that had no idea where the walls were.
 *
 * The lines are deliberately not the same objects as the corridor ROOMS. A
 * cross corridor's room starts at the spine's right edge, but its centreline
 * is extended left to meet the spine's centreline so the two actually
 * intersect — the overlap lies inside the spine, which is walkable floor.
 *
 * @typedef {object} NavLine
 * @property {string} id
 * @property {'h'|'v'} axis
 * @property {number} c    the constant coordinate: y for 'h', x for 'v'
 * @property {number} min  start along the varying axis
 * @property {number} max  end along the varying axis
 *
 * @param {Room[]} rooms
 * @param {number} W
 * @param {number} H
 * @returns {{lines: NavLine[], spineId: string|null}}
 */
function buildNavLines(rooms, W, H) {
  /** @type {NavLine[]} */
  const lines = [];
  const spine = rooms.find((r) => r.id === '__spine__');
  const spineC = spine ? spine.x + spine.w / 2 : null;

  if (spine) {
    lines.push({ id: spine.id, axis: 'v', c: spineC, min: spine.y, max: spine.y + spine.h });
  }

  for (const r of rooms) {
    if (r.kind !== 'corridor' || r.id === '__spine__') continue;
    if (r.thoroughfare === false) continue;
    // A corridor's own shape says which way people walk down it. The working
    // floor now has one horizontal corridor across the middle and a vertical
    // aisle beside every column of rooms; both are routes, and a room deep in
    // a stack reaches the floor through the aisle next to it rather than by
    // cutting through its neighbour.
    if (r.h > r.w) {
      const c = r.x + r.w / 2;
      // Extended half a corridor past each end so it actually meets the
      // corridor centreline it opens onto — a line that stops exactly at the
      // corridor's edge never intersects it, and the graph comes apart into
      // one component per row.
      lines.push({
        id: r.id,
        axis: 'v',
        c,
        min: Math.max(0, r.y - CORRIDOR / 2),
        max: Math.min(H, r.y + r.h + CORRIDOR / 2),
      });
      continue;
    }
    const c = r.y + r.h / 2;
    // Extended left to the spine centreline so the graph is connected.
    const min = spineC !== null ? Math.min(spineC, r.x) : r.x;
    lines.push({ id: r.id, axis: 'h', c, min, max: Math.min(W, r.x + r.w) });
  }

  // A floor with no corridors at all (a single project, say) still needs one
  // walkable line, or nothing can move.
  if (lines.length === 0) {
    lines.push({ id: '__fallback__', axis: 'v', c: W / 2, min: 0, max: H });
  }
  return { lines, spineId: spine ? spine.id : null };
}

/** Distance from a point to a nav line, and the closest point on it. */
function projectOntoLine(line, p) {
  if (line.axis === 'v') {
    const y = clamp(p.y, line.min, line.max);
    return { point: { x: line.c, y }, dist: Math.hypot(p.x - line.c, p.y - y) };
  }
  const x = clamp(p.x, line.min, line.max);
  return { point: { x, y: line.c }, dist: Math.hypot(p.x - x, p.y - line.c) };
}

/**
 * Give every room a door on its own boundary and an entry point on the
 * corridor that door opens onto.
 *
 * @param {Room[]} rooms
 * @param {NavLine[]} lines
 */
function assignDoors(rooms, lines) {
  for (const room of rooms) {
    if (room.kind === 'corridor') continue;
    const centre = { x: room.x + room.w / 2, y: room.y + room.h / 2 };

    let best = null;
    for (const line of lines) {
      const { point, dist } = projectOntoLine(line, centre);
      if (!best || dist < best.dist) best = { line, point, dist };
    }
    if (!best) continue;

    // The door sits on the room edge that faces the corridor, level with the
    // entry point, so leaving a room is always one straight step through its
    // own wall rather than a diagonal across furniture.
    const e = best.point;
    let door;
    if (best.line.axis === 'v') {
      const y = clamp(e.y, room.y + 1, room.y + room.h - 1);
      door = { x: e.x < centre.x ? room.x : room.x + room.w, y };
    } else {
      const x = clamp(e.x, room.x + 1, room.x + room.w - 1);
      door = { x, y: e.y < centre.y ? room.y : room.y + room.h };
    }
    room.door = door;
    room.navEntry = { x: e.x, y: e.y };
    room.navLineId = best.line.id;
  }
}

// ------------------------------------------------------------------ the plan

/**
 * Build the whole floor.
 *
 * @param {ProjectLike[]} projects
 * @param {AgentLike[]} agents
 * @param {{ targetAspect?: number }} [opts]
 * @returns {Plan}
 */
export function buildPlan(projects, agents, opts = {}) {
  const targetAspect = clamp(Number(opts.targetAspect) || DEFAULT_ASPECT, ASPECT_MIN, ASPECT_MAX);
  const list = Array.isArray(agents) ? agents : [];
  const waitingCount = list.filter(
    (a) => a && a.ackState === 'active' && a.activityState === 'for_review',
  ).length;
  const benchedCount = list.filter((a) => a && a.ackState === 'benched').length;
  // Which repos are worth floor space.
  //
  //   active agents        -> open room, with desks and people
  //   none, not archived   -> collapsed to a strip
  //   none, archived       -> off the floor entirely
  //
  // An active agent always wins, which is what makes archiving a room safe: a
  // room the user collapsed pops back open by itself the moment somebody
  // starts working in that repo, rather than hiding them.
  const isIdle = (p) => (p.activeCount ?? p.sessionCount ?? 0) === 0;
  const visible = (Array.isArray(projects) ? projects : []).filter(
    (p) => (p.sessionCount ?? 0) > 0 && !(isIdle(p) && p.archived),
  );

  // ---- pass 1: everything at its natural size, purely to bid for space.
  let office = buildOffice(waitingCount);
  let lounge = buildLounge(benchedCount);
  // ARCHIVED SESSIONS ARE OFF THE FLOOR. They get no room, no street and no
  // strip: an archived session is one the user has explicitly put away, and
  // the floor is for the ones that are still in play. They are still counted
  // in the header and still listed in the panel — they simply do not take
  // screen space away from the rooms where work happens.
  /** @type {{room: Room, seats: Seat[]}[]} */
  // A collapsed room is just a project room with a small fixed footprint and
  // no furniture, so it rides the same packing, placement and hit-testing as
  // every other room rather than needing a parallel path through the layout.
  const projectRooms = visible.map((p) =>
    isIdle(p)
      ? { room: buildCollapsedRoom(p, p.sessionCount ?? 0), seats: /** @type {Seat[]} */ ([]) }
      : buildProjectRoom(p, p.sessionCount ?? 0),
  );

  // ---- THE FLOOR IS THREE BANDS, and their shares are the design.
  //
  //   service   ~32%  the user's office above the lounge
  //   working   ~65%  the project rooms, which are what the product is for
  //
  // Everything below follows from that. Earlier revisions let each band ask
  // for what its contents wanted and then tried to reconcile the result, which
  // is how a machine whose sessions are nearly all benched ended up with 58%
  // of its floor given to a reception, a lounge and a room full of archived
  // sessions, and 13% to the rooms with people working in them.
  //
  // The service column is what sets the scale: it holds a roughly fixed amount
  // of furniture, so once its width is chosen the rest of the floor follows
  // from the shares. The search below picks that width.
  const serviceCache = new Map();
  const measureService = (sw) => {
    const key = Math.round(sw);
    let got = serviceCache.get(key);
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
    const o = buildOffice(waitingCount, { w: Math.min(key, OFFICE_MAX_W), h: 0 });
    const colW = o.room.w;
    const l = buildLounge(benchedCount, { w: colW, h: 0 });
    // The lounge takes the column's width whatever its blocks packed to: open
    // floor in a lounge is a lounge, and the alternative is a strip of
    // circulation beside it doing the same job less honestly.
    l.room.w = colW;
    got = { w: colW, office: o, lounge: l, h: o.room.h + l.room.h };
    serviceCache.set(key, got);
    return got;
  };

  /**
   * How much floor each project is worth, relative to the others.
   *
   * Its furniture's own footprint — a twenty-one desk project earns more room
   * than a one desk project — with the ratio clamped. Unclamped, one very large
   * repo beside a dozen single-session ones turns the small rooms into
   * splinters, and a splinter is not a room whatever its area says.
   */
  const weights = (() => {
    const raw = projectRooms.map((pr) => Math.max(1, pr.room.w * pr.room.h));
    const min = Math.min(...raw);
    return raw.map((v) => Math.min(v, min * WEIGHT_MAX_RATIO));
  })();

  /**
   * Deal the projects into `rowCount` bands of roughly equal weight, largest
   * first. Balanced bands are what stop one row of the floor being crowded
   * while the other has room to spare.
   */
  const bandsOf = (rowCount) => {
    const order = weights
      .map((weight, i) => ({ weight, i }))
      .sort((a, b) => b.weight - a.weight || a.i - b.i);
    const bands = Array.from({ length: rowCount }, () => []);
    const load = new Array(rowCount).fill(0);
    for (const item of order) {
      let pick = 0;
      for (let r = 1; r < rowCount; r++) if (load[r] < load[pick]) pick = r;
      bands[pick].push(item);
      load[pick] += item.weight;
    }
    return bands.filter((b) => b.length > 0);
  };

  /**
   * Lay the project rooms into `rect` as `rowCount` bands separated by ONE
   * corridor each, every band squarified so its rooms tile it exactly.
   *
   * This is a double-loaded corridor plan, which is what an office floor of
   * this shape actually is: a service core down one side, a spine beside it,
   * and working bays either side of a single cross corridor. There is no other
   * circulation on the working floor — rooms share their walls.
   *
   * @param {{x:number,y:number,w:number,h:number}} rect
   * @param {number} rowCount
   */
  const layWorkingFloor = (rect, rowCount) => {
    /** @type {{x:number,y:number,w:number,h:number}[]} */
    const empty = new Array(projectRooms.length);
    if (!projectRooms.length || rect.w <= 0 || rect.h <= 0) {
      return { cells: empty, corridors: [] };
    }

    const attempt = (rows) => {
      const cells = new Array(projectRooms.length);
      const corridors = [];
      const bands = bandsOf(rows);
      const n = bands.length;
      const bandH = (rect.h - CORRIDOR * (n - 1)) / n;
      if (bandH <= 0) return null;
      bands.forEach((band, r) => {
        const y = rect.y + r * (bandH + CORRIDOR);
        const laid = squarify(
          band.map((item, k) => ({ weight: item.weight, i: k })),
          { x: rect.x, y, w: rect.w, h: bandH },
        );
        band.forEach((item, k) => {
          cells[item.i] = laid[k];
        });
        if (r < n - 1) corridors.push({ x: rect.x, y: y + bandH, w: rect.w, h: CORRIDOR });
      });
      let worst = 1;
      for (const c of cells) {
        if (!c || c.w <= 0 || c.h <= 0) return null;
        worst = Math.max(worst, c.w / c.h, c.h / c.w);
      }
      return { cells, corridors, worst };
    };

    // Two bands is the plan. It only gives way when two bands would leave a
    // room that is no longer a room — with three rooms on a wide floor,
    // splitting them two-and-one leaves the lone one spanning the whole width
    // — and then only if one band actually does better.
    const two = attempt(rowCount);
    const one = rowCount > 1 ? attempt(1) : null;
    const pick =
      two && two.worst <= PROJECT_ASPECT_LIMIT
        ? two
        : one && (!two || one.worst < two.worst)
          ? one
          : two || one;
    if (!pick) return { cells: empty, corridors: [] };
    return { cells: pick.cells, corridors: pick.corridors };
  };

  /**
   * The whole envelope implied by one service-column width.
   *
   * The floor is built to the STAGE's shape, exactly: `W = targetAspect * H`.
   * Everything else follows, because the working floor is a treemap and a
   * treemap tiles whatever rectangle it is handed — so the plan can be told
   * what size to be instead of reporting what size it turned out to be, and
   * there is never a letterbox band or a bay of leftover floor.
   *
   * `H` starts at the height of the service column and grows only until the
   * working side has room for its furniture.
   *
   * @param {number} sw service-column width
   */
  const envelopeFor = (sw) => {
    const measured = measureService(sw);
    const needed = projectRooms.reduce((a, pr) => a + pr.room.w * pr.room.h, 0);
    const rowCount = projectRooms.length >= WORKING_ROWS_MIN_ROOMS ? WORKING_ROWS : 1;

    let H = Math.max(measured.h, MARGIN * 4);
    for (let pass = 0; pass < 40; pass++) {
      const W = targetAspect * H;
      const workingW = W - measured.w - CORRIDOR;
      const workingH = H - CORRIDOR * (rowCount - 1);
      if (workingW > MARGIN * 2 && workingW * workingH >= needed * (1 + WORKING_HEADROOM)) break;
      H *= 1.04;
    }
    const W = targetAspect * H;
    return { measured, W, H, rowCount, workingW: Math.max(0, W - measured.w - CORRIDOR) };
  };

  // Pick the column width whose floor draws largest on this stage. A floor is
  // drawn at `min(stageW / W, stageH / H)`, and the stage's aspect is the
  // target, so that is the same as minimising `max(W / targetAspect, H)`.
  let best = null;
  for (let sw = OFFICE_MIN_W; sw <= SERVICE_MAX_W; sw += SERVICE_W_STEP) {
    const candidate = envelopeFor(sw);
    const cost = Math.max(candidate.W / targetAspect, candidate.H);
    if (!best || cost < best.cost) best = { ...candidate, cost };
  }
  const chosen = best || envelopeFor(OFFICE_MIN_W);

  office = chosen.measured.office;
  lounge = chosen.measured.lounge;
  const serviceW = chosen.measured.w;
  const serviceX = 0;
  const workingX = serviceW + CORRIDOR;

  // ---- the working floor, and the floor's final size.
  //
  // The rooms are laid into their cells and REBUILT to the shape of the cell
  // they were given, so a project's tables flow to that shape rather than
  // being laid out square and centred in something that is not. Rebuilding
  // changes what a room needs, so the fit is checked and the building grows
  // until every room holds its own furniture — the one thing the plan may
  // never get wrong, since a desk outside its room is a desk on the corridor.
  let H = chosen.H;
  let W = chosen.W;
  let laid = { cells: [], corridors: [] };
  for (let pass = 0; pass < 8; pass++) {
    W = targetAspect * H;
    laid = layWorkingFloor({ x: workingX, y: 0, w: W - workingX, h: H }, chosen.rowCount);
    let worst = 1;
    projectRooms.forEach((pr, i) => {
      const cell = laid.cells[i];
      if (!cell) return;
      if (!pr.room.collapsed) {
        const rebuilt = buildProjectRoom(visible[i], visible[i].sessionCount ?? 0, cell.w / cell.h);
        projectRooms[i] = rebuilt;
      }
      const natural = projectRooms[i].room.natural || {
        w: projectRooms[i].room.w,
        h: projectRooms[i].room.h,
      };
      worst = Math.max(worst, natural.w / cell.w, natural.h / cell.h);
    });
    if (worst <= 1.0005) break;
    H *= Math.min(worst, 1.25);
  }

  // ---- the service column fills its side of the floor exactly.
  //
  // The office above the lounge, both the column's full width, together the
  // building's full height. Any surplus is shared between them rather than
  // left as a strip: a lobby is a room-shaped piece of nothing, and this plan
  // has exactly two pieces of circulation in it — the spine and the cross
  // corridor — by design.
  const loungeNaturalH = lounge.room.h;
  const columnSurplus = Math.max(0, H - (office.room.h + loungeNaturalH));
  // The reception takes a share of it, up to the point where it would stop
  // being a room; the lounge takes the rest, because open floor reads as a
  // lounge and reads as dead space anywhere else.
  // The reception takes a floor of the column whatever the lounge needs. It is
  // the room the product is about — the one that answers "is anything waiting
  // on me" — and on a machine where nearly every session is benched the lounge
  // would otherwise have four times its height simply by having more in it.
  const officeH = clamp(
    Math.max(office.room.h + columnSurplus * OFFICE_SURPLUS_SHARE, H * OFFICE_COLUMN_MIN),
    office.room.h,
    Math.max(office.room.h, serviceW / OFFICE_ASPECT_MIN),
  );

  office = buildOffice(waitingCount, { w: serviceW, h: officeH });
  office.room.x = serviceX;
  office.room.y = 0;
  office.room.w = serviceW;
  office.room.h = officeH;

  lounge.room.x = serviceX;
  lounge.room.w = serviceW;
  lounge.room.y = officeH;
  lounge.room.h = Math.max(loungeNaturalH, H - officeH);

  // The column is the height of what it holds. Giving the reception a floor of
  // the column can push the two past the building; the building grows to match
  // rather than the rooms overlapping, and the floor is re-squared to the
  // stage so it still fills it exactly.
  const columnH = officeH + lounge.room.h;
  if (columnH > H + 0.01) {
    H = columnH;
    W = targetAspect * H;
    laid = layWorkingFloor({ x: workingX, y: 0, w: W - workingX, h: H }, chosen.rowCount);
  }

  const workingWidth = Math.max(0, W - workingX);

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

  // The spine: the one vertical corridor, between the service column and the
  // working floor.
  const spine = {
    kind: /** @type {'corridor'} */ ('corridor'),
    id: '__spine__',
    name: '',
    x: serviceW,
    y: 0,
    w: CORRIDOR,
    h: H,
    walls: /** @type {'partial'} */ ('partial'),
    floor: /** @type {'circulation'} */ ('circulation'),
    plateLines: /** @type {[string, string]} */ (['', '']),
    props: [],
    zones: [],
  };

  // And the cross corridor, or corridors if the working floor ever grows past
  // two bands. Both are thoroughfares; there is nothing else to walk on.
  const crossCorridors = laid.corridors.map((c, i) => ({
    kind: /** @type {'corridor'} */ ('corridor'),
    thoroughfare: true,
    id: `__corridor-${i}__`,
    name: '',
    x: c.x,
    y: c.y,
    w: c.w,
    h: c.h,
    walls: /** @type {'partial'} */ ('partial'),
    floor: /** @type {'circulation'} */ ('circulation'),
    plateLines: /** @type {[string, string]} */ (['', '']),
    props: [],
    zones: [],
  }));

  // A floor with no projects at all still needs the working side to be
  // something rather than a hole: it becomes open circulation.
  const emptyBand =
    projectRooms.length === 0 && workingWidth > 1
      ? [
          {
            kind: /** @type {'corridor'} */ ('corridor'),
            // Open floor, not a route: with no project rooms there is nothing
            // on this side to walk to, and a full-height bay beside the spine
            // is a second parallel vertical line the graph can never reach.
            thoroughfare: false,
            id: '__open__',
            name: '',
            x: workingX,
            y: 0,
            w: workingWidth,
            h: H,
            walls: /** @type {'partial'} */ ('partial'),
            floor: /** @type {'circulation'} */ ('circulation'),
            plateLines: /** @type {[string, string]} */ (['', '']),
            props: [],
            zones: [],
          },
        ]
      : [];

  const rooms = [
    office.room,
    spine,
    ...crossCorridors,
    ...emptyBand,
    ...projectRooms.map((pr) => pr.room),
    lounge.room,
  ];

  // ---- one frame, everywhere.
  //
  // Every builder lays its contents out in its own room's frame with (0,0) at
  // the room's top-left, so placing a room is a single translation and every
  // anchor then resolves against the same corner the coordinates were written
  // from. There is no second, content-relative frame to fall out of step.
  const place = (room, movable) => {
    // A project room is given a cell by the treemap and rebuilt to its shape,
    // but the two never match to the unit. Its furniture is centred in the
    // result rather than pushed into a corner — safe here, and only here,
    // because a project room carries no wall-anchored props: its shelf and
    // screen are attached to the desks, so nothing resolves against the room's
    // edges.
    const band = room.plateBand ?? 0;
    const slackX = room.natural ? Math.max(0, room.w - room.natural.w) / 2 : 0;
    const slackY = room.natural ? Math.max(0, room.h - room.natural.h) / 2 : 0;
    const dx = room.x + slackX;
    const dy = room.y + band + slackY;
    translateContents(room, dx, dy);
    for (const m of movable || []) {
      m.x += dx;
      m.y += dy;
    }
    resolveAnchors(room);
  };

  place(office.room, office.officeSeats);
  // Now that the reception's furniture has real coordinates, put people on it.
  office.officeSeats = seatOffice(office.room, waitingCount);
  place(lounge.room, lounge.loungeSpots);
  if (lounge.room.kitchenZone) {
    const kz = lounge.room.zones.find((z) => z.id === 'kitchen-zone');
    if (kz) lounge.room.kitchenZone = { x: kz.x, y: kz.y, w: kz.w, h: kz.h };
  }

  /** @type {Map<string, Seat[]>} */
  const seats = new Map();
  for (const pr of projectRooms) {
    place(pr.room, pr.seats);
    seats.set(pr.room.id, pr.seats);
  }

  const walls = deriveWalls(rooms, W, H);

  // The walkable network. Agents are confined to it — see buildNavLines.
  const nav = buildNavLines(rooms, W, H);
  assignDoors(rooms, nav.lines);

  /** @type {Door[]} */
  const doors = [];
  for (const room of rooms) {
    if (room.walls !== 'full' || !room.door) continue;
    const onVertical =
      Math.abs(room.door.x - room.x) < 0.01 || Math.abs(room.door.x - (room.x + room.w)) < 0.01;
    doors.push({
      x: room.door.x,
      y: room.door.y,
      // The swing opens INTO the room, so the arc is drawn away from the
      // corridor the door gives onto.
      angle: onVertical
        ? Math.abs(room.door.x - room.x) < 0.01
          ? 0
          : Math.PI
        : Math.abs(room.door.y - room.y) < 0.01
          ? Math.PI / 2
          : -Math.PI / 2,
      width: DOOR_WIDTH,
    });
  }

  return {
    width: W,
    height: H,
    targetAspect,
    rooms,
    walls,
    nav: nav.lines,
    seats,
    officeSeats: office.officeSeats,
    loungeSpots: lounge.loungeSpots,
    // Archived sessions have no place on the floor at all.
    letGoSpots: [],
    doors,
  };
}
