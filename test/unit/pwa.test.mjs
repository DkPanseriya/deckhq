/**
 * WP-16 · the installable floor.
 *
 * The manifest and the service worker are the two files in this project that
 * a browser fetches, caches and then obeys without anyone looking at them
 * again. Two things therefore have to be true of them, and are asserted here
 * rather than reviewed:
 *
 *   1. **Neither names a host that is not this machine.** `08` §1.1 rule 2:
 *      no analytics, no update check, no CDN asset, ever. A service worker is
 *      exactly the place that promise would be broken quietly — it runs with
 *      the page closed — so the promise is a test.
 *   2. **The worker caches nothing.** A cached floor is a floor that lies
 *      about who is waiting, and the whole product is the claim that it does
 *      not.
 *
 * Plus the plumbing: the icons the manifest names exist and are the sizes it
 * claims, the daemon serves `.webmanifest` as a manifest, the CSP admits a
 * same-origin worker, and the client's three lines are where they say.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const PUBLIC = path.join(ROOT, 'public');

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const MANIFEST_SRC = read('public', 'manifest.webmanifest');
const MANIFEST = JSON.parse(MANIFEST_SRC);
const SW_SRC = read('public', 'sw.js');

/**
 * Any absolute URL, any protocol-relative URL, and the two ways a worker
 * reaches the network by name. Loopback is allowed — it is the only host this
 * product has ever contacted.
 */
function offMachineHosts(source) {
  const found = [];
  for (const m of source.matchAll(/(?:[a-z][a-z0-9+.-]*:)?\/\/([^\s'"`)\]}>,;]+)/gi)) {
    const host = m[1]
      .split('/')[0]
      .replace(/^\[|\]$/g, '')
      .replace(/:\d+$/, '');
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1') continue;
    found.push(m[0]);
  }
  return found;
}

test('the service worker names no host but this machine', () => {
  // Comments are stripped: the header explains what it refuses to do, and
  // that prose is the point. It is a URL in *code* that would be the defect.
  const code = SW_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.deepEqual(
    offMachineHosts(code),
    [],
    'public/sw.js reaches off this machine. The free core makes zero outbound connections.',
  );
});

test('the manifest names no host but this machine', () => {
  assert.deepEqual(offMachineHosts(MANIFEST_SRC), []);
  for (const key of ['start_url', 'scope', 'id']) {
    assert.doesNotMatch(String(MANIFEST[key] ?? ''), /^[a-z]+:\/\//i, `${key} is an absolute URL`);
  }
  for (const icon of MANIFEST.icons) {
    assert.doesNotMatch(icon.src, /^[a-z]+:\/\//i, `icon ${icon.src} is an absolute URL`);
  }
});

test('the service worker caches nothing', () => {
  const code = SW_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const forbidden of [/\bcaches\b/, /\bCache\b/, /cache\.(put|add|addAll|match)/]) {
    assert.doesNotMatch(
      code,
      forbidden,
      'public/sw.js has grown a cache. A cached floor lies about who is waiting; ' +
        'if this is deliberate it needs an invalidation plan and a changelog line.',
    );
  }
});

test('the service worker never answers a request itself', () => {
  const code = SW_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(
    code,
    /respondWith/,
    'intercepting responses breaks the SSE stream the floor is drawn from',
  );
  assert.match(code, /addEventListener\('fetch'/, 'installability needs a fetch handler');
});

test('the manifest is installable: name, start_url, display, and both icons', () => {
  assert.equal(MANIFEST.name, 'DeckHQ');
  assert.equal(MANIFEST.start_url, '/');
  assert.equal(MANIFEST.scope, '/');
  assert.equal(MANIFEST.display, 'standalone');
  const sizes = MANIFEST.icons.map((i) => i.sizes).sort();
  assert.deepEqual(sizes, ['192x192', '512x512']);
});

test('the icons the manifest names exist, and are the size it claims', () => {
  for (const icon of MANIFEST.icons) {
    const file = path.join(PUBLIC, icon.src.replace(/^\.\//, ''));
    assert.ok(fs.existsSync(file), `${icon.src} is missing`);
    const bytes = fs.readFileSync(file);
    assert.equal(
      bytes.subarray(0, 8).toString('hex'),
      '89504e470d0a1a0a',
      `${icon.src} is not a PNG`,
    );
    // IHDR is always the first chunk: 8-byte signature, 4-byte length, 'IHDR'.
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    assert.equal(`${width}x${height}`, icon.sizes, `${icon.src} is ${width}x${height}`);
    assert.equal(icon.type, 'image/png');
  }
});

test('the daemon serves .webmanifest as a manifest', () => {
  const src = read('src', 'http', 'server.mjs');
  assert.match(src, /'\.webmanifest': 'application\/manifest\+json/);
});

test('the CSP admits a same-origin worker and manifest, and no other origin', () => {
  const src = read('src', 'http', 'server.mjs');
  const csp = src.slice(src.indexOf("default-src 'self'"));
  assert.match(csp, /worker-src 'self'/);
  assert.match(csp, /manifest-src 'self'/);
  assert.doesNotMatch(csp.split('\n').slice(0, 5).join('\n'), /https?:\/\//);
});

test('the page links the manifest', () => {
  assert.match(read('public', 'index.html'), /rel="manifest" href="\.\/manifest\.webmanifest"/);
});

test('the client registers the worker and badges the count', () => {
  const app = read('public', 'app.js');
  assert.match(app, /navigator\.serviceWorker\.register\('\.\/sw\.js'/);
  assert.match(app, /navigator\.setAppBadge\?\.\(n\)/);
  assert.match(app, /navigator\.clearAppBadge\?\.\(\)/);
  // The badge is driven by the SSE snapshot's count, not by a local tally.
  assert.match(app, /setAppBadge\(c\.needsYou\)/);
});

test("WP-16's client footprint stays three delimited lines' worth", () => {
  // Other agents are editing app.js at the same time. Everything this package
  // adds is inside one marked block plus the single call in renderHeader, so a
  // merge conflict is a conflict about one region rather than a scavenger hunt.
  const app = read('public', 'app.js');
  assert.equal((app.match(/WP-16 · begin/g) || []).length, 2);
  assert.equal((app.match(/WP-16 · end/g) || []).length, 2);
});
