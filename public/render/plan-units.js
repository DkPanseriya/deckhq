/**
 * The plan's vocabulary: how big things are.
 *
 * Split out of `plan.js` by WP-22. Every other `plan-*.js` module imports from
 * here and none of them import each other's constants, so a dimension has one
 * definition and one place to change it.
 *
 * THE SHAPES WENT TO `plan-shapes.js` (WP-77), which is the same remedy applied
 * one level down: this file held "what the shapes ARE, and how big things are"
 * and WP-77's constants took it past WP-22's own 900-line ceiling. Every
 * typedef is re-declared below, so `import('./plan-units.js').Room` — which
 * `plan.js` re-exports and a dozen modules write — resolves as it always did.
 *
 * Pure data and a handful of arithmetic helpers. No DOM, and one type-only
 * import.
 */

/** @typedef {import('./plan-shapes.js').ActivityState} ActivityState */
/** @typedef {import('./plan-shapes.js').AckState} AckState */
/** @typedef {import('./plan-shapes.js').AgentLike} AgentLike */
/** @typedef {import('./plan-shapes.js').ProjectLike} ProjectLike */
/** @typedef {import('./plan-shapes.js').Anchor} Anchor */
/** @typedef {import('./plan-shapes.js').Prop} Prop */
/** @typedef {import('./plan-shapes.js').Zone} Zone */
/** @typedef {import('./plan-shapes.js').Wall} Wall */
/** @typedef {import('./plan-shapes.js').Room} Room */
/** @typedef {import('./plan-shapes.js').Seat} Seat */
/** @typedef {import('./plan-shapes.js').LoungeSpot} LoungeSpot */
/** @typedef {import('./plan-shapes.js').NavLine} NavLine */
/** @typedef {import('./plan-shapes.js').Door} Door */
/** @typedef {import('./plan-shapes.js').Plan} Plan */
/** @typedef {import('./plan-shapes.js').Arrangement} Arrangement */
/** @typedef {import('./plan-shapes.js').WorkingSide} WorkingSide */

/** Pixels per unit at scale 1. */
export const U = 14;

/** Clear floor kept between a zone's furniture and its walls. */
export const MARGIN = 2.5;

/**
 * Clear strip across the top of every room, where its plate is drawn.
 *
 * The plate is live text on the floor (no card, no fill — CONTRACTS-WP15.md
 * §3), so anything under it competes with it. Reserving the strip in the PLAN
 * rather than hoping the furniture happens to miss it is the only way to be
 * sure: the room's interior simply starts below it, and every anchor —
 * including the wall anchors — measures from there.
 */
export const PLATE_BAND = 3.4;

/** The building is the shape of the screen, within reason. */
export const ASPECT_MIN = 1.2;
export const ASPECT_MAX = 2.2;
export const DEFAULT_ASPECT = 1.7;

/**
 * How far the envelope's aspect may sit from the stage's before the floor is
 * no longer "the shape of the window" (WP-59).
 *
 * It is the fill target said as a ratio. A floor narrower than its stage is
 * drawn to the stage's HEIGHT, so the fraction of the stage's width it covers
 * is exactly `planAspect / stageAspect`; 15% off the shape is 87% of the
 * width, which is the margin `docs/DEVIATIONS.md` §139 measures.
 */
export const ASPECT_TOLERANCE = 0.15;

/**
 * How close to the stage's shape is close enough for the search to stop
 * chasing it (WP-59).
 *
 * `ASPECT_TOLERANCE` is the acceptance — what a floor may be judged on.
 * This is tighter, and the difference between them is the margin the
 * acceptance has: inside this band the envelope search stops buying shape and
 * takes the TIGHTEST arrangement instead, which is WP-55's rule applied where
 * it still holds. Aiming at exactly the acceptance would land every floor on
 * the edge of it, which is a test that passes and a picture that is 13% short.
 */
export const ASPECT_SETTLE = 0.05;

/**
 * The most of a BAND OF ROOMS the plan will let become open floor (WP-59b).
 *
 * WP-59 stated this over the whole envelope at 0.28 and that is the number
 * that let the defect through: the service column is nearly half the building
 * on a floor with a full lounge, and the column is never open floor, so a
 * working side that was HALF empty still scored 25% and passed. The owner's
 * floor drew three rooms down the left of the band with the right 55% of it
 * bare — a narrow column of rooms beside an empty lot — and every bound the
 * plan had was satisfied.
 *
 * So the budget is stated where the eye reads it: in the band, against the
 * band. A bay at the end of a row of rooms is the whole of what this measures,
 * 12% is about one room's width in a five-room row, and the search treats an
 * arrangement past it as illegal rather than merely untidy. Anything the band
 * cannot honestly fill goes to the strip's columns or to the service column
 * instead, and what is left over lands below the band as `__open__`, where it
 * is bounded by `FLOOR_OPEN_MAX` rather than hidden inside a room.
 */
export const OPEN_FLOOR_MAX = 0.12;

