/**
 * MK numbering. The value of a tag like `MK3.2` is entirely in its
 * stability — a number the user has learned must never come to mean something
 * else — so that is what this suite guards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../../src/core/store.mjs';
import { Identity } from '../../src/core/identity.mjs';
import { SHORT_NAMES } from '../../public/names.js';

async function freshStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckhq-identity-'));
  const store = new Store(path.join(dir, 'state.json'));
  await store.load();
  return { store, dir };
}

test('projects are numbered in the order they are first seen', async () => {
  const { store, dir } = await freshStore();
  const id = new Identity(store);
  assert.equal(id.projectMk('alpha'), 1);
  assert.equal(id.projectMk('beta'), 2);
  assert.equal(id.projectMk('gamma'), 3);
  // Asking again never renumbers.
  assert.equal(id.projectMk('alpha'), 1);
  assert.equal(id.projectMk('beta'), 2);
  await fs.rm(dir, { recursive: true, force: true });
});

test('agents are numbered within their own project', async () => {
  const { store, dir } = await freshStore();
  const id = new Identity(store);
  assert.equal(id.describe('a1', 'alpha').mk, 'MK1.1');
  assert.equal(id.describe('a2', 'alpha').mk, 'MK1.2');
  // A different project restarts at .1 — the number is relative to the room.
  assert.equal(id.describe('b1', 'beta').mk, 'MK2.1');
  assert.equal(id.describe('a3', 'alpha').mk, 'MK1.3');
  await fs.rm(dir, { recursive: true, force: true });
});

test('STABILITY: a number is never reused after its agent is gone', async () => {
  const { store, dir } = await freshStore();
  const id = new Identity(store);
  id.describe('a1', 'alpha');
  id.describe('a2', 'alpha');
  id.describe('a3', 'alpha');

  // a2 and a3 are let go and vanish from the floor. A newcomer must not
  // inherit MK1.2 — a tag meaning a different session next week is worse
  // than a gap in the sequence.
  const next = id.describe('a4', 'alpha');
  assert.equal(next.mk, 'MK1.4');
  await fs.rm(dir, { recursive: true, force: true });
});

test('STABILITY: numbering survives a daemon restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckhq-identity-'));
  const file = path.join(dir, 'state.json');

  const first = new Store(file);
  await first.load();
  const id1 = new Identity(first);
  id1.describe('a1', 'alpha');
  id1.describe('b1', 'beta');
  const before = id1.describe('b2', 'beta');
  id1.setDisplay('b2', { name: 'Marco', avatar: 'hex' });
  await first.flush();

  const second = new Store(file);
  await second.load();
  const id2 = new Identity(second);
  const after = id2.describe('b2', 'beta');

  assert.equal(after.mk, before.mk, 'the MK tag must survive a restart');
  assert.equal(after.displayName, 'Marco');
  assert.equal(after.avatar, 'hex');
  assert.equal(after.label, 'Marco', 'a name replaces the tag on the floor');
  // And a project seen for the first time after the restart continues the
  // sequence rather than colliding with an existing number.
  assert.equal(id2.projectMk('gamma'), 3);
  await fs.rm(dir, { recursive: true, force: true });
});

test('a display name replaces the given name as the label, and clearing it restores it', async () => {
  const { store, dir } = await freshStore();
  const id = new Identity(store);
  // Since WP-20 an agent arrives already named, so the label is that name and
  // not the tag. The tag is still there underneath, as the sub-label.
  const first = id.describe('a1', 'alpha');
  assert.equal(first.label, first.givenName);
  assert.equal(first.mk, 'MK1.1');

  id.setDisplay('a1', { name: 'Tai' });
  assert.equal(id.describe('a1', 'alpha').label, 'Tai');
  assert.equal(id.describe('a1', 'alpha').mk, 'MK1.1', 'the tag stays underneath');
  assert.equal(id.describe('a1', 'alpha').givenName, first.givenName, 'the given name survives');

  id.setDisplay('a1', { name: null });
  assert.equal(id.describe('a1', 'alpha').label, first.givenName);
  await fs.rm(dir, { recursive: true, force: true });
});

test('names are trimmed, bounded, and reported for collision checks', async () => {
  const { store, dir } = await freshStore();
  const id = new Identity(store);
  const a1 = id.describe('a1', 'alpha');
  id.setDisplay('a1', { name: '  Marco  ' });
  assert.equal(id.describe('a1', 'alpha').displayName, 'Marco');

  const a2 = id.describe('a2', 'alpha');
  id.setDisplay('a2', { name: 'x'.repeat(200) });
  assert.ok(id.describe('a2', 'alpha').displayName.length <= 24);

  // Both channels are reported: a name the daemon gave is as taken as one the
  // user chose, or the picker would offer a name somebody is already wearing.
  assert.deepEqual(
    id.takenNames().sort(),
    ['Marco', 'x'.repeat(24), a1.givenName, a2.givenName].sort(),
  );
  await fs.rm(dir, { recursive: true, force: true });
});

// ------------------------------------------------------- WP-20: given names

test('WP-20: an agent is named on first sight, from names.js, without being asked', async () => {
  const { store, dir } = await freshStore();
  const id = new Identity(store);
  const rec = id.describe('a1', 'alpha');
  assert.ok(rec.givenName, 'an agent must arrive with a name');
  assert.ok(
    SHORT_NAMES.includes(rec.givenName),
    `"${rec.givenName}" is not one of names.js's SHORT_NAMES`,
  );
  assert.equal(rec.displayName, null, 'a daemon-given name is not a user-chosen one');
  assert.equal(rec.label, rec.givenName);
  await fs.rm(dir, { recursive: true, force: true });
});

test('WP-20 STABILITY: a given name survives a daemon restart and is never reassigned', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckhq-identity-'));
  const file = path.join(dir, 'state.json');

  const first = new Store(file);
  await first.load();
  const id1 = new Identity(first);
  const before = id1.describe('a1', 'alpha');
  // Two more agents arrive after it, which is exactly the situation in which a
  // "pick the next free name" scheme would be tempted to renumber.
  id1.describe('a2', 'alpha');
  id1.describe('a3', 'beta');
  assert.equal(id1.describe('a1', 'alpha').givenName, before.givenName);
  await first.flush();

  const second = new Store(file);
  await second.load();
  const id2 = new Identity(second);
  assert.equal(id2.describe('a1', 'alpha').givenName, before.givenName);
  // And a newcomer after the restart still does not take it.
  assert.notEqual(id2.describe('a4', 'beta').givenName, before.givenName);
  await fs.rm(dir, { recursive: true, force: true });
});

test('WP-20: no two agents are given the same name, even past the end of the list', async () => {
  const { store, dir } = await freshStore();
  const id = new Identity(store);
  const seen = new Set();
  // Deliberately more agents than there are names: a repeat is the one thing
  // that must not happen, because MK tags exist to end exactly that confusion.
  const total = SHORT_NAMES.length + 12;
  for (let i = 0; i < total; i++) {
    const name = id.describe(`a${i}`, 'alpha').givenName;
    assert.ok(name, `agent a${i} got no name`);
    assert.ok(!seen.has(name.toLowerCase()), `"${name}" was handed out twice`);
    seen.add(name.toLowerCase());
  }
  assert.equal(seen.size, total);
  await fs.rm(dir, { recursive: true, force: true });
});

test('WP-20: a user-chosen name is never taken by the naming pass', async () => {
  const { store, dir } = await freshStore();
  const id = new Identity(store);
  id.describe('a1', 'alpha');
  id.setDisplay('a1', { name: 'Nova' });
  for (let i = 2; i < 30; i++) {
    assert.notEqual(
      String(id.describe(`a${i}`, 'alpha').givenName).toLowerCase(),
      'nova',
      'the naming pass handed out a name the user had already claimed',
    );
  }
  await fs.rm(dir, { recursive: true, force: true });
});

test('WP-20 INVARIANT: naming an agent writes no user-owned field', async () => {
  const { store, dir } = await freshStore();
  const id = new Identity(store);

  // A hundred agents seen, named, and described repeatedly. Nothing the user
  // owns — `name`, `avatar` — may have been written by any of it.
  for (let i = 0; i < 100; i++) {
    id.describe(`a${i}`, i % 3 === 0 ? 'alpha' : 'beta');
    id.describe(`a${i}`, i % 3 === 0 ? 'alpha' : 'beta');
  }
  for (const [agentId, rec] of Object.entries(store.identity.names)) {
    assert.ok(
      !('name' in rec) || rec.name == null,
      `${agentId}: identity assignment wrote the user's \`name\` field (${rec.name})`,
    );
    assert.ok(
      !('avatar' in rec) || rec.avatar == null,
      `${agentId}: identity assignment wrote the user's \`avatar\` field (${rec.avatar})`,
    );
  }

  // And the user's own values, once set, are not disturbed by later sightings.
  id.setDisplay('a7', { name: 'Ada', avatar: 'star' });
  for (let i = 0; i < 20; i++) id.describe('a7', 'beta');
  assert.equal(store.identity.names.a7.name, 'Ada');
  assert.equal(store.identity.names.a7.avatar, 'star');

  // Nothing outside the identity block is touched at all: no acknowledgement
  // was invented, and no project was archived or un-archived.
  assert.deepEqual(store.allAck(), {});
  assert.deepEqual(store.archivedProjects(), []);
  await fs.rm(dir, { recursive: true, force: true });
});
