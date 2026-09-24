/**
 * Drift control and the budget stop — WP-71, `docs/07-STUDIO-DESIGN.md` §8,
 * §9 invariant 1 and §10 acceptance (3) and (4).
 *
 *   (3) a flag produces a review card and changes no board state — the PM
 *       pass's `INVARIANT:`, over a planner that flags EVERY card;
 *   (4) a card crossing its cap moves only to `blocked`, stops further sends,
 *       posts exactly one message, and kills nothing — against a real child
 *       process standing in for the CLI session, which outlives the stop.
 *
 * The routes are driven through a real `Router` with the handlers the daemon
 * registers, over a real project directory, a real ledger directory and a
 * real `SendHub`. What is fake is the model: the adapter's `send` answers
 * from a script instead of spawning `claude`, because the login on the
 * reference machine is still expired (§159.1) and a planner that cannot log
 * in cannot answer a PM pass either.
 *
 * The clock is `DECKHQ_NOW`, the product's own injected clock; the schedule
 * is ticked by hand, never waited on.
 */
import { scratchDir } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Router, readJson, sendError } from '../../src/http/server.mjs';
import { register as registerActions } from '../../src/http/routes/actions.mjs';
import { resolveProject } from '../../src/http/routes/studio.mjs';
import { budgetStopped, registerDrift } from '../../src/http/routes/studio-drift.mjs';
import { SendHub } from '../../src/core/sends.mjs';
import { dayKey } from '../../src/core/ledger-record.mjs';
import { StudioStore } from '../../src/studio/store.mjs';
import { appendMove } from '../../src/studio/schema.mjs';
import { CLOCK_ENV } from '../../src/core/clock.mjs';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const silentLog = { error() {}, warn() {}, debug() {}, info() {} };
const T0 = Date.parse('2026-09-24T10:00:00.000Z');
const MIN = 60_000;
const PLANNER = 'claude-code:planner-1';
const WORKER = 'claude-code:worker-1';
const OTHER = 'claude-code:other-1';

/** @param {number} t */
function setNow(t) {
  process.env[CLOCK_ENV] = new Date(t).toISOString();
}

function fakeRes() {
  const res = new EventEmitter();
  res.status = null;
  res.body = null;
  res.writeHead = (status) => {
    res.status = status;
    return res;
  };
  res.end = (payload) => {
    if (payload != null) res.body = String(payload);
  };
  return res;
}

async function call(router, method, route, body, search = '') {
  const handler = router.match(method, route);
  assert.ok(handler, `${method} ${route} is not registered`);
  const req = new EventEmitter();
  const res = fakeRes();
  const done = handler(req, res, new URL(`http://127.0.0.1:4317${route}${search}`));
  if (method === 'POST') {
    req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  }
  await done;
  return { status: res.status, body: res.body == null ? null : JSON.parse(res.body) };
}

const card = (id, column, extra = {}) => ({
  id,
  title: `card ${id}`,
  acceptance: ['a failing test first', 'npm test green'],
  milestone: 'm1',
  role: null,
  column,
  budget: null,
  agentId: null,
  worktree: null,
  handover: null,
  flags: [],
  updatedAt: 100,
  ...extra,
});

/**
 * A project with Studio's directory, a board, a roster, a ledger, a planner
 * and a worker, and every route this package adds — plus `/api/send`.
 *
 * @param {{cards:any[], records?:any[], answer?:string, consent?:boolean}} opts
 */
