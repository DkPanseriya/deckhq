/**
 * THE PICTURES THE LOOK SECTION IS MADE OF — WP-88b.
 *
 * `docs/plan/11-LOOK-CONTROL-CENTRE.md` §4 asks for three kinds of picture, and
 * every one of them is painted by the **real** floor painter rather than by a
 * second renderer that draws something that looks like a floor:
 *
 *   - a **preset thumbnail**, one per card, 160 x 100 at ~7 px/U;
 *   - a **live preview**, the same fragment larger, repainted on every change;
 *   - a **swatch**, 46 x 28, one per option a painter can actually draw.
 *
 * `paintFloorMaterial` and `paintProp` are the two entry points, which is the
 * whole point: *"a swatch cannot drift from the floor it stands for"*. A second
 * painter here would be a second herringbone, and the first time one of them was
 * fixed the other would be a lie.
 *
 * ============================================================================
 * WHY A FRAGMENT AND NOT THE `three` FLOOR
 *
 * The obvious thumbnail is `bakeBackdrop(scene._plan)` scaled down, and it is
 * the wrong one twice. A bake lays its pattern in PLAN UNITS, so shrinking the
 * picture does not shrink the work: the herringbone still lays one block per
 * 1.71 U over the whole envelope whatever the thumbnail is, and six of those is
 * six full floor bakes to fill a strip 160 px wide. And a full bake is
 * 4800 x 2880 physical pixels before it is scaled, six times over, inside a
 * settings sheet.
 *
 * So a thumbnail is a **four-zone fragment** — office, corridor, two project
 * rooms, lounge, with the two rugs, a desk and a plant on it — laid out in plan
 * units and painted by the floor's own painters at the thumbnail's own `u`, in
 * the bake's own order: floors, daylight, the walls between rooms, furniture.
 * It shows what a preset actually changes: the four floors, the scheme's
 * temperature, the rug tones and patterns, the furniture set's radius and
 * frame, the plant family — and, since the light, the partitions and the room
 * colours became choices, those three as well: two rooms side by side, each in
 * the colour the look gives it, the look's own partition between them, and
 * every shadow as long as the look's light makes it.
 * `LOOK_THUMB_DRAW_BUDGET` below is what holds it to that, and
 * `test/unit/look-ui.test.mjs` measures every preset against it.
 * ============================================================================
 *
 * Pure: every function here takes a 2D context and numbers. No DOM at module
 * scope and none inside, so `node --test` can hand it a recorder and count what
 * it did (the technique `lighting.test.mjs` already uses on `paintProp`).
 */

import { LOOK, applyLook, roomGroundFor } from './render/look-derive.js';
import { paintFloorMaterial } from './render/backdrop-floor-look.js';
import { paintProp, paintRoomLight, paintWallSegment } from './render/backdrop.js';
import { seededRng } from './render/backdrop-paint.js';
import { identityFor } from './render/palette.js';

/** The preset card's picture, in CSS pixels. §4's "~7 px/U" at this size. */
export const THUMB_W = 160;
export const THUMB_H = 100;
/** One option's chip. §4: *"every chip the same painter at 46 x 28"*. */
export const SWATCH_W = 46;
export const SWATCH_H = 28;

/** Plan units per pixel for each picture. The preview is §4's "~9 px/U". */
export const THUMB_U = 7;
export const PREVIEW_U = 9;
export const SWATCH_U = 7;

/**
 * How many context operations ONE preset thumbnail may cost, on average.
 *
 * A ceiling, not a measurement, and per card so it does not have to be
 * rewritten the day a twelfth preset is drawn. What it catches is the thing it
 * exists to catch — somebody reaching for `bakeBackdrop` and putting a whole
 * floor bake per card behind a settings sheet, which is two orders of magnitude
 * over this number rather than a few per cent. The measured cost is in
 * `test/unit/look-ui.test.mjs`, which prints it.
 */
export const LOOK_THUMB_DRAW_BUDGET = 2200;

/**
 * RUN `fn` WITH THE FLOOR TEMPORARILY PAINTED IN SOME OTHER LOOK.
 *
 * Every painter in `render/` reads the live `LOOK` and the live `PALETTE` — that
 * is the device WP-88a chose, and it is the right one for a floor that is baked
 * once. A swatch for an option nobody has chosen yet therefore has to BE that
 * floor for the length of one paint, and then stop being it.
 *
 * Safe because it is synchronous end to end: nothing between the two
 * `applyLook` calls yields, so no other painter can observe the borrowed look.
 * `applyLook(LOOK.look, LOOK.theme)` is an exact restore rather than an
 * approximate one — a resolved look is a pure function of those two.
 *
 * @template T
 * @param {unknown} look   the look to borrow
 * @param {unknown} theme  the theme name to borrow it on
 * @param {() => T} fn
 * @returns {T}
 */
