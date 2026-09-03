/**
 * Who is on the floor, where they stand, and who has gone home — once.
 *
 * THIS IS THE ONLY COPY. It used to be two, either side of the static-file
 * boundary: `placement()` and `isGoneHome()` in `src/core/model.mjs`, and
 * `derivePlacement()` and `isGoneHome()` in `public/render/`. Both pairs
 * carried a comment telling the next person not to let them drift, and both
 * had drifted — `placement()`'s own signature stopped naming `subagent` when
 * WP-41 made it read that field (`docs/DEVIATIONS.md` §121 defect 9), and
 * §106's whole rewrite exists because the header and the floor had two answers
 * to "who is drawn".
 *
 * THE BOUNDARY, AND WHY THIS IS ALLOWED TO CROSS IT. `docs/02-ARCHITECTURE.md`
 * §9 confines static serving to `publicDir`, so a browser module cannot reach
 * `src/core/*.mjs` — that direction is genuinely impossible and stays so. The
 * other direction was never impossible, only unused: Node resolves
 * `public/*.js` like any other path, and `src/core/identity.mjs` has imported
 * `public/names.js` for the name pool since WP-20. So the shared rule lives
 * HERE, on the side both can see, and `src/core/model.mjs` imports it.
 *
 * WHAT THAT COSTS, stated so it is a decision rather than an accident:
 *
 *   1. This file must stay pure. No DOM, no `node:` imports, no top-level side
 *     effect — it is loaded both by a browser over HTTP and by Node from disk.
 *     `test/unit/model.test.mjs` asserts that.
 *   2. It ships in both halves of the package, which it already did as two
 *     copies. `public/` is in `package.json`'s `files`.
 *   3. It is served to the browser as a static file, so it is public. It
 *     contains no secret, no path and no user data — it is four predicates
 *     over fields the client already has in every snapshot.
 *
 * Nothing here writes. Every function is a DISPLAY FILTER over observed
 * fields, which is why none of them can touch the invariant
 * (`docs/01-PRODUCT.md` §2): a session that is not drawn is still counted,
 * still in the panel and still one keystroke away.
 */

/**
 * The activity states that put a session on the floor at all — at a desk, hand
 * up, gone quiet, or standing in the office waiting to be seen. `08` B6.
 *
 * `ended` is not one of them: a session that has finished and been
 * acknowledged is history, not a person in the building.
 */
export const ON_THE_FLOOR = Object.freeze(['working', 'needs_input', 'stalled', 'for_review']);

/**
 * Days of no activity after which a benched session is not drawn on the floor.
 * `settings.goneHomeDays`; the same default `store.mjs` carries.
 */
export const GONE_HOME_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The subset of an agent this file reads. A `Pick<Agent, ...>` on the Node
 * side and an `AgentLike` on the browser side both satisfy it, which is what
 * lets one function serve both.
 *
 * @typedef {object} FloorAgent
 * @property {string} [id]
 * @property {string} [projectId]
 * @property {string} [ackState]
 * @property {string} [activityState]
 * @property {boolean} [subagent]
 * @property {number} [lastActivityAt] ms epoch; drives the gone-home filter
 */

/**
 * Is this a junior — a subagent its parent spawned (WP-41)?
 *
 * Stated as a function rather than read as a field wherever the answer decides
 * behaviour, for the reason §96 decision 3 gives: two representations of the
 * same thing, allowed to disagree, is the bug this project keeps having.
 * @param {FloorAgent} agent
 * @returns {boolean}
 */
export function isSubagent(agent) {
  return !!agent && agent.subagent === true;
}

/**
 * Placement is derived, never stored. `docs/02-ARCHITECTURE.md` §3.1.
 *
 * A session that is not running still sits at its project desk. Only an
 * explicit bench moves it to the lounge.
 *
 * @param {FloorAgent} agent
 * @returns {'desk'|'office'|'lounge'|'let_go'}
 */
export function placement(agent) {
  if (agent.ackState === 'let_go') return 'let_go';
  // WP-41. A junior is only ever beside its parent. It cannot be benched (the
  // user is never offered the button) and it never stands in the office: its
  // finished turn is handed to its parent, not to you, so putting it in the
  // waiting area would queue work nobody can discharge.
  if (isSubagent(agent)) return 'desk';
  if (agent.ackState === 'benched') return 'lounge';
  if (agent.activityState === 'for_review') return 'office';
  return 'desk';
}

