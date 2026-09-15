/**
 * The colour tokens themselves, and the discipline that guards them
 * (WP-22 follow-up).
 *
 * Split out of `palette.js` unchanged: the six state colours, the materials
 * list every renderer paints from, the frozen default a theme is a diff
 * against, and the runtime guard that throws if the reserved crimson leaks
 * into a material.
 *
 * COLOUR DISCIPLINE: `#C0392B` is `for_review` and primary actions ONLY. If
 * the user sees red anywhere else on the floor, something is standing in
 * their office that should not be.
 *
 * Pure data, no DOM, no canvas — safe to import in Node.
 */

/**
 * @typedef {'working'|'needs_input'|'stalled'|'for_review'|'benched'|'let_go'} ActivityLikeState
 */

/**
 * THE FLOOR HAS ONE LIGHT (WP-72).
 *
 * A key light in the UPPER LEFT, stated here as the unit vector every shadow
 * on this floor travels along — down and to the right, at 45°. It is a
 * DIRECTION and not a position, because the camera is orthographic top-down
 * (docs/03-VISUAL-SPEC.md §1): a point light would make the shadow at one end
 * of a 90-unit building fall the other way from the shadow at the other end,
 * and nothing in a plan view reads as a mistake faster than that.
 *
 * Everything that casts reads it: a prop's two-pass shadow and its contact
 * shadow (`backdrop-paint.js`), a wall's drop shadow (`backdrop-floor.js`),
 * a room slab's shadow onto the screed, and the building's own shadow onto
 * the ground (`scene-draw.js`, `minifloor.js`). One vector, so nothing on the
 * floor can be lit from somewhere else.
 *
 * 45° exactly, so `dist * LIGHT_DIR` is `(d, d)` for `d = dist / √2` and the
 * offsets the floor shipped with before this package — a contact shadow at
 * `(2, 2)`, a wall at `(2, 2)`, a prop at `(3, 3)` — are reproduced to the
 * pixel by naming the distance along the ray rather than the drop down the
 * page.
 *
 * @type {Readonly<{x:number, y:number}>}
 */
export const LIGHT_DIR = Object.freeze({ x: Math.SQRT1_2, y: Math.SQRT1_2 });

/**
 * How far a project room's carpet is moved toward that project's identity
 * colour (WP-72). Six per cent: enough that two rooms side by side are
 * different rooms at a glance, far too little to be a colour anybody would
 * name. The identity ring on the agent is the signal; this is the room
 * agreeing with it.
 *
 * It is a hard ceiling rather than a taste setting because the carpet is a
 * GROUND — room plates, agent names and the in-room "+" are drawn on it — and
 * `themes.js`'s `assertThemeContrast` measures the WASHED carpet against every
 * theme's ink for all fourteen identities. Raising this number moves a floor
 * every one of those measurements is taken against.
 */
export const CARPET_IDENTITY_WASH = 0.06;

/**
 * State -> colour, verbatim from docs/03-VISUAL-SPEC.md §5.
 *
 * COLOUR DISCIPLINE: `#C0392B` (crimson) is reserved for `for_review` and
 * primary actions ONLY. If the user sees red anywhere else on the floor,
 * something is standing in their office that should not be. Nothing
 * decorative, no material, no furniture tone may reuse this value — see the
 * runtime guard at the bottom of this file, which throws if it leaks into
 * PALETTE.
 *
 * @type {Readonly<Record<ActivityLikeState, string>>}
 */
export const STATE_COLORS = Object.freeze({
  working: '#2E7D63',
  needs_input: '#B87333',
  stalled: '#9A7B4F',
  for_review: '#C0392B',
  benched: '#7B8794',
  let_go: '#BDB7AA',
  // `ended` is in ARCHITECTURE's ActivityState but has no row in
  // VISUAL-SPEC section 5. It needs one: an ended session still sits at its
  // project desk (only an explicit bench moves it), and on a real machine it
  // is the commonest state by far. Without its own colour it inherited
  // `working` green and read as "producing output right now", which is the
  // single most misleading thing the floor could say. Warm dark grey: 3.9:1
  // against the carpet, and unmistakable against both the benched slate and
  // the let-go grey. Raised with the orchestrator; see docs/DEVIATIONS.md.
  ended: '#6E6A63',
});