function setup(opts) {
  setNow(T0);
  const root = path.join(scratchDir('drift-'), 'orbital');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  const studio = new StudioStore(root);
  fs.mkdirSync(studio.dir, { recursive: true });
  const boardFile = studio.pathOf('board.json');
  const board = { version: 1, projectKey: studio.projectKey, cards: opts.cards };
  fs.writeFileSync(boardFile, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  fs.writeFileSync(
    studio.pathOf('roster.json'),
    JSON.stringify({
      version: 1,
      projectKey: studio.projectKey,
      roles: [{ name: 'backend', agentId: WORKER }],
    }),
    'utf8',
  );
  fs.writeFileSync(studio.pathOf('blueprint.md'), '# Orbital\n\nGoal: refunds.\n', 'utf8');

  const ledgerDir = scratchDir('drift-ledger-');
  const records = opts.records || [];
  for (const rec of records) {
    fs.appendFileSync(path.join(ledgerDir, `${dayKey(rec.t)}.jsonl`), `${JSON.stringify(rec)}\n`);
  }

  /** @type {Array<{id:string, text:string}>} */
  const sent = [];
  const adapter = {
    id: 'claude-code',
    label: 'Claude Code',
    send: async (sessionId, text) => {
      sent.push({ id: `claude-code:${sessionId}`, text });
      return { ok: true, text: sessionId === 'planner-1' ? opts.answer || '[]' : 'ok' };
    },
  };
  const agents = [
    { id: PLANNER, cwd: root, runtime: 'claude-code' },
    { id: WORKER, cwd: root, runtime: 'claude-code' },
    { id: OTHER, cwd: root, runtime: 'claude-code' },
  ];
  const consent = opts.consent === false ? {} : { [studio.projectKey]: { root } };
  const ctx = {
    log: silentLog,
    store: {
      settings: {},
      studioConsent: () => consent,
      studioPlannerFor: (key) => (key === studio.projectKey ? { agentId: PLANNER } : null),
      roomOrder: () => [],
    },
    registry: { agents, snapshot: () => ({ agents }), on: () => () => {} },
    adapters: {
      getAdapter: (id) => (id === 'claude-code' ? adapter : null),
      getAdapters: () => [],
    },
    sends: new SendHub({ log: silentLog }),
    ledger: { dir: ledgerDir },
    studioTickMs: 24 * 60 * MIN,
  };
  const router = new Router();
  const projectFromBody = async (req, res) => {
    const body = await readJson(req);
    const project = resolveProject(body.cwd);
    if ('error' in project) {
      sendError(res, 400, project.error);
      return null;
    }
    return { ...project, body };
  };
  const drift = registerDrift(router, ctx, {
    projectFromBody,
    consentFor: (key) => consent[key] || null,
    resolveProject,
  });
  registerActions(router, /** @type {any} */ (ctx));
  const read = () => JSON.parse(fs.readFileSync(boardFile, 'utf8'));
  return { root, studio, boardFile, router, drift, sent, ctx, read };
}

const tokens = (t, sessionId, delta) => ({
  t,
  sessionId,
  projectKey: 'p',
  machineId: 'm',
  kind: 'tokens',
  delta,
  tokens: delta,
  cacheDelta: 0,
  cacheTokens: 0,
});

// ---------------------------------------------------------------------------
// The PM pass
// ---------------------------------------------------------------------------

test('INVARIANT: a PM pass that flags every card leaves every column byte-identical', async () => {
  const cards = [
    card('c1', 'backlog'),
    card('c2', 'in_progress', { role: 'backend' }),
    card('c3', 'review'),
    card('c4', 'blocked'),
  ];
  const answer = [
    'Here is what I see.',
    '```json',
    JSON.stringify([
      ...cards.map((c) => ({ cardId: c.id, kind: 'scope', text: `move ${c.id} to done now` })),
      { cardId: 'c99', kind: 'scope', text: 'a card that does not exist' },
    ]),
    '```',
  ].join('\n');
  const s = setup({ cards, answer });
  try {
    const columns = (b) => JSON.stringify(b.cards.map((c) => [c.id, c.column]));
    const before = s.read();

    const res = await call(s.router, 'POST', '/api/studio/pm-pass', { cwd: s.root });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.flags, 4);
    assert.equal(res.body.dropped, 1, 'a card the board does not have is dropped, not invented');

    const after = s.read();
    assert.equal(columns(after), columns(before), 'a flag moved a card');
    for (const [i, c] of after.cards.entries()) {
      const { flags, ...rest } = c;
      const { flags: was, ...restBefore } = before.cards[i];
      assert.deepEqual(rest, restBefore, `${c.id} changed outside its flags`);
      assert.deepEqual(flags, [
        ...was,
        { kind: 'drift', text: `scope: move ${c.id} to done now`, at: T0 },
      ]);
    }
    // The planner was handed the fixed instruction, the blueprint and the board,
    // through the ordinary send path.
    assert.equal(s.sent.length, 1);
    assert.equal(s.sent[0].id, PLANNER);
    assert.match(s.sent[0].text, /^DeckHQ PM pass\./);
    assert.match(s.sent[0].text, /Goal: refunds\./);
    assert.match(s.sent[0].text, /"id": "c4"/);
  } finally {
    s.drift.stop();
  }
});

