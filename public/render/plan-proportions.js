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
 * A SMALLER MODULE IS NOT THE BIGGER ROOM. A short last row stretches its
 * rooms, so a one-desk room there may come out larger than a team's room in a
 * full row — by up to this much, which reads as two rooms of a size. Past it
 * the floor is saying the opposite of what is in the rooms, and that deal is
 * not laid.
 */
export const MODULE_ORDER_SLACK = 1.25;

/**
 * A PINNED room nobody is in may stay small — this much of a one-desk room —
 * but never so small that the largest room passes the spread bound against it
 * (`PINNED_SPREAD` leaves the grid's own stretch some room under 2.5).
 */
export const PINNED_WEIGHT = 0.6;
export const PINNED_SPREAD = 2.25;

// ------------------------------------------------------- (c) a room's ceiling

/**
 * THE SMALLEST A MODULE IS FURNISHED AT, in square units.
 *
 * A one-desk room is its desk bay (15 x 16 with its pad and plate), the
 * break-out pair beside it and a lane between the two and to the door: 25 wide
 * by 21 deep. A team's room adds the credenza and the four-seat table, a large
 * one the eight-seat table and the shelving wall, and each comes to the
 * module's own step over the one before — 30 x 26 and 40 x 30 as laid — so the
 * three are stated as one number and `MODULE_WEIGHTS`.
 */
export const ROOM_FURNISHED_MIN = 525;

/**
 * How far past that a room may be laid. At 1.6 there is a second lane's worth
 * of floor round every piece and room for one more group; past it the room is
 * being furnished to hide its floor, which is what a showroom is.
 */
export const ROOM_CEILING_OVER_FURNISHED = 1.6;

/**
 * A ROOM HAS A MAXIMUM SIZE: 840, 1260 and 1890 square units for one desk, a
 * team and a large team. A floor with few rooms is DRAWN LARGER; its rooms are
 * not laid larger to fill the window.
 */
export const MODULE_AREA_MAX = Object.freeze({
  S: ROOM_FURNISHED_MIN * ROOM_CEILING_OVER_FURNISHED * MODULE_WEIGHTS.S,
  M: ROOM_FURNISHED_MIN * ROOM_CEILING_OVER_FURNISHED * MODULE_WEIGHTS.M,
  L: ROOM_FURNISHED_MIN * ROOM_CEILING_OVER_FURNISHED * MODULE_WEIGHTS.L,
});

/**
 * The ceiling of one room, in square units.
 *
 * IT IS THE BUILDING'S, AND DOES NOT MOVE WITH THE BODY SIZE. That is what the
 * larger size is for: the same room with larger people and larger furniture in
 * it is a room they are not lost in, and a ceiling that grew with them would
 * hand the floor straight back. A room is never held under its own desks,
 * though: twelve people at desks are past any module's number, and their
 * room's ceiling is that much over the floor the desks themselves stand on.
 *
 * @param {'S'|'M'|'L'|undefined} module none for a pinned room, held as a one-desk room
 * @param {number} [desks] the floor its desks need, in square units
 */
export function roomAreaMax(module, desks = 0) {
  const own = MODULE_AREA_MAX[module ?? 'S'] ?? MODULE_AREA_MAX.S;
  return Math.max(own, ROOM_CEILING_OVER_FURNISHED * (Number(desks) || 0));
}

/** The deepest a room of that ceiling can be and still be a room's shape. */
export const roomDepthMax = (/** @type {number} */ areaMax) => Math.sqrt(areaMax / ROOM_RATIO_MIN);

/** And the widest. */
export const roomWidthMax = (/** @type {number} */ areaMax) => Math.sqrt(areaMax * ROOM_RATIO_MAX);

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
 * A room with nobody at its desks is drawn with the lights off: every colour in
 * it keeps its hue, loses this much of its lightness and `LIGHTS_OFF_DIM` of its
 * saturation. A quarter is one clear step under a lit room, and a pale carpet a
 * quarter darker at full colour is khaki, which is why the colour goes with it.
 */
export const LIGHTS_OFF_STEP = 0.24;

/** The band that step is held to on every theme: seen, and still that room's floor. */
export const LIGHTS_OFF_STEP_MIN = 0.18;
export const LIGHTS_OFF_STEP_MAX = 0.3;

/** How much of its saturation a colour gives up with the lights off. */
export const LIGHTS_OFF_DIM = 0.35;

/** A dimmed carpet is the lit one's hue: at most this many degrees from it. */
export const LIGHTS_OFF_HUE_MAX = 8;

