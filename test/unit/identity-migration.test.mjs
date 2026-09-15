/**
 * WP-86 · the one time a given name is allowed to change, and every guard on it.
 *
 * The owner, 15 September 2026: _"I don't like names like Livia 1, 2, 3. Make
 * the list big enough so that we do not run out of names."_
 *
 * Growing the pool (`names-pool.test.mjs`) fixes the future and nothing else. An
 * identity is written the first time an agent is seen and never reassigned, so
 * `Livia 2` — assigned back when the pool held sixty names and the machine held
 * ninety-two conversations — would have stayed on the floor for as long as that
 * session existed. So WP-86 takes the suffixes away ONCE, as a versioned store
 * migration, and this file is what keeps that from becoming a licence to rename
 * anything else:
 *
 *   1. a suffixed given name is replaced by the name the ordinary walk would
 *      have given it, and nothing else about the identity moves;
 *   2. a clean name is never touched;
 *   3. the pass is idempotent — running it twice changes nothing the second
 *      time, which matters because `load()` runs twice on a normal start;
 *   4. a fresh state file migrates nothing at all;
 *   5. a resume chain's identity is renamed once, because a chain has one
 *      identity (§155);
 *   6. the old name survives for a week as `formerName` and then stops.
 */

// A machine of our own, before anything under `src/` is loaded. §124.
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CLOCK_ENV } from '../../src/core/clock.mjs';
import { FORMER_NAME_MS, Identity, formerNameOf } from '../../src/core/identity.mjs';
import { collapseResumed } from '../../src/core/resume-chain.mjs';
import {
  MIGRATIONS,
  STATE_VERSION,
  migrateState,
  renameSuffixedNames,
} from '../../src/core/state-migrations.mjs';
import { Store } from '../../src/core/store.mjs';
import { SHORT_NAMES } from '../../public/names.js';

const T0 = Date.UTC(2026, 8, 15, 9, 0, 0);

/** Run `fn` with the daemon clock pinned, then put the environment back. */
async function atInstant(ms, fn) {
  const before = process.env[CLOCK_ENV];
  process.env[CLOCK_ENV] = new Date(ms).toISOString();
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env[CLOCK_ENV];
    else process.env[CLOCK_ENV] = before;
  }
}

/**
 * A state file an older build could plausibly have written: twelve identities
 * wearing the pool's "we ran out" marker and thirty wearing a name, all of them
 * with MK numbers and two of them renamed by the user.
 */
function fixtureState() {
  /** @type {Record<string, any>} */
  const names = {};
  /** @type {Record<string, number>} */
  const agents = {};
  /** @type {Record<string, string>} */
  const projectOf = {};

  // Thirty clean identities, drawing real names out of the frozen head so the
  // fixture looks like a machine rather than like a test.
  for (let i = 0; i < 30; i++) {
    const id = `claude-code:clean-${i}`;
    names[id] = { name: null, avatar: null, given: SHORT_NAMES[i] };
    agents[id] = i + 1;
    projectOf[id] = 'alpha';
  }
  // Twelve markers, of the two shapes the owner's floor actually showed.
  const markers = [
    'Livia 2',
    'Livia 3',
    'Greta 2',
    'Sena 3',
    'Wren 2',
    'Marco 2',
    'Juno 4',
    'Otto 2',
    'Mira 2',
    'Hugo 2',
    'Zola 3',
    'Piet 2',
  ];
  markers.forEach((given, i) => {
    const id = `claude-code:suffixed-${i}`;
    names[id] = { name: null, avatar: null, given };
    agents[id] = 100 + i;
    projectOf[id] = 'beta';
  });
  // Two names the USER chose. Nothing in this package may touch either.
  names['claude-code:clean-0'].name = 'Ada';
  names['claude-code:clean-0'].avatar = 'star';
  names['claude-code:clean-1'].name = 'Livia 2';

  return {
    version: 1,
    seededAt: null,
    machineId: null,
    settings: {},
    ack: {},
    identity: { projects: { alpha: 1, beta: 2 }, agents, projectOf, names, nextProject: 3 },
    archivedProjects: {},
    pins: {},
    layout: { rooms: [] },
    studio: { consent: {}, planner: {} },
  };
}

