/**
 * End-to-end checks against a real daemon on a real loopback port.
 *
 * These exercise the contract in docs/02-ARCHITECTURE.md §4, §5 and §9 — and,
 * above all, the product invariant in docs/01-PRODUCT.md §2.
 *
 * The machine is pinned before `src/` is imported (`docs/DEVIATIONS.md` §123).
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