/** A dimmed room's plate is still the plate: WCAG AA for its text. */
export const DIM_PLATE_CONTRAST_MIN = 4.5;

// --------------------------------------------------------------- (g) lounge

/** The lounge draws its seats and ONE standing row; everybody past it is the chip. */
export const LOUNGE_STANDING_ROWS = 1;

// --------------------------------------------------------------- (h) window

/** The building covers at least this much of the window on both axes (audit F2). */
export const WINDOW_FILL_MIN = 0.96;

// ---------------------------------------------------------------- (i) scale

/**
 * THE SCALE THE SERVICE ROOMS ARE HELD AT: twelve pixels to a unit, which is a
 * figure thirty pixels tall — the height under which the figure loses its rim,
 * its chest glyph and its far limb (`RIG_DETAIL_MIN_PX`). A window that many
 * pixels wide is a building this many units wide, and that building is what
 * the office and the lounge are held to their caps IN: past it the reception's
 * queue stands and the lounge shows its chip, rather than everybody on the
 * floor being drawn without their detail so that a crowd can all sit down.
 * Only the ROOMS' own needs take a building past it ((i): the scale drops
 * before a room becomes a strip). A floor that needs less is laid smaller, and
 * drawn larger.
 */
export const NOMINAL_PX_PER_UNIT = 12;

/**
 * The stage a floor is laid for when the caller names a shape and no pixels:
 * the goldens' own canvas, a 1600 x 1000 window less its chrome.
 */
export const REFERENCE_STAGE = Object.freeze({ w: 1600, h: 870 });

/**
 * The smallest scale a floor is drawn at before it scrolls (`MIN_SCALE` in
 * `scene-lod.js`, which this file may not import; a test holds the two equal).
 * A floor whose rooms need a building too wide for the window at this scale
 * is laid a body size smaller before it is left to scroll.
 */
export const SCALE_MIN_PX_PER_UNIT = 7.5;

/**
 * THE LARGEST SCALE A FLOOR IS DRAWN AT, at the medium body: a figure
 * seventy-two pixels tall (`BODY_MAX_PX` over `BODY_HEIGHT_U` in `scene-lod.js`;
 * a test holds the two equal). It is a bound on the BODY, so it is this number
 * over `s` at another size and nobody is drawn taller at `large`. Names and
 * plates are held to their own pixel sizes and do not grow with it.
 *
 * A window too large for its floor at this scale is not left as ground round
 * a small building: the building is laid that much larger, its service rooms
 * to their caps and the rest a hall (`plan-grid.js`).
 */
export const SCALE_MAX_PX_PER_UNIT = 72 / 2.52;

/**
 * The narrowest building that still covers a stage at the largest scale.
 * @param {{w?:number, h?:number}|undefined|null} stage the canvas, in pixels
 * @param {number} [s] the body scale the floor is laid at
 */
export function widthAtLargestScale(stage, s = 1) {
  const px = Number(stage?.w) > 0 && Number(stage?.h) > 0 ? Number(stage?.w) : 0;
  return (px * (Number(s) > 0 ? Number(s) : 1)) / SCALE_MAX_PX_PER_UNIT;
}

/**
 * The widest building the nominal scale gives a stage, in units.
 * @param {{w?:number, h?:number}|undefined|null} stage the canvas, in pixels
 * @param {number} aspect the shape the building is laid to
 */
export function nominalWidth(stage, aspect) {
  const px = Number(stage?.w) > 0 && Number(stage?.h) > 0 ? Number(stage?.w) : 0;
  if (px > 0) return px / NOMINAL_PX_PER_UNIT;
  // No pixels: the reference stage's area, in the shape asked for.
  return Math.sqrt(REFERENCE_STAGE.w * REFERENCE_STAGE.h * aspect) / NOMINAL_PX_PER_UNIT;
}

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
 * The widest a room may be laid in a row of this depth: the shape bound, or
 * its ceiling, whichever is narrower.
 * @param {number} depth @param {number} [areaMax] none means no ceiling
 */
