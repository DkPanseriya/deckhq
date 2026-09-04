/**
 * A project's colour, and an agent's glyph (WP-22 follow-up).
 *
 * Split out of `palette.js` unchanged: the project identity ring and the
 * avatar glyph set, both chosen by hash so the same project and the same
 * agent look the same on every rebuild and on every machine.
 */
import { assertMaterialDiscipline, DEFAULT_PALETTE } from './palette-colors.js';

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
