/**
 * WHERE A NAME GOES: the frame's label collision pass.
 *
 * Moved out of `scene-labels.js` (which re-exports it) and given the rule the
 * owner's floor of 6 October asked for. Five names sat in a row across the
 * office rug, two label-heights under five figures on the top sofa: every one
 * of them was clear of everything, and not one of them could be read as
 * belonging to anybody. A name is a label for a BODY, so the first thing it
 * owes is to stay next to it.
 *
 * THE NEAR RING. A name with a feet point (`feet`, every name the floor draws)
 * is placed within one body height of its figure before it may go anywhere
 * else, in this order:
 *
 *   1. below the feet, where it has always gone;
 *   2. above the head, clear of the icon-and-badge slot;
 *   3. left, then right, at the depth it would have had below; then beside the
 *      body itself.
 *
 * Measured to the label's CENTRE, a spot is near while that centre is within
 * `NEAR_REACH` body heights of the feet: one body height, plus the label's own
 * half-height of give. A spot farther than that is not tried in this pass at
 * all, which is why "above the head" is usually skipped for somebody waiting:
 * their icon is in the way, and over the icon is too far from the feet.
 *
 * IF EVERY NEAR SPOT IS TAKEN, THE NAME GETS SMALLER BEFORE IT GETS FARTHER.
 * First the minimum label size (`variants[0]`, 11 px), then the abbreviation
 * (`variants[1]`, the first four letters and a dot: `Cassio` → `Cass.`), each
 * tried at every near spot. Each size is tried by EVERY name before any name
 * tries the next, so one crowded corner does not shrink a whole sofa. Only a
 * live agent's name (`keep`) may then move further, through `LABEL_SPOTS`, and
 * a name that does is drawn with a 1 px leader to its feet (`leader: true`). A
 * resting figure's name in the lounge that has no near spot is not drawn.
 *
 * A NAME UNDER A WAIT BADGE IS HALF OF A UNIT (`unit`). It is never set over
 * the head, where the badge already is, and under the feet it takes the floor
 * between the feet and itself as well, so no other figure's name is ever set
 * between a body and its own.
 *
 * An item with no `feet` is placed by the old rule exactly, which is what the
 * pure tests of this function in `scene-math.test.mjs` hold.
 */

// Name-label collision resolution (tech-lead review finding 1,
// docs/DEVIATIONS.md "Findings from review"): how many extra candidate
// positions (each one label-height further down) a non-priority label gets
// before it is dropped rather than drawn overlapping.
export const MAX_LABEL_OFFSET_ATTEMPTS = 2;

/**
 * How far a name's centre may sit from its figure's feet and still be NEAR, in
 * body heights: one, and a fifth for the label's own half-height.
 */
export const NEAR_REACH = 1.2;

/**
 * Resolve overlapping name labels for one frame. `items` should already be in
 * the caller's priority/paint order — earlier items get first claim on space.
 *
 * `pin: true` (the selected agent only) is placed unconditionally at its
 * natural position and contributes to what later items must avoid, but is
 * never nudged or dropped — moving or hiding the one label that says "this is
 * the agent you opened" would defeat the point of it.
 *
 * Without `feet`, an item is tried at its natural position, then at up to
 * `MAX_LABEL_OFFSET_ATTEMPTS` positions each one label-height further down; a
 * `keep` item then tries the sideways spots in `LABEL_SPOTS` too. With `feet`,
 * the near ring above comes first. Nothing is ever drawn overlapping: a missing
 * label beats an unreadable smear.
 *
 * @param {{id:string, x:number, y:number, w:number, h:number, keep?:boolean,
 *   pin?:boolean, unit?:boolean, alts?:number[][], up?:number,
 *   feet?:{x:number, y:number},
 *   bh?:number, side?:number,
 *   variants?:{x:number, y:number, w:number, h:number, text:string, px:number}[]}[]} items
 *   `x,y,w,h`: the label's un-offset screen box; `up`: the offsetY that puts it
 *   over its figure's head; `feet`, `bh`, `side`: the feet point, the body's
 *   height and half-width, all in screen px; `variants`: the same label smaller,
 *   in the order it may shrink (each box at its own un-offset position)
 * @param {{x:number, y:number, w:number, h:number}} [bounds] the building's
 *   screen rect, which no name may leave sideways or upwards
 * @returns {Map<string, {offsetY:number, offsetX?:number, text?:string,
 *   px?:number, leader?:boolean}|null>} per id; `null` means "not this frame"
 */
