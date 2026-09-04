/**
 * WP-45's acceptance criterion, `docs/plan/08-PLAN-V2-100X.md` §9:
 *
 *   > Nothing in it affects capture, the queue or any action, asserted by a
 *   > test that runs the acceptance script with and without the pack and
 *   > diffs the API responses.
 *
 * ============================================================================
 * WHAT IS DIFFED, AND WHY THAT IS THE RIGHT SURFACE
 *
 * There is no standalone acceptance script in this repository; the acceptance
 * SURFACE is the daemon's API, which is what every client — the page, the CLI,
 * the status line, the VS Code extension, the plugin — sees. So this file runs
 * the same scripted session against two real daemons on real loopback ports:
 * one with an empty packs directory, one with the sample Supporter pack
 * installed. Same planted transcripts, same clock-independent projection, same
 * sequence of actions.
 *
 * The script exercises, in order:
 *
 *   - `GET /api/state` — capture: which sessions were seen at all, their
 *     states, their projects, and the header counts.
 *   - `POST /api/ack` — every user-owned action the product has, and the
 *     state each one produces.
 *   - `GET /api/state` again — the queue after those actions.
 *   - `GET /api/settings` — with the ONE known difference accounted for.
 *
 * Everything is normalised for the things that legitimately differ between two
 * runs of anything (ids that carry a port, timestamps, a scan time) and then
 * compared as one deep-equal. A pack that changed any of it fails here.
 *
 * The one permitted difference is `settings.avatarSet`'s legal VALUES — with a
 * pack installed there is a set to choose, and without one there is not. The
 * stored value is `''` in both, so the diff above is unaffected; the test
 * asserts the difference explicitly rather than filtering it away silently.
 * ============================================================================
 *
 * The machine is pinned before `src/` is imported (`docs/DEVIATIONS.md` §124).
 */
