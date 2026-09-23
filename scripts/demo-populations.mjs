/**
 * The floors this script can photograph (WP-22 follow-up).
 *
 * Split out of `demo-floor.mjs` unchanged: the README's floor, the reference
 * population the goldens compare against, the single-session and empty
 * floors, and WP-41's juniors.
 *
 * Everything about a population is a pure function of its name: ids, titles,
 * ages and token counts are all derived from the session's index, never from
 * the clock or a random source. That is what lets `scripts/goldens.mjs`
 * photograph each one and compare the pixels against a committed golden.
 *
 * The two "unknown NAME" refusals are here rather than in the entry point
 * because they have to run before `SESSIONS` is built, and `SESSIONS` is what
 * every writer below reads.
 */

import process from 'node:process';

import { themeByName, themeNames } from '../src/core/themes.mjs';
import { PACK_FILE, POPULATION, THEME } from './demo-args.mjs';

/**
 * The floor we want to photograph for the README.
 *
 * `state` is what the session should end up in, not something written
 * directly — `working`, `needs_input` and `stalled` are produced by posting
 * real hook events below, and `for_review` by the transcript ending on a
 * finished assistant turn.
 *
 * Rows are `[project, title, state, ageHours, tokensM]`.
 */
/** @type {Array<[string, string, string, number, number]>} */
export const DEMO_SESSIONS = [
  // orbital-api — the busy room: someone working, someone with a hand up.
  ['orbital-api', 'Rate limiter for the public API', 'working', 2.1, 0.4],
  ['orbital-api', 'Migrate auth to short-lived tokens', 'needs_input', 3.4, 0.9],
  ['orbital-api', 'Backfill the events table', 'for_review', 5.2, 1.6],
  ['orbital-api', 'Fix flaky integration suite', 'idle', 12, 0.8],
  ['orbital-api', 'Drop the legacy /v1 routes', 'idle', 30, 0.3],
  ['orbital-api', 'Split the deploy pipeline', 'benched', 52, 1.1],
  ['orbital-api', 'Postgres connection pool exhaustion', 'benched', 66, 0.7],

  // checkout-flow — two waiting on review.
  ['checkout-flow', 'Apple Pay in the express lane', 'for_review', 1.2, 2.2],
  ['checkout-flow', 'Refund path leaves orphaned rows', 'for_review', 7.8, 0.6],
  ['checkout-flow', 'Stripe webhook retries', 'idle', 26, 0.4],
  ['checkout-flow', 'Copy pass on the error states', 'benched', 44, 0.2],
  ['checkout-flow', 'Tax rounding off by a cent', 'benched', 58, 0.5],

  // design-system — one gone quiet, and one running two juniors (WP-41).
  ['design-system', 'Token pipeline to Figma', 'stalled', 0.8, 1.3],
  // `JUNIOR_PARENT` below. Freshly written on purpose: the adapter only opens
  // a session's `subagents/` directory when the session's own transcript has
  // moved recently (`SUBAGENT_PARENT_WINDOW_MS`), which is what stops a scan
  // paying a directory read per session on a machine with 70 of them.
  ['design-system', 'Dark mode audit across 40 components', 'working', 0.05, 3.1],
  ['design-system', 'Drop the old Button API', 'idle', 33, 0.5],
  ['design-system', 'Storybook a11y violations', 'benched', 47, 0.4],

  // data-pipeline — quiet room.
  ['data-pipeline', 'dbt models for retention', 'for_review', 19, 0.7],
  ['data-pipeline', 'Airflow DAG keeps timing out', 'idle', 40, 0.9],
  ['data-pipeline', 'Backfill 2024 events', 'benched', 63, 1.4],

  // mobile-app
  ['mobile-app', 'Offline queue for draft posts', 'working', 3.0, 1.8],
  ['mobile-app', 'Crash on cold start, Android 14', 'needs_input', 4.5, 0.5],
  ['mobile-app', 'Bump RN and unbreak the build', 'idle', 61, 2.4],
  ['mobile-app', 'Push notification permissions copy', 'benched', 70, 0.2],
  ['mobile-app', 'Deep links open the wrong tab', 'benched', 74, 0.3],

  // infra — all resting.
  ['infra-terraform', 'Move state to a remote backend', 'benched', 55, 0.6],
  ['infra-terraform', 'Least-privilege the CI role', 'let_go', 90, 0.3],
];

