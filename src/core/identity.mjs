/**
 * Stable short identities for projects and agents.
 *
 * A session title is the user's own sentence — too long to read on a floor
 * plan and different every time. What the floor needs is a tag short enough to
 * take in without reading: `MK3.2` is project three, agent two.
 *
 * The numbers must be STABLE. They are assigned the first time a project or an
 * agent is seen and then persisted, so re-sorting the floor, restarting the
 * daemon, or a project going quiet for a week never renumbers anything the
 * user has learned. A number is not reused after an agent is let go either —
 * reusing `MK3.2` for a different session would be worse than having a gap.
 *
 * A user-chosen display name replaces the tag on the floor but never replaces
 * the numbering underneath it.
 *
 * GIVEN NAMES (WP-20). Since `docs/plan/04` §4, every agent is also handed a
 * first name from `public/names.js` the first time it is seen, rather than
 * waiting for the user to ask for one. *"Ada has been waiting since
 * yesterday"* is a sentence that makes someone open a tab; *"MK3.2 has been
 * waiting since yesterday"* is not. The given name is persisted beside the MK
 * numbers, under its own key, and — like the numbers — is never reassigned.
 *
 * THE ONE EXCEPTION, AND IT IS NOT ONE (WP-86, docs/DEVIATIONS.md §168). A
 * given name is never reassigned. A `"<base> N"` suffix was never a name: it is
 * the marker this file writes when the pool is exhausted at the moment of
 * assignment, and for months it was engaged permanently because the pool held
 * sixty names and the owner's machine held ninety-two conversations. The pool
 * holds 600 now, and the markers that were already persisted are taken away
 * ONCE, by a versioned store migration that hands each of them the name the
 * same walk would have given it (`core/state-migrations.mjs`). The MK number
 * and the face are untouched, and the old marker is kept as `formerName` so the
 * panel can say "was Livia 2" for a week. Nothing else in this product ever
 * changes a name the daemon gave.
 *
 * THE INVARIANT: assignment never writes a user-owned field. `name` and
 * `avatar` belong to the user and are written by `setDisplay` and by nothing
 * else, ever. `given` is the daemon's, and a user rename simply outranks it
 * (`displayName` still means "the user chose this", everywhere in the tree
 * that already asks that question). Guarded in identity.test.mjs.
 */

import { ORIGINAL_POOL, SHORT_NAMES } from '../../public/names.js';
import { now as clockNow } from './clock.mjs';

/**
 * @typedef {object} IdentityRecord
 * @property {number} projectMk
 * @property {number} agentMk
 * @property {string} mk            e.g. 'MK3.2'
 * @property {string|null} displayName  the USER's chosen name, or null
 * @property {string|null} givenName    the auto-assigned first name
 * @property {string|null} formerName   the suffixed name WP-86's migration took
 *                                      away, for the week after it did (§168)
 * @property {string|null} avatar
 * @property {string} label         displayName ?? givenName ?? mk
 */

/**
 * What a name looks like when the pool ran out: `Livia 2`, `Greta 3`.
 *
 * WP-86 writes down what this always was. `"<base> N"` is not a name; it is a
 * MARKER saying there was no name left at the moment of assignment, and the
 * owner's floor was covered in them because the pool held sixty and his machine
 * held ninety-two conversations (§155.2, §156.4). The pool holds 600 now, which
 * is more than the fallback can be reached below, and the markers that were
 * already persisted are taken away once by a store migration — see
 * `renameSuffixedNames` in `state-migrations.mjs`.
 */
export const SUFFIXED_NAME_RE = /^(.+) (\d+)$/;

/**
 * How long the panel may say "was Livia 2" after the migration renamed
 * somebody. A week on the injected clock (`core/clock.mjs`), which is long
 * enough that anybody who opens DeckHQ in a normal week sees the sentence once
 * and short enough that it does not become part of the agent's identity. After
 * it, the old name is simply gone from every surface.
 */
export const FORMER_NAME_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Is this the pool's "we ran out" marker rather than a name?
 * @param {unknown} name
 * @returns {boolean}
 */
export function isSuffixedName(name) {
  return typeof name === 'string' && SUFFIXED_NAME_RE.test(name);
}

/**
 * The name WP-86's migration took away, while it is still worth saying.
 *
 * Null on every record that was never renamed — which is every record on a
 * machine that never ran out of names, and every record on a fresh install —
 * and null again once `FORMER_NAME_MS` has passed. The stored fields are left
 * alone rather than pruned: expiring a sentence is a read-side decision, and
 * `describe()` is a read (the WP-20 invariant: describing an agent writes no
 * field the user owns, and this writes no field at all).
 *
 * @param {{formerName?: string|null, renamedAt?: number|null}} rec
 * @param {number} at model time, from the injected clock
 * @returns {string|null}
 */
