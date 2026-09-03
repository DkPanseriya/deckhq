/**
 * WP-09 · the transcript tail.
 *
 * A reply typed into a terminal has to appear in the open panel without the
 * browser polling for it. `adapter.watchConversation()` is that watch: it
 * reads a bounded tail of the session's own transcript when the file moves,
 * and reports a DIGEST — never the messages — so the panel re-reads through
 * the endpoint it already uses.
 *
 * `CLAUDE_CONFIG_DIR` is read at import time, so the environment is set
 * before the adapter is imported. `node --test` gives every file its own
 * process, so this cannot leak into another test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-tail-'));
const claudeDir = path.join(root, 'claude');
const projectDir = path.join(claudeDir, 'projects', 'C--w-orbital-api');
await fsp.mkdir(projectDir, { recursive: true });
process.env.CLAUDE_CONFIG_DIR = claudeDir;
process.env.DECKHQ_STATE_DIR = path.join(root, 'data');

const { adapter, WATCH_TAIL_BYTES } = await import('../../src/adapters/claude-code/adapter.mjs');

const SESSION_ID = '9e2a4c11-77b6-4f0e-a3d2-1b8c5e6f0a44';
const AGENT_ID = `claude-code:${SESSION_ID}`;
const FILE = path.join(projectDir, `${SESSION_ID}.jsonl`);

/** One transcript record, in the shape the runtime writes. */
function line(role, text, at) {
  return (
    JSON.stringify({
      type: role,
      isSidechain: false,
      cwd: '/w/orbital-api',
      timestamp: new Date(at).toISOString(),
      message: { role, content: [{ type: 'text', text }] },
    }) + '\n'
  );
}

const T0 = Date.parse('2026-09-04T09:00:00.000Z');

/** Wait for `fn()` to be true. The watch is a real filesystem watch. */
async function until(fn, { timeoutMs = 4000, stepMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (fn()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

test('the tail window is bounded, and far smaller than a whole-session read', () => {
  assert.equal(WATCH_TAIL_BYTES, 256 * 1024);
});

test('a reply appended by something else reaches the watcher inside a second', async () => {
  await fsp.writeFile(FILE, line('user', 'why is the build wrong?', T0), 'utf8');
  const seen = [];
  const stop = await adapter.watchConversation(AGENT_ID, {
    onChange: (d) => seen.push(d),
    pollMs: 60,
    debounceMs: 20,
  });
  try {
    // Nothing has changed yet: the first read is the baseline, not an event.
    assert.deepEqual(seen, [], 'opening the panel is not a change');

    const started = Date.now();
    await fsp.appendFile(FILE, line('assistant', 'Because `base` was wrong.', T0 + 1000), 'utf8');
    assert.ok(await until(() => seen.length > 0), 'the append never reached the watcher');
    assert.ok(
      Date.now() - started < 1000,
      'WP-09 asks for the reply within a second; it took longer',
    );
    assert.equal(seen[0].count, 2);
    assert.equal(seen[0].lastRole, 'assistant');
    assert.equal(seen[0].at, T0 + 1000);
  } finally {
    stop();
  }
});

test('the watcher reports a digest, never the conversation', async () => {
  await fsp.writeFile(FILE, line('user', 'a secret nobody asked for', T0), 'utf8');
  const seen = [];
  const stop = await adapter.watchConversation(AGENT_ID, {
    onChange: (d) => seen.push(d),
    pollMs: 60,
    debounceMs: 20,
  });
  try {
    await fsp.appendFile(FILE, line('assistant', 'a secret nobody asked for', T0 + 1), 'utf8');
    assert.ok(await until(() => seen.length > 0));
    // The wire carries three numbers and a role. Not text — the panel reads
    // that through /api/conversation, which is the one bounded, parsed,
    // markdown-rendered path there is.
    assert.deepEqual(Object.keys(seen[0]).sort(), ['at', 'count', 'lastRole']);
    assert.doesNotMatch(JSON.stringify(seen[0]), /secret/);
  } finally {
    stop();
  }
});

test('a touch that changes nothing in the conversation raises nothing', async () => {
  await fsp.writeFile(FILE, line('user', 'hello', T0), 'utf8');
  const seen = [];
  const stop = await adapter.watchConversation(AGENT_ID, {
    onChange: (d) => seen.push(d),
    pollMs: 30,
    debounceMs: 10,
  });
  try {
    // A record the panel does not render: token accounting, a custom title.
    // The file moves; the conversation does not.
    await fsp.appendFile(
      FILE,
      JSON.stringify({ type: 'custom-title', customTitle: 'the build' }) + '\n',
      'utf8',
    );
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(seen, [], 'a non-conversation append woke the panel');
  } finally {
    stop();
  }
});

test('stopping the watch stops the work, and stopping twice is safe', async () => {
  await fsp.writeFile(FILE, line('user', 'hello', T0), 'utf8');
  const seen = [];
  const stop = await adapter.watchConversation(AGENT_ID, {
    onChange: (d) => seen.push(d),
    pollMs: 30,
    debounceMs: 10,
  });
  stop();
  stop();
  await fsp.appendFile(FILE, line('assistant', 'too late', T0 + 5), 'utf8');
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(seen, [], 'a closed panel is still being written to');
});

test('a session with no transcript yet is watched for one appearing', async () => {
  const newId = 'claude-code:0000ffff-0000-4000-8000-00000000cafe';
  const newFile = path.join(projectDir, '0000ffff-0000-4000-8000-00000000cafe.jsonl');
  const seen = [];
  const stop = await adapter.watchConversation(newId, {
    onChange: (d) => seen.push(d),
    pollMs: 40,
    debounceMs: 10,
  });
  try {
    await fsp.writeFile(newFile, line('assistant', 'first words', T0), 'utf8');
    assert.ok(await until(() => seen.length > 0), 'a transcript that appeared was never noticed');
    assert.equal(seen[0].count, 1);
  } finally {
    stop();
    await fsp.rm(newFile, { force: true });
  }
});

test('a listener that throws cannot take the watch down', async () => {
  await fsp.writeFile(FILE, line('user', 'hello', T0), 'utf8');
  let calls = 0;
  const stop = await adapter.watchConversation(AGENT_ID, {
    onChange: () => {
      calls += 1;
      throw new Error('the panel exploded');
    },
    pollMs: 30,
    debounceMs: 10,
  });
  try {
    await fsp.appendFile(FILE, line('assistant', 'one', T0 + 1), 'utf8');
    assert.ok(await until(() => calls >= 1));
    await fsp.appendFile(FILE, line('assistant', 'two', T0 + 2), 'utf8');
    assert.ok(await until(() => calls >= 2), 'the watch stopped after the first throw');
  } finally {
    stop();
  }
});

test('watchConversation never throws, even on a session that does not exist', async () => {
  const stop = await adapter.watchConversation('claude-code:not-a-session', {
    onChange: () => {},
    pollMs: 5000,
  });
  assert.equal(typeof stop, 'function');
  stop();
});

test.after(async () => {
  await fsp.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
