/**
 * The rooms a project earns: its own room, or one line in the idle strip.
 *
 * Split out of `plan.js` by WP-22. `buildProjectRoom` is where `08` B6's rule
 * becomes furniture — desks equal to the agents at them, a table per eight
 * people, and a `natural` footprint that is what the room's contents need
 * rather than what the packer has to spare (`docs/DEVIATIONS.md` §106).
 * `buildDirectory` is the other end of the same rule: a project with nobody in
 * it is a legible line, not an empty room.
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
  DIRECTORY_COL_MAX_W,
  DIRECTORY_COL_W,
  DIRECTORY_LINE_H,
  DIRECTORY_MAX_ROWS,
  DIRECTORY_PAD,
  FIXTURE_TOP,
  MARGIN,
  MIN_PROJECT_ROOM_H,
  MIN_PROJECT_ROOM_W,
  PLANT_GAP,
  PLANT_SIZE,
  PLATE_BAND,
  ROOM_PAD,
  RUG_MAX_OVER_CLUSTER,
  RUG_ROOM_INSET,
  SEAT_PITCH,
  TABLE_GAP,
  WHITEBOARD_H,
  angleTo,
  clamp,
} from './plan-units.js';

/** @typedef {import('./plan-units.js').ProjectLike} ProjectLike */
/** @typedef {import('./plan-units.js').Prop} Prop */
/** @typedef {import('./plan-units.js').Zone} Zone */
/** @typedef {import('./plan-units.js').Wall} Wall */
/** @typedef {import('./plan-units.js').DirectoryEntry} DirectoryEntry */
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

// ------------------------------------------------------------ project zones

/**
 * How many rows of lines a directory of `count` projects needs in `width`.
 * Pulled out because the envelope search has to know the strip's height
 * before the strip itself can be built.
 * @param {number} count
 * @param {number} width the strip's outer width, in units
 */
export function directoryGrid(count, width) {
  if (count <= 0) return { cols: 0, rows: 0 };
  const inner = Math.max(0, width - MARGIN * 2);
  // As many columns as fit a readable line, and then as many rows as those
  // columns need. Past the row cap the columns narrow and the names ellipsise
  // instead — a repo you cannot see is a repo you cannot start an agent in, so
  // a project is never dropped whatever the count.
  let cols = Math.max(1, Math.floor(inner / DIRECTORY_COL_W));
  let rows = Math.ceil(count / cols);
  if (rows > DIRECTORY_MAX_ROWS) {
    rows = DIRECTORY_MAX_ROWS;
    cols = Math.ceil(count / rows);
  }
  return { cols, rows };
}

/** How many rows of lines a directory of `count` projects needs in `width`. */
export function directoryRows(count, width) {
  return directoryGrid(count, width).rows;
}

/** The height a directory of `count` projects takes in `width`. */
export function directoryHeight(count, width) {
  const rows = directoryRows(count, width);
  return rows === 0 ? 0 : PLATE_BAND + rows * DIRECTORY_LINE_H + DIRECTORY_PAD;
}

/**
 * The idle-projects directory: one strip, one line per repo nobody is in.
 *
 * A project whose agents are all benched, archived or finished used to get a
 * collapsed ROOM — a plate with a footprint, which still bid for area in the
 * treemap. On the reference machine that spent most of the working floor on
 * rooms with nobody in them (`08` B6). It is a DIRECTORY now: a strip along
 * the bottom of the working floor carrying, per project, its name, its session
 * count and how long ago anything happened in it, each line a click target
 * that opens the panel exactly as a room plate does.
 *
 * Deliberately still ON the floor rather than hidden: the repo exists, and
 * being able to see it — and start an agent in it — is the point. Only an
 * explicit archive removes a project from view altogether.
 *
 * The lines are laid out here, in the room's own frame, and drawn live by
 * `scene.js`: their text is session counts and elapsed times, which change on
 * every push, and re-baking the backdrop for that would cost ~190 ms a frame.
 *
 * @param {{id:string,name:string,sessionCount:number,lastActivityAt:number}[]} projects
 * @param {{w:number,h:number}} fit the strip the packer has reserved
 * @returns {Room}
 */