test('the PM pass runs every 30 minutes on the injected clock, and not before', async () => {
  const s = setup({ cards: [card('c1', 'backlog')], answer: '[]' });
  try {
    await s.drift.tick();
    assert.equal(s.sent.length, 0, 'the first tick starts the clock; it is not a pass');
    setNow(T0 + 29 * MIN);
    await s.drift.tick();
    assert.equal(s.sent.length, 0, 'twenty-nine minutes is not thirty');
    setNow(T0 + 30 * MIN);
    await s.drift.tick();
    assert.equal(s.sent.length, 1, 'thirty minutes is a pass');
    setNow(T0 + 45 * MIN);
    await s.drift.tick();
    assert.equal(s.sent.length, 1);
    const tracking = await call(
      s.router,
      'GET',
      '/api/studio/tracking',
      null,
      `?project=${encodeURIComponent(s.root)}`,
    );
    assert.equal(tracking.body.pmPass.ok, true);
    assert.equal(tracking.body.pmPass.flags, 0);
  } finally {
    s.drift.stop();
  }
});

// ---------------------------------------------------------------------------
// The budget stop
// ---------------------------------------------------------------------------

test('INVARIANT: the budget stop reaches `blocked` only, refuses sends, posts once, kills nothing', async () => {
  // A real child process standing in for the hired CLI session. It is not the
  // daemon's child in production; here it is the test's, and the test is the
  // only thing that stops it.
  const session = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  /** @type {any[]} */
  const kills = [];
  const realKill = process.kill;
  const realChildKill = session.kill.bind(session);
  process.kill = /** @type {any} */ ((...args) => kills.push(['process.kill', ...args]));
  session.kill = /** @type {any} */ ((...args) => kills.push(['child.kill', ...args]));

  const cards = [
    // Over its token cap (1,200 of 1,000) and in progress: this one stops.
    card('c1', 'in_progress', { role: 'backend', budget: { tokens: 1000, minutes: null } }),
    // Over its cap too, but in review: finished work is not stopped.
    card('c2', 'review', { agentId: OTHER, budget: { tokens: 10, minutes: null } }),
    // Under its cap.
    card('c3', 'in_progress', { agentId: OTHER, budget: { tokens: 1_000_000, minutes: 600 } }),
  ];
  const records = [tokens(T0 - 5 * MIN, WORKER, 1200), tokens(T0 - 4 * MIN, OTHER, 20)];
  const s = setup({ cards, records });
  try {
    const before = s.read();
    const first = await s.drift.tick();
    assert.deepEqual(first[0].stops, [
      { cardId: 'c1', which: 'tokens', agentId: WORKER, posted: true },
    ]);

    const after = s.read();
    assert.deepEqual(
      after.cards.map((c) => c.column),
      ['blocked', 'review', 'in_progress'],
      'the stop reached blocked, for the one card, and nothing else moved',
    );
    const c1 = after.cards[0];
    assert.deepEqual(c1.moves, [{ from: 'in_progress', to: 'blocked', at: T0 }]);
    assert.deepEqual(c1.flags, [
      { kind: 'budget', text: '1,200 of 1,000 tokens spent, 0/2 criteria met', at: T0 },
    ]);
    assert.ok(budgetStopped(c1));
    assert.deepEqual(after.cards.slice(1), before.cards.slice(1));

    // Exactly one message, to the worker, asking it to stop and hand over.
    assert.equal(s.sent.length, 1);
    assert.equal(s.sent[0].id, WORKER);
    assert.match(s.sent[0].text, /^DeckHQ budget stop: card c1 has crossed its budget/);
    assert.match(s.sent[0].text, /handovers[\\/]c1\.md/);

    // A second tick finds the card already blocked, and posts nothing.
    setNow(T0 + 5 * MIN);
    await s.drift.tick();
    assert.equal(s.sent.length, 1, 'a second message was posted');

    // Sends to that session are refused, by name; another session's are not.
    const refused = await call(s.router, 'POST', '/api/send', { id: WORKER, text: 'go on' });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.reason, 'budget');
    assert.equal(refused.body.cardId, 'c1');
    assert.match(refused.body.error, /card c1 crossed its budget/);
    const other = await call(s.router, 'POST', '/api/send', { id: OTHER, text: 'hello' });
    assert.equal(other.status, 202);

    // Nothing was killed, and the session is still running.
    assert.deepEqual(kills, []);
    assert.equal(session.exitCode, null);
    assert.equal(session.signalCode, null);

    // The user moves the card out of Blocked: the file says so, and the
    // refusal lifts with nothing to reset.
    const moved = s.read();
    moved.cards[0] = {
      ...moved.cards[0],
      column: 'review',
      moves: appendMove(moved.cards[0].moves, 'blocked', 'review', T0 + 6 * MIN),
    };
    fs.writeFileSync(s.boardFile, `${JSON.stringify(moved, null, 2)}\n`, 'utf8');
    const lifted = await call(s.router, 'POST', '/api/send', { id: WORKER, text: 'go on' });
    assert.equal(lifted.status, 202);
  } finally {
    process.kill = realKill;
    s.drift.stop();
    realChildKill();
  }
});