export function resolveLabelCollisions(items, bounds) {
  /** @type {{x:number,y:number,w:number,h:number}[]} */
  const placed = [];
  const result = new Map();

  const overlaps = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  // `bounds`, when given, is the building on screen: a name is never centred past
  // its side walls or over its top one (a sideways step from a figure on the
  // west wall used to hang the name off the floor and off the canvas).
  const inside = (a, b) =>
    a.x + a.w / 2 >= b.x && a.x + a.w / 2 <= b.x + b.w && a.y + a.h / 2 >= b.y;
  const free = (rect) =>
    !(bounds && !inside(rect, bounds)) && !placed.some((p) => overlaps(rect, p));

  // `pin` is an exemption and `keep` is only a priority. Making needs-you
  // labels exempt collapsed in the case that matters most: every agent in the
  // waiting area is for_review, so all of them were exempt at once and the
  // office turned into an unreadable band of overlapping names. Exactly one
  // label — the selected agent's — is ever truly exempt.
  const pinned = items.filter((it) => it.pin);
  const kept = items.filter((it) => it.keep && !it.pin);
  const rest = items.filter((it) => !it.keep && !it.pin);

  for (const it of pinned) {
    placed.push({ x: it.x, y: it.y, w: it.w, h: it.h });
    result.set(it.id, { offsetY: 0 });
  }

  /** The placement record for `it` drawn as `form` at offset (dx, dy). */
  const spotOf = (it, form, dx, dy, leader) => {
    /** @type {{offsetY:number, offsetX?:number, text?:string, px?:number, leader?:boolean}} */
    const spot = { offsetY: dy };
    if (dx !== 0) spot.offsetX = dx;
    if (form !== it) Object.assign(spot, { text: form.text, px: form.px });
    if (leader) spot.leader = true;
    return spot;
  };

  for (const group of [kept, rest]) {
    // The near ring, one size at a time across the whole group.
    const near = group.filter((it) => it.feet);
    const sizes = Math.max(0, ...near.map((it) => 1 + (it.variants || []).length));
    for (let v = 0; v < sizes; v++) {
      for (const it of near) {
        if (result.has(it.id)) continue;
        const form = v === 0 ? it : (it.variants || [])[v - 1];
        if (!form) continue;
        for (const [dx, dy] of nearSpots(it, form)) {
          const rect = { x: form.x + dx, y: form.y + dy, w: form.w, h: form.h };
          // Under its own feet a unit's name claims the floor up to them.
          const gap = it.unit && dy === 0 ? Math.max(0, rect.y - it.feet.y) : 0;
          const claim = gap > 0 ? { ...rect, y: it.feet.y, h: rect.h + gap } : rect;
          if (!free(claim)) continue;
          placed.push(claim);
          result.set(it.id, spotOf(it, form, dx, dy, false));
          break;
        }
      }
    }
    for (const it of group) {
      if (result.has(it.id)) continue;
      // A resting name with no near spot is not drawn: far from its body it
      // would read as somebody else's.
      if (it.feet && !it.keep) {
        result.set(it.id, null);
        continue;
      }
      // Smallest first once it has to move: it is already as small as it gets.
      const form = it.feet ? [it, ...(it.variants || [])].slice(-1)[0] : it;
      let chosen = null;
      // A kept label (a live agent's) may also step sideways before it gives up;
      // one in the lounge gets the straight-down attempts and is then dropped.
      const spots = it.keep ? LABEL_SPOTS : LABEL_SPOTS_DOWN;
      // `alts`: other figures the same label may hang under instead, as offsets
      // from this one — a crew's `Explore ×3` belongs to any of its three.
      for (const [bx, by] of [[0, 0], ...(it.alts || [])]) {
        for (const [fx, fy] of spots) {
          if (fy === LABEL_UP && (it.unit || typeof it.up !== 'number')) continue;
          const offsetX = bx + fx * form.w;
          const offsetY = by + (fy === LABEL_UP ? upFor(it, form) : fy * form.h);
          const rect = { x: form.x + offsetX, y: form.y + offsetY, w: form.w, h: form.h };
          if (!free(rect)) continue;
          chosen = spotOf(it, form, offsetX, offsetY, !!it.feet && !isNear(it, rect));
          placed.push(rect);
          break;
        }
        if (chosen) break;
      }
      result.set(it.id, chosen);
    }
  }

  return result;
}

