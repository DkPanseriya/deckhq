/**
 * THE PROPORTIONS OF THE FLOOR — the interior designer's rulebook.
 *
 * The owner, looking at his own floor on a 2000 x 1185 window: _"Project rooms
 * should occupy the majority of the area, not just the lounge and boss office.
 * We cannot make one room very big and the others really thin rectangles."_ On
 * that floor the lounge had 40% of the building and the reception 17%; five
 * project rooms shared 35%, one of them a hall round a single desk and four of
 * them strips showing a desk top.
 *
 * Every rule a floor is held to is a named number in this file with the reason
 * beside it, and every one of them is MEASURED on a finished plan by
 * `measureProportions` rather than asserted by the code that laid it:
 * `proportionFaults` is the list a test, and `plan.proportions`, both read.
 *
 * WHAT IS HERE. The area budget, the shape and the size family of a room, the
 * row grid (`splitRow`, `dealRows`, `layGrid`), who stands in the lounge and who
 * is behind its chip (`restingOnFloor`), and the measurement. What is NOT here
 * is which building those rules are laid into — the service rooms' furniture
 * and the search for the smallest floor that keeps every rule are
 * `plan-grid.js`'s, because they need the room builders and this file needs
 * nothing.
 *
 * Pure arithmetic. No DOM, no clock, no randomness, no imports.
 */

// ---------------------------------------------------------------- (a) area

/**
 * The project rooms take at least this much of the building's interior, once
 * there is one. They are what the product is for; a floor whose service rooms
 * are the larger half is a lobby with desks in it.
 */
export const ROOMS_AREA_MIN = 0.55;

/** Your Office takes at most a fifth: a reception is read first, not most. */
export const OFFICE_AREA_MAX = 0.2;

/** The lounge takes at most a quarter: rest is a corner of an office, not half of it. */
export const LOUNGE_AREA_MAX = 0.25;

// --------------------------------------------------------------- (b) shape

/** Narrower than this for its depth and a room is a slot with a desk in it. */
export const ROOM_RATIO_MIN = 0.7;

/** Wider than this for its depth and it is a strip showing a desk top. */
export const ROOM_RATIO_MAX = 1.8;

/** The shape a room is laid towards: a little wider than deep, as a desk row is. */
export const ROOM_RATIO_IDEAL = 1.2;

// ---------------------------------------------------------- (c) size family

/**
 * THE THREE MODULES, as floor area relative to the smallest: one desk, a small
 * team, a large one. A step of 1.5 is the smallest the eye reads as "the bigger
 * room" at fit scale, and two steps stay inside `ROOM_AREA_SPREAD_MAX`.
 */
export const MODULE_WEIGHTS = Object.freeze({ S: 1, M: 1.5, L: 2.25 });

/** Two desks make a team: the first table that seats people side by side. */
export const MODULE_M_DESKS = 2;

/** Five desks is past one four-seat table, so the room holds a second cluster. */
export const MODULE_L_DESKS = 5;

/** A crew formation (three juniors on the floor) needs a team room's floor. */
export const MODULE_M_CREW = 3;

/** Six in a formation is an arc as wide as two tables: a large room's floor. */
export const MODULE_L_CREW = 6;

/** No room is more than this many times the smallest room on the floor. */
export const ROOM_AREA_SPREAD_MAX = 2.5;

/**
 * A PINNED room nobody is in may stay small — this much of a one-desk room —
 * but never so small that the largest room passes the spread bound against it
 * (`PINNED_SPREAD` leaves the grid's own stretch some room under 2.5).
 */
export const PINNED_WEIGHT = 0.6;
export const PINNED_SPREAD = 2.25;

// ---------------------------------------------------------------- (d) rows

/** One to three rows of rooms is a floor the eye counts; more is a spreadsheet. */
export const ROWS_MAX = 3;

/**
 * Past what three rows can hold at a legal shape (about two dozen rooms on a
 * wide window) the row count grows instead of the rooms becoming strips. This
 * is where it stops; a floor past it is laid at its least-bad grid.
 */
export const ROWS_LIMIT = 8;

/** Rows are near-equal in depth: the deepest is at most this much past the shallowest. */
export const ROW_DEPTH_SPREAD_MAX = 0.15;

// ----------------------------------------------------------- (e) lights off

