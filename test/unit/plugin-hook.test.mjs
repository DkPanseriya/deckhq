/**
 * WP-37 — the plugin's hook command, and the SessionStart start.
 *
 * One test spawns `plugin/scripts/hook.mjs` as a real child process with a real
 * payload on stdin and a real HTTP server standing in for the daemon, because
 * that is exactly how Claude Code runs it, and because the thing being proved
 * is that the command finds a daemon on a port nobody baked into it. The rest
 * drive `runHook` in this process: the suite has latency budgets in it
 * (`statusline`'s 20 ms, the store's non-blocking read) and a pile of
 * concurrent child processes is enough load to fail them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  acquireLock,
  ensureDaemon,
  releaseLock,
  resolveLauncher,
} from '../../plugin/lib/start.mjs';
import {
  candidatePorts,
  findDaemon,
  installedHookPort,
  publishedPort,
} from '../../plugin/lib/deckhq.mjs';
import { readAll, runHook } from '../../plugin/scripts/hook.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK = path.join(ROOT, 'plugin', 'scripts', 'hook.mjs');

/** A fresh empty directory that cleans itself up. */
function tmpdir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-plugin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A stream that hands over `text` and ends, the way a piped stdin does. */
function stdinOf(text) {
  const stream = new EventEmitter();
  stream.resume = () => {
    setImmediate(() => {
      if (text) stream.emit('data', Buffer.from(text));
      stream.emit('end');
    });
  };
  return stream;
}

/**
 * A loopback server that answers `/api/state` the way a daemon does and
 * records every `/api/hook` body it is handed.
 */
async function fakeDaemon(t) {
  /** @type {string[]} */
  const received = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/api/state') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ agents: [], counts: { needsYou: 0 } }));
      return;
    }
    if (req.url === '/api/hook' && req.method === 'POST') {
      /** @type {Buffer[]} */
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        received.push(Buffer.concat(chunks).toString('utf8'));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { received, port: server.address().port };
}

// ---------------------------------------------------------------------------
// The hook command, as Claude Code runs it
// ---------------------------------------------------------------------------

test('the hook posts to the port the daemon published, not to a baked-in one', async (t) => {
  const daemon = await fakeDaemon(t);
  const stateDir = tmpdir(t);
  const configDir = tmpdir(t);
  // The port is chosen by the OS and appears nowhere in the plugin's source.
  fs.writeFileSync(
    path.join(stateDir, 'daemon.json'),
    JSON.stringify({ port: daemon.port, url: `http://127.0.0.1:${daemon.port}/`, pid: 1 }),
  );

  const payload = JSON.stringify({
    session_id: 'wp37-0001',
    hook_event_name: 'Stop',
    cwd: 'C:/Dk/Projects/1_Project_DeckHQ',
  });

  const run = await new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], {
      env: {
        ...process.env,
        DECKHQ_STATE_DIR: stateDir,
        CLAUDE_CONFIG_DIR: configDir,
        DECKHQ_PORT: '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('close', (code) => resolve({ code, out, err }));
    child.stdin.end(payload);
  });

  assert.equal(run.code, 0, 'a non-zero hook exit shows up in the session');
  assert.equal(run.out, '', 'a hook that prints is a hook the user sees');
  assert.equal(run.err, '');
  assert.deepEqual(daemon.received, [payload], 'the payload was not delivered verbatim');
});

test('the hook posts the payload byte for byte, interpreting nothing', async (t) => {
  const daemon = await fakeDaemon(t);

  // A command line carrying a newline and an ANSI escape: deciding what any of
  // it means belongs to the adapter on the daemon's side of the socket.
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: `echo one\ntwo${String.fromCharCode(27)}[31m` },
  });
  const result = await runHook({
    argv: [],
    stdin: stdinOf(payload),
    find: async () => ({ port: daemon.port, snapshot: {} }),
  });

  assert.deepEqual(result, { port: daemon.port, posted: true, started: false });
  assert.deepEqual(daemon.received, [payload]);
});

test('the hook does nothing at all when no daemon is listening', async () => {
  const result = await runHook({
    argv: [],
    stdin: stdinOf(JSON.stringify({ hook_event_name: 'Stop' })),
    find: async () => null,
    post: () => assert.fail('a hook posted with no daemon found'),
  });
  assert.deepEqual(result, { port: null, posted: false, started: false });
});

test('a payload that is not JSON is still forwarded', async (t) => {
  // What is and is not a valid payload is the daemon's call, not this
  // command's: it is a pipe, and a pipe that parses is a pipe that can drop an
  // event the daemon would have understood.
  const daemon = await fakeDaemon(t);
  await runHook({
    argv: [],
    stdin: stdinOf('not json'),
    find: async () => ({ port: daemon.port, snapshot: {} }),
  });
  assert.deepEqual(daemon.received, ['not json']);
});

