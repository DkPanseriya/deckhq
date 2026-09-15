/**
 * The plan's vocabulary: what the shapes ARE.
 *
 * Split out of `plan-units.js` by WP-77, which took that file past
 * `model.test.mjs`'s 900-line ceiling. WP-22's own remedy is the split and
 * never a higher ceiling, and this is the seam the file's own first sentence
 * had already drawn: it held "what the shapes ARE, and how big things are",
 * which is two things. The DIMENSIONS stayed where they were — one definition
 * and one place to change it — and the shapes came here.
 *
 * NOTHING IMPORTS THIS DIRECTLY, and nothing needs to. `plan-units.js`
 * re-declares every typedef below as `import('./plan-shapes.js').X`, so
 * `import('./plan-units.js').Room` and `import('./plan.js').Room` — which
 * `agents.js`, `scene.js`, `backdrop.js` and a dozen others write — resolve
 * exactly as they did before the split.
 *
 * Types only. One empty runtime export, so this is a module rather than a
 * script. No DOM, no imports of its own.
 */

export {};

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
 * @property {number} [projectMk] the MK number this project's identity colour
 *   is derived from (CONTRACTS-WP15.md §1). Assigned once and persisted, which
 *   is what lets WP-72 tint the room's carpet with it.
 * @property {number} [tokens]
 * @property {number} [needsYou]
 * @property {boolean} [hasDashboard] the project has a runnable dashboard
 * @property {boolean} [archived] the user collapsed this project off the floor
 * @property {boolean} [pinned] the user pinned this project's room (WP-77): it
 *   keeps a room with nothing running in it. User-owned state from
 *   `state.json`, never derived — see `src/core/store.mjs`.
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
 * @property {'wool'|'task'} [tone] which textile a rug is (WP-85b). A painter
 *   cannot ask what room it is in, and a project room's break-out rug and the
 *   reception's wool are the same two KINDS in two different materials, so the
 *   plan declares it — the seam `prop.tall` already uses for a prop's height.
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
 * @property {string} [bay] the lounge only (WP-85c): which of §3.7's four named
 *   bays this rectangle is the ground of. A bay is a PLACE — its own ground, its
 *   own centrepiece, a planter run between it and the next one — so the plan
 *   names it rather than leaving the reader to infer a grouping from positions.
 * @property {'wood'|'tile'} [ground] what that bay stands on. Only the café's
 *   differs from the boards, which is why the lounge already carried a
 *   `kitchenZone` before there were bays to have one.
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
 * @typedef {object} Room
 * @property {'office'|'project'|'lounge'|'corridor'} kind
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
 * @property {number} [projectMk] project rooms only: the MK number this
 *   project's identity colour is derived from, which is what tints its carpet
 *   (WP-72). Absent on every other kind of room, and `identityFor` is total,
 *   so a room whose MK has not resolved yet still paints.
 * @property {{x:number,y:number,w:number,h:number}} [kitchenZone]
 * @property {number} [plateBand] height reserved across the top of the room for
 *   its plate. `PLATE_BAND` on every room that carries one.
 * @property {{w:number, h:number}} [natural] what this room's own contents need,
 *   before the packer gives it a cell (WP-55, docs/DEVIATIONS.md §106).
 * @property {boolean} [pinned] project rooms only (WP-77): the room a repo the
 *   user PINNED keeps with nobody in it — one desk, nobody at it, and at most
 *   `PINNED_AREA_SHARE` of the narrowest live room's footprint. Absent on every
 *   live room, so `room.pinned === true` is the whole of the test.
 * @property {boolean} [landscape] the reception, laid on its side for a row
 *   (WP-59d): the waiting area runs along its width and the desk is at one
 *   end. `seatOffice` reads it to walk the runs in queue order.
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
 * @property {boolean} [standing] WP-78: a place in the office queue, which has
 *   no chair under it. The rig draws its occupant on its feet.
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
 * @property {WorkingSide} working what the working side did with the height
 *   the service column gave it (WP-59c)
 * @property {Arrangement} arrangement which shape the envelope search chose
 *   (WP-59d): `column` is the service column beside the working side, which
 *   every floor before this package was laid as; `two-rows` is the office
 *   beside the rooms over the lounge beside the strip.
 */

/** @typedef {'column'|'two-rows'} Arrangement */

/**
 * @typedef {object} WorkingSide
 * @property {number} x the working side's left edge, in units
 * @property {number} w its width
 * @property {number} open the fraction of it nobody stands on
 * @property {number} bareCarpet the worst room's bare fraction — floor inside
 *   a room its furniture does not occupy. REPORTED, never enforced (WP-60):
 *   `ROOM_FILL_MAX` used to stop a band short of its row rather than let this
 *   rise, which bought tidiness with a bay of open floor beside the rooms.
 * @property {boolean} roomsStretched (a) — the rooms were made deeper than the
 *   plan would have chosen, to meet the service column
 * @property {number} loungePack (b) — how tightly the lounge was packed; `1`
 *   is the room untouched
 * @property {number} openH (c) — the open plan left under the rooms, in units
 * @property {number} [pinnedH] the depth the pinned strip took along the bottom
 *   of the working side (WP-77); `0` on every floor with nothing pinned
 *
 * There used to be a `stripCols` between (a) and (b) — the columns the idle
 * strip had been laid in — because the strip standing its lines up was a step
 * of the fill order. WP-60 took the strip off the floor and the step with it.
 */