/**
 * The reference machine from docs/plan/08-PLAN-V2-100X.md §0: 70 sessions
 * across 18 projects, 1 at a desk, 2 in the office, 47 benched, the other 20
 * idle at their desks. It is the shape WP-50 exists to fix, so it is the shape
 * the goldens have to hold still.
 *
 * Built rather than listed: 70 hand-written rows would be noise. The 18 sizes
 * sum to 70; states are dealt so the counts land on §0's exactly.
 *
 * TWO CORRECTIONS MADE FOR WP-50, both so this fixture is the machine §0
 * measured rather than an approximation of it:
 *
 *   1. Both office sessions belong to ONE project. §0's floor is "one
 *      furnished room"; dealing the second one into `web-console` (it fell on
 *      index 14) gave the fixture a second active repo that the real machine
 *      did not have.
 *   2. Ages span a month, not five days. The real machine's 47 benched
 *      sessions had been benched for weeks — that is what the gone-home
 *      window is FOR — and a fixture whose oldest session is five days old
 *      cannot photograph it.
 */
export function referenceSessions() {
  /** @type {Array<[string, number]>} */
  const projects = [
    ['platform-api', 13],
    ['web-console', 9],
    ['billing-service', 7],
    ['search-indexer', 6],
    ['notifications', 5],
    ['auth-gateway', 4],
    ['mobile-ios', 4],
    ['mobile-android', 3],
    ['design-tokens', 3],
    ['docs-site', 3],
    ['infra-k8s', 3],
    ['data-warehouse', 2],
    ['ml-ranking', 2],
    ['cli-tools', 2],
    ['legacy-monolith', 1],
    ['status-page', 1],
    ['sdk-typescript', 1],
    ['marketing-site', 1],
  ];
  const verbs = ['Fix', 'Refactor', 'Migrate', 'Investigate', 'Add', 'Remove', 'Speed up', 'Test'];
  const nouns = [
    'the retry path',
    'pagination',
    'the cache layer',
    'flaky CI',
    'the audit log',
    'rate limits',
    'the onboarding flow',
    'config loading',
    'the metrics exporter',
    'the release script',
  ];
  /** @type {Array<[string, string, string, number, number]>} */
  const rows = [];
  let n = 0;
  let benched = 0;
  for (const [project, count] of projects) {
    for (let k = 0; k < count; k++) {
      /** @type {string} */
      let state;
      if (n === 0) state = 'working';
      else if (n === 1 || n === 2) state = 'for_review';
      else if (benched < 47 && n % 10 !== 5) {
        state = 'benched';
        benched++;
      } else state = 'idle';
      rows.push([
        project,
        `${verbs[n % verbs.length]} ${nouns[(n * 7) % nouns.length]}`,
        state,
        // Ages step from a couple of hours to a month, in whole hours, so the
        // gone-home window (7 days) has a real spread to bite on.
        2 + ((n * 37) % 120) * 6,
        0.2 + ((n * 13) % 25) / 10,
      ]);
      n++;
    }
  }
  if (rows.length !== 70 || benched !== 47) {
    throw new Error(`reference population drifted: ${rows.length} sessions, ${benched} benched`);
  }
  return rows;
}

/**
 * Named fixtures. `scripts/goldens.mjs` photographs each of these; add one
 * here and a golden for it will be generated on the next `npm run goldens`.
 * @type {Record<string, () => Array<[string, string, string, number, number]>>}
 */