export function withLook(look, theme, fn) {
  const wasLook = LOOK.look;
  const wasTheme = LOOK.theme;
  try {
    applyLook(look, theme);
    return fn();
  } finally {
    applyLook(wasLook, wasTheme);
  }
}

/**
 * The fragment's four zones, as fractions of the picture.
 *
 * A spine down the middle with the office on one side, a project room over a
 * lounge bay on the other: the smallest arrangement in which all four of §1.a's
 * zones touch, so all three of `ZONE_ADJACENCY`'s edges are visible in it. The
 * numbers are fractions rather than units so the same fragment serves a 160 px
 * card and a 640 px preview. The rooms' side is the wider one since it became
 * two rooms: at a card's size each has to be wide enough to read as a room.
 */
const ZONE_BOXES = Object.freeze({
  office: Object.freeze({ x: 0, y: 0, w: 0.38, h: 1 }),
  corridor: Object.freeze({ x: 0.38, y: 0, w: 0.14, h: 1 }),
  rooms: Object.freeze({ x: 0.52, y: 0, w: 0.48, h: 0.56 }),
  lounge: Object.freeze({ x: 0.52, y: 0.56, w: 0.48, h: 0.44 }),
});

/** Every zone this fragment paints, in paint order. @type {ReadonlyArray<string>} */
export const THUMB_ZONES = Object.freeze(Object.keys(ZONE_BOXES));

/**
 * THE ROOMS ZONE IS TWO PROJECT ROOMS, side by side.
 *
 * One room cannot show what a room COLOUR is — a colour of its own is only a
 * colour beside the next room's — and it cannot show a partition, which is
 * what stands between two. So the zone is the first project's room and the
 * second's, each floor in the colour the look gives that project, and the
 * look's own partition on the line they share.
 */
const ROOM_BOXES = Object.freeze({
  'room.1': Object.freeze({ x: 0.52, y: 0, w: 0.24, h: 0.56 }),
  'room.2': Object.freeze({ x: 0.76, y: 0, w: 0.24, h: 0.56 }),
});

/** Every rectangle a prop may be stood in: the four zones and the two rooms. */
const BOXES = Object.freeze({ ...ZONE_BOXES, ...ROOM_BOXES });

/**
 * A box of the picture, on whole pixels. Edges are rounded rather than sizes,
 * so two boxes that share a line in fractions share it in pixels as well.
 * @param {{x:number, y:number, w:number, h:number}} box
 * @param {number} w @param {number} h the picture, in px
 */
function pxOf(box, w, h) {
  const x = Math.round(box.x * w);
  const y = Math.round(box.y * h);
  return { x, y, w: Math.round((box.x + box.w) * w) - x, h: Math.round((box.y + box.h) * h) - y };
}

/**
 * The two walls of the building this fragment is the top-left corner of. They
 * are just outside the picture and are never painted: they are here so the
 * daylight knows which way a room faces, exactly as a plan's walls tell it.
 * @param {number} wU @param {number} hU the picture, in plan units
 */
const envelopeOf = (wU, hU) => [
  { x1: 0, y1: 0, x2: wU, y2: 0, kind: 'exterior' },
  { x1: 0, y1: 0, x2: 0, y2: hU, kind: 'exterior' },
];

/**
 * Lay one zone's floor, in the material the LIVE look gives that zone.
 *
 * `seededRng(zone)` rather than a fresh source: terrazzo and cork scatter, and a
 * scattered floor that moved between two repaints of the same swatch would be a
 * picture that could never be a golden. Same rule as the bake's own
 * `seededRng(room.id)` and the same reason (`08` §1.1: no `Math.random()`).
 *
 * @param {any} ctx
 * @param {string} zone
 * @param {number} w @param {number} h  the picture, in px
 * @param {number} u  px per plan unit
 */
function paintZone(ctx, zone, w, h, u) {
  const r = pxOf(ZONE_BOXES[/** @type {keyof typeof ZONE_BOXES} */ (zone)], w, h);
  paintFloorMaterial(ctx, LOOK.look.floors[zone], r.x, r.y, r.w, r.h, seededRng(zone), null, u);
}

/**
 * Lay the n-th project's room: the rooms' material, in the colour the LIVE
 * look gives that project. `roomGroundFor` is what the bake hands the same
 * painter — the project's identity wash, the room's own hue, or nothing — so a
 * card cannot show a room colour the floor would not.
 *
 * @param {any} ctx
 * @param {number} n which project, counted from 1
 * @param {{x:number, y:number, w:number, h:number}} r the room, in px
 * @param {number} u
 */