/** The 12 ids the fixture gave a marker to. */
function suffixedIds() {
  return Array.from({ length: 12 }, (_, i) => `claude-code:suffixed-${i}`);
}

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'deckhq-migration-'));
}

// ------------------------------------------------------ the pass, in isolation

test('WP-86: twelve suffixed identities are renamed and thirty clean ones are not', () => {
  const data = fixtureState();
  const before = JSON.parse(JSON.stringify(data.identity.names));

  const { renamed, leftAlone } = renameSuffixedNames(data.identity, T0);

  assert.equal(renamed.length, 12, 'every marker should have been taken away');
  assert.equal(leftAlone, 0, 'the pool had room for all twelve');

  for (const { to } of renamed) {
    assert.ok(SHORT_NAMES.includes(to), `"${to}" is not a name from the pool`);
    assert.ok(!/ \d+$/.test(to), `"${to}" is another marker, not a name`);
  }

  // The thirty are byte for byte what they were, user-owned fields included.
  for (let i = 0; i < 30; i++) {
    const id = `claude-code:clean-${i}`;
    assert.deepEqual(data.identity.names[id], before[id], `${id} was touched`);
  }

  // And nothing outside `names` moved: the MK numbers are the point of the
  // whole identity table and the migration has no business in them.
  assert.equal(data.identity.agents['claude-code:suffixed-0'], 100);
  assert.equal(data.identity.nextProject, 3);
});

test('WP-86: the rename collides with nothing, including the names the user chose', () => {
  const data = fixtureState();
  renameSuffixedNames(data.identity, T0);

  /** @type {string[]} */
  const worn = [];
  for (const rec of Object.values(data.identity.names)) {
    if (rec.name) worn.push(String(rec.name).toLowerCase());
    if (rec.given) worn.push(String(rec.given).toLowerCase());
  }
  assert.equal(new Set(worn).size, worn.length, `a name was handed out twice: ${worn.join(', ')}`);

  // The user's own fields are untouched — including the user who typed
  // "Livia 2" themselves, which is a name and not a marker because a person
  // chose it.
  assert.equal(data.identity.names['claude-code:clean-0'].name, 'Ada');
  assert.equal(data.identity.names['claude-code:clean-0'].avatar, 'star');
  assert.equal(data.identity.names['claude-code:clean-1'].name, 'Livia 2');
});

test('WP-86: the old marker is kept as formerName, with the instant it happened', () => {
  const data = fixtureState();
  renameSuffixedNames(data.identity, T0);
  for (const id of suffixedIds()) {
    const rec = data.identity.names[id];
    assert.ok(/ \d+$/.test(rec.formerName), `${id} kept no marker to explain itself`);
    assert.equal(rec.renamedAt, T0);
  }
});

test('WP-86 IDEMPOTENT: a second pass over the same data changes nothing', () => {
  const data = fixtureState();
  renameSuffixedNames(data.identity, T0);
  const after = JSON.parse(JSON.stringify(data.identity));

  const second = renameSuffixedNames(data.identity, T0 + 99_999);
  assert.deepEqual(second.renamed, [], 'the second pass found something to rename');
  assert.deepEqual(data.identity, after, 'the second pass moved something');
});

test('WP-86 DETERMINISTIC: the same state file yields the same names, key order aside', () => {
  // `load()` runs twice on a normal start and the debounced write may not have
  // landed in between, so the second pass genuinely sees the unmigrated file
  // again — and must choose the same names, or a name would change twice.
  const a = fixtureState();
  const b = fixtureState();
  // Same content, keys in the opposite order.
  b.identity.names = Object.fromEntries(Object.entries(b.identity.names).reverse());

  renameSuffixedNames(a.identity, T0);
  renameSuffixedNames(b.identity, T0);
  for (const id of suffixedIds()) {
    assert.equal(a.identity.names[id].given, b.identity.names[id].given, `${id} drifted`);
  }
});