/**
 * A room with nobody at its desks is drawn with the lights off: its floor and
 * furniture this far towards the theme's dark. A third reads as "dark room" at
 * fit scale and still shows the desk that is waiting for somebody.
 */
export const LIGHTS_OFF_DIM = 0.35;

/** A dimmed room's plate is still the plate: WCAG AA for its text. */
export const DIM_PLATE_CONTRAST_MIN = 4.5;

// --------------------------------------------------------------- (g) lounge

/** The lounge draws its seats and ONE standing row; everybody past it is the chip. */
export const LOUNGE_STANDING_ROWS = 1;

// --------------------------------------------------------------- (h) window

/** The building covers at least this much of the window on both axes (audit F2). */
export const WINDOW_FILL_MIN = 0.96;

/** Comparisons on laid geometry, in plan units. */
const EPS = 1e-6;

// ------------------------------------------------------------------ modules

/**
 * The module a room is laid at, from what stands in it.
 * @param {{desks?:number, crew?:number}} need `desks`: people at desks;
 *   `crew`: the largest formation on its floor, 0 for none
 * @returns {'S'|'M'|'L'}
 */
export function moduleFor(need) {
  const desks = Math.max(0, Math.floor(Number(need?.desks) || 0));
  const crew = Math.max(0, Math.floor(Number(need?.crew) || 0));
  if (desks >= MODULE_L_DESKS || crew >= MODULE_L_CREW) return 'L';
  if (desks >= MODULE_M_DESKS || crew >= MODULE_M_CREW) return 'M';
  return 'S';
}

/**
 * The weight a pinned, empty room is laid at beside these rooms.
 * @param {number[]} weights the weights of the rooms with people in them
 */
export function pinnedWeight(weights) {
  const largest = Math.max(0, ...(Array.isArray(weights) ? weights : []));
  return Math.max(PINNED_WEIGHT, largest / PINNED_SPREAD);
}

// --------------------------------------------------------------------- rows

/**
 * Which rows have a corridor under them.
 *
 * A corridor serves the row above it and the row below it, so rows are paired
 * across one: `row, corridor, row`. An odd last row takes a corridor of its own
 * above it. One corridor for two rows, two for three or four, three for five.
 *
 * @param {number} rows
 * @returns {boolean[]} `rows - 1` flags: a corridor between row k and row k+1
 */
export function corridorsBetween(rows) {
  const n = Math.max(1, Math.floor(Number(rows) || 1));
  const out = [];
  for (let k = 0; k < n - 1; k++) out.push(k % 2 === 0 || k === n - 2);
  return out;
}

/**
 * The narrowest a room may be laid in a row of this depth: the shape bound, or
 * its furniture, whichever is wider.
 * @param {{w:number,h:number}[]|undefined} footprints ways its furniture can
 *   stand; none means no furniture to clear
 * @param {number} depth
 */
function narrowest(footprints, depth) {
  let furniture = 0;
  if (Array.isArray(footprints) && footprints.length) {
    furniture = Infinity;
    for (const f of footprints) if (f.h <= depth + EPS) furniture = Math.min(furniture, f.w);
  }
  return Math.max(ROOM_RATIO_MIN * depth, furniture);
}

/**
 * ONE ROW: share a width between rooms of one depth.
 *
 * Each room's width is in proportion to its weight, held inside the shape
 * bounds — `ROOM_RATIO_MIN` to `ROOM_RATIO_MAX` of the depth — and never under
 * its furniture. Where a bound binds, the rooms it does not bind share what is
 * left, so the widths always sum to the row exactly: no leftover cell.
 *
 * `give` is for a row that shares its band with a service room. The rooms come
 * first: they take the width up to the widest shape they may be, and only what
 * is past that — at most `give` — is handed back to the room beside them. The
 * widths then sum to less than `width`, and the caller widens its neighbour.
 *
 * @param {number[]} weights
 * @param {number} width the row's width
 * @param {number} depth the row's depth
 * @param {({w:number,h:number}[]|undefined)[]} [footprints] per room
 * @param {number} [give] the most of `width` the rooms may leave untaken
 * @returns {number[]|null} one width per room, or null where no legal split exists
 */