export function formerNameOf(rec, at) {
  if (!rec || typeof rec.formerName !== 'string' || !rec.formerName) return null;
  const since = Number(rec.renamedAt);
  if (!Number.isFinite(since) || since <= 0) return null;
  return at - since < FORMER_NAME_MS ? rec.formerName : null;
}

/**
 * FNV-1a over the agent id, 32-bit: where in `SHORT_NAMES` this agent starts
 * looking. Only a starting point — the search below walks forward from it past
 * anything already in use — so two agents never share a name, and the same
 * agent starts from the same place on a machine that has seen nobody else.
 * @param {string} str
 * @returns {number} unsigned 32-bit
 */
export function nameHash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * THE WALK. The one place a first name is chosen, so that the daemon assigning
 * one on first sight and WP-86's migration taking a suffix away cannot drift
 * apart: both start at `nameHash(agentId) % ORIGINAL_POOL` and take the first
 * name in the array that nobody is wearing.
 *
 * A NUMERIC SUFFIX IS THE LAST RESORT AND NOTHING ELSE. It is reached only when
 * every one of the 600 names is spoken for at the moment of assignment — 600
 * live identities on one machine — and it is a marker rather than a name; see
 * `SUFFIXED_NAME_RE`. `suffixed` is returned rather than inferred so a caller
 * can refuse it: the migration hands back a record untouched rather than
 * swapping one marker for another.
 *
 * @param {string} agentId
 * @param {Set<string>} used every name spoken for, lower-cased
 * @returns {{name: string, suffixed: boolean}}
 */
export function pickGivenName(agentId, used) {
  // WP-84. The start is taken modulo the pool's ORIGINAL block, not its whole
  // length. `% SHORT_NAMES.length` would have moved every unnamed agent's
  // starting point the moment the pool grew — a machine whose identities had
  // not been written yet (a fresh install, and the goldens' demo fixture, which
  // is rebuilt from nothing on every capture) would have drawn a different set
  // of names for the same floor. Anchoring the start to the old block makes
  // every growth purely additive: the walk below still runs the WHOLE array, so
  // all 600 names are reachable — they are simply what it reaches once the
  // first block is spoken for. See `public/names.js`'s header.
  const span = Math.min(ORIGINAL_POOL, SHORT_NAMES.length);
  const start = nameHash(agentId) % span;
  for (let i = 0; i < SHORT_NAMES.length; i++) {
    const candidate = SHORT_NAMES[(start + i) % SHORT_NAMES.length];
    if (!used.has(candidate.toLowerCase())) return { name: candidate, suffixed: false };
  }
  // More agents than names. A repeated name would be worse than a marked one:
  // two agents both called Wren is exactly the confusion the MK tag was
  // invented to end. `used.size + 2` is a bound that cannot fail — there are at
  // most `used.size` names in the way.
  const base = SHORT_NAMES[start];
  for (let n = 2; n < used.size + 3; n++) {
    const candidate = `${base} ${n}`;
    if (!used.has(candidate.toLowerCase())) return { name: candidate, suffixed: true };
  }
  return { name: base, suffixed: true };
}

/**
 * Assigns and remembers MK numbers.
 *
 * The store owns persistence; this owns the numbering rules.
 */
export class Identity {
  /** @param {import('./store.mjs').Store} store */
  constructor(store) {
    this.store = store;
  }

  /**
   * `names` carries three fields, not two: `name` and `avatar` are the user's,
   * `given` is the one this class assigns and never reassigns. The record type
   * used to name only the first two while `givenName()`, `_usedNames()` and
   * `takenNames()` all read and wrote the third (WP-22).
   * @returns {{projects: Record<string, number>, agents: Record<string, number>, projectOf: Record<string, string>, names: Record<string, {name?: string|null, avatar?: string|null, given?: string|null, formerName?: string|null, renamedAt?: number|null}>, nextProject: number, juniors: Record<string, {next: number, of: Record<string, number>}>}}
   */
  _state() {
    const s = this.store.identity;
    if (!s.projects) s.projects = {};
    if (!s.agents) s.agents = {};
    if (!s.names) s.names = {};
    if (!s.projectOf) s.projectOf = {};
    if (typeof s.nextProject !== 'number') s.nextProject = 1;
    if (!s.juniors) s.juniors = {};
    return s;
  }

  /**
   * The project's number, assigning one if this is the first time it is seen.
   * @param {string} projectId
   * @returns {number}
   */
  projectMk(projectId) {
    const s = this._state();
    if (typeof s.projects[projectId] !== 'number') {
      s.projects[projectId] = s.nextProject;
      s.nextProject += 1;
      this.store.touch();
    }
    return s.projects[projectId];
  }

