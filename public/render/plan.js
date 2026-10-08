/**
 * DeckHQ floor plan generator — pure geometry, no canvas calls, so it is
 * unit-testable in plain Node. Coordinates are UNITS, not pixels.
 *
 * THE MODEL: one continuous floor, partially divided.
 *
 * The office is a single building envelope, subdivided by walls into zones
 * that TILE it exactly. Zones share their boundaries; there is no gap between
 * them and no zone floats free. That is the difference between an open-plan
 * office and a set of sheds in a field, and earlier revisions of this file
 * built the sheds: rooms were sized to their furniture and then scattered,
 * which left every room ringed by dead space.
 *
 * THE ANCHOR HIERARCHY, in order. Nothing is positioned by a bare coordinate:
 *
 *     floor
 *       walls        on zone boundaries
 *       tables       anchored in their zone
 *         chairs     anchored to their table edge
 *           agents   seated on their chair
 *         plants     anchored beside their table
 *
 * A project's furniture follows its headcount: tables come in 2, 4, 6 and 8
 * seat sizes, a project too big for one table gets several, and its zone
 * grows to hold them. Add a project and the floor re-tiles to make room.
 *
 * No DOM access anywhere — this file must import cleanly under `node --test`.
 *
 * WHERE THINGS ARE (WP-22). This file was 3,255 lines and is now the assembly
 * step plus the population rule. Its siblings hold the rest, each one a pure
 * function of its arguments and none of them importing this file back:
 *
 *   plan-shapes.js   what the shapes are — every typedef (WP-77)
 *   plan-units.js    every dimension the BUILDING sets
 *   plan-scale.js    every dimension a BODY sets, and how it scales (WP-88c)
 *   plan-packing.js  flow, shelf, squarify, tileRows — rectangles into a rect
 *   plan-anchors.js  resolveAnchors, translateContents, the table sizes
 *   plan-rooms.js    a project's room, and the pinned strip (WP-77)
 *   plan-plate.js    what a room plate SAYS, in words (WP-81)
 *   plan-office.js   the reception, upright and on its side (WP-59d)
 *   plan-service.js  the lounge
 *   plan-nav.js      walls, corridor centrelines, doors
 *   plan-envelope.js the working floor: bands, band widths, what it measures,
 *                    what it does with the height the column gave it, and how
 *                    a column is laid (WP-59, which took this file past the
 *                    900-line ceiling)
 *   plan-search.js   how the envelope search ranks two candidates, and two
 *                    arrangements (WP-59c, which took it past a second time)
 *   plan-rows.js     arrangement B: the office beside the rooms over the
 *                    lounge (WP-59d, and a third time)
 *   plan-classic.js  the envelope search itself, both arrangements and the
 *                    rectangles they come out as — `buildPlan`'s middle, moved
 *                    whole when this file stood at 899 lines
 *   plan-proportions.js  the designer's rulebook: shares, shapes, modules, rows
 *   plan-grid.js     the building laid to it, wherever there is a room to lay
 *   plan-grid-service.js  what that building asks of the reception and lounge
 *   plan-quiet.js    one or two rooms: the two service rooms a strip down the
 *                    left, and the rooms the rest of the building
 *   plan-seated.js   which chairs somebody is sitting in, for the bake
 *
 * Who is on the floor at all is not here either, and never was two answers
 * again: `public/floor-rule.js` is the one copy, imported by both sides (WP-22).
 *
 * Everything the old module exported is re-exported at the foot of this file,
 * so no import anywhere had to change.
 */

import { behindTheChip } from '../floor-resting.js';
import { awayRooms, floorPopulation, offTheFloor } from '../floor-rule.js';
import { benchSeatsIn, worktreeBenches } from '../floor-worktrees.js';
import { resolveAnchors, translateContents } from './plan-anchors.js';
import { layClassic } from './plan-classic.js';
import { layProportioned } from './plan-grid.js';
import { furnishRoom } from './plan-interior.js';
import { landscapeHalls } from './plan-margin.js';
import { assignDoors, buildNavLines, deriveWalls } from './plan-nav.js';
import {
  NOMINAL_PX_PER_UNIT,
  SCALE_MIN_PX_PER_UNIT,
  measureProportions,
  proportionFaults,
} from './plan-proportions.js';
import { crewFloorFor } from './plan-rooms.js';
import { markOccupiedChairs } from './plan-seated.js';
import { benchFloorFor, layWorktreeBenches } from './plan-worktrees.js';
import { AGENT_SCALE, DEFAULT_AGENT_SIZE, SIZE_IDS, sizeForPopulation } from './plan-scale.js';
import { seatOffice } from './plan-office.js';
import { LOUNGE_CHIP_ZONE } from './plan-service.js';
import { ASPECT_MAX, ASPECT_MIN, DEFAULT_ASPECT, DOOR_WIDTH, clamp } from './plan-units.js';

