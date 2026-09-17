/**
 * A route that needs a runtime asks for one — WP-92j,
 * `docs/plan/13-ARCHITECTURE-AUDIT.md` A-08.
 *
 * Five handlers read `String(body.runtime || 'claude-code')`, which is not a
 * default: it is the daemon answering "which of four runtimes is this about?"
 * from a field that was not there. Four of them refuse now, with a 400 that
 * names the field. The fifth is `POST /api/permission`, whose URL is written
 * into the user's own Claude Code settings by the Claude Code adapter and
 * whose payload is the runtime's own — that one is a choice, asserted below to
 * still be the choice it was.
 *
 * Two halves, and the second is the one that makes this safe to ship:
 *
 *   1. The routes refuse, and refuse without doing anything — no session
 *      started, no directory made, no `openNewSession` called.
 *   2. Every caller in `public/` names a runtime. A route that refuses what
 *      the product itself sends is not a hardening, it is an outage, and a
 *      grep is the only thing that can say so about a client that is never
 *      imported by a test (A-13 is the finding about exactly that).
 *
 * The routes are driven through fake `IncomingMessage`/`ServerResponse`
 * objects, the way `permission-route.test.mjs` drives its own: nothing here
 * opens a socket, a terminal or a directory.
 */
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Router } from '../../src/http/server.mjs';
import { register } from '../../src/http/routes/actions.mjs';
import { RUNTIME_FIELD, RUNTIME_REQUIRED } from '../../src/http/routes/runtime-required.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = path.join(REPO, 'public');

const silentLog = { error() {}, warn() {}, debug() {}, info() {} };

function fakeRes() {
  const res = new EventEmitter();
  res.headersSent = false;
  res.status = null;
  res.body = null;
  res.writeHead = (status) => {
    res.headersSent = true;
    res.status = status;
    return res;
  };
  res.end = (payload) => {
    res.ended = true;
    if (payload != null) res.body = String(payload);
  };
  res.ended = false;
  return res;
}

/** Everything the routes could have done to the machine, recorded instead. */
function setup() {
  /** @type {any[]} */
  const started = [];
  const adapter = {
    id: 'claude-code',
    label: 'Claude Code',
    openNewSession: async (...args) => {
      started.push(args);
      return { ok: true };
    },
    appAvailable: async () => true,
  };
  const adapters = {
    getAdapter: (id) => (id === 'claude-code' ? adapter : null),
    getAdapters: () => [adapter],
  };
  const router = new Router();
  register(router, {
    registry: { agents: [], snapshot: () => ({ agents: [] }), on: () => () => {} },
    adapters,
    log: silentLog,
    store: { settings: {}, roomOrder: () => [] },
    sends: null,
    identity: null,
  });
  return { router, started };
}

async function post(router, route, body) {
  const handler = router.match('POST', route);
  assert.ok(handler, `POST ${route} is not registered`);
  const req = new EventEmitter();
  const res = fakeRes();
  const done = handler(req, res);
  req.emit('data', Buffer.from(JSON.stringify(body)));
  req.emit('end');
  await done;
  return { status: res.status, body: res.body == null ? null : JSON.parse(res.body) };
}

async function get(router, route, search = '') {
  const handler = router.match('GET', route);
  assert.ok(handler, `GET ${route} is not registered`);
  const req = new EventEmitter();
  const res = fakeRes();
  await handler(req, res, new URL(`http://127.0.0.1:4317${route}${search}`));
  return { status: res.status, body: res.body == null ? null : JSON.parse(res.body) };
}

// ---------------------------------------------------------------------------
// The refusal
// ---------------------------------------------------------------------------

test('a request to start a session without a runtime is refused, and starts nothing', async () => {
  for (const route of ['/api/new-project', '/api/agent']) {
    const { router, started } = setup();
    for (const over of [{}, { runtime: '' }, { runtime: '  ' }, { runtime: null }]) {
      const out = await post(router, route, { cwd: REPO, path: REPO, ...over });
      assert.equal(out.status, 400, `${route} ${JSON.stringify(over)}`);
      assert.equal(out.body.field, RUNTIME_FIELD);
      assert.equal(out.body.error, RUNTIME_REQUIRED);
    }
    assert.deepEqual(started, [], `${route} started a session it had been asked to refuse`);
  }
});

test('the refusal happens before the path is even looked at', async () => {
  // A 400 about a runtime must not depend on the directory existing: the two
  // are independent complaints, and a caller fixing one at a time has to be
  // able to see the other.
  const { router } = setup();
  const out = await post(router, '/api/new-project', { path: path.join(REPO, 'no-such-dir') });
  assert.equal(out.status, 400);
  assert.equal(out.body.field, RUNTIME_FIELD);
});

test('resume targets: an agent id names the runtime, `runtime` names it directly', async () => {
  const { router } = setup();

  const byId = await get(router, '/api/resume-targets', '?id=claude-code%3Asess-1');
  assert.equal(byId.status, 200);
  assert.equal(byId.body.appAvailable, true);

  const byRuntime = await get(router, '/api/resume-targets', '?runtime=claude-code');
  assert.equal(byRuntime.status, 200);
  assert.deepEqual(byRuntime.body, byId.body, 'the two ways of asking must answer the same');

  const neither = await get(router, '/api/resume-targets');
  assert.equal(neither.status, 400);
  assert.equal(neither.body.field, RUNTIME_FIELD);
  assert.match(neither.body.error, /id/, 'the refusal must name the other way to ask');

  const empty = await get(router, '/api/resume-targets', '?id=&runtime=');
  assert.equal(empty.status, 400);
});