/** The one and only place crimson is allowed to live. Never add it below. */
export const RESERVED_CRIMSON = STATE_COLORS.for_review;

/**
 * THE STATES A FIGURE IS EVER DRAWN IN, ON THE FLOOR (WP-85a §3.9).
 *
 * Six of the seven. `let_go` is the one that is not on this list and that is a
 * statement about the product rather than an omission: a let-go session has
 * left — it is a row in the departures list and in the deck, never a body
 * standing on a floor — so holding the figure halo to 3:1 against `#BDB7AA`
 * would be holding a character's outline to a colour no character wears.
 *
 * The order is the one `03-VISUAL-SPEC.md` §5 lists them in, with `ended` last
 * because it is the row §5 never had (see `STATE_COLORS.ended` above).
 * @type {ReadonlyArray<string>}
 */
export const ON_FLOOR_STATES = Object.freeze([
  'working',
  'needs_input',
  'stalled',
  'for_review',
  'benched',
  'ended',
]);

/**
 * THE HALO EVERY CHARACTER ON THIS FLOOR IS READ AGAINST (WP-85a §3.9).
 *
 * `03-VISUAL-SPEC.md` §10 promised that every state colour clears 3:1 against
 * its floor background. It never did, on any theme, and it never could: the
 * state palette is mid-tone — `benched #7B8794` and `needs_input #B87333` both
 * sit near L* 53 — so a floor clearing 3:1 against all six would have to be
 * near paper or near black, which is not a floor anybody would want to look at.
 *
 * So the surface a state colour is read against stopped being the floor. Every
 * figure carries this one warm near-white with it: a ground POOL under the feet
 * on a light theme, whose job is uniformity — flattening the parquet so the
 * silhouette sits on one tone — and a thin RIM on the silhouette on a dark one,
 * where a pool would be a bright hole in the room. Which device applies is
 * `relativeLuminance(ink) > 0.5`, the switch the theme derivation already uses.
 *
 * IT IS NOT THEMEABLE, and that is the whole of the guarantee. Like the seven
 * state colours it is a separate export that no floor key names, so no theme
 * document and no asset pack can reach it; `assertFigureHaloContrast` measures
 * it against all six on-floor states at import. Worst case, both dark themes
 * and every theme anybody will ever write: `benched` at 3.28:1.
 */
export const FIGURE_HALO = '#F6F2E9';

/**
 * The pool's peak alpha at the centre of a figure, and the fraction of the
 * body's height at which it reaches zero (§3.9). Stated here beside the colour
 * because `rig-body.js` paints it and `test/unit/interior.test.mjs` measures it.
 */
export const FIGURE_HALO_POOL_ALPHA = 0.34;
export const FIGURE_HALO_POOL_SPAN = 0.58;

/**
 * How far the dark-theme rim stands proud of the silhouette, in px at
 * `BASE_U`. §3.9 says 1.1: enough to separate a body from a dark board at fit
 * scale, too little to read as an outline around a sticker.
 */
export const FIGURE_HALO_RIM_PX = 1.1;

/**
 * Material and furniture colour tokens for the baked backdrop. Every entry
 * name says what it paints, not just what colour it is, so backdrop.js reads
 * like a materials list rather than a swatch book.
 *
 * WP-30 made this object THEMABLE, and that cost it its `Object.freeze`.
 * `DEFAULT_PALETTE` below is the frozen original — the one true default, and
 * what `resetPalette()` restores — and `PALETTE` is the live object every
 * renderer already reads. Themes reach it through `overridePalette()` and
 * never by assignment, and both entry points re-run the colour-discipline
 * guards at the bottom of this file, so a theme that tried to paint a floor
 * in the reserved crimson throws where it is applied rather than on the
 * floor. Nothing in `STATE_COLORS`, `PROJECT_IDENTITIES` or the appearance
 * tables below is reachable from a theme by construction: they are separate
 * exports and no themed key names one.
 *
 * @type {Record<string, string>}
 */