/**
 * The most of the whole envelope that may be open floor (WP-59b).
 *
 * `OPEN_FLOOR_MAX` above is the band's budget and is the one that shapes the
 * picture; this is the backstop on the rest — chiefly `__open__`, the open
 * plan under the rooms and the strip on a floor whose service column is taller
 * than its working side has anything to put in. WP-59's single 0.28 did both
 * jobs and did neither well.
 *
 * IT IS TWELVE POINTS LOOSER THAN §139's, AND THAT IS THE PRICE OF THE OTHER
 * TWO CHANGES rather than a change of mind. Three one-desk rooms laid ACROSS a
 * band fill it at the area `ROOM_FILL_MAX` allows them and no more, so the
 * emptiness that used to be spread down the side of every row as bays now
 * lands in one piece below them. It is the same floor area either way; what
 * moved is where it is. And it buys the picture the owner was owed: on his
 * machine at 1920 x 1080 the building goes from 65% of the window to 80% of
 * it, because the alternative to open plan INSIDE the building is dark ground
 * OUTSIDE it, which is §139's own argument and is worth no less here.
 *
 * It is a ceiling and not a target: the search takes the tightest arrangement
 * of the ones that are the window's shape (`better`), so a floor with enough
 * in it to fill itself still does.
 */
export const FLOOR_OPEN_MAX = 0.4;

/**
 * The most a room's cell may be wider — and, since WP-59b, deeper — than the
 * footprint its furniture needs.
 *
 * One room can only be so wide: a two-seat table in a cell three times its own
 * width is the bare-carpet defect §106 exists to remove, whatever shape the
 * window is. `ROOM_FILL_MAX` bounds the AREA and is what usually bites; these
 * bound the axes, so a band cannot be flattened into a gallery to chase an
 * aspect ratio, nor stood on end to fill a tall one. Past them the width goes
 * to the directory's columns and the service column instead.
 *
 * WP-59 bounded only the width, because only the width could grow: the band's
 * depth was pinned to `BAND_STRETCH_MAX`. WP-59b lets a room grow into its
 * cell on both axes before any open floor is drawn, so the second bound is no
 * longer implied by the first and is said out loud.
 */
export const ROOM_WIDTH_STRETCH_MAX = 1.6;
export const ROOM_HEIGHT_STRETCH_MAX = 1.6;

/**
 * The most of the WORKING SIDE that may be open floor (WP-59c).
 *
 * The third statement of the same budget, and the first one measured where
 * the eye actually reads it. §139 stated it over the whole envelope, which
 * the service column — never open floor, and half the building — paid for.
 * §140 stated it over a ROW of rooms, which caught the bay beside them and
 * said nothing at all about the floor UNDER them: on the owner's machine the
 * three rooms filled their row, the strip filled its width, and the bottom
 * 40% of the building was one bare open-plan block, because the lounge set
 * the height and nothing on the working side grew to meet it. Every bound the
 * plan had was satisfied. He called it "not full screen wide and very
 * cramped", and §140 admitted in writing that the block "may not survive his
 * eye". It did not.
 *
 * So: the working side, against itself, rooms and strip against its whole
 * rectangle. `FLOOR_OPEN_MAX` and `OPEN_FLOOR_MAX` are both still stated and
 * both still asserted; this is the one that shapes the picture now, and the
 * order the plan is allowed to fill it in is `plan.js`'s `envelopeFor` —
 * rooms first, then the strip, then a denser lounge, and only then this.
 */
export const WORKING_OPEN_MAX = 0.05;

/**
 * The bare-carpet bound for a room the SERVICE COLUMN made tall (WP-59c).
 *
 * §106's 35% is the bound on a room the plan chose to stretch, and it stands.
 * This is the bound on a room that was stretched by something outside the
 * working side altogether: a lounge holding twenty-four benched agents is
 * seventy units tall, and the rooms beside it are given that height whether
 * their desks want it or not. The choice there is between a room 45% of whose
 * floor is clear — a large room, which is a thing offices have — and a room of
 * the right size with a bare open-plan block under it three times its area,
 * which is the picture this package exists to remove.
 *
 * `1 / 0.58` — 42%, with three points in hand against the 45% the integrity
 * test asserts, exactly as `ROOM_FILL_MAX` keeps five against §106's 35%. A
 * cap set at the number the test checks is a cap every floor lands exactly on,
 * and then one rounding away from red.
 *
 * It applies ONLY where the column forced the depth, never where
 * the search merely preferred it, and `buildProjectRoom` re-lays the room's
 * furniture to the space rather than leaving the desks adrift in it — the rug
 * grows, the plants take the corners, the whiteboard and the shelf spread down
 * the walls. What it never does is deal a second row of desks: desks equal
 * agents at desks (`08` B6), and inventing one to fill a room would be the
 * oldest defect in this file wearing a new hat.
 */
export const ROOM_FILL_COLUMN_MAX = 1 / 0.58;

/**
 * HOW UNEQUAL TWO CELLS IN ONE ROW MAY BE (WP-60).
 *
 * The owner's floor has a twenty-four session project beside three one-session
 * ones, and it drew four cells of the same width: the row shared itself out by
 * what each room's FURNITURE needed, and a one-desk room's furniture is very
 * nearly a twenty-four-desk room's once both have a rug, a board and their
 * planting. So the room where all the work is happening was the same size as
 * the three where almost none is.
 *
 * The cells are shared out by OCCUPANCY now — desks, which are agents at desks
 * (`08` B6) — and this is the bound on it. Unclamped, twenty-four against one
 * is a cell twenty-four times the width of its neighbour, which is not a room
 * any more: at the widths a real stage gives a row of four that is a hall
 * beside three cupboards, and a cupboard cannot hold a desk, a chair and the
 * clearance around them. Three to one is the widest a row can be dealt while
 * every cell in it is still recognisably a room.
 *
 * It is a RATIO WITHIN A ROW rather than an absolute size, because that is the
 * comparison a person actually makes: the eye reads the big room as the busy
 * one by seeing it next to the small ones.
 */
