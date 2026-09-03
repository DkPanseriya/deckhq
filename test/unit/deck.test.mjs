/**
 * WP-42 — the terminal deck.
 *
 * What these tests are protecting:
 *
 *   1. **The order is the deck's order.** `docs/plan/05-GUI-UX-SPEC.md` §3.2:
 *      oldest first, `for_review` and `needs_input` above `stalled`, separated
 *      by a rule. A screen-reader user and a terminal user get the same queue
 *      in the same order as the floor, which is what makes the deck the
 *      accessible equivalent rather than a second opinion.
 *   2. **An id resolves to exactly one agent, or to an error.** These ids
 *      address `ack` and `bench`. A near-miss that guesses is how a user-owned
 *      state gets cleared on the wrong agent.
 *   3. **`NO_COLOR` and a pipe mean no ANSI**, so the deck is greppable.
 *   4. **Writes need the daemon.** With none, `ack` and `bench` print one line
 *      and exit 2 — they do not fall back to editing `state.json`, because
 *      `act()` is the only path allowed to clear a user-owned state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  NO_DAEMON,
  cut,
  groupRows,
  jsonRows,
  palette,
  renderDeck,
  resolveId,
  runAct,
  runLs,
  runOpen,
  runWaiting,
  shortId,
  useColor,
  waited,
} from '../../src/cli/deck.mjs';
import { readOffline, waitStart } from '../../src/cli/source.mjs';

const HOUR = 3600_000;
const NOW = 1_700_000_000_000;
const ESC = String.fromCharCode(27);

/**
 * One agent, in the shape `/api/state` hands out.
 * @param {Partial<any>} spec
 */
function agent(spec = {}) {
  const id = spec.id || `claude-code:${spec.mk || 'x'}`;
  return {
    id,
    runtime: 'claude-code',
    title: 'a session',
    projectId: 'orbital-api',
    projectName: 'orbital-api',
    cwd: '/work/orbital-api',
    live: false,
    activityState: 'for_review',
    ackState: 'active',
    reviewSince: null,
    needsInputSince: null,
    lastOutputAt: null,
    lastActivityAt: NOW - HOUR,
    tokens: 1000,
    lastText: 'done',
    mk: null,
    displayName: null,
    label: null,
    ...spec,
    id,
  };
}

/** A deck of four: two finished turns, one raised hand, one stall. */
function fourAgents() {
  return [
    agent({
      mk: 'MK1.4',
      id: 'claude-code:d',
      activityState: 'for_review',
      reviewSince: NOW - HOUR,
    }),
    agent({
      mk: 'MK5.1',
      id: 'claude-code:b',
      activityState: 'needs_input',
      needsInputSince: NOW - 4 * HOUR,
    }),
    agent({
      mk: 'MK3.2',
      id: 'claude-code:s',
      activityState: 'stalled',
      lastOutputAt: NOW - 3 * HOUR,
    }),
    agent({
      mk: 'MK1.1',
      id: 'claude-code:a',
      activityState: 'for_review',
      reviewSince: NOW - 26 * HOUR,
    }),
  ];
}

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

test('the queue is oldest first', () => {
  const [queue] = groupRows(fourAgents(), { waitingOnly: true });
  assert.deepEqual(
    queue.rows.map((a) => a.mk),
    ['MK1.1', 'MK5.1', 'MK1.4'],
  );
  const starts = queue.rows.map(waitStart);
  assert.deepEqual(
    [...starts].sort((a, b) => a - b),
    starts,
  );
});

test('a raised hand and a finished turn share a group; a stall sits below the rule', () => {
  const groups = groupRows(fourAgents(), { waitingOnly: true });
  assert.deepEqual(
    groups.map((g) => g.key),
    ['waiting', 'stalled'],
  );
  assert.deepEqual(
    groups[1].rows.map((a) => a.mk),
    ['MK3.2'],
  );
  const text = renderDeck(fourAgents(), { now: NOW, color: false, waitingOnly: true });
  const lines = text.split('\n').filter(Boolean);
  const ruleAt = lines.findIndex((l) => l.includes('─'));
  const stallAt = lines.findIndex((l) => l.includes('MK3.2'));
  assert.ok(ruleAt > 0 && stallAt > ruleAt, 'the stall is below the rule');
  for (const mk of ['MK1.1', 'MK5.1', 'MK1.4']) {
    assert.ok(lines.findIndex((l) => l.includes(mk)) < ruleAt, `${mk} is above the rule`);
  }
});

