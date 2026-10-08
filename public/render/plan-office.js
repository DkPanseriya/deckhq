/**
 * The user's office: the room the product is about.
 *
 * Split out of `plan-service.js` by WP-59d, which is the package that made the
 * split true. That module's own header said the office and the lounge "are one
 * module because they are one column of the building — sized together, stacked
 * together". In arrangement B they are not: the reception is the left end of
 * the top row and the lounge the left end of the bottom one, laid at different
 * widths, at different depths, and on different axes. Two rooms that are no
 * longer one column are no longer one module — and with the row reception in
 * it, the file was over `model.test.mjs`'s 900-line ceiling besides.
 *
 * `seatOffice` comes with it rather than staying with the packing, for the
 * reason it was always beside `buildOffice`: it reads the office's own
 * resolved furniture, so it must run after `resolveAnchors` or the waiting
 * agents sit beside the sofas instead of on them.
 */

import {
  CHAIR,
  FIXTURE_TOP,
  OFFICE_GROWTH_H,
  OFFICE_GROWTH_W,
  OFFICE_MAX_H,
  OFFICE_MAX_W,
  OFFICE_MIN_H,
  OFFICE_MIN_W,
  OFFICE_QUEUE_PITCH,
  OFFICE_QUEUE_ROW,
  OFFICE_ROW_ASPECT_MAX,
  OFFICE_ROW_MAX_DEPTH,
  OFFICE_SEAT_PITCH,
  OFFICE_VISITOR_CHAIRS,
  PLATE_BAND,
  ROOM_ASPECT_MAX,
  SOFA_DEPTH,
  SOFA_MIN_RUN,
  angleTo,
  clamp,
} from './plan-units.js';
import {
  DESK_TRAY_H,
  DESK_TRAY_W,
  MONITOR_H,
  MONITOR_W,
  OFFICE_RUG_INSET,
  OFFICE_RUG_LEAD,
  SEAT_TUB,
  WATER_COOLER,
} from './plan-furniture.js';
import {
  BOOKCASE_MAX_H,
  BOOKCASE_MIN_RUN,
  BOOKCASE_W,
  PLANT_FOOTPRINTS,
  PLANT_TREE,
  plantRun,
} from './plan-props.js';
import {
  OFFICE_QUEUE_ZONE,
  OFFICE_VISITOR_ZONE,
  SOFA_ARM,
  queueAlong,
  sofaCushionCount,
} from './plan-office-seats.js';

/**
 * A QUIET RECEPTION (`opts.compact`): with this many waiting or fewer it is the
 * desk, the visitor chair and ONE sofa run of at least this many cushions, down
 * the wall the queue would form on. The second and third runs are laid when
 * somebody needs them. Three runs round an empty rug were the largest room on
 * a floor of two desks.
 */
export const OFFICE_COMPACT_MAX = 4;
/**
 * ON A QUIET FLOOR THE RUNS COME BACK ONE AT A TIME (`opts.graded`): up to this
 * many waiting it is two — the one down the wall and one across the foot of
 * the room — and all three past it. Without it the second and the third arrive
 * together, as they did.
 */
export const OFFICE_TWO_RUNS_MAX = 9;
/**
 * How many sofa runs a reception is laid with.
 * @param {number} waiting @param {{hold?:boolean, compact?:boolean, graded?:boolean}} [opts]
 * @returns {1|2|3}
 */
export function officeRunsFor(waiting, opts = {}) {
  if (opts.compact !== true || opts.hold) return 3;
  if (waiting <= OFFICE_COMPACT_MAX) return 1;
  return opts.graded === true && waiting <= OFFICE_TWO_RUNS_MAX ? 2 : 3;
}
/** How wide the quiet reception is, less its plate: a desk, the rug and one run. */
export const OFFICE_COMPACT_W = 16;

export {
  OFFICE_QUEUE_ZONE,
  OFFICE_VISITOR_ZONE,
  officeChairSeat,
  seatOffice,
} from './plan-office-seats.js';