/**
 * THE CARPET, named once (§3.1). The woven ground of a project room, and the
 * colour the lounge games are muted toward — two uses that must not drift.
 */
const CARPET_BASE = '#E7E2D7';

/**
 * HOW FAR THE LOUNGE GAMES ARE MUTED (WP-85c, §3 owner decision 5).
 *
 * *"Do the lounge games stay? They are the one saturated accent left and the
 * one thing that makes a cleared queue look like a reward. Default: yes, muted
 * 22–26 % toward the room's own carpet."*
 *
 * Damped rather than drained: 24 % is the middle of the band the owner set, and
 * `interior.test.mjs` asserts the shipped value is inside it rather than
 * trusting this comment.
 *
 * HERE AND NOT IN `themes.js`, and that is a rule this product already had: *a
 * theme repaints no prop — monitors, the hob and the billiard cloth are
 * objects*. Billiard cloth is green in every building on earth and a floor
 * theme has no business saying otherwise, so the mute is applied ONCE, to the
 * object, against the carpet the default floor has. `GAME_HUES` is what it is
 * muted from, kept as its own table because a material cannot be derived from
 * itself.
 */
export const GAME_MUTE = 0.24;
export const GAME_MUTE_MIN = 0.22;
export const GAME_MUTE_MAX = 0.26;
export const GAME_HUES = Object.freeze({
  poolFelt: '#2F6B4F',
  poolRail: '#6B4A2E',
  poolRailTop: '#8A6238',
  ttBed: '#2E5F80',
  cabinetBody: '#5B5560',
  boardGameFelt: '#7E9481',
});
/** The tokens the mute applies to: the games, and nothing else on the floor. */
export const MUTED_GAME_TOKENS = Object.freeze(Object.keys(GAME_HUES));
/** @param {keyof typeof GAME_HUES} k */
function mutedGame(k) {
  return mixHex(GAME_HUES[k], CARPET_BASE, GAME_MUTE);
}

