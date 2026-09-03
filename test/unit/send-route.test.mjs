/**
 * WP-09 · POST /api/send answers 202, and the turn arrives on the SSE
 * channel.
 *
 * The route is driven through fake `IncomingMessage`/`ServerResponse` objects,
 * the same way test/unit/permission-route.test.mjs drives the permission
 * hold: what matters here is exactly WHEN the socket is answered — before the
 * turn has produced a word — and that is not observable from a real HTTP
 * client that has already waited for the body.
 *
 * The adapter is a stand-in that emits the neutral events
 * src/adapters/claude-code/stream.mjs produces. The real adapter's half of
 * this, over a real child process replaying a recorded stream, is
 * test/unit/claude-stream.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { Router } from '../../src/http/server.mjs';
import { register as registerActions } from '../../src/http/routes/actions.mjs';
import { register as registerState } from '../../src/http/routes/state.mjs';
import { SendHub } from '../../src/core/sends.mjs';

const silentLog = { error() {}, warn() {}, debug() {}, info() {} };

const AGENT = {
  id: 'claude-code:sess-1',
  cwd: '/w/orbital-api',
  live: false,
  activityState: 'for_review',
  ackState: 'active',
};

/** A `ServerResponse` stand-in that records what was written to it. */
function fakeRes() {
  const res = new EventEmitter();
  res.headersSent = false;
  res.status = null;
  res.body = null;
  res.chunks = [];
  res.ended = false;
  res.writeHead = (status, headers) => {
    res.headersSent = true;
    res.status = status;
    res.headers = headers;
    return res;
  };
  res.write = (chunk) => {
    res.chunks.push(String(chunk));
    return true;
  };
  res.end = (payload) => {
    res.ended = true;
    if (payload != null) res.body = String(payload);
  };
  return res;
}

/** An `IncomingMessage` stand-in carrying a JSON body. */
function fakeReq(body) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json' };
  const payload = JSON.stringify(body);
  queueMicrotask(() => {
    req.emit('data', Buffer.from(payload, 'utf8'));
    req.emit('end');
  });
  return req;
}

/** Every SSE frame written to a stream response, parsed. */
function frames(res) {
  return res.chunks
    .join('')
    .split('\n\n')
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block);
      const data = /^data: (.+)$/m.exec(block);
      if (!event || !data) return null;
      return { event: event[1], data: JSON.parse(data[1]) };
    })
    .filter(Boolean);
}

const answer = (res) => (res.body == null ? null : JSON.parse(res.body));
const tick = () => new Promise((r) => setTimeout(r, 5));

/**
 * @param {{events?:any[], result?:any, hang?:boolean, throws?:Error}} [turn]
 *   what the stand-in adapter does with the send it is handed.
 */
function setup(turn = {}) {
  const calls = [];
  const sends = new SendHub({ log: silentLog });
  /** @type {{resolve:Function, signal:AbortSignal}[]} */
  const inFlight = [];

  const adapter = {
    id: 'claude-code',
    label: 'Claude Code',
    send(sessionId, text, opts) {
      calls.push(['send', sessionId, text, { cwd: opts.cwd, timeoutMs: opts.timeoutMs }]);
      if (turn.throws) return Promise.reject(turn.throws);
      return new Promise((resolve) => {
        inFlight.push({ resolve, signal: opts.signal });
        opts.signal?.addEventListener?.('abort', () =>
          resolve({ ok: false, error: 'the send was cancelled' }),
        );
        if (turn.hang) return;
        for (const e of turn.events || []) opts.onEvent(e);
        resolve(turn.result || { ok: true, text: 'done' });
      });
    },
  };

  const registry = {
    agents: [AGENT],
    snapshot: () => ({ agents: [AGENT], projects: [] }),
    on: () => () => {},
    noteSent: (...args) => calls.push(['noteSent', ...args]),
    // Present so an attempt to touch ack state is recorded rather than
    // throwing: THE INVARIANT is asserted by these never being reached.
    act: (...args) => calls.push(['act', ...args]),
    setAck: (...args) => calls.push(['setAck', ...args]),
  };

  const ctx = {
    registry,
    store: { settings: {}, save: async () => {} },
    adapters: { getAdapter: (id) => (id === 'claude-code' ? adapter : null) },
    sends,
    log: silentLog,
  };
  const router = new Router();
  registerActions(router, ctx);
  registerState(router, ctx);
  return { router, ctx, calls, sends, inFlight };
}

