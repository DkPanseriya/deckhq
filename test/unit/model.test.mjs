import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentId,
  clampText,
  counts,
  needsYou,
  placement,
  projectIdFromCwd,
  projectNameFromCwd,
  projects,
  splitAgentId,
} from '../../src/core/model.mjs';

/** @param {Partial<import('../../src/core/model.mjs').Agent>} over */
function agent(over = {}) {
  return {
    id: 'claude-code:x',
    runtime: 'claude-code',
    title: 't',
    hasCustomTitle: false,
    projectId: 'p',
    projectName: 'p',
    cwd: 'C:/p',
    gitBranch: null,
    model: null,
    live: false,
    activityState: 'ended',
    ackState: 'active',
    reviewSince: null,
    needsInputSince: null,
    lastOutputAt: null,
    lastActivityAt: 0,
    tokens: 0,
    cacheTokens: 0,
    costEstimate: 0,
    lastRole: null,
    lastText: '',
    ...over,
  };
}

test('placement: user-owned states outrank observed ones', () => {
  // let_go and benched win over anything observed.
  // Let-go agents now have a room of their own (the departures room) rather
  // than vanishing from the floor. `let_go` still outranks every observed
  // state — an archived session does not queue for review.
  assert.equal(placement(agent({ ackState: 'let_go', activityState: 'for_review' })), 'let_go');
  assert.equal(placement(agent({ ackState: 'benched', activityState: 'for_review' })), 'lounge');
  assert.equal(placement(agent({ ackState: 'active', activityState: 'for_review' })), 'office');
});

test('placement: a dead session still sits at its project desk', () => {
  // docs/01-PRODUCT.md §4.1 — only an explicit bench moves it to the lounge.
  assert.equal(placement(agent({ live: false, activityState: 'ended' })), 'desk');
  assert.equal(placement(agent({ activityState: 'needs_input' })), 'desk');
  assert.equal(placement(agent({ activityState: 'stalled' })), 'desk');
  assert.equal(placement(agent({ activityState: 'working' })), 'desk');
});

test('needsYou counts only active agents in the three attention states', () => {
  assert.equal(needsYou(agent({ activityState: 'needs_input' })), true);
  assert.equal(needsYou(agent({ activityState: 'stalled' })), true);
  assert.equal(needsYou(agent({ activityState: 'for_review' })), true);
  assert.equal(needsYou(agent({ activityState: 'working' })), false);
  assert.equal(needsYou(agent({ activityState: 'ended' })), false);
  // Benched or let go never counts, whatever the runtime thinks.
  assert.equal(needsYou(agent({ activityState: 'for_review', ackState: 'benched' })), false);
  assert.equal(needsYou(agent({ activityState: 'for_review', ackState: 'let_go' })), false);
});

test('counts gives the three-way header breakdown', () => {
  const c = counts([
    agent({ id: 'a', activityState: 'needs_input' }),
    agent({ id: 'b', activityState: 'stalled' }),
    agent({ id: 'c', activityState: 'for_review' }),
    agent({ id: 'd', activityState: 'for_review' }),
    agent({ id: 'e', activityState: 'working' }),
    agent({ id: 'f', ackState: 'benched' }),
    agent({ id: 'g', ackState: 'let_go', activityState: 'for_review' }),
  ]);
  assert.equal(c.handsUp, 1);
  assert.equal(c.stalled, 1);
  assert.equal(c.forReview, 2);
  assert.equal(c.needsYou, 4);
  assert.equal(c.benched, 1);
  assert.equal(c.letGo, 1);
  assert.equal(c.working, 1);
  assert.equal(c.total, 7);
  // needs_input, stalled and working all sit at a desk; for_review is in the office.
  assert.equal(c.atDesk, 3);
});

