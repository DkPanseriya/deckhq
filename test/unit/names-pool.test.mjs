/**
 * WP-84 · the name pool, and the sixty names inside it that may never move.
 *
 * `public/names.js` held sixty names. The machine WP-84 came from holds
 * ninety-two conversations, so `Identity.givenName`'s `"<base> N"` fallback —
 * the rule that produced `Greta 2` and `Sena 3` in §155 — had been permanently
 * engaged: thirty-eight of the owner's hundred-odd agents wore a suffix. The
 * pool grew.
 *
 * Growing a pool of names is a data change wearing a cosmetic change's
 * clothes, so this file pins the three things that make it safe:
 *
 *   1. **The first `ORIGINAL_POOL` entries are frozen**, in order, spelling
 *      for spelling. They are written out below rather than read from the
 *      module, because a test that reads the thing it is checking checks
 *      nothing. An identity is persisted on first sight and never reassigned,
 *      so every one of these is a name somebody has already learned.
 *   2. **The shape of a name.** At most six letters, unique case-insensitively,
 *      nothing that is also a word the interface speaks.
 *   3. **The pool is big enough**, and an empty machine still draws from the
 *      block it always drew from — which is why no golden of an under-sixty
 *      floor moved when the pool tripled.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ORIGINAL_POOL, SHORT_NAMES, availableNames } from '../../public/names.js';
import { Store } from '../../src/core/store.mjs';
import { Identity } from '../../src/core/identity.mjs';

/**
 * The pool exactly as it stood before WP-84 — `git show HEAD:public/names.js`
 * at the commit that grew it. Do not regenerate this list from the module.
 */
const FROZEN_SIXTY = [
  'Marco',
  'Tai',
  'Nova',
  'Wren',
  'Kobe',
  'Ines',
  'Dov',
  'Juno',
  'Rafi',
  'Sena',
  'Bex',
  'Otto',
  'Livia',
  'Cassio',
  'Mira',
  'Hugo',
  'Zola',
  'Piet',
  'Anouk',
  'Tomas',
  'Elif',
  'Boris',
  'Yara',
  'Dmitri',
  'Faye',
  'Ravi',
  'Suki',
  'Milos',
  'Greta',
  'Nadir',
  'Bruna',
  'Oskar',
  'Vera',
  'Idris',
  'Lotte',
  'Amir',
  'Sonia',
  'Emeka',
  'Tessa',
  'Bruno',
  'Kaia',
  'Viggo',
  'Neve',
  'Casper',
  'Ludo',
  'Freya',
  'Enzo',
  'Maud',
  'Tariq',
  'Ilse',
  'Bodhi',
  'Roma',
  'Silas',
  'Nell',
  'Arlo',
  'Petra',
  'Ronan',
  'Isla',
  'Timo',
  'Greer',
];

/** The vocabulary the interface already uses for a state or an action. */
const UI_WORDS = new Set(
  [
    'ready',
    'done',
    'idle',
    'live',
    'active',
    'working',
    'stalled',
    'ended',
    'benched',
    'fired',
    'review',
    'hands',
    'waiting',
    'home',
    'gone',
    'deck',
    'floor',
    'desk',
    'room',
    'back',
    'close',
    'open',
    'new',
    'draft',
    'said',
  ].map((w) => w.toLowerCase()),
);

test('WP-84: the sixty names that predate the growth are byte for byte where they were', () => {
  assert.equal(ORIGINAL_POOL, FROZEN_SIXTY.length, 'ORIGINAL_POOL no longer names the old block');
  assert.deepEqual(
    SHORT_NAMES.slice(0, FROZEN_SIXTY.length),
    FROZEN_SIXTY,
    'a name already handed out is a name somebody has learned — the first ' +
      'block may be appended to and nothing else',
  );
});

test('WP-84: the pool is big enough for a real machine', () => {
  // Ninety-two conversations on the machine this came from, and it grows.
  assert.ok(
    SHORT_NAMES.length >= 200,
    `the pool holds ${SHORT_NAMES.length} names; 200 is the floor WP-84 set`,
  );
});

test('WP-84: every name is short, unique, and not a word the interface speaks', () => {
  /** @type {string[]} */
  const offenders = [];
  const seen = new Map();
  for (const name of SHORT_NAMES) {
    const low = name.toLowerCase();
    if (name.length > 6) offenders.push(`${name}: ${name.length} letters`);
    if (!/^[A-Z][a-z]+$/.test(name)) offenders.push(`${name}: not a plain capitalised name`);
    if (seen.has(low)) offenders.push(`${name}: already in the pool as "${seen.get(low)}"`);
    else seen.set(low, name);
    if (UI_WORDS.has(low)) offenders.push(`${name}: is also a word the interface speaks`);
  }
  assert.deepEqual(offenders, []);
  assert.equal(seen.size, SHORT_NAMES.length);
});

test('WP-84: the names added by the growth share no first three letters', () => {
  // The pool's own rule, held for everything WP-84 added — against the old
  // block as well as against itself. The one pair that predates it, Bruna and
  // Bruno, is the reason this checks the NEW names rather than all of them.
  const prefixes = new Map();
  /** @type {string[]} */
  const offenders = [];
  for (let i = 0; i < SHORT_NAMES.length; i++) {
    const name = SHORT_NAMES[i];
    const key = name.slice(0, 3).toLowerCase();
    const had = prefixes.get(key);
    if (had && i >= ORIGINAL_POOL) offenders.push(`${name} reads like ${had}`);
    if (!had) prefixes.set(key, name);
  }
  assert.deepEqual(offenders, []);
});

test('WP-84: the picker still offers what is free and nothing else', () => {
  const free = availableNames(['marco', 'Anja', '', null]);
  assert.equal(free.length, SHORT_NAMES.length - 2);
  assert.ok(!free.includes('Marco'), 'a taken name is offered case-insensitively');
  assert.ok(!free.includes('Anja'));
  assert.equal(free[0], 'Tai', 'the pool order is the picker order');
});

test('WP-84: an empty machine still draws its names from the block it always drew from', async () => {
  // This is why no golden of a floor smaller than the old pool moved. The
  // hash picks a starting point inside `ORIGINAL_POOL`, so the first name a
  // fresh machine hands out is the same one it handed out before the pool
  // grew; the new names are what the walk REACHES once the old ones are gone.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckhq-names-'));
  const store = new Store(path.join(dir, 'state.json'));
  await store.load();
  const identity = new Identity(store);
  const old = new Set(SHORT_NAMES.slice(0, ORIGINAL_POOL));
  for (let i = 0; i < 24; i++) {
    const name = identity.describe(`claude-code:sess-${i}`, 'alpha').givenName;
    assert.ok(old.has(name), `"${name}" came from outside the original block on an empty machine`);
  }
  await fs.rm(dir, { recursive: true, force: true });
});

test('WP-84: past sixty agents the pool keeps going instead of suffixing', async () => {
  // The whole point. Ninety-two conversations used to mean thirty-two
  // suffixed names; now it means ninety-two names.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckhq-names-'));
  const store = new Store(path.join(dir, 'state.json'));
  await store.load();
  const identity = new Identity(store);
  const seen = new Set();
  for (let i = 0; i < 92; i++) {
    const name = identity.describe(`claude-code:conv-${i}`, 'alpha').givenName;
    assert.ok(!/ \d+$/.test(name), `"${name}" is a suffixed name on a pool with room left`);
    assert.ok(!seen.has(name), `"${name}" was handed out twice`);
    seen.add(name);
  }
  assert.equal(seen.size, 92);
  await fs.rm(dir, { recursive: true, force: true });
});