test('`waiting` shows only what needs you; `ls` also shows everyone else', async () => {
  const agents = [
    ...fourAgents(),
    agent({ mk: 'MK9.9', id: 'claude-code:w', activityState: 'working' }),
  ];
  const read = async () => ({ agents, counts: {}, source: 'daemon', port: 4317 });

  const waitingOut = [];
  await runWaiting(['--no-color'], { write: (s) => waitingOut.push(s), read, now: NOW });
  assert.doesNotMatch(waitingOut.join(''), /MK9\.9/);

  const lsOut = [];
  await runLs(['--no-color'], { write: (s) => lsOut.push(s), read, now: NOW });
  assert.match(lsOut.join(''), /MK9\.9/);
});

test('benched and let-go agents appear only with --all', async () => {
  const agents = [
    agent({
      mk: 'MK1.1',
      id: 'claude-code:a',
      activityState: 'for_review',
      reviewSince: NOW - HOUR,
    }),
    agent({ mk: 'MK2.2', id: 'claude-code:b', ackState: 'benched', activityState: 'ended' }),
  ];
  const read = async () => ({ agents, counts: {}, source: 'daemon', port: 4317 });

  const plain = [];
  await runLs(['--no-color'], { write: (s) => plain.push(s), read, now: NOW });
  assert.doesNotMatch(plain.join(''), /MK2\.2/);

  const all = [];
  await runLs(['--no-color', '--all'], { write: (s) => all.push(s), read, now: NOW });
  assert.match(all.join(''), /MK2\.2/);
});

test('the columns are the deck spec’s, in the deck spec’s order', () => {
  const text = renderDeck(fourAgents(), { now: NOW, color: false, waitingOnly: true });
  const header = text.split('\n').find((l) => l.includes('WAITING'));
  const order = ['WAITING', 'WHO', 'ID', 'PROJECT', 'LAST WORD', 'TOKENS'];
  let at = -1;
  for (const col of order) {
    const next = header.indexOf(col);
    assert.ok(next > at, `${col} comes after the column before it`);
    at = next;
  }
});

test('the waiting column carries two units while both matter', () => {
  assert.equal(waited(26 * HOUR), '1d 2h');
  assert.equal(waited(4 * HOUR + 12 * 60000), '4h 12m');
  assert.equal(waited(40 * 60000), '40m');
  assert.equal(waited(7 * 60000), '7m');
  assert.equal(waited(20 * 1000), 'just now');
});

test('the last word is one line, cut with an ellipsis', () => {
  assert.equal(cut('a\nb   c', 40), 'a b c');
  assert.equal(cut('x'.repeat(50), 10), 'x'.repeat(9) + '…');
});

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

test('an id resolves from the MK tag, its bare number, a name, or a session prefix', () => {
  const agents = [
    agent({ mk: 'MK1.1', id: 'claude-code:abc12345-dead-beef', displayName: 'Ada' }),
    agent({ mk: 'MK5.1', id: 'claude-code:99887766-cafe-f00d' }),
  ];
  assert.equal(resolveId(agents, 'MK1.1').id, 'claude-code:abc12345-dead-beef');
  assert.equal(resolveId(agents, 'mk1.1').id, 'claude-code:abc12345-dead-beef');
  assert.equal(resolveId(agents, '1.1').id, 'claude-code:abc12345-dead-beef');
  assert.equal(resolveId(agents, 'Ada').id, 'claude-code:abc12345-dead-beef');
  assert.equal(resolveId(agents, 'abc123').id, 'claude-code:abc12345-dead-beef');
  assert.equal(
    resolveId(agents, 'claude-code:99887766-cafe-f00d').id,
    'claude-code:99887766-cafe-f00d',
  );
});

test('an ambiguous id is refused rather than guessed', () => {
  const agents = [
    agent({ mk: 'MK1.1', id: 'claude-code:aaa11111' }),
    agent({ mk: 'MK1.2', id: 'claude-code:aaa22222' }),
  ];
  const result = resolveId(agents, 'aaa');
  assert.ok('error' in result);
  assert.match(result.error, /matches 2 agents/);
  assert.equal(result.matches.length, 2);
});

test('an id that matches nothing is an error, not the first row', () => {
  const result = resolveId(fourAgents(), 'MK9.9');
  assert.ok('error' in result);
  assert.match(result.error, /no agent matches/);
});

test('an empty id is an error', () => {
  assert.ok('error' in resolveId(fourAgents(), '   '));
});

