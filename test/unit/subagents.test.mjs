/**
 * WP-41 — subagents drawn as juniors beside their parent.
 *
 * Four layers, in the order the data moves through them:
 *
 *   1. `parse.mjs` — the on-disk shapes, over synthetic fixtures built to
 *      match what was measured on the reference machine (docs/DEVIATIONS.md
 *      §117). NOTHING HERE IS A REAL TRANSCRIPT: every fixture is written by
 *      this file into a temp directory and deleted afterwards.
 *   2. `adapter.mjs` — discovery, the freshness windows, and the summary.
 *   3. `model.mjs` / `state-machine.mjs` — a junior is a session that is
 *      never in the needs-you count unless it raises its own hand, owns no
 *      user-facing state, and counts as an occupant of its parent's room.
 *   4. `plan.js` / `agents.js` / `panel.js` — the table grows, the juniors
 *      stand beside the parent, and the panel says which way it runs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  parseSummary,
  parseConversation,
  parseSubagentMeta,
  parseSubagentTimes,
  subagentIdFromFile,
  subagentMetaFile,
  subagentEvent,
  readHead,
  readTail,
  HEAD_BYTES,
  TAIL_BYTES,
} from '../../src/adapters/claude-code/parse.mjs';
import { counts, needsYou, placement, projects, isSubagent } from '../../src/core/model.mjs';
import { Registry } from '../../src/core/state-machine.mjs';
import { agentId } from '../../src/core/model.mjs';
import { Identity } from '../../src/core/identity.mjs';
import { floorPopulation, tableSizesFor, isDeskAgent } from '../../public/render/plan.js';
import { assignSeats, derivePlacement, JUNIOR_OFFSET } from '../../public/render/agents.js';
import {
  characterScaleFor,
  plateLinesFor,
  CHAR_MIN_PX_PER_UNIT,
  JUNIOR_SCALE,
} from '../../public/render/scene.js';
import { BODY_HEIGHT_U } from '../../public/render/rig.js';
import { juniorMetaFor } from '../../public/panel.js';

// ---------------------------------------------------------------------------
// Synthetic fixtures, shaped like the files measured on the reference machine.
// ---------------------------------------------------------------------------

const PARENT_ID = '0ef0b873-cb53-4283-9bc5-117285fc7a4a';
const CWD = 'C:\\work\\design-system';

/** One record of a subagent transcript, in the measured shape. */
function subagentRecord(over) {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: true,
    agentId: over.agentId,
    type: over.type,
    uuid: `uuid-${over.n}`,
    timestamp: over.timestamp,
    userType: 'external',
    entrypoint: 'cli',
    cwd: CWD,
    // Verified on this machine: a subagent's records carry the PARENT's
    // session id in `sessionId`. Its own identity is `agentId` and nowhere
    // else in the file.
    sessionId: PARENT_ID,
    version: '2.1.231',
    gitBranch: 'main',
    message: over.message,
  });
}

/** A whole subagent transcript: an opening Task prompt and one working turn. */
function subagentTranscript({ id, startedAt, lastAt, finished = false }) {
  const lines = [
    subagentRecord({
      agentId: id,
      n: 1,
      type: 'user',
      timestamp: new Date(startedAt).toISOString(),
      message: { role: 'user', content: 'Find every hard-coded hex' },
    }),
    subagentRecord({
      agentId: id,
      n: 2,
      type: 'assistant',
      timestamp: new Date(lastAt).toISOString(),
      message: {
        id: `msg-${id}`,
        role: 'assistant',
        model: 'claude-opus-5',
        stop_reason: finished ? 'end_turn' : 'tool_use',
        content: finished
          ? [{ type: 'text', text: 'Found 14 literals across 6 files.' }]
          : [
              { type: 'text', text: 'Sweeping the token files.' },
              { type: 'tool_use', id: 'tu-1', name: 'Grep', input: { pattern: '#fff' } },
            ],
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 900,
          cache_creation_input_tokens: 50,
        },
      },
    }),
  ];
  return lines.join('\n') + '\n';
}

/** A primary session transcript, mid-turn. */
function parentTranscript(at) {
  const base = {
    cwd: CWD,
    gitBranch: 'main',
    sessionId: PARENT_ID,
    version: '2.1.231',
  };
  return (
    [
      JSON.stringify({ type: 'custom-title', customTitle: 'Dark mode audit' }),
      JSON.stringify({
        ...base,
        type: 'user',
        timestamp: new Date(at - 60_000).toISOString(),
        message: { role: 'user', content: 'Audit the dark palette' },
      }),
      JSON.stringify({
        ...base,
        type: 'assistant',
        timestamp: new Date(at).toISOString(),
        message: {
          id: 'msg-parent',
          role: 'assistant',
          model: 'claude-opus-5',
          stop_reason: 'tool_use',
          content: [
            { type: 'text', text: 'Sending two juniors out.' },
            { type: 'tool_use', id: 'toolu_1', name: 'Task', input: { subagent_type: 'Explore' } },
          ],
          usage: { input_tokens: 5, output_tokens: 5 },
        },
      }),
    ].join('\n') + '\n'
  );
}

/**
 * Build a whole synthetic `~/.claude/projects` tree: one project directory,
 * one session, and `juniors.length` subagents under it in the measured
 * layout. Returns the root and a teardown.
 */
