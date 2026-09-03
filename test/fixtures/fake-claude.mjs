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
 * on PATH at all. docs/DEVIATIONS.md §115 records it.
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

/** Write one chunk and resolve when it has actually been flushed. */
function write(text) {
  return new Promise((resolve) => {
    if (!process.stdout.write(text)) process.stdout.once('drain', resolve);
    else resolve();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (mode === 'hang') {
  // Alive, quiet, and refusing to leave: what a long turn looks like from
  // outside. Held open by an interval rather than by stdin, so nothing about
  // how it was spawned can end it early. Only a signal does.
  process.stdout.write('{"type":"system","subtype":"init","session_id":"hang"}\n');
  setInterval(() => {}, 1000);
} else if (mode === 'crash') {
  process.stderr.write('claude: something went wrong\n');
  process.exit(Number(process.env.FAKE_CLAUDE_EXIT_CODE) || 1);
} else if (mode === 'garbage') {
  // Not JSON, and not newline-terminated: the shape a broken pipe leaves.
  process.stdout.write('this is not json\nnor is this {');
  process.exit(0);
} else if (mode === 'silent') {
  // Exits cleanly having said nothing at all — no `result` event.
  process.exit(0);
} else {
  const file = process.env.FAKE_CLAUDE_FIXTURE;
  if (!file) {
    process.stderr.write('fake-claude: FAKE_CLAUDE_FIXTURE is not set\n');
    process.exit(2);
  }
  const lines = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim());
  // Deliberately written in pieces that do not line up with line boundaries:
  // a real pipe splits wherever it likes, and the parser must not assume one
  // chunk is one event.
  for (const line of lines) {
    const half = Math.max(1, Math.floor(line.length / 2));
    await write(line.slice(0, half));
    await write(line.slice(half) + '\n');
    if (delay) await sleep(delay);
  }
  process.exit(0);
}