test('the id the deck prints is the id the deck accepts', () => {
  const a = agent({ mk: 'MK4.2', id: 'claude-code:deadbeef-1111' });
  assert.equal(shortId(a), 'MK4.2');
  assert.equal(resolveId([a], shortId(a)).id, a.id);
  const unnamed = agent({ mk: null, id: 'claude-code:deadbeef-1111' });
  assert.equal(shortId(unnamed), 'deadbeef');
  assert.equal(resolveId([unnamed], shortId(unnamed)).id, unnamed.id);
});

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

test('NO_COLOR turns the colour off however it is set', () => {
  assert.equal(useColor({ env: { NO_COLOR: '1' }, isTTY: true }), false);
  assert.equal(useColor({ env: { NO_COLOR: '' }, isTTY: true }), false);
  assert.equal(useColor({ env: { NO_COLOR: '0' }, isTTY: true }), false);
});

test('a pipe, a dumb terminal and --no-color all mean no ANSI', () => {
  assert.equal(useColor({ env: {}, isTTY: false }), false);
  assert.equal(useColor({ env: { TERM: 'dumb' }, isTTY: true }), false);
  assert.equal(useColor({ env: {}, isTTY: true, argv: ['--no-color'] }), false);
  assert.equal(useColor({ env: {}, isTTY: true }), true);
});

test('no escape byte reaches an uncoloured deck', () => {
  const plain = renderDeck(fourAgents(), { now: NOW, color: false, waitingOnly: true });
  assert.equal(plain.includes(ESC), false);
  const coloured = renderDeck(fourAgents(), { now: NOW, color: true, waitingOnly: true });
  assert.ok(coloured.includes(ESC));
  // The rows themselves are identical once the escapes are gone.
  assert.equal(coloured.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), ''), plain);
});

test('an uncoloured palette is four identity functions', () => {
  const p = palette(false);
  assert.equal(p.review('x'), 'x');
  assert.equal(p.dim('x'), 'x');
});

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

test('--json carries the group, the id and how long it has been waiting', async () => {
  const out = [];
  await runLs(['--json'], {
    write: (s) => out.push(s),
    read: async () => ({
      agents: fourAgents(),
      counts: { needsYou: 4, handsUp: 1 },
      source: 'daemon',
      port: 4317,
    }),
    now: NOW,
  });
  const parsed = JSON.parse(out.join(''));
  assert.equal(parsed.source, 'daemon');
  assert.equal(parsed.port, 4317);
  assert.equal(parsed.counts.needsYou, 4);
  assert.deepEqual(
    parsed.rows.map((r) => r.mk),
    ['MK1.1', 'MK5.1', 'MK1.4', 'MK3.2'],
  );
  assert.deepEqual(
    parsed.rows.map((r) => r.group),
    ['waiting', 'waiting', 'waiting', 'stalled'],
  );
  assert.equal(parsed.rows[0].waitingMs, 26 * HOUR);
});

test('the JSON rows and the table are the same rows in the same order', () => {
  const rows = jsonRows(fourAgents(), { now: NOW, waitingOnly: true });
  const text = renderDeck(fourAgents(), { now: NOW, color: false, waitingOnly: true });
  const printed = text
    .split('\n')
    .map((l) => (l.match(/MK\d+\.\d+/) || [])[0])
    .filter(Boolean);
  assert.deepEqual(
    rows.map((r) => r.mk),
    printed,
  );
});

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

test('with no daemon, ack and bench refuse and exit 2', async () => {
  for (const action of ['acknowledge', 'bench']) {
    const errs = [];
    let posted = false;
    const code = await runAct(action, ['MK1.1'], {
      write: () => {},
      error: (s) => errs.push(s),
      find: async () => null,
      post: async () => {
        posted = true;
        return { ok: true, status: 200, body: {} };
      },
    });
    assert.equal(code, 2);
    assert.equal(errs.join('').trim(), NO_DAEMON);
    assert.equal(posted, false, 'nothing was posted anywhere');
  }
});

test('INVARIANT: with no daemon, the CLI writes nothing to state.json', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-deck-'));
  const stateFile = path.join(dir, 'state.json');
  const cacheDir = path.join(dir, 'cache');
  fs.mkdirSync(cacheDir);
  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      version: 1,
      ack: { 'claude-code:a': { state: 'active', reviewSince: NOW - HOUR } },
      identity: { projects: {}, agents: {}, projectOf: {}, names: {} },
      settings: {},
    }),
  );
  const before = fs.readFileSync(stateFile);

  await runAct('acknowledge', ['a'], { write: () => {}, error: () => {}, find: async () => null });
  await runLs(['--no-color'], {
    write: () => {},
    read: async () => readOffline({ stateFile, cacheDir }),
    now: NOW,
  });

  assert.deepEqual(fs.readFileSync(stateFile), before);
  // And the debt is still there, unacknowledged.
  assert.equal(readOffline({ stateFile, cacheDir }).counts.needsYou, 1);
});