  /**
   * The agent's number within its project. Never reuses a number, even after
   * the agent that held it has gone.
   * @param {string} agentId
   * @param {string} projectId
   * @returns {number}
   */
  agentMk(agentId, projectId) {
    const s = this._state();
    if (typeof s.agents[agentId] !== 'number') {
      this.projectMk(projectId);
      // One past the highest number ever handed out in this project. Counting
      // from what exists now would reuse the number of a let-go agent, and
      // MK3.2 meaning a different session than it did last week is worse than
      // a gap in the sequence.
      let max = 0;
      for (const [id, n] of Object.entries(s.agents)) {
        if (s.projectOf[id] === projectId && n > max) max = n;
      }
      s.agents[agentId] = max + 1;
      s.projectOf[agentId] = projectId;
      this.store.touch();
    }
    return s.agents[agentId];
  }

  /**
   * Every name currently spoken for, lower-cased: names the user chose, and
   * names the daemon gave. Both count — offering a picker a name another
   * agent is already wearing is the collision this exists to prevent.
   * @param {string} [exceptAgentId]
   * @returns {Set<string>}
   */
  _usedNames(exceptAgentId) {
    const used = new Set();
    for (const [id, rec] of Object.entries(this._state().names)) {
      if (id === exceptAgentId || !rec) continue;
      if (typeof rec.name === 'string' && rec.name) used.add(rec.name.toLowerCase());
      if (typeof rec.given === 'string' && rec.given) used.add(rec.given.toLowerCase());
    }
    return used;
  }

  /**
   * The agent's first name, assigning one if this is the first time it is
   * seen. Persisted immediately, so it survives a restart and is never
   * reassigned — a name the user has learned must be as stable as the MK tag
   * underneath it.
   *
   * Writes ONLY `given`. `name` and `avatar` are the user's (see the header).
   * @param {string} agentId
   * @returns {string}
   */
  givenName(agentId) {
    const s = this._state();
    const rec = s.names[agentId] || {};
    if (typeof rec.given === 'string' && rec.given) return rec.given;

    const used = this._usedNames(agentId);
    const chosen = pickGivenName(agentId, used).name;

    rec.given = chosen;
    s.names[agentId] = rec;
    this.store.touch();
    return chosen;
  }

  /**
   * Set or clear an agent's display name and avatar.
   * @param {string} agentId
   * @param {{name?: string|null, avatar?: string|null}} patch
   */
  setDisplay(agentId, patch) {
    const s = this._state();
    const rec = s.names[agentId] || {};
    if ('name' in patch) {
      const name = patch.name == null ? null : String(patch.name).trim().slice(0, 24);
      rec.name = name || null;
    }
    if ('avatar' in patch) {
      const avatar = patch.avatar == null ? null : String(patch.avatar).trim().slice(0, 24);
      rec.avatar = avatar || null;
    }
    s.names[agentId] = rec;
    this.store.touch();
    return rec;
  }

  /**
   * Everything the floor and the interface need to identify one agent.
   * @param {string} agentId
   * @param {string} projectId
   * @returns {IdentityRecord}
   */
  describe(agentId, projectId) {
    const projectMk = this.projectMk(projectId);
    const agentMk = this.agentMk(agentId, projectId);
    const mk = `MK${projectMk}.${agentMk}`;
    // Assigned before the record is read, so an agent seen for the first time
    // arrives already named rather than named one snapshot later.
    const givenName = this.givenName(agentId);
    const rec = this._state().names[agentId] || {};
    // `displayName` keeps meaning exactly what it meant before this package:
    // the name the USER chose, or null. Several places in the tree ask that
    // question — the pending-identity match in http/routes/actions.mjs is one
    // — and a daemon-assigned name must not answer yes to it.
    const displayName = rec.name ?? null;
    return {
      projectMk,
      agentMk,
      mk,
      displayName,
      givenName,
      formerName: formerNameOf(rec, clockNow()),
      avatar: rec.avatar ?? null,
      label: displayName || givenName || mk,
    };
  }