export function buildDirectory(projects, fit) {
  const grid = directoryGrid(projects.length, fit.w);
  const rows = Math.max(1, grid.rows);
  // The SAME column count the strip was measured with. Deriving it back from
  // the row count instead put six columns in a strip one column wide, which is
  // how seventeen idle repos came to be drawn on top of each other.
  const cols = Math.max(1, grid.cols);
  const inner = Math.max(1, fit.w - MARGIN * 2);
  // Columns share the strip evenly, but a column wider than a line needs is a
  // line with its name at one end of the building and its numbers at the
  // other. One idle repo gets a readable line, not a full-width one.
  const colW = Math.min(inner / cols, DIRECTORY_COL_MAX_W);

  // Local frame, exactly like a prop: (0, 0) is the room's top-left and the
  // interior starts below the plate band, which `place` adds. Writing the
  // band in here as well would be the two-frames defect in miniature.
  /** @type {DirectoryEntry[]} */
  const entries = projects.map((p, i) => ({
    ...p,
    // Column-major: reading down a column then across is how a directory
    // board is read, and it keeps a project in the same place when the strip
    // gains a row rather than reshuffling every line.
    x: MARGIN + Math.floor(i / rows) * colW,
    y: (i % rows) * DIRECTORY_LINE_H,
    w: colW,
    h: DIRECTORY_LINE_H,
  }));

  /** @type {Room} */
  return {
    kind: 'directory',
    id: '__directory__',
    name: 'Idle projects',
    x: 0,
    y: 0,
    w: fit.w,
    h: fit.h,
    walls: 'partial',
    // Circulation, not carpet: nobody works here, and painting it as a room
    // material made a strip with no furniture in it read as one more empty
    // room — which is the exact defect this strip exists to remove.
    floor: 'circulation',
    plateLines: [
      'Idle projects',
      `${projects.length} repo${projects.length === 1 ? '' : 's'} · nobody in`,
    ],
    props: [],
    zones: [],
    plateBand: PLATE_BAND,
    entries,
  };
}

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
          w: 1.6,
          h: 0.5,
          // The rect already says the screen is wide and shallow, sitting
          // across the table edge. Rotating it by the occupant's facing on
          // top of that stood it on end — the same mistake the reception
          // sofa made. `angle` is not how a prop LIES; its rect is.
          angle: 0,
          x: cx - 0.8,
          y: side.sign < 0 ? ty : ty + t.h - 0.5,
          anchor: {
            type: 'attached',
            to: tableId,
            edge: side.key,
            along: (k + 0.5) * SEAT_PITCH - 0.8,
            gap: -0.5,
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
      w: 1.2,
      h: 3.6,
      angle: 0,
      x: firstTable.x,
      y: firstTable.y,
      anchor: { type: 'wall', side: 'E', along: FIXTURE_TOP, inset: 0.3 },
    });
    if (project.hasDashboard) {
      props.push({
        kind: 'screen',
        id: 'screen',
        w: 0.9,
        h: 2.4,
        angle: 0,
        x: firstTable.x,
        y: firstTable.y,
        anchor: { type: 'wall', side: 'E', along: FIXTURE_TOP + 3.6 + 0.8, inset: 0.3 },
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
      w: 2.4,
      h: WHITEBOARD_H,
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
  const dy = -cluster.y + (naturalH - PLATE_BAND - cluster.h) / 2;
  translateContents({ props, zones }, dx, dy);
  for (const s of seats) {
    s.x += dx;
    s.y += dy;
  }

  const w = Math.max(naturalW, fit && fit.w > 0 ? fit.w : 0);
  const h = Math.max(naturalH, fit && fit.h > 0 ? fit.h : 0);

  // A rug under the desk cluster. A project room is given its cell by the
  // treemap and can still be a little larger than its desks need — an interior
  // with a group of desks adrift in the middle of it is unfinished, and a rug
  // is what defines the group as a group. It grows with the room, stopping
  // `RUG_ROOM_INSET` clear of the walls so the corner planting and the wall
  // fixtures keep floor of their own, and it is never allowed to become the
  // room: past `RUG_MAX_OVER_CLUSTER` the extra floor is honestly bare rather
  // than painted as a rug that nothing stands on.
  if (zones.length) {
    const clusterW = cluster.w + 1.6;
    const clusterH = cluster.h + 1.6;
    const rugW = clamp(w - RUG_ROOM_INSET * 2, clusterW, clusterW * RUG_MAX_OVER_CLUSTER);
    const rugH = clamp(
      h - PLATE_BAND - RUG_ROOM_INSET * 2,
      clusterH,
      clusterH * RUG_MAX_OVER_CLUSTER,
    );
    props.unshift({
      kind: 'rug',
      w: rugW,
      h: rugH,
      angle: 0,
      x: 0,
      y: 0,
      anchor: { type: 'centered', of: 'desk-group' },
    });
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
