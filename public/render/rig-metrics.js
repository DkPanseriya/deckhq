/**
 * Every dimension, colour and threshold the rig is drawn from, and the four
 * text helpers beside them (WP-22 follow-up; the character rework is WP-79).
 *
 * WP-79 replaced the doodle — a top-down ellipse with stroke limbs — with
 * **B**, the 45° three-quarter robot from `docs/media/design/character`. The
 * figure is BILLBOARDED: it never rotates with `bodyAngle`, and the contact
 * ellipse under its feet is the only part of it that lies in the floor's own
 * plane. Everything about it is authored in ONE local frame (origin at the
 * ground contact, y UP, 1 local unit = `RIG_UNIT_U` plan units), which is what
 * lets the whole figure be stated once and drawn at any zoom without a sprite
 * sheet.
 *
 * `rig.js` re-exports every name, so `scene-draw.js`, `minifloor.js` and the
 * test files import exactly what they imported before.
 */

import { channelsOf, mixHex, PALETTE } from './palette.js';
import { registerBodyScale, scaleAll } from './plan-scale.js';

export const TAU = Math.PI * 2;
export const BASE_U = 14; // reference px-per-unit these proportions were tuned at

// ---------------------------------------------------------------- constants

export const SKIN = '#E4B98E';
export const HAIR = '#3C2A1C';
export const OUTLINE = 'rgba(255,255,255,0.85)';

// ---- B's own materials (WP-79) --------------------------------------------
//
// THE THREE LESSONS FROM THE DESIGN STUDY, restated where they are enforced
// (`docs/media/design/character/README.md`):
//
//   1. **The state colour owns the whole body mass, head included.** The old
//      rig spent the head and the hair on identity and left a coloured
//      waistcoat, which at 22 px read as a grey blob with a stripe. Every
//      shape B draws is a tint of `opts.color`, so a character is one coherent
//      hue at a glance and the hue is the state.
//   2. **The face is a bright pane with a dark mark.** A lit screen on a
//      coloured head survives 24 px; a dark screen with a light mark does not
//      (measured on all four candidates — the study's own finding).
//   3. **Identity is two or three SMALL elements**, never the body: the
//      antenna tip, the ear cups, the chest badge and its glyph, the boots.
//      Any louder and B reads as a teddy bear.

/** The line work on the figure: one warm near-black, never pure black. */
export const RIG_INK = '#382F26';
/** A lit visor. Bright pane, dark mark — lesson 2. */
export const RIG_PANE = '#F7F1E1';
/** A mark ON a dark pane (the over-head badge's glyph). */
export const RIG_MARK = '#FFF6E6';
/** A dead visor, and an unlit lamp: `ended` has no power. */
export const RIG_PANE_DEAD = '#CFC9BD';
/** The mark on a dead visor. */
export const RIG_OFF = '#9A938A';
export const SELECTION_RING_COLOR = 'rgba(74,68,56,0.55)';
export const CLOUD_FILL = 'rgba(252, 250, 244, 0.95)';
export const CLOUD_EDGE = 'rgba(90, 78, 62, 0.45)';
export const DOT_COLOR = PALETTE.inkCool;

export const PROP_COLORS = Object.freeze({
  mug: PALETTE.fridgeFill,
  plate: PALETTE.tileBase,
  cue: PALETTE.tableWood,
  paddle: PALETTE.inkCool,
  controller: PALETTE.cabinetBody,
  piece: PALETTE.chairBackrest,
});

// ---- the manager: the user's own avatar at the office desk (WP15 addendum) --
// Not an agent — no state colour, no MK tag, no project identity. Reuses the
// same body primitives as every character (see drawManagerFigure at the
// bottom of this file) so it reads as the same species, just bigger and in a
// suit.
export const MANAGER_SUIT = PALETTE.managerSuit;
export const MANAGER_SHIRT = PALETTE.managerShirt;
export const MANAGER_TIE = PALETTE.managerTie;
export const MANAGER_SCALE = 1.3; // "a bit bigger" than an agent (uniform scale over u)

