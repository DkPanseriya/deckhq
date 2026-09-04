/**
 * Signed asset packs — WP-45, the Supporter pack.
 *
 * `docs/plan/08-PLAN-V2-100X.md` §5 and `docs/plan/03-BUSINESS-MODEL.md` §5.
 * A pack is a single JSON file that carries MORE THEMES AND AVATAR SETS and
 * nothing else. It is installed into `~/.deckhq/packs/<name>/pack.json` and
 * loaded at daemon start if it is there.
 *
 * ============================================================================
 * WHAT A PACK CANNOT DO
 *
 * This is the seam `docs/DEVIATIONS.md` §125.9 left open — `validateTheme` was
 * strict, tested, and called on nothing, because accepting a theme document
 * from outside meant an unmeasured contrast failure could reach somebody's
 * floor. That is why every theme in a pack goes through the SAME
 * `validateTheme` and the SAME `assertThemeContrast` as a theme this build
 * ships, and why a theme that fails is dropped WITH ITS REASON while the rest
 * of the pack loads. A pack cannot lower a bar; it can only bring documents
 * that clear one.
 *
 * Beyond that, structurally:
 *
 *   - **A pack carries colours and names.** No code, no URL, no font, no
 *     script, no path. Every colour is `#rrggbb` (`validateTheme`'s rule, and
 *     the same rule for avatars here), so a pack cannot fetch anything. The
 *     free core makes no outbound request, ever, and a pack does not change
 *     that.
 *   - **A pack gates nothing.** There is no key in this schema that names a
 *     feature, a tier, a licence or an expiry, and `test/unit/packs.test.mjs`
 *     asserts there is not. `08` §1.1 rule 2: paid features are services you
 *     opt into, never gates on the local UI. Capture, the six states, the
 *     invariant and every action are free forever, with a pack installed or
 *     without one — asserted end to end by
 *     `test/integration/pack-acceptance.test.mjs`, which runs the acceptance
 *     surface with and without a pack and diffs the responses.
 *   - **A pack is a FILE.** No account, no licence check, no activation, no
 *     egress. Anyone holding the file can install it, anywhere, offline,
 *     forever. See `src/core/publisher-key.mjs` for why that is the design and
 *     not an oversight.
 *
 * ## Why it is signed at all, then
 *
 * Integrity, not enforcement. A pack changes what the floor is painted in, so
 * a tampered pack is a way to get unmeasured colours onto somebody's screen —
 * and a pack downloaded from a storefront passes through places we do not
 * control. An Ed25519 signature over the canonical document, checked against
 * a key compiled into this file's neighbour, means the bytes that load are the
 * bytes that were published. An unsigned or badly signed pack is REFUSED
 * whole, with a message, and nothing in it loads.
 *
 * The same shape WP-48 already uses for a signed ledger day
 * (`src/core/ledger.mjs`), for the same reasons and with the same primitive.
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  createHash,
} from 'node:crypto';

import { PACKS_DIR } from './paths.mjs';
import { validateTheme } from './themes.mjs';
import {
  THEME_NAMES,
  clearPackThemes,
  registerPackThemes,
  relativeLuminance,
} from '../../public/render/themes.js';
import { STATE_COLORS } from '../../public/render/palette.js';
import { clearPackAvatarSets, registerPackAvatarSets } from './avatars.mjs';
import { CURRENT_PUBLISHER_KEY_ID, PUBLISHER_KEYS } from './publisher-key.mjs';

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
const PACK_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Semver-ish. A pack version is displayed and compared as a string. */
const PACK_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9a-z.]+)?$/;

/** The only colour shape anything in a pack may carry. */
const COLOUR_RE = /^#[0-9a-fA-F]{6}$/;

/** An avatar-set name: the same shape a theme name has. */
const SET_NAME_RE = /^[a-z0-9][a-z0-9 _-]{0,31}$/;

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
const MIN_ACCENTS = 2;
const MAX_ACCENTS = 16;
const MIN_JACKETS = 2;
const MAX_JACKETS = 8;