/** Open an SSE listener on `/api/events?stream=send`. */
function listen(router, ctx, { watch } = {}) {
  const req = new EventEmitter();
  req.method = 'GET';
  req.headers = {};
  const res = fakeRes();
  const search = new URLSearchParams({ stream: 'send' });
  if (watch) search.set('watch', watch);
  const url = new URL(`http://127.0.0.1/api/events?${search}`);
  router.match('GET', '/api/events')(req, res, url, ctx);
  return { req, res, close: () => req.emit('close') };
}

async function post(router, ctx, path, body) {
  const res = fakeRes();
  await router.match('POST', path)(fakeReq(body), res, new URL(`http://127.0.0.1${path}`), ctx);
  return res;
}

// ---------------------------------------------------------------------------

test('a send is accepted, not awaited: 202 with an id, before any of the turn', async () => {
  const { router, ctx } = setup({ hang: true });
  const res = await post(router, ctx, '/api/send', { id: AGENT.id, text: 'ship it' });
  assert.equal(res.status, 202, 'the composer is held for the whole turn at 200');
  const body = answer(res);
  assert.equal(body.ok, true);
  assert.equal(body.id, AGENT.id);
  assert.match(String(body.sendId), /^s\d+$/);
});

test('the turn arrives on the SSE channel, in order, tagged with its send id', async () => {
  const { router, ctx } = setup({
    events: [
      { type: 'accepted', sessionId: 'sess-1', model: 'claude-sonnet-4-6' },
      { type: 'delta', text: 'Right — ' },
      { type: 'tool', name: 'Read', summary: 'Read vite.config.ts' },
      { type: 'delta', text: 'found it.' },
      { type: 'result', ok: true, text: 'Right — found it.', error: null },
    ],
    result: { ok: true, text: 'Right — found it.' },
  });
  const stream = listen(router, ctx);
  const res = await post(router, ctx, '/api/send', { id: AGENT.id, text: 'ship it' });
  const sendId = answer(res).sendId;
  await tick();

  const got = frames(stream.res).filter((f) => f.event === 'send');
  assert.deepEqual(
    got.map((f) => f.data.type),
    ['accepted', 'delta', 'tool', 'delta', 'result', 'done'],
  );
  for (const f of got) {
    assert.equal(f.data.sendId, sendId, 'every event names the send it belongs to');
    assert.equal(f.data.agentId, AGENT.id);
  }
  assert.equal(got[1].data.text, 'Right — ');
  assert.equal(got[5].data.ok, true);
  stream.close();
});

test('a failed turn says so on the channel, so the composer can be restored', async () => {
  const { router, ctx } = setup({
    events: [
      { type: 'accepted', sessionId: 'sess-1' },
      {
        type: 'result',
        ok: false,
        text: '',
        error: 'Failed to authenticate. API Error: 401 OAuth access token has expired.',
      },
    ],
    result: {
      ok: false,
      error: 'Failed to authenticate. API Error: 401 OAuth access token has expired.',
    },
  });
  const stream = listen(router, ctx);
  await post(router, ctx, '/api/send', { id: AGENT.id, text: 'ship it' });
  await tick();

  const got = frames(stream.res).filter((f) => f.event === 'send');
  const error = got.find((f) => f.data.type === 'error');
  assert.ok(error, 'a failure the client can act on was never sent');
  assert.match(error.data.error, /OAuth access token has expired/);
  // And the turn is still closed, or the panel would sit typing forever.
  assert.equal(got[got.length - 1].data.type, 'done');
  assert.equal(got[got.length - 1].data.ok, false);
  stream.close();
});

test('an adapter that throws is a failed turn, not a dropped one', async () => {
  const { router, ctx } = setup({ throws: new Error('claude is not on PATH') });
  const stream = listen(router, ctx);
  const res = await post(router, ctx, '/api/send', { id: AGENT.id, text: 'ship it' });
  assert.equal(res.status, 202, 'the route had already accepted it');
  await tick();
  const got = frames(stream.res).filter((f) => f.event === 'send');
  assert.deepEqual(
    got.map((f) => f.data.type),
    ['error', 'done'],
  );
  assert.match(got[0].data.error, /not on PATH/);
  stream.close();
});

test('a failed send is not recorded as a send', async () => {
  const { router, ctx, calls } = setup({ result: { ok: false, error: 'nope' } });
  await post(router, ctx, '/api/send', { id: AGENT.id, text: 'ship it' });
  await tick();
  const noted = calls.filter((c) => c[0] === 'noteSent');
  assert.equal(noted.length, 1);
  assert.equal(noted[0][2].ok, false, 'the ledger decides; the route reports honestly');
});

