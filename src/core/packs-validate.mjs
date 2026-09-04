/**
 * What a pack must be before it is allowed anywhere near the floor
 * (WP-22 follow-up).
 *
 * Split out of `packs.mjs` unchanged: the avatar-set checks — every colour
 * far enough from every state colour, and from each other — the whole-pack
 * check, and the parse that refuses anything that is not a pack.
 *
 * Every refusal here is a string a user can act on, which is why
 * `errorText` exists: a validator that only answers "invalid" tells nobody
 * what to change.
 */

import { validateTheme } from './themes.mjs';
import { THEME_NAMES, relativeLuminance } from '../../public/render/themes.js';
import { STATE_COLORS } from '../../public/render/palette.js';
import {
  distance,
  errorText,
  isPlainObject,
  SET_NAME_RE,
  COLOUR_RE,
  AVATAR_STATE_MIN_DISTANCE,
  AVATAR_MUTUAL_MIN_DISTANCE,
  MIN_ACCENTS,
  MAX_ACCENTS,
  MIN_JACKETS,
  MAX_JACKETS,
  JACKET_MAX_LUMINANCE,
  PACK_KIND,
  PACK_VERSION,
  PACK_NAME_RE,
  PACK_VERSION_RE,
  MAX_THEMES_PER_PACK,
  MAX_AVATAR_SETS_PER_PACK,
  MAX_PACK_BYTES,
} from './packs-format.mjs';
import { verifyPackSignature } from './packs-sign.mjs';

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

/**
 * One avatar set: two colour tables an agent's appearance may be drawn from.
 *
 * NOT a face. Hair silhouettes, builds, glyphs and the rarity model are
 * geometry and rules in `public/render/rig.js` and `palette.js`; a pack cannot
 * add a shape, only a colour to draw an existing shape in. That keeps a pack
 * to data — see this file's header.
 *
 * @param {unknown} doc
 * @returns {{ok:true, set:{name:string, blurb:string, accents:string[], jackets:string[]}}
 *           | {ok:false, error:string}}
 */
export function validateAvatarSet(doc) {
  if (!isPlainObject(doc)) return { ok: false, error: 'an avatar set must be a JSON object' };
  const raw = /** @type {any} */ (doc);
  const name = typeof raw.name === 'string' ? raw.name.trim().toLowerCase() : '';
  if (!SET_NAME_RE.test(name)) {
    return {
      ok: false,
      error:
        'an avatar set needs a "name": lower-case letters, digits, spaces, - or _, up to 32 characters',
    };
  }

  const extra = Object.keys(raw).filter(
    (k) => !['name', 'blurb', 'accents', 'jackets'].includes(k),
  );
  if (extra.length) {
    return {
      ok: false,
      error: `avatar set "${name}" carries ${extra.join(', ')}; a set is a name and two colour tables`,
    };
  }

  /**
   * @param {string} key
   * @param {number} min
   * @param {number} max
   * @param {boolean} mutual  hold the table's own entries apart from each other
   * @returns {{ok:boolean, list:string[], error:string}}
   */
  const table = (key, min, max, mutual) => {
    /** @param {string} error @returns {{ok:boolean, list:string[], error:string}} */
    const no = (error) => ({ ok: false, list: [], error });
    const value = raw[key];
    if (!Array.isArray(value)) return no(`avatar set "${name}" has no "${key}" array`);
    if (value.length < min || value.length > max) {
      return no(
        `avatar set "${name}" carries ${value.length} ${key}; it needs between ${min} and ${max}`,
      );
    }
    /** @type {string[]} */
    const list = [];
    for (const colour of value) {
      if (typeof colour !== 'string' || !COLOUR_RE.test(colour.trim())) {
        return no(
          `avatar set "${name}" has ${JSON.stringify(colour)} in ${key}; an avatar table carries #rrggbb colours and nothing else`,
        );
      }
      list.push(colour.trim().toUpperCase());
    }
    // No agent's clothes may imitate a state. The same 70 palette.js holds its
    // own tables to, re-run here because this table arrived from outside.
    for (const colour of list) {
      for (const [state, value2] of Object.entries(STATE_COLORS)) {
        const d = distance(colour, value2);
        if (d < AVATAR_STATE_MIN_DISTANCE) {
          return no(
            `avatar set "${name}": ${key} ${colour} is ${d.toFixed(1)} from the ${state} state ` +
              `colour (${value2}), and needs >= ${AVATAR_STATE_MIN_DISTANCE}. An agent must never ` +
              'wear a state — docs/03-VISUAL-SPEC.md §5.',
          );
        }
      }
    }
    for (let i = 0; mutual && i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const d = distance(list[i], list[j]);
        if (d < AVATAR_MUTUAL_MIN_DISTANCE) {
          return no(
            `avatar set "${name}": ${key} ${list[i]} and ${list[j]} are ${d.toFixed(1)} apart, ` +
              `and need >= ${AVATAR_MUTUAL_MIN_DISTANCE}. Two agents standing together have to ` +
              'read as two people.',
          );
        }
      }
    }
    return { ok: true, list, error: '' };
  };

  const accents = table('accents', MIN_ACCENTS, MAX_ACCENTS, true);
  if (!accents.ok) return { ok: false, error: accents.error };
  const jackets = table('jackets', MIN_JACKETS, MAX_JACKETS, false);
  if (!jackets.ok) return { ok: false, error: jackets.error };

  for (const colour of jackets.list) {
    const l = relativeLuminance(colour);
    if (l > JACKET_MAX_LUMINANCE) {
      return {
        ok: false,
        error:
          `avatar set "${name}": jacket ${colour} has luminance ${l.toFixed(3)}, over ` +
          `${JACKET_MAX_LUMINANCE}. A jacket is tailoring drawn over a state-coloured torso; a ` +
          'pale one reads as the torso itself.',
      };
    }
  }

  return {
    ok: true,
    set: {
      name,
      blurb: typeof raw.blurb === 'string' ? raw.blurb.slice(0, 200) : '',
      accents: accents.list,
      jackets: jackets.list,
    },
  };
}

