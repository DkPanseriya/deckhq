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
  OFFICE_VISITOR_PITCH,
  PLATE_BAND,
  ROOM_ASPECT_MAX,
  SOFA_MIN_RUN,
  angleTo,
  clamp,
  visitorChairCount,
} from './plan-units.js';

/** The prefix every standing queue place carries, as a zone id. */
export const OFFICE_QUEUE_ZONE = 'office-queue-';
/** The prefix every visitor chair carries, as a prop and a zone id. */
export const OFFICE_VISITOR_ZONE = 'office-visitor-';

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
 * @param {{maxW?:number, landscape?:boolean}} [opts] `maxW` overrides
 *   `OFFICE_MAX_W` — in a row that cap is read on the other axis and is the
 *   room's DEPTH (WP-59d). `landscape` says this room is about to be reflected
 *   in the diagonal by `buildOfficeRow`, which is the only thing the QUEUE
 *   needs to know: a queue must spread along whichever axis ends up horizontal
 *   on screen, because that is the axis a name label and a waiting badge have
 *   room on (WP-78).
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
  const wantW = clamp(OFFICE_MIN_W + want * OFFICE_GROWTH_W, OFFICE_MIN_W, maxW);
  const wantH = clamp(OFFICE_MIN_H + want * OFFICE_GROWTH_H, OFFICE_MIN_H, OFFICE_MAX_H);
  const IN_W = clamp(Math.max(wantW, fit ? Math.min(fit.w, maxW) : 0), OFFICE_MIN_W, maxW);
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

  // --- the visitor chairs: a ROW facing the desk across it (WP-78)
  //
  // There was one, and it belonged to "the agent that has waited longest";
  // everybody else sat on the sofas round the walls. The owner wants the
  // people who are waiting on HIM at his desk, so the chairs are two or three
  // - `visitorChairCount`, off the desk's own width, so a bigger room gets a
  // third rather than a wider gap - and the sofas seat nobody.
  const deskCentre = { x: deskX + deskW / 2, y: deskY + 1.5 };
  const visitors = visitorChairCount(IN_W);
  const visitorY = deskY + 3 + 1.4;
  const visitorRun = (visitors - 1) * OFFICE_VISITOR_PITCH;
  for (let i = 0; i < visitors; i++) {
    const cx = deskX + deskW / 2 - visitorRun / 2 + i * OFFICE_VISITOR_PITCH;
    const cy = visitorY + CHAIR / 2;
    const id = OFFICE_VISITOR_ZONE + i;
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
  }

  // --- seating around the walls, sized to the room it is actually in
  //
  // The room's HEIGHT is settled here, before anything is anchored to it,
  // because the reception has to hold its whole queue. A first pass says how
  // many the wall seating takes; whatever is left needs loose chairs, and the
  // room grows to hold those rather than laying them out past its own south
  // wall. Growing only ever increases the wall seating, so one pass converges.
  const bandTop = visitorY + CHAIR + 2.4;
  const backW = Math.max(4, IN_W - (PAD + SOFA_D) * 2);
  // THE QUEUE, AND THE ROOM IT NEEDS.
  //
  // Everyone the chairs could not take stands inside the well the three sofa
  // runs enclose, so a queue place can never land on a sofa whatever
  // proportions the room turns out to have.
  //
  // IT RUNS ALONG THE WELL'S LONGER AXIS, and that is the whole of why this is
  // not four lines. The packer may lay this room on its side (`buildOfficeRow`
  // reflects it in the diagonal), so the axis that is "across the room" here is
  // "down the room" on the next floor — and a queue laid across the SHORT axis
  // of a row reception is six people stacked in the room's depth, each one's
  // name drawn through the badge of the person behind them. That was measured
  // on the `demo` floor before this rule existed.
  const queued = Math.max(0, waitingCount - visitors);
  const QUEUE_PAD = 1.6;
  const wellWFor = () => Math.max(CHAIR, IN_W - 2 * (PAD + SOFA_D) - QUEUE_PAD * 2);
  const wellHFor = (height) => Math.max(CHAIR, height - PAD - SOFA_D - bandTop - QUEUE_PAD * 2);
  // `+ 1` because a lane count is places, not gaps: a run of exactly one pitch
  // holds two people, at either end of it.
  const lanesIn = (len) => Math.max(1, Math.floor(len / OFFICE_QUEUE_PITCH) + 1);
  const layFor = (major, minor) => {
    const lanes = lanesIn(major);
    const files = Math.max(1, Math.ceil(queued / lanes));
    return { lanes, files, fits: (files - 1) * OFFICE_QUEUE_ROW <= minor };
  };
  const wellW0 = wellWFor();
  const wellH0 = wellHFor(IN_H);
  // Along whichever axis will be HORIZONTAL on screen. A reception laid on its
  // side is the same room reflected in the diagonal, so its local `y` is the
  // screen's `x` — and a queue that ignores that stacks six people down the
  // room's depth with each name drawn through the badge behind it.
  let alongX = !opts.landscape;
  let lay = alongX ? layFor(wellW0, wellH0) : layFor(wellH0, wellW0);
  // Laid down the room and too wide for it: fall back to across the room, which
  // is the arrangement the room can GROW to hold.
  if (!alongX && !lay.fits) {
    alongX = true;
    lay = layFor(wellW0, wellH0);
  }
  // The room is at least as tall as its own contents: the desk band, a sofa
  // run somebody can actually sit on, the back run and the wall pad. Clamping
  // the RUN instead (the old rule) let a short room overlap its own back sofa.
  const queueDepth = queued > 0 ? (alongX ? (lay.files - 1) * OFFICE_QUEUE_ROW : 0) : 0;
  const IN_H_FINAL = Math.max(
    IN_H,
    bandTop + SOFA_MIN_RUN + SOFA_D + PAD * 2,
    bandTop + QUEUE_PAD * 2 + CHAIR + queueDepth + SOFA_D + PAD * 2,
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

  // --- the standing queue, beside the desk and inside the well
  //
  // Zones and no props: a queue is people standing, and giving each of them a
  // chair would say they had been seated. One lane fills before the next file
  // starts, so the line forms in arrival order and only doubles back when the
  // room runs out of wall — which is what a queue does.
  const clampX = (v) => Math.min(Math.max(v, wellX + CHAIR / 2), wellX + wellW - CHAIR / 2);
  const clampY = (v) => Math.min(Math.max(v, wellY + CHAIR / 2), wellY + wellH - CHAIR / 2);
  for (let i = 0; i < queued; i++) {
    const lane = i % lay.lanes;
    const file = Math.floor(i / lay.lanes);
    const along = lane * OFFICE_QUEUE_PITCH;
    const back = file * OFFICE_QUEUE_ROW;
    const qx = clampX(wellX + QUEUE_PAD + (alongX ? along : back));
    const qy = clampY(wellY + QUEUE_PAD + (alongX ? back : along));
    zones.push({
      id: OFFICE_QUEUE_ZONE + i,
      x: qx - CHAIR / 2,
      y: qy - CHAIR / 2,
      w: CHAIR,
      h: CHAIR,
    });
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
 */
export function buildOfficeRow(waitingCount, fit) {
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
  const depth = Math.min(
    OFFICE_ROW_MAX_DEPTH,
    Math.max(OFFICE_MIN_W, rowH - PLATE_BAND, rowW / OFFICE_ROW_ASPECT_MAX),
  );
  const portrait = {
    w: depth,
    h: Math.max(rowW, OFFICE_MIN_H + want * (OFFICE_GROWTH_W + OFFICE_GROWTH_H)) + PLATE_BAND,
  };
  const built = buildOffice(waitingCount, portrait, { maxW: depth, landscape: true });
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

/**
 * Seat the waiting agents on the reception furniture, after that furniture has
 * been placed for real.
 *
 * This runs late on purpose. The chairs and the queue are anchored to the
 * room's own frame, so their final coordinates are not known until the room has
 * been sized, tiled and had its anchors resolved. An earlier version computed
 * seats from the pre-anchor layout, and agents appeared to sit on the floor
 * beside the furniture rather than on it - the two frames simply were not the
 * same.
 *
 * THE ORDER IS THE QUEUE, AND THE QUEUE IS ARRIVAL ORDER (WP-78).
 * `assignSeats` hands this array the waiting agents sorted oldest first, so
 * seat 0 has to be the place nearest the manager. The chairs come first,
 * sorted by their distance from the desk - which for a row centred on it puts
 * the agent that has waited longest directly across from him and the rest to
 * either side - and then the standing queue, in the order `buildOffice` laid
 * it out.
 *
 * NOBODY IS SEATED ON A SOFA. The three runs are furniture now and nothing
 * else; see `docs/DEVIATIONS.md` §153 for why they stayed in the room.
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

  /** @param {number} x @param {number} y @param {boolean} [standing] */
  const place = (x, y, standing) => {
    if (seats.length >= waitingCount) return;
    /** @type {Seat} */
    const seat = { x, y, angle: angleTo({ x, y }, deskCentre) };
    // A queue place has no chair under it, and a character drawn seated over
    // bare carpet is a character sitting on the floor. `agents.js` reads this.
    if (standing) seat.standing = true;
    seats.push(seat);
  };

  const near = (p) => Math.hypot(p.x - deskCentre.x, p.y - deskCentre.y);
  const chairs = room.props
    .filter((p) => p.kind === 'waiting_chair')
    .map((p) => ({ x: p.x + p.w / 2, y: p.y + p.h / 2 }))
    .sort((a, b) => near(a) - near(b) || a.x - b.x || a.y - b.y);
  for (const c of chairs) place(c.x, c.y);

  const index = (z) => Number(String(z.id).slice(OFFICE_QUEUE_ZONE.length));
  const queue = (room.zones || [])
    .filter((z) => typeof z.id === 'string' && z.id.startsWith(OFFICE_QUEUE_ZONE))
    .sort((a, b) => index(a) - index(b));
  for (const z of queue) place(z.x + z.w / 2, z.y + z.h / 2, true);

  return seats;
}