function paintProjectRoom(ctx, n, r, u) {
  const tint = roomGroundFor(LOOK, n, identityFor(n).accent);
  const rng = seededRng(`room.${n}`);
  paintFloorMaterial(ctx, LOOK.look.floors.rooms, r.x, r.y, r.w, r.h, rng, tint, u);
}

/**
 * One box's daylight, by the bake's own painter: the room falling away from
 * its windows, a patch under each pane or a skylight where no pane reaches,
 * and the shade at the foot of its walls.
 *
 * @param {any} ctx
 * @param {{x:number, y:number, w:number, h:number}} r the box, in px
 * @param {ReadonlyArray<any>} walls the building's outside walls, in plan units
 * @param {number} u
 */
function paintBoxLight(ctx, r, walls, u) {
  const room = { x: r.x / u, y: r.y / u, w: r.w / u, h: r.h / u };
  paintRoomLight(ctx, room, { rx: r.x, ry: r.y, rw: r.w, rh: r.h }, walls, u);
}

/**
 * One prop on the fragment, positioned in the fraction of a ZONE it sits in.
 *
 * Props are the one thing here that is sized in plan units rather than in
 * fractions, because a desk is 5.2 U wide on every floor and a desk that scaled
 * with the thumbnail would stop being a desk. If the zone is too small to hold
 * it at this `u` — which a 46 px swatch always is — nothing is drawn, and that
 * is the honest answer rather than a desk squeezed to a sliver.
 *
 * @param {any} ctx
 * @param {{kind:string, tone?:string, wU:number, hU:number, zone:string,
 *          fx:number, fy:number}} spec
 * @param {number} w @param {number} h @param {number} u
 */
function paintFragmentProp(ctx, spec, w, h, u) {
  const box = BOXES[/** @type {keyof typeof BOXES} */ (spec.zone)];
  const zoneW = (box.w * w) / u;
  const zoneH = (box.h * h) / u;
  if (spec.wU > zoneW || spec.hU > zoneH) return false;
  const x = (box.x * w) / u + spec.fx * (zoneW - spec.wU);
  const y = (box.y * h) / u + spec.fy * (zoneH - spec.hU);
  paintProp(ctx, { ...spec, x, y, w: spec.wU, h: spec.hU, angle: 0 }, u);
  return true;
}

/**
 * What stands on the fragment, and why each one is there.
 *
 * Five props, one per picker group a floor material cannot show by itself: the
 * two rugs are §1.d's tone and pattern, the round rug is the lounge's own, the
 * desk carries §1.c's radius and frame line, and the plant carries §1.e's
 * family silhouette. Nothing here is decoration — a prop that showed no picker
 * would be a prop the user cannot read the section from.
 */
const FRAGMENT_PROPS = Object.freeze(
  [
    // The sizes are a desk CLUSTER's, not a reception's: 5.2 x 3.4 is the mat
    // under a bench desk rather than the room-sized rug a lobby gets, because
    // the office zone of a 160 px fragment is ten plan units across and a
    // reception rug laid in it covers the floor the card is about. Measured on
    // the card itself — the first cut used the room-sized ones and every preset
    // read as two pale slabs.
    { kind: 'rug', tone: 'wool', zone: 'office', wU: 5.2, hU: 3.4, fx: 0.5, fy: 0.2 },
    // The task rug lies in the SECOND room and the first is left bare: a room's
    // colour is its floor, and one of the two has to show a floor.
    { kind: 'rug', tone: 'task', zone: 'room.2', wU: 3.8, hU: 3, fx: 0.5, fy: 0.6 },
    { kind: 'rug_round', tone: 'wool', zone: 'lounge', wU: 3.8, hU: 3.8, fx: 0.34, fy: 0.55 },
    { kind: 'desk', zone: 'office', wU: 4.4, hU: 2.2, fx: 0.46, fy: 0.84 },
    { kind: 'plant_broad', tone: 'broad', zone: 'lounge', wU: 2, hU: 2, fx: 0.95, fy: 0.12 },
  ].map((p) => Object.freeze(p)),
);

/**
 * THE FRAGMENT, in whatever look is live right now.
 *
 * Callers that want a look other than the live one wrap this in `withLook`;
 * this function itself never applies anything, so the preview — which IS the
 * live look — costs no resolve at all.
 *
 * @param {any} ctx a 2D context, or a recorder
 * @param {{w:number, h:number, u:number, props?:boolean}} opts
 */