export const POPULATIONS = {
  /** The README floor: every state, six projects, a busy lounge. */
  demo: () => DEMO_SESSIONS,
  /** A machine with no sessions at all: reception and an empty lounge. */
  empty: () => [],
  /** One project, one agent, working. The smallest floor that has a room. */
  single: () => [['orbital-api', 'Rate limiter for the public API', 'working', 0.5, 0.4]],
  /**
   * THREE ACTIVE REPOS, one person at a desk in each, a few benched and two
   * repos nobody is in (WP-59b).
   *
   * The owner's own floor, in miniature, and the shape that showed WP-59's
   * defect: three rooms is the smallest count a row cannot be split evenly
   * into, so the packer dealt it two-and-one and drew the lone room a third of
   * a band wide with the rest of that row as bare floor. Photographed as a
   * golden because it is a LAYOUT case rather than a drawing one — nothing in
   * it is new furniture, and no other population in this file has an odd
   * number of rooms above one.
   */
  three: () => [
    ['orbital-api', 'Rate limiter for the public API', 'working', 2.1, 0.4],
    ['orbital-api', 'Backfill the events table', 'for_review', 5.2, 1.6],
    ['orbital-api', 'Postgres connection pool exhaustion', 'benched', 66, 0.7],
    ['checkout-flow', 'Apple Pay in the express lane', 'needs_input', 1.2, 2.2],
    ['checkout-flow', 'Tax rounding off by a cent', 'benched', 58, 0.5],
    ['design-system', 'Token pipeline to Figma', 'working', 0.8, 1.3],
    ['design-system', 'Storybook a11y violations', 'benched', 47, 0.4],
    ['data-pipeline', 'Backfill 2024 events', 'benched', 63, 1.4],
    ['infra-terraform', 'Move state to a remote backend', 'benched', 55, 0.6],
  ],
  /**
   * THE `three` FLOOR WITH ONE REPO PINNED (WP-77).
   *
   * The same nine sessions, so the two captures differ in exactly one thing:
   * `data-pipeline` has nobody in it and the user has asked it to keep a room
   * anyway. What the picture has to show is the strip along the bottom of the
   * working side — one small room, one desk, nobody at it, a plate that says
   * `pinned` — and the three live rooms still filling their row above it.
   *
   * Its own population rather than a pin on `three` because `three` is WP-59b's
   * LAYOUT case and has to go on photographing a floor with nothing pinned on
   * it: a golden that answers two questions answers neither when it moves.
   */
  pinned: () => POPULATIONS.three(),
  /**
   * WP-89's FLOOR: one senior with a crew of five around it.
   *
   * ONE SESSION, which is `single`'s shape and chosen for `single`'s reason: the
   * crew is the whole subject of the picture, and the smaller the building the
   * more pixels the one room in it gets. A `demo` floor with a crew on it would
   * photograph twenty-seven people and five cables at sixteen pixels a unit, and
   * the cables are what this capture is for. Two populated floors are compared
   * side by side in the `demo` set already; this one answers one question.
   *
   * The five juniors themselves are `CREW_JUNIORS` below, and their ages are the
   * whole of the point: two still writing, two gone quiet, one caught mid-fold.
   */
  crew: () => [['orbital-api', 'Audit every call site of the token bucket', 'working', 0.05, 2.4]],
  /**
   * WP-69's FLOOR, for the `board` golden: one repo, three people in it.
   *
   * ONE REPO, and that is the whole reason this is its own population rather
   * than a flag on `three`. The board draws THE PROJECT IN VIEW, which is the
   * room the floor is filtered to or the project of the session in the panel;
   * the capture reaches it by selecting somebody, and on a floor with three
   * repos on it which room that lands in is a fact about the queue rather
   * than about the board. With one repo there is nothing to land in but
   * `orbital-api`, which is the repo `writeStudioFixture()` enables Studio on.
   *
   * THREE SESSIONS, in roster order, because §4's claim is that a hired agent
   * is the same character on the board as on the floor: two of the eight cards
   * carry an `agentId`, and the robot on those cards is drawn from the same
   * identity as the robot at the desk behind the board.
   *
   * One of them is `for_review` so the needs-you queue is not empty — the
   * capture's way in is the same `j` `three@selected` uses.
   */
  board: () => [
    ['orbital-api', 'Backfill the events table', 'working', 2.1, 0.4],
    ['orbital-api', 'Status page reads the backfill', 'for_review', 5.2, 1.6],
    ['orbital-api', 'Fixtures for the re-run assertion', 'working', 0.8, 1.3],
  ],
  reference: referenceSessions,
};

