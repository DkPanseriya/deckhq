/**
 * THE TONES A PIECE OF FURNITURE IS DETAILED IN, and the two rules that keep
 * furniture quieter than the people using it.
 *
 * A desk is one token and so is a seat, and that is all a theme names. What a
 * desk CARRIES — a keyboard, the dark band along its far edges, the groove down
 * a bench — and what a sofa is upholstered in past its cushion are derived here,
 * from those tokens and from nothing else, so every theme and every colour
 * scheme repaints the details with the piece.
 *
 * TWO RULES, both measured by `look-guards.js` over every theme, scheme and set:
 *
 *   1. A DETAIL IS NEVER MORE THAN 1.6:1 AGAINST THE SURFACE IT SITS ON
 *      (`FURNITURE_DETAIL_MAX`). It holds by construction: `quietOn` walks a
 *      tone back toward its surface until it fits, which is `underWall`'s device
 *      pointed at a different ceiling. The monitor is the one exception — a
 *      screen is a dark object on a pale desk and is how a desk reads as a desk.
 *
 *   2. NO FILL COMES WITHIN 60 RGB OF A COLOUR THAT ASKS FOR THE USER
 *      (`FURNITURE_STATE_MIN_DISTANCE`, `FURNITURE_ALERT_STATES`): the crimson
 *      of a session waiting for review and the amber of one waiting for input.
 *
 * Pure functions over a record of material tokens. No DOM, no canvas, and no
 * reading of the live palette: the painters pass it in, and so do the guards.
 */

import { contrastRatio, mix, over, shade } from './themes-derive.js';

/** The most a detail may stand out from the surface it is drawn on. */
export const FURNITURE_DETAIL_MAX = 1.6;

/** Where `quietOn` stops: inside the ceiling, clear of a channel's rounding. */
export const FURNITURE_DETAIL_TARGET = 1.55;

/** How far, in RGB, every furniture fill keeps from a colour that asks for the user. */
export const FURNITURE_STATE_MIN_DISTANCE = 60;

/**
 * THE TWO COLOURS THAT MEAN "LOOK AT ME". A session waiting for review and one
 * waiting for input are the reason the floor exists, and they are saturated and
 * warm; nothing a room is furnished with may come near either.
 *
 * The other four on-floor states are not on this list, and that is a
 * measurement rather than a preference: `stalled`, `benched` and `ended` are a
 * tan and two greys, and `working` is a dark green, and a building furnished in
 * timber and neutrals is inside 60 RGB of all four before a single detail is
 * drawn on it (the seat token itself is 36 from `ended` on a dark theme).
 * `furnitureStateDistances` reports those for the record.
 */
export const FURNITURE_ALERT_STATES = Object.freeze(['for_review', 'needs_input']);

/**
 * `wanted`, or the nearest tone to it that is no more than `max`:1 against
 * `surface`. Bisects on a mix toward the surface; twenty halvings land well
 * inside one channel count, so the answer is the same on every machine.
 *
 * @param {string} surface the material the tone is drawn on
 * @param {string} wanted the tone the piece would like
 * @param {number} [max]
 * @returns {string}
 */
export function quietOn(surface, wanted, max = FURNITURE_DETAIL_TARGET) {
  if (contrastRatio(wanted, surface) <= max) return wanted;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(mix(wanted, surface, mid), surface) > max) lo = mid;
    else hi = mid;
  }
  return mix(wanted, surface, hi);
}

/**
 * Every tone the furniture painters use past the raw tokens.
 *
 * @param {Record<string, string>} t the material tokens (`PALETTE`, or a
 *   resolved look's tokens over the default palette)
 * @returns {Readonly<Record<string, string>>}
 */
export function furnitureTonesFor(t) {
  const desk = t.deskTop;
  const wood = t.tableWood;
  const seat = t.chairFill;
  const cushion = t.sofaCushion;
  const counter = t.counterTop;
  const keyboard = quietOn(desk, mix(seat, t.wallFill, 0.4));
  const well = quietOn(wood, shade(wood, -0.1));
  const bezel = t.monitorBody;
  return Object.freeze({
    // ---- the desk: a top, its two shaded edges, its lit ones, what is on it
    deskTop: desk,
    deskBand: quietOn(desk, t.deskEdge),
    deskLit: over(desk, t.deskSheen),
    deskSpine: quietOn(desk, shade(desk, -0.12)),
    keyboard,
    keyRow: quietOn(keyboard, shade(keyboard, -0.18)),
    monitorFoot: quietOn(desk, shade(desk, -0.3)),
    monitorBezel: bezel,
    screenGlow: over(bezel, t.monitorScreenGlow),

    // ---- the pale timber: meeting, coffee and side tables, storage
    tableTop: wood,
    tableBand: quietOn(wood, t.deskEdge),
    tableLit: over(wood, t.deskSheen),
    tableStrip: quietOn(wood, shade(wood, -0.08)),
    magazineA: quietOn(wood, mix(t.whiteboardMarkerBlue, wood, 0.4)),
    magazineB: quietOn(wood, mix(t.whiteboardMarkerPlum, wood, 0.4)),
    shelfWell: well,
    bookA: quietOn(well, mix(desk, t.partitionFill, 0.5)),
    bookB: quietOn(well, mix(seat, t.plantLeafA, 0.25)),
    bookC: quietOn(well, mix(t.circulationBase, t.inkWarm, 0.18)),
    topPot: quietOn(wood, t.plantPot),
    topLeaf: quietOn(wood, t.plantLeafB),
    topTray: quietOn(wood, t.clutterPaper),
    topBook: quietOn(wood, t.bookA),

    // ---- the kitchen and the bar
    counterTop: counter,
    counterBand: quietOn(counter, shade(counter, -0.18)),
    counterLit: over(counter, t.deskSheen),
    hob: quietOn(counter, t.hob),
    hobRing: quietOn(counter, shade(counter, -0.1)),
    sink: quietOn(counter, shade(counter, -0.14)),

    // ---- a task chair
    // The base is the seat's own cloth carried toward the line work, so on a
    // dark floor it is a mid grey rather than five bright points.
    chairBase: mix(seat, t.inkWarm, 0.45),
    chairSeat: seat,
    chairBack: quietOn(seat, shade(seat, -0.2)),
    chairArm: quietOn(seat, shade(seat, -0.13)),
    seatLine: quietOn(seat, shade(seat, -0.16)),
    seatLit: over(seat, t.chairCushion),

    // ---- sofas, armchairs, tub chairs
    sofaFrame: t.sofaFrame,
    sofaArm: mix(t.sofaFrame, cushion, 0.45),
    sofaCushion: cushion,
    sofaBack: quietOn(cushion, shade(cushion, -0.07)),
    sofaSeam: quietOn(cushion, over(cushion, t.sofaSeam)),
    pillow: quietOn(cushion, mix(cushion, t.plantLeafA, 0.42)),

    // ---- fruit, magazines, balls: the small coloured things, muted
    fruitA: mix(t.plantLeafA, counter, 0.25),
    fruitB: mix(t.clutterNote, t.plantLeafB, 0.35),
    fruitC: mix(desk, t.wallFill, 0.25),
    fruitD: mix(t.plantLeafC, desk, 0.45),
    ballA: mix(t.whiteboardMarkerBlue, t.poolFelt, 0.25),
    ballB: mix(t.whiteboardMarkerPlum, t.poolFelt, 0.25),
    ballC: mix(t.clutterNote, t.poolFelt, 0.2),
    ballD: mix(t.poolCue, t.poolFelt, 0.3),
  });
}

