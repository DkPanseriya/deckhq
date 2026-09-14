/**
 * THE FURNITURE SET, IN UNITS (WP-85b).
 *
 * `docs/plan/10-INTERIOR-DESIGN.md` §3.4 is a table of what each room type is
 * furnished with and how big every piece is. This file is that table, and it is
 * its own module for the reason `plan-shapes.js` is: `plan-units.js` is at
 * WP-22's 900-line ceiling and the set below is a vocabulary rather than a
 * dimension of the plan — a room builder reads it, the envelope search never
 * does.
 *
 * A unit is about **0.30 m**, read off the plan rather than off a preference
 * (`CHAIR = 2 U` is a task chair, `DOOR_WIDTH = 3.5 U` a door), so every number
 * here is a claim about a real piece of furniture.
 *
 * Pure data and one predicate. No DOM, no imports.
 */

// ------------------------------------------------------------- the seats

/**
 * FOUR SEAT KINDS, FOUR FOOTPRINTS (§3.4).
 *
 * *"No two seat kinds in one room share a footprint"* is a silhouette rule
 * stated as an arithmetic one, and it is the whole reason a tub chair is worth
 * having: at 34 px the reader cannot tell two seats apart by their upholstery,
 * only by how much floor they take. So the four are spread far enough that the
 * difference survives the fit scale — a stool is 20 px across on the goldens'
 * floor and an armchair 42.
 *
 * The tub chair grew from `CHAIR`'s 2.0 to 2.4 because §1.7 measured the old
 * one: *"visitor chairs are 28 px and vanish under a 24 px character"*, and
 * WP-79's figure is bigger again. A seat you cannot see under the person in it
 * is a seat the picture does not have.
 */
export const SEAT_TUB = 2.4;
export const SEAT_TASK = 2.0;
export const SEAT_STOOL = 1.4;
export const SEAT_ARMCHAIR = 3.0;

/**
 * Which prop kind is which seat, so the four-footprints rule can be asserted
 * over what the plan actually emits rather than over this file's own constants.
 * A seat kind missing from here is a seat nothing measures.
 */
export const SEAT_FOOTPRINTS = Object.freeze({
  tub_chair: SEAT_TUB,
  chair: SEAT_TASK,
  bar_stool: SEAT_STOOL,
  armchair: SEAT_ARMCHAIR,
});

// ------------------------------------------------------- the project room

/**
 * How much bigger than its desk cluster a task rug is drawn (§3.4: *"task rug
 * = cluster + 1.0"*).
 *
 * THE RUG IS A SIZE, NOT A FILL. WP-50 let it grow to the room, WP-59c and
 * WP-60 capped that growth per axis, and every one of those rules still asked
 * the rug to take whatever floor was going — so §1.4 measured *"a pale mint
 * slab ~20 U across holding one 6 U desk"*. A rug defines a group: it is half a
 * unit of border round the group and nothing else, and `RUG_MAX_OVER_CLUSTER`
 * is only the ceiling for a cluster small enough that half a unit would be a
 * third of it again.
 *
 * What the room does with the floor the rug no longer covers is the break-out
 * corner below, which is furniture — §3.5's *"a clear-floor patch larger than
 * 10 U × 10 U gets a destination, not a bigger rug"*.
 */
export const RUG_CLUSTER_PAD = 1.0;

/** The whiteboard's face, on the west wall: 2.4 U deep, 5.2 U at the least. */
export const WHITEBOARD_W = 2.4;

/**
 * And the most of a wall it may take (§3.4: *"whiteboard 2.4 × ≥5.2, west"*).
 *
 * WP-59c let it grow to 40% of the wall so a room the service column made forty
 * units deep did not carry a postage stamp. That was right about the defect and
 * wrong about the remedy: at 40% of a deep wall the board is the longest
 * silhouette in the room, and §1.2 found it was also the brightest. WP-85a took
 * the brightness; this takes the length. Eight units is a real board — 2.4 m —
 * and a wall with more than that spare gets the pinboard under it instead.
 */
export const WHITEBOARD_MAX_H = 8;

/** The repo-folder shelf on the east wall, and §3.4's `≤7` on its run. */
export const SHELF_W = 1.2;
export const SHELF_MAX_H = 7;

/**
 * THE PINBOARD (§3.4), the one new fixture in a project room.
 *
 * A second, different silhouette under the shelf, on the wall the shelf and the
 * dashboard screen share. §1.6's complaint was forty prop kinds and one
 * silhouette repeated; the answer is not more plants but a piece of furniture
 * the eye can tell from the one above it — a shelf is long and full of book
 * tops, a pinboard is short and covered in paper.
 */
export const PINBOARD_W = 1.2;
export const PINBOARD_H = 2.8;
/** Clear wall between the shelf above and the pinboard below it. */
export const PINBOARD_GAP = 0.8;

// ------------------------------------------------------ the break-out corner

