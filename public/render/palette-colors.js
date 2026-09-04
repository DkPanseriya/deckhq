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
export const BASE_PALETTE = /** @type {Record<string, string>} */ ({
  // ---- herringbone wood floor (office + lounge), four tone variations ----
  woodHerringboneA: '#CBA87A',
  woodHerringboneB: '#BE9868',
  woodHerringboneC: '#D6B98A',
  woodHerringboneD: '#C4A074',
  woodHerringboneSeam: 'rgba(105,76,44,0.55)',
  woodHerringboneSheen: 'rgba(255,255,255,0.10)',

  /**
   * Circulation — the corridors between rooms. This MUST differ from every
   * room floor. When circulation and project rooms shared one carpet, room
   * boundaries were invisible and the floor read as furniture scattered on a
   * field rather than as rooms off corridors; a partition line alone was not
   * enough to carry the distinction at fit zoom.
   */
  circulationBase: '#CFC9BC',
  circulationSpeckle: 'rgba(120,112,98,0.13)',
  circulationEdge: 'rgba(120,112,98,0.20)',
  /** A single soft sheen along a run, so the surface reads as poured. */
  circulationSheen: 'rgba(255,255,255,0.28)',

  // ---- woven carpet (project rooms), warm grey, two-tone noise ----
  carpetBase: '#E4DFD3',
  carpetNoiseLight: 'rgba(255,255,255,0.55)',
  carpetNoiseDark: 'rgba(150,140,125,0.16)',

  // ---- kitchen tile + grout (inside the lounge) ----
  tileBase: '#EDEAE4',
  tileGrout: 'rgba(140,132,118,0.16)',

  /**
   * The ground the whole building stands on, and the shadow it casts onto the
   * stage. The floor is the shape its contents want, so there is usually slack
   * on one axis; this is what makes that slack read as the edge of the
   * building rather than as a hole in it.
   */
  floorGround: '#E3DED4',
  floorDropShadow: 'rgba(0, 0, 0, 0.55)',

  /** Wash over a project room nobody is working in. */
  roomDimmed: 'rgba(58, 48, 38, 0.10)',

  // ---- walls, partitions, doors ----
  wallFill: '#FCFBF8', // near-white, 5px thick
  wallEdge: '#CFC9BE',
  wallShadow: 'rgba(60,50,38,0.13)',
  wallAmbientOcclusion: 'rgba(70,58,42,0.16)', // gradient band, wall meets floor
  partitionFill: '#E7E2D6', // waist-height, 0.3U thick, visually subordinate
  partitionEdge: '#C9C2B2',
  doorSwingArc: 'rgba(140,132,118,0.45)',

  // ---- shadows ----
  shadowContact: 'rgba(55,45,32,0.26)', // soft contact shadow under furniture
  shadowSoft: 'rgba(55,45,32,0.20)', // room plates, raised chrome
  shadowDeep: 'rgba(55,45,32,0.30)', // desks, benches, heavier pieces

  // ---- rugs ----
  rugSage: '#C8D3C5',
  rugCream: '#E6E0D2',
  rugBorder: 'rgba(255,255,255,0.6)',
  /** The rug's own outer edge, so it sits on the floor rather than in it. */
  rugEdge: 'rgba(120,112,98,0.28)',

  // ---- plants, three scales share the same three leaf tones ----
  plantLeafA: '#6F8F5E',
  plantLeafB: '#87A874',
  plantLeafC: '#587A49',
  plantPot: '#D9D2C4',

  // ---- monitors ----
  monitorBody: '#33333A',
  monitorScreenGlow: 'rgba(150,190,205,0.55)',

  // ---- desks, benches, tables (wood tones) ----
  deskTop: '#D8BD97',
  deskEdge: '#B29470',
  tableWood: '#CBA87A',

  // ---- task chairs, sofas ----
  chairFill: '#FBFAF7',
  chairEdge: '#D2CCC1',
  chairBackrest: '#D6CDBD',
  /** Upholstery highlight on the seat pan, so a chair reads as padded. */
  chairCushion: 'rgba(255, 255, 255, 0.42)',
  sofaFill: '#EFECE4',
  /** Frame, arms and back — a shade darker than the cushions they hold. */
  sofaFrame: '#E4E0D6',
  sofaCushion: '#F7F5EF',
  sofaSeam: 'rgba(150,142,126,0.35)',

  // ---- metal furniture tone: chair frames, table legs, cabinet trim ----
  furnitureMetal: '#8C8474',

  // ---- kitchen fittings ----
  counterTop: '#F0EDE6',
  hob: '#3B3B40',
  sink: '#D8D3C8',
  fridgeFill: '#F2F0EA',

  // ---- arcade cabinet, board games, small accents ----
  cabinetBody: '#5B5560',
  cabinetScreenGlow: 'rgba(150,190,205,0.55)',
  boardGameFelt: '#7E9481',

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
  poolFelt: '#2F6B4F',
  poolFeltLine: 'rgba(255,255,255,0.16)',
  poolRail: '#6B4A2E',
  poolRailTop: '#8A6238',
  poolPocket: '#241C15',
  poolCue: '#E8D9B8',
  ttBed: '#2E5F80',
  ttLine: 'rgba(255,255,255,0.85)',
  ttNet: '#E4E0D6',

  // ---- tinted near-black neutrals: text, strokes, ink ----
  inkWarm: '#4A4438', // primary text / stroke, warm-tinted near-black
  inkCool: '#3A3D40', // secondary stroke, cool-tinted near-black (metal edges)
  inkSoft: '#8C8474', // muted labels, sub-lines on room plates

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

  plateInk: '#33291E', // room name
  plateInkSecondary: '#3E3222', // one data line, a shade softer, still >=4.5:1

  // ---- the in-room "+" (CONTRACTS-WP15.md §5): a thin quiet vector cross,
  // never a button — no fill plate, no rounded rect, just a stroke that
  // brightens on hover so it stays discoverable.
  plusRest: 'rgba(140,132,116,0.55)', // resting stroke — quiet, still visible
  plusHover: '#33291E', // hover stroke — solid, same ink as the room plate
  plusHoverHalo: 'rgba(51,41,30,0.10)', // faint halo, hover only — not chrome

  // ---- whiteboard (project rooms, CONTRACTS-WP15.md §4) ----
  whiteboardSurface: '#F2F6F5', // glossy board face, cool off-white
  whiteboardSheen: 'rgba(255,255,255,0.50)', // gloss gradient highlight
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