/** `up` for a smaller form of the same label: the same bottom line over the head. */
function upFor(it, form) {
  return it.y + (it.up ?? 0) + it.h - form.h - form.y;
}

/** Is this box's centre within `NEAR_REACH` body heights of the item's feet? */
function isNear(it, rect) {
  if (!it.feet || !(it.bh > 0)) return false;
  const cx = rect.x + rect.w / 2 - it.feet.x;
  const cy = rect.y + rect.h / 2 - it.feet.y;
  return Math.hypot(cx, cy) <= NEAR_REACH * it.bh + 1e-6;
}

/**
 * The near ring for one form of a label, as offsets from its un-offset box, in
 * the order they are tried, keeping only the ones within reach of the feet.
 * @param {any} it @param {{x:number, y:number, w:number, h:number}} form
 * @returns {number[][]}
 */
function nearSpots(it, form) {
  const { feet } = it;
  const side = it.side || 0;
  const midX = form.x + form.w / 2;
  const midY = form.y + form.h / 2;
  // Beside the body: the label's inner edge a pixel off the figure's box, its
  // bottom a pixel over the floor line, so it never covers the figure it names
  // nor the head of somebody standing in front of it.
  const besideY = feet.y - 1 - form.h / 2 - midY;
  // Either way by a sixteenth of the label at a time: a name at the end of a
  // sofa run is often a few pixels from clear of the corner, not a whole step.
  /** @param {number[]} fs @param {number} dy */
  const slide = (fs, dy) =>
    fs.flatMap((f) => [(-f * form.w) / 16, (f * form.w) / 16].map((dx) => [dx, dy]));
  const up = typeof it.up === 'number' && !it.unit ? upFor(it, form) : null;
  const spots = [
    [0, 0],
    ...slide([1, 2, 3, 4], 0),
    ...(up === null ? [] : [[0, up], ...slide([1, 2, 3, 4], up)]),
    ...slide([5, 6, 7, 8, 9, 10, 11, 12, 14, 16], 0),
    [feet.x - side - 1 - form.w / 2 - midX, besideY],
    [feet.x + side + 1 + form.w / 2 - midX, besideY],
  ];
  return spots.filter(([dx, dy]) => isNear(it, { ...form, x: form.x + dx, y: form.y + dy }));
}

/**
 * `Cassio` → `Cass.`: the first four letters and a dot, the last form a name
 * takes before it may leave its figure. A junior keeps its mark, whose own dot
 * is the abbreviation's (`Marta·jr` → `Mart·jr`), and anything that is not one
 * name — a crew's `general-purpose ×3` — is left whole, because four letters of
 * it say nothing.
 * @param {string} text
 * @param {string} [mark] a suffix to keep, outside the abbreviation
 * @returns {string}
 */
export function abbreviateName(text, mark = '') {
  const s = String(text ?? '');
  const tail = mark && s.endsWith(mark) ? mark : '';
  const base = tail ? s.slice(0, -tail.length) : s;
  if (base.length <= 4 || /[\s×]/.test(base)) return s;
  return tail ? `${base.slice(0, 4)}${tail}` : `${base.slice(0, 4)}.`;
}

/**
 * WHERE A LABEL MAY GO ONCE IT HAS TO MOVE (audit F1/F7), as fractions of its
 * own width and height. Straight down first — the old rule — then half a label
 * to either side at each of those depths, then a full step aside. A live
 * agent's name is never dropped while one of these is clear; a lounge label
 * without a feet point is, after the straight-down attempts.
 */
const LABEL_SPOTS_DOWN = Object.freeze(
  Array.from({ length: MAX_LABEL_OFFSET_ATTEMPTS + 1 }, (_, i) => Object.freeze([0, i])),
);
/**
 * "Over the head" rather than a depth: the item's own `up`, the offset that
 * sets the label clear above its icon-and-badge slot.
 */
const LABEL_UP = 1e9;
const LABEL_SPOTS = Object.freeze([
  ...LABEL_SPOTS_DOWN,
  ...[0, 1, 2].flatMap((fy) => [
    [-0.6, fy],
    [0.6, fy],
  ]),
  [0, LABEL_UP],
  [-0.6, LABEL_UP],
  [0.6, LABEL_UP],
  [0, 3],
  ...[0, 1, 2, 3].flatMap((fy) => [
    [-1.15, fy],
    [1.15, fy],
  ]),
  [-0.6, 3],
  [0.6, 3],
]);
