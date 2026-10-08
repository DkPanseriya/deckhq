/**
 * ONE ROW OF ROOMS, SPLIT — the arithmetic under `splitRow` and `dealRows`
 * (`plan-proportions.js`), in a form a search can ask thousands of times.
 *
 * `splitRow` takes a row's rooms as arrays of their own. A deal asks about
 * every run of consecutive rooms in every row it might lay, and a search asks
 * for thousands of deals, so cutting a fresh set of arrays for each question
 * and measuring every room's bounds again was most of what laying a large
 * floor cost. Here the rooms are a span `from`..`to` of the floor's own arrays
 * and the bounds are handed in, measured once per depth.
 *
 * The arithmetic is `splitRow`'s, operation for operation and in the same
 * order: the same floor is split to the same widths, to the last bit.
 *
 * Pure. No DOM, no clock, no randomness, no imports: the two rules it needs are
 * `plan-proportions.js`'s and are passed in.
 */

/** Comparisons on laid geometry, in plan units (`plan-proportions.js`'s own). */
const EPS = 1e-6;

/**
 * Share a width between the rooms `from` to `to`, each inside its bounds.
 *
 * @param {number[]} weights every room of the floor
 * @param {number} from the first room of the row @param {number} to one past its last
 * @param {number} width the row's width @param {number} depth the row's depth
 * @param {number[]} lo the narrowest each room may be at this depth
 * @param {number[]} hi the widest each may be
 * @param {number} give the most of `width` the rooms may leave to a service room
 * @param {number} spare the most they may leave as a hall
 * @param {boolean} loose whether rooms short of their shape may leave one
 * @param {{ratioMax:number, hallMin:number}} rules `ROOM_RATIO_MAX`, `HALL_WIDTH_MIN`
 * @returns {number[]|null} one width per room of the row, or null where no
 *   legal split exists
 */
export function splitSpan(weights, from, to, width, depth, lo, hi, give, spare, loose, rules) {
  const n = to - from;
  if (!(n > 0) || !(width > 0) || !(depth > 0)) return null;
  // A row too deep for a room's ceiling has no shape to lay it at.
  for (let i = from; i < to; i++) if (lo[i] > hi[i] + EPS) return null;
  let least = 0;
  for (let i = from; i < to; i++) least += lo[i];
  if (least > width + EPS) return null;
  let most = 0;
  for (let i = from; i < to; i++) most += hi[i];
  if (most < width - EPS) {
    const left = width - most;
    // The room beside them takes it.
    if (left <= give + EPS) return hi.slice(from, to);
    const shape = rules.ratioMax * depth;
    let held = loose;
    if (!held) {
      held = true;
      for (let i = from; i < to && held; i++) held = hi[i] < shape - EPS;
    }
    if (!held || left > spare + EPS) return null;
    // A hall, then, and never a sliver of one.
    if (left >= rules.hallMin - EPS) return hi.slice(from, to);
    return splitSpan(weights, from, to, width - rules.hallMin, depth, lo, hi, 0, 0, false, rules);
  }
  // Water-filling. Share what is left by weight; hold whichever side is the
  // further out of bounds at its bound; share again. Each pass holds at least
  // one room, so it ends in at most `n` of them and the sum is the row.
  /** @type {number[]} */
  const out = new Array(n).fill(-1);
  let rest = width;
  let open = 0;
  for (let i = from; i < to; i++) open += weights[i];
  for (let pass = 0; pass <= n; pass++) {
    const k = rest / Math.max(1e-12, open);
    let under = 0;
    let over = 0;
    for (let i = 0; i < n; i++) {
      if (out[i] >= 0) continue;
      const v = k * weights[from + i];
      if (v < lo[from + i]) under += lo[from + i] - v;
      else if (v > hi[from + i]) over += v - hi[from + i];
    }
    const low = under >= over;
    let held = false;
    for (let i = 0; i < n; i++) {
      if (out[i] >= 0) continue;
      const v = k * weights[from + i];
      if (under + over <= EPS) out[i] = v;
      else if (low ? v < lo[from + i] : v > hi[from + i]) {
        out[i] = low ? lo[from + i] : hi[from + i];
        rest -= out[i];
        open -= weights[from + i];
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