export const CELL_OCCUPANCY_RATIO_MAX = 3;

/**
 * THE SECOND ARRANGEMENT (WP-59d), and the two conditions it is tried under.
 *
 * §141 proved by arithmetic that a service COLUMN cannot fill a wide window
 * beside one-desk rooms: a reception over a lounge holding twenty-three
 * benched agents is seventy units tall, four one-desk rooms and a fourteen-line
 * board want about thirty between them, and every lever in the fill order
 * together left 43% of the owner's working side as open plan. The remaining
 * 41% "is the difference between a lounge holding twenty-three benched agents
 * and four repos with one desk each in them" — a statement about the SHAPE the
 * service rooms are laid in, not about how much floor there is.
 *
 * So there is a second shape. Arrangement B lays the building as TWO ROWS —
 * the office beside the rooms, the lounge beside the strip, one corridor
 * between them — which turns the same furniture through ninety degrees and
 * lets a wide window be filled by a wide reception and a wide lounge rather
 * than by rooms that have nothing to grow into.
 *
 * It is tried only where both of these hold, and both are necessary:
 *
 *   - `ROWS_ASPECT_MIN` — the stage is at least this wide for its height. A
 *     tall or square window is exactly what a column is for, and stacking two
 *     rows in one would make a building wider than the screen.
 *   - `ROWS_OPEN_MIN` — arrangement A would leave at least this much of its
 *     working side as open plan. A floor whose column already fills its side
 *     is not a floor with a problem, and re-arranging it would move a picture
 *     nobody complained about.
 *
 * Below the trigger the plan is laid exactly as WP-59c left it, and the search
 * for B is not even run.
 */
export const ROWS_ASPECT_MIN = 1.45;
export const ROWS_OPEN_MIN = 0.15;

/**
 * The reception, laid on its side (WP-59d).
 *
 * In arrangement B the reception is the wide end of a row rather than the top
 * of a column: the waiting area runs along its width and the desk stands at
 * one end. It is the SAME room — `buildOfficeRow` transposes what
 * `buildOffice` lays out, so the C of sofas, the well, the rug and every
 * anchor are the ones §57 measured — and these are the two bounds that change
 * with the axis it is laid on.
 *
 * `OFFICE_ROW_MAX_W` is the widest the search will ever ASK for, and the
 * search may not ask for all of it: the reception in a row is `OFFICE_MAX_W`
 * — as wide as it may be in a column — plus one `OFFICE_SEAT_PITCH` for every
 * person waiting in it, because the C of sofas runs along its width and a
 * queue is exactly what a wider reception buys. Without that the envelope
 * search found the easiest way to fill a wide window: an empty reception
 * ninety units across, which is a hall.
 *
 * What it may still be handed is a wider ROW, and that is not the same thing:
 * both rows fill one width, so a reception beside narrow rooms is as wide as
 * the lounge and the strip below it make it. A room padded to its row is
 * furnished to its row — `buildOffice` lays the seating into whatever it is
 * given — and the alternative is a strip of nothing at the end of row one,
 * which is the one thing the service side has never done.
 *
 * `OFFICE_ROW_MAX_DEPTH` is `OFFICE_MAX_W` read on the other axis — how deep
 * a row may make the reception — and it is larger for the same reason.
 */
export const OFFICE_ROW_MAX_W = 96;
export const OFFICE_ROW_MAX_DEPTH = 60;

/**
 * Widest a reception may be for its depth once it is laid in a row (WP-59d).
 *
 * `ROOM_ASPECT_MAX` (1.8) is the bound on a room that could have been either
 * shape, and a row office could not: it is as wide as the row leaves it and as
 * deep as the row is. "A 2:1 reception reads as a corridor with a desk at one
 * end" was written about a room whose desk is at the TOP; this one's desk is
 * at the end by design, which is what a long reception actually looks like.
 * The bound is still here because past about three to one the waiting area
 * stops reading as a room at all.
 */
export const OFFICE_ROW_ASPECT_MAX = 3.2;

/**
 * And the same bound on the lounge at the end of the other row (WP-59d,
 * remeasured by WP-77).
 *
 * §139 gave the column lounge the reception's own rule — "a wider column is a
 * taller one, and the lever is self-limiting" — because a lounge shelf-packed
 * into a wide budget comes out as a gallery: eighty units of row two with a
 * television at one end and a pool table at the other is 4.2:1, which is a
 * corridor with sofas in it.
 *
 * WP-77 RAISED IT TO 5.4, AND THE REASON IS WHAT THE BOUND WAS BUYING. It is a
 * FLOOR ON THE LOUNGE'S DEPTH, not a cap on its width — the width is the
 * building's, because row two is the whole of it — so at 3.2 it was padding an
 * empty lounge from 19.4 units to 28 to keep a ratio. That padding is bare
 * carpet INSIDE the lounge, which is the defect §106 removed one room over, and
 * it was the eight units the owner was looking at when he said _"the lounge is
 * very big, the whole bottom half"_.
 *
 * What row two actually is, once the lounge is the size of what is in it, is a
 * PROMENADE: one block deep, with the sofa group, the kitchen counter, the
 * quiet corner and a games table strung along the bottom of the building and
 * the standing band running past them. That is a thing an office floor has. A
 * gallery is what you get when the room is padded to a ratio it has nothing to
 * put in.
 *
 * 5.4 is measured rather than chosen: the worst two-row lounge over
 * `floor-integrity`'s sixteen populations at five aspects, with the occupancy
 * ceiling in force, is 5.19:1. The bound is still enforced as a floor on the
 * depth, so it is self-proving — `plan.test.mjs` §3.8 asserts the aspect and
 * cannot fail while this is the number the depth is floored at.
 */
