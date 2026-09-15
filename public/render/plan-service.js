/**
 * The lounge: the other service room.
 *
 * Split out of `plan.js` by WP-22, when it held the office as well — "one
 * module because they are one column of the building, sized together, stacked
 * together". WP-59d ended that: in arrangement B the reception is the left end
 * of the top row and the lounge the left end of the bottom one, at different
 * widths, at different depths and on different axes, so the office went to
 * `plan-office.js` and this file kept the room that is still one thing.
 *
 * What the two still share is the sentence that made them a pair in the first
 * place: they are the only rooms whose contents are a function of a COUNT
 * rather than of a project.
 */

import { translateContents } from './plan-anchors.js';
import { boundsOf, shelfPack } from './plan-packing.js';
import {
  LOUNGE_GAP,
  LOUNGE_MAX_GAMES,
  LOUNGE_PACKS,
  LOUNGE_SOFA_GROUP_H,
  MARGIN,
  MINGLE_PITCH,
  MINGLE_PITCH_MIN,
  MINGLE_ROW,
  MINGLE_ROW_MIN,
  PLATE_BAND,
  clamp,
} from './plan-units.js';
import {
  LOUNGE_ARCADE_H,
  LOUNGE_ARCADE_W,
  LOUNGE_COFFEE_H,
  LOUNGE_COFFEE_W,
  LOUNGE_DINING,
  LOUNGE_FRIDGE_H,
  LOUNGE_FRIDGE_W,
  LOUNGE_POOL_H,
  LOUNGE_POOL_W,
  LOUNGE_STOOL_PITCH,
  LOUNGE_TT_H,
  LOUNGE_TT_W,
  SEAT_ARMCHAIR,
  SEAT_STOOL,
} from './plan-furniture.js';
import {
  LOUNGE_BAY_SPEC,
  PLANTER_MARGIN,
  PLANTER_W,
  PLANTS_PER_LOUNGE_BAY,
  PLANT_FOOTPRINTS,
  loungeBayNames,
  plantRun,
} from './plan-props.js';

/** @typedef {import('./plan-units.js').Prop} Prop */
/** @typedef {import('./plan-units.js').Zone} Zone */
/** @typedef {import('./plan-units.js').Room} Room */
/** @typedef {import('./plan-units.js').LoungeSpot} LoungeSpot */

// --------------------------------------------------------------- the lounge

/**
 * The lounge: a rest area, a games room and a coffee spot in one.
 *
 * Unlike the project rooms, this is furnished whether or not anyone is in it —
 * an empty lounge should still read as somewhere you would want to go, because
 * a cleared queue is the reward and an empty grey box is not much of one. What
 * scales with the benched population is the GAMES: a table appears when there
 * are enough people to use it, so a busy lounge fills up rather than starting
 * out sparse.
 *
 * THE LOUNGE IS SIZED BY WHO IS DRAWN, not by who is benched (`08` B6).
 * `benchedCount` is the DRAWN count — benched agents with no activity for
 * longer than the gone-home window are not in this room and do not size it.
 * `goneHomeCount` only reaches the door plate.
 *
 * @param {number} benchedCount agents actually drawn in here
 * @param {{w:number,h:number}} [fit] the interior this room has been given
 * @param {number} [goneHomeCount] benched, not drawn; carried on the plate
 * @param {number} [pack] how tightly the clusters and the standing band are
 *   laid, `1` being the room as it has always been laid and `LOUNGE_PACKS`'s
 *   last entry the densest (WP-59c). NOTHING is removed at any setting and no
 *   furniture changes size: the gaps between the clusters close and the
 *   benched stand closer together, which is the whole of it. The service
 *   column sets the building's height, so this is what stops a lounge
 *   dictating an empty lot on the working side.
 */
