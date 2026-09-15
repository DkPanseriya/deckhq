/**
 * WP-84, then WP-86 · the name pool, and the 243 names inside it that may never
 * move.
 *
 * WP-86 grew it again, to **600**, because 243 was a number chosen against one
 * machine's conversation count rather than against the rule. The rule is now
 * stated as a test rather than as a hope: assign six hundred identities and
 * count the numeric suffixes, which must be zero. Two checks were added with
 * it — no two names within a single edit of each other, and no name that is
 * also a US state — and the frozen head grew from 60 to 243.
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
 *   1. **The first `FROZEN_POOL` entries are frozen**, in order, spelling for
 *      spelling — the 60 that shipped and the 183 WP-84 appended. They are
 *      written out below rather than read from the module, because a test that
 *      reads the thing it is checking checks nothing. An identity is persisted
 *      on first sight and never reassigned, so every one of these is a name
 *      somebody has already learned.
 *   2. **The shape of a name.** At most seven letters, unique
 *      case-insensitively, two edits from every other name WP-86 added, and
 *      neither a word the interface speaks nor the name of a US state.
 *   3. **The pool is big enough**, and an empty machine still draws from the
 *      block it always drew from — which is why no golden of an under-sixty
 *      floor moved when the pool tripled, or when it grew again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { FROZEN_POOL, ORIGINAL_POOL, SHORT_NAMES, availableNames } from '../../public/names.js';
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

/**
 * The 183 WP-84 appended, in their order — `git show HEAD:public/names.js` at
 * the commit WP-86 grew the pool from. Frozen for the reason the sixty above
 * are: every one of them has been handed out and persisted on somebody's
 * machine by now, and an identity is never reassigned. Written out longhand
 * rather than read from the module, for the reason the sixty are.
 */