export const LOUNGE_ROW_ASPECT_MAX = 5.4;

/**
 * The narrowest the lounge may be laid in a row (WP-59d).
 *
 * Its widest block — the living room, 15 U — plus the margin either side. A
 * lounge narrower than its own furniture is a lounge with furniture drawn
 * outside it, which is the defect this package fixes at the other end (the
 * juniors' packed row); the strip gives up the width instead.
 */
export const LOUNGE_ROW_MIN_W = 20;

/**
 * The most of the building the service column may take, once the working band
 * holds more than one room (WP-59b).
 *
 * The floor's subject is the rooms with people in them. A reception and a
 * lounge either side of a single project room can honestly be most of the
 * picture — there is nothing else on that floor — but three active repos
 * beside a 46 U column that leaves them 46 U is a plan reporting the lounge as
 * the product. The column is a lever the envelope search likes to pull,
 * because a wider column is a SHORTER one and therefore a wider building; this
 * is the point past which it may not.
 *
 * Stated on the service column rather than on the working side because the
 * column is the thing being chosen: the spine between them is four units of
 * circulation that serves both.
 */
export const SERVICE_COLUMN_MAX = 0.4;

/**
 * Depths the envelope search may lay a band of rooms at, as a multiple of the
 * depth its rooms need (WP-59).
 *
 * A band holds a fixed amount of furniture, so making it shallower makes it
 * wider — the one lever the working floor has for taking the shape of a wide
 * window without any room being given floor it does not fill. `0.9` is as
 * shallow as it goes, which is about what the furniture itself occupies once
 * `WORKING_HEADROOM` is spread over both axes; `BAND_STRETCH_MAX` is the
 * deepest, and WP-59b raised it because a room may now grow into its cell on
 * the depth axis too.
 */
export const BAND_DEPTHS = Object.freeze([1.25, 1.15, 1.05, 0.95, 0.9]);

/**
 * Width of the circulation corridors, in units.
 *
 * A central spine runs the full height of the building between the service
 * side (the user's office above the lounge) and the working floor, and a
 * corridor separates each row of project rooms from the next. Together they
 * mean an agent can leave any desk and reach the lounge or the office without
 * walking through somebody else's room.
 */
export const CORRIDOR = 4;

/** Table geometry. Seats sit along the two long sides. */
export const SEAT_PITCH = 2.6;
export const TABLE_DEPTH = 2.6;
export const CHAIR = 2;
export const CHAIR_GAP = 0.15;
export const TABLE_GAP = 3.2;
export const TABLE_SIZES = [8, 6, 4, 2];

/**
 * A plant's footprint is `plan-props.js`'s now (WP-85c §3.6). `PLANT_SIZE` and
 * `PLANT_GAP` were one size and one offset for the one silhouette this floor
 * had; four kinds at four footprints cannot be a pair of numbers, and the room
 * that used them — a plant at the end of the first bench desk — is the
 * decoration-by-area §3.5 replaced with a break-out corner.
 */

/**
 * THE IDLE-PROJECTS STRIP USED TO BE HERE — where a project with nobody in it
 * went (§96, WP-50).
 *
 * An idle project first got a collapsed ROOM, which still bid for area in the
 * treemap; on the reference machine that turned most of the working floor into
 * large empty cells with a plate each (`08` B6). WP-50 made it one LINE on a
 * single strip along one edge of the working floor — name, session count, last
 * activity — with `DIRECTORY_LINE_H`, `DIRECTORY_COL_W`, `DIRECTORY_MAX_ROWS`
 * and four more constants deciding how a board of them was laid.
 *
 * WP-60 took the strip off the floor altogether. The owner's words were "keep
 * less clutter on screen": fourteen repos nobody is in were taking a corner of
 * the building, a column of the envelope search, and a step of the fill order,
 * to say something the user wanted only when they went looking for it. They are
 * a popover now (`public/idle-projects.js`), so they cost no floor, no
 * constants and no search dimension — and the rooms with people in them get
 * the space back.
 */

/**
 * Where the shelf and the dashboard screen start down a project room's east
 * wall — clear of the in-room "+" that sits in the corner above them.
 */
export const FIXTURE_TOP = 0.6;

/**
 * How much of a project room's west wall its whiteboard takes, at the least.
 * It grows with the wall (WP-59c) — a 5.2 U board at the top of a wall the
 * service column made forty units tall is a postage stamp with nothing under
 * it — and `plan-rooms.js` leaves the last of the wall for the corner planting.
 */