export const BASE_PALETTE = /** @type {Record<string, string>} */ ({
  // ---- herringbone wood floor (office + lounge), four tone variations ----
  //
  // WP-85a §3.2. The four tones sit `BOARD_TONE_SPREAD` apart rather than the
  // ±0.09 this shipped with — 1.08:1 between the two extremes instead of
  // 1.27:1 — and the seam is 0.20 alpha instead of 0.55. The parquet was the
  // loudest thing in the product and it carries no information; §2's first
  // principle is that the ground is quiet so the objects can speak.
  woodHerringboneA: '#DCC9AE',
  woodHerringboneB: '#d5c3a9',
  woodHerringboneC: '#ddcbb0',
  woodHerringboneD: '#dac7ac',
  woodHerringboneSeam: 'rgba(99,90,78,0.2)',
  woodHerringboneSheen: 'rgba(255,255,255,0.045)',

  /**
   * Circulation — the corridors between rooms. This MUST differ from every
   * room floor. When circulation and project rooms shared one carpet, room
   * boundaries were invisible and the floor read as furniture scattered on a
   * field rather than as rooms off corridors; a partition line alone was not
   * enough to carry the distinction at fit zoom.
   */
  circulationBase: '#D2CDC1',
  circulationSpeckle: 'rgba(116,113,106,0.13)',
  circulationEdge: 'rgba(116,113,106,0.2)',
  /** A single soft sheen along a run, so the surface reads as poured. */
  circulationSheen: 'rgba(255,255,255,0.16)',

  /**
   * Woven carpet (project rooms), warm grey — a WEAVE since WP-85a (§3.2).
   *
   * These were `carpetNoise*`, and the name was honest: `paintCarpet` scattered
   * up to six thousand single pixels of them, which reads as a dirty surface at
   * 1x and as sensor noise at 2x. A weave is directional and low-frequency and
   * salt is neither. Two hairline passes now, one horizontal and one vertical,
   * at the pitch `paintCarpet` owns.
   */
  carpetBase: CARPET_BASE,
  carpetWeaveLight: 'rgba(255,255,255,0.03)',
  carpetWeaveDark: 'rgba(116,113,108,0.09)',

  // ---- kitchen tile + grout (inside the lounge) ----
  tileBase: '#E3DFD6',
  tileGrout: 'rgba(125,123,118,0.16)',

  /**
   * The ground the whole building stands on, and the shadow it casts onto the
   * stage. The floor is the shape its contents want, so there is usually slack
   * on one axis; this is what makes that slack read as the edge of the
   * building rather than as a hole in it.
   */
  floorGround: '#DFDAD0',
  floorDropShadow: 'rgba(0, 0, 0, 0.55)',
  /**
   * The light the ground catches beside the building, and loses as it leaves
   * it (WP-72). A very gentle radial falloff centred on the envelope: this
   * where the floor ends, nothing at the furthest corner of the window.
   *
   * IT LIGHTS RATHER THAN DARKENS, and that is a measurement rather than a
   * preference. The first cut of this darkened outward, which is the obvious
   * reading of "darker away from the building" — and it moved the ground by
   * one channel count on the `wide` capture, because the ground the building
   * actually stands on is the chrome's `--bg` at `#131419` and there is no
   * darker to go. Same ramp, same direction, stated from the lit end: the
   * ground beside the slab is lifted and falls away to the page's own black.
   *
   * Cool, and colder than the floor, so the studio keeps the temperature
   * `docs/DEVIATIONS.md` §69 gave it — the warm thing in this window is the
   * building.
   */
  groundFalloff: 'rgba(126, 134, 158, 0.16)',

  /**
   * A room is a SLAB (WP-72). Two tokens say so:
   *
   *   `slabEdge`   the darker rim inside the room's two light-away sides —
   *                south and east, since the key light is upper-left. It is the
   *                thickness of the slab, seen from directly above.
   *   `slabShadow` the soft shadow that rim casts outward, onto the screed
   *                between rooms and across a shared partition.
   *
   * Same warm dark family as `wallAmbientOcclusion` and `shadowDeep`: the rim
   * and the wall's own occlusion band meet at every corner, and two different
   * darks meeting there reads as a smudge rather than as a corner.
   */
  slabEdge: 'rgba(61,60,59,0.22)',
  slabShadow: 'rgba(63,62,58,0.3)',

  /** Wash over a project room nobody is working in. */
  roomDimmed: 'rgba(58, 48, 38, 0.10)',

  /**
   * A POOL OF LIGHT (WP-85a §3.2).
   *
   * WP-72 gave this floor one key light and the floor spent it entirely on
   * shadow direction, which made it a rule about offsets rather than a light.
   * This is the other half: a soft warm radial, baked with the backdrop, over
   * the manager's desk, every working desk and every threshold — the places a
   * plan lights because that is where the work and the arriving happen.
   *
   * Warm on a floor whose chrome is cold by rule (DEVIATIONS §69), and that is
   * the point: the building is the lit thing in this window. The alpha is the
   * light theme's; a dark theme gets a little over half of it, because a dark
   * floor has far less headroom above it before a pool becomes a hole.
   */
  lightPool: 'rgba(255,233,196,0.1)',

  // ---- walls, partitions, doors ----
  wallFill: '#F4F1EA', // near-white, 5px thick
  wallEdge: '#d2cfc9',
  wallShadow: 'rgba(73,72,70,0.13)',
  wallAmbientOcclusion: 'rgba(61,60,59,0.16)', // gradient band, wall meets floor
  partitionFill: '#E0DACD', // waist-height, 0.3U thick, visually subordinate
  partitionEdge: '#c1bbb0',
  doorSwingArc: 'rgba(50,40,29,0.45)',

  // ---- shadows ----
  shadowContact: 'rgba(55,45,32,0.26)', // soft contact shadow under furniture
  shadowSoft: 'rgba(55,45,32,0.20)', // room plates, raised chrome
  shadowDeep: 'rgba(55,45,32,0.30)', // desks, benches, heavier pieces

  // ---- rugs ----
  rugSage: '#c2c9b4',
  rugCream: '#b5b9b9',
  rugBorder: 'rgba(255,255,255,0.36)',
  /** The rug's own outer edge, so it sits on the floor rather than in it. */
  rugEdge: 'rgba(123,120,114,0.28)',

  // ---- plants, four silhouettes share the same three leaf tones ----
  plantLeafA: '#6C8F63',
  plantLeafB: '#819f79',
  plantLeafC: '#5d7b55',
  plantPot: '#c6c0b2',
  /**
   * The trough a planter run is planted in, and the soil in it (WP-85c §3.6).
   *
   * A planter is a PARTITION that happens to be planted — it divides one lounge
   * bay from the next — so it is the partition's own material rather than the
   * pot's: a thing that reads as built into the floor, not as a row of pots
   * somebody put in a line.
   */
  planterTrough: '#E0DACD',
  planterSoil: '#7a7770',

  /**
   * BOOK SPINES, DESATURATED (WP-85c §3.5).
   *
   * *"Book spines lose their saturation: `bookA/B/C` derive from the desk
   * timber mixed halfway to three muted neutrals, so a shelf never competes
   * with an identity ring."* They were the marker blues, plums and felts — six
   * of the most saturated tokens on the floor, tiled twenty to a shelf, on the
   * one piece of furniture that is meant to read as texture.
   */
  bookA: '#998a73',
  bookB: '#b2a28a',
  bookC: '#cdbda3',

  // ---- thresholds: the screed band across a doorway, and the mat inside the
  // reception's (WP-85c §3.3) ----
  thresholdBand: '#c5c1b5',
  matFill: '#c1c1bc',
  matPile: 'rgba(112,109,104,0.22)',

  // ---- monitors ----
  monitorBody: '#33333A',
  monitorScreenGlow: 'rgba(150,190,205,0.55)',

  // ---- desks, benches, tables (wood tones) ----
  deskTop: '#C8AC84',
  deskEdge: '#a8906f',
  /**
   * The lit edge of a table top (WP-85b, §3.4's *"every table shows its edge"*).
   *
   * It replaces the `rgba(255,255,255,0.85)` centre divider every desk used to
   * carry, which was a near-white line — brighter than the wall on the default
   * theme — drawn down the middle of the one piece of furniture the person at it
   * is supposed to be the loud thing on. `sheenOver` holds the derived form
   * under the wall on every theme; this is the shipped default it caps.
   */
  deskSheen: 'rgba(255,255,255,0.16)',
  tableWood: '#DCC9AE',

  /**
   * WHAT IS ON A DESK (WP-85c §3.5): a mug, a notebook, a sticky note.
   *
   * Three tokens for four objects — the in-tray is the reception's `desk_tray`
   * and keeps its own — and all three are held UNDER the wall by the same
   * derivation everything else on this floor is. A sticky note is the one
   * object here anybody would draw in a saturated yellow, and a saturated
   * yellow 0.7 U across on every desk is forty small bright dots competing
   * with the one ring that means something (§1.2).
   */
  clutterCeramic: '#ddd6c7',
  clutterPaper: '#d9d2c4',
  clutterNote: '#c6bea0',

  // ---- task chairs, sofas ----
  chairFill: '#DCD5C6',
  chairEdge: '#c2bbae',
  chairBackrest: '#cdc6b8',
  /** Upholstery highlight on the seat pan, so a chair reads as padded. */
  chairCushion: 'rgba(255,255,255,0.24)',
  sofaFill: '#d5cfc0',
  /** Frame, arms and back — a shade darker than the cushions they hold. */
  sofaFrame: '#a7a296',
  sofaCushion: '#ddd6c7',
  sofaSeam: 'rgba(110,107,99,0.35)',

  // ---- metal furniture tone: chair frames, table legs, cabinet trim ----
  furnitureMetal: '#8C8474',

  // ---- kitchen fittings ----
  counterTop: '#ddd4c4',
  hob: '#3B3B40',
  sink: '#D8D3C8',
  fridgeFill: '#ddd6c8',

  // ---- arcade cabinet, board games, small accents ----
  //
  // MUTED SINCE WP-85c (§3, owner decision 5): *"the lounge games stay, muted
  // 22–26 % toward the room's own carpet"*. `GAME_HUES` above is what
  // they are muted FROM, and every value below is that table run through the
  // default theme's own derivation — which is also the first derivation these
  // six tokens have ever had. They were the one corner of this floor that read
  // the same at noon and on a night shift.
  cabinetBody: mutedGame('cabinetBody'),
  cabinetScreenGlow: 'rgba(150,190,205,0.55)',
  boardGameFelt: mutedGame('boardGameFelt'),

  // ---- the departures room ----
  boxFill: '#C8A574',
  boxFlap: '#B08D5E',
  boxTape: 'rgba(250,246,236,0.75)',
  exitGreen: '#3E7D57',

  // ---- games: pool and table tennis ----
  // The sage `boardGameFelt` is right for a card table but reads as plain
  // wood at play scale on a wood floor, which is how a pool table ended up
  // looking like an oval side table. Billiard cloth is its own colour and
  // needs to stay unmistakable next to the tan floor.
  poolFelt: mutedGame('poolFelt'),
  poolFeltLine: 'rgba(255,255,255,0.16)',
  poolRail: mutedGame('poolRail'),
  poolRailTop: mutedGame('poolRailTop'),
  poolPocket: '#241C15',
  poolCue: '#E8D9B8',
  ttBed: mutedGame('ttBed'),
  ttLine: 'rgba(255,255,255,0.85)',
  ttNet: '#E4E0D6',

  // ---- tinted near-black neutrals: text, strokes, ink ----
  inkWarm: '#32281D', // primary text / stroke, warm-tinted near-black
  inkCool: '#42392f', // secondary stroke, cool-tinted near-black (metal edges)
  inkSoft: '#746d65', // muted labels, sub-lines on room plates

  // ---- room chrome: plain-text room plates, no card (CONTRACTS-WP15.md §3)
  // ----  Darker than inkWarm/inkSoft on purpose: with the backing card gone,
  // this ink sits directly on wood or carpet, so it has to clear 4.5:1 on its
  // own against the darkest floor tone in the mix (woodHerringboneB) rather
  // than relying on an opaque plate behind it. Verified: >=4.68:1 against
  // every wood tone and carpetBase (see identity-visuals.test.mjs would be
  // the natural home for a runtime check, but this was hand-verified via the
  // same WCAG relative-luminance formula against every floor token above).
  /**
   * The halo drawn behind plate text and agent labels. Deliberately a warm
   * near-white rather than pure white: it has to lift letterforms off the
   * herringbone's plank seams without reading as a card, which is the thing
   * the floor is supposed to be free of.
   */
  plateHalo: 'rgba(252,250,244,0.92)',

  plateInk: '#32281D', // room name
  plateInkSecondary: '#4b4238', // one data line, a shade softer, still >=4.5:1

  // ---- the in-room "+" (CONTRACTS-WP15.md §5): a thin quiet vector cross,
  // never a button — no fill plate, no rounded rect, just a stroke that
  // brightens on hover so it stays discoverable.
  plusRest: 'rgba(50,40,29,0.55)', // resting stroke — quiet, still visible
  plusHover: '#32281D', // hover stroke — solid, same ink as the room plate
  plusHoverHalo: 'rgba(50,40,29,0.1)', // faint halo, hover only — not chrome

  // ---- whiteboard (project rooms, CONTRACTS-WP15.md §4) ----
  whiteboardSurface: '#dfd8cb', // glossy board face, cool off-white
  whiteboardSheen: 'rgba(255,255,255,0.22)', // gloss gradient highlight
  whiteboardMarkerBlue: '#3E6E8E',
  whiteboardMarkerPlum: '#7A5C7E',

  // ---- the manager (user's own avatar at the office desk): a suit. Fixed,
  // deliberately NOT a state colour — see the runtime guard below and
  // identity-visuals.test.mjs, which asserts this is nowhere near crimson.
  managerSuit: '#2B2F3A',
  managerShirt: '#F4F1E8',
  managerTie: '#3E5C6B',
});

