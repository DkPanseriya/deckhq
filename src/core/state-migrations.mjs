/**
 * `state.json`'s version, and the one-way passes that carry an older file up to
 * it (WP-86, docs/DEVIATIONS.md §168).
 *
 * ## Why this exists at all
 *
 * `state.json` had a `version: 1` that nothing read and nothing ever changed,
 * because until now every change to the file was additive and `normalize()`
 * could fill a missing key in. WP-86 is the first change that has to REWRITE
 * something a previous build wrote: the names on the owner's floor read
 * `Livia 2`, `Greta 2`, `Sena 3`, and they read that way because they were
 * assigned when the pool held sixty names. Growing the pool does nothing for
 * them — an identity is written once and never reassigned — so the suffixes
 * would have outlived the defect that produced them for as long as those
 * sessions existed.
 *
 * ## The rules a migration here keeps
 *
 *   1. **Versioned.** A pass runs when the file's `version` is below the pass's
 *      own, and never again after `version` reaches `STATE_VERSION`.
 *   2. **Idempotent anyway.** Version or no version, running a pass twice over
 *      the same data must produce the same data. `load()` happens twice on a
 *      normal start (`startDaemon`, then `Registry.start`) and the debounced
 *      write may not have landed in between, so the second pass genuinely does
 *      see the unmigrated file again. Every pass below is a pure function of
 *      what it reads.
 *   3. **Recorded.** What ran, when, and what it did is written into
 *      `state.json` under `migrations`, so a machine can say why a name
 *      changed. `deckhq doctor` reads the same block.
 *   4. **Never on a fresh file.** `defaultData()` starts at `STATE_VERSION`, so
 *      a machine that has never run DeckHQ migrates nothing — which is what
 *      keeps the goldens' demo fixture, rebuilt from nothing on every capture,
 *      byte for byte what it was.
 */

import { isSuffixedName, pickGivenName } from './identity.mjs';

/**
 * The version a state file written by this build carries.
 *
 * 1 → 2: WP-86's suffixed given names are taken away once.
 */
export const STATE_VERSION = 2;

/**
 * Take the pool's "we ran out" markers away, once.
 *
 * Every persisted identity whose given name matches `SUFFIXED_NAME_RE` is
 * handed the name the ordinary walk would have given it — hash-seeded from the
 * same agent id, first free name in the pool — and the marker is kept beside it
 * as `formerName` with the instant it happened, so the panel can say
 * *"was Livia 2"* for a week and then stop (`identity.formerNameOf`).
 *
 * WHAT IT DOES NOT TOUCH. The MK number, the face (a pure function of the
 * session id, §105), the user's own `name` and `avatar`, and every record whose
 * given name is a name. A record with no free name left is left exactly as it
 * was rather than being handed a second marker.
 *
 * WHY THE ORDER IS SORTED. `Object.entries` is insertion order, which is the
 * order the keys happen to sit in the file. Sorting the ids makes the result a
 * function of the CONTENT of the state file and nothing else, so two runs over
 * the same data — the double `load()` at daemon start — choose the same names.
 *
 * RESUME CHAINS (§155) need nothing special here and get nothing special. A
 * chain's members each have their own persisted identity and the floor reads
 * only the earliest one's, so renaming records one at a time renames each
 * IDENTITY once; the chain's visible name changes once, because the chain has
 * one visible identity. See `test/unit/identity-migration.test.mjs`.
 *
 * @param {{names?: Record<string, any>}} identity the state file's identity block
 * @param {number} at model time, for `renamedAt`
 * @returns {{renamed: {agentId:string, from:string, to:string}[], leftAlone: number}}
 */
export function renameSuffixedNames(identity, at) {
  const names = identity && identity.names ? identity.names : {};
  /** @type {{agentId:string, from:string, to:string}[]} */
  const renamed = [];
  let leftAlone = 0;

  /** Every name spoken for, lower-cased — the user's and the daemon's alike. */
  const used = new Set();
  for (const rec of Object.values(names)) {
    if (!rec) continue;
    if (typeof rec.name === 'string' && rec.name) used.add(rec.name.toLowerCase());
    if (typeof rec.given === 'string' && rec.given) used.add(rec.given.toLowerCase());
  }

  const suffixed = Object.keys(names)
    .filter((id) => names[id] && isSuffixedName(names[id].given))
    .sort();

  for (const agentId of suffixed) {
    const rec = names[agentId];
    const from = rec.given;
    // The marker is not a name and must not block the walk: drop it from the
    // used set before asking, or every rename would step around a string
    // nobody is going to be wearing a moment later.
    used.delete(from.toLowerCase());
    const { name, suffixed: stillSuffixed } = pickGivenName(agentId, used);
    if (stillSuffixed) {
      // 600 identities and no name left. Swapping one marker for another would
      // be churn for nothing, so this record keeps the marker it has.
      used.add(from.toLowerCase());
      leftAlone += 1;
      continue;
    }
    rec.given = name;
    rec.formerName = from;
    rec.renamedAt = at;
    used.add(name.toLowerCase());
    renamed.push({ agentId, from, to: name });
  }

  return { renamed, leftAlone };
}

/**
 * The passes, oldest first. `version` is the version the file carries AFTER the
 * pass has run.
 * @type {ReadonlyArray<{version:number, id:string, apply:(data:any, at:number) => Record<string, any>}>}
 */
export const MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 2,
    id: 'identity-suffixed-names',
    /** @param {any} data @param {number} at */
    apply(data, at) {
      const { renamed, leftAlone } = renameSuffixedNames(data.identity || {}, at);
      return { renamed: renamed.length, leftAlone };
    },
  }),
]);

/**
 * Carry a loaded state object up to `STATE_VERSION`, in place.
 *
 * A file with no readable version is treated as 1 — the version every build
 * before this one wrote — rather than as current: guessing "current" for an
 * unreadable value would skip a pass on exactly the old file it exists for.
 *
 * @param {any} data a normalised state object
 * @param {{now: number}} deps model time, injected (`core/clock.mjs`)
 * @returns {{from:number, to:number, ran:{id:string, version:number, detail:Record<string, any>}[]}}
 */
export function migrateState(data, deps) {
  const at = Number(deps?.now);
  const raw = Number(data?.version);
  const from = Number.isInteger(raw) && raw > 0 ? raw : 1;
  /** @type {{id:string, version:number, detail:Record<string, any>}[]} */
  const ran = [];
  if (!data.migrations || typeof data.migrations !== 'object') data.migrations = {};

  for (const pass of MIGRATIONS) {
    if (from >= pass.version) continue;
    const detail = pass.apply(data, at) || {};
    data.migrations[pass.id] = { at, version: pass.version, ...detail };
    ran.push({ id: pass.id, version: pass.version, detail });
  }

  data.version = Math.max(from, STATE_VERSION);
  return { from, to: data.version, ran };
}