test('counts.drawn describes the floor, and counts still describes the deck', () => {
  // WP-55. `atDesk` is every session whose placement is a desk, which is what
  // the deck and the CLI mean by it. `drawn.atDesk` is the ones the FLOOR puts
  // at a desk — a project with nobody active in it has no room, so the finished
  // sessions sitting in it are not drawn anywhere and are counted as
  // `drawn.finished` instead. They are still in `total`, still in the panel,
  // still in the deck.
  const list = [
    // `busy` has somebody working, so it gets a room and its finished session
    // is drawn at a desk in it.
    agent({ id: 'a', projectId: 'busy', activityState: 'working' }),
    agent({ id: 'b', projectId: 'busy', activityState: 'ended' }),
    // `quiet` has only finished sessions: a directory line, no room, nobody
    // drawn.
    agent({ id: 'c', projectId: 'quiet', activityState: 'ended' }),
    agent({ id: 'd', projectId: 'quiet', activityState: 'ended' }),
    // Waiting in the office — drawn, but not at a desk. Its project keeps a
    // room while it queues, which is why it is not in `quiet`.
    agent({ id: 'e', projectId: 'queued', activityState: 'for_review' }),
  ];
  const c = counts(list, { now: 1_000_000_000_000, goneHomeDays: 7 });
  assert.equal(c.atDesk, 4, 'the deck still counts every session at a desk');
  assert.equal(c.drawn.atDesk, 2, 'the floor draws two of them at a desk');
  assert.equal(c.drawn.finished, 2, 'and names the two it does not draw');
  assert.equal(c.drawn.waiting, 1);
  assert.equal(c.drawn.atDesk + c.drawn.finished, c.atDesk, 'every desk session is accounted for');
});

test('counts.drawn splits the benched by the gone-home window', () => {
  const NOW = 1_800_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;
  const benched = (id, ageDays) =>
    agent({ id, ackState: 'benched', lastActivityAt: NOW - ageDays * DAY });
  const list = [benched('a', 1), benched('b', 30), benched('c', 30), { ...benched('d', 30) }];
  list[3].lastActivityAt = 0; // nobody can date it, so the floor draws it

  const c = counts(list, { now: NOW, goneHomeDays: 7 });
  assert.equal(c.benched, 4, 'the deck counts every benched session');
  assert.equal(c.drawn.benched, 2, 'the lounge draws the recent one and the undateable one');
  assert.equal(c.drawn.wentHome, 2);
  assert.equal(c.drawn.benched + c.drawn.wentHome, c.benched);

  // A window of zero turns the filter off rather than sending everybody home,
  // the same refusal `plan.js` makes.
  const off = counts(list, { now: NOW, goneHomeDays: 0 });
  assert.equal(off.drawn.wentHome, 0);
  assert.equal(off.drawn.benched, 4);
  // And nothing wrote to anybody's ackState.
  for (const a of list) assert.equal(a.ackState, 'benched');
});

test('project slugs are stable across separators and case', () => {
  const a = projectIdFromCwd('C:\\Dk\\Projects\\1_Project_DeckHQ');
  const b = projectIdFromCwd('c:/dk/projects/1_project_deckhq/');
  assert.equal(a, b);
  assert.equal(projectIdFromCwd(''), 'unknown');
  assert.equal(projectNameFromCwd('C:\\Dk\\Projects\\1_Project_DeckHQ'), '1_Project_DeckHQ');
  assert.equal(projectNameFromCwd('/home/me/career-ops/'), 'career-ops');
});

test('projects groups and sorts, and excludes let_go from sizing', () => {
  const list = projects([
    agent({ id: '1', projectId: 'a', projectName: 'a', tokens: 10 }),
    agent({ id: '2', projectId: 'a', projectName: 'a', tokens: 5, activityState: 'for_review' }),
    agent({ id: '3', projectId: 'a', projectName: 'a', ackState: 'let_go' }),
    agent({ id: '4', projectId: 'b', projectName: 'b' }),
  ]);
  const a = list.find((p) => p.id === 'a');
  assert.equal(a.sessionCount, 2, 'let_go must not size the room');
  assert.equal(a.agentIds.length, 3);
  assert.equal(a.tokens, 15);
  assert.equal(a.needsYou, 1);
  assert.equal(list[0].id, 'a', 'largest project first');
});

test('agent ids round-trip through the runtime prefix', () => {
  const id = agentId('claude-code', 'fd61ff58-6d65-4edc-9c77-1cd4efbf80a4');
  assert.equal(id, 'claude-code:fd61ff58-6d65-4edc-9c77-1cd4efbf80a4');
  assert.deepEqual(splitAgentId(id), {
    runtime: 'claude-code',
    sessionId: 'fd61ff58-6d65-4edc-9c77-1cd4efbf80a4',
  });
  // A session id containing a colon must not be truncated.
  assert.deepEqual(splitAgentId('codex:a:b'), { runtime: 'codex', sessionId: 'a:b' });
});

test('clampText collapses whitespace and truncates at 400', () => {
  assert.equal(clampText('  a\n\n b  '), 'a b');
  const long = clampText('x'.repeat(600));
  assert.equal(long.length, 400);
  assert.ok(long.endsWith('…'));
});