export function widestIn(depth, areaMax) {
  const shape = ROOM_RATIO_MAX * depth;
  return Number(areaMax) > 0 ? Math.min(shape, Number(areaMax) / depth) : shape;
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
 * @param {number[]} [caps] each room's ceiling in square units (`roomAreaMax`):
 *   no room is laid wider than its ceiling is at this depth
 * @param {number} [spare] and the most they may leave where every one of them
 *   is at its CEILING: a row of rooms that may not be larger leaves a hall
 * @returns {number[]|null} one width per room, or null where no legal split exists
 */
export function splitRow(weights, width, depth, footprints = [], give = 0, caps = [], spare = 0) {
  const n = weights.length;
  if (!n || !(width > 0) || !(depth > 0)) return null;
  const hi = weights.map((_, i) => widestIn(depth, caps[i]));
  const lo = weights.map((_, i) => narrowest(footprints[i], depth));
  // A row too deep for a room's ceiling has no shape to lay it at.
  if (lo.some((v, i) => v > hi[i] + EPS)) return null;
  let least = 0;
  for (const v of lo) least += v;
  if (least > width + EPS) return null;
  let most = 0;
  for (const v of hi) most += v;
  if (most < width - EPS) {
    const shape = ROOM_RATIO_MAX * depth;
    const held = hi.every((v) => v < shape - EPS);
    return width - most <= Math.max(give, held ? spare : 0) + EPS ? hi : null;
  }
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
      else if (v > hi[i]) over += v - hi[i];
    }
    const low = under >= over;
    let held = false;
    for (let i = 0; i < n; i++) {
      if (out[i] >= 0) continue;
      const v = k * weights[i];
      if (under + over <= EPS) out[i] = v;
      else if (low ? v < lo[i] : v > hi[i]) {
        out[i] = low ? lo[i] : hi[i];
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

/** The most of its width a band's rooms may leave untaken, either way. */
const leaves = (/** @type {{give?:number, spare?:number}} */ b) =>
  Math.max(b.give ?? 0, b.spare ?? 0);

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
 * @param {{w:number,d:number,give?:number,spare?:number}[]} bands each row's width and depth,
 *   top to bottom, and what it may hand back to a service room (`splitRow`)
 * @param {({w:number,h:number}[]|undefined)[]} [footprints]
 * @param {number[]} [caps] each room's ceiling, as `splitRow` takes it
 * @returns {{starts:number[], widths:number[][]}|null} `starts[k]` is the first
 *   room of row k
 */
export function dealRows(weights, bands, footprints = [], caps = []) {
  const n = weights.length;
  const rows = bands.length;
  if (!rows || n < rows) return null;
  const total = weights.reduce((a, v) => a + v, 0);
  // The area a weight of one is laid towards: the rows' own, or — where the
  // rooms' ceilings come to less than the rows — what those allow.
  const ceiling = caps.length === n ? caps.reduce((a, v) => a + v, 0) : Infinity;
  const floor = bands.reduce((a, b) => a + b.w * b.d, 0);
  const unit = Math.min(ceiling, floor) / Math.max(1e-9, total);
  // How many rooms a row can hold at all is a matter of the shape bounds, and
  // most runs are outside it: asked first, it is what keeps forty rooms cheap.
  const most = bands.map((b) => Math.floor(b.w / (ROOM_RATIO_MIN * b.d) + EPS));
  const fewest = bands.map((b) =>
    Math.max(1, Math.ceil((b.w - leaves(b)) / (ROOM_RATIO_MAX * b.d) - EPS)),
  );
  const sumOf = (/** @type {number[]} */ list) => list.reduce((a, v) => a + v, 0);
  if (n > sumOf(most) || n < sumOf(fewest)) return null;
  // One answer per (row, first room, last room), kept in a flat table: this is
  // asked a few hundred times a floor and a few hundred floors a search.
  const span = n + 1;
  /** @type {({cost:number, widths:number[]}|null|undefined)[]} */
  const memo = new Array(rows * span * span);
  const row = (/** @type {number} */ k, /** @type {number} */ i, /** @type {number} */ j) => {
    if (j - i > most[k] || j - i < fewest[k]) return null;
    const key = (k * span + i) * span + j;
    const known = memo[key];
    if (known !== undefined) return known;
    const band = bands[k];
    const widths = splitRow(
      weights.slice(i, j),
      band.w,
      band.d,
      footprints.slice(i, j),
      band.give ?? 0,
      caps.slice(i, j),
      band.spare ?? 0,
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
    memo[key] = got;
    return got;
  };
  // cost[k][j]: the cheapest deal of the first j rooms into the first k rows,
  // and from[k][j] where its last row starts.
  const cost = new Float64Array((rows + 1) * span).fill(Infinity);
  const from = new Int32Array((rows + 1) * span).fill(-1);
  cost[0] = 0;
  for (let k = 1; k <= rows; k++) {
    for (let j = k; j <= n - (rows - k); j++) {
      for (let i = Math.max(k - 1, j - most[k - 1]); i <= j - fewest[k - 1]; i++) {
        const before = cost[(k - 1) * span + i];
        if (before === Infinity) continue;
        const got = row(k - 1, i, j);
        if (!got) continue;
        if (before + got.cost < cost[k * span + j] - 1e-12) {
          cost[k * span + j] = before + got.cost;
          from[k * span + j] = i;
        }
      }
    }
  }
  if (cost[rows * span + n] === Infinity) return null;
  const starts = Array(rows).fill(0);
  const widths = Array(rows).fill(null);
  for (let k = rows, j = n; k >= 1; k--) {
    const i = from[k * span + j];
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
const FLATTEN = Object.freeze([1, 0.7, 0.4, 0]);

/**
 * THE GRID: every room a cell, every row one depth, nothing left over.
 *
 * A row's rooms end at its band's right edge. Where a band has `give` and its
 * rooms did not take all of it, they start that much in from the left, and
 * `taken[k]` says how much of the band they used.
 *
 * @param {number[]} weights one per room, in floor order
 * @param {{x:number,y:number,w:number,d:number,give?:number,spare?:number}[]} bands the
 *   rectangle each row of rooms has, top to bottom
 * @param {({w:number,h:number}[]|undefined)[]} [footprints]
 * @param {boolean[]} [empty] rooms nobody is in (a pinned one): never larger
 *   than a room of a bigger module, with no slack at all
 * @param {number[]} [caps] each room's ceiling, as `splitRow` takes it
 * @returns {{cells:{x:number,y:number,w:number,h:number,row:number}[],
 *   taken:number[], spread:number, flatten:number, full:boolean}|null} null
 *   where no deal keeps every rule; `full` where no room could be laid larger
 */
export function layGrid(weights, bands, footprints = [], empty = [], caps = []) {
  // How many rooms the rows can hold between them, counted before anything is
  // built: most of what a search asks is a grid with too many rooms for it, or
  // too few, and that is two sums.
  let most = 0;
  let fewest = 0;
  for (const b of bands) {
    most += Math.floor(b.w / (ROOM_RATIO_MIN * b.d) + EPS);
    fewest += Math.max(1, Math.ceil((b.w - leaves(b)) / (ROOM_RATIO_MAX * b.d) - EPS));
  }
  if (weights.length > most || weights.length < fewest) return null;
  for (const power of FLATTEN) {
    const flat = power === 1 ? weights : weights.map((m) => Math.pow(Math.max(1e-6, m), power));
    const deal = dealRows(flat, bands, footprints, caps);
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
    if (spread > ROOM_AREA_SPREAD_MAX + EPS) continue;
    // And the modules are still in order: the largest room of a smaller
    // module against the smallest room of each bigger one.
    const kinds = [...new Set(weights)].sort((a, b) => a - b);
    const range = kinds.map((m) => {
      const own = areas.filter((_, i) => weights[i] === m);
      const slack = weights.some((w, i) => w === m && empty[i]) ? 1 : MODULE_ORDER_SLACK;
      return { least: Math.min(...own), most: Math.max(...own), slack };
    });
    const ordered = range.every((r, a) =>
      range.slice(a + 1).every((bigger) => r.most <= bigger.least * r.slack + EPS),
    );
    if (!ordered) continue;
    const full = cells.every((c, i) => c.w >= widestIn(c.h, caps[i]) - 1e-4);
    return { cells, taken, spread, flatten: power, full };
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
  // Against its ceiling, where the planner gave a room one (`room.areaMax`): how
  // far the largest is over, and whether any of them could have been larger.
  const held = projects.filter((r) => Number(r.areaMax) > 0);
  const over = held.map((r) => (r.w * r.h) / r.areaMax);
  const atCeiling =
    held.length === projects.length &&
    held.every((r) => r.w >= widestIn(r.h, r.areaMax) - 1e-3 || r.w * r.h >= r.areaMax - 1e-3);
  return {
    area,
    rooms: projects.length,
    overCeiling: over.length ? Math.max(...over) : 0,
    atCeiling,
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
  // The majority, or all a room may be: a floor whose every room is at its
  // ceiling is drawn larger, and what its rooms leave is the service rooms' to
  // their caps and then a hall — never a larger room.
  if (m.shares.rooms < ROOMS_AREA_MIN - EPS && !m.atCeiling) {
    out.push(
      `project rooms have ${pct(m.shares.rooms)} of the building, under ${pct(ROOMS_AREA_MIN)}`,
    );
  }
  if (m.overCeiling > 1 + 1e-4) {
    out.push(`a room is ${m.overCeiling.toFixed(2)}x its module's ceiling`);
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
