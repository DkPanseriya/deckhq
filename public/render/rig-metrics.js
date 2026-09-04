/**
 * Every dimension, colour and threshold the rig is drawn from, and the four
 * text helpers beside them (WP-22 follow-up).
 *
 * Split out of `rig.js` unchanged. Each proportion is expressed against
 * `BASE_U` — the px-per-unit these were tuned at — which is what lets the rig
 * scale cleanly across the whole zoom range without a sprite sheet. Skin,
 * hair and prop materials are constant across agents by design
 * (docs/03-VISUAL-SPEC.md §3): individuality is carried by the name label,
 * not by appearance.
 *
 * `rig.js` re-exports every name, so `scene-draw.js`, `minifloor.js` and
 * three test files import exactly what they imported before.
 */

import { PALETTE } from './palette.js';

export const TAU = Math.PI * 2;
export const BASE_U = 14; // reference px-per-unit these proportions were tuned at

// ---------------------------------------------------------------- constants

export const SKIN = '#E4B98E';
export const HAIR = '#3C2A1C';
export const OUTLINE = 'rgba(255,255,255,0.85)';
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
export const SHADOW_RX = 0.86,
  SHADOW_RY = 0.39,
  SHADOW_OX = 0.12,
  SHADOW_OY = 0.62;
export const TORSO_RX = 0.82,
  TORSO_RY = 0.61;
export const HEAD_R = 0.5,
  HEAD_OFFSET_Y = -0.95;
export const SHOULDER_OFFSET_X = 0.5,
  // Kept symmetric with HIP_OFFSET_Y below: shoulders sit as far forward of
  // centre as the hips sit behind it. At the old -0.2, the `type` clip's
  // reach (clips.js TYPE_ARM: shoulder=1.2, elbow=0.35) landed the typing
  // hand only ~0.01 local units on the correct (forward, head-side) side of
  // centre — effectively a coin flip once floating point is involved, and
  // `type` drives `working`, the single commonest state on a real machine.
  // -0.4 gives every reaching pose real margin on the correct side without
  // moving the reach angles themselves (verified against all 16 clips in
  // clips.js; see test/unit/rig-orientation.test.mjs).
  SHOULDER_OFFSET_Y = -0.4;
export const HIP_OFFSET_X = 0.32,
  HIP_OFFSET_Y = 0.4;
// Identity marks (CONTRACTS-WP15.md §2) and the manager's suit accents share
// this local frame: COLLAR_OFFSET_Y sits between the shoulder line and the
// head (the neckline); GLYPH_OFFSET is "the shoulder/back" the spec calls
// for — slightly behind centre (local +y) and to one side.
export const COLLAR_OFFSET_Y = -0.58;
export const GLYPH_OFFSET_X = 0.4,
  GLYPH_OFFSET_Y = 0.08;
export const ARM_LEN1 = 0.55,
  ARM_LEN2 = 0.5,
  ARM_WIDTH = 0.22,
  HAND_R = 0.16;
export const LEG_LEN_STAND = 0.55,
  LEG_LEN_SEATED = 0.28,
  LEG_WIDTH = 0.24;
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
export const SELECTION_RING_R = 1.35;
export const RING_BASE_R = 1.15;

/**
 * A standing character's height in plan units, crown to sole: the top of the
 * head (`HEAD_OFFSET_Y - HEAD_R`) down to the far end of a leg at rest, plus
 * the round cap on the leg stroke.
 *
 * Exported because `05-GUI-UX-SPEC.md` §6.2's "a character body is never under
 * 16 px" is a claim about THIS number times the character scale, and a test
 * that checks it must measure what the rig actually draws rather than a second
 * estimate of it (docs/DEVIATIONS.md §16, §35, §38: two representations of the
 * same thing, allowed to disagree).
 */
export const BODY_HEIGHT_U = HEAD_R - HEAD_OFFSET_Y + HIP_OFFSET_Y + LEG_LEN_STAND + LEG_WIDTH / 2;

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

/**
 * The point size a name label is set in at character scale `u`. Exported so
 * the legibility test measures the size the rig actually uses.
 * @param {number} u
 */
export function labelFontSize(u) {
  return Math.max(LABEL_MIN_PX, u * 0.62);
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