/** @typedef {import('./plan-units.js').Prop} Prop */
/** @typedef {import('./plan-units.js').Zone} Zone */
/** @typedef {import('./plan-units.js').Room} Room */
/** @typedef {import('./plan-units.js').Seat} Seat */

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
 *      There is exactly one visitor chair at the desk, and it is empty unless
 *      the user has a waiting session OPEN — that session walks to it and sits
 *      facing him (WP-93). Everybody else waits on the sofas, and whoever the
 *      sofas cannot take stands beside them.
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
 * @param {{maxW?:number, landscape?:boolean, hold?:boolean, compact?:boolean, graded?:boolean}} [opts] `maxW` overrides
 *   `OFFICE_MAX_W` — in a row that cap is read on the other axis and is the
 *   room's DEPTH (WP-59d). `landscape` says this room is about to be reflected
 *   in the diagonal by `buildOfficeRow`, which is the only thing the QUEUE
 *   needs to know: a queue must spread along whichever axis ends up horizontal
 *   on screen, because that is the axis a name label and a waiting badge have
 *   room on (WP-78). `hold` lays the room AT the size it is given rather
 *   than at the size its queue would like: it is at its share of the building
 *   (`plan-proportions.js` (f)), so its sofa runs are as long as that room's
 *   walls, and everybody they cannot seat stands in the queue beside them.
 */
