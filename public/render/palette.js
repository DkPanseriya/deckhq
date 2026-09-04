/**
 * DeckHQ colour tokens — shared by every renderer module (rig, clips, scene,
 * plan, backdrop). Pure data, no DOM, no canvas. Safe to import in Node.
 *
 * docs/03-VISUAL-SPEC.md §5 (state colours) and §6 (materials).
 *
 * ============================================================================
 * WP-22 follow-up · this file is WP-30's rarity: how an agent's appearance is
 * rolled, which tier it lands in, and what that tier is called. The tokens
 * themselves are three modules, every name re-exported from here:
 *
 *   palette-colors.js    the state colours, the materials, the crimson guard
 *   palette-identity.js  a project's ring colour, an agent's glyph
 *   palette-avatars.js   the appearance pools and WP-45's pack sets
 *
 * Every name the old module exported is re-exported here, so eleven renderer
 * modules and six test files import exactly what they imported before.
 * ============================================================================
 */

import {
  AGENT_SKINS,
  AGENT_HAIR_STYLES,
  AGENT_BUILDS,
  RARE_HAIR_COLORS,
  CROWN_GOLD,
  ACCENT_POOL,
  JACKET_POOL,
} from './palette-avatars.js';

export * from './palette-colors.js';
export * from './palette-identity.js';
export * from './palette-avatars.js';

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
export function appearanceHash(str) {
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
export function appearanceRng(seed) {
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
export function pick(rng, list) {
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
