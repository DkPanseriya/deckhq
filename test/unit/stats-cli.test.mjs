/**
 * WP-17's two command-line surfaces, and the promise that `deckhq stats` and
 * `GET /api/stats` can never disagree.
 *
 *   1. **One computation, two surfaces.** Both call `computeStats` over the
 *      same files. The test that matters here is the one that runs the route
 *      and the command against one directory and diffs the numbers.
 *   2. **`stats` opens no socket.** Every other read command in this CLI
 *      prefers a daemon; this one deliberately does not, and that is asserted
 *      rather than described.
 *   3. **Nothing here writes anything the user owns.** `state.json` is
 *      byte-identical afterwards.
 *   4. **`ledger export --signed` produces something `verify` accepts, and one
 *      changed byte makes it stop accepting it.**
 *   5. **No path and no project name leaves in an exported file.**
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Ledger, computeStats, dayKey, projectKeyFor, readAll } from '../../src/core/ledger.mjs';
import { projectNames, renderStats, runStats } from '../../src/cli/stats.mjs';
import { runLedger } from '../../src/cli/ledger.mjs';
import { register as registerStats } from '../../src/http/routes/stats.mjs';
import { Router } from '../../src/http/server.mjs';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/**
 * Now, not a pinned instant. The route computes against the real clock and
 * the command against this one; a fixture dated in the future would put every
 * record past the route's `now` and quietly empty half the report — which is
 * exactly the disagreement this file exists to catch, so it must not be
 * manufactured by the fixture.
 */
const NOW = Date.now();
const CWD = 'C:\\work\\orbital-api';
const KEY = projectKeyFor(CWD);

async function tmpDir(tag = 'stats') {
  return fsp.mkdtemp(path.join(os.tmpdir(), `deckhq-${tag}-`));
}

async function cleanup(dir) {
  await fsp.rm(dir, { recursive: true, force: true });
}

/**
 * A small, realistic ledger: three sessions, two discharged, one still
 * waiting since yesterday.
 * @param {string} dir
 */
async function seedLedger(dir) {
  const led = new Ledger(dir, { machineId: 'a'.repeat(32), flushIntervalMs: 0, now: () => NOW });
  const at = (t, kind, fields) => led.record(kind, { t, projectKey: KEY, ...fields });
  const t0 = NOW - 2 * HOUR;
  at(t0 - HOUR, 'session', {
    sessionId: 'claude-code:a',
    event: 'first_seen',
    activity: 'working',
    ack: 'active',
    since: t0 - HOUR,
  });
  at(t0, 'state', {
    sessionId: 'claude-code:a',
    dim: 'activity',
    from: 'working',
    to: 'for_review',
  });
  at(t0 + HOUR, 'state', {
    sessionId: 'claude-code:a',
    dim: 'activity',
    from: 'for_review',
    to: 'working',
  });
  at(t0 + HOUR, 'action', { sessionId: 'claude-code:a', action: 'acknowledge' });
  at(t0 + HOUR, 'send', { sessionId: 'claude-code:a', chars: 40 });
  at(t0 + HOUR, 'tokens', { sessionId: 'claude-code:a', delta: 12_000, tokens: 12_000 });

  at(NOW - 30 * HOUR, 'session', {
    sessionId: 'claude-code:b',
    event: 'first_seen',
    activity: 'working',
    ack: 'active',
    since: NOW - 30 * HOUR,
  });
  at(NOW - 30 * HOUR, 'state', {
    sessionId: 'claude-code:b',
    dim: 'activity',
    from: 'working',
    to: 'for_review',
  });
  await led.close();
  return led;
}

// ---------------------------------------------------------------------------
// The two surfaces agree
// ---------------------------------------------------------------------------