export function buildOffice(waitingCount, fit, opts = {}) {
  const maxW = Math.max(OFFICE_MIN_W, Number(opts.maxW) || OFFICE_MAX_W);
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
  // One run, two or three; `compact` is the room with no west run, at one or two.
  const runs = officeRunsFor(want, opts);
  const compact = runs < 3;
  const grows = opts.hold || compact ? 0 : want;
  const minW = compact ? OFFICE_COMPACT_W : OFFICE_MIN_W;
  const wantW = clamp(minW + grows * OFFICE_GROWTH_W, minW, maxW);
  const wantH = clamp(OFFICE_MIN_H + grows * OFFICE_GROWTH_H, OFFICE_MIN_H, OFFICE_MAX_H);
  const IN_W = clamp(Math.max(wantW, fit ? Math.min(fit.w, maxW) : 0), minW, maxW);
  // Never wider than a room: the reception is the one room the user looks at
  // first, and a 2:1 reception reads as a corridor with a desk at one end.
  // `fit.h` is a ROOM height and a room carries a plate band at the top, so
  // the interior is what is left under it. Taking `fit.h` as the interior
  // added a band on every pass and the reception grew a little taller each
  // time the plan was rebuilt.
  const IN_H = Math.max(wantH, IN_W / ROOM_ASPECT_MAX, fit ? fit.h - PLATE_BAND : 0);
  // §2: a sofa is as deep as the person on it. `plan-scale.js` owns the number.
  const SOFA_D = SOFA_DEPTH;
  const PAD = 0.4;

  // --- the desk, at the head of the room
  const deskW = clamp(IN_W * 0.4, 8, 14);
  // (Off-centre in a quiet reception, so that the tree beside it has its floor.)
  const deskX = compact ? PAD + 1.6 : (IN_W - deskW) / 2;
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
  // WHAT IS ON IT (§3.4: `user desk 8-14 x 3 with a monitor and a tray`).
  //
  // Every other desk in the building carries a monitor and this one carried
  // nothing, which is what made the room's one piece of furniture read as a
  // counter rather than as somebody's desk. Two objects at two sizes, on the
  // desk's own zone so they travel with it at whatever width the room gives it.
  const monitorDx = deskW * 0.3;
  props.push({
    kind: 'monitor',
    w: MONITOR_W,
    h: MONITOR_H,
    angle: 0,
    x: deskX + monitorDx,
    y: deskY + 0.5,
    anchor: { type: 'zone', of: 'office-desk', dx: monitorDx, dy: 0.5 },
  });
  const trayDx = deskW - DESK_TRAY_W - 0.7;
  const trayDy = (3 - DESK_TRAY_H) / 2;
  props.push({
    kind: 'desk_tray',
    w: DESK_TRAY_W,
    h: DESK_TRAY_H,
    angle: 0,
    x: deskX + trayDx,
    y: deskY + trayDy,
    anchor: { type: 'zone', of: 'office-desk', dx: trayDx, dy: trayDy },
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
  // The one TREE on this floor (§3.6), at the head of the room where the
  // manager's light pool already is. `plant_tree` is a single canopy rather
  // than the five-blob rosette every plant used to be: the reception is the
  // room the user looks at first and the head of it is where a statement piece
  // belongs, so the kind that is a statement stands there and nowhere else.
  props.push({
    kind: 'plant_tree',
    w: PLANT_TREE,
    h: PLANT_TREE,
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

  // --- THE ONE VISITOR CHAIR, square across the desk (WP-93)
  //
  // WP-78 made this a ROW of two or three and filled it with the waiting queue.
  // The owner, 15 September: _"They all should sit on the sofa. Only the agent I
  // open walks up to the manager desk."_ So it is one chair again — the chair of
  // whoever is being seen — and it is EMPTY unless the user has a waiting
  // session open. The other two are gone rather than turned to face the sofas:
  // a chair at the manager's desk is read as somewhere a session might be
  // sitting, and two spare ones beside the occupied chair would say the audience
  // seats three. The seating for waiting is the sofa run, which is the whole
  // point of the change; the reception now has one and only one answer to
  // "who is being seen".
  //
  // WP-85b: IT IS A TUB CHAIR, AT 2.4 U (§3.4), standing ON the wool rug rather
  // than in front of it — the rug still starts `OFFICE_RUG_LEAD` above it and
  // runs down to the back sofa, so the waiting area is one place and the chair
  // is its head.
  const deskCentre = { x: deskX + deskW / 2, y: deskY + 1.5 };
  const visitorY = deskY + 3 + 1.4;
  for (let i = 0; i < OFFICE_VISITOR_CHAIRS; i++) {
    const cx = deskX + deskW / 2;
    const cy = visitorY + SEAT_TUB / 2;
    const id = OFFICE_VISITOR_ZONE + i;
    zones.push({ id, x: cx - SEAT_TUB / 2, y: cy - SEAT_TUB / 2, w: SEAT_TUB, h: SEAT_TUB });
    props.push({
      kind: 'tub_chair',
      id,
      w: SEAT_TUB,
      h: SEAT_TUB,
      angle: angleTo({ x: cx, y: cy }, deskCentre),
      x: cx - SEAT_TUB / 2,
      y: cy - SEAT_TUB / 2,
      anchor: { type: 'centered', of: id },
    });
  }

  // --- seating around the walls, sized to the room it is actually in
  //
  // The room's HEIGHT is settled here, before anything is anchored to it: the
  // runs are as long as the room is deep, and how many they seat is read off
  // them once it is.
  const bandTop = visitorY + SEAT_TUB + 2.4;
  // (With no west run, the back one starts at the west wall.)
  const backW = Math.max(4, IN_W - (compact ? PAD * 2 + SOFA_D : (PAD + SOFA_D) * 2));
  const backCushions = runs === 1 ? 0 : sofaCushionCount(backW, SOFA_D);
  // The room is at least as tall as its own contents: the desk band, a sofa
  // run somebody can actually sit on, the back run and the wall pad — and a
  // well between the runs a chair deep with clear floor either side of it.
  // Clamping the RUN instead (the old rule) let a short room overlap its own
  // back sofa.
  const WELL_PAD = 1.6;
  // (A quiet reception has no back run: its one run is the east one, and the
  // room is as deep as that run's cushions.)
  // (And with a second run across its foot, the room is that run deeper and
  // the first is as long as whoever the second does not seat.)
  const compactRun = Math.max(OFFICE_COMPACT_MAX, want - backCushions) * SOFA_D + SOFA_ARM * 2;
  const IN_H_FINAL = compact
    ? Math.max(IN_H, bandTop + compactRun + PAD + (runs === 2 ? SOFA_D : 0))
    : Math.max(
        IN_H,
        bandTop + SOFA_MIN_RUN + SOFA_D + PAD * 2,
        bandTop + WELL_PAD * 2 + CHAIR + SOFA_D + PAD * 2,
      );
  // The three runs form a continuous C: the side runs come down to meet the
  // back run, and the back run spans exactly between them. Leaving each run to
  // its own arithmetic left the corners two units short at both ends, so the
  // seating read as three separate benches rather than as one reception.
  // (The one run is as long as the people waiting, however long its room is.)
  const sofaRunH = runs === 1 ? compactRun : IN_H_FINAL - PAD - SOFA_D - bandTop;
  // HOW MANY THE SOFAS SEAT: one a cushion (WP-93, and the owner again on the
  // reception of sixteen). Each run carries its count, the painter draws that
  // many cushions, and whoever is left over stands in the file by the wall.
  const sideCushions = sofaCushionCount(sofaRunH, SOFA_D);
  const queued = Math.max(0, waitingCount - sideCushions * (compact ? 1 : 2) - backCushions);

  if (!compact) {
    props.push({
      kind: 'sofa',
      id: 'wait-sofa-w',
      w: SOFA_D,
      h: sofaRunH,
      cushions: sideCushions,
      // Back to the west wall, seat facing east into the room.
      angle: 0,
      x: PAD,
      y: bandTop,
      anchor: { type: 'wall', side: 'W', along: bandTop, inset: PAD },
    });
  }
  props.push({
    kind: 'sofa',
    id: 'wait-sofa-e',
    w: SOFA_D,
    h: sofaRunH,
    cushions: sideCushions,
    angle: Math.PI,
    x: IN_W - PAD - SOFA_D,
    y: bandTop,
    anchor: { type: 'wall', side: 'E', along: bandTop, inset: PAD },
  });
  if (runs > 1) {
    const backX = compact ? PAD : PAD + SOFA_D;
    props.push({
      kind: 'sofa',
      id: 'wait-sofa-s',
      w: backW,
      h: SOFA_D,
      cushions: backCushions,
      angle: -Math.PI / 2,
      x: backX,
      y: IN_H_FINAL - PAD - SOFA_D,
      anchor: { type: 'wall', side: 'S', along: backX, inset: PAD },
    });
  }

  // The middle of the room: the floor the three sofa runs enclose. A rug
  // covers it and a low table is centred on it, both `centered` on that zone,
  // so neither can drift away from the seating however wide the room becomes.
  // (In a quiet reception it is the floor beside the one run, wall to wall.)
  const wellX = compact ? PAD : PAD + SOFA_D;
  const wellY = bandTop;
  const wellW = Math.max(4, IN_W - (compact ? PAD * 2 + SOFA_D : 2 * (PAD + SOFA_D)));
  const wellH = Math.max(4, compact ? sofaRunH : IN_H_FINAL - PAD - SOFA_D - wellY);
  zones.push({ id: 'office-well', x: wellX, y: wellY, w: wellW, h: wellH });

  // THE WAITING AREA, AND THE WOOL RUG THAT IS THE WHOLE OF IT (§3.4, §3.7).
  //
  // The rug used to sit inside the well — under the low table, clear of the
  // chairs at the desk — which made the waiting area a thing in the middle of
  // the floor and the chairs a row in front of a desk somewhere else. §3.7 asks
  // for one place: *"the waiting room (rug, three tub chairs facing the desk
  // across it, sofa runs on three walls, a low table with something on it)"*.
  //
  // So the rug is anchored to a zone that STARTS ABOVE THE CHAIRS and runs down
  // to the back sofa, the chairs stand on it, and the queue forms down it. It is
  // the waiting area less `OFFICE_RUG_INSET` a side, so the boards read all the
  // way round it and every sofa run still touches the rug it encloses — §57's
  // invariant, which `floor-integrity.test.mjs` asserts, and the reason §3.4's
  // `≤12 deep` is not adopted (see `plan-furniture.js`).
  const waitTop = visitorY - OFFICE_RUG_LEAD;
  const waitH = Math.max(4, wellY + wellH - waitTop);
  zones.push({ id: 'office-waiting', x: wellX, y: waitTop, w: wellW, h: waitH });
  const rugW = Math.max(4, wellW - OFFICE_RUG_INSET * 2);
  const rugH = Math.max(4, waitH - OFFICE_RUG_INSET);
  const rugDx = (wellW - rugW) / 2;
  // UNSHIFTED, so the rug is painted before everything that stands on it. The
  // props array is the paint order, and a rug that now reaches up under the
  // chairs would otherwise be drawn over them.
  props.unshift({
    kind: 'rug',
    // The slate wool, not the task sage (§3.1, owner decision 2).
    tone: 'wool',
    w: rugW,
    h: rugH,
    angle: 0,
    x: wellX + rugDx,
    y: waitTop,
    anchor: { type: 'zone', of: 'office-waiting', dx: rugDx, dy: 0 },
  });
  // THE LOW TABLE GOES IN FRONT OF THE BACK SOFA, not in the middle of the room.
  //
  // §3.7: *"The middle stays clear, because the middle is where the queue
  // forms."* Centred on the well — where it was — it stood exactly on the
  // queue's second rank, and a coffee table is a thing you put in front of a
  // sofa anyway. Attached to the run it belongs to, so it travels with it at
  // whatever depth the room turns out to have.
  const lowW = clamp(wellW * 0.4, 3, 7);
  props.push(
    runs === 1
      ? {
          // In front of the one run there is, lying along it.
          kind: 'magazine_table',
          w: 3,
          h: lowW,
          angle: 0,
          x: IN_W - PAD - SOFA_D - 1.2 - 3,
          y: bandTop + (sofaRunH - lowW) / 2,
          anchor: {
            type: 'attached',
            to: 'wait-sofa-e',
            edge: 'W',
            along: (sofaRunH - lowW) / 2,
            gap: 1.2,
          },
        }
      : {
          kind: 'magazine_table',
          w: lowW,
          h: 3,
          angle: 0,
          x: wellX + (wellW - lowW) / 2,
          y: IN_H_FINAL - PAD - SOFA_D - 3 - 1.2,
          anchor: {
            type: 'attached',
            to: 'wait-sofa-s',
            edge: 'N',
            along: (backW - lowW) / 2,
            gap: 1.2,
          },
        },
  );
  // The small pieces bracket the head of the seating band. Each is attached
  // to the sofa run it stands beside, so it travels with it. (With no west
  // run to stand beside, the side table is against the west wall itself.)
  props.push({
    kind: 'side_table',
    id: 'office-side-table',
    w: 1.8,
    h: 1.8,
    angle: 0,
    x: PAD + 0.4,
    y: bandTop - 2.2,
    anchor: compact
      ? { type: 'wall', side: 'W', along: bandTop - 2.2, inset: PAD + 0.4 }
      : { type: 'attached', to: 'wait-sofa-w', edge: 'N', along: 0.4, gap: 0.4 },
  });
  // INBOARD OF THE EAST RUN, not on the wall above it. The lamp used to stand
  // at the head of that sofa against the east wall, which is the run the
  // bookcase below now takes — and a standard lamp belongs at the end of a sofa
  // rather than in front of a bookcase anyway.
  props.push({
    kind: 'lamp',
    w: 1.6,
    h: 1.6,
    angle: 0,
    x: IN_W - PAD - SOFA_D - 2.0,
    y: bandTop - 2.2,
    anchor: { type: 'attached', to: 'wait-sofa-e', edge: 'W', along: -2.2, gap: 0.4 },
  });
  props.push({
    kind: 'water_cooler',
    w: WATER_COOLER,
    h: WATER_COOLER,
    angle: 0,
    x: PAD + 0.7,
    y: bandTop - 4.4,
    anchor: { type: 'attached', to: 'office-side-table', edge: 'N', along: 0.2, gap: 0.4 },
  });
  // THE BOOKCASES (§3.4: *"bookcase 1.2 × 8 on each long wall"*).
  //
  // A reception's long walls are the two the seating runs down, and from
  // `bandTop` to the floor they are sofa. What is left is the HEAD BAND — the
  // wall beside the desk — and that is where a bookcase in a reception actually
  // stands: behind the person waiting to be called, not behind the sofa they
  // are sitting on.
  //
  // THE EAST ONE IS CONDITIONAL, and the condition is the art. §3.4 gives that
  // wall a picture up to 6 U long and this band is under thirteen; a wall that
  // has spent its run on one fixture does not get a second drawn through it.
  // So the west wall always carries a case, the east wall carries one when the
  // art leaves the run for it, and neither is ever stretched to fill a wall —
  // §3.4 caps the case at 8 U for the reason it caps the whiteboard.
  const westRun = clamp(bandTop - FIXTURE_TOP - 5.0, 0, BOOKCASE_MAX_H);
  if (westRun >= BOOKCASE_MIN_RUN) {
    props.push({
      kind: 'bookshelf',
      id: 'office-bookcase-w',
      w: BOOKCASE_W,
      h: westRun,
      angle: 0,
      x: PAD,
      y: FIXTURE_TOP,
      anchor: { type: 'wall', side: 'W', along: FIXTURE_TOP, inset: 0.3 },
    });
  }
  const eastTop = deskY + artH + 1.0;
  const eastRun = clamp(bandTop - eastTop, 0, BOOKCASE_MAX_H);
  // And a wall with a file of people standing along it has spent its run too.
  if (eastRun >= BOOKCASE_MIN_RUN && queued === 0) {
    props.push({
      kind: 'bookshelf',
      id: 'office-bookcase-e',
      w: BOOKCASE_W,
      h: eastRun,
      angle: 0,
      x: IN_W - PAD - BOOKCASE_W,
      y: eastTop,
      anchor: { type: 'wall', side: 'E', along: eastTop, inset: 0.3 },
    });
  }

  // Planting in the two corners the seating leaves open, so the head of the
  // room is furnished rather than bare either side of the desk. TWO KINDS, and
  // never the same one twice: `plantRun` cannot repeat a silhouette (§3.6), so
  // the pair reads as planting rather than as a symmetry.
  //
  // THE TREE IS NOT IN THE RUN. It is already standing at the head of this
  // room, eight units away, and §3.5's second rule is *"no two identical
  // silhouettes within 8 U"* — a corner that answered with a second canopy
  // would be §1.6's finding inside one room. Two kinds and two corners, so the
  // pair also cannot repeat each other.
  const officeKinds = plantRun('__office__', 2, ['plant_broad', 'plant_blade']);
  /** @type {readonly ('NW'|'NE')[]} */
  const officeCorners = ['NW', 'NE'];
  officeCorners.forEach((corner, n) => {
    const kind = officeKinds[n];
    const size = PLANT_FOOTPRINTS[kind] || 2;
    props.push({
      kind,
      w: size,
      h: size,
      angle: 0,
      x: corner === 'NW' ? PAD + 0.6 : IN_W - PAD - 0.6 - size,
      y: PAD + 0.6,
      anchor: { type: 'corner', corner, inset: PAD + 0.6 },
    });
  });

  // --- the standing file, along the wall at the head of the room
  //
  // Zones and no props: a queue is people standing, and giving each of them a
  // chair would say they had been seated. NOBODY STANDS HERE WHILE A CUSHION IS
  // FREE (`plan-office-seats.js`): `queued` is what is left once every cushion
  // on all three runs is taken.
  //
  // IT IS A FILE ALONG THE EAST WALL, on the line of the east run and above
  // the head of it: between that sofa and the corner planting, beside the desk
  // rather than across it. The rug stops short of this wall, so nobody in the
  // file is standing on it — the middle of the room used to be the queue, and
  // five people stood on the rug in front of cushions nobody was sitting on.
  // Laid on its side, the room has this wall along the corridor, beside its
  // door.
  //
  // The first to stand is the next to sit, so the file starts at the sofa and
  // runs away from it. Its pitch is the stack a waiting person is — a body, a
  // badge and a name — read on whichever axis the file runs along ON SCREEN
  // (`opts.landscape`), and `queueAlong` closes it up when the wall is short.
  const across = opts.landscape === true;
  const filePitch = across ? OFFICE_QUEUE_PITCH : OFFICE_QUEUE_ROW;
  const fileX = IN_W - PAD - SOFA_D / 2;
  const fileHead = bandTop + SOFA_D * 0.75 - filePitch;
  const cornerPlant = PLANT_FOOTPRINTS[officeKinds[1]] || 2;
  const fileEnd = PAD + 0.6 + cornerPlant + (across ? OFFICE_SEAT_PITCH / 2 : OFFICE_SEAT_PITCH);
  queueAlong(queued, fileHead - fileEnd, filePitch).forEach((back, i) => {
    zones.push({
      id: OFFICE_QUEUE_ZONE + i,
      x: fileX - CHAIR / 2,
      y: fileHead - back - CHAIR / 2,
      w: CHAIR,
      h: CHAIR,
    });
  });

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

/**
 * How a transposed reception's walls, corners and runs are renamed.
 *
 * Laying the room on its side is a reflection in the diagonal, so north and
 * west swap and so do south and east — and every anchor has to be renamed with
 * the coordinates or `resolveAnchors` would put the furniture back where the
 * portrait room had it. The two corners ON the diagonal keep their names; the
 * two off it swap.
 */
const TRANSPOSED_SIDE = /** @type {const} */ ({ N: 'W', W: 'N', S: 'E', E: 'S' });
const TRANSPOSED_CORNER = /** @type {const} */ ({ NW: 'NW', SE: 'SE', NE: 'SW', SW: 'NE' });
/** The sofa runs are named for the wall they lie along, so they move too. */
const TRANSPOSED_ID = new Map([
  ['wait-sofa-w', 'wait-sofa-n'],
  ['wait-sofa-n', 'wait-sofa-w'],
  ['wait-sofa-e', 'wait-sofa-s'],
  ['wait-sofa-s', 'wait-sofa-e'],
]);

/**
 * THE RECEPTION, LAID ON ITS SIDE (WP-59d).
 *
 * Arrangement B puts the office at the wide end of a row rather than at the
 * top of a column: the waiting area runs along its width, and the desk is at
 * one end with the manager behind it looking down the room. That is the same
 * room through ninety degrees, and it is built as exactly that rather than as
 * a second layout — `buildOffice` is asked for the room it would have laid in
 * the transposed box, and every coordinate, angle, anchor and run name is then
 * reflected in the diagonal.
 *
 * WHY A TRANSPOSE AND NOT A SECOND LAYOUT. The portrait reception is the most
 * carefully measured room in this file: the three runs form one continuous C
 * corner to corner (§57), the rug reaches the seating it belongs to, the
 * water cooler stands on the side table which stands at the head of the west
 * run, and `layout-anchors.test.mjs` holds every one of those to 2 U. A second
 * hand-written layout is a second set of those relationships to get right and
 * to keep right; a reflection cannot get them wrong, because it is the same
 * numbers read on the other axis.
 *
 * @param {number} waitingCount
 * @param {{w:number,h:number}} [fit] the ROW cell this reception has been
 *   given — `w` along the row, `h` its depth.
 * @param {{hold?:boolean, compact?:boolean, graded?:boolean}} [opts] `hold`: lay it at the width it is given,
 *   not at the width its queue would like (see `buildOffice`)
 */
export function buildOfficeRow(waitingCount, fit, opts = {}) {
  // The box the portrait room is asked for, read back to front: its WIDTH is
  // the row's depth (less the plate band, which is a room's and not an
  // interior's), and its HEIGHT is the row's width. The aspect floor is the
  // one bound the transpose cannot inherit — `ROOM_ASPECT_MAX` is stated on a
  // portrait room — so a long row office is given the depth that keeps it
  // inside `OFFICE_ROW_ASPECT_MAX`.
  const rowW = fit && fit.w > 0 ? fit.w : 0;
  const rowH = fit && fit.h > 0 ? fit.h : 0;
  // THE QUEUE GROWS THE ROW'S WIDTH, NOT ITS DEPTH, and that is the transpose
  // of "the reception is sized for the queue it holds" rather than an
  // exception to it. `OFFICE_GROWTH_W` and `OFFICE_GROWTH_H` are per-head
  // growth on a portrait room's two axes; in a row the C of sofas runs along
  // the WIDTH, so both of them are spent there and the depth is exactly what
  // the row asks for. Left alone, nine waiting agents made the reception eight
  // units DEEPER — which is eight units the rooms beside it could not use and
  // drew as open floor under themselves.
  const want = Math.max(0, waitingCount);
  const compact = officeRunsFor(want, opts) < 3;
  const depth = Math.min(
    OFFICE_ROW_MAX_DEPTH,
    Math.max(
      compact ? OFFICE_COMPACT_W : OFFICE_MIN_W,
      rowH - PLATE_BAND,
      rowW / OFFICE_ROW_ASPECT_MAX,
    ),
  );
  const grows = opts.hold || compact ? 0 : want;
  const portrait = {
    w: depth,
    h: Math.max(rowW, OFFICE_MIN_H + grows * (OFFICE_GROWTH_W + OFFICE_GROWTH_H)) + PLATE_BAND,
  };
  const built = buildOffice(waitingCount, portrait, {
    maxW: depth,
    landscape: true,
    hold: opts.hold === true,
    compact: opts.compact === true,
    graded: opts.graded === true,
  });
  const room = built.room;
  const rename = (id) => (id == null ? id : (TRANSPOSED_ID.get(id) ?? id));

  for (const z of room.zones) {
    const { x, y, w, h } = z;
    z.x = y;
    z.y = x;
    z.w = h;
    z.h = w;
    z.id = rename(z.id);
  }
  for (const p of room.props) {
    const { x, y, w, h } = p;
    p.x = y;
    p.y = x;
    p.w = h;
    p.h = w;
    // A reflection in the diagonal maps a direction (cos a, sin a) to
    // (sin a, cos a), which is the direction at PI/2 - a.
    p.angle = Math.PI / 2 - (p.angle || 0);
    if (p.id) p.id = rename(p.id);
    const a = p.anchor;
    if (a.type === 'wall') a.side = TRANSPOSED_SIDE[a.side];
    else if (a.type === 'corner') a.corner = TRANSPOSED_CORNER[a.corner];
    else if (a.type === 'attached') {
      a.edge = TRANSPOSED_SIDE[a.edge];
      a.to = rename(a.to);
    } else if (a.type === 'zone') {
      const dx = a.dx;
      a.dx = a.dy;
      a.dy = dx;
      a.of = rename(a.of);
    } else if (a.type === 'centered') {
      a.of = rename(a.of);
    }
  }
  // The plate band is not part of the transpose: it is a strip across the top
  // of a room whichever way the room lies, and the contents' frame starts
  // under it either way. So the room's own box is the interior swapped, with
  // the band added back on the height.
  const band = room.plateBand ?? 0;
  const interiorW = room.h - band;
  const interiorH = room.w;
  room.w = interiorW;
  room.h = interiorH + band;
  room.natural = { w: interiorW, h: interiorH + band };
  room.landscape = true;
  return { room, officeSeats: [] };
}
