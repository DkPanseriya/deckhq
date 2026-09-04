/**
 * What an avatar can be made of (WP-22 follow-up).
 *
 * Split out of `palette.js` unchanged: the skin, hair, accent and build
 * pools, the assertion that keeps the reserved crimson out of every one of
 * them, and WP-45's pack avatar sets — registering one, clearing them, and
 * applying a set by name.
 *
 * Individuality is carried here and by the name label, and nowhere else: the
 * body's own materials are constant across agents by design
 * (docs/03-VISUAL-SPEC.md §3).
 */

import { STATE_COLORS, colourDistance } from './palette-colors.js';

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
export let ACCENT_POOL = AGENT_ACCENTS;
/** @type {ReadonlyArray<string>} */
export let JACKET_POOL = JACKET_COLORS;

/**
 * The tables `appearanceFor` is drawing from right now.
 * @returns {{accents:ReadonlyArray<string>, jackets:ReadonlyArray<string>, name:string}}
 */
export function avatarPools() {
  return { accents: ACCENT_POOL, jackets: JACKET_POOL, name: APPLIED_AVATAR_SET };
}

/** Which set is applied, or `''` for the shipped tables. */
export let APPLIED_AVATAR_SET = '';

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
export const PACK_AVATAR_SETS = [];

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
