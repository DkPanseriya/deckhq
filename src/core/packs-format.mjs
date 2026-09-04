/**
 * What a pack file is, in constants (WP-22 follow-up).
 *
 * Split out of `packs.mjs` unchanged: the document kind, the format
 * version, the size and count ceilings, the three name patterns, and the
 * colour distances an avatar set must clear. Plus the three predicates the
 * validator and the signer both use, and `errorText`, which is why every
 * refusal in this package is a sentence a user can act on.
 *
 * A leaf: the format is what the signer, the validator and the store all
 * agree on, so it has one definition and no dependencies.
 */

/** The document kind. A file that does not say this is not a pack. */
export const PACK_KIND = 'deckhq.pack';

/** The schema version this build writes and reads. */
export const PACK_VERSION = 1;

/**
 * Largest pack we will even look at, in bytes.
 *
 * A pack is colours and names; the sample one is under 6 kB. The cap exists
 * so a hostile or corrupt file is refused before `JSON.parse` rather than
 * after — the same discipline `layout.mjs` applies to an imported layout.
 */
export const MAX_PACK_BYTES = 256 * 1024;

/** Most themes one pack may carry, and most avatar sets. */
export const MAX_THEMES_PER_PACK = 32;
export const MAX_AVATAR_SETS_PER_PACK = 32;

/**
 * A pack name is a DIRECTORY NAME. It is therefore held to the narrowest
 * shape in this file: no separator, no dot-segment, no space, nothing that
 * could climb out of `~/.deckhq/packs`.
 */
export const PACK_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Semver-ish. A pack version is displayed and compared as a string. */
export const PACK_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9a-z.]+)?$/;

/** The only colour shape anything in a pack may carry. */
export const COLOUR_RE = /^#[0-9a-fA-F]{6}$/;

/** An avatar-set name: the same shape a theme name has. */
export const SET_NAME_RE = /^[a-z0-9][a-z0-9 _-]{0,31}$/;

/**
 * How far an avatar colour must sit from every state colour, in sRGB.
 *
 * 70 is not a new number: it is the bar `public/render/palette.js` already
 * holds `AGENT_ACCENTS`, `RARE_HAIR_COLORS` and `JACKET_COLORS` to, checked
 * at import there and re-checked here for a table that arrives from outside.
 * An agent's clothes must never imitate a state — `docs/03-VISUAL-SPEC.md` §5.
 */
export const AVATAR_STATE_MIN_DISTANCE = 70;

/**
 * How far two ACCENTS must sit from each other.
 *
 * The point of a per-agent accent is that two agents standing together read
 * as two people at 16 px, and a pack that shipped eight shades of the same
 * blue would be a pack that painted eight identical agents. 40 is set under
 * the shipped table's own tightest pair — `#9B7EDE` and `#C56BE8` at 47.2 —
 * so it is a bar the product already clears rather than one invented for
 * other people's packs.
 *
 * It deliberately does NOT apply to jackets. The shipped jacket table's
 * tightest pair is `#1B2E3F` and `#3A2350` at 35.7, and it is tight for a
 * reason: a jacket is a dark garment drawn over a state-coloured torso, and
 * every dark garment colour lives in the same small corner of the cube. A
 * rule that failed the table this product already ships would be a rule about
 * nothing — the same lesson `docs/DEVIATIONS.md` §125.4 records for the
 * crimson bar.
 */
export const AVATAR_MUTUAL_MIN_DISTANCE = 40;

/** A jacket is tailoring: dark enough to read as a garment over a torso. */
export const JACKET_MAX_LUMINANCE = 0.3;

/** How many colours an avatar table may carry. */
export const MIN_ACCENTS = 2;
export const MAX_ACCENTS = 16;
export const MIN_JACKETS = 2;
export const MAX_JACKETS = 8;

/** @param {unknown} v */
export function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** @param {string} hex @returns {[number,number,number]} */
export function channels(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** sRGB distance between two `#rrggbb` colours. @param {string} a @param {string} b */
export function distance(a, b) {
  const x = channels(a);
  const y = channels(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** @param {unknown} err */
export function errorText(err) {
  return (err && /** @type {any} */ (err).message) || String(err);
}
