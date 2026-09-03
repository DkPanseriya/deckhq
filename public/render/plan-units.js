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
 * defining it there (WP-22, `docs/DEVIATIONS.md` §121 defect 3). It is a shape,
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
export const DIRECTORY_PAD = 1;

/**
 * The tallest the whole directory may ever be, however many idle repos there
 * are: its own plate band plus `DIRECTORY_MAX_ROWS` lines. Exported so the
 * integrity test asserts the cap the strip is actually built against rather
 * than a second copy of the arithmetic.
 */
export const DIRECTORY_MAX_H = PLATE_BAND + DIRECTORY_MAX_ROWS * DIRECTORY_LINE_H + DIRECTORY_PAD;

/** Days of no activity after which a benched agent is not drawn. */
export const GONE_HOME_DAYS = 7;
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where the shelf and the dashboard screen start down a project room's east
 * wall — clear of the in-room "+" that sits in the corner above them.
 */
export const FIXTURE_TOP = 0.6;

/** How much of a project room's west wall its whiteboard takes. */
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
export const OFFICE_MAX_W = 38;
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
 */
export const BAND_STRETCH_MAX = 1.15;

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
