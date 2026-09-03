/**
 * Everything this extension does on a socket, and the only place it may.
 *
 * **The one rule.** `HOST` below is the only host name in this extension's
 * runtime source. Every request is built from it, there is no parameter that
 * can change it, and `test/unit/vscode-extension.test.mjs` reads the source of
 * `vscode/extension.js` and `vscode/lib/*.js` and fails if any other host
 * appears anywhere in them. DeckHQ makes no outbound network calls of any kind
 * (`docs/02-ARCHITECTURE.md` §9) and a Marketplace listing is exactly the
 * wrong place to start.
 *
 * `node:http` rather than `fetch` on purpose: the SSE stream at `/api/events`
 * is a long-lived response this has to read incrementally, and `http.get`
 * hands over the raw stream without a second abstraction in the way.
 */
const http = require('node:http');
const net = require('node:net');

/** The only host this extension ever speaks to. */
const HOST = '127.0.0.1';

/** The port the daemon prefers, and how far it walks when that one is taken. */
const DEFAULT_PORT = 4317;
const PORT_SCAN_SPAN = 10;

/**
 * Loopback ports worth asking about, most likely first. Mirrors
 * `candidatePorts()` in `src/cli/source.mjs`: a configured port is where the
 * user says the daemon is, so it is asked first, then the walk
 * `startDaemon()` performs when 4317 is taken.
 *
 * @param {{port?:number|null, span?:number}} [opts]
 * @returns {number[]}
 */
function candidatePorts(opts = {}) {
  const span = opts.span == null ? PORT_SCAN_SPAN : opts.span;
  /** @type {number[]} */
  const ordered = [];
  const add = (p) => {
    const n = Number(p);
    if (Number.isInteger(n) && n > 0 && n < 65536 && !ordered.includes(n)) ordered.push(n);
  };
  if (opts.port != null) add(opts.port);
  for (let p = DEFAULT_PORT; p < DEFAULT_PORT + span; p++) add(p);
  return ordered;
}

/**
 * Is anything accepting connections on this loopback port? A bare TCP connect,
 * refused in under a millisecond when nothing is there — so the HTTP client is
 * only ever stood up on a machine that has something to talk to.
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function probe(port, timeoutMs) {
  if (!(timeoutMs > 0)) return Promise.resolve(false);
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
 * GET a loopback path and parse the body as JSON. Never throws; a failure of
 * any kind — refused, slow, not JSON — resolves to `null`.
 * @param {number} port
 * @param {string} path must begin with `/`
 * @param {number} timeoutMs
 * @returns {Promise<any>}
 */
function getJson(port, path, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let req;
    try {
      req = http.get(
        { host: HOST, port, path, headers: { connection: 'close' }, timeout: timeoutMs },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            return done(null);
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            try {
              done(JSON.parse(body));
            } catch {
              done(null);
            }
          });
          res.on('error', () => done(null));
        },
      );
    } catch {
      return done(null);
    }
    req.on('timeout', () => {
      req.destroy();
      done(null);
    });
    req.on('error', () => done(null));
  });
}

/**
 * Is what answered on this port a DeckHQ daemon? Identified the way `doctor`
 * and `deckhq ls` identify one: a well-formed `/api/state` snapshot. Anything
 * else on the port is not ours to reason about.
 * @param {any} snapshot
 */
function isSnapshot(snapshot) {
  return Boolean(snapshot && Array.isArray(snapshot.agents) && snapshot.counts);
}

/**
 * Find a running DeckHQ inside one wall-clock budget. Every candidate is
 * TCP-probed in parallel first; only the ports that answered are spoken HTTP
 * to, in preference order.
 *
 * @param {{port?:number|null, span?:number, timeoutMs?:number,
 *          probe?:typeof probe, ask?:typeof getJson, now?:() => number}} [opts]
 * @returns {Promise<{port:number, snapshot:any}|null>}
 */
async function findDaemon(opts = {}) {
  const probeFn = opts.probe || probe;
  const ask = opts.ask || getJson;
  const now = opts.now || (() => Date.now());
  const budget = opts.timeoutMs == null ? 1000 : opts.timeoutMs;
  const ports = candidatePorts(opts);
  if (ports.length === 0) return null;

  const deadline = now() + budget;
  const left = () => deadline - now();

  const open = await Promise.all(ports.map((p) => probeFn(p, left())));
  const listening = ports.filter((_p, i) => open[i]);

  for (const port of listening) {
    const remaining = left();
    if (remaining <= 0) return null;
    const snapshot = await ask(port, '/api/state', remaining);
    if (isSnapshot(snapshot)) return { port, snapshot };
  }
  return null;
}

/**
 * The floor's URL for a port, and the deep link for one agent.
 *
 * The fragment never reaches the server, so it costs the daemon nothing.
 * `public/` does not read it yet — see `docs/DEVIATIONS.md` §93 — so today the
 * panel opens the floor and names the agent in the URL.
 *
 * @param {number} port
 * @param {string} [agentId]
 * @returns {string}
 */
function floorUrl(port, agentId) {
  const base = `http://${HOST}:${port}/`;
  return agentId ? `${base}#agent=${encodeURIComponent(agentId)}` : base;
}

/**
 * Subscribe to `/api/events`, the daemon's SSE stream.
 *
 * The daemon pushes a whole snapshot on every change, so there is no diffing
 * and no ordering to get wrong: each `event: state` is the new truth. The
 * caller gets `onSnapshot` and `onClose`; reconnection is the caller's
 * business (see `Monitor`), because only it knows whether the daemon is meant
 * to still be there.
 *
 * @param {{port:number, onSnapshot:(s:any) => void, onClose:() => void}} opts
 * @returns {{dispose:() => void}}
 */
function subscribe(opts) {
  let disposed = false;
  /** @type {import('node:http').ClientRequest|null} */
  let req = null;

  const close = () => {
    if (disposed) return;
    disposed = true;
    try {
      if (req) req.destroy();
    } catch {
      /* already gone */
    }
    opts.onClose();
  };

  try {
    req = http.get(
      {
        host: HOST,
        port: opts.port,
        path: '/api/events',
        headers: { accept: 'text/event-stream' },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return close();
        }
        res.setEncoding('utf8');
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk;
          // Events are separated by a blank line; anything after the last one
          // is a partial event and stays in the buffer.
          let split;
          while ((split = buffer.indexOf('\n\n')) !== -1) {
            const raw = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            // A comment line (`: ping`) is the heartbeat and carries no data.
            const data = raw
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim())
              .join('\n');
            if (!data) continue;
            try {
              const snapshot = JSON.parse(data);
              if (isSnapshot(snapshot)) opts.onSnapshot(snapshot);
            } catch {
              /* a truncated frame is dropped; the next one is a full snapshot */
            }
          }
          // A stream that has stopped delimiting events is a stream that has
          // gone wrong. Bound it rather than grow without limit.
          if (buffer.length > 8 * 1024 * 1024) close();
        });
        res.on('end', close);
        res.on('error', close);
        res.on('close', close);
      },
    );
    req.on('error', close);
  } catch {
    close();
  }

  return { dispose: close };
}

module.exports = {
  HOST,
  DEFAULT_PORT,
  PORT_SCAN_SPAN,
  candidatePorts,
  probe,
  getJson,
  isSnapshot,
  findDaemon,
  floorUrl,
  subscribe,
};