async function buildFixture(juniors, { parentAgeMs = 0 } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckhq-wp41-'));
  const projects = path.join(root, 'projects');
  const dir = path.join(projects, 'C--work-design-system');
  await fs.mkdir(dir, { recursive: true });

  const now = Date.now();
  const parentFile = path.join(dir, `${PARENT_ID}.jsonl`);
  await fs.writeFile(parentFile, parentTranscript(now - parentAgeMs), 'utf8');
  const pt = new Date(now - parentAgeMs);
  await fs.utimes(parentFile, pt, pt);

  const subs = path.join(dir, PARENT_ID, 'subagents');
  await fs.mkdir(subs, { recursive: true });
  for (const j of juniors) {
    // Half of the real ones live under `workflows/wf_<id>/`; exercise both.
    const home = j.workflow ? path.join(subs, 'workflows', `wf_${j.workflow}`) : subs;
    await fs.mkdir(home, { recursive: true });
    const file = path.join(home, `agent-${j.id}.jsonl`);
    await fs.writeFile(
      file,
      subagentTranscript({
        id: j.id,
        startedAt: now - (j.ageMs ?? 0) - 120_000,
        lastAt: now - (j.ageMs ?? 0),
        finished: j.finished,
      }),
      'utf8',
    );
    const t = new Date(now - (j.ageMs ?? 0));
    await fs.utimes(file, t, t);
    if (j.meta !== null) {
      await fs.writeFile(
        path.join(home, `agent-${j.id}.meta.json`),
        JSON.stringify(j.meta ?? { agentType: 'Explore', description: j.id, spawnDepth: 1 }),
        'utf8',
      );
    }
  }
  // The workflow journal that sits beside real workflow subagents and is not
  // one: it must never become a person on the floor.
  const wf = juniors.find((j) => j.workflow);
  if (wf) {
    await fs.writeFile(
      path.join(subs, 'workflows', `wf_${wf.workflow}`, 'journal.jsonl'),
      JSON.stringify({ type: 'started', key: 'v2:abc', agentId: wf.id }) + '\n',
      'utf8',
    );
  }

  return { root, projects, dir, now, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

/**
 * Drive the REAL adapter against a fixture tree, in a child process.
 *
 * `PROJECTS_DIR` is resolved from `CLAUDE_CONFIG_DIR` at import time, and this
 * process has already imported `parse.mjs` (bound to the developer's own
 * `~/.claude`) at the top of this file. A query-string re-import would give a
 * fresh `adapter.mjs` and the same cached `parse.mjs` underneath it, so the
 * only honest way to point the adapter at a fixture is a process that has not
 * imported it yet. It also means the summary cache, the live-probe cache and
 * the subagent index start empty for every case, which is what makes these
 * deterministic.
 *
 * `body` is module source; whatever it assigns to `result` comes back as JSON.
 *
 * @param {string} claudeDir
 * @param {string} body
 * @returns {Promise<any>}
 */
function inAdapter(claudeDir, body) {
  const src = `
    import { adapter, SUBAGENT_IDLE_MS, SUBAGENT_PARENT_WINDOW_MS } from ${JSON.stringify(
      new URL('../../src/adapters/claude-code/adapter.mjs', import.meta.url).href,
    )};
    import fs from 'node:fs/promises';
    import path from 'node:path';
    const scan = () => adapter.scanSessions({ maxAgeDays: 36500, limit: 100 });
    let result;
    ${body}
    process.stdout.write(JSON.stringify(result ?? null));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', src], {
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: claudeDir,
        // The scan reads the desktop app's store and would otherwise touch the
        // developer's own; and the summary cache must not land in ~/.deckhq.
        DECKHQ_STATE_DIR: path.join(claudeDir, 'state'),
      },
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`adapter child exited ${code}: ${err}`));
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(new Error(`adapter child printed ${JSON.stringify(out)}: ${e.message}\n${err}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// 1. parse.mjs — the shapes on disk
// ---------------------------------------------------------------------------

test('a subagent transcript filename yields its id, and a workflow journal does not', () => {
  assert.equal(subagentIdFromFile('agent-a17d285494ed98b0e.jsonl'), 'a17d285494ed98b0e');
  assert.equal(subagentIdFromFile('journal.jsonl'), null);
  assert.equal(subagentIdFromFile('agent-a17d285494ed98b0e.meta.json'), null);
  assert.equal(subagentIdFromFile(''), null);
  assert.equal(subagentIdFromFile('agent-../../escape.jsonl'), null);
  assert.equal(subagentMetaFile('agent-abc.jsonl'), 'agent-abc.meta.json');
});

test('every meta.json shape measured on the reference machine parses', () => {
  // 607 of 987 sidecars carry only these two keys.
  assert.deepEqual(parseSubagentMeta('{"agentType":"workflow-subagent","spawnDepth":1}'), {
    agentType: 'workflow-subagent',
    description: null,
    model: null,
    toolUseId: null,
    spawnDepth: 1,
    parentAgentId: null,
  });
  // The richest shape seen: a Task subagent with a worktree.
  const full = parseSubagentMeta(
    JSON.stringify({
      agentType: 'general-purpose',
      description: 'Audit pixel office tools vs spec',
      model: 'claude-opus-5',
      toolUseId: 'toolu_01UQF7dyziPSAoHoXxpUKfAG',
      spawnDepth: 2,
      spawnedWithWorktree: true,
      worktreeBranch: 'agent-a1',
      worktreePath: 'C:/wt',
      parentAgentId: 'a5103915280dde10b',
    }),
  );
  assert.equal(full.agentType, 'general-purpose');
  assert.equal(full.description, 'Audit pixel office tools vs spec');
  assert.equal(full.toolUseId, 'toolu_01UQF7dyziPSAoHoXxpUKfAG');
  assert.equal(full.spawnDepth, 2);
  assert.equal(full.parentAgentId, 'a5103915280dde10b');
  // Absent, empty and corrupt all give the same all-null record, never a throw.
  for (const bad of ['', '{', 'null', '[]', '"a string"', '{"agentType":42}']) {
    assert.equal(parseSubagentMeta(bad).agentType, null, bad);
  }
});

test('spawn and last-activity come from the transcript, oldest and newest', () => {
  const start = Date.parse('2026-09-03T10:00:00.000Z');
  const end = Date.parse('2026-09-03T10:04:00.000Z');
  const text = subagentTranscript({ id: 'a1', startedAt: start, lastAt: end });
  const times = parseSubagentTimes(text, text);
  assert.equal(times.spawnedAt, start);
  assert.equal(times.lastActivityAt, end);
  // Nothing datable is null, not zero and not NaN.
  assert.deepEqual(parseSubagentTimes('', ''), { spawnedAt: null, lastActivityAt: null });
  assert.deepEqual(parseSubagentTimes('not json\n{}\n', ''), {
    spawnedAt: null,
    lastActivityAt: null,
  });
});

test('parseSummary reads a subagent transcript only with sidechain:true', () => {
  const at = Date.parse('2026-09-03T10:04:00.000Z');
  const text = subagentTranscript({ id: 'a1', startedAt: at - 120_000, lastAt: at });

  // Without the flag every record is filtered out as somebody else's traffic:
  // the tokens still count (they always did) but nothing was said and there is
  // no title to be had.
  const blind = parseSummary(text, text, { id: 'a1', mtimeMs: at });
  assert.equal(blind.lastText, '');
  assert.equal(blind.lastRole, null);
  assert.ok(blind.tokens > 0, 'token accounting was never sidechain-blind');

  const seen = parseSummary(text, text, { id: 'a1', mtimeMs: at, sidechain: true });
  assert.equal(seen.lastRole, 'assistant');
  assert.match(seen.lastText, /Sweeping the token files/);
  assert.equal(seen.cwd, CWD);
  assert.equal(seen.gitBranch, 'main');
  assert.equal(seen.model, 'claude-opus-5');
  assert.equal(seen.lastActivityAt, at);
  // Mid-turn: a tool call is outstanding, so the junior is working.
  assert.equal(seen.turnEnded, false);

  const done = parseSummary(
    subagentTranscript({ id: 'a1', startedAt: at - 120_000, lastAt: at, finished: true }),
    subagentTranscript({ id: 'a1', startedAt: at - 120_000, lastAt: at, finished: true }),
    { id: 'a1', mtimeMs: at, sidechain: true },
  );
  assert.equal(done.turnEnded, true, 'an end_turn with no tool call is a finished junior');
});

test('parseConversation returns a juniordialogue only with sidechain:true', () => {
  const at = Date.now();
  const text = subagentTranscript({ id: 'a1', startedAt: at - 1000, lastAt: at });
  assert.equal(parseConversation(text).length, 0);
  const msgs = parseConversation(text, { sidechain: true });
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'user');
  assert.equal(msgs[1].role, 'assistant');
});

test('subagentEvent reads the three payload shapes and guesses at none', () => {
  // 1. An explicit id, whatever it is spelled.
  for (const key of ['agent_id', 'agentId', 'subagent_id']) {
    assert.deepEqual(subagentEvent({ [key]: 'a1' }), { agentId: 'a1', parentSessionId: null });
  }
  // 2. A transcript path inside a subagents directory, on either separator.
  assert.deepEqual(
    subagentEvent({
      transcript_path: `C:\\Users\\x\\.claude\\projects\\P\\${PARENT_ID}\\subagents\\agent-a9.jsonl`,
    }),
    { agentId: 'a9', parentSessionId: PARENT_ID },
  );
  assert.deepEqual(
    subagentEvent({
      transcript_path: `/home/x/.claude/projects/P/${PARENT_ID}/subagents/workflows/wf_1/agent-a9.jsonl`,
    }),
    { agentId: 'a9', parentSessionId: PARENT_ID },
  );
  // 3. Nothing that names a junior: null, so the caller keeps §89's behaviour.
  assert.equal(subagentEvent({}), null);
  assert.equal(subagentEvent(null), null);
  assert.equal(subagentEvent({ session_id: PARENT_ID }), null);
  assert.equal(
    subagentEvent({ transcript_path: `/home/x/.claude/projects/P/${PARENT_ID}.jsonl` }),
    null,
    'a PARENT transcript path names no junior',
  );
  assert.equal(
    subagentEvent({ transcript_path: '/home/x/.claude/projects/P/S/subagents/journal.jsonl' }),
    null,
  );
});

// ---------------------------------------------------------------------------
// 2. adapter.mjs — discovery and the two windows
// ---------------------------------------------------------------------------

test('the adapter finds juniors in both on-disk layouts and skips the journal', async () => {
  const fx = await buildFixture([
    { id: 'a0000000000000001', ageMs: 5_000 },
    { id: 'a0000000000000002', ageMs: 5_000, workflow: '8cbac7c4-a49' },
  ]);
  try {
    const out = await inAdapter(fx.root, 'result = await scan();');
    const juniors = out.filter((s) => s.subagent);
    assert.equal(juniors.length, 2, 'one Task subagent and one workflow subagent');
    assert.deepEqual(
      juniors.map((j) => j.id).sort(),
      ['claude-code:a0000000000000001', 'claude-code:a0000000000000002'],
      'journal.jsonl is not a junior',
    );
    for (const j of juniors) {
      assert.equal(j.parentSessionId, PARENT_ID);
      assert.equal(j.runtime, 'claude-code');
      assert.equal(j.cwd, CWD);
      assert.equal(j.subagentType, 'Explore');
      assert.ok(j.spawnedAt > 0 && j.spawnedAt < j.lastActivityAt);
      assert.ok(j.tokens > 0);
    }
    // And the parent is still an ordinary session in the same list.
    const parent = out.find((s) => s.id === agentId('claude-code', PARENT_ID));
    assert.ok(parent, 'the parent session is unaffected');
    assert.equal(parent.subagent, undefined);
    assert.equal(parent.title, 'Dark mode audit');
  } finally {
    await fx.cleanup();
  }
});

test("a junior's title is the Task description, and a junior with no meta still works", async () => {
  const fx = await buildFixture([
    {
      id: 'a0000000000000003',
      ageMs: 1_000,
      meta: { agentType: 'general-purpose', description: 'Check the contrast ratios' },
    },
    { id: 'a0000000000000004', ageMs: 1_000, meta: null },
  ]);
  try {
    const out = await inAdapter(fx.root, 'result = await scan();');
    const described = out.find((s) => s.id === 'claude-code:a0000000000000003');
    assert.equal(described.title, 'Check the contrast ratios');
    assert.equal(described.hasCustomTitle, true);

    const bare = out.find((s) => s.id === 'claude-code:a0000000000000004');
    assert.ok(bare, 'a junior with no sidecar is still a junior');
    assert.equal(bare.subagentType, null);
    // Falls back to the transcript's own opening prompt, like any session.
    assert.equal(bare.title, 'Find every hard-coded hex');
  } finally {
    await fx.cleanup();
  }
});

test('a junior leaves when its transcript stops moving, and a stale parent is never opened', async () => {
  const fx = await buildFixture([{ id: 'a0000000000000005', ageMs: 10_000 }]);
  const junior = path
    .join(fx.dir, PARENT_ID, 'subagents', 'agent-a0000000000000005.jsonl')
    .replace(/\\/g, '\\\\');
  const parentFile = path.join(fx.dir, `${PARENT_ID}.jsonl`).replace(/\\/g, '\\\\');
  try {
    const out = await inAdapter(
      fx.root,
      `
      const junior = "${junior}";
      const parentFile = "${parentFile}";
      const juniors = (list) => list.filter((s) => s.subagent).length;
      const fresh = juniors(await scan());

      // Push the junior's file past the idle window, leaving everything else.
      const stale = new Date(Date.now() - SUBAGENT_IDLE_MS - 60_000);
      await fs.utimes(junior, stale, stale);
      const afterIdle = await scan();

      // A parent whose own transcript is old has no live junior by definition,
      // and its directory is not read at all — the cost control.
      const old = new Date(Date.now() - SUBAGENT_PARENT_WINDOW_MS - 60_000);
      await fs.utimes(parentFile, old, old);
      await fs.utimes(junior, new Date(), new Date());
      const staleParent = await scan();

      result = {
        fresh,
        afterIdle: juniors(afterIdle),
        parentStillThere: afterIdle.some((s) => s.id === 'claude-code:${PARENT_ID}'),
        staleParent: juniors(staleParent),
      };
    `,
    );
    assert.equal(out.fresh, 1, 'a junior written seconds ago is here');
    assert.equal(out.afterIdle, 0, 'it stopped, so it left');
    assert.equal(out.parentStillThere, true, 'the parent is untouched by its junior leaving');
    assert.equal(out.staleParent, 0, 'a parent quiet for half an hour is not searched for juniors');
  } finally {
    await fx.cleanup();
  }
});

test("a junior's own conversation is readable, and the parent's is not polluted", async () => {
  const fx = await buildFixture([{ id: 'a0000000000000006', ageMs: 1_000 }]);
  try {
    const out = await inAdapter(
      fx.root,
      `
      await scan();
      result = {
        junior: await adapter.conversation('claude-code:a0000000000000006', { maxMessages: 200 }),
        parent: await adapter.conversation('claude-code:${PARENT_ID}', { maxMessages: 200 }),
      };
    `,
    );
    assert.equal(out.junior.length, 2, "the junior's own turns, from its own file");
    assert.match(out.junior[1].text, /Sweeping the token files/);
    assert.ok(
      out.parent.every((m) => !/Sweeping the token files/.test(m.text)),
      "a junior's speech never appears in its parent's conversation",
    );
  } finally {
    await fx.cleanup();
  }
});

test('bounded reads are still bounded for a junior', async () => {
  // Nothing in the subagent path may read a whole file: the same head/tail
  // discipline as every other transcript.
  const fx = await buildFixture([{ id: 'a0000000000000007', ageMs: 1_000 }]);
  try {
    const file = path.join(fx.dir, PARENT_ID, 'subagents', 'agent-a0000000000000007.jsonl');
    const head = await readHead(file, 64);
    const tail = await readTail(file, 64);
    assert.ok(head.length <= 64);
    assert.ok(tail.length <= 64);
    assert.ok(HEAD_BYTES > 0 && TAIL_BYTES > 0);
  } finally {
    await fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 3. model.mjs — what a junior is, and is not
// ---------------------------------------------------------------------------

function agent(over = {}) {
  return {
    id: over.id ?? 'claude-code:s1',
    runtime: 'claude-code',
    title: 't',
    projectId: over.projectId ?? 'p',
    projectName: 'p',
    cwd: 'C:\\p',
    activityState: over.activityState ?? 'working',
    ackState: over.ackState ?? 'active',
    reviewSince: over.reviewSince ?? null,
    needsInputSince: null,
    lastActivityAt: over.lastActivityAt ?? Date.now(),
    tokens: over.tokens ?? 10,
    cacheTokens: 0,
    costEstimate: over.costEstimate ?? 0.01,
    subagent: over.subagent,
    parentId: over.parentId ?? null,
    juniorCount: over.juniorCount ?? 0,
  };
}

test('a junior is never in the needs-you count unless it raises its own hand', () => {
  for (const state of ['for_review', 'stalled']) {
    assert.equal(needsYou(agent({ activityState: state })), true, `a session is: ${state}`);
    assert.equal(
      needsYou(agent({ activityState: state, subagent: true })),
      false,
      `a junior is not: ${state}`,
    );
  }
  // The one that does count, because only a person can answer it.
  assert.equal(needsYou(agent({ activityState: 'needs_input', subagent: true })), true);
  assert.equal(needsYou(agent({ activityState: 'working', subagent: true })), false);
  assert.equal(isSubagent(agent({ subagent: true })), true);
  assert.equal(isSubagent(agent()), false);
});

test('counts() agrees with needsYou() about juniors, breakdown included', () => {
  const c = counts([
    agent({ id: 'a', activityState: 'for_review', reviewSince: 1 }),
    agent({ id: 'b', activityState: 'for_review', subagent: true, parentId: 'claude-code:a' }),
    agent({ id: 'c', activityState: 'stalled', subagent: true, parentId: 'claude-code:a' }),
    agent({ id: 'd', activityState: 'needs_input', subagent: true, parentId: 'claude-code:a' }),
  ]);
  assert.equal(c.forReview, 1, "the junior's finished turn is not a review");
  assert.equal(c.stalled, 0, 'nor is its long tool call a stall');
  assert.equal(c.handsUp, 1, 'but a raised hand is a raised hand');
  assert.equal(c.needsYou, 2, '1 for_review + 1 hand up');
  assert.equal(c.total, 4, 'juniors are still counted as people on the floor');
});

test('a junior is only ever beside its parent: never the office, never the lounge', () => {
  assert.equal(placement(agent({ activityState: 'for_review' })), 'office');
  assert.equal(placement(agent({ activityState: 'for_review', subagent: true })), 'desk');
  assert.equal(placement(agent({ ackState: 'benched', subagent: true })), 'desk');
  // The renderer's mirror of the same rule must agree, on every case.
  for (const activityState of ['working', 'needs_input', 'stalled', 'for_review', 'ended']) {
    for (const ackState of ['active', 'benched', 'let_go']) {
      const a = agent({ activityState, ackState });
      assert.equal(derivePlacement(a), placement(a), `${activityState}/${ackState}`);
      const j = agent({ activityState, ackState, subagent: true });
      assert.equal(derivePlacement(j), placement(j), `junior ${activityState}/${ackState}`);
    }
  }
});

test('a room counts its juniors apart from its sessions, and their spend with them', () => {
  const [p] = projects([
    agent({ id: 'claude-code:a', tokens: 100, costEstimate: 1 }),
    agent({
      id: 'claude-code:j1',
      subagent: true,
      parentId: 'claude-code:a',
      tokens: 10,
      costEstimate: 0.5,
    }),
    agent({
      id: 'claude-code:j2',
      subagent: true,
      parentId: 'claude-code:a',
      tokens: 10,
      costEstimate: 0.5,
    }),
  ]);
  assert.equal(p.sessionCount, 1, 'the user started one thing');
  assert.equal(p.juniors, 2);
  assert.equal(p.activeCount, 3, 'but three people are in the room');
  assert.equal(p.tokens, 120, "a junior's tokens are its own and are not double counted");
  assert.equal(p.costEstimate, 2);
});

// ---------------------------------------------------------------------------
// 4. state-machine.mjs — the lifecycle, and the invariant
// ---------------------------------------------------------------------------

function fakeStore() {
  const ack = new Map();
  const writes = [];
  return {
    async load() {},
    get settings() {
      return { stallWindowMs: 600_000, notifications: false, sound: false, pollIntervalMs: 5000 };
    },
    setSettings() {},
    get seededAt() {
      return 1;
    },
    markSeeded() {},
    getAck(id) {
      return ack.has(id) ? { ...ack.get(id) } : undefined;
    },
    setAck(id, patch) {
      writes.push({ id, patch });
      const prev = ack.get(id) || {
        state: 'active',
        reviewSince: null,
        needsInputSince: null,
        updatedAt: 0,
      };
      const next = { ...prev, ...patch, updatedAt: 1 };
      ack.set(id, next);
      return { ...next };
    },
    allAck() {
      const out = {};
      for (const [k, v] of ack) out[k] = { ...v };
      return out;
    },
    isProjectArchived: () => false,
    setProjectArchived() {},
    archivedProjects: () => [],
    writes,
  };
}

function fakeAdapter(summaries) {
  let current = summaries;
  return {
    id: 'claude-code',
    label: 'Claude Code',
    available: async () => true,
    scanSessions: async () => current,
    liveSessions: async () => [],
    conversation: async () => [],
    send: async () => ({ ok: true }),
    openInTerminal: async () => {},
    hooks: {
      supported: true,
      describe: () => ({ file: '', json: '', events: [], note: '' }),
      install: async () => {},
      remove: async () => {},
      installed: async () => true,
    },
    set(next) {
      current = next;
    },
  };
}

function summary(id, over = {}) {
  return {
    id: agentId('claude-code', id),
    runtime: 'claude-code',
    title: over.title ?? id,
    hasCustomTitle: false,
    cwd: CWD,
    gitBranch: 'main',
    model: 'claude-opus-5',
    lastActivityAt: over.lastActivityAt ?? Date.now(),
    tokens: over.tokens ?? 10,
    cacheTokens: 0,
    costEstimate: 0.01,
    lastRole: 'assistant',
    lastText: 'x',
    turnEnded: over.turnEnded ?? false,
    ...over,
  };
}

function junior(id, over = {}) {
  return summary(id, {
    subagent: true,
    parentSessionId: PARENT_ID,
    subagentType: over.subagentType ?? 'Explore',
    subagentDescription: over.subagentDescription ?? null,
    spawnedAt: over.spawnedAt ?? Date.now() - 60_000,
    ...over,
  });
}

async function registryWith(summaries) {
  const store = fakeStore();
  const adapter = fakeAdapter(summaries);
  const registry = new Registry({
    store,
    adapters: [adapter],
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
  registry.setHookStatus({ 'claude-code': { supported: true, installed: true } });
  await registry.refresh();
  return { registry, store, adapter };
}

/** Every user-owned field, exactly as `docs/01-PRODUCT.md` §2 names them. */
function userOwned(a) {
  return { ackState: a.ackState, reviewSince: a.reviewSince, needsInputSince: a.needsInputSince };
}

test('a junior arrives when it is spawned, is attached to its parent, and never for_review', async () => {
  const { registry, adapter } = await registryWith([summary(PARENT_ID)]);
  let parent = registry.agents.find((a) => a.id === agentId('claude-code', PARENT_ID));
  assert.equal(parent.juniorCount, 0);

  adapter.set([summary(PARENT_ID), junior('a1'), junior('a2')]);
  await registry.refresh();

  const juniors = registry.agents.filter((a) => a.subagent);
  assert.equal(juniors.length, 2, 'two juniors sat down');
  for (const j of juniors) {
    assert.equal(j.parentId, agentId('claude-code', PARENT_ID));
    assert.equal(j.ackState, 'active', 'a junior is never anything else');
    assert.equal(j.activityState, 'working');
    assert.equal(j.subagentType, 'Explore');
    assert.ok(j.spawnedAt > 0);
  }
  parent = registry.agents.find((a) => a.id === agentId('claude-code', PARENT_ID));
  assert.equal(parent.juniorCount, 2);
  assert.equal(parent.subagent, false);

  // A junior whose turn has ended is `ended` and waiting for nobody — the one
  // state a session would have called `for_review`.
  adapter.set([summary(PARENT_ID), junior('a1', { turnEnded: true })]);
  await registry.refresh();
  const done = registry.agents.find((a) => a.id === 'claude-code:a1');
  assert.equal(done.activityState, 'ended');
  assert.equal(done.reviewSince, null);
});

test('INVARIANT: a subagent lifecycle changes no user-owned field on the parent', async () => {
  // The parent starts where it hurts most: standing in the office with a
  // review the user has not answered, and a hand-up record beside it.
  const { registry, store, adapter } = await registryWith([
    summary(PARENT_ID, { turnEnded: true, lastRole: 'assistant' }),
  ]);
  const parentAgentId = agentId('claude-code', PARENT_ID);
  await registry.act(parentAgentId, 'review');

  const before = userOwned(registry.agents.find((a) => a.id === parentAgentId));
  assert.equal(before.activityState, undefined);
  assert.ok(before.reviewSince, 'the parent is genuinely in the office');
  const ackBefore = JSON.stringify(store.allAck());
  const countsBefore = JSON.stringify(registry.snapshot().counts);

  // A whole junior lifetime, twice over: spawn, work, a tool event on the
  // parent's id, a stop that names the junior, and the scan losing it.
  adapter.set([summary(PARENT_ID, { turnEnded: true }), junior('a1'), junior('a2'), junior('a3')]);
  await registry.refresh();
  assert.equal(registry.agents.filter((a) => a.subagent).length, 3);

  registry.applyHook({
    runtime: 'claude-code',
    sessionId: PARENT_ID,
    hookEvent: 'PreToolUse',
    tool: { name: 'Task', summary: 'Explore' },
  });
  registry.applyHook({
    runtime: 'claude-code',
    sessionId: PARENT_ID,
    hookEvent: 'SubagentStop',
    subagent: { agentId: 'a1', parentSessionId: PARENT_ID },
  });
  registry.applyHook({
    runtime: 'claude-code',
    sessionId: PARENT_ID,
    hookEvent: 'SubagentStop',
    subagent: null,
  });
  adapter.set([summary(PARENT_ID, { turnEnded: true }), junior('a2')]);
  await registry.refresh();
  adapter.set([summary(PARENT_ID, { turnEnded: true })]);
  await registry.refresh();

  const after = userOwned(registry.agents.find((a) => a.id === parentAgentId));
  assert.deepEqual(after, before, 'not one user-owned field on the parent moved');
  assert.equal(
    JSON.stringify(store.allAck()),
    ackBefore,
    'and nothing new was written to the store for anybody',
  );
  assert.equal(
    JSON.stringify(registry.snapshot().counts),
    countsBefore,
    'the needs-you count and its whole breakdown are unchanged',
  );
  assert.equal(registry.agents.filter((a) => a.subagent).length, 0, 'every junior has left');
});

test('a SubagentStop that names a junior removes it at once; one that names none does not', async () => {
  const { registry, adapter } = await registryWith([
    summary(PARENT_ID),
    junior('a1'),
    junior('a2'),
  ]);
  assert.equal(registry.agents.filter((a) => a.subagent).length, 2);

  registry.applyHook({
    runtime: 'claude-code',
    sessionId: PARENT_ID,
    hookEvent: 'SubagentStop',
    subagent: { agentId: 'a1', parentSessionId: PARENT_ID },
  });
  assert.deepEqual(
    registry.agents.filter((a) => a.subagent).map((a) => a.id),
    ['claude-code:a2'],
    'the named junior left and the other stayed',
  );

  // §89's behaviour, unchanged, for a payload that identifies nobody.
  registry.applyHook({
    runtime: 'claude-code',
    sessionId: PARENT_ID,
    hookEvent: 'SubagentStop',
    subagent: null,
  });
  assert.equal(registry.agents.filter((a) => a.subagent).length, 1);

  // And the set does not grow: once the scan loses `a1` too, it is forgotten.
  adapter.set([summary(PARENT_ID)]);
  await registry.refresh();
  assert.equal(registry._stoppedJuniors.size, 0);
});

test('no user action is available on a junior, from any surface', async () => {
  const { registry, store } = await registryWith([summary(PARENT_ID), junior('a1')]);
  for (const action of ['acknowledge', 'review', 'bench', 'recall', 'let_go', 'rehire']) {
    await assert.rejects(
      () => registry.act('claude-code:a1', action),
      /not available for a subagent/,
      action,
    );
  }
  assert.deepEqual(store.writes, [], 'a refused action writes nothing');
});

test("a junior wears its parent's tag and takes no MK number or name of its own", async () => {
  // The smallest store surface `Identity` uses: an `identity` bag and a
  // `touch()` that would persist it.
  const identityStore = { identity: {}, touch() {} };
  const identity = new Identity(identityStore);
  const store = fakeStore();
  const adapter = fakeAdapter([summary(PARENT_ID), junior('a1'), junior('a2')]);
  const registry = new Registry({
    store,
    adapters: [adapter],
    identity,
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
  registry.setHookStatus({ 'claude-code': { supported: true, installed: true } });
  await registry.refresh();

  const snap = registry.snapshot();
  const parent = snap.agents.find((a) => a.id === agentId('claude-code', PARENT_ID));
  const juniors = snap.agents.filter((a) => a.subagent).sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(juniors.length, 2);
  assert.equal(juniors[0].mk, `${parent.mk}j1`);
  assert.equal(juniors[1].mk, `${parent.mk}j2`);
  assert.equal(juniors[0].label, `${parent.mk}j1`);
  assert.equal(juniors[0].givenName, null, 'a junior is never given a first name');
  assert.equal(juniors[0].displayName, null);
  // Nothing about either junior was persisted: the identity table knows the
  // parent and the project, and nobody else. This is the thing that would
  // otherwise fill `~/.deckhq` with hundreds of thirty-second sessions and
  // drain the first-name pool.
  const state = identityStore.identity;
  assert.deepEqual(Object.keys(state.agents), [agentId('claude-code', PARENT_ID)]);
  assert.deepEqual(Object.keys(state.names), [agentId('claude-code', PARENT_ID)]);
});

// ---------------------------------------------------------------------------
// 5. plan.js / agents.js — the table grows and the juniors stand beside
// ---------------------------------------------------------------------------

test("juniors are occupants: the table grows to seat the parent's whole huddle", () => {
  const senior = agent({ id: 'claude-code:s', projectId: 'p' });
  const withNone = floorPopulation([senior]);
  assert.equal(withNone.desks.get('p'), 1);
  assert.deepEqual(tableSizesFor(withNone.desks.get('p')), [2]);

  const juniors = [1, 2, 3].map((n) =>
    agent({ id: `claude-code:j${n}`, projectId: 'p', subagent: true, parentId: 'claude-code:s' }),
  );
  const withThree = floorPopulation([senior, ...juniors]);
  assert.equal(withThree.desks.get('p'), 4, 'desks = agents at desks, juniors included');
  assert.deepEqual(
    tableSizesFor(withThree.desks.get('p')),
    [4],
    'a parent with three juniors gets a four-seat table',
  );
  assert.equal(withThree.active.get('p'), 4);
  for (const j of juniors) assert.equal(isDeskAgent(j), true);
});

test('a junior takes no chair: it stands one seat pitch beside its parent, and behind it', () => {
  const senior = agent({ id: 'claude-code:s', projectId: 'p' });
  const j1 = agent({
    id: 'claude-code:j1',
    projectId: 'p',
    subagent: true,
    parentId: 'claude-code:s',
  });
  const j2 = agent({
    id: 'claude-code:j2',
    projectId: 'p',
    subagent: true,
    parentId: 'claude-code:s',
  });
  // Two real chairs, so a junior stealing one would be visible as a miss.
  const plan = {
    seats: new Map([
      [
        'p',
        [
          { x: 10, y: 10, angle: -Math.PI / 2 },
          { x: 20, y: 20, angle: -Math.PI / 2 },
        ],
      ],
    ]),
    officeSeats: [],
    loungeSpots: [],
  };
  const seats = assignSeats(plan, [senior, j1, j2]);

  const anchor = seats.get('claude-code:s');
  assert.ok(anchor, 'the senior took a chair');
  const a = seats.get('claude-code:j1');
  const b = seats.get('claude-code:j2');
  assert.ok(a && b, 'both juniors were placed');
  assert.equal(a.junior, true);
  // Facing is -PI/2 (up the screen at the table), so "along the desk" is x and
  // "behind" is +y. First junior left, second right, both a step back.
  const near = (v, want, why) =>
    assert.ok(Math.abs(v - want) < 1e-6, `${why}: ${v} is not ${want}`);
  near(a.x - anchor.x, -JUNIOR_OFFSET, 'the first junior is one seat pitch left');
  near(b.x - anchor.x, JUNIOR_OFFSET, 'the second is one seat pitch right');
  assert.ok(a.y > anchor.y, 'behind the chair, not on the table');
  near(a.y, b.y, 'the juniors stand in one row');
  assert.equal(a.angle, anchor.angle, 'and face the same way as the person they came from');
  // Neither junior is standing on the OTHER chair.
  assert.notDeepEqual([a.x, a.y], [20, 20]);
  assert.notDeepEqual([b.x, b.y], [20, 20]);
});

test('a junior whose parent is not on the floor is not drawn at all', () => {
  const orphan = agent({
    id: 'claude-code:j1',
    projectId: 'p',
    subagent: true,
    parentId: 'claude-code:gone',
  });
  const seats = assignSeats(
    { seats: new Map([['p', [{ x: 1, y: 1, angle: 0 }]]]), officeSeats: [], loungeSpots: [] },
    [orphan],
  );
  assert.equal(seats.size, 0, 'nothing to stand beside, so nothing on the floor');
});

// ---------------------------------------------------------------------------
// 6. panel.js — which way the relationship runs
// ---------------------------------------------------------------------------

test('the room plate counts the juniors, apart from the sessions', () => {
  const room = {
    kind: 'project',
    id: 'p',
    name: 'design-system',
    plateLines: ['design-system', ''],
  };
  const project = {
    id: 'p',
    sessionCount: 4,
    tokens: 540_000,
    needsYou: 0,
    juniors: 2,
    costRated: false,
  };
  const [, line] = plateLinesFor(room, { projects: [project] });
  assert.match(line, /^4 sessions · \+2 juniors · /);
  const [, one] = plateLinesFor(room, { projects: [{ ...project, juniors: 1 }] });
  assert.match(one, /\+1 junior · /);
  const [, none] = plateLinesFor(room, { projects: [{ ...project, juniors: 0 }] });
  assert.equal(none.includes('junior'), false, 'a room with none says nothing about them');
  // A snapshot from a daemon that predates this package has no `juniors` key.
  const [, old] = plateLinesFor(room, { projects: [{ ...project, juniors: undefined }] });
  assert.equal(old.includes('junior'), false);
});

test('a junior is drawn smaller than its parent, but never below the legibility floor', () => {
  assert.ok(JUNIOR_SCALE > 0 && JUNIOR_SCALE < 1);
  // On a comfortable floor the junior is exactly `JUNIOR_SCALE` of the senior.
  const roomy = 40;
  assert.equal(characterScaleFor(roomy), roomy);
  assert.equal(characterScaleFor(roomy * JUNIOR_SCALE), roomy * JUNIOR_SCALE);
  assert.ok(characterScaleFor(roomy * JUNIOR_SCALE) < characterScaleFor(roomy));
  // On a floor tight enough that 80% would fall under 16 px of body, the
  // junior stops shrinking with everybody else rather than becoming a smudge.
  const tight = CHAR_MIN_PX_PER_UNIT;
  assert.equal(characterScaleFor(tight * JUNIOR_SCALE), CHAR_MIN_PX_PER_UNIT);
  assert.equal(characterScaleFor(tight * JUNIOR_SCALE) * BODY_HEIGHT_U >= 16, true);
});

test('the panel builds its junior line from `juniorMetaFor` and nowhere else', () => {
  // The repo's own way of checking a client render path (see
  // `panel-invariant.test.mjs`): read the source. A second, hand-rolled copy
  // of this string is exactly the drift `docs/DEVIATIONS.md` §96 decision 3 is
  // about.
  const src = readFileSync(new URL('../../public/panel.js', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm,
    '$1',
  );
  assert.match(src, /juniorMetaFor\(a, getSnapshot\(\)\)/, 'the meta row calls it');
  assert.equal(
    (src.match(/junior of /g) || []).length,
    1,
    'the phrase exists once, inside juniorMetaFor',
  );
  assert.equal(
    (src.match(/juniorCount/g) || []).length,
    1,
    'and juniorCount is read in exactly one place',
  );
});

test('the panel says "junior of <parent>" on one and "3 juniors" on the other', () => {
  const parent = { id: 'claude-code:s', displayName: null, label: 'MK1.2', juniorCount: 3 };
  const jr = { id: 'claude-code:j1', subagent: true, parentId: 'claude-code:s' };
  const snap = { agents: [parent, jr] };

  assert.equal(juniorMetaFor(jr, snap), 'junior of MK1.2');
  assert.equal(juniorMetaFor(parent, snap), '3 juniors');
  assert.equal(juniorMetaFor({ ...parent, juniorCount: 1 }, snap), '1 junior');
  assert.equal(
    juniorMetaFor({ ...parent, juniorCount: 0 }, snap),
    null,
    'silent when there are none',
  );
  // A named parent is called by its name, the way every other line does it.
  assert.equal(
    juniorMetaFor(jr, { agents: [{ ...parent, displayName: 'Boris' }, jr] }),
    'junior of Boris',
  );
  // And a junior whose parent is off the snapshot still says what it is.
  assert.equal(juniorMetaFor(jr, { agents: [jr] }), 'junior');
  assert.equal(juniorMetaFor(null, snap), null);
});
