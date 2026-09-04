#!/usr/bin/env node
/**
 * A fake `claude`, for WP-09.
 *
 * The login on the reference machine is expired, so `claude --resume <id> -p`
 * cannot reach the API. This stands in for it: a real child process, with real
 * pipes, real exit codes and real signal handling, replaying a recorded
 * `--output-format stream-json` transcript one line at a time. Everything
 * about the adapter's side of a send is therefore exercised for real — the
 * argv it builds, the incremental parse, the timeout, the kill on shutdown —
 * and only the model is missing.
 *
 * It is reached through `send()`'s `bin` seam
 * (`{command: process.execPath, args: [thisFile]}`) rather than by putting a
 * `claude` on PATH. That is not a preference: Node's `spawn` without a shell
 * cannot execute a `.cmd` or `.bat` on Windows, and on this machine the real
 * `claude` is a `.exe`, so there is no cross-platform way to plant a fake one
 * on PATH at all. docs/DEVIATIONS.md §117 records it.
 *
 * Configured entirely by environment, so the argv it receives is exactly the
 * argv the real binary would have received and can be asserted verbatim:
 *
 *   FAKE_CLAUDE_FIXTURE    NDJSON file to replay (required for `replay`)
 *   FAKE_CLAUDE_MODE       replay (default) | hang | crash | garbage | silent
 *   FAKE_CLAUDE_DELAY_MS   milliseconds between lines (default 0)
 *   FAKE_CLAUDE_ARGV_FILE  write the argv it was given here, as JSON
 *   FAKE_CLAUDE_PID_FILE   write its own pid here, so a test can check it died
 *   FAKE_CLAUDE_EXIT_CODE  exit code for `crash` (default 1)
 */

import fs from 'node:fs';

const argv = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE || 'replay';
const delay = Number(process.env.FAKE_CLAUDE_DELAY_MS) || 0;

if (process.env.FAKE_CLAUDE_ARGV_FILE) {
  fs.writeFileSync(process.env.FAKE_CLAUDE_ARGV_FILE, JSON.stringify(argv), 'utf8');
}
if (process.env.FAKE_CLAUDE_PID_FILE) {
  fs.writeFileSync(process.env.FAKE_CLAUDE_PID_FILE, String(process.pid), 'utf8');
}

/**
 * Write one chunk and resolve when it has ACTUALLY reached the operating
 * system, not merely when it was accepted into a buffer.
 *
 * The distinction is the whole of docs/DEVIATIONS.md §126.1. `write()`'s
 * return value is backpressure — false means "the buffer is over its high
 * water mark", true means only "there is room for more", never "it is gone".
 * On POSIX a pipe is an ASYNCHRONOUS stream for `process.stdout` (it is
 * synchronous only on Windows, and for files everywhere), so a `true` return
 * routinely leaves bytes queued inside libuv. `process.exit()` then discards
 * them: the transcript arrives truncated, the `result` line is never written,
 * and the adapter correctly reports "claude produced no result event".
 *
 * The write callback is the real completion signal, so that is what is
 * awaited here — and no mode below calls `process.exit()` on a successful
 * path. A pending write keeps the loop alive, so the natural exit is both
 * correct and still prompt.
 */
function write(stream, text) {
  return new Promise((resolve, reject) => {
    stream.write(text, (err) => (err ? reject(err) : resolve()));
  });
}

const out = (text) => write(process.stdout, text);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (mode === 'hang') {
  // Alive, quiet, and refusing to leave: what a long turn looks like from
  // outside. Held open by an interval rather than by stdin, so nothing about
  // how it was spawned can end it early. Only a signal does.
  process.stdout.write('{"type":"system","subtype":"init","session_id":"hang"}\n');
  setInterval(() => {}, 1000);
} else if (mode === 'crash') {
  // Same flush rule as stdout, and for the same reason: the test that reads
  // this asserts on the sentence, so losing it to `process.exit` would be the
  // §126.1 failure again with a different pipe.
  await write(process.stderr, 'claude: something went wrong\n');
  process.exitCode = Number(process.env.FAKE_CLAUDE_EXIT_CODE) || 1;
} else if (mode === 'garbage') {
  // Not JSON, and not newline-terminated: the shape a broken pipe leaves.
  await out('this is not json\nnor is this {');
  process.exitCode = 0;
} else if (mode === 'silent') {
  // Exits cleanly having said nothing at all — no `result` event.
  process.exitCode = 0;
} else if (!process.env.FAKE_CLAUDE_FIXTURE) {
  await write(process.stderr, 'fake-claude: FAKE_CLAUDE_FIXTURE is not set\n');
  process.exitCode = 2;
} else {
  const lines = fs
    .readFileSync(process.env.FAKE_CLAUDE_FIXTURE, 'utf8')
    .split('\n')
    .filter((l) => l.trim());
  // Deliberately written in pieces that do not line up with line boundaries:
  // a real pipe splits wherever it likes, and the parser must not assume one
  // chunk is one event.
  for (const line of lines) {
    const half = Math.max(1, Math.floor(line.length / 2));
    await out(line.slice(0, half));
    await out(line.slice(half) + '\n');
    if (delay) await sleep(delay);
  }
  // No `process.exit(0)`: every byte above is flushed, and the process leaves
  // on its own the moment nothing is left to do. Exiting explicitly here is
  // what truncated the last line on macOS (§126.1).
  process.exitCode = 0;
}