// ------------------------------------------------------------------ the plan

/**
 * Build the whole floor.
 *
 * THE PLAN IS A FUNCTION OF ACTIVE PROJECTS AND ACTIVE AGENTS (`08` B6). It
 * used to be a function of the repositories on disk: `buildProjectRoom` sized
 * desks by session count, benched sessions included, and a project with nobody
 * in it still bid for area in the treemap. On the reference machine that drew
 * one furnished room and ten large empty cells.
 *
 * @param {ProjectLike[]} projects
 * @param {AgentLike[]} agents
 * @param {{ targetAspect?: number, stage?: {w:number, h:number},
 *   goneHomeDays?: number, now?: number, agentSize?: string, furnish?: boolean }} [opts]
 *   `goneHomeDays` is `settings.goneHomeDays`; `now` is injectable so a test and
 *   a golden are both pure functions of their fixture. `stage` is the canvas the
 *   floor will be drawn on (WP-59), read only for its SHAPE, and `targetAspect`
 *   is that number stated directly — pass either. `agentSize` is WP-88c's.
 *   `furnish: false` leaves every room as its desks left it, which is how the
 *   furnishing is measured against the floor it was given (`plan-interior.js`).
 * @returns {Plan}
 */
export function buildPlan(projects, agents, opts = {}) {
  const stage = opts.stage;
  const stageAspect =
    stage && Number(stage.w) > 0 && Number(stage.h) > 0 ? Number(stage.w) / Number(stage.h) : 0;
  const targetAspect = clamp(
    Number(opts.targetAspect) || stageAspect || DEFAULT_ASPECT,
    ASPECT_MIN,
    ASPECT_MAX,
  );
  const list = Array.isArray(agents) ? agents : [];
  const pop = floorPopulation(list, { now: opts.now, goneHomeDays: opts.goneHomeDays });
  const waitingCount = pop.waiting;
  const goneHomeCount = pop.goneHome.size;
  // How big the people are (WP-88c) — before any geometry, because every body
  // length below is a live binding `plan-scale.js` §2 is what sets.
  const sized = sizeForPopulation(opts.agentSize ?? DEFAULT_AGENT_SIZE, pop);

  const idOf = (p) => String(p.id ?? p.projectId ?? 'unknown');
  // A WORKTREE IS NOT A PROJECT: the sessions working in a linked worktree sit
  // at that worktree's bench in the repository's room, and the desks are the
  // main checkout's (`floor-worktrees.js`). One desk at least, as ever.
  const benches = worktreeBenches(list, pop);
  const benched = { benches };
  const desksIn = (p) =>
    Math.max(
      1,
      pop.known.has(idOf(p))
        ? (pop.desks.get(idOf(p)) ?? 0) - benchSeatsIn(benched, idOf(p))
        : (p.activeCount ?? p.sessionCount ?? 0),
    );

  // WHICH REPOS ARE WORTH FLOOR SPACE — `splitProjectsByOccupancy`, and the
  // rule itself is in `floor-rule.js` since WP-60 rather than here. It moved
  // because a second caller appeared: the idle repos are a popover now, built
  // from the snapshot, and a rule about who is on the floor with two
  // implementations is a floor and a list that can disagree about the same repo.
  //
  // A repo nobody is in earns no room, no strip and no bare carpet: it is a
  // line in a list the user opens when they want it (WP-60) — UNLESS the user
  // PINNED it, which is WP-77's middle case and the one thing on this floor
  // that is not derived from what was observed. `pinned` comes off
  // `state.json` through the snapshot and nothing here may write it.
  // A repo whose people are all waiting in the office joins the strip, narrow
  // (`awayRooms`): `onFloor` is every repo with a room of either size.
  const { rooms: activeProjects, strip: pinnedProjects, onFloor } = awayRooms(projects, pop);

  // ---- who the floor draws nobody for.
  //
  // Two display filters, both of which leave `ackState` exactly as the user set
  // it: an agent who went home, and an agent at a desk in a project with no live
  // room. The door plate stands for the first and the idle list's line for the
  // second; `assignSeats` and `AgentRuntime#sync` read this set rather than
  // re-deriving it, so "is this person on the floor" has one answer and not two
  // that disagree. Keyed on the projects that HAVE A LIVE ROOM rather than on
  // the idle ones, which are not the same set: a repo the user archived and then
  // stopped working in is off the floor entirely, so asking "is this agent's
  // project idle?" answered no for it and left its sessions drawn in a room that
  // does not exist. A PINNED room is not in it either (WP-77): pinning kept the
  // room, not the people, and its room has no seat to draw anybody on.
  const roomIds = new Set(onFloor.map(idOf));
  const hidden = offTheFloor(list, roomIds, pop);

  // THE LOUNGE HOLDS THE BENCHED **AND** THE ENDED (WP-78). `08` B6's rule is
  // untouched — an `ended` session in a repo nobody is working in is still a line
  // in the idle list and nothing on the floor, which is what `hidden` above just
  // decided. What changed is where the ones whose repo IS live go: they used to
  // sit at a desk in it, making a room a register of what had ever run there.
  let restingCount = 0;
  for (const [pid, n] of pop.resting) if (roomIds.has(pid)) restingCount += n;
  // Sized by who is DRAWN: agents who went home are on the door plate only.
  const benchedCount = pop.benchedDrawn + restingCount;

  // ---- THE FLOOR, LAID, and every room, corridor and strip comes back placed.
  //
  // A FLOOR WITH A PROJECT ROOM ON IT IS LAID TO THE RULEBOOK
  // (`plan-proportions.js`): the rooms the majority of the building, every one
  // of them a room's shape, in a grid with nothing left over — `plan-grid.js`.
  // A floor with none has nothing for those rules to be about, and its office
  // and lounge share the building as they always have (`plan-classic.js`),
  // which is also what a floor no legal grid was found for falls back to.
  const crewIn = (p) => {
    const crew = crewFloorFor(pop, idOf(p));
    const bench = benchFloorFor(benches.get(idOf(p)));
    return bench ? { w: crew ? crew.w : 0, h: crew ? crew.h : 0, bench } : crew;
  };
  const live = new Map(activeProjects.map((p) => [idOf(p), p]));
  const kept = new Set(pinnedProjects.map(idOf));
  const gridRooms = (Array.isArray(projects) ? projects : [])
    .filter((p) => live.has(idOf(p)) || kept.has(idOf(p)))
    .map((p) => ({ project: live.get(idOf(p)) ?? p, pinned: !live.has(idOf(p)) }));
  const shared = { targetAspect, waitingCount, benchedCount, goneHomeCount, desksIn, crewIn };
  const layout =
    layProportioned({
      ...shared,
      stage,
      rooms: gridRooms,
      crewSizeIn: (p) => pop.crews.get(idOf(p))?.[0] ?? 0,
      benchSeatsIn: (p) => benchSeatsIn(benched, idOf(p)),
    }) || layClassic({ ...shared, activeProjects, pinnedProjects });
  const { W, H, office, lounge, projectRooms, working } = layout;

  // THE BODY SIZE FOLLOWS THE SCALE DOWN (`plan-proportions.js` (i)). A floor
  // whose rooms need a building too wide for this window at the smallest scale
  // a floor is drawn at would scroll. Before that, the same floor is laid a
  // body size smaller: smaller people need less desk, less sofa and less of a
  // crew's arc, so the rooms stay rooms and more of them fit.
  const fits = stageAspect ? Math.min(Number(stage.w) / W, Number(stage.h) / H) : Infinity;
  const smaller = SIZE_IDS[SIZE_IDS.indexOf(sized.size) - 1];
  if (fits < SCALE_MIN_PX_PER_UNIT - 1e-6 && smaller && gridRooms.length) {
    return buildPlan(projects, agents, { ...opts, agentSize: smaller });
  }
  // AND UP, WHERE THE SIZE IS LEFT TO THE FLOOR. `auto` reads a count, and a
  // count does not know how large the floor it buys is drawn: a dozen people
  // in two rooms are a small building in a large window. So a floor that is
  // still at the nominal scale or better one body size up is laid at that
  // size. A size somebody chose is never overruled.
  const larger = SIZE_IDS[SIZE_IDS.indexOf(sized.size) + 1];
  if (opts.agentSize === 'auto' && larger && gridRooms.length && fits !== Infinity) {
    const roomy = fits >= NOMINAL_PX_PER_UNIT - 1e-6;
    const up = roomy ? buildPlan(projects, agents, { ...opts, agentSize: larger }) : null;
    const held = up && Math.min(Number(stage.w) / up.width, Number(stage.h) / up.height);
    if (up) AGENT_SCALE.setting = 'auto';
    if (up && held >= NOMINAL_PX_PER_UNIT - 1e-6) return up;
    // The trial left every body length at the larger size: lay this one again.
    if (up) {
      const back = buildPlan(projects, agents, { ...opts, agentSize: sized.size });
      AGENT_SCALE.setting = 'auto';
      return back;
    }
  }
  const strip = { rooms: layout.stripRooms };

  const rooms = [
    office.room,
    ...layout.corridors,
    ...projectRooms.map((pr) => pr.room),
    ...strip.rooms,
    lounge.room,
  ];

  // ---- one frame, everywhere.
  //
  // Every builder lays its contents out in its own room's frame with (0,0) at
  // the room's top-left, so placing a room is a single translation and every
  // anchor then resolves against the same corner the coordinates were written
  // from. There is no second, content-relative frame to fall out of step.
  const place = (room, movable) => {
    // A project room is given a cell and rebuilt to its shape, but the two
    // never match to the unit. Its furniture is centred in the result rather
    // than pushed into a corner — safe here, and only here, because a project
    // room carries no wall-anchored props.
    const band = room.plateBand ?? 0;
    const slackX = room.natural ? Math.max(0, room.w - room.natural.w) / 2 : 0;
    const slackY = room.natural ? Math.max(0, room.h - room.natural.h) / 2 : 0;
    const dx = room.x + slackX;
    const dy = room.y + band + slackY;
    translateContents(room, dx, dy);
    for (const m of movable || []) {
      m.x += dx;
      m.y += dy;
    }
    resolveAnchors(room);
  };

  place(office.room, office.officeSeats);
  // Now that the reception's furniture has real coordinates, put people on it.
  const seating = seatOffice(office.room, waitingCount);
  place(lounge.room, lounge.loungeSpots);
  if (lounge.room.kitchenZone) {
    const kz = lounge.room.zones.find((z) => z.id === 'kitchen-zone');
    if (kz) lounge.room.kitchenZone = { x: kz.x, y: kz.y, w: kz.w, h: kz.h };
  }

  // WHO IS BEHIND THE LOUNGE'S CHIP (`plan-proportions.js` (g)). The lounge
  // laid a place for so many people — its seats and one standing row — and
  // everybody past that, longest-rested first, is `+N resting` on a chip at
  // the end of that row and a row each in the deck (`floor-resting.js`).
  //
  // NOT IN `hidden`. They are in the lounge: on its plate, and in the header's
  // count of who the floor holds. What the floor declines is to draw sixty
  // portraits of them, and `assignSeats` and the runtime read this set for it.
  const places = lounge.loungeSpots.reduce((a, sp) => a + Math.max(1, sp.capacity ?? 1), 0);
  const behind = behindTheChip(list, hidden, places);
  const chipZone = lounge.room.zones.find((z) => z.id === LOUNGE_CHIP_ZONE) || {
    x: lounge.room.x + lounge.room.w - 8,
    y: lounge.room.y + lounge.room.h - 4,
    w: 6,
    h: 2,
  };
  const loungeOverflow = behind.size
    ? {
        count: behind.size,
        ids: behind,
        x: chipZone.x,
        y: chipZone.y,
        w: chipZone.w,
        h: chipZone.h,
      }
    : null;

  /** @type {Map<string, Seat[]>} */
  const seats = new Map();
  for (const pr of projectRooms) {
    place(pr.room, pr.seats);
    seats.set(pr.room.id, pr.seats);
  }
  // A pinned room is placed like any other and seats NOBODY: pinning kept the
  // ROOM, not the people (WP-77, and WP-50 before it).
  for (const room of strip.rooms) place(room, []);
  const walls = deriveWalls(rooms, W, H);

  // The walkable network. Agents are confined to it — see buildNavLines.
  const nav = buildNavLines(rooms, W, H);
  assignDoors(rooms, nav.lines);
  // The worktree benches, against each room's foot wall and clear of the door
  // it has just been given — before the furnishing, which then works round them.
  /** @type {Map<string, Seat>} */
  const worktreeSeats = new Map();
  /** @type {any[]} */
  const worktreeBenchList = [];
  for (const pr of projectRooms) {
    const laid = layWorktreeBenches(pr.room, benches.get(String(pr.room.id)) || []);
    for (const [id, seat] of laid.seatOf) worktreeSeats.set(id, seat);
    worktreeBenchList.push(...laid.benches);
  }
  // Every room is furnished into the rectangle it ended up with, round the
  // desks it was built for and clear of the door it has just been given.
  if (opts.furnish !== false) for (const pr of projectRooms) furnishRoom(pr.room, pr.seats);
  // And the hall a floor of few rooms is left with is planted, clear of them.
  if (opts.furnish !== false) landscapeHalls(rooms);

  /** @type {Door[]} */
  const doors = [];
  for (const room of rooms) {
    if (room.walls !== 'full' || !room.door) continue;
    const onVertical =
      Math.abs(room.door.x - room.x) < 0.01 || Math.abs(room.door.x - (room.x + room.w)) < 0.01;
    doors.push({
      x: room.door.x,
      y: room.door.y,
      // The swing opens INTO the room, so the arc is drawn away from the
      // corridor the door gives onto.
      angle: onVertical
        ? Math.abs(room.door.x - room.x) < 0.01
          ? 0
          : Math.PI
        : Math.abs(room.door.y - room.y) < 0.01
          ? Math.PI / 2
          : -Math.PI / 2,
      width: DOOR_WIDTH,
    });
  }
  const measure = measureProportions({ width: W, height: H, rooms });

  /** @type {Plan} */
  const plan = {
    width: W,
    height: H,
    targetAspect,
    // The stage's width in pixels, where the caller had one: the floor is laid
    // for it as well as for its shape (`nominalWidth`), so the scene lays it
    // again when the window is a different size at the same shape.
    stageW: stageAspect ? Number(stage.w) : null,
    agentSize: sized.size, // what `auto` resolved to here; §2's `s` beside it
    agentScale: sized.s,
    arrangement: layout.arrangement,
    // What the floor's proportions ARE, measured off the rectangles below, and
    // the rules of `plan-proportions.js` it breaks — none, on a floor the grid
    // laid. A record and not a claim: the tests re-measure it.
    proportions: { ...measure, faults: proportionFaults(measure) },
    working,
    rooms,
    walls,
    nav: nav.lines,
    seats,
    // Who sits at a worktree's bench rather than at a desk, by agent id, and
    // the benches themselves, for the name written on each.
    worktreeSeats,
    worktreeBenches: worktreeBenchList,
    ...seating,
    loungeSpots: lounge.loungeSpots,
    letGoSpots: [], // an archived session has no place on the floor at all
    doors,
    // Who the floor draws nobody for, decided once here rather than twice.
    hidden,
    goneHome: pop.goneHome,
    // Who is in the lounge and not drawn, and where their chip stands; null
    // on every floor whose lounge has a place for everybody in it.
    loungeOverflow,
  };
  // Last, on the finished plan: the chairs somebody sits in face their desks.
  markOccupiedChairs(plan, list);
  return plan;
}

