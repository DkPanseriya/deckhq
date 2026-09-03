/**
 * POST /api/permission and POST /api/permission/decide — the route that holds
 * a raised hand open, and the one that answers it. WP-19.
 *
 * The route is driven through fake `IncomingMessage`/`ServerResponse` objects
 * so every assertion can be made about a socket that has NOT been written to
 * yet: "nothing was sent" is the load-bearing state in this feature, and it is
 * not observable from a real HTTP client until the hold has already expired.
 *
 * The registry here records every call made on it. That is how the invariant
 * "a permission decision never touches ackState" is checked structurally
 * rather than by reading the code: the fake carries `setAck`, `act` and
 * `applyHook`, and the tests assert those were never reached.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { Router } from '../../src/http/server.mjs';
import { register } from '../../src/http/routes/permission.mjs';
import { Permissions } from '../../src/core/permissions.mjs';
import * as adapters from '../../src/adapters/index.mjs';

const silentLog = { error() {}, warn() {}, debug() {}, info() {} };

/** A `ServerResponse` stand-in that records what was written to it, if anything. */
function fakeRes() {
  const res = new EventEmitter();
  res.headersSent = false;
  res.status = null;
  res.body = null;
  res.writeHead = (status) => {
    res.headersSent = true;
    res.status = status;
    return res;
  };
  res.end = (payload) => {
    res.ended = true;
    if (payload != null) res.body = String(payload);
  };
  res.ended = false;
  return res;
}

/** The parsed JSON a socket was answered with, or null if it is still open. */
function answer(res) {
  return res.body == null ? null : JSON.parse(res.body);
}

function setup({ holdMs, maxPending } = {}) {
  /** Everything the route did to the registry, in order. */
  const calls = [];
  const registry = {
    setPendingPermission: (id, pending) => calls.push(['set', id, pending]),
    clearPendingPermission: (id, requestId) => calls.push(['clear', id, requestId]),
    // Present so that reaching for them is recorded rather than throwing:
    // a test that says "ackState was never touched" has to be able to see the
    // attempt if it ever happens.
    setAck: (...args) => calls.push(['setAck', ...args]),
    act: (...args) => calls.push(['act', ...args]),
    applyHook: (...args) => calls.push(['applyHook', ...args]),
  };
  const permissions = new Permissions({ registry, log: silentLog, holdMs, maxPending });
  const router = new Router();
  register(router, { registry, adapters, permissions, log: silentLog });
  return { router, calls, permissions, registry };
}

/** A realistic PermissionRequest payload, as the runtime sends it. */
function payload(over = {}) {
  return {
    session_id: 'sess-1',
    cwd: process.cwd(),
    permission_mode: 'default',
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'npm run deploy' },
    tool_use_id: 'toolu_1',
    permission_suggestions: [
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'npm run deploy:*' }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ],
    ...over,
  };
}

/** Fire the hook at the route and return the response object it is holding. */
function postHook(router, body) {
  const handler = router.match('POST', '/api/permission');
  assert.ok(handler, 'POST /api/permission is not registered');
  const req = new EventEmitter();
  const res = fakeRes();
  handler(req, res);
  req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
  req.emit('end');
  return res;
}

/** Answer through the panel's route, and return {status, body}. */
async function postDecide(router, body) {
  const handler = router.match('POST', '/api/permission/decide');
  assert.ok(handler, 'POST /api/permission/decide is not registered');
  const req = new EventEmitter();
  const res = fakeRes();
  const done = handler(req, res);
  req.emit('data', Buffer.from(JSON.stringify(body)));
  req.emit('end');
  await done;
  return { status: res.status, body: answer(res) };
}

// ---------------------------------------------------------------- holding