export function paintLookFragment(ctx, opts) {
  const { w, h, u } = opts;
  // A GROUND UNDER THE FOUR, and it is not decoration. Every floor painter
  // clips itself to a 2 px rounded rectangle — that is the bake's own device,
  // where a room is a slab with soft corners — so four patches laid edge to edge
  // leave a dark nick at each join, and on a 160 px card those nicks are the
  // first thing the eye finds. The colour is the corridor's own field, which is
  // to say the resolved look's, so nothing here invents one.
  ctx.fillStyle = LOOK.zones.corridor.field;
  ctx.fillRect(0, 0, w, h);

  // FLOORS. The rooms zone is laid as two project rooms rather than as a zone.
  for (const zone of THUMB_ZONES) if (zone !== 'rooms') paintZone(ctx, zone, w, h, u);
  const rooms = Object.values(ROOM_BOXES).map((box) => pxOf(box, w, h));
  rooms.forEach((r, i) => paintProjectRoom(ctx, i + 1, r, u));

  // DAYLIGHT, on the finished floors and under everything that stands on them.
  // The corridor is circulation and takes none, as on the floor.
  const walls = envelopeOf(w / u, h / u);
  paintBoxLight(ctx, pxOf(ZONE_BOXES.office, w, h), walls, u);
  for (const r of rooms) paintBoxLight(ctx, r, walls, u);
  paintBoxLight(ctx, pxOf(ZONE_BOXES.lounge, w, h), walls, u);

  // THE WALLS BETWEEN ROOMS, in the look's partition style: where a room meets
  // the corridor, where it meets the next room, and along the rooms' foot.
  const foot = (rooms[0].y + rooms[0].h) / u;
  const top = rooms[0].y / u;
  const right = (rooms[rooms.length - 1].x + rooms[rooms.length - 1].w) / u;
  for (const r of rooms) {
    paintWallSegment(ctx, { x1: r.x / u, y1: top, x2: r.x / u, y2: foot, kind: 'partition' }, u);
  }
  paintWallSegment(
    ctx,
    { x1: rooms[0].x / u, y1: foot, x2: right, y2: foot, kind: 'partition' },
    u,
  );

  if (opts.props === false) return;
  for (const spec of FRAGMENT_PROPS) paintFragmentProp(ctx, spec, w, h, u);
}

/**
 * One preset's card picture: the fragment under that preset, on this theme.
 *
 * @param {any} ctx
 * @param {{look:unknown, theme:unknown, w?:number, h?:number, u?:number}} opts
 */
export function paintLookThumbnail(ctx, opts) {
  const w = opts.w ?? THUMB_W;
  const h = opts.h ?? THUMB_H;
  withLook(opts.look, opts.theme, () => paintLookFragment(ctx, { w, h, u: opts.u ?? THUMB_U }));
}

/**
 * ONE OPTION'S CHIP.
 *
 * A swatch is the fragment's own painter over one rectangle rather than four,
 * because a chip 46 px wide has room for one material and a border. Which
 * rectangle depends on what the option IS:
 *
 *   - a FLOOR or a SCHEME chip is that material, filling the chip;
 *   - a RUG chip is the rug's own floor with the rug lying on it, because a rug
 *     tone means nothing except against the floor it has to read on — which is
 *     exactly §1.d's whole finding;
 *   - a ROOMS chip (`rooms`) is two project rooms, one above the other, and the
 *     partition between them: the first project's floor, the second's, and the
 *     wall the look puts on the line they share. It is what a partition style
 *     and a room colour each are — a statement about two rooms. The wall runs
 *     the long way so a low partition is long enough to stop short of both
 *     ends, which is the thing that makes it low.
 *
 * @param {any} ctx
 * @param {{look:unknown, theme:unknown, zone:string, rug?:string|null,
 *          rooms?:boolean, w?:number, h?:number, u?:number}} opts
 */
export function paintLookSwatch(ctx, opts) {
  const w = opts.w ?? SWATCH_W;
  const h = opts.h ?? SWATCH_H;
  const u = opts.u ?? SWATCH_U;
  withLook(opts.look, opts.theme, () => {
    if (opts.rooms) {
      const mid = Math.round(h / 2);
      paintProjectRoom(ctx, 1, { x: 0, y: 0, w, h: mid }, u);
      paintProjectRoom(ctx, 2, { x: 0, y: mid, w, h: h - mid }, u);
      paintWallSegment(ctx, { x1: 0, y1: mid / u, x2: w / u, y2: mid / u, kind: 'partition' }, u);
      return;
    }
    paintFloorMaterial(ctx, LOOK.look.floors[opts.zone], 0, 0, w, h, seededRng(opts.zone), null, u);
    if (!opts.rug) return;
    // Inset by a fifth of the chip on each side, so the floor still reads
    // around it: a rug that filled its swatch would be a colour chip again.
    const wU = (w / u) * 0.62;
    const hU = (h / u) * 0.58;
    paintProp(
      ctx,
      {
        kind: 'rug',
        tone: opts.rug,
        x: (w / u - wU) / 2,
        y: (h / u - hU) / 2,
        w: wU,
        h: hU,
        angle: 0,
      },
      u,
    );
  });
}
