// A machine of our own, before anything under `src/` is loaded.
// `docs/DEVIATIONS.md` §124.
import { HOME } from '../helpers/isolate.mjs';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  extractExecEvent,
  extractMessage,
  extractSessionMeta,
  extractUsage,
  sessionIdFromFilename,
  turnBoundary,
  isInjectedUserContext,
} from '../../src/adapters/codex/parse.mjs';
import { adapter } from '../../src/adapters/codex/adapter.mjs';

/**
 * WP-23 (`docs/DEVIATIONS.md` §137, `docs/plan/CODEX-VERIFICATION.md` §6).
 *
 * Everything here pins a shape that was MEASURED against a real codex-cli
 * 0.153.1 rollout on 4 September 2026 and that this package had wrong. The
 * fixture beside it is **synthetic** — `ADAPTERS.md` §7: no real path, no real
 * project name, no real prompt — and shaped like the real file rather than
 * copied from it. Its numbers are round so that a wrong answer is legible:
 * turn one spends 1000/10, turn two 1100/12, and the thread 2100/22.
 *
 * These live in a file of their own because they need `~/.codex` to EXIST in
 * the isolated home, and `codex-parse.test.mjs` asserts the opposite —
 * `adapter.available()` is cached for the life of a process, so the two
 * conditions cannot share one.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'codex-two-turn.jsonl');
const SESSION_ID = '5b1f6e2a-1234-4abc-9def-000000000002';

// Plant it before any adapter call: `available()` caches its first answer.
const sessionsDir = path.join(HOME, '.codex', 'sessions', '2026', '08', '21');
fs.mkdirSync(sessionsDir, { recursive: true });
fs.copyFileSync(FIXTURE, path.join(sessionsDir, `rollout-2026-08-21T09-00-00-${SESSION_ID}.jsonl`));

// ---------------------------------------------------------------------------
// §4 — `originator` is a client name, never a working directory
// ---------------------------------------------------------------------------

test('extractSessionMeta: originator is not a cwd fallback', () => {
  // MEASURED: 0.153.1 writes 'Codex Desktop' from the app and 'codex_exec'
  // from the CLI. The old chain (cwd -> originator -> workdir) would have put
  // the session in a room called "Codex Desktop".
  const meta = extractSessionMeta({
    type: 'session_meta',
    payload: { id: 'x', originator: 'Codex Desktop', cli_version: '0.153.1' },
  });
  assert.equal(meta.cwd, null);
});

test('extractSessionMeta: cwd, then workdir, and nothing else', () => {
  assert.equal(
    extractSessionMeta({ payload: { id: 'x', cwd: '/a', workdir: '/b', originator: 'app' } }).cwd,
    '/a',
  );
  assert.equal(
    extractSessionMeta({ payload: { id: 'x', workdir: '/b', originator: 'app' } }).cwd,
    '/b',
  );
});

// ---------------------------------------------------------------------------
// §5 — injected context is not a message
// ---------------------------------------------------------------------------

test('isInjectedUserContext: a user record that does not claim user.text is context', () => {
  assert.equal(
    isInjectedUserContext({
      role: 'user',
      internal_chat_message_metadata_passthrough: {
        content_item_kinds: ['plugins.recommendations', 'environments.environment_context'],
      },
    }),
    true,
  );
});

test('isInjectedUserContext: a real prompt, an assistant reply, and an old record are not', () => {
  assert.equal(
    isInjectedUserContext({
      role: 'user',
      internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] },
    }),
    false,
  );
  // MEASURED: an assistant record declares ['unknown'] and must never be eaten
  // by this rule.
  assert.equal(
    isInjectedUserContext({
      role: 'assistant',
      internal_chat_message_metadata_passthrough: { content_item_kinds: ['unknown'] },
    }),
    false,
  );
  // A rollout written before the field existed behaves exactly as it did.
  assert.equal(isInjectedUserContext({ role: 'user' }), false);
  assert.equal(isInjectedUserContext({ role: 'user', content: 'hi' }), false);
});

test('extractMessage: the injected user record is dropped, the typed one is kept', () => {
  const injected = {
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: '<recommended_plugins>…</recommended_plugins>' }],
      internal_chat_message_metadata_passthrough: {
        content_item_kinds: ['plugins.recommendations'],
      },
    },
  };
  assert.equal(extractMessage(injected), null);

  const typed = {
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'rename the widget helper' }],
      internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] },
    },
  };
  assert.deepEqual(extractMessage(typed), {
    role: 'user',
    text: 'rename the widget helper',
    at: null,
  });
});

// ---------------------------------------------------------------------------
// §7 — only `thread_token_usage` counts the thread
// ---------------------------------------------------------------------------

test('extractUsage: thread_token_usage is thread-scoped and wins over the turn beside it', () => {
  const rec = {
    type: 'token_usage_record',
    payload: {
      usage: { input_tokens: 1100, output_tokens: 12, cached_input_tokens: 900 },
      turn_token_usage: { input_tokens: 1100, output_tokens: 12, cached_input_tokens: 900 },
      thread_token_usage: { input_tokens: 2100, output_tokens: 22, cached_input_tokens: 1000 },
    },
  };
  assert.deepEqual(extractUsage(rec), {
    inputTokens: 2100,
    outputTokens: 22,
    cachedInputTokens: 1000,
    scope: 'thread',
  });
});

test('extractUsage: token_count total_token_usage is turn-scoped, whatever it is called', () => {
  // MEASURED: on a resumed session `total_token_usage` counts the CLI process,
  // so its "total" is the newest turn. Calling it cumulative halved the floor.
  const rec = {
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { input_tokens: 1100, output_tokens: 12, cached_input_tokens: 900 },
        last_token_usage: { input_tokens: 1100, output_tokens: 12, cached_input_tokens: 900 },
      },
    },
  };
  assert.deepEqual(extractUsage(rec), {
    inputTokens: 1100,
    outputTokens: 12,
    cachedInputTokens: 900,
    scope: 'turn',
  });
});

// ---------------------------------------------------------------------------
// §9 — turns are bracketed, so the state is read rather than guessed
// ---------------------------------------------------------------------------

test('turnBoundary: task_started opens a turn and task_complete closes it', () => {
  assert.equal(turnBoundary({ type: 'event_msg', payload: { type: 'task_started' } }), 'started');
  assert.equal(turnBoundary({ type: 'event_msg', payload: { type: 'task_complete' } }), 'ended');
  assert.equal(turnBoundary({ type: 'turn.started' }), 'started');
  assert.equal(turnBoundary({ type: 'turn.completed' }), 'ended');
  assert.equal(turnBoundary({ type: 'turn.failed' }), 'ended');
  assert.equal(turnBoundary({ type: 'response_item', payload: { type: 'message' } }), null);
  assert.equal(turnBoundary(null), null);
});

// ---------------------------------------------------------------------------
// §10 — `codex exec --json` is a different schema from the rollout
// ---------------------------------------------------------------------------

test('extractExecEvent: reads the exec stream the rollout extractors cannot', () => {
  // Every line here is the shape of a line MEASURED from a real
  // `codex exec resume … --json` run; the text is ours.
  assert.equal(extractExecEvent({ type: 'thread.started', thread_id: 'x' }), null);
  assert.equal(extractExecEvent({ type: 'turn.started' }), null);
  assert.deepEqual(
    extractExecEvent({
      type: 'item.completed',
      item: { id: 'item_0', type: 'agent_message', text: 'OK' },
    }),
    { kind: 'assistant', text: 'OK' },
  );
  assert.deepEqual(
    extractExecEvent({
      type: 'item.completed',
      item: { id: 'item_0', type: 'error', message: 'model metadata not found' },
    }),
    { kind: 'error', text: 'model metadata not found' },
  );
  assert.deepEqual(extractExecEvent({ type: 'error', message: 'status 400' }), {
    kind: 'error',
    text: 'status 400',
  });
  assert.deepEqual(extractExecEvent({ type: 'turn.failed', error: { message: 'status 400' } }), {
    kind: 'error',
    text: 'status 400',
  });
});

test('extractExecEvent: an exec event is not mistaken for a rollout message', () => {
  // The bug this pins: `extractMessage` returns null for every exec event, so
  // a send() that worked fell through to `stdout.trim()` and put the whole
  // JSONL stream in the panel as the assistant's reply.
  const ev = { type: 'item.completed', item: { type: 'agent_message', text: 'OK' } };
  assert.equal(extractMessage(ev), null);
  assert.equal(extractExecEvent(ev).text, 'OK');
});

// ---------------------------------------------------------------------------
// §136.2's filename, now that compressed journals are walked
// ---------------------------------------------------------------------------

test('sessionIdFromFilename: a compressed rollout still yields its uuid', () => {
  assert.equal(
    sessionIdFromFilename(`rollout-2026-08-21T09-00-00-${SESSION_ID}.jsonl`),
    SESSION_ID,
  );
  assert.equal(
    sessionIdFromFilename(`rollout-2026-08-21T09-00-00-${SESSION_ID}.jsonl.zst`),
    SESSION_ID,
  );
});

// ---------------------------------------------------------------------------
// End to end, over a planted two-turn rollout
// ---------------------------------------------------------------------------

test('scanSessions: a two-turn rollout summarises the way the real one did', async () => {
  const sessions = await adapter.scanSessions();
  assert.equal(sessions.length, 1);
  const s = sessions[0];

  assert.equal(s.id, `codex:${SESSION_ID}`);
  assert.equal(s.runtime, 'codex');
  // The room. Not 'unknown', and not the originator.
  assert.equal(s.cwd, 'C:\\Dk\\Projects\\demo-app');
  // The title is what somebody typed, not the context Codex injected ahead of
  // it — this read `<recommended_plugins> Here is a list of…` on every Codex
  // session on the floor until WP-23.
  assert.equal(s.title, 'rename the widget helper');
  assert.equal(s.hasCustomTitle, false);
  // The thread total (2100 + 22), not the last turn's (1100 + 12).
  assert.equal(s.tokens, 2122);
  assert.equal(s.cacheTokens, 1000);
  assert.notEqual(s.costEstimate, 0);
  assert.equal(s.model, 'gpt-5-codex-mini');
  assert.equal(s.lastRole, 'assistant');
  assert.equal(s.turnEnded, true);
});

test('conversation: two turns, no injected context, no tool artefacts', async () => {
  const messages = await adapter.conversation(`codex:${SESSION_ID}`);
  assert.deepEqual(
    messages.map((m) => [m.role, m.text]),
    [
      ['user', 'rename the widget helper'],
      ['assistant', 'Renamed it.'],
      ['user', 'now run the tests'],
      ['assistant', 'All tests pass.'],
    ],
  );
  for (const m of messages) {
    assert.doesNotMatch(m.text, /\[tool:/);
    assert.doesNotMatch(m.text, /<recommended_plugins>/);
    assert.doesNotMatch(m.text, /<environment_context>/);
  }
});
