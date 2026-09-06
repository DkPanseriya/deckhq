/**
 * The plan's vocabulary: what the shapes ARE, and how big things are.
 *
 * Split out of `plan.js` by WP-22. Every other `plan-*.js` module imports from
 * here and none of them import each other's constants, so a dimension has one
 * definition and one place to change it. The typedefs live here for the same
 * reason: `plan.js` re-exports them, so `import('./plan.js').Room` — which
 * `agents.js`, `scene.js` and `backdrop.js` all write — still resolves.
 *
 * Pure data and two arithmetic helpers. No DOM, no imports of its own.
 */

/** @typedef {'working'|'needs_input'|'stalled'|'for_review'|'ended'} ActivityState */
/** @typedef {'active'|'benched'|'let_go'} AckState */

/**
 * @typedef {object} AgentLike
 * @property {string} [id]
 * @property {string} [projectId]
 * @property {AckState} [ackState]
 * @property {ActivityState} [activityState]
 * @property {number} [lastActivityAt] ms epoch; drives the gone-home filter
 */

/**
 * @typedef {object} ProjectLike
 * @property {string} [id]
 * @property {string} [projectId]
 * @property {string} [name]
 * @property {string} [projectName]
 * @property {number} [sessionCount]
 * @property {number} [tokens]
 * @property {number} [needsYou]
 * @property {boolean} [hasDashboard] the project has a runnable dashboard
 * @property {boolean} [archived] the user collapsed this project off the floor
 * @property {number} [lastActivityAt] ms epoch of the newest session in it
 * @property {number|null} [todaySpend] WP-26's payroll meter; see `payrollLine`
 * @property {boolean} [todaySpendIsToday] whether that figure is today's
 */

/**
 * How a prop's position was derived. Every prop carries one.
 * @typedef {{type:'zone', of:string, dx:number, dy:number}
 *   | {type:'wall', side:'N'|'S'|'E'|'W', along:number, inset?:number}
 *   | {type:'corner', corner:'NE'|'NW'|'SE'|'SW', inset?:number}
 *   | {type:'attached', to:string, edge:'N'|'S'|'E'|'W', along:number, gap?:number}
 *   | {type:'centered', of:string}} Anchor
 */

/**
 * A furniture instance the backdrop paints.
 *
 * `x, y` is the TOP-LEFT corner, in absolute units — the same convention as
 * `Room`, `Zone` and `Wall`, so every rectangle in the renderer means the same
 * thing. `backdrop.js` translates to the rect centre before drawing.
 *
 * @typedef {object} Prop
 * @property {string} kind
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {number} angle
 * @property {Anchor} anchor
 * @property {string} [id] required on anchor targets
 */

/**
 * A structural rectangle inside a room — a table's footprint, a sofa group, an
 * activity slice. Never painted; it exists so anchors have something real to
 * refer to.
 * @typedef {object} Zone
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

/**
 * A wall segment on a zone boundary. Walls are properties of the FLOOR, not of
 * a room: two zones either side of a partition share one wall, which is what
 * makes the plan read as one building.
 * @typedef {object} Wall
 * @property {number} x1
 * @property {number} y1
 * @property {number} x2
 * @property {number} y2
 * @property {'exterior'|'solid'|'partition'} kind
 * @property {{at:number, width:number}} [door] gap along the segment
 */

