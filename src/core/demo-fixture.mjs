/**
 * The actors: what a machine with no sessions shows instead of an empty room.
 *
 * `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §7 and
 * `docs/plan/05-GUI-UX-SPEC.md` §7 (WP-13). A user who installs DeckHQ before
 * they have run anything currently gets "Nothing on the floor yet" and a
 * `<code>claude</code>` block — the blank screen Warp's own post-mortem names
 * as its activation problem. Instead the floor comes up populated by actors,
 * with one line saying exactly what they are, and the moment a real session
 * appears they are gone and it walks in alone.
 *
 * WHY THIS IS SERVER SIDE. The obvious implementation is to boot
 * `scripts/demo-floor.mjs`, which builds a fake `~/.claude` and drives a real
 * daemon through real hooks. That is right for screenshots and wrong here: it
 * writes a fixture tree to disk, spawns a second daemon, and would put actor
 * sessions into the user's own scan path where an ack could land on one. This
 * module instead produces a snapshot-shaped object that never enters the
 * registry, never reaches the store, and carries `demo: true` so every
 * consumer can tell it apart. Nothing in it is addressable: the ids are not in
 * `registry.agents`, so `/api/ack`, `/api/send` and `/api/resume` all 404 on
 * them by construction rather than by a check somebody has to remember.
 *
 * THE INVARIANT (docs/01-PRODUCT.md §2) is untouched: no code path here reads
 * or writes `ackState`, and the fixture is discarded the instant the scan
 * returns anybody real.
 *
 * Everything is a pure function of the `now` passed in, so two calls a second
 * apart produce the same floor and `test/goldens/` can photograph it.
 */

import { counts as countsOf, projects as projectsOf } from './model.mjs';

const MINUTE = 60_000;

/**
 * The line under the floor. Second person, but never second-person *fault*
 * (`04` §5): it says what to do, not what you failed to do.
 */
export const DEMO_NOTE = 'These are actors. Run `claude` in any repo and a real one walks in.';

/**
 * The cast.
 *
 * Small on purpose — seven actors across three rooms. The empty-machine floor
 * exists to answer one question ("what is this thing?") in about five seconds,
 * and a 51-session reference floor answers it worse than a legible one. The
 * mix is chosen to show the two states that are the whole product: somebody
 * standing in your office waiting on you, and somebody with their hand up.
 *
 * Rows are `[project, title, activityState, ackState, ageMinutes, waitMinutes]`.
 * `waitMinutes` is how long a `for_review` actor has been standing in the
 * office, or a `needs_input` actor has had its hand up; it is ignored for the
 * rest.
 *
 * @type {ReadonlyArray<readonly [string, string, string, string, number, number]>}
 */
const CAST = Object.freeze([
  ['orbital-api', 'Rate limiter for the public API', 'working', 'active', 6, 0],
  ['orbital-api', 'Migrate auth to short-lived tokens', 'needs_input', 'active', 41, 12],
  ['orbital-api', 'Backfill the events table', 'for_review', 'active', 96, 74],
  ['checkout-flow', 'Apple Pay in the express lane', 'for_review', 'active', 150, 26],
  ['checkout-flow', 'Refund path leaves orphaned rows', 'working', 'active', 18, 0],
  ['design-system', 'Dark mode audit across 40 components', 'stalled', 'active', 220, 0],
  ['design-system', 'Token pipeline to Figma', 'ended', 'benched', 640, 0],
]);

/** What each actor is holding, so the thought bubbles (WP-52) have something true to say. */
const TOOLS = Object.freeze({
  'Rate limiter for the public API': { name: 'Bash', summary: 'npm test' },
  'Refund path leaves orphaned rows': { name: 'Edit', summary: 'src/refunds/reconcile.ts' },
});

/** The last thing each actor said, for the review card. */
const LAST_TEXT = Object.freeze({
  'Backfill the events table':
    'Backfilled 1.2M rows in 14 batches. The two rows that failed the check constraint are ' +
    'listed in backfill-errors.csv. Want me to open the PR?',
  'Apple Pay in the express lane':
    'Express lane now offers Apple Pay when the browser advertises it, and falls back to the ' +
    'card form when it does not. Tests cover both paths.',
  'Migrate auth to short-lived tokens':
    'Refresh tokens can live in a cookie or in the keychain. Which do you want?',
});

/**
 * Where the actors "work". A path that is obviously fictional, so nothing in a
 * screenshot of the demo floor can be mistaken for a directory on the machine
 * that took it, and so `projectIdFromCwd` produces a slug that cannot collide
 * with a real project.
 * @param {string} project
 */
function demoCwd(project) {
  return `/deckhq-demo/${project}`;
}

/**
 * Build the actor floor.
 *
 * @param {{now?: number, settings?: any, hooks?: any, degraded?: any,
 *          writeError?: any, takenNames?: string[], scannedAt?: number|null}} [opts]
 * @returns {any} a snapshot in the shape of `Registry.snapshot()`, plus `demo`
 *   and `demoNote`
 */
