/**
 * Everything the DeckHQ plugin knows how to do, in one dependency-free module.
 *
 * ## Why this file duplicates a little of `src/`
 *
 * A plugin installed from a marketplace is **copied** into
 * `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` — the whole
 * directory and nothing else. There is no `node_modules`, no sibling `src/`,
 * and no guarantee that the repository the plugin came from is still on the
 * machine. So `plugin/` imports nothing outside itself, and the small amount of
 * DeckHQ it needs to restate — the three activity states that mean "this is on
 * you", and the loopback probe — is restated here rather than reached for.
 *
 * Everything else it asks the daemon, which is the single source of truth
 * (`docs/02-ARCHITECTURE.md` §1). This file computes no state, keeps no cache
 * and writes nothing the user owns.
 *
 * ## No egress
 *
 * The only host any function here will connect to is `127.0.0.1`. There is no
 * configuration that changes that: the host is a literal in one place.
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/** The only host this plugin ever speaks to. */
export const HOST = '127.0.0.1';

/** Where the daemon prefers to listen, and how far it walks when taken. */
export const DEFAULT_PORT = 4317;
export const PORT_SCAN_SPAN = 10;

/**
 * The three activity states that put an agent on the user's plate, restated
 * from `src/core/model.mjs`. An agent counts only while the user has not
 * discharged it (`ackState === 'active'`) — benched and let-go agents are the
 * user's own decision and are not owed anything.
 */
export const NEEDS_YOU_STATES = ['for_review', 'needs_input', 'stalled'];

/** @param {any} agent */
export function needsYou(agent) {
  return Boolean(
    agent && agent.ackState === 'active' && NEEDS_YOU_STATES.includes(agent.activityState),
  );
}

/** Where DeckHQ keeps its state, honouring the same override `src/` does. */
export function dataDir(env = process.env) {
  const override = env.DECKHQ_STATE_DIR;
  if (override && String(override).trim()) return path.resolve(String(override).trim());
  return path.join(os.homedir(), '.deckhq');
}

/**
 * The port a running daemon published in `~/.deckhq/daemon.json`, or null.
 *
 * A hint, never an answer: the file survives a daemon that was killed, so
 * every caller confirms it with a probe before believing it.
 *
 * @param {{env?:any, file?:string}} [opts]
 * @returns {number|null}
 */
