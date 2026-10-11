/**
 * DeckHQ for Windows — everything about the app's build that is plain Node.
 *
 * `app/windows/` wraps the npm package in a window and an installer. Nothing
 * here compiles C#, runs NSIS or opens a window: these are the rules the build
 * is held to on every platform the suite runs on — what goes in the folder,
 * what a download has to match before it is touched, and what the installer
 * may and may not do to a user's machine. The shell's own source is held in
 * `app-windows-shell.test.mjs`.
 */
import { scratchDir } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => fs.readFileSync(path.join(REPO, ...parts), 'utf8');

const { layout, WEBVIEW2_FILES } = await import('../../app/windows/build.mjs');
const { webview2Url } = await import('../../app/windows/fetch-webview2.mjs');
const { nodeUrls } = await import('../../app/windows/fetch-node.mjs');
const { npmRunner, packFiles } = await import('../../app/windows/lib/pack-list.mjs');
const { download, readPins, requireHash } = await import('../../app/windows/lib/verify.mjs');
const { makeIcon, ICON_SIZES } = await import('../../app/windows/build-shell.mjs');
const { readIco } = await import('../../src/core/ico.mjs');

const pins = readPins();
const pkg = JSON.parse(read('package.json'));

// ---------------------------------------------------------------------------
// What goes in the folder
// ---------------------------------------------------------------------------

test('core\\ is exactly the list npm pack reports, and nothing else is copied from the tree', (t) => {
  if (!npmRunner()) {
    t.skip('no npm beside this Node');
    return;
  }
  const pack = packFiles(REPO, { npm_config_cache: scratchDir('npm-cache-') });
  assert.ok(pack.includes('bin/deckhq.mjs') && pack.includes('package.json'));

  const plan = layout({ pack, nodeLicence: true });
  const core = plan.filter((p) => p.to.startsWith('core/')).map((p) => p.to.slice(5));
  assert.deepEqual(core.sort(), pack);
  for (const p of plan.filter((q) => q.to.startsWith('core/'))) {
    assert.equal(path.relative(REPO, p.from).replace(/\\/g, '/'), p.to.slice(5));
  }
  // Everything else in the folder is the shell, WebView2, or a licence.
  const rest = plan.filter((p) => !p.to.startsWith('core/')).map((p) => p.to);
  assert.deepEqual(
    rest.sort(),
    [
      'DeckHQ.exe',
      'LICENSE.txt',
      ...WEBVIEW2_FILES,
      'licenses/Node-LICENSE.txt',
      'licenses/THIRD-PARTY.md',
      'licenses/WebView2-LICENSE.txt',
    ].sort(),
  );
});

test('INVARIANT: npm pack lists nothing under app/, and the core gains no dependency', (t) => {
  assert.equal(pkg.dependencies, undefined, 'the core is zero-dependency');
  assert.deepEqual(Object.keys(pkg.devDependencies).sort(), ['eslint', 'prettier', 'typescript']);
  assert.ok(!pkg.files.some((f) => /^!?app(\/|$)/.test(f)), '`files` must not name app/');
  if (!npmRunner()) {
    t.skip('no npm beside this Node');
    return;
  }
  const pack = packFiles(REPO, { npm_config_cache: scratchDir('npm-cache-') });
  assert.deepEqual(
    pack.filter((f) => f.startsWith('app/')),
    [],
  );
});

test('the app icon is the mark at six sizes, from the PNGs the package ships', () => {
  const ico = makeIcon();
  assert.ok(ico.length < 100 * 1024, `${ico.length} bytes`);
  const sizes = readIco(ico).entries.map((e) => e.width);
  assert.deepEqual(
    sizes.sort((a, b) => a - b),
    ICON_SIZES,
  );
});

// ---------------------------------------------------------------------------
// Downloads: pinned, and refused before they are opened
// ---------------------------------------------------------------------------

test('pins.json pins the WebView2 package and every file taken from it, by hash', () => {
  assert.match(pins.webview2.version, /^\d+\.\d+\.\d+\.\d+$/);
  assert.match(pins.webview2.sha512, /^[0-9a-f]{128}$/);
  const taken = Object.entries(pins.webview2.files);
  assert.deepEqual(
    taken
      .map(([, spec]) => spec.to)
      .filter((to) => to !== 'LICENSE.txt')
      .sort(),
    [...WEBVIEW2_FILES].sort(),
  );
  for (const [name, spec] of taken) assert.match(spec.sha256, /^[0-9a-f]{64}$/, name);
  assert.match(pins.node.version, /^\d+\.\d+\.\d+$/, 'an exact Node release, never a range');
  assert.ok(pins.node.sha256 === '' || /^[0-9a-f]{64}$/.test(pins.node.sha256));
  assert.equal(new URL(webview2Url(pins.webview2.version)).hostname, 'api.nuget.org');
  assert.equal(new URL(nodeUrls(pins.node.version).zip).hostname, 'nodejs.org');
});

test('THIRD-PARTY.md records the same versions, URLs and hashes pins.json holds', () => {
  const doc = read('app', 'windows', 'THIRD-PARTY.md');
  for (const needle of [
    pins.webview2.version,
    webview2Url(pins.webview2.version),
    pins.webview2.sha512,
    ...Object.values(pins.webview2.files).map((spec) => spec.sha256),
    ...Object.keys(pins.webview2.files),
    pins.node.version,
    nodeUrls(pins.node.version).zip,
  ]) {
    assert.ok(doc.includes(needle), `THIRD-PARTY.md does not mention ${needle}`);
  }
});

test('SECURITY: a download is only ever HTTPS from nuget.org or nodejs.org', async () => {
  await assert.rejects(download('https://example.com/a.nupkg'), /not a pinned host/);
  await assert.rejects(download('http://api.nuget.org/a.nupkg'), /not a pinned host/);
  await assert.rejects(download('https://nodejs.org.example.com/a.zip'), /not a pinned host/);
  assert.throws(() => requireHash(Buffer.from('x'), 'sha256', '', 'a file'), /no sha256 is pinned/);
});
