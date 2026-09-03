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
 * step plus the population rule. Six siblings hold the rest, each one a pure
 * function of its arguments and none of them importing this file back:
 *
 *   plan-units.js    the shapes and every dimension
 *   plan-packing.js  flow, shelf, squarify, tileRows — rectangles into a rect
 *   plan-anchors.js  resolveAnchors, translateContents, the table sizes
 *   plan-rooms.js    a project's room, and the idle strip's lines
 *   plan-service.js  the office and the lounge
 *   plan-nav.js      walls, corridor centrelines, doors
 *
 * Everything the old module exported is re-exported at the foot of this file,
 * so no import anywhere had to change. Nothing else moved: `buildPlan` below
 * is the same function, line for line, and the goldens are byte-identical.
 */

import { resolveAnchors, translateContents } from './plan-anchors.js';
import { assignDoors, buildNavLines, deriveWalls } from './plan-nav.js';
import { squarify } from './plan-packing.js';
import { buildDirectory, buildProjectRoom, directoryHeight } from './plan-rooms.js';
import { buildLounge, buildOffice, seatOffice } from './plan-service.js';
import {
  ASPECT_MAX,
  ASPECT_MIN,
  BAND_STRETCH_MAX,
  CORRIDOR,
  DAY_MS,
  DEFAULT_ASPECT,
  DOOR_WIDTH,
  GONE_HOME_DAYS,
  HEIGHT_BAND_RATIO,
  MARGIN,
  MAX_WORKING_ROWS,
  MIN_PROJECT_ROOM_W,
  OFFICE_ASPECT_MIN,
  OFFICE_COLUMN_MIN,
  OFFICE_MAX_W,
  OFFICE_MIN_W,
  OFFICE_SURPLUS_SHARE,
  PLATE_BAND,
  PROJECT_ASPECT_LIMIT,
  ROOM_ASPECT_MAX,
  ROOM_FILL_MAX,
  ROOM_PAD,
  SERVICE_MAX_W,
  SERVICE_W_STEP,
  WORKING_HEADROOM,
  clamp,
} from './plan-units.js';

// ------------------------------------------------- who is on the floor at all

/**
 * The activity states that count as "on the floor": at a desk, hand up, or
 * waiting in the office. `ended` is not one of them — a session that has
 * finished and been acknowledged is history, not a person in the building.
 */
const ON_THE_FLOOR = new Set(['working', 'needs_input', 'stalled', 'for_review']);

/**
 * Does this agent put its project on the working floor?
 *
 * `08` B6, the rule this file is built around: the plan is a function of
 * active projects and active agents and nothing else. An active agent is one
 * the user has not benched or archived, doing something — working, hand up,
 * gone quiet, or standing in the office waiting to be seen.
 * @param {AgentLike} agent
 */
export function isActiveAgent(agent) {
  return (
    !!agent &&
    agent.ackState === 'active' &&
    ON_THE_FLOOR.has(/** @type {string} */ (agent.activityState))
  );
}

/**
 * Does this agent occupy a DESK in its project's room?
 *
 * Everything `placement()` (src/core/model.mjs) calls `desk`: active, and not
 * standing in the office. That includes an `ended` session sitting at its own
 * desk — it is drawn whenever its project has a room, and it is what "desks
 * equal agents at desks" counts.
 * @param {AgentLike} agent
 */
export function isDeskAgent(agent) {
  return !!agent && agent.ackState === 'active' && agent.activityState !== 'for_review';
}

/**
 * Has this benched agent gone home?
 *
 * A DISPLAY FILTER AND NOTHING ELSE. `ackState` is untouched, the agent is
 * still counted, still in the panel, still one keystroke away, and any new
 * activity brings it back on the next scan — which is why this reads
 * `lastActivityAt` rather than storing a flag anywhere. The `INVARIANT:` tests
 * must pass unchanged, and they do: nothing here writes.
 *
 * Two deliberate refusals. A window of zero disables the filter rather than
 * hiding everybody, and an agent whose last activity is unknown is DRAWN — the
 * floor does not hide what it cannot date.
 *
 * @param {AgentLike} agent
 * @param {number} now ms epoch
 * @param {number} [goneHomeDays] `settings.goneHomeDays`
 */
export function isGoneHome(agent, now, goneHomeDays = GONE_HOME_DAYS) {
  if (!agent || agent.ackState !== 'benched') return false;
  const days = Number(goneHomeDays);
  if (!Number.isFinite(days) || days <= 0) return false;
  const last = Number(agent.lastActivityAt);
  if (!Number.isFinite(last) || last <= 0) return false;
  return now - last > days * DAY_MS;
}

/**
 * Everything the plan needs to know about a population, counted once.
 *
 * Exported because it is the whole of B6's rule in one place, and a test that
 * checks the rule should read the same numbers the floor is built from rather
 * than re-deriving them.
 *
 * @param {AgentLike[]} agents
 * @param {{now?:number, goneHomeDays?:number}} [opts]
 */
