/**
 * Hooks port adoption. docs/plan/08-PLAN-V2-100X.md WP-36.
 *
 * Hooks are written with the daemon's port at install time, and a daemon that
 * later starts on a different port runs degraded while every surface says it
 * is fine: the settings file is valid, the header claims exact state, and each
 * event posts into a void. `doctor` can report that; this is the daemon no
 * longer creating it. With no port named, it listens where the hooks post if
 * that is free, refuses to start beside a DeckHQ that is already there, and
 * leaves an explicit `--port` exactly as given.
 *
 * The throwaway machine comes from `test/helpers/isolate.mjs`, imported before
 * the dynamic imports below because `CLAUDE_CONFIG_DIR` and `DECKHQ_STATE_DIR`
 * are read at module-evaluation time by the modules under test
 * (`docs/DEVIATIONS.md` §123). Ports are never fixed: every one is taken from
 * the OS moments before it is used, so the developer's own daemon on 4317 or
 * 4400 is never in the way.
 */
// First, and before anything under `src/`: it moves the machine.
import {
  CLAUDE_DIR,
  DESKTOP_SESSIONS_DIR,
  PROJECTS_DIR,
  STATE_DIR,
  scratchDir,
} from '../helpers/isolate.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(HERE, '../..');
const BIN = path.join(ROOT_DIR, 'bin', 'deckhq.mjs');
const FIXTURE = path.join(ROOT_DIR, 'test', 'fixtures', 'claude-sample.jsonl');

// One transcript, so Claude Code counts as a runtime IN USE: the header's
// degraded flag is only reported for runtimes that have sessions, and the
// banner these tests are about is that flag.
const PROJECT_DIR = path.join(PROJECTS_DIR, 'C--Dk-Projects-FixtureProj');
await fs.mkdir(PROJECT_DIR, { recursive: true });
await fs.copyFile(FIXTURE, path.join(PROJECT_DIR, '11111111-1111-1111-1111-111111111111.jsonl'));

const { startDaemon, DeckhqAlreadyRunningError } = await import('../../src/daemon.mjs');
const hooks = await import('../../src/adapters/claude-code/hooks.mjs');

/** A port the OS just handed out and released, so it is free right now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {net.AddressInfo} */ (server.address());
      server.close(() => resolve(port));
    });
  });
}

/** Hooks freshly installed at `port`, and nothing else in the settings file. */
async function hooksAt(port) {
  await fs.rm(hooks.SETTINGS_FILE, { force: true });
  await hooks.install(port);
  assert.equal(await hooks.installedPort(), port);
}

/** Isolated state and public dir for one daemon. */
async function daemonOpts() {
  const dir = scratchDir('daemon-');
  const publicDir = path.join(dir, 'public');
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(path.join(publicDir, 'index.html'), 'floor');
  return { stateFile: path.join(dir, 'state.json'), publicDir };
}

/** Run `fn` while capturing everything the daemon logs to stderr. */
async function capturingLog(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.map(String).join(' '));
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = original;
  }
}

// ---------------------------------------------------------------------------

test('with no port named, the daemon listens where the installed hooks post, and says so once', async () => {
  const hookPort = await freePort();
  const requested = await freePort();
  assert.notEqual(hookPort, requested);
  await hooksAt(hookPort);

  const opts = await daemonOpts();
  const { result: d, lines } = await capturingLog(() =>
    startDaemon({ port: requested, adoptHooksPort: true, ...opts }),
  );
  try {
    assert.equal(d.port, hookPort, 'the hooks win over the default');
    assert.equal(d.url, `http://127.0.0.1:${hookPort}/`);

    const snap = d.registry.snapshot();
    assert.equal(snap.hooks['claude-code'].installed, true, 'hooks now point at THIS daemon');
    assert.equal(
      snap.degraded['claude-code'],
      false,
      'so the header shows exact state and no banner',
    );

    const said = lines.filter((l) => /the installed Claude Code hooks post there/.test(l));
    assert.equal(said.length, 1, `exactly one line explains the port:\n${lines.join('\n')}`);
    assert.match(said[0], new RegExp(`listening on ${hookPort} rather than ${requested}`));
  } finally {
    await d.close();
  }
});