export function splitRow(weights, width, depth, footprints = [], give = 0) {
  const n = weights.length;
  if (!n || !(width > 0) || !(depth > 0)) return null;
  const hi = ROOM_RATIO_MAX * depth;
  const lo = weights.map((_, i) => narrowest(footprints[i], depth));
  if (lo.some((v) => v > hi + EPS)) return null;
  let least = 0;
  for (const v of lo) least += v;
  if (least > width + EPS) return null;
  if (n * hi < width - EPS) return width - n * hi <= give + EPS ? weights.map(() => hi) : null;
  // Water-filling. Share what is left by weight; hold whichever side is the
  // further out of bounds at its bound; share again. Each pass holds at least
  // one room, so it ends in at most `n` of them and the sum is the row.
  /** @type {number[]} */
  const out = Array(n).fill(-1);
  let rest = width;
  let open = 0;
  for (const m of weights) open += m;
  for (let pass = 0; pass <= n; pass++) {
    const k = rest / Math.max(1e-12, open);
    let under = 0;
    let over = 0;
    for (let i = 0; i < n; i++) {
      if (out[i] >= 0) continue;
      const v = k * weights[i];
      if (v < lo[i]) under += lo[i] - v;
      else if (v > hi) over += v - hi;
    }
    const low = under >= over;
    let held = false;
    for (let i = 0; i < n; i++) {
      if (out[i] >= 0) continue;
      const v = k * weights[i];
      if (under + over <= EPS) out[i] = v;
      else if (low ? v < lo[i] : v > hi) {
        out[i] = low ? lo[i] : hi;
        rest -= out[i];
        open -= weights[i];
        held = true;
      }
    }
    if (!held) break;
  }
  // The last float of error goes to the widest room, where it is smallest.
  let widest = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += out[i];
    if (out[i] > out[widest]) widest = i;
  }
  out[widest] += width - total;
  return out;
}

/**
 * DEAL the rooms, in floor order, into rows.
 *
 * Every row takes a run of consecutive rooms and none is left empty. Among the
 * deals whose every row has a legal `splitRow`, the one chosen keeps each room
 * closest to the area its module asks for and to `ROOM_RATIO_IDEAL` — summed
 * over rooms, so the choice is one dynamic programme and the same floor is
 * dealt the same way on every machine.
 *
 * @param {number[]} weights
 * @param {{w:number,d:number,give?:number}[]} bands each row's width and depth,
 *   top to bottom, and what it may hand back to a service room (`splitRow`)
 * @param {({w:number,h:number}[]|undefined)[]} [footprints]
 * @returns {{starts:number[], widths:number[][]}|null} `starts[k]` is the first
 *   room of row k
 */
export function dealRows(weights, bands, footprints = []) {
  const n = weights.length;
  const rows = bands.length;
  if (!rows || n < rows) return null;
  const total = weights.reduce((a, v) => a + v, 0);
  const unit = bands.reduce((a, b) => a + b.w * b.d, 0) / Math.max(1e-9, total);
  // How many rooms a row can hold at all is a matter of the shape bounds, and
  // most runs are outside it: asked first, it is what keeps forty rooms cheap.
  const most = bands.map((b) => Math.floor(b.w / (ROOM_RATIO_MIN * b.d) + EPS));
  const fewest = bands.map((b) =>
    Math.max(1, Math.ceil((b.w - (b.give ?? 0)) / (ROOM_RATIO_MAX * b.d) - EPS)),
  );
  const sumOf = (/** @type {number[]} */ list) => list.reduce((a, v) => a + v, 0);
  if (n > sumOf(most) || n < sumOf(fewest)) return null;
  /** @type {Map<string, {cost:number, widths:number[]}|null>} */
  const memo = new Map();
  const row = (/** @type {number} */ k, /** @type {number} */ i, /** @type {number} */ j) => {
    if (j - i > most[k] || j - i < fewest[k]) return null;
    const key = `${k}:${i}:${j}`;
    if (memo.has(key)) return memo.get(key);
    const band = bands[k];
    const widths = splitRow(
      weights.slice(i, j),
      band.w,
      band.d,
      footprints.slice(i, j),
      band.give ?? 0,
    );
    let got = null;
    if (widths) {
      let cost = 0;
      widths.forEach((w, at) => {
        const size = Math.log((w * band.d) / (unit * weights[i + at]));
        const shape = Math.log(w / band.d / ROOM_RATIO_IDEAL);
        cost += size * size + 0.25 * shape * shape;
      });
      got = { cost, widths };
    }
    memo.set(key, got);
    return got;
  };
  // best[k][j]: the cheapest deal of the first j rooms into the first k rows.
  /** @type {{cost:number, from:number}[][]} */
  const best = Array.from({ length: rows + 1 }, () =>
    Array.from({ length: n + 1 }, () => ({ cost: Infinity, from: -1 })),
  );
  best[0][0] = { cost: 0, from: -1 };
  for (let k = 1; k <= rows; k++) {
    for (let j = k; j <= n - (rows - k); j++) {
      for (let i = Math.max(k - 1, j - most[k - 1]); i <= j - fewest[k - 1]; i++) {
        if (!Number.isFinite(best[k - 1][i].cost)) continue;
        const got = row(k - 1, i, j);
        if (!got) continue;
        const cost = best[k - 1][i].cost + got.cost;
        if (cost < best[k][j].cost - 1e-12) best[k][j] = { cost, from: i };
      }
    }
  }
  if (!Number.isFinite(best[rows][n].cost)) return null;
  const starts = Array(rows).fill(0);
  const widths = Array(rows).fill(null);
  for (let k = rows, j = n; k >= 1; k--) {
    const i = best[k][j].from;
    starts[k - 1] = i;
    widths[k - 1] = /** @type {{widths:number[]}} */ (row(k - 1, i, j)).widths;
    j = i;
  }
  return { starts, widths };
}