export function buildLounge(benchedCount, fit, goneHomeCount = 0, pack = 1) {
  const packing = clamp(Number(pack) || 1, LOUNGE_PACKS[LOUNGE_PACKS.length - 1], 1);
  const gap = LOUNGE_GAP * packing;
  const minglePitch = Math.max(MINGLE_PITCH_MIN, MINGLE_PITCH * packing);
  const mingleRow = Math.max(MINGLE_ROW_MIN, MINGLE_ROW * packing);
  /** @type {Prop[]} */
  const props = [];
  /** @type {Zone[]} */
  const zones = [];
  /** @type {LoungeSpot[]} */
  const spots = [];
  /** @type {{id:string, w:number, h:number, place:(x:number,y:number)=>void}[]} */
  const blocks = [];

  /** Shorthand: a prop positioned by an offset inside a zone. */
  const at = (zone, kind, dx, dy, w, h, angle = 0, id = undefined) => {
    props.push({
      kind,
      id,
      w,
      h,
      angle,
      x: zone.x + dx,
      y: zone.y + dy,
      anchor: { type: 'zone', of: zone.id, dx, dy },
    });
  };

  // ---- the lounge proper: sofas facing a television, on a round rug
  // The deepest block in the room, and therefore the one that decides how short
  // an empty lounge can be — `LOUNGE_MIN_H` is arithmetic over it (WP-77), so
  // the depth is named there rather than written twice.
  blocks.push({
    id: 'living',
    w: 15,
    h: LOUNGE_SOFA_GROUP_H,
    place(x, y) {
      const z = { id: 'living-zone', x, y, w: 15, h: LOUNGE_SOFA_GROUP_H };
      zones.push(z);
      // §3.7's sitting bay lies on *"boards + wool rug"*: the one rectangular
      // textile in this room, and the quiet bay one block over takes the round
      // one. Two grounds, two shapes — which is the difference §3.7 is asking
      // for when it calls each bay a place.
      at(z, 'rug', 1.5, 1.5, 12, 8, 0, 'lounge-sitting-rug');
      at(z, 'tv', 4.5, 0, 6, 0.6);
      at(z, 'sofa', 3.5, 7.6, 8, 2.4, -Math.PI / 2, 'lounge-sofa-main');
      at(z, 'sofa', 0.4, 3.2, 2.4, 5, 0, 'lounge-sofa-side');
      at(z, 'coffee_table', 4.6, 4.2, LOUNGE_COFFEE_W, LOUNGE_COFFEE_H);
      at(z, 'side_table', 12.4, 3.4, 1.8, 1.8);
      at(z, 'lamp', 12.6, 6, 1.6, 1.6);
      spots.push({
        id: 'lounge-sofa-a',
        kind: 'lounge_idle',
        x: x + 7.5,
        y: y + 8.8,
        angle: -Math.PI / 2,
        capacity: 3,
      });
      spots.push({
        id: 'lounge-sofa-b',
        kind: 'lounge_idle',
        x: x + 1.6,
        y: y + 5.7,
        angle: 0,
        capacity: 2,
      });
    },
  });

  // ---- the coffee spot: counter, machine, fridge, and stools to sit at
  blocks.push({
    id: 'coffee',
    w: 13,
    h: 8,
    place(x, y) {
      const z = { id: 'kitchen-zone', x, y, w: 13, h: 8 };
      zones.push(z);
      at(z, 'counter', 1, 0.4, 11, 2, 0, 'kitchen-counter');
      at(z, 'coffee_machine', 1.6, 2.7, 1.6, 1.2);
      at(z, 'fridge', 9.9, 2.5, LOUNGE_FRIDGE_W, LOUNGE_FRIDGE_H);
      // A fruit bowl and a mug on the counter: the small domestic cues that
      // make this read as a kitchen at a glance rather than as more office
      // furniture with a different outline.
      at(z, 'fruit_bowl', 5.2, 0.9, 1.6, 1.6);
      at(z, 'bar_counter', 1, 5, 11, 1.6, 0, 'bar-counter');
      // THREE STOOLS AT A 4 U PITCH (§3.4), where there were four at 2.8.
      //
      // There were four stools and three places to sit at them — `spots` below
      // has always laid three — so the fourth was a seat nobody could ever be
      // drawn in, at a pitch that put all four shoulder to shoulder. A stool is
      // the smallest of §3.4's four seat kinds and the pitch is what says so.
      for (let i = 0; i < 3; i++)
        at(z, 'bar_stool', 1.9 + i * LOUNGE_STOOL_PITCH, 7, SEAT_STOOL, SEAT_STOOL);
      at(z, 'fruit_bowl', 8.4, 5.2, 1.4, 1.4);
      spots.push({
        id: 'lounge-coffee',
        kind: 'coffee',
        x: x + 2.4,
        y: y + 3.6,
        angle: -Math.PI / 2,
        capacity: 1,
      });
      for (let i = 0; i < 3; i++) {
        spots.push({
          id: `lounge-bar-${i}`,
          kind: 'eat',
          x: x + 1.9 + SEAT_STOOL / 2 + i * LOUNGE_STOOL_PITCH,
          y: y + 7.8,
          angle: -Math.PI / 2,
          capacity: 1,
        });
      }
    },
  });

  // ---- a quiet corner, always present: books, two armchairs and a plant
  //
  // §3.4's quiet bay, at the furniture it names: *"two armchairs, side table,
  // bookcase, one tall plant"*. It was a six-unit sofa and a side table beside
  // it, which is the same silhouette as the two sofa runs one block over — and
  // §1.6's finding was one silhouette repeated. The armchair is the largest of
  // §3.4's four seat kinds at 3.0 U, so a quiet corner reads as a quiet corner
  // from across the room rather than as a smaller living room.
  blocks.push({
    id: 'quiet',
    w: 9,
    h: 6,
    place(x, y) {
      const z = { id: 'quiet-zone', x, y, w: 9, h: 6 };
      zones.push(z);
      // §3.7's quiet bay: *"boards + round rug"*, and the rug goes down first
      // so the armchairs stand on it rather than beside it.
      at(z, 'rug_round', 1.2, 1.4, 6.6, 4.4, 0, 'lounge-quiet-rug');
      at(z, 'bookshelf', 0.5, 0.3, 8, 1.3);
      const chairY = 2.6;
      at(z, 'armchair', 0.6, chairY, SEAT_ARMCHAIR, SEAT_ARMCHAIR, 0);
      at(z, 'side_table', 3.9, chairY + 0.8, 1.4, 1.4);
      at(z, 'armchair', 5.4, chairY, SEAT_ARMCHAIR, SEAT_ARMCHAIR, Math.PI);
      // One seat per chair, each facing the table between them.
      spots.push({
        id: 'lounge-quiet-a',
        kind: 'lounge_idle',
        x: x + 0.6 + SEAT_ARMCHAIR / 2,
        y: y + chairY + SEAT_ARMCHAIR / 2,
        angle: 0,
        capacity: 1,
      });
      spots.push({
        id: 'lounge-quiet-b',
        kind: 'lounge_idle',
        x: x + 5.4 + SEAT_ARMCHAIR / 2,
        y: y + chairY + SEAT_ARMCHAIR / 2,
        angle: Math.PI,
        capacity: 1,
      });
    },
  });

  /**
   * A games table, added only once there are enough people to want it.
   * @param {string} id
   * @param {string} kind
   * @param {number} w
   * @param {number} h
   * @param {(z: Zone) => void} addSpots
   */
  // Standing room between a game table and the edge of its block. Players
  // stand OUTSIDE the table; an earlier version derived spots from the zone
  // rather than the table, which put every player on top of the furniture
  // they were supposedly using — 14 of 23 lounge spots, including all four
  // diners sitting in the middle of the dining table.
  const GAME_INSET = 1.6;
  const STAND_OFF = 1.2;

  /**
   * A standing spot just clear of a table edge, facing the table.
   *
   * `bodyAngle` 0 faces +x, so each side faces back across the table:
   * standing south of it means looking north, and so on.
   *
   * @param {{x:number,y:number,w:number,h:number}} t the table's own rect
   * @param {'N'|'S'|'W'|'E'} side which side of it to stand on
   * @param {number} frac 0..1 along that side
   */
  const atTable = (t, side, frac) => {
    if (side === 'S') return { x: t.x + t.w * frac, y: t.y + t.h + STAND_OFF, angle: -Math.PI / 2 };
    if (side === 'N') return { x: t.x + t.w * frac, y: t.y - STAND_OFF, angle: Math.PI / 2 };
    if (side === 'W') return { x: t.x - STAND_OFF, y: t.y + t.h * frac, angle: 0 };
    return { x: t.x + t.w + STAND_OFF, y: t.y + t.h * frac, angle: Math.PI };
  };

  /**
   * A game: one piece of furniture, plus the places people stand to use it.
   *
   * `tw`/`th` are the TABLE's size, not the block's — the block grows by the
   * standing margin on every side. `addSpots` receives the table's resolved
   * rect, so spots are always positioned relative to the thing they belong
   * to rather than to a zone that merely contains it.
   */
  const game = (id, kind, tw, th, addSpots) => {
    blocks.push({
      id,
      w: tw + GAME_INSET * 2,
      h: th + GAME_INSET * 2,
      place(x, y) {
        const z = { id: `${id}-zone`, x, y, w: tw + GAME_INSET * 2, h: th + GAME_INSET * 2 };
        zones.push(z);
        const t = { x: x + GAME_INSET, y: y + GAME_INSET, w: tw, h: th };
        at(z, kind, GAME_INSET, GAME_INSET, tw, th, 0, id);
        addSpots(z, t);
      },
    });
  };

  // How many games this lounge lays out.
  //
  // THE LOUNGE IS SIZED BY WHO IS IN IT (WP-55). The old rule dealt a table out
  // at 1, 3, 5, 7, 9 and 11 benched agents, which on the reference machine gave
  // twelve people an arcade: five tables, and a service column 76 U tall beside
  // a working floor that needed 20. A table now appears only while the lounge
  // has more people in it than places to put them — and one is kept whenever
  // anybody is in at all, because a lounge with nobody playing anything is
  // still a lounge and an empty one is not much of a reward.
  //
  // `LOUNGE_BASE_SEATS` is the capacity of the three blocks above: the living
  // room's two sofas (3 + 2), the coffee spot's machine and three bar stools
  // (1 + 3), and the quiet corner (2). They are declared inside `place`, which
  // has not run yet, so it is stated here rather than counted.
  const LOUNGE_BASE_SEATS = 11;
  let games = 0;
  let capacity = LOUNGE_BASE_SEATS;
  /** @param {number} seats the table this call would add */
  const wants = (seats) => {
    if (benchedCount <= 0 || games >= LOUNGE_MAX_GAMES) return false;
    if (games > 0 && capacity >= benchedCount) return false;
    games++;
    capacity += seats;
    return true;
  };

  if (wants(4)) {
    game('dining', 'dining_table', LOUNGE_DINING, LOUNGE_DINING, (z, t) => {
      /** @type {Array<['N'|'S'|'E'|'W', number]>} */
      const seats = [
        ['S', 0.28],
        ['S', 0.72],
        ['N', 0.28],
        ['N', 0.72],
      ];
      seats.forEach(([side, frac], i) => {
        spots.push({ id: `lounge-eat-t${i}`, kind: 'eat', capacity: 1, ...atTable(t, side, frac) });
      });
    });
  }
  if (wants(2)) {
    game('pool', 'pool_table', LOUNGE_POOL_W, LOUNGE_POOL_H, (z, t) => {
      at(z, 'lamp', 0.4, z.h - 2, 1.4, 1.4);
      // Opposite sides, offset along the table rather than face to face —
      // how two people actually stand around a pool table.
      spots.push({
        id: 'lounge-pool-a',
        kind: 'pool',
        capacity: 1,
        partnerOf: 'lounge-pool-b',
        ...atTable(t, 'S', 0.32),
      });
      spots.push({
        id: 'lounge-pool-b',
        kind: 'pool',
        capacity: 1,
        partnerOf: 'lounge-pool-a',
        ...atTable(t, 'N', 0.68),
      });
    });
  }
  if (wants(2)) {
    game('tt', 'table_tennis', LOUNGE_TT_W, LOUNGE_TT_H, (z, t) => {
      // One at each end, across the net.
      spots.push({
        id: 'lounge-tt-a',
        kind: 'table_tennis',
        capacity: 1,
        partnerOf: 'lounge-tt-b',
        ...atTable(t, 'W', 0.5),
      });
      spots.push({
        id: 'lounge-tt-b',
        kind: 'table_tennis',
        capacity: 1,
        partnerOf: 'lounge-tt-a',
        ...atTable(t, 'E', 0.5),
      });
    });
  }
  if (wants(2)) {
    game('foos', 'foosball', 8.2, 5.2, (z, t) => {
      spots.push({
        id: 'lounge-foos-a',
        kind: 'board_game',
        capacity: 1,
        partnerOf: 'lounge-foos-b',
        ...atTable(t, 'W', 0.5),
      });
      spots.push({
        id: 'lounge-foos-b',
        kind: 'board_game',
        capacity: 1,
        partnerOf: 'lounge-foos-a',
        ...atTable(t, 'E', 0.5),
      });
    });
  }
  if (wants(1)) {
    game('arcade', 'arcade_cabinet', LOUNGE_ARCADE_W, LOUNGE_ARCADE_H, (z, t) => {
      // In front of the cabinet, facing the screen.
      spots.push({ id: 'lounge-arcade', kind: 'arcade', capacity: 1, ...atTable(t, 'S', 0.5) });
    });
  }
  if (wants(4)) {
    game('board', 'board_game_table', 7.2, 6.2, (z, t) => {
      /** @type {Array<['N'|'S'|'E'|'W', number]>} */
      const seats = [
        ['S', 0.28],
        ['S', 0.72],
        ['N', 0.28],
        ['N', 0.72],
      ];
      seats.forEach(([side, frac], i) => {
        spots.push({
          id: `lounge-board-${i}`,
          kind: 'board_game',
          capacity: 1,
          ...atTable(t, side, frac),
        });
      });
    });
  }

  // ---- THE FOUR BAYS (§3.7), and which block belongs to which.
  //
  // *"The lounge is four bays, not one field."* It was a field: nine blocks of
  // furniture shelf-packed by height into whatever rectangle the packer had
  // left, so a pool table could land between the sofas and the fridge and the
  // room had no places in it at all — one continuous floor with objects on it.
  //
  // A bay is three things and nothing else: its own ground, its own centrepiece
  // and a planter run between it and the next one. The blocks did not have to
  // change to get that; what had to change is that they pack TWICE — inside a
  // bay first, then as bays — so a bay comes out as one rectangle the eye can
  // find rather than as a scatter its neighbours are interleaved with.
  const BAY_OF = /** @type {Record<string, string>} */ ({
    living: 'sitting',
    quiet: 'quiet',
    coffee: 'cafe',
    dining: 'cafe',
    pool: 'games',
    tt: 'games',
    foos: 'games',
    arcade: 'games',
    board: 'games',
  });
  /** Clear floor a bay's ground keeps round its own furniture. */
  const BAY_PAD = 1;
  // The gap between two bays has to hold the planter that divides them, which
  // is why it is not simply `LOUNGE_GAP`: at the densest packing that gap is
  // one unit, and a 0.9 U trough in it would touch the furniture either side.
  const bayGap = Math.max(gap, PLANTER_W + PLANTER_MARGIN * 2);

  const budgetW = fit && fit.w > 0 ? fit.w - MARGIN * 2 : Infinity;
  // The lounge's blocks are all different sizes, so it shelf-packs rather than
  // flowing into a fixed column count (see `shelfPack`).
  const budget = Number.isFinite(budgetW)
    ? budgetW
    : Math.max(...blocks.map((b) => b.w)) * Math.max(1, Math.round(Math.sqrt(blocks.length)));

  // IS THIS LOUNGE ONE ROW? §3.7's collapse rule is about a lounge laid in a
  // single row of bays — *"it never spreads three bays across sixty units"* —
  // and a lounge with the depth for a second shelf does not have that problem.
  // At `LOUNGE_MIN_H` it is one sofa group deep by construction (WP-77), which
  // is the only shape where a bay has to be given up rather than wrapped. See
  // `loungeBayNames`.
  const deepest = Math.max(...blocks.map((b) => b.h));
  const depthBudget = fit && fit.h > 0 ? fit.h - PLATE_BAND - MARGIN * 2 : Infinity;
  const oneRow = depthBudget < deepest * 2 + bayGap;
  const present = new Set(blocks.map((b) => BAY_OF[b.id]));
  const bayNames = loungeBayNames(budget, { oneRow, has: (n) => present.has(n) });
  const kept = new Set(bayNames);
  const live = blocks.filter((b) => kept.has(BAY_OF[b.id]));

  // Each bay packs its own blocks, then the bays pack into the room — IN THE
  // ORDER §3.7 LISTS THEM rather than by height. `shelfPack` sorts tallest
  // first, which is right for loose furniture and wrong for a row of places:
  // the lounge reads left to right, sitting to games, on every floor.
  const bays = bayNames.map((name) => {
    const own = live.filter((b) => BAY_OF[b.id] === name);
    const inner = shelfPack(own, gap, Math.max(budget - BAY_PAD * 2, ...own.map((b) => b.w)));
    return {
      name,
      own,
      inner,
      x: 0,
      y: 0,
      row: 0,
      w: inner.w + BAY_PAD * 2,
      h: inner.h + BAY_PAD * 2,
    };
  });
  let bx = 0;
  let by = 0;
  let rowH = 0;
  let row = 0;
  for (const bay of bays) {
    if (bx > 0 && bx + bay.w > budget + 1e-6) {
      by += rowH + bayGap;
      bx = 0;
      rowH = 0;
      row++;
    }
    bay.x = bx;
    bay.y = by;
    bay.row = row;
    bx += bay.w + bayGap;
    rowH = Math.max(rowH, bay.h);
  }
  for (const bay of bays) {
    bay.own.forEach((b, i) => {
      const at = bay.inner.out[i];
      b.place(bay.x + BAY_PAD + at.x, bay.y + BAY_PAD + at.y);
    });
  }

  // ---- each bay's own GROUND, and the planter run that divides it from the
  // next one (§3.6: *"planters do the dividing between bays, which is what a
  // planting budget is for"*).
  //
  // The ground is a zone rather than a rug: a rug is a thing lying on a floor
  // and a bay's ground IS the floor — the café's is tile, which is the one
  // material change inside this room and the reason it was already carrying a
  // `kitchenZone` before there were bays to have one.
  for (const bay of bays) {
    const spec = LOUNGE_BAY_SPEC[bay.name];
    zones.push({
      id: `lounge-bay-${bay.name}`,
      x: bay.x,
      y: bay.y,
      w: bay.w,
      h: bay.h,
      bay: bay.name,
      ground: spec ? spec.ground : 'wood',
    });
  }
  // ONE PLANT PER BAY, in the bay's own south-west corner (§3.6 allows six and
  // this room wants the budget spent on the planters instead: *"planters do the
  // dividing between bays, which is what a planting budget is for"*). The kinds
  // come from `plantRun`, so the four bays never show the same silhouette twice
  // running and a reader can tell one bay's corner from the next one's.
  const bayKinds = plantRun('__lounge__', Math.min(bays.length, PLANTS_PER_LOUNGE_BAY));
  bays.forEach((bay, i) => {
    const kind = bayKinds[i % bayKinds.length];
    const size = PLANT_FOOTPRINTS[kind] || 2.4;
    const dx = Math.max(0, bay.w - size - 0.2);
    const dy = Math.max(0, bay.h - size - 0.2);
    props.push({
      kind,
      w: size,
      h: size,
      angle: 0,
      x: bay.x + dx,
      y: bay.y + dy,
      anchor: { type: 'zone', of: `lounge-bay-${bay.name}`, dx, dy },
    });
  });

  for (let i = 1; i < bays.length; i++) {
    const left = bays[i - 1];
    const right = bays[i];
    if (left.row !== right.row) continue;
    const run = Math.max(left.h, right.h);
    props.push({
      kind: 'planter',
      id: `lounge-planter-${left.name}-${right.name}`,
      w: PLANTER_W,
      h: run,
      angle: 0,
      x: left.x + left.w + (bayGap - PLANTER_W) / 2,
      y: Math.min(left.y, right.y),
      anchor: {
        type: 'zone',
        of: `lounge-bay-${left.name}`,
        dx: left.w + (bayGap - PLANTER_W) / 2,
        dy: Math.min(left.y, right.y) - left.y,
      },
    });
  }

  // Standing conversations need no furniture, so they take the promenade
  // along the bottom of the lounge once every seat is spoken for.
  //
  // The count is a HARD guarantee, not a decoration: `assignSeats` gives one
  // agent one spot, so a lounge with fewer spots than benched agents stacks
  // the remainder on top of each other. The band therefore grows until every
  // benched agent has somewhere of their own to stand.
  const furniture = boundsOf([...props, ...zones]);
  const seated = spots.reduce((a, sp) => a + sp.capacity, 0);
  const missing = Math.max(0, benchedCount - seated);
  if (missing > 0) {
    // ALONG THE WHOLE WIDTH IT WAS GIVEN (WP-59d), not along the furniture.
    // In a column the two are the same number — the clusters shelf-pack to
    // fill their budget and the band is the same width as they are — and in a
    // ROW they are not: a lounge ninety units wide whose blocks came out
    // sixty stood its whole benched population in the left two thirds of it
    // and left the rest bare. The promenade is the one thing in this room that
    // can be any width at all, so it takes the room's.
    const bandW = Number.isFinite(budgetW) ? budgetW : furniture.w;
    const perRow = Math.max(2, 2 * Math.floor(bandW / (minglePitch * 2)));
    const rows = Math.ceil(missing / perRow);
    const bandY = furniture.y + furniture.h + gap;
    zones.push({
      id: 'lounge-mingle',
      x: furniture.x,
      y: bandY - 1.2,
      w: Math.max(furniture.w, bandW),
      h: rows * mingleRow + 2.4,
    });
    let made = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c + 1 < perRow && made < missing; c += 2) {
        const bx = furniture.x + 1.2 + c * minglePitch;
        const by = bandY + r * mingleRow;
        const a = `lounge-chat-${r}-${c}a`;
        const b = `lounge-chat-${r}-${c}b`;
        spots.push({ id: a, kind: 'chat', x: bx, y: by, angle: 0, capacity: 1, partnerOf: b });
        made++;
        if (made < missing) {
          spots.push({
            id: b,
            kind: 'chat',
            x: bx + 1.8,
            y: by,
            angle: Math.PI,
            capacity: 1,
            partnerOf: a,
          });
          made++;
        }
      }
    }
  }

  const box = boundsOf([...props, ...zones]);
  // One frame: contents sit MARGIN inside the room's own top-left corner, and
  // every anchor is measured from that same corner.
  const dx = -box.x + MARGIN;
  const dy = -box.y + MARGIN;
  translateContents({ props, zones }, dx, dy);
  for (const sp of spots) {
    sp.x += dx;
    sp.y += dy;
  }
  // THE CAFÉ BAY'S GROUND IS THE TILE (§3.7). It used to be the kitchen block's
  // own 13 x 8 zone, which tiled the counter and left the dining table standing
  // on boards two units away — half a floor, which is worse than either. The
  // bay is the room's one material change and it is the whole bay.
  const cafeBay = zones.find((z) => z.id === 'lounge-bay-cafe');
  const kitchen = cafeBay || zones.find((z) => z.id === 'kitchen-zone');

  /** @type {Room} */
  const room = {
    kind: 'lounge',
    id: '__lounge__',
    name: 'Lounge',
    x: 0,
    y: 0,
    // Its own size. `fit` is a BUDGET for the flow above, not a size to pad
    // out to: a room padded to a budget it did not need is a room with a bay
    // of empty floor in it, which is the whole defect this layer exists to
    // prevent. The packer gives the leftover to circulation instead.
    w: box.w + MARGIN * 2,
    h: Math.max(box.h + MARGIN * 2, fit ? fit.h - PLATE_BAND : 0) + PLATE_BAND,
    plateBand: PLATE_BAND,
    natural: { w: box.w + MARGIN * 2, h: box.h + MARGIN * 2 + PLATE_BAND },
    walls: 'partial',
    floor: 'wood',
    // The door plate carries the people who are not in the room, which is the
    // only place that number is visible on the floor at all.
    plateLines: [
      'Lounge',
      goneHomeCount > 0
        ? `${benchedCount} resting · ${goneHomeCount} went home`
        : `${benchedCount} resting`,
    ],
    props,
    zones,
    kitchenZone: kitchen ? { x: kitchen.x, y: kitchen.y, w: kitchen.w, h: kitchen.h } : undefined,
  };
  return { room, loungeSpots: spots };
}
