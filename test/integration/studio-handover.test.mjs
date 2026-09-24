/**
 * THE WATCH, AND THE GATE — WP-70, `docs/07-STUDIO-DESIGN.md` §6, §5.2, §10.
 *
 * WP-70's four acceptance criteria, each against a real daemon, a real
 * project directory and a real file written by something that is not DeckHQ:
 *
 *   (1) a handover file raises the review within one watch event and MOVES NO
 *       CARD — asserted as an `INVARIANT:`, over the columns compared by hash
 *       rather than one at a time, because a board that came back with the
 *       same columns in a different order would pass a card-by-card read;
 *   (2) Accept is the only path from a handover to a column change, and it
 *       moves the card to the column the USER named and changes nothing else;
 *   (3) a handover for an unknown card id is `unattached` in the snapshot,
 *       not dropped;
 *   (4) the test counts come back as a quotation attributed to the handover
 *       (the copy itself is `test/unit/studio-handover.test.mjs`).
 *
 * And the gate's refusals: no consent, an unknown card, a decision this route
 * does not have, a column Accept may not name, and a bounce with no note.
 *
 * The watch is given a 40 ms debounce and a 120 ms poll through the daemon's
 * own `studioWatchOptions` seam — the production numbers are 150 ms and one
 * second, and a test that waited on those would be a test somebody skips. The
 * FILE is real, the write is a real `fs.writeFile`, and nothing here calls the
 * watcher directly.
 */
import { daemonScratch, scratchDir } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const { startDaemon } = await import('../../src/daemon.mjs');
const { projectKeyFor } = await import('../../src/core/ledger-record.mjs');

const HANDOVER = [
  '# Handover for c1',
  '',
  '## What changed',
  '',
  'The watcher, and the two presses under it.',
  '',
  '## Tests run',
  '',
  'npm test — 43 passed',
  '',
  '## Next step',
  '',
  'Bake the golden.',
  '',
].join('\n');

/** The columns, and only the columns, as one digest. */
function columnHash(file) {
  const board = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = board.cards.map((c) => `${c.id}=${c.column}`).join('|');
  return createHash('sha256').update(rows).digest('hex');
}

function boardFor(projectKey) {
  const card = (id, column, extra = {}) => ({
    id,
    title: `card ${id}`,
    acceptance: ['a failing test first'],
    milestone: 'm1',
    role: 'backend',
    column,
    budget: null,
    agentId: null,
    worktree: null,
    handover: null,
    flags: [],
    updatedAt: 100,
    ...extra,
  });
  return {
    version: 1,
    projectKey,
    cards: [card('c1', 'in_progress'), card('c2', 'ready'), card('c3', 'backlog')],
  };
}

/**
 * A daemon over a scratch state directory, Studio enabled on a real project
 * through the ROUTE, and a board on disk.
 *
 * @param {(ctx:{d:any, project:string, boardFile:string, handovers:string}) => Promise<void>} fn
 */
async function withStudio(fn) {
  const { dir, stateFile, publicDir } = daemonScratch('studio-handover-');
  const projects = scratchDir('studio-handover-projects-');
  const project = path.join(projects, 'orbital');
  await fsp.mkdir(path.join(project, 'src'), { recursive: true });

  const d = await startDaemon({
    port: 0,
    stateFile,
    publicDir,
    ledgerDir: path.join(dir, 'ledger'),
    studioWatchOptions: { debounceMs: 40, pollMs: 120 },
  });
  try {
    const enabled = await fetch(`${d.url}api/studio/enable`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ cwd: project, confirm: true }),
    });
    assert.equal(enabled.status, 200, await enabled.text());

    const boardFile = path.join(project, '.deckhq', 'studio', 'board.json');
    await fsp.writeFile(
      boardFile,
      `${JSON.stringify(boardFor(projectKeyFor(project)), null, 2)}\n`,
      'utf8',
    );
    await fn({
      d,
      project,
      boardFile,
      handovers: path.join(project, '.deckhq', 'studio', 'handovers'),
    });
  } finally {
    await d.close();
    for (const victim of [dir, projects]) {
      await fsp.rm(victim, { recursive: true, force: true, maxRetries: 10, retryDelay: 60 });
    }
  }
}