/**
 * One idle project's line in the directory strip. Local to the strip's own
 * frame until `place` translates it, exactly like a prop.
 * @typedef {object} DirectoryEntry
 * @property {string} id project id
 * @property {string} name
 * @property {number} sessionCount
 * @property {number} lastActivityAt ms epoch, 0 when unknown
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

/**
 * @typedef {object} Room
 * @property {'office'|'project'|'lounge'|'corridor'|'directory'} kind
 * @property {string} id
 * @property {string} name
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {'full'|'partial'} walls
 * @property {[string, string]|[string, string, string]} plateLines
 *   Name, one data line, and — project rooms only, WP-26 — a quiet payroll
 *   line. The third is `''` when there is nothing honest to put there, and a
 *   renderer that only knows about two lines is correct to ignore it.
 * @property {Prop[]} props
 * @property {Zone[]} zones
 * @property {'wood'|'carpet'|'tile'|'circulation'} floor
 * @property {{x:number,y:number,w:number,h:number}} [kitchenZone]
 * @property {DirectoryEntry[]} [entries] the directory strip only
 * @property {number} [plateBand] height reserved across the top of the room for
 *   its plate. `PLATE_BAND` on every room that carries one.
 * @property {{w:number, h:number}} [natural] what this room's own contents need,
 *   before the packer gives it a cell (WP-55, docs/DEVIATIONS.md §106).
 * @property {boolean} [thoroughfare] a corridor nobody routes down when false.
 * @property {{x:number,y:number}} [door] where an occupant leaves the room, set
 *   by `assignDoors` once the nav graph exists.
 * @property {{x:number,y:number}} [navEntry] the point on the corridor that door
 *   opens onto.
 * @property {string} [navLineId] which nav line `navEntry` sits on.
 */

/**
 * @typedef {object} Seat
 * @property {number} x
 * @property {number} y
 * @property {number} angle radians; the occupant faces this direction
 */

/**
 * @typedef {object} LoungeSpot
 * @property {string} id
 * @property {'pool'|'table_tennis'|'board_game'|'arcade'|'coffee'|'eat'|'chat'|'lounge_idle'} kind
 * @property {number} x
 * @property {number} y
 * @property {number} angle
 * @property {number} capacity
 * @property {string} [partnerOf]
 */

/**
 * One walkable corridor centreline.
 *
 * It used to be declared inside `buildNavLines`'s own doc comment, which is
 * why `agents.js` could reference `NavLine` in five annotations with nothing
 * defining it there (WP-22, `docs/DEVIATIONS.md` §122 defect 3). It is a shape,
 * so it lives with the other shapes.
 *
 * @typedef {object} NavLine
 * @property {string} id
 * @property {'h'|'v'} axis
 * @property {number} c    the constant coordinate: y for 'h', x for 'v'
 * @property {number} min  start along the varying axis
 * @property {number} max  end along the varying axis
 */

/**
 * @typedef {object} Door
 * @property {number} x
 * @property {number} y
 * @property {number} angle
 * @property {number} width
 */

/**
 * @typedef {object} Plan
 * @property {number} width
 * @property {number} height
 * @property {number} targetAspect
 * @property {Room[]} rooms tiling the envelope, sharing boundaries
 * @property {Wall[]} walls
 * @property {NavLine[]} nav corridor centrelines; the only walkable routes
 * @property {Map<string, Seat[]>} seats keyed by projectId
 * @property {Seat[]} officeSeats
 * @property {LoungeSpot[]} loungeSpots
 * @property {Seat[]} letGoSpots always empty: an archived session has no place
 *   on the floor at all. Kept so a renderer can ask without a guard.
 * @property {Door[]} doors
 * @property {Set<string>} hidden agent ids the plan draws nobody for
 * @property {Set<string>} goneHome the subset of `hidden` that went home
 * @property {Room|null} directory the idle-projects strip, when there is one
 * @property {WorkingSide} working what the working side did with the height
 *   the service column gave it (WP-59c)
 */

/**
 * @typedef {object} WorkingSide
 * @property {number} x the working side's left edge, in units
 * @property {number} w its width
 * @property {number} open the fraction of it nobody stands on
 * @property {boolean} roomsStretched (a) — the rooms were made deeper than the
 *   plan would have chosen, to meet the service column
 * @property {number} stripCols (b) — columns the idle strip was laid in, `0`
 *   when there is no strip
 * @property {number} loungePack (c) — how tightly the lounge was packed; `1`
 *   is the room untouched
 * @property {number} openH (d) — the open plan left under both, in units
 */

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
export const WORKING_OPEN_MAX = 0.1;

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
 * The most of the working side's height the idle strip may take (WP-59c).
 *
 * Step (b) of the fill order. Once the rooms are as deep as they may honestly
 * be and the working side is still short, the strip takes the next of it — by
 * using FEWER columns and more rows, which is the same lines in a taller
 * board and costs nothing but the shape of the board. It is capped because a
 * strip is a strip: past a quarter of the working side, seventeen idle repos
 * start to read as the subject of the floor rather than as its footnote.
 */
