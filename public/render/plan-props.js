/**
 * THE PROPS CATALOGUE (WP-85c).
 *
 * `docs/plan/10-INTERIOR-DESIGN.md` §3.5 and §3.6 are two tables and six rules:
 * what a room is decorated with, how much of it, and where it may stand. This
 * file is those tables, plus the pure functions that turn them into placements.
 * Its own module for the reason `plan-furniture.js` is: `plan-units.js` is at
 * WP-22's 900-line ceiling, and a catalogue is a vocabulary rather than a
 * dimension of the plan — the room builders read it, the envelope search never
 * does.
 *
 * TWO RULES ABOUT THIS FILE.
 *
 * **Nothing here is random.** §3.5's *"decoration is a function of available
 * anchors, not of area"* is a determinism claim as much as a density one: the
 * backdrop is baked once per plan and must be pixel-identical on the next bake,
 * so every choice below is a pure function of a string the plan already has.
 * `appearanceHash` is the hash that does it — the same one WP-79's traits
 * vocabulary draws a robot from — and it is used here for the same reason: a
 * thing that looks like itself has to be a function of its own name.
 *
 * **Every kind named here is declared in `PROP_HEIGHT`** (WP-78). A prop with
 * no height is a prop with a shadow nobody measured; `lighting.test.mjs` reads
 * both lists and fails on the first kind one of them is missing.
 *
 * Pure data and pure functions. No DOM, no canvas.
 */

import { appearanceHash } from './palette.js';

// ------------------------------------------------------------- the plants

/**
 * §3.6's FOUR KINDS, AT FOUR FOOTPRINTS.
 *
 * The floor had two — `plant` and `plant_large`, the same five-blob rosette at
 * two scales — and answered every spare corner with one of them. §1.6 measured
 * what that comes to: *"forty prop kinds, one silhouette repeated"*, and six
 * identical plants in a room is wallpaper rather than planting.
 *
 * So the kinds differ in SILHOUETTE and not in scale: broad is low and round,
 * blade is tall and narrow, the tree is one canopy, and the planter is a run.
 * At the goldens' fit scale a 2.0 U bush is 28 px and a 2.4 U blade 34, which
 * is not a difference anybody can read — the difference has to be the shape.
 */
export const PLANT_BROAD = 2.0;
export const PLANT_BLADE = 2.4;
export const PLANT_TREE = 3.2;
/** The planter's thickness; its run is the depth of the bay it divides. */
export const PLANTER_W = 0.9;

/** Footprint per kind, so a density test measures what the plan emits. */
export const PLANT_FOOTPRINTS = Object.freeze({
  plant_broad: PLANT_BROAD,
  plant_blade: PLANT_BLADE,
  plant_tree: PLANT_TREE,
  planter: PLANTER_W,
});

/**
 * The three free-standing kinds, in the order a run cycles through them.
 * `planter` is not in it: a planter is a partition that happens to be planted,
 * and §3.6 gives it its own job — *"planters do the dividing between bays,
 * which is what a planting budget is for"*.
 */
export const PLANT_RUN_KINDS = Object.freeze(['plant_broad', 'plant_blade', 'plant_tree']);

/** §3.6's two ceilings, stated where the test and the plan both read them. */
export const PLANTS_PER_PROJECT_ROOM = 2;
export const PLANTS_PER_LOUNGE_BAY = 6;

/**
 * A run of plant kinds, NO TWO ADJACENT THE SAME (§3.6).
 *
 * Deterministic in `seed` and therefore in the room: the same room plants the
 * same corners on every bake, on every machine. The no-repeat rule is enforced
 * by construction — each step advances by 1 or 2 through the cycle, never by 0
 * — rather than by rejecting draws, so the function is total and cannot loop.
 *
 * @param {string} seed something the plan already names this group by
 * @param {number} n how many plants
 * @param {ReadonlyArray<string>} [kinds]
 * @returns {string[]}
 */
export function plantRun(seed, n, kinds = PLANT_RUN_KINDS) {
  const count = Math.max(0, Math.floor(n));
  const len = kinds.length;
  /** @type {string[]} */
  const out = [];
  if (count === 0 || len === 0) return out;
  const h = appearanceHash(String(seed));
  let i = h % len;
  for (let k = 0; k < count; k++) {
    out.push(kinds[i]);
    // 1 or 2, never 0: the next plant is always a different silhouette.
    i = (i + 1 + ((h >>> (k % 24)) & 1)) % len;
  }
  return out;
}

// -------------------------------------------------------- the desk clutter

