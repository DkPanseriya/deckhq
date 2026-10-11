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
 * a name that does is drawn with a 1 px leader to its figure (`leader: true`). A
 * resting figure's name in the lounge that has no near spot is not drawn.
 *
 * A LEADER CROSSES NOBODY (`line`, `leader-line.js`). It ends at the edge of
 * the figure it belongs to and runs over no other figure, no badge, chip or
 * plate and nobody else's name; a place whose line would is passed over for the
 * next one, and no name is set across a line already drawn. Only a name with no
 * other place at all has its line bent round whoever is in the way, or cut short.
 *
 * A NAME UNDER A WAIT BADGE IS HALF OF A UNIT (`unit`). It is never set over
 * the head, where the badge already is, and under the feet it takes the floor
 * between the feet and itself as well, so no other figure's name is ever set
 * between a body and its own.
 *
 * A DENSE SOFA RUN SETS ITS NAMES AT TWO LEVELS (`lower`). Where two people sit
 * on neighbouring cushions, one name is under its feet and the next is a line
 * lower on a leader; if that line is taken, the name is placed as any other.
 *
 * An item with no `feet` is placed by the old rule exactly, which is what the
 * pure tests of this function in `scene-math.test.mjs` hold.
 */

import { leaderFor, leaderStraight, lineEnters } from './leader-line.js';

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
 * How far the centre of a name on the SECOND LEVEL may sit from its feet, in
 * body heights: a line under where the first level is, and tied to its figure
 * by a leader, so it reads as that figure's from farther than a bare name does.
 */
