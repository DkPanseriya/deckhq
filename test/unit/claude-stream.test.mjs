/**
 * WP-09 · the streamed send.
 *
 * Two halves, both here because they are one contract:
 *
 *  1. `createStreamParser` over a recorded `--output-format stream-json`
 *     transcript. Pure; no process.
 *  2. `adapter.send()` over a FAKE `claude` — a real child process replaying
 *     that same transcript through a real pipe (test/fixtures/fake-claude.mjs).
 *     The login on this machine is expired, so this is as close to the real
 *     binary as the adapter can be driven; everything except the model is
 *     genuine, including the argv, the chunk boundaries, the exit code and
 *     the kill. docs/DEVIATIONS.md §115.
 *
 * The fixtures say what is recorded and what is reconstructed, on their own
 * first line. Nothing here claims a live run happened.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStreamParser, MAX_LINE_BYTES } from '../../src/adapters/claude-code/stream.mjs';
import { adapter, sendArgs, sendSpawnOptions } from '../../src/adapters/claude-code/adapter.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, '../fixtures/claude-stream-json.ndjson');
const ERROR_FIXTURE = path.resolve(HERE, '../fixtures/claude-stream-json-error.ndjson');
const FAKE_CLI = path.resolve(HERE, '../fixtures/fake-claude.mjs');

const SESSION = 'claude-code:7c1f9a20-0d3e-4d61-9a2b-5f0e2c8b41aa';

/** Run a whole text through a parser and collect what it emitted. */
function drive(text, { chunkSize } = {}) {
  const events = [];
  const parser = createStreamParser((e) => events.push(e));
  if (chunkSize) {
    for (let i = 0; i < text.length; i += chunkSize) parser.push(text.slice(i, i + chunkSize));
  } else {
    parser.push(text);
  }
  parser.end();
  return events;
}

const fixture = fs.readFileSync(FIXTURE, 'utf8');
const errorFixture = fs.readFileSync(ERROR_FIXTURE, 'utf8');

/**
 * The fake CLI, reached through `send()`'s `bin` seam. Its whole
 * configuration travels in the child's environment, so the argv it receives
 * is exactly the argv the real binary would have — which is what makes
 * asserting that argv worth anything.
 * @param {{mode?:string, fixture?:string, delayMs?:number, dir?:string}} [o]
 */
function fakeBin(o = {}) {
  const env = { ...process.env };
  env.FAKE_CLAUDE_MODE = o.mode || 'replay';
  env.FAKE_CLAUDE_FIXTURE = o.fixture || FIXTURE;
  if (o.delayMs) env.FAKE_CLAUDE_DELAY_MS = String(o.delayMs);
  if (o.dir) {
    env.FAKE_CLAUDE_ARGV_FILE = path.join(o.dir, 'argv.json');
    env.FAKE_CLAUDE_PID_FILE = path.join(o.dir, 'pid');
  }
  return { command: process.execPath, args: [FAKE_CLI], env };
}

async function tmpDir(tag) {
  return fsp.mkdtemp(path.join(os.tmpdir(), `deckhq-${tag}-`));
}

/**
 * Remove a temp directory. Retried, because a child killed a millisecond ago
 * can still hold a handle on Windows and `rmdir` answers EBUSY — which is the
 * test cleaning up, not the thing under test.
 */
async function rmDir(dir) {
  await fsp.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

/** Is this pid still a running process? Same reading as the adapter's. */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return !!err && err.code === 'EPERM';
  }
}

