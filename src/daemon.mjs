/**
 * The DeckHQ daemon: the single source of truth.
 *
 * Binds 127.0.0.1 and nothing else. Makes no outbound network calls of any
 * kind. Outlives the browser tab, because the whole point is that debts
 * accumulate while you are not looking.
 *
 * docs/02-ARCHITECTURE.md §1, §5, §9.
 */
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Router, sendError, serveStatic } from './http/server.mjs';
import { register as registerState } from './http/routes/state.mjs';
import { register as registerActions } from './http/routes/actions.mjs';
import { register as registerHooks } from './http/routes/hooks.mjs';
import { register as registerSettings } from './http/routes/settings.mjs';
import { register as registerChanges } from './http/routes/changes.mjs';
import { createLog } from './core/log.mjs';
import { Store } from './core/store.mjs';
import { STATE_FILE, migrateLegacyState } from './core/paths.mjs';
import { Registry } from './core/state-machine.mjs';
import { Identity } from './core/identity.mjs';
import * as adapters from './adapters/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');
export const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

// State lives in the user's home directory, never in the package directory.
// See src/core/paths.mjs for why.
export { STATE_FILE };

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4317;

/**
 * Thrown by `startDaemon` when the port the installed hooks post to is already
 * held by another DeckHQ daemon. Starting a second one beside it would bind
 * the next port along and run degraded — every hook event would keep going to
 * the first — so the caller is told which one is already there and starts
 * nothing. `bin/deckhq.mjs` turns this into a one-line message.
 */
export class DeckhqAlreadyRunningError extends Error {
  /**
   * @param {number} port
   * @param {string} label the runtime whose hooks point at that port
   */
  constructor(port, label) {
    super(`DeckHQ is already running at http://${HOST}:${port}/`);
    this.name = 'DeckhqAlreadyRunningError';
    this.port = port;
    this.url = `http://${HOST}:${port}/`;
    this.label = label;
  }
}

/**
 * Is anything accepting connections on this loopback port right now? A bare
 * TCP connect, refused immediately on loopback when nothing is there.
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
function portInUse(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port });
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * Is what is listening on this port a DeckHQ daemon? Identified the way
 * `deckhq doctor` identifies one: a well-formed `/api/state` snapshot. Anything
 * else on the port — another tool, a dev server, a stale process — is not ours
 * to reason about. Loopback only; never throws.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
async function isDeckhqDaemon(port) {
  try {
    const res = await fetch(`http://${HOST}:${port}/api/state`, {
      signal: AbortSignal.timeout(1500),
      headers: { connection: 'close' },
    });
    if (!res.ok) return false;
    const snapshot = await res.json();
    return Boolean(snapshot && Array.isArray(snapshot.agents) && snapshot.counts);
  } catch {
    return false;
  }
}

/**
 * Where to listen when the user named no port: wherever the installed hooks
 * already post, if that is free.
 *
 * Hooks are written with the port the daemon had at install time. A daemon
 * started later on a different port — the default after an install on 4400,
 * or 4318 after a walk — is the one failure that looks healthy from every
 * surface: the settings file is valid, the header claims exact state, and
 * every event lands nowhere. `doctor` reports it; this removes the way to
 * create it by accident. docs/plan/08-PLAN-V2-100X.md WP-36.
 *
 *   - hooks point at X and X is free: listen on X, say so in the log.
 *   - X is held by a DeckHQ daemon: throw `DeckhqAlreadyRunningError` — the
 *     hooks are already being delivered to it, and a second daemon beside it
 *     would be exactly the degraded case this exists to prevent.
 *   - X is held by something else: fall back to the requested port and let
 *     the header's banner offer the reinstall, as before.
 *   - no hooks, or hooks with no readable port: the requested port.
 *
 * An explicit `--port` never reaches this function: naming a port is a
 * request to be on it, and the banner is the honest report of what that
 * costs.
 *
 * @param {number} requested
 * @param {ReturnType<typeof createLog>} log
 * @returns {Promise<number>}
 */
async function adoptHooksPort(requested, log) {
  let hookPort = null;
  let label = 'runtime';
  for (const adapter of adapters.getAdapters()) {
    const hooks = adapter.hooks;
    if (!hooks || !hooks.supported || typeof hooks.installedPort !== 'function') continue;
    let port;
    try {
      port = await hooks.installedPort();
    } catch {
      continue; // unreadable settings read as "no hooks", as everywhere else
    }
    if (Number.isInteger(port) && port > 0) {
      hookPort = port;
      label = adapter.label;
      break;
    }
  }
  if (hookPort == null) return requested;

  if (!(await portInUse(hookPort))) {
    if (hookPort !== requested) {
      log.info(
        `listening on ${hookPort} rather than ${requested}: the installed ${label} hooks post there`,
      );
    }
    return hookPort;
  }
  if (await isDeckhqDaemon(hookPort)) throw new DeckhqAlreadyRunningError(hookPort, label);
  log.warn(
    `port ${hookPort}, where the installed ${label} hooks post, is held by something that is ` +
      `not DeckHQ; starting from ${requested} instead. Reinstall the hooks from the header once up.`,
  );
  return requested;
}