test('an explicit --port is honoured as given, and the header keeps its banner', async () => {
  const hookPort = await freePort();
  const explicit = await freePort();
  await hooksAt(hookPort);

  // What bin/deckhq.mjs passes for `--port <explicit>`: no adoption.
  const d = await startDaemon({ port: explicit, ...(await daemonOpts()) });
  try {
    assert.equal(d.port, explicit);
    const snap = d.registry.snapshot();
    assert.equal(snap.hooks['claude-code'].installed, false, 'hooks aim elsewhere');
    assert.equal(snap.degraded['claude-code'], true, 'so the banner offering a reinstall is up');

    // And the hooks route reports exactly where they aim, for that banner.
    const res = await fetch(d.url + 'api/hooks');
    const { adapters } = await res.json();
    const claude = adapters.find((a) => a.runtime === 'claude-code');
    assert.equal(claude.staleAtPort, hookPort);
  } finally {
    await d.close();
  }
});

test('the hooks port held by a DeckHQ daemon: refuse to start beside it, naming it', async () => {
  const first = await startDaemon({ port: 0, ...(await daemonOpts()) });
  try {
    await hooksAt(first.port);
    const requested = await freePort();
    const opts = await daemonOpts();

    await assert.rejects(
      () => startDaemon({ port: requested, adoptHooksPort: true, ...opts }),
      (err) => {
        assert.ok(err instanceof DeckhqAlreadyRunningError);
        assert.equal(err.port, first.port);
        assert.equal(err.url, first.url);
        assert.equal(err.label, 'Claude Code');
        return true;
      },
    );

    // Nothing was bound on the way to that decision.
    assert.equal(await portListening(requested), false);
  } finally {
    await first.close();
  }
});

test('the CLI turns that refusal into one line and a clean exit', async () => {
  const first = await startDaemon({ port: 0, ...(await daemonOpts()) });
  try {
    await hooksAt(first.port);

    const { code, stdout, stderr } = await new Promise((resolve) => {
      execFile(
        process.execPath,
        [BIN, '--no-open'],
        {
          timeout: 60_000,
          env: {
            ...process.env,
            CLAUDE_CONFIG_DIR: CLAUDE_DIR,
            DECKHQ_STATE_DIR: STATE_DIR,
            DECKHQ_DESKTOP_SESSIONS_DIR: DESKTOP_SESSIONS_DIR,
            DECKHQ_PORT: '',
          },
        },
        (err, out, errOut) =>
          resolve({ code: err ? (err.code ?? 1) : 0, stdout: out, stderr: errOut }),
      );
    });

    assert.equal(code, 0, `stderr: ${stderr}`);
    const lines = stdout.split('\n').filter((l) => l.trim());
    assert.equal(lines.length, 1, `one line, not a banner:\n${stdout}`);
    assert.match(lines[0], new RegExp(`already running at http://127\\.0\\.0\\.1:${first.port}/`));
    assert.match(lines[0], /Claude Code hooks post there/);
    assert.doesNotMatch(stdout, /DeckHQ {2}http/, 'the start banner must not appear');
  } finally {
    await first.close();
  }
});

test('the hooks port held by something that is not DeckHQ: fall back to the requested port', async () => {
  const hookPort = await freePort();
  const requested = await freePort();
  await hooksAt(hookPort);

  // A stranger on the hooks' port, answering 200 to everything with a body
  // that is not a DeckHQ snapshot.
  const stranger = http.createServer((_req, res) => res.end('not deckhq'));
  await new Promise((resolve) => stranger.listen(hookPort, '127.0.0.1', resolve));

  try {
    const opts = await daemonOpts();
    const { result: d, lines } = await capturingLog(() =>
      startDaemon({ port: requested, adoptHooksPort: true, ...opts }),
    );
    try {
      assert.equal(d.port, requested, 'no adoption, no walk: the requested port');
      assert.equal(d.registry.snapshot().hooks['claude-code'].installed, false);
      assert.ok(
        lines.some((l) => /held by something that is not DeckHQ/.test(l)),
        `the fallback is explained:\n${lines.join('\n')}`,
      );
    } finally {
      await d.close();
    }
  } finally {
    await new Promise((resolve) => stranger.close(resolve));
  }
});

test('no hooks installed: the requested port, exactly as before', async () => {
  await fs.rm(hooks.SETTINGS_FILE, { force: true });
  const requested = await freePort();
  const d = await startDaemon({ port: requested, adoptHooksPort: true, ...(await daemonOpts()) });
  try {
    assert.equal(d.port, requested);
  } finally {
    await d.close();
  }
});

// ---------------------------------------------------------------------------

/** @param {number} port */
function portListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}
