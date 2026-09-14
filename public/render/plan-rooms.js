/**
 * The room a project earns.
 *
 * Split out of `plan.js` by WP-22. `buildProjectRoom` is where `08` B6's rule
 * becomes furniture — desks equal to the agents at them, a table per eight
 * people, and a `natural` footprint that is what the room's contents need
 * rather than what the packer has to spare (`docs/DEVIATIONS.md` §106).
 *
 * THE OTHER END OF THAT RULE USED TO LIVE HERE TOO. A project with nobody in it
 * earned `buildDirectory` — one legible line on a strip along the working
 * side's edge, rather than an empty room (§96). WP-60 took the strip off the
 * floor: a repo nobody is in is now a line in a popover the user opens, so it
 * costs no floor at all and this module builds one kind of thing.
 *
 * The two plate-line formatters live here because this is the only place that
 * writes a plate. `plan.js` re-exports both.
 */

import { tableBlockSize, tableSize, tableSizesFor, translateContents } from './plan-anchors.js';
import { boundsOf, flowBlocks } from './plan-packing.js';
import {
  CHAIR,
  CHAIR_GAP,
  CORNER_PLANT_INSET,
  FIXTURE_TOP,
  MIN_PROJECT_ROOM_H,
  MIN_PROJECT_ROOM_W,
  PLANT_GAP,
  PLANT_SIZE,
  PLATE_BAND,
  ROOM_PAD,
  RUG_MAX_OVER_CLUSTER,
  RUG_ROOM_INSET,
  SEAT_PITCH,
  TABLE_DEPTH,
  TABLE_GAP,
  WHITEBOARD_H,
  angleTo,
  clamp,
} from './plan-units.js';
import {
  BREAKOUT_RUG_D,
  BREAKOUT_TABLE,
  MONITOR_H,
  MONITOR_W,
  PINBOARD_GAP,
  PINBOARD_H,
  PINBOARD_W,
  RUG_CLUSTER_PAD,
  SEAT_TUB,
  SHELF_MAX_H,
  SHELF_W,
  WHITEBOARD_MAX_H,
  WHITEBOARD_W,
  breakoutFits,
} from './plan-furniture.js';

/** @typedef {import('./plan-units.js').ProjectLike} ProjectLike */
/** @typedef {import('./plan-units.js').Prop} Prop */
/** @typedef {import('./plan-units.js').Zone} Zone */
/** @typedef {import('./plan-units.js').Wall} Wall */
/** @typedef {import('./plan-units.js').Room} Room */
/** @typedef {import('./plan-units.js').Seat} Seat */

/**
 * Compact token formatting, e.g. `2200000 -> '2.2M'`.
 * @param {number} n
 */