/** Poll until `fn()` is true, or give up. Windows takes a beat to reap. */
async function until(fn, { timeoutMs = 5000, stepMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

// --------------------------------------------------------------- the parser

test('the recorded stream produces the reply a fragment at a time, in order', () => {
  const events = drive(fixture);
  const deltas = events.filter((e) => e.type === 'delta').map((e) => e.text);
  assert.deepEqual(deltas, [
    'Right — ',
    'reading the build config ',
    'first.',
    'Found it: `base` was ',
    '`/`, so every asset resolved ',
    'against the wrong root.',
  ]);
  // Joined, the deltas ARE the reply. That is the whole promise of the
  // package: the panel can print them as they land and end up with the same
  // text the transcript will hold.
  assert.equal(
    deltas.slice(3).join(''),
    'Found it: `base` was `/`, so every asset resolved against the wrong root.',
  );
});

test('the turn is accepted before any of it has been written', () => {
  const events = drive(fixture);
  const acceptedAt = events.findIndex((e) => e.type === 'accepted');
  const firstDelta = events.findIndex((e) => e.type === 'delta');
  assert.ok(acceptedAt !== -1, 'no accepted event');
  assert.ok(acceptedAt < firstDelta, 'the composer would be held until the first word');
  assert.equal(events[acceptedAt].sessionId, '7c1f9a20-0d3e-4d61-9a2b-5f0e2c8b41aa');
  assert.equal(events[acceptedAt].model, 'claude-sonnet-4-6');
});

test('a tool the agent picks up is reported once, by name, with no directory tree in it', () => {
  const tools = drive(fixture).filter((e) => e.type === 'tool');
  assert.equal(tools.length, 1, 'the streamed start and the whole message must not both count');
  assert.equal(tools[0].name, 'Read');
  // SECURITY-adjacent, and the same rule as DEVIATIONS §89 decision 5: the
  // basename only, so somebody else's paths never land in a screenshot.
  assert.equal(tools[0].summary, 'Read vite.config.ts');
  assert.doesNotMatch(tools[0].summary, /orbital-api|[\\/]/);
});

test('prose is never printed twice when partial messages are on', () => {
  const events = drive(fixture);
  assert.equal(
    events.filter((e) => e.type === 'text').length,
    0,
    'a whole assistant message must not repeat prose the deltas already carried',
  );
});

test('with no partial messages the whole assistant messages become the stream', () => {
  // What an older CLI, or one that refused `--include-partial-messages`,
  // emits. Exactly one of the two paths ever produces text.
  const withoutPartials = fixture
    .split('\n')
    .filter((l) => !l.includes('"type":"stream_event"'))
    .join('\n');
  const events = drive(withoutPartials);
  assert.equal(events.filter((e) => e.type === 'delta').length, 0);
  assert.deepEqual(
    events.filter((e) => e.type === 'text').map((e) => e.text),
    [
      'Right — reading the build config first.',
      'Found it: `base` was `/`, so every asset resolved against the wrong root.',
    ],
  );
  // And the tool is still reported, from the whole message this time.
  assert.deepEqual(
    events.filter((e) => e.type === 'tool').map((e) => e.summary),
    ['Read vite.config.ts'],
  );
});

test('thinking and half-built tool arguments are not the agent’s reply', () => {
  // The fixture streams a `thinking_delta` and an `input_json_delta`. Neither
  // is prose and neither may reach the panel as prose.
  const text = drive(fixture)
    .filter((e) => e.type === 'delta' || e.type === 'text')
    .map((e) => e.text)
    .join('');
  assert.doesNotMatch(text, /culprit/, 'private reasoning leaked into the reply');
  assert.doesNotMatch(text, /file_path/, 'a tool argument leaked into the reply');
});

test('the result carries the answer, the session id and the cost', () => {
  const result = drive(fixture).find((e) => e.type === 'result');
  assert.ok(result);
  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.equal(
    result.text,
    'Found it: `base` was `/`, so every asset resolved against the wrong root.',
  );
  assert.equal(result.sessionId, '7c1f9a20-0d3e-4d61-9a2b-5f0e2c8b41aa');
  assert.equal(result.durationMs, 5210);
  assert.equal(result.costUsd, 0.0412);
});

test('`is_error` decides, not `subtype` — the recorded failure says "success"', () => {
  // Verbatim from a real run with an expired login: subtype "success" beside
  // is_error true. Reading the subtype would report an authentication failure
  // as the agent's reply.
  assert.match(errorFixture, /"subtype":"success"/);
  assert.match(errorFixture, /"is_error":true/);
  const result = drive(errorFixture).find((e) => e.type === 'result');
  assert.equal(result.ok, false);
  assert.equal(result.text, '');
  assert.match(result.error, /OAuth access token has expired/);
});

test('a chunk boundary anywhere in the stream changes nothing', () => {
  const whole = drive(fixture);
  for (const size of [1, 7, 64, 997]) {
    assert.deepEqual(
      drive(fixture, { chunkSize: size }),
      whole,
      `a ${size}-byte pipe produced a different conversation`,
    );
  }
});

test('a corrupt line is skipped and the stream carries on', () => {
  const broken = fixture.split('\n');
  broken.splice(6, 0, '{"type":"stream_event","event":{"type":"content_bl');
  broken.splice(9, 0, 'not json at all');
  const events = drive(broken.join('\n'));
  assert.equal(events.filter((e) => e.type === 'delta').length, 6);
  assert.equal(events.find((e) => e.type === 'result').ok, true);
});

test('a runaway line is dropped rather than buffered without bound', () => {
  const events = [];
  const parser = createStreamParser((e) => events.push(e));
  // A single line larger than the cap, with no newline in it, then a real one.
  const huge = '{"type":"stream_event","event":{"x":"' + 'a'.repeat(256 * 1024);
  for (let written = 0; written < MAX_LINE_BYTES + 4096; written += huge.length) {
    parser.push(huge);
  }
  parser.push('"}}\n');
  parser.push(
    '{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"s"}\n',
  );
  parser.end();
  assert.deepEqual(
    events.map((e) => e.type),
    ['result'],
    'the oversized line must be dropped and the next one still parsed',
  );
});

test('a listener that throws cannot take the stream down', () => {
  let seen = 0;
  const parser = createStreamParser(() => {
    seen += 1;
    throw new Error('the panel exploded');
  });
  parser.push(fixture);
  parser.end();
  assert.ok(seen > 5, 'events kept arriving after the first throw');
});

// -------------------------------------------------------------- the argv

test('the argv is the four flags the installed CLI documents, and nothing else', () => {
  // Checked against `claude --help` on Claude Code 2.1.231:
  //   --output-format stream-json  "realtime streaming" (only with --print)
  //   --verbose                    required for stream-json under --print
  //   --include-partial-messages   "partial message chunks as they arrive"
  assert.deepEqual(sendArgs('sess-1', 'ship it'), [
    '--resume',
    'sess-1',
    '-p',
    'ship it',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
  ]);
});

test('SECURITY: the session id and the message are argv elements, never a command line', () => {
  const hostile = 'ada"; & $(rm -rf ~) `whoami` | notify-send pwned & %PATH%';
  const argv = sendArgs(hostile, hostile);
  assert.equal(argv[1], hostile, 'the id is passed whole');
  assert.equal(argv[3], hostile, 'the text is passed whole');
  for (const a of argv) assert.equal(typeof a, 'string');
});

test('the child is not detached, and stdin is closed', () => {
  const opts = sendSpawnOptions('/w/orbital-api');
  // The one field that is a promise rather than a detail: a detached child
  // would outlive the daemon that started it.
  assert.equal(opts.detached, false);
  assert.deepEqual(opts.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(opts.windowsHide, true);
  assert.equal(opts.cwd, '/w/orbital-api');
});

// ------------------------------------------------------ send() end to end

test('send() streams the recorded turn out of a real child process', async () => {
  const dir = await tmpDir('send');
  try {
    const events = [];
    const result = await adapter.send(SESSION, 'why is the build wrong?', {
      cwd: dir,
      bin: fakeBin({ dir }),
      onEvent: (e) => events.push(e),
      timeoutMs: 30_000,
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(
      result.text,
      'Found it: `base` was `/`, so every asset resolved against the wrong root.',
    );
    assert.ok(
      events.filter((e) => e.type === 'delta').length >= 6,
      'the events did not arrive incrementally',
    );
    assert.equal(events[0].type, 'accepted');
    assert.equal(events[events.length - 1].type, 'result');
  } finally {
    await rmDir(dir);
  }
});

test('the fake CLI receives exactly the argv the real one would have', async () => {
  const dir = await tmpDir('argv');
  try {
    await adapter.send(SESSION, 'ship it', {
      cwd: dir,
      bin: fakeBin({ dir }),
      timeoutMs: 30_000,
    });
    const got = JSON.parse(await fsp.readFile(path.join(dir, 'argv.json'), 'utf8'));
    assert.deepEqual(got, sendArgs('7c1f9a20-0d3e-4d61-9a2b-5f0e2c8b41aa', 'ship it'));
  } finally {
    await rmDir(dir);
  }
});

test('a runtime that exits non-zero comes back as an error, with what it said', async () => {
  const dir = await tmpDir('crash');
  try {
    const result = await adapter.send(SESSION, 'hello', {
      cwd: dir,
      bin: fakeBin({ mode: 'crash', dir }),
      timeoutMs: 30_000,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /something went wrong/);
  } finally {
    await rmDir(dir);
  }
});

test('output that is not JSON is a failed send, never an empty reply', async () => {
  const dir = await tmpDir('garbage');
  try {
    const result = await adapter.send(SESSION, 'hello', {
      cwd: dir,
      bin: fakeBin({ mode: 'garbage', dir }),
      timeoutMs: 30_000,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /no result event/);
  } finally {
    await rmDir(dir);
  }
});

test('a binary that is not there is an error, not a throw', async () => {
  const result = await adapter.send(SESSION, 'hello', {
    bin: { command: path.join(os.tmpdir(), 'deckhq-no-such-binary-9f3a'), args: [] },
    timeoutMs: 5000,
  });
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('a turn that overruns its timeout is killed, and leaves nothing running', async () => {
  const dir = await tmpDir('timeout');
  const pidFile = path.join(dir, 'pid');
  try {
    const started = Date.now();
    const result = await adapter.send(SESSION, 'hello', {
      cwd: dir,
      bin: fakeBin({ mode: 'hang', dir }),
      timeoutMs: 300,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /timed out/);
    assert.ok(Date.now() - started < 15_000, 'the timeout did not fire');
    const pid = Number(await fsp.readFile(pidFile, 'utf8'));
    assert.ok(await until(() => !alive(pid)), `pid ${pid} outlived its timeout`);
  } finally {
    await rmDir(dir);
  }
});

test('ORPHAN: aborting a send kills the child — a closing daemon leaves nothing behind', async () => {
  // The daemon's close() aborts every in-flight send (SendHub.shutdown()).
  // This is that path, with a real process on the end of it: the fake CLI is
  // in `hang` mode and will never exit on its own.
  const dir = await tmpDir('orphan');
  const pidFile = path.join(dir, 'pid');
  try {
    const controller = new AbortController();
    const turn = adapter.send(SESSION, 'a long one', {
      cwd: dir,
      bin: fakeBin({ mode: 'hang', dir }),
      signal: controller.signal,
      timeoutMs: 60_000,
    });

    assert.ok(await until(() => fs.existsSync(pidFile)), 'the child never started');
    const pid = Number(await fsp.readFile(pidFile, 'utf8'));
    assert.ok(alive(pid), 'the child was not running to begin with');

    controller.abort();
    const result = await turn;
    assert.equal(result.ok, false);
    assert.match(result.error, /cancelled/);
    assert.ok(await until(() => !alive(pid)), `pid ${pid} is an orphan`);
  } finally {
    await rmDir(dir);
  }
});

test('a signal that is already aborted never starts a process at all', async () => {
  const controller = new AbortController();
  controller.abort();
  let spawned = 0;
  const result = await adapter.send(SESSION, 'hello', {
    signal: controller.signal,
    spawnFn: () => {
      spawned += 1;
      throw new Error('should not be reached');
    },
  });
  assert.equal(spawned, 0);
  assert.equal(result.ok, false);
});
