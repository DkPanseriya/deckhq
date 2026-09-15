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
  OFFICE_SOFA_PITCH,
  OFFICE_VISITOR_CHAIRS,
  PLATE_BAND,
  ROOM_ASPECT_MAX,
  SOFA_DEPTH,
  SOFA_MIN_RUN,
  SOFA_SEAT_BIAS,
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

/** The prefix every standing queue place carries, as a zone id. */
export const OFFICE_QUEUE_ZONE = 'office-queue-';
/** The prefix every visitor chair carries, as a prop and a zone id. */
export const OFFICE_VISITOR_ZONE = 'office-visitor-';

/** @typedef {import('./plan-units.js').Prop} Prop */
/** @typedef {import('./plan-units.js').Zone} Zone */
/** @typedef {import('./plan-units.js').Room} Room */
/** @typedef {import('./plan-units.js').Seat} Seat */

/**
 * How many waiting sessions a sofa run of this length seats (WP-93).
 *
 * One expression, called from two places that must agree: `buildOffice`, which
 * sizes the standing queue off it before the furniture exists, and
 * `sofaPlacesOn`, which lays the places out once it does. Two copies of this
 * arithmetic is a room whose queue is one longer than its empty cushions.
 *
 * The `1e-9` is not decoration. `SOFA_MIN_RUN` and `OFFICE_SOFA_PITCH` are both
 * 5.2, so the shortest run the room will build divides EXACTLY once — and
 * `5.2 / 5.2` in binary floating point is not reliably 1.
 * @param {number} runLen
 */
function sofaPlaceCount(runLen) {
  const n = Number(runLen);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.floor(n / OFFICE_SOFA_PITCH + 1e-9));
}

/**
 * Where people sit on ONE sofa run, in the room's own resolved frame.
 *
 * Evenly along the run rather than packed from one end, so a half-full sofa
 * reads as a sofa somebody is sitting on rather than as one with a gap at the
 * end; and forward of the centre line by `SOFA_SEAT_BIAS` of the run's depth,
 * because the back cushion occupies the far third of it (`backdrop.js`'s sofa
 * case) and a body drawn on the centre line is sitting on the back.
 *
 * The rect says which way the run lies and the angle says which way it faces,
 * exactly as they do for the painter — so this is correct for the portrait
 * reception and for the transposed row one without being told which it has.
 * @param {Prop} sofa
 * @returns {{x:number, y:number}[]}
 */
function sofaPlacesOn(sofa) {
  const vertical = sofa.h > sofa.w;
  const runLen = vertical ? sofa.h : sofa.w;
  const n = sofaPlaceCount(runLen);
  if (n === 0) return [];
  const depth = vertical ? sofa.w : sofa.h;
  const forward = depth * SOFA_SEAT_BIAS;
  const bias = {
    x: vertical ? Math.cos(sofa.angle || 0) * forward : 0,
    y: vertical ? 0 : Math.sin(sofa.angle || 0) * forward,
  };
  /** @type {{x:number, y:number}[]} */
  const out = [];
  for (let i = 0; i < n; i++) {
    const along = ((i + 0.5) * runLen) / n;
    out.push(
      vertical
        ? { x: sofa.x + sofa.w / 2 + bias.x, y: sofa.y + along }
        : { x: sofa.x + along, y: sofa.y + sofa.h / 2 + bias.y },
    );
  }
  return out;
}

/**
 * The manager's desk centre — what everybody in this room faces, and what the
 * queue is ordered by. Falls back to the head of the room for a reception that
 * somehow has no desk in it, so ordering never divides by a missing prop.
 * @param {Room} room
 */
