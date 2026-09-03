/**
 * The Claude Code adapter's cached live roster.
 *
 * `claude agents --json` boots the whole CLI — 490 ms median wall and 406-984
 * ms of the child's own CPU on the reference machine — and the daemon asked
 * it that question every 5 s forever. The roster is now cached, and corrected
 * between probes by two cheap signals: a pid check retires a session that
 * exited, and the scan drags a probe forward when a transcript moves for a
 * session the roster does not list. See docs/DEVIATIONS.md §77.
 *
 * Every test drives `liveSessions` through its three seams — `probe` in place
 * of the spawn, so probes can be counted exactly; `now` in place of the clock,
 * so a TTL can be crossed without sleeping through it; and `alive` in place of
 * the pid check, so a pid can die and be handed to another process on cue.
 * Nothing here spawns a CLI.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { adapter, _resetLiveProbeCache } from '../../src/adapters/claude-code/adapter.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADAPTER = pathToFileURL(
  path.resolve(HERE, '../../src/adapters/claude-code/adapter.mjs'),
).href;
const FIXTURE = path.resolve(HERE, '../fixtures/claude-sample.jsonl');

// Mirrors the constants in the adapter. Deliberately re-stated rather than
// imported: a test that read them from the module could not notice them
// changing, which is part of what it is here to guard.
const TTL_MS = 60_000;
const MIN_INTERVAL_MS = 10_000;

const T0 = 1_800_000_000_000;

/** This process is always alive; nothing sane holds the other pid. */
const LIVE_PID = process.pid;
const DEAD_PID = 0x7ffffffe;

/** A roster entry in the shape `probeLiveSessions` builds. */
function session(sessionId, pid) {
  return {
    id: `claude-code:${sessionId}`,
    runtime: 'claude-code',
    cwd: 'C:\\Dk\\Projects\\FixtureProj',
    name: sessionId,
    startedAt: T0 - 1000,
    pid,
  };
}

/**
 * A probe that counts its own calls and answers from a queue of rosters,
 * repeating the last one once the queue runs dry.
 */
function countingProbe(...rosters) {
  const fn = async () => {
    fn.calls += 1;
    return rosters[Math.min(fn.calls - 1, rosters.length - 1)] || [];
  };
  fn.calls = 0;
  return fn;
}

// --------------------------------------------------------------------------

test('the first call always probes, and hands back what the CLI said', async () => {
  _resetLiveProbeCache();
  const probe = countingProbe([session('a', LIVE_PID)]);
  const out = await adapter.liveSessions({ probe, now: T0 });
  assert.equal(probe.calls, 1);
  assert.deepEqual(
    out.map((s) => s.id),
    ['claude-code:a'],
  );
});

test('calls inside the TTL are served from the cache without spawning', async () => {
  _resetLiveProbeCache();
  const probe = countingProbe([session('a', LIVE_PID)]);
  await adapter.liveSessions({ probe, now: T0 });

  // Five more polls at the daemon's real 5 s interval, all inside the TTL.
  for (let i = 1; i <= 5; i++) {
    const out = await adapter.liveSessions({ probe, now: T0 + i * 5000 });
    assert.deepEqual(
      out.map((s) => s.id),
      ['claude-code:a'],
      `poll ${i} lost the roster`,
    );
  }
  assert.equal(probe.calls, 1, 'six polls must cost exactly one spawn');
});

test('the TTL expiring probes again', async () => {
  _resetLiveProbeCache();
  const probe = countingProbe([session('a', LIVE_PID)], [session('b', LIVE_PID)]);
  await adapter.liveSessions({ probe, now: T0 });
  await adapter.liveSessions({ probe, now: T0 + TTL_MS - 1 });
  assert.equal(probe.calls, 1);

  const out = await adapter.liveSessions({ probe, now: T0 + TTL_MS });
  assert.equal(probe.calls, 2);
  assert.deepEqual(
    out.map((s) => s.id),
    ['claude-code:b'],
  );
});

test('a session whose process exited leaves the roster within one poll', async () => {
  _resetLiveProbeCache();
  const probe = countingProbe([session('alive', LIVE_PID), session('gone', DEAD_PID)]);
  const first = await adapter.liveSessions({ probe, now: T0 });
  assert.equal(first.length, 2, 'the probe itself is not second-guessed');

  const second = await adapter.liveSessions({ probe, now: T0 + 5000 });
  assert.equal(probe.calls, 1, 'retiring a dead session must not cost a spawn');
  assert.deepEqual(
    second.map((s) => s.id),
    ['claude-code:alive'],
  );
});

test('an entry with no pid survives until the next probe', async () => {
  _resetLiveProbeCache();
  const probe = countingProbe([session('nopid', null)]);
  await adapter.liveSessions({ probe, now: T0 });
  const out = await adapter.liveSessions({ probe, now: T0 + 5000 });
  assert.equal(probe.calls, 1);
  assert.deepEqual(
    out.map((s) => s.id),
    ['claude-code:nopid'],
    'nothing cheap can call this dead, so the probe stays authoritative',
  );
});

