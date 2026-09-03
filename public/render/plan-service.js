/**
 * The service column: the user's office, and the lounge.
 *
 * Split out of `plan.js` by WP-22. These two are one module because they are
 * one column of the building — sized together, stacked together, and the only
 * two rooms whose contents are a function of a count rather than of a project.
 * `seatOffice` is here rather than with the packing because it reads the
 * office's own resolved furniture: it must run after `resolveAnchors`, or the
 * waiting agents sit beside the sofas instead of on them.
 */

import { translateContents } from './plan-anchors.js';
import { boundsOf, shelfPack } from './plan-packing.js';
import {
  CHAIR,
  LOUNGE_GAP,
  LOUNGE_MAX_GAMES,
  MARGIN,
  MINGLE_PITCH,
  MINGLE_ROW,
  OFFICE_CHAIR_PITCH,
  OFFICE_CHAIR_ROW,
  OFFICE_GROWTH_H,
  OFFICE_GROWTH_W,
  OFFICE_MAX_H,
  OFFICE_MAX_W,
  OFFICE_MIN_H,
  OFFICE_MIN_W,
  OFFICE_SEAT_PITCH,
  PLATE_BAND,
  ROOM_ASPECT_MAX,
  SOFA_MIN_RUN,
  SOFA_SEAT_BIAS,
  angleTo,
  clamp,
} from './plan-units.js';

/** @typedef {import('./plan-units.js').Prop} Prop */
/** @typedef {import('./plan-units.js').Zone} Zone */
/** @typedef {import('./plan-units.js').Room} Room */
/** @typedef {import('./plan-units.js').Seat} Seat */
/** @typedef {import('./plan-units.js').LoungeSpot} LoungeSpot */

// --------------------------------------------------------------- the office

/**
 * The user's office: their desk at the head of the room, and a reception
 * seated around the walls.
 *
 * Three rules shape it, all from how a real office actually works:
 *
 *   1. **The seating is against the walls.** A sofa run hugs the west, south
 *      and east walls, which leaves the middle of the room clear. An earlier
 *      version floated a C-shaped group in the centre and the room read as
 *      cramped, because the only circulation left was the gap between the
 *      furniture and the wall.
 *   2. **Nobody sits across from the manager except the person being seen.**
 *      There is exactly one guest chair at the desk, and it belongs to the
 *      front of the queue — the agent that has waited longest. Everyone else
 *      waits on the sofas until they are called.
 *   3. **The room is laid out for the size it is actually given.** `fit` is
 *      the interior the tiler ended up handing this room; the furniture is
 *      designed into it rather than laid out at some natural size and then
 *      centred inside a larger box. Centring was the old behaviour and it is
 *      what decoupled the wall-anchored sofas from the free-standing rug and
 *      coffee table by up to fifteen units.
 *
 * Local coordinates are the ROOM's own frame: (0, 0) is the room's top-left
 * corner, so `resolveAnchors` — which measures wall and corner anchors from
 * that same corner — can never disagree with the coordinates written here.
 *
 * @param {number} waitingCount
 * @param {{w:number,h:number}} [fit] the interior this room has been given
 */
