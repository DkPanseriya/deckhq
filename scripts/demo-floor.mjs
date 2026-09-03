/**
 * Start DeckHQ against a synthetic machine, for screenshots and demos.
 *
 * The floor in the README has to show the product doing its job — agents in
 * every state, across several projects — without publishing anybody's real
 * project names, session titles or token spend. So this builds a fake
 * `~/.claude` from scratch, points a daemon at it with `CLAUDE_CONFIG_DIR` and
 * `DECKHQ_STATE_DIR`, and drives it into the states we want to show through
 * the real `/api/hook` endpoint — exactly the way Claude Code drives it.
 *
 * Nothing here is a mock of the product. The transcripts are parsed by the
 * real parser, the states are produced by the real state machine, and the
 * floor is laid out by the real planner. Only the data is invented.
 *
 *   node scripts/demo-floor.mjs                    # start and print the URL
 *   node scripts/demo-floor.mjs --port N           # a different port (0 = any free port)
 *   node scripts/demo-floor.mjs --population NAME  # a different fixture, see POPULATIONS
 *   node scripts/demo-floor.mjs --ledger-fixture   # + a synthetic week of ledger records,
 *                                                  #   so the day's card and Wrapped appear
 *
 * Ctrl-C to stop. The fixture lives in a temp directory and is rebuilt on
 * every run; nothing is written to your real ~/.claude or ~/.deckhq.
 *
 * Everything about a population is a pure function of its name: ids, titles,
 * ages and token counts are all derived from the session's index, never from
 * the clock or a random source. That is what lets `scripts/goldens.mjs`
 * photograph each one and compare the pixels against a committed golden.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

import { CARDS_OFF } from '../public/postcard.js';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const PORT = Number(opt('--port', 4499));
const POPULATION = opt('--population', 'demo');
/**
 * WP-18 / WP-27. Write a synthetic ledger into the fixture's state directory
 * and let the day's card and Wrapped appear.
 *
 * The cards are the only surfaces in this product whose content comes from the
 * ledger rather than from the floor, so photographing them needs a ledger — and
 * a real one is somebody's real work. This builds a week of plausible records
 * against the same fake sessions the floor is already made of, using the
 * documented record shapes, so what the card renders is the real
 * `windowDigest` over real records and only the data is invented.
 *
 * Off by default, and the goldens never use it: with a ledger present the
 * cards would appear over the floor and every capture would depend on the day
 * of the week.
 */
const LEDGER_FIXTURE = argv.includes('--ledger-fixture');