// body-part geometry, expressed as a fraction of `u` (tuned at BASE_U = 14)
/**
 * A CHARACTER'S SHADOW IS DIRECTLY UNDER ITS FEET (WP-78).
 *
 * `SHADOW_OX`/`SHADOW_OY` were 0.12 and 0.62 — a sixth of a unit right and
 * two thirds of a unit down the page, which at the fit scales this floor is
 * drawn at is between 5 and 15 screen pixels of daylight between a person and
 * their own shadow. It was a drop from a light nobody had stated, and it was
 * the owner's "the oval shadows sometimes are offset and make no sense".
 *
 * A character's feet point IS `(x, y)`: `drawCharacter` is handed the seat or
 * spot the person is standing on and draws the whole body around it, rotating
 * the legs with the facing rather than hanging them down the page. So the
 * ground contact is the origin, and the ellipse is centred on it. Both are kept
 * as named constants rather than deleted, because "the offset is zero" is a
 * decision and `test/unit/lighting.test.mjs` measures it.
 */
export let SHADOW_RX = 0.86,
  SHADOW_RY = 0.39;
export const SHADOW_OX = 0,
  SHADOW_OY = 0;
// ---- B's local frame (WP-79) ----------------------------------------------
//
// The figure is authored once, in a frame whose origin is the ground contact,
// whose y runs UP, and whose unit is the figure's own nominal height. Nothing
// in that frame knows about px or about zoom; `rigFrame()` in `rig-pose.js`
// is the single place a local point becomes a screen point.
//
// WHY THE FRAME UNIT IS TWO PLAN UNITS. The design's in-situ test
// (`docs/media/design/character/in-situ.png`, a 1:1 crop of
// `test/goldens/win32/empty.png`) puts the figure at **34 px** on that floor,
// whose fit scale is ~16.5 px per plan unit — so one frame unit is ~2.06 plan
// units, and 2 is the round number inside that. It is the whole size decision,
// and it is the one the owner signed off in the sheet rather than a taste call
// made here.

/** B's local frame: 1 local unit = this many plan units. */
export let RIG_UNIT_U = 2.0;

/**
 * The local y of the tallest thing B draws — the antenna finial on a standing
 * figure — so `BODY_HEIGHT_U` below stays a real measurement of the figure
 * rather than a number that used to be one.
 */
export const RIG_CROWN = 1.26;

/**
 * The scale at which B stops drawing its quiet half: the rim halo, the chest
 * glyph and the far arm (the design README's own risk note — "the rim-halo
 * pass doubles stroke work, so at 100 agents the halo, chest glyph and far
 * limbs should drop below ~30 px"). Measured on the FIGURE's height in screen
 * px, not on `u`, because that is what the note is about.
 *
 * The raised hand and the visor are drawn at every level and are never in this
 * list: they are the two things the floor exists to say.
 */
export const RIG_DETAIL_MIN_PX = 30;

/**
 * Below this the state mark on the visor swaps to ONE bold form instead of its
 * full drawing. A three-bar `working` glyph at 20 px of figure is three grey
 * pixels; one bar is still a bar.
 *
 * The design README says 34, and this is 30 — the one number in this package
 * that departs from the study, and it departs because the study's own in-situ
 * test settles it. B is 33 px of frame at the fit scale that test was taken at,
 * so a swap at 34 would mean the floor NEVER draws a full mark: every figure on
 * every golden would carry the fallback, and the six marks the design drew
 * would exist only on the sheet. 30 is where a three-bar mark actually stops
 * resolving, measured at 2× on the regenerated goldens.
 */
export const RIG_MARK_MIN_PX = 30;

/**
 * HOW HIGH ABOVE THE FEET THE OVER-HEAD SLOT STARTS, in plan units (WP-79).
 *
 * The state icon, the tool bubble, the thought cloud and the waiting badge all
 * hang off the ground contact rather than off the crown, because they are ONE
 * slot and a slot that moved with each figure's own antenna would put two
 * neighbours' icons at two heights. It was 1.05 U while a character's crown sat
 * at 1.45 U — the icon deliberately overlapped the top of the head a little —
 * and B's crown is at `BODY_HEIGHT_U` (2.52 U), so it moves by the same
 * difference and keeps the same small overlap.
 *
 * `CHROME_BADGE_U` is the waiting badge, which sits ABOVE the icon: it has to
 * clear `max(ICON_MIN_PX, u * 0.9)` of icon on top of the offset below, which
 * at every scale the floor is drawn at is under 1.1 U.
 */
