/**
 * `GET /api/traits` — WP-28's server half, against a real daemon.
 *
 * Three things the unit suite cannot say:
 *
 *   1. **A floor with no ledger behind it says "new here" for everybody**, and
 *      says it as a line rather than as an empty string. The degraded path is
 *      the one nearly every real floor is on the day the feature lands, so it
 *      is the one worth an end-to-end test.
 *   2. **The line on the wire is the line the ledger implies.** A day file is
 *      written by hand AFTER the daemon is up — `readAll` runs per request, so
 *      the response has to move — and the trait line is read back off the
 *      socket.
 *   3. **PRIVACY: nothing on this route names a path.** Ledger records carry a
 *      project hash by design (`docs/DEVIATIONS.md` §100 decision 5) and this
 *      response carries no project at all, so the assertion is simply that
 *      neither a directory nor the sandbox home appears anywhere in the body.
 *
 * The daemon runs against a scratch state directory, so nothing touches the
 * real `~/.deckhq`. The machine is pinned before `src/` is imported, for the
 * reason `docs/DEVIATIONS.md` §124 gives.
 */
import { HOME as SANDBOX, scratchDir } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const { startDaemon } = await import('../../src/daemon.mjs');
const { dayKey } = await import('../../src/core/ledger.mjs');

async function withDaemon(fn) {
  const dir = scratchDir('traits-');
  const publicDir = path.join(dir, 'public');
  const ledgerDir = path.join(dir, 'ledger');
  await fs.mkdir(publicDir);
  await fs.mkdir(ledgerDir);
  await fs.writeFile(path.join(publicDir, 'index.html'), 'floor');
  const d = await startDaemon({
    port: 0,
    stateFile: path.join(dir, 'state.json'),
    publicDir,
    ledgerDir,
  });
  try {
    await fn(d, ledgerDir);
  } finally {
    await d.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('a floor with nothing behind it says "new here", for everybody', async () => {
  await withDaemon(async (d) => {
    const res = await fetch(`${d.url}api/traits`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.traits && typeof body.traits === 'object');

    const floor = await fetch(`${d.url}api/state`).then((r) => r.json());
    const ids = (floor.agents || []).map((a) => a.id);
    assert.ok(ids.length > 0, 'the daemon served an empty floor; there is nothing to trait');
    assert.deepEqual(Object.keys(body.traits).sort(), [...ids].sort());

    for (const [id, set] of Object.entries(body.traits)) {
      assert.equal(set.line, 'new here', id);
      assert.equal(set.degraded, true);
      assert.equal(set.turns, 0);
      assert.equal(set.tendency, null);
      assert.deepEqual(
        set.traits.map((t) => t.key),
        ['new_here'],
      );
    }
  });
});

test('a day file written under the daemon changes the line on the next read', async () => {
  await withDaemon(async (d, ledgerDir) => {
    const floor = await fetch(`${d.url}api/state`).then((r) => r.json());
    const target = floor.agents[0];
    assert.ok(target, 'no agent to write a ledger for');

    // Six stops: four clean finishes and two hands up, so the rate is 3.33
    // per ten and the band is "asks often".
    const now = Date.now();
    const lines = [];
    lines.push(
      JSON.stringify({
        t: now - 100_000,
        machineId: 'x'.repeat(32),
        projectKey: 'deadbeefdeadbeef',
        sessionId: target.id,
        kind: 'session',
        event: 'first_seen',
        activity: 'working',
        ack: 'active',
        since: now - 100_000,
      }),
    );
    for (let i = 0; i < 6; i++) {
      lines.push(
        JSON.stringify({
          t: now - 90_000 + i * 1000,
          machineId: 'x'.repeat(32),
          projectKey: 'deadbeefdeadbeef',
          sessionId: target.id,
          kind: 'state',
          dim: 'activity',
          from: 'working',
          to: i < 2 ? 'needs_input' : 'for_review',
        }),
      );
    }
    await fs.writeFile(
      path.join(ledgerDir, `${dayKey(now)}.jsonl`),
      lines.join('\n') + '\n',
      'utf8',
    );

    const body = await fetch(`${d.url}api/traits`).then((r) => r.json());
    const set = body.traits[target.id];
    assert.equal(set.degraded, false);
    assert.equal(set.turns, 6);
    assert.ok(set.line.startsWith('asks often'), set.line);
    assert.match(set.line, / · since \d{1,2} [A-Z][a-z]{2}$/);
    // Everyone else on the floor is untouched by one session's ledger.
    for (const [id, other] of Object.entries(body.traits)) {
      if (id === target.id) continue;
      assert.equal(other.line, 'new here', id);
    }

    // The single-agent form answers about that agent and nobody else.
    const one = await fetch(`${d.url}api/traits?id=${encodeURIComponent(target.id)}`).then((r) =>
      r.json(),
    );
    assert.deepEqual(Object.keys(one.traits), [target.id]);
  });
});

test('PRIVACY: no path, and no second person, reaches the response', async () => {
  await withDaemon(async (d) => {
    const text = await fetch(`${d.url}api/traits`).then((r) => r.text());
    for (const needle of [os.homedir(), SANDBOX, path.sep === '\\' ? 'C:\\' : '/home/']) {
      assert.equal(text.includes(needle), false, `the response leaked ${needle}`);
    }
    // docs/plan/08 §1.1 rule 6: the agents are described, the manager is not.
    for (const word of ['"you', ' you ', 'your ']) {
      assert.equal(text.toLowerCase().includes(word), false, `the response says "${word.trim()}"`);
    }
  });
});