/**
 * THE BREAK-OUT CORNER (§3.4, §3.5, owner decision 4).
 *
 * *"Where a room's clear floor still exceeds 2.2× its cluster area it gets the
 * break-out corner rather than more rug or more plants."* A round rug, two tub
 * chairs facing each other across a small table: a second destination, so a
 * room that was given more floor than its desks need is still the size of what
 * is in it.
 *
 * `BREAKOUT_BAND` is the threshold, and it is a size in units rather than a
 * ratio because the group is a fixed size: the round rug is 6.4 U across and
 * needs 0.6 U of floor round it to read as a rug rather than as a wall-to-wall
 * covering. A room whose spare floor is under that gets nothing, which is the
 * honest answer and the one §3.5 allows (*"a break-out corner, a planter run,
 * or nothing"*).
 *
 * BOTH CONDITIONS, AND THEY MEASURE DIFFERENT THINGS. The ratio is *should this
 * room have a second destination at all*; the band is *will the one we draw
 * fit*. A ratio on its own puts a six-unit rug in a five-unit gap, and a band on
 * its own furnishes a room that was never empty.
 */
export const BREAKOUT_CLEAR_RATIO = 2.2;
/** §3.4's `round rug r 3.2`, said as the diameter the plan actually lays. */
export const BREAKOUT_RUG_D = 6.4;
/** §3.4's `side table 1.4`. */
export const BREAKOUT_TABLE = 1.4;
/** Clear floor the round rug keeps on every side of itself. */
export const BREAKOUT_MARGIN = 0.6;
/** The clear patch, on either axis, that the whole group needs. */
export const BREAKOUT_BAND = BREAKOUT_RUG_D + BREAKOUT_MARGIN * 2;

/**
 * Does a clear patch this size get a break-out group?
 *
 * A pure function of three numbers, so the plan, the test and the document
 * cannot each have their own answer — the defect `visitorChairCount` was
 * written to prevent, one room over.
 *
 * @param {number} bandW the clear patch's width, in units
 * @param {number} bandH its depth
 * @param {number} clearRatio the room's clear floor over its cluster's area
 */
export function breakoutFits(bandW, bandH, clearRatio) {
  return (
    Number(bandW) >= BREAKOUT_BAND &&
    Number(bandH) >= BREAKOUT_BAND &&
    Number(clearRatio) > BREAKOUT_CLEAR_RATIO
  );
}

// ---------------------------------------------------------- the reception

/** The monitor that stands on any desk in the building (§3.4). */
export const MONITOR_W = 1.6;
export const MONITOR_H = 0.5;

/**
 * The in-tray on the manager's desk (§3.4: *"user desk 8–14 × 3 with a monitor
 * and a tray"*).
 *
 * The reception desk was the one desk on the floor with nothing on it, which is
 * what made it read as a counter. Two objects at two sizes is what says
 * somebody works here.
 */
export const DESK_TRAY_W = 2.2;
export const DESK_TRAY_H = 1.2;

/** §3.4's water cooler, which was 1.4. */
export const WATER_COOLER = 1.6;

/**
 * The reception's wool rug: the well less this much a side (§3.4: *"wool rug =
 * well - 1.0 a side, ≤12 deep"*).
 *
 * It reaches UP past the waiting chairs rather than starting under them, which
 * is the whole of §3.7's *"three tub chairs facing the desk across it"*: a rug
 * with the chairs standing off its edge is a mat in front of a desk, and a rug
 * the chairs stand on is a waiting room.
 *
 * §3.4's SECOND CLAUSE IS NOT ADOPTED, and the reason is a rule that predates
 * it. `floor-integrity.test.mjs` holds every reception sofa within 2.5 U of the
 * rug it surrounds — §57's remedy for *"sofas hard against the walls and the
 * rug they surround stranded in the middle of a much wider room"* — and a 12 U
 * ceiling strands the back run by 3.4 U in a reception deep enough to want one.
 * A rug in a waiting area is the floor the seating group encloses, so it is the
 * well and the chair row, less an inset, and nothing else. §1.4's "a rug defines
 * a group, past that it is floor covering" is satisfied by the SOFAS bounding
 * it, which is not true of a project room's task rug and is why the two rules
 * differ. `docs/DEVIATIONS.md` §163.
 */
export const OFFICE_RUG_INSET = 1.0;
/** Clear floor between the rug's near edge and the chairs that stand on it. */
export const OFFICE_RUG_LEAD = 0.8;

// -------------------------------------------------------------- the lounge

/**
 * §3.4's lounge set, at the sizes the bays will want (WP-85c builds the bays;
 * this package only sizes what is already in the room).
 *
 * The stools are the visible change: there were four props and three places to
 * sit, at a pitch that put them shoulder to shoulder. Three at a 4 U pitch is
 * the counter §3.4 describes, and it is also the count `LOUNGE_BASE_SEATS`
 * always believed in.
 */
export const LOUNGE_STOOL_PITCH = 4;
export const LOUNGE_COFFEE_W = 6;
export const LOUNGE_COFFEE_H = 2.7;
export const LOUNGE_FRIDGE_W = 2.6;
export const LOUNGE_FRIDGE_H = 2.4;
export const LOUNGE_DINING = 7.6;
export const LOUNGE_POOL_W = 13.5;
export const LOUNGE_POOL_H = 7;
export const LOUNGE_TT_W = 12;
export const LOUNGE_TT_H = 6;
export const LOUNGE_ARCADE_W = 2.6;
export const LOUNGE_ARCADE_H = 2;