/** @param {unknown} v */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** @param {string} hex @returns {[number,number,number]} */
function channels(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** sRGB distance between two `#rrggbb` colours. @param {string} a @param {string} b */
function distance(a, b) {
  const x = channels(a);
  const y = channels(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// ---------------------------------------------------------------------------
// Canonical JSON — what a signature is actually over
// ---------------------------------------------------------------------------

/**
 * A value as ONE string, whatever order its keys arrived in.
 *
 * A signature over `JSON.stringify(doc)` would be a signature over whichever
 * key order the producer's parser happened to emit, so a pack that survived a
 * round trip through any tool that re-orders keys — a formatter, a CDN that
 * re-serialises JSON, a human editing it — would stop verifying while being
 * byte-for-byte the same document. So: object keys sorted, arrays in order,
 * no whitespace, and nothing else.
 *
 * Refuses what JSON cannot round-trip rather than silently dropping it:
 * `undefined`, a function, a non-finite number and a cycle are all errors, not
 * omissions, because an omission would mean signing a document that is not the
 * one on disk.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  /** @param {unknown} v @param {Set<any>} seen @param {string} where */
  const walk = (v, seen, where) => {
    if (v === null) return 'null';
    const t = typeof v;
    if (t === 'number') {
      if (!Number.isFinite(v)) throw new Error(`${where} is not a finite number`);
      return JSON.stringify(v);
    }
    if (t === 'string' || t === 'boolean') return JSON.stringify(v);
    if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') {
      throw new Error(`${where} is a ${t}, which cannot be signed`);
    }
    if (seen.has(v)) throw new Error(`${where} is a cycle`);
    seen.add(v);
    let out;
    if (Array.isArray(v)) {
      out = `[${v.map((x, i) => walk(x, seen, `${where}[${i}]`)).join(',')}]`;
    } else {
      const keys = Object.keys(/** @type {any} */ (v)).sort();
      out = `{${keys
        .map(
          (k) => `${JSON.stringify(k)}:${walk(/** @type {any} */ (v)[k], seen, `${where}.${k}`)}`,
        )
        .join(',')}}`;
    }
    seen.delete(v);
    return out;
  };
  return walk(value, new Set(), 'the document');
}

/**
 * The bytes a pack's signature covers: the whole document except its own
 * `signature` block, canonicalised.
 * @param {any} doc
 * @returns {Buffer}
 */
export function signedBytes(doc) {
  const { signature: _ignored, ...rest } = isPlainObject(doc) ? doc : {};
  return Buffer.from(canonicalJson(rest), 'utf8');
}

// ---------------------------------------------------------------------------
// Signing and verifying
// ---------------------------------------------------------------------------

/** A short, comparable fingerprint of a public key. Same shape as WP-48's. */
export function keyFingerprint(publicKeyPem) {
  return createHash('sha256')
    .update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Sign an unsigned pack document.
 *
 * The signature block carries a key ID and a fingerprint so a refusal can say
 * WHICH key a pack wanted, which is the difference between "this is not ours"
 * and "your DeckHQ is too old to know this key".
 *
 * @param {any} doc a pack document, with or without a stale `signature`
 * @param {string} privateKeyPem  PKCS#8 PEM of an Ed25519 private key
 * @param {{keyId?:string, now?:number}} [meta]
 * @returns {any} the same document with a fresh `signature`
 */
export function signPack(doc, privateKeyPem, meta = {}) {
  const { signature: _drop, ...rest } = isPlainObject(doc) ? doc : {};
  const bytes = Buffer.from(canonicalJson(rest), 'utf8');
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(
      `the signing key is ${key.asymmetricKeyType}, and a pack is signed with ed25519`,
    );
  }
  const publicKeyPem = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();
  return {
    ...rest,
    signature: {
      alg: 'ed25519',
      keyId: meta.keyId || CURRENT_PUBLISHER_KEY_ID,
      fingerprint: keyFingerprint(publicKeyPem),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sig: cryptoSign(null, bytes, key).toString('base64'),
      signedAt: meta.now ?? Date.now(),
    },
  };
}

/**
 * Is this document signed by a key this build trusts?
 *
 * Returns a result rather than throwing, because every caller has something
 * better to do with the reason: the CLI prints one line, the loader skips the
 * pack and logs it, and the test suite asserts on it.
 *
 * @param {any} doc
 * @param {{keys?:ReadonlyArray<{id:string,pem:string,retired?:boolean}>}} [opts]
 * @returns {{ok:true, keyId:string, retired:boolean} | {ok:false, error:string}}
 */
export function verifyPackSignature(doc, opts = {}) {
  const keys = opts.keys || PUBLISHER_KEYS;
  if (!isPlainObject(doc)) return { ok: false, error: 'that is not a pack document' };
  const sig = doc.signature;
  if (!isPlainObject(sig)) {
    return {
      ok: false,
      error: 'this pack is not signed. DeckHQ only loads packs signed by its publisher key.',
    };
  }
  if (sig.alg !== 'ed25519') {
    return { ok: false, error: `unknown signature algorithm ${JSON.stringify(sig.alg)}` };
  }
  if (typeof sig.sig !== 'string' || !sig.sig) {
    return { ok: false, error: 'the signature block carries no signature' };
  }

  let bytes;
  try {
    bytes = signedBytes(doc);
  } catch (err) {
    return { ok: false, error: `this pack cannot be canonicalised: ${errorText(err)}` };
  }

  // The digest is a courtesy, not the check: it turns "the signature does not
  // match" into "the file was edited after it was signed" for the common case.
  if (typeof sig.sha256 === 'string') {
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== sig.sha256) {
      return { ok: false, error: 'this pack has been edited since it was signed' };
    }
  }

  let raw;
  try {
    raw = Buffer.from(sig.sig, 'base64');
  } catch {
    return { ok: false, error: 'the signature is not base64' };
  }

  for (const key of keys) {
    let ok = false;
    try {
      ok = cryptoVerify(null, bytes, createPublicKey(key.pem), raw);
    } catch {
      ok = false;
    }
    if (ok) return { ok: true, keyId: key.id, retired: key.retired === true };
  }

  const wanted = typeof sig.keyId === 'string' ? sig.keyId : '(unnamed)';
  const known = keys.map((k) => k.id).join(', ');
  return {
    ok: false,
    error:
      `this pack's signature does not match any DeckHQ publisher key. ` +
      `It names key "${wanted}"; this build knows ${known}.`,
  };
}

