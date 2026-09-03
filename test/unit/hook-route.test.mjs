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

// ---------------------------------------------------------------------------
// GET /api/hooks — the status the header banner reads
// ---------------------------------------------------------------------------
//
// WP-56. A managed settings key can switch these hooks off over DeckHQ's head
// (docs/DEVIATIONS.md §86.4, §114). The screen has no button for it — there is
// nothing on this side to press — so all it can do is say which key, in which
// file, and the route is what carries that.

/** One adapter's hook status, straight out of the real GET handler. */
async function getStatus(hooks) {
  const registry = {
    applyHook() {},
    setHookStatus() {},
    hookHealthFor: () => ({ eventsSeen: 0, lastEventAt: null, daemonStartedAt: 0 }),
  };
  const adapter = {
    id: 'claude-code',
    label: 'Claude Code',
    hooks: {
      supported: true,
      describe: () => ({ file: '/x/settings.json', json: '{}', events: [], note: '' }),
      installed: async () => true,
      installedPort: async () => 4317,
      ...hooks,
    },
  };
  const router = new Router();
  register(router, {
    registry,
    adapters: { getAdapters: () => [adapter], getAdapter: () => adapter },
    log: silentLog,
    port: 4317,
  });
  const handler = router.match('GET', '/api/hooks');
  assert.ok(handler, 'GET /api/hooks is not registered');
  let payload = '';
  await handler(
    {},
    {
      writeHead() {},
      end: (p) => {
        payload = p;
      },
    },
  );
  return JSON.parse(payload).adapters[0];
}

test('WP-56: /api/hooks carries the managed policy that blocks the hooks', async () => {
  const blocked = { key: 'allowManagedHooksOnly', file: '/etc/claude-code/managed-settings.json' };
  const status = await getStatus({ blockedByPolicy: async () => blocked });
  assert.deepEqual(status.blockedByPolicy, blocked);
});

test('WP-56: blockedByPolicy is null, never absent, when no policy blocks', async () => {
  const status = await getStatus({ blockedByPolicy: async () => null });
  assert.ok('blockedByPolicy' in status);
  assert.equal(status.blockedByPolicy, null);

  // And for an adapter with no such check at all.
  const without = await getStatus({});
  assert.ok('blockedByPolicy' in without);
  assert.equal(without.blockedByPolicy, null);
});

test('WP-56: a policy check that throws never fails the hook status', async () => {
  const status = await getStatus({
    blockedByPolicy: async () => {
      throw new Error('EACCES: permission denied');
    },
  });
  assert.equal(status.error, null);
  assert.equal(status.installed, true);
  assert.equal(status.blockedByPolicy, null);
});

test('WP-56: the policy is checked against the port the hooks actually target', async () => {
  /** @type {any} */
  let seen = null;
  await getStatus({
    installedPort: async () => 4400,
    blockedByPolicy: async (opts) => {
      seen = opts;
      return null;
    },
  });
  assert.equal(seen.port, 4400);
});