/**
 * @typedef {object} Pack
 * @property {string} name
 * @property {string} version
 * @property {string} publisher
 * @property {Array<import('./themes.mjs').ThemeDocument & {blurb?:string}>} themes
 * @property {Array<{name:string, blurb:string, accents:string[], jackets:string[]}>} avatars
 * @property {string} blurb      one line about the pack, for the settings sheet
 * @property {string} keyId       which publisher key signed it
 * @property {string[]} rejected  one line per item this build refused
 */

/**
 * Validate a parsed, ALREADY-VERIFIED pack document.
 *
 * The order matters and is the acceptance criterion: signature first (a pack
 * that is not ours is refused whole, and none of its contents is looked at),
 * then the envelope (a malformed envelope is refused whole), then the
 * contents ITEM BY ITEM. A theme that fails `validateTheme` is dropped with
 * its reason and the pack still loads with the rest — "rejected individually,
 * not silently". A pack whose every item is rejected loads as an empty pack,
 * which is honest: it says what it refused.
 *
 * @param {any} doc
 * @returns {{ok:true, pack:Pack} | {ok:false, error:string}}
 */
export function validatePack(doc) {
  if (!isPlainObject(doc)) return { ok: false, error: 'a pack must be a JSON object' };
  if (doc.kind !== PACK_KIND) {
    return { ok: false, error: `a pack has "kind": ${JSON.stringify(PACK_KIND)}` };
  }
  if (doc.schema !== PACK_VERSION) {
    return {
      ok: false,
      error: `this pack is schema ${JSON.stringify(doc.schema)}; this build reads schema ${PACK_VERSION}`,
    };
  }

  const name = typeof doc.name === 'string' ? doc.name.trim().toLowerCase() : '';
  if (!PACK_NAME_RE.test(name)) {
    return {
      ok: false,
      error:
        'a pack needs a "name": lower-case letters, digits, . - or _, up to 64 characters. ' +
        'It becomes a directory name, so it may not contain a separator or a dot segment.',
    };
  }
  if (name === '.' || name === '..')
    return { ok: false, error: 'a pack may not be named "." or ".."' };

  const version = typeof doc.version === 'string' ? doc.version.trim() : '';
  if (!PACK_VERSION_RE.test(version)) {
    return { ok: false, error: `pack "${name}" needs a "version" like 1.0.0` };
  }

  const publisher = typeof doc.publisher === 'string' ? doc.publisher.trim() : '';
  if (!publisher || publisher.length > 64) {
    return { ok: false, error: `pack "${name}" needs a "publisher" of 1 to 64 characters` };
  }

  // An unknown top-level key is refused rather than dropped, for the reason
  // `validateTheme` refuses one: a pack that carried `entitlements` and had it
  // silently ignored would look accepted and would ship.
  const allowed = [
    'kind',
    'schema',
    'name',
    'version',
    'publisher',
    'blurb',
    'themes',
    'avatars',
    'signature',
  ];
  const extra = Object.keys(doc).filter((k) => !allowed.includes(k));
  if (extra.length) {
    return {
      ok: false,
      error:
        `pack "${name}" carries ${extra.join(', ')}, which a pack may not. A pack is themes and ` +
        'avatar sets. There is no key here for a tier, a licence, an expiry or a feature flag, ' +
        'and there never will be — docs/plan/08-PLAN-V2-100X.md §1.1 rule 2.',
    };
  }

  const rawThemes = doc.themes === undefined ? [] : doc.themes;
  if (!Array.isArray(rawThemes))
    return { ok: false, error: `pack "${name}" has a "themes" that is not an array` };
  if (rawThemes.length > MAX_THEMES_PER_PACK) {
    return {
      ok: false,
      error: `pack "${name}" carries ${rawThemes.length} themes; the cap is ${MAX_THEMES_PER_PACK}`,
    };
  }
  const rawAvatars = doc.avatars === undefined ? [] : doc.avatars;
  if (!Array.isArray(rawAvatars))
    return { ok: false, error: `pack "${name}" has an "avatars" that is not an array` };
  if (rawAvatars.length > MAX_AVATAR_SETS_PER_PACK) {
    return {
      ok: false,
      error: `pack "${name}" carries ${rawAvatars.length} avatar sets; the cap is ${MAX_AVATAR_SETS_PER_PACK}`,
    };
  }

  /** @type {string[]} */
  const rejected = [];
  /** @type {any[]} */
  const themes = [];
  const shipped = new Set(THEME_NAMES);
  const seenThemes = new Set();
  for (const [i, raw] of rawThemes.entries()) {
    const result = validateTheme(raw);
    if ('error' in result) {
      rejected.push(`themes[${i}]: ${result.error}`);
      continue;
    }
    // A pack may not shadow a shipped theme: the picker would show two rows
    // with one name, and `settings.theme` stores a NAME, so which floor you
    // got would depend on load order.
    if (shipped.has(result.theme.name)) {
      rejected.push(
        `themes[${i}]: "${result.theme.name}" is a theme this build already ships, and a pack may not replace one`,
      );
      continue;
    }
    if (seenThemes.has(result.theme.name)) {
      rejected.push(`themes[${i}]: "${result.theme.name}" appears twice in this pack`);
      continue;
    }
    seenThemes.add(result.theme.name);
    themes.push(
      typeof (/** @type {any} */ (raw).blurb) === 'string'
        ? { ...result.theme, blurb: /** @type {any} */ (raw).blurb.slice(0, 200) }
        : result.theme,
    );
  }

  /** @type {any[]} */
  const avatars = [];
  const seenSets = new Set();
  for (const [i, raw] of rawAvatars.entries()) {
    const result = validateAvatarSet(raw);
    if ('error' in result) {
      rejected.push(`avatars[${i}]: ${result.error}`);
      continue;
    }
    if (seenSets.has(result.set.name)) {
      rejected.push(`avatars[${i}]: "${result.set.name}" appears twice in this pack`);
      continue;
    }
    seenSets.add(result.set.name);
    avatars.push(result.set);
  }

  return {
    ok: true,
    pack: {
      name,
      version,
      publisher,
      blurb: typeof doc.blurb === 'string' ? doc.blurb.slice(0, 300) : '',
      themes,
      avatars,
      keyId:
        isPlainObject(doc.signature) && typeof doc.signature.keyId === 'string'
          ? doc.signature.keyId
          : '',
      rejected,
    },
  };
}

