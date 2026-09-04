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
const BASE_PALETTE = /** @type {Record<string, string>} */ ({
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
const CRIMSON_MIN_DISTANCE = 60;

/** @param {string} hex @returns {[number,number,number]|null} */
function channelsOf(hex) {
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

// ---- runtime colour-discipline guard --------------------------------------
// The shipped materials are held to the same rule a theme is, at import time,
// so a decorative red cannot creep onto the floor from either direction.
assertMaterialDiscipline(DEFAULT_PALETTE, 'PALETTE');

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

// ---------------------------------------------------------------------------
// Per-AGENT appearance and rarity (WP-20; docs/plan/04 §4, docs/plan/08 §7).
//
// The project channel above is unchanged: hair COLOUR, the collar accent and
// the glyph still say which project an agent belongs to (DEVIATIONS §30's
// split). What is added here is the second, orthogonal channel — who this
// particular session *is*: hair style, skin tone, an outfit accent, glasses
// and build, plus a rarity trait on a small fraction of agents.
//
// Three rules govern every table below, and each has a test:
//   1. The torso is the STATE colour and nothing here touches it. Every mark
//      is off-torso (head, neckline, waistband, sleeve) or a thin edge.
//   2. No appearance colour may sit near crimson — the reserved for_review
//      tone — or near ANY state colour. A waistband that reads as copper
//      beside a copper torso is a legibility bug, not a decoration.
//   3. Appearance is a pure function of the session id. It is never rolled,
//      never stored, never re-rolled, and it changes no state and no count.
//      Nothing is earned and nothing decays (docs/plan/04 §5).

/**
 * Skin tones, light to deep. Six, no two closer than 42 in sRGB, so nobody
 * reads as the same person at 16 px. `#E4B98E` (index 1) is the single tone
 * every agent used before this package, so an existing floor keeps a familiar
 * face in the mix rather than shifting wholesale.
 *
 * Skin is held to a LOWER bar than clothing — 40 from every state colour, not
 * the 70 the tables below clear — and the difference is deliberate. Mid-brown
 * is a band `needs_input` copper (#B87333) and `stalled` olive (#9A7B4F)
 * genuinely occupy, and a colour discipline that excluded it would have
 * excluded a whole range of real faces to protect a channel skin does not
 * carry: skin is a fixed shape in a fixed place (a head above a torso, two
 * hands at the ends of two arms), never an area that could be read as the body
 * colour. Clothing, which sits ON the body, keeps the strict bar. The tightest
 * pair in this table is 44.5 and the nearest approach to crimson is 82.5 —
 * measured in identity-visuals.test.mjs, not eyeballed.
 * @type {ReadonlyArray<string>}
 */
export const AGENT_SKINS = Object.freeze([
  '#F7E0C8',
  '#E4B98E',
  '#CE9A6E',
  '#96543A',
  '#6E3A22',
  '#4A2616',
]);

/**
 * Hair silhouettes. `rig.js` draws each as a variation on the same
 * back-of-the-head cap, so they differ in OUTLINE — the only channel that
 * survives being drawn 16 px tall — rather than in detail.
 * @type {ReadonlyArray<string>}
 */
export const AGENT_HAIR_STYLES = Object.freeze(['crop', 'short', 'bob', 'tuft', 'bun', 'long']);

/**
 * Outfit accents: the waistband, and the colour a hat or scarf is made of.
 * Every entry is at least 70 in sRGB distance from every entry in
 * STATE_COLORS (measured, not eyeballed — the runtime guard at the bottom of
 * this file and identity-visuals.test.mjs both recompute it), which is why the
 * orange-copper and olive bands are missing: those are `needs_input` and
 * `stalled`, and an agent must never wear a state.
 * @type {ReadonlyArray<string>}
 */
export const AGENT_ACCENTS = Object.freeze([
  '#F2C14E', // amber
  '#6FCF3F', // lime
  '#2FC7A8', // teal
  '#5ED0EE', // sky
  '#5B8FF9', // cornflower
  '#9B7EDE', // violet
  '#C56BE8', // orchid
  '#E86AA6', // pink
]);

/**
 * Torso scale. A silhouette cue, deliberately small: ±8% is readable when two
 * agents stand together and invisible as "a different size of person" when
 * one stands alone. It scales the torso only — never the head, the limb
 * geometry, the chrome or the label — so nothing that carries meaning moves.
 * @type {ReadonlyArray<number>}
 */
export const AGENT_BUILDS = Object.freeze([0.92, 1.0, 1.08]);

/**
 * The rare hair colours (the `hair` trait). Striking on purpose and nowhere
 * near any state colour; they replace the project's hair tone for the ~2.5% of
 * agents that draw them, which is the one place the per-agent channel is
 * allowed to overrule the project channel — see DEVIATIONS.
 * @type {ReadonlyArray<string>}
 */
export const RARE_HAIR_COLORS = Object.freeze(['#7B3FD9', '#1FA8C4', '#C56BE8', '#2FC7A8']);

/**
 * Jacket tones (the `jacket` trait): dark garment colours drawn as a yoke and
 * two lapels over the shoulders. Deep enough to read as tailoring against
 * every state colour, and far enough from all of them to never be mistaken
 * for one.
 * @type {ReadonlyArray<string>}
 */
export const JACKET_COLORS = Object.freeze(['#1B2E3F', '#3A2350', '#4A1F3C', '#0F3A46']);

/** The one legendary metal. Not a state colour, not crimson, not decorative red. */
export const CROWN_GOLD = '#E8C15A';

// ---------------------------------------------------------------------------
// Avatar sets from a pack (WP-45)
//
// The two tables above are the ones `appearanceFor` draws from, and an
// installed asset pack may replace them with a set of its own. Two properties
// make that safe to do to a channel whose whole point is that it never
// changes (see `appearanceRng`):
//
//   1. **It is opt-in and it is a setting.** `settings.avatarSet` is empty on
//      every install, including one with a pack installed, and empty means
//      these tables. Nobody's floor changes because a file appeared in a
//      directory; it changes because they picked a set, and picking the empty
//      row puts every face back exactly.
//   2. **A pack cannot lower the bar.** `overrideAvatarPools` re-runs the same
//      >= 70-from-every-state-colour discipline the guard at the bottom of
//      this file runs over the shipped tables, and throws with the offending
//      pair named. A set that could paint an agent in a state colour cannot be
//      applied, whoever signed it.
//
// The draw ORDER is untouched, so a set with the same table lengths gives
// every agent the same index — the same person in different clothes rather
// than a different person.
// ---------------------------------------------------------------------------

/** @type {ReadonlyArray<string>} */
let ACCENT_POOL = AGENT_ACCENTS;
/** @type {ReadonlyArray<string>} */
let JACKET_POOL = JACKET_COLORS;

/**
 * The tables `appearanceFor` is drawing from right now.
 * @returns {{accents:ReadonlyArray<string>, jackets:ReadonlyArray<string>, name:string}}
 */
export function avatarPools() {
  return { accents: ACCENT_POOL, jackets: JACKET_POOL, name: APPLIED_AVATAR_SET };
}

/** Which set is applied, or `''` for the shipped tables. */
let APPLIED_AVATAR_SET = '';

/**
 * Hold a table of clothing colours to the rule the shipped ones are held to.
 * Exported so `src/core/packs.mjs` and the test suite measure with the same
 * function the renderer defends itself with, rather than a second copy of the
 * number.
 *
 * @param {string} where  what to name in the error
 * @param {ReadonlyArray<string>} list
 * @param {number} [floor]
 */
export function assertAvatarColours(where, list, floor = 70) {
  for (const colour of list || []) {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(colour))) {
      throw new Error(`palette.js: ${where} entry ${colour} is not a #rrggbb colour`);
    }
    for (const [state, value] of Object.entries(STATE_COLORS)) {
      const d = colourDistance(String(colour), value);
      if (d < floor) {
        throw new Error(
          `palette.js: ${where} entry ${colour} is only ${d.toFixed(1)} from ` +
            `STATE_COLORS.${state} (${value}); an agent's clothes must never ` +
            'imitate a state — see VISUAL-SPEC §5.',
        );
      }
    }
  }
}

/**
 * Draw faces from a pack's tables instead of the shipped ones. Throws, and
 * changes nothing, if either table would let an agent wear a state.
 *
 * @param {{name?:string, accents?:ReadonlyArray<string>, jackets?:ReadonlyArray<string>}} set
 * @returns {string} the set name that was applied
 */
export function overrideAvatarPools(set) {
  const accents = set?.accents?.length ? set.accents.map((c) => String(c)) : null;
  const jackets = set?.jackets?.length ? set.jackets.map((c) => String(c)) : null;
  if (!accents || !jackets)
    throw new Error('an avatar set needs both an accents and a jackets table');
  assertAvatarColours('an avatar set’s accents', accents);
  assertAvatarColours('an avatar set’s jackets', jackets);
  ACCENT_POOL = Object.freeze(accents);
  JACKET_POOL = Object.freeze(jackets);
  APPLIED_AVATAR_SET = String(set?.name || '');
  return APPLIED_AVATAR_SET;
}

/** Back to the shipped tables, byte for byte. */
export function resetAvatarPools() {
  ACCENT_POOL = AGENT_ACCENTS;
  JACKET_POOL = JACKET_COLORS;
  APPLIED_AVATAR_SET = '';
}

/**
 * Avatar sets an installed pack brought (WP-45).
 *
 * A registry rather than an append to the tables above, for exactly the
 * reason `PACK_THEMES` in `themes.js` is one: the shipped tables stay frozen,
 * stay what the identity tests measure, and stay what an install with no pack
 * draws from. This list is empty on every such install.
 * @type {Array<{name:string, blurb:string, accents:string[], jackets:string[], pack:string}>}
 */
const PACK_AVATAR_SETS = [];

/**
 * @param {string} packName
 * @param {ReadonlyArray<any>} sets
 * @returns {{added:string[], rejected:string[]}}
 */
export function registerPackAvatarSets(packName, sets) {
  /** @type {string[]} */
  const added = [];
  /** @type {string[]} */
  const rejected = [];
  for (const set of sets || []) {
    const name = String(set?.name ?? '')
      .trim()
      .toLowerCase();
    if (!name) {
      rejected.push('an avatar set with no name');
      continue;
    }
    if (PACK_AVATAR_SETS.some((s) => s.name === name)) {
      rejected.push(`avatar set "${name}" is already registered by another pack`);
      continue;
    }
    try {
      assertAvatarColours(`avatar set "${name}" accents`, set.accents || []);
      assertAvatarColours(`avatar set "${name}" jackets`, set.jackets || []);
    } catch (err) {
      rejected.push(`avatar set "${name}": ${(err && /** @type {any} */ (err).message) || err}`);
      continue;
    }
    PACK_AVATAR_SETS.push({
      name,
      blurb: String(set.blurb || ''),
      accents: [...set.accents],
      jackets: [...set.jackets],
      pack: String(packName || ''),
    });
    added.push(name);
  }
  return { added, rejected };
}

/** Forget every registered avatar set, and go back to the shipped tables. */
export function clearPackAvatarSets() {
  PACK_AVATAR_SETS.length = 0;
  resetAvatarPools();
}

/** Every set that can be chosen. The shipped tables are the empty name. */
export function avatarSets() {
  return [...PACK_AVATAR_SETS];
}

/**
 * One registered set by name, or `null`. Case- and separator-insensitive on
 * the way in, the same way `themeByName` is.
 * @param {unknown} name
 */
export function avatarSetByName(name) {
  const key = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');
  if (!key) return null;
  return PACK_AVATAR_SETS.find((s) => s.name === key) || null;
}

/**
 * The `settings.avatarSet` sanitizer's rule, in one place: only a set some
 * installed pack actually registered may be selected, and anything else — a
 * hand-edited `state.json`, a set from a pack that has since been removed —
 * reads back as the shipped tables. A set name is not a path and is never
 * opened.
 * @param {unknown} v
 */
export function sanitizeAvatarSetName(v) {
  const set = avatarSetByName(v);
  return set ? set.name : '';
}

/**
 * Dress every agent from a named set, or from the shipped tables for `''`.
 * Returns the name that was actually applied, so a caller can tell whether it
 * got what it asked for.
 * @param {unknown} name
 * @returns {string}
 */
export function applyAvatarSet(name) {
  const set = avatarSetByName(name);
  if (!set) {
    resetAvatarPools();
    return '';
  }
  return overrideAvatarPools(set);
}

/** sRGB distance between two `#rrggbb` colours. @param {string} a @param {string} b */
function colourDistance(a, b) {
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

/**
 * Rarity tiers, commonest first. `common` is the ABSENCE of a trait, not a
 * trait.
 * @type {ReadonlyArray<'common'|'uncommon'|'rare'|'legendary'>}
 */
export const RARITY_TIERS = Object.freeze(['common', 'uncommon', 'rare', 'legendary']);

/**
 * The target share of agents in each tier, from docs/plan/08 §7 verbatim:
 * "common, uncommon, rare 5%, legendary 1%". `common` is the remainder.
 * @type {Readonly<Record<string, number>>}
 */
export const RARITY_TARGETS = Object.freeze({
  common: 0.74,
  uncommon: 0.2,
  rare: 0.05,
  legendary: 0.01,
});

/**
 * The trait each tier can carry. One trait per agent, never two — the point of
 * a rare agent is that you notice it, and two marks read as noise.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const RARITY_TRAITS = Object.freeze({
  common: Object.freeze([]),
  uncommon: Object.freeze(['hat', 'scarf']),
  rare: Object.freeze(['jacket', 'hair']),
  legendary: Object.freeze(['crown', 'glow']),
});

/**
 * FNV-1a over the session id, 32-bit.
 *
 * Deliberately NOT `agents.js`'s `hashString`, even though the two would give
 * equally good spreads. That one seeds seat and lounge-spot assignment;
 * sharing it would mean that tuning where somebody sits re-rolls everybody's
 * face, and a face that changes is the one thing this package exists to
 * prevent. Two hashes with two jobs is the cheap answer.
 * @param {string} str
 * @returns {number} unsigned 32-bit
 */
function appearanceHash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * mulberry32: small, fast, well-distributed. Seeded once from the session id,
 * then drawn from in a FIXED order — appending a new draw at the end is safe,
 * inserting one in the middle re-rolls every face after it.
 * @param {number} seed
 * @returns {() => number} successive values in [0, 1)
 */
function appearanceRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @template T
 * @param {() => number} rng
 * @param {ReadonlyArray<T>} list
 * @returns {T}
 */
function pick(rng, list) {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

/**
 * @typedef {object} Appearance
 * @property {string} hairStyle        a member of AGENT_HAIR_STYLES
 * @property {string|null} hairColor   a rare hair colour, or null to keep the project's
 * @property {string} skin             a member of AGENT_SKINS
 * @property {string} accent           a member of AGENT_ACCENTS
 * @property {boolean} glasses
 * @property {number} build            a member of AGENT_BUILDS
 * @property {'common'|'uncommon'|'rare'|'legendary'} tier
 * @property {string|null} trait       the rarity trait, or null for common
 * @property {string|null} traitColor  the colour that trait is drawn in, or null
 */

/**
 * This session's face. A pure, total function of the session id: the same id
 * gives the same face in every process, on every machine, forever, with
 * nothing persisted and nothing to migrate.
 *
 * Tolerant of bad input for the same reason `identityFor` is — an agent whose
 * id has not resolved yet must still draw, so `null`/`undefined`/a number each
 * yield a valid (if uninteresting) appearance rather than a throw.
 *
 * @param {string} sessionId
 * @returns {Appearance}
 */
export function appearanceFor(sessionId) {
  const key =
    typeof sessionId === 'string' ? sessionId : sessionId == null ? '' : String(sessionId);
  const rng = appearanceRng(appearanceHash(key));

  // Draw order is part of the contract — see appearanceRng.
  const hairStyle = pick(rng, AGENT_HAIR_STYLES);
  const skin = pick(rng, AGENT_SKINS);
  const accent = pick(rng, ACCENT_POOL);
  const glasses = rng() < 0.3;
  const build = pick(rng, AGENT_BUILDS);

  // The tier comes from its own draw, so the split is exactly the table above
  // and inherits no bias from the choices before it.
  const roll = rng();
  const legendaryEdge = RARITY_TARGETS.legendary;
  const rareEdge = legendaryEdge + RARITY_TARGETS.rare;
  const uncommonEdge = rareEdge + RARITY_TARGETS.uncommon;
  const tier =
    roll < legendaryEdge
      ? 'legendary'
      : roll < rareEdge
        ? 'rare'
        : roll < uncommonEdge
          ? 'uncommon'
          : 'common';

  const options = RARITY_TRAITS[tier];
  const trait = options.length ? pick(rng, options) : null;

  let hairColor = null;
  let traitColor = null;
  if (trait === 'hair') {
    hairColor = pick(rng, RARE_HAIR_COLORS);
    traitColor = hairColor;
  } else if (trait === 'jacket') {
    traitColor = pick(rng, JACKET_POOL);
  } else if (trait === 'crown') {
    traitColor = CROWN_GOLD;
  } else if (trait) {
    // hat, scarf, glow: the agent's own accent, so a rare agent still reads as
    // one person rather than as a person plus an unrelated object.
    traitColor = accent;
  }

  return { hairStyle, hairColor, skin, accent, glasses, build, tier, trait, traitColor };
}

/**
 * The one quiet word the interface is allowed to say about rarity, or `null`
 * for a common agent (which is most of them, and which gets no word at all).
 *
 * A word and never a number: no percentage, no rank, no count. The human is
 * never scored (docs/plan/08 §1.1 rule 6), and a count would turn the agents'
 * faces into the user's collection statistic.
 * @param {string} tier
 * @returns {string|null}
 */
export function rarityWord(tier) {
  return tier === 'uncommon' || tier === 'rare' || tier === 'legendary' ? tier : null;
}

// ---- runtime guard: no appearance colour may impersonate a state ----------
// The same discipline as `assertNoDecorativeCrimson` above, one level
// stricter. Crimson is the colour that must mean exactly one thing, but EVERY
// state colour is a colour an agent's clothes must not be able to imitate.
// Fails at import time rather than on the floor.
(function assertAppearanceCannotImpersonateAState() {
  const MIN_DISTANCE = 70;
  const channels = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const distance = (a, b) => {
    const x = channels(a);
    const y = channels(b);
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  };
  // Skin gets its own, lower bar — see AGENT_SKINS for why.
  const SKIN_MIN_DISTANCE = 40;
  const tables = {
    AGENT_ACCENTS,
    RARE_HAIR_COLORS,
    JACKET_COLORS,
    CROWN_GOLD: [CROWN_GOLD],
    AGENT_SKINS,
  };
  for (const [name, list] of Object.entries(tables)) {
    const floor = name === 'AGENT_SKINS' ? SKIN_MIN_DISTANCE : MIN_DISTANCE;
    for (const colour of list) {
      for (const [state, value] of Object.entries(STATE_COLORS)) {
        const d = distance(colour, value);
        if (d < floor) {
          throw new Error(
            `palette.js: ${name} entry ${colour} is only ${d.toFixed(1)} from ` +
              `STATE_COLORS.${state} (${value}); an agent's clothes must never ` +
              'imitate a state — see VISUAL-SPEC §5.',
          );
        }
      }
    }
  }
})();
