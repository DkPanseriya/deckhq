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
 */

/**
 * @typedef {object} IdentityRecord
 * @property {number} projectMk
 * @property {number} agentMk
 * @property {string} mk            e.g. 'MK3.2'
 * @property {string|null} displayName
 * @property {string|null} avatar
 * @property {string} label         displayName ?? mk
 */

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
    const rec = this._state().names[agentId] || {};
    const displayName = rec.name ?? null;
    return {
      projectMk,
      agentMk,
      mk,
      displayName,
      avatar: rec.avatar ?? null,
      label: displayName || mk,
    };
  }

  /** Every display name currently in use, so a picker can avoid collisions. */
  takenNames() {
    return Object.values(this._state().names)
      .map((r) => r && r.name)
      .filter(Boolean);
  }
}
