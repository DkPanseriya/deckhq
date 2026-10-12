/**
 * THE REHEARSAL: a demo floor that takes a reply (`scripts/demo-floor.mjs
 * --rehearsal`).
 *
 * The sessions on a demo floor are invented, so a send has nothing to
 * continue. With `--rehearsal` the daemon is handed a stand-in for `claude`
 * through its `sendBin` seam. These tests hold the three things that make that
 * honest: the seam reaches the adapter and nothing passes it by default; the
 * stand-in tells the daemon about the prompt through the real hook endpoint;
 * and what it answers says that no model ran.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startTurn } from '../../src/http/send-turn.mjs';
import { createStreamParser } from '../../src/adapters/claude-code/stream.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAND_IN = path.join(ROOT, 'scripts', 'demo-claude.mjs');

/** An adapter that records what a send was given, and a hub that does nothing. */
function fakeContext(extra) {
  /** @type {any[]} */
  const calls = [];
  const adapter = {
    send: (/** @type {string} */ id, /** @type {string} */ text, /** @type {any} */ opts) => {
      calls.push({ id, text, opts });
      return Promise.resolve({ ok: true, text: 'ok' });
    },
  };
  return {
    calls,
    ctx: {
      adapters: { getAdapter: () => adapter },
      sends: { begin: () => ({ sendId: 's1', signal: undefined }), publish() {}, end() {} },
      ...extra,
    },
  };
}

test('a send is handed the fixture stand-in when the daemon was given one, and none otherwise', async () => {
  const plain = fakeContext({});
  await startTurn(plain.ctx, { id: 'claude-code:abc', cwd: ROOT }, 'hello').turn;
  assert.equal(plain.calls[0].opts.bin, undefined, 'a real daemon starts the real binary');

  const bin = { command: process.execPath, args: [STAND_IN] };
  const rehearsal = fakeContext({ sendBin: bin });
  await startTurn(rehearsal.ctx, { id: 'claude-code:abc', cwd: ROOT }, 'hello').turn;
  assert.equal(rehearsal.calls[0].opts.bin, bin);
});

test('no shipped command passes a stand-in: the seam is named in the daemon and the demo only', () => {
  const users = [];
  const walk = (/** @type {string} */ dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.m?js$/.test(entry.name) && fs.readFileSync(file, 'utf8').includes('sendBin')) {
        users.push(path.relative(ROOT, file).replace(/\\/g, '/'));
      }
    }
  };
  for (const dir of ['src', 'bin', 'scripts', 'public']) walk(path.join(ROOT, dir));
  assert.deepEqual(users.sort(), [
    'scripts/demo-claude.mjs',
    'scripts/demo-floor.mjs',
    'src/daemon.mjs',
    'src/http/send-turn.mjs',
  ]);
});

test('the stand-in posts the prompt to the hook endpoint and answers that no model ran', async () => {
  /** @type {any[]} */
  const hooks = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      hooks.push({ url: req.url, method: req.method, body: JSON.parse(body) });
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;

  /** @type {any[]} */
  const events = [];
  const parser = createStreamParser((event) => events.push(event));
  const child = spawn(
    process.execPath,
    [STAND_IN, '--demo-port', String(port), '--resume', 'sess-1', '-p', 'Yes, go ahead.'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => parser.push(String(chunk)));
  const code = await new Promise((resolve) => child.on('close', resolve));
  parser.end();
  await new Promise((resolve) => server.close(() => resolve(undefined)));

  assert.equal(code, 0);
  assert.equal(hooks.length, 1, 'one hook, and no Stop: the session stays working');
  assert.equal(hooks[0].url, '/api/hook');
  assert.equal(hooks[0].method, 'POST');
  assert.equal(hooks[0].body.hook_event_name, 'UserPromptSubmit');
  assert.equal(hooks[0].body.session_id, 'sess-1');
  assert.equal(hooks[0].body.runtime, 'claude-code');

  const result = events.find((event) => event.type === 'result');
  assert.ok(result && result.ok, 'the turn ends in a result the adapter accepts');
  assert.match(result.text, /no model ran/i, 'the reply says what it is');
});

test('the stand-in refuses a call that names no session', async () => {
  const child = spawn(process.execPath, [STAND_IN, '-p', 'hello'], { stdio: 'ignore' });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 2);
});
