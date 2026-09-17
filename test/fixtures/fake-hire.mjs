#!/usr/bin/env node
/**
 * A fake `claude` for WP-68's Hire — a real child process, with the real argv.
 *
 * `test/integration/studio-hire.test.mjs` replaces `launchTerminal` and runs
 * this with `launch.command.slice(1)`, so what it receives is character for
 * character what the route would have handed the real binary. It does two
 * things and nothing else:
 *
 *   1. **Writes its argv to a file**, so the test can assert the array element
 *      by element after it has been through `execFile` rather than before.
 *   2. **Writes a Claude Code transcript for its own cwd**, which is the
 *      worktree, so the ORDINARY scan finds a session there and the registry
 *      puts it on the floor. Nothing in the daemon is told about it; it is
 *      found the way every other session is found (§9 invariant 4).
 *
 * It also checks that the brief named by `--append-system-prompt-file` is a
 * file that exists, which is the half of "the argv names the file" that a
 * string comparison cannot see. A missing one is a non-zero exit.
 *
 *   FAKE_HIRE_ARGV_DIR   directory to write `<basename of cwd>.json` into
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
const cwd = process.cwd();
const label = path.basename(cwd);

if (process.env.FAKE_HIRE_ARGV_DIR) {
  fs.mkdirSync(process.env.FAKE_HIRE_ARGV_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(process.env.FAKE_HIRE_ARGV_DIR, `${label}.json`),
    JSON.stringify({ argv, cwd }, null, 2),
    'utf8',
  );
}

const at = argv.indexOf('--append-system-prompt-file');
if (at >= 0) {
  const brief = argv[at + 1];
  if (!brief || !fs.existsSync(brief)) {
    process.stderr.write(`Append system prompt file not found: ${brief}\n`);
    process.exit(1);
  }
}

// The transcript, where the Claude Code adapter looks for one: the config
// directory, a per-project folder named after the cwd, one `<id>.jsonl`.
const configDir = process.env.CLAUDE_CONFIG_DIR;
if (configDir) {
  const sessionId = crypto.randomUUID();
  const dir = path.join(configDir, 'projects', cwd.replace(/[\\/:]+/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const stamp = (s) => new Date(Date.now() - 60_000 + s * 1000).toISOString();
  const lines = [
    { type: 'custom-title', customTitle: `working in ${label}`, sessionId },
    {
      parentUuid: null,
      isSidechain: false,
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: argv[argv.length - 1] || 'go' }] },
      uuid: 'u1',
      timestamp: stamp(1),
      cwd,
      gitBranch: 'main',
      sessionId,
      version: '2.1.0',
    },
    {
      parentUuid: 'u1',
      isSidechain: false,
      type: 'assistant',
      message: {
        id: 'msg_a',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'Read the brief. Starting.' }],
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
      uuid: 'a1',
      timestamp: stamp(2),
      cwd,
      gitBranch: 'main',
      sessionId,
    },
  ];
  fs.writeFileSync(
    path.join(dir, `${sessionId}.jsonl`),
    `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`,
    'utf8',
  );
}