export function buildOffice(waitingCount, fit) {
  /** @type {Prop[]} */
  const props = [];
  /** @type {Zone[]} */
  const zones = [];

  // On the first pass `fit` is absent and the room bids for space at its
  // minimum size; the packer then re-runs this function with whatever the
  // service column actually granted.
  // The reception is sized for the queue it holds. A fixed 28 x 24 floor is a
  // large room to give one waiting agent, and on a real machine the queue is
  // usually one or two — so the room grew with the floor and never with its
  // purpose, and read as the biggest thing on a plan whose subject is the
  // working rooms. It still never shrinks below a room somebody could stand a
  // desk and a sofa in.
  const want = Math.max(0, waitingCount);
  const wantW = clamp(OFFICE_MIN_W + want * OFFICE_GROWTH_W, OFFICE_MIN_W, OFFICE_MAX_W);
  const wantH = clamp(OFFICE_MIN_H + want * OFFICE_GROWTH_H, OFFICE_MIN_H, OFFICE_MAX_H);
  const IN_W = clamp(
    Math.max(wantW, fit ? Math.min(fit.w, OFFICE_MAX_W) : 0),
    OFFICE_MIN_W,
    OFFICE_MAX_W,
  );
  // Never wider than a room: the reception is the one room the user looks at
  // first, and a 2:1 reception reads as a corridor with a desk at one end.
  // `fit.h` is a ROOM height and a room carries a plate band at the top, so
  // the interior is what is left under it. Taking `fit.h` as the interior
  // added a band on every pass and the reception grew a little taller each
  // time the plan was rebuilt.
  const IN_H = Math.max(wantH, IN_W / ROOM_ASPECT_MAX, fit ? fit.h - PLATE_BAND : 0);
  const SOFA_D = 2.6;
  const PAD = 0.4;

  // --- the desk, at the head of the room
  const deskW = clamp(IN_W * 0.4, 8, 14);
  const deskX = (IN_W - deskW) / 2;
  const deskY = 3.6;
  zones.push({ id: 'office-desk', x: deskX, y: deskY, w: deskW, h: 3 });
  props.push({
    kind: 'user_desk',
    id: 'user-desk',
    w: deskW,
    h: 3,
    angle: 0,
    x: deskX,
    y: deskY,
    anchor: { type: 'centered', of: 'office-desk' },
  });
  // The manager sits BEHIND the desk, between it and the north wall, looking
  // down the room at whoever is in the guest chair.
  props.push({
    kind: 'manager',
    id: 'manager',
    w: 2.6,
    h: 2.6,
    angle: Math.PI / 2,
    x: deskX + deskW / 2 - 1.3,
    y: deskY - 0.3 - 2.6,
    anchor: { type: 'attached', to: 'office-desk', edge: 'N', along: deskW / 2 - 1.3, gap: 0.3 },
  });
  props.push({
    kind: 'plant_large',
    w: 2.6,
    h: 2.6,
    angle: 0,
    x: deskX + deskW + 1.2,
    y: deskY + 0.2,
    anchor: { type: 'attached', to: 'office-desk', edge: 'E', along: 0.2, gap: 1.2 },
  });
  // Art on the EAST wall, beside the desk rather than above it. The strip
  // across the top of every room belongs to its plate (`PLATE_BAND`), and a
  // picture hung there would be read through the room's own name.
  const artH = Math.min(6, deskW * 0.55);
  props.push({
    kind: 'art',
    w: 0.4,
    h: artH,
    angle: 0,
    x: IN_W - 0.55,
    y: deskY,
    anchor: { type: 'wall', side: 'E', along: deskY, inset: 0.15 },
  });

  // --- the guest chair: one seat, facing the desk across it
  const guestX = deskX + deskW / 2 - CHAIR / 2;
  const guestY = deskY + 3 + 1.4;
  zones.push({ id: 'office-guest', x: guestX, y: guestY, w: CHAIR, h: CHAIR });
  props.push({
    kind: 'waiting_chair',
    id: 'guest-chair',
    w: CHAIR,
    h: CHAIR,
    angle: -Math.PI / 2,
    x: guestX,
    y: guestY,
    anchor: { type: 'centered', of: 'office-guest' },
  });

  // --- seating around the walls, sized to the room it is actually in
  //
  // The room's HEIGHT is settled here, before anything is anchored to it,
  // because the reception has to hold its whole queue. A first pass says how
  // many the wall seating takes; whatever is left needs loose chairs, and the
  // room grows to hold those rather than laying them out past its own south
  // wall. Growing only ever increases the wall seating, so one pass converges.
  const bandTop = guestY + CHAIR + 2.4;
  const backW = Math.max(4, IN_W - (PAD + SOFA_D) * 2);
  const chairCols = Math.max(1, Math.floor((IN_W - 2 * (PAD + SOFA_D) - 2) / OFFICE_CHAIR_PITCH));
  const seatsFor = (height) => {
    const run = Math.max(SOFA_MIN_RUN, height - bandTop - SOFA_D - PAD * 2);
    return (
      1 +
      Math.max(2, Math.floor(run / OFFICE_SEAT_PITCH)) * 2 +
      Math.max(2, Math.floor(backW / OFFICE_SEAT_PITCH))
    );
  };
  const chairRowsFor = (height) =>
    Math.ceil(Math.max(0, waitingCount - seatsFor(height)) / chairCols);
  // The room is at least as tall as its own contents: the desk band, a sofa
  // run somebody can actually sit on, the back run and the wall pad. Clamping
  // the RUN instead (the old rule) let a short room overlap its own back sofa.
  const IN_H_FINAL = Math.max(
    IN_H,
    bandTop + SOFA_MIN_RUN + SOFA_D + PAD * 2,
    bandTop + chairRowsFor(IN_H) * OFFICE_CHAIR_ROW + 2.8 + SOFA_D + PAD * 2,
  );
  // The three runs form a continuous C: the side runs come down to meet the
  // back run, and the back run spans exactly between them. Leaving each run to
  // its own arithmetic left the corners two units short at both ends, so the
  // seating read as three separate benches rather than as one reception.
  const sofaRunH = IN_H_FINAL - PAD - SOFA_D - bandTop;

  props.push({
    kind: 'sofa',
    id: 'wait-sofa-w',
    w: SOFA_D,
    h: sofaRunH,
    // Back to the west wall, seat facing east into the room.
    angle: 0,
    x: PAD,
    y: bandTop,
    anchor: { type: 'wall', side: 'W', along: bandTop, inset: PAD },
  });
  props.push({
    kind: 'sofa',
    id: 'wait-sofa-e',
    w: SOFA_D,
    h: sofaRunH,
    angle: Math.PI,
    x: IN_W - PAD - SOFA_D,
    y: bandTop,
    anchor: { type: 'wall', side: 'E', along: bandTop, inset: PAD },
  });
  props.push({
    kind: 'sofa',
    id: 'wait-sofa-s',
    w: backW,
    h: SOFA_D,
    angle: -Math.PI / 2,
    x: PAD + SOFA_D,
    y: IN_H_FINAL - PAD - SOFA_D,
    anchor: { type: 'wall', side: 'S', along: PAD + SOFA_D, inset: PAD },
  });

  // The middle of the room: the floor the three sofa runs enclose. A rug
  // covers it and a low table is centred on it, both `centered` on that zone,
  // so neither can drift away from the seating however wide the room becomes.
  const wellX = PAD + SOFA_D;
  const wellY = bandTop;
  const wellW = Math.max(4, IN_W - 2 * (PAD + SOFA_D));
  const wellH = Math.max(4, IN_H_FINAL - PAD - SOFA_D - wellY);
  zones.push({ id: 'office-well', x: wellX, y: wellY, w: wellW, h: wellH });
  // A rug defines the seating group; it is not floor covering. Held to a
  // sensible proportion so a wide reception gets a rug rather than a stripe,
  // and inset enough that the boards read all the way round it.
  // Wide enough to reach the seating it belongs to. Capping the rug's aspect
  // at 2.4:1 left a shallow reception with a rug stranded nine units clear of
  // the sofas on either side of it — the floating-prop defect, in the one room
  // the user looks at first.
  const rugH = Math.max(3, wellH - 2.4);
  const rugW = Math.max(4, wellW - 2.4);
  props.push({
    kind: 'rug',
    w: rugW,
    h: rugH,
    angle: 0,
    x: wellX + (wellW - rugW) / 2,
    y: wellY + 1.2,
    anchor: { type: 'centered', of: 'office-well' },
  });
  props.push({
    kind: 'magazine_table',
    w: clamp(wellW * 0.4, 3, 7),
    h: 3,
    angle: 0,
    x: wellX,
    y: wellY,
    anchor: { type: 'centered', of: 'office-well' },
  });
  // The small pieces bracket the head of the seating band. Each is attached
  // to the sofa run it stands beside, so it travels with it.
  props.push({
    kind: 'side_table',
    id: 'office-side-table',
    w: 1.8,
    h: 1.8,
    angle: 0,
    x: PAD + 0.4,
    y: bandTop - 2.2,
    anchor: { type: 'attached', to: 'wait-sofa-w', edge: 'N', along: 0.4, gap: 0.4 },
  });
  props.push({
    kind: 'lamp',
    w: 1.6,
    h: 1.6,
    angle: 0,
    x: IN_W - PAD - 2,
    y: bandTop - 2.2,
    anchor: { type: 'attached', to: 'wait-sofa-e', edge: 'N', along: 0.5, gap: 0.4 },
  });
  props.push({
    kind: 'water_cooler',
    w: 1.4,
    h: 1.4,
    angle: 0,
    x: PAD + 0.7,
    y: bandTop - 4.4,
    anchor: { type: 'attached', to: 'office-side-table', edge: 'N', along: 0.2, gap: 0.4 },
  });
  // Planting in the two corners the seating leaves open, so the head of the
  // room is furnished rather than bare either side of the desk.
  props.push({
    kind: 'plant',
    w: 2,
    h: 2,
    angle: 0,
    x: PAD + 0.6,
    y: PAD + 0.6,
    anchor: { type: 'corner', corner: 'NW', inset: PAD + 0.6 },
  });
  props.push({
    kind: 'plant',
    w: 2,
    h: 2,
    angle: 0,
    x: IN_W - PAD - 2.6,
    y: PAD + 0.6,
    anchor: { type: 'corner', corner: 'NE', inset: PAD + 0.6 },
  });

  // --- how many people the room can seat, and the loose chairs for the rest
  //
  // Only the COUNT is decided here. Where each agent actually sits is worked
  // out later, in `seatOffice`, from the furniture's resolved positions.
  const deskCentre = { x: deskX + deskW / 2, y: deskY + 1.5 };
  const perSide = Math.max(2, Math.floor(sofaRunH / OFFICE_SEAT_PITCH));
  const backCount = Math.max(2, Math.floor(backW / OFFICE_SEAT_PITCH));
  const seatedCapacity = 1 + perSide * 2 + backCount;

  // Overflow chairs, in rows across the well and facing the desk. They are
  // laid out INSIDE the well, so a loose chair can never land on a sofa.
  let overflow = Math.max(0, waitingCount - seatedCapacity);
  const chairRows = Math.max(1, Math.ceil(overflow / chairCols));
  const chairX0 = wellX + Math.max(1, (wellW - chairCols * OFFICE_CHAIR_PITCH) / 2) + 1.6;
  const chairY0 = wellY + Math.max(1.4, (wellH - chairRows * OFFICE_CHAIR_ROW) / 2) + 1.4;
  for (let r = 0; overflow > 0; r++) {
    for (let c = 0; c < chairCols && overflow > 0; c++) {
      const cx = chairX0 + c * OFFICE_CHAIR_PITCH;
      const cy = chairY0 + r * OFFICE_CHAIR_ROW;
      const id = `office-chair-${r}-${c}`;
      zones.push({ id, x: cx - CHAIR / 2, y: cy - CHAIR / 2, w: CHAIR, h: CHAIR });
      props.push({
        kind: 'waiting_chair',
        id,
        w: CHAIR,
        h: CHAIR,
        angle: angleTo({ x: cx, y: cy }, deskCentre),
        x: cx - CHAIR / 2,
        y: cy - CHAIR / 2,
        anchor: { type: 'centered', of: id },
      });
      overflow--;
    }
  }

  zones.push({ id: 'office-room', x: 0, y: 0, w: IN_W, h: IN_H_FINAL });

  /** @type {Room} */
  const room = {
    kind: 'office',
    id: '__office__',
    name: 'Your Office',
    x: 0,
    y: 0,
    w: IN_W,
    h: IN_H_FINAL + PLATE_BAND,
    plateBand: PLATE_BAND,
    natural: { w: IN_W, h: IN_H_FINAL + PLATE_BAND },
    walls: 'full',
    floor: 'wood',
    plateLines: ['Your Office', `${waitingCount} waiting`],
    props,
    zones,
  };
  // Seats are derived from the resolved furniture, later, by `seatOffice`.
  return { room, officeSeats: [] };
}

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
 */
