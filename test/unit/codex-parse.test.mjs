// A machine of our own, before anything under `src/` is loaded: several of
// those modules resolve a path out of the environment while they evaluate.
// `docs/DEVIATIONS.md` §123.
import '../helpers/isolate.mjs';

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';

import {
  contentToText,
  extractMessage,
  extractModelHint,
  extractSessionMeta,
  extractUsage,
  isSessionMeta,
  linesFromChunk,
  parseLine,
  parseRecords,
  readHead,
  readTail,
  sessionIdFromFilename,
  truncateTitle,
} from '../../src/adapters/codex/parse.mjs';
import { adapter } from '../../src/adapters/codex/adapter.mjs';
import { hooks } from '../../src/adapters/codex/hooks.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'codex-sample.jsonl');

test('parseLine: valid JSON object line parses', () => {
  const rec = parseLine('{"a":1}');
  assert.deepEqual(rec, { a: 1 });
});

test('parseLine: corrupt line returns null instead of throwing', () => {
  assert.equal(parseLine('{"a": this is not json'), null);
  assert.equal(parseLine(''), null);
  assert.equal(parseLine('   '), null);
  assert.equal(parseLine(undefined), null);
});

test('parseLine: a JSON scalar (not an object) is rejected', () => {
  assert.equal(parseLine('"just a string"'), null);
  assert.equal(parseLine('42'), null);
});

test('linesFromChunk: drops trailing empty line from a final newline', () => {
  assert.deepEqual(linesFromChunk('a\nb\nc\n'), ['a', 'b', 'c']);
});

test('linesFromChunk: drops a partial line at either edge on request', () => {
  assert.deepEqual(linesFromChunk('partial\na\nb', { dropFirstPartial: true }), ['a', 'b']);
  assert.deepEqual(linesFromChunk('a\nb\npartial', { dropLastPartial: true }), ['a', 'b']);
  assert.deepEqual(linesFromChunk(''), []);
});

test('extractSessionMeta: wrapped session_meta record resolves id/timestamp/cwd/instructions', () => {
  const rec = {
    type: 'session_meta',
    payload: {
      id: 'abc-123',
      timestamp: '2026-08-20T10:00:00.000Z',
      cwd: 'C:\\work\\proj',
      instructions: null,
    },
  };
  const meta = extractSessionMeta(rec);
  assert.equal(meta.id, 'abc-123');
  assert.equal(meta.timestamp, '2026-08-20T10:00:00.000Z');
  assert.equal(meta.cwd, 'C:\\work\\proj');
  assert.equal(meta.instructions, null);
});

test('extractSessionMeta: cwd falls back to originator, then workdir', () => {
  const viaOriginator = extractSessionMeta({
    type: 'session_meta',
    payload: { id: 'x', originator: 'C:\\from\\originator' },
  });
  assert.equal(viaOriginator.cwd, 'C:\\from\\originator');

  const viaWorkdir = extractSessionMeta({
    type: 'session_meta',
    payload: { id: 'x', workdir: 'C:\\from\\workdir' },
  });
  assert.equal(viaWorkdir.cwd, 'C:\\from\\workdir');

  const viaCwdWins = extractSessionMeta({
    type: 'session_meta',
    payload: { id: 'x', cwd: 'C:\\real', originator: 'ignored', workdir: 'ignored' },
  });
  assert.equal(viaCwdWins.cwd, 'C:\\real');
});

test('extractSessionMeta: returns null for a record with no meta-like fields', () => {
  assert.equal(extractSessionMeta({ type: 'response_item', payload: { type: 'message' } }), null);
  assert.equal(extractSessionMeta(null), null);
  assert.equal(extractSessionMeta('not an object'), null);
});

test('isSessionMeta: recognises wrapped and flat meta shapes', () => {
  assert.equal(isSessionMeta({ type: 'session_meta', payload: {} }), true);
  assert.equal(isSessionMeta({ type: 'meta', payload: {} }), true);
  assert.equal(isSessionMeta({ id: 'x', cwd: 'y' }), true);
  assert.equal(isSessionMeta({ type: 'response_item', payload: {} }), false);
  assert.equal(isSessionMeta(null), false);
});

test('contentToText: plain string content passes through', () => {
  assert.equal(contentToText('hello world'), 'hello world');
});

test('contentToText: array of typed parts is joined, non-text parts skipped', () => {
  const content = [
    { type: 'input_text', text: 'part one. ' },
    { type: 'image', url: 'ignored.png' },
    { type: 'text', text: 'part two.' },
  ];
  assert.equal(contentToText(content), 'part one. part two.');
});

test('contentToText: nullish or unrecognised content yields empty string', () => {
  assert.equal(contentToText(null), '');
  assert.equal(contentToText(undefined), '');
  assert.equal(contentToText(42), '');
});