test('WP-86: a record with no free name left keeps the marker rather than getting another', () => {
  // Six hundred names, six hundred and one identities. The last one cannot be
  // given a name, and swapping one marker for another would be churn.
  /** @type {Record<string, any>} */
  const names = {};
  SHORT_NAMES.forEach((given, i) => {
    names[`claude-code:full-${String(i).padStart(4, '0')}`] = { given };
  });
  names['claude-code:zzz-overflow'] = { given: 'Wren 2' };

  const identity = { names };
  const { renamed, leftAlone } = renameSuffixedNames(identity, T0);
  assert.deepEqual(renamed, []);
  assert.equal(leftAlone, 1);
  assert.equal(names['claude-code:zzz-overflow'].given, 'Wren 2');
  assert.equal(names['claude-code:zzz-overflow'].formerName, undefined);
});

// ------------------------------------------------------------- the versioning

test('WP-86: migrateState runs the pass once, records it, and stamps the version', () => {
  const data = fixtureState();
  const result = migrateState(data, { now: T0 });

  assert.equal(result.from, 1);
  assert.equal(result.to, STATE_VERSION);
  assert.equal(data.version, STATE_VERSION);
  assert.deepEqual(
    result.ran.map((r) => r.id),
    MIGRATIONS.map((m) => m.id),
  );
  assert.deepEqual(data.migrations['identity-suffixed-names'], {
    at: T0,
    version: 2,
    renamed: 12,
    leftAlone: 0,
  });

  // Again, on the file it just wrote: nothing runs, nothing changes.
  const snapshot = JSON.parse(JSON.stringify(data));
  const again = migrateState(data, { now: T0 + 60_000 });
  assert.deepEqual(again.ran, []);
  assert.deepEqual(data, snapshot);
});

test('WP-86: a file with no version at all is treated as the oldest, never as current', () => {
  const data = fixtureState();
  delete data.version;
  const result = migrateState(data, { now: T0 });
  assert.equal(result.from, 1);
  assert.equal(result.ran.length, MIGRATIONS.length);
});

// ------------------------------------------------------------- through a store

test('WP-86: the migration runs at daemon start, on the state file that is there', async () => {
  const dir = await tmpDir();
  const file = path.join(dir, 'state.json');
  await fs.writeFile(file, JSON.stringify(fixtureState(), null, 2), 'utf8');

  await atInstant(T0, async () => {
    const store = new Store(file);
    await store.load();
    const names = store.identity.names;
    for (const id of suffixedIds()) {
      assert.ok(!/ \d+$/.test(names[id].given), `${names[id].given} survived the daemon start`);
    }
    await store.flush();

    // A restart reads a migrated file and does nothing at all to it.
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(raw.version, STATE_VERSION);
    assert.equal(raw.migrations['identity-suffixed-names'].renamed, 12);

    const second = new Store(file);
    await second.load();
    for (const id of suffixedIds()) {
      assert.equal(second.identity.names[id].given, names[id].given, `${id} was renamed twice`);
    }
  });

  await fs.rm(dir, { recursive: true, force: true });
});

test('WP-86: a fresh state file is already current and has nothing to migrate', async () => {
  const dir = await tmpDir();
  const store = new Store(path.join(dir, 'state.json'));
  await store.load();
  const identity = new Identity(store);

  for (let i = 0; i < 40; i++) {
    const rec = identity.describe(`claude-code:new-${i}`, 'alpha');
    assert.ok(!/ \d+$/.test(rec.givenName), `a fresh machine produced "${rec.givenName}"`);
    assert.equal(rec.formerName, null, 'a fresh identity has nothing to have been');
  }
  await fs.rm(dir, { recursive: true, force: true });
});

// -------------------------------------------------------- the week of "was X"