// `estimateCost` and the rate card left this file at WP-26: they read
// `src/data/rates.json` and the user's override, and this module promises no
// I/O. Their tests live in `test/unit/rates.test.mjs`.

test('a project sums only the sessions the rate card could price', () => {
  const [p] = projects([
    agent({ id: 'a', projectId: 'p', costEstimate: 1.5 }),
    agent({ id: 'b', projectId: 'p', costEstimate: null }),
  ]);
  assert.equal(p.costEstimate, 1.5);
  assert.equal(p.costRated, true, 'one priced session is enough to have a rate');
});

test('a project nobody could price is flagged unrated rather than zero', () => {
  const [p] = projects([
    agent({ id: 'a', projectId: 'p', costEstimate: null }),
    agent({ id: 'b', projectId: 'p', costEstimate: null }),
  ]);
  assert.equal(p.costEstimate, 0);
  assert.equal(p.costRated, false, '"no rate" and "$0.00" are different claims');
});

// ----------------------------------------- WP-22: one rule, on one side only

/**
 * `public/floor-rule.js` is imported by `src/core/model.mjs` AND served to the
 * browser as a static file. That is only safe while it stays pure, and only
 * useful while it stays the only copy. Both are asserted here rather than left
 * to the comment at the top of it (`docs/DEVIATIONS.md` §122).
 */
test('the shared floor rule is pure enough to live on both sides of the boundary', async () => {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const file = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'public',
    'floor-rule.js',
  );
  const src = await readFile(file, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // No Node: it is fetched by a browser over HTTP.
  assert.doesNotMatch(code, /from '(node:|\.\.\/src)/, 'the browser cannot resolve that');
  assert.doesNotMatch(code, /\bprocess\.|\bBuffer\b|require\(/, 'no Node globals');
  // No DOM: it is imported by the daemon, which has none.
  assert.doesNotMatch(code, /\bdocument\.|\bwindow\.|localStorage/, 'no DOM');
  // No top-level side effect: both sides load it for the functions alone.
  assert.doesNotMatch(code, /^[a-z].*\(\);$/m, 'a bare call at module scope');
  // No import of its own at all, so it can never pull either side into the
  // other by accident.
  assert.doesNotMatch(code, /^import /m, 'the shared rule imports nothing');
});

test('placement() and derivePlacement() are the same function, not two copies', async () => {
  const agents = await import('../../public/render/agents.js');
  const rule = await import('../../public/floor-rule.js');
  assert.equal(agents.derivePlacement, placement, 'the renderer got a copy again');
  assert.equal(rule.placement, placement, 'the core got a copy again');

  // And the rule itself is stated once. Before WP-22 this literal appeared in
  // `src/core/model.mjs` and in `public/render/plan.js`, with a comment in each
  // asking the next person not to let them drift.
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  for (const rel of ['src/core/model.mjs', 'public/render/plan.js']) {
    const src = await readFile(path.join(root, rel), 'utf8');
    assert.doesNotMatch(
      src,
      /\['working', 'needs_input', 'stalled', 'for_review'\]/,
      `${rel} carries a second copy of the on-the-floor set`,
    );
  }
});

test('WP-22: no split module is over 900 lines', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const root = path.join(repo, 'public');

  // [directory, filename prefix, how many modules that split produced].
  // The WP-22 follow-up added the last groups; the ceiling itself, 900, has
  // not moved.
  const groups = [
    [path.join(root, 'render'), 'plan', 7],
    [root, 'app', 11],
    [root, 'panel', 14],
    [path.join(root, 'render'), 'scene', 9],
    [path.join(root, 'render'), 'rig', 7],
    [path.join(repo, 'src', 'core'), 'ledger', 7],
    [path.join(root, 'render'), 'backdrop', 6],
    [path.join(root, 'render'), 'agents', 5],
  ];
  let checked = 0;
  for (const [dir, prefix, min] of groups) {
    const files = (await readdir(dir)).filter(
      (f) => f.startsWith(prefix) && /\.m?js$/.test(f) && !f.endsWith('.test.mjs'),
    );
    assert.ok(
      files.length >= min,
      `${dir}/${prefix}* did not split into the modules it should have`,
    );
    for (const f of files) {
      const lines = (await readFile(path.join(dir, f), 'utf8')).split('\n').length;
      assert.ok(lines <= 900, `${f} is ${lines} lines; WP-22's ceiling is 900`);
      checked++;
    }
  }
  assert.ok(checked >= 66, `expected the whole split, saw ${checked} files`);
});
