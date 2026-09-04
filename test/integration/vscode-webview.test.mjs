/**
 * WP-31 — what the daemon has to be true for a VS Code webview to hold the
 * floor, and what it must go on refusing anyway.
 *
 * The extension loads `http://127.0.0.1:<port>/` into an **iframe** inside the
 * webview rather than re-serving `public/` on the `vscode-webview://` origin.
 * That choice is the whole security story of the package, and it rests on two
 * facts about the daemon that nothing in `vscode/` can enforce:
 *
 *   1. The floor may be framed — it sets no `X-Frame-Options` and no
 *      `frame-ancestors`. If that ever changes, the panel goes blank with no
 *      error anyone will see, so it is asserted here.
 *   2. Inside that frame the floor keeps its own origin, so its own requests
 *      are same-origin and the CSRF guard in `src/daemon.mjs` passes them
 *      untouched. **No allowance for `vscode-webview://` was added, and this
 *      file asserts that a request actually carrying that origin is still
 *      refused** — because if one ever arrived, it would not be from us.
 *
 * The machine is pinned before `src/` is imported (`docs/DEVIATIONS.md` §123).
 */
// First, and before anything under `src/`: it moves the machine.
import { daemonScratch } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';

const { startDaemon } = await import('../../src/daemon.mjs');

async function withDaemon(fn) {
  const { dir, stateFile, publicDir } = daemonScratch('vscode-');
  const d = await startDaemon({ port: 0, stateFile, publicDir });
  try {
    await fn(d);
  } finally {
    await d.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** A raw request, so `Origin` and `Sec-Fetch-Site` can be set freely. */
function request(port, opts) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: opts.path,
        method: opts.method || 'GET',
        headers: { ...(opts.headers || {}) },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

test('the floor can be framed, which is what the VS Code panel needs', async () => {
  await withDaemon(async (d) => {
    const res = await request(d.port, { path: '/' });
    assert.equal(res.status, 200);
    assert.equal(
      res.headers['x-frame-options'],
      undefined,
      'X-Frame-Options would blank the panel',
    );
    const csp = String(res.headers['content-security-policy'] || '');
    assert.ok(csp.length > 0, 'the floor still ships a policy of its own');
    assert.ok(
      !csp.includes('frame-ancestors'),
      'frame-ancestors would blank the panel; the webview wrapper is the one that names the frame',
    );
  });
});

test('a page served in the frame keeps its own origin, and the guard passes it', async () => {
  await withDaemon(async (d) => {
    const origin = `http://127.0.0.1:${d.port}`;
    const res = await request(d.port, {
      path: '/api/settings',
      method: 'POST',
      headers: {
        origin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    assert.notEqual(
      res.status,
      403,
      'the floor inside the iframe must not be treated as cross-site',
    );
  });
});

test('SECURITY: a vscode-webview:// origin is still refused', async () => {
  await withDaemon(async (d) => {
    for (const headers of [
      { origin: 'vscode-webview://0a1b2c3d-4e5f-6789-abcd-ef0123456789' },
      { origin: 'vscode-webview://x', 'sec-fetch-site': 'cross-site' },
      { origin: 'vscode-file://vscode-app' },
    ]) {
      const res = await request(d.port, {
        path: '/api/settings',
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(
        res.status,
        403,
        `${headers.origin} was not refused — no allowance for it was ever added, and none is needed`,
      );
    }
  });
});

test('the event stream the status bar reads is a plain loopback GET', async () => {
  await withDaemon(async (d) => {
    const first = await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port: d.port, path: '/api/events' }, (res) => {
        assert.equal(res.statusCode, 200);
        assert.match(String(res.headers['content-type']), /text\/event-stream/);
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
          const at = buffer.indexOf('event: state\ndata: ');
          if (at === -1) return;
          const end = buffer.indexOf('\n\n', at);
          if (end === -1) return;
          req.destroy();
          resolve(buffer.slice(at + 'event: state\ndata: '.length, end));
        });
        res.on('error', reject);
      });
      req.on('error', (err) => {
        // `destroy()` after we have what we came for is not a failure.
        if (buffered) return;
        reject(err);
      });
      let buffered = false;
      req.on('close', () => {
        buffered = true;
      });
    });
    const snapshot = JSON.parse(first);
    assert.ok(Array.isArray(snapshot.agents));
    assert.ok(snapshot.counts && typeof snapshot.counts.needsYou === 'number');
  });
});