/**
 * WHAT IS ON A DESK (§3.5), and the one place on this floor where two
 * identical rooms are allowed to differ.
 *
 * A bench desk carried a monitor and nothing else, which is the same picture
 * whoever is sitting at it. Four objects at four sizes — a mug, a notebook, a
 * sticky note and an in-tray — are what say somebody has been working here for
 * an hour rather than that a desk has been delivered.
 *
 * SIZES ARE SMALL ON PURPOSE. Everything here stands ON the desk, inside the
 * seat's own 2.6 U cell, so none of it enlarges the desk cluster the room is
 * sized from (`buildProjectRoom`'s `cluster`) and none of it can be mistaken
 * for furniture at fit scale. The in-tray is the reception's `desk_tray` at a
 * bench desk's scale, which is why it is not a fifth kind.
 */
export const DESK_CLUTTER = Object.freeze({
  mug: Object.freeze({ kind: 'mug', w: 0.8, h: 0.8, slot: 'side' }),
  sticky: Object.freeze({ kind: 'sticky', w: 0.7, h: 0.7, slot: 'side' }),
  notebook: Object.freeze({ kind: 'notebook', w: 1.3, h: 0.9, slot: 'front' }),
  in_tray: Object.freeze({ kind: 'desk_tray', w: 1.6, h: 1.0, slot: 'front' }),
});

/**
 * THE TWELVE SETS, and why there are exactly twelve.
 *
 * At most one object in each of the desk's three free places — two beside the
 * monitor, one in front of it — which is §3.5's density rule applied to a
 * surface rather than to a floor. Enumerated rather than drawn at random so
 * the count is a fact about this list: twelve sets, none empty, none a subset
 * of another by accident.
 */
export const DESK_CLUTTER_SETS = Object.freeze([
  Object.freeze(['mug']),
  Object.freeze(['sticky']),
  Object.freeze(['notebook']),
  Object.freeze(['in_tray']),
  Object.freeze(['mug', 'notebook']),
  Object.freeze(['mug', 'in_tray']),
  Object.freeze(['sticky', 'notebook']),
  Object.freeze(['sticky', 'in_tray']),
  Object.freeze(['mug', 'sticky']),
  Object.freeze(['mug', 'sticky', 'notebook']),
  Object.freeze(['mug', 'sticky', 'in_tray']),
  Object.freeze(['notebook', 'mug', 'sticky']),
]);

/**
 * The places on a desk an object may stand, in the seat's own cell.
 *
 * `along` is measured from the cell's left edge across `SEAT_PITCH`, `depth`
 * from the table edge the occupant sits at. The monitor is 1.6 U wide and
 * 0.5 U deep on that edge, so the two side places are outboard of it and the
 * front place is behind it, toward the middle of the table.
 */
export const DESK_SLOTS = Object.freeze({
  sideA: Object.freeze({ along: 0.48, depth: 0.52 }),
  sideB: Object.freeze({ along: 2.12, depth: 0.52 }),
  front: Object.freeze({ along: 1.3, depth: 1.62 }),
});

/**
 * WHAT IS ON THIS DESK — a pure function of the desk's own name.
 *
 * `key` is the desk's id in the plan (`<project>-table-<i>` plus the seat),
 * and `ordinal` is which desk this is in its room. Both, and for two different
 * reasons: the hash is what makes two PROJECTS differ, and the ordinal is what
 * GUARANTEES two desks in one room differ — twelve sets and a room of at most
 * twelve desks means the guarantee is arithmetic rather than a hope about a
 * hash. That matters because two desks side by side is exactly where a repeat
 * would be read as a texture.
 *
 * `flip` swaps the two side places, so a mug on the left and a mug on the
 * right are two pictures rather than one.
 *
 * @param {string} key the desk's own id
 * @param {number} ordinal which desk this is in its room, from 0
 * @returns {{kind:string, w:number, h:number, along:number, depth:number}[]}
 */
export function deskClutterFor(key, ordinal = 0) {
  const h = appearanceHash(String(key));
  const set = DESK_CLUTTER_SETS[(h + Math.max(0, Math.floor(ordinal))) % DESK_CLUTTER_SETS.length];
  const flip = (h & 1) === 1;
  const sides = flip ? [DESK_SLOTS.sideB, DESK_SLOTS.sideA] : [DESK_SLOTS.sideA, DESK_SLOTS.sideB];
  let sideAt = 0;
  /** @type {{kind:string, w:number, h:number, along:number, depth:number}[]} */
  const out = [];
  for (const name of set) {
    const item = DESK_CLUTTER[name];
    if (!item) continue;
    const slot = item.slot === 'front' ? DESK_SLOTS.front : sides[Math.min(1, sideAt++)];
    out.push({ kind: item.kind, w: item.w, h: item.h, along: slot.along, depth: slot.depth });
  }
  return out;
}