test('ack posts exactly one acknowledge for the resolved id', async () => {
  const posts = [];
  const agents = [agent({ mk: 'MK1.1', id: 'claude-code:abc12345', displayName: 'Ada' })];
  const out = [];
  const code = await runAct('acknowledge', ['mk1.1'], {
    write: (s) => out.push(s),
    error: () => {},
    find: async () => ({ port: 4317, snapshot: { agents } }),
    post: async (port, body) => {
      posts.push({ port, body });
      return { ok: true, status: 200, body: { ok: true, agent: { id: body.id } } };
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(posts, [
    { port: 4317, body: { id: 'claude-code:abc12345', action: 'acknowledge' } },
  ]);
  assert.match(out.join(''), /acknowledged MK1\.1 \(Ada\)/);
});

test('bench posts a bench, and a daemon refusal is reported rather than retried', async () => {
  const posts = [];
  const errs = [];
  const code = await runAct('bench', ['MK1.1'], {
    write: () => {},
    error: (s) => errs.push(s),
    find: async () => ({
      port: 4317,
      snapshot: { agents: [agent({ mk: 'MK1.1', id: 'claude-code:a' })] },
    }),
    post: async (port, body) => {
      posts.push(body);
      return { ok: false, status: 409, body: { error: 'Action "bench" is not legal' } };
    },
  });
  assert.equal(code, 1);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].action, 'bench');
  assert.match(errs.join(''), /not legal/);
});

test('an ambiguous id posts nothing at all', async () => {
  let posted = false;
  const agents = [
    agent({ mk: 'MK1.1', id: 'claude-code:aaa11111' }),
    agent({ mk: 'MK1.2', id: 'claude-code:aaa22222' }),
  ];
  const code = await runAct('acknowledge', ['aaa'], {
    write: () => {},
    error: () => {},
    find: async () => ({ port: 4317, snapshot: { agents } }),
    post: async () => {
      posted = true;
      return { ok: true, status: 200, body: {} };
    },
  });
  assert.equal(code, 2);
  assert.equal(posted, false);
});

// ---------------------------------------------------------------------------
// open
// ---------------------------------------------------------------------------

test('open names the agent in the fragment, on the daemon’s own loopback port', async () => {
  const opened = [];
  const agents = [agent({ mk: 'MK1.1', id: 'claude-code:abc12345' })];
  const code = await runOpen(['MK1.1'], {
    write: () => {},
    error: () => {},
    find: async () => ({ port: 4399, snapshot: { agents } }),
    open: (url) => opened.push(url),
  });
  assert.equal(code, 0);
  assert.deepEqual(opened, ['http://127.0.0.1:4399/#agent=claude-code%3Aabc12345']);
});

test('open with no id opens the floor', async () => {
  const opened = [];
  await runOpen([], {
    write: () => {},
    error: () => {},
    find: async () => ({ port: 4317, snapshot: { agents: [] } }),
    open: (url) => opened.push(url),
  });
  assert.deepEqual(opened, ['http://127.0.0.1:4317/']);
});

test('open with no daemon opens nothing', async () => {
  const opened = [];
  const errs = [];
  const code = await runOpen(['MK1.1'], {
    write: () => {},
    error: (s) => errs.push(s),
    find: async () => null,
    open: (url) => opened.push(url),
  });
  assert.equal(code, 2);
  assert.deepEqual(opened, []);
  assert.match(errs.join(''), /not running/);
});

// ---------------------------------------------------------------------------
// Empty
// ---------------------------------------------------------------------------

test('an empty deck says so without saying it is your fault', () => {
  const text = renderDeck([], { now: NOW, color: false });
  assert.match(text, /nothing is waiting on you/);
  assert.doesNotMatch(text, /you have|you left|still waiting on you for/i);
});

test('a fileless read says where its numbers came from', () => {
  const text = renderDeck(fourAgents(), {
    now: NOW,
    color: false,
    waitingOnly: true,
    source: 'state',
  });
  assert.match(text, /DeckHQ is not running/);
});