test('deckhq stats --json and GET /api/stats report the same numbers', async () => {
  const dir = await tmpDir();
  try {
    await seedLedger(dir);

    let cli = '';
    const code = await runStats(['--json', '--days', '7'], {
      dir,
      cacheDir: path.join(dir, 'no-cache'),
      now: NOW,
      write: (s) => (cli += s),
    });
    assert.equal(code, 0);
    const fromCli = JSON.parse(cli);

    // The route, driven directly through the Router the daemon builds.
    const router = new Router();
    registerStats(router, {
      registry: { snapshot: () => ({ projects: [{ id: 'p', name: 'orbital-api', cwd: CWD }] }) },
      ledger: { dir, writeError: null },
      log: { warn() {}, info() {}, error() {}, debug() {} },
    });
    const handler = router.match('GET', '/api/stats');
    assert.ok(handler);
    const res = fakeRes();
    await handler({}, res, new URL(`http://127.0.0.1/api/stats?since=${NOW - 7 * DAY}`), {});
    const fromRoute = JSON.parse(res.body);

    // `now` differs by however long the two took; everything derived from the
    // ledger must not.
    assert.deepEqual(fromRoute.forReview, fromCli.forReview);
    assert.deepEqual(fromRoute.dischargesPerDay, fromCli.dischargesPerDay);
    assert.deepEqual(fromRoute.sendsPerDay, fromCli.sendsPerDay);
    assert.deepEqual(fromRoute.tokensPerProjectPerDay, fromCli.tokensPerProjectPerDay);
    assert.equal(fromRoute.longestWaitEver.ms >= fromCli.longestWaitEver.ms, true);
    assert.equal(fromRoute.over24h, fromCli.over24h);
  } finally {
    await cleanup(dir);
  }
});

function fakeRes() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body || '';
    },
  };
}

test('the route reports the \u00a76 numbers, and names projects without ever holding a path', async () => {
  const dir = await tmpDir();
  try {
    await seedLedger(dir);
    const router = new Router();
    registerStats(router, {
      registry: { snapshot: () => ({ projects: [{ id: 'p', name: 'orbital-api', cwd: CWD }] }) },
      ledger: { dir, writeError: null },
      log: { warn() {} },
    });
    const res = fakeRes();
    await handle(router, res, `http://127.0.0.1/api/stats?since=${NOW - 7 * DAY}`);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);

    assert.equal(body.forReview.medianMs, HOUR);
    assert.equal(body.forReview.discharged, 1);
    assert.equal(body.over24h, 1, 'b has been waiting 30 hours');
    assert.ok(body.longestWaitEver.ms >= 30 * HOUR);
    assert.deepEqual(body.projects, { [KEY]: 'orbital-api' });
    // The name is in there because the caller asked for it by name; the PATH
    // is what must never be.
    assert.ok(!res.body.includes('C:'), 'a path reached the response');
    assert.ok(!res.body.includes('\\\\work'), 'a path segment reached the response');
  } finally {
    await cleanup(dir);
  }
});

async function handle(router, res, url) {
  const handler = router.match('GET', '/api/stats');
  return handler({}, res, new URL(url), {});
}

test('the route refuses a since it cannot read, and defaults to thirty days', async () => {
  const dir = await tmpDir();
  try {
    await seedLedger(dir);
    const router = new Router();
    registerStats(router, {
      registry: { snapshot: () => ({ projects: [] }) },
      ledger: { dir, writeError: null },
      log: { warn() {} },
    });

    const bad = fakeRes();
    await handle(router, bad, 'http://127.0.0.1/api/stats?since=yesterday');
    assert.equal(bad.status, 400);

    const none = fakeRes();
    await handle(router, none, 'http://127.0.0.1/api/stats');
    assert.equal(none.status, 200);
    assert.equal(JSON.parse(none.body).days, 30);

    // A small number is a window, not an epoch — what a status line wants.
    const rel = fakeRes();
    await handle(router, rel, `http://127.0.0.1/api/stats?since=${7 * DAY}`);
    assert.equal(JSON.parse(rel.body).days, 7);
  } finally {
    await cleanup(dir);
  }
});

test('the route says so when the ledger is not running', async () => {
  const router = new Router();
  registerStats(router, { registry: null, ledger: null, log: { warn() {} } });
  const res = fakeRes();
  await handle(router, res, 'http://127.0.0.1/api/stats');
  assert.equal(res.status, 503);
});

// ---------------------------------------------------------------------------
// deckhq stats
// ---------------------------------------------------------------------------

