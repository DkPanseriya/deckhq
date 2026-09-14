/**
 * Who is on the floor, where they stand, and who has gone home — once.
 *
 * THIS IS THE ONLY COPY. It used to be two, either side of the static-file
 * boundary: `placement()` and `isGoneHome()` in `src/core/model.mjs`, and
 * `derivePlacement()` and `isGoneHome()` in `public/render/`. Both pairs
 * carried a comment telling the next person not to let them drift, and both
 * had drifted — `placement()`'s own signature stopped naming `subagent` when
 * WP-41 made it read that field (`docs/DEVIATIONS.md` §122 defect 9), and
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
 * THE STATES THAT KEEP A DESK IN A PROJECT ROOM (WP-78).
 *
 * The owner, 14 September: _"Only live working agents are on desks in the
 * project rooms. Everyone else is in the lounge area, so I can clearly see
 * which sessions are active at the moment."_ A room full of desks only answers
 * "who is working right now" if the only people at them are working right now.
 *
 * `stalled` is the ONE exception, and it is deliberate rather than an
 * oversight: a stalled session is `working` that has gone quiet past the stall
 * window (`01-PRODUCT.md` §4.2), it is still live, and it may produce its next
 * line a second from now. Standing it up and walking it to the lounge would
 * make the floor flicker on a timer rather than on an event, and it would have
 * to walk back. It keeps its desk, its slump and its stall badge.
 */
export const AT_DESK_STATES = Object.freeze(['working', 'stalled']);

/**
 * THE STATES THAT PUT A SESSION IN THE USER'S OFFICE (WP-78).
 *
 * The two "needs you" signals `01-PRODUCT.md` §4.2 names — blocked on a
 * question or a permission request (`needs_input`), and finished a turn and
 * awaiting review (`for_review`). Both need the user and nobody else, so both
 * wait where the user is. They stay visibly different once they are there: a
 * raised hand is still a raised hand.
 *
 * `01-PRODUCT.md` §4.2 said `needs_input` "stays at its desk"; that sentence is
 * superseded by this list. `docs/DEVIATIONS.md` §153.
 */
export const WAITING_STATES = Object.freeze(['needs_input', 'for_review']);

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
 * THREE ZONES, AND ONE QUESTION EACH (WP-78):
 *
 *   desk    is this session working for me right now?      `AT_DESK_STATES`
 *   office  is this session waiting on me right now?       `WAITING_STATES`
 *   lounge  everything else — ended, benched, gone home
 *
 * It used to be "a session that is not running still sits at its project desk;
 * only an explicit bench moves it to the lounge", which made a project room a
 * register of everything that had ever run in that repo. On the reference
 * machine that was 21 bodies at desks over one working session, and the room
 * the product is for stopped answering the question the product is for.
 *
 * SELECTING A SESSION MOVES NOBODY. Placement reads `ackState` and
 * `activityState` and nothing else — there is no `selected` here to read, and
 * the panel's selection is a ring on the floor (`03-VISUAL-SPEC.md` §8), never
 * a walk. Being *waiting* is what walks an agent to the manager's desk.
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
  const state = agent.activityState;
  if (/** @type {readonly string[]} */ (WAITING_STATES).includes(state)) return 'office';
  if (/** @type {readonly string[]} */ (AT_DESK_STATES).includes(state)) return 'desk';
  return 'lounge';
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
 * Everything `placement()` calls `desk`, which since WP-78 is working, stalled
 * and every junior standing beside its parent — and no longer an `ended`
 * session, which is in the lounge. It is what "desks equal agents at desks"
 * counts and what sizes a project room's tables.
 * @param {FloorAgent} agent
 */
export function isDeskAgent(agent) {
  return !!agent && agent.ackState === 'active' && placement(agent) === 'desk';
}

/**
 * Is this agent waiting on the user, at the manager's desk?
 *
 * The office population, stated once so the plan, the counts and the plate
 * cannot each derive it. A junior is never here (see `placement`).
 * @param {FloorAgent} agent
 */
