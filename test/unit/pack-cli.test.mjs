/**
 * WP-45 — `deckhq pack`.
 *
 * The command is driven through its injected IO, so a test asserts what a user
 * would see and what exit code they would get without a real terminal. The one
 * thing it does touch for real is the filesystem, inside this file's own temp
 * root: `install` and `remove` are about a directory, and a test that faked
 * the directory would be testing the fake.
 *
 * The chain the package is accepted against — **build → verify → install →
 * the theme appears in the picker** — is the last test in this file.
 *
 * The machine is pinned before `src/` is imported (`docs/DEVIATIONS.md` §124).
 */
import { ROOT } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

const { runPack } = await import('../../src/cli/pack.mjs');
const packsCore = await import('../../src/core/packs.mjs');
const { THEME_NAMES, themeByName, themeNames } = await import('../../src/core/themes.mjs');

const REPO = path.resolve(import.meta.dirname, '..', '..');
const SAMPLE = path.join(REPO, 'packs', 'supporter-sample');

const pair = generateKeyPairSync('ed25519');
const KEY_FILE = path.join(ROOT, 'publisher.key.pem');
fs.writeFileSync(KEY_FILE, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
const TEST_KEYS = [
  { id: 'test-key', pem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() },
];

let seq = 0;
/** Run the command, capturing both streams. */
async function run(argv, opts = {}) {
  let out = '';
  let err = '';
  const code = await runPack(argv, {
    write: (s) => (out += s),
    error: (s) => (err += s),
    packsDir: opts.packsDir,
  });
  return { code, out, err };
}

function scratchDir(prefix) {
  const dir = path.join(ROOT, `${prefix}-${seq++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('no verb prints the help and exits 2; --help exits 0', async () => {
  const bare = await run([]);
  assert.equal(bare.code, 2);
  assert.match(bare.out, /deckhq pack/);
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  // The help says what a pack is FOR, and what it never does. This is the one
  // surface a customer reads before paying.
  assert.match(help.out, /gates nothing/);
  assert.match(help.out, /no account, no licence check and no\s+network call/i);
});

test('an unknown verb exits 2 and lists the real ones', async () => {
  const r = await run(['frobnicate']);
  assert.equal(r.code, 2);
  assert.match(r.err, /build, verify, install, list or remove/);
});

test('build refuses without a key, and says where the key is not', async () => {
  const r = await run(['build', SAMPLE]);
  assert.equal(r.code, 2);
  assert.match(r.err, /--key is required/);
  assert.match(r.err, /not in this repository/);
});

test('build refuses a source that would not load, before it signs anything', async () => {
  const dir = scratchDir('bad-source');
  fs.writeFileSync(
    path.join(dir, 'pack.json'),
    JSON.stringify({ name: 'x', version: 'nope', publisher: 'DeckHQ', themes: [] }),
  );
  const r = await run(['build', dir, '--key', KEY_FILE]);
  assert.equal(r.code, 1);
  assert.match(r.err, /version/);
});

test('verify and install refuse an unsigned file and write nothing', async () => {
  const dir = scratchDir('unsigned');
  const file = path.join(dir, 'pack.json');
  fs.copyFileSync(path.join(SAMPLE, 'pack.json'), file);

  const verified = await run(['verify', file]);
  assert.equal(verified.code, 1);
  assert.match(verified.err, /not signed/);

  const packsDir = scratchDir('packs-unsigned');
  const installed = await run(['install', file], { packsDir });
  assert.equal(installed.code, 1);
  assert.match(installed.err, /nothing was installed/i);
  assert.deepEqual(fs.readdirSync(packsDir), []);
});

test('a missing file is exit 2 — a usage problem, not a bad pack', async () => {
  const r = await run(['verify', path.join(ROOT, 'not-there.json')]);
  assert.equal(r.code, 2);
  assert.match(r.err, /could not read/);
});

test('list on an empty directory says so and exits 0', async () => {
  const packsDir = scratchDir('packs-empty');
  const r = await run(['list'], { packsDir });
  assert.equal(r.code, 0);
  assert.match(r.out, /no packs installed/);
});

test('remove refuses a name that is not one, and one that is not installed', async () => {
  const packsDir = scratchDir('packs-remove');
  assert.equal((await run(['remove', '../etc'], { packsDir })).code, 1);
  assert.equal((await run(['remove', 'ghost'], { packsDir })).code, 1);
  assert.equal((await run(['remove'], { packsDir })).code, 2);
});

test('build → verify → install → the theme is in the picker → remove puts it back', async (t) => {
  // This is WP-45's acceptance chain, end to end, with a key of our own. The
  // publisher key compiled into the build is the real one and its private half
  // is not in this repository, so the test swaps in its own key list for the
  // one step that checks a signature.
  const out = path.join(scratchDir('dist'), 'supporter-sample-1.0.0.deckhq-pack.json');
  const built = await run(['build', SAMPLE, '--key', KEY_FILE, '--out', out]);
  assert.equal(built.code, 0, built.err);
  assert.match(built.out, /warehouse, garden/);
  assert.ok(fs.existsSync(out));

  // The key file was read and never copied anywhere near the output.
  const signedText = fs.readFileSync(out, 'utf8');
  assert.doesNotMatch(signedText, /PRIVATE KEY/);
  const signedDoc = JSON.parse(signedText);
  assert.equal(signedDoc.signature.alg, 'ed25519');

  // `verify` and `install` through the CLI check against the SHIPPED key, so
  // a pack signed with a test key is correctly refused by them. That refusal
  // is itself the point, and it is asserted here rather than worked around.
  const cliVerify = await run(['verify', out]);
  assert.equal(cliVerify.code, 1);
  assert.match(cliVerify.err, /does not match any DeckHQ publisher key/);

  // The rest of the chain runs against the core with the test key list, which
  // is exactly what the CLI does one layer down.
  const packsDir = scratchDir('packs-chain');
  const installed = packsCore.installPack(signedText, { dir: packsDir, keys: TEST_KEYS });
  assert.equal(installed.ok, true, installed.ok ? '' : installed.error);
  assert.equal(installed.file, path.join(packsDir, 'supporter-sample', 'pack.json'));

  t.after(() => packsCore.clearPacks());
  packsCore.clearPacks();
  assert.equal(themeByName('warehouse'), null, 'no pack, no warehouse');

  const loaded = packsCore.currentPacks({ dir: packsDir, force: true, keys: TEST_KEYS });
  assert.deepEqual(loaded.themes, ['warehouse', 'garden']);
  assert.ok(themeNames().includes('warehouse'), 'the theme is in the picker');
  assert.equal(themeByName('warehouse').floor.ink, '#EAEDF2');

  // `pack list` reads the directory through the SHIPPED key, so this pack —
  // signed with a test key — is listed as one that will not load rather than
  // as one that is installed. That is the correct answer and it is asserted
  // rather than worked around: the file is on disk, and it is still not ours.
  const listed = await run(['list'], { packsDir });
  assert.equal(listed.code, 0, 'listing what is there is not a failure');
  assert.equal(listed.out, '');
  assert.match(listed.err, /supporter-sample: .*does not match any DeckHQ publisher key/);

  const removed = await run(['remove', 'supporter-sample'], { packsDir });
  assert.equal(removed.code, 0);
  assert.match(removed.out, /no session, no acknowledgement and no queue entry lives in a pack/);
  packsCore.currentPacks({ dir: packsDir, force: true, keys: TEST_KEYS });
  assert.deepEqual(themeNames(), [...THEME_NAMES], 'removing a pack puts the picker back');
});
