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
 *
 * ============================================================================
 * WP-22 follow-up · this file is the store: where a pack lives on disk, how
 * the set of installed packs is loaded, cached and invalidated, and how one
 * is installed or removed. The rest is two modules, both re-exported from
 * here so nothing that imports `packs.mjs` had to change:
 *
 *   packs-format.mjs    the constants a pack file is measured against
 *   packs-sign.mjs      canonical bytes, the fingerprint, sign and verify
 *   packs-validate.mjs  what a pack must be, and what it may carry
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';

import { PACKS_DIR } from './paths.mjs';
import { clearPackThemes, registerPackThemes } from '../../public/render/themes.js';
import { clearPackAvatarSets, registerPackAvatarSets } from './avatars.mjs';
import { errorText, PACK_NAME_RE } from './packs-format.mjs';
import { parsePack } from './packs-validate.mjs';

export * from './packs-format.mjs';
export * from './packs-sign.mjs';
export * from './packs-validate.mjs';

/** @typedef {import('./packs-validate.mjs').Pack} Pack */

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
export function packsStamp(dir) {
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
export let PACKS_CACHE = null;

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