export const LOWER_REACH = 1.6;

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
 *   pin?:boolean, wall?:boolean, unit?:boolean, lower?:boolean, alts?:number[][], up?:number,
 *   feet?:{x:number, y:number},
 *   room?:{x:number, y:number, w:number, h:number}, over?:number,
 *   bh?:number, side?:number, lift?:number,
 *   figure?:{x:number, y:number, w:number, h:number},
 *   body?:{x:number, y:number, w:number, h:number}, of?:string,
 *   variants?:{x:number, y:number, w:number, h:number, text:string, px:number}[]}[]} items
 *   `x,y,w,h`: the label's un-offset screen box; `room`: the floor of the
 *   figure's own room, inside its walls, which the whole name stays in; `over`:
 *   the offsetY that sets it over its own wait badge; `up`: the offsetY that puts it
 *   over its figure's head; `feet`, `bh`, `side`: the feet point, the body's
 *   height and half-width, all in screen px; `lift`: half the depth of a
 *   two-row tag's second row (`rowCentre`); `variants`: the same label smaller,
 *   in the order it may shrink (each box at its own un-offset position);
 *   `figure`: the body the name belongs to, where its leader ends; and on an
 *   obstacle, `body`: the figure drawn inside it, which no leader crosses, and
 *   `of`: the id of the figure a badge or a raised hand belongs to
 * @param {{x:number, y:number, w:number, h:number}} [bounds] the building's
 *   screen rect, which no name may leave sideways or upwards
 * @returns {Map<string, {offsetY:number, offsetX?:number, text?:string,
 *   px?:number, leader?:boolean, line?:number[]}|null>} per id; `null` means "not
 *   this frame"; `line`: the leader as `[x0, y0, x1, y1, …]`, offsets from the feet
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
  // A NAME IS INSIDE ITS OWN ROOM (`room`, every seated figure's): the whole
  // box, clear of the wall band, with no exception — a name past a wall is a
  // name in somebody else's room. A figure with no room of its own (one that is
  // walking, between rooms) is asked about the walls instead, and `through`
  // lets a live name that has no place at all clear of one be set anyway.
  const within = (a, b) =>
    a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  const free = (rect, it = null, through = false) =>
    !(bounds && !inside(rect, bounds)) &&
    !placed.some((p) => overlaps(rect, p)) &&
    !lines.some((line) => lineEnters(line, rect)) &&
    (it && it.room ? within(rect, it.room) : through || !walls.some((w) => overlaps(rect, w)));

  // `pin` is an exemption and `keep` is only a priority. Making needs-you
  // labels exempt collapsed in the case that matters most: every agent in the
  // waiting area is for_review, so all of them were exempt at once and the
  // office turned into an unreadable band of overlapping names. Exactly one
  // label — the selected agent's — is ever truly exempt.
  const pinned = items.filter((it) => it.pin);
  // The walls among them (`wall: true`): a name is never set across one.
  const walls = pinned.filter((it) => it.wall === true);
  const kept = items.filter((it) => it.keep && !it.pin);
  const rest = items.filter((it) => !it.keep && !it.pin);

  for (const it of pinned) {
    // A wall is asked about on its own (`free`), so it can be seen through.
    if (it.wall !== true) placed.push({ x: it.x, y: it.y, w: it.w, h: it.h });
    result.set(it.id, { offsetY: 0 });
  }

  // Every figure on the floor as the body that is drawn (`body`, on its
  // obstacle): what a leader may not cross (`leader-line.js`).
  const figures = pinned.flatMap((it) => (it.body ? [it.body] : []));
  // Nor a badge, a chip or a plate that is not its own figure's (`of`), nor a
  // name already set; and no name is set across a leader already drawn.
  const chrome = pinned.filter((it) => !it.body && it.wall !== true);
  /** @type {{x:number,y:number,w:number,h:number}[]} */
  const names = [];
  /** @type {number[][]} */
  const lines = [];
  const scene = { figures, chrome, names };
  /**
   * The leader a name set at `rect` is on (`tieFor`); null where it needs none.
   * `bend`: with no straight line clear, the one bent round or cut short.
   * @param {any} it @param {any} rect @param {boolean} [always] @param {boolean} [bend]
   */
  const tieOf = (it, rect, always = false, bend = false) => tieFor(it, rect, scene, always, bend);
  /** Take a place for a name: nothing set after it may be on it, or on its leader. */
  const take = (/** @type {any} */ rect, /** @type {any} */ tie = null) => {
    placed.push(rect);
    names.push(rect);
    if (tie && tie.line) lines.push(tie.line);
  };

  /**
   * The placement record for `it` drawn as `form` at offset (dx, dy), on the
   * leader `tie` where it has one: its line as offsets from the feet.
   * @param {any} it @param {any} form @param {number} dx @param {number} dy
   * @param {{line?:number[]}|null|false} tie
   */
  const spotOf = (it, form, dx, dy, tie) => {
    /** @type {{offsetY:number, offsetX?:number, text?:string, px?:number, leader?:boolean,
     *   line?:number[]}} */
    const spot = { offsetY: dy };
    if (dx !== 0) spot.offsetX = dx;
    if (form !== it) Object.assign(spot, { text: form.text, px: form.px });
    if (tie) spot.leader = true;
    if (tie && tie.line) spot.line = tie.line.map((v, i) => v - (i % 2 ? it.feet.y : it.feet.x));
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
        // THE SECOND LEVEL. Shoulder to shoulder on a sofa, two names are wider
        // than the cushions they are under, so every other one (`lower`) is set
        // a line down, on a 1 px leader that runs between its neighbours' names.
        if (it.lower && it.bh > 0) {
          const rect = { x: form.x, y: form.y + form.h, w: form.w, h: form.h };
          const line = { x: it.feet.x - 0.5, y: it.feet.y, w: 1, h: rect.y - it.feet.y };
          const reach = (rowCentre(it, rect) - it.feet.y) / it.bh;
          const tie = tieOf(it, rect, true) || { clear: true };
          const clear = tie.clear && free(rect, it) && (line.h <= 0 || free(line));
          if (reach <= LOWER_REACH + 1e-6 && clear) {
            take(rect);
            if (line.h > 0) placed.push(line);
            result.set(it.id, spotOf(it, form, 0, form.h, tie));
            continue;
          }
        }
        // Where its own place is on its room's wall, the first place tried is
        // that one brought inside the room (`insideStep`).
        const inward = insideStep(it, form);
        const ring = nearSpots(it, form);
        for (const spot of inward === null ? ring : [inward, ...ring]) {
          const [dx, dy] = spot;
          const rect = { x: form.x + dx, y: form.y + dy, w: form.w, h: form.h };
          // Under its own feet a unit's name claims the floor up to them.
          const below = dy === 0 || spot === inward;
          const gap = it.unit && below ? Math.max(0, rect.y - it.feet.y) : 0;
          const claim = gap > 0 ? { ...rect, y: it.feet.y, h: rect.h + gap } : rect;
          if (!free(claim, it)) continue;
          // A name that has slid clear of its figure is tied back to it, and
          // only where that line crosses nobody: the next place is tried first.
          const tie = tieOf(it, rect);
          if (tie && !tie.clear) continue;
          take(claim, tie);
          result.set(it.id, spotOf(it, form, dx, dy, tie));
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
      // THE LAST PLACES INSIDE ITS ROOM that are still plainly this figure's
      // (`lastInside`): closer under its feet, then over its own wait badge.
      const last = it.room
        ? lastInside(it, form).find(([dx, dy]) =>
            free({ x: form.x + dx, y: form.y + dy, w: form.w, h: form.h }, it),
          )
        : undefined;
      if (last) {
        take({ x: form.x + last[0], y: form.y + last[1], w: form.w, h: form.h });
        result.set(it.id, spotOf(it, form, last[0], last[1], false));
        continue;
      }
      // WHAT IS ASKED OF A PLACE, IN TURN. In its own room; then, for a live
      // name, the free place in its room nearest its feet (`roomScan`). Only a
      // live name with no place in its room at all — a crew's tag half as wide
      // as the room it is in, on a floor of a hundred and fifty — is then set
      // as a figure between rooms is: clear of every wall, and last of all as
      // if no wall were there. A live name is never dropped.
      const outside = it.keep && walls.length ? ['walls', 'any'] : ['walls'];
      const passes = it.room ? (it.keep ? ['room', 'scan', ...outside] : ['room']) : outside;
      // A LEADER CROSSES NOBODY (`leader-line.js`). Every place is asked first
      // for one whose line to its figure is straight and clear (`strict`); only
      // a name with no such place anywhere takes one whose line has to be bent
      // round somebody, or cut short of them.
      for (const strict of [true, false]) {
        for (const pass of passes) {
          if (pass === 'scan') {
            for (const [dx, dy] of roomScan(it, form)) {
              const rect = { x: form.x + dx, y: form.y + dy, w: form.w, h: form.h };
              if (!free(rect, it)) continue;
              const tie = tieOf(it, rect, true, !strict) || { clear: true };
              if (strict && !tie.clear) continue;
              take(rect, tie);
              chosen = spotOf(it, form, dx, dy, tie);
              break;
            }
            if (chosen) break;
            continue;
          }
          const owner = pass === 'room' ? it : null;
          for (const [bx, by] of [[0, 0], ...(it.alts || [])]) {
            for (const [fx, fy] of spots) {
              if (fy === LABEL_UP && (it.unit || typeof it.up !== 'number')) continue;
              const offsetX = bx + fx * form.w;
              const offsetY = by + (fy === LABEL_UP ? upFor(it, form) : fy * form.h);
              const rect = { x: form.x + offsetX, y: form.y + offsetY, w: form.w, h: form.h };
              if (!free(rect, owner, pass === 'any')) continue;
              // On a leader wherever it is far from its feet — or within reach
              // of them and under no part of its own figure (`tieFor`).
              const tie = tieOf(it, rect, false, !strict);
              if (strict && tie && !tie.clear) continue;
              chosen = spotOf(it, form, offsetX, offsetY, tie);
              take(rect, tie);
              break;
            }
            if (chosen) break;
          }
          if (chosen) break;
        }
        if (chosen) break;
      }
      result.set(it.id, chosen);
    }
  }

  return result;
}