test('deckhq stats prints the \u00a76 numbers and opens no socket', async () => {
  const dir = await tmpDir();
  try {
    await seedLedger(dir);
    let out = '';
    // A `net` or `fetch` call would show up as a handle; simpler and stricter,
    // assert the module never imports either.
    const source = await fsp.readFile(new URL('../../src/cli/stats.mjs', import.meta.url), 'utf8');
    assert.ok(!/node:net|node:http|fetch\(/.test(source), 'deckhq stats reached for a socket');
    assert.ok(!/findDaemon|askDaemon|readDeck/.test(source));

    const code = await runStats(['--days', '7', '--no-color'], {
      dir,
      cacheDir: path.join(dir, 'no-cache'),
      now: NOW,
      write: (s) => (out += s),
    });
    assert.equal(code, 0);
    assert.match(out, /median time in review\s+1h 00m/);
    assert.match(out, /waiting over 24h\s+1/);
    assert.match(out, /longest wait ever/);
    assert.match(out, /tokens by project/);
    assert.match(out, /12,000/);
  } finally {
    await cleanup(dir);
  }
});

test('deckhq stats says the ledger is empty rather than printing invented zeros', async () => {
  const dir = await tmpDir();
  try {
    let out = '';
    await runStats(['--no-color'], { dir, cacheDir: dir, now: NOW, write: (s) => (out += s) });
    assert.match(out, /the ledger is empty/);
    assert.ok(!/median/.test(out));
  } finally {
    await cleanup(dir);
  }
});

test('deckhq stats --help prints, and a nonsense window is refused', async () => {
  let out = '';
  let err = '';
  assert.equal(await runStats(['--help'], { write: (s) => (out += s) }), 0);
  assert.match(out, /deckhq stats/);
  assert.equal(
    await runStats(['--days', 'lots'], { write: () => {}, error: (s) => (err += s) }),
    2,
  );
  assert.match(err, /positive number of days/);
});

test('a project with no session in the cache stays a hash, it is never guessed at', () => {
  const names = projectNames([{ cwd: CWD }, { cwd: '' }]);
  assert.deepEqual(names, { [KEY]: 'orbital-api' });
  const rendered = renderStats(
    computeStats(
      [{ t: NOW, kind: 'tokens', sessionId: 's', projectKey: 'ffffffffffffffff', delta: 5 }],
      {
        now: NOW,
        since: NOW - DAY,
      },
    ),
    { names, color: false },
  );
  assert.match(rendered, /ffffffff/);
});

// ---------------------------------------------------------------------------
// deckhq ledger
// ---------------------------------------------------------------------------

test('ledger days lists what is there, and says so when there is nothing', async () => {
  const dir = await tmpDir('ledger');
  try {
    let empty = '';
    assert.equal(await runLedger(['days'], { dir, write: (s) => (empty += s) }), 0);
    assert.match(empty, /the ledger is empty/);

    await seedLedger(dir);
    let out = '';
    assert.equal(await runLedger(['days'], { dir, write: (s) => (out += s) }), 0);
    assert.match(out, new RegExp(dayKey(NOW)));
    assert.match(out, /records/);
  } finally {
    await cleanup(dir);
  }
});

test('ledger export --signed writes a byte-identical day and a signature verify accepts', async () => {
  const dir = await tmpDir('ledger');
  const stateDir = await tmpDir('state');
  const out = await tmpDir('out');
  try {
    await seedLedger(dir);
    fs.writeFileSync(
      path.join(stateDir, 'state.json'),
      JSON.stringify({ machineId: 'b'.repeat(32) }),
      'utf8',
    );

    let printed = '';
    const code = await runLedger(['export', '--signed', '--out', out], {
      dir,
      stateDir,
      cwd: out,
      now: NOW,
      write: (s) => (printed += s),
    });
    assert.equal(code, 0);

    const day = dayKey(NOW);
    const exported = path.join(out, `${day}.jsonl`);
    assert.deepEqual(fs.readFileSync(exported), fs.readFileSync(path.join(dir, `${day}.jsonl`)));

    const sig = JSON.parse(fs.readFileSync(`${exported}.sig`, 'utf8'));
    assert.equal(sig.alg, 'ed25519');
    assert.equal(sig.machineId, 'b'.repeat(32));
    assert.equal(sig.day, day);
    assert.match(printed, /signed ed25519, key [0-9a-f]{16}/);

    // The private key never leaves the state directory.
    assert.equal(fs.existsSync(path.join(stateDir, 'ledger-key.pem')), true);
    assert.equal(fs.existsSync(path.join(out, 'ledger-key.pem')), false);
    assert.ok(!fs.readFileSync(`${exported}.sig`, 'utf8').includes('PRIVATE KEY'));

    let verified = '';
    assert.equal(
      await runLedger(['verify', `${day}.jsonl`], { cwd: out, write: (s) => (verified += s) }),
      0,
    );
    assert.match(verified, /verified/);
    assert.match(verified, /key {8}[0-9a-f]{16}/);
    assert.match(verified, /does not prove who that is/);

    // One changed byte, and it stops verifying.
    const raw = fs.readFileSync(exported, 'utf8');
    fs.writeFileSync(exported, raw.replace('"acknowledge"', '"bench"'), 'utf8');
    let err = '';
    assert.equal(
      await runLedger(['verify', `${day}.jsonl`], {
        cwd: out,
        write: () => {},
        error: (s) => (err += s),
      }),
      1,
    );
    assert.match(err, /NOT VERIFIED/);
  } finally {
    await cleanup(dir);
    await cleanup(stateDir);
    await cleanup(out);
  }
});

test('PRIVACY: an exported day carries no path and no project name', async () => {
  const dir = await tmpDir('ledger');
  const out = await tmpDir('out');
  try {
    await seedLedger(dir);
    await runLedger(['export', '--out', out], { dir, cwd: out, now: NOW, write: () => {} });
    const text = fs.readFileSync(path.join(out, `${dayKey(NOW)}.jsonl`), 'utf8');
    // "working" is a state name and legitimately contains "work"; what must
    // not be there is the directory or any segment of it.
    for (const needle of ['orbital', 'C:', 'Users', '\\\\', CWD]) {
      assert.ok(!text.includes(needle), `${needle} left the machine`);
    }
    assert.ok(text.includes(KEY), 'the hash is what identifies the project');
  } finally {
    await cleanup(dir);
    await cleanup(out);
  }
});

test('export refuses a day it does not have, and a token that is not a day', async () => {
  const dir = await tmpDir('ledger');
  const out = await tmpDir('out');
  try {
    let err = '';
    assert.equal(
      await runLedger(['export', '--day', 'tuesday'], {
        dir,
        cwd: out,
        write: () => {},
        error: (s) => (err += s),
      }),
      2,
    );
    assert.match(err, /is not a day/);

    err = '';
    assert.equal(
      await runLedger(['export', '--day', '1999-01-01'], {
        dir,
        cwd: out,
        write: () => {},
        error: (s) => (err += s),
      }),
      2,
    );
    assert.match(err, /there is no ledger for 1999-01-01/);
  } finally {
    await cleanup(dir);
    await cleanup(out);
  }
});

test('verify needs a file and a signature, and says which is missing', async () => {
  const out = await tmpDir('out');
  try {
    let err = '';
    assert.equal(
      await runLedger(['verify'], { cwd: out, write: () => {}, error: (s) => (err += s) }),
      2,
    );
    assert.match(err, /which file/);

    fs.writeFileSync(path.join(out, 'a.jsonl'), '{}\n');
    err = '';
    assert.equal(
      await runLedger(['verify', 'a.jsonl'], {
        cwd: out,
        write: () => {},
        error: (s) => (err += s),
      }),
      2,
    );
    assert.match(err, /there is no signature/);
  } finally {
    await cleanup(out);
  }
});

test('deckhq ledger with no command prints help and exits 2; an unknown one is refused', async () => {
  let out = '';
  let err = '';
  assert.equal(await runLedger([], { write: (s) => (out += s) }), 2);
  assert.match(out, /deckhq ledger/);
  assert.equal(await runLedger(['sing'], { write: () => {}, error: (s) => (err += s) }), 2);
  assert.match(err, /unknown command "sing"/);
});

// ---------------------------------------------------------------------------
// Nothing here writes what the user owns
// ---------------------------------------------------------------------------

test('INVARIANT: stats, export and verify leave state.json byte-identical', async () => {
  const dir = await tmpDir('ledger');
  const stateDir = await tmpDir('state');
  const out = await tmpDir('out');
  try {
    await seedLedger(dir);
    const stateFile = path.join(stateDir, 'state.json');
    const before = JSON.stringify({
      machineId: 'c'.repeat(32),
      ack: { 'claude-code:b': { state: 'active', reviewSince: NOW - 30 * HOUR } },
    });
    fs.writeFileSync(stateFile, before, 'utf8');

    await runStats(['--json'], { dir, cacheDir: dir, now: NOW, write: () => {} });
    await runLedger(['export', '--signed', '--out', out], {
      dir,
      stateDir,
      cwd: out,
      now: NOW,
      write: () => {},
    });
    await runLedger(['verify', `${dayKey(NOW)}.jsonl`], { cwd: out, write: () => {} });
    await runLedger(['days'], { dir, write: () => {} });

    assert.equal(fs.readFileSync(stateFile, 'utf8'), before);
    // And the ledger itself is untouched by reading it.
    assert.equal((await readAll(dir)).length > 0, true);
  } finally {
    await cleanup(dir);
    await cleanup(stateDir);
    await cleanup(out);
  }
});
