/**
 * A ROOM IS DRESSED, BY RULE, AFTER IT IS FURNISHED.
 *
 * `plan-interior.js` gives a room the furniture its size is owed, and stops
 * once less than half its floor is bare. What that leaves is a room with the
 * right pieces in it and nothing that says anybody works there: bare walls, no
 * bin, nowhere to hang a coat — and, where one desk was laid in a room for six,
 * a field of carpet between the pieces.
 *
 * This runs last, on a room whose desks, benches, furniture and door are all
 * placed, and adds what a room is lived in with:
 *
 *   - **a waste bin** at the light-away end of the desks, and one at each
 *     worktree bench;
 *   - **a coat stand** beside the door, on its hinge side, in a room wide
 *     enough to hang a coat up in;
 *   - **a second place**, where there is a void to put one in: a standing
 *     table with a lamp over it, a reading corner, a booth, a whiteboard to
 *     huddle at — as many as the room's module and the look's density allow
 *     (`DECO_LEVELS`);
 *   - **a pendant lamp** over a meeting table;
 *   - **wall panels**, one to a clear stretch of wall.
 *
 * THE RULES IT MAY NOT BREAK, each asked of real plans by `deco.test.mjs`:
 *
 *   1. it moves nothing that was there: seats, room rectangles and doors are
 *      byte for byte what they were;
 *   2. nothing stands within `CHAR_CLEAR_U` of anybody's feet, inside a door,
 *      or within `WALK_CLEAR_U` of the line somebody walks from the door to
 *      their seat;
 *   3. one free-standing prop per `propClearU2()` of clear floor, counted with
 *      everything the room already had;
 *   4. no two of a kind within `SILHOUETTE_SPACING`;
 *   5. no panel within `PANEL_PLATE_CLEAR` of the plate's corner, on glazing,
 *      or on a partition that is not a wall.
 *
 * Nothing is random: every choice is a function of the room's own rectangle
 * and its own name. Pure data and pure functions. No DOM, no canvas.
 */

import { appearanceHash } from './palette.js';
import { LOOK } from './look-derive.js';
import { moduleFor } from './plan-proportions.js';
import {
  BIN,
  BIN_OFF,
  BOOTH_D,
  BOOTH_W,
  BREAKOUT_TABLE,
  COAT_STAND,
  COAT_STAND_OFF,
  FLOOR_LAMP,
  PENDANT,
  SEAT_ARMCHAIR,
  SEAT_STOOL,
  STANDING_STOOL_GAP,
  STANDING_TABLE_D,
  STANDING_TABLE_W,
  WALL_PANEL_DEPTH,
  WALL_PANEL_RUN,
  WALL_PANEL_RUN_SHORT,
} from './plan-furniture.js';
import {
  CHAR_CLEAR_U,
  COAT_ROOM_MIN_W,
  DECO_OFF_THE_FLOOR,
  DECO_ZONE_CLEAR,
  PANEL_CORNER_CLEAR,
  PANEL_PLATE_CLEAR,
  PANEL_SHARE,
  PLANTER_W,
  SILHOUETTE_SPACING,
  WALK_CLEAR_U,
  decoLevel,
  propClearU2,
} from './plan-props.js';
import {
  BOARD_STAND_DEPTH,
  BOARD_STAND_GAP,
  BOARD_STAND_RUN,
  DOOR_CLEAR_W,
  ROOM_LANE,
  WALL_GAP,
  WALL_INSET,
  WORK_BACK,
  crewFloorOf,
  workZoneOf,
} from './plan-interior.js';
import { doorBoxOf } from './plan-worktrees.js';

/** @typedef {import('./plan-units.js').Prop} Prop */
/** @typedef {import('./plan-units.js').Room} Room */
/** @typedef {import('./plan-units.js').Wall} Wall */
/** @typedef {{x:number, y:number, w:number, h:number}} Rect */
/** @typedef {'N'|'S'|'E'|'W'} Side */

/**
 * What a second place's zone is called: `deco-<what>-<n>`. `deskFootprints`
 * (`agents-seats.js`) reads the prefix — a crew's cables are routed round
 * desks, and a reading corner is not one.
 */
