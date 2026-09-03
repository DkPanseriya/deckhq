/**
 * WP-19 end to end, as far as it can honestly be taken without a live runtime.
 *
 * `scripts/fake-permission-client.mjs` plays Claude Code: it POSTs the payload
 * §86.2 of `docs/DEVIATIONS.md` recorded, to the real route, on a real daemon,
 * and waits on the socket the way the runtime waits. Everything downstream of
 * it is production code — the route, the hold, the adapter's parser and its
 * response-body builder, the registry and its snapshot. Only the caller is
 * fake, and the caller is the half the expired login makes unavailable
 * (§86.1).
 *
 * What this therefore proves: the exact bytes DeckHQ puts on the wire for all
 * three buttons, and that a hold with nobody at the keyboard ends in no
 * decision at all. What it does NOT prove, and what no test can: that the
 * installed runtime accepts those bytes. That is the acceptance run, it is
 * still owed, and it needs `claude login` on the reference machine first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startDaemon } from '../../src/daemon.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '../../scripts/fake-permission-client.mjs');

/** Start a daemon with an isolated state file and public dir. */
async function withDaemon(opts, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckhq-permission-'));
  const publicDir = path.join(dir, 'public');
  await fs.mkdir(publicDir);
  await fs.writeFile(path.join(publicDir, 'index.html'), 'floor');
  const d = await startDaemon({
    port: 0,
    stateFile: path.join(dir, 'state.json'),
    publicDir,
    ...opts,
  });
  try {
    await fn(d);
  } finally {
    await d.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * Run the fake runtime. Resolves with what it printed on stdout — the decision
 * body, verbatim — and its exit code.
 * @param {number} port
 * @param {string[]} [args]
 */
function fakeRuntime(port, args = []) {
  const child = spawn(
    process.execPath,
    [CLIENT, '--port', String(port), '--session', 'sess-e2e', '--cwd', process.cwd(), ...args],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let out = '';
  let err = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (err += c));
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out: out.trim(), err }));
  });
}

/** Wait until the daemon is holding a request with this id. */
async function waitForHold(daemon, id, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // The panel learns about a hold through the snapshot; the test reads the
    // holder directly because the fixture has no session on the floor to hang
    // the card on, and inventing one would be testing the fixture.
    if (daemon.permissions?.size > 0) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`no permission request was held within ${timeoutMs}ms (looking for ${id})`);
}

/** POST the panel's answer. */
async function decide(daemon, id, decision) {
  const res = await fetch(`${daemon.url}api/permission/decide`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, decision }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test('Allow: the runtime gets exactly {behavior:"allow"} and nothing else', async () => {
  await withDaemon({}, async (d) => {
    const running = fakeRuntime(d.port, ['--id', 'toolu_allow']);
    await waitForHold(d, 'toolu_allow');
    const answered = await decide(d, 'toolu_allow', 'allow');
    assert.equal(answered.status, 200);

    const { code, out } = await running;
    assert.equal(code, 0, 'the runtime fell through instead of being answered');
    assert.deepEqual(JSON.parse(out), {
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
  });
});

test('Deny: behavior "deny" with a message, and interrupt is never sent', async () => {
  await withDaemon({}, async (d) => {
    const running = fakeRuntime(d.port, ['--id', 'toolu_deny']);
    await waitForHold(d, 'toolu_deny');
    await decide(d, 'toolu_deny', 'deny');

    const { code, out } = await running;
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(out), {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'Denied from DeckHQ.' },
      },
    });
    // `interrupt: true` would also abort the turn. Denying one command is not
    // stopping the agent, and the two stay separate actions.
    assert.doesNotMatch(out, /interrupt/);
  });
});

test('Allow for this session: the runtime\'s own rule comes back with destination "session"', async () => {
  await withDaemon({}, async (d) => {
    const running = fakeRuntime(d.port, ['--id', 'toolu_session', '--input', 'npm run deploy']);
    await waitForHold(d, 'toolu_session');
    await decide(d, 'toolu_session', 'session');

    const { code, out } = await running;
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(out), {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'allow',
          updatedPermissions: [
            {
              type: 'addRules',
              rules: [{ toolName: 'Bash', ruleContent: 'npm:*' }],
              behavior: 'allow',
              destination: 'session',
            },
          ],
        },
      },
    });
    // A permanent grant written into the user's settings files is not a button
    // this panel has.
    assert.doesNotMatch(out, /userSettings|projectSettings|localSettings|cliArg/);
  });
});

test('nobody answers: the hold expires into no decision, and the terminal prompt wins', async () => {
  // 250 ms instead of ten minutes. The point of the test is that what comes
  // back carries no decision, not how long the wait was.
  await withDaemon({ permissionHoldMs: 250 }, async (d) => {
    const { code, out } = await fakeRuntime(d.port, ['--id', 'toolu_timeout']);
    assert.equal(code, 1, 'a timeout must not look like an answer');
    assert.deepEqual(JSON.parse(out), {});
    assert.doesNotMatch(out, /behavior|hookSpecificOutput/);
  });
});

test('the daemon closing lets a waiting session go, deciding nothing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckhq-permission-'));
  const publicDir = path.join(dir, 'public');
  await fs.mkdir(publicDir);
  await fs.writeFile(path.join(publicDir, 'index.html'), 'floor');
  const d = await startDaemon({ port: 0, stateFile: path.join(dir, 'state.json'), publicDir });
  try {
    const running = fakeRuntime(d.port, ['--id', 'toolu_shutdown']);
    await waitForHold(d, 'toolu_shutdown');
    await d.close();

    const { code, out } = await running;
    assert.equal(code, 1);
    assert.deepEqual(JSON.parse(out), {}, 'a closing DeckHQ decided something on its way out');
  } finally {
    await d.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a tool that must be answered in the session is held, and refused from the API', async () => {
  await withDaemon({ permissionHoldMs: 400 }, async (d) => {
    const running = fakeRuntime(d.port, ['--id', 'toolu_ask', '--tool', 'AskUserQuestion']);
    await waitForHold(d, 'toolu_ask');
    const answered = await decide(d, 'toolu_ask', 'allow');
    assert.equal(answered.status, 409);
    assert.match(answered.body.error, /answered in the session/);

    // It still falls through to the terminal on its own, which is where it
    // always had to be answered.
    const { code, out } = await running;
    assert.equal(code, 1);
    assert.deepEqual(JSON.parse(out), {});
  });
});