test('the request is HELD: nothing at all is written back until somebody answers', () => {
  const { router, calls } = setup();
  const res = postHook(router, payload());

  assert.equal(res.headersSent, false, 'the socket was answered without a human');
  assert.equal(res.ended, false);
  // ...and the card is on the session immediately, so the panel can show it.
  const set = calls.find((c) => c[0] === 'set');
  assert.ok(set, 'no pending permission was registered');
  assert.equal(set[1], 'claude-code:sess-1');
  assert.equal(set[2].tool, 'Bash');
  assert.equal(set[2].summary, 'npm run deploy');
  assert.equal(set[2].id, 'toolu_1');
  assert.equal(set[2].suggestions.length, 1);
  assert.equal(typeof set[2].since, 'number');
});

test('INVARIANT: holding, answering and expiring a request never touch ack state', async () => {
  const { router, calls, permissions } = setup({ holdMs: 20 });
  postHook(router, payload());
  await postDecide(router, { id: 'toolu_1', decision: 'allow' });
  postHook(router, payload({ tool_use_id: 'toolu_2' }));
  await new Promise((r) => setTimeout(r, 60));
  permissions.shutdown();

  const forbidden = calls.filter(
    (c) => c[0] === 'setAck' || c[0] === 'act' || c[0] === 'applyHook',
  );
  assert.deepEqual(forbidden, [], 'a permission decision reached the user-owned half of the model');
  // Only the two write-only observed-state methods were ever used.
  for (const c of calls) assert.ok(c[0] === 'set' || c[0] === 'clear', `unexpected call ${c[0]}`);
});

test('a payload the adapter cannot read falls through instead of hanging', () => {
  const { router } = setup();
  for (const body of [
    '{ not json',
    JSON.stringify({}),
    JSON.stringify(payload({ tool_name: '' })),
  ]) {
    const res = postHook(router, body);
    assert.equal(res.status, 200);
    // An empty object is NOT a decision: the runtime falls through to the
    // terminal prompt (docs/DEVIATIONS.md §86.4).
    assert.deepEqual(answer(res), {});
  }
});

test('a runtime with no permission parser is not answered by us', () => {
  const { router } = setup();
  const res = postHook(router, payload({ runtime: 'codex' }));
  assert.deepEqual(answer(res), {});
});

// --------------------------------------------------------------- deciding

test('Allow sends exactly {behavior:"allow"} on the held socket', async () => {
  const { router, calls } = setup();
  const held = postHook(router, payload());
  const out = await postDecide(router, { id: 'toolu_1', decision: 'allow' });

  assert.equal(out.status, 200);
  assert.deepEqual(answer(held), {
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
  });
  assert.equal(held.status, 200);
  // The card comes off the session as the socket is answered.
  assert.ok(calls.some((c) => c[0] === 'clear' && c[2] === 'toolu_1'));
});

test('Deny sends behavior:"deny" with the message, and never interrupt', async () => {
  const { router } = setup();
  const held = postHook(router, payload());
  await postDecide(router, { id: 'toolu_1', decision: 'deny' });

  assert.deepEqual(answer(held), {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'deny', message: 'denied from DeckHQ' },
    },
  });
  assert.doesNotMatch(held.body, /interrupt/);
});

test('INVARIANT: Allow for this session sends destination:"session" and nothing else', async () => {
  const { router } = setup();
  const held = postHook(router, payload());
  await postDecide(router, { id: 'toolu_1', decision: 'session' });

  assert.deepEqual(answer(held), {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: {
        behavior: 'allow',
        updatedPermissions: [
          {
            type: 'addRules',
            rules: [{ toolName: 'Bash', ruleContent: 'npm run deploy:*' }],
            behavior: 'allow',
            destination: 'session',
          },
        ],
      },
    },
  });
  assert.doesNotMatch(held.body, /userSettings|projectSettings|localSettings|cliArg/);
});

test('with no rule to add, "for this session" is refused rather than invented', async () => {
  const { router } = setup();
  const held = postHook(router, payload({ permission_suggestions: [] }));
  const out = await postDecide(router, { id: 'toolu_1', decision: 'session' });
  assert.equal(out.status, 400);
  assert.equal(held.headersSent, false, 'the socket must still be held');
});