// -------------------------------------------------- thresholds and doormats

/**
 * §3.3's THREE THRESHOLD PIECES, *"because they are how a plan says you are
 * entering something"*.
 *
 * The screed band goes across every doorway and the doormat inside the
 * reception's only. Two of the three are not here, and for one reason: they
 * belong to the DOORWAY rather than to a room. The band is
 * `THRESHOLD_RUN_U`/`THRESHOLD_DEPTH_U` and the pool `DOOR_POOL_R_U`, both in
 * `backdrop-floor.js`, both painted over `plan.doors` — which is a list that
 * does not exist until every room has been placed and `assignDoors` has run.
 * What is left here is the mat, which is a thing lying in one room.
 */
export const DOORMAT_W = 4.6;
export const DOORMAT_H = 1.8;

/**
 * How far inside the wall the reception's doormat lies.
 *
 * Not flush with the threshold, and that is a fact about this room rather than
 * a preference: the reception's sofa runs stand `PAD + SOFA_D` (3.0 U) off
 * three of its walls, so a mat flush to the wall is a mat under a sofa. Clear
 * of the run is where somebody actually steps off the threshold, which is what
 * a doormat is for.
 */
export const DOORMAT_INSET = 3.6;

/** §3.4's reception bookcase: 1.2 U deep, on each long wall. */
export const BOOKCASE_W = 1.2;
export const BOOKCASE_MAX_H = 8;
/**
 * The shortest run that still reads as a bookcase rather than as a box on a
 * wall. Under it the wall carries nothing, which is §3.5's third option —
 * *"a break-out corner, a planter run, or nothing"* — applied to a wall.
 */
export const BOOKCASE_MIN_RUN = 3.2;

// ------------------------------------------------------------ the density

/**
 * §3.5's FOUR RULES, as numbers.
 *
 * `PROP_CLEAR_U2` is *"at most one free-standing prop per 9 U² of clear
 * floor"*; `SILHOUETTE_SPACING` is *"no two identical silhouettes within
 * 8 U"*; `CLEAR_PATCH_MAX` is *"a clear-floor patch larger than 10 U × 10 U
 * gets a destination, not a bigger rug"*. All three are checked over emitted
 * plans in `interior.test.mjs` rather than trusted here.
 */
export const PROP_CLEAR_U2 = 9;
export const SILHOUETTE_SPACING = 8;
export const CLEAR_PATCH_MAX = 10;

/**
 * §3.5's *"every prop is ≤ 2.0 U from a wall or from what it is attached to"*,
 * extended by WP-85c's acceptance to the kinds this package adds.
 */
export const PROP_ATTACH_MAX = 2.0;

/**
 * THE CLEAR FLOOR ROUND A PERSON (WP-85c's acceptance).
 *
 * *"No prop stands within 1.2 U of a character's footprint."* At WP-79's 34 px
 * figure a prop any nearer is drawn through the robot rather than beside it —
 * and a plan that puts a bush where somebody is standing has decorated a place
 * rather than a room. It is what a bay's corner is searched against.
 *
 * FURNITURE IS NOT IN IT, and cannot be: a seat's own `(x, y)` IS the figure's
 * ground contact (WP-85b), somebody making coffee stands at the counter, and a
 * pool player stands `STAND_OFF` from the table. The rule is about the things
 * that decorate the floor round a person, not about the thing they are using.
 */
export const CHAR_CLEAR_U = 1.2;

// ------------------------------------------------------------- the lounge

/**
 * §3.7's FOUR BAYS: *"the lounge is four bays, not one field"*.
 *
 * `minW` is the width the bay needs to be laid as a place rather than as a
 * corner of one; `ground` is what it stands on. Only the café's differs from
 * the boards, which is the whole of why the lounge already carried a
 * `kitchenZone` and now carries a ground per bay.
 *
 * ORDER IS LOAD-BEARING TWICE, and §3.7 states it once: *"a lounge below 60 U
 * wide drops bays from the right — games first, then quiet"*. A drop order of
 * games-then-quiet that is also *from the right* fixes the lay order exactly —
 * **sitting, café, quiet, games** — and it is not the order §3.7's table prints
 * them in, which is by minimum width. Taking the table's order instead would
 * make "from the right" drop games and then café, which is the one bay the
 * lounge cannot give up: the café is the room's only change of ground.
 *
 * So the lay order is the one sentence, and `LOUNGE_BAY_DROP_ORDER` below is
 * DERIVED from it rather than written a second time — which is what makes
 * "from the right" true by construction instead of by agreement between two
 * lists somebody has to keep in step.
 */