/**
 * The materials as shipped, frozen. The floor's one true default: a theme is
 * a diff against this, and `resetPalette()` is how you get back to it exactly
 * — which is what keeps the default theme's goldens at 0 px.
 * @type {Readonly<Record<string, string>>}
 */
export const DEFAULT_PALETTE = Object.freeze({ ...BASE_PALETTE });

/**
 * The live materials list. Every renderer reads properties off this object at
 * paint time, so replacing a value here changes the next bake and nothing
 * else. See `BASE_PALETTE` above for why it is not frozen.
 * @type {Record<string, string>}
 */
export const PALETTE = { ...BASE_PALETTE };

/**
 * How close, in sRGB channel distance, a material may come to the reserved
 * crimson. The shipped floor's own closest approach is `poolRail` at 87, so
 * 60 is a real bar with room in it rather than a number chosen to pass.
 *
 * It is measured against crimson ALONE, and that is deliberate. The floor is
 * warm wood and warm grey, and `let_go` (`#BDB7AA`) is warm grey too — the
 * default herringbone sits 52 from it — so a distance rule over all seven
 * states would fail the floor this product already ships. Crimson is the one
 * colour that must mean exactly one thing, and it is the one a material is
 * held away from.
 */
export const CRIMSON_MIN_DISTANCE = 60;

