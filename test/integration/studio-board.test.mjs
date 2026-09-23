/**
 * THE COLUMN IS USER-OWNED — WP-69, `docs/07-STUDIO-DESIGN.md` §5.2 and §9.1.
 *
 * §5.2, in the spec's own words: *"An observed event may flag a card and may
 * never move it. A session ending, a test passing, a file appearing, a budget
 * being spent: each writes `flags` and nothing else. A column changes on
 * exactly two things — the user dragging or pressing, or a handover the user
 * has accepted."*
 *
 * `test/unit/studio-invariant.test.mjs` holds the STATIC half of that: it
 * greps the source and fails on a second writer of `column`. This is the
 * behavioural half, and it is WP-69's second acceptance criterion:
 *
 *   **a session ending, a hook arriving and a scan completing move no card.**
 *
 * The assertion is over BYTES, not over columns. A test that re-read the board
 * and compared the column of each card would pass a daemon that rewrote the
 * file with the same columns and a different `updatedAt`, different key order
 * or a stripped flag — and a board the user edited being silently rewritten is
 * the same defect wearing a different hat. So the file is hashed before the
 * three events and hashed after them, and nothing about it may have changed.
 *
 * The three events are made to HAPPEN rather than simulated:
 *
 *   - a session arrives on the floor because a real transcript is planted in
 *     the isolated home and the ordinary scan finds it;
 *   - it ENDS because the transcript is deleted and the next scan does not;
 *   - a hook arrives through `POST /api/hook`, the route the installed hook
 *     block posts to, in all four of its shapes — `SessionEnd` included, which
 *     is the one an auto-advancing board would have been tempted by.
 *
 * And one positive control at the end: the user's own `op:'move'` DOES change
 * the file. Without it this whole test would pass against a daemon that could
 * not write the board at all.
 */
import { daemonScratch, scratchDir, writeClaudeSession } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const { startDaemon } = await import('../../src/daemon.mjs');
const { projectKeyFor } = await import('../../src/core/ledger-record.mjs');
const { COLUMNS } = await import('../../src/studio/schema.mjs');

/** Eight cards, one in every column and two spare, so a slip anywhere shows. */
function boardFor(projectKey) {
  const card = (n, column, extra = {}) => ({
    id: `c${n}`,
    title: `card ${n}`,
    acceptance: ['a failing test first'],
    milestone: 'm1',
    role: 'backend',
    column,
    budget: { tokens: 400000, minutes: 90 },
    agentId: null,
    worktree: null,
    handover: null,
    flags: [],
    updatedAt: 100 + n,
    ...extra,
  });
  return {
    version: 1,
    projectKey,
    cards: [
      ...COLUMNS.map((column, i) => card(i + 1, column)),
      card(7, 'in_progress'),
      card(8, 'ready'),
    ],
  };
}

const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * A daemon over a scratch state directory, with Studio enabled on a project
 * and a board already on disk.
 *
 * Enabled through the ROUTE rather than by writing the consent record by hand:
 * a grant this test invented would be a grant the product does not issue, and
 * the point of the fixture is that everything after it is the real thing.
 *
 * @param {(ctx:{d:any, project:string, boardFile:string}) => Promise<void>} fn
 */
