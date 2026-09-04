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
import { register as registerLayout } from './http/routes/layout.mjs';
import { register as registerChanges } from './http/routes/changes.mjs';
import { register as registerDiff } from './http/routes/diff.mjs';
import { register as registerPermission } from './http/routes/permission.mjs';
import { register as registerStats } from './http/routes/stats.mjs';
import { register as registerTraits } from './http/routes/traits.mjs';
import { register as registerSnapshot } from './http/routes/snapshot.mjs';
import { register as registerWrapped } from './http/routes/wrapped.mjs';
import { register as registerPacks } from './http/routes/packs.mjs';
import { register as registerReplay } from './http/routes/replay.mjs';
import { register as registerRates } from './http/routes/rates.mjs';
import { createLog } from './core/log.mjs';
import { Store } from './core/store.mjs';
import { Ledger } from './core/ledger.mjs';
import {
  DAEMON_FILE,
  LEDGER_DIR,
  PACKS_DIR,
  STATE_FILE,
  migrateLegacyState,
} from './core/paths.mjs';
import { currentPacks } from './core/packs.mjs';
import { clearDaemonFile, writeDaemonFile } from './core/daemon-file.mjs';
import { Registry } from './core/state-machine.mjs';
import { Identity } from './core/identity.mjs';
import { Permissions } from './core/permissions.mjs';
import { SendHub } from './core/sends.mjs';
import { createNotificationWatcher } from './core/notify-watch.mjs';
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
 * How long a connection that is still mid-request gets, once shutdown has
 * ended everything it owns, before it is taken away from it.
 *
 * Short on purpose. Everything on this server is loopback and small; the one
 * long-lived response is the event stream, and `close()` ends those itself
 * before the clock starts. What is left is a request that arrived in the last
 * instant, and half a second is a generous read of "let it finish".
 * `docs/DEVIATIONS.md` §128.
 */
const SHUTDOWN_GRACE_MS = 500;

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
      `not DeckHQ; starting from ${requested} instead. Reinstall the hooks from the settings sheet once up.`,
  );
  return requested;
}

/**
 * `DECKHQ_PERMISSION_HOLD_MS`, when it is a positive number. Undefined
 * otherwise, so `Permissions` falls back to its own default.
 * @returns {number|undefined}
 */
