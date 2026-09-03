/**
 * Packing: how a set of rectangles is fitted into a rectangle.
 *
 * Split out of `plan.js` by WP-22. Four independent strategies plus their
 * shared bounding box, all pure functions of their arguments and none of them
 * knowing what a room is:
 *
 *   - `flowBlocks`  wrap blocks into rows, for furniture inside a zone
 *   - `shelfPack`   the same idea with a hard width, for the lounge
 *   - `squarify`    a treemap, for rooms bidding for area against each other
 *   - `tileRows`    rows sized by what each cell must hold, with corridors
 */

/** Bounding box of a set of rects. */
export function boundsOf(items) {
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
export function flowBlocks(blocks, gap, targetAspect = 1, maxW = Infinity) {
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
 * @param {number} [gap]
 * @returns {{cells: {x:number,y:number,w:number,h:number}[],
 *   corridors: {x:number,y:number,w:number,h:number}[]}} the cells AND the
 *   corridors between them. It was declared as returning the cells alone,
 *   which is not what any of its three callers read (WP-22).
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