/**
 * WCAG 2.x relative luminance, for the renderer.
 *
 * A third copy — `themes.js` has the product's own and the test suite has the
 * independent check on it — and it is here rather than imported because
 * `rig-body.js` must be able to ask "is this floor dark?" without pulling in the
 * theme machinery that repaints it. Three lines of the same arithmetic against
 * a module cycle is not a close call.
 *
 * @param {string} colour `#rrggbb`; anything else reads as black.
 */
export function relativeLuminanceOf(colour) {
  const ch = channelsOf(colour);
  if (!ch) return 0;
  const lin = ch.map((n) => {
    const c = n / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/**
 * Which halo device the floor is currently painted for (§3.9): a ground POOL on
 * a light floor, a thin RIM on a dark one.
 *
 * Reads the LIVE palette rather than a theme name, so it is right the moment
 * `overridePalette` returns and a caller never has to be told which theme it is
 * drawing. `plateInk` is the switch because it is the floor's line work, which
 * is the same test the theme derivation itself uses to decide which way every
 * halo on this floor goes.
 *
 * @returns {'pool'|'rim'}
 */
export function figureHaloMode() {
  return relativeLuminanceOf(PALETTE.plateInk) > 0.5 ? 'rim' : 'pool';
}

/** @param {string} hex @returns {[number,number,number]|null} */
export function channelsOf(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  return /** @type {[number,number,number]} */ (
    [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
  );
}

/**
 * The colour discipline, as a function rather than as a one-shot IIFE, so a
 * theme is held to the same rule the shipped materials are.
 *
 * Two clauses, and each has a reason rather than a taste:
 *
 *   1. **No crimson, ever.** `#C0392B` means "standing in your office" and
 *      nothing else may wear it (VISUAL-SPEC §5). A literal match catches the
 *      obvious case.
 *   2. **No near-miss on crimson**, at `CRIMSON_MIN_DISTANCE`. Clause 1 alone
 *      would let a theme paint the carpet `#C13A2C`, which is the same
 *      failure with one bit of deniability.
 *
 * @param {Record<string, string>} tokens
 * @param {string} where what to name in the error
 */
export function assertMaterialDiscipline(tokens, where = 'PALETTE') {
  const crimson = RESERVED_CRIMSON.toLowerCase();
  for (const [name, value] of Object.entries(tokens)) {
    if (typeof value !== 'string') continue;
    if (value.toLowerCase().includes(crimson)) {
      throw new Error(
        `palette.js: ${where}.${name} uses the reserved crimson (${RESERVED_CRIMSON}). ` +
          'Crimson is reserved for for_review and primary actions only — see VISUAL-SPEC §5.',
      );
    }
    const rgb = channelsOf(value);
    if (!rgb) continue; // rgba()/gradient strings carry no flat colour to measure
    const red = /** @type {[number,number,number]} */ (channelsOf(RESERVED_CRIMSON));
    const d = Math.hypot(rgb[0] - red[0], rgb[1] - red[1], rgb[2] - red[2]);
    if (d < CRIMSON_MIN_DISTANCE) {
      throw new Error(
        `palette.js: ${where}.${name} (${value}) is only ${d.toFixed(1)} from the ` +
          `reserved crimson (${RESERVED_CRIMSON}); nothing decorative may approach ` +
          'the one colour that means "standing in your office" — see VISUAL-SPEC §5.',
      );
    }
  }
}

/**
 * Apply a theme's material tokens over the defaults. Only keys the default
 * palette already has may be written — a theme cannot invent a token, and it
 * cannot reach a state colour, an identity colour or the accent, because none
 * of those is in this object. The whole result is re-checked, so a theme is
 * refused at the moment it is applied rather than on the floor.
 *
 * @param {Record<string, string>} tokens
 */
export function overridePalette(tokens) {
  /** @type {Record<string, string>} */
  const next = { ...DEFAULT_PALETTE };
  for (const [name, value] of Object.entries(tokens || {})) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_PALETTE, name)) {
      throw new Error(`palette.js: no material token named "${name}"`);
    }
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`palette.js: material token "${name}" must be a colour string`);
    }
    next[name] = value;
  }
  assertMaterialDiscipline(next, 'theme');
  Object.assign(PALETTE, next);
}