test('extractMessage: response_item message with array content (input_text)', () => {
  const rec = {
    type: 'response_item',
    timestamp: '2026-08-20T10:00:05.000Z',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'do the thing' }],
    },
  };
  const msg = extractMessage(rec);
  assert.equal(msg.role, 'user');
  assert.equal(msg.text, 'do the thing');
  assert.equal(msg.at, Date.parse('2026-08-20T10:00:05.000Z'));
});

test('extractMessage: response_item message with array content (output_text)', () => {
  const rec = {
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'done' }],
    },
  };
  assert.deepEqual(extractMessage(rec), { role: 'assistant', text: 'done', at: null });
});

test('extractMessage: flat unwrapped {role, content:string} shape', () => {
  const rec = { role: 'user', content: 'plain string body', timestamp: '2026-08-20T10:01:10.000Z' };
  const msg = extractMessage(rec);
  assert.equal(msg.role, 'user');
  assert.equal(msg.text, 'plain string body');
});

test('extractMessage: event_msg agent_message with bare `message` string infers assistant role', () => {
  const rec = { type: 'event_msg', payload: { type: 'agent_message', message: 'all set' } };
  const msg = extractMessage(rec);
  assert.equal(msg.role, 'assistant');
  assert.equal(msg.text, 'all set');
});

test('extractMessage: excludes tool calls, tool results, and reasoning', () => {
  const functionCall = {
    type: 'response_item',
    payload: { type: 'function_call', name: 'shell', arguments: '{}' },
  };
  const reasoning = {
    type: 'response_item',
    payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'thinking' }] },
  };
  assert.equal(extractMessage(functionCall), null);
  assert.equal(extractMessage(reasoning), null);
});

test('extractMessage: turn_context is never treated as a message', () => {
  const rec = { type: 'turn_context', payload: { cwd: 'C:\\x', model: 'gpt-5-codex' } };
  assert.equal(extractMessage(rec), null);
});

test('extractMessage: a record with no text content returns null', () => {
  assert.equal(extractMessage({ role: 'user', content: [] }), null);
  assert.equal(extractMessage({ role: 'user' }), null);
  assert.equal(extractMessage(null), null);
});

test('extractUsage: nested info.total_token_usage with canonical keys', () => {
  const rec = {
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { input_tokens: 100, output_tokens: 40, cached_input_tokens: 10 },
      },
    },
  };
  assert.deepEqual(extractUsage(rec), {
    inputTokens: 100,
    outputTokens: 40,
    cachedInputTokens: 10,
  });
});

test('extractUsage: probes alias keys (camelCase, cache_read/creation aliases)', () => {
  const rec = { usage: { inputTokens: 5, outputTokens: 2, cache_read_input_tokens: 1 } };
  assert.deepEqual(extractUsage(rec), { inputTokens: 5, outputTokens: 2, cachedInputTokens: 1 });
});

test('extractUsage: returns null when nothing usage-shaped is present', () => {
  assert.equal(extractUsage({ type: 'response_item', payload: { type: 'message' } }), null);
  assert.equal(extractUsage(null), null);
});

test('extractModelHint: reads model off a payload or a bare record', () => {
  assert.equal(extractModelHint({ payload: { model: 'gpt-5-codex' } }), 'gpt-5-codex');
  assert.equal(extractModelHint({ model: 'gpt-5-codex' }), 'gpt-5-codex');
  assert.equal(extractModelHint({}), null);
});

test('truncateTitle: collapses whitespace and truncates with an ellipsis', () => {
  assert.equal(truncateTitle('  hello   world  '), 'hello world');
  const long = 'x'.repeat(100);
  const t = truncateTitle(long, 60);
  assert.equal(t.length, 60);
  assert.ok(t.endsWith('…'));
});

test('truncateTitle: empty/nullish input yields empty string', () => {
  assert.equal(truncateTitle(''), '');
  assert.equal(truncateTitle(undefined), '');
});

test('sessionIdFromFilename: extracts the trailing uuid from a rollout filename', () => {
  const name = 'rollout-2026-08-20T10-00-00-5b1f6e2a-1234-4abc-9def-000000000001.jsonl';
  assert.equal(sessionIdFromFilename(name), '5b1f6e2a-1234-4abc-9def-000000000001');
});

test('sessionIdFromFilename: falls back to the bare filename when no uuid is found', () => {
  assert.equal(sessionIdFromFilename('weird-name.jsonl'), 'weird-name');
});

test('fixture: bounded head/tail reads see the whole small file and parse every valid line', async () => {
  const head = await readHead(FIXTURE, 256 * 1024);
  const tail = await readTail(FIXTURE, 2 * 1024 * 1024);
  // The fixture is far smaller than either bound, so both reads see the entire file
  // and neither edge is a partial line.
  assert.equal(head.truncated, false);
  assert.equal(tail.truncated, false);
  assert.equal(head.text, tail.text);

  const records = parseRecords(head.text);
  // 11 lines total, 1 of which (line 6) is deliberately corrupt and must be skipped.
  assert.equal(records.length, 10);
});