import { daemonScratch, writeClaudeSession } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { startDaemon } = await import('../../src/daemon.mjs');
const packsCore = await import('../../src/core/packs.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SAMPLE_DIR = path.join(REPO, 'packs', 'supporter-sample');
const SAMPLE_SIGNED = path.join(SAMPLE_DIR, 'supporter-sample-1.0.0.deckhq-pack.json');

/**
 * The committed, SIGNED sample pack, installed into `dir`.
 *
 * Deliberately the real artifact rather than one this test signs with a key of
 * its own: signing here would need a trust seam in the daemon, and a product
 * whose signature check can be widened by a constructor option is a product
 * whose signature check is decoration. The sample pack is signed with the real
 * publisher key, the private half of which is not in this repository — so this
 * test exercises the same verification path a customer's install does.
 * @param {string} dir
 */
function installSample(dir) {
  const result = packsCore.installPack(fs.readFileSync(SAMPLE_SIGNED), { dir });
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  return result;
}

/**
 * Everything about a snapshot that is a claim about the user's work, with the
 * things that legitimately move between two runs removed.
 * @param {any} snapshot
 */
function acceptanceShape(snapshot) {
  return {
    counts: snapshot.counts,
    projects: (snapshot.projects || [])
      .map((p) => ({
        id: p.id,
        name: p.name,
        sessionCount: p.sessionCount,
        needsYou: p.needsYou,
        working: p.working,
        activeCount: p.activeCount,
        archived: p.archived === true,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    agents: (snapshot.agents || [])
      .map((a) => ({
        id: a.id,
        runtime: a.runtime,
        title: a.title,
        projectId: a.projectId,
        activityState: a.activityState,
        ackState: a.ackState,
        subagent: a.subagent === true,
        live: a.live,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/**
 * Run the acceptance script against one daemon and return everything it saw.
 * @param {{url:string}} d
 */
async function runScript(d) {
  const get = async (path_) => {
    const res = await fetch(d.url + path_);
    assert.equal(res.ok, true, `${path_} answered ${res.status}`);
    return res.json();
  };
  const post = async (path_, body) => {
    const res = await fetch(d.url + path_, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const before = await get('api/state');
  const target = before.agents[0];
  assert.ok(target, 'the acceptance script needs a session to act on');

  /** @type {any[]} */
  const actions = [];
  // Every user-owned action the product has, in an order each one is legal in.
  for (const action of ['acknowledge', 'review', 'bench', 'recall', 'let_go', 'rehire']) {
    const res = await post('api/ack', { id: target.id, action });
    actions.push({
      action,
      status: res.status,
      ackState: res.body?.agent?.ackState ?? res.body?.ackState ?? null,
      activityState: res.body?.agent?.activityState ?? res.body?.activityState ?? null,
      error: res.body?.error ?? null,
    });
  }

  const after = await get('api/state');
  const settings = await get('api/settings');

  return {
    before: acceptanceShape(before),
    actions,
    after: acceptanceShape(after),
    settings,
  };
}

/**
 * Start a daemon, run the script, stop it. Each call gets its own state file
 * and its own packs directory, so the two runs cannot see each other.
 * @param {{withPack:boolean}} opts
 */
async function scripted(opts) {
  const { dir, stateFile, publicDir } = daemonScratch(
    opts.withPack ? 'accept-pack-' : 'accept-bare-',
  );
  const packsDir = path.join(dir, 'packs');
  fs.mkdirSync(packsDir, { recursive: true });
  if (opts.withPack) installSample(packsDir);

  const d = await startDaemon({
    port: 0,
    stateFile,
    publicDir,
    packsDir,
    ratesFile: path.join(dir, 'rates.json'),
  });
  try {
    const result = await runScript(d);
    const packs = await (await fetch(d.url + 'api/packs')).json();
    return { result, packs, url: d.url, dir, packsDir };
  } finally {
    await d.close();
    // The registry is process-wide, so a run must not leave its themes behind
    // for the next one. This is the same call `deckhq pack remove` relies on.
    packsCore.clearPacks();
  }
}

test('ACCEPTANCE: the API is identical with and without a pack installed', async (t) => {
  const session = writeClaudeSession({ sessionId: 'aaaaaaaa-0000-0000-0000-000000000001' });
  t.after(() => session.remove());

  const bare = await scripted({ withPack: false });
  const packed = await scripted({ withPack: true });

  // The pack really was installed for the second run, and really was not for
  // the first — without this, the diff below could pass vacuously.
  assert.deepEqual(bare.packs.packs, []);
  assert.deepEqual(
    packed.packs.packs.map((p) => p.name),
    ['supporter-sample'],
  );
  assert.deepEqual(
    packed.packs.packs[0].themes.map((th) => th.name),
    ['warehouse', 'garden'],
  );

  // Capture. Every session seen, in the same state, in the same project.
  assert.deepEqual(packed.result.before, bare.result.before, 'a pack changed what was captured');
  // Every action, in the same order, with the same answer.
  assert.deepEqual(packed.result.actions, bare.result.actions, 'a pack changed an action');
  // The queue afterwards.
  assert.deepEqual(packed.result.after, bare.result.after, 'a pack changed the queue');

  // And the settings, which carry the ONE legitimate difference: what the
  // avatar picker may offer. The stored value is the same in both.
  assert.deepEqual(packed.result.settings, bare.result.settings, 'a pack changed a setting');
  assert.equal(bare.result.settings.avatarSet, '');
  assert.equal(packed.result.settings.avatarSet, '');
  assert.deepEqual(
    packed.packs.avatarSets.map((s) => s.name),
    ['warehouse crew'],
  );
  assert.deepEqual(bare.packs.avatarSets, []);

  await fsp.rm(bare.dir, { recursive: true, force: true });
  await fsp.rm(packed.dir, { recursive: true, force: true });
});

test('a pack theme is selectable, and removing the pack puts the floor back', async (t) => {
  const { dir, stateFile, publicDir } = daemonScratch('pack-theme-');
  const packsDir = path.join(dir, 'packs');
  fs.mkdirSync(packsDir, { recursive: true });
  installSample(packsDir);

  const d = await startDaemon({ port: 0, stateFile, publicDir, packsDir });
  t.after(async () => {
    await d.close();
    packsCore.clearPacks();
    await fsp.rm(dir, { recursive: true, force: true });
  });

  const setTheme = async (theme) => {
    const res = await fetch(d.url + 'api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme }),
    });
    return { status: res.status, body: await res.json() };
  };

  const ok = await setTheme('warehouse');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.theme, 'warehouse', 'a pack theme must be storable');

  // A theme no pack brought is still refused, with the offerable list.
  const bad = await setTheme('midnight');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /warehouse/);

  // And an avatar set from the pack is selectable, while one that does not
  // exist is refused rather than silently defaulted.
  const dressed = await fetch(d.url + 'api/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ avatarSet: 'warehouse crew' }),
  });
  assert.equal(dressed.status, 200);
  assert.equal((await dressed.json()).avatarSet, 'warehouse crew');

  const nonsense = await fetch(d.url + 'api/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ avatarSet: 'nobody' }),
  });
  assert.equal(nonsense.status, 400);

  // The store sanitises against what is REGISTERED, so a state file naming a
  // pack theme survives a restart with the pack installed. That is why the
  // daemon loads packs before it loads the store.
  await d.store.flush();
  const stored = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(stored.settings.theme, 'warehouse');

  // Remove the pack: the floor falls back to the default rather than staying
  // on a theme nothing can paint.
  assert.equal(packsCore.removePack('supporter-sample', { dir: packsDir }).ok, true);
  packsCore.currentPacks({ dir: packsDir, force: true });
  const { Store } = await import('../../src/core/store.mjs');
  const reloaded = new Store(stateFile);
  await reloaded.load();
  assert.equal(reloaded.settings.theme, 'default');
});

test('GET /api/packs reports a pack that will not load, rather than hiding it', async (t) => {
  const { dir, stateFile, publicDir } = daemonScratch('pack-bad-');
  const packsDir = path.join(dir, 'packs');
  fs.mkdirSync(path.join(packsDir, 'not-ours'), { recursive: true });
  fs.writeFileSync(
    path.join(packsDir, 'not-ours', 'pack.json'),
    fs.readFileSync(path.join(REPO, 'packs', 'supporter-sample', 'pack.json')),
  );

  const d = await startDaemon({ port: 0, stateFile, publicDir, packsDir });
  t.after(async () => {
    await d.close();
    packsCore.clearPacks();
    await fsp.rm(dir, { recursive: true, force: true });
  });

  const body = await (await fetch(d.url + 'api/packs')).json();
  assert.deepEqual(body.packs, []);
  assert.equal(body.errors.length, 1);
  assert.match(body.errors[0].error, /not signed/);

  // And the daemon still came up, still captures, still serves a floor. A
  // decoration that will not load must never stop the product.
  const state = await (await fetch(d.url + 'api/state')).json();
  assert.ok(Array.isArray(state.agents));
});

// ---------------------------------------------------------------------------
// The two free-core features WP-45 moved out of the pack
// ---------------------------------------------------------------------------

test('the rate-card editor writes the user override, and refuses a bad row whole', async (t) => {
  const { dir, stateFile, publicDir } = daemonScratch('rates-');
  const ratesFile = path.join(dir, 'rates.json');
  const d = await startDaemon({ port: 0, stateFile, publicDir, ratesFile });
  t.after(async () => {
    await d.close();
    await fsp.rm(dir, { recursive: true, force: true });
  });

  const post = async (body) => {
    const res = await fetch(d.url + 'api/rates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  const before = await (await fetch(d.url + 'api/rates')).json();
  assert.equal(before.override.present, false);
  assert.ok(before.builtin.rates.length > 0, 'the shipped table has to be readable');
  assert.equal(before.overrideFile, ratesFile);

  // Refused whole, and nothing written.
  for (const [body, re] of [
    [{ rates: [{ match: 'MY MODEL', input: 1, output: 2 }] }, /model id/],
    [{ rates: [{ match: 'a', input: -1, output: 2 }] }, /0 or more/],
    [{ rates: [{ match: 'a', input: 1 }] }, /needs an "input" and an "output"/],
    [{ rates: [{ match: 'a', input: 1, output: 2, per: 0 }] }, /cannot be 0/],
    [
      {
        rates: [
          { match: 'a', input: 1, output: 2 },
          { match: 'a', input: 3, output: 4 },
        ],
      },
      /appears twice/,
    ],
  ]) {
    const res = await post(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.body.error, re);
    assert.equal(fs.existsSync(ratesFile), false, 'a refused card must write nothing');
  }

  // A good one lands, and the daemon quotes it immediately.
  const saved = await post({
    version: 'mine-2026-09',
    rates: [{ match: 'my-model', input: 4, output: 20, per: 1e6 }],
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.version, 'mine-2026-09');
  const written = JSON.parse(fs.readFileSync(ratesFile, 'utf8'));
  assert.equal(written.rates.length, 1);
  // Cache read and write default from the input price rather than to zero:
  // pricing cached tokens at nothing would be the invented number WP-26 exists
  // to remove.
  assert.equal(written.rates[0].cacheRead, 0.4);
  assert.equal(written.rates[0].cacheWrite, 5);

  const about = await (await fetch(d.url + 'api/about')).json();
  assert.equal(typeof about.rateCardVersion, 'string');

  // Clearing every row removes the file rather than leaving an empty one
  // behind that would claim the table is overridden for ever.
  const cleared = await post({ rates: [] });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.removed, true);
  assert.equal(fs.existsSync(ratesFile), false);
});

test('INVARIANT: a replay over HTTP changes nothing, and needs no pack', async (t) => {
  const { dir, stateFile, publicDir } = daemonScratch('replay-http-');
  const ledgerDir = path.join(dir, 'ledger');
  const d = await startDaemon({ port: 0, stateFile, publicDir, ledgerDir });
  t.after(async () => {
    await d.close();
    await fsp.rm(dir, { recursive: true, force: true });
  });

  const days = await (await fetch(d.url + 'api/replay/days')).json();
  assert.ok(Array.isArray(days.days));

  // A day the ledger has never heard of is an empty replay, not an error: the
  // ledger only holds what happened.
  const res = await fetch(d.url + 'api/replay?day=2026-01-01');
  assert.equal(res.status, 200);
  const replay = await res.json();
  assert.equal(replay.day, '2026-01-01');
  assert.equal(replay.speed, 60);
  assert.ok(Array.isArray(replay.frames));

  // A day that is not a day is a 400 rather than a guess.
  assert.equal((await fetch(d.url + 'api/replay?day=yesterday')).status, 400);
  assert.equal((await fetch(d.url + 'api/replay')).status, 400);

  // The replay is free: it answered on a daemon with no packs directory at
  // all, and the ack state is untouched by having been watched.
  await d.store.flush();
  const stateBefore = fs.readFileSync(stateFile, 'utf8');
  await fetch(d.url + 'api/replay?day=2026-01-01');
  await d.store.flush();
  assert.equal(fs.readFileSync(stateFile, 'utf8'), stateBefore);
});