/**
 * Write a handover the way an agent does: `mkdir -p` and then the file.
 *
 * `enable` does NOT create `handovers/` — it writes one tagged `README.md` and
 * nothing else (§150.2 item 3) — so the directory appears for the first time
 * when the first agent writes into it. That is the path this exercises: the
 * watch is started at `enable`, over a directory that does not exist, and it
 * has to come alive when one does.
 */
async function writeHandover(dir, name, text) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, name), text, 'utf8');
}

// `connection: close` on every request in this file, including the reads.
// `until()` below makes one GET every 60 ms while it waits, and undici pools
// its sockets: a keep-alive connection left open is a connection `d.close()`
// then waits for, and this file would spend minutes in teardown rather than
// milliseconds. The POSTs in the rest of `test/integration/` carry the same
// header for the same reason.
const snapshotOf = async (d, project) =>
  (
    await fetch(`${d.url}api/studio?project=${encodeURIComponent(project)}`, {
      headers: { connection: 'close' },
    })
  ).json();

const decide = (d, body) =>
  fetch(`${d.url}api/studio/handover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify(body),
  });

/**
 * Wait for a predicate over `board.json` ITSELF, or give up.
 *
 * The disk rather than the daemon, deliberately. What is being waited for is
 * a filesystem event reaching a file write, and polling `GET /api/studio` to
 * find out would put a hundred HTTP round trips inside the thing being timed
 * — which is how this file first took six minutes to run. One read of one
 * small file every 50 ms costs nothing, and every call site takes the
 * SNAPSHOT afterwards and asserts against that, so the route is still what is
 * checked.
 *
 * @param {string} boardFile
 * @param {(board:any) => boolean} ready
 */
async function untilBoard(boardFile, ready, ms = 8000) {
  const stop = Date.now() + ms;
  for (;;) {
    let board = null;
    try {
      board = JSON.parse(fs.readFileSync(boardFile, 'utf8'));
    } catch {
      board = null;
    }
    if (board && ready(board)) return board;
    if (Date.now() >= stop) return board;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** The same wait, for a handover that attaches to no card and writes nothing. */
async function untilFile(file, ms = 8000) {
  const stop = Date.now() + ms;
  while (!fs.existsSync(file) && Date.now() < stop) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** A card has a handover flag. */
const flagged = (board, id) =>
  (board.cards.find((c) => c.id === id)?.flags || []).some((f) => f.kind === 'handover');

// ---------------------------------------------------------------------------

test('INVARIANT: a handover raises the review and moves no card', async () => {
  await withStudio(async ({ d, project, boardFile, handovers }) => {
    const before = columnHash(boardFile);

    // A real file, written by something that is not DeckHQ — which is what an
    // agent is — into the directory §6 names.
    await writeHandover(handovers, 'c1.md', HANDOVER);

    await untilBoard(boardFile, (b) => flagged(b, 'c1'));
    const snap = await snapshotOf(d, project);

    // (1) The card is FLAGGED …
    const c1 = snap.studio.board.board.cards.find((c) => c.id === 'c1');
    const flag = (c1.flags || []).find((f) => f.kind === 'handover');
    assert.ok(flag, `no handover flag arrived: ${JSON.stringify(c1)}`);
    assert.equal(flag.path, path.join(handovers, 'c1.md'));
    assert.ok(flag.at > 0, 'the flag carries when the file was written');
    assert.equal(c1.handover, 'c1.md', 'the card points at the file the next brief will read');

    // … and NOT MOVED. The columns, all three of them, by hash.
    assert.equal(columnHash(boardFile), before, 'a handover moved a card');
    assert.equal(c1.column, 'in_progress');

    // (4) The counts come back as a quotation, never as a figure.
    const mine = snap.handovers.find((h) => h.cardId === 'c1');
    assert.ok(mine, 'the handover is in the snapshot');
    assert.equal(mine.quote, 'the handover says npm test — 43 passed');
    assert.deepEqual(mine.missing, ['Open questions'], 'the missing section is named');
    assert.equal(mine.sections.questions, null, 'and is not invented');
    assert.match(mine.sections.changed, /the two presses/);

    // A second, IDENTICAL tick leaves one flag. The watch reports every file
    // on its first pass, so this is the shape a restart takes.
    await fsp.utimes(path.join(handovers, 'c1.md'), new Date(), new Date());
    await new Promise((r) => setTimeout(r, 400));
    const again = await snapshotOf(d, project);
    const flags = again.studio.board.board.cards.find((c) => c.id === 'c1').flags;
    assert.ok(flags.length <= 2, `a touch left ${flags.length} flags`);
    assert.equal(columnHash(boardFile), before, 'a second tick moved a card');
  });
});

test('a handover naming no card is unattached, not dropped (§6)', async () => {
  await withStudio(async ({ d, project, boardFile, handovers }) => {
    const before = columnHash(boardFile);
    await writeHandover(handovers, 'c99.md', HANDOVER);

    // Nothing is written for an unattached handover, so the wait is on the
    // file the TEST wrote being visible to the daemon: one snapshot, taken
    // after a watch tick has had time to happen.
    await untilFile(path.join(handovers, 'c99.md'));
    await new Promise((r) => setTimeout(r, 400));
    const snap = await snapshotOf(d, project);
    const orphan = (snap.handovers || []).find((h) => h.path.endsWith('c99.md'));
    assert.ok(orphan, 'the file was dropped rather than shown');
    assert.equal(orphan.cardId, null, 'unattached is `cardId: null`, and the file is still read');
    assert.match(orphan.sections.changed, /the two presses/);

    // Nothing on the board was touched — no card invented, no column moved.
    assert.equal(snap.studio.board.board.cards.length, 3);
    assert.equal(columnHash(boardFile), before);
    for (const card of snap.studio.board.board.cards) assert.deepEqual(card.flags, []);
  });
});

test('ACCEPTANCE: Accept moves the card to the column the user named, and nothing else changes', async () => {
  await withStudio(async ({ d, project, boardFile, handovers }) => {
    await writeHandover(handovers, 'c1.md', HANDOVER);
    await untilBoard(boardFile, (b) => flagged(b, 'c1'));
    const before = JSON.parse(fs.readFileSync(boardFile, 'utf8'));

    const res = await decide(d, { cwd: project, cardId: 'c1', decision: 'accept', column: 'done' });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.moved, true);

    const after = JSON.parse(fs.readFileSync(boardFile, 'utf8'));
    const [was, now] = [before, after].map((b) => b.cards.find((c) => c.id === 'c1'));
    assert.equal(now.column, 'done', 'the column the USER named');
    assert.equal(was.column, 'in_progress');

    // And nothing else. Every other field of that card, and every other card,
    // byte for byte — `updatedAt` excepted, which is what a move stamps.
    assert.deepEqual(
      { ...now, column: null, updatedAt: 0 },
      { ...was, column: null, updatedAt: 0 },
      'Accept changed something other than the column',
    );
    assert.deepEqual(
      after.cards.filter((c) => c.id !== 'c1'),
      before.cards.filter((c) => c.id !== 'c1'),
      'Accept touched another card',
    );
    assert.equal(
      (now.flags || []).some((f) => f.kind === 'handover'),
      true,
      'the flag is kept: the handover still happened',
    );
  });
});

test('ACCEPTANCE: Bounce leaves the card where it is, and the note joins the next brief', async () => {
  await withStudio(async ({ d, project, boardFile, handovers }) => {
    await writeHandover(handovers, 'c1.md', HANDOVER);
    await untilBoard(boardFile, (b) => flagged(b, 'c1'));
    const before = columnHash(boardFile);

    const note = 'The tests section quotes a count nobody ran. Run them and say what you saw.';
    const res = await decide(d, { cwd: project, cardId: 'c1', decision: 'bounce', note });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.moved, false);

    // The card stays exactly where it was …
    assert.equal(columnHash(boardFile), before, 'a bounce moved a card');
    const card = JSON.parse(fs.readFileSync(boardFile, 'utf8')).cards.find((c) => c.id === 'c1');
    assert.equal(card.column, 'in_progress');
    // … and the note is ON it, as a flag the board can draw.
    const flag = (card.flags || []).find((f) => f.kind === 'bounce');
    assert.ok(flag, 'the bounce is not on the card');
    assert.equal(flag.text, note);

    // And it is a FILE, in the place §6.1's brief reads it from.
    const noteFile = path.join(handovers, 'c1.bounce.md');
    assert.equal(fs.existsSync(noteFile), true, body.note);
    assert.match(fs.readFileSync(noteFile, 'utf8'), /quotes a count nobody ran/);

    // The next brief, rendered from the real store, carries it.
    const { StudioStore } = await import('../../src/studio/store.mjs');
    const { roleBriefText } = await import('../../src/studio/brief-role.mjs');
    const brief = roleBriefText(new StudioStore(project), { name: 'backend' }, { card });
    assert.match(brief, /This card was bounced back/);
    assert.ok(brief.includes(note), 'the bounce note is not in the next brief');
    // And so does the handover it bounced, which is the other half of §6.1's
    // third part.
    assert.ok(brief.includes('Bake the golden.'), 'the handover is not in the next brief');
    // The instruction is there too, so the role knows how to answer.
    assert.match(brief, /handovers[\\/]<cardId>\.md/);
  });
});

test('the gate refuses what it cannot answer, and refuses it without writing', async () => {
  await withStudio(async ({ d, project, boardFile, handovers }) => {
    await writeHandover(handovers, 'c1.md', HANDOVER);
    await untilBoard(boardFile, (b) => flagged(b, 'c1'));
    const before = fs.readFileSync(boardFile, 'utf8');

    /** @type {Array<[any, number, RegExp]>} */
    const cases = [
      [{ cwd: project, cardId: 'c1' }, 400, /decision is one of accept or bounce/],
      [{ cwd: project, cardId: 'c1', decision: 'maybe' }, 400, /accept or bounce/],
      [{ cwd: project, cardId: 'c9', decision: 'accept', column: 'done' }, 404, /no card called/],
      [
        { cwd: project, cardId: 'c1', decision: 'accept', column: 'blocked' },
        400,
        /Accept moves a card to review or done/,
      ],
      [
        { cwd: project, cardId: 'c1', decision: 'accept', column: 'in_progress' },
        400,
        /Accept moves a card to review or done/,
      ],
      [{ cwd: project, cardId: 'c1', decision: 'accept' }, 400, /Accept moves a card to/],
      [{ cwd: project, cardId: 'c1', decision: 'bounce' }, 400, /a bounce carries a note/],
      [{ cwd: project, cardId: 'c1', decision: 'bounce', note: '   ' }, 400, /carries a note/],
      [{ decision: 'accept', column: 'done', cardId: 'c1' }, 400, /project directory is required/],
    ];
    for (const [payload, status, message] of cases) {
      const res = await decide(d, payload);
      assert.equal(res.status, status, `${JSON.stringify(payload)} → ${res.status}`);
      const body = await res.json();
      assert.match(body.error, message);
    }
    assert.equal(fs.readFileSync(boardFile, 'utf8'), before, 'a refusal wrote the board');
  });
});

test('a project with no grant is refused, and is not watched', async () => {
  await withStudio(async ({ d }) => {
    const other = scratchDir('studio-handover-nogrant-');
    try {
      const res = await decide(d, {
        cwd: other,
        cardId: 'c1',
        decision: 'accept',
        column: 'done',
      });
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.match(body.error, /Studio is not enabled for/);
      // Consent is per project and is never inferred from another — the
      // directory this daemon DOES have a grant for is not a grant for this one.
      assert.match(body.error, /never inferred from another/);
      assert.equal(fs.existsSync(path.join(other, '.deckhq')), false, 'a refusal made a directory');
    } finally {
      await fsp.rm(other, { recursive: true, force: true, maxRetries: 10, retryDelay: 60 });
    }
  });
});
