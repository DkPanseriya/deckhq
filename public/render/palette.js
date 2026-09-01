/**
 * DeckHQ colour tokens — shared by every renderer module (rig, clips, scene,
 * plan, backdrop). Pure data, no DOM, no canvas. Safe to import in Node.
 *
 * docs/03-VISUAL-SPEC.md §5 (state colours) and §6 (materials).
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
const RESERVED_CRIMSON = STATE_COLORS.for_review;

/**
 * Material and furniture colour tokens for the baked backdrop. Every entry
 * name says what it paints, not just what colour it is, so backdrop.js reads
 * like a materials list rather than a swatch book.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PALETTE = Object.freeze({
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

// ---- runtime colour-discipline guard --------------------------------------
// Crimson may exist exactly once in this module: as STATE_COLORS.for_review.
// If it ever appears in a material/furniture token, fail loudly at import
// time rather than let a decorative red creep onto the floor.
(function assertNoDecorativeCrimson() {
  const crimson = RESERVED_CRIMSON.toLowerCase();
  for (const [name, value] of Object.entries(PALETTE)) {
    if (typeof value === 'string' && value.toLowerCase().includes(crimson)) {
      throw new Error(
        `palette.js: PALETTE.${name} uses the reserved crimson (${RESERVED_CRIMSON}). ` +
          'Crimson is reserved for for_review and primary actions only — see VISUAL-SPEC §5.',
      );
    }
  }
})();

// ---------------------------------------------------------------------------
// Per-project appearance (CONTRACTS-WP15.md §2).
//
// The state colour owns the torso — that is the entire legibility model
// (VISUAL-SPEC §5: crimson means "standing in your office" and nothing else
// may wear it) and it is NOT negotiable. Project identity therefore rides on
// everything except the torso: hair, a small clothing accent, and a vector
// glyph (rig.js draws all three; this module only supplies the data).
//
// 14 entries (>= the 12 CONTRACTS-WP15.md requires) spanning hue 65-300 —
// olive through green, teal, blue, indigo, violet, magenta — deliberately
// stopping well short of the red/red-orange band crimson (#C0392B, hue ~5)
// lives in, so no identity colour can be mistaken for the one colour that
// must mean a single specific thing. identity-visuals.test.mjs computes the
// actual distance rather than trusting this comment.
/**
 * @type {ReadonlyArray<{hair:string, accent:string, glyph:string}>}
 */
export const PROJECT_IDENTITIES = Object.freeze(
  [
    { hair: '#555926', accent: '#B5BF40', glyph: 'hex' },
    { hair: '#465926', accent: '#8EBF40', glyph: 'triangle' },
    { hair: '#365926', accent: '#68BF40', glyph: 'square' },
    { hair: '#275926', accent: '#41BF40', glyph: 'diamond' },
    { hair: '#265935', accent: '#40BF65', glyph: 'drop' },
    { hair: '#265944', accent: '#40BF8B', glyph: 'star' },
    { hair: '#265954', accent: '#40BFB1', glyph: 'cross' },
    { hair: '#264F59', accent: '#40A7BF', glyph: 'ring' },
    { hair: '#264059', accent: '#4080BF', glyph: 'hex' },
    { hair: '#263159', accent: '#405ABF', glyph: 'triangle' },
    { hair: '#2B2659', accent: '#4C40BF', glyph: 'square' },
    { hair: '#3B2659', accent: '#7240BF', glyph: 'diamond' },
    { hair: '#4A2659', accent: '#9940BF', glyph: 'drop' },
    { hair: '#592659', accent: '#BF40BF', glyph: 'star' },
  ].map((entry) => Object.freeze(entry)),
);

/**
 * The vector glyph vocabulary (CONTRACTS-WP15.md §2). Drawn as small vector
 * paths in rig.js — no fonts, no emoji.
 * @type {ReadonlyArray<string>}
 */
export const AVATAR_GLYPHS = Object.freeze([
  'hex',
  'triangle',
  'square',
  'diamond',
  'drop',
  'star',
  'cross',
  'ring',
]);

/**
 * Resolve a project's visual identity. Deterministic and stable in
 * `projectMk` alone (CONTRACTS-WP15.md §1: MK numbers are assigned once and
 * persisted, so an identity derived purely from that number never drifts
 * when projects re-sort). `avatarOverride` — a user-chosen glyph, carried
 * per-agent as `agent.avatar` — wins over the derived glyph when it names a
 * real member of `AVATAR_GLYPHS`; hair and accent are project-level and have
 * no override (CONTRACTS-WP15.md §2's table: only the glyph row says "or
 * per-agent override").
 *
 * Tolerant of bad input on purpose: a project whose MK has not resolved yet
 * (0, negative, `NaN`, a float) still gets a valid, deterministic identity
 * rather than throwing — better a wrong-looking but harmless colour than a
 * crashed render.
 *
 * @param {number} projectMk
 * @param {string|null} [avatarOverride]
 * @returns {{hair:string, accent:string, glyph:string}}
 */
export function identityFor(projectMk, avatarOverride) {
  const n = Number.isFinite(projectMk) ? Math.trunc(projectMk) : 0;
  const len = PROJECT_IDENTITIES.length;
  const idx = (((n - 1) % len) + len) % len;
  const base = PROJECT_IDENTITIES[idx];
  const glyph = AVATAR_GLYPHS.includes(avatarOverride) ? avatarOverride : base.glyph;
  return { hair: base.hair, accent: base.accent, glyph };
}