/**
 * Has a NEAR name slid clear of its own figure? A name under its feet may step
 * sideways a sixteenth of itself at a time to clear a neighbour, and a long tag
 * under a small body — a junior's `code-reviewer` — can step until no part of
 * it is under the body it names: still within reach, and reading as nobody's.
 * Such a name is tied back to its feet by the leader a far name already has. A
 * name beside the body, at the body's own height, is against it and needs none.
 * @param {{feet?:{x:number, y:number}, side?:number, bh?:number}} it
 * @param {{x:number, y:number, w:number, h:number}} rect where it was set
 */
function detached(it, rect) {
  if (!it.feet || !(it.bh > 0)) return false;
  // Under the BODY, which is half as wide as the ring `side` measures: a name
  // whose last few pixels are under the ring's rim is under nothing drawn.
  const side = (it.side || 0) / 2;
  const under = rect.x < it.feet.x + side && rect.x + rect.w > it.feet.x - side;
  const level = rect.y < it.feet.y && rect.y + rect.h > it.feet.y - it.bh;
  return !under && !level;
}

/**
 * THE LEADER A NAME SET AT `rect` IS ON, or null where it needs none: it is
 * within reach of its feet and under, over or beside its own figure. A type a
 * crew says once (`alts`) is asked of every figure of that type — under any of
 * them it is that figure's, and its line goes to the nearest one it can reach
 * without crossing anybody (`leaderFor`).
 * @param {any} it
 * @param {{x:number, y:number, w:number, h:number}} rect where it is set
 * @param {{figures:any[], chrome:any[], names:any[]}} scene what its line may
 *   not cross: every body drawn but its own; the badges, chips and plates that
 *   are not its own figure's (`of`); and the names already set
 * @param {boolean} always on a leader wherever it is: the second level, and a
 *   place found by scanning the room
 * @param {boolean} bend with no straight line clear, give the one that is bent
 *   round whoever is in the way, or cut short of them
 * @returns {{line?:number[], clear:boolean}|null} `line` in screen px, for an
 *   item that says where its figure is (`figure`); `clear`: straight, over nobody
 */