// --- The pid check, and what it cannot know (docs/DEVIATIONS.md §82) -------

test('a pid that has really exited reads dead on this platform, not just a pid that never existed', async () => {
  // DEAD_PID above never existed. The case the roster actually meets is a
  // process that ran and exited, and on Windows those are different code
  // paths inside libuv (`OpenProcess` failing vs `GetExitCodeProcess`
  // reporting an exit). Both must come back ESRCH, never EPERM, or a finished
  // session would sit at its desk until the TTL.
  const child = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
  await new Promise((resolve) => child.once('exit', resolve));

  _resetLiveProbeCache();
  const probe = countingProbe([session('alive', LIVE_PID), session('exited', child.pid)]);
  await adapter.liveSessions({ probe, now: T0 });
  const out = await adapter.liveSessions({ probe, now: T0 + 5000 });
  assert.equal(probe.calls, 1);
  assert.deepEqual(
    out.map((s) => s.id),
    ['claude-code:alive'],
  );
});

test('pid reuse: a pid once seen dead cannot bring its session back before the next probe', async () => {
  // The session exits, the check sees it (poll 2), and by poll 3 the OS has
  // handed the same pid to something else. The roster is corrected by
  // removal, not by re-evaluation, so the impostor cannot revive the entry.
  _resetLiveProbeCache();
  const REUSED = 4242;
  let pidIsAlive = true;
  const alive = (pid) => (pid === REUSED ? pidIsAlive : pid === LIVE_PID);
  const probe = countingProbe([session('kept', LIVE_PID), session('reused', REUSED)]);

  await adapter.liveSessions({ probe, now: T0, alive });
  pidIsAlive = false; // the session's process exits
  const retired = await adapter.liveSessions({ probe, now: T0 + 5000, alive });
  assert.deepEqual(
    retired.map((s) => s.id),
    ['claude-code:kept'],
  );

  pidIsAlive = true; // some other process now holds the pid
  for (let i = 2; i * 5000 < TTL_MS; i++) {
    const out = await adapter.liveSessions({ probe, now: T0 + i * 5000, alive });
    assert.deepEqual(
      out.map((s) => s.id),
      ['claude-code:kept'],
      `poll ${i}: a reused pid must not resurrect a retired session`,
    );
  }
  assert.equal(probe.calls, 1, 'and none of that may cost a spawn');
});

test('pid reuse the check never saw reads live until the next probe, and not past it', async () => {
  // The accepted exposure, pinned so its size is a fact and not a guess: the
  // session exits AND its pid is reused inside one poll interval, so no check
  // ever sees it dead. This process's own pid stands in for the impostor.
  // Measured on the reference machine a pid recurs after 123–155 further
  // process creations, so this needs ~25 spawns a second during the 5 s the
  // check is blind. The roster may be wrong for the rest of the TTL and must
  // be right the moment the probe answers again.
  _resetLiveProbeCache();
  const probe = countingProbe([session('reused', LIVE_PID)], []);
  await adapter.liveSessions({ probe, now: T0 });

  const inside = await adapter.liveSessions({ probe, now: T0 + TTL_MS - 5000 });
  assert.equal(inside.length, 1, 'inside the TTL the impostor reads live — the documented price');
  assert.equal(probe.calls, 1);

  const after = await adapter.liveSessions({ probe, now: T0 + TTL_MS });
  assert.equal(probe.calls, 2, 'the TTL probe is what corrects it');
  assert.deepEqual(
    after,
    [],
    'and the correction is complete: nothing survives a probe that omits it',
  );
});

test('the returned roster is a copy — a caller cannot write into the cache', async () => {
  _resetLiveProbeCache();
  const probe = countingProbe([session('a', LIVE_PID)]);
  const first = await adapter.liveSessions({ probe, now: T0 });
  first[0].cwd = 'MUTATED';
  first.length = 0;

  const second = await adapter.liveSessions({ probe, now: T0 + 5000 });
  assert.equal(probe.calls, 1);
  assert.equal(second.length, 1);
  assert.notEqual(second[0].cwd, 'MUTATED');
});

test('liveSessions() with no arguments keeps its never-throws contract', async () => {
  _resetLiveProbeCache();
  const out = await adapter.liveSessions();
  assert.ok(Array.isArray(out));
  _resetLiveProbeCache();
});

// --------------------------------------------------------------------------
// The scan's half of the contract. `CLAUDE_CONFIG_DIR` is read at module
// import time, so these run in a child process against a throwaway machine —
// the same shape as test/unit/claude-scan-cache.test.mjs.

/** A `~/.claude` holding one project directory. */
async function makeWorld() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-live-'));
  const claudeDir = path.join(root, 'claude');
  const projectDir = path.join(claudeDir, 'projects', 'C--Dk-Projects-FixtureProj');
  await fsp.mkdir(projectDir, { recursive: true });
  return { root, claudeDir, projectDir, stateDir: path.join(root, 'data') };
}

