/**
 * WP-45 — signed asset packs.
 *
 * What this file is here to hold true, in the order it matters:
 *
 *   1. **A pack gates nothing.** There is no key in the schema that names a
 *      tier, a licence, an expiry or a feature, and one that tried is refused
 *      rather than ignored. The end-to-end half of this promise is
 *      `test/integration/pack-acceptance.test.mjs`, which diffs the acceptance
 *      surface with and without a pack installed.
 *   2. **A pack cannot lower a bar.** Every theme goes through the same
 *      `validateTheme` and `assertThemeContrast` a shipped theme does, and
 *      every avatar colour through the same >= 70-from-every-state-colour rule
 *      `public/render/palette.js` holds its own tables to.
 *   3. **An unsigned or badly signed pack loads nothing at all**, and says so.
 *   4. **A bad ITEM is refused alone**, with its reason, and the rest of the
 *      pack still loads. A theme that fails a contrast gate must not cost a
 *      customer the pack they paid for.
 *
 * The machine is pinned before `src/` is imported (`docs/DEVIATIONS.md` §124).
 */
import { ROOT } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const packs = await import('../../src/core/packs.mjs');
const { THEMES, THEME_NAMES, themeByName, themeNames } = await import('../../src/core/themes.mjs');
const { avatarSetByName, avatarSets } = await import('../../src/core/avatars.mjs');
const { STATE_COLORS } = await import('../../public/render/palette.js');
const { PUBLISHER_KEYS } = await import('../../src/core/publisher-key.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

/** A publisher key of our own, so no test needs the real private half. */
const pair = generateKeyPairSync('ed25519');
const TEST_PRIVATE = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const TEST_KEYS = [
  {
    id: 'test-key',
    pem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    retired: false,
  },
];

/** A theme document that clears every gate. Derived from a shipped one. */
function goodTheme(name) {
  const base = THEMES[1]; // night shift: dark floor, light ink, measured
  return { name, version: base.version, floor: { ...base.floor }, chrome: { ...base.chrome } };
}

function goodAvatarSet(name) {
  return {
    name,
    accents: ['#3FC1C9', '#7AD9F5', '#6C8BFF', '#B98CFF'],
    jackets: ['#20313D', '#123A32'],
  };
}

/** An unsigned pack source. */
function source(over = {}) {
  return {
    kind: 'deckhq.pack',
    schema: 1,
    name: 'test-pack',
    version: '1.0.0',
    publisher: 'DeckHQ',
    themes: [goodTheme('midnight')],
    avatars: [goodAvatarSet('test crew')],
    ...over,
  };
}

/** @param {any} doc */
function signed(doc) {
  return packs.signPack(doc, TEST_PRIVATE, { keyId: 'test-key' });
}

/** A fresh packs directory, and a clean registry, for one test. */
let seq = 0;
function scratch() {
  packs.clearPacks();
  const dir = path.join(ROOT, `packs-${seq++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------- canonical

test('canonical JSON is key-order independent, and refuses what JSON cannot carry', () => {
  const a = { b: 1, a: [3, { z: 1, y: 2 }] };
  const b = { a: [3, { y: 2, z: 1 }], b: 1 };
  assert.equal(packs.canonicalJson(a), packs.canonicalJson(b));
  assert.equal(packs.canonicalJson(a), '{"a":[3,{"y":2,"z":1}],"b":1}');

  // A signature over a document that silently dropped a field would be a
  // signature over a different document from the one on disk.
  assert.throws(() => packs.canonicalJson({ a: undefined }), /cannot be signed/);
  assert.throws(() => packs.canonicalJson({ a: NaN }), /finite/);
  const cycle = /** @type {any} */ ({});
  cycle.self = cycle;
  assert.throws(() => packs.canonicalJson(cycle), /cycle/);
});

test('a signature survives re-serialisation with different key order', () => {
  const doc = signed(source());
  // Round-trip through a parser that re-orders every object's keys.
  const shuffled = JSON.parse(
    JSON.stringify(doc, (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).reverse())
        : v,
    ),
  );
  const result = packs.verifyPackSignature(shuffled, { keys: TEST_KEYS });
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------- signature

test('a good signature verifies, and names the key that matched', () => {
  const result = packs.verifyPackSignature(signed(source()), { keys: TEST_KEYS });
  assert.deepEqual(result, { ok: true, keyId: 'test-key', retired: false });
});

test('an unsigned pack is refused whole, with a message that says why', () => {
  const doc = source();
  const result = packs.parsePack(JSON.stringify(doc), { keys: TEST_KEYS });
  assert.equal(result.ok, false);
  assert.match(result.error, /not signed/);
});

test('a pack edited after signing is refused, and says it was edited', () => {
  const doc = signed(source());
  doc.themes[0].floor.wood = '#123456';
  const result = packs.parsePack(JSON.stringify(doc), { keys: TEST_KEYS });
  assert.equal(result.ok, false);
  assert.match(result.error, /edited since it was signed/);
});

test('a pack signed by a key this build does not know is refused, and names both', () => {
  const other = generateKeyPairSync('ed25519');
  const doc = packs.signPack(source(), other.privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    keyId: 'somebody-else',
  });
  const result = packs.parsePack(JSON.stringify(doc), { keys: TEST_KEYS });
  assert.equal(result.ok, false);
  assert.match(result.error, /somebody-else/);
  assert.match(result.error, /test-key/);
});

test('a stripped signature block, a wrong algorithm and a bad base64 are each refused', () => {
  for (const [what, mutate] of [
    ['no signature', (d) => delete d.signature],
    ['wrong alg', (d) => (d.signature.alg = 'rsa')],
    ['no sig', (d) => delete d.signature.sig],
    ['garbage sig', (d) => (d.signature.sig = 'not base64 at all !!')],
  ]) {
    const doc = signed(source());
    mutate(doc);
    const result = packs.verifyPackSignature(doc, { keys: TEST_KEYS });
    assert.equal(result.ok, false, what);
  }
});

test('the shipped publisher key is a public key, and the repository holds no private half', () => {
  assert.ok(PUBLISHER_KEYS.length >= 1);
  for (const key of PUBLISHER_KEYS) {
    assert.match(key.pem, /^-----BEGIN PUBLIC KEY-----/);
    assert.doesNotMatch(key.pem, /PRIVATE/);
  }
  // The whole of src/ and packs/, not just this key: a private key committed
  // anywhere in the tree is the one mistake this package could make that
  // cannot be taken back.
  const suspects = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      // A PEM block header, not the words: prose about a private key is
      // exactly what several files in this package are supposed to contain.
      else if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(fs.readFileSync(full, 'utf8'))) {
        suspects.push(full);
      }
    }
  };
  for (const dir of ['src', 'packs', 'bin', 'public']) walk(path.join(REPO, dir));
  assert.deepEqual(suspects, [], 'a PRIVATE KEY block is committed in this repository');
});

// ------------------------------------------------------------------- schema

test('a pack may not carry a tier, a licence, an expiry or any other gate', () => {
  for (const key of ['tier', 'licence', 'license', 'entitlements', 'expiresAt', 'features']) {
    const result = packs.validatePack(source({ [key]: 'anything' }));
    assert.equal(result.ok, false, key);
    assert.match(result.error, new RegExp(key));
    // And the refusal explains the rule rather than only naming the field.
    assert.match(result.error, /rule 2/);
  }
});

test('the envelope is refused whole for a bad kind, schema, name, version or publisher', () => {
  const cases = [
    [{ kind: 'something-else' }, /"kind"/],
    [{ schema: 2 }, /schema/],
    [{ name: '../escape' }, /directory name/],
    [{ name: 'Has Spaces' }, /directory name/],
    [{ name: '' }, /directory name/],
    [{ version: 'one' }, /version/],
    [{ publisher: '' }, /publisher/],
    [{ themes: 'no' }, /not an array/],
    [{ avatars: 'no' }, /not an array/],
  ];
  for (const [over, re] of cases) {
    const result = packs.validatePack(source(over));
    assert.equal(result.ok, false, JSON.stringify(over));
    assert.match(result.error, re);
  }
});

test('a bad theme is refused ALONE, with its reason, and the pack still loads', () => {
  const result = packs.validatePack(
    source({
      themes: [
        goodTheme('midnight'),
        { name: 'broken', version: 1, floor: {}, chrome: {} },
        goodTheme('twilight'),
      ],
    }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.pack.themes.map((t) => t.name),
    ['midnight', 'twilight'],
  );
  assert.equal(result.pack.rejected.length, 1);
  assert.match(result.pack.rejected[0], /themes\[1\]/);
});

test('a theme that fails the contrast gate is refused with the measurement', () => {
  const bad = goodTheme('unreadable');
  bad.floor.ink = bad.floor.carpet; // ink on its own ground
  const result = packs.validatePack(source({ themes: [bad] }));
  assert.equal(result.ok, true);
  assert.equal(result.pack.themes.length, 0);
  assert.match(result.pack.rejected[0], /needs >= 4.5:1/);
});

test('a pack may not replace a theme this build ships, or repeat one of its own', () => {
  const shadow = goodTheme('blueprint');
  const result = packs.validatePack(source({ themes: [shadow, goodTheme('x'), goodTheme('x')] }));
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.pack.themes.map((t) => t.name),
    ['x'],
  );
  assert.match(result.pack.rejected[0], /already ships/);
  assert.match(result.pack.rejected[1], /appears twice/);
});

// ------------------------------------------------------------------ avatars

test('an avatar colour may never come within 70 of a state colour', () => {
  for (const [state, colour] of Object.entries(STATE_COLORS)) {
    const set = goodAvatarSet('impostor');
    set.accents = [colour, '#3FC1C9', '#7AD9F5'];
    const result = packs.validateAvatarSet(set);
    assert.equal(result.ok, false, state);
    assert.match(result.error, /must never/);
    // The message names the state the colour is CLOSEST to, which is not
    // always the one it was copied from — two state colours can be within 70
    // of each other. Naming the nearest is the more useful report.
    assert.match(result.error, /state colour/);
  }
});

test('two accents that read the same at 16 px are refused; two jackets are not', () => {
  const tight = goodAvatarSet('samey');
  tight.accents = ['#3FC1C9', '#42C4CC'];
  assert.equal(packs.validateAvatarSet(tight).ok, false);

  // The shipped jacket table's own tightest pair is 35.7, so a mutual bar on
  // jackets would fail the product as it ships. Deliberately not applied.
  const jackets = goodAvatarSet('tailoring');
  jackets.jackets = ['#1B2E3F', '#3A2350'];
  assert.equal(packs.validateAvatarSet(jackets).ok, true);
});

test('a pale jacket is refused: it would read as the torso it covers', () => {
  const set = goodAvatarSet('pale');
  set.jackets = ['#EFEFEF', '#20313D'];
  const result = packs.validateAvatarSet(set);
  assert.equal(result.ok, false);
  assert.match(result.error, /luminance/);
});

test('an avatar set is a name and two colour tables, and refuses anything else', () => {
  const cases = [
    [{ name: 'BAD NAME!' }, /needs a "name"/],
    [{ accents: [] }, /between/],
    [{ accents: ['nope', '#3FC1C9'] }, /#rrggbb/],
    [{ jackets: undefined }, /"jackets" array/],
    [{ glasses: true }, /a set is a name and two colour tables/],
  ];
  for (const [over, re] of cases) {
    const result = packs.validateAvatarSet({ ...goodAvatarSet('crew'), ...over });
    assert.equal(result.ok, false, JSON.stringify(over));
    assert.match(result.error, re);
  }
});

// -------------------------------------------------------------- the on-disk

test('loadPacks reads a directory, and refuses one pack without losing the others', () => {
  const dir = scratch();
  const write = (name, text) => {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
    fs.writeFileSync(path.join(dir, name, 'pack.json'), text);
  };
  write('good', JSON.stringify(signed(source({ name: 'good', themes: [goodTheme('one')] }))));
  write('unsigned', JSON.stringify(source({ name: 'unsigned' })));
  write('renamed', JSON.stringify(signed(source({ name: 'test-pack' }))));
  write('garbage', 'not json');

  const { packs: loaded, errors } = packs.loadPacks({ dir, keys: TEST_KEYS });
  assert.deepEqual(
    loaded.map((p) => p.name),
    ['good'],
  );
  assert.deepEqual(errors.map((e) => e.name).sort(), ['garbage', 'renamed', 'unsigned']);
  assert.match(errors.find((e) => e.name === 'renamed').error, /but the pack inside says/);
});

test('a missing packs directory is no packs, not an error', () => {
  packs.clearPacks();
  const { packs: loaded, errors } = packs.loadPacks({ dir: path.join(ROOT, 'nope') });
  assert.deepEqual(loaded, []);
  assert.deepEqual(errors, []);
});

test('install verifies before it writes, and remove deletes', () => {
  const dir = scratch();
  const bad = packs.installPack(JSON.stringify(source()), { dir, keys: TEST_KEYS });
  assert.equal(bad.ok, false);
  assert.equal(fs.existsSync(path.join(dir, 'test-pack')), false, 'nothing may be written');

  const good = packs.installPack(JSON.stringify(signed(source())), { dir, keys: TEST_KEYS });
  assert.equal(good.ok, true);
  assert.equal(good.replaced, null);
  assert.ok(fs.existsSync(good.file));

  const again = packs.installPack(JSON.stringify(signed(source({ version: '1.1.0' }))), {
    dir,
    keys: TEST_KEYS,
  });
  assert.equal(again.ok, true);
  assert.equal(again.replaced, '1.0.0');

  assert.equal(packs.removePack('../escape', { dir }).ok, false);
  assert.equal(packs.removePack('nothing-here', { dir }).ok, false);
  assert.equal(packs.removePack('test-pack', { dir }).ok, true);
  assert.equal(fs.existsSync(path.join(dir, 'test-pack')), false);
});

// ------------------------------------------------------- the live registries

test('currentPacks registers what loaded, and clearing puts the product back', () => {
  const dir = scratch();
  const before = themeNames();
  assert.deepEqual(before, [...THEME_NAMES], 'no pack, no extra theme');
  assert.deepEqual(avatarSets(), []);

  fs.mkdirSync(path.join(dir, 'test-pack'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'test-pack', 'pack.json'),
    JSON.stringify(signed(source({ themes: [goodTheme('midnight')] }))),
  );

  const loaded = packs.currentPacks({ dir, force: true, keys: TEST_KEYS });
  assert.deepEqual(loaded.themes, ['midnight']);
  assert.ok(themeNames().includes('midnight'));
  assert.equal(themeByName('Midnight').name, 'midnight');
  assert.equal(avatarSetByName('test crew').name, 'test crew');
  // Shipped themes stay first, and stay exactly what they were.
  assert.deepEqual(themeNames().slice(0, THEME_NAMES.length), [...THEME_NAMES]);

  packs.clearPacks();
  assert.deepEqual(themeNames(), [...THEME_NAMES]);
  assert.equal(themeByName('midnight'), null);
  assert.deepEqual(avatarSets(), []);
});

test('the registry is a projection of the directory, not an accumulation', () => {
  const dir = scratch();
  fs.mkdirSync(path.join(dir, 'test-pack'), { recursive: true });
  const file = path.join(dir, 'test-pack', 'pack.json');
  fs.writeFileSync(file, JSON.stringify(signed(source({ themes: [goodTheme('midnight')] }))));
  packs.currentPacks({ dir, force: true, keys: TEST_KEYS });
  assert.ok(themeNames().includes('midnight'));

  fs.rmSync(path.join(dir, 'test-pack'), { recursive: true, force: true });
  packs.currentPacks({ dir, force: true, keys: TEST_KEYS });
  assert.equal(themeNames().includes('midnight'), false, 'a removed pack must not linger');
  packs.clearPacks();
});

// --------------------------------------------------------- the sample pack

test('packs/supporter-sample is a pack this build would load, once signed', () => {
  const doc = JSON.parse(
    fs.readFileSync(path.join(REPO, 'packs', 'supporter-sample', 'pack.json'), 'utf8'),
  );
  const result = packs.validatePack(doc);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  assert.deepEqual(
    result.pack.themes.map((t) => t.name),
    ['warehouse', 'garden'],
  );
  assert.deepEqual(
    result.pack.avatars.map((a) => a.name),
    ['warehouse crew'],
  );
  assert.deepEqual(result.pack.rejected, [], 'the sample pack must refuse nothing');
  // The source in the repository is UNSIGNED on purpose: it is reviewable, and
  // signing it needs a key that is not here.
  assert.equal('signature' in doc, false);
});

test('the committed signed sample pack is the committed source, signed by the shipped key', () => {
  const dir = path.join(REPO, 'packs', 'supporter-sample');
  const source = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'));
  const artifact = JSON.parse(
    fs.readFileSync(path.join(dir, 'supporter-sample-1.0.0.deckhq-pack.json'), 'utf8'),
  );

  // Byte for byte the same document, once the signature is set aside. The two
  // drifting apart is the one way this pair could lie: a reviewer reads the
  // source and a customer installs the artifact.
  const { signature, ...unsigned } = artifact;
  assert.equal(
    packs.canonicalJson(unsigned),
    packs.canonicalJson(source),
    'packs/supporter-sample is out of date — re-run packs/supporter-sample/build.mjs',
  );

  // And it verifies against the key this build ships, which is what makes the
  // acceptance test exercise a real install rather than a mocked one.
  const verified = packs.verifyPackSignature(artifact);
  assert.equal(verified.ok, true, verified.ok ? '' : verified.error);
  assert.equal(signature.alg, 'ed25519');
  assert.doesNotMatch(JSON.stringify(artifact), /PRIVATE/);
});