export const WHITEBOARD_H = 5.2;

/** How far a corner plant sits from the two walls it stands between. */
export const CORNER_PLANT_INSET = 1.2;

/**
 * Floor a room-sized rug leaves clear of its walls, so the corner planting and
 * the wall fixtures still stand on the room's own carpet rather than on it.
 */
export const RUG_ROOM_INSET = 4;

/**
 * How much bigger than its desk cluster a rug may be drawn (WP-55, remeasured
 * by WP-85b).
 *
 * WP-50 let the rug grow to the room with no ceiling, on the grounds that a
 * small rug in a large cell reads as desks adrift. It does — but a rug that IS
 * the room reads as bare carpet, which is what the reference floor showed: an
 * 88 x 67 rug with one two-seat table on it. WP-55 capped it at 1.6 and WP-59c
 * gave a column-stretched room's DEPTH a second, looser 2.6, and §1.4 of
 * `docs/plan/10-INTERIOR-DESIGN.md` then measured what those two together
 * actually drew: *"a pale mint slab ~20 U across holding one 6 U desk — the
 * largest shape in the room, at 1.31:1 against the carpet under it"*.
 *
 * ONE NUMBER NOW, AND IT IS A CEILING RATHER THAN A TARGET. §3.4 sizes the rug
 * at `cluster + RUG_CLUSTER_PAD` — half a unit of border round the group — and
 * this is only what stops that half unit becoming a third of the cluster again
 * on a very small one. The floor the rug no longer covers gets the break-out
 * corner (`plan-furniture.js`), which is furniture, rather than more rug.
 */
export const RUG_MAX_OVER_CLUSTER = 1.35;

/**
 * Clear floor a project room keeps between its desk cluster and its walls.
 *
 * Sized from what actually stands there: a corner plant is 2.4 U across at an
 * inset of `CORNER_PLANT_INSET`, so anything less than 3.6 puts a plant on a
 * chair. The whiteboard (2.4 deep) and the shelf (1.2) live inside the same
 * band on the west and east walls.
 */
export const ROOM_PAD = 3.8;

/**
 * The smallest a project room may be, whatever its furniture.
 *
 * A one-table room's cluster is under 7 U across; a room that snug has nowhere
 * for its own door, its whiteboard and its plate to coexist. These are floors,
 * not targets — the room grows with the desks from here.
 */
export const MIN_PROJECT_ROOM_W = 15;
export const MIN_PROJECT_ROOM_H = 13;

/**
 * THE PINNED ROOM (WP-77) — the room a repo keeps with nobody in it.
 *
 * The owner: _"Pin any particular project room so it is always in a room, so
 * the room does not collapse when agents are not running, maybe downsized
 * according to live agents."_ The second half is the whole of the sizing rule:
 * a room with nobody in it is not a room that earns a room's floor. It gets one
 * desk, nobody at it, no juniors' seats, and **at most a third of a live room's
 * footprint in the same plan**.
 *
 * A third is guaranteed rather than aimed at, and it takes both axes to do it:
 *
 *   - the DEPTH is `PINNED_DEPTH_SHARE` of the depth the band of live rooms
 *     asked for, so a pinned room is always the shallower thing in the picture;
 *   - and the WIDTH is then capped so the AREA lands under the third, measured
 *     against the NARROWEST live room actually laid. Depth alone cannot do it:
 *     a strip room as wide as the row would be a third of the depth and all of
 *     the width, which is a corridor with a desk in it.
 *
 * `PINNED_MIN_H` is the floor under the depth share, and it is measured off
 * what has to stand in the room: a desk is `TABLE_DEPTH` deep and wants clear
 * floor on both sides of it, so five units of interior under the plate. Below
 * that the room is a rug and a name, which is honest but is not what pinning
 * was asked for. `PINNED_ROW_MIN_W` is how much width one pinned room is dealt
 * before the strip wraps to a second row.
 */
export const PINNED_DEPTH_SHARE = 0.32;
export const PINNED_MIN_H = 5 + PLATE_BAND;
export const PINNED_MAX_H = 14;
export const PINNED_ROW_MIN_W = 14;
/** The most of a live room's footprint a pinned one may take. */
export const PINNED_AREA_SHARE = 1 / 3;

/**
 * How deep one row of the pinned strip is laid, for a band of live rooms that
 * asked to be `askedBandH` deep.
 *
 * Read off what the band ASKED for rather than off what it ended up with,
 * because the strip's height has to be reserved before the fill order runs and
 * the fill order only ever makes the band deeper. So this is an upper bound on
 * `PINNED_DEPTH_SHARE` of the depth the rooms actually get, which is what makes
 * the third a guarantee rather than an aim.
 * @param {number} askedBandH
 */
export function pinnedRowDepth(askedBandH) {
  const asked = Number(askedBandH) || 0;
  if (asked <= 0) return PINNED_MIN_H;
  return clamp(asked * PINNED_DEPTH_SHARE, PINNED_MIN_H, PINNED_MAX_H);
}

/** How many pinned rooms stand side by side in a working side this wide. */
export function pinnedPerRow(workingW) {
  return Math.max(1, Math.floor(Math.max(0, Number(workingW) || 0) / PINNED_ROW_MIN_W));
}

