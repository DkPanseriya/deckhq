/**
 * WP-13's empty machine, end to end on a real daemon.
 *
 * The claim in `docs/plan/05-GUI-UX-SPEC.md` §7 is specific: a user with no
 * sessions sees actors rather than a blank screen, and "when the first real
 * session appears, the actors leave and it walks in alone" — within one poll,
 * not on a reload. That is a statement about the daemon, so it is tested
 * against one.
 *
 * The environment is pinned before `src/` is imported, because the Claude
 * adapter resolves `CLAUDE_CONFIG_DIR` at module load and the Codex adapter
 * reads `os.homedir()`, which on both platforms is an environment variable.
 * `node --test` gives every file its own process, so this cannot leak into
 * another suite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

// --------------------------------------------------------- an empty machine
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-demo-it-'));
const CLAUDE_DIR = path.join(SANDBOX, 'claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
fs.mkdirSync(PROJECTS_DIR, { recursive: true });

process.env.CLAUDE_CONFIG_DIR = CLAUDE_DIR;
// Codex has no config-dir override, so the home itself is moved. There is no
// `~/.codex` under this one, so the adapter reports itself unavailable.
process.env.HOME = SANDBOX;
process.env.USERPROFILE = SANDBOX;

const { startDaemon } = await import('../../src/daemon.mjs');
const { DEMO_NOTE } = await import('../../src/core/demo-fixture.mjs');
const { deckFrom } = await import('../../src/cli/doctor.mjs');

/** Start a daemon over the empty machine, with its own state file. */
async function withDaemon(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-demo-state-'));
  const publicDir = path.join(dir, 'public');
  await fsp.mkdir(publicDir);
  await fsp.writeFile(path.join(publicDir, 'index.html'), 'floor');
  const d = await startDaemon({ port: 0, stateFile: path.join(dir, 'state.json'), publicDir });
  try {
    await fn(d);
  } finally {
    await d.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

const state = (d) => fetch(d.url + 'api/state').then((r) => r.json());

/**
 * Write a Claude Code transcript the real parser will read: one user turn,
 * one finished assistant turn. That is a session that has finished its turn,
 * which is what puts somebody in the office.
 * @param {string} sessionId
 */
function writeRealSession(sessionId) {
  const cwd = path.join(SANDBOX, 'code', 'walks-in');
  const slug = cwd.replace(/[\\/:]+/g, '-');
  const dir = path.join(PROJECTS_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  const at = (s) => new Date(Date.now() - 60_000 + s * 1000).toISOString();
  const lines = [
    { type: 'custom-title', customTitle: 'The one that walks in', sessionId },
    {
      parentUuid: null,
      isSidechain: false,
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'Ship the thing.' }] },
      uuid: 'u1',
      timestamp: at(1),
      cwd,
      gitBranch: 'main',
      sessionId,
      version: '2.1.0',
    },
    {
      parentUuid: 'u1',
      isSidechain: false,
      type: 'assistant',
      message: {
        id: 'msg_a',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'Shipped. Want me to open the PR?' }],
        usage: {
          input_tokens: 120,
          output_tokens: 64,
          cache_read_input_tokens: 8,
          cache_creation_input_tokens: 4,
        },
      },
      uuid: 'a1',
      timestamp: at(2),
      cwd,
      gitBranch: 'main',
      sessionId,
    },
  ];
  fs.writeFileSync(
    path.join(dir, `${sessionId}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
    'utf8',
  );
  // The machine is shared by every test in this file, and "no sessions" is
  // the precondition for most of them. Handing back the undo keeps that true
  // without ordering the tests by hand.
  return () => fs.rmSync(dir, { recursive: true, force: true });
}

test('a machine with no sessions is served the actors, not an empty room', async () => {
  await withDaemon(async (d) => {
    const snap = await state(d);
    assert.equal(snap.demo, true, 'an empty scan did not produce the actor floor');
    assert.equal(snap.demoNote, DEMO_NOTE);
    assert.ok(snap.agents.length > 0, 'the actor floor is empty');
    assert.ok(snap.counts.needsYou > 0, 'the numeral the first coach mark points at reads zero');
    // The registry itself is still empty — the actors never entered the model.
    assert.deepEqual(d.registry.agents, []);
  });
});

test('INVARIANT: an actor cannot be acknowledged, benched or let go', async () => {
  await withDaemon(async (d) => {
    const snap = await state(d);
    const actor = snap.agents[0].id;
    for (const action of ['acknowledge', 'bench', 'let_go']) {
      const res = await fetch(d.url + 'api/ack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: actor, action }),
      });
      assert.ok(
        res.status >= 400,
        `POST /api/ack ${action} on an actor answered ${res.status}; ` +
          'the demo floor must not be addressable',
      );
      await res.text();
    }
    // And nothing was written for it.
    const after = await state(d);
    assert.equal(after.demo, true);
    assert.equal(after.agents.find((a) => a.id === actor).ackState, 'active');
  });
});

test('the first real session replaces the whole cast, within one refresh', async () => {
  let undo = () => {};
  try {
    await withDaemon(async (d) => {
      assert.equal((await state(d)).demo, true);

      undo = writeRealSession('22222222-2222-2222-2222-222222222222');

      // One poll. `/api/refresh` is exactly the scan the poll timer runs — the
      // test drives it directly rather than sleeping through the interval.
      const refreshed = await fetch(d.url + 'api/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(refreshed.status, 200);
      await refreshed.text();

      const snap = await state(d);
      assert.notEqual(snap.demo, true, 'the actors are still on the floor');
      assert.equal(snap.agents.length, 1, 'the real session did not walk in alone');
      assert.equal(snap.agents[0].title, 'The one that walks in');
      assert.equal(snap.agents[0].projectName, 'walks-in');
      assert.ok(!snap.demoNote, 'the actors line is still under a real floor');
      // Not one actor survived into the real floor.
      assert.equal(
        snap.agents.filter((a) => String(a.id).startsWith('demo:')).length,
        0,
        'an actor leaked into a real snapshot',
      );
    });
  } finally {
    undo();
  }
});

test('the terminal surfaces report zero on an actor floor, not the actors', async () => {
  await withDaemon(async (d) => {
    const { askDaemon } = await import('../../src/cli/source.mjs');
    const found = await askDaemon(d.port, 2000);
    assert.ok(found, 'the daemon was not found');
    assert.deepEqual(found.snapshot.agents, [], '`deckhq waiting` would list actors');
    assert.equal(found.snapshot.counts.needsYou, 0, 'the status line would show a fake count');

    // `doctor` reads the same snapshot and must report the same nothing.
    const deck = deckFrom(await state(d));
    assert.equal(deck.waiting, 0);
    assert.equal(deck.total, 0);
  });
});

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