export function floorPopulation(agents, opts = {}) {
  const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
  const goneHomeDays = opts.goneHomeDays ?? GONE_HOME_DAYS;
  const list = Array.isArray(agents) ? agents : [];

  let waiting = 0;
  let benchedDrawn = 0;
  /** @type {Map<string, number>} */
  const active = new Map();
  /** @type {Map<string, number>} */
  const desks = new Map();
  /** Project ids the agent list actually mentions. See `buildPlan`. */
  const known = new Set();
  /** @type {Set<string>} */
  const goneHome = new Set();
  /** Newest activity per project — the directory strip's third column. */
  const lastActivity = new Map();

  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

  for (const a of list) {
    if (!a || a.ackState === 'let_go') continue;
    const pid = a.projectId == null ? '' : String(a.projectId);
    if (pid) {
      known.add(pid);
      const at = Number(a.lastActivityAt) || 0;
      if (at > (lastActivity.get(pid) || 0)) lastActivity.set(pid, at);
    }
    if (a.ackState === 'benched') {
      if (isGoneHome(a, now, goneHomeDays)) goneHome.add(String(a.id));
      else benchedDrawn++;
      continue;
    }
    if (a.ackState !== 'active') continue;
    if (a.activityState === 'for_review') waiting++;
    if (pid && isActiveAgent(a)) bump(active, pid);
    if (pid && isDeskAgent(a)) bump(desks, pid);
  }

  return { now, goneHomeDays, waiting, benchedDrawn, goneHome, active, desks, known, lastActivity };
}

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
 * @param {{ targetAspect?: number, goneHomeDays?: number, now?: number }} [opts]
 *   `goneHomeDays` is `settings.goneHomeDays`; `now` is injectable so a test
 *   and a golden can both be a pure function of their fixture.
 * @returns {Plan}
 */