/** @param {unknown} err */
function errorText(err) {
  return (err && /** @type {any} */ (err).message) || String(err);
}

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

// ---------------------------------------------------------------------------
// The installed directory
// ---------------------------------------------------------------------------

/**
 * Where one installed pack's document lives.
 * @param {string} name  already validated by `PACK_NAME_RE`
 * @param {string} [dir]
 */
export function packFileFor(name, dir = PACKS_DIR) {
  return path.join(dir, name, 'pack.json');
}

/**
 * Every pack installed under `dir`, loaded and validated.
 *
 * NEVER THROWS. A missing directory is no packs; an unreadable, unsigned,
 * tampered or malformed pack is one entry in `errors` and the others still
 * load. The floor must come up whatever is in this directory — a pack is
 * decoration, and decoration that cannot be read must not be able to stop the
 * product that captures your sessions.
 *
 * @param {{dir?:string, keys?:ReadonlyArray<{id:string,pem:string,retired?:boolean}>}} [opts]
 * @returns {{packs:Pack[], errors:Array<{name:string, error:string}>}}
 */
export function loadPacks(opts = {}) {
  const dir = opts.dir || PACKS_DIR;
  /** @type {Pack[]} */
  const packs = [];
  /** @type {Array<{name:string, error:string}>} */
  const errors = [];

  /** @type {string[]} */
  let entries;
  try {
    entries = fs.readdirSync(dir).sort();
  } catch {
    return { packs, errors };
  }

  for (const entry of entries) {
    const file = path.join(dir, entry, 'pack.json');
    let text;
    try {
      if (!fs.statSync(path.join(dir, entry)).isDirectory()) continue;
      text = fs.readFileSync(file);
    } catch (err) {
      errors.push({ name: entry, error: `could not read ${file}: ${errorText(err)}` });
      continue;
    }
    const result = parsePack(text, { keys: opts.keys });
    if ('error' in result) {
      errors.push({ name: entry, error: result.error });
      continue;
    }
    // The directory is the pack's identity on disk. A pack that says it is
    // called something else was renamed after it was signed, or installed by
    // hand into the wrong place; either way loading it would mean
    // `pack remove <name>` could not find it.
    if (result.pack.name !== entry) {
      errors.push({
        name: entry,
        error: `the directory is "${entry}" but the pack inside says it is "${result.pack.name}"`,
      });
      continue;
    }
    if (packs.some((p) => p.name === result.pack.name)) {
      errors.push({ name: entry, error: `"${result.pack.name}" is installed twice` });
      continue;
    }
    packs.push(result.pack);
  }

  return { packs, errors };
}

// ---------------------------------------------------------------------------
// What the running product sees
// ---------------------------------------------------------------------------

/**
 * `mtimeMs:size` for every `pack.json` under `dir`, plus the directory's own
 * mtime. The same trick `rates.mjs` uses on the rate card and for the same
 * reason: a user who installs a pack should not have to restart the daemon,
 * and stat'ing a handful of small files is cheaper than re-parsing them.
 * @param {string} dir
 */
function packsStamp(dir) {
  /** @type {string[]} */
  const parts = [];
  try {
    const st = fs.statSync(dir);
    parts.push(`${st.mtimeMs}`);
    for (const entry of fs.readdirSync(dir).sort()) {
      try {
        const f = fs.statSync(path.join(dir, entry, 'pack.json'));
        parts.push(`${entry}:${f.mtimeMs}:${f.size}`);
      } catch {
        parts.push(`${entry}:-`);
      }
    }
  } catch {
    return '';
  }
  return parts.join('|');
}

/** @type {{dir:string, stamp:string, checkedAt:number, result:any}|null} */
let PACKS_CACHE = null;

/** How long a load is trusted before the directory is stat'd again. */
export const PACKS_RECHECK_MS = 1000;