export function buildLounge(benchedCount, fit, goneHomeCount = 0) {
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
  blocks.push({
    id: 'living',
    w: 15,
    h: 11,
    place(x, y) {
      const z = { id: 'living-zone', x, y, w: 15, h: 11 };
      zones.push(z);
      at(z, 'rug_round', 1.5, 1.5, 12, 8);
      at(z, 'tv', 4.5, 0, 6, 0.6);
      at(z, 'sofa', 3.5, 7.6, 8, 2.4, -Math.PI / 2, 'lounge-sofa-main');
      at(z, 'sofa', 0.4, 3.2, 2.4, 5, 0, 'lounge-sofa-side');
      at(z, 'coffee_table', 5.5, 4.2, 4.5, 2.2);
      at(z, 'side_table', 12.4, 3.4, 1.8, 1.8);
      at(z, 'lamp', 12.6, 6, 1.6, 1.6);
      at(z, 'plant_large', 12.4, 8.4, 2.4, 2.4);
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
      at(z, 'fridge', 10, 2.6, 2.2, 2.2);
      // A fruit bowl and a mug on the counter: the small domestic cues that
      // make this read as a kitchen at a glance rather than as more office
      // furniture with a different outline.
      at(z, 'fruit_bowl', 5.2, 0.9, 1.6, 1.6);
      at(z, 'bar_counter', 1, 5, 11, 1.6, 0, 'bar-counter');
      for (let i = 0; i < 4; i++) at(z, 'bar_stool', 2 + i * 2.8, 7, 1.6, 1.6);
      at(z, 'fruit_bowl', 8.4, 5.2, 1.4, 1.4);
      at(z, 'plant_large', 11.2, 6.4, 2.2, 2.2);
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
          x: x + 2.8 + i * 2.8,
          y: y + 7.8,
          angle: -Math.PI / 2,
          capacity: 1,
        });
      }
    },
  });

  // ---- a quiet corner, always present: books and a plant
  blocks.push({
    id: 'quiet',
    w: 9,
    h: 6,
    place(x, y) {
      const z = { id: 'quiet-zone', x, y, w: 9, h: 6 };
      zones.push(z);
      at(z, 'bookshelf', 0.5, 0.3, 8, 1.3);
      at(z, 'sofa', 1, 3.4, 6, 2.2, Math.PI / 2);
      at(z, 'side_table', 7.4, 3.6, 1.8, 1.8);
      at(z, 'plant_large', 7.2, 0.4, 2.2, 2.2);
      spots.push({
        id: 'lounge-quiet',
        kind: 'lounge_idle',
        x: x + 4,
        y: y + 4.5,
        angle: -Math.PI / 2,
        capacity: 2,
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
    game('dining', 'dining_table', 7.2, 6.2, (z, t) => {
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
    game('pool', 'pool_table', 11.2, 7.2, (z, t) => {
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
    game('tt', 'table_tennis', 10.2, 6.2, (z, t) => {
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
    game('arcade', 'arcade_cabinet', 4.2, 5.2, (z, t) => {
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

  // Flow the blocks to the shape of the room this lounge has been given, so
  // it fills its column rather than leaving a band of bare floor beside it.
  const budgetW = fit && fit.w > 0 ? fit.w - MARGIN * 2 : Infinity;
  // The lounge's blocks are all different sizes, so it shelf-packs rather than
  // flowing into a fixed column count (see `shelfPack`).
  const budget = Number.isFinite(budgetW)
    ? budgetW
    : Math.max(...blocks.map((b) => b.w)) * Math.max(1, Math.round(Math.sqrt(blocks.length)));
  const flow = shelfPack(blocks, LOUNGE_GAP, budget);
  blocks.forEach((b, i) => b.place(flow.out[i].x, flow.out[i].y));

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
    const bandW = Math.min(furniture.w, budgetW);
    const perRow = Math.max(2, 2 * Math.floor(bandW / (MINGLE_PITCH * 2)));
    const rows = Math.ceil(missing / perRow);
    const bandY = furniture.y + furniture.h + LOUNGE_GAP;
    zones.push({
      id: 'lounge-mingle',
      x: furniture.x,
      y: bandY - 1.2,
      w: furniture.w,
      h: rows * MINGLE_ROW + 2.4,
    });
    let made = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c + 1 < perRow && made < missing; c += 2) {
        const bx = furniture.x + 1.2 + c * MINGLE_PITCH;
        const by = bandY + r * MINGLE_ROW;
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
  const kitchen = zones.find((z) => z.id === 'kitchen-zone');

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
        ? `${benchedCount} benched · ${goneHomeCount} went home`
        : `${benchedCount} benched`,
    ],
    props,
    zones,
    kitchenZone: kitchen ? { x: kitchen.x, y: kitchen.y, w: kitchen.w, h: kitchen.h } : undefined,
  };
  return { room, loungeSpots: spots };
}

/**
 * Seat the waiting agents on the reception furniture, after that furniture has
 * been placed for real.
 *
 * This runs late on purpose. The sofas are anchored to the room's walls, so
 * their final coordinates are not known until the room has been sized, tiled
 * and had its anchors resolved. An earlier version computed seats from the
 * pre-anchor layout, and agents appeared to sit on the floor beside the
 * furniture rather than on it — the two frames simply were not the same.
 *
 * Order matters: the guest chair at the desk is the front of the queue, then
 * the west run, the south run, the east run, and finally any loose chairs.
 *
 * @param {Room} room the office, with anchors already resolved
 * @param {number} waitingCount
 * @returns {Seat[]}
 */
export function seatOffice(room, waitingCount) {
  /** @type {Seat[]} */
  const seats = [];
  if (waitingCount <= 0) return seats;

  const byId = new Map();
  for (const p of room.props) if (p.id) byId.set(p.id, p);
  const desk = byId.get('user-desk');
  const deskCentre = desk
    ? { x: desk.x + desk.w / 2, y: desk.y + desk.h / 2 }
    : { x: room.x + room.w / 2, y: room.y };

  const place = (x, y) => {
    if (seats.length >= waitingCount) return;
    seats.push({ x, y, angle: angleTo({ x, y }, deskCentre) });
  };

  const guest = byId.get('guest-chair');
  if (guest) place(guest.x + guest.w / 2, guest.y + guest.h / 2);

  // Along each sofa run, spaced by seat pitch. A run's rectangle says which
  // way it lies, exactly as it does for the painter.
  const SEAT_ALONG = OFFICE_SEAT_PITCH;
  for (const id of ['wait-sofa-w', 'wait-sofa-s', 'wait-sofa-e']) {
    const sofa = byId.get(id);
    if (!sofa) continue;
    const vertical = sofa.h > sofa.w;
    const runLen = vertical ? sofa.h : sofa.w;
    const n = Math.max(1, Math.floor(runLen / SEAT_ALONG));
    // Sit on the SEAT, not on the back. The back occupies the far third of the
    // sofa's depth from the direction it faces (`backdrop.js`'s sofa case), so
    // the occupant is nudged that far toward the front of it.
    const depth = vertical ? sofa.w : sofa.h;
    const forward = depth * SOFA_SEAT_BIAS;
    const bias = {
      x: vertical ? Math.cos(sofa.angle || 0) * forward : 0,
      y: vertical ? 0 : Math.sin(sofa.angle || 0) * forward,
    };
    for (let i = 0; i < n; i++) {
      const along = ((i + 0.5) * runLen) / n;
      if (vertical) place(sofa.x + sofa.w / 2 + bias.x, sofa.y + along);
      else place(sofa.x + along, sofa.y + sofa.h / 2 + bias.y);
    }
  }

  // Loose chairs last, in the order they were laid out.
  for (const p of room.props) {
    if (p.kind !== 'waiting_chair' || p.id === 'guest-chair') continue;
    place(p.x + p.w / 2, p.y + p.h / 2);
  }
  return seats;
}