/** Put every material back exactly as it shipped. */
export function resetPalette() {
  Object.assign(PALETTE, DEFAULT_PALETTE);
}

/**
 * Blend two `#rrggbb` colours, `t` of the way from `a` to `b`.
 *
 * A second copy of `themes.js`'s `mix`, and deliberately: that one is part of
 * the theme DERIVATION and lives with the rest of it, while this one is
 * reachable from a renderer that must not import the theme machinery to paint
 * a carpet. Both are three lines of the same arithmetic; the alternative is a
 * renderer that depends on the module that repaints it.
 *
 * Returns `a` unchanged if either colour is not a flat `#rrggbb` — a themed
 * token is validated on the way in, so this is the branch a malformed pack
 * takes rather than one that ever runs in the product.
 *
 * @param {string} a @param {string} b @param {number} t 0 is all `a`, 1 all `b`
 * @returns {string}
 */
export function mixHex(a, b, t) {
  const x = channelsOf(a);
  const y = channelsOf(b);
  if (!x || !y) return a;
  const k = Math.min(1, Math.max(0, Number(t) || 0));
  return `#${x
    .map((n, i) =>
      Math.round(n + (y[i] - n) * k)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/**
 * The carpet a project room is actually painted in (WP-72): the theme's carpet
 * moved `CARPET_IDENTITY_WASH` of the way toward that project's identity
 * colour.
 *
 * One function, called by the renderer that paints it and by the contrast test
 * that measures it, so the surface the suite proves readable is the surface the
 * bake puts on the floor.
 *
 * @param {string} carpet the theme's carpet, `#rrggbb`
 * @param {string|null|undefined} tint the project's identity accent
 * @param {number} [amount]
 * @returns {string}
 */
export function washedCarpet(carpet, tint, amount = CARPET_IDENTITY_WASH) {
  if (!tint) return carpet;
  return mixHex(carpet, tint, Math.min(CARPET_IDENTITY_WASH, amount));
}

/**
 * The same colour at zero alpha — the far stop of a soft band or a gradient
 * that has to fade into nothing rather than into a colour.
 *
 * Stated as a function because a gradient whose transparent stop is a
 * DIFFERENT hue (`rgba(0,0,0,0)` against a warm shadow, say) interpolates
 * through that hue in premultiplied space and leaves a grey bloom along the
 * band — which is the banding this exists to avoid.
 *
 * @param {string} colour
 * @returns {string}
 */
export function fadedOut(colour) {
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(String(colour));
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},0)`;
  const ch = channelsOf(colour);
  return ch ? `rgba(${ch[0]},${ch[1]},${ch[2]},0)` : 'rgba(0,0,0,0)';
}

/** sRGB distance between two `#rrggbb` colours. @param {string} a @param {string} b */
export function colourDistance(a, b) {
  /** @param {string} hex */
  const ch = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const x = ch(a);
  const y = ch(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
