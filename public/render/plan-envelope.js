/**
 * The working floor: how the project rooms are dealt into bands, how wide a
 * band may be laid, and what the whole of it measures.
 *
 * Split out of `plan.js` by WP-59, which took that file past `model.test.mjs`'s
 * 900-line ceiling. It is `docs/DEVIATIONS.md` §131's shape 3 — a CLOSURE —
 * because every function in here reads one thing that changes underneath it:
 * `naturalOf(i)`, what a room's furniture needs at the size it was last built.
 * `plan.js`'s fit loop rebuilds each room to the cell it was given, which
 * changes that answer, so a module of pure functions taking the rooms as an
 * argument would have to be handed them on every call and the two caches below
 * would have nothing to key on. `createWorkingFloor` closes over the array and
 * the accessor instead, and `invalidateBands()` is the one line the fit loop
 * owes it.
 *
 * Nothing here knows about the service column, the directory strip or the
 * envelope. It is asked "lay these rooms in this rectangle" and "how big are
 * they", and that is all.
 */

import { squarify } from './plan-packing.js';
import {
  CORRIDOR,
  HEIGHT_BAND_RATIO,
  PROJECT_ASPECT_LIMIT,
  ROOM_FILL_MAX,
  ROOM_WIDTH_STRETCH_MAX,
  WORKING_HEADROOM,
} from './plan-units.js';

/**
 * @param {{room: import('./plan-units.js').Room}[]} projectRooms
 * @param {(i:number) => {w:number,h:number}} naturalOf what room `i`'s
 *   furniture needs, read fresh every time because the fit loop rebuilds it
 */
