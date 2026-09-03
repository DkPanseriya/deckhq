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
 * THE INVARIANT: assignment never writes a user-owned field. `name` and
 * `avatar` belong to the user and are written by `setDisplay` and by nothing
 * else, ever. `given` is the daemon's, and a user rename simply outranks it
 * (`displayName` still means "the user chose this", everywhere in the tree
 * that already asks that question). Guarded in identity.test.mjs.
 */

import { SHORT_NAMES } from '../../public/names.js';

/**
 * @typedef {object} IdentityRecord
 * @property {number} projectMk
 * @property {number} agentMk
 * @property {string} mk            e.g. 'MK3.2'
 * @property {string|null} displayName  the USER's chosen name, or null
 * @property {string|null} givenName    the auto-assigned first name
 * @property {string|null} avatar
 * @property {string} label         displayName ?? givenName ?? mk
 */

/**
 * FNV-1a over the agent id, 32-bit: where in `SHORT_NAMES` this agent starts
 * looking. Only a starting point — the search below walks forward from it past
 * anything already in use — so two agents never share a name, and the same
 * agent starts from the same place on a machine that has seen nobody else.
 * @param {string} str
 * @returns {number} unsigned 32-bit
 */
function nameHash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
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

  /** @returns {{projects: Record<string, number>, agents: Record<string, number>, projectOf: Record<string, string>, names: Record<string, {name?: string|null, avatar?: string|null}>, nextProject: number}} */
  _state() {
    const s = this.store.identity;
    if (!s.projects) s.projects = {};
    if (!s.agents) s.agents = {};
    if (!s.names) s.names = {};
    if (!s.projectOf) s.projectOf = {};
    if (typeof s.nextProject !== 'number') s.nextProject = 1;
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
    const start = nameHash(agentId) % SHORT_NAMES.length;
    let chosen = null;
    for (let i = 0; i < SHORT_NAMES.length && chosen === null; i++) {
      const candidate = SHORT_NAMES[(start + i) % SHORT_NAMES.length];
      if (!used.has(candidate.toLowerCase())) chosen = candidate;
    }
    if (chosen === null) {
      // More agents than names. A repeated name would be worse than a plain
      // one: two agents both called Wren is exactly the confusion the MK tag
      // was invented to end. `used.size + 2` is a bound that cannot fail —
      // there are at most `used.size` names in the way.
      const base = SHORT_NAMES[start];
      for (let n = 2; n < used.size + 3 && chosen === null; n++) {
        const candidate = `${base} ${n}`;
        if (!used.has(candidate.toLowerCase())) chosen = candidate;
      }
    }

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
      avatar: rec.avatar ?? null,
      label: displayName || givenName || mk,
    };
  }

  /**
   * A junior's identity (WP-41), which is DERIVED AND NEVER PERSISTED.
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
   * It says whose junior it is, it is short enough for a floor label, and it
   * writes nothing. The junior's FACE is unaffected — `appearanceFor()` is a
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
      avatar: null,
      label: mk,
    };
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