test('the budget stop counts minutes on the card as well as tokens', async () => {
  const cards = [
    card('c1', 'in_progress', {
      budget: { tokens: null, minutes: 30 },
      moves: [{ from: 'ready', to: 'in_progress', at: T0 - 31 * MIN }],
    }),
  ];
  const s = setup({ cards });
  try {
    const out = await s.drift.tick();
    assert.equal(out[0].stops.length, 1);
    assert.equal(out[0].stops[0].which, 'minutes');
    assert.equal(out[0].stops[0].posted, false, 'a card with no session has nobody to message');
    assert.equal(s.read().cards[0].column, 'blocked');
    assert.equal(s.sent.length, 0);
  } finally {
    s.drift.stop();
  }
});

test('INVARIANT: no path through tracking, the PM pass or the budget stop kills a process', () => {
  const files = [
    'http/routes/studio-drift.mjs',
    'http/send-turn.mjs',
    'studio/budget.mjs',
    'studio/pm-pass.mjs',
    'studio/tracking.mjs',
  ];
  for (const file of files) {
    const body = fs
      .readFileSync(path.join(SRC, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    for (const needle of ['.kill(', 'kill(', 'SIGTERM', 'SIGKILL', 'taskkill', 'abort(']) {
      assert.equal(body.includes(needle), false, `${file} contains "${needle}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// The routes' refusals, and the tracking shape
// ---------------------------------------------------------------------------

test('the routes refuse what they should, and tracking reads `no data` without a digit', async () => {
  const s = setup({
    cards: [card('c1', 'backlog', { acceptance: [], milestone: null })],
    consent: false,
  });
  try {
    const noConsent = await call(s.router, 'POST', '/api/studio/pm-pass', { cwd: s.root });
    assert.equal(noConsent.status, 403);
    const relative = await call(s.router, 'POST', '/api/studio/pm-pass', { cwd: 'orbital' });
    assert.equal(relative.status, 400);
    const bad = await call(s.router, 'GET', '/api/studio/tracking', null, '?project=nowhere');
    assert.equal(bad.status, 400);

    const res = await call(
      s.router,
      'GET',
      '/api/studio/tracking',
      null,
      `?project=${encodeURIComponent(s.root)}`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.cards.length, 1);
    const { cardId, ...said } = res.body.cards[0];
    assert.equal(cardId, 'c1');
    assert.equal(said.status, 'no data');
    assert.equal(/\d/.test(JSON.stringify(said)), false, JSON.stringify(said));
    assert.equal('cost' in said, false, 'showCost is off');
    assert.equal(res.body.pmPass, null);
  } finally {
    s.drift.stop();
  }
});

test('a PM pass with no planner on the floor says so, and writes nothing', async () => {
  const s = setup({ cards: [card('c1', 'backlog')] });
  try {
    s.ctx.registry.agents.splice(0, 1);
    const before = fs.readFileSync(s.boardFile, 'utf8');
    const res = await call(s.router, 'POST', '/api/studio/pm-pass', { cwd: s.root });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'no planner on the floor');
    assert.equal(fs.readFileSync(s.boardFile, 'utf8'), before);
    assert.equal(s.sent.length, 0);
  } finally {
    s.drift.stop();
  }
});
