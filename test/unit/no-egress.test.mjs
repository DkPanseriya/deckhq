/**
 * INVARIANT: THE PRODUCT'S OWN CODE OPENS NO OUTBOUND CONNECTION.
 *
 * `deckhq doctor` says "none by design: only 127.0.0.1", and the README and
 * the site say DeckHQ makes no outbound connection. That is a property of the
 * code, so it is held here, on the code: no module of the daemon, the CLI or
 * the browser page loads a library that can speak to the outside — TLS,
 * HTTP/2, UDP, DNS lookups — and every address a socket is opened to in the
 * source is the loopback one.
 *
 * What this cannot see, and the doctor row says so: a dependency of Node
 * itself, the operating system, or a browser's own traffic. It holds what
 * DeckHQ's code does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every source file of the shipped product: the daemon, the CLI and the page. */
function sources() {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) {
        // A build that carries a client for a paid service keeps it in
        // `src/pro/`; this file is about the product everybody gets.
        if (path.relative(ROOT, file).replace(/\\/g, '/') === 'src/pro') continue;
        walk(file);
      } else if (/\.m?js$/.test(e.name)) out.push(file);
    }
  };
  for (const dir of ['src', 'bin', 'public']) walk(path.join(ROOT, dir));
  return out;
}

const OUTWARD = [
  /from ['"](node:)?(https|tls|http2|dgram|dns)['"]/,
  /require\(['"](node:)?(https|tls|http2|dgram|dns)['"]\)/,
  /import\(['"](node:)?(https|tls|http2|dgram|dns)['"]\)/,
];

test('INVARIANT: no module loads a library that can reach outside this machine', () => {
  const files = sources();
  assert.ok(files.length > 100, `found only ${files.length} source files`);
  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const re of OUTWARD) {
      const m = re.exec(text);
      if (m) hits.push(`${path.relative(ROOT, file)}: ${m[0]}`);
    }
  }
  assert.deepEqual(hits, [], `an outward-facing library is loaded:\n${hits.join('\n')}`);
});

test('INVARIANT: every host a socket is opened to in the source is the loopback one', () => {
  const hits = [];
  // `host: '…'` and `hostname: '…'` literals handed to http/net, and fetch()
  // to an absolute http(s) address.
  const HOST = /\bhost(?:name)?\s*:\s*['"]([^'"]+)['"]/g;
  const URLS = /fetch\(\s*['"`](https?:\/\/[^'"`/]+)/g;
  const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  for (const file of sources()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(HOST)) {
      // Only what could be an address: a name with a dot, or one with a port.
      // `host: 'pro-teaser-host'` names an element, not a machine.
      if (!/[.:]/.test(m[1]) && m[1] !== 'localhost') continue;
      if (!LOOPBACK.has(m[1])) hits.push(`${path.relative(ROOT, file)}: host ${m[1]}`);
    }
    for (const m of text.matchAll(URLS)) {
      const host = m[1]
        .replace(/^https?:\/\//, '')
        .replace(/\$\{.*$/, '')
        .replace(/:\d*$/, '');
      if (host && !LOOPBACK.has(host)) hits.push(`${path.relative(ROOT, file)}: fetch ${m[1]}`);
    }
  }
  assert.deepEqual(hits, [], `a socket to somewhere else:\n${hits.join('\n')}`);
});