export function publishedPort(opts = {}) {
  const file = opts.file || path.join(dataDir(opts.env), 'daemon.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const port = Number(parsed && parsed.port);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

/**
 * The port a DeckHQ hook already installed in Claude Code's own settings file
 * posts to, or null.
 *
 * A machine can have DeckHQ's hooks twice over: written into `settings.json`
 * from the floor's own consent screen, and carried by this plugin. The
 * settings-file ones name a port as a literal, and on a machine where that
 * port is not in the default walk — the daemon adopted 4400, say
 * (`docs/DEVIATIONS.md` §83) — it is the only record of where the daemon is
 * until that daemon has been restarted on a build that publishes
 * `daemon.json`. Reading it here is what stops this plugin trying to start a
 * second daemon beside a perfectly healthy one.
 *
 * Reading a runtime's own configuration would belong in an adapter if this
 * file were inside `src/` (`docs/02-ARCHITECTURE.md` §2). It is not: this is a
 * Claude Code plugin, running inside Claude Code, and it cannot import from a
 * repository that is not on the machine.
 *
 * @param {{env?:any, file?:string}} [opts]
 * @returns {number|null}
 */
export function installedHookPort(opts = {}) {
  const env = opts.env || process.env;
  const file =
    opts.file ||
    path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  // The same shape `src/adapters/claude-code/hooks.mjs` writes. Matched against
  // the raw text rather than a walked object: this runs on every hook event and
  // the file is small, so one regex beats parsing and traversing it.
  const m = /port:(\d+),path:'\/api\/hook'/.exec(raw);
  if (!m) return null;
  const port = Number(m[1]);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

/**
 * Loopback ports worth asking about, most likely first: the one the caller
 * named, then the one the environment names, then the one the daemon
 * published, then the one any settings-file hooks post to, then the walk
 * `startDaemon()` performs when 4317 is taken.
 *
 * @param {{port?:number|null, env?:any, span?:number, file?:string,
 *          settingsFile?:string}} [opts]
 * @returns {number[]}
 */
export function candidatePorts(opts = {}) {
  const env = opts.env || process.env;
  /** @type {number[]} */
  const ordered = [];
  const add = (p) => {
    const n = Number(p);
    if (Number.isInteger(n) && n > 0 && n < 65536 && !ordered.includes(n)) ordered.push(n);
  };
  if (opts.port != null) add(opts.port);
  if (env.DECKHQ_PORT) add(env.DECKHQ_PORT);
  add(publishedPort({ env, file: opts.file }));
  add(installedHookPort({ env, file: opts.settingsFile }));
  const span = opts.span ?? PORT_SCAN_SPAN;
  for (let p = DEFAULT_PORT; p < DEFAULT_PORT + span; p++) add(p);
  return ordered;
}

/**
 * Is anything accepting connections here? A bare TCP connect, for the reason
 * `src/cli/source.mjs` gives: standing up an HTTP client costs ~88 ms on the
 * first `fetch()` in a process, and on the ordinary machine every one of these
 * candidates is refused in well under a millisecond.
 *
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
export function probe(port, timeoutMs) {
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
 * Ask one port for a snapshot, and decide whether a DeckHQ answered. Something
 * else returning 200 to `/api/state` is not a daemon.
 *
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<{port:number, snapshot:any}|null>}
 */
export async function askState(port, timeoutMs) {
  if (!(timeoutMs > 0)) return null;
  try {
    const res = await fetch(`http://${HOST}:${port}/api/state`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { connection: 'close' },
    });
    if (!res.ok) return null;
    const snapshot = await res.json();
    if (!snapshot || !Array.isArray(snapshot.agents) || !snapshot.counts) return null;
    return { port, snapshot };
  } catch {
    return null;
  }
}

/**
 * Find the daemon inside one wall-clock budget: probe every candidate in
 * parallel, then speak HTTP only to the ones that answered, in order.
 *
 * @param {{port?:number|null, env?:any, span?:number, file?:string,
 *          timeoutMs?:number, probe?:typeof probe, ask?:typeof askState,
 *          now?:() => number}} [opts]
 * @returns {Promise<{port:number, snapshot:any}|null>}
 */
export async function findDaemon(opts = {}) {
  const probeFn = opts.probe || probe;
  const ask = opts.ask || askState;
  const now = opts.now || (() => Date.now());
  const deadline = now() + (opts.timeoutMs ?? 1000);
  const left = () => deadline - now();

  const ports = candidatePorts(opts);
  const open = await Promise.all(ports.map((p) => probeFn(p, left())));
  for (const port of ports.filter((_p, i) => open[i])) {
    const budget = left();
    if (budget <= 0) return null;
    const found = await ask(port, budget);
    if (found) return found;
  }
  return null;
}

/**
 * POST a hook payload to a daemon, verbatim. Resolves true when the daemon
 * accepted it and false on every failure — a hook that throws is a hook that
 * puts a stack trace in somebody's session.
 *
 * @param {number} port
 * @param {Buffer|string} body
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
export async function postHook(port, body, timeoutMs = 1000) {
  try {
    const res = await fetch(`http://${HOST}:${port}/api/hook`, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json', connection: 'close' },
    });
    // The body is small and already consumed by the daemon; draining keeps the
    // socket from lingering past process exit.
    await res.arrayBuffer().catch(() => {});
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The queue, as text
// ---------------------------------------------------------------------------

/**
 * The needs-you rows of a snapshot, oldest wait first — the deck's own order
 * (`docs/plan/05-GUI-UX-SPEC.md` §3.2).
 *
 * @param {any} snapshot
 * @returns {any[]}
 */
export function waitingFrom(snapshot) {
  const agents = snapshot && Array.isArray(snapshot.agents) ? snapshot.agents : [];
  const since = (a) =>
    num(a.reviewSince) ??
    num(a.needsInputSince) ??
    num(a.lastOutputAt) ??
    num(a.lastActivityAt) ??
    0;
  return agents.filter(needsYou).sort((a, b) => since(a) - since(b));
}

/** @param {unknown} v @returns {number|null} */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** A wait, in the coarsest unit that is still true. */
export function ago(ms) {
  if (!(ms > 0)) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** What each activity state is called in a sentence. */
const STATE_WORDS = {
  for_review: 'finished, for review',
  needs_input: 'hand up, waiting on an answer',
  stalled: 'stalled',
};

/**
 * The queue as plain text, for a slash command and for an MCP tool result.
 *
 * Deliberately not the ANSI table `deckhq waiting` prints: this text is read by
 * a model as often as by a person, and escape codes are noise in a transcript.
 * Never says "you" about a fault and never scores the human
 * (`docs/plan/08-PLAN-V2-100X.md` §1.1 rule 6).
 *
 * @param {any} snapshot
 * @param {{now?:number, port?:number|null}} [opts]
 * @returns {string}
 */
export function renderWaiting(snapshot, opts = {}) {
  const now = opts.now ?? Date.now();
  const rows = waitingFrom(snapshot);
  if (rows.length === 0) {
    return 'Nothing is waiting. Every session on this machine has been dealt with.';
  }
  const lines = [`${rows.length} waiting on this machine:`, ''];
  for (const a of rows) {
    const since =
      num(a.reviewSince) ?? num(a.needsInputSince) ?? num(a.lastOutputAt) ?? num(a.lastActivityAt);
    const label = a.displayName || a.mk || String(a.id || '').slice(0, 8);
    const where = a.projectName || a.projectId || '';
    const what = STATE_WORDS[a.activityState] || a.activityState || '';
    const waited = since ? ` · ${ago(now - since)}` : '';
    lines.push(`  ${label} — ${where} — ${what}${waited}`);
    const text = oneLine(a.lastText, 100);
    if (text) lines.push(`      ${text}`);
  }
  return lines.join('\n');
}

/**
 * One line of plain text, at most `max` characters.
 *
 * A transcript line is text this project did not write. It reaches a model's
 * context and a terminal, so every control, format and surrogate code point
 * becomes a space first — the same rule `toolSummary` applies in
 * `src/adapters/claude-code/hooks.mjs` (`docs/DEVIATIONS.md` §89 decision 6).
 *
 * @param {unknown} value
 * @param {number} max
 */
export function oneLine(value, max) {
  const flat = String(value ?? '')
    .replace(/\p{C}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

/** What every surface says when nothing is listening. */
export const NO_DAEMON =
  'DeckHQ is not running on this machine. Start it with `deckhq` (or open a new Claude Code ' +
  'session — this plugin starts it on SessionStart when `deckhq` is on PATH).';