export let CHROME_TOP_U = 2.35;
export let CHROME_BUBBLE_U = 3.05;
export let CHROME_BADGE_U = 3.45;
/**
 * The radius, in plan units, of the ring drawn around the selected character.
 *
 * Exported because it is also the product's own answer to "how wide is a
 * person" — it is sized to clear the widest pose the rig can reach, and it is
 * the shape the interface already draws to mean *this one*. `scene.js`'s
 * `anchorFor('agent', id)` uses it as the half-width of a character's box
 * rather than inventing a second estimate (docs/DEVIATIONS.md §16, §35, §38:
 * two representations of the same thing, allowed to disagree).
 */
export let SELECTION_RING_R = 1.35;
export let RING_BASE_R = 1.15;

/**
 * A standing character's height in plan units, crown to sole.
 *
 * Exported because `05-GUI-UX-SPEC.md` §6.2's "a character body is never under
 * 16 px" is a claim about THIS number times the character scale, and a test
 * that checks it must measure what the rig actually draws rather than a second
 * estimate of it (docs/DEVIATIONS.md §16, §35, §38: two representations of the
 * same thing, allowed to disagree).
 *
 * WP-79 kept the number — `2.0 × 1.26` is 2.52, exactly what the old rig's
 * crown-to-sole came to — and that is deliberate rather than lucky: it is
 * derived from B's own frame, and B was sized to the design's in-situ test, but
 * having it land on the old value means the floor's CAMERA does not move.
 * `CHAR_MIN_PX_PER_UNIT`, `CHAR_MAX_PX_PER_UNIT`, the fit ceiling, the hit box
 * and the halo pool's span are all quotients of this number, and every one of
 * them is unchanged. What changed is what is drawn inside the height: the old
 * rig spent a third of it on thin splayed limbs and read as 22 px of coloured
 * mass; B fills it.
 */
export let BODY_HEIGHT_U = RIG_UNIT_U * RIG_CROWN;

/**
 * Per-element legibility floors, in screen pixels (05-GUI-UX-SPEC.md §6.2's
 * table). They are floors on the ELEMENT, not on the scale: the label is set
 * in the larger of its natural size and 11 px, which is what keeps a name
 * readable on a floor drawn small without inflating the people carrying it.
 *
 * `body` is the one floor the rig cannot enforce on its own — it is a floor on
 * `u`, and `u` is the caller's — so `scene.js` applies it in
 * `_characterScale()` and this object is where both halves agree on the number.
 */
export const LEGIBILITY_MIN_PX = Object.freeze({ body: 16, label: 11, icon: 12, badge: 13 });

export const LABEL_MIN_PX = LEGIBILITY_MIN_PX.label;
export const ICON_MIN_PX = LEGIBILITY_MIN_PX.icon;
export const BADGE_MIN_PX = LEGIBILITY_MIN_PX.badge;

// ---- the state colour, fanned out (WP-79) ---------------------------------

/**
 * Toward white (`f > 0`) or toward black (`f < 0`), by `|f|`.
 * @param {string} hex @param {number} f
 */
export function shade(hex, f) {
  return mixHex(hex, f > 0 ? '#ffffff' : '#000000', Math.abs(f));
}

/** The same colour at `a` opacity, as an `rgba()` string. */
export function fade(hex, a) {
  const ch = channelsOf(hex) || [0, 0, 0];
  return `rgba(${ch[0]},${ch[1]},${ch[2]},${a})`;
}

/**
 * The five tints every part of B is painted in, all of them the state colour.
 *
 * This function IS lesson 1 (see the header): there is no second hue anywhere
 * on the body, so a character is one mass of one colour at 24 px rather than a
 * grey shape with a coloured panel. `col` is the caller's colour untouched and
 * at full strength — `test/unit/identity-visuals.test.mjs` measures that the
 * barrel is filled with exactly it, which is VISUAL-SPEC §5's whole contract.
 *
 * @param {string} color the resolved state colour
 * @param {boolean} [dead] `ended`: the visor is off and the lamp is out
 */
export function rigTints(color, dead) {
  return {
    col: color,
    shell: shade(color, 0.58), // mitts, dome highlight: light, still the state hue
    lite: shade(color, 0.24), // the lit top planes that sell the 45° tilt
    dark: shade(color, -0.2), // the chest plate
    deep: shade(color, -0.34), // the base, the ear cups, the far arm
    glass: shade(color, -0.6), // the mark on the lit visor
    dead: !!dead,
  };
}

