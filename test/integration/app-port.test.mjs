/**
 * `deckhq app`, two DeckHQs on one machine, and which one it opens.
 *
 * The report this file exists for: the daemon on 4317 had been stopped, a
 * preview of another branch was running on 4321 against its own
 * `DECKHQ_STATE_DIR`, and `deckhq app` printed "already running" and opened the
 * preview — with `--port 4317` on the command line as well as without it.
 *
 * Two rules came out of it, and both are asserted here against real daemons:
 *
 *   1. **A named port is the whole search.** `--port` or `DECKHQ_PORT`: a DeckHQ
 *      there is reused, an empty port gets a daemon started on it, anything else
 *      on it is an error. No other port is ever asked.
 *   2. **With no port named, only a daemon for THIS state directory is reused.**
 *      `/api/state` carries `stateDirId`, and a daemon whose id is not the
 *      caller's is walked past.
 *
 * Every daemon here is this file's own: started on a port the OS chose, against
 * a state directory inside the isolated temp root, and closed by the handle
 * `startDaemon` returned. No search in this file walks 4317 upward — each one
 * either names a port or is handed the exact ports to ask — so a DeckHQ that
 * happens to be running on the machine is never spoken to.
 */
// First, and before anything under `src/`: it moves the machine.
import { daemonScratch, scratchDir } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const { startDaemon } = await import('../../src/daemon.mjs');
const { findRunningDaemon, runApp, startDetachedDaemon } = await import('../../src/cli/app.mjs');
const { stateDirId, writeDaemonFile } = await import('../../src/core/daemon-file.mjs');

/** A real daemon on a port of the OS's choosing, closed when the test ends. */
async function daemonIn(t, prefix, port = 0) {
  const scratch = daemonScratch(prefix);
  const d = await startDaemon({ port, stateFile: scratch.stateFile, publicDir: scratch.publicDir });
  t.after(() => d.close());
  return { port: d.port, url: d.url, dir: scratch.dir };
}

/** A loopback HTTP server that answers every request with `body`. */
async function listener(t, body, type = 'text/plain') {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': type, connection: 'close' });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  t.after(() => new Promise((resolve) => server.close(() => resolve(undefined))));
  return /** @type {import('node:net').AddressInfo} */ (server.address()).port;
}

/** A port nothing is listening on: bound, read, and let go. */
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  await new Promise((resolve) => server.close(() => resolve(undefined)));
  return port;
}

/**
 * The real search, told exactly which ports to ask when no port is named.
 * A named port needs no list: it is asked alone.
 */
const scanning = (ports) => (opts) =>
  findRunningDaemon(opts.port != null ? opts : { ...opts, ports });

/** A `start` that starts a real daemon in this process, for `dir`. */
function startingIn(t, dir, calls = []) {
  return async ({ port }) => {
    calls.push(port ?? null);
    const scratch = daemonScratch('started-');
    const d = await startDaemon({
      port: port ?? 0,
      stateFile: path.join(dir, 'state.json'),
      publicDir: scratch.publicDir,
    });
    t.after(() => d.close());
    return { port: d.port, url: d.url, pid: null, started: true, timedOut: false };
  };
}