export const DECO_ZONE = 'deco';

/** How far along the wall from its door a coat stand may be pushed by what is already there. */
const COAT_STAND_REACH = 6;

/** Floor coverings: a thing may stand beside one and never counts as standing. */
const COVERINGS = new Set(['rug', 'rug_round', 'doormat']);
/** On a wall, on a desk or overhead: takes no floor (`props.test.mjs` has the reasons). */
const NO_FLOOR = new Set([
  ...COVERINGS,
  ...DECO_OFF_THE_FLOOR,
  'whiteboard',
  'shelf',
  'bookshelf',
  'pinboard',
  'art',
  'tv',
  'screen',
  'exit_sign',
  'mug',
  'notebook',
  'sticky',
  'desk_tray',
  'monitor',
  'fruit_bowl',
  'coffee_machine',
]);

// --------------------------------------------------------------- the measure

/** How far apart two rectangles are; 0 where they touch or overlap. @param {Rect} a @param {Rect} b */
export function gapBetween(a, b) {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

/** @param {Rect} a @param {Rect} b @param {number} [pad] */
function hits(a, b, pad = 0) {
  return (
    a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y
  );
}

/** How far a point is from a segment. */
function pointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/**
 * How far a walked line passes from a rectangle; 0 where it crosses it.
 * @param {{x:number, y:number}} a @param {{x:number, y:number}} b @param {Rect} r
 */
export function segmentToRect(a, b, r) {
  // Clip the segment to the rectangle (Liang–Barsky): any of it inside is 0.
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let inside = true;
  for (const [p, q] of [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) inside = false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
  }
  if (inside && t0 <= t1) return 0;
  // Otherwise the nearest approach is at a corner of one or an end of the other.
  let best = Infinity;
  for (const [cx, cy] of [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h],
  ]) {
    best = Math.min(best, pointToSegment(cx, cy, a.x, a.y, b.x, b.y));
  }
  for (const p of [a, b]) best = Math.min(best, gapBetween({ x: p.x, y: p.y, w: 0, h: 0 }, r));
  return best;
}

/** The room less the strip its plate is written in. @param {Room} room @returns {Rect} */
function interiorOf(room) {
  const band = room.plateBand ?? 0;
  return { x: room.x, y: room.y + band, w: room.w, h: Math.max(0, room.h - band) };
}

/** Which wall a room's door is in, or ''. @param {Room} room @returns {Side|''} */
export function doorSideOf(room) {
  const d = room.door;
  if (!d) return '';
  const near = (/** @type {number} */ p, /** @type {number} */ q) => Math.abs(p - q) < 0.01;
  if (near(d.y, room.y + room.h)) return 'S';
  if (near(d.y, room.y)) return 'N';
  return near(d.x, room.x) ? 'W' : 'E';
}

/**
 * WHAT A WALL OF THIS ROOM IS: the building's own wall, a solid one, or a
 * partition — and whether a panel may hang on it.
 *
 * Not on glazing: the light comes in through the building's top and left
 * walls, and both are a band of windows. Not on a partition that is not a
 * wall: where the look divides rooms with glass or with a waist-high run,
 * there is nothing between two rooms to hang anything on.
 *
 * @param {Room} room @param {Side} side @param {ReadonlyArray<Wall>} walls
 * @param {string} partitions the look's partition style
 * @returns {{kind:string, hangs:boolean}}
 */
export function wallOf(room, side, walls, partitions) {
  const mid =
    side === 'W' || side === 'E'
      ? { x: side === 'W' ? room.x : room.x + room.w, y: room.y + room.h / 2 }
      : { x: room.x + room.w / 2, y: side === 'N' ? room.y : room.y + room.h };
  const rank = { partition: 0, solid: 1, exterior: 2 };
  let kind = 'partition';
  for (const w of walls || []) {
    const on =
      Math.abs(w.x1 - w.x2) < 0.01
        ? Math.abs(w.x1 - mid.x) < 0.02 &&
          mid.y >= Math.min(w.y1, w.y2) &&
          mid.y <= Math.max(w.y1, w.y2)
        : Math.abs(w.y1 - mid.y) < 0.02 &&
          mid.x >= Math.min(w.x1, w.x2) &&
          mid.x <= Math.max(w.x1, w.x2);
    if (on && rank[w.kind] >= rank[/** @type {keyof typeof rank} */ (kind)]) kind = w.kind;
  }
  const glazed = kind === 'exterior' && (mid.x < 0.02 || mid.y < 0.02);
  const hangs = kind === 'partition' ? partitions === 'solid' : !glazed;
  return { kind, hangs };
}