/**
 * Does this agent put its project on the working floor?
 *
 * `08` B6, the rule the plan is built around: the plan is a function of active
 * projects and active agents and nothing else. An active agent is one the user
 * has not benched or archived, doing something.
 * @param {FloorAgent} agent
 */
export function isActiveAgent(agent) {
  return !!agent && agent.ackState === 'active' && ON_THE_FLOOR.includes(agent.activityState);
}

/**
 * Does this agent occupy a DESK in its project's room?
 *
 * Everything `placement()` calls `desk`: active, and not standing in the
 * office. That includes an `ended` session sitting at its own desk — it is
 * drawn whenever its project has a room, and it is what "desks equal agents at
 * desks" counts.
 * @param {FloorAgent} agent
 */
export function isDeskAgent(agent) {
  return !!agent && agent.ackState === 'active' && agent.activityState !== 'for_review';
}

/**
 * Has this benched agent gone home?
 *
 * A DISPLAY FILTER AND NOTHING ELSE. `ackState` is untouched, the agent is
 * still counted, still in the panel, still one keystroke away, and any new
 * activity brings it back on the next scan — which is why this reads
 * `lastActivityAt` rather than storing a flag anywhere. The `INVARIANT:` tests
 * must pass unchanged, and they do: nothing here writes.
 *
 * Two deliberate refusals. A window of zero disables the filter rather than
 * hiding everybody, and an agent whose last activity is unknown is DRAWN — the
 * floor does not hide what it cannot date.
 *
 * @param {FloorAgent} agent
 * @param {number} now ms epoch
 * @param {number} [goneHomeDays] `settings.goneHomeDays`
 */
export function isGoneHome(agent, now, goneHomeDays = GONE_HOME_DAYS) {
  if (!agent || agent.ackState !== 'benched') return false;
  const days = Number(goneHomeDays);
  if (!Number.isFinite(days) || days <= 0) return false;
  const last = Number(agent.lastActivityAt);
  if (!Number.isFinite(last) || last <= 0) return false;
  return now - last > days * DAY_MS;
}

/**
 * Everything the plan needs to know about a population, counted once.
 *
 * Exported because it is the whole of B6's rule in one place, and a test that
 * checks the rule should read the same numbers the floor is built from rather
 * than re-deriving them. It lives here rather than in `plan.js` for the same
 * reason everything else in this file does: it is the rule, not the drawing.
 *
 * @param {FloorAgent[]} agents
 * @param {{now?:number, goneHomeDays?:number}} [opts]
 */
export function floorPopulation(agents, opts = {}) {
  const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
  const goneHomeDays = opts.goneHomeDays ?? GONE_HOME_DAYS;
  const list = Array.isArray(agents) ? agents : [];

  let waiting = 0;
  let benchedDrawn = 0;
  /** @type {Map<string, number>} */
  const active = new Map();
  /** @type {Map<string, number>} */
  const desks = new Map();
  /** Project ids the agent list actually mentions. See `buildPlan`. */
  const known = new Set();
  /** @type {Set<string>} */
  const goneHome = new Set();
  /** Newest activity per project — the directory strip's third column. */
  const lastActivity = new Map();

  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

  for (const a of list) {
    if (!a || a.ackState === 'let_go') continue;
    const pid = a.projectId == null ? '' : String(a.projectId);
    if (pid) {
      known.add(pid);
      const at = Number(a.lastActivityAt) || 0;
      if (at > (lastActivity.get(pid) || 0)) lastActivity.set(pid, at);
    }
    if (a.ackState === 'benched') {
      if (isGoneHome(a, now, goneHomeDays)) goneHome.add(String(a.id));
      else benchedDrawn++;
      continue;
    }
    if (a.ackState !== 'active') continue;
    if (a.activityState === 'for_review') waiting++;
    if (pid && isActiveAgent(a)) bump(active, pid);
    if (pid && isDeskAgent(a)) bump(desks, pid);
  }

  return { now, goneHomeDays, waiting, benchedDrawn, goneHome, active, desks, known, lastActivity };
}