export function buildDemoSnapshot(opts = {}) {
  const now = opts.now ?? Date.now();

  /** @type {Map<string, number>} project slug -> its MK number, in first-seen order */
  const projectMks = new Map();
  /** @type {Map<string, number>} project slug -> how many actors it has so far */
  const seatsTaken = new Map();

  const agents = CAST.map(([project, title, activityState, ackState, ageMin, waitMin], i) => {
    const cwd = demoCwd(project);
    const projectId = `deckhq-demo-${project}`;
    if (!projectMks.has(projectId)) projectMks.set(projectId, projectMks.size + 1);
    const projectMk = /** @type {number} */ (projectMks.get(projectId));
    const agentMk = (seatsTaken.get(projectId) ?? 0) + 1;
    seatsTaken.set(projectId, agentMk);

    const lastActivityAt = now - ageMin * MINUTE;
    const waitedSince = waitMin > 0 ? now - waitMin * MINUTE : null;
    const tool = TOOLS[title];

    return {
      // Not a session id shape any runtime produces, and prefixed so it is
      // obvious in a bug report which floor a screenshot came from.
      id: `demo:actor-${i + 1}`,
      runtime: 'claude-code',
      title,
      hasCustomTitle: true,
      projectId,
      projectName: project,
      cwd,
      gitBranch: i % 3 === 0 ? 'main' : `feat/${project}-${i + 1}`,
      model: 'claude-sonnet-4-5',
      live: activityState === 'working' || activityState === 'needs_input',
      activityState,
      ackState,
      reviewSince: activityState === 'for_review' ? waitedSince : null,
      needsInputSince: activityState === 'needs_input' ? waitedSince : null,
      lastOutputAt: lastActivityAt,
      lastActivityAt,
      tokens: 40_000 + i * 23_000,
      cacheTokens: 120_000 + i * 51_000,
      // A number the user can see is not theirs. It is still labelled an
      // estimate everywhere it is drawn (standing rule 7).
      costEstimate: 0.42 + i * 0.37,
      lastRole: activityState === 'needs_input' ? 'assistant' : 'assistant',
      lastText: LAST_TEXT[title] || '',
      currentTool: tool ? { ...tool, since: now - 4_000 } : null,
      turnEnded: activityState === 'for_review',
      archived: false,
      // Identity, normally stamped on by `Identity.describe()` in
      // `Registry.snapshot()`. The actors are not in the identity store — they
      // would take real MK numbers and real names away from real sessions — so
      // they carry their own, derived from their position in the cast.
      projectMk,
      agentMk,
      mk: `MK${projectMk}.${agentMk}`,
      displayName: null,
      avatar: null,
      label: `MK${projectMk}.${agentMk}`,
    };
  });

  const projects = projectsOf(agents).map((p) => ({
    ...p,
    hasDashboard: false,
    archived: false,
    projectMk: /** @type {number} */ (projectMks.get(p.id)),
    mk: `MK${projectMks.get(p.id)}`,
  }));

  return {
    agents,
    projects,
    counts: countsOf(agents),
    settings: opts.settings ?? {},
    takenNames: opts.takenNames ?? [],
    hooks: opts.hooks ?? {},
    // An empty machine has no runtime in use, so nothing can be degraded. The
    // actors must never put the "install hooks for exact state" banner up:
    // there is nothing on this machine for hooks to be exact about yet.
    degraded: {},
    writeError: opts.writeError ?? null,
    scannedAt: opts.scannedAt ?? null,
    /**
     * The flag every consumer keys off. It is on the snapshot rather than
     * inferred from the ids because "is this floor real" is a question the
     * terminal deck, the status line and `doctor` all have to answer, and
     * inferring it from an id prefix would be a rule each of them could get
     * subtly wrong.
     */
    demo: true,
    demoNote: DEMO_NOTE,
  };
}

/**
 * Strip the actors out of a snapshot that has them.
 *
 * The demo floor is a browser onboarding device and nothing else. `deckhq
 * waiting`, `deckhq statusline` and `deckhq doctor` all read `/api/state`, and
 * every one of them is answering a question about the real machine — "is
 * anything waiting on me" must be `0`, not `2`, on a machine with no sessions.
 * Reporting actors there would put fake work in a terminal prompt, which is
 * the one place in this product that has to be true at a glance.
 *
 * Returns the snapshot unchanged when it is real, so callers can apply it
 * unconditionally.
 *
 * @template {{demo?: boolean}} T
 * @param {T} snapshot
 * @returns {T}
 */
export function withoutDemoAgents(snapshot) {
  if (!snapshot || !snapshot.demo) return snapshot;
  return {
    ...snapshot,
    agents: [],
    projects: [],
    counts: countsOf([]),
    demo: true,
  };
}