function tieFor(it, rect, scene, always, bend) {
  if (!it.feet) return null;
  /** @type {{line?:number[], clear:boolean}|null} */
  let best = null;
  let rank = Infinity;
  for (const [bx, by] of [[0, 0], ...(it.alts || [])]) {
    const who =
      bx === 0 && by === 0 ? it : { ...it, feet: { x: it.feet.x + bx, y: it.feet.y + by } };
    if (!always && isNear(who, rect) && !detached(who, rect)) return null;
    if (!it.figure) continue;
    const own = { ...it.figure, x: it.figure.x + bx, y: it.figure.y + by };
    const other = (/** @type {any} */ f) =>
      Math.abs(f.x - own.x) > 0.01 || Math.abs(f.y - own.y) > 0.01;
    const foreign = (/** @type {any} */ c) => c.of !== it.id;
    let line = leaderStraight(rect, own);
    const clear =
      !scene.figures.some((f) => other(f) && lineEnters(line, f)) &&
      !scene.chrome.some((c) => foreign(c) && lineEnters(line, c)) &&
      !scene.names.some((n) => lineEnters(line, n));
    if (!clear && !bend) {
      best = best || { clear: false };
      continue;
    }
    if (!clear) {
      const solid = [...scene.chrome.filter(foreign), ...scene.names];
      line = leaderFor(rect, own, [...scene.figures.filter(other), ...solid]).line;
    }
    let length = 0;
    for (let i = 0; i + 3 < line.length; i += 2)
      length += Math.hypot(line[i + 2] - line[i], line[i + 3] - line[i + 1]);
    // Straight before bent before cut short; the shortest of each.
    const score = (clear ? 0 : line.length > 4 ? 1e6 : 2e6) + length;
    if (score < rank) [best, rank] = [{ line, clear }, score];
  }
  return best || { clear: true };
}

/** How far inside a wall's face a name is set, in screen px: clear of it, not against it. */
export const WALL_CLEAR_PX = 2;

/**
 * THE STEP INSIDE. A figure on a sofa that backs onto its room's wall has that
 * wall where its name hangs. A name across the wall is in neither room, and a
 * name past it is in the wrong one — under the office's bottom sofa that was
 * the lounge, beside the lounge's own plate. So its first place is its own
 * place brought back inside its room by the least it takes: lifted over the
 * sofa's front edge, still under its feet. Where the figure leaves no room for
 * that — the lifted name would be on its body — the ring's own places follow:
 * beside the body, at seat height.
 * @param {any} it @param {{x:number, y:number, w:number, h:number}} form
 * @returns {number[]|null} `[dx, dy]` of that place; null for a name that is
 *   inside its room where it hangs, or has no room
 */