export function buildPlan(projects, agents, opts = {}) {
  const targetAspect = clamp(Number(opts.targetAspect) || DEFAULT_ASPECT, ASPECT_MIN, ASPECT_MAX);
  const list = Array.isArray(agents) ? agents : [];
  const pop = floorPopulation(list, { now: opts.now, goneHomeDays: opts.goneHomeDays });
  const waitingCount = pop.waiting;
  // The lounge is sized by how many are DRAWN. Agents who went home are on the
  // door plate and nowhere else.
  const benchedCount = pop.benchedDrawn;
  const goneHomeCount = pop.goneHome.size;

  const idOf = (p) => String(p.id ?? p.projectId ?? 'unknown');
  /**
   * The counts a project is planned from.
   *
   * Read off the AGENTS, which is the whole point of B6. The fallback matters
   * only for a caller that hands `buildPlan` a project it gave no agents for:
   * the plan cannot invent people it was not given, so the project record's
   * own counts are then the only thing to go on.
   */
  const activeIn = (p) =>
    pop.known.has(idOf(p))
      ? (pop.active.get(idOf(p)) ?? 0)
      : (p.activeCount ?? p.sessionCount ?? 0);
  const desksIn = (p) =>
    Math.max(
      1,
      pop.known.has(idOf(p))
        ? (pop.desks.get(idOf(p)) ?? 0)
        : (p.activeCount ?? p.sessionCount ?? 0),
    );

  // Which repos are worth floor space.
  //
  //   an active agent      -> a room, with desks for the agents at them
  //   nobody, not archived -> one line in the directory strip
  //   nobody, archived     -> off the floor entirely
  //
  // An active agent always wins, which is what makes archiving safe: a project
  // the user archived comes back by itself the moment somebody starts working
  // in that repo, rather than hiding them.
  const isIdle = (p) => activeIn(p) === 0;
  const visible = (Array.isArray(projects) ? projects : []).filter(
    (p) => (p.sessionCount ?? 0) > 0 && !(isIdle(p) && p.archived),
  );
  const activeProjects = visible.filter((p) => !isIdle(p));
  const idleProjects = visible.filter(isIdle);

  // ---- who the floor draws nobody for.
  //
  // Two display filters, both of which leave `ackState` exactly as the user
  // set it: an agent who went home, and an agent sitting at a desk in a
  // project that has no room. The strip's line — name, sessions, last
  // activity — is what stands for the second group, and the door plate for the
  // first. `assignSeats` and `AgentRuntime#sync` read this set rather than
  // re-deriving it, so there is one answer to "is this person on the floor"
  // and not two that can disagree.
  // Keyed on the projects that HAVE a room rather than on the idle ones. Those
  // are not the same set: a project the user archived and then stopped working
  // in is off the floor entirely, so it is in neither `activeProjects` nor
  // `idleProjects`, and asking "is this agent's project idle?" answered no for
  // it — leaving its sessions drawn in a room that does not exist.
  const roomIds = new Set(activeProjects.map(idOf));
  /** @type {Set<string>} */
  const hidden = new Set(pop.goneHome);
  for (const a of list) {
    if (!a || !isDeskAgent(a)) continue;
    if (!roomIds.has(String(a.projectId))) hidden.add(String(a.id));
  }

  // ---- pass 1: everything at its natural size, purely to bid for space.
  let office = buildOffice(waitingCount);
  let lounge = buildLounge(benchedCount, undefined, goneHomeCount);
  // ARCHIVED SESSIONS ARE OFF THE FLOOR. They get no room, no street and no
  // strip: an archived session is one the user has explicitly put away, and
  // the floor is for the ones that are still in play. They are still counted
  // in the header and still listed in the panel — they simply do not take
  // screen space away from the rooms where work happens.
  //
  // Bid at the shape a ROOM wants, not at a square. `flowBlocks` decides how a
  // project's tables are arranged, and asking it for a square cluster stands a
  // two-table project's benches one above the other — a room twice the depth of
  // its neighbours, which then has to be dealt a row of its own with a bay
  // beside it (see `bandsOf`). One row of tables is what an office does, and it
  // keeps every room in a band the same depth.
  /** @type {{room: Room, seats: Seat[]}[]} */
  const projectRooms = activeProjects.map((p) => buildProjectRoom(p, desksIn(p), ROOM_ASPECT_MAX));

  /** One directory line per idle project. */
  const directoryProjects = idleProjects.map((p) => ({
    id: idOf(p),
    name: String(p.name ?? p.projectName ?? idOf(p)),
    sessionCount: p.sessionCount ?? 0,
    lastActivityAt: pop.lastActivity.get(idOf(p)) ?? Number(p.lastActivityAt) ?? 0,
  }));

  // ---- THE FLOOR IS THREE BANDS, and their shares are the design.
  //
  //   service   ~32%  the user's office above the lounge
  //   working   ~65%  the project rooms, which are what the product is for
  //
  // Everything below follows from that. Earlier revisions let each band ask
  // for what its contents wanted and then tried to reconcile the result, which
  // is how a machine whose sessions are nearly all benched ended up with 58%
  // of its floor given to a reception, a lounge and a room full of archived
  // sessions, and 13% to the rooms with people working in them.
  //
  // The service column is what sets the scale: it holds a roughly fixed amount
  // of furniture, so once its width is chosen the rest of the floor follows
  // from the shares. The search below picks that width.
  const serviceCache = new Map();
  const measureService = (sw) => {
    const key = Math.round(sw);
    let got = serviceCache.get(key);
    if (got) return got;
    // `h: 0` on purpose — this measures what the column NEEDS at that width.
    // Passing a height here makes each room pad itself out to it and the
    // measurement then reports back whatever was asked for.
    // ONE COLUMN WIDTH, and both rooms fill it.
    //
    // The office and the lounge are the same width and each spans the column,
    // so there is no strip of anything beside either of them. A lobby there is
    // a room-shaped piece of nothing next to the room the user reads first,
    // and it was taking width the working floor could have had.
    const o = buildOffice(waitingCount, { w: Math.min(key, OFFICE_MAX_W), h: 0 });
    const colW = o.room.w;
    const l = buildLounge(benchedCount, { w: colW, h: 0 }, goneHomeCount);
    // The lounge takes the column's width whatever its blocks packed to: open
    // floor in a lounge is a lounge, and the alternative is a strip of
    // circulation beside it doing the same job less honestly.
    l.room.w = colW;
    got = { w: colW, office: o, lounge: l, h: o.room.h + l.room.h };
    serviceCache.set(key, got);
    return got;
  };

  /** What a project room's furniture needs, at the size it was last built. */
  const naturalOf = (i) =>
    projectRooms[i].room.natural || { w: projectRooms[i].room.w, h: projectRooms[i].room.h };

  /**
   * How much floor each project is worth, relative to the others.
   *
   * Exactly its furniture's own footprint — a twenty-one desk project earns
   * more room than a one desk project, in the ratio their desks actually need.
   * WP-50 clamped this ratio to stop a very large repo turning its neighbours
   * into splinters, which was necessary while the weights came from session
   * counts and the cell had no relation to the furniture in it. Now that every
   * room is BUILT at its natural size (WP-55), a clamp here is a room given
   * less floor than its desks occupy, which the fit loop then has to buy back
   * by growing the whole building.
   */
  const weights = projectRooms.map((_, i) => {
    const n = naturalOf(i);
    return Math.max(1, n.w * n.h);
  });

  /**
   * Deal the projects into bands: rows of rooms of SIMILAR DEPTH, each row
   * carrying roughly the same total width.
   *
   * Depth first, and it is not a preference. A row is as deep as its deepest
   * room, so a one-table room sharing a row with a fifteen-desk project is
   * given a cell twice the depth its desks need and the difference is drawn as
   * carpet — the defect this package exists to remove, one level down. A room
   * more than `HEIGHT_BAND_RATIO` shallower than the row it would join starts a
   * new row instead, whatever the requested row count.
   *
   * Width second, because within a row the cells are shared out by width and a
   * row much wider than its neighbour leaves the difference as a bay.
   *
   * @param {number} rowCount rows to aim for; the depth rule may take more
   */
  const bandsOf = (rowCount) => {
    const order = weights
      .map((weight, i) => ({ weight, i, w: naturalOf(i).w, h: naturalOf(i).h }))
      .sort((a, b) => b.h - a.h || b.w - a.w || a.i - b.i);
    const totalW = order.reduce((a, it) => a + it.w, 0) || 1;
    const perBand = totalW / Math.max(1, rowCount);
    /** @type {{weight:number,i:number,w:number,h:number}[][]} */
    const bands = [];
    let current = null;
    let acc = 0;
    for (const item of order) {
      const tooShallow = current && current[0].h > item.h * HEIGHT_BAND_RATIO;
      const full = current && bands.length < rowCount && acc + item.w / 2 > perBand;
      if (!current || tooShallow || full) {
        current = [];
        bands.push(current);
        acc = 0;
      }
      current.push(item);
      acc += item.w;
    }
    return bands;
  };

  /**
   * Lay the project rooms into `rect` as `rowCount` bands separated by ONE
   * corridor each, every band squarified so its rooms tile it exactly.
   *
   * This is a double-loaded corridor plan, which is what an office floor of
   * this shape actually is: a service core down one side, a spine beside it,
   * and working bays either side of a single cross corridor. There is no other
   * circulation on the working floor — rooms share their walls.
   *
   * @param {{x:number,y:number,w:number,h:number}} rect
   * @param {number} rowCount
   */
  /**
   * Lay one band's rooms into its rectangle.
   *
   * ONE ROW, full depth, widths in proportion to what each room needs. A band
   * is only as deep as its deepest room now (see `attempt`), so a row is the
   * shape the rooms actually want and every cell comes out at the band's depth
   * — which is what stops the squarifier stacking two rooms into a half-depth
   * cell that neither of their tables fits in.
   *
   * The squarified treemap is still the answer when a band is carrying more
   * rooms than one row can hold without cutting them below the width their
   * desks need; then a second row inside the band beats a row of splinters.
   *
   * @param {{weight:number,i:number}[]} band
   * @param {{x:number,y:number,w:number,h:number}} rect
   */
  const layBand = (band, rect) => {
    // Shared out by WIDTH, not by area. The cells are all the band's depth, so
    // width is the only degree of freedom left and giving it out by area hands
    // a deep room its neighbour's floor.
    const total = band.reduce((a, item) => a + Math.max(1e-6, naturalOf(item.i).w), 0) || 1;
    /** @type {{x:number,y:number,w:number,h:number}[]} */
    const row = [];
    let x = rect.x;
    band.forEach((item, k) => {
      const w =
        k === band.length - 1 ? rect.x + rect.w - x : (naturalOf(item.i).w / total) * rect.w;
      row.push({ x, y: rect.y, w, h: rect.h });
      x += w;
    });
    const fits = row.every((cell, k) => cell.w >= naturalOf(band[k].i).w - 0.01);
    if (fits) return row;
    return squarify(
      band.map((item, k) => ({ weight: item.weight, i: k })),
      rect,
    );
  };

  const layWorkingFloor = (rect, rowCount) => {
    /** @type {{x:number,y:number,w:number,h:number}[]} */
    const empty = new Array(projectRooms.length);
    if (!projectRooms.length || rect.w <= 0 || rect.h <= 0) {
      return { cells: empty, corridors: [] };
    }

    const attempt = (rows) => {
      const cells = new Array(projectRooms.length);
      const corridors = [];
      const bands = bandsOf(rows);
      const n = bands.length;
      const usableH = rect.h - CORRIDOR * (n - 1);
      if (usableH <= 0) return null;
      // A BAND IS AS DEEP AS ITS DEEPEST ROOM NEEDS, not a fixed share of the
      // working floor. Splitting the height evenly gave a band of one-table
      // rooms the same depth as a band holding a fifteen-desk project, so its
      // cells came out three times taller than wide and the plan gave up its
      // two-band layout rather than draw the splinters.
      const bandNaturalH = bands.map((band) =>
        band.reduce((a, item) => Math.max(a, naturalOf(item.i).h), 1),
      );
      const totalNaturalH = bandNaturalH.reduce((a, b) => a + b, 0) || 1;
      const bandHs = bandNaturalH.map((nh) => (usableH * nh) / totalNaturalH);
      let bandY = rect.y;
      bands.forEach((band, r) => {
        const bandH = bandHs[r];
        const y = bandY;
        bandY += bandH + CORRIDOR;
        // A BAND TAKES THE WIDTH ITS ROOMS NEED, NOT THE WIDTH IT IS OFFERED.
        //
        // Bands rarely hold the same number of rooms — five projects split
        // three and two — and the narrower band used to stretch its rooms
        // across the whole working floor anyway: on the demo floor that was two
        // rooms at 53% bare carpet beside three at 34%. A band is now capped at
        // the area its rooms may honestly fill (`ROOM_FILL_MAX`), and what it
        // does not take is open floor at the end of the band.
        //
        // The cap is stated on the SHALLOWEST room in the band, because that is
        // the one whose cell is furthest past what its furniture needs: every
        // cell is `bandH` deep, so a room `h` deep is `bandH / h` over before
        // the width is even shared out.
        let naturalW = 0;
        let shallowest = Infinity;
        for (const item of band) {
          const nat = naturalOf(item.i);
          naturalW += nat.w;
          shallowest = Math.min(shallowest, nat.h);
        }
        const w = Math.min(
          rect.w,
          Math.max(1, Math.min(naturalW, rect.w), (naturalW * ROOM_FILL_MAX * shallowest) / bandH),
        );
        const laid = layBand(band, { x: rect.x, y, w, h: bandH });
        band.forEach((item, k) => {
          cells[item.i] = laid[k];
        });
        if (rect.w - w > 0.01) {
          corridors.push({ x: rect.x + w, y, w: rect.w - w, h: bandH, bay: true });
        }
        if (r < n - 1) corridors.push({ x: rect.x, y: y + bandH, w: rect.w, h: CORRIDOR });
      });
      let worst = 1;
      for (const c of cells) {
        if (!c || c.w <= 0 || c.h <= 0) return null;
        worst = Math.max(worst, c.w / c.h, c.h / c.w);
      }
      return { cells, corridors, worst };
    };

    // Two bands is the plan. It only gives way when two bands would leave a
    // room that is no longer a room — with three rooms on a wide floor,
    // splitting them two-and-one leaves the lone one spanning the whole width
    // — and then only if one band actually does better.
    const two = attempt(rowCount);
    const one = rowCount > 1 ? attempt(1) : null;
    const pick =
      two && two.worst <= PROJECT_ASPECT_LIMIT
        ? two
        : one && (!two || one.worst < two.worst)
          ? one
          : two || one;
    if (!pick) return { cells: empty, corridors: [] };
    return { cells: pick.cells, corridors: pick.corridors };
  };

  /**
   * The rectangle the working floor's rooms want, at their natural sizes.
   *
   * THE BUILDING IS THE SIZE OF WHAT IS IN IT (WP-55). The floor used to be
   * built to the STAGE's shape exactly — `W = targetAspect * H`, with `H`
   * pinned to the service column — and the treemap then stretched whatever
   * rooms there were to tile the remainder. With one active project that made
   * an 88 x 67 room for a two-seat table: the plan was reporting the window's
   * shape back to itself and calling the difference carpet. The working side is
   * now measured from its rooms and the envelope summed from its parts; a small
   * floor comes out small, and `fitToWindow` draws it larger.
   *
   * @param {number} rowCount
   */
  const workingShape = (rowCount) => {
    const bands = bandsOf(rowCount);
    if (!bands.length) return { w: 0, h: 0, rows: 0 };
    // Circulation the working side keeps beyond its furniture: people walk
    // between the desks, and the treemap spends it as margin inside each room
    // rather than as corridor between them. Spread over both axes so the rect
    // keeps the shape its rooms asked for.
    const pad = Math.sqrt(1 + WORKING_HEADROOM);
    let w = 0;
    let h = 0;
    for (const band of bands) {
      let bandW = 0;
      let bandH = 0;
      for (const item of band) {
        const n = naturalOf(item.i);
        bandW += n.w;
        bandH = Math.max(bandH, n.h);
      }
      // A band is as deep as its deepest room and as wide as its rooms laid
      // side by side, both with the working side's circulation spread over
      // them: people walk between the desks, and it is spent as margin inside
      // each room rather than as corridor between them.
      w = Math.max(w, bandW * pad);
      h += bandH * pad;
    }
    return { w, h: h + CORRIDOR * (bands.length - 1), rows: bands.length };
  };

  /**
   * The whole envelope implied by one service-column width: the service column,
   * the spine, and the working floor its rooms need, side by side.
   *
   * @param {number} sw service-column width
   */
  const envelopeFor = (sw, rowCount) => {
    const measured = measureService(sw);
    const shape = workingShape(rowCount);
    const hasWorkingSide = projectRooms.length > 0 || directoryProjects.length > 0;
    const workingW = hasWorkingSide ? Math.max(shape.w, MIN_PROJECT_ROOM_W) : 0;
    const dirH = directoryHeight(directoryProjects.length, workingW);
    const H = Math.max(measured.h, shape.h + dirH, MARGIN * 4);
    const W = measured.w + CORRIDOR + workingW;
    return { measured, W, H, dirH, rowCount: shape.rows || rowCount, workingW, shape };
  };

  // Pick the column width and the number of working bands whose floor draws
  // largest on this stage. A floor is drawn at `min(stageW / W, stageH / H)`,
  // and the stage's aspect is the target, so that is the same as minimising
  // `max(W / targetAspect, H)`.
  //
  // Both are real choices again now that the envelope is not pinned to the
  // stage's shape: a wider service column shelf-packs the lounge into fewer,
  // shorter rows, and more bands make the working floor deeper and narrower.
  // This is where the floor still takes the shape of the screen — by choosing
  // between honest layouts, rather than by stretching one to fit.
  const maxRows = Math.max(1, Math.min(projectRooms.length, MAX_WORKING_ROWS));
  let best = null;
  for (let sw = OFFICE_MIN_W; sw <= SERVICE_MAX_W; sw += SERVICE_W_STEP) {
    for (let rows = 1; rows <= maxRows; rows++) {
      const candidate = envelopeFor(sw, rows);
      const cost = Math.max(candidate.W / targetAspect, candidate.H);
      // Ties are common — the service column often sets `H` on its own. They
      // are broken first by whichever layout leaves the least open floor INSIDE
      // the building, because that is the defect, and only then by whichever
      // envelope is closest to the stage's shape. Ground outside the building
      // is not a defect; a bay inside it is.
      const usable = Math.max(0, candidate.H - candidate.dirH);
      const slack = Math.max(0, usable - Math.min(usable, candidate.shape.h * BAND_STRETCH_MAX));
      const aspectErr = Math.abs(Math.log(candidate.W / candidate.H / targetAspect));
      const better =
        !best ||
        cost < best.cost - 0.01 ||
        (cost < best.cost + 0.01 &&
          (slack < best.slack - 0.01 || (slack < best.slack + 0.01 && aspectErr < best.aspectErr)));
      if (better) best = { ...candidate, cost, slack, aspectErr };
    }
  }
  const chosen = best || envelopeFor(OFFICE_MIN_W, 1);

  office = chosen.measured.office;
  lounge = chosen.measured.lounge;
  const serviceW = chosen.measured.w;
  const serviceX = 0;
  const workingX = serviceW + CORRIDOR;

  // ---- the working floor, and the floor's final size.
  //
  // The rooms are laid into their cells and REBUILT to the shape of the cell
  // they were given, so a project's tables flow to that shape rather than
  // being laid out square and centred in something that is not. Rebuilding
  // changes what a room needs, so the fit is checked and the building grows
  // until every room holds its own furniture — the one thing the plan may
  // never get wrong, since a desk outside its room is a desk on the corridor.
  let H = chosen.H;
  let workingW = chosen.workingW;
  let W = workingX + workingW;
  let laid = { cells: [], corridors: [] };
  /** Height the directory strip takes off the bottom of the working side. */
  let dirH = 0;
  /**
   * Height the ROOMS take of the working side.
   *
   * Not the whole of it. Where the service column is taller than the rooms
   * need — one small project beside a reception and a lounge — the rooms may
   * absorb the difference only up to `BAND_STRETCH_MAX`; past that the floor
   * says so with open circulation rather than painting more carpet nobody
   * stands on. Carpet with nothing on it is the defect; ground is not.
   */
  let bandH = projectRooms.length ? chosen.shape.h * BAND_STRETCH_MAX : 0;
  for (let pass = 0; pass < 8; pass++) {
    W = workingX + workingW;
    dirH = directoryHeight(directoryProjects.length, workingW);
    bandH = Math.min(bandH, Math.max(1, H - dirH));
    laid = projectRooms.length
      ? layWorkingFloor({ x: workingX, y: 0, w: workingW, h: bandH }, chosen.rowCount)
      : { cells: [], corridors: [] };
    let worstW = 1;
    let worstH = 1;
    projectRooms.forEach((pr, i) => {
      const cell = laid.cells[i];
      if (!cell) return;
      const project = activeProjects[i];
      // The shape the DESK CLUSTER has to fill, which is the cell less the
      // clearance the walls and the plate take — not the cell's own aspect.
      const interiorAspect =
        Math.max(1, cell.w - ROOM_PAD * 2) / Math.max(1, cell.h - ROOM_PAD * 2 - PLATE_BAND);
      projectRooms[i] = buildProjectRoom(project, desksIn(project), interiorAspect, cell);
      const natural = naturalOf(i);
      worstW = Math.max(worstW, natural.w / cell.w);
      worstH = Math.max(worstH, natural.h / cell.h);
    });
    if (worstW <= 1.0005 && worstH <= 1.0005) break;
    workingW *= Math.min(worstW, 1.25);
    bandH *= Math.min(worstH, 1.25);
    H = Math.max(H, bandH + dirH);
  }

  // ---- the service column fills its side of the floor exactly.
  //
  // The office above the lounge, both the column's full width, together the
  // building's full height. Any surplus is shared between them rather than
  // left as a strip: a lobby is a room-shaped piece of nothing, and this plan
  // has exactly two pieces of circulation in it — the spine and the cross
  // corridor — by design.
  const loungeNaturalH = lounge.room.h;
  const columnSurplus = Math.max(0, H - (office.room.h + loungeNaturalH));
  // The reception takes a share of it, up to the point where it would stop
  // being a room; the lounge takes the rest, because open floor reads as a
  // lounge and reads as dead space anywhere else.
  // The reception takes a floor of the column whatever the lounge needs. It is
  // the room the product is about — the one that answers "is anything waiting
  // on me" — and on a machine where nearly every session is benched the lounge
  // would otherwise have four times its height simply by having more in it.
  const officeH = clamp(
    Math.max(office.room.h + columnSurplus * OFFICE_SURPLUS_SHARE, H * OFFICE_COLUMN_MIN),
    office.room.h,
    Math.max(office.room.h, serviceW / OFFICE_ASPECT_MIN),
  );

  office = buildOffice(waitingCount, { w: serviceW, h: officeH });
  office.room.x = serviceX;
  office.room.y = 0;
  office.room.w = serviceW;
  office.room.h = officeH;

  lounge.room.x = serviceX;
  lounge.room.w = serviceW;
  lounge.room.y = officeH;
  lounge.room.h = Math.max(loungeNaturalH, H - officeH);

  // The column is the height of what it holds. Giving the reception a floor of
  // the column can push the two past the building; the building grows to match
  // rather than the rooms overlapping. The working side keeps the room band it
  // was given and the extra becomes open floor, so growing the column can never
  // reach back into a room and turn the difference into carpet.
  const columnH = officeH + lounge.room.h;
  if (columnH > H + 0.01) H = columnH;

  const workingWidth = Math.max(0, W - workingX);

  // ---- the working floor: bands of squarified rooms, one corridor between.
  //
  // Every project room is rebuilt for the CELL it was given, so its tables
  // flow to that shape rather than being laid out square and centred in
  // something that is not. The cells tile their band exactly, so adjacent
  // rooms share a wall and there is no circulation between them.
  projectRooms.forEach((pr, i) => {
    const cell = laid.cells[i];
    if (!cell) return;
    const room = pr.room;
    room.x = cell.x;
    room.y = cell.y;
    room.w = cell.w;
    room.h = cell.h;
  });

  // The spine: the one vertical corridor, between the service column and the
  // working floor.
  const spine = {
    kind: /** @type {'corridor'} */ ('corridor'),
    id: '__spine__',
    name: '',
    x: serviceW,
    y: 0,
    w: CORRIDOR,
    h: H,
    walls: /** @type {'partial'} */ ('partial'),
    floor: /** @type {'circulation'} */ ('circulation'),
    plateLines: /** @type {[string, string]} */ (['', '']),
    props: [],
    zones: [],
  };

  // And the cross corridor, or corridors if the working floor ever grows past
  // two bands. A cross corridor is a thoroughfare; there is nothing else to
  // walk on. A BAY — the open floor at the end of a band whose rooms did not
  // need the whole width — is not: it is a dead end beside the rooms, and
  // treating it as a route would put a second vertical line beside the spine
  // that the graph can never reach.
  const crossCorridors = laid.corridors.map((c, i) => ({
    kind: /** @type {'corridor'} */ ('corridor'),
    thoroughfare: !c.bay,
    id: c.bay ? `__bay-${i}__` : `__corridor-${i}__`,
    name: '',
    x: c.x,
    y: c.y,
    w: c.w,
    h: c.h,
    walls: /** @type {'partial'} */ ('partial'),
    floor: /** @type {'circulation'} */ ('circulation'),
    plateLines: /** @type {[string, string]} */ (['', '']),
    props: [],
    zones: [],
  }));

  // THE DIRECTORY STRIP, along the bottom edge of the working floor.
  //
  // It shares its walls with the rooms above it: a strip of corridor between a
  // room and a board on the wall below it would be a gap in the floor, and the
  // working side already has exactly one piece of circulation in it by design.
  const directory =
    directoryProjects.length > 0 && workingWidth > 1 && dirH > 0
      ? buildDirectory(directoryProjects, { w: workingWidth, h: dirH })
      : null;
  if (directory) {
    directory.x = workingX;
    directory.y = H - dirH;
  }

  // WHATEVER THE ROOMS DO NOT NEED IS OPEN FLOOR, NOT A BIGGER ROOM.
  //
  // Two cases, one band. A floor with no rooms at all still needs its working
  // side to be something rather than a hole; and a floor whose service column
  // is taller than its one project room needs somewhere for the difference to
  // go. Before WP-55 the rooms swallowed it and drew it as carpet. This is
  // circulation — walkable-looking floor with nothing on it, which is what it
  // honestly is — sitting between the rooms and the directory strip.
  const slackY = projectRooms.length ? bandH : 0;
  const slackH = Math.max(0, H - dirH - slackY);
  const emptyBand =
    workingWidth > 1 && slackH > 0.01
      ? [
          {
            kind: /** @type {'corridor'} */ ('corridor'),
            // Open floor, not a route: there is nothing in this bay to walk
            // to, and a full-height band beside the spine is a second parallel
            // vertical line the graph can never reach.
            thoroughfare: false,
            id: '__open__',
            name: '',
            x: workingX,
            y: slackY,
            w: workingWidth,
            h: slackH,
            walls: /** @type {'partial'} */ ('partial'),
            floor: /** @type {'circulation'} */ ('circulation'),
            plateLines: /** @type {[string, string]} */ (['', '']),
            props: [],
            zones: [],
          },
        ]
      : [];

  const rooms = [
    office.room,
    spine,
    ...crossCorridors,
    ...emptyBand,
    ...projectRooms.map((pr) => pr.room),
    ...(directory ? [directory] : []),
    lounge.room,
  ];

  // ---- one frame, everywhere.
  //
  // Every builder lays its contents out in its own room's frame with (0,0) at
  // the room's top-left, so placing a room is a single translation and every
  // anchor then resolves against the same corner the coordinates were written
  // from. There is no second, content-relative frame to fall out of step.
  const place = (room, movable) => {
    // A project room is given a cell by the treemap and rebuilt to its shape,
    // but the two never match to the unit. Its furniture is centred in the
    // result rather than pushed into a corner — safe here, and only here,
    // because a project room carries no wall-anchored props: its shelf and
    // screen are attached to the desks, so nothing resolves against the room's
    // edges.
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
  office.officeSeats = seatOffice(office.room, waitingCount);
  place(lounge.room, lounge.loungeSpots);
  if (lounge.room.kitchenZone) {
    const kz = lounge.room.zones.find((z) => z.id === 'kitchen-zone');
    if (kz) lounge.room.kitchenZone = { x: kz.x, y: kz.y, w: kz.w, h: kz.h };
  }

  /** @type {Map<string, Seat[]>} */
  const seats = new Map();
  for (const pr of projectRooms) {
    place(pr.room, pr.seats);
    seats.set(pr.room.id, pr.seats);
  }
  // The strip's lines ride `place`'s translation like any other movable, so
  // they land under the strip's own plate band rather than in a frame of their
  // own that could drift from it.
  if (directory) place(directory, directory.entries);

  const walls = deriveWalls(rooms, W, H);

  // The walkable network. Agents are confined to it — see buildNavLines.
  const nav = buildNavLines(rooms, W, H);
  assignDoors(rooms, nav.lines);

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

  return {
    width: W,
    height: H,
    targetAspect,
    rooms,
    walls,
    nav: nav.lines,
    seats,
    officeSeats: office.officeSeats,
    loungeSpots: lounge.loungeSpots,
    // Archived sessions have no place on the floor at all.
    letGoSpots: [],
    doors,
    // Who the floor draws nobody for, decided once, here. `assignSeats` and
    // `AgentRuntime#sync` read it rather than deciding again.
    hidden,
    goneHome: pop.goneHome,
    directory,
  };
}

// ---------------------------------------------------------------- re-exports

/**
 * WP-22 split this file into `plan-units`, `plan-packing`, `plan-anchors`,
 * `plan-rooms`, `plan-service` and `plan-nav`. Everything the old module
 * exported is re-exported here, unchanged, so every existing import keeps
 * working and the goldens keep matching to the pixel. The typedefs are
 * re-exported too, so `import('./plan.js').Room` still resolves.
 */

export { resolveAnchors, tableSizesFor } from './plan-anchors.js';
export { shelfPack, squarify, tileRows } from './plan-packing.js';
export { formatTokens, payrollLine } from './plan-rooms.js';
export { DIRECTORY_MAX_H, GONE_HOME_DAYS, PLATE_BAND, U } from './plan-units.js';

/** @typedef {import('./plan-units.js').ActivityState} ActivityState */
/** @typedef {import('./plan-units.js').AckState} AckState */
/** @typedef {import('./plan-units.js').AgentLike} AgentLike */
/** @typedef {import('./plan-units.js').ProjectLike} ProjectLike */
/** @typedef {import('./plan-units.js').Anchor} Anchor */
/** @typedef {import('./plan-units.js').Prop} Prop */
/** @typedef {import('./plan-units.js').Zone} Zone */
/** @typedef {import('./plan-units.js').Wall} Wall */
/** @typedef {import('./plan-units.js').DirectoryEntry} DirectoryEntry */
/** @typedef {import('./plan-units.js').Room} Room */
/** @typedef {import('./plan-units.js').Seat} Seat */
/** @typedef {import('./plan-units.js').LoungeSpot} LoungeSpot */
/** @typedef {import('./plan-units.js').Door} Door */
/** @typedef {import('./plan-units.js').NavLine} NavLine */
/** @typedef {import('./plan-units.js').Plan} Plan */