export const DIRECTORY_SIDE_MAX = 0.25;

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

export const PLANT_SIZE = 2;
export const PLANT_GAP = 0.4;

/**
 * THE DIRECTORY STRIP — where a project with nobody in it goes.
 *
 * An idle project used to get a collapsed ROOM, which still bid for area in
 * the treemap; on the reference machine that turned most of the working floor
 * into large empty cells with a plate each (`08` B6). It now costs one LINE in
 * a single strip along the bottom of the working floor: name, session count,
 * last activity, and the same click target a room plate has.
 *
 * The lines flow into columns so the strip stays a strip. `DIRECTORY_MAX_ROWS`
 * is the cap that keeps it one: past it the columns get narrower and the text
 * ellipsises, but a project is never dropped from the directory — a repo you
 * cannot see is a repo you cannot start an agent in.
 */
export const DIRECTORY_LINE_H = 1.6;
export const DIRECTORY_COL_W = 15;
export const DIRECTORY_COL_MAX_W = 28;
/**
 * The most rows the strip is allowed, however narrow the working side.
 *
 * WP-50 set this at three and let the COLUMNS overflow instead: past three
 * rows the columns narrowed and the names ellipsised. That works while the
 * working floor is the width of the building, and WP-55 made the working floor
 * the width of its ROOMS — one active project is about seventeen units across,
 * which is one column, and seventeen idle repos then arrived stacked six deep
 * in a strip with room for three. A line has a minimum readable width; a strip
 * has a whole working side to grow down. So the rows give way now and the
 * columns hold their width, up to this cap.
 */
export const DIRECTORY_MAX_ROWS = 18;

/**
 * The most columns the envelope search will ever ask the strip for (WP-59).
 *
 * The strip's column count is one of the levers the plan spends a wide window
 * on, and without a bound the ladder of candidate widths grows with the number
 * of idle repos — sixty of them is sixty column counts to try, on a search that
 * runs on every re-plan. Six columns is already a board the width of the
 * working floor; past that the strip stops being a strip, which the integrity
 * test asserts separately.
 */
export const DIRECTORY_MAX_COLS = 6;
export const DIRECTORY_PAD = 1;

/**
 * The tallest the whole directory may ever be, however many idle repos there
 * are: its own plate band plus `DIRECTORY_MAX_ROWS` lines. Exported so the
 * integrity test asserts the cap the strip is actually built against rather
 * than a second copy of the arithmetic.
 */
export const DIRECTORY_MAX_H = PLATE_BAND + DIRECTORY_MAX_ROWS * DIRECTORY_LINE_H + DIRECTORY_PAD;

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
 * How much bigger than its desk cluster a rug may grow (WP-55).
 *
 * WP-50 let the rug grow to the room with no ceiling, on the grounds that a
 * small rug in a large cell reads as desks adrift. It does — but a rug that IS
 * the room reads as bare carpet, which is what the reference floor showed: an
 * 88 x 67 rug with one two-seat table on it. A rug defines a group; past this it
 * is floor covering, and the honest answer is to make the room smaller, which
 * is what the rest of this package does.
 */
export const RUG_MAX_OVER_CLUSTER = 1.6;

/**
 * The same ceiling for a room the SERVICE COLUMN made deep (WP-59c).
 *
 * "Make the room smaller" is the honest answer to a room the plan CHOSE to
 * stretch, and it is not available for one the column stretched: the building
 * is as tall as its lounge, the room beside it is given that height, and the
 * choice is between a rug under the desks and bare carpet under them. So the
 * rug is allowed further down the depth axis only, and only there — the width
 * still stops at `RUG_MAX_OVER_CLUSTER`, because nothing ever made the room
 * wider than the plan chose.
 */
export const RUG_MAX_OVER_COLUMN = 2.6;

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
 * How much of the column's leftover height the reception takes before the
 * lounge does. The reception is the room the user reads first and the one the
 * product is about, so it takes the larger share of the slack; the lounge is
 * where nothing is happening and gives the room up.
 */
export const OFFICE_SURPLUS_SHARE = 0.55;

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