test('an empty stdin posts nothing', async () => {
  const result = await runHook({
    argv: [],
    stdin: stdinOf(''),
    find: async () => ({ port: 4317, snapshot: {} }),
    post: () => assert.fail('an empty payload was posted'),
  });
  assert.deepEqual(result, { port: 4317, posted: false, started: false });
});

test('--start is the only argv that starts a daemon', async () => {
  let ensured = 0;
  await runHook({
    argv: ['--start'],
    stdin: stdinOf('{}'),
    ensure: async () => {
      ensured += 1;
      return { port: 4317, started: true, reason: 'started' };
    },
    post: async () => true,
  });
  assert.equal(ensured, 1);

  await runHook({
    argv: [],
    stdin: stdinOf('{}'),
    find: async () => null,
    ensure: () => assert.fail('an ordinary event tried to start a daemon'),
  });
});

test('a stream that errors mid-payload does not hang the hook', async () => {
  const stream = new EventEmitter();
  stream.resume = () => {};
  const pending = readAll(stream);
  stream.emit('data', Buffer.from('{"partial":'));
  stream.emit('error', new Error('broken pipe'));
  assert.equal((await pending).toString('utf8'), '{"partial":');
});

test('something on the port that is not a DeckHQ is not a daemon', async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"hello":"i am not deckhq"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const stateDir = tmpdir(t);
  fs.writeFileSync(
    path.join(stateDir, 'daemon.json'),
    JSON.stringify({ port: server.address().port }),
  );

  const found = await findDaemon({
    env: { DECKHQ_STATE_DIR: stateDir, CLAUDE_CONFIG_DIR: tmpdir(t) },
    span: 0,
    timeoutMs: 1500,
  });
  assert.equal(found, null);
});

// ---------------------------------------------------------------------------
// Port discovery
// ---------------------------------------------------------------------------

test('discovery prefers the published port, then the settings hooks, then the walk', (t) => {
  const stateDir = tmpdir(t);
  const configDir = tmpdir(t);
  fs.writeFileSync(path.join(stateDir, 'daemon.json'), JSON.stringify({ port: 4499 }));
  fs.writeFileSync(
    path.join(configDir, 'settings.json'),
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command:
                  "node -e \"var req=http.request({host:'127.0.0.1',port:4400,path:'/api/hook',method:'POST'})\"",
                _deckhq: true,
              },
            ],
          },
        ],
      },
    }),
  );
  const env = { DECKHQ_STATE_DIR: stateDir, CLAUDE_CONFIG_DIR: configDir };

  assert.equal(publishedPort({ env }), 4499);
  assert.equal(installedHookPort({ env }), 4400);
  const ports = candidatePorts({ env });
  assert.deepEqual(ports.slice(0, 3), [4499, 4400, 4317]);
  assert.equal(ports.length, 12, 'the walk is ten ports plus the two hints');
});

test('an explicit port and DECKHQ_PORT come before every hint', (t) => {
  const stateDir = tmpdir(t);
  fs.writeFileSync(path.join(stateDir, 'daemon.json'), JSON.stringify({ port: 4499 }));
  const env = { DECKHQ_STATE_DIR: stateDir, CLAUDE_CONFIG_DIR: tmpdir(t), DECKHQ_PORT: '4600' };
  assert.deepEqual(candidatePorts({ port: 4700, env }).slice(0, 3), [4700, 4600, 4499]);
});

test('a settings file with no DeckHQ hooks yields no port', (t) => {
  const configDir = tmpdir(t);
  fs.writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify({ hooks: {} }));
  assert.equal(installedHookPort({ env: { CLAUDE_CONFIG_DIR: configDir } }), null);
  assert.equal(installedHookPort({ env: { CLAUDE_CONFIG_DIR: tmpdir(t) } }), null);
});

// ---------------------------------------------------------------------------
// Starting exactly one daemon
// ---------------------------------------------------------------------------