function envHoldMs() {
  const raw = Number(process.env.DECKHQ_PERMISSION_HOLD_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

/**
 * @param {{ port?: number, adoptHooksPort?: boolean, stateFile?: string,
 *           ledgerDir?: string, publicDir?: string, permissionHoldMs?: number,
 *           notify?: boolean, daemonFile?: string, snapshotDir?: string,
 *           packsDir?: string, ratesFile?: string }} [opts]
 *   `daemonFile` overrides where the bound port is published; it defaults to
 *   `daemon.json` beside `stateFile`, or `~/.deckhq/daemon.json` when the
 *   caller named no state file.
 *   `snapshotDir` overrides where `S` writes its PNGs (WP-14), for the same
 *   reason: a test must never write into the user's real `~/.deckhq`.
 *   `packsDir` and `ratesFile` do the same for WP-45's asset packs and the
 *   rate-card editor's override file: a test must never read the developer's
 *   installed packs, and must never edit the developer's own rate card.
 *   `adoptHooksPort` is set by the CLI when the user named no port: the daemon
 *   may then prefer the port the installed hooks post to (see `adoptHooksPort`
 *   above). Tests and embedders that pass a port leave it unset.
 *   `notify` is `--notify`: OS notifications for this run, without writing
 *   `settings.osNotify` (WP-16).
 * @returns {Promise<{ url:string, port:number, server:import('node:http').Server, registry:Registry, store:Store, ledger:Ledger, permissions:Permissions, sends:SendHub, close:() => Promise<void> }>}
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

  // WP-45. Packs are loaded BEFORE the store, and the order is the whole
  // reason this line is here rather than beside the routes: `store.load()`
  // sanitises `settings.theme` against the themes this build can paint, so a
  // machine whose floor is painted in a pack's theme would silently fall back
  // to the default on every start if the pack had not been registered yet.
  //
  // Never fatal. `currentPacks` does not throw, and a pack that will not load
  // is one line in the log — the product that captures your sessions does not
  // fail to start because a decoration is corrupt.
  const packsDir = opts.packsDir || PACKS_DIR;
  const packs = currentPacks({ dir: packsDir, force: true });
  for (const bad of packs.errors) log.warn(`pack "${bad.name}" was not loaded: ${bad.error}`);
  for (const pack of packs.packs) {
    for (const line of pack.rejected) log.warn(`pack "${pack.name}" — ${line}`);
  }
  if (packs.packs.length) {
    log.info(
      `${packs.packs.length} pack(s) loaded: ${packs.packs.map((p) => `${p.name} ${p.version}`).join(', ')}`,
    );
  }

  const store = new Store(opts.stateFile || STATE_FILE);
  await store.load();

  // WP-17. The ledger is opened before the registry so the registry's first
  // rebuild is already being written down, and primed from today's file so a
  // restart inside one day does not re-announce the whole floor. Retention is
  // enforced here, at start, and nowhere else: a prune on a timer would be a
  // background process deleting files in the user's home for the life of the
  // daemon, and one pass a start is enough for a 90-day window.
  // A caller that named its own `stateFile` — the integration suite, an
  // embedder — gets its ledger beside that file rather than in the real
  // `~/.deckhq`. A test daemon writing into the developer's own ledger would
  // corrupt the very measurement this package exists to make.
  const ledgerDir =
    opts.ledgerDir ||
    (opts.stateFile ? path.join(path.dirname(opts.stateFile), 'ledger') : LEDGER_DIR);
  const ledger = new Ledger(ledgerDir, {
    machineId: store.machineId,
    log: createLog('ledger'),
  });
  await ledger.prime();
  ledger.prune(store.settings.ledgerRetentionDays).then(
    ({ removed }) => {
      if (removed.length) log.info(`pruned ${removed.length} ledger day(s) past retention`);
    },
    () => {},
  );

  // The Registry takes the adapter list; the HTTP layer takes the registry
  // module (it needs getAdapter/getAdapters for routing and hook status).
  const identity = new Identity(store);
  const registry = new Registry({
    store,
    adapters: adapters.getAdapters(),
    log: createLog('registry'),
    identity,
    ledger,
  });

  // WP-19. The sockets a raised hand is waiting on. `holdMs` is configurable
  // so a test can prove the fall-through in milliseconds instead of ten
  // minutes, and so a machine whose runtime uses a shorter timeout can be
  // brought back under it; the default is the runtime's own 600 s less a
  // margin (src/core/permissions.mjs).
  const permissions = new Permissions({
    registry,
    log: createLog('permissions'),
    holdMs: opts.permissionHoldMs ?? envHoldMs(),
  });

  // WP-09. The turns currently running, and the channel their progress
  // reaches the page on. Held here rather than inside the route so `close()`
  // below can cancel every one of them while this process is still alive.
  const sends = new SendHub({ log: createLog('sends') });

  const router = new Router();
  /** @type {any} */
  // `port` is filled in once the listener is bound. The hooks routes read it
  // so the hook command they write points at THIS daemon, not at 4317 by
  // assumption — see src/adapters/claude-code/hooks.mjs.
  const ctx = {
    registry,
    store,
    adapters,
    identity,
    ledger,
    permissions,
    sends,
    log,
    publicDir,
    // Where `S` writes (WP-14). Overridable for the same reason `stateFile`
    // is: a test must never write into the user's real `~/.deckhq`.
    snapshotDir: opts.snapshotDir,
    // WP-45. Where installed asset packs live. Overridable for the same
    // reason `stateFile` is: a test must never read the developer's own.
    packsDir,
    // WP-45's rate-card editor writes here. Beside a caller's own state file
    // when it named one, so a test never edits the developer's rate card.
    ratesFile:
      opts.ratesFile ||
      (opts.stateFile ? path.join(path.dirname(opts.stateFile), 'rates.json') : undefined),
    port: null,
  };
  registerState(router, ctx);
  registerStats(router, ctx);
  registerTraits(router, ctx);
  registerWrapped(router, ctx);
  registerActions(router, ctx);
  registerHooks(router, ctx);
  registerSettings(router, ctx);
  registerLayout(router, ctx);
  registerChanges(router, ctx);
  registerDiff(router, ctx);
  registerPermission(router, ctx);
  registerSnapshot(router, ctx);
  registerPacks(router, ctx);
  registerReplay(router, ctx);
  registerRates(router, ctx);

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

  // WP-16. The one thing the browser's own Notification cannot do: reach the
  // user with every window closed. Two events only — a raised hand, and a
  // working session whose process went away without saying goodbye. Started
  // after the first scan so the floor as it already stands is the baseline
  // rather than a backlog to announce.
  const notifier = createNotificationWatcher({
    registry,
    store,
    flag: opts.notify === true,
    log: createLog('notify'),
  });

  const url = `http://${HOST}:${port}/`;

  // Publish where we are, so a hook command that was written before this port
  // was chosen can still find us (WP-37). An embedder that named its own state
  // file gets the record beside that file rather than in the user's home
  // directory: 400-odd tests start daemons, and none of them may overwrite the
  // record the real one on this machine wrote.
  const daemonFile =
    opts.daemonFile ??
    (opts.stateFile ? path.join(path.dirname(opts.stateFile), 'daemon.json') : DAEMON_FILE);
  writeDaemonFile({ file: daemonFile, port, url });

  log.info(`listening on ${url}`);

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    // Let go of every held permission request FIRST, answering each with
    // nothing: a closing DeckHQ must never leave a session blocked, and must
    // never spend its last act deciding something (docs/DEVIATIONS.md §97).
    permissions.shutdown();
    // And cancel every turn still running, for the same reason: a closing
    // DeckHQ must not leave a `claude` child of its own behind it. The
    // children are spawned `detached: false`, so this reaches them — see
    // SendHub.shutdown() for what that does and does not promise.
    sends.shutdown();
    notifier.stop();
    clearDaemonFile({ file: daemonFile });
    registry.stop();
    await store.flush?.();
    // Never allowed to fail the shutdown: a measurement is not worth an
    // unclean exit, and `close()` already swallows its own write errors.
    await ledger.close().catch(() => {});

    // Last of the things this daemon owns: the event streams it is holding
    // open. `/api/events` is a request in flight, forever, by design — a
    // browser parked on the floor has one, and so does every embedder that
    // subscribed — and the wait below is a wait for every request to finish.
    // Each gets a final `event: bye` and then `res.end()`, so the client sees
    // the stream end rather than a socket disappear. See
    // `src/http/routes/state.mjs` for the set this walks.
    ctx.endEventStreams?.();

    // `server.close()` stops accepting and then waits for every connection to
    // end. Three kinds do not end on their own, and each is answered here.
    //
    // **Idle keep-alive sockets.** A browser tab holds one; so does anything
    // using `fetch`, because undici pools its sockets. Node 19 made `close()`
    // release those itself, so there `closeIdleConnections()` is a redundant
    // second call. **Node 18 does not**, and there the wait runs until the
    // server's own timers expire — `headersTimeout` 60 s plus
    // `keepAliveTimeout` 5 s. That is the 64–65 s that every daemon test on
    // the Node 18 matrix jobs spent in here, ~18 of them, past the job's
    // 10-minute guard, reported as a cancellation rather than as a failure.
    // `docs/DEVIATIONS.md` §121 moved that call INSIDE the wait, where it can
    // actually unblock the promise.
    //
    // **Streams in flight.** §121 left this one: an SSE response is a request
    // that never finishes, `closeIdleConnections()` correctly will not touch
    // it, and `closeAllConnections()` — the one call that would — sat *after*
    // the `await` it was meant to unblock, so it could never run. `close()`
    // therefore never returned with a browser attached, which deadlocked the
    // goldens gate for eight minutes (§126.3). The streams are ended above,
    // and the call that was in the wrong place is now inside the wait too.
    //
    // **A socket that ended its response but has not gone quiet.** Which is
    // why `closeAllConnections()` waits `SHUTDOWN_GRACE_MS` rather than firing
    // at once: a request that arrived in the last instant is left to finish,
    // and a socket that is merely slow to be reaped is not waited on forever.
    // Both calls arrived in Node 18.2/19, so both are optional here (§128).
    await new Promise((resolve) => {
      // Armed before the close is asked for, so that the grace cannot be
      // started late by a slow callback, and cleared the moment the server
      // says it is done.
      const grace = setTimeout(() => server.closeAllConnections?.(), SHUTDOWN_GRACE_MS);
      if (typeof grace.unref === 'function') grace.unref();
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(grace);
        resolve(undefined);
      };
      server.close(done);
      server.closeIdleConnections?.();
    });
  }

  return { url, port, server, registry, store, ledger, permissions, sends, close };
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