/**
 * The height the pinned strip reserves at the bottom of the working side.
 * Zero when nothing is pinned, which is every floor that has not been told
 * otherwise.
 * @param {number} count
 * @param {number} workingW
 * @param {number} askedBandH
 */
export function pinnedBandHeight(count, workingW, askedBandH) {
  const n = Math.max(0, Number(count) || 0);
  if (n === 0) return 0;
  const rows = Math.ceil(n / pinnedPerRow(workingW));
  return rows * pinnedRowDepth(askedBandH);
}

/** Shortest sofa run worth sitting on, in units. */
export const SOFA_MIN_RUN = 5.2;

/** The reception's smallest useful interior, before the queue grows it. */
export const OFFICE_MIN_H = 20;

/**
 * How much the reception grows per agent waiting in it. A queue of one gets a
 * small room; a queue of twenty gets the full reception, and past that the
 * loose chairs in the middle take over (see `buildOffice`).
 */
export const OFFICE_GROWTH_W = 0.8;
export const OFFICE_GROWTH_H = 0.55;

export const OFFICE_MIN_W = 22;
export const OFFICE_MAX_W = 46;
export const OFFICE_MAX_H = 36;

/** Pitch between two people sitting on the same sofa run. */
export const OFFICE_SEAT_PITCH = 2.6;

/** Grid of the reception's overflow chairs. */
export const OFFICE_CHAIR_PITCH = 3.2;
export const OFFICE_CHAIR_ROW = 2.8;

/**
 * THE VISITOR CHAIRS AT THE MANAGER'S DESK (WP-78).
 *
 * The owner, 14 September: _"Nobody sits by default in front of the manager;
 * everybody is waiting on the sofa. Only the agent I open walks up to the
 * manager desk."_ — said about a floor where the one guest chair was filled by
 * whoever happened to be at the head of the queue and the rest sat on sofas
 * around the walls. He wants the opposite: the people who are *waiting on him*
 * at his desk, and the sofas for nobody.
 *
 * So there is a ROW of chairs across the front of the desk rather than one, and
 * how many is a function of the desk the room actually got — `OFFICE_MIN_W`
 * gives a 8.8 U desk and two chairs, and anything from 24 U up gives three.
 * Between `MIN` and `MAX` and nothing else: a fourth chair is a boardroom, and
 * a room the user reads first should not look like a meeting.
 */
export const OFFICE_VISITOR_MIN = 2;
export const OFFICE_VISITOR_MAX = 3;

/**
 * HOW FAR APART TWO PEOPLE WAIT, and why it is not the seat pitch.
 *
 * `OFFICE_SEAT_PITCH` (2.6) is how close two bodies may be drawn on one sofa.
 * A person in the waiting area is not only a body: they carry a waiting badge
 * above the head and a name label below it (`03-VISUAL-SPEC.md` §7), and that
 * stack is roughly four units tall. The reception is also the one room the
 * packer may lay on its side (`buildOfficeRow`), so a row of chairs that is
 * horizontal on one floor is vertical on the next — and at 2.6 the vertical
 * case drew each name through the badge of the person behind them.
 *
 * So both pitches here clear the whole stack rather than the body, and the
 * queue runs along the well's LONGER axis so it spreads rather than stacks.
 *
 * WP-85b BROUGHT THE CHAIR PITCH IN FROM 6.4 TO 5.2 (§3.4). §1.7 measured what
 * 6.4 drew: *"at `OFFICE_VISITOR_PITCH = 6.4 U` the three of them are 90 px
 * apart, reading as three unrelated discs rather than a row"*. The label stack
 * that bought the 6.4 is still four units tall, and the chairs still clear it —
 * the pitch is stated on the chairs and `OFFICE_QUEUE_PITCH` on the queue, and
 * only the queue ever stacks two names in one column. What the tighter pitch
 * buys is a ROW: three chairs at 5.2 span 12.8 U, which reads as one piece of
 * seating rather than as three, and fits two units of reception sooner
 * (`OFFICE_VISITOR_THIRD`).
 */
export const OFFICE_VISITOR_PITCH = 5.2;
export const OFFICE_QUEUE_PITCH = 3.8;
export const OFFICE_QUEUE_ROW = 6.4;

/**
 * The reception interior from which the manager's desk earns a THIRD chair.
 * Below it, two — a room at `OFFICE_MIN_W` has no width to spare once the sofa
 * runs have taken theirs.
 *
 * It fell from 26 to 24 with the pitch (WP-85b): three chairs at 5.2 U span
 * 12.8 U rather than 15.2, so the width that used to hold two now holds three
 * with the same clear floor either side. The rule is unchanged and so is its
 * shape — two or three, off the room's own interior and nothing else.
 */
export const OFFICE_VISITOR_THIRD = 24;

/**
 * How many chairs stand at the manager's desk in a reception this wide.
 *
 * A pure function of the room's own interior width, so the plan, the tests and
 * the docs cannot each have their own answer, and so the same floor produces
 * the same chairs on every rebuild. It is the INTERIOR rather than the desk
 * because the desk is itself derived from the interior, and one derivation is
 * easier to keep honest than two.
 * @param {number} interiorW
 */
export function visitorChairCount(interiorW) {
  return Number(interiorW) >= OFFICE_VISITOR_THIRD ? OFFICE_VISITOR_MAX : OFFICE_VISITOR_MIN;
}