/**
 * How far the module weights are flattened before a grid is given up on. The
 * family is "about" 1 : 1.5 : 2.25; a floor whose rows cannot hold those areas
 * inside the spread bound is laid at a gentler family rather than at a strip.
 */
const FLATTEN = Object.freeze([1, 0.8, 0.6, 0.4, 0.2, 0]);

/**
 * THE GRID: every room a cell, every row one depth, nothing left over.
 *
 * A row's rooms end at its band's right edge. Where a band has `give` and its
 * rooms did not take all of it, they start that much in from the left, and
 * `taken[k]` says how much of the band they used.
 *
 * @param {number[]} weights one per room, in floor order
 * @param {{x:number,y:number,w:number,d:number,give?:number}[]} bands the
 *   rectangle each row of rooms has, top to bottom
 * @param {({w:number,h:number}[]|undefined)[]} [footprints]
 * @returns {{cells:{x:number,y:number,w:number,h:number,row:number}[],
 *   taken:number[], spread:number, flatten:number}|null} null where no deal
 *   keeps every rule
 */
export function layGrid(weights, bands, footprints = []) {
  for (const power of FLATTEN) {
    const flat = weights.map((m) => Math.pow(Math.max(1e-6, m), power));
    const deal = dealRows(flat, bands, footprints);
    // Whether a legal deal exists is a matter of shapes, not of weights.
    if (!deal) return null;
    /** @type {{x:number,y:number,w:number,h:number,row:number}[]} */
    const cells = [];
    const taken = deal.widths.map((widths) => widths.reduce((a, v) => a + v, 0));
    deal.widths.forEach((widths, k) => {
      let x = bands[k].x + bands[k].w - taken[k];
      for (const w of widths) {
        cells.push({ x, y: bands[k].y, w, h: bands[k].d, row: k });
        x += w;
      }
    });
    const areas = cells.map((c) => c.w * c.h);
    const spread = Math.max(...areas) / Math.max(1e-9, Math.min(...areas));
    if (spread <= ROOM_AREA_SPREAD_MAX + EPS) return { cells, taken, spread, flatten: power };
  }
  return null;
}

// ------------------------------------------------------------------- lounge

/**
 * WHO IS DRAWN IN THE LOUNGE, and who is behind its chip.
 *
 * Seats first, then `LOUNGE_STANDING_ROWS` of people standing, as many as the
 * lounge's width holds. Everybody past that is a number on a chip — `+N
 * resting` — and still a row in the deck: nobody is hidden from the list.
 *
 * @param {number} resting people the lounge is asked to hold
 * @param {number} seats places on its furniture
 * @param {number} perRow how many stand side by side across its width
 * @returns {{seated:number, standing:number, chip:number}}
 */
export function restingOnFloor(resting, seats, perRow) {
  const n = Math.max(0, Math.floor(Number(resting) || 0));
  const seated = Math.min(n, Math.max(0, Math.floor(Number(seats) || 0)));
  const room = Math.max(0, Math.floor(Number(perRow) || 0)) * LOUNGE_STANDING_ROWS;
  const standing = Math.min(n - seated, room);
  return { seated, standing, chip: n - seated - standing };
}