const FROZEN_WP84 = [
  'Anja',
  'Eero',
  'Aino',
  'Bjorn',
  'Lars',
  'Nils',
  'Sanna',
  'Runa',
  'Alva',
  'Iver',
  'Hilda',
  'Stine',
  'Sigrid',
  'Frida',
  'Ingrid',
  'Malin',
  'Tove',
  'Vidar',
  'Zoran',
  'Vlada',
  'Lenka',
  'Radek',
  'Sasha',
  'Katya',
  'Pavel',
  'Anika',
  'Danko',
  'Vesna',
  'Igor',
  'Olya',
  'Bojan',
  'Nuno',
  'Luca',
  'Matteo',
  'Nico',
  'Vito',
  'Rocco',
  'Dario',
  'Flavia',
  'Giulia',
  'Chiara',
  'Aldo',
  'Ennio',
  'Fabio',
  'Renzo',
  'Noemi',
  'Paloma',
  'Iker',
  'Nerea',
  'Aitor',
  'Unai',
  'Vasco',
  'Tiago',
  'Emilia',
  'Camilo',
  'Ximena',
  'Joana',
  'Celso',
  'Nikos',
  'Elena',
  'Thalia',
  'Yannis',
  'Kostas',
  'Irini',
  'Dimos',
  'Sofia',
  'Alexi',
  'Zoe',
  'Layla',
  'Omar',
  'Rania',
  'Zaid',
  'Yusuf',
  'Samir',
  'Farah',
  'Hakim',
  'Karim',
  'Basma',
  'Dalia',
  'Hamza',
  'Jamal',
  'Salma',
  'Zahra',
  'Aziz',
  'Reza',
  'Sahar',
  'Kian',
  'Roya',
  'Arash',
  'Emre',
  'Deniz',
  'Ceren',
  'Kaan',
  'Sibel',
  'Ozan',
  'Aylin',
  'Berk',
  'Mert',
  'Selin',
  'Zeynep',
  'Arjun',
  'Meera',
  'Rohan',
  'Kavya',
  'Priya',
  'Varun',
  'Diya',
  'Aarav',
  'Tanvi',
  'Rhea',
  'Kiran',
  'Manav',
  'Neha',
  'Zoya',
  'Nisha',
  'Kabir',
  'Mei',
  'Hana',
  'Yuki',
  'Sora',
  'Kenji',
  'Aiko',
  'Haru',
  'Rina',
  'Riku',
  'Yuna',
  'Minho',
  'Jisoo',
  'Jiho',
  'Wei',
  'Lian',
  'Linh',
  'Trang',
  'Quan',
  'Tuan',
  'Dewi',
  'Putri',
  'Wayan',
  'Bayu',
  'Intan',
  'Citra',
  'Amara',
  'Zuri',
  'Kwame',
  'Ayo',
  'Femi',
  'Naledi',
  'Sipho',
  'Lerato',
  'Kofi',
  'Nkechi',
  'Uche',
  'Dayo',
  'Imani',
  'Jabari',
  'Kamau',
  'Makena',
  'Nandi',
  'Noa',
  'Eitan',
  'Tamar',
  'Yael',
  'Shira',
  'Lior',
  'Maya',
  'Adina',
  'Omer',
  'Sivan',
  'Niamh',
  'Eoin',
  'Cian',
  'Maeve',
  'Rhys',
  'Bryn',
  'Gwen',
  'Iona',
  'Fiona',
  'Callum',
  'Orla',
  'Sean',
  'Declan',
  'Carys',
  'Eira',
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

/**
 * WP-86. A name that is also a US state reads as a place on a floor plan, which
 * is the one thing a floor plan already is. Written out rather than imported,
 * for the reason everything else in this file is.
 */
const STATE_NAMES = new Set(
  [
    'Alabama',
    'Alaska',
    'Arizona',
    'Arkansas',
    'California',
    'Colorado',
    'Connecticut',
    'Delaware',
    'Florida',
    'Georgia',
    'Hawaii',
    'Idaho',
    'Illinois',
    'Indiana',
    'Iowa',
    'Kansas',
    'Kentucky',
    'Louisiana',
    'Maine',
    'Maryland',
    'Massachusetts',
    'Michigan',
    'Minnesota',
    'Mississippi',
    'Missouri',
    'Montana',
    'Nebraska',
    'Nevada',
    'Ohio',
    'Oklahoma',
    'Oregon',
    'Pennsylvania',
    'Tennessee',
    'Texas',
    'Utah',
    'Vermont',
    'Virginia',
    'Washington',
    'Wisconsin',
    'Wyoming',
  ].map((s) => s.toLowerCase()),
);

/**
 * Edit distance, written here rather than imported from anywhere: the rule
 * "no two names are within one edit of each other" is the thing being checked,
 * and a check that borrows the implementation it is checking checks nothing.
 * @param {string} a @param {string} b
 */
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

test('WP-84: the sixty names that predate the growth are byte for byte where they were', () => {
  assert.equal(ORIGINAL_POOL, FROZEN_SIXTY.length, 'ORIGINAL_POOL no longer names the old block');
  assert.deepEqual(
    SHORT_NAMES.slice(0, FROZEN_SIXTY.length),
    FROZEN_SIXTY,
    'a name already handed out is a name somebody has learned — the first ' +
      'block may be appended to and nothing else',
  );
});

test('WP-86: the 243 names that predate the second growth are byte for byte where they were', () => {
  assert.equal(FROZEN_POOL, FROZEN_SIXTY.length + FROZEN_WP84.length, 'FROZEN_POOL moved');
  assert.deepEqual(
    SHORT_NAMES.slice(0, FROZEN_POOL),
    [...FROZEN_SIXTY, ...FROZEN_WP84],
    'the head of the pool may be appended to and nothing else — these are the ' +
      'names real machines have already persisted, and the names the goldens draw',
  );
});

test('WP-86: the pool is big enough that a suffix is unreachable', () => {
  // The owner, 15 September 2026: "make the list big enough so that we do not
  // run out of names". 600, which is more identities than any one machine has
  // had, and the number the suffix test below assigns.
  assert.ok(
    SHORT_NAMES.length >= 600,
    `the pool holds ${SHORT_NAMES.length} names; 600 is the floor WP-86 set`,
  );
});

test('WP-86: every name is short, unique, and not a word the interface speaks', () => {
  /** @type {string[]} */
  const offenders = [];
  const seen = new Map();
  for (const name of SHORT_NAMES) {
    const low = name.toLowerCase();
    if (name.length > 7) offenders.push(`${name}: ${name.length} letters`);
    if (!/^[A-Z][a-z]+$/.test(name)) offenders.push(`${name}: not a plain capitalised name`);
    if (seen.has(low)) offenders.push(`${name}: already in the pool as "${seen.get(low)}"`);
    else seen.set(low, name);
    if (UI_WORDS.has(low)) offenders.push(`${name}: is also a word the interface speaks`);
    if (STATE_NAMES.has(low)) offenders.push(`${name}: is also the name of a US state`);
  }
  assert.deepEqual(offenders, []);
  assert.equal(seen.size, SHORT_NAMES.length);
});

test('WP-86: every name the second growth added is two edits from every other', () => {
  // "Mira" beside "Mila", "Iver" beside "Iker": one substitution apart is a
  // floor you have to read twice, and the whole value of a name here is being
  // readable without reading.
  //
  // IT STARTS AT FROZEN_POOL, and that is a fact about the pool rather than a
  // softened rule. Twenty-seven pairs inside the first 243 are one edit apart —
  // Bruna/Runa, Kian/Kiran/Cian/Lian, Iona/Fiona, Mira/Eira — because the rule
  // did not exist when they were added, and they cannot be fixed: every one of
  // them has been handed to somebody's agent and persisted, and an identity is
  // never reassigned. So the rule is held for everything added from here on,
  // against the whole pool, which is the strongest form still available.
  /** @type {string[]} */
  const offenders = [];
  for (let i = FROZEN_POOL; i < SHORT_NAMES.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = SHORT_NAMES[i];
      const b = SHORT_NAMES[j];
      // Length alone rules out most pairs, and this runs 180,000 times.
      if (Math.abs(a.length - b.length) > 1) continue;
      if (editDistance(a.toLowerCase(), b.toLowerCase()) < 2) {
        offenders.push(`${a} is one edit from ${b}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
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

test('WP-86 THE RULE: a suffix cannot occur below 600 live identities', async () => {
  // The whole of what the owner asked for, as one number. Six hundred agents on
  // one machine — more than any real one has had — and not one of them wears
  // "Livia 2". A suffix is the marker the pool writes when it has nothing left;
  // this asserts the pool has something left for every one of the 600.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckhq-names-'));
  const store = new Store(path.join(dir, 'state.json'));
  await store.load();
  const identity = new Identity(store);
  const seen = new Set();
  /** @type {string[]} */
  const suffixed = [];
  for (let i = 0; i < 600; i++) {
    const name = identity.describe(
      `claude-code:agent-${i}`,
      i % 7 === 0 ? 'alpha' : 'beta',
    ).givenName;
    if (/ \d+$/.test(name)) suffixed.push(name);
    assert.ok(!seen.has(name.toLowerCase()), `"${name}" was handed out twice`);
    seen.add(name.toLowerCase());
  }
  assert.deepEqual(suffixed, [], 'the pool ran out before 600 identities');
  assert.equal(seen.size, 600);
  await fs.rm(dir, { recursive: true, force: true });
});