export function isWaitingAgent(agent) {
  return !!agent && agent.ackState === 'active' && placement(agent) === 'office';
}

/**
 * When this agent started waiting on the user, as a ms epoch.
 *
 * The office queue is ordered oldest first (`03-VISUAL-SPEC.md` §7, WP-78's
 * "oldest wait nearest"), and since WP-78 the queue holds both waiting states,
 * so there are two clocks to read rather than one. Each state reads its own —
 * `reviewSince` for a finished turn, `needsInputSince` for a raised hand — and
 * an agent whose timestamp the adapter could not supply sorts to the BACK
 * rather than the front: an unknown wait is not evidence of a long one.
 *
 * Returns `Infinity` for anybody who is not waiting at all, so a caller may
 * sort a mixed list without filtering it first.
 *
 * @param {FloorAgent & {reviewSince?: number|null, needsInputSince?: number|null}} agent
 * @returns {number}
 */
export function waitingSince(agent) {
  if (!agent) return Infinity;
  const at =
    agent.activityState === 'for_review'
      ? agent.reviewSince
      : agent.activityState === 'needs_input'
        ? agent.needsInputSince
        : null;
  const n = Number(at);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
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
  /** Active sessions the lounge holds, per project (WP-78). @type {Map<string, number>} */
  const resting = new Map();
  /** Project ids the agent list actually mentions. See `buildPlan`. */
  const known = new Set();
  /** @type {Set<string>} */
  const goneHome = new Set();
  /** Newest activity per project — the idle list's third column. */
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
    if (isWaitingAgent(a)) waiting++;
    if (pid && isActiveAgent(a)) bump(active, pid);
    if (pid && isDeskAgent(a)) bump(desks, pid);
    // WP-78. An active session that is neither at a desk nor at the manager's
    // desk is resting in the lounge — `ended`, almost always. Counted PER
    // PROJECT because whether it is drawn at all still depends on whether its
    // project earned a room (`buildPlan`), which is not knowable here.
    if (placement(a) === 'lounge') bump(resting, pid);
  }

  return {
    now,
    goneHomeDays,
    waiting,
    benchedDrawn,
    goneHome,
    active,
    desks,
    resting,
    known,
    lastActivity,
  };
}

/**
 * WHICH REPOS ARE ON THE FLOOR, AND WHICH ARE ONLY IN THE LIST (`08` B6).
 *
 *   an active agent        -> a room, with desks for the agents at them
 *   nobody, PINNED         -> a room, empty, a third the size (WP-77)
 *   nobody, not archived   -> one line in the idle list
 *   nobody, archived       -> off the floor and out of the list entirely
 *
 * An active agent always wins, which is what makes archiving safe: a project
 * the user archived comes back by itself the moment somebody starts working in
 * that repo, rather than hiding them.
 *
 * AND A PIN IS THE USER SAYING SO DIRECTLY (WP-77). The owner: _"Pin any
 * particular project room so it is always in a room, so the room does not
 * collapse when agents are not running."_ A pinned repo is a room rather than a
 * line, which keeps WP-60's own property exactly as it was — **a repo with
 * sessions is a room or a line, never both and never neither** — rather than
 * inventing a third state that is half of each.
 *
 * ARCHIVING STILL WINS OVER PINNING, and deliberately: both are the user
 * speaking, and "take this off my floor" is the more recent and the more
 * specific of the two. The interface never offers both at once.
 *
 * ONE COPY, HERE, SINCE WP-60. It used to be three lines inside `buildPlan`,
 * which was right while the only thing that could ask was the strip the plan
 * drew. The idle list is a popover now — HTML, off the canvas, built from the
 * snapshot rather than from the plan — so a second caller exists, and a rule
 * about who is on the floor with two implementations is a floor and a list that
 * can disagree about the same repo. It lives in this file for the reason
 * everything else here does: it is the rule, not the drawing.
 *
 * @param {{id?:string, projectId?:string, name?:string, projectName?:string,
 *   sessionCount?:number, activeCount?:number, archived?:boolean,
 *   pinned?:boolean, lastActivityAt?:number}[]} projects
 * @param {ReturnType<typeof floorPopulation>} pop
 * @returns {{active: any[], pinned: any[], idle: {id:string, name:string,
 *   sessionCount:number, lastActivityAt:number}[]}}
 *   `active` are the project records that earn a full room, in the order given;
 *   `pinned` are the ones that earn an empty one; `idle` are the list's own
 *   lines, already reduced to what a line says.
 */
