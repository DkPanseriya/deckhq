/**
 * POST /api/hook — the wiring between the runtime's payload, the adapter that
 * knows its shape, and the registry.
 *
 * The endpoint answers first and processes on the next tick (it is blocking a
 * live Claude Code while it waits), so every assertion here is made after the
 * queue has drained.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { Router } from '../../src/http/server.mjs';
import { register } from '../../src/http/routes/hooks.mjs';
import * as adapters from '../../src/adapters/index.mjs';

const silentLog = { error() {}, warn() {}, debug() {}, info() {} };

/** A router with the hook routes registered against a recording registry. */
function setup() {
  /** @type {any[]} */
  const applied = [];
  const registry = {
    applyHook: (event) => applied.push(event),
    setHookStatus() {},
    hookHealthFor: () => ({ eventsSeen: 0, lastEventAt: null, daemonStartedAt: 0 }),
  };
  const router = new Router();
  register(router, { registry, adapters, log: silentLog, port: 4317 });
  return { router, applied };
}

/** Drive one POST /api/hook with `body`, then let the deferred work run. */
async function postHook(router, body) {
  const handler = router.match('POST', '/api/hook');
  assert.ok(handler, 'POST /api/hook is not registered');
  const req = new EventEmitter();
  const res = { writeHead() {}, end() {} };
  handler(req, res);
  req.emit('data', Buffer.from(JSON.stringify(body)));
  req.emit('end');
  // `sendJson` then `setImmediate` in the route; one more turn to be sure.
  await new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

test('a PreToolUse payload reaches the registry with the adapter-parsed tool', async () => {
  const { router, applied } = setup();
  await postHook(router, {
    session_id: 'abc',
    cwd: process.cwd(),
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
  });

  assert.equal(applied.length, 1);
  assert.equal(applied[0].hookEvent, 'PreToolUse');
  assert.equal(applied[0].sessionId, 'abc');
  assert.deepEqual(applied[0].tool, { name: 'Bash', summary: 'Bash npm test' });
});

test('every other event carries no tool at all — PostToolUse says only "stop showing one"', async () => {
  const { router, applied } = setup();
  for (const hook_event_name of ['PostToolUse', 'Stop', 'Notification', 'SessionEnd']) {
    await postHook(router, {
      session_id: 'abc',
      cwd: process.cwd(),
      hook_event_name,
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
    });
  }
  assert.equal(applied.length, 4);
  for (const event of applied) assert.equal(event.tool, null, `${event.hookEvent} carried a tool`);
});

test('a runtime with no tool reporting is not an error, it just has no bubble', async () => {
  const { router, applied } = setup();
  await postHook(router, {
    runtime: 'codex',
    session_id: 'abc',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
  });
  assert.equal(applied.length, 1);
  assert.equal(applied[0].tool, null);
});

test('a malformed body is dropped without reaching the registry', async () => {
  const { router, applied } = setup();
  const handler = router.match('POST', '/api/hook');
  const req = new EventEmitter();
  handler(req, { writeHead() {}, end() {} });
  req.emit('data', Buffer.from('{ not json'));
  req.emit('end');
  await new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
  assert.equal(applied.length, 0);
});