/** Run the command with stdout and stderr collected. */
async function app(argv, deps) {
  const out = [];
  const err = [];
  const code = await runApp(argv, {
    write: (s) => out.push(s),
    error: (s) => err.push(s),
    findBrowser: () => null,
    spawnFn: () => assert.fail('no window is ever opened by this file'),
    ...deps,
  });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

// ---------------------------------------------------------------------------
// The identifier
// ---------------------------------------------------------------------------

test('SECURITY: a daemon names its state directory as a hash, never as the path', async (t) => {
  const a = await daemonIn(t, 'id-a-');
  const b = await daemonIn(t, 'id-b-');

  const body = await (await fetch(a.url + 'api/state')).text();
  const id = JSON.parse(body).stateDirId;

  assert.match(id, /^[0-9a-f]{16}$/, 'sixteen hex characters: no separator can be in it');
  assert.equal(id, stateDirId(a.dir), 'the id the caller computes for the same directory');
  assert.notEqual(id, stateDirId(b.dir));
  assert.equal((await (await fetch(b.url + 'api/state')).json()).stateDirId, stateDirId(b.dir));

  // The path itself, however a JSON body could spell it, is nowhere in the answer.
  const spellings = [
    a.dir,
    a.dir.split(path.sep).join('/'),
    JSON.stringify(a.dir).slice(1, -1),
    path.basename(a.dir),
  ];
  for (const spelt of spellings) {
    assert.ok(!body.includes(spelt), `the answer carries the state directory: ${spelt}`);
    assert.ok(!body.toLowerCase().includes(spelt.toLowerCase()));
  }
});

// ---------------------------------------------------------------------------
// No port named: only this state directory's daemon
// ---------------------------------------------------------------------------

test('REGRESSION: with no port named, the daemon for this state directory is the one reused', async (t) => {
  const a = await daemonIn(t, 'two-a-');
  const b = await daemonIn(t, 'two-b-');
  const never = async () => assert.fail('a daemon for this directory is already running');

  // The foreign one is asked FIRST each time, and walked past each time.
  const forA = await app(['--no-window'], {
    dataDir: a.dir,
    find: scanning([b.port, a.port]),
    start: never,
  });
  assert.equal(forA.code, 0, forA.stderr);
  assert.match(forA.stdout, new RegExp(`127\\.0\\.0\\.1:${a.port}/ {2}\\(already running\\)`));
  assert.ok(!forA.stdout.includes(`:${b.port}/`));

  const forB = await app(['--dry-run', '--no-window'], {
    dataDir: b.dir,
    find: scanning([a.port, b.port]),
    start: never,
  });
  assert.equal(forB.code, 0, forB.stderr);
  assert.match(forB.stdout, new RegExp(`127\\.0\\.0\\.1:${b.port}/ {2}\\(already running`));
  assert.ok(!forB.stdout.includes(`:${a.port}/`));
});

test('REGRESSION: with only foreign daemons answering, it starts its own and never opens theirs', async (t) => {
  const a = await daemonIn(t, 'foreign-a-');
  const b = await daemonIn(t, 'foreign-b-');
  const mine = scratchDir('mine-');
  const foreign = [a.port, b.port];

  const dry = await app(['--dry-run', '--no-window'], { dataDir: mine, find: scanning(foreign) });
  assert.equal(dry.code, 0, dry.stderr);
  assert.match(dry.stdout, /none answered, so it would start one/);
  assert.doesNotMatch(dry.stdout, /already running/);

  const calls = [];
  const first = await app(['--no-window'], {
    dataDir: mine,
    find: scanning(foreign),
    start: startingIn(t, mine, calls),
  });
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual(calls, [null], 'one daemon started, and no port forced on it');
  assert.match(first.stdout, /\(started just now\)/);
  for (const port of foreign) assert.ok(!first.stdout.includes(`:${port}/`));

  // And the one it started is the one the next run finds, among the same three.
  const own = Number(/127\.0\.0\.1:(\d+)\//.exec(first.stdout)?.[1]);
  const again = await app(['--no-window'], {
    dataDir: mine,
    find: scanning([...foreign, own]),
    start: async () => assert.fail('its own daemon is running now'),
  });
  assert.match(again.stdout, new RegExp(`127\\.0\\.0\\.1:${own}/ {2}\\(already running\\)`));
});

test('a daemon too old to name its directory is reused only where daemon.json says it is', async (t) => {
  // What a build from before `stateDirId` answers: a snapshot, and no id.
  const old = await listener(t, JSON.stringify({ agents: [], counts: {} }), 'application/json');

  const named = scratchDir('old-named-');
  writeDaemonFile({
    file: path.join(named, 'daemon.json'),
    port: old,
    url: `http://127.0.0.1:${old}/`,
  });
  assert.deepEqual(await findRunningDaemon({ dataDir: named, ports: [old] }), {
    port: old,
    url: `http://127.0.0.1:${old}/`,
  });

  // The same daemon, asked about from a directory whose daemon.json does not
  // name it — and from one with no daemon.json at all — is not ours.
  const elsewhere = scratchDir('old-elsewhere-');
  writeDaemonFile({ file: path.join(elsewhere, 'daemon.json'), port: 1, url: 'x' });
  assert.equal(await findRunningDaemon({ dataDir: elsewhere, ports: [old] }), null);
  assert.equal(await findRunningDaemon({ dataDir: scratchDir('old-none-'), ports: [old] }), null);
});

// ---------------------------------------------------------------------------
// A port named: that port, and no other
// ---------------------------------------------------------------------------

test('REGRESSION: --port with a foreign daemon answering elsewhere starts on the named port', async (t) => {
  const foreign = await daemonIn(t, 'named-foreign-');
  const mine = scratchDir('named-mine-');
  const port = await freePort();

  const dry = await app(['--dry-run', '--no-window', '--port', String(port)], { dataDir: mine });
  assert.equal(dry.code, 0, dry.stderr);
  assert.match(dry.stdout, new RegExp(`nothing is on port ${port}, the port you named`));
  assert.match(dry.stdout, new RegExp(`--no-open --port ${port}\\n`));
  assert.ok(!dry.stdout.includes(`:${foreign.port}/`));

  // The wait after the spawn asks the named port and nothing else: with no
  // daemon ever coming up there, it times out rather than settling for the
  // one that is answering somewhere else.
  const spawned = [];
  const waited = await startDetachedDaemon({
    port,
    dataDir: mine,
    timeoutMs: 250,
    pollMs: 50,
    spawnFn: (command, args) => {
      spawned.push(args);
      return { pid: 1, unref() {} };
    },
  });
  assert.deepEqual(spawned[0].slice(1), ['--no-open', '--port', String(port)]);
  assert.equal(waited.timedOut, true);
  assert.equal(waited.port, port);

  // The real search, and a real daemon started where it was told to start.
  const calls = [];
  const run = await app(['--no-window', '--port', String(port)], {
    dataDir: mine,
    start: startingIn(t, mine, calls),
  });
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(calls, [port]);
  assert.match(
    run.stdout,
    new RegExp(`127\\.0\\.0\\.1:${port}/ {2}\\(started on the port you named\\)`),
  );
  assert.ok(!run.stdout.includes(`:${foreign.port}/`));

  // Named again, it is found there and reused.
  const again = await app(['--no-window', '--port', String(port)], {
    dataDir: mine,
    start: async () => assert.fail('it is already on the port that was named'),
  });
  assert.match(again.stdout, new RegExp(`127\\.0\\.0\\.1:${port}/ {2}\\(already running\\)`));
});

test('--port on a port held by something that is not DeckHQ fails and says why', async (t) => {
  const busy = await listener(t, 'not a deckhq');
  const mine = scratchDir('busy-mine-');

  for (const argv of [['--no-window'], ['--dry-run', '--no-window']]) {
    const run = await app([...argv, '--port', String(busy)], {
      dataDir: mine,
      start: async () => assert.fail('nothing is started beside a port that was named'),
    });
    assert.equal(run.code, 1);
    assert.match(run.stderr, new RegExp(`Port ${busy} is in use`));
    assert.match(run.stderr, /did not answer as a DeckHQ/);
    assert.match(run.stderr, /nothing was started and no other port was tried/);
    assert.equal(run.stdout.includes('DeckHQ  http'), false);
  }
});

test('DECKHQ_PORT behaves exactly as --port does', async (t) => {
  const a = await daemonIn(t, 'env-a-');
  const b = await daemonIn(t, 'env-b-');
  const never = async () => assert.fail('nothing needs starting');

  // It names a daemon: B is reused from A's directory, though A's own daemon
  // is running and B serves somewhere else. A named port wins.
  const reused = await app(['--no-window'], {
    dataDir: a.dir,
    env: { DECKHQ_PORT: String(b.port) },
    start: never,
  });
  assert.equal(reused.code, 0, reused.stderr);
  assert.match(reused.stdout, new RegExp(`127\\.0\\.0\\.1:${b.port}/ {2}\\(already running\\)`));

  // --port wins over it.
  const flag = await app(['--no-window', '--port', String(a.port)], {
    dataDir: a.dir,
    env: { DECKHQ_PORT: String(b.port) },
    start: never,
  });
  assert.match(flag.stdout, new RegExp(`127\\.0\\.0\\.1:${a.port}/ {2}\\(already running\\)`));

  // Nothing on it: a daemon is started there, not found somewhere else.
  const mine = scratchDir('env-mine-');
  const port = await freePort();
  const calls = [];
  const started = await app(['--no-window'], {
    dataDir: mine,
    env: { DECKHQ_PORT: String(port) },
    start: startingIn(t, mine, calls),
  });
  assert.equal(started.code, 0, started.stderr);
  assert.deepEqual(calls, [port]);
  assert.match(
    started.stdout,
    new RegExp(`127\\.0\\.0\\.1:${port}/ {2}\\(started on the port you named\\)`),
  );

  // Something else on it: the same refusal.
  const busy = await listener(t, 'not a deckhq');
  const refused = await app(['--no-window'], {
    dataDir: mine,
    env: { DECKHQ_PORT: String(busy) },
    start: never,
  });
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, new RegExp(`Port ${busy} is in use`));
});