// ---------------------------------------------------------------- re-exports

/**
 * WP-22 split this file into its `plan-*` siblings. Everything the old module
 * exported is re-exported here, unchanged — typedefs included, so
 * `import('./plan.js').Room` still resolves — and no import anywhere moved.
 */

export { resolveAnchors, tableSizesFor } from './plan-anchors.js';
export { shelfPack, squarify, tileRows } from './plan-packing.js';
export * from './plan-plate.js';
export {
  ASPECT_TOLERANCE,
  FLOOR_OPEN_MAX,
  OPEN_FLOOR_MAX,
  PLATE_BAND,
  ROOM_FILL_COLUMN_MAX,
  ROOM_FILL_MAX,
  ROOM_HEIGHT_STRETCH_MAX,
  ROOM_WIDTH_STRETCH_MAX,
  SERVICE_COLUMN_MAX,
  U,
  WORKING_OPEN_MAX,
} from './plan-units.js';
export {
  AT_DESK_STATES,
  GONE_HOME_DAYS,
  WAITING_STATES,
  floorPopulation,
  isActiveAgent,
  isDeskAgent,
  isGoneHome,
  isWaitingAgent,
} from '../floor-rule.js';

/** @typedef {import('./plan-units.js').ActivityState} ActivityState */
/** @typedef {import('./plan-units.js').AckState} AckState */
/** @typedef {import('./plan-units.js').AgentLike} AgentLike */
/** @typedef {import('./plan-units.js').ProjectLike} ProjectLike */
/** @typedef {import('./plan-units.js').Anchor} Anchor */
/** @typedef {import('./plan-units.js').Prop} Prop */
/** @typedef {import('./plan-units.js').Zone} Zone */
/** @typedef {import('./plan-units.js').Wall} Wall */
/** @typedef {import('./plan-units.js').Room} Room */
/** @typedef {import('./plan-units.js').Seat} Seat */
/** @typedef {import('./plan-units.js').LoungeSpot} LoungeSpot */
/** @typedef {import('./plan-units.js').Door} Door */
/** @typedef {import('./plan-units.js').NavLine} NavLine */
/** @typedef {import('./plan-units.js').Plan} Plan */