/**
 * Every installed pack, with its themes registered with the renderer.
 *
 * This is the one function that connects a file on disk to what the picker
 * offers, and it is deliberately the only one: `clearPackThemes()` first,
 * then register what loaded, so a removed pack's theme disappears on the same
 * pass a new one appears — the registry is a projection of the directory and
 * never an accumulation of everything ever seen.
 *
 * Registering is idempotent and never throws. A theme the renderer refuses
 * joins the pack's `rejected` list beside the ones the schema refused, so one
 * list answers "what did DeckHQ not take from this pack, and why".
 *
 * @param {{dir?:string, force?:boolean, now?:number, keys?:any}} [opts]
 * @returns {{packs:Pack[], errors:Array<{name:string,error:string}>, themes:string[], avatars:any[]}}
 */
export function currentPacks(opts = {}) {
  const dir = opts.dir || PACKS_DIR;
  const now = opts.now ?? Date.now();
  if (
    !opts.force &&
    PACKS_CACHE &&
    PACKS_CACHE.dir === dir &&
    now - PACKS_CACHE.checkedAt < PACKS_RECHECK_MS
  ) {
    return PACKS_CACHE.result;
  }
  const stamp = packsStamp(dir);
  if (!opts.force && PACKS_CACHE && PACKS_CACHE.dir === dir && PACKS_CACHE.stamp === stamp) {
    PACKS_CACHE.checkedAt = now;
    return PACKS_CACHE.result;
  }

  const { packs, errors } = loadPacks({ dir, keys: opts.keys });
  clearPackThemes();
  clearPackAvatarSets();
  /** @type {string[]} */
  const themes = [];
  /** @type {any[]} */
  const avatars = [];
  for (const pack of packs) {
    const themeResult = registerPackThemes(pack.name, pack.themes);
    const avatarResult = registerPackAvatarSets(pack.name, pack.avatars);
    themes.push(...themeResult.added);
    pack.rejected = [
      ...pack.rejected,
      ...[...themeResult.rejected, ...avatarResult.rejected].map(
        (r) => `the renderer refused ${r}`,
      ),
    ];
    // Something the renderer refused is not offered, so it must not be listed
    // as something this pack carries either.
    pack.themes = pack.themes.filter((t) => themeResult.added.includes(t.name));
    pack.avatars = pack.avatars.filter((a) => avatarResult.added.includes(a.name));
    for (const set of pack.avatars) avatars.push({ ...set, pack: pack.name });
  }
  const result = { packs, errors, themes, avatars };
  PACKS_CACHE = { dir, stamp, checkedAt: now, result };
  return result;
}

/** Forget the cached load AND everything a pack registered. For tests. */
export function clearPacks() {
  PACKS_CACHE = null;
  clearPackThemes();
  clearPackAvatarSets();
}

/**
 * Copy a verified pack file into the packs directory.
 *
 * Verification happens HERE as well as in the CLI, and not as belt and
 * braces: this is the only function that writes into the packs directory, so
 * it is the one place that can promise nothing unsigned ever lands there.
 *
 * @param {string|Buffer} text  the pack file's bytes
 * @param {{dir?:string, keys?:any}} [opts]
 * @returns {{ok:true, pack:Pack, file:string, replaced:string|null} | {ok:false, error:string}}
 */
export function installPack(text, opts = {}) {
  const dir = opts.dir || PACKS_DIR;
  const result = parsePack(text, { keys: opts.keys });
  if ('error' in result) return { ok: false, error: result.error };

  const file = packFileFor(result.pack.name, dir);
  /** @type {string|null} */
  let replaced = null;
  try {
    const before = JSON.parse(fs.readFileSync(file, 'utf8'));
    replaced = typeof before.version === 'string' ? before.version : 'an unknown version';
  } catch {
    replaced = null;
  }

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Written from the parsed document rather than copied byte for byte, so
    // what lands on disk is what was verified rather than what was on the
    // other side of the read. It re-verifies on load either way.
    fs.writeFileSync(file, `${JSON.stringify(result.doc, null, 2)}\n`, 'utf8');
  } catch (err) {
    return { ok: false, error: `could not write ${file}: ${errorText(err)}` };
  }
  return { ok: true, pack: result.pack, file, replaced };
}

/**
 * Delete an installed pack.
 * @param {string} name
 * @param {{dir?:string}} [opts]
 * @returns {{ok:true, dir:string} | {ok:false, error:string}}
 */
export function removePack(name, opts = {}) {
  const dir = opts.dir || PACKS_DIR;
  const key = String(name ?? '')
    .trim()
    .toLowerCase();
  if (!PACK_NAME_RE.test(key)) return { ok: false, error: `"${name}" is not a pack name` };
  const target = path.join(dir, key);
  if (!fs.existsSync(target)) return { ok: false, error: `no pack called "${key}" is installed` };
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (err) {
    return { ok: false, error: `could not remove ${target}: ${errorText(err)}` };
  }
  return { ok: true, dir: target };
}