/**
 * @param {{ port?: number, adoptHooksPort?: boolean, stateFile?: string, publicDir?: string }} [opts]
 *   `adoptHooksPort` is set by the CLI when the user named no port: the daemon
 *   may then prefer the port the installed hooks post to (see `adoptHooksPort`
 *   above). Tests and embedders that pass a port leave it unset.
 * @returns {Promise<{ url:string, port:number, server:import('node:http').Server, registry:Registry, store:Store, close:() => Promise<void> }>}
 * @throws {DeckhqAlreadyRunningError} when adopting and the hooks' port is
 *   already a running DeckHQ daemon. Thrown before anything is opened or
 *   written, so there is nothing to close.
 */
export async function startDaemon(opts = {}) {
  const log = createLog('daemon');
  const publicDir = opts.publicDir || PUBLIC_DIR;

  // Decided first, before the store is touched: the already-running case
  // must leave no trace behind it.
  let preferredPort = opts.port ?? DEFAULT_PORT;
  if (opts.adoptHooksPort) preferredPort = await adoptHooksPort(preferredPort, log);

  // Carry over state written by a build that kept it inside the package.
  if (!opts.stateFile) migrateLegacyState(REPO_ROOT, log);
  const store = new Store(opts.stateFile || STATE_FILE);
  await store.load();

  // The Registry takes the adapter list; the HTTP layer takes the registry
  // module (it needs getAdapter/getAdapters for routing and hook status).
  const identity = new Identity(store);
  const registry = new Registry({
    store,
    adapters: adapters.getAdapters(),
    log: createLog('registry'),
    identity,
  });

  const router = new Router();
  /** @type {any} */
  // `port` is filled in once the listener is bound. The hooks routes read it
  // so the hook command they write points at THIS daemon, not at 4317 by
  // assumption — see src/adapters/claude-code/hooks.mjs.
  const ctx = { registry, store, adapters, identity, log, publicDir, port: null };
  registerState(router, ctx);
  registerActions(router, ctx);
  registerHooks(router, ctx);
  registerSettings(router, ctx);
  registerChanges(router, ctx);

  const server = http.createServer((req, res) => {
    // A missing Host header, or one pointing anywhere but loopback, is not a
    // request from our own page. Reject it rather than serve it.
    const host = String(req.headers.host || '');
    const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (hostname && hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') {
      return sendError(res, 403, 'Loopback only');
    }

    let url;
    try {
      url = new URL(req.url || '/', `http://${HOST}`);
    } catch {
      return sendError(res, 400, 'Bad request');
    }

    // Cross-site request forgery guard.
    //
    // Binding loopback keeps the network out, but it does NOT keep other web
    // pages out: any site the user visits can POST to 127.0.0.1, and the
    // browser sets a correct Host header on that request, so the check above
    // waves it through. Without this, a page in another tab could spawn a
    // terminal via /api/open, inject a prompt via /api/send, or run a project
    // script via /api/run.
    //
    // A cross-origin POST always carries an Origin the attacker cannot forge,
    // and modern browsers add Sec-Fetch-Site. Same-origin requests from our
    // own page carry our own origin. Reject anything else that mutates.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = String(req.headers.origin || '');
      const site = String(req.headers['sec-fetch-site'] || '');
      const originOk =
        origin === '' || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin);
      const siteOk = site === '' || site === 'same-origin' || site === 'none';
      if (!originOk || !siteOk) {
        log.warn('rejected cross-site request', req.method, url.pathname, origin || site);
        return sendError(res, 403, 'Cross-site requests are refused');
      }
    }

    const handler = router.match(req.method || 'GET', url.pathname);
    if (handler) {
      try {
        const out = handler(req, res, url, ctx);
        if (out && typeof out.catch === 'function') {
          out.catch((err) => {
            log.error('route threw', url.pathname, err);
            if (!res.headersSent) sendError(res, 500, 'Internal error');
          });
        }
      } catch (err) {
        log.error('route threw', url.pathname, err);
        if (!res.headersSent) sendError(res, 500, 'Internal error');
      }
      return;
    }

    if (url.pathname.startsWith('/api/')) return sendError(res, 404, 'Not found');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendError(res, 405, 'Method not allowed');
    }
    serveStatic(res, publicDir, url.pathname).catch((err) => {
      log.error('static failed', url.pathname, err);
      if (!res.headersSent) sendError(res, 500, 'Internal error');
    });
  });

  // Keep sockets from wedging shutdown.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  // SSE streams are long-lived by design.
  server.requestTimeout = 0;
  server.timeout = 0;

  const port = await listen(server, preferredPort, log);
  ctx.port = port;

  await ctx.refreshHookStatus?.().catch?.(() => {});
  await registry.start();

  const url = `http://${HOST}:${port}/`;
  log.info(`listening on ${url}`);

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    registry.stop();
    await store.flush?.();
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    server.closeAllConnections?.();
  }

  return { url, port, server, registry, store, close };
}

/**
 * Bind loopback, walking forward a few ports if the preferred one is taken.
 * @param {import('node:http').Server} server
 * @param {number} preferred
 */
function listen(server, preferred, log) {
  return new Promise((resolve, reject) => {
    let port = preferred;
    let attempts = 0;

    const onError = (err) => {
      if (err.code === 'EADDRINUSE' && attempts < 10) {
        attempts += 1;
        port += 1;
        log.warn(`port ${port - 1} in use, trying ${port}`);
        setTimeout(() => server.listen(port, HOST), 50);
        return;
      }
      server.off('error', onError);
      reject(err);
    };

    server.on('error', onError);
    server.on('listening', () => {
      server.off('error', onError);
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    });
    server.listen(port, HOST);
  });
}
