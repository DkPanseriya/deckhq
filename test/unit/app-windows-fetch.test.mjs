/**
 * DeckHQ for Windows — the two downloads, and every way they are refused.
 *
 * No network: `download` and the Authenticode check are injected. What is held
 * here is the ORDER — hash before open, every inner file's hash before a byte
 * is written, the publisher's signature before anything is kept — because a
 * build that checks in any other order has already run code it did not verify.
 */
import { scratchDir } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const { fetchWebView2 } = await import('../../app/windows/fetch-webview2.mjs');
const { fetchNode, fetchedNode, nodeUrls, shasumFor, isOpenJsSubject } =
  await import('../../app/windows/fetch-node.mjs');
const { isMicrosoftSubject, readPins } = await import('../../app/windows/lib/verify.mjs');
const { readZip } = await import('../../app/windows/lib/zip.mjs');

const realPins = readPins();
const sha = (bytes, algorithm) => createHash(algorithm).update(bytes).digest('hex');
const quiet = () => {};
const MICROSOFT =
  'CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US';
const OPENJS = 'CN=OpenJS Foundation, O=OpenJS Foundation, L=San Francisco, S=California, C=US';

/** A zip of stored (uncompressed) entries: enough for the reader under test. */
function storedZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, bytes] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt32LE(bytes.length, 20);
    entry.writeUInt32LE(bytes.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, bytes);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + bytes.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** A package shaped like the real one, and the pins that describe it. */
function fakePackage() {
  const files = {};
  const pin = { version: '9.9.9', sha512: '', files: {} };
  for (const [name, spec] of Object.entries(realPins.webview2.files)) {
    files[name] = Buffer.from(`bytes of ${name}`);
    pin.files[name] = { to: spec.to, sha256: sha(files[name], 'sha256') };
  }
  const nupkg = storedZip(files);
  pin.sha512 = sha(nupkg, 'sha512');
  return { nupkg, pins: { webview2: pin } };
}

const verdicts = (status, subject) => (files) => files.map((file) => ({ file, status, subject }));

test('the zip reader finds a stored entry and refuses what is not a zip', () => {
  const zip = storedZip({ 'a/b.txt': Buffer.from('hello') });
  const [entry] = readZip(zip);
  assert.equal(entry.name, 'a/b.txt');
  assert.equal(entry.read().toString(), 'hello');
  assert.throws(() => readZip(Buffer.from('not a zip at all, just some text')), /not a zip/);
});

test('SECURITY: the WebView2 fetch refuses a package whose SHA-512 is not the pinned one', async () => {
  const { pins } = fakePackage();
  const outDir = path.join(scratchDir('wv2-'), 'out');
  let asked = 0;
  await assert.rejects(
    fetchWebView2({
      pins,
      outDir,
      log: quiet,
      download: async () => Buffer.from('a different package entirely'),
      signatures: () => {
        asked += 1;
        return [];
      },
    }),
    /SHA-512 mismatch, refused/,
  );
  assert.equal(fs.existsSync(outDir), false, 'nothing may be extracted from an unverified package');
  assert.equal(asked, 0);
});

test('SECURITY: a file inside the package that is not the pinned bytes stops the fetch', async () => {
  const { nupkg, pins } = fakePackage();
  const [first] = Object.keys(pins.webview2.files);
  pins.webview2.files[first].sha256 = sha(Buffer.from('other bytes'), 'sha256');
  const outDir = path.join(scratchDir('wv2-'), 'out');
  await assert.rejects(
    fetchWebView2({ pins, outDir, log: quiet, download: async () => nupkg }),
    /SHA-256 mismatch, refused/,
  );
  assert.equal(fs.existsSync(outDir), false);
});

test('SECURITY: DLLs Windows does not call validly signed by Microsoft are deleted again', async () => {
  for (const signatures of [
    verdicts('NotSigned', ''),
    verdicts('HashMismatch', MICROSOFT),
    verdicts('Valid', 'CN=Somebody Else, O=Somebody Else, C=US'),
    () => [],
    () => {
      throw new Error('powershell is not here');
    },
  ]) {
    const { nupkg, pins } = fakePackage();
    const outDir = path.join(scratchDir('wv2-'), 'out');
    await assert.rejects(
      fetchWebView2({ pins, outDir, log: quiet, download: async () => nupkg, signatures }),
      /not validly signed by Microsoft Corporation|could not check the Authenticode/,
    );
    assert.equal(fs.existsSync(outDir), false, 'an unsigned DLL must not be left for a build');
  }
});