// Each population gets its own fixture directory, so a goldens run cannot
// tear down the floor somebody is looking at in `npm run demo`. A run with the
// synthetic ledger gets its own too, for the same reason and one more: this
// script's first act is to delete its fixture directory, so a card run sharing
// the plain demo's root would take the plain demo's ledger with it — and the
// two floors would then append into one directory. Found by doing it.
const ROOT = path.join(
  os.tmpdir(),
  (POPULATION === 'demo' ? 'deckhq-demo' : `deckhq-demo-${POPULATION}`) +
    (LEDGER_FIXTURE ? '-ledger' : ''),
);
const CLAUDE_DIR = path.join(ROOT, 'claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const STATE_DIR = path.join(ROOT, 'state');
const BIN_DIR = path.join(ROOT, 'bin');

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

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
const DEMO_SESSIONS = [
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
function referenceSessions() {
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
  const rows = [];
  let n = 0;
  let benched = 0;
  for (const [project, count] of projects) {
    for (let k = 0; k < count; k++) {
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
const POPULATIONS = {
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
const SESSIONS = POPULATIONS[POPULATION]();

/** A deterministic uuid-shaped id, so runs are reproducible. */
function fakeId(n) {
  const hex = (n * 2654435761).toString(16).padStart(8, '0').slice(-8);
  return `${hex}-d3m0-4f00-9a1b-${String(n).padStart(12, '0')}`;
}

/** Claude Code's directory name for a cwd: separators become dashes. */
function slugForCwd(cwd) {
  return cwd.replace(/[\\/:]/g, '-');
}

function rmrf(dir) {
  // `maxRetries` is not belt-and-braces on Windows: the goldens harness stops
  // one population by killing it, and the OS can still hold a handle on the
  // fixture for a moment afterwards, so the next run's reset hits EBUSY or
  // EPERM. Node retries exactly those errors for us.
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

/**
 * One synthetic transcript.
 *
 * The final record decides `turnEnded`, which is what actually puts a session
 * in the office: an assistant message with text and no `tool_use` means the
 * turn finished and the session is up for review. Anything mid-turn ends on a
 * `tool_use` instead.
 */
function writeTranscript({ id, cwd, title, ageHours, tokensM, finished }) {
  const dir = path.join(PROJECTS_DIR, slugForCwd(cwd));
  fs.mkdirSync(dir, { recursive: true });

  const end = Date.now() - ageHours * HOUR;
  const at = (offsetMs) => new Date(end + offsetMs).toISOString();
  const base = { cwd, gitBranch: 'main', sessionId: id, version: '2.0.0' };

  const inputTokens = Math.round(tokensM * 1_000_000 * 0.08);
  const outputTokens = Math.round(tokensM * 1_000_000 * 0.02);
  const cacheRead = Math.round(tokensM * 1_000_000 * 0.85);
  const cacheWrite = Math.round(tokensM * 1_000_000 * 0.05);

  const lines = [
    { type: 'custom-title', customTitle: title },
    {
      ...base,
      type: 'user',
      timestamp: at(-12 * MINUTE),
      message: { role: 'user', content: title },
    },
    {
      ...base,
      type: 'assistant',
      timestamp: at(-8 * MINUTE),
      message: {
        id: `msg_${id}_1`,
        role: 'assistant',
        model: 'claude-opus-5',
        content: [{ type: 'text', text: 'Reading the relevant modules first.' }],
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_input_tokens: cacheRead,
          cache_creation_input_tokens: cacheWrite,
        },
      },
    },
  ];

  if (finished) {
    // Written the way an agent actually writes: markdown. The review card
    // renders it (WP-08), so the fixture carries a list and a fenced block.
    const text = [
      'Done. Tests pass and the change is on the branch.',
      '',
      '- `src/events/backfill.ts` now batches by 500 rows and persists the cursor',
      '- the old full-table scan in `index.ts` is gone',
      '',
      '```',
      'npm test  ✓ 214 passing',
      '```',
      '',
      'Want me to open the PR?',
    ].join('\n');
    lines.push({
      ...base,
      type: 'assistant',
      timestamp: at(0),
      message: {
        id: `msg_${id}_2`,
        role: 'assistant',
        model: 'claude-opus-5',
        content: [{ type: 'text', text }],
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  } else {
    // Mid-turn: the last record carries a tool_use, so turnEnded is false.
    lines.push({
      ...base,
      type: 'assistant',
      timestamp: at(0),
      message: {
        id: `msg_${id}_2`,
        role: 'assistant',
        model: 'claude-opus-5',
        content: [
          { type: 'text', text: 'Checking the call sites.' },
          { type: 'tool_use', id: `tu_${id}`, name: 'Grep', input: { pattern: 'foo' } },
        ],
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  const mtime = new Date(end);
  fs.utimesSync(file, mtime, mtime);
}

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
const JUNIOR_PARENT = 'Dark mode audit across 40 components';
const JUNIORS = [
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

/**
 * One synthetic subagent transcript, in the shape the real ones have on disk
 * (docs/DEVIATIONS.md §120): under the PARENT session's own directory, in a
 * `subagents/` folder, named for the subagent's id, with a `.meta.json`
 * sidecar beside it and `isSidechain: true` on every record.
 *
 * It ends on a `tool_use`, so the junior reads as working rather than
 * finished — a finished junior is `ended` and walks off the floor, which is
 * correct behaviour and a poor screenshot.
 */
function writeSubagent({ parentId, cwd, junior }) {
  const dir = path.join(PROJECTS_DIR, slugForCwd(cwd), parentId, 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  const transcript = path.join(dir, `agent-${junior.agentId}.jsonl`);
  JUNIOR_FILES.push(transcript);

  const end = Date.now() - junior.ageMinutes * MINUTE;
  const at = (offsetMs) => new Date(end + offsetMs).toISOString();
  // `sessionId` is the PARENT's id on every record — verified on this machine:
  // a subagent transcript never carries an id of its own in that field, only
  // in `agentId`.
  const base = {
    cwd,
    gitBranch: 'main',
    sessionId: parentId,
    agentId: junior.agentId,
    isSidechain: true,
    version: '2.1.231',
  };

  const lines = [
    {
      ...base,
      parentUuid: null,
      type: 'user',
      userType: 'external',
      timestamp: at(-3 * MINUTE),
      message: { role: 'user', content: junior.description },
    },
    {
      ...base,
      type: 'assistant',
      timestamp: at(0),
      message: {
        id: `msg_${junior.agentId}_1`,
        role: 'assistant',
        model: 'claude-opus-5',
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: junior.text },
          {
            type: 'tool_use',
            id: `tu_${junior.agentId}`,
            name: junior.tool.name,
            input: junior.tool.input,
          },
        ],
        usage: {
          input_tokens: 4_000,
          output_tokens: 900,
          cache_read_input_tokens: 61_000,
          cache_creation_input_tokens: 8_000,
        },
      },
    },
  ];

  fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  fs.writeFileSync(
    path.join(dir, `agent-${junior.agentId}.meta.json`),
    JSON.stringify({
      agentType: junior.agentType,
      description: junior.description,
      toolUseId: `toolu_${junior.agentId}`,
      spawnDepth: 1,
    }),
    'utf8',
  );
  // Deliberately NOT backdated, where `writeTranscript` backdates every
  // session: a junior is drawn only while its transcript is still moving, and
  // the in-file timestamps say how long it has been going.
}

/** Every junior transcript in this fixture, for `keepJuniorsWorking`. */
const JUNIOR_FILES = [];

/**
 * Keep the demo's juniors at their desks (WP-41).
 *
 * A junior leaves the floor when its transcript stops being written to — five
 * minutes, `SUBAGENT_IDLE_MS` in the Claude Code adapter — which is right, and
 * which means a demo floor left running for a coffee has nobody standing
 * beside the senior any more. A REAL junior is writing to its file every few
 * seconds for the whole of its life; this is the fixture doing the same thing,
 * so `npm run demo` and a goldens capture see the same floor at minute one and
 * at minute forty.
 *
 * Nothing else about the transcript changes, so every number on the floor is
 * exactly what it was: this touches the mtime and no bytes.
 */
function keepJuniorsWorking() {
  if (!JUNIOR_FILES.length) return null;
  const beat = () => {
    const now = new Date();
    for (const file of JUNIOR_FILES) {
      try {
        fs.utimesSync(file, now, now);
      } catch {
        /* the fixture is being torn down; nothing to keep alive */
      }
    }
  };
  const timer = setInterval(beat, 60_000);
  // Do not hold the process open on its own account.
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

/**
 * A `claude` on PATH that reports no live sessions.
 *
 * Without this the adapter shells out to the REAL Claude Code, whose live
 * session ids would be unioned into the floor — putting the user's actual
 * work in a screenshot meant to contain none of it. Liveness for the demo
 * comes from hook events instead, which is the accurate path anyway.
 */
function writeClaudeShim() {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(BIN_DIR, 'claude.cmd'), '@echo off\r\necho []\r\n', 'utf8');
  }
  const sh = path.join(BIN_DIR, 'claude');
  fs.writeFileSync(sh, '#!/bin/sh\necho "[]"\n', 'utf8');
  try {
    fs.chmodSync(sh, 0o755);
  } catch {
    /* not POSIX */
  }
}

/**
 * The project directories themselves, so the review card's "what changed in
 * <project>" (GET /api/changes, WP-08) has a real working tree to read. One
 * of each shape the panel draws: a dirty repository, a clean one, plain
 * directories with no git, and one project whose directory is simply gone.
 * Skipped quietly when git is not installed — the floor still works.
 */
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'DeckHQ Demo',
  GIT_AUTHOR_EMAIL: 'demo@example.invalid',
  GIT_COMMITTER_NAME: 'DeckHQ Demo',
  GIT_COMMITTER_EMAIL: 'demo@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
};
function git(cwd, args) {
  execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'ignore' });
}
function writeLines(file, from, to, label) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out = [];
  for (let i = from; i < to; i++) out.push(`${label} line ${i}`);
  fs.writeFileSync(file, out.join('\n') + '\n', 'utf8');
}
function writeProjectDirs(root) {
  let hasGit = true;
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
  } catch {
    hasGit = false;
  }
  const dir = (name) => {
    const d = path.join(root, name);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  // Plain directories: "not a git repository".
  for (const name of ['design-system', 'data-pipeline', 'mobile-app']) dir(name);
  // infra-terraform is deliberately not created: "the directory no longer exists".
  if (!hasGit) return;
  try {
    // checkout-flow: a repository with nothing uncommitted.
    const clean = dir('checkout-flow');
    git(clean, ['init', '-q', '-b', 'main']);
    writeLines(path.join(clean, 'README.md'), 0, 5, 'readme');
    git(clean, ['add', '.']);
    git(clean, ['commit', '-q', '-m', 'init']);

    // orbital-api: the busy room, with the spec's own diff on disk —
    // src/events/backfill.ts +98 −4, src/events/index.ts +21 −8,
    // test/backfill.test.ts +23 −6.
    const dirty = dir('orbital-api');
    git(dirty, ['init', '-q', '-b', 'main']);
    const files = [
      ['src/events/backfill.ts', 30, 4, 98],
      ['src/events/index.ts', 20, 8, 21],
      ['test/backfill.test.ts', 15, 6, 23],
    ];
    for (const [rel, n] of files) writeLines(path.join(dirty, rel), 0, n, rel);
    git(dirty, ['add', '.']);
    git(dirty, ['commit', '-q', '-m', 'events table']);
    for (const [rel, n, removed, added] of files) {
      // Drop `removed` lines from the top, append `added` new ones.
      writeLines(path.join(dirty, rel), removed, n + added, rel);
    }
  } catch {
    /* a git that cannot commit here is not the demo's problem */
  }
}

/**
 * A week of plausible ledger records for the fake floor. WP-18 / WP-27.
 *
 * The cards are the only surfaces in this product whose content comes from the
 * ledger rather than from the floor, so a screenshot of one needs records —
 * and a real ledger is somebody's real work. These are written in the shape
 * `src/core/ledger.mjs` documents (`session/first_seen`, `state` with
 * `dim: 'activity'`, `send`, `tokens`), against the fixture's own sessions and
 * project directories, so the card renders the real `windowDigest` over real
 * records. Only the data is invented, which is this script's whole rule.
 *
 * Everything is a pure function of the session index and the day offset, so a
 * second run at the same hour produces the same card.
 *
 * @param {Array<{id:string, cwd:string, project:string, state:string}>} sessions
 */
async function writeLedgerFixture(sessions) {
  const { dayKey, projectKeyFor } = await import('../src/core/ledger.mjs');
  const dir = path.join(STATE_DIR, 'ledger');
  fs.mkdirSync(dir, { recursive: true });
  const machineId = '0'.repeat(32);
  /** @type {Map<string, {t:number, line:string}[]>} day file -> records */
  const files = new Map();
  const push = (t, rec) => {
    const day = dayKey(t);
    const line = JSON.stringify({
      t,
      machineId,
      projectKey: rec.projectKey,
      sessionId: rec.sessionId,
      ...rec.body,
    });
    const list = files.get(day) || [];
    list.push({ t, line });
    files.set(day, list);
  };

  const now = Date.now();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  // Eight days back, so the weekly Wrapped has a full window AND a previous
  // one to have fallen from.
  for (let back = 8; back >= 0; back--) {
    const dayStart = new Date(midnight);
    dayStart.setDate(dayStart.getDate() - back);
    sessions.forEach((s, i) => {
      const key = projectKeyFor(s.cwd);
      // A deterministic, uneven number of turns per session per day. Rooms
      // differ, days differ, and nothing depends on a random source.
      const turns = (i * 3 + back * 5) % 4;
      if (turns === 0) return;
      // A working day starts at 08:00 and runs nine hours — except today,
      // which has only run as far as it has run. Without the second half a
      // demo started before 08:00 would have an empty "today", and the daily
      // postcard's own screenshot would be a card about nothing.
      const elapsed = Math.max(1, Math.floor((now - dayStart.getTime()) / HOUR));
      const span = Math.min(9, elapsed);
      const first =
        dayStart.getTime() + Math.min(8, Math.max(0, elapsed - span)) * HOUR + (i % span) * HOUR;
      if (first > now) return;
      push(first, {
        projectKey: key,
        sessionId: s.id,
        body: {
          kind: 'session',
          event: 'first_seen',
          activity: 'ended',
          ack: 'active',
          since: first,
        },
      });
      for (let n = 0; n < turns; n++) {
        const at = first + n * 47 * MINUTE;
        if (at > now) break;
        push(at, {
          projectKey: key,
          sessionId: s.id,
          body: { kind: 'state', dim: 'activity', from: 'ended', to: 'working' },
        });
        push(at + 60_000, {
          projectKey: key,
          sessionId: s.id,
          body: { kind: 'tokens', delta: 12_000 + ((i * 37 + n * 11) % 40) * 1000, cacheDelta: 0 },
        });
        // Finished, then discharged — an episode with both ends, which is what
        // "shipped 3" and "longest wait → cleared" are counted from.
        const done = at + (14 + ((i + n) % 5) * 9) * MINUTE;
        if (done > now) break;
        push(done, {
          projectKey: key,
          sessionId: s.id,
          body: { kind: 'state', dim: 'activity', from: 'working', to: 'for_review' },
        });
        const cleared = done + (6 + ((i * 13 + n * 29) % 90)) * MINUTE;
        if (cleared > now) break;
        push(cleared, {
          projectKey: key,
          sessionId: s.id,
          body: { kind: 'state', dim: 'activity', from: 'for_review', to: 'ended' },
        });
        // Some of those clearings were a reply typed here rather than in a
        // terminal, which is the only half of the conversation the ledger can
        // honestly count as a send.
        if ((i + n + back) % 3 === 0) {
          push(cleared - 30_000, {
            projectKey: key,
            sessionId: s.id,
            body: { kind: 'send', chars: 120 + ((i * 17) % 200) },
          });
        }
      }
    });
  }

  for (const [day, recs] of files) {
    recs.sort((a, b) => a.t - b.t);
    fs.writeFileSync(
      path.join(dir, `${day}.jsonl`),
      recs.map((r) => r.line).join('\n') + '\n',
      'utf8',
    );
  }
  return { days: files.size, records: [...files.values()].reduce((a, b) => a + b.length, 0) };
}

/** An empty settings file for the fake machine. Hooks are installed later. */
function writeSettings() {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CLAUDE_DIR, 'settings.json'), '{}', 'utf8');
}

/** POST one hook event, the way the installed hook command would. */
function postHook(port, body) {
  return new Promise((resolve) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/hook',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    );
    req.on('error', resolve);
    req.end(payload);
  });
}

function post(port, route, body) {
  return new Promise((resolve) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: route,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    );
    req.on('error', resolve);
    req.end(payload);
  });
}

// ---------------------------------------------------------------- build

rmrf(ROOT);
fs.mkdirSync(PROJECTS_DIR, { recursive: true });
fs.mkdirSync(STATE_DIR, { recursive: true });
writeClaudeShim();
writeSettings();

// The projects live inside the fixture too, so the review card can read real
// working trees (see writeProjectDirs) and nothing on the real disk is touched.
const root = path.join(ROOT, 'code');
writeProjectDirs(root);
const built = SESSIONS.map(([project, title, state, ageHours, tokensM], i) => {
  const id = fakeId(i + 1);
  const cwd = path.join(root, project);
  writeTranscript({
    id,
    cwd,
    title,
    ageHours,
    tokensM,
    // Only the ones we want standing in the office end on a finished turn.
    finished: state === 'for_review',
  });
  return { id, agentId: `claude-code:${id}`, cwd, project, title, state };
});

// WP-41. The juniors, once their parent's transcript exists to hang them off.
// Only the `demo` population has them: `reference` photographs `08` §0's
// machine, which had none, and `single` and `empty` are controls.
if (POPULATION === 'demo') {
  const parent = built.find((s) => s.title === JUNIOR_PARENT);
  if (parent) {
    for (const junior of JUNIORS) {
      writeSubagent({ parentId: parent.id, cwd: parent.cwd, junior });
    }
    keepJuniorsWorking();
  }
}

// Seed ack state so the lounge is populated the moment the daemon starts,
// and so seeding does not re-derive something else on first run.
// Ack state the daemon restores on start. `reviewSince` is what actually puts
// an agent in the office and gives it a waiting-time badge; staggering the
// values is what makes the queue look like a queue rather than a clump.
const ack = {};
const WAITS = [26 * HOUR, 4 * HOUR, 40 * MINUTE, 7 * MINUTE];
let waitIndex = 0;
for (const s of built) {
  if (s.state === 'benched') ack[s.agentId] = { state: 'benched', updatedAt: Date.now() };
  else if (s.state === 'let_go') ack[s.agentId] = { state: 'let_go', updatedAt: Date.now() };
  else if (s.state === 'for_review') {
    ack[s.agentId] = {
      state: 'active',
      reviewSince: Date.now() - WAITS[waitIndex++ % WAITS.length],
      updatedAt: Date.now(),
    };
  }
}
fs.writeFileSync(
  path.join(STATE_DIR, 'state.json'),
  JSON.stringify(
    {
      version: 1,
      seededAt: Date.now(),
      // `onboarded` keeps the first-run dialog off a floor that exists to be
      // photographed; the capture scripts used to have to dismiss it.
      settings: {
        stallWindowMs: 2 * MINUTE,
        notifications: false,
        onboarded: true,
        // The day's card (WP-18) and Wrapped (WP-27) are marked already shown,
        // for exactly the reason `onboarded` is: this floor exists to be
        // photographed, and a capture taken after 22:00 — or on a Monday, or
        // in December — would otherwise have a card over the middle of it and
        // every golden would fail on the clock. `--ledger-fixture` turns the
        // markers off, which is how the cards' own screenshots are taken.
        postcardDay: LEDGER_FIXTURE ? '' : CARDS_OFF,
        wrappedShown: LEDGER_FIXTURE ? '' : CARDS_OFF,
      },
      ack,
    },
    null,
    2,
  ),
);

// The synthetic ledger, only when it was asked for. It is written before the
// daemon starts so `Ledger.prime()` reads it as the day already in progress,
// exactly as a restart would.
let ledgerFixture = null;
if (LEDGER_FIXTURE) ledgerFixture = await writeLedgerFixture(built);

process.env.CLAUDE_CONFIG_DIR = CLAUDE_DIR;
process.env.DECKHQ_STATE_DIR = STATE_DIR;
// The office snapshot names the office after the machine (WP-14), and this
// script exists so that nothing real ends up in a committed screenshot. A
// machine name is somebody's real something, so it is invented here too.
process.env.DECKHQ_HOSTNAME = 'DECKHQ-DEMO';
process.env.PATH = `${BIN_DIR}${path.delimiter}${process.env.PATH}`;

const { startDaemon } = await import('../src/daemon.mjs');
// stateFile is passed explicitly so the daemon skips its legacy migration —
// the demo must never pull anything out of a real install.
const { url, port, close } = await startDaemon({
  port: PORT,
  stateFile: path.join(STATE_DIR, 'state.json'),
});

// Install hooks through the real consent-gated endpoint, AFTER the listener is
// up. The port has to be the one actually bound — `--port` may have been taken
// and walked forward — and installing here also refreshes the daemon's own
// hook status, which is what switches it off the degraded path.
await post(port, '/api/hooks/install', { runtime: 'claude-code', consent: true });

// Drive the floor into the states we want to show, through the real hook
// endpoint. Order matters: SessionStart makes a session live, and only a live
// session can be working, blocked or stalled.
const hook = (s, hookEvent) =>
  postHook(port, {
    session_id: s.id,
    cwd: s.cwd,
    hook_event_name: hookEvent,
    runtime: 'claude-code',
  });

for (const s of built) {
  if (s.state === 'working' || s.state === 'needs_input' || s.state === 'stalled') {
    await hook(s, 'SessionStart');
  }
}
for (const s of built) {
  if (s.state === 'needs_input') await hook(s, 'Notification');
  if (s.state === 'stalled') await hook(s, 'UserPromptSubmit'); // starts the stall clock
}

const stallSeconds = 2 * 60;
process.stdout.write(
  [
    '',
    `  DeckHQ demo floor  ${url}`,
    '',
    `  population: ${POPULATION}`,
    `  fixture:  ${ROOT}`,
    `  projects: ${new Set(built.map((s) => s.project)).size}`,
    `  sessions: ${built.length}`,
    ...(ledgerFixture
      ? [`  ledger:   ${ledgerFixture.records} records across ${ledgerFixture.days} days (fixture)`]
      : []),
    '',
    `  "stalled" appears after ~${stallSeconds}s (the minimum stall window).`,
    '  Ctrl-C to stop. Nothing was written to your real ~/.claude or ~/.deckhq.',
    '',
  ].join('\n'),
);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    close().finally(() => {
      rmrf(ROOT);
      process.exit(0);
    });
  });
}
