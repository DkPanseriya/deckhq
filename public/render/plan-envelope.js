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
 * Nothing here knows about the service column or the envelope. It is asked
 * "lay these rooms in this rectangle", "how big are they" and — since WP-59c —
 * "what do you do with a height the column gave you". It used to have to know
 * how tall a board of `n` idle repos was, because the fill order spent the
 * strip's rows on the working side's height; WP-60 took the strip off the
 * floor, and this module no longer knows that idle repos exist at all.
 */

import {
  CORRIDOR,
  HEIGHT_BAND_RATIO,
  PLATE_BAND,
  PROJECT_ASPECT_LIMIT,
  ROOM_FILL_COLUMN_MAX,
  ROOM_FILL_MAX,
  ROOM_HEIGHT_STRETCH_MAX,
  ROOM_PAD,
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
   * Deal the projects into bands — the GRID the working floor is laid on.
   *
   * ACROSS FIRST, AND ONLY THEN DOWN (WP-59b). A grid of `rowCount` rows holds
   * `ceil(n / rowCount)` rooms in each, so two projects go side by side, three
   * go three across, four go two by two, and a room is stacked under another
   * only once the row above it is full. WP-59 dealt by cumulative WIDTH
   * instead — a row was closed when its rooms had used up `totalW / rowCount`
   * — which is the same answer for a floor of similar rooms and the wrong one
   * for the floor the owner actually has: three one-desk repos came out as a
   * row of two and a row of one, and the lone room could honestly take only a
   * third of the band, so the rest of it was drawn as bare floor. A row that
   * cannot be filled is not a row; the fix is to not cut it.
   *
   * The DEPTH rule is untouched and still overrides the count, because it is
   * the one thing a row cannot absorb. A row is as deep as its deepest room,
   * so a one-table room sharing a row with a fifteen-desk project is given a
   * cell twice the depth its desks need and the difference is drawn as carpet
   * — the defect §106 exists to remove, one level down. A room more than
   * `HEIGHT_BAND_RATIO` shallower than the row it would join starts a new row
   * instead, whatever the requested row count.
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
    const perCount = Math.max(1, Math.ceil(order.length / Math.max(1, rowCount)));
    const perWidth = order.reduce((a, it) => a + it.w, 0) / Math.max(1, rowCount);
    /** @type {{weight:number,i:number,w:number,h:number}[][]} */
    const bands = [];
    let current = null;
    let acc = 0;
    for (const item of order) {
      const tooShallow = current && current[0].h > item.h * HEIGHT_BAND_RATIO;
      // A row is full when it holds its share of the rooms OR its share of the
      // width, whichever comes first. The count is what makes the grid a grid
      // on a floor of similar rooms; the width is what keeps a twenty-one desk
      // project from sharing a row with three one-desk ones and leaving the
      // row below it two thirds empty.
      //
      // `bands.length < rowCount` is load-bearing and is why the two rules can
      // be used together at all. They do not close a row at the same moment —
      // twelve rooms over two, and the width rule closes the first row after
      // five while the count rule would have taken six — so without the guard
      // the second row closes at its sixth room and a THIRD row opens holding
      // the last one, which can then honestly take a third of the band. Only
      // the depth rule below may take more rows than were asked for.
      const full =
        current &&
        bands.length < rowCount &&
        (current.length >= perCount || acc + item.w / 2 > perWidth);
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
   * corridor each, each band one row of rooms tiling it exactly.
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
   * is only as deep as its deepest room (see `attempt`), so a row is the shape
   * the rooms actually want and every cell comes out at the band's depth —
   * which is what stops two rooms being stacked into a half-depth cell that
   * neither of their tables fits in.
   *
   * @param {{weight:number,i:number}[]} band
   * @param {{x:number,y:number,w:number,h:number}} rect
   */
  const layBand = (band, rect) => {
    // Shared out by WIDTH, not by area. The cells are all the band's depth, so
    // width is the only degree of freedom left and giving it out by area hands
    // a deep room its neighbour's floor.
    const rowOf = (items, r) => {
      const total = items.reduce((a, item) => a + Math.max(1e-6, naturalOf(item.i).w), 0) || 1;
      /** @type {{x:number,y:number,w:number,h:number}[]} */
      const row = [];
      let x = r.x;
      items.forEach((item, k) => {
        const w = k === items.length - 1 ? r.x + r.w - x : (naturalOf(item.i).w / total) * r.w;
        row.push({ x, y: r.y, w, h: r.h });
        x += w;
      });
      return row;
    };
    // ONE ROW, ALWAYS (WP-59b). WP-55 fell back to a squarified treemap when
    // the rooms would not stand side by side in the width the band had, which
    // stacked two of them into a half-depth cell and handed one of them two
    // and a half times the width its desks need — the bare-carpet defect, made
    // by the code that exists to prevent it. There is nothing to fall back TO:
    // a band is only ever short of width when the whole working floor is, and
    // `buildPlan`'s fit loop reads exactly that off these cells and grows the
    // floor until it is not. Stacking is `dealBands`'s job and its alone, and
    // it stacks a row only when the row above is full.
    return rowOf(band, rect);
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
   * @param {number} [fillMax] the bare-carpet bound in force — `ROOM_FILL_MAX`
   *   (30%) normally, and `ROOM_FILL_COLUMN_MAX` (45%) for a band the SERVICE
   *   COLUMN made deep (WP-59c). It has to be passed rather than assumed here,
   *   because the depth and the width are two ends of one bound: raise the cap
   *   for the depth and forget it for the width, and the band answers a deeper
   *   row by narrowing itself — trading the open floor under the rooms for a
   *   bay beside them, which is the defect §140 removed.
   */
  const bandWidthFor = (band, bandH, availW, fillMax = ROOM_FILL_MAX) => {
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
        (naturalW * fillMax * shallowest) / Math.max(1e-6, bandH),
      ),
    );
  };

  /**
   * The DEEPEST the working side's rooms may honestly be laid, given the width
   * they have to fill (WP-59c, step (a) of `plan.js`'s fill order).
   *
   * The exact inverse of `bandWidthFor`, and it has to be exact or the two
   * disagree about the same room. A band laid at depth `d` and width `w` gives
   * its shallowest room `(w / naturalW) * (d / shallowest)` times the floor its
   * furniture needs; `fillMax` is the most of that a room may have. So the
   * deepest that band may be laid at the width it actually wants is
   *
   *     d ≤ fillMax * shallowest * naturalW / min(availW, naturalW * 1.6)
   *
   * and the working side's ceiling is the tightest of those, shared out in the
   * same proportion `attempt` shares the height in. §140's
   * `ROOM_HEIGHT_STRETCH_MAX` is deliberately NOT applied here: a room may grow
   * past 1.6x its natural depth to meet the column, because the alternative is
   * the bare block under it, and what stops it instead is the area — which is
   * what "45% bare carpet" is a statement about.
   *
   * @param {number} rowCount
   * @param {number} availW the working floor's width
   * @param {number} fillMax the bare-carpet bound in force
   */
  const bandDepthCeiling = (rowCount, availW, fillMax) => {
    const bands = bandsOf(rowCount);
    if (!bands.length || availW <= 0) return 0;
    const bandNaturalH = bands.map((band) =>
      band.reduce((a, item) => Math.max(a, naturalOf(item.i).h), 1),
    );
    const totalNaturalH = bandNaturalH.reduce((a, b) => a + b, 0) || 1;
    let usable = Infinity;
    bands.forEach((band, r) => {
      let naturalW = 0;
      let shallowest = Infinity;
      for (const item of band) {
        const nat = naturalOf(item.i);
        naturalW += nat.w;
        shallowest = Math.min(shallowest, nat.h);
      }
      const w = Math.min(availW, naturalW * ROOM_WIDTH_STRETCH_MAX);
      const deepest = (fillMax * shallowest * naturalW) / Math.max(1e-6, w);
      usable = Math.min(usable, deepest / (bandNaturalH[r] / totalNaturalH));
    });
    if (!Number.isFinite(usable)) return 0;
    return Math.max(0, usable) + CORRIDOR * (bands.length - 1);
  };

  /**
   * What a working side laid `rowCount` bands deep in `workingW x bandHTotal`
   * would cost — the same arithmetic `attempt` below performs, stated once so
   * the envelope search can price a layout before committing to it.
   *
   *   `area`     the floor the ROOMS take. Everything else is open floor.
   *   `bandSkew` how much SHORTER the shortest row of rooms is than the
   *              longest, as a fraction of the longest. This is the empty lot,
   *              and it is what `OPEN_FLOOR_MAX` bounds.
   *
   *              Relative, and that is the whole of the thinking. The obvious
   *              measure — each row's bay against the working side's full
   *              width — cannot tell the defect from the honest case, because
   *              the two are the same shape: a working side is wider than its
   *              rooms whenever the DIRECTORY STRIP asked for more width than
   *              they did, and on the reference machine (one small room, a
   *              seventeen-line board under it) that is every arrangement
   *              there is. Bounding it absolutely squeezed that floor to the
   *              width of its one room and drew a 1.24:1 building on a 1.60:1
   *              window. What is actually wrong in the owner's picture is that
   *              one ROW is a third the length of the row above it — three
   *              repos dealt two-and-one — and no grid has to do that. Row
   *              against row is the comparison that says so.
   *   `bandOpen` the worst row's bay against the WHOLE width of the working
   *              side. Not a legality — see `bandSkew` — but a preference, and
   *              a real one: of two arrangements the same shape, the one whose
   *              rooms reach further across their row is the better picture.
   *              It is what chooses between laying the band shallow and wide
   *              or deep and narrow once the envelope is settled.
   *   `gridErr`  how far this grid's cells are from the shape its rooms want,
   *              as a mean |log| ratio over the rooms. A row of three in a
   *              band deep enough for two rows gives cells a third as wide as
   *              they are deep; the search reads this and takes the other
   *              grid. Zero when every cell is the shape of the room in it.
   */
  const costWorkingFloor = (rowCount, workingW, bandHTotal, fillMax = ROOM_FILL_MAX) => {
    const none = { area: 0, bandOpen: 0, bandSkew: 0, gridErr: 0 };
    const bands = bandsOf(rowCount);
    if (!bands.length || workingW <= 0 || bandHTotal <= 0) return none;
    const usableH = bandHTotal - CORRIDOR * (bands.length - 1);
    if (usableH <= 0) return none;
    const bandNaturalH = bands.map((band) =>
      band.reduce((a, item) => Math.max(a, naturalOf(item.i).h), 1),
    );
    const totalNaturalH = bandNaturalH.reduce((a, b) => a + b, 0) || 1;
    let area = 0;
    let widest = 0;
    let narrowest = Infinity;
    let bandOpen = 0;
    let gridErr = 0;
    let counted = 0;
    bands.forEach((band, r) => {
      const bandH = (usableH * bandNaturalH[r]) / totalNaturalH;
      const w = bandWidthFor(band, bandH, workingW, fillMax);
      area += w * bandH;
      widest = Math.max(widest, w);
      narrowest = Math.min(narrowest, w);
      bandOpen = Math.max(bandOpen, Math.max(0, (workingW - w) / Math.max(1e-6, workingW)));
      // The cell every room in this band would be given, against the shape the
      // room itself wants. Both are ratios, so the comparison is a log.
      const cellW = w / band.length;
      for (const item of band) {
        const nat = naturalOf(item.i);
        gridErr += Math.abs(Math.log(cellW / bandH / Math.max(1e-6, nat.w / nat.h)));
        counted++;
      }
    });
    return {
      area,
      bandOpen,
      bandSkew: Math.max(0, (widest - narrowest) / Math.max(1e-6, widest)),
      gridErr: counted ? gridErr / counted : 0,
    };
  };

  const layWorkingFloor = (rect, rowCount, fillMax = ROOM_FILL_MAX) => {
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
        const w = bandWidthFor(band, bandH, rect.w, fillMax);
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

  /**
   * THE FILL ORDER (WP-59c). What the working side does with the height the
   * service column gave it, in the order it is allowed to do it.
   *
   * The building is as tall as its service column, always — a reception above
   * a lounge holding twenty-four benched agents is seventy units whatever is
   * beside it. §139 and §140 both left the difference as one bare open-plan
   * block at the bottom of the working side, and on the owner's machine that
   * block was two fifths of the building. The order below is what fills it,
   * and the order is the design: everything that is CONTENT goes first, and
   * open plan is what is left when the content has run out.
   *
   *   (a) the rooms grow DEEPER, past `ROOM_HEIGHT_STRETCH_MAX` if the column
   *       forces it, until the shallowest of them is at `ROOM_FILL_COLUMN_MAX`
   *       — 45% bare carpet, five points past the bound on a stretch the plan
   *       merely preferred, and `buildProjectRoom` re-lays the furniture into
   *       the depth rather than leaving the desks adrift in it;
   *   (b) the service column comes DOWN to meet them, by packing the lounge
   *       denser. That is the `pack` axis of the search rather than a step
   *       here, because it changes the height this function is measuring
   *       against; `better` takes the loosest lounge that does the job.
   *   (c) and only then open plan, which `WORKING_OPEN_MAX` bounds.
   *
   * THERE USED TO BE A STEP BETWEEN (a) AND (b): the idle strip stood its lines
   * up — fewer columns, more rows, the same repos — to spend some of the height
   * the column had handed over. WP-60 took the strip off the floor, and with it
   * the only lever on this side that was not a room. What that leaves is a
   * shorter order and a plainer sentence: the rooms take the height, and what
   * they cannot take is open plan.
   *
   * Returns the band depth (a) settles on, so `envelopeFor` and `settle` cannot
   * answer differently.
   *
   * @param {number} rowCount @param {number} workingW @param {number} H
   * @param {number} bandH the depth this candidate asked its band to be laid at
   */
  const fillOrder = (rowCount, workingW, H, bandH) => {
    let rooms = bandH;
    // (a) the rooms, and there is nothing else on this side to be second.
    if (projectRooms.length && rooms < H - 1e-6) {
      const ceiling = bandDepthCeiling(rowCount, workingW, ROOM_FILL_COLUMN_MAX);
      rooms = Math.max(rooms, Math.min(H, ceiling));
    }
    // A room deeper than the search asked for is a room the COLUMN stretched,
    // and it is the one case the looser bare-carpet bound applies to. Said as
    // a comparison rather than as a flag because the same comparison is what
    // the integrity test makes of the finished floor.
    const forced = rooms > bandH + 1e-6;
    return { bandH: rooms, forced };
  };

  /**
   * LAY THE COLUMN ARRANGEMENT — the working floor, and the floor's final
   * size.
   *
   * The rooms are laid into their cells and REBUILT to the shape of the cell
   * they were given, so a project's tables flow to that shape rather than
   * being laid out square and centred in something that is not. Rebuilding
   * changes what a room needs, so the fit is checked and the building grows
   * until every room holds its own furniture — the one thing the plan may
   * never get wrong, since a desk outside its room is a desk on the corridor.
   *
   * `bandH` is the height the ROOMS take of the working side, and not the
   * whole of it. Where the service column is taller than the rooms need — one
   * small project beside a reception and a lounge — the rooms may absorb the
   * difference only up to `BAND_STRETCH_MAX`; past that the floor says so with
   * open circulation rather than painting more carpet nobody stands on. Carpet
   * with nothing on it is the defect; ground is not.
   *
   * It lives here rather than in `plan.js` since WP-59d, beside the fill order
   * it re-runs and opposite `plan-rows.js`'s `layRows`, which is the same loop
   * for the other arrangement. What it takes from `plan.js` is the one step
   * that file owns: how to rebuild a project's room into the cell it was given.
   *
   * @param {any} chosen the candidate envelope the search settled on
   * @param {(i:number, cell:{w:number,h:number}, aspect:number) => void} rebuild
   */
  const layColumn = (chosen, rebuild) => {
    const workingX = chosen.measured.w + CORRIDOR;
    let H = chosen.H;
    let workingW = chosen.workingW;
    let W = workingX + workingW;
    let laid = { cells: [], corridors: [] };
    let forced = chosen.forced;
    let bandH = chosen.bandH;
    let asked = chosen.asked ?? chosen.bandH;
    for (let pass = 0; pass < 8; pass++) {
      // Rebuilding a room changes what its furniture needs, so the deal the
      // bands were cut from is stale the moment the previous pass touched one.
      bandCache.clear();
      shapeCache.clear();
      W = workingX + workingW;
      // THE FILL ORDER, AGAIN, AGAINST THE FLOOR THAT IS ACTUALLY BEING LAID
      // (WP-59c). `envelopeFor` ran it over what the rooms wanted; the fit
      // loop has since rebuilt them into their cells, so the rooms are a
      // different size and the answer has to be asked again. Asked through the
      // same function, so the two can be wrong together but never differently.
      const order = fillOrder(chosen.rowCount, workingW, H, Math.min(asked, Math.max(1, H)));
      forced = order.forced;
      bandH = Math.min(order.bandH, Math.max(1, H));
      laid = projectRooms.length
        ? layWorkingFloor(
            { x: workingX, y: 0, w: workingW, h: bandH },
            chosen.rowCount,
            forced ? ROOM_FILL_COLUMN_MAX : ROOM_FILL_MAX,
          )
        : { cells: [], corridors: [] };
      let worstW = 1;
      let worstH = 1;
      projectRooms.forEach((pr, i) => {
        const cell = laid.cells[i];
        if (!cell) return;
        // The shape the DESK CLUSTER has to fill, which is the cell less the
        // clearance the walls and the plate take — not the cell's own aspect.
        //
        // AND NEVER DEEPER THAN A ROOM THE PLAN WOULD HAVE CHOSEN (WP-59c).
        // A column-forced cell is depth the desks did not ask for, and flowing
        // the tables into it deals a SECOND ROW OF DESKS to fill a lounge's
        // height. Desks equal agents at desks (`08` B6); the extra depth goes
        // to the rug, the planting and the wall furniture instead, which is
        // what `buildProjectRoom` spreads into it.
        const natural0 = naturalOf(i);
        const flowH = Math.min(cell.h, natural0.h * ROOM_HEIGHT_STRETCH_MAX);
        const interiorAspect =
          Math.max(1, cell.w - ROOM_PAD * 2) / Math.max(1, flowH - ROOM_PAD * 2 - PLATE_BAND);
        rebuild(i, cell, interiorAspect);
        const natural = naturalOf(i);
        worstW = Math.max(worstW, natural.w / cell.w);
        worstH = Math.max(worstH, natural.h / cell.h);
      });
      if (worstW <= 1.0005 && worstH <= 1.0005) break;
      workingW *= Math.min(worstW, 1.25);
      asked *= Math.min(worstH, 1.25);
      H = Math.max(H, asked);
    }
    return { H, W, workingW, workingX, laid, bandH, forced };
  };

  return {
    bandsOf,
    layColumn,
    // The depth ladder's ceiling, exported since WP-59d: arrangement B grows
    // its rooms into the row its reception set, which is step (a) of the same
    // fill order read on the other axis, and there is one copy of the rule.
    bandDepthCeiling,
    fillOrder,
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
    costWorkingFloor,
    layWorkingFloor,
    workingShape,
  };
}