/**
 * How much of the column's leftover height the reception takes before the
 * lounge does. The reception is the room the user reads first and the one the
 * product is about, so it takes the larger share of the slack; the lounge is
 * where nothing is happening and gives the room up.
 */
export const OFFICE_SURPLUS_SHARE = 0.55;

/**
 * THE SOFA GROUP, and the floor it puts under the lounge (WP-77).
 *
 * The living room — a television, a rug, two sofa runs, a coffee table and the
 * lamp beside it — is the deepest block the lounge lays, so it is the block
 * that decides how short an empty lounge can be. Stated here rather than inside
 * `buildLounge` because `LOUNGE_MIN_H` is arithmetic over it and the two must
 * not drift.
 */
export const LOUNGE_SOFA_GROUP_H = 11;

/**
 * THE SMALLEST THE LOUNGE MAY BE, whatever the ceiling below says (WP-77).
 *
 * One sofa group, the clear floor either side of it, and the plate across the
 * top. An empty lounge is still a lounge — "a cleared queue is the reward and
 * an empty grey box is not much of one" — and a room shorter than the furniture
 * in it would draw the furniture outside itself, which is the one thing the
 * plan may never do.
 *
 * It is a FLOOR and not a target: the lounge is as tall as its contents need,
 * and this is only what stops the contents being argued below themselves.
 */
export const LOUNGE_MIN_H = LOUNGE_SOFA_GROUP_H + MARGIN * 2 + PLATE_BAND;

/**
 * HOW MUCH OF THE BUILDING'S HEIGHT THE LOUNGE MAY BE PADDED TO (WP-77).
 *
 * The owner, 14 September: _"The lounge is very big, the whole bottom half."_
 * He was right, and the measurement is worse than the sentence: on the `three`
 * floor at 1600 x 1000 the lounge came out **27.7 of 57.1 units — 49% of the
 * building — with NOBODY IN IT**, and the identical 27.7 with fifteen people in
 * it. Its height had nothing to do with its occupants. It was
 * `LOUNGE_ROW_ASPECT_MAX` and `ROOM_FILL_MAX` between them: a room padded out
 * to keep a proportion against a row that is a hundred units wide.
 *
 * So the proportion keeps a CEILING over it, and the ceiling is a function of
 * who is in the room:
 *
 *   ≤ 5 people   25% of the building's height
 *   each 5 more  five points more, to 50%
 *
 * A CEILING ON PADDING AND NEVER A CAP ON CONTENTS. The lounge is first the
 * size of what it must hold — the clusters, the games and the standing band
 * `buildLounge` lays for every benched agent — and this only ever removes the
 * padding ON TOP of that. Where the two disagree the contents win, because a
 * room smaller than its furniture is the defect and a room larger than its
 * furniture is merely wasteful.
 *
 * The honest measurement, stated so nobody reads the number as a promise: at
 * `LOUNGE_MIN_H` (19.4) on a 49 U building the lounge is 40% of the height, not
 * 25%. The share bites on the PADDING, which on the owner's own floor was eight
 * units of it, and the floor minimum is what is left. `docs/DEVIATIONS.md`
 * §154.
 */
export const LOUNGE_SHARE_MIN = 0.25;
export const LOUNGE_SHARE_MAX = 0.5;
export const LOUNGE_SHARE_STEP = 0.05;
/** People the smallest lounge holds before the ceiling takes its first step. */
export const LOUNGE_QUIET_MAX = 5;
/** And how many more arrivals buy the next step. */
export const LOUNGE_SHARE_PER = 5;

/**
 * The share of the building's height the lounge may be padded to, for a lounge
 * with `n` people drawn in it. A pure function of the count and nothing else —
 * no clock, no stage, no randomness.
 * @param {number} n
 */
export function loungeShareFor(n) {
  const over = Math.max(0, (Number(n) || 0) - LOUNGE_QUIET_MAX);
  const steps = Math.ceil(over / LOUNGE_SHARE_PER);
  return clamp(LOUNGE_SHARE_MIN + steps * LOUNGE_SHARE_STEP, LOUNGE_SHARE_MIN, LOUNGE_SHARE_MAX);
}

/**
 * The tallest the lounge may be padded to, given the rest of the building.
 *
 * `restH` is everything that is NOT the lounge — the reception's row and the
 * corridor under it, or the reception above it in a column — so the share is
 * solved rather than guessed: `h ≤ s(restH + h)` is `h ≤ s·restH / (1 - s)`.
 * Stating it this way is what lets the ceiling be applied before the building's
 * height is known, which is the only moment the lounge's own height is still
 * being decided.
 *
 * @param {number} n people drawn in the lounge
 * @param {number} restH the building without it, in units
 */
export function loungeCeiling(n, restH) {
  const s = loungeShareFor(n);
  return Math.max(LOUNGE_MIN_H, (s * Math.max(0, Number(restH) || 0)) / (1 - s));
}

/**
 * Gap between two furniture groups in the lounge, and the pitch of the
 * standing-room band along its promenade.
 */
export const LOUNGE_GAP = 2;
export const MINGLE_PITCH = 2.4;
export const MINGLE_ROW = 2.4;