test('INVARIANT: nothing on the send path touches ack state', async () => {
  const { router, ctx, calls } = setup({
    events: [{ type: 'delta', text: 'hi' }],
    result: { ok: true, text: 'hi' },
  });
  await post(router, ctx, '/api/send', { id: AGENT.id, text: 'Yes, go ahead.' });
  await tick();
  assert.deepEqual(
    calls.filter((c) => c[0] === 'act' || c[0] === 'setAck'),
    [],
    '`2 Approve` is a send, never an ack',
  );
});

test('the validation the route always did is unchanged', async () => {
  const { router, ctx } = setup();
  assert.equal((await post(router, ctx, '/api/send', { text: 'hi' })).status, 400);
  assert.equal((await post(router, ctx, '/api/send', { id: AGENT.id, text: '  ' })).status, 400);
  assert.equal(
    (await post(router, ctx, '/api/send', { id: AGENT.id, text: 'x'.repeat(100_001) })).status,
    413,
  );
  assert.equal(
    (await post(router, ctx, '/api/send', { id: 'claude-code:nope', text: 'hi' })).status,
    404,
  );
  assert.equal((await post(router, ctx, '/api/send', { id: 'mystery:1', text: 'hi' })).status, 404);
});

// -------------------------------------------------------------- the channel

test('the default SSE stream is the snapshot, exactly as it was', () => {
  const { router, ctx } = setup();
  const req = new EventEmitter();
  req.method = 'GET';
  req.headers = {};
  const res = fakeRes();
  router.match('GET', '/api/events')(req, res, new URL('http://127.0.0.1/api/events'), ctx);
  const got = frames(res);
  assert.equal(got.length, 1);
  assert.equal(got[0].event, 'state');
  req.emit('close');
});

test('a send listener is not sent the floor snapshot it never reads', async () => {
  const { router, ctx } = setup({ result: { ok: true, text: 'hi' } });
  const stream = listen(router, ctx);
  await tick();
  assert.deepEqual(
    frames(stream.res).filter((f) => f.event === 'state'),
    [],
    'the panel’s own connection would double every snapshot on the wire',
  );
  stream.close();
});

test('closing the page stops the transcript watch it opened', async () => {
  let stopped = 0;
  const { router, ctx } = setup();
  ctx.adapters.getAdapter = () => ({
    watchConversation: async () => () => {
      stopped += 1;
    },
  });
  const stream = listen(router, ctx, { watch: AGENT.id });
  await tick();
  stream.close();
  await tick();
  assert.equal(stopped, 1, 'a closed panel left the daemon watching a file');
});

test('a runtime with no transcript watch costs the panel nothing else', async () => {
  const { router, ctx } = setup();
  ctx.adapters.getAdapter = () => ({ id: 'codex' }); // no watchConversation
  const stream = listen(router, ctx, { watch: 'codex:sess-9' });
  await tick();
  assert.equal(stream.res.status, 200, 'the stream still opened');
  stream.close();
});

// ------------------------------------------------------------------ the hub

test('ORPHAN: closing the daemon cancels every turn still running', async () => {
  const { router, ctx, sends, inFlight } = setup({ hang: true });
  const res = await post(router, ctx, '/api/send', { id: AGENT.id, text: 'a long one' });
  const sendId = answer(res).sendId;
  assert.deepEqual(sends.liveIds(), [sendId]);
  assert.equal(inFlight.length, 1);
  assert.equal(inFlight[0].signal.aborted, false);

  // What src/daemon.mjs's close() does, in the order it does it.
  sends.shutdown();
  assert.equal(inFlight[0].signal.aborted, true, 'the child was left running');
  await tick();
  assert.deepEqual(sends.liveIds(), []);
});

test('the hub keeps the last few endings, so a page that reconnects is not left waiting', () => {
  const hub = new SendHub({ log: silentLog });
  for (let i = 0; i < 25; i++) {
    const { sendId } = hub.begin({ agentId: AGENT.id });
    hub.publish(sendId, { type: 'delta', text: 'x' });
    hub.publish(sendId, { type: 'result', ok: true, text: 'x' });
    hub.end(sendId);
  }
  const recent = hub.recent();
  assert.equal(recent.length, 20, 'this is a hand-off window, not a log');
  assert.ok(recent.every((e) => e.type === 'result'));
});

test('a subscriber that throws cannot stop the others hearing the turn', () => {
  const hub = new SendHub({ log: silentLog });
  const heard = [];
  hub.subscribe(() => {
    throw new Error('the panel exploded');
  });
  hub.subscribe((e) => heard.push(e.type));
  const { sendId } = hub.begin({ agentId: AGENT.id });
  hub.publish(sendId, { type: 'delta', text: 'x' });
  hub.publish(sendId, { type: 'done', ok: true });
  assert.deepEqual(heard, ['delta', 'done']);
});