export function createWorkingFloor(projectRooms, naturalOf) {
  /**
   * How much floor each project is worth, relative to the others.
   *
   * Exactly its furniture's own footprint — a twenty-one desk project earns
   * more room than a one desk project, in the ratio their desks actually need.
   * WP-50 clamped this ratio to stop a very large repo turning its neighbours
   * into splinters, which was necessary while the weights came from session
   * counts and the cell had no relation to the furniture in it. Now that every
   * room is BUILT at its natural size (WP-55), a clamp here is a room given
   * less floor than its desks occupy, which the fit loop then has to buy back
   * by growing the whole building.
   */
  const weights = projectRooms.map((_, i) => {
    const n = naturalOf(i);
    return Math.max(1, n.w * n.h);
  });

  /**
   * Deal the projects into bands: rows of rooms of SIMILAR DEPTH, each row
   * carrying roughly the same total width.
   *
   * Depth first, and it is not a preference. A row is as deep as its deepest
   * room, so a one-table room sharing a row with a fifteen-desk project is
   * given a cell twice the depth its desks need and the difference is drawn as
   * carpet — the defect this package exists to remove, one level down. A room
   * more than `HEIGHT_BAND_RATIO` shallower than the row it would join starts a
   * new row instead, whatever the requested row count.
   *
   * Width second, because within a row the cells are shared out by width and a
   * row much wider than its neighbour leaves the difference as a bay.
   *
   * @param {number} rowCount rows to aim for; the depth rule may take more
   */
  /** @type {Map<number, {weight:number,i:number,w:number,h:number}[][]>} */
  const bandCache = new Map();
  const bandsOf = (rowCount) => {
    const hit = bandCache.get(rowCount);
    if (hit) return hit;
    const made = dealBands(rowCount);
    bandCache.set(rowCount, made);
    return made;
  };
  const dealBands = (rowCount) => {
    const order = weights
      .map((weight, i) => ({ weight, i, w: naturalOf(i).w, h: naturalOf(i).h }))
      .sort((a, b) => b.h - a.h || b.w - a.w || a.i - b.i);
    const totalW = order.reduce((a, it) => a + it.w, 0) || 1;
    const perBand = totalW / Math.max(1, rowCount);
    /** @type {{weight:number,i:number,w:number,h:number}[][]} */
    const bands = [];
    let current = null;
    let acc = 0;
    for (const item of order) {
      const tooShallow = current && current[0].h > item.h * HEIGHT_BAND_RATIO;
      const full = current && bands.length < rowCount && acc + item.w / 2 > perBand;
      if (!current || tooShallow || full) {
        current = [];
        bands.push(current);
        acc = 0;
      }
      current.push(item);
      acc += item.w;
    }
    return bands;
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
  /**
   * Lay one band's rooms into its rectangle.
   *
   * ONE ROW, full depth, widths in proportion to what each room needs. A band
   * is only as deep as its deepest room now (see `attempt`), so a row is the
   * shape the rooms actually want and every cell comes out at the band's depth
   * — which is what stops the squarifier stacking two rooms into a half-depth
   * cell that neither of their tables fits in.
   *
   * The squarified treemap is still the answer when a band is carrying more
   * rooms than one row can hold without cutting them below the width their
   * desks need; then a second row inside the band beats a row of splinters.
   *
   * @param {{weight:number,i:number}[]} band
   * @param {{x:number,y:number,w:number,h:number}} rect
   */
  const layBand = (band, rect) => {
    // Shared out by WIDTH, not by area. The cells are all the band's depth, so
    // width is the only degree of freedom left and giving it out by area hands
    // a deep room its neighbour's floor.
    const total = band.reduce((a, item) => a + Math.max(1e-6, naturalOf(item.i).w), 0) || 1;
    /** @type {{x:number,y:number,w:number,h:number}[]} */
    const row = [];
    let x = rect.x;
    band.forEach((item, k) => {
      const w =
        k === band.length - 1 ? rect.x + rect.w - x : (naturalOf(item.i).w / total) * rect.w;
      row.push({ x, y: rect.y, w, h: rect.h });
      x += w;
    });
    const fits = row.every((cell, k) => cell.w >= naturalOf(band[k].i).w - 0.01);
    if (fits) return row;
    return squarify(
      band.map((item, k) => ({ weight: item.weight, i: k })),
      rect,
    );
  };

  /**
   * How wide a band of rooms may be laid, given the depth it is being laid at
   * and the width on offer.
   *
   * A BAND TAKES THE WIDTH ITS ROOMS NEED, NOT THE WIDTH IT IS OFFERED.
   *
   * Bands rarely hold the same number of rooms — five projects split three and
   * two — and the narrower band used to stretch its rooms across the whole
   * working floor anyway: on the demo floor that was two rooms at 53% bare
   * carpet beside three at 34%. A band is capped at the area its rooms may
   * honestly fill (`ROOM_FILL_MAX`) and, since WP-59, at the width one room may
   * honestly be (`ROOM_WIDTH_STRETCH_MAX`); what it does not take is open floor
   * at the end of the band.
   *
   * The area cap is stated on the SHALLOWEST room in the band, because that is
   * the one whose cell is furthest past what its furniture needs: every cell is
   * `bandH` deep, so a room `h` deep is `bandH / h` over before the width is
   * even shared out. Which is also why a SHALLOWER band is a WIDER one, and why
   * the envelope search has a band depth to choose (WP-59).
   *
   * @param {{weight:number,i:number}[]} band
   * @param {number} bandH the depth the band is being laid at
   * @param {number} availW the working floor's width
   */
  const bandWidthFor = (band, bandH, availW) => {
    let naturalW = 0;
    let shallowest = Infinity;
    for (const item of band) {
      const nat = naturalOf(item.i);
      naturalW += nat.w;
      shallowest = Math.min(shallowest, nat.h);
    }
    return Math.min(
      availW,
      naturalW * ROOM_WIDTH_STRETCH_MAX,
      Math.max(
        1,
        Math.min(naturalW, availW),
        (naturalW * ROOM_FILL_MAX * shallowest) / Math.max(1e-6, bandH),
      ),
    );
  };

  /**
   * The floor the ROOMS take of a working side laid `rowCount` bands deep in
   * `workingW x bandHTotal` — the same arithmetic `attempt` below performs,
   * stated once so the envelope search can cost a layout before committing to
   * it. Everything else in that rectangle is open floor.
   */
  const roomsAreaFor = (rowCount, workingW, bandHTotal) => {
    const bands = bandsOf(rowCount);
    if (!bands.length || workingW <= 0 || bandHTotal <= 0) return 0;
    const usableH = bandHTotal - CORRIDOR * (bands.length - 1);
    if (usableH <= 0) return 0;
    const bandNaturalH = bands.map((band) =>
      band.reduce((a, item) => Math.max(a, naturalOf(item.i).h), 1),
    );
    const totalNaturalH = bandNaturalH.reduce((a, b) => a + b, 0) || 1;
    let area = 0;
    bands.forEach((band, r) => {
      const bandH = (usableH * bandNaturalH[r]) / totalNaturalH;
      area += bandWidthFor(band, bandH, workingW) * bandH;
    });
    return area;
  };

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
      const usableH = rect.h - CORRIDOR * (n - 1);
      if (usableH <= 0) return null;
      // A BAND IS AS DEEP AS ITS DEEPEST ROOM NEEDS, not a fixed share of the
      // working floor. Splitting the height evenly gave a band of one-table
      // rooms the same depth as a band holding a fifteen-desk project, so its
      // cells came out three times taller than wide and the plan gave up its
      // two-band layout rather than draw the splinters.
      const bandNaturalH = bands.map((band) =>
        band.reduce((a, item) => Math.max(a, naturalOf(item.i).h), 1),
      );
      const totalNaturalH = bandNaturalH.reduce((a, b) => a + b, 0) || 1;
      const bandHs = bandNaturalH.map((nh) => (usableH * nh) / totalNaturalH);
      let bandY = rect.y;
      bands.forEach((band, r) => {
        const bandH = bandHs[r];
        const y = bandY;
        bandY += bandH + CORRIDOR;
        // See `bandWidthFor`: the band takes the width its rooms need, not the
        // width it is offered, and the difference is a bay of open floor.
        const w = bandWidthFor(band, bandH, rect.w);
        const laid = layBand(band, { x: rect.x, y, w, h: bandH });
        band.forEach((item, k) => {
          cells[item.i] = laid[k];
        });
        if (rect.w - w > 0.01) {
          corridors.push({ x: rect.x + w, y, w: rect.w - w, h: bandH, bay: true });
        }
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
   * The rectangle the working floor's rooms want, at their natural sizes.
   *
   * THE BUILDING IS THE SIZE OF WHAT IS IN IT (WP-55). The floor used to be
   * built to the STAGE's shape exactly — `W = targetAspect * H`, with `H`
   * pinned to the service column — and the treemap then stretched whatever
   * rooms there were to tile the remainder. With one active project that made
   * an 88 x 67 room for a two-seat table: the plan was reporting the window's
   * shape back to itself and calling the difference carpet. The working side is
   * now measured from its rooms and the envelope summed from its parts; a small
   * floor comes out small, and `fitToWindow` draws it larger.
   *
   * @param {number} rowCount
   */
  /** @type {Map<number, {w:number,h:number,rows:number}>} */
  const shapeCache = new Map();
  const workingShape = (rowCount) => {
    const hit = shapeCache.get(rowCount);
    if (hit) return hit;
    const made = measureWorkingShape(rowCount);
    shapeCache.set(rowCount, made);
    return made;
  };
  const measureWorkingShape = (rowCount) => {
    const bands = bandsOf(rowCount);
    if (!bands.length) return { w: 0, h: 0, rows: 0 };
    // Circulation the working side keeps beyond its furniture: people walk
    // between the desks, and the treemap spends it as margin inside each room
    // rather than as corridor between them. Spread over both axes so the rect
    // keeps the shape its rooms asked for.
    const pad = Math.sqrt(1 + WORKING_HEADROOM);
    let w = 0;
    let h = 0;
    for (const band of bands) {
      let bandW = 0;
      let bandH = 0;
      for (const item of band) {
        const n = naturalOf(item.i);
        bandW += n.w;
        bandH = Math.max(bandH, n.h);
      }
      // A band is as deep as its deepest room and as wide as its rooms laid
      // side by side, both with the working side's circulation spread over
      // them: people walk between the desks, and it is spent as margin inside
      // each room rather than as corridor between them.
      w = Math.max(w, bandW * pad);
      h += bandH * pad;
    }
    return { w, h: h + CORRIDOR * (bands.length - 1), rows: bands.length };
  };

  return {
    bandsOf,
    /**
     * Forget the deal and the measurement.
     *
     * Rebuilding a room changes what its furniture needs, so both caches are
     * stale the moment `plan.js`'s fit loop has touched one. Stated as a call
     * rather than as a time-to-live, because the caller knows exactly when that
     * happened and nothing else does.
     */
    invalidateBands() {
      bandCache.clear();
      shapeCache.clear();
    },
    layWorkingFloor,
    roomsAreaFor,
    workingShape,
  };
}