/**
 * The project the `board` population enables Studio on, or null (WP-69).
 *
 * `PINNED_PROJECTS`'s construction and its reason: the directory is inside the
 * fixture and the fixture is rebuilt on every run, so the NAME is written here
 * and `demo-floor.mjs` turns it into a path against the root it just built.
 * Null for every other population, which is what keeps every other golden a
 * photograph of a floor with Studio off — as it is on every install.
 */
export const STUDIO_PROJECT = POPULATION === 'board' ? 'orbital-api' : null;

/**
 * The project folders the `pinned` population pins (WP-77), by name. The floor
 * addresses a project by the SLUG of its directory, and the directory is inside
 * the fixture, so the id cannot be written down here — `demo-floor.mjs` turns
 * these into ids with `projectIdFromCwd` against the fixture root it just built.
 *
 * Empty for every other population, which is what keeps the other seven goldens
 * a photograph of a floor with nothing pinned on it.
 */
export const PINNED_PROJECTS = POPULATION === 'pinned' ? ['data-pipeline'] : [];

if (!POPULATIONS[POPULATION]) {
  process.stderr.write(
    `unknown population "${POPULATION}"; one of: ${Object.keys(POPULATIONS).join(', ')}\n`,
  );
  process.exit(2);
}
// WP-45. With `--pack` the theme is checked LATER, after the pack has been
// installed into the fixture — a pack's themes are only nameable once they are
// registered, so `--theme warehouse` is a valid request with a pack and an
// error without one.
if (!PACK_FILE && !themeByName(THEME)) {
  process.stderr.write(`unknown theme "${THEME}"; one of: ${themeNames().join(', ')}
`);
  process.exit(2);
}

export const SESSIONS = POPULATIONS[POPULATION]();

/**
 * The session whose juniors the demo floor shows (WP-41), and what they are
 * doing. Two, in one room, so a README screenshot can show the thing `08` B7
 * is about: a senior with juniors standing beside it that were not there five
 * minutes ago and will not be there in five more.
 *
 * Titles rather than ids because the ids are derived from cast position, and a
 * row moving in `DEMO_SESSIONS` should not silently reattach the juniors to
 * somebody else.
 */
/**
 * WHAT THE WORKING SESSIONS ARE RUNNING, FOR WP-81's SECOND PLATE LINE.
 *
 * The room plate's second line is `MK1.1 · Bash npm test` — `agent.currentTool`
 * as the adapter summarised it, and nothing else. `currentTool` is written by a
 * `PreToolUse` hook and by no other path, so a demo floor that never fired one
 * photographed that line empty on every capture: the copy was unit-tested and
 * the PIXELS were not, which is exactly the gap `DEVIATIONS.md` §157's own
 * "Unverified" note left open for the by-tool table.
 *
 * So the demo drives a real `PreToolUse` through the real endpoint, in the real
 * Claude Code payload shape, and the real adapter summarises it — the same
 * discipline every other state on this floor is produced by. Keyed by title for
 * the reason `JUNIORS` is: ids are derived from cast position.
 *
 * Only two rows, and both on WORKING sessions. A tool call cannot move a
 * session's state (`state-machine-hooks.mjs` refuses to, on purpose), so
 * putting one on a waiting session would say "editing tests" beside a raised
 * hand — true of the process and a lie about the floor.
 */
export const DEMO_TOOLS = Object.freeze({
  'Rate limiter for the public API': { tool_name: 'Bash', tool_input: { command: 'npm test' } },
  'Dark mode audit across 40 components': {
    tool_name: 'Edit',
    tool_input: { file_path: 'src/tokens/dark.ts' },
  },
});