/** @param {Awaited<ReturnType<typeof makeWorld>>} world */
function inChild(world, body) {
  const script = [
    `const { adapter, _resetLiveProbeCache } = await import(${JSON.stringify(ADAPTER)});`,
    `const out = (v) => process.stdout.write(JSON.stringify(v));`,
    `const scan = () => adapter.scanSessions({ maxAgeDays: 36500, limit: 5000 });`,
    `const countingProbe = ${countingProbe.toString()};`,
    `const T0 = ${T0};`,
    `const MIN_INTERVAL_MS = ${MIN_INTERVAL_MS};`,
    `const TTL_MS = ${TTL_MS};`,
    body,
  ].join('\n');
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: world.claudeDir,
      DECKHQ_STATE_DIR: world.stateDir,
      // Point the desktop-app store at a directory that does not exist, so a
      // real one on the developer's machine cannot reach these assertions.
      DECKHQ_DESKTOP_SESSIONS_DIR: path.join(world.root, 'no-desktop'),
    },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

/**
 * Plant a transcript whose newest in-file timestamp is `at`. The fixture's
 * own timestamps are rewritten, because the scan sorts and compares on the
 * content-derived `lastActivityAt`, not on the file's mtime.
 * @param {Awaited<ReturnType<typeof makeWorld>>} world
 */
async function plantTranscript(world, sessionId, at) {
  const raw = await fsp.readFile(FIXTURE, 'utf8');
  const stamp = new Date(at).toISOString();
  const rewritten = raw.replace(/"timestamp":\s*"[^"]*"/g, `"timestamp":"${stamp}"`);
  await fsp.writeFile(path.join(world.projectDir, `${sessionId}.jsonl`), rewritten, 'utf8');
}

test('a transcript moving for a session the roster omits drags the probe forward', async () => {
  const world = await makeWorld();
  try {
    // Activity stamped after the probe: what a session coming alive since the
    // last probe looks like from disk.
    await plantTranscript(world, '22222222-2222-2222-2222-222222222222', T0 + 60_000);
    const got = inChild(
      world,
      `
      _resetLiveProbeCache();
      // The roster never lists this session, so the scan's evidence
      // contradicts it. Probed at T0; the TTL alone would hold until T0+30s.
      const probe = countingProbe([]);
      await adapter.liveSessions({ probe, now: T0 });
      const afterFirst = probe.calls;

      await scan();

      // Inside the minimum interval: the flag is set, but it must not spend
      // a spawn yet.
      await adapter.liveSessions({ probe, now: T0 + 5000 });
      const held = probe.calls;

      // Past the minimum interval, still well inside the TTL.
      await adapter.liveSessions({ probe, now: T0 + MIN_INTERVAL_MS });
      out({ afterFirst, held, forced: probe.calls });
      `,
    );
    assert.equal(got.afterFirst, 1);
    assert.equal(got.held, 1, 'the minimum interval must hold the forced probe back');
    assert.equal(got.forced, 2, 'once past it, the scan must have forced a fresh probe');
  } finally {
    await fsp.rm(world.root, { recursive: true, force: true });
  }
});

test('a scan that agrees with the roster does not force anything', async () => {
  const world = await makeWorld();
  const sessionId = '33333333-3333-3333-3333-333333333333';
  try {
    await plantTranscript(world, sessionId, T0 + 60_000);
    const got = inChild(
      world,
      `
      _resetLiveProbeCache();
      // This time the roster DOES list the busy session.
      const probe = countingProbe([{
        id: ${JSON.stringify(`claude-code:${sessionId}`)},
        runtime: 'claude-code',
        cwd: 'anywhere',
        name: 'busy',
        startedAt: T0,
        pid: process.pid,
      }]);
      await adapter.liveSessions({ probe, now: T0 });
      await scan();
      await adapter.liveSessions({ probe, now: T0 + MIN_INTERVAL_MS });
      await scan();
      await adapter.liveSessions({ probe, now: T0 + TTL_MS - 1 });
      out({ calls: probe.calls });
      `,
    );
    assert.equal(got.calls, 1, 'a roster that already explains the activity is not stale');
  } finally {
    await fsp.rm(world.root, { recursive: true, force: true });
  }
});

test('activity older than the last probe never forces one', async () => {
  const world = await makeWorld();
  try {
    // Stamped BEFORE the probe: the probe already saw this and said no.
    await plantTranscript(world, '44444444-4444-4444-4444-444444444444', T0 - 60_000);
    const got = inChild(
      world,
      `
      _resetLiveProbeCache();
      const probe = countingProbe([]);
      await adapter.liveSessions({ probe, now: T0 });
      await scan();
      await adapter.liveSessions({ probe, now: T0 + MIN_INTERVAL_MS });
      out({ calls: probe.calls });
      `,
    );
    assert.equal(got.calls, 1);
  } finally {
    await fsp.rm(world.root, { recursive: true, force: true });
  }
});
