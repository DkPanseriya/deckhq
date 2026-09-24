/**
 * `/api/studio/*` against a real daemon — WP-66, `docs/07-STUDIO-DESIGN.md`
 * §5.3 and §10.
 *
 * Three of these are acceptance criteria rather than coverage:
 *
 *   1. **`enable` without `confirm` writes nothing and returns every path it
 *      would write.** Proved by hashing the whole project tree before and
 *      after — not by checking for the one file we happen to expect, which
 *      would pass a version of this route that wrote a different one.
 *   3. **`disable` removes only tagged files and names the rest.** The board
 *      the user edited is still there afterwards, and the response says so.
 *   4. Consent is per project: enabling one leaves the other refused.
 *
 * The daemon runs against a scratch state directory, so nothing touches the
 * real `~/.deckhq` — and that matters more here than usual, because `enable`
 * records what it wrote in `installed.json`, which is the file
 * `deckhq shortcut --remove` reads and acts on.
 */
import { scratchDir } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const { startDaemon } = await import('../../src/daemon.mjs');
const { STUDIO_TAG } = await import('../../src/studio/consent.mjs');
const { projectKeyFor } = await import('../../src/core/ledger-record.mjs');

/**
 * A daemon, a state directory of its own, and two project directories.
 * @param {(ctx:{d:any, dir:string, a:string, b:string}) => Promise<void>} fn
 */
async function withDaemon(fn) {
  const dir = scratchDir('studio-');
  const publicDir = path.join(dir, 'public');
  await fsp.mkdir(publicDir, { recursive: true });
  await fsp.writeFile(path.join(publicDir, 'index.html'), 'floor');
  // The projects live OUTSIDE the state directory, which is where a real one
  // is: `isOurs()` treats anything under the state directory as DeckHQ's by
  // construction, so a test that put a project inside it would be testing a
  // machine nobody has.
  const projects = scratchDir('studio-projects-');
  const a = path.join(projects, 'orbital');
  const b = path.join(projects, 'ledger');
  for (const p of [a, b]) await fsp.mkdir(path.join(p, 'src'), { recursive: true });

  const d = await startDaemon({
    port: 0,
    stateFile: path.join(dir, 'state.json'),
    ledgerDir: path.join(dir, 'ledger'),
    publicDir,
  });
  try {
    await fn({ d, dir, a, b });
  } finally {
    await d.close();
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rm(projects, { recursive: true, force: true });
  }
}