test('WP-86: "was Livia 2" is on the record for a week and then is not', async () => {
  const dir = await tmpDir();
  const file = path.join(dir, 'state.json');
  await fs.writeFile(file, JSON.stringify(fixtureState(), null, 2), 'utf8');
  const id = 'claude-code:suffixed-0';

  await atInstant(T0, async () => {
    const store = new Store(file);
    await store.load();
    const rec = new Identity(store).describe(id, 'beta');
    assert.equal(rec.formerName, 'Livia 2');
    assert.notEqual(rec.givenName, 'Livia 2');
    await store.flush();
  });

  // A minute before the week is up, and a minute after. The daemon's clock is
  // the only clock in this: the panel is told or not told, it decides nothing.
  await atInstant(T0 + FORMER_NAME_MS - 60_000, async () => {
    const store = new Store(file);
    await store.load();
    assert.equal(new Identity(store).describe(id, 'beta').formerName, 'Livia 2');
  });
  await atInstant(T0 + FORMER_NAME_MS + 60_000, async () => {
    const store = new Store(file);
    await store.load();
    assert.equal(new Identity(store).describe(id, 'beta').formerName, null);
  });

  await fs.rm(dir, { recursive: true, force: true });
});

test('WP-86: formerNameOf says nothing about a record that was never renamed', () => {
  assert.equal(formerNameOf({}, T0), null);
  assert.equal(formerNameOf({ formerName: 'Livia 2' }, T0), null, 'no instant, no sentence');
  assert.equal(formerNameOf({ formerName: '', renamedAt: T0 }, T0), null);
  assert.equal(formerNameOf({ formerName: 'Livia 2', renamedAt: T0 }, T0), 'Livia 2');
});

// --------------------------------------------------- §155: one chain, one name

test('WP-86 + §155: a resume chain is renamed once, because it has one identity', async () => {
  // Four transcripts, one conversation. The floor reads the EARLIEST member's
  // identity and nobody else's (`identityOf`), so the chain has exactly one
  // name to take a marker away from — and it must change once, not four times,
  // and not to a different name on the second scan.
  const dir = await tmpDir();
  const file = path.join(dir, 'state.json');
  const data = fixtureState();
  const chain = ['chain-a', 'chain-b', 'chain-c', 'chain-d'].map((s) => `claude-code:${s}`);
  chain.forEach((id, i) => {
    data.identity.names[id] = { name: null, avatar: null, given: `Greer ${i + 2}` };
    data.identity.agents[id] = 200 + i;
    data.identity.projectOf[id] = 'beta';
  });
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');

  /** @param {string} id @param {number} at */
  const summary = (id, at) => ({
    id,
    runtime: /** @type {const} */ ('claude-code'),
    cwd: 'C:\\Dk\\Projects\\one',
    originUuid: 'shared-origin-uuid',
    lastActivityAt: at,
  });
  const scan = chain.map((id, i) => summary(id, T0 + i * 3600_000));

  await atInstant(T0, async () => {
    const store = new Store(file);
    await store.load();
    const identity = new Identity(store);

    const collapsed = collapseResumed(scan);
    assert.equal(collapsed.summaries.length, 1, 'four transcripts are one agent');
    const survivor = collapsed.summaries[0].id;
    const identityId = collapsed.identityOf.get(survivor) || survivor;
    assert.equal(identityId, chain[0], 'the chain wears the earliest identity');

    // The identity on the floor: renamed, once, to a name.
    const shown = identity.describe(identityId, 'beta');
    assert.ok(!/ \d+$/.test(shown.givenName));
    assert.equal(shown.formerName, 'Greer 2');

    // A second scan — the floor's normal poll — shows the same name. The
    // migration is not part of a refresh and cannot run again inside one.
    const again = identity.describe(identityId, 'beta');
    assert.equal(again.givenName, shown.givenName, 'the chain was renamed twice');

    // And the members the floor never reads kept their own records: each was
    // renamed once, in its own right, and none of them took the chain's name.
    const worn = new Set([shown.givenName.toLowerCase()]);
    for (const id of chain.slice(1)) {
      const rec = store.identity.names[id];
      assert.ok(!/ \d+$/.test(rec.given), `${id} kept a marker`);
      assert.ok(!worn.has(rec.given.toLowerCase()), `${rec.given} was handed out twice`);
      worn.add(rec.given.toLowerCase());
    }
  });

  await fs.rm(dir, { recursive: true, force: true });
});
