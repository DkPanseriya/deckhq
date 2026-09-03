/**
 * Where a DeckHQ command-line surface gets its numbers.
 *
 * Two sources, in this order:
 *
 *   1. **A running daemon**, over loopback. It holds the only complete answer:
 *      liveness, the stall clock, and the observed half of every agent's state.
 *   2. **`~/.deckhq/state.json` plus `~/.deckhq/cache/`**, with no daemon at
 *      all. `state.json` is the user-owned half of the model — the ack record,
 *      including `reviewSince` and `needsInputSince` — and the cache is the
 *      derived half, one parsed summary per transcript on disk.
 *
 * The offline path is not a second implementation of the state machine. It is
 * exactly the bootstrap `Registry._ensureObserved()` already performs when the
 * daemon restarts: a persisted `reviewSince` means `for_review`, a persisted
 * `needsInputSince` means `needs_input`, and nothing else is inferred. No
 * liveness, so no `working`, and — the important one — **no `stalled`**, which
 * is a function of a live process and a clock neither of which exists here.
 * Inventing either would be a second, disagreeing representation of state, and
 * `docs/DEVIATIONS.md` has five entries on what that costs.
 *
 * Nothing in this file writes. Not `state.json`, not the cache, not an MK
 * number: `identity` is read exactly as it stands, and an agent the daemon has
 * never numbered simply has no tag yet. A read command that assigned an
 * identity would be a read command that mutates the file the product is made
 * of.
 *
 * No egress (docs/02-ARCHITECTURE.md §9): the only socket opened is to
 * 127.0.0.1.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';

import { CACHE_DIR, STATE_FILE } from '../core/paths.mjs';
import {
  ACK_STATES,
  counts as countsOf,
  needsYou,
  projectIdFromCwd,
  projectNameFromCwd,
  splitAgentId,
} from '../core/model.mjs';
import { withoutDemoAgents } from '../core/demo-fixture.mjs';

/** The port the daemon prefers, and how far it walks when that one is taken. */
export const DEFAULT_PORT = 4317;
export const PORT_SCAN_SPAN = 10;

/**
 * How long a CLI read waits for a daemon before giving up and reading the
 * files instead. WP-38's budget: a status line that blocks a terminal is worse
 * than a status line that is one poll stale.
 */
export const DAEMON_TIMEOUT_MS = 150;

