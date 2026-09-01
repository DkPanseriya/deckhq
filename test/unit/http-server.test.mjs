import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Router, readJson, sendJson, serveStatic } from '../../src/http/server.mjs';

/** Spin a throwaway loopback server around a handler. */
async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('Router matches by method and path', () => {
  const r = new Router();
  const h = () => {};
  r.get('/api/state', h).post('/api/ack', h);
  assert.equal(r.match('GET', '/api/state'), h);
  assert.equal(r.match('POST', '/api/ack'), h);
  assert.equal(r.match('POST', '/api/state'), undefined);
  assert.equal(r.match('GET', '/nope'), undefined);
});

test('serveStatic rejects path traversal instead of clamping it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckhq-static-'));
  const secretDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckhq-secret-'));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>ok</h1>');
  await fs.writeFile(path.join(secretDir, 'secret.txt'), 'do not serve me');

  await withServer(
    (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      serveStatic(res, root, url.pathname);
    },
    async (base) => {
      const ok = await fetch(`${base}/index.html`);
      assert.equal(ok.status, 200);
      assert.match(await ok.text(), /ok/);

      // Encoded and raw traversal, plus a Windows-flavoured attempt.
      for (const attempt of [
        '/../secret.txt',
        '/%2e%2e/secret.txt',
        '/..%2fsecret.txt',
        '/..\\secret.txt',
        '/a/../../secret.txt',
      ]) {
        const res = await fetch(base + attempt, { redirect: 'manual' });
        assert.ok(
          res.status === 403 || res.status === 404,
          `${attempt} should be refused, got ${res.status}`,
        );
        const body = await res.text();
        assert.doesNotMatch(body, /do not serve me/);
      }
    },
  );

  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(secretDir, { recursive: true, force: true });
});

test('serveStatic maps / to index.html and sets a no-egress CSP', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckhq-static-'));
  await fs.writeFile(path.join(root, 'index.html'), 'root page');
  await withServer(
    (req, res) => serveStatic(res, root, new URL(req.url, 'http://127.0.0.1').pathname),
    async (base) => {
      const res = await fetch(base + '/');
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'root page');
      const csp = res.headers.get('content-security-policy');
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /connect-src 'self'/);
      assert.match(csp, /object-src 'none'/);
    },
  );
  await fs.rm(root, { recursive: true, force: true });
});

test('readJson rejects malformed bodies and oversized bodies', async () => {
  await withServer(
    async (req, res) => {
      try {
        const body = await readJson(req);
        sendJson(res, 200, { got: body });
      } catch (err) {
        sendJson(res, 400, { error: err.message });
      }
    },
    async (base) => {
      const good = await fetch(base, { method: 'POST', body: JSON.stringify({ a: 1 }) });
      assert.deepEqual(await good.json(), { got: { a: 1 } });

      const bad = await fetch(base, { method: 'POST', body: '{not json' });
      assert.equal(bad.status, 400);

      const huge = await fetch(base, {
        method: 'POST',
        body: JSON.stringify({ a: 'x'.repeat(2 * 1024 * 1024) }),
      }).catch(() => null);
      // Either a 400 or a destroyed socket is acceptable; serving it is not.
      if (huge) assert.notEqual(huge.status, 200);
    },
  );
});
