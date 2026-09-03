/**
 * WP-37 — the `deckhq_waiting` MCP server.
 *
 * Driven the way Claude Code drives it: a child process, newline-delimited
 * JSON-RPC on stdio, with a loopback server standing in for the daemon. The
 * handler is also exercised in-process for the cases a transport makes
 * awkward to reach.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOLS, callWaiting, handle, serve } from '../../plugin/scripts/mcp-server.mjs';
import { renderWaiting, waitingFrom } from '../../plugin/lib/deckhq.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SERVER = path.join(ROOT, 'plugin', 'scripts', 'mcp-server.mjs');

const NOW = 1_700_000_000_000;

/** Two agents on the user's plate and two that are not. */
const SNAPSHOT = {
  counts: { needsYou: 2, handsUp: 1, forReview: 1, stalled: 0 },
  agents: [
    {
      id: 'claude-code:aaaa',
      runtime: 'claude-code',
      mk: 'MK1.1',
      displayName: null,
      projectName: 'deckhq',
      ackState: 'active',
      activityState: 'needs_input',
      needsInputSince: NOW - 3 * 60 * 60 * 1000,
      lastText: 'Which migration should I run first?',
    },
    {
      id: 'claude-code:bbbb',
      runtime: 'claude-code',
      mk: 'MK2.1',
      displayName: 'Ada',
      projectName: 'career-ops',
      ackState: 'active',
      activityState: 'for_review',
      reviewSince: NOW - 26 * 60 * 60 * 1000,
      lastText: 'Done.\nThree commits on the branch.',
    },
    {
      id: 'claude-code:cccc',
      runtime: 'claude-code',
      mk: 'MK1.2',
      projectName: 'deckhq',
      ackState: 'active',
      activityState: 'working',
    },
    {
      id: 'claude-code:dddd',
      runtime: 'claude-code',
      mk: 'MK1.3',
      projectName: 'deckhq',
      // Benched by the user: their decision, and not a debt.
      ackState: 'benched',
      activityState: 'for_review',
      reviewSince: NOW - 60_000,
    },
  ],
};

function tmpdir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-mcp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A loopback server that answers `/api/state` with `snapshot`. */
async function fakeDaemon(t, snapshot) {
  const server = http.createServer((req, res) => {
    if (req.url !== '/api/state') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(snapshot));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

/**
 * Send `messages` to the server over stdio and collect every response line.
 * @param {any[]} messages
 * @param {Record<string,string>} env
 */
function rpc(messages, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('close', (code) =>
      resolve({
        code,
        err,
        responses: out
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      }),
    );
    for (const m of messages) child.stdin.write(JSON.stringify(m) + '\n');
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Over the real transport
// ---------------------------------------------------------------------------

test('the server answers initialize, tools/list and tools/call over stdio', async (t) => {
  const port = await fakeDaemon(t, SNAPSHOT);
  const stateDir = tmpdir(t);
  fs.writeFileSync(path.join(stateDir, 'daemon.json'), JSON.stringify({ port }));

  const { code, err, responses } = await rpc(
    [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't' } },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'deckhq_waiting' } },
    ],
    { DECKHQ_STATE_DIR: stateDir, CLAUDE_CONFIG_DIR: tmpdir(t), DECKHQ_PORT: '' },
  );

  assert.equal(code, 0);
  assert.equal(err, '', 'a server that writes to stderr corrupts nothing but confuses everything');
  // The notification gets no reply, by the specification.
  assert.deepEqual(
    responses.map((r) => r.id),
    [1, 2, 3],
  );

  const init = responses[0].result;
  assert.equal(init.protocolVersion, '2025-06-18');
  assert.equal(init.serverInfo.name, 'deckhq');
  assert.ok(init.capabilities.tools);

  assert.deepEqual(
    responses[1].result.tools.map((tool) => tool.name),
    ['deckhq_waiting'],
  );

  const call = responses[2].result;
  assert.equal(call.isError, undefined);
  assert.equal(call.content[0].type, 'text');
  assert.match(call.content[0].text, /^2 waiting on this machine:/);
  assert.equal(call.structuredContent.waiting, 2);
});

/**
 * Drive `serve()` in this process over a pair of fake streams. Everything the
 * transport does — framing, ordering, parse errors — without a fourth child
 * process on a suite that already has latency budgets in it.
 * @param {string} input raw bytes as they would arrive on stdin
 */
async function transport(input, deps = {}) {
  const stdin = new EventEmitter();
  stdin.setEncoding = () => {};
  let out = '';
  const drain = serve(stdin, { write: (s) => (out += s) }, deps);
  stdin.emit('data', input);
  await drain();
  return out;
}