/**
 * WP-89's CREW, and the five of them are five different states on purpose.
 *
 * `quietSeconds` is how long ago each transcript last moved, measured back from
 * the pinned clock, and it is the ONLY thing that differs between them — because
 * it is the only thing the floor can observe about a junior (§3.1). Against
 * `CREW_ACTIVE_MS` (60 s) and `CREW_FOLD_MS` (0.30 s) it deals:
 *
 *   0 s, 20 s   two ACTIVE — a live cable each, four pulses and two
 *   60.15 s     one caught mid-FOLD — half a lid, a cable half way to grey
 *   150 s, 240 s two finished — grey cable, folded laptop, no pulses
 *
 * All five are inside `SUBAGENT_IDLE_MS`, so all five are on the floor: a junior
 * that has stopped does not vanish, it goes grey. The first four `wf_` juniors
 * share one workflow id and the fifth is a bare `Task` call, which is the
 * distinction WP-89 recovered from the path.
 *
 * `ageMinutes` tracks `quietSeconds` deliberately. They are two different
 * observations — the newest record IN the transcript, and when the FILE last
 * moved — and on a real junior they move together within a poll. A fixture that
 * let them disagree would draw a five-minute thought cloud over a junior whose
 * cable is pulsing, which is a picture no real machine can produce.
 */
export const CREW_PARENT = 'Audit every call site of the token bucket';
export const CREW_WORKFLOW = 'wf_01k9crewdemo0001';
export const CREW_JUNIORS = [
  {
    agentId: 'ad3m0000000000101',
    agentType: 'Explore',
    description: 'Map the rate-limit call sites',
    text: 'Walking every import of the bucket module.',
    tool: { name: 'Grep', input: { pattern: 'tokenBucket' } },
    ageMinutes: 0,
    quietSeconds: 0,
    workflow: CREW_WORKFLOW,
  },
  {
    agentId: 'ad3m0000000000102',
    agentType: 'general-purpose',
    description: 'Check the burst maths',
    text: 'Re-deriving the refill rate against the published limits.',
    tool: { name: 'Read', input: { file_path: 'src/limits/bucket.ts' } },
    ageMinutes: 0.33,
    quietSeconds: 20,
    workflow: CREW_WORKFLOW,
  },
  {
    agentId: 'ad3m0000000000103',
    agentType: 'test-engineer',
    description: 'Cover the 429 path',
    text: 'Writing the case where the bucket empties mid-request.',
    tool: { name: 'Edit', input: { file_path: 'test/limits.test.ts' } },
    ageMinutes: 1,
    // Just past the stall window, and by a fraction of the fold: this is the
    // junior the capture exists to show finishing.
    quietSeconds: 60.15,
    workflow: CREW_WORKFLOW,
  },
  {
    agentId: 'ad3m0000000000104',
    agentType: 'Explore',
    description: 'Find the old middleware',
    text: 'Located two copies of the retry wrapper.',
    tool: { name: 'Glob', input: { pattern: 'src/**/retry*.ts' } },
    ageMinutes: 2.5,
    quietSeconds: 150,
    workflow: CREW_WORKFLOW,
  },
  {
    agentId: 'ad3m0000000000105',
    agentType: 'code-reviewer',
    description: 'Read the diff so far',
    text: 'Nothing in the diff changes the public shape.',
    tool: { name: 'Read', input: { file_path: 'src/limits/index.ts' } },
    ageMinutes: 4,
    quietSeconds: 240,
    workflow: null,
  },
];

export const JUNIOR_PARENT = 'Dark mode audit across 40 components';
export const JUNIORS = [
  {
    agentId: 'ad3m0000000000001',
    agentType: 'Explore',
    description: 'Find every hard-coded hex',
    text: 'Sweeping the token files for literals the audit has to replace.',
    tool: { name: 'Grep', input: { pattern: '#[0-9a-fA-F]{6}' } },
    ageMinutes: 3,
  },
  {
    agentId: 'ad3m0000000000002',
    agentType: 'general-purpose',
    description: 'Check the contrast ratios',
    text: 'Computing contrast for every pair the dark palette introduces.',
    tool: { name: 'Read', input: { file_path: 'tokens/dark.json' } },
    ageMinutes: 2,
  },
];