// -------------------------------------------------------------- measurement

/**
 * WHAT A FINISHED PLAN'S PROPORTIONS ARE — read off its rectangles.
 *
 * Nothing here trusts the planner: the shares are areas of `plan.rooms` over
 * the building's own area, a row is the set of project rooms that share a top
 * edge, and a room's ratio is its width over its depth.
 *
 * @param {{width:number, height:number, rooms:any[]}} plan
 */
export function measureProportions(plan) {
  const area = Math.max(1e-9, plan.width * plan.height);
  const of = (/** @type {string} */ kind) => plan.rooms.filter((r) => r.kind === kind);
  const sum = (/** @type {any[]} */ list) => list.reduce((a, r) => a + r.w * r.h, 0);
  const projects = of('project');
  const ratios = projects.map((r) => r.w / Math.max(1e-9, r.h));
  const areas = projects.map((r) => r.w * r.h);
  /** @type {Map<number, number>} top edge -> depth */
  const rows = new Map();
  for (const r of projects) {
    const y = Math.round(r.y * 100) / 100;
    rows.set(y, Math.max(rows.get(y) ?? 0, r.h));
  }
  const depths = [...rows.values()];
  return {
    area,
    rooms: projects.length,
    shares: {
      rooms: sum(projects) / area,
      office: sum(of('office')) / area,
      lounge: sum(of('lounge')) / area,
      corridors: sum(of('corridor')) / area,
    },
    ratioMin: ratios.length ? Math.min(...ratios) : 0,
    ratioMax: ratios.length ? Math.max(...ratios) : 0,
    areaSpread: areas.length ? Math.max(...areas) / Math.max(1e-9, Math.min(...areas)) : 1,
    rows: depths.length,
    rowDepthSpread: depths.length ? Math.max(...depths) / Math.min(...depths) - 1 : 0,
  };
}

/**
 * The rules a measured floor breaks, in the owner's words. Empty for a floor
 * that keeps them all. A floor with no project room is held to none of the
 * room rules, and its office and lounge may share the building.
 *
 * `ROWS_MAX` is not in the list: it is the norm a floor is laid towards, and a
 * floor with more rooms than three rows can hold at a legal shape is given more
 * rows on purpose (`ROWS_LIMIT`).
 *
 * @param {ReturnType<typeof measureProportions>} m
 * @returns {string[]}
 */
export function proportionFaults(m) {
  if (!m.rooms) return [];
  const pct = (/** @type {number} */ v) => `${(v * 100).toFixed(1)}%`;
  const out = [];
  if (m.shares.rooms < ROOMS_AREA_MIN - EPS) {
    out.push(
      `project rooms have ${pct(m.shares.rooms)} of the building, under ${pct(ROOMS_AREA_MIN)}`,
    );
  }
  if (m.shares.office > OFFICE_AREA_MAX + EPS) {
    out.push(`the office has ${pct(m.shares.office)}, over ${pct(OFFICE_AREA_MAX)}`);
  }
  if (m.shares.lounge > LOUNGE_AREA_MAX + EPS) {
    out.push(`the lounge has ${pct(m.shares.lounge)}, over ${pct(LOUNGE_AREA_MAX)}`);
  }
  if (m.ratioMin < ROOM_RATIO_MIN - EPS || m.ratioMax > ROOM_RATIO_MAX + EPS) {
    out.push(
      `a room is ${m.ratioMin.toFixed(2)}:1 or ${m.ratioMax.toFixed(2)}:1, outside ` +
        `${ROOM_RATIO_MIN} to ${ROOM_RATIO_MAX}`,
    );
  }
  if (m.areaSpread > ROOM_AREA_SPREAD_MAX + EPS) {
    out.push(
      `the largest room is ${m.areaSpread.toFixed(2)}x the smallest, over ${ROOM_AREA_SPREAD_MAX}`,
    );
  }
  if (m.rowDepthSpread > ROW_DEPTH_SPREAD_MAX + EPS) {
    out.push(`row depths differ by ${pct(m.rowDepthSpread)}, over ${pct(ROW_DEPTH_SPREAD_MAX)}`);
  }
  return out;
}