  /**
   * A junior's identity (WP-41): no MK number and no name of its own, only its
   * parent's tag and the `j<n>` that `juniorNumbers` keeps for it.
   *
   * `describe()` above assigns and stores an MK number and a first name the
   * first time it sees an agent, and never reassigns either — which is exactly
   * right for a session and exactly wrong for a subagent. A busy week spawns
   * hundreds of juniors that live for seconds; giving each one a permanent
   * number would burn through a project's MK sequence, grow `~/.deckhq`'s
   * identity table without bound, and drain the finite first-name pool
   * (`_usedNames` is what the picker avoids, and it never shrinks).
   *
   * So a junior wears its parent's tag with a suffix: `MK1.2j1`, `MK1.2j2`.
   * It says whose junior it is, it is short enough for a floor label, and all
   * it writes is that one number in its parent's bounded book. The junior's FACE is unaffected — `appearanceFor()` is a
   * pure function of the session id (§105), so a junior looks like itself and
   * like nobody else without any of this.
   *
   * The project number IS assigned, because the project is real and the parent
   * would have assigned it a moment later anyway.
   *
   * @param {IdentityRecord} parent the parent's own record, from `describe()`
   * @param {string} projectId
   * @param {number} index 1-based, in a stable order the caller decides
   * @returns {IdentityRecord}
   */
  describeJunior(parent, projectId, index) {
    const projectMk = this.projectMk(projectId);
    const mk = `${parent && parent.mk ? parent.mk : `MK${projectMk}`}j${index}`;
    return {
      projectMk,
      agentMk: parent && Number.isFinite(parent.agentMk) ? parent.agentMk : 0,
      mk,
      // A junior is never renamed and never named: both of these are the
      // user's or the daemon's word for a session, and a junior is neither.
      displayName: null,
      givenName: null,
      // A junior was never given a name, so there is nothing WP-86's
      // migration could ever have renamed.
      formerName: null,
      avatar: null,
      label: mk,
    };
  }

  /**
   * Each junior's `j<n>`, handed out once and kept in `state.json` (audit F6).
   *
   * The number is the junior's identity in the same sense an MK number is a
   * session's: once `MK1.2j3` has been read, it must keep meaning that junior
   * through siblings leaving AND through a daemon restart. So the books live in
   * the identity block beside the MK numbers, under `juniors`, and follow the
   * same rules — see `assignJuniorNumbers`. The MK number and the first name
   * stay unassigned for a junior, for WP-41's reasons (above).
   *
   * @param {any[]} agents the snapshot's agents; juniors carry `parentId`
   * @returns {Map<string, number>} junior agent id → its number
   */
  juniorNumbers(agents) {
    const { numbers, changed } = assignJuniorNumbers(this._state().juniors, agents);
    if (changed) this.store.touch();
    return numbers;
  }

  /**
   * Every name currently in use, so a picker can avoid collisions. Includes
   * the names the daemon gave as well as the ones the user chose: from the
   * floor's point of view a name is taken either way.
   */
  takenNames() {
    const out = [];
    for (const rec of Object.values(this._state().names)) {
      if (!rec) continue;
      if (rec.name) out.push(rec.name);
      if (rec.given && rec.given !== rec.name) out.push(rec.given);
    }
    return out;
  }
}

/**
 * How many of a parent's most recent junior numbers keep their holder's id on
 * file after the junior has left the snapshot. Older entries of juniors not on
 * the snapshot are dropped, which bounds the book by parents rather than by
 * every junior a week ever spawned; `next` is never dropped, so a number is
 * never handed out twice either way.
 */
export const JUNIOR_BOOK_KEEP = 64;

/**
 * A JUNIOR'S NUMBER IS ITS OWN (audit F6).
 *
 * Each junior is numbered once, the first time it is seen, with the next number
 * its parent has not handed out; juniors first seen together are numbered in
 * spawn order, then id. A number is never reassigned: `next` only grows, and a
 * junior on the snapshot is never dropped from its parent's book, so siblings
 * leaving — before or across a restart — renumber nobody.
 *
 * `books` is the persisted `identity.juniors` block, `parent id → {next, of:
 * {junior id → n}}`, mutated in place.
 *
 * @param {Record<string, {next:number, of:Record<string, number>}>} books
 * @param {any[]} agents
 * @returns {{numbers: Map<string, number>, changed: boolean}}
 */
export function assignJuniorNumbers(books, agents) {
  /** @type {Map<string, any[]>} */
  const byParent = new Map();
  for (const a of agents) {
    if (!a || a.subagent !== true) continue;
    const key = String(a.parentId ?? '');
    byParent.set(key, [...(byParent.get(key) || []), a]);
  }
  /** @param {any} a */
  const spawned = (a) => (Number.isFinite(Number(a.spawnedAt)) ? Number(a.spawnedAt) : Infinity);
  /** @type {Map<string, number>} */
  const numbers = new Map();
  let changed = false;
  for (const [key, list] of byParent) {
    if (!books[key]) {
      books[key] = { next: 0, of: {} };
      changed = true;
    }
    const book = books[key];
    const fresh = list
      .filter((a) => typeof book.of[String(a.id)] !== 'number')
      .sort((x, y) => spawned(x) - spawned(y) || String(x.id).localeCompare(String(y.id)));
    for (const a of fresh) {
      book.next += 1;
      book.of[String(a.id)] = book.next;
      changed = true;
    }
    const here = new Set(list.map((a) => String(a.id)));
    for (const [id, n] of Object.entries(book.of)) {
      if (here.has(id) || n > book.next - JUNIOR_BOOK_KEEP) continue;
      delete book.of[id];
      changed = true;
    }
    for (const a of list) numbers.set(String(a.id), book.of[String(a.id)]);
  }
  return { numbers, changed };
}