/** POST as our own page would. */
function post(d, pathname, body) {
  return fetch(`${d.url}api/studio${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify(body),
  });
}

/** GET, parsed. */
async function get(d, pathname) {
  const res = await fetch(`${d.url}api/studio${pathname}`);
  return { status: res.status, body: await res.json() };
}

/**
 * A hash of every path and every byte under a directory, so "nothing changed"
 * is a claim about the tree and not about one file.
 * @param {string} root
 */
function treeHash(root) {
  const h = createHash('sha256');
  const walk = (dir) => {
    let entries;
    try {
      entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .sort((x, y) => x.name.localeCompare(y.name));
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      h.update(path.relative(root, full).split(path.sep).join('/'));
      if (entry.isDirectory()) walk(full);
      else h.update(fs.readFileSync(full));
    }
  };
  walk(root);
  return h.digest('hex');
}

// ---------------------------------------------------------------------------
// Enable
// ---------------------------------------------------------------------------

test('ACCEPTANCE: enable without confirm returns every path it would write, and writes none of them', async () => {
  await withDaemon(async ({ d, a }) => {
    const before = treeHash(a);

    const res = await post(d, '/enable', { cwd: a });
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.confirmed, false);
    assert.equal(body.enabled, false);
    assert.equal(body.changed, false);

    // Every path, and each with a reason beside it.
    const paths = body.paths.map((p) => p.path);
    const dir = path.join(a, '.deckhq', 'studio');
    assert.deepEqual(paths, [
      path.join(dir, 'README.md'),
      path.join(dir, 'blueprint.md'),
      path.join(dir, 'roster.json'),
      path.join(dir, 'board.json'),
      path.join(dir, 'rules.md'),
      path.join(dir, 'briefs') + path.sep,
      path.join(dir, 'handovers') + path.sep,
    ]);
    for (const entry of body.paths) assert.ok(entry.why.length > 10, entry.path);
    // Exactly one is written now; the rest are what it is asking for.
    assert.deepEqual(
      body.paths.filter((p) => p.written).map((p) => path.basename(p.path)),
      ['README.md'],
    );
    // The printed screen names the marker and says nothing runs.
    assert.ok(body.describe.includes(STUDIO_TAG));
    assert.match(body.describe, /Nothing runs/);

    // THE CRITERION.
    assert.equal(treeHash(a), before, 'describing wrote something');
    assert.equal(fs.existsSync(path.join(a, '.deckhq')), false);
  });
});

test('enable with confirm writes one tagged file, records it, and grants consent', async () => {
  await withDaemon(async ({ d, a, dir }) => {
    const res = await post(d, '/enable', { cwd: a, confirm: true });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.changed, true);
    assert.equal(body.enabled, true);

    // One file, and it carries the marker on its first line.
    const readme = path.join(a, '.deckhq', 'studio', 'README.md');
    assert.deepEqual(body.written, [readme]);
    const text = fs.readFileSync(readme, 'utf8');
    assert.ok(text.split('\n')[0].includes(STUDIO_TAG), text.split('\n')[0]);
    // And nothing else was created beside it.
    assert.deepEqual(fs.readdirSync(path.join(a, '.deckhq', 'studio')), ['README.md']);

    // state.json carries the grant, keyed by the project hash and no path...
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    const key = projectKeyFor(a);
    assert.equal(body.projectKey, key);
    assert.ok(state.studio.consent[key], 'no grant in state.json');
    assert.equal(state.studio.consent[key].root, a);
    assert.ok(state.studio.consent[key].grantedAt > 0);

    // ...and installed.json carries the path, under this project's own surface.
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'installed.json'), 'utf8'));
    const ours = record.entries.filter((e) => e.surface === `studio:${key}`);
    assert.ok(
      ours.some((e) => e.path === readme && e.proof === 'tag'),
      JSON.stringify(ours),
    );

    // Enabling twice is quiet and changes nothing.
    const again = await (await post(d, '/enable', { cwd: a, confirm: true })).json();
    assert.equal(again.already, true);
    assert.equal(again.changed, false);
  });
});

test('consent is per project and is never inferred from another', async () => {
  await withDaemon(async ({ d, a, b }) => {
    await post(d, '/enable', { cwd: a, confirm: true });

    const snapshotB = await get(d, `?project=${encodeURIComponent(b)}`);
    assert.equal(snapshotB.body.enabled, false);
    assert.equal(snapshotB.body.consent, null);

    const refused = await post(d, '/card', { cwd: b, op: 'create', card: { title: 'x' } });
    assert.equal(refused.status, 403);
    assert.match((await refused.json()).error, /not enabled/);
    assert.equal(fs.existsSync(path.join(b, '.deckhq')), false);
  });
});

test('a project directory that is relative, absent or a file is refused by name', async () => {
  await withDaemon(async ({ d, a }) => {
    for (const [cwd, pattern] of [
      ['relative/path', /not an absolute path/],
      [path.join(a, 'nope'), /does not exist/],
      [path.join(a, 'src'), null],
    ]) {
      const res = await post(d, '/enable', { cwd });
      if (pattern) {
        assert.equal(res.status, 400, cwd);
        assert.match((await res.json()).error, pattern);
      }
    }
    const file = path.join(a, 'a-file.txt');
    fs.writeFileSync(file, 'x');
    const res = await post(d, '/enable', { cwd: file });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /is not a directory/);
  });
});

// ---------------------------------------------------------------------------
// The board, and the one funnel
// ---------------------------------------------------------------------------

test('a card is created, edited and moved, and only `move` moves it', async () => {
  await withDaemon(async ({ d, a }) => {
    await post(d, '/enable', { cwd: a, confirm: true });

    const created = await (
      await post(d, '/card', {
        cwd: a,
        op: 'create',
        card: { title: 'Refund path returns the fee', acceptance: ['a failing test first'] },
      })
    ).json();
    assert.equal(created.ok, true);
    assert.equal(created.board.cards.length, 1);
    const card = created.board.cards[0];
    assert.equal(card.id, 'c1');
    assert.equal(card.column, 'backlog');

    // An edit changes the title and leaves the column alone.
    const edited = await (
      await post(d, '/card', { cwd: a, op: 'edit', cardId: 'c1', card: { title: 'Refunds' } })
    ).json();
    assert.equal(edited.board.cards[0].title, 'Refunds');
    assert.equal(edited.board.cards[0].column, 'backlog');

    // An edit that carries a column is REFUSED, not quietly ignored.
    const sneaky = await post(d, '/card', {
      cwd: a,
      op: 'edit',
      cardId: 'c1',
      card: { column: 'done' },
    });
    assert.equal(sneaky.status, 400);
    assert.match((await sneaky.json()).error, /op:"move"/);

    // The move, which is the user's press.
    const moved = await (
      await post(d, '/card', { cwd: a, op: 'move', cardId: 'c1', column: 'in_progress' })
    ).json();
    assert.equal(moved.board.cards[0].column, 'in_progress');
    assert.ok(moved.board.cards[0].updatedAt > 0);

    // A column this build cannot draw is refused with the six named.
    const bad = await post(d, '/card', { cwd: a, op: 'move', cardId: 'c1', column: 'shipped' });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /backlog, ready, in_progress, review, done, blocked/);

    // A second card gets the next id, and the file on disk is the response.
    const second = await (await post(d, '/card', { cwd: a, op: 'create', card: {} })).json();
    assert.equal(second.board.cards[1].id, 'c2');
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(a, '.deckhq', 'studio', 'board.json'), 'utf8'),
    );
    assert.deepEqual(onDisk, second.board);

    // And a card nobody has heard of is a 404, not a new card.
    const missing = await post(d, '/card', { cwd: a, op: 'move', cardId: 'c9', column: 'done' });
    assert.equal(missing.status, 404);
  });
});

test('a roster the user edited is replaced whole, and a bad one is refused with its path', async () => {
  await withDaemon(async ({ d, a }) => {
    await post(d, '/enable', { cwd: a, confirm: true });

    const ok = await post(d, '/roster', {
      cwd: a,
      roster: {
        version: 1,
        roles: [
          {
            name: 'backend',
            purpose: 'the API',
            systemPrompt: 'You are the backend.',
            allowedTools: ['Edit'],
            permissionPolicy: 'ask',
            budget: { tokens: 400000, minutes: 90 },
          },
        ],
      },
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.roster.roles[0].name, 'backend');
    assert.equal(body.roster.roles[0].agentId, null);

    const bad = await post(d, '/roster', {
      cwd: a,
      roster: { version: 1, roles: [{ name: 'backend', permissionPolicy: 'yolo' }] },
    });
    assert.equal(bad.status, 400);
    const err = await bad.json();
    assert.equal(err.path, 'roles[0].permissionPolicy');
    assert.ok(err.error.includes('ask, allowlist, plan'));
  });
});

test('GET /api/studio is one snapshot: consent, blueprint, roster, board', async () => {
  await withDaemon(async ({ d, a }) => {
    const before = await get(d, `?project=${encodeURIComponent(a)}`);
    assert.equal(before.status, 200);
    assert.equal(before.body.enabled, false);
    assert.deepEqual(before.body.columns, [
      'backlog',
      'ready',
      'in_progress',
      'review',
      'done',
      'blocked',
    ]);
    assert.equal(before.body.studio.exists, false);

    await post(d, '/enable', { cwd: a, confirm: true });
    await post(d, '/card', { cwd: a, op: 'create', card: { title: 'One' } });
    fs.writeFileSync(
      path.join(a, '.deckhq', 'studio', 'blueprint.md'),
      '# Orbital\n\nGoal: ship it.\n',
      'utf8',
    );

    const after = await get(d, `?project=${encodeURIComponent(a)}`);
    assert.equal(after.body.enabled, true);
    assert.equal(after.body.consent.root, a);
    assert.equal(after.body.studio.exists, true);
    assert.match(after.body.studio.blueprint.text, /Goal: ship it/);
    assert.equal(after.body.studio.board.board.cards.length, 1);
    assert.equal(after.body.studio.board.error, null);
  });
});

test('tracking answers "no data" and invents no number', async () => {
  await withDaemon(async ({ d, a }) => {
    await post(d, '/enable', { cwd: a, confirm: true });
    await post(d, '/card', { cwd: a, op: 'create', card: { title: 'One' } });
    const res = await get(d, `/tracking?project=${encodeURIComponent(a)}`);
    assert.equal(res.status, 200);
    // WP-71 replaced the empty shape with the fold. The card is there, and a
    // card with no ledger records, no moves and no handover reads `no data`
    // in every figure.
    assert.equal(res.body.cards.length, 1);
    assert.equal(res.body.cards[0].cardId, 'c1');
    assert.equal(res.body.cards[0].status, 'no data');
    assert.deepEqual(res.body.cards[0].tokens, { status: 'no data' });
    assert.deepEqual(res.body.milestones, []);
    // Not one number anywhere in the body — not even a zero.
    assert.equal(/[:[]\s*\d/.test(JSON.stringify(res.body)), false, JSON.stringify(res.body));
  });
});

test('nothing answers 501 any more, and §5.3’s table is whole', async () => {
  // WP-67 took `/plan` off this list, WP-68 took `/hire` and WP-70 took
  // `/handover`, which was the last one. The distinction the 501 carried is
  // still worth holding from the other side: a route that EXISTS must refuse
  // a bad request as a bad request, because 501 means "this package does not
  // exist yet" and a shipped endpoint answering it reads as missing.
  // `test/integration/studio-handover.test.mjs` is where the route is tested.
  // `/plan` and `/hire` are deliberately NOT posted here: both start a real
  // session, and a test that opened a terminal window on the machine running
  // it would be a test nobody could run twice. Their own integration files
  // drive them, through the `launchTerminal` seam.
  await withDaemon(async ({ d, a }) => {
    await post(d, '/enable', { cwd: a, confirm: true });
    const res = await post(d, '/handover', { cwd: a });
    assert.notEqual(res.status, 501, '/handover still answers 501');
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /decision is one of accept or bounce/);
  });
});

test('a Hire naming no role is refused as a bad request, not as an unbuilt one', async () => {
  // The distinction the test above used to carry for `/hire`: 501 means "this
  // package does not exist yet" and 400 means "it does, and you did not name a
  // role". Confusing the two is how a shipped endpoint reads as missing.
  await withDaemon(async ({ d, a }) => {
    await post(d, '/enable', { cwd: a, confirm: true });
    const res = await post(d, '/hire', { cwd: a, runtime: 'claude-code' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /name a role to hire/);
    assert.equal(body.max, 6);
  });
});

// ---------------------------------------------------------------------------
// Disable
// ---------------------------------------------------------------------------

test('ACCEPTANCE: disable removes only tagged files and names the rest', async () => {
  await withDaemon(async ({ d, a, dir }) => {
    await post(d, '/enable', { cwd: a, confirm: true });
    await post(d, '/card', { cwd: a, op: 'create', card: { title: 'Mine' } });
    const studio = path.join(a, '.deckhq', 'studio');
    fs.writeFileSync(path.join(studio, 'blueprint.md'), '# Mine\n', 'utf8');
    fs.mkdirSync(path.join(studio, 'handovers'), { recursive: true });
    fs.writeFileSync(path.join(studio, 'handovers', 'c1.md'), 'what changed\n', 'utf8');

    // Described first, and it changes nothing.
    const described = await (await post(d, '/disable', { cwd: a })).json();
    assert.deepEqual(described.wouldRemove, [path.join(studio, 'README.md')]);
    assert.deepEqual(described.wouldKeep, [
      path.join(studio, 'blueprint.md'),
      path.join(studio, 'board.json'),
      path.join(studio, 'handovers', 'c1.md'),
    ]);
    assert.equal(described.changed, false);
    assert.ok(fs.existsSync(path.join(studio, 'README.md')));

    const done = await (await post(d, '/disable', { cwd: a, confirm: true })).json();
    assert.deepEqual(done.removed, [path.join(studio, 'README.md')]);
    assert.deepEqual(done.foreign, []);
    assert.deepEqual(done.kept, described.wouldKeep);

    // The user's files are all still there; only the marker is gone.
    assert.equal(fs.existsSync(path.join(studio, 'README.md')), false);
    for (const kept of done.kept) assert.ok(fs.existsSync(kept), kept);

    // And the grant is gone, so a write is refused again.
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    assert.deepEqual(state.studio.consent, {});
    const refused = await post(d, '/card', { cwd: a, op: 'create', card: {} });
    assert.equal(refused.status, 403);
  });
});

test('a README somebody else wrote is refused, never replaced, and is left alone by disable', async () => {
  await withDaemon(async ({ d, a }) => {
    const studio = path.join(a, '.deckhq', 'studio');
    fs.mkdirSync(studio, { recursive: true });
    fs.writeFileSync(path.join(studio, 'README.md'), '# not ours\n', 'utf8');

    const res = await post(d, '/enable', { cwd: a, confirm: true });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /already exists and was not written by DeckHQ/);
    assert.equal(fs.readFileSync(path.join(studio, 'README.md'), 'utf8'), '# not ours\n');
  });
});

// ---------------------------------------------------------------------------
// The guards every other route stands behind
// ---------------------------------------------------------------------------

test('a cross-site POST is refused before it reaches the route', async () => {
  await withDaemon(async ({ d, a }) => {
    const res = await fetch(`${d.url}api/studio/enable`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example',
        connection: 'close',
      },
      body: JSON.stringify({ cwd: a, confirm: true }),
    });
    assert.equal(res.status, 403);
    assert.equal(fs.existsSync(path.join(a, '.deckhq')), false);
  });
});