/**
 * RULE 1'S LIST: every detail, and the surface it is measured against.
 * A detail a painter draws that is not here is a detail nobody measured.
 * @type {ReadonlyArray<readonly [string, string]>}
 */
export const FURNITURE_DETAILS = Object.freeze(
  /** @type {Array<readonly [string, string]>} */ ([
    ['deskBand', 'deskTop'],
    ['deskLit', 'deskTop'],
    ['deskSpine', 'deskTop'],
    ['keyboard', 'deskTop'],
    ['keyRow', 'keyboard'],
    ['monitorFoot', 'deskTop'],
    ['tableBand', 'tableTop'],
    ['tableLit', 'tableTop'],
    ['tableStrip', 'tableTop'],
    ['magazineA', 'tableTop'],
    ['magazineB', 'tableTop'],
    ['shelfWell', 'tableTop'],
    ['bookA', 'shelfWell'],
    ['bookB', 'shelfWell'],
    ['bookC', 'shelfWell'],
    ['topPot', 'tableTop'],
    ['topLeaf', 'tableTop'],
    ['topTray', 'tableTop'],
    ['topBook', 'tableTop'],
    ['counterBand', 'counterTop'],
    ['counterLit', 'counterTop'],
    ['hob', 'counterTop'],
    ['hobRing', 'counterTop'],
    ['sink', 'counterTop'],
    ['chairBack', 'chairSeat'],
    ['chairArm', 'chairSeat'],
    ['seatLine', 'chairSeat'],
    ['seatLit', 'chairSeat'],
    ['sofaBack', 'sofaCushion'],
    ['sofaSeam', 'sofaCushion'],
    ['pillow', 'sofaCushion'],
  ]),
);

/**
 * THE ONE EXCEPTION TO RULE 1: the monitor. Its bezel is a dark object on a
 * pale desk, and its glow is the lit face of that object.
 */
export const FURNITURE_BEZEL = Object.freeze(['monitorBezel', 'screenGlow']);

/**
 * RULE 2'S LIST: the shipped tokens a piece of furniture is filled with. The
 * derived tones above are measured as well; these are the ones a theme names.
 */
export const FURNITURE_FILL_TOKENS = Object.freeze([
  'deskTop',
  'deskEdge',
  'tableWood',
  'chairFill',
  'chairEdge',
  'chairBackrest',
  'sofaFill',
  'sofaFrame',
  'sofaCushion',
  'furnitureMetal',
  'counterTop',
  'fridgeFill',
  'whiteboardSurface',
  'plantPot',
  'planterTrough',
  'planterSoil',
  'clutterCeramic',
  'clutterPaper',
  'clutterNote',
  'monitorBody',
  'hob',
  'sink',
  'cabinetBody',
  'poolFelt',
  'ttBed',
  'boardGameFelt',
  'boxFill',
  'inkCool',
]);

/**
 * THREE SHIPPED OBJECT TOKENS INSIDE THE DISTANCE, named rather than hidden:
 * the pool table's walnut rail and the flap of a packing carton are browns, and
 * a brown is 51 to 59 RGB from the amber of "needs input". They belong to
 * `palette-colors.js`, which a theme does not repaint, and the floor of each is
 * what was measured the day this table was written — a token that moves closer
 * fails, and one that clears 60 fails until its row is deleted.
 *
 * @type {Readonly<Record<string, {state:string, floor:number}>>}
 */
export const FURNITURE_FILL_EXEMPT = Object.freeze({
  poolRail: Object.freeze({ state: 'needs_input', floor: 59 }),
  poolRailTop: Object.freeze({ state: 'needs_input', floor: 51 }),
  boxFlap: Object.freeze({ state: 'needs_input', floor: 50 }),
});