test('a tool that must be answered in the session cannot be answered from here', async () => {
  const { router } = setup();
  const held = postHook(router, payload({ tool_name: 'ExitPlanMode', tool_input: {} }));
  for (const decision of ['allow', 'deny']) {
    const out = await postDecide(router, { id: 'toolu_1', decision });
    assert.equal(out.status, 409);
  }
  assert.equal(held.headersSent, false);
});

test('an unknown decision, a missing id and an unknown request are all refused', async () => {
  const { router } = setup();
  postHook(router, payload());
  assert.equal((await postDecide(router, { id: 'toolu_1', decision: 'maybe' })).status, 400);
  assert.equal((await postDecide(router, { decision: 'allow' })).status, 400);
  assert.equal((await postDecide(router, { id: 'nope', decision: 'allow' })).status, 404);
  // The real one is still there, untouched.
  assert.equal((await postDecide(router, { id: 'toolu_1', decision: 'allow' })).status, 200);
});

test('a request answered twice is a 404 the second time, not a second write', async () => {
  const { router } = setup();
  const held = postHook(router, payload());
  assert.equal((await postDecide(router, { id: 'toolu_1', decision: 'allow' })).status, 200);
  const before = held.body;
  assert.equal((await postDecide(router, { id: 'toolu_1', decision: 'deny' })).status, 404);
  assert.equal(held.body, before);
});

// ------------------------------------------------------- falling through

test('INVARIANT: the hold expires into no decision at all — never an auto-allow', async () => {
  const { router, calls } = setup({ holdMs: 20 });
  const held = postHook(router, payload());
  assert.equal(held.headersSent, false);
  await new Promise((r) => setTimeout(r, 80));

  assert.equal(held.status, 200);
  assert.deepEqual(answer(held), {}, 'a timer decided something');
  assert.doesNotMatch(held.body, /behavior|hookSpecificOutput/);
  assert.ok(calls.some((c) => c[0] === 'clear'));
});

test('INVARIANT: shutdown lets every hold go, deciding nothing', () => {
  const { router, permissions } = setup();
  const a = postHook(router, payload());
  const b = postHook(router, payload({ tool_use_id: 'toolu_2' }));
  permissions.shutdown();

  for (const held of [a, b]) {
    assert.deepEqual(answer(held), {});
    assert.doesNotMatch(held.body, /behavior/);
  }
  assert.equal(permissions.size, 0);
});

test('a request whose socket closes is withdrawn — the terminal answered it', () => {
  const { router, calls, permissions } = setup();
  const held = postHook(router, payload());
  assert.equal(permissions.size, 1);
  held.emit('close');
  assert.equal(permissions.size, 0);
  assert.ok(calls.some((c) => c[0] === 'clear' && c[2] === 'toolu_1'));
  // Never written to: writing to a socket the runtime has abandoned is how a
  // hold turns into an unhandled error.
  assert.equal(held.headersSent, false);
});

test('the held map is capped, and sheds its oldest into the terminal prompt', () => {
  const { router, permissions } = setup({ maxPending: 2 });
  const a = postHook(router, payload({ tool_use_id: 'a' }));
  const b = postHook(router, payload({ tool_use_id: 'b' }));
  const c = postHook(router, payload({ tool_use_id: 'c' }));

  assert.equal(permissions.size, 2);
  assert.deepEqual(answer(a), {}, 'the oldest is released with no decision');
  assert.equal(b.headersSent, false);
  assert.equal(c.headersSent, false);
});

test('a repeated tool_use_id replaces the older socket rather than orphaning it', () => {
  const { router, permissions } = setup();
  const first = postHook(router, payload());
  const second = postHook(router, payload());
  assert.equal(permissions.size, 1);
  assert.deepEqual(answer(first), {});
  assert.equal(second.headersSent, false);
});

test('nothing is held once the daemon has begun shutting down', () => {
  const { router, permissions } = setup();
  permissions.shutdown();
  const res = postHook(router, payload());
  assert.deepEqual(answer(res), {});
});
