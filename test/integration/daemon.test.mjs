/**
 * End-to-end checks against a real daemon on a real loopback port.
 *
 * These exercise the contract in docs/02-ARCHITECTURE.md §4, §5 and §9 — and,
 * above all, the product invariant in docs/01-PRODUCT.md §2.
 *
 * The machine is pinned before `src/` is imported (`docs/DEVIATIONS.md` §124).
 * This file is the one §121.4 named: `INVARIANT: reading a conversation over
 * HTTP never clears reviewSince` used to look for a `for_review` agent on the
 * host and return without asserting anything when it did not find one, so what
 * the file proved depended on what the developer happened to have open. It now
 * plants the session it needs and asserts unconditionally.
 */
// First, and before anything under `src/`: it moves the machine.
import { daemonScratch, writeClaudeSession } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const { startDaemon } = await import('../../src/daemon.mjs');

/** Start a daemon with an isolated state file and public dir. */
async function withDaemon(fn) {
  const { dir, stateFile, publicDir } = daemonScratch('daemon-');
  const d = await startDaemon({ port: 0, stateFile, publicDir });
  try {
    await fn(d, dir);
  } finally {
    await d.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('daemon binds loopback and serves a snapshot', async () => {
  await withDaemon(async (d) => {
    assert.match(d.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const addr = d.server.address();
    assert.equal(addr.address, '127.0.0.1', 'must never bind 0.0.0.0');

    const res = await fetch(d.url + 'api/state');
    assert.equal(res.status, 200);
    const snap = await res.json();
    for (const key of ['agents', 'projects', 'counts', 'settings']) {
      assert.ok(key in snap, `snapshot is missing ${key}`);
    }
    assert.ok(Array.isArray(snap.agents));
  });
});

test('daemon rejects a non-loopback Host header', async () => {
  await withDaemon(async (d) => {
    // `host` is a forbidden header for fetch(), so this needs a raw request.
    // The check matters: it is what stops a page on another origin from
    // driving the daemon via DNS rebinding.
    const status = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: d.port,
          path: '/api/state',
          method: 'GET',
          headers: { host: 'evil.example.com' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403);
  });
});

test('static serving refuses traversal out of the public directory', async () => {
  await withDaemon(async (d, dir) => {
    await fs.writeFile(path.join(dir, 'outside.txt'), 'secret');
    for (const p of ['../outside.txt', '%2e%2e/outside.txt', 'a/../../outside.txt']) {
      const res = await fetch(d.url + p);
      assert.ok(res.status === 403 || res.status === 404, `${p} -> ${res.status}`);
      assert.doesNotMatch(await res.text(), /secret/);
    }
  });
});

test('unknown api routes 404 and unknown actions 400', async () => {
  await withDaemon(async (d) => {
    assert.equal((await fetch(d.url + 'api/nope')).status, 404);
    const res = await fetch(d.url + 'api/ack', {
      method: 'POST',
      body: JSON.stringify({ id: 'claude-code:x', action: 'delete-everything' }),
    });
    assert.equal(res.status, 400);
  });
});

test('/api/hook answers well inside its 200 ms budget and never blocks', async () => {
  await withDaemon(async (d) => {
    const payload = JSON.stringify({
      hook_event_name: 'Stop',
      session_id: 'nonexistent-session',
      cwd: process.cwd(),
    });
    const started = Date.now();
    const res = await fetch(d.url + 'api/hook', { method: 'POST', body: payload });
    const elapsed = Date.now() - started;
    assert.equal(res.status, 200);
    assert.ok(elapsed < 200, `hook responded in ${elapsed} ms, budget is 200 ms`);

    // A burst must not degrade it either.
    const burstStart = Date.now();
    await Promise.all(
      Array.from({ length: 100 }, () =>
        fetch(d.url + 'api/hook', { method: 'POST', body: payload }),
      ),
    );
    const perEvent = (Date.now() - burstStart) / 100;
    assert.ok(perEvent < 200, `100 events averaged ${perEvent.toFixed(1)} ms each`);
  });
});

test('SSE pushes an initial snapshot and keeps the stream open', async () => {
  await withDaemon(async (d) => {
    const controller = new AbortController();
    const res = await fetch(d.url + 'api/events', { signal: controller.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const deadline = Date.now() + 5000;
    while (!buffer.includes('event: state') && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    assert.match(buffer, /event: state/);
    assert.match(buffer, /"agents"/);
    controller.abort();
  });
});

test('close() ends an open event stream instead of waiting forever for it', async () => {
  // The defect this pins: `close()` awaits `server.close()`, which waits for
  // every request to finish, and an SSE response never finishes on its own.
  // With a browser parked on the floor `close()` simply did not return —
  // measured here at >10 s and unbounded before the fix, 9 ms after it. That
  // deadlocked the goldens gate for eight minutes and hung any embedder.
  // `docs/DEVIATIONS.md` §126.3, §128.
  const { dir, stateFile, publicDir } = daemonScratch('daemon-sse-close-');
  const d = await startDaemon({ port: 0, stateFile, publicDir });
  // A raw request, not `fetch`: nothing pools it, nothing aborts it, and it
  // stays open exactly as long as the daemon leaves it open. Held out here so
  // the `finally` can destroy it: a regression must come back as a failing
  // assertion, and without this it would come back as a test file that never
  // exits — which is the reporting problem §121.3 and §126.3 are both about.
  const req = http.request({
    host: '127.0.0.1',
    port: d.port,
    path: '/api/events',
    method: 'GET',
  });
  try {
    const res = await new Promise((resolve, reject) => {
      req.on('response', resolve);
      req.on('error', reject);
      req.end();
    });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/event-stream/);
    res.setEncoding('utf8');

    let seen = '';
    let ended = false;
    const streamEnded = new Promise((resolve) =>
      res.on('end', () => {
        ended = true;
        resolve(undefined);
      }),
    );
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no snapshot arrived on the stream')), 5000);
      res.on('data', (chunk) => {
        seen += chunk;
        if (seen.includes('event: state')) {
          clearTimeout(timer);
          resolve(undefined);
        }
      });
    });
    assert.equal(ended, false, 'the stream must still be open when close() is called');

    // Raced rather than awaited: before the fix this promise never settles at
    // all, and a test that hangs reports nothing.
    const started = Date.now();
    const verdict = await Promise.race([
      d.close().then(() => 'closed'),
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve('hung'), 5000);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
    const elapsed = Date.now() - started;
    assert.equal(verdict, 'closed', 'close() did not return within 5 s with a stream attached');
    assert.ok(elapsed < 2000, `close() took ${elapsed} ms with a stream attached; budget is 2000`);

    // And the client is told, rather than left to notice a socket disappear.
    await streamEnded;
    assert.match(seen, /event: bye/, 'the stream must be ended with a bye, not cut');
  } finally {
    req.destroy();
    await d.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('close() releases what it owns in order, and the user-owned things first', async () => {
  // The order is the contract, not an implementation detail: a closing DeckHQ
  // must never leave a session blocked on a held permission request, and must
  // never leave a `claude` child of its own behind it, so those two go before
  // anything of ours (§97). The rest is ours to shut down, ledger last.
  const { dir, stateFile, publicDir } = daemonScratch('daemon-order-');
  const d = await startDaemon({ port: 0, stateFile, publicDir });
  /** @type {string[]} */
  const calls = [];
  const spy = (obj, name, label) => {
    const original = obj[name].bind(obj);
    obj[name] = (...args) => {
      calls.push(label);
      return original(...args);
    };
  };
  spy(d.permissions, 'shutdown', 'permissions.shutdown');
  spy(d.sends, 'shutdown', 'sends.shutdown');
  spy(d.registry, 'stop', 'registry.stop');
  spy(d.store, 'flush', 'store.flush');
  spy(d.ledger, 'close', 'ledger.close');

  const daemonFile = path.join(dir, 'daemon.json');
  assert.ok(existsSync(daemonFile), 'the daemon publishes where it is bound while it runs');

  try {
    await d.close();
    assert.deepEqual(calls, [
      'permissions.shutdown',
      'sends.shutdown',
      'registry.stop',
      'store.flush',
      'ledger.close',
    ]);
    assert.equal(existsSync(daemonFile), false, 'the daemon file must not outlive the daemon');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('INVARIANT: reading a conversation over HTTP never clears reviewSince', async () => {
  // A transcript with a finished assistant turn on it, in the isolated home:
  // that is what puts an agent in `for_review`, and planting it is what makes
  // the assertions below run every time rather than on the machines that
  // happened to have one. §121.4.
  const planted = writeClaudeSession({
    sessionId: '33333333-3333-3333-3333-333333333333',
    title: 'The one waiting on you',
    project: 'review-me',
  });
  try {
    await withDaemon(async (d) => {
      const registry = d.registry;
      await registry.refresh();
      const before = registry.agents.find((a) => a.activityState === 'for_review');
      assert.ok(before, 'the planted session did not reach the floor in for_review');

      const reviewSince = before.reviewSince;
      assert.ok(reviewSince, 'a for_review agent must carry reviewSince');

      await fetch(d.url + 'api/conversation?id=' + encodeURIComponent(before.id));
      await fetch(d.url + 'api/state');
      await registry.refresh();

      const after = registry.agents.find((a) => a.id === before.id);
      assert.equal(after.reviewSince, reviewSince, 'reading must not touch reviewSince');
      assert.equal(after.activityState, 'for_review');
      assert.equal(after.ackState, 'active');
    });
  } finally {
    planted.remove();
  }
});

test('settings round-trip and clamp the stall window', async () => {
  await withDaemon(async (d) => {
    const res = await fetch(d.url + 'api/settings', {
      method: 'POST',
      body: JSON.stringify({ stallWindowMs: 60_000_000, notifications: false }),
    });
    assert.equal(res.status, 200);
    const settings = await res.json();
    assert.equal(settings.notifications, false);
    assert.ok(settings.stallWindowMs <= 120 * 60 * 1000, 'stall window must clamp to 120 minutes');
  });
});

test('codexBin must be a file that exists, and never a batch launcher', async () => {
  // WP-23a, docs/DEVIATIONS.md §136.1. This is `editor`'s class of setting —
  // its value becomes a program — and this route is the only layer that can
  // look at the disk, so it is the layer that refuses. A rejected value is
  // reported rather than silently defaulted, which is what the store would do.
  await withDaemon(async (d, dir) => {
    const post = (body) =>
      fetch(d.url + 'api/settings', { method: 'POST', body: JSON.stringify(body) });

    const missing = await post({ codexBin: path.join(dir, 'no-such-codex.exe') });
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).error, /existing file/i);

    const shim = path.join(dir, 'codex.cmd');
    await fs.writeFile(shim, '@echo off\n');
    const batch = await post({ codexBin: shim });
    assert.equal(batch.status, 400);
    assert.match((await batch.json()).error, /cannot be a \.cmd or \.bat/i);

    const real = path.join(dir, 'codex-stand-in');
    await fs.writeFile(real, 'not really a binary, but it is a file\n');
    const ok = await post({ codexBin: real });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).codexBin, real);

    // And "" is always accepted: it means "find it".
    const cleared = await post({ codexBin: '' });
    assert.equal(cleared.status, 200);
    assert.equal((await cleared.json()).codexBin, '');
  });
});

test('hook status is reported per adapter, including unsupported ones', async () => {
  await withDaemon(async (d) => {
    const res = await fetch(d.url + 'api/hooks');
    assert.equal(res.status, 200);
    const { adapters } = await res.json();
    assert.ok(Array.isArray(adapters) && adapters.length >= 2, 'both runtimes must be listed');
    for (const a of adapters) {
      assert.ok('supported' in a && 'installed' in a && 'plan' in a);
    }
  });
});

test('installing hooks without consent is refused', async () => {
  await withDaemon(async (d) => {
    const res = await fetch(d.url + 'api/hooks/install', {
      method: 'POST',
      body: JSON.stringify({ runtime: 'claude-code' }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /consent/i);
  });
});

test('SECURITY: a cross-site POST is refused', async () => {
  await withDaemon(async (d) => {
    // Binding loopback keeps the network out but NOT other web pages: any site
    // the user visits can POST to 127.0.0.1, and the browser sets a correct
    // Host header on that request. Without an Origin check, such a page could
    // spawn a terminal via /api/open or run a project script via /api/run.
    const post = (headers) =>
      fetch(d.url + 'api/ack', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ id: 'claude-code:x', action: 'acknowledge' }),
      });

    const evil = await post({ origin: 'https://evil.example.com' });
    assert.equal(evil.status, 403, 'a foreign Origin must be refused');

    const evilFetchSite = await post({ 'sec-fetch-site': 'cross-site' });
    assert.equal(evilFetchSite.status, 403, 'Sec-Fetch-Site: cross-site must be refused');

    // Our own page still works: it is refused for being an unknown session
    // (404/409), never for being cross-site.
    const ours = await post({ origin: d.url.replace(/\/$/, ''), 'sec-fetch-site': 'same-origin' });
    assert.notEqual(ours.status, 403, 'our own page must not be blocked');
  });
});

test('SECURITY: reads are not blocked by the cross-site guard', async () => {
  await withDaemon(async (d) => {
    // GETs are safe and the client may fetch them in contexts without an
    // Origin; only mutations are gated.
    const res = await fetch(d.url + 'api/state', {
      headers: { origin: 'https://evil.example.com' },
    });
    assert.equal(res.status, 200);
  });
});
