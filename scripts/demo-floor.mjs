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

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const PORT = Number(opt('--port', 4499));
const POPULATION = opt('--population', 'demo');

// Each population gets its own fixture directory, so a goldens run cannot
// tear down the floor somebody is looking at in `npm run demo`.
const ROOT = path.join(
  os.tmpdir(),
  POPULATION === 'demo' ? 'deckhq-demo' : `deckhq-demo-${POPULATION}`,
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

  // design-system — one gone quiet.
  ['design-system', 'Token pipeline to Figma', 'stalled', 0.8, 1.3],
  ['design-system', 'Dark mode audit across 40 components', 'working', 1.1, 3.1],
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
      },
      ack,
    },
    null,
    2,
  ),
);

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