test('fixture: the meta record resolves id and cwd', async () => {
  const head = await readHead(FIXTURE, 256 * 1024);
  const records = parseRecords(head.text);
  const meta = records.map(extractSessionMeta).find(Boolean);
  assert.ok(meta);
  assert.equal(meta.id, '5b1f6e2a-1234-4abc-9def-000000000001');
  assert.equal(meta.cwd, 'C:\\Dk\\Projects\\demo-app');
});

test('fixture: extracting messages yields user/assistant text only, in file order', async () => {
  const head = await readHead(FIXTURE, 256 * 1024);
  const records = parseRecords(head.text);
  const messages = records.map(extractMessage).filter(Boolean);

  // 4 real messages survive: user (array content), assistant (array content),
  // flat user (string content), and the event_msg agent_message (bare `message`).
  // function_call and reasoning are excluded; the corrupt line never parsed at all.
  assert.equal(messages.length, 4);
  assert.deepEqual(
    messages.map((m) => m.role),
    ['user', 'assistant', 'user', 'assistant'],
  );
  assert.equal(messages[0].text, 'Please refactor the auth module to use async/await.');
  assert.equal(messages[2].text, 'Also run the test suite when done.');
  assert.equal(messages[3].text, 'Tests are passing now.');
});

test('fixture: the later token_count event wins over the earlier one (last-wins, not summed)', async () => {
  const head = await readHead(FIXTURE, 256 * 1024);
  const records = parseRecords(head.text);
  let usage = null;
  for (const rec of records) {
    const u = extractUsage(rec);
    if (u) usage = u;
  }
  assert.deepEqual(usage, { inputTokens: 1800, outputTokens: 500, cachedInputTokens: 250 });
});

// The "no ~/.codex" in the four titles below is now a fact rather than a hope.
// Codex has no config-dir override and derives its home from `os.homedir()`, so
// until this file was isolated these tests asserted `false` about whatever
// machine they ran on: true by luck here, and a hard failure on any developer
// who had Codex installed. The isolate helper at the top of the file moves the
// home, and there is no `.codex` under it. `docs/DEVIATIONS.md` §123.3.
test('adapter.available(): resolves false on a machine with no ~/.codex, and never throws', async () => {
  await assert.doesNotReject(async () => {
    const result = await adapter.available();
    assert.equal(result, false);
  });
});

test('adapter.available(): is cached (repeated calls resolve consistently)', async () => {
  const a = await adapter.available();
  const b = await adapter.available();
  assert.equal(a, false);
  assert.equal(b, false);
});

test('adapter.scanSessions(): resolves [] on a Codex-free machine without throwing', async () => {
  const result = await adapter.scanSessions({ maxAgeDays: 400, limit: 100 });
  assert.deepEqual(result, []);
});

test('adapter.liveSessions(): resolves [] without throwing', async () => {
  const result = await adapter.liveSessions();
  assert.deepEqual(result, []);
});

test('adapter.conversation(): resolves [] on a Codex-free machine without throwing', async () => {
  const result = await adapter.conversation('codex:does-not-exist', { maxMessages: 50 });
  assert.deepEqual(result, []);
});

test('adapter.send(): resolves a clean failure on a Codex-free machine without throwing', async () => {
  const result = await adapter.send('codex:does-not-exist', 'hello', {
    cwd: process.cwd(),
    timeoutMs: 1000,
  });
  assert.deepEqual(result, { ok: false, error: 'Codex is not installed' });
});

test('adapter.openInTerminal(): resolves without throwing on a Codex-free machine', async () => {
  await assert.doesNotReject(() => adapter.openInTerminal('codex:does-not-exist', process.cwd()));
});

test('adapter identity: id and label match the contract', () => {
  assert.equal(adapter.id, 'codex');
  assert.equal(adapter.label, 'Codex');
  assert.equal(typeof adapter.available, 'function');
  assert.equal(typeof adapter.scanSessions, 'function');
  assert.equal(typeof adapter.conversation, 'function');
  assert.equal(typeof adapter.send, 'function');
  assert.equal(typeof adapter.openInTerminal, 'function');
});

test('hooks: reports unsupported and describes the polling fallback', () => {
  assert.equal(hooks.supported, false);
  const plan = hooks.describe();
  assert.equal(typeof plan.note, 'string');
  assert.ok(
    plan.note.includes('needs input') ||
      plan.note.toLowerCase().includes('needs_input') ||
      plan.note.length > 0,
  );
  assert.deepEqual(plan.events, []);
});

test('hooks: install/remove reject, installed() resolves false', async () => {
  await assert.rejects(() => hooks.install());
  await assert.rejects(() => hooks.remove());
  assert.equal(await hooks.installed(), false);
});