function deskCentreOf(room) {
  const desk = (room.props || []).find((p) => p.id === 'user-desk');
  return desk
    ? { x: desk.x + desk.w / 2, y: desk.y + desk.h / 2 }
    : { x: room.x + room.w / 2, y: room.y };
}

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
  // §2: a sofa is as deep as the person on it. `plan-scale.js` owns the number.
  const SOFA_D = SOFA_DEPTH;
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
  // The room's HEIGHT is settled here, before anything is anchored to it,
  // because the reception has to hold its whole queue. A first pass says how
  // many the wall seating takes; whatever is left needs loose chairs, and the
  // room grows to hold those rather than laying them out past its own south
  // wall. Growing only ever increases the wall seating, so one pass converges.
  const bandTop = visitorY + SEAT_TUB + 2.4;
  const backW = Math.max(4, IN_W - (PAD + SOFA_D) * 2);
  // HOW MANY THE SOFAS HOLD, on a first pass (WP-93).
  //
  // The queue's size is `waitingCount` less whatever the three runs seat, and
  // the runs' final length is not known until the room's height is, which is
  // settled below from the queue. One pass converges because growing the room
  // only ever LENGTHENS a run: a capacity read off the pre-growth height is a
  // lower bound, so the queue laid out here is an upper bound on the queue
  // actually needed, and `seatOffice` — which reads the resolved furniture —
  // simply leaves the spare places empty. A shortfall is the failure that would
  // matter, and it cannot happen in this direction.
  const sofaRunH0 = Math.max(SOFA_MIN_RUN, IN_H - PAD - SOFA_D - bandTop);
  const seatedOnSofas = Math.min(
    Math.max(0, waitingCount),
    sofaPlaceCount(sofaRunH0) * 2 + sofaPlaceCount(backW),
  );
  // THE QUEUE, AND THE ROOM IT NEEDS.
  //
  // Everyone the sofas could not seat stands inside the well the three runs
  // enclose — at the open end of the C, which is the end nearest the desk and
  // the only end a reception's seating has. A queue place can never land on a
  // sofa whatever proportions the room turns out to have, and it is never at
  // the desk: the well starts 2.4 U below the visitor chair, so the standing
  // line is beside the seating rather than across the manager's table.
  //
  // IT RUNS ALONG THE WELL'S LONGER AXIS, and that is the whole of why this is
  // not four lines. The packer may lay this room on its side (`buildOfficeRow`
  // reflects it in the diagonal), so the axis that is "across the room" here is
  // "down the room" on the next floor — and a queue laid across the SHORT axis
  // of a row reception is six people stacked in the room's depth, each one's
  // name drawn through the badge of the person behind them. That was measured
  // on the `demo` floor before this rule existed.
  const queued = Math.max(0, waitingCount - seatedOnSofas);
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
  props.push({
    kind: 'magazine_table',
    w: lowW,
    h: 3,
    angle: 0,
    x: wellX + (wellW - lowW) / 2,
    y: IN_H_FINAL - PAD - SOFA_D - 3 - 1.2,
    anchor: { type: 'attached', to: 'wait-sofa-s', edge: 'N', along: (backW - lowW) / 2, gap: 1.2 },
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
  if (eastRun >= BOOKCASE_MIN_RUN) {
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
 * This runs late on purpose. The sofas and the queue are anchored to the room's
 * own frame, so their final coordinates are not known until the room has been
 * sized, tiled and had its anchors resolved. An earlier version computed seats
 * from the pre-anchor layout, and agents appeared to sit on the floor beside
 * the furniture rather than on it - the two frames simply were not the same.
 *
 * THE WAITING SIT ON THE SOFAS (WP-93). The owner, 15 September: _"They all
 * should sit on the sofa. Only the agent I open walks up to the manager desk."_
 * WP-78 had put the whole queue in a row of chairs at the desk and left the
 * three runs seating nobody; this is that package's departure taken back.
 *
 * THE ORDER IS THE QUEUE, AND THE QUEUE IS ARRIVAL ORDER. `assignSeats` hands
 * this array the waiting agents sorted oldest first, so seat 0 has to be the
 * place nearest the manager. The sofa places come first, sorted by distance
 * from the desk centre - which fills the two runs from their open ends inward
 * and the back run last, exactly as a real waiting room fills - and then the
 * standing queue, in the order `buildOffice` laid it out.
 *
 * THE VISITOR CHAIR IS NOT IN `officeSeats`. It holds one person, it is chosen
 * by the user rather than by the clock, and putting it at index 0 would give it
 * to the longest wait by default - which is the thing WP-93 removes. It comes
 * back beside the queue as `officeChair`, and `assignSeats` reaches for it only
 * for the session whose panel is open.
 *
 * @param {Room} room the office, with anchors already resolved
 * @param {number} waitingCount
 * @returns {{officeSeats: Seat[], officeChair: Seat|null}} the plan's own two
 *   fields, named as the plan names them, so `buildPlan` spreads the result
 *   rather than unpacking two answers to the same question.
 */
export function seatOffice(room, waitingCount) {
  /** @type {Seat[]} */
  const seats = [];
  const officeChair = officeChairSeat(room);
  if (waitingCount <= 0) return { officeSeats: seats, officeChair };

  const deskCentre = deskCentreOf(room);

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
  const cushions = room.props
    .filter((p) => p.kind === 'sofa')
    .flatMap((p) => sofaPlacesOn(p))
    .sort((a, b) => near(a) - near(b) || a.x - b.x || a.y - b.y);
  for (const c of cushions) place(c.x, c.y);

  const index = (z) => Number(String(z.id).slice(OFFICE_QUEUE_ZONE.length));
  const queue = (room.zones || [])
    .filter((z) => typeof z.id === 'string' && z.id.startsWith(OFFICE_QUEUE_ZONE))
    .sort((a, b) => index(a) - index(b));
  for (const z of queue) place(z.x + z.w / 2, z.y + z.h / 2, true);

  return { officeSeats: seats, officeChair };
}

/**
 * The one place at the manager's desk, for the session the user has OPEN
 * (WP-93).
 *
 * Derived from the same resolved furniture `seatOffice` reads, and returned
 * separately from the waiting places for the reason stated above: it is the
 * only thing on the floor that a user's selection decides, and it must not be
 * reachable by waiting long enough. `null` for a reception without a chair,
 * so a caller may ask without a guard.
 *
 * Nothing here is stored. The chair is a coordinate; whether anybody is in it
 * is `assignSeats`'s answer, recomputed from the selection every time it is
 * asked, and no observed event can reach it — `test/unit/occupancy.test.mjs`
 * holds that as an `INVARIANT:` test.
 *
 * @param {Room} room the office, with anchors already resolved
 * @returns {Seat|null}
 */
export function officeChairSeat(room) {
  const chair = (room.props || []).find(
    (p) =>
      p.kind === 'tub_chair' && typeof p.id === 'string' && p.id.startsWith(OFFICE_VISITOR_ZONE),
  );
  if (!chair) return null;
  const at = { x: chair.x + chair.w / 2, y: chair.y + chair.h / 2 };
  return { x: at.x, y: at.y, angle: angleTo(at, deskCentreOf(room)) };
}