/**
 * Parse, verify and validate one pack file's text, in that order.
 *
 * @param {string|Buffer} text
 * @param {{keys?:ReadonlyArray<{id:string,pem:string,retired?:boolean}>}} [opts]
 * @returns {{ok:true, pack:Pack, doc:any} | {ok:false, error:string}}
 */
export function parsePack(text, opts = {}) {
  const raw = Buffer.isBuffer(text) ? text : Buffer.from(String(text ?? ''), 'utf8');
  if (raw.length === 0) return { ok: false, error: 'that file is empty' };
  if (raw.length > MAX_PACK_BYTES) {
    return {
      ok: false,
      error: `that file is ${raw.length} bytes; a pack is at most ${MAX_PACK_BYTES}`,
    };
  }
  let doc;
  try {
    doc = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    return { ok: false, error: `that file is not JSON: ${errorText(err)}` };
  }

  // Signature FIRST. Nothing about a pack we did not publish is looked at,
  // let alone loaded.
  const verified = verifyPackSignature(doc, opts);
  if ('error' in verified) return { ok: false, error: verified.error };

  const validated = validatePack(doc);
  if ('error' in validated) return { ok: false, error: validated.error };
  return { ok: true, pack: { ...validated.pack, keyId: verified.keyId }, doc };
}