/** @param {unknown} v */
function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** @param {unknown} n @returns {number|null} */
function posNumber(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Loopback ports worth asking about, most likely first.
 *
 * A port named on the command line or in the environment is where the user
 * says the daemon is, so it is asked first and alone; the rest of the range is
 * the walk `startDaemon()` performs when 4317 is taken.
 *
 * Deliberately does NOT consult the installed hooks' port, which would mean
 * loading the adapter registry — see `docs/DEVIATIONS.md` §92. `deckhq ls` and
 * friends accept `--port` for the machine whose daemon lives outside this
 * range, and `deckhq doctor` is the command that goes looking properly.
 *
 * @param {{port?:number|null, span?:number}} [opts]
 * @returns {number[]}
 */
export function candidatePorts(opts = {}) {
  const span = opts.span ?? PORT_SCAN_SPAN;
  /** @type {number[]} */
  const ordered = [];
  const add = (p) => {
    const n = Number(p);
    if (Number.isInteger(n) && n > 0 && n < 65536 && !ordered.includes(n)) ordered.push(n);
  };
  if (opts.port != null) add(opts.port);
  if (process.env.DECKHQ_PORT) add(process.env.DECKHQ_PORT);
  for (let p = DEFAULT_PORT; p < DEFAULT_PORT + span; p++) add(p);
  return ordered;
}

/**
 * Ask one loopback port for a snapshot, and decide whether the answer came
 * from a DeckHQ daemon.
 *
 * `connection: close` for the same reason `doctor` sets it: a one-shot command
 * has no use for a pooled socket, and an idle keep-alive outliving the command
 * is what turned a healthy run into a libuv abort at exit
 * (`docs/DEVIATIONS.md` §76).
 *
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<{port:number, snapshot:any}|null>}
 */
export async function askDaemon(port, timeoutMs) {
  if (!(timeoutMs > 0)) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/state`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { connection: 'close' },
    });
    if (!res.ok) return null;
    const snapshot = await res.json();
    // Something else on the port answering 200 to /api/state is not a daemon.
    if (!snapshot || !Array.isArray(snapshot.agents) || !snapshot.counts) return null;
    // A machine with no sessions gets an actor floor in the browser (WP-13).
    // The terminal is not the browser: `deckhq waiting` and the status line
    // exist to say what is really waiting, and a fake `2` in a shell prompt
    // is the one lie this product cannot afford. The actors are stripped
    // here, at the single door every CLI surface comes through.
    return { port, snapshot: withoutDemoAgents(snapshot) };
  } catch {
    return null;
  }
}

/**
 * Is anything accepting connections on this loopback port right now?
 *
 * A bare TCP connect, the same probe `doctor` uses. It is here for cost, not
 * for tidiness: the first `fetch()` in a process pays ~88 ms to stand undici
 * up (measured on the reference machine, Node 22, Windows), and on the
 * ordinary no-daemon machine that is the single largest cost in the whole
 * command. A refused TCP connect on loopback costs under a millisecond, so
 * the HTTP client is only ever loaded on a machine that has something to talk
 * to. `docs/DEVIATIONS.md` §92.
 *
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
export function probeLoopbackPort(port, timeoutMs) {
  if (!(timeoutMs > 0)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
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
 * Find a daemon inside one wall-clock budget.
 *
 * Every candidate is TCP-probed in parallel first — cheap, and on the
 * overwhelmingly common machine every one of them is refused instantly — and
 * only the ports that answered are spoken HTTP to, in preference order. A
 * stranger process holding 4318 open without answering can cost the budget,
 * and never more than it.
 *
 * @param {{port?:number|null, span?:number, timeoutMs?:number,
 *          ask?:typeof askDaemon, probe?:typeof probeLoopbackPort,
 *          now?:() => number}} [opts]
 * @returns {Promise<{port:number, snapshot:any}|null>}
 */
export async function findDaemon(opts = {}) {
  const ask = opts.ask || askDaemon;
  const probe = opts.probe || probeLoopbackPort;
  const now = opts.now || (() => Date.now());
  const timeoutMs = opts.timeoutMs ?? DAEMON_TIMEOUT_MS;
  const ports = candidatePorts(opts);
  if (ports.length === 0) return null;

  const deadline = now() + timeoutMs;
  const left = () => deadline - now();

  const open = await Promise.all(ports.map((p) => probe(p, left())));
  const listening = ports.filter((_p, i) => open[i]);

  for (const port of listening) {
    const budget = left();
    if (budget <= 0) return null;
    const found = await ask(port, budget);
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The offline path
// ---------------------------------------------------------------------------

/**
 * `state.json` as data, or an empty shell.
 *
 * Never throws. A missing file is a machine that has not run DeckHQ yet; a
 * corrupt one is `Store.load()`'s problem to back up and repair, and a read
 * command's job in the meantime is to report nothing rather than to fail.
 *
 * @param {string} [file]
 * @returns {{ack:Record<string,any>, identity:any, settings:any, found:boolean}}
 */
export function readState(file = STATE_FILE) {
  const empty = {
    ack: {},
    identity: { projects: {}, agents: {}, projectOf: {}, names: {} },
    settings: {},
    found: false,
  };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return empty;
  }
  if (!isPlainObject(parsed)) return empty;
  const identity = isPlainObject(parsed.identity) ? parsed.identity : {};
  return {
    ack: isPlainObject(parsed.ack) ? parsed.ack : {},
    identity: {
      projects: isPlainObject(identity.projects) ? identity.projects : {},
      agents: isPlainObject(identity.agents) ? identity.agents : {},
      projectOf: isPlainObject(identity.projectOf) ? identity.projectOf : {},
      names: isPlainObject(identity.names) ? identity.names : {},
    },
    settings: isPlainObject(parsed.settings) ? parsed.settings : {},
    found: true,
  };
}

/**
 * Every session summary the scan cache is holding, across all runtimes.
 *
 * Field-by-field permissive rather than schema-strict. `SummaryCache` discards
 * a whole file on a version bump because it hands its entries to a parser that
 * may have changed meaning; this reads six stable fields for display and can
 * afford to take what it recognises and ignore the rest. A cache written by a
 * newer build therefore degrades to fewer columns, never to a blank deck.
 *
 * Never throws.
 *
 * @param {string} [dir]
 * @returns {Array<{id:string, cwd:string, title:string, tokens:number,
 *                  lastText:string, lastActivityAt:number, runtime:string}>}
 */
export function readCache(dir = CACHE_DIR) {
  /** @type {any[]} */
  const out = [];
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      continue;
    }
    if (!isPlainObject(parsed) || !isPlainObject(parsed.entries)) continue;
    for (const entry of Object.values(parsed.entries)) {
      const s = isPlainObject(entry) ? entry.summary : null;
      if (!isPlainObject(s) || typeof s.id !== 'string' || !s.id) continue;
      out.push({
        id: s.id,
        runtime: typeof s.runtime === 'string' ? s.runtime : splitAgentId(s.id).runtime,
        cwd: typeof s.cwd === 'string' ? s.cwd : '',
        title: typeof s.title === 'string' ? s.title : '',
        tokens: typeof s.tokens === 'number' && Number.isFinite(s.tokens) ? s.tokens : 0,
        lastText: typeof s.lastText === 'string' ? s.lastText : '',
        lastActivityAt: posNumber(s.lastActivityAt) ?? 0,
      });
    }
  }
  return out;
}

/**
 * The MK tag and display name for one agent, read-only.
 * @param {any} identity
 * @param {string} agentId
 * @param {string} projectId
 */
function identityOf(identity, agentId, projectId) {
  const projectMk = identity.projects[projectId];
  const agentMk = identity.agents[agentId];
  const mk =
    typeof projectMk === 'number' && typeof agentMk === 'number'
      ? `MK${projectMk}.${agentMk}`
      : null;
  const rec = isPlainObject(identity.names[agentId]) ? identity.names[agentId] : {};
  const displayName = typeof rec.name === 'string' && rec.name ? rec.name : null;
  // The name the daemon gave on first sight (WP-20). Read-only here: this path
  // never assigns one — it reads a state.json the daemon owns, and an offline
  // read must not start writing names into it.
  const givenName = typeof rec.given === 'string' && rec.given ? rec.given : null;
  return {
    mk,
    displayName,
    givenName,
    label: displayName || givenName || mk || splitAgentId(agentId).sessionId.slice(0, 8),
  };
}

/**
 * Does this ack record describe a debt the user has not discharged?
 *
 * This is what makes the offline path safe to trust in the direction that
 * matters. The agent set comes from the cache, which is capped by entry count
 * and by bytes and can legitimately be missing sessions; an ack record
 * carrying an undischarged `reviewSince` is evidence of a debt regardless of
 * whether its summary survived that cap. Under-reporting the queue is the
 * worse failure for this product, so a debt with no cached summary is still
 * listed — with fewer columns filled in.
 *
 * @param {any} rec
 */
function isDebt(rec) {
  return Boolean(
    isPlainObject(rec) &&
    (rec.state === undefined || rec.state === 'active') &&
    (posNumber(rec.reviewSince) != null || posNumber(rec.needsInputSince) != null),
  );
}

/**
 * The agents, as far as the files on disk can say.
 *
 * @param {{stateFile?:string, cacheDir?:string, state?:any, summaries?:any[]}} [opts]
 * @returns {{agents:any[], counts:ReturnType<typeof countsOf>, source:'state', port:null}}
 */
export function readOffline(opts = {}) {
  const state = opts.state || readState(opts.stateFile);
  const summaries = opts.summaries || readCache(opts.cacheDir);

  /** @type {Map<string, any>} */
  const byId = new Map();
  for (const s of summaries) byId.set(s.id, s);

  const ids = new Set(byId.keys());
  for (const [id, rec] of Object.entries(state.ack)) {
    if (isDebt(rec)) ids.add(id);
  }

  /** @type {any[]} */
  const agents = [];
  for (const id of ids) {
    const summary = byId.get(id);
    const rec = isPlainObject(state.ack[id]) ? state.ack[id] : {};
    const ackState = /** @type {readonly string[]} */ (ACK_STATES).includes(rec.state)
      ? rec.state
      : 'active';
    const reviewSince = posNumber(rec.reviewSince);
    const needsInputSince = posNumber(rec.needsInputSince);

    // The daemon's own restart bootstrap, and nothing more. `for_review` wins
    // if both are somehow set, since it is the more specific, terminal state.
    const activityState =
      reviewSince != null ? 'for_review' : needsInputSince != null ? 'needs_input' : 'ended';

    const cwd = summary ? summary.cwd : '';
    const projectId = cwd
      ? projectIdFromCwd(cwd)
      : typeof state.identity.projectOf[id] === 'string'
        ? state.identity.projectOf[id]
        : 'unknown';
    const ident = identityOf(state.identity, id, projectId);

    agents.push({
      id,
      runtime: summary ? summary.runtime : splitAgentId(id).runtime,
      title: summary ? summary.title : '',
      cwd,
      projectId,
      projectName: cwd ? projectNameFromCwd(cwd) : projectId,
      live: false,
      activityState,
      ackState,
      reviewSince,
      needsInputSince,
      lastOutputAt: null,
      lastActivityAt: summary ? summary.lastActivityAt : reviewSince || needsInputSince || 0,
      tokens: summary ? summary.tokens : 0,
      lastText: summary ? summary.lastText : '',
      ...ident,
    });
  }

  return { agents, counts: countsOf(agents), source: 'state', port: null };
}

// ---------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------

/**
 * The deck, from the daemon if one answers and from the files if none does.
 *
 * @param {{port?:number|null, span?:number, timeoutMs?:number,
 *          stateFile?:string, cacheDir?:string,
 *          find?:typeof findDaemon, offline?:typeof readOffline}} [opts]
 * @returns {Promise<{agents:any[], counts:any, source:'daemon'|'state', port:number|null}>}
 */
export async function readDeck(opts = {}) {
  const find = opts.find || findDaemon;
  const offline = opts.offline || readOffline;
  const found = await find(opts);
  if (found) {
    const snap = found.snapshot;
    return {
      agents: Array.isArray(snap.agents) ? snap.agents : [],
      counts: snap.counts,
      source: 'daemon',
      port: found.port,
    };
  }
  return offline(opts);
}

/**
 * When this agent started waiting on the user.
 *
 * The user-owned timestamps first, because they are the ones the queue is
 * ordered by and the ones that survive a restart. `lastActivityAt` is the
 * fallback for a row that is in the list for some other reason.
 *
 * @param {any} agent
 * @returns {number}
 */
export function waitStart(agent) {
  return (
    posNumber(agent?.reviewSince) ??
    posNumber(agent?.needsInputSince) ??
    posNumber(agent?.lastOutputAt) ??
    posNumber(agent?.lastActivityAt) ??
    0
  );
}

/** Re-exported so a command can ask the model, not this file. */
export { needsYou };