/**
 * How close the lounge's furniture may be pushed when the working side beside
 * it is short of height (WP-59c, step (c) of the fill order).
 *
 * A LOUNGE MAY NOT DICTATE AN EMPTY LOT BESIDE IT. The service column sets the
 * building's height, and the height a lounge asks for is a function of how
 * loosely its clusters are shelf-packed and how far apart the benched agents
 * stand — neither of which is furniture, and both of which an office adjusts
 * without anybody calling it cramped. So when the rooms and the strip together
 * still cannot reach the column's height, the column comes down to meet them:
 * the ladder below is the multiplier on `LOUNGE_GAP` and on the standing band's
 * pitch, tried loosest first, and the search takes a denser lounge only when it
 * actually buys the fill (see `better`). The office is not touched at all — it
 * is the room the product is about, and its queue is not a density problem.
 *
 * The pitch has its own floor because the gap has a meaning the gap-multiplier
 * does not know: `MINGLE_*_MIN` is one body and the clear width beside it, so
 * two benched agents at the densest setting stand next to each other rather
 * than inside each other.
 */
export const LOUNGE_PACKS = Object.freeze([1, 0.8, 0.65, 0.5]);
export const MINGLE_PITCH_MIN = 2;
export const MINGLE_ROW_MIN = 2;

/** Most games tables the lounge will ever lay out. */
export const LOUNGE_MAX_GAMES = 5;

/**
 * Widest the service column may get, and the step the search walks it in.
 * Past this the office and the lounge start to dominate a floor whose subject
 * is the working rooms.
 */
export const SERVICE_MAX_W = 72;
export const SERVICE_W_STEP = 2;

/**
 * The most bands the working floor is ever divided into, with ONE corridor
 * between each. Within a band the rooms tile it exactly and share their walls;
 * there is no other circulation on that side of the plan.
 *
 * WP-50 fixed this at two once there were three rooms. Two is still what a
 * normal floor comes out as — see the envelope search, which now CHOOSES the
 * band count rather than being told it — but a machine with twenty active
 * repos in one band makes a building five screens wide, and the choice is what
 * lets the plan take the shape of the window without stretching a room.
 */
export const MAX_WORKING_ROWS = 4;

/**
 * How far from square a project room may be before it stops being a room. Past
 * this the floor will give up its two-band plan rather than draw a splinter.
 */
export const PROJECT_ASPECT_LIMIT = 2.4;

/**
 * Clear floor the working side keeps beyond its furniture, as a fraction. Some
 * is necessary — people walk between the desks — and the treemap spends it as
 * margin inside each room rather than as corridor between them.
 *
 * WP-50 spent 55% here, which is 35% of every room drawn as carpet with
 * nothing on it before the treemap has stretched anything. The working rect is
 * measured from the rooms now (`workingShape`), so this is the whole of the
 * slack rather than a lower bound on it, and it is spent accordingly.
 */
export const WORKING_HEADROOM = 0.25;

/**
 * The most a band of rooms may be stretched past what its rooms need, to help
 * fill a working side made tall by the service column beside it.
 *
 * The bound is the acceptance criterion stated as a number: `WORKING_HEADROOM`
 * plus this must keep a room under `1 / (1 - 0.35)` of its natural footprint,
 * which is what "no room more than 35% bare carpet" means. Past it the floor
 * stops pretending and draws open circulation (`__open__`).
 *
 * WP-59b raised it from 1.15 to 1.25. `WORKING_HEADROOM` is spread over both
 * axes as `sqrt(1.25)`, so a band laid at 1.25 gives every cell 1.4 times the
 * depth its rooms need — one hair under `ROOM_FILL_MAX`, which is the area
 * bound the sentence above is actually about, and which still bites first.
 */
export const BAND_STRETCH_MAX = 1.25;

/**
 * The most floor a room may be given relative to the footprint its furniture
 * needs — `1 / (1 - 0.30)`, which is "no room more than 30% bare carpet" with
 * five points in hand against WP-55's acceptance bound of 35%.
 */
export const ROOM_FILL_MAX = 1 / 0.7;

/**
 * How much shallower than the deepest room in its row a room may be before it
 * is dealt into a row of its own.
 *
 * Every cell in a row is the row's depth, so a room `k` times shallower starts
 * `k` times over its own footprint before any width is shared out. Kept under
 * `ROOM_FILL_MAX / sqrt(1 + WORKING_HEADROOM)` so the width share can still
 * bring it back inside the bare-carpet bound.
 */
export const HEIGHT_BAND_RATIO = 1.25;

/** Squarest the reception may be before it stops reading as a room. */
export const OFFICE_ASPECT_MIN = 0.6;

/** Least of the service column the reception takes, however full the lounge. */
export const OFFICE_COLUMN_MIN = 0.32;

/**
 * A room may be up to this much wider than it is tall before it stops reading
 * as a room (05-LAYOUT-REWORK.md §2.2, VISUAL-SPEC acceptance 8).
 */
export const ROOM_ASPECT_MAX = 1.8;

/**
 * How far from a sofa's centre line its occupant sits, as a fraction of the
 * sofa's depth — forward of centre, clear of the back cushion.
 */
export const SOFA_SEAT_BIAS = 0.15;

/** Door opening width, in units. */
export const DOOR_WIDTH = 3.5;

/**
 * Angle from `from` pointing at `to`. 0 faces +x (east), PI/2 faces +y.
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 */
export function angleTo(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** @param {number} v @param {number} lo @param {number} hi */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
