/**
 * Building the fake machine on disk (WP-22 follow-up).
 *
 * Split out of `demo-floor.mjs` unchanged: the deterministic ids, the
 * transcripts, WP-41's subagent files, the `claude` shim, the project
 * directories and their git repositories, WP-17's synthetic ledger week, and
 * the empty settings file.
 *
 * Nothing here is a mock of the product. These transcripts are parsed by the
 * real parser and the states are produced by the real state machine; only the
 * data is invented.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

import { BIN_DIR, CLAUDE_DIR, HOUR, MINUTE, NOW, PROJECTS_DIR, STATE_DIR } from './demo-args.mjs';
import { now as clockNow } from '../src/core/clock.mjs';

/** A deterministic uuid-shaped id, so runs are reproducible. */
export function fakeId(n) {
  const hex = (n * 2654435761).toString(16).padStart(8, '0').slice(-8);
  return `${hex}-d3m0-4f00-9a1b-${String(n).padStart(12, '0')}`;
}

/** Claude Code's directory name for a cwd: separators become dashes. */
export function slugForCwd(cwd) {
  return cwd.replace(/[\\/:]/g, '-');
}

export function rmrf(dir) {
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
export function writeTranscript({ id, cwd, title, ageHours, tokensM, finished }) {
  const dir = path.join(PROJECTS_DIR, slugForCwd(cwd));
  fs.mkdirSync(dir, { recursive: true });

  const end = NOW - ageHours * HOUR;
  const at = (offsetMs) => new Date(end + offsetMs).toISOString();
  const base = { cwd, gitBranch: 'main', sessionId: id, version: '2.0.0' };

  const inputTokens = Math.round(tokensM * 1_000_000 * 0.08);
  const outputTokens = Math.round(tokensM * 1_000_000 * 0.02);
  const cacheRead = Math.round(tokensM * 1_000_000 * 0.85);
  const cacheWrite = Math.round(tokensM * 1_000_000 * 0.05);

  /** @type {any[]} a hand-built transcript; every record is a different shape */
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
 * One synthetic subagent transcript, in the shape the real ones have on disk
 * (docs/DEVIATIONS.md §120): under the PARENT session's own directory, in a
 * `subagents/` folder, named for the subagent's id, with a `.meta.json`
 * sidecar beside it and `isSidechain: true` on every record.
 *
 * It ends on a `tool_use`, so the junior reads as working rather than
 * finished — a finished junior is `ended` and walks off the floor, which is
 * correct behaviour and a poor screenshot.
 */
export function writeSubagent({ parentId, cwd, junior }) {
  // WP-89. A junior with a `workflow` is written where a real multi-agent
  // workflow's juniors live — `subagents/workflows/wf_<id>/` — so the fixture
  // exercises the path segment the adapter now keeps rather than a shape only
  // the unit tests have ever seen.
  const subagents = path.join(PROJECTS_DIR, slugForCwd(cwd), parentId, 'subagents');
  const dir = junior.workflow ? path.join(subagents, 'workflows', junior.workflow) : subagents;
  fs.mkdirSync(dir, { recursive: true });
  const transcript = path.join(dir, `agent-${junior.agentId}.jsonl`);
  // WP-89. A junior with a `quietSeconds` says how long ago its file last moved,
  // which is the one thing the crew reads: it is stamped below and deliberately
  // left OUT of `JUNIOR_FILES`, so the keep-alive beat cannot drag a junior that
  // is meant to be finishing back to life mid-capture.
  if (junior.quietSeconds === undefined) JUNIOR_FILES.push(transcript);

  const end = NOW - junior.ageMinutes * MINUTE;
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

  /** @type {any[]} a hand-built transcript; every record is a different shape */
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
  //
  // WP-89's crew is the exception, and it is the whole of what that capture
  // shows: `quietSeconds` stamps the mtime a fixed distance behind the pinned
  // clock, so `lastGrowthAt` — and therefore the cable's colour, its pulses and
  // its fold — is the same number on every run.
  if (junior.quietSeconds !== undefined) {
    const at = new Date(NOW - junior.quietSeconds * 1000);
    fs.utimesSync(transcript, at, at);
  }
}

/** Every junior transcript in this fixture, for `keepJuniorsWorking`. */
export const JUNIOR_FILES = [];

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
export function keepJuniorsWorking() {
  if (!JUNIOR_FILES.length) return null;
  const beat = () => {
    // The model's clock, not the machine's: under `DECKHQ_NOW` the adapter
    // measures a junior's freshness against the pinned instant, so the beat
    // has to stamp that same instant or every junior reads as long gone.
    const now = new Date(clockNow());
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
export function writeClaudeShim() {
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
export const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'DeckHQ Demo',
  GIT_AUTHOR_EMAIL: 'demo@example.invalid',
  GIT_COMMITTER_NAME: 'DeckHQ Demo',
  GIT_COMMITTER_EMAIL: 'demo@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
};
export function git(cwd, args) {
  execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'ignore' });
}
export function writeLines(file, from, to, label) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out = [];
  for (let i = from; i < to; i++) out.push(`${label} line ${i}`);
  fs.writeFileSync(file, out.join('\n') + '\n', 'utf8');
}
export function writeProjectDirs(root) {
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
    /** @type {Array<[string, number, number, number]>} */
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
export async function writeLedgerFixture(sessions) {
  const { dayKey, projectKeyFor } = await import('../src/core/ledger.mjs');
  const { agentId } = await import('../src/core/model.mjs');
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

  // The real writer records the product's OWN agent id — `runtime:uuid` — so
  // that a record joins straight to an `Agent` (`docs/DEVIATIONS.md` §100).
  // This fixture wrote the raw transcript id, which joins to nothing: every
  // per-session surface computed from the ledger (WP-46's record line, WP-28's
  // trait line) matched no agent on the demo floor and quietly showed nothing.
  const agentIdOf = (s) => agentId('claude-code', s.id);

  const now = NOW;
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
        sessionId: agentIdOf(s),
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
          sessionId: agentIdOf(s),
          body: { kind: 'state', dim: 'activity', from: 'ended', to: 'working' },
        });
        push(at + 60_000, {
          projectKey: key,
          sessionId: agentIdOf(s),
          body: { kind: 'tokens', delta: 12_000 + ((i * 37 + n * 11) % 40) * 1000, cacheDelta: 0 },
        });
        // Finished, then discharged — an episode with both ends, which is what
        // "shipped 3" and "longest wait → cleared" are counted from.
        const done = at + (14 + ((i + n) % 5) * 9) * MINUTE;
        if (done > now) break;
        push(done, {
          projectKey: key,
          sessionId: agentIdOf(s),
          body: { kind: 'state', dim: 'activity', from: 'working', to: 'for_review' },
        });
        const cleared = done + (6 + ((i * 13 + n * 29) % 90)) * MINUTE;
        if (cleared > now) break;
        push(cleared, {
          projectKey: key,
          sessionId: agentIdOf(s),
          body: { kind: 'state', dim: 'activity', from: 'for_review', to: 'ended' },
        });
        // Some of those clearings were a reply typed here rather than in a
        // terminal, which is the only half of the conversation the ledger can
        // honestly count as a send.
        if ((i + n + back) % 3 === 0) {
          push(cleared - 30_000, {
            projectKey: key,
            sessionId: agentIdOf(s),
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

/**
 * A STUDIO PROJECT, for the `board` golden — WP-69, §5.
 *
 * `scripts/goldens.mjs`'s `board` capture photographs the six columns, so it
 * needs a project with Studio enabled on it, a roster, and cards. All three
 * are written HERE rather than driven through `POST /api/studio/enable` and
 * `/card`, for the reason every other fixture in this file is written rather
 * than performed: the demo builds a machine and then starts a daemon over it,
 * and a golden that depended on a sequence of requests landing in order would
 * be a golden that could fail for a reason that has nothing to do with the
 * picture.
 *
 * What it writes is what `enable` writes — the same paths, and a `README.md`
 * carrying the same marker on its first line, so `deckhq studio disable` on
 * the fixture would still find and remove it. The grant itself goes into
 * `state.json` beside the rest of the seeded state (`demo-floor.mjs`), because
 * that is where the store keeps it.
 *
 * THE BOARD IS EIGHT CARDS ACROSS THE SIX COLUMNS, and the spread is the point
 * of the picture: every column has at least one card, so none of the six can go
 * missing unnoticed; two of them hold two, so a stack is photographed as well
 * as a single; one card has no assignee at all (so *"nobody"* is photographed
 * rather than a blank) and no acceptance criteria either; three carry budgets;
 * and one carries two flag chips beside a three-criterion count, which is the
 * widest a card gets. Every value is fixed and every timestamp is an offset
 * from the pinned clock, so two runs produce the same file byte for byte.
 *
 * @param {string} projectRoot the fixture project the board belongs to
 * @param {string[]} agentIds the three sessions, in roster order
 * @returns {Promise<{projectKey:string, dir:string, consent:{grantedAt:number, root:string}}>}
 */
export async function writeStudioFixture(projectRoot, agentIds) {
  const { projectKeyFor } = await import('../src/core/ledger.mjs');
  // `readmeText()` puts the marker on the first line itself, so the fixture's
  // README is the product's, not a copy of it that could drift.
  const { readmeText } = await import('../src/studio/consent.mjs');
  const root = path.resolve(projectRoot);
  const projectKey = projectKeyFor(root);
  const dir = path.join(root, '.deckhq', 'studio');
  fs.mkdirSync(path.join(dir, 'briefs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'handovers'), { recursive: true });

  const write = (name, text) => fs.writeFileSync(path.join(dir, name), text, 'utf8');
  write('README.md', readmeText(root));
  write(
    'blueprint.md',
    [
      '# Orbital API — the events backfill',
      '',
      'Three people and one milestone: the events table has to hold every event the',
      'public API has ever emitted, and the backfill has to be re-runnable.',
      '',
      '## m1 — the backfill is re-runnable',
      '',
      'A second run over the same window writes nothing new, and says so.',
      '',
    ].join('\n'),
  );

  const roles = [
    { name: 'backend', purpose: 'Owns the events table and the backfill.' },
    { name: 'frontend', purpose: 'Owns the status page the backfill reports to.' },
    { name: 'tests', purpose: 'Owns the fixtures and the re-run assertion.' },
  ];
  write(
    'roster.json',
    `${JSON.stringify(
      {
        version: 1,
        projectKey,
        roles: roles.map((role, i) => ({
          ...role,
          systemPrompt: `You are the ${role.name} on this project.`,
          allowedTools: [],
          permissionPolicy: 'ask',
          // The ids of the sessions the fixture actually wrote, so the board's
          // faces are the SAME robots standing on the floor behind it (§4).
          agentId: agentIds[i] || null,
        })),
      },
      null,
      2,
    )}\n`,
  );

  /** @param {number} h hours before the pinned clock */
  const ago = (h) => NOW - h * HOUR;
  const card = (id, title, column, extra = {}) => ({
    id,
    title,
    acceptance: [],
    milestone: 'm1',
    role: null,
    column,
    budget: null,
    agentId: null,
    worktree: null,
    handover: null,
    flags: [],
    updatedAt: ago(4),
    ...extra,
  });

  write(
    'board.json',
    `${JSON.stringify(
      {
        version: 1,
        projectKey,
        cards: [
          card('c1', 'Page the backfill in windows', 'backlog', {
            role: 'backend',
            acceptance: ['a window is a day', 'a partial window is re-run whole'],
          }),
          card('c2', 'Decide what a duplicate is', 'backlog'),
          card('c3', 'Fixtures for the re-run assertion', 'ready', {
            role: 'tests',
            acceptance: ['a failing test first'],
            budget: { tokens: 400000, minutes: 90 },
          }),
          card('c4', 'Backfill the events table', 'in_progress', {
            role: 'backend',
            acceptance: ['a failing test first', 'npm test green', 'the guide says so'],
            budget: { tokens: 1200000, minutes: 240 },
            agentId: agentIds[0] || null,
            flags: [
              { kind: 'budget', text: '80% spent, 1/3 criteria met', at: ago(2) },
              { kind: 'scope', text: 'touching the status page too', at: ago(1) },
            ],
            updatedAt: ago(1),
          }),
          card('c5', 'Status page reads the backfill', 'in_progress', {
            role: 'frontend',
            acceptance: ['the page says which window is running'],
            agentId: agentIds[1] || null,
            updatedAt: ago(3),
          }),
          card('c6', 'Rate limiter for the public API', 'review', {
            role: 'backend',
            acceptance: ['a failing test first', 'npm test green'],
            handover: '.deckhq/studio/handovers/c6.md',
            updatedAt: ago(6),
          }),
          card('c7', 'Move the events schema to a migration', 'done', {
            role: 'backend',
            acceptance: ['npm test green'],
            updatedAt: ago(26),
          }),
          card('c8', 'Connection pool exhaustion', 'blocked', {
            role: 'tests',
            acceptance: ['a failing test first'],
            budget: { tokens: 200000, minutes: 45 },
            flags: [{ kind: 'budget', text: 'stopped on cost', at: ago(9) }],
            updatedAt: ago(9),
          }),
        ],
      },
      null,
      2,
    )}\n`,
  );

  // The grant the store will read. Written by the caller into `state.json`,
  // because that is the one file the daemon restores its state from.
  return { projectKey, dir, consent: { grantedAt: ago(30), root } };
}

/** An empty settings file for the fake machine. Hooks are installed later. */
export function writeSettings() {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CLAUDE_DIR, 'settings.json'), '{}', 'utf8');
}