// ------------------------------------------------------------- the dressing

/**
 * DRESS ONE PROJECT ROOM, in place: props, and the zones they stand in, are
 * appended to it. Nothing that was there is moved.
 *
 * @param {Room} room placed, furnished, `door` set
 * @param {ReadonlyArray<{x:number, y:number}>} [people] every seat in it: its
 *   desks' and its benches'
 * @param {{walls?:ReadonlyArray<Wall>}} [opts] the floor's walls, for what a
 *   panel may hang on
 * @returns {{added:Prop[], places:{name:string, rect:Rect}[]}} what it laid,
 *   and the second places among it, for a test
 */
export function decorateRoom(room, people = [], opts = {}) {
  /** @type {Prop[]} */
  const added = [];
  /** @type {{name:string, rect:Rect}[]} */
  const places = [];
  if (!room || room.kind !== 'project' || room.pinned === true) return { added, places };
  const desks = (room.zones || []).find((z) => z.id === 'desk-group');
  if (!desks) return { added, places };
  const level = decoLevel();
  const at = interiorOf(room);
  const right = at.x + at.w;
  const bottom = at.y + at.h;
  const seed = appearanceHash(`deco:${room.id}`);
  const door = room.door || null;
  const doorBox = doorBoxOf(room);
  const doorSide = doorSideOf(room);
  const feet = people.map((s) => ({ x: s.x - 0.5, y: s.y - 0.5, w: 1, h: 1 }));
  const work = workZoneOf(room);
  const crew = crewFloorOf(room);
  /** @type {Rect[]} the desks and the floor round them, and a crew's: nobody's to dress */
  const keep = [];
  if (work) {
    keep.push({
      x: work.x - ROOM_LANE,
      y: work.y - WORK_BACK,
      w: work.w + ROOM_LANE * 2,
      h: work.h + WORK_BACK * 2,
    });
  }
  if (crew) keep.push(crew);
  /**
   * The narrower floor a single small piece keeps off: the desks, and the
   * strip behind each row of them where a junior sits.
   * @type {Rect[]}
   */
  const behind = [];
  if (work) {
    behind.push({ x: work.x, y: work.y - WORK_BACK, w: work.w, h: work.h + WORK_BACK * 2 });
  }
  if (crew) behind.push(crew);

  // ---- the rules, as questions about one rectangle.
  const inRoom = (/** @type {Rect} */ r, pad = 0) =>
    r.x >= at.x + pad - 1e-9 &&
    r.y >= at.y + pad - 1e-9 &&
    r.x + r.w <= right - pad + 1e-9 &&
    r.y + r.h <= bottom - pad + 1e-9;
  const offFeet = (/** @type {Rect} */ r) =>
    feet.every((f) => gapBetween(r, f) >= CHAR_CLEAR_U + 1e-6);
  const offPaths = (/** @type {Rect} */ r) =>
    !door || people.every((s) => segmentToRect(door, s, r) >= WALK_CLEAR_U - 1e-9);
  const offDoor = (/** @type {Rect} */ r) => !doorBox || !hits(r, doorBox);
  /** Everything standing in the room now, what this pass has added included. */
  const standing = () => room.props.filter((p) => !NO_FLOOR.has(p.kind));
  const offProps = (/** @type {Rect} */ r, pad = 0) =>
    !room.props.some((p) => !COVERINGS.has(p.kind) && p.kind !== 'pendant' && hits(r, p, pad));
  /** No two of a kind within sight of each other. */
  const alone = (/** @type {string} */ kind, /** @type {Rect} */ r) =>
    !room.props.some((p) => p.kind === kind && gapBetween(r, p) < SILHOUETTE_SPACING - 1e-9);
  /** One free-standing prop per so much clear floor, this one counted. */
  const afforded = (/** @type {Rect[]} */ rects) => {
    const all = [...standing(), ...rects];
    const taken = all.reduce((a, p) => a + p.w * p.h, 0);
    return all.length <= Math.floor(Math.max(0, at.w * at.h - taken) / propClearU2());
  };

  /**
   * Write a prop down where its own anchor says, and remember it.
   * @param {any} prop its kind, size and anchor; `x` and `y` are derived
   */
  const lay = (prop) => {
    const a = prop.anchor;
    if (a.type === 'zone') {
      const z = room.zones.find((q) => q.id === a.of);
      prop.x = /** @type {Rect} */ (z).x + a.dx;
      prop.y = /** @type {Rect} */ (z).y + a.dy;
    } else if (a.side === 'N') {
      prop.x = at.x + a.along;
      prop.y = at.y + a.inset;
    } else if (a.side === 'S') {
      prop.x = at.x + a.along;
      prop.y = bottom - a.inset - prop.h;
    } else if (a.side === 'W') {
      prop.x = at.x + a.inset;
      prop.y = at.y + a.along;
    } else {
      prop.x = right - a.inset - prop.w;
      prop.y = at.y + a.along;
    }
    room.props.push(prop);
    added.push(prop);
    return prop;
  };
  // ---- a bin at the desks, and one at each bench.
  //
  // At the light-away end — the light travels down and to the right, so that
  // is the east end, level with the foot of the last table — and `BIN_OFF` off
  // the cluster, which is the edge of the rug the desks stand on.
  /** @type {{zone:Rect & {id:string}, row:Rect}[]} */
  const clusters = [];
  const tables = room.props.filter(
    (p) => p.kind === 'desk' && /-table-\d+-top$/.test(String(p.id || '')),
  );
  if (tables.length) {
    const last = tables.reduce((a, p) =>
      p.x + p.w > a.x + a.w + 1e-9 || (Math.abs(p.x + p.w - a.x - a.w) < 1e-9 && p.y > a.y) ? p : a,
    );
    clusters.push({ zone: /** @type {any} */ (desks), row: last });
  }
  for (const z of room.zones.filter((q) => /^worktree-\d+$/.test(String(q.id)))) {
    const top = room.props.find((p) => p.kind === 'desk' && p.id === `${z.id}-top`);
    if (top) clusters.push({ zone: /** @type {any} */ (z), row: top });
  }
  for (const { zone, row } of clusters) {
    const ys = [row.y + row.h - BIN, row.y, zone.y + zone.h - BIN, zone.y];
    const xs = [zone.x + zone.w + BIN_OFF, zone.x - BIN_OFF - BIN];
    /** @type {Rect|null} */
    let spot = null;
    for (const x of xs) {
      for (const y of ys) {
        const r = { x, y, w: BIN, h: BIN };
        if (!inRoom(r, WALL_INSET) || !offFeet(r) || !offPaths(r) || !offDoor(r)) continue;
        if (!offProps(r, 0.15) || !alone('bin', r) || !afforded([r])) continue;
        if (crew && hits(r, crew)) continue;
        spot = r;
        break;
      }
      if (spot) break;
    }
    if (!spot) continue;
    lay({
      kind: 'bin',
      w: BIN,
      h: BIN,
      angle: 0,
      anchor: { type: 'zone', of: zone.id, dx: spot.x - zone.x, dy: spot.y - zone.y },
    });
  }

  // ---- a coat stand inside the door, on its hinge side.
  //
  // A door hangs from the jamb nearer the origin (`paintDoorSwing`): the west
  // one in a wall that runs across, the north one in a wall that runs down. The
  // stand is just past the floor the door swings over, `COAT_STAND_OFF` off
  // the wall; where that side is taken it stands on the other.
  if (door && doorSide && room.w >= COAT_ROOM_MIN_W - 1e-9) {
    const across = doorSide === 'S' || doorSide === 'N';
    const half = DOOR_CLEAR_W / 2 + 0.2;
    const mid = across ? door.x : door.y;
    // Beside the door, hinge side first; and where a plant or a shelf has that
    // floor, a step further along the wall at a time, either way.
    /** @type {number[]} */
    const tries = [];
    for (let step = 0; step <= COAT_STAND_REACH + 1e-9; step += 0.5) {
      tries.push(mid - half - COAT_STAND - step, mid + half + step);
    }
    for (const from of tries) {
      const along = from - (across ? at.x : at.y);
      /** @type {Rect} */
      const r = across
        ? {
            x: from,
            y: doorSide === 'S' ? bottom - COAT_STAND_OFF - COAT_STAND : at.y + COAT_STAND_OFF,
            w: COAT_STAND,
            h: COAT_STAND,
          }
        : {
            x: doorSide === 'W' ? at.x + COAT_STAND_OFF : right - COAT_STAND_OFF - COAT_STAND,
            y: from,
            w: COAT_STAND,
            h: COAT_STAND,
          };
      if (!inRoom(r, WALL_INSET) || !offFeet(r) || !offPaths(r) || !offDoor(r)) continue;
      if (!offProps(r, 0.4) || behind.some((k) => hits(r, k)) || !afforded([r])) continue;
      lay({
        kind: 'coat_stand',
        w: COAT_STAND,
        h: COAT_STAND,
        angle: 0,
        anchor: { type: 'wall', side: doorSide, along, inset: COAT_STAND_OFF },
      });
      break;
    }
  }

  // ---- a second place, where there is a void to put one in.
  /** What a group may not stand on or crowd. @returns {Rect[]} */
  const blockers = () => [
    ...room.props.filter((p) => p.kind !== 'pendant'),
    ...keep,
    ...(doorBox ? [doorBox] : []),
  ];
  /**
   * How much clear floor a rectangle has round it; walls count unless it is
   * against one. Stops at `floor`: a place no better than the best so far is
   * not measured to the end.
   * @param {Rect} r @param {Side|''} against @param {Rect[]} solid @param {number} floor
   */
  const clearance = (r, against, solid, floor) => {
    let c = Infinity;
    if (against !== 'W') c = Math.min(c, r.x - at.x);
    if (against !== 'E') c = Math.min(c, right - r.x - r.w);
    if (against !== 'N') c = Math.min(c, r.y - at.y);
    if (against !== 'S') c = Math.min(c, bottom - r.y - r.h);
    for (let i = 0; i < solid.length && c > floor; i++) c = Math.min(c, gapBetween(r, solid[i]));
    return c;
  };
  /**
   * The emptiest place a `w` by `h` group can stand: free on the floor, or
   * against one of the walls, with at least `DECO_ZONE_CLEAR` round it.
   * @param {number} w @param {number} h @param {ReadonlyArray<Side|''>} sides
   * @returns {{rect:Rect, side:Side|''}|null}
   */
  const emptiest = (w, h, sides) => {
    /** @type {{rect:Rect, side:Side|''}|null} */
    let best = null;
    let most = DECO_ZONE_CLEAR - 1e-9;
    const step = 0.5;
    const solid = blockers();
    for (const side of sides) {
      const upright = side === 'W' || side === 'E';
      const gw = upright ? h : w;
      const gh = upright ? w : h;
      /** @type {Rect[]} */
      const spots = [];
      if (side === '') {
        for (let y = at.y; y + h <= bottom + 1e-9; y += step) {
          for (let x = at.x; x + w <= right + 1e-9; x += step) spots.push({ x, y, w, h });
        }
      } else if (upright) {
        const x = side === 'W' ? at.x + WALL_INSET : right - WALL_INSET - gw;
        for (let y = at.y; y + gh <= bottom + 1e-9; y += step) spots.push({ x, y, w: gw, h: gh });
      } else {
        const y = side === 'N' ? at.y + WALL_INSET : bottom - WALL_INSET - gh;
        for (let x = at.x; x + gw <= right + 1e-9; x += step) spots.push({ x, y, w: gw, h: gh });
      }
      for (const r of spots) {
        const c = clearance(r, side, solid, most + 1e-9);
        if (c <= most + 1e-9) continue;
        if (!offFeet(r) || !offPaths(r)) continue;
        most = c;
        best = { rect: r, side };
      }
    }
    return best;
  };

  const module = room.kit || room.module || moduleFor({ desks: people.length, crew: 0 });
  const owed = level.zones[/** @type {'S'|'M'|'L'} */ (module)] ?? 0;
  /** Which way a piece against a wall faces: into the room. */
  const facing = { W: 0, E: Math.PI, N: Math.PI / 2, S: -Math.PI / 2 };
  /** The walls a group may stand against: not the one the plate is over. */
  const walls = /** @type {Side[]} */ (['W', 'E', 'S']);
  const recipes = {
    /** A standing table, three stools down one side, a lamp over it. */
    standup: () => {
      const deep = STANDING_TABLE_D + STANDING_STOOL_GAP + SEAT_STOOL;
      const spot = emptiest(STANDING_TABLE_W, deep, ['']);
      if (!spot) return null;
      const pitch = (STANDING_TABLE_W - SEAT_STOOL) / 2;
      // The stools are on the side nearer the middle of the room.
      const below = spot.rect.y + deep / 2 < at.y + at.h / 2;
      const tableY = below ? 0 : SEAT_STOOL + STANDING_STOOL_GAP;
      /** @type {any[]} */
      const parts = [
        { kind: 'standing_table', x: 0, y: tableY, w: STANDING_TABLE_W, h: STANDING_TABLE_D },
        ...[0, 1, 2].map((i) => ({
          kind: 'bar_stool',
          x: i * pitch,
          y: below ? STANDING_TABLE_D + STANDING_STOOL_GAP : 0,
          w: SEAT_STOOL,
          h: SEAT_STOOL,
        })),
      ];
      if (level.pendants) {
        parts.push({
          kind: 'pendant',
          x: (STANDING_TABLE_W - PENDANT) / 2,
          y: tableY + (STANDING_TABLE_D - PENDANT) / 2,
          w: PENDANT,
          h: PENDANT,
        });
      }
      return { rect: spot.rect, parts };
    },
    /** A reading corner: an armchair with its back to a wall, a lamp, a small table. */
    reading: () => {
      const along = FLOOR_LAMP + 0.3 + SEAT_ARMCHAIR;
      const deep = Math.max(SEAT_ARMCHAIR, FLOOR_LAMP + 0.2 + BREAKOUT_TABLE);
      const spot = emptiest(along, deep, walls);
      if (!spot || spot.side === '') return null;
      const upright = spot.side === 'W' || spot.side === 'E';
      const far = spot.side === 'E' || spot.side === 'S';
      /** A part `a` along the wall and `d` off it, `l` long and `t` deep. */
      const part = (
        /** @type {string} */ kind,
        /** @type {number} */ a,
        /** @type {number} */ d,
        /** @type {number} */ l,
        /** @type {number} */ t,
        angle = 0,
      ) => {
        const off = far ? deep - d - t : d;
        return upright
          ? { kind, x: off, y: a, w: t, h: l, angle }
          : { kind, x: a, y: off, w: l, h: t, angle };
      };
      /** @type {any[]} */
      const parts = [
        part('lamp', 0, 0, FLOOR_LAMP, FLOOR_LAMP),
        part('side_table', 0.1, FLOOR_LAMP + 0.2, BREAKOUT_TABLE, BREAKOUT_TABLE),
        part('armchair', FLOOR_LAMP + 0.3, 0, SEAT_ARMCHAIR, SEAT_ARMCHAIR, facing[spot.side]),
      ];
      if (!alone('lamp', spot.rect)) return null;
      return { rect: spot.rect, parts, side: spot.side };
    },
    /** A standing whiteboard and two stools in front of it: somewhere to think aloud. */
    huddle: () => {
      const deep = BOARD_STAND_DEPTH + BOARD_STAND_GAP + SEAT_STOOL;
      const spot = emptiest(BOARD_STAND_RUN, deep, ['']);
      if (!spot || !alone('board_stand', spot.rect)) return null;
      // The board is on the side nearer a wall, so whoever sits faces it.
      const below = spot.rect.y + deep / 2 < at.y + at.h / 2;
      const mid = BOARD_STAND_RUN / 2;
      return {
        rect: spot.rect,
        parts: [
          {
            kind: 'board_stand',
            tall: true,
            x: 0,
            y: below ? 0 : deep - BOARD_STAND_DEPTH,
            w: BOARD_STAND_RUN,
            h: BOARD_STAND_DEPTH,
          },
          ...[-1, 1].map((k) => ({
            kind: 'bar_stool',
            x: mid + (k < 0 ? -SEAT_STOOL - 0.2 : 0.2),
            y: below ? deep - SEAT_STOOL : 0,
            w: SEAT_STOOL,
            h: SEAT_STOOL,
          })),
        ],
      };
    },
    /** A booth for a call, its back to a wall and open to the room. */
    booth: () => {
      const spot = emptiest(BOOTH_W, BOOTH_D, walls);
      if (!spot || spot.side === '') return null;
      const { rect } = spot;
      return {
        rect,
        side: spot.side,
        parts: [{ kind: 'booth', x: 0, y: 0, w: rect.w, h: rect.h, angle: facing[spot.side] }],
      };
    },
  };
  // A room's own name decides which it is given first, so three rooms in a row
  // are not three reading corners.
  const order = /** @type {(keyof typeof recipes)[]} */ (['standup', 'reading', 'booth', 'huddle']);
  for (let i = 0, laid = 0; i < order.length && laid < owed; i++) {
    const name = order[(i + seed) % order.length];
    const made = recipes[name]();
    if (!made) continue;
    /** @type {any[]} every part where it will stand */
    const abs = made.parts.map((p) => ({ ...p, x: made.rect.x + p.x, y: made.rect.y + p.y }));
    if (!afforded(abs.filter((p) => !NO_FLOOR.has(p.kind)))) continue;
    // A place is a zone of the room, as a meeting table's is: every piece of
    // it is anchored to it, so nothing in it floats (§3.3).
    const id = `${DECO_ZONE}-${name}-${laid}`;
    room.zones.push({ id, ...made.rect });
    places.push({ name, rect: made.rect });
    for (const p of made.parts) {
      lay({ angle: 0, ...p, anchor: { type: 'zone', of: id, dx: p.x, dy: p.y } });
    }
    laid++;
    // Lively: a planter run between a reading corner and the room.
    if (name === 'reading' && level.screens) screen(made.rect, id);
  }

  /** A planter run along the open long side of a group. @param {Rect} g @param {string} id */
  function screen(g, id) {
    const wide = g.w >= g.h;
    const run = wide ? g.w : g.h;
    /** @type {Rect[]} */
    const sides = wide
      ? [
          { x: g.x, y: g.y - 0.6 - PLANTER_W, w: run, h: PLANTER_W },
          { x: g.x, y: g.y + g.h + 0.6, w: run, h: PLANTER_W },
        ]
      : [
          { x: g.x - 0.6 - PLANTER_W, y: g.y, w: PLANTER_W, h: run },
          { x: g.x + g.w + 0.6, y: g.y, w: PLANTER_W, h: run },
        ];
    for (const r of sides) {
      if (!inRoom(r, WALL_GAP) || !offFeet(r) || !offPaths(r) || !offDoor(r)) continue;
      if (!offProps(r, 0.4) || keep.some((k) => hits(r, k))) continue;
      if (!alone('planter', r) || !afforded([r])) continue;
      lay({
        kind: 'planter',
        w: r.w,
        h: r.h,
        angle: 0,
        anchor: { type: 'zone', of: id, dx: r.x - g.x, dy: r.y - g.y },
      });
      return;
    }
  }

  // ---- a lamp over a meeting table.
  if (level.pendants) {
    for (const table of room.props.filter((p) => p.kind === 'meeting_table')) {
      const zone = room.zones.find((z) => table.anchor.type === 'zone' && z.id === table.anchor.of);
      if (!zone) continue;
      const r = {
        x: table.x + (table.w - PENDANT) / 2,
        y: table.y + (table.h - PENDANT) / 2,
        w: PENDANT,
        h: PENDANT,
      };
      if (!alone('pendant', r) || !offFeet(r)) continue;
      lay({
        kind: 'pendant',
        w: PENDANT,
        h: PENDANT,
        angle: 0,
        anchor: { type: 'zone', of: zone.id, dx: r.x - zone.x, dy: r.y - zone.y },
      });
    }
  }

  // ---- panels, one to a clear stretch of wall.
  const partitions = LOOK.partitions?.id || 'solid';
  const plate = { x: room.x, y: room.y, w: 0, h: 0 };
  let hung = 0;
  // The wall facing the door first, then the others: what somebody sees coming in.
  const opposite = { S: 'N', N: 'S', W: 'E', E: 'W', '': 'S' }[doorSide];
  const sidesInOrder = /** @type {Side[]} */ (
    ['W', 'E', 'S'].sort((a, b) => Number(b === opposite) - Number(a === opposite))
  );
  for (const side of sidesInOrder) {
    if (hung >= level.panels) break;
    if (!wallOf(room, side, opts.walls || [], partitions).hangs) continue;
    const upright = side !== 'S';
    const lo = (upright ? at.y : at.x) + PANEL_CORNER_CLEAR;
    const hi = (upright ? bottom : right) - PANEL_CORNER_CLEAR;
    // On the wall's own face: a wall is drawn on the room's edge and stands a
    // fifth of a unit into it.
    const flush = WALL_INSET * (2 / 3);
    const reach = flush + WALL_PANEL_DEPTH + 0.6;
    /** @type {Rect} the strip of floor in front of this wall */
    const strip = upright
      ? { x: side === 'W' ? at.x : right - reach, y: lo, w: reach, h: hi - lo }
      : { x: lo, y: bottom - reach, w: hi - lo, h: reach };
    const taken = [...room.props.filter((p) => !COVERINGS.has(p.kind)), doorBox].filter(
      (p) => !!p && hits(/** @type {Rect} */ (p), strip),
    );
    const blocked = /** @type {Rect[]} */ (taken)
      .map((p) =>
        upright ? [p.y - WALL_GAP, p.y + p.h + WALL_GAP] : [p.x - WALL_GAP, p.x + p.w + WALL_GAP],
      )
      .sort((a, b) => a[0] - b[0]);
    let cursor = lo;
    for (const [from, to] of [...blocked, [hi, hi]]) {
      const clear = from - cursor;
      // One to a share of clear wall, and one where the wall is short of a
      // share and still long enough to hang a panel with room either side.
      const fits = clear >= WALL_PANEL_RUN + PANEL_CORNER_CLEAR * 2;
      const shares = Math.max(fits ? 1 : 0, Math.floor(clear / PANEL_SHARE));
      for (let i = 0; i < shares && hung < level.panels; i++) {
        const split = (seed + hung) % 3 === 1 ? 2 : 1;
        const run = (seed + hung) % 3 === 2 ? WALL_PANEL_RUN_SHORT : WALL_PANEL_RUN;
        const along = cursor + (clear / shares) * (i + 0.5) - run / 2;
        /** @type {Rect} */
        const r = upright
          ? {
              x: side === 'W' ? at.x + flush : right - flush - WALL_PANEL_DEPTH,
              y: along,
              w: WALL_PANEL_DEPTH,
              h: run,
            }
          : { x: along, y: bottom - flush - WALL_PANEL_DEPTH, w: run, h: WALL_PANEL_DEPTH };
        if (gapBetween(r, plate) < PANEL_PLATE_CLEAR || !alone('wall_panel', r)) continue;
        if (!offFeet(r) || !offDoor(r)) continue;
        lay({
          kind: 'wall_panel',
          w: r.w,
          h: r.h,
          angle: 0,
          split,
          mk: room.projectMk,
          anchor: { type: 'wall', side, along: along - (upright ? at.y : at.x), inset: flush },
        });
        hung++;
      }
      cursor = Math.max(cursor, to);
    }
  }

  return { added, places };
}