export function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1000)}k`;
  return `${Math.round(v)}`;
}

/**
 * The room plate's payroll line (WP-26), or `''` when there is nothing
 * honest to put on it.
 *
 * Three rules, and the third is the one that matters:
 *
 *   1. **Quiet.** It is the third line on a door plate, under the name and the
 *      session count. It is context for a room, not a headline.
 *   2. **Dated by its own words.** `today` when the ledger has the day's token
 *      deltas for this project; `to date` when it does not and the line is the
 *      session totals falling back (`todaySpendFor` in
 *      `src/core/state-machine.mjs`). The plate never says "today" about a
 *      number that is not today's.
 *   3. **It says what kind of number it is.** `list price` is not decoration:
 *      `08` §1.1 rule 7 is that cost is an estimate and never a bill, and a
 *      currency figure on a wall with no qualifier beside it reads as a bill.
 *      A project nothing in the rate card can price gets NO LINE at all rather
 *      than `$0.00` — see `src/core/rates.mjs`.
 *
 * @param {{todaySpend?:number|null, todaySpendIsToday?:boolean}} project
 * @returns {string}
 */
export function payrollLine(project) {
  const usd = project ? project.todaySpend : null;
  if (usd == null || !Number.isFinite(Number(usd))) return '';
  const amount = `≈ $${Number(usd).toFixed(2)}`;
  return project.todaySpendIsToday
    ? `today ${amount} · list price`
    : `${amount} to date · list price`;
}

/**
 * The room plate's third line when cost is off, which is how it ships (WP-83).
 *
 * TOKENS, NOT MONEY, and the same three rules the payroll line keeps:
 *
 *   1. **Quiet.** Still the third line on a door plate, still context.
 *   2. **Dated by its own words.** `today` when the ledger has the day's token
 *      deltas for this room — `Ledger.todayTokens`, folded per project by
 *      `todayTokensFor` in `src/core/state-machine-rules.mjs` — and `to date`
 *      when it does not and this is the room's lifetime total falling back.
 *      The plate never says "today" about a number that is not today's.
 *   3. **It says nothing rather than something it cannot measure.** A room
 *      with no token figure at all gets no line, exactly as an unpriceable
 *      room got none before.
 *
 * **`with cache` is not decoration either.** The data line above this one is
 * `project.tokens`, which is input plus output and nothing else; this line is
 * that plus the cache traffic, which on a real room is an order of magnitude
 * larger. Two token figures on one plate that count different things, with
 * only one of them saying so, is a plate that looks wrong to anybody who adds
 * them up — and the bigger of the two is the one that needed the qualifier.
 *
 * Short on purpose: WP-81 reworks the plate and will set the type; this is the
 * data line it will be given. Kept in the same file as `payrollLine` because
 * the two are alternatives for one slot and the choice between them is one
 * setting read in one place (`plateLinesFor` in `scene-labels.js`).
 *
 * @param {{todayTokens?:number|null, todayTokensIsToday?:boolean, tokens?:number,
 *          cacheTokens?:number}} project
 * @returns {string}
 */
export function tokenLine(project) {
  const today = project ? project.todayTokens : null;
  if (today != null && Number.isFinite(Number(today)) && Number(today) > 0) {
    return project.todayTokensIsToday
      ? `today ${formatTokens(Number(today))} tok · with cache`
      : `${formatTokens(Number(today))} tok to date · with cache`;
  }
  const lifetime = (Number(project?.tokens) || 0) + (Number(project?.cacheTokens) || 0);
  if (lifetime <= 0) return '';
  return `${formatTokens(lifetime)} tok to date · with cache`;
}

// ------------------------------------------------------------ a pinned room

/**
 * THE ROOM A PINNED REPO KEEPS WITH NOBODY IN IT (WP-77).
 *
 * The owner, 14 September: _"Pin any particular project room so it is always in
 * a room, so the room does not collapse when agents are not running, maybe
 * downsized according to live agents."_
 *
 * So: a room, and a small one. One desk, **nobody at it** — no chair, no
 * monitor, no junior's seat, because a chair with nobody on it is the oldest
 * defect in this file and a desk nobody is at is the second oldest. What it
 * carries instead is the three things that make a rectangle read as *that
 * repo's room* rather than as a bay: its carpet washed toward its own identity
 * colour (WP-72), a rug, and a plate with its name on it.
 *
 * IT IS BUILT AT THE CELL IT IS GIVEN and never at a natural size of its own.
 * A pinned room is a placeholder: the cell it gets is decided by the third rule
 * (`PINNED_AREA_SHARE` of the narrowest live room), so the furniture is
 * designed into whatever came back rather than laid out and then centred — the
 * two-frames defect §57 removed, which is easier to avoid than to fix. Where
 * the cell is too small for a desk and the clearance round it, the room is a
 * rug and a plate and says so honestly rather than drawing a desk through a
 * wall.
 *
 * @param {ProjectLike} project
 * @param {{w:number,h:number}} cell the rectangle this room has been given
 * @returns {{ room: Room }}
 */
export function buildPinnedRoom(project, cell) {
  const id = String(project.id ?? project.projectId ?? 'unknown');
  const name = String(project.name ?? project.projectName ?? id);
  const sessionCount = project.sessionCount ?? 0;

  const w = Math.max(4, Number(cell?.w) || 0);
  const h = Math.max(PLATE_BAND + 2, Number(cell?.h) || 0);
  const interiorH = h - PLATE_BAND;

  /** @type {Prop[]} */
  const props = [];
  /** @type {Zone[]} */
  const zones = [];

  // The room's own floor, as a zone, so the rug and the desk are centred on
  // something real rather than on arithmetic that could drift from it.
  const inset = Math.min(1.2, Math.min(w, interiorH) * 0.12);
  zones.push({
    id: `${id}-pinned-floor`,
    x: inset,
    y: inset,
    w: Math.max(1, w - inset * 2),
    h: Math.max(1, interiorH - inset * 2),
  });
  props.push({
    kind: 'rug',
    w: Math.max(1, w - inset * 2),
    h: Math.max(1, interiorH - inset * 2),
    angle: 0,
    x: inset,
    y: inset,
    anchor: { type: 'centered', of: `${id}-pinned-floor` },
  });

  // One desk, centred, only where the room can hold it with clear floor round
  // it. `TABLE_DEPTH` is what a desk IS; anything shallower is a desk drawn
  // through the plate above it.
  const deskW = clamp(w * 0.45, 3.2, 8);
  if (interiorH >= TABLE_DEPTH + 1.6 && w >= deskW + 2) {
    const deskId = `${id}-pinned-desk`;
    zones.push({
      id: deskId,
      x: (w - deskW) / 2,
      y: (interiorH - TABLE_DEPTH) / 2,
      w: deskW,
      h: TABLE_DEPTH,
    });
    props.push({
      kind: 'desk',
      id: `${deskId}-top`,
      w: deskW,
      h: TABLE_DEPTH,
      angle: 0,
      x: (w - deskW) / 2,
      y: (interiorH - TABLE_DEPTH) / 2,
      anchor: { type: 'centered', of: deskId },
    });
  }

  /** @type {Room} */
  const room = {
    kind: 'project',
    id,
    name,
    x: 0,
    y: 0,
    w,
    h,
    projectMk: project.projectMk,
    plateBand: PLATE_BAND,
    // Its natural size IS the cell: a pinned room never bids for floor. If it
    // did, the envelope search would price an empty repo against a room with
    // people in it, which is the whole thing WP-50 took off the floor.
    natural: { w, h },
    // The one flag the renderer and the tests read to tell this room from a
    // live one. `kind` stays `project` on purpose: it is a project's room, it
    // is painted by the same painter, and a new room kind would be three
    // painters and a plate rule for a rectangle that differs only in what is
    // in it.
    pinned: true,
    walls: 'partial',
    floor: 'carpet',
    plateLines: [
      name,
      // The badge. A word rather than a pill, because a plate is live text on
      // the floor (CONTRACTS-WP15.md §3) and a second painted object over a
      // room this small would be drawn through its own name.
      `${sessionCount} session${sessionCount === 1 ? '' : 's'} · pinned`,
      '',
    ],
    props,
    zones,
  };
  return { room };
}

/**
 * LAY THE PINNED STRIP along the bottom of the working side (WP-77).
 *
 * The rooms take the depth they need, the pinned rooms take the strip the fill
 * order reserved for them, and open plan is what is left under both. That is
 * WP-59c's order with one thing inserted before the open plan rather than a new
 * order: a pinned room is CONTENT — a repo the user asked to keep — and content
 * goes before the carpet nobody stands on.
 *
 * A THIRD OF THE NARROWEST LIVE ROOM, and the WIDTH is where that is settled.
 * The strip's depth is already `PINNED_DEPTH_SHARE` of the band's (see
 * `pinnedRowDepth`); this is what stops a shallow room that is as wide as the
 * row from being half of a live one anyway. Against the NARROWEST rather than
 * the largest, because that is the comparison a person actually makes: the
 * pinned room has to read as the small one beside every room with somebody in
 * it. Whatever a pinned room does not take of its share is open floor, never a
 * wider pinned room.
 *
 * @param {ProjectLike[]} projects the pinned projects, in floor order
 * @param {{x:number,y:number,w:number,h:number}} rect the strip
 * @param {number} perRow how many stand side by side — `pinnedPerRow(rect.w)`
 * @param {number} areaCap the most floor one pinned room may take, or
 *   `Infinity` where there is no live room to be a third of
 * @returns {{rooms: Room[], gaps: {x:number,y:number,w:number,h:number}[]}}
 */
export function layPinnedStrip(projects, rect, perRow, areaCap) {
  /** @type {Room[]} */
  const rooms = [];
  /** @type {{x:number,y:number,w:number,h:number}[]} */
  const gaps = [];
  const list = Array.isArray(projects) ? projects : [];
  if (!list.length || rect.h <= 0.01 || rect.w <= 1) return { rooms, gaps };

  const stripRows = Math.ceil(list.length / Math.max(1, perRow));
  const rowH = rect.h / stripRows;
  // Shared by HOW MANY THERE ARE, not by how many would fit. `pinnedPerRow` is
  // the wrap — when to start a second row — and reading it as the share left
  // two thirds of the strip bare whenever one repo was pinned on a floor with
  // room for three. Where the third rule still bites, what the rooms do not
  // take is open floor: that is the price of a pinned room being a third of a
  // live one, and it is a price paid in carpet rather than in a lie.
  const cellW = Math.max(2, Math.min(rect.w / Math.min(perRow, list.length), areaCap / rowH));
  for (let r = 0; r < stripRows; r++) {
    const y = rect.y + r * rowH;
    let x = rect.x;
    for (const project of list.slice(r * perRow, (r + 1) * perRow)) {
      const built = buildPinnedRoom(project, { w: cellW, h: rowH });
      built.room.x = x;
      built.room.y = y;
      rooms.push(built.room);
      x += cellW;
    }
    const restW = rect.x + rect.w - x;
    if (restW > 0.005) gaps.push({ x, y, w: restW, h: rowH });
  }
  return { rooms, gaps };
}

// ------------------------------------------------------------ project zones

/**
 * Lay out one project's tables, chairs and plant in local coordinates.
 *
 * @param {ProjectLike} project
 * @param {number} deskCount agents at desks in this project, minimum one table
 * @param {number} [targetAspect] shape the tables should aim to fill
 * @param {{w:number,h:number}} [fit] the cell the tiler has given this room
 * @returns {{ room: Room, seats: Seat[], size: {w:number,h:number} }}
 */
export function buildProjectRoom(project, deskCount, targetAspect = 1, fit = undefined) {
  const id = String(project.id ?? project.projectId ?? 'unknown');
  const name = String(project.name ?? project.projectName ?? id);
  const sessionCount = project.sessionCount ?? deskCount;

  /** @type {Prop[]} */
  const props = [];
  /** @type {Zone[]} */
  const zones = [];
  /** @type {Seat[]} */
  const seats = [];

  // DESKS EQUAL AGENTS AT DESKS, minimum one table (`08` B6). This used to be
  // `sessionCount`, benched sessions included, so a repo with twenty benched
  // agents and one working one got three benches and one occupant.
  const sizes = tableSizesFor(Math.max(1, deskCount));
  const blocks = sizes.map((s) => tableBlockSize(s));
  const flow = flowBlocks(blocks, TABLE_GAP, targetAspect);

  // THE WALL FURNITURE SPREADS TO THE WALL IT IS ON (WP-59c).
  //
  // A room the service column made deep — see `plan.js`'s fill order, step
  // (a) — has more wall than its desks asked for, and a 5.2 U whiteboard at
  // the top of a 40 U wall is a postage stamp with thirty units of nothing
  // under it. The board and the shelf are the two things in here that are
  // ON a wall and can honestly take more of it, so they do; the rug takes the
  // floor (below), and the planting takes the corners it always did, which is
  // already a function of the room's size. What none of them do is multiply:
  // there is one board, one shelf and one rug however tall the room gets.
  //
  // Measured off the CELL rather than off the finished room, because the
  // finished room is what this function is deciding. `run` is the wall from
  // under the plate to the floor; the fixtures leave the last of it for the
  // corner planting.
  // The board and the shelf stand on the EAST and WEST walls, so what they may
  // take is the room's DEPTH however wide the cell is. A wider room spreads
  // through its rug, its planting and the clearance around the desks instead —
  // there is one board and one shelf however large the room gets, which is what
  // keeps a big room reading as a room rather than as a wall of fixtures.
  //
  // WP-85b PUT A CEILING BACK ON BOTH OF THEM (§3.4: `whiteboard 2.4 × ≥5.2`,
  // `shelf 1.2 × ≤7`). "Grow with the wall" without a ceiling is how a board
  // became the longest silhouette in a room whose subject is the person at the
  // desk, and §1.2 measured it as the brightest object in frame besides. A wall
  // with more spare than the two fixtures want gets the PINBOARD under the
  // shelf — a second, shorter silhouette — rather than a longer board.
  const wallRun = Math.max(0, (fit && fit.h > 0 ? fit.h : 0) - PLATE_BAND);
  const wallRoom = Math.max(0, wallRun - FIXTURE_TOP - CORNER_PLANT_INSET - 2.4);
  const shelfH = clamp(wallRun * 0.22, 3.6, Math.max(3.6, Math.min(SHELF_MAX_H, wallRoom * 0.45)));
  const boardH = clamp(
    wallRun * 0.28,
    WHITEBOARD_H,
    Math.max(WHITEBOARD_H, Math.min(WHITEBOARD_MAX_H, wallRoom)),
  );

  let remaining = Math.max(1, deskCount);
  sizes.forEach((seatCount, i) => {
    const at = flow.out[i];
    const t = tableSize(seatCount);
    const tableId = `${id}-table-${i}`;
    // The table's own footprint is a zone: chairs hang off it, the plant
    // stands beside it, and both stay attached however the floor re-tiles.
    const tx = at.x;
    const ty = at.y + CHAIR_GAP + CHAIR;
    zones.push({ id: tableId, x: tx, y: ty, w: t.w, h: t.h });

    props.push({
      kind: 'desk',
      id: tableId + '-top',
      w: t.w,
      h: t.h,
      angle: 0,
      x: tx,
      y: ty,
      anchor: { type: 'centered', of: tableId },
    });

    const perSide = Math.max(1, Math.ceil(seatCount / 2));
    for (const side of [
      { key: /** @type {'N'} */ ('N'), sign: -1 },
      { key: /** @type {'S'} */ ('S'), sign: 1 },
    ]) {
      for (let k = 0; k < perSide && remaining > 0; k++) {
        const cx = tx + (k + 0.5) * SEAT_PITCH;
        const cy = side.sign < 0 ? ty - CHAIR_GAP - CHAIR / 2 : ty + t.h + CHAIR_GAP + CHAIR / 2;
        // Square on to the table, so each occupant faces their own monitor
        // rather than converging on the table's centre point.
        const angle = angleTo({ x: cx, y: cy }, { x: cx, y: ty + t.h / 2 });
        seats.push({ x: cx, y: cy, angle });
        props.push({
          kind: 'chair',
          w: CHAIR,
          h: CHAIR,
          angle,
          x: cx - CHAIR / 2,
          y: cy - CHAIR / 2,
          anchor: {
            type: 'attached',
            to: tableId,
            edge: side.key,
            along: (k + 0.5) * SEAT_PITCH - CHAIR / 2,
            gap: CHAIR_GAP,
          },
        });
        props.push({
          kind: 'monitor',
          w: MONITOR_W,
          h: MONITOR_H,
          // The rect already says the screen is wide and shallow, sitting
          // across the table edge. Rotating it by the occupant's facing on
          // top of that stood it on end — the same mistake the reception
          // sofa made. `angle` is not how a prop LIES; its rect is.
          angle: 0,
          x: cx - MONITOR_W / 2,
          y: side.sign < 0 ? ty : ty + t.h - MONITOR_H,
          anchor: {
            type: 'attached',
            to: tableId,
            edge: side.key,
            along: (k + 0.5) * SEAT_PITCH - MONITOR_W / 2,
            gap: -MONITOR_H,
          },
        });
        remaining--;
      }
    }

    // One plant per table, standing at its end where it cannot be adrift.
    if (i === 0) {
      props.push({
        kind: 'plant',
        w: PLANT_SIZE,
        h: PLANT_SIZE,
        angle: 0,
        x: tx + t.w + PLANT_GAP,
        y: ty,
        anchor: {
          type: 'attached',
          to: tableId,
          edge: 'E',
          along: (t.h - PLANT_SIZE) / 2,
          gap: PLANT_GAP,
        },
      });
    }
  });

  // The floor is a spatial launcher: a shelf opens the repo's folder, a screen
  // runs its dashboard.
  //
  // Both are ATTACHED to the first table rather than anchored to a wall.
  // A project room is the one room the tiler is allowed to stretch (it has to
  // absorb the slack in its row), so a wall anchor here would slide away from
  // the desks every time the row got wider while the desk cluster stayed put —
  // the exact two-frames defect this file exists to prevent. Attached to the
  // furniture, they travel with it at a fixed offset whatever the room does.
  const firstTable = zones[0];
  if (firstTable) {
    // Against the room's EAST wall, stacked below the in-room "+" that sits in
    // its top-right corner. Wall furniture belongs on a wall; the desks are
    // centred in the room and these are not part of that composition, so
    // nothing is lost by anchoring them to the geometry they actually touch.
    props.push({
      kind: 'shelf',
      id: 'shelf',
      w: SHELF_W,
      h: shelfH,
      angle: 0,
      x: firstTable.x,
      y: firstTable.y,
      anchor: { type: 'wall', side: 'E', along: FIXTURE_TOP, inset: 0.3 },
    });
    let eastRun = FIXTURE_TOP + shelfH + PINBOARD_GAP;
    if (project.hasDashboard) {
      props.push({
        kind: 'screen',
        id: 'screen',
        w: 0.9,
        h: 2.4,
        angle: 0,
        x: firstTable.x,
        y: firstTable.y,
        // Under the shelf, whatever the shelf turned out to be.
        anchor: { type: 'wall', side: 'E', along: eastRun, inset: 0.3 },
      });
      eastRun += 2.4 + PINBOARD_GAP;
    }
    // THE PINBOARD (§3.4), under whatever the east wall already carries.
    //
    // The fixtures on this wall are capped now, so a deep room has wall left
    // over; §1.6's finding was that the floor answered spare wall and spare
    // floor the same way — with another plant — and that six identical plants
    // is wallpaper. A short, papered board is a silhouette the shelf above it
    // cannot be mistaken for, which is what spare wall is actually for.
    if (wallRoom >= eastRun + PINBOARD_H) {
      props.push({
        kind: 'pinboard',
        id: 'pinboard',
        w: PINBOARD_W,
        h: PINBOARD_H,
        angle: 0,
        x: firstTable.x,
        y: firstTable.y,
        anchor: { type: 'wall', side: 'E', along: eastRun, inset: 0.3 },
      });
    }
    // The project's whiteboard, on the WEST wall facing the room. Every
    // project room has one and clicking it opens the board — the numbers a
    // team keeps written up where everyone can see them.
    props.push({
      kind: 'whiteboard',
      id: 'whiteboard',
      // Deeper than a board is thick: the rect has to contain the face the
      // painter projects into the room (see backdrop.js's `whiteboard` case).
      w: WHITEBOARD_W,
      h: boardH,
      angle: 0,
      x: firstTable.x,
      y: firstTable.y,
      anchor: { type: 'wall', side: 'W', along: FIXTURE_TOP, inset: 0.3 },
    });
  }

  // THE ROOM IS THE SIZE OF WHAT IS IN IT (WP-55).
  //
  // The desk cluster — tables, chairs, monitors and the plant beside the first
  // table — is the only thing here with real coordinates; the wall and corner
  // furniture carries placeholder positions that `resolveAnchors` overwrites
  // once the room has a size. So the cluster's box is measured on its own and
  // the room's footprint is that box plus the clearance the anchored furniture
  // needs, rather than a bounding box that includes props which have not been
  // placed yet (and, before this, a rug that had already been grown to the
  // cell — which made `natural` report the cell back to the packer and every
  // room a self-fulfilling 88 x 67).
  const anchoredLater = new Set(['wall', 'corner']);
  const cluster = boundsOf([...props.filter((p) => !anchoredLater.has(p.anchor.type)), ...zones]);

  const deskBlock = boundsOf(zones);
  if (zones.length) {
    zones.push({
      id: 'desk-group',
      x: deskBlock.x - CHAIR - CHAIR_GAP,
      y: deskBlock.y - CHAIR - CHAIR_GAP,
      w: deskBlock.w + (CHAIR + CHAIR_GAP) * 2,
      h: deskBlock.h + (CHAIR + CHAIR_GAP) * 2,
    });
  }

  // The interior the contents need: the cluster, with room round it for the
  // corner planting and the wall fixtures to stand in, and the plate band
  // across the top. This is what the packer bids with and what the building's
  // own extent is summed from.
  const interiorW = cluster.w + ROOM_PAD * 2;
  const interiorH = cluster.h + ROOM_PAD * 2;
  const naturalW = Math.max(interiorW, MIN_PROJECT_ROOM_W);
  const naturalH = Math.max(interiorH, MIN_PROJECT_ROOM_H) + PLATE_BAND;

  const w = Math.max(naturalW, fit && fit.w > 0 ? fit.w : 0);
  const h = Math.max(naturalH, fit && fit.h > 0 ? fit.h : 0);
  const finalW = w;
  const finalH = h - PLATE_BAND;

  // WHAT `place` WILL ADD BACK.
  //
  // `plan.js`'s `place` centres a room's contents in whatever cell it was
  // given, by `(room.h - natural.h) / 2`. Everything below that wants to be
  // measured against the FINAL interior — the break-out group, which belongs at
  // the bottom of the room and not at the bottom of the room's natural
  // footprint — therefore writes `desired - slack` and lets that centring put
  // it back. Two frames are allowed to disagree only where one of them is
  // stated in terms of the other, and this is that statement.
  const slackX = Math.max(0, w - naturalW) / 2;
  const slackY = Math.max(0, h - naturalH) / 2;

  // A rug under the desk cluster, sized to the GROUP and not to the room
  // (WP-85b, §3.4: `task rug = cluster + 1.0, capped 1.35× per axis`).
  //
  // It used to take whatever floor the room had spare, per axis, up to 1.6x its
  // cluster and 2.6x on a column-stretched depth. §1.4 measured the result and
  // called it what it was: floor covering. A rug defines a group — half a unit
  // of border round the desks — and the floor it no longer covers is answered
  // by the break-out group below, which is furniture.
  //
  // MEASURED OFF `desk-group` rather than off `cluster`, because `desk-group`
  // is the box the plan publishes as "the desks and the chairs round them" and
  // is what the acceptance in §5 is stated over. `cluster` includes the plant
  // standing at the first table's end, so a rug capped against it would be
  // capped against a different number from the one anybody measures.
  const group = zones.find((z) => z.id === 'desk-group');
  if (group) {
    /** @param {number} base @param {number} room */
    const rugSide = (base, room) => {
      const ceiling = base * RUG_MAX_OVER_CLUSTER;
      const wanted = Math.min(base + RUG_CLUSTER_PAD, ceiling);
      return clamp(Math.min(wanted, Math.max(base, room - RUG_ROOM_INSET * 2)), base, ceiling);
    };
    props.unshift({
      kind: 'rug',
      w: rugSide(group.w, finalW),
      h: rugSide(group.h, finalH),
      angle: 0,
      x: 0,
      y: 0,
      anchor: { type: 'centered', of: 'desk-group' },
    });
  }

  // THE BREAK-OUT CORNER (§3.4, owner decision 4).
  //
  // A room the packer made deeper than its desks need now keeps that floor as
  // floor rather than painting it, so the question §3.5 asks is what the floor
  // is FOR: *"a clear-floor patch larger than 10 U x 10 U gets a destination,
  // not a bigger rug"*. The destination is a round rug, two tub chairs facing
  // each other and a small table between them — a second place in the room,
  // which is why a large room is still the size of what is in it.
  //
  // It is decided before the contents are translated, because deciding it is
  // also deciding where the DESKS go: a group that needs the bottom of the room
  // can only have it if the cluster sits at the top rather than in the middle.
  // `breakoutFits` is the whole of the rule and lives with the sizes it is
  // about (`plan-furniture.js`), so the plan, the test and the document cannot
  // each have their own threshold.
  const clusterArea = group ? group.w * group.h : 0;
  const clearRatio = clusterArea > 0 ? (finalW * finalH - clusterArea) / clusterArea : 0;
  // Where the cluster would stand with the room's spare depth given to the
  // break-out rather than shared above and below it, and what is left under the
  // rug once it does. `CORNER_PLANT_INSET` is the planting in the two south
  // corners, which the group must not be drawn through.
  const rugProp = props[0] && props[0].kind === 'rug' ? props[0] : null;
  // The desk group's own top, measured from the cluster's — they differ by the
  // plant at the first table's end, which is in the cluster and not in the
  // group — so the band below is measured off what is actually drawn.
  const groupOffset = group ? group.y - cluster.y : 0;
  const breakTop =
    group && rugProp ? ROOM_PAD + groupOffset + group.h / 2 + rugProp.h / 2 + 1.2 : 0;
  const breakBottom = finalH - CORNER_PLANT_INSET - 0.4;
  const breakout =
    !!group && breakoutFits(finalW - ROOM_PAD * 2, breakBottom - breakTop, clearRatio);

  // Contents land inside the room's own frame, never at its very corner. THE
  // ONE FRAME RULE: a room's props, zones and seats are all expressed relative
  // to the room's top-left, so `resolveAnchors` — which measures wall and
  // corner anchors from that same corner — cannot disagree with them.
  // Translating to 0 and then centring the contents separately is what put the
  // reception's sofas on the walls and its rug fifteen units away in the middle
  // of the floor.
  // `place` adds the plate band, exactly as it does for the office and the
  // lounge, so the local frame's origin is the top of the INTERIOR and
  // `natural.h` carries the band. Adding it here as well is the two-frames
  // defect in miniature.
  const dx = -cluster.x + (naturalW - cluster.w) / 2;
  // A ROOM WITH A BREAK-OUT GROUP PUTS ITS DESKS AT THE TOP.
  //
  // The centred layout is right for a room the size of its furniture and wrong
  // for one the packer made half as deep again: the spare floor arrives as two
  // equal strips, one of which is under the plate. A room with a second
  // destination in it gives the whole of that floor to the destination, which
  // is the composition §3.7 draws and the one `crop-project-room@2x.png` shows.
  const dy = -cluster.y + (breakout ? ROOM_PAD - slackY : (naturalH - PLATE_BAND - cluster.h) / 2);
  translateContents({ props, zones }, dx, dy);
  for (const s of seats) {
    s.x += dx;
    s.y += dy;
  }

  if (breakout && rugProp) {
    const d = BREAKOUT_RUG_D;
    const band = breakBottom - breakTop;
    // Centred across the room and at the head of the band it was measured in,
    // written against the final interior and lifted by the slack `place` will
    // put back.
    const zx = (finalW - d) / 2 - slackX;
    const zy = breakTop + (band - d) / 2 - slackY;
    const z = { id: 'breakout', x: zx, y: zy, w: d, h: d };
    zones.push(z);
    props.push({
      kind: 'rug_round',
      id: 'breakout-rug',
      // This one lies on the room's own carpet, so it is the task textile
      // rather than the lounge's wool.
      tone: 'task',
      w: d,
      h: d,
      angle: 0,
      x: zx,
      y: zy,
      anchor: { type: 'zone', of: z.id, dx: 0, dy: 0 },
    });
    // The table first, then the two chairs facing each other across it: a
    // conversation, which is the one thing a project room does not otherwise
    // have a place for.
    const tOff = (d - BREAKOUT_TABLE) / 2;
    props.push({
      kind: 'side_table',
      w: BREAKOUT_TABLE,
      h: BREAKOUT_TABLE,
      angle: 0,
      x: zx + tOff,
      y: zy + tOff,
      anchor: { type: 'zone', of: z.id, dx: tOff, dy: tOff },
    });
    const seatOff = (d - SEAT_TUB) / 2;
    for (const side of /** @type {const} */ ([-1, 1])) {
      const cdx = side < 0 ? 0 : d - SEAT_TUB;
      props.push({
        kind: 'tub_chair',
        w: SEAT_TUB,
        h: SEAT_TUB,
        // Facing each other across the table: 0 is +x, so the chair on the
        // west side looks east and the one on the east side looks west.
        angle: side < 0 ? 0 : Math.PI,
        x: zx + cdx,
        y: zy + seatOff,
        anchor: { type: 'zone', of: z.id, dx: cdx, dy: seatOff },
      });
    }
  }

  // Planting in the corners the plate and the wall fixtures leave free. Never
  // the north-west corner: that is where the room's name is written.
  for (const corner of /** @type {const} */ (['SW', 'SE', 'NE'])) {
    props.push({
      kind: 'plant_large',
      w: 2.4,
      h: 2.4,
      angle: 0,
      x: 0,
      y: 0,
      anchor: { type: 'corner', corner, inset: CORNER_PLANT_INSET },
    });
  }

  /** @type {Room} */
  const room = {
    kind: 'project',
    id,
    name,
    x: 0,
    y: 0,
    w,
    h,
    // WP-72: the room's carpet is washed toward this project's identity
    // colour, and `identityFor` is a pure function of the MK number. Carried
    // on the room rather than looked up in the bake, because the bake is
    // handed a plan and nothing else — a renderer that had to reach back to
    // the snapshot for a colour would be a renderer that could be handed a
    // plan it cannot paint.
    projectMk: project.projectMk,
    plateBand: PLATE_BAND,
    // What the furniture actually needs. The tiler may widen a project room to
    // fill its row; `place` uses this to centre the desks in the result rather
    // than leaving them against the left wall, and `buildPlan` sums it to size
    // the working floor.
    natural: { w: naturalW, h: naturalH },
    walls: 'partial',
    floor: 'carpet',
    plateLines: [
      name,
      `${sessionCount} session${sessionCount === 1 ? '' : 's'} · ${formatTokens(project.tokens || 0)} tok · ${project.needsYou || 0} need you`,
      // WP-26's payroll meter. Third and quietest; `''` when the room has no
      // priceable model, which is what keeps an invented `$0.00` off the wall.
      payrollLine(project),
    ],
    props,
    zones,
  };
  return { room, seats, size: { w: room.w, h: room.h } };
}