export function splitProjectsByOccupancy(projects, pop) {
  const idOf = (p) => String(p.id ?? p.projectId ?? 'unknown');
  // The counts a project is judged by are read off the AGENTS, which is the
  // whole point of B6. The fallback matters only for a caller that hands over a
  // project it gave no agents for: the rule cannot invent people it was not
  // given, so the project record's own counts are then the only thing to go on.
  const activeIn = (p) =>
    pop.known.has(idOf(p))
      ? (pop.active.get(idOf(p)) ?? 0)
      : (p.activeCount ?? p.sessionCount ?? 0);
  const isIdle = (p) => activeIn(p) === 0;
  const visible = (Array.isArray(projects) ? projects : []).filter(
    (p) => (p.sessionCount ?? 0) > 0 && !(isIdle(p) && p.archived),
  );
  const resting = visible.filter(isIdle);
  return {
    active: visible.filter((p) => !isIdle(p)),
    pinned: resting.filter((p) => p.pinned === true),
    idle: resting.filter((p) => p.pinned !== true).map((p) => lineOf(p, pop)),
  };
}

/** The shape one line of either list carries. @param {any} p @param {any} pop */
function lineOf(p, pop) {
  const id = String(p.id ?? p.projectId ?? 'unknown');
  return {
    id,
    name: String(p.name ?? p.projectName ?? id),
    sessionCount: p.sessionCount ?? 0,
    lastActivityAt: pop.lastActivity.get(id) ?? Number(p.lastActivityAt) ?? 0,
  };
}

/**
 * The idle list, from a snapshot alone.
 *
 * The convenience the DOM side actually wants: it holds a snapshot and nothing
 * else, and going through `floorPopulation` by hand at every call site is how
 * one of them ends up passing different options from the floor.
 *
 * PINNED REPOS ARE NOT IN IT (WP-77). They are rooms, and a repo that is a room
 * and a line is the thing WP-60's property forbids; `pinnedProjectsOf` below is
 * how the popover still offers the one action a pinned repo needs, which is
 * taking the pin back.
 *
 * @param {{projects?:any[], agents?:FloorAgent[], settings?:{goneHomeDays?:number}}} snapshot
 * @param {{now?:number}} [opts]
 */
export function idleProjectsOf(snapshot, opts = {}) {
  const snap = snapshot || {};
  const pop = floorPopulation(snap.agents || [], {
    now: opts.now,
    goneHomeDays: (snap.settings || {}).goneHomeDays,
  });
  return splitProjectsByOccupancy(snap.projects || [], pop).idle;
}

/**
 * The repos that are on the floor because the user PINNED them (WP-77), in the
 * same shape one idle line carries.
 *
 * It exists for one reason: the pin has to be reachable from the same place it
 * was made. A pinned repo leaves the idle list the moment it is pinned — it is
 * a room now — so without this the only way back would be the palette, and a
 * toggle you can turn on in one place and off in another is two controls.
 *
 * @param {{projects?:any[], agents?:FloorAgent[], settings?:{goneHomeDays?:number}}} snapshot
 * @param {{now?:number}} [opts]
 */
export function pinnedProjectsOf(snapshot, opts = {}) {
  const snap = snapshot || {};
  const pop = floorPopulation(snap.agents || [], {
    now: opts.now,
    goneHomeDays: (snap.settings || {}).goneHomeDays,
  });
  return splitProjectsByOccupancy(snap.projects || [], pop).pinned.map((p) => ({
    ...lineOf(p, pop),
    pinned: true,
  }));
}