test('an unknown runtime is still a 404, not a 400 — it was named, it just is not one', async () => {
  const { router } = setup();
  const out = await post(router, '/api/agent', { cwd: REPO, runtime: 'not-a-runtime' });
  assert.equal(out.status, 404);
  assert.equal(out.body.field, undefined);
});

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

/** Each route, and the field a caller of it must name. */
const CALLERS = [
  { route: '/api/new-project', field: 'runtime' },
  { route: '/api/agent', field: 'runtime' },
  { route: '/api/permission/decide', field: 'runtime' },
  // A GET, and its runtime rides in the query string as `id`.
  { route: '/api/resume-targets', field: 'id' },
  // WP-68. The one row here whose route does NOT answer 400 without a runtime:
  // `POST /api/studio/hire` has a documented default, because §4's contract is
  // `{ role }` on its own. The gate is on the CLIENT anyway, and for A-08's
  // reason rather than the route's: a Hire is a spawn, §4 makes the runtime a
  // real per-role choice between four of them, and a page that let the daemon
  // pick would be a page that never showed the user which one it picked.
  { route: '/api/studio/hire', field: 'runtime' },
];

/** Every `.js` under `public/`, flat — the client is one directory. */
async function clientSources() {
  const names = (await readdir(PUBLIC, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => e.name);
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const name of names) out.set(name, await readFile(path.join(PUBLIC, name), 'utf8'));
  return out;
}

test('every client caller of a runtime-refusing route names a runtime', async () => {
  const sources = await clientSources();
  for (const { route, field } of CALLERS) {
    /** @type {string[]} */
    const callers = [];
    for (const [name, src] of sources) {
      // A `fetch('/api/x'` or a template literal naming it. The comment-only
      // mentions in `panel.js` and `panel-permission.js`'s header are not
      // calls, so the match is on the fetch rather than on the route.
      if (new RegExp(`fetch\\(\\s*['"\`]${route}`).test(src)) callers.push(name);
    }
    assert.ok(callers.length > 0, `nothing in public/ calls ${route} — has it moved?`);
    for (const name of callers) {
      const src = /** @type {string} */ (sources.get(name));
      const at = src.search(new RegExp(`fetch\\(\\s*['"\`]${route}`));
      assert.ok(at >= 0);
      // The call and the object literal that follows it. Every one of these is
      // a short `fetch(url, { ... })` expression; 800 characters is the whole
      // of the longest of them and nowhere near the next one.
      const call = src.slice(at, at + 800);
      assert.match(
        call,
        new RegExp(`\\b${field}\\b`),
        `${name} calls ${route} without naming \`${field}\` — the daemon refuses that now`,
      );
    }
  }
});

test('POST /api/permission is the one that still chooses, and says so', async () => {
  // Not an oversight and not a default: the URL is written into the user own
  // Claude Code settings by the Claude Code adapter, the payload is the
  // runtime's own and names no runtime, and this route can never answer 400 —
  // everything it cannot handle ends as `{}` so the terminal prompt wins.
  const src = await readFile(path.join(REPO, 'src', 'http', 'routes', 'permission.mjs'), 'utf8');
  assert.match(src, /HOOK_URL_RUNTIME = 'claude-code'/);
  assert.equal(
    src.includes("String(payload.runtime || 'claude-code')"),
    false,
    'the literal should be the named constant with the reason beside it',
  );
  // And the decide half does refuse.
  assert.match(src, /requireRuntime\(res, body\.runtime\)/);
});

test('no route under src/http/ assumes a runtime any more, except the ones named here', async () => {
  const dir = path.join(REPO, 'src', 'http', 'routes');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.mjs'));
  /**
   * Where the shape is allowed to remain, each for a reason:
   *
   *   `hooks.mjs`             `POST /api/hook` resolves the runtime the way it
   *                           always has, which the audit names as
   *                           must-not-change; `hooks/{install,remove}` are
   *                           reached only from the hooks screen, which has
   *                           always sent one (asserted above, in the client
   *                           gate's own way).
   *   `permission.mjs`        the choice, now a named constant with the reason
   *                           beside it. It keeps `payload.runtime ||
   *                           HOOK_URL_RUNTIME`, not the literal.
   *   `runtime-required.mjs`  quotes the shape in its header to say what it
   *                           replaced.
   */
  const ALLOWED = new Set(['hooks.mjs', 'permission.mjs', 'runtime-required.mjs']);
  /** @type {string[]} */
  const assuming = [];
  for (const file of files) {
    if (ALLOWED.has(file)) continue;
    const src = await readFile(path.join(dir, file), 'utf8');
    if (/\|\|\s*'claude-code'/.test(src)) assuming.push(file);
  }
  assert.deepEqual(assuming, []);
});