function insideStep(it, form) {
  const room = it.room;
  if (!room) return null;
  const dx = Math.max(room.x - form.x, Math.min(0, room.x + room.w - form.x - form.w));
  const dy = Math.max(room.y - form.y, Math.min(0, room.y + room.h - form.y - form.h));
  if (dx === 0 && dy === 0) return null;
  // Still its figure's: no farther from its feet than a second-level name is.
  const mid = { x: form.x + dx + form.w / 2, y: rowCentre(it, { y: form.y + dy, h: form.h }) };
  const far = it.feet ? Math.hypot(mid.x - it.feet.x, mid.y - it.feet.y) : 0;
  return it.bh > 0 && far > LOWER_REACH * it.bh ? null : [dx, dy];
}

/**
 * WHERE A LIVE NAME GOES WHEN ITS RING IS FULL AND IT MAY NOT LEAVE ITS ROOM,
 * before it is sent away on a leader. In order:
 *
 *   1. under its feet still, but closer: lifted two pixels at a time until its
 *      top is against the floor line. A name hangs a little under its figure,
 *      and in a packed office that gap is often all the room there is;
 *   2. over its own wait badge (`over`), straight, then a few sixteenths to
 *      either side. A waiting figure's name is never set there while it has a
 *      place under or beside it; with neither, over its own badge it is still
 *      plainly that figure's.
 * @param {any} it @param {{x:number, y:number, w:number, h:number}} form
 * @returns {number[][]} offsets from the form's un-offset box
 */
function lastInside(it, form) {
  /** @type {number[][]} */
  const out = [];
  if (!it.feet) return out;
  for (let dy = -2; form.y + dy >= it.feet.y + 1; dy -= 2) out.push([0, dy]);
  if (typeof it.over === 'number') {
    const dy = it.y + it.over + it.h - form.h - form.y;
    out.push([0, dy]);
    for (const f of [1, 2, 3, 4]) out.push([(-f * form.w) / 16, dy], [(f * form.w) / 16, dy]);
  }
  return out;
}

/**
 * Every place round a figure a name could be looked for, nearest its feet
 * first: a quarter of the name's width apart across two widths either way, and
 * half its height apart from six heights over where it hangs to three under.
 * The caller keeps the first that is free and inside the room.
 * @param {any} it @param {{x:number, y:number, w:number, h:number}} form
 * @returns {number[][]} offsets from the form's un-offset box
 */
function roomScan(it, form) {
  /** @type {number[][]} each with how far it is, measured once and not per comparison */
  const out = [];
  const cx = form.x + form.w / 2 - it.feet.x;
  const cy = form.y + form.h / 2 - it.feet.y;
  for (let j = -12; j <= 6; j++) {
    for (let i = -8; i <= 8; i++) {
      const dx = (i * form.w) / 4;
      const dy = (j * form.h) / 2;
      out.push([dx, dy, Math.hypot(cx + dx, cy + dy)]);
    }
  }
  return out.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
}

/** `up` for a smaller form of the same label: the same bottom line over the head. */
function upFor(it, form) {
  return it.y + (it.up ?? 0) + it.h - form.h - form.y;
}

/** Is this box's centre within `NEAR_REACH` body heights of the item's feet? */
function isNear(it, rect) {
  if (!it.feet || !(it.bh > 0)) return false;
  const cx = rect.x + rect.w / 2 - it.feet.x;
  const cy = rowCentre(it, rect) - it.feet.y;
  return Math.hypot(cx, cy) <= NEAR_REACH * it.bh + 1e-6;
}

/**
 * The y a box is MEASURED from, for how far it is from its feet.
 *
 * A one-row name is measured from its centre. A two-row tag (`lift`, WP-99 —
 * a sub-agent's role chip over its name) is measured from the centre of the
 * one-row label it would be without its second row: the row nearer the body.
 * The whole box is still what has to be free; only "how far away is it" asks
 * about the near row, because a tag whose first row is under its figure's feet
 * reads as that figure's, however many rows hang below it.
 * @param {{feet?:{y:number}, lift?:number}} it
 * @param {{y:number, h:number}} rect
 */
function rowCentre(it, rect) {
  const mid = rect.y + rect.h / 2;
  const lift = it.lift || 0;
  if (!(lift > 0) || !it.feet) return mid;
  const d = mid - it.feet.y;
  return mid - Math.sign(d) * Math.min(Math.abs(d), lift);
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