test('the transport frames one JSON object per line, in order', async () => {
  const out = await transport(
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) +
      '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) +
      '\n',
  );
  const lines = out.split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), { jsonrpc: '2.0', id: 1, result: {} });
  assert.equal(JSON.parse(lines[1]).id, 2);
});

test('a message split across two reads is still one message', async () => {
  const stdin = new EventEmitter();
  stdin.setEncoding = () => {};
  let out = '';
  const drain = serve(stdin, { write: (s) => (out += s) });
  stdin.emit('data', '{"jsonrpc":"2.0","id":7,"me');
  stdin.emit('data', 'thod":"ping"}\n');
  await drain();
  assert.equal(JSON.parse(out).id, 7);
});

test('a line that is not JSON is a parse error, and the next line still works', async () => {
  const out = await transport('{ not json\n{"jsonrpc":"2.0","id":9,"method":"ping"}\n');
  const lines = out
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  assert.equal(lines[0].error.code, -32700);
  assert.equal(lines[1].id, 9);
});

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

test('the tool is declared read-only and closed-world', () => {
  const tool = TOOLS[0];
  assert.equal(tool.name, 'deckhq_waiting');
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.annotations.openWorldHint, false);
  assert.deepEqual(tool.inputSchema, {
    type: 'object',
    properties: {},
    additionalProperties: false,
  });
});

test('INVARIANT: the server exposes no tool that can write', () => {
  // `docs/01-PRODUCT.md` §2. Acknowledging is the user discharging a debt; a
  // model that can clear the needs-you count can clear it by accident.
  assert.equal(TOOLS.length, 1);
  const source = fs.readFileSync(SERVER, 'utf8');
  assert.equal(/method:\s*['"]POST['"]/.test(source), false);
  assert.equal(/\/api\/(ack|act|send|open|run)/.test(source), false);
});

test('an unknown tool is refused', async () => {
  const response = await handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'deckhq_ack' },
  });
  assert.equal(response.error.code, -32602);
});

test('an unknown method with an id is an error, and without one is silence', async () => {
  assert.equal((await handle({ jsonrpc: '2.0', id: 5, method: 'nope' })).error.code, -32601);
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/whatever' }), null);
});

test('initialize echoes a protocol version the client asked for', async () => {
  const older = await handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05' },
  });
  assert.equal(older.result.protocolVersion, '2024-11-05');

  const none = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.match(none.result.protocolVersion, /^\d{4}-\d{2}-\d{2}$/);
});

test('no daemon is reported as a sentence, not as a tool error', async () => {
  const result = await callWaiting({ find: async () => null });
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /DeckHQ is not running/);
  assert.equal(result.structuredContent, undefined);
});

test('a daemon that throws is reported inside the result', async () => {
  const response = await handle(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'deckhq_waiting' } },
    {
      find: async () => {
        throw new Error('socket hang up');
      },
    },
  );
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /socket hang up/);
});

// ---------------------------------------------------------------------------
// What the queue says
// ---------------------------------------------------------------------------

test('only active agents in a needs-you state are listed, oldest wait first', () => {
  const rows = waitingFrom(SNAPSHOT);
  assert.deepEqual(
    rows.map((a) => a.mk),
    ['MK2.1', 'MK1.1'],
  );
});

test('the rendered queue names the agent, the project and the wait', () => {
  const text = renderWaiting(SNAPSHOT, { now: NOW });
  assert.match(text, /^2 waiting on this machine:/);
  assert.match(text, /Ada — career-ops — finished, for review · 1d/);
  assert.match(text, /MK1\.1 — deckhq — hand up, waiting on an answer · 3h/);
});

test('a transcript line reaches the model as one flat line', () => {
  // The last thing an agent said is text this project did not write: it can
  // carry newlines and escapes, and it ends up in a model's context.
  const text = renderWaiting(SNAPSHOT, { now: NOW });
  assert.match(text, /Done\. Three commits on the branch\./);
  assert.equal(text.includes('Done.\nThree'), false);
});

test('an empty queue is a sentence, not a blank', () => {
  const text = renderWaiting({ agents: [], counts: {} }, { now: NOW });
  assert.match(text, /Nothing is waiting/);
});

test('the queue never scores the human', () => {
  // `docs/plan/08-PLAN-V2-100X.md` §1.1 rule 6.
  const text = renderWaiting(SNAPSHOT, { now: NOW }) + ' ' + TOOLS[0].description;
  for (const word of ['streak', 'behind', 'overdue', 'should have', 'you failed', 'backlog']) {
    assert.equal(text.toLowerCase().includes(word), false, `the queue says "${word}"`);
  }
});