test('a package that matches every hash and is signed lands as the four DLLs and the licence', async () => {
  const { nupkg, pins } = fakePackage();
  const outDir = path.join(scratchDir('wv2-'), 'out');
  /** @type {string[]} */
  let checked = [];
  const done = await fetchWebView2({
    pins,
    outDir,
    log: quiet,
    download: async () => nupkg,
    signatures: (files) => {
      checked = files;
      return verdicts('Valid', MICROSOFT)(files);
    },
  });
  assert.equal(done.files.length, 5);
  assert.equal(checked.length, 4, 'every DLL is put to Windows, and only the DLLs');
  assert.ok(
    fs.existsSync(path.join(outDir, 'runtimes', 'win-arm64', 'native', 'WebView2Loader.dll')),
  );
  assert.equal(fs.readFileSync(path.join(outDir, 'VERSION'), 'utf8').trim(), '9.9.9');
});

test('a certificate subject is matched on whole fields, not on a substring', () => {
  assert.equal(isMicrosoftSubject(MICROSOFT), true);
  assert.equal(isMicrosoftSubject('CN=Not Microsoft Corporation, O=Microsoft Corporation'), false);
  assert.equal(isMicrosoftSubject('CN=Microsoft Corporation, O=Microsoft Corporation Ltd'), false);
  assert.equal(isOpenJsSubject(OPENJS), true);
  assert.equal(isOpenJsSubject('CN=x, O=OpenJS Foundation Fan Club'), false);
});

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

function fakeNode(version = '24.19.0') {
  const { folder, zip, shasums } = nodeUrls(version);
  const bytes = storedZip({
    [`${folder}/node.exe`]: Buffer.from('MZ pretend node'),
    [`${folder}/LICENSE`]: Buffer.from('the licence'),
    [`${folder}/npm.cmd`]: Buffer.from('not wanted'),
  });
  const listing = (hash) => `${'0'.repeat(64)}  node-v${version}.tar.gz\n${hash}  ${folder}.zip\n`;
  const serve = (hash) => async (url) => {
    if (url === shasums) return Buffer.from(listing(hash));
    if (url === zip) return bytes;
    throw new Error(`unexpected download ${url}`);
  };
  return { bytes, hash: sha(bytes, 'sha256'), serve, folder };
}

test('SHASUMS256.txt is read by exact file name', () => {
  const text = `${'a'.repeat(64)}  node-v1.0.0-win-x64.zip\n${'b'.repeat(64)}  win-x64/node.exe\n`;
  assert.equal(shasumFor(text, 'node-v1.0.0-win-x64.zip'), 'a'.repeat(64));
  assert.equal(shasumFor(text, 'node.exe'), null);
  assert.equal(shasumFor(text, 'node-v1.0.0-win-x64.7z'), null);
});

test('SECURITY: the Node zip is refused unless it matches SHASUMS256.txt, pins.json and its signer', async () => {
  const node = fakeNode();
  const base = { log: quiet, signatures: verdicts('Valid', OPENJS) };
  const run = (over) => {
    const outDir = path.join(scratchDir('node-'), 'out');
    return {
      outDir,
      promise: fetchNode({
        ...base,
        outDir,
        pins: { node: { version: '24.19.0', sha256: '' } },
        ...over,
      }),
    };
  };

  const wrongList = run({ download: node.serve('c'.repeat(64)) });
  await assert.rejects(wrongList.promise, /SHA-256 mismatch, refused/);
  assert.equal(fs.existsSync(wrongList.outDir), false);

  const wrongPin = run({
    download: node.serve(node.hash),
    pins: { node: { version: '24.19.0', sha256: 'd'.repeat(64) } },
  });
  await assert.rejects(wrongPin.promise, /pins\.json pins d+; refused/);

  const unsigned = run({ download: node.serve(node.hash), signatures: verdicts('NotSigned', '') });
  await assert.rejects(unsigned.promise, /not validly signed by the OpenJS Foundation/);
  assert.equal(fs.existsSync(unsigned.outDir), false);

  const good = run({ download: node.serve(node.hash) });
  const done = await good.promise;
  assert.equal(done.sha256, node.hash);
  assert.deepEqual(fs.readdirSync(good.outDir).sort(), ['LICENSE', 'node.exe', 'node.json']);
  const pinsNow = { node: { version: '24.19.0', sha256: '' } };
  assert.equal(fetchedNode({ pins: pinsNow, outDir: good.outDir }).sha256, node.hash);
  fs.appendFileSync(path.join(good.outDir, 'node.exe'), 'tampered');
  assert.equal(fetchedNode({ pins: pinsNow, outDir: good.outDir }), null);
});
