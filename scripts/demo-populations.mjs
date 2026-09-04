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
  reference: referenceSessions,
};

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