async function withBoard(fn) {
  const { dir, stateFile, publicDir } = daemonScratch('studio-board-');
  const projects = scratchDir('studio-board-projects-');
  const project = path.join(projects, 'orbital');
  await fsp.mkdir(path.join(project, 'src'), { recursive: true });

  const d = await startDaemon({
    port: 0,
    stateFile,
    publicDir,
    ledgerDir: path.join(dir, 'ledger'),
  });
  try {
    const enabled = await fetch(`${d.url}api/studio/enable`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ cwd: project, confirm: true }),
    });
    assert.equal(enabled.status, 200, await enabled.text());

    const boardFile = path.join(project, '.deckhq', 'studio', 'board.json');
    await fsp.mkdir(path.dirname(boardFile), { recursive: true });
    await fsp.writeFile(
      boardFile,
      `${JSON.stringify(boardFor(projectKeyFor(project)), null, 2)}\n`,
      'utf8',
    );

    await fn({ d, project, boardFile });
  } finally {
    await d.close();
    for (const victim of [dir, projects]) {
      await fsp.rm(victim, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }
}

test('INVARIANT: a session ending, a hook arriving and a scan completing move no card', async () => {
  await withBoard(async ({ d, project, boardFile }) => {
    const before = hash(boardFile);
    const stat = fs.statSync(boardFile);

    // --- a session, found by the ordinary scan, in the project itself -------
    const planted = writeClaudeSession({
      sessionId: '69696969-6969-4969-a969-696969696969',
      title: 'Working the board',
      cwd: project,
    });
    // Whether the plant reached the floor is not asserted as a precondition:
    // a host where the scan cannot see it still runs the other two events,
    // and the hash below is the claim either way.
    await d.registry.refresh();

    // --- every hook shape, including the one about a session ending --------
    for (const hook_event_name of [
      'PreToolUse',
      'PostToolUse',
      'Notification',
      'Stop',
      'SessionEnd',
    ]) {
      const res = await fetch(`${d.url}api/hook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', connection: 'close' },
        body: JSON.stringify({
          session_id: '69696969-6969-4969-a969-696969696969',
          cwd: project,
          hook_event_name,
          tool_name: 'Bash',
          tool_input: { command: 'npm test' },
        }),
      });
      assert.ok(res.status < 500, `${hook_event_name} answered ${res.status}`);
      await res.arrayBuffer();
    }

    // --- the session ends, and two more scans complete over its absence ----
    planted.remove();
    await d.registry.refresh();
    await d.registry.refresh();

    // The board is served by `GET /api/studio` too, and READING must not write.
    const snap = await (
      await fetch(`${d.url}api/studio?project=${encodeURIComponent(project)}`)
    ).json();
    assert.equal(snap.enabled, true);
    assert.equal(snap.studio.board.board.cards.length, 8, 'the board the daemon reads back');

    // The listener a scan chains behind it runs after the refresh returns, so
    // give it a turn before the file is read. A yield, not a wait: nothing
    // here is timing-dependent unless the invariant is already broken.
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(hash(boardFile), before, 'board.json changed, byte for byte');
    assert.equal(fs.statSync(boardFile).mtimeMs, stat.mtimeMs, 'board.json was rewritten');
  });
});

test('the control: the user’s own move DOES write the board', async () => {
  await withBoard(async ({ d, project, boardFile }) => {
    const before = hash(boardFile);
    const res = await fetch(`${d.url}api/studio/card`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ cwd: project, op: 'move', cardId: 'c1', column: 'ready' }),
    });
    assert.equal(res.status, 200, await res.text());
    assert.notEqual(hash(boardFile), before, 'a move that changed nothing is not a move');

    const after = JSON.parse(fs.readFileSync(boardFile, 'utf8'));
    assert.equal(after.cards.find((c) => c.id === 'c1').column, 'ready');
    // And it moved ONE card. A writer that rewrote every column would pass the
    // line above and fail this one.
    assert.deepEqual(
      after.cards.filter((c) => c.id !== 'c1').map((c) => c.column),
      boardFor(projectKeyFor(project))
        .cards.filter((c) => c.id !== 'c1')
        .map((c) => c.column),
    );
  });
});

test('an edit that carries a column is refused, with the verb named (§150.2)', async () => {
  await withBoard(async ({ d, project, boardFile }) => {
    const before = hash(boardFile);
    const res = await fetch(`${d.url}api/studio/card`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({
        cwd: project,
        op: 'edit',
        cardId: 'c1',
        card: { title: 'renamed', column: 'done' },
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /move/i, 'the refusal names the verb that does move a column');
    assert.equal(hash(boardFile), before, 'a refused edit wrote something');
  });
});