/** A fake world where a daemon appears only after something spawns it. */
function world() {
  const state = { spawned: 0, up: false };
  return {
    state,
    find: async () => (state.up ? { port: 4317, snapshot: {} } : null),
    resolve: () => ({ command: 'node', args: ['deckhq.mjs'], via: 'test' }),
    spawn: () => {
      state.spawned += 1;
      // A real daemon takes a moment to bind; the poll loop is what waits.
      setTimeout(() => {
        state.up = true;
      }, 30);
      return { unref() {} };
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

test('SessionStart starts exactly one daemon, however many sessions open at once', async (t) => {
  const w = world();
  const lockFile = path.join(tmpdir(t), 'daemon.start.lock');

  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      ensureDaemon({
        lockFile,
        find: w.find,
        resolve: w.resolve,
        spawn: w.spawn,
        sleep: w.sleep,
        pollMs: 10,
      }),
    ),
  );

  assert.equal(w.state.spawned, 1, 'more than one daemon was started');
  assert.equal(results.filter((r) => r.started).length, 1);
  for (const r of results) assert.equal(r.port, 4317, `a caller got ${r.reason} with no port`);
  assert.equal(fs.existsSync(lockFile), false, 'the start lock was not released');
});

test('a daemon that is already running is not started again', async (t) => {
  const w = world();
  w.state.up = true;
  const result = await ensureDaemon({
    lockFile: path.join(tmpdir(t), 'lock'),
    find: w.find,
    resolve: w.resolve,
    spawn: w.spawn,
    sleep: w.sleep,
  });
  assert.deepEqual(result, { port: 4317, started: false, reason: 'running' });
  assert.equal(w.state.spawned, 0);
});

test('a machine with no deckhq on it reports so and spawns nothing', async (t) => {
  const w = world();
  const result = await ensureDaemon({
    lockFile: path.join(tmpdir(t), 'lock'),
    find: w.find,
    resolve: () => null,
    spawn: w.spawn,
    sleep: w.sleep,
  });
  assert.deepEqual(result, { port: null, started: false, reason: 'no-deckhq' });
  assert.equal(w.state.spawned, 0);
});

test('the daemon is spawned with --no-open and nothing else', async (t) => {
  const w = world();
  /** @type {any[]} */
  const calls = [];
  await ensureDaemon({
    lockFile: path.join(tmpdir(t), 'lock'),
    find: w.find,
    resolve: w.resolve,
    sleep: w.sleep,
    pollMs: 10,
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return w.spawn();
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['deckhq.mjs', '--no-open']);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio, 'ignore');
  // SECURITY: argv array, never a shell string with anything interpolated.
  assert.equal(calls[0].options.shell, undefined);
});

test('an abandoned lock is broken open rather than believed forever', (t) => {
  const file = path.join(tmpdir(t), 'lock');
  assert.equal(acquireLock({ file, now: 1_000_000 }).held, true);
  assert.equal(acquireLock({ file, now: 1_000_100 }).held, false, 'a live lock was stolen');
  assert.equal(
    acquireLock({ file, now: Date.now() + 10 * 60_000 }).held,
    true,
    'an abandoned lock was never released',
  );
  releaseLock(file);
  assert.equal(fs.existsSync(file), false);
});

// ---------------------------------------------------------------------------
// Finding deckhq
// ---------------------------------------------------------------------------

test('DECKHQ_BIN pointing at a script is run through this node', () => {
  const launcher = resolveLauncher({ env: { DECKHQ_BIN: '/opt/deckhq/bin/deckhq.mjs' } });
  assert.equal(launcher.command, process.execPath);
  assert.deepEqual(launcher.args, ['/opt/deckhq/bin/deckhq.mjs']);
  assert.equal(launcher.via, 'DECKHQ_BIN');
});

test("npm's own entry point is preferred to the shim beside it", () => {
  const dir = path.join('/usr', 'local', 'bin');
  const entry = path.join(dir, 'node_modules', 'deckhq', 'bin', 'deckhq.mjs');
  const launcher = resolveLauncher({
    env: { PATH: dir },
    exists: (p) => p === entry || p === path.join(dir, 'deckhq'),
  });
  assert.equal(launcher.command, process.execPath);
  assert.deepEqual(launcher.args, [entry]);
  assert.equal(launcher.via, 'package');
});

test('a .cmd shim is run as an argument to the interpreter, never as a shell string', () => {
  // SECURITY: node refuses to spawn a batch file directly since 18.20.2, and
  // shelling out with an interpolated path is the class of bug this project
  // does not write. Every argument here is a literal.
  const dir = 'C:\\tools';
  const shim = path.join(dir, 'deckhq.cmd');
  const launcher = resolveLauncher({ env: { PATH: dir }, exists: (p) => p === shim });
  assert.match(launcher.command, /cmd\.exe$/i);
  assert.deepEqual(launcher.args, ['/d', '/s', '/c', shim]);
});

test('an extensionless executable is spawned directly', () => {
  const shim = path.join('/usr', 'local', 'bin', 'deckhq');
  const launcher = resolveLauncher({ env: { PATH: '/usr/local/bin' }, exists: (p) => p === shim });
  assert.deepEqual(launcher, { command: shim, args: [], via: 'path' });
});

test('a machine with no deckhq anywhere resolves to nothing', () => {
  assert.equal(resolveLauncher({ env: { PATH: '/nowhere' }, exists: () => false }), null);
});
