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

test('a display name replaces the tag as the label, and clearing it restores the tag', async () => {
  const { store, dir } = await freshStore();
  const id = new Identity(store);
  assert.equal(id.describe('a1', 'alpha').label, 'MK1.1');

  id.setDisplay('a1', { name: 'Tai' });
  assert.equal(id.describe('a1', 'alpha').label, 'Tai');
  assert.equal(id.describe('a1', 'alpha').mk, 'MK1.1', 'the tag stays underneath');

  id.setDisplay('a1', { name: null });
  assert.equal(id.describe('a1', 'alpha').label, 'MK1.1');
  await fs.rm(dir, { recursive: true, force: true });
});

test('names are trimmed, bounded, and reported for collision checks', async () => {
  const { store, dir } = await freshStore();
  const id = new Identity(store);
  id.describe('a1', 'alpha');
  id.setDisplay('a1', { name: '  Marco  ' });
  assert.equal(id.describe('a1', 'alpha').displayName, 'Marco');

  id.describe('a2', 'alpha');
  id.setDisplay('a2', { name: 'x'.repeat(200) });
  assert.ok(id.describe('a2', 'alpha').displayName.length <= 24);

  assert.deepEqual(id.takenNames().sort(), ['Marco', 'x'.repeat(24)].sort());
  await fs.rm(dir, { recursive: true, force: true });
});