/**
 * The largest a name label is ever set (WP-59).
 *
 * A label is an identifier, not a headline: 11 px is the floor §6.2 states and
 * 14 px is a comfortable UI size, and between them is the whole useful range.
 * It needed saying once the fit ceiling rose to a 72 px body — `u * 0.62` at
 * that scale is nearly 18 px, which puts a session's name in larger type than
 * the room plate above it and turns a floor of eight agents into eight
 * captions.
 */
export const LABEL_MAX_PX = 14;

/**
 * The point size a name label is set in at character scale `u`. Exported so
 * the legibility test measures the size the rig actually uses.
 * @param {number} u
 */
export function labelFontSize(u) {
  return Math.min(LABEL_MAX_PX, Math.max(LABEL_MIN_PX, u * 0.62));
}

// -------------------------------------------------------------- text/format

/**
 * Formats a waiting-time badge: `4m`, `2h 10m`, `2d 4h`.
 * @param {number} ms
 * @returns {string}
 */
export function formatElapsed(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  if (totalHours < 24) return remMinutes > 0 ? `${totalHours}h ${remMinutes}m` : `${totalHours}h`;
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

/**
 * Truncates a name label to at most 18 characters total (VISUAL-SPEC §7),
 * preferring a break on a word boundary within the budget over a mid-word
 * cut (tech-lead review finding 1, docs/DEVIATIONS.md "Findings from
 * review": labels were truncating mid-word). Falls back to a hard cut when
 * the budget contains no space to break on — a single word longer than the
 * budget has nowhere else to give.
 * @param {string} label
 * @returns {string}
 */
export function truncateLabel(label) {
  const s = String(label == null ? '' : label);
  if (s.length <= 18) return s;
  const budget = 17; // + 1 ellipsis char = 18 total
  const slice = s.slice(0, budget);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${cut}…`;
}

export const monoFontCache = new Map();
export function monoFont(px) {
  const key = Math.round(px);
  let f = monoFontCache.get(key);
  if (f === undefined) {
    f = `700 ${key}px "JetBrains Mono", monospace`;
    monoFontCache.set(key, f);
  }
  return f;
}

export const sansFontCache = new Map();
export function sansFont(px) {
  const key = Math.round(px);
  let f = sansFontCache.get(key);
  if (f === undefined) {
    f = `600 ${key}px "IBM Plex Sans", system-ui, sans-serif`;
    sansFontCache.set(key, f);
  }
  return f;
}

// ----------------------------------------------------- the scaling law (§2)
//
// **THE SETTING IS `RIG_UNIT_U`** — 1.6 / 2.0 / 2.5, which is 2.0 × `s` — and
// `BODY_HEIGHT_U` follows it to §2's 2.02 / 2.52 / 3.15. Everything else here is
// the same figure's own furniture: the three chrome bands the icon, the bubble
// and the waiting badge hang at, the ring that is this product's answer to *how
// wide is a person*, and the contact ellipse under the feet. A figure a quarter
// larger with its badge at the old height would wear the badge on its head.
//
// WHAT DOES NOT MOVE is every number in screen pixels: the legibility floors,
// the two detail thresholds, and the label's own 11–14 px. §2 says it in one
// line — *"a large floor gets larger people under the same labels, not larger
// labels"* — and the two thresholds are floors on what a STROKE resolves at,
// which is a property of the screen rather than of the person.
//
// `scene-lod.js`'s `CHAR_MIN_PX_PER_UNIT` and `CHAR_MAX_PX_PER_UNIT` are
// quotients of `BODY_HEIGHT_U` and re-derive there, so the 16 px legibility
// floor and the 72 px ceiling stay floors on the BODY at every size.

const BASE = {
  RIG_UNIT_U,
  CHROME_TOP_U,
  CHROME_BUBBLE_U,
  CHROME_BADGE_U,
  SELECTION_RING_R,
  RING_BASE_R,
  SHADOW_RX,
  SHADOW_RY,
};

registerBodyScale((s) => {
  ({
    RIG_UNIT_U,
    CHROME_TOP_U,
    CHROME_BUBBLE_U,
    CHROME_BADGE_U,
    SELECTION_RING_R,
    RING_BASE_R,
    SHADOW_RX,
    SHADOW_RY,
  } = scaleAll(BASE, s));
  BODY_HEIGHT_U = RIG_UNIT_U * RIG_CROWN;
});
