/**
 * The first real `PermissionRequest` this project has ever received, pinned.
 *
 * `docs/DEVIATIONS.md` §134. Every payload in
 * `test/fixtures/permission-request-live.json` is a verbatim copy of what
 * Claude Code 2.1.260 POSTed to `POST /api/permission` on 4 September 2026,
 * with the scratch project's paths — and only those — rewritten. Nothing in
 * it is invented.
 *
 * It exists because it differs from §86.2, which was read out of the 2.1.231
 * binary rather than received:
 *
 *   - there is **no `tool_use_id`**, the field §86.2 called "the natural
 *     correlation key". The route's fallback key is therefore the normal
 *     path, not the exception;
 *   - there is no `agent_id` and no `agent_type`;
 *   - there is a `scratchpad_dir`, which §86.2 does not mention at all;
 *   - `permission_suggestions` carried a `setMode`, not an `addRules`. So the
 *     card that a real Write request produces has NO third button, which is
 *     §97.3 decision 4 working exactly as written.
 *
 * `test/unit/permission-route.test.mjs` keeps driving the §86.2 shape, which
 * is still the documented one and still has to work. This file is the other
 * half: what actually arrived.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Router } from '../../src/http/server.mjs';
import { register } from '../../src/http/routes/permission.mjs';
import { Permissions } from '../../src/core/permissions.mjs';
import * as adapters from '../../src/adapters/index.mjs';
import {
  permissionRequest,
  permissionDecisionBody,
} from '../../src/adapters/claude-code/hooks-summary.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, '../fixtures/permission-request-live.json');
/** @type {any[]} */
const LIVE = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const [allowed, denied] = LIVE;

const silentLog = { error() {}, warn() {}, debug() {}, info() {} };

/**
 * The recorded `cwd` and `file_path` are Windows paths, and `path.relative`
 * on a POSIX runner cannot see that one contains the other — the same shape
 * of host-dependent assertion §114 had to fix. So the basename rule is
 * asserted exactly where the paths are native and by suffix everywhere else.
 * @param {string} summary
 * @param {string} basename
 */
function assertBasename(summary, basename) {
  if (process.platform === 'win32') assert.equal(summary, basename);
  else assert.ok(summary.endsWith(basename), `${summary} does not end with ${basename}`);
}

test('the recorded payload is the one the runtime sent: no tool_use_id, no agent_id', () => {
  assert.equal(LIVE.length, 2, 'both raised hands of the live run are recorded');
  assert.deepEqual(Object.keys(allowed), [
    'session_id',
    'transcript_path',
    'cwd',
    'scratchpad_dir',
    'prompt_id',
    'permission_mode',
    'effort',
    'hook_event_name',
    'tool_name',
    'tool_input',
    'permission_suggestions',
  ]);
  // The three §86.2 fields that did not arrive.
  assert.equal('tool_use_id' in allowed, false);
  assert.equal('agent_id' in allowed, false);
  assert.equal('agent_type' in allowed, false);
  // And the one that arrived without being documented anywhere.
  assert.equal(typeof allowed.scratchpad_dir, 'string');
  assert.equal(allowed.hook_event_name, 'PermissionRequest');
  assert.equal(allowed.permission_mode, 'default');
});

test('the parser reads a live payload: no id, a basename summary, and no third button', () => {
  const request = permissionRequest(allowed);
  assert.ok(request);
  assert.equal(request.sessionId, 'efbe52e9-e69d-446f-8a14-93e1f3e41a10');
  assert.equal(request.tool, 'Write');
  // Inside the session's own cwd, so the basename and nothing else (§97.3
  // decision 3 shows an OUTSIDE path in full; this one is not outside).
  assertBasename(request.summary, 'live-run-1.txt');
  assert.equal(request.requiresUserInteraction, false);
  // No correlation key came with it.
  assert.equal(request.id, '');
  // `setMode` is a wider grant than "Allow for this session" says, so it is
  // dropped and the card offers two buttons, not three.
  assert.deepEqual(request.suggestions, []);
  assert.equal(allowed.permission_suggestions[0].type, 'setMode');
});

test('two live payloads arriving together get distinct keys and two held sockets', () => {
  const calls = [];
  const registry = {
    setPendingPermission: (id, pending) => calls.push(['set', id, pending]),
    clearPendingPermission: (id, requestId) => calls.push(['clear', id, requestId]),
    setAck: (...args) => calls.push(['setAck', ...args]),
  };
  const permissions = new Permissions({ registry, log: silentLog });
  const router = new Router();
  register(router, { registry, adapters, permissions, log: silentLog });
  const handler = router.match('POST', '/api/permission');
  assert.ok(handler);

  /** @param {any} body */
  const post = (body) => {
    const req = new EventEmitter();
    const res = new EventEmitter();
    res.headersSent = false;
    res.writeHead = () => {
      res.headersSent = true;
      return res;
    };
    res.end = () => {
      res.ended = true;
    };
    res.ended = false;
    handler(req, res);
    req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
    return res;
  };

  // The live run's two Writes were milliseconds apart and shared a session.
  // With `tool_use_id` absent, a key of session+timestamp alone could collide
  // and supersede — which would release the first socket and drop its card.
  const first = post(allowed);
  const second = post(denied);

  assert.equal(first.headersSent, false, 'the first socket was answered without a human');
  assert.equal(second.headersSent, false);
  assert.equal(permissions.size, 2, 'one of the two raised hands was lost');

  const set = calls.filter((c) => c[0] === 'set');
  assert.equal(set.length, 2);
  assert.notEqual(set[0][2].id, set[1][2].id, 'two requests were given the same key');
  assertBasename(set[0][2].summary, 'live-run-1.txt');
  assertBasename(set[1][2].summary, 'live-run-2.txt');
  // Nothing user-owned was touched on the way in.
  assert.equal(
    calls.some((c) => c[0] === 'setAck'),
    false,
  );

  // Both sockets are still open; releasing them is the daemon's job.
  permissions.shutdown();
});

test('the two bodies the live runtime accepted, byte for byte', () => {
  // Copied from the daemon's own log of the run (§134): these exact objects
  // were serialised onto the held sockets, and the runtime turned the first
  // into a completed Write and the second into a tool_result reading
  // "Denied from DeckHQ." with no interrupt.
  assert.deepEqual(permissionDecisionBody('allow', []), {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow' },
    },
  });
  assert.deepEqual(permissionDecisionBody('deny', []), {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'deny', message: 'Denied from DeckHQ.' },
    },
  });
  // A live request carries no `addRules`, so "Allow for this session" degrades
  // to a plain allow rather than inventing a rule.
  assert.deepEqual(permissionDecisionBody('session', permissionRequest(allowed).suggestions), {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow' },
    },
  });
});