export const LOUNGE_BAYS = Object.freeze([
  Object.freeze({ name: 'sitting', minW: 26, ground: 'wood' }),
  Object.freeze({ name: 'cafe', minW: 22, ground: 'tile' }),
  Object.freeze({ name: 'quiet', minW: 16, ground: 'wood' }),
  Object.freeze({ name: 'games', minW: 20, ground: 'wood' }),
]);

/** Every bay's name, in lay order. */
export const LOUNGE_BAY_NAMES = Object.freeze(LOUNGE_BAYS.map((b) => b.name));

/** The same table, keyed, so a builder can ask one bay what it stands on. */
export const LOUNGE_BAY_SPEC = Object.freeze(
  Object.fromEntries(LOUNGE_BAYS.map((b) => [b.name, b])),
);

/**
 * §3.7: *"A lounge below 60 U wide drops bays from the right — games first,
 * then quiet. It never spreads three bays across sixty units."*
 */
export const LOUNGE_BAY_ROW_MIN = 60;
/** *"It never spreads THREE bays across sixty units"* — the three, named. */
export const LOUNGE_BAY_ROW_MIN_COUNT = 3;
/**
 * *"From the right"* — the lay order, reversed. Derived rather than written,
 * so the two can never disagree; §3.7's *"games first, then quiet"* is the
 * first two entries of it, which is the check `interior.test.mjs` makes.
 */
export const LOUNGE_BAY_DROP_ORDER = Object.freeze([...LOUNGE_BAY_NAMES].reverse());
/** The clear floor a planter run keeps either side of itself. */
export const PLANTER_MARGIN = 0.2;

/**
 * WHICH BAYS THIS LOUNGE LAYS, and it is §3.7's rule with one reading made
 * explicit.
 *
 * §3.7's sentence is about a lounge laid in ONE ROW, which is what *"never
 * spreads three bays across sixty units"* says: three bays in sixty units is a
 * row, not a lounge. A lounge with the DEPTH for a second shelf does not have
 * that problem — its bays wrap, exactly as `shelfPack` already wraps the blocks
 * inside them — and dropping the games room from a floor that had the room for
 * it would be furniture removed to satisfy a rule about a different shape.
 *
 * So `oneRow` is the condition, and it is reached only at `LOUNGE_MIN_H`, where
 * the room is one sofa group deep by construction (WP-77). Everywhere else all
 * four bays survive, which is what WP-85c's acceptance — *"at least three named
 * bays at any population ≥ 1"* — is stated over.
 *
 * `has` is the second condition and the honest one: a games bay with no game
 * dealt is an empty rectangle with a name, and §3.7's bays are places rather
 * than labels.
 *
 * A DROP THAT BUYS NOTHING IS NOT MADE. §3.7 gives up a bay to get the rest of
 * them into one row; on a lounge so narrow that even two bays will not fit in
 * one row, giving up the third buys no row and costs a place, so the whole list
 * survives and the bays wrap. Without that clause a 33 U column dropped its
 * quiet bay and came out at exactly the same two rows and the same height it
 * had with the bay in it — furniture removed for nothing, which is the shape of
 * defect §1.7 was written about.
 *
 * @param {number} widthU the lounge's interior width
 * @param {{oneRow?: boolean, has?: (name: string) => boolean}} [opts]
 * @returns {string[]} bay names, in lay order
 */
export function loungeBayNames(widthU, opts = {}) {
  const w = Number(widthU) || 0;
  const has = opts.has || (() => true);
  const names = LOUNGE_BAY_NAMES.filter((n) => has(n));
  if (!opts.oneRow) return names;
  const runOf = (list) =>
    list.reduce(
      (a, n) =>
        a + (LOUNGE_BAYS.find((b) => b.name === n)?.minW ?? 0) + PLANTER_W + PLANTER_MARGIN * 2,
      0,
    );
  // Two clauses, and both are §3.7's own sentence: the run has to fit the width
  // the room actually has, and *"it never spreads three bays across sixty
  // units"* — so three or more of them need `LOUNGE_BAY_ROW_MIN` as well.
  const fits = (list) =>
    runOf(list) <= w && (list.length < LOUNGE_BAY_ROW_MIN_COUNT || w >= LOUNGE_BAY_ROW_MIN);
  if (fits(names)) return names;
  let cur = names;
  for (const drop of LOUNGE_BAY_DROP_ORDER) {
    const next = cur.filter((n) => n !== drop);
    if (next.length === cur.length) continue;
    // Never below two: a lounge with one named place is a field again.
    if (next.length < 2) break;
    cur = next;
    if (fits(cur)) return cur;
  }
  return fits(cur) ? cur : names;
}
