/**
 * `deckhq doctor` — the environment report, and the launch asset.
 *
 * The claim DeckHQ is built on is that it sees every agent session on the
 * machine, including the ones the runtime's own view cannot: Claude Code's
 * documentation says plainly that "interactive sessions you have open in other
 * terminals don't appear until you background them". That claim is worth
 * exactly as much as a user's ability to check it on their own machine in one
 * line. This command is that line.
 *
 * Everything here goes through the adapter registry (docs/02-ARCHITECTURE.md
 * §2). No transcript is read and no runtime CLI is spawned from this file —
 * `scanSessions()` and `liveSessions()` do both, behind the interface.
 *
 * No network egress (§9). The only sockets opened are to 127.0.0.1: a probe
 * for "is anything listening on the port the hooks target", and, when there is,
 * a read of the running daemon's own hook-health numbers.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import * as defaultAdapters from '../adapters/index.mjs';
import { DATA_DIR, STATE_FILE } from '../core/paths.mjs';
import { readDaemonFile } from '../core/daemon-file.mjs';
import { TERMINAL_AUTO } from '../core/store.mjs';
import { describeTerminal } from '../adapters/claude-code/terminals.mjs';

/**
 * The same scan bounds the daemon uses (src/core/state-machine.mjs), so
 * "on the floor" is the number the floor would actually show. A doctor that
 * counts differently from the product is worse than no doctor.
 */
export const SCAN_MAX_AGE_DAYS = 36500;
export const SCAN_LIMIT = 5000;

/** The port the daemon prefers, and how far it walks when that one is taken. */
const DEFAULT_PORT = 4317;
const PORT_SCAN_SPAN = 10;

/** Column width for the report's label gutter. */
const LABEL_WIDTH = 16;

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

/**
 * Is anything listening on 127.0.0.1:port right now?
 *
 * A bare TCP connect, not an HTTP request: the question is only whether the
 * hooks are firing into a void, and a socket that opens answers it without
 * assuming what is on the other end.
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
export function probeLoopbackPort(port, timeoutMs = 500) {
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
 * Ask whatever is listening on this loopback port whether it is a DeckHQ
 * daemon, and if so what it knows.
 *
 * Two things live only in a running daemon's memory and have no other source:
 * the hook delivery counters, and the deck — how many sessions are actually
 * waiting on the user right now. No daemon means both are simply unknown,
 * which is not an error.
 *
 * @param {number} port
 * @returns {Promise<{port:number, hookHealth:Map<string,{eventsSeen:number,lastEventAt:number|null}>, deck:any}|null>}
 */
export async function inspectDaemon(port) {
  /** @type {any} */
  let snapshot;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/state`, {
      signal: AbortSignal.timeout(1500),
      // A one-shot command has no use for a pooled connection, and an idle
      // keep-alive socket outliving the report is exactly what turned a
      // healthy run into a libuv abort at exit.
      headers: { connection: 'close' },
    });
    if (!res.ok) return null;
    snapshot = await res.json();
  } catch {
    return null; // nothing there, or not answering
  }
  // Something else on the port answering 200 to /api/state is not a daemon.
  if (!snapshot || !Array.isArray(snapshot.agents) || !snapshot.counts) return null;

  /** @type {Map<string, {eventsSeen:number, lastEventAt:number|null}>} */
  const hookHealth = new Map();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/hooks`, {
      signal: AbortSignal.timeout(1500),
      // A one-shot command has no use for a pooled connection, and an idle
      // keep-alive socket outliving the report is exactly what turned a
      // healthy run into a libuv abort at exit.
      headers: { connection: 'close' },
    });
    if (res.ok) {
      const body = await res.json();
      for (const entry of body.adapters || []) {
        if (!entry || typeof entry.runtime !== 'string') continue;
        hookHealth.set(entry.runtime, {
          eventsSeen: Number(entry.eventsSeen) || 0,
          lastEventAt: typeof entry.lastEventAt === 'number' ? entry.lastEventAt : null,
        });
      }
    }
  } catch {
    // The deck is still worth having without the counters.
  }

  return { port, hookHealth, deck: deckFrom(snapshot) };
}

/**
 * What the machine currently owes the user, from a daemon snapshot.
 *
 * `waitingNotRunning` is the number that matters and the only one safe to
 * claim anything about. A session the runtime still lists as running may well
 * be waiting on a permission prompt — the runtime's own view would show that
 * one, so counting it as something the runtime hides would be false. Each
 * agent carries its own `live` flag, so the intersection is exact rather than
 * inferred.
 *
 * @param {any} snapshot
 */
export function deckFrom(snapshot) {
  const agents = Array.isArray(snapshot?.agents) ? snapshot.agents : [];
  const waiting = agents.filter(
    (a) =>
      a &&
      a.ackState === 'active' &&
      (a.activityState === 'for_review' ||
        a.activityState === 'needs_input' ||
        a.activityState === 'stalled'),
  );
  const notRunning = waiting.filter((a) => a.live !== true);

  let oldestWaitAt = null;
  for (const a of notRunning) {
    for (const t of [a.reviewSince, a.needsInputSince, a.lastOutputAt]) {
      if (typeof t === 'number' && t > 0) {
        if (oldestWaitAt === null || t < oldestWaitAt) oldestWaitAt = t;
        break; // the first set field is this agent's own wait start
      }
    }
  }

  return {
    found: true,
    waiting: waiting.length,
    waitingNotRunning: notRunning.length,
    oldestWaitAt,
    total: agents.length,
  };
}

/** The deck when no daemon could be found to ask. */
const NO_DECK = {
  found: false,
  waiting: null,
  waitingNotRunning: null,
  oldestWaitAt: null,
  total: null,
};

/**
 * Can DeckHQ actually write the state it owns?
 *
 * This writes a probe file and deletes it, rather than asking
 * `fs.access(W_OK)`. On Windows `access` only consults the read-only
 * attribute and cheerfully reports a directory writable that a real write
 * fails on — and a doctor whose answer is wrong in the one case it exists for
 * is not worth shipping.
 *
 * @param {{stateFile:string, dataDir:string}} opts
 * @returns {{path:string, writable:boolean, error:string|null}}
 */
export function checkState({ stateFile, dataDir }) {
  const probe = path.join(dataDir, `.doctor-probe-${process.pid}`);
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(probe, 'deckhq doctor\n', 'utf8');
    fs.unlinkSync(probe);
  } catch (err) {
    return { path: stateFile, writable: false, error: err?.message || String(err) };
  }
  // The directory being writable does not make an existing file writable —
  // a root-owned or read-only state.json is the exact failure this catches.
  if (fs.existsSync(stateFile)) {
    try {
      fs.accessSync(stateFile, fs.constants.W_OK);
    } catch (err) {
      return { path: stateFile, writable: false, error: err?.message || String(err) };
    }
  }
  return { path: stateFile, writable: true, error: null };
}

/**
 * One runtime's row: is it here, how much of it is on disk, and how much of
 * that its own view can see.
 * @param {any} adapter
 * @param {{maxAgeDays:number, limit:number}} scan
 */
async function collectRuntime(adapter, scan) {
  const row = {
    id: adapter.id,
    label: adapter.label,
    available: false,
    /**
     * The runtime's own version string. Always null today: the adapter
     * interface (docs/02-ARCHITECTURE.md §2) exposes no `version()`, and
     * asking the runtime directly would mean spawning its CLI from outside an
     * adapter, which the architecture forbids. Read through an optional
     * method so this row fills itself in the day the interface grows one.
     * See docs/DEVIATIONS.md §72.
     */
    version: null,
    sessions: 0,
    projects: 0,
    live: 0,
    liveReported: 0,
    finished: 0,
    error: null,
  };

  try {
    row.available = Boolean(await adapter.available());
  } catch (err) {
    row.error = err?.message || String(err);
    return row;
  }
  if (!row.available) return row;

  try {
    if (typeof adapter.version === 'function') {
      const v = await adapter.version();
      row.version = typeof v === 'string' && v.trim() ? v.trim() : null;
    }
  } catch {
    row.version = null; // never fail the report over a cosmetic field
  }

  try {
    const sessions = await adapter.scanSessions(scan);
    const list = Array.isArray(sessions) ? sessions : [];
    row.sessions = list.length;
    row.projects = new Set(list.map((s) => s && s.cwd).filter(Boolean)).size;
  } catch (err) {
    row.error = err?.message || String(err);
  }

  try {
    const live = await adapter.liveSessions();
    const list = Array.isArray(live) ? live : [];
    row.live = list.length;
    // Same number, deliberately reported twice. `liveSessions()` IS the
    // runtime's own answer, so printing both is what makes the comparison
    // below checkable rather than a claim: DeckHQ is not inflating its side.
    row.liveReported = list.length;
  } catch (err) {
    row.error = row.error || err?.message || String(err);
  }

  // Sessions on disk whose process is no longer running. This used to be
  // called "sessions the agent view cannot see", which was false: `claude
  // agents --json` lists interactive terminal sessions perfectly well while
  // they are alive. What it does not do is remember one after it exits. So
  // this number is exactly what it says — finished — and the claim attached
  // to it is only that a view of running processes no longer lists them.
  // See docs/DEVIATIONS.md §74.
  //
  // Clamped at zero: a runtime reporting more running sessions than we have
  // transcripts for (a session seconds old whose file has not landed yet)
  // means none have finished, not that a negative number have.
  row.finished = Math.max(0, row.sessions - row.liveReported);
  return row;
}

/**
 * The `terminal` setting, read straight off `state.json`.
 *
 * `doctor` does not construct a `Store`: that one would schedule debounced
 * writes and, on a machine where the state file is missing, is one method call
 * away from creating it. A read-only command must not be able to write the
 * state it is reporting on. So this is a plain read, and every failure — no
 * file, unreadable, unparseable, wrong shape — is `auto`, which is also what
 * the daemon would use.
 * @param {string} stateFile
 * @returns {Promise<string>}
 */
export async function readTerminalPin(stateFile) {
  try {
    const parsed = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
    const pin = parsed?.settings?.terminal;
    return typeof pin === 'string' && pin.trim() ? pin.trim() : TERMINAL_AUTO;
  } catch {
    return TERMINAL_AUTO;
  }
}

/**
 * One hooks row per adapter that supports hooks.
 * @param {any} adapter
 * @param {{probe:Function}} deps
 */
async function collectHooks(adapter, deps) {
  const row = {
    runtime: adapter.id,
    label: adapter.label,
    supported: Boolean(adapter.hooks && adapter.hooks.supported),
    installed: false,
    // WP-37: the same hook block can arrive as a Claude Code plugin, which
    // puts nothing in the settings file and carries no port. Reported
    // separately so the row can say which route it found without claiming a
    // port that does not exist.
    viaPlugin: false,
    port: null,
    listening: null,
    eventsSeen: null,
    lastEventAt: null,
    error: null,
  };
  if (!row.supported) return row;

  try {
    row.viaPlugin = Boolean(await adapter.hooks.pluginInstalled?.());
    row.installed = Boolean(await adapter.hooks.installed()) || row.viaPlugin;
    if (row.installed && typeof adapter.hooks.installedPort === 'function') {
      const port = await adapter.hooks.installedPort();
      row.port = typeof port === 'number' ? port : null;
    }
  } catch (err) {
    row.error = err?.message || String(err);
    return row;
  }

  if (row.installed && row.port != null) {
    row.listening = await deps.probe(row.port);
  }
  return row;
}

/**
 * Loopback ports worth asking about: wherever the hooks point, whatever the
 * user named, and the range the daemon walks when 4317 is taken. Finding a
 * daemon on a port DIFFERENT from the one the hooks target is the whole
 * reason this scan exists — see the exit-code rules below.
 * A plugin install adds a third source (WP-37): its hooks carry no port, so
 * the running daemon publishes the one it bound in `~/.deckhq/daemon.json` and
 * this scan reads it. Without that, a daemon the plugin started outside the
 * ten-port walk would be invisible to the one command whose job is to find it.
 *
 * @param {number[]} hookPorts
 * @param {number|null} explicit
 * @param {number|null} [published]
 */
function candidatePorts(hookPorts, explicit, published = null) {
  const ports = new Set(hookPorts.filter((p) => typeof p === 'number'));
  if (explicit != null) ports.add(explicit);
  if (published != null) ports.add(published);
  for (let p = DEFAULT_PORT; p < DEFAULT_PORT + PORT_SCAN_SPAN; p++) ports.add(p);
  return [...ports];
}

/**
 * The whole report, as data. Every external dependency is injectable so the
 * tests can drive a fake registry and a fake machine.
 *
 * @param {{
 *   adapters?: {getAdapters: () => any[]},
 *   stateFile?: string,
 *   dataDir?: string,
 *   probe?: (port:number) => Promise<boolean>,
 *   inspect?: (port:number) => Promise<any>,
 *   port?: number|null,
 *   now?: number,
 *   scan?: {maxAgeDays:number, limit:number},
 *   terminal?: (opts:any) => Promise<any>,
 *   terminalPin?: string,
 * }} [opts]
 */
export async function collectReport(opts = {}) {
  const adapters = opts.adapters || defaultAdapters;
  const stateFile = opts.stateFile || STATE_FILE;
  const dataDir = opts.dataDir || DATA_DIR;
  const probe = opts.probe || probeLoopbackPort;
  const inspect = opts.inspect || inspectDaemon;
  const now = opts.now ?? Date.now();
  const scan = opts.scan || { maxAgeDays: SCAN_MAX_AGE_DAYS, limit: SCAN_LIMIT };
  const findTerminal = opts.terminal || describeTerminal;

  const list = adapters.getAdapters();
  const runtimes = await Promise.all(list.map((a) => collectRuntime(a, scan)));
  const hooks = await Promise.all(list.map((a) => collectHooks(a, { probe })));

  // Find the daemon, if there is one. TCP-probe every candidate in parallel
  // first — cheap — then only speak HTTP to the ports that answered.
  const candidates = candidatePorts(
    hooks.map((h) => h.port),
    opts.port ?? null,
    opts.publishedPort !== undefined
      ? opts.publishedPort
      : (readDaemonFile(path.join(dataDir, 'daemon.json'))?.port ?? null),
  );
  const open = await Promise.all(candidates.map((p) => probe(p)));
  const listening = new Set(candidates.filter((_p, i) => open[i]));

  for (const row of hooks) {
    if (row.installed && row.port != null) row.listening = listening.has(row.port);
  }

  /** @type {{port:number, hookHealth:Map<string,any>, deck:any}|null} */
  let daemon = null;
  // Prefer the port the hooks target, so a healthy install is identified in
  // one request and the mismatch case is the one that costs a scan.
  const ordered = [...listening].sort((a, b) => {
    const aHook = hooks.some((h) => h.port === a) ? 0 : 1;
    const bHook = hooks.some((h) => h.port === b) ? 0 : 1;
    return aHook - bHook || a - b;
  });
  for (const port of ordered) {
    const found = await inspect(port);
    if (found) {
      daemon = found;
      break;
    }
  }

  if (daemon) {
    for (const row of hooks) {
      // A runtime with no hook mechanism has no delivery evidence to report,
      // and a zero there would read as "installed but silent" rather than
      // "not a thing this runtime does".
      if (!row.supported) continue;
      const found = daemon.hookHealth.get(row.runtime);
      if (!found) continue;
      row.eventsSeen = found.eventsSeen;
      row.lastEventAt = found.lastEventAt;
    }
  }

  const deck = daemon ? { ...daemon.deck, port: daemon.port } : { ...NO_DECK, port: null };
  const state = checkState({ stateFile, dataDir });

  // Which terminal "open in terminal" would actually use, and how it was
  // chosen. WP-04. Never fails the report: an emulator probe that throws
  // leaves the row saying it found nothing, which is the same thing the
  // launcher would then do.
  //
  // The pin is read from the same state file `checkState` just looked at, so
  // this row reflects the user's setting rather than what detection would pick
  // if they had never set one.
  /** @type {{id:string|null,label:string|null,reason:string|null,present:boolean,pinned:boolean}} */
  let terminal = { id: null, label: null, reason: null, present: false, pinned: false };
  try {
    const pin = opts.terminalPin ?? (await readTerminalPin(stateFile));
    terminal = await findTerminal({ pin });
  } catch {
    // leave the row as "none found"
  }

  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const notes = [];

  if (!state.writable) {
    problems.push(
      `state is not writable at ${state.path}${state.error ? ` (${state.error})` : ''}`,
    );
  }

  for (const row of hooks) {
    if (row.error) {
      problems.push(`${row.label} hooks could not be read: ${row.error}`);
      continue;
    }
    if (!row.installed || row.port == null || row.listening !== false) continue;

    // Hooks aimed at a silent port. Which of these it is decides everything:
    //
    //   - No daemon anywhere: DeckHQ simply is not running. That is the
    //     normal state of most machines most of the time — the hooks are
    //     inert, not broken, and they start working again the moment the
    //     daemon does. Informational, exit 0.
    //   - A daemon running on a DIFFERENT port: every event is being posted
    //     into a void while the interface claims exact state. That is the
    //     failure this check exists for, and it is silent in every other
    //     surface. Exit 1.
    if (daemon) {
      problems.push(
        `${row.label} hooks post to 127.0.0.1:${row.port}, but DeckHQ is running on ` +
          `${daemon.port} — every hook event is being dropped. Reinstall the hooks from the ` +
          `header, or restart DeckHQ with --port ${row.port}.`,
      );
    } else {
      notes.push(
        `${row.label} hooks post to 127.0.0.1:${row.port} and DeckHQ is not running. ` +
          'They start delivering again when it is.',
      );
    }
  }

  if (!runtimes.some((r) => r.available)) {
    problems.push('no agent runtime is available on this machine — DeckHQ has nothing to show');
  }
  for (const row of runtimes) {
    if (row.error) problems.push(`${row.label} reported an error: ${row.error}`);
  }

  return {
    generatedAt: now,
    ok: problems.length === 0,
    runtimes,
    hooks,
    deck,
    state,
    terminal,
    // Static and deliberate. The core opens no outbound socket at all
    // (docs/02-ARCHITECTURE.md §9), including from this command: the only
    // connections it makes are to 127.0.0.1.
    egress: { outbound: 0, note: 'none. no outbound sockets.' },
    problems,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Thousands separators without depending on the machine's ICU build.
 * @param {number} n
 */
export function group(n) {
  const s = String(Math.trunc(Math.abs(n)));
  const parts = [];
  for (let i = s.length; i > 0; i -= 3) parts.unshift(s.slice(Math.max(0, i - 3), i));
  return (n < 0 ? '-' : '') + parts.join(',');
}

/**
 * "2m", "3h", "4d" — the shortest true thing about an elapsed span.
 * @param {number} ms
 */
export function ago(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Collapse the user's home directory back to `~`, so the report is readable
 * and safe to paste in a bug report.
 * @param {string} p
 * @param {string} [home]
 */
export function tildify(p, home = os.homedir()) {
  const norm = (s) => String(s).replace(/\\/g, '/');
  const np = norm(p);
  const nh = norm(home).replace(/\/$/, '');
  if (nh && (np === nh || np.startsWith(nh + '/'))) return '~' + np.slice(nh.length);
  return np;
}

/** @param {string} label @param {string} value */
function row(label, value) {
  return `  ${label.padEnd(LABEL_WIDTH)}${value}`;
}

/**
 * The plain-text report.
 * @param {Awaited<ReturnType<typeof collectReport>>} report
 * @param {{home?:string}} [opts]
 * @returns {string}
 */
export function renderReport(report, opts = {}) {
  const lines = [];

  for (const rt of report.runtimes) {
    const name = rt.label.toLowerCase();
    if (!rt.available) {
      lines.push(row(name, 'not installed'));
      continue;
    }
    lines.push(row(name, rt.version ? `${rt.version} on PATH` : 'available'));
    lines.push(
      row(
        'transcripts',
        `${group(rt.sessions)} ${plural(rt.sessions, 'session')} across ` +
          `${group(rt.projects)} ${plural(rt.projects, 'project')}`,
      ),
    );
    lines.push(
      row(
        'running now',
        `${group(rt.live)}   (${name}'s own agent view reports ${group(rt.liveReported)})`,
      ),
    );
    const floor = `${group(rt.sessions)}`;
    lines.push(
      row(
        'on the floor',
        rt.finished > 0
          ? `${floor}  ← ${group(rt.finished)} ${plural(rt.finished, 'session')} ` +
              `${rt.finished === 1 ? 'has' : 'have'} already finished; ` +
              'the agent view no longer lists them'
          : floor,
      ),
    );
    if (rt.error) lines.push(row('', `error: ${rt.error}`));
  }

  lines.push(row('waiting on you', describeDeck(report.deck, report.generatedAt)));

  const hookRows = report.hooks.filter((h) => h.supported);
  for (const h of hookRows) {
    const label = hookRows.length > 1 ? `hooks (${h.label.toLowerCase()})` : 'hooks';
    lines.push(row(label, describeHooks(h, report.generatedAt)));
  }

  lines.push(row('terminal', describeTerminalRow(report.terminal)));

  lines.push(
    row(
      'state',
      `${tildify(report.state.path, opts.home)}, ${report.state.writable ? 'writable' : 'NOT WRITABLE'}` +
        (report.state.writable || !report.state.error ? '' : ` (${report.state.error})`),
    ),
  );
  lines.push(row('egress', report.egress.note));

  if (report.notes.length || !report.ok) lines.push('');
  for (const problem of report.problems) lines.push(`  ! ${problem}`);
  for (const note of report.notes) lines.push(`  · ${note}`);

  return lines.join('\n') + '\n';
}

/**
 * @param {any} h
 * @param {number} now
 */
function describeHooks(h, now) {
  if (h.error) return `could not be read: ${h.error}`;
  if (!h.installed) return 'not installed (DeckHQ polls instead)';
  // A plugin install carries no port: its hook command asks the daemon where
  // it is on every event, so there is no port to report and nothing that can
  // go stale. Saying so is the difference between a row that explains the
  // missing port and a row that looks half-read.
  const parts = [h.viaPlugin && h.port == null ? 'installed as a plugin' : 'installed'];
  if (h.port != null) parts.push(`port ${h.port}`);
  if (h.listening === false) parts.push('NOTHING LISTENING THERE');
  if (h.eventsSeen != null) {
    parts.push(`${group(h.eventsSeen)} ${plural(h.eventsSeen, 'event')}`);
    if (h.lastEventAt) parts.push(`last ${ago(now - h.lastEventAt)} ago`);
    else parts.push('none yet this run');
  }
  return parts.join(', ');
}

/**
 * Which terminal "open in terminal" would use, and how it was chosen.
 *
 * Same wording discipline as the rest of the report (`docs/DEVIATIONS.md`
 * §72–§73): every phrase here names a check that was actually run — an
 * environment variable that is set, a binary on `PATH`, an app bundle that
 * exists, a setting that is stored. The row does NOT claim the launch works.
 * As of WP-04 no launch form outside Windows has been run on a real desktop
 * (`docs/DEVIATIONS.md` §9), and a row saying "will open Ghostty" would be
 * exactly the kind of unearned claim §74 exists to keep out of this file.
 * @param {any} t
 */
function describeTerminalRow(t) {
  if (!t || !t.id) {
    return 'none found — "open in terminal" has nothing to open';
  }
  if (t.pinned && !t.present) {
    return `${t.label}   (pinned in settings; not found on this machine)`;
  }
  const how = {
    pinned: 'pinned in settings',
    env: 'this session runs inside it',
    TERMINAL: '$TERMINAL',
    installed: 'installed',
    fallback: 'always present',
  }[t.reason];
  return how ? `${t.label}   (${how})` : String(t.label);
}

/**
 * The debt line. This is the number that cannot be argued with: sessions that
 * owe the user an answer AND are not running, so no view derived from live
 * processes lists them at all.
 * @param {any} deck
 * @param {number} now
 */
function describeDeck(deck, now) {
  if (!deck.found) return 'needs a running DeckHQ to count';
  if (deck.waitingNotRunning === 0) {
    return deck.waiting > 0
      ? `0   (${group(deck.waiting)} waiting, all still running)`
      : '0   nothing is waiting on you';
  }
  const parts = [`${group(deck.waitingNotRunning)}  ← none of these are running`];
  if (deck.oldestWaitAt) parts.push(`oldest ${ago(now - deck.oldestWaitAt)}`);
  return parts.join('; ');
}

/** @param {number} n @param {string} word */
function plural(n, word) {
  return n === 1 ? word : `${word}s`;
}

// ---------------------------------------------------------------------------
// The share block
// ---------------------------------------------------------------------------

/**
 * The pitch, as one line, and the last line of every share block.
 * `docs/plan/08-PLAN-V2-100X.md` §1.3 is the source; the wording of this line
 * belongs to the PM (WP-44 in that document's §11 list), so it is a named
 * export rather than a string buried in a template.
 */
export const PITCH =
  'DeckHQ — every AI coding session on your machine, on one office floor. ' +
  'npx deckhq · local, private, MIT.';

/** How wide the share block's label gutter is. The report's width, unindented. */
const SHARE_LABEL_WIDTH = 16;

/**
 * Everything that could name this machine or its work, gone.
 *
 * The share block is assembled only from counts and fixed phrases, so on the
 * ordinary path this replaces nothing at all. It exists because two fields in
 * the report are strings this file did not write — a runtime's `version()` and
 * an adapter's error message — and an error message from a filesystem call
 * carries an absolute path by default. Defence in depth for a block whose
 * whole purpose is to be pasted somewhere public.
 *
 * The home directory goes first, so `~` never has to be inferred from a
 * pattern, then the shapes of an absolute path, then the machine's name.
 * Hostnames under three characters are left alone: a two-letter host name is
 * indistinguishable from a word and redacting it would corrupt the text it is
 * meant to protect.
 *
 * @param {string} text
 * @param {{home?:string, host?:string}} [opts]
 * @returns {string}
 */
export function redact(text, opts = {}) {
  const home = opts.home ?? os.homedir();
  const host = opts.host ?? os.hostname();
  let out = String(text);

  if (home) {
    for (const form of new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')])) {
      // Anything hanging off the home directory goes with it: the path is the
      // part that identifies the machine, the rest identifies the work.
      //
      // Anchored at the start of a token, because the separator-swapped forms
      // are otherwise substrings of the real thing: `C:\Users\ada` contains
      // `\Users\ada`, and replacing the tail alone would leave `C:[path]`
      // behind for the drive-letter rule to no longer recognise.
      out = out.replace(
        new RegExp(`(^|[\\s,;('"=])${escapeRegExp(form)}[^\\s,;)'"]*`, 'gi'),
        '$1[path]',
      );
    }
  }

  out = out
    .replace(/\\\\[^\s,;)'"]+/g, '[path]') // \\server\share
    .replace(/[A-Za-z]:[\\/][^\s,;)'"]*/g, '[path]') // C:\Users\…, C:/Users/…
    .replace(/~[\\/][^\s,;)'"]*/g, '[path]') // ~/…
    .replace(/(?:\/[A-Za-z0-9._@%+-]+){2,}\/?/g, '[path]'); // /home/ada/work

  for (const name of new Set([host, String(host).split('.')[0]])) {
    if (!name || name.length < 3) continue;
    out = out.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi'), '[host]');
  }
  return out;
}

/** @param {string} s */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The pasteable block: the same report, fenced, with nothing in it that
 * belongs to the person running it. `docs/plan/08-PLAN-V2-100X.md` WP-44.
 *
 * This is the launch asset, and it is text on purpose — a number travels
 * through a thread, a terminal and a chat window, and a screenshot only
 * travels through one of those. What makes it postable is that a reader can
 * run the same command and check it, so the block carries the whole report's
 * numbers and not a selected highlight.
 *
 * What it drops against `renderReport`, and why:
 *
 *   - **The state path.** The only path in the healthy report, and a home
 *     directory names its owner. The row keeps its verdict — writable or not
 *     — because that is the part a reader can act on.
 *   - **Every free-text problem, note and per-runtime error.** These are the
 *     strings most likely to carry a path, a project name or a machine name,
 *     and none of them is meaningful to a stranger. When the report is not
 *     `ok`, the block says how many problems there are and where to see them:
 *     the honest summary, with nothing leaked.
 *   - **The hook port.** A port number tells a reader nothing about whether
 *     hooks are working, which is what the row is for.
 *
 * It adds a date (UTC, to the day — the hour would date-stamp a person's
 * working habits for no gain) and the pitch as its last line.
 *
 * Project names never appear because they never enter: `collectReport` counts
 * distinct working directories and keeps the count, never the strings. The
 * test for that asserts the absence of the fixture's directory names in the
 * rendered block rather than trusting this paragraph.
 *
 * @param {Awaited<ReturnType<typeof collectReport>>} report
 * @param {{home?:string, host?:string}} [opts]
 * @returns {string}
 */
export function renderShare(report, opts = {}) {
  /** @param {string} label @param {string} value */
  const srow = (label, value) => `${label.padEnd(SHARE_LABEL_WIDTH)}${value}`;
  const lines = [`deckhq doctor · ${new Date(report.generatedAt).toISOString().slice(0, 10)}`, ''];

  for (const rt of report.runtimes) {
    const name = rt.label.toLowerCase();
    if (!rt.available) {
      lines.push(srow(name, 'not installed'));
      continue;
    }
    lines.push(srow(name, rt.version ? `${rt.version} on PATH` : 'available'));
    lines.push(
      srow(
        'transcripts',
        `${group(rt.sessions)} ${plural(rt.sessions, 'session')} across ` +
          `${group(rt.projects)} ${plural(rt.projects, 'project')}`,
      ),
    );
    lines.push(
      srow(
        'running now',
        `${group(rt.live)}   (${name}'s own agent view reports ${group(rt.liveReported)})`,
      ),
    );
    lines.push(
      srow(
        'on the floor',
        rt.finished > 0
          ? `${group(rt.sessions)}  ← ${group(rt.finished)} ${plural(rt.finished, 'session')} ` +
              `${rt.finished === 1 ? 'has' : 'have'} already finished; ` +
              'the agent view no longer lists them'
          : `${group(rt.sessions)}`,
      ),
    );
  }

  lines.push(srow('waiting on you', describeDeck(report.deck, report.generatedAt)));

  const hookRows = report.hooks.filter((h) => h.supported);
  for (const h of hookRows) {
    const label = hookRows.length > 1 ? `hooks (${h.label.toLowerCase()})` : 'hooks';
    lines.push(srow(label, describeHooksForShare(h, report.generatedAt)));
  }

  lines.push(srow('state', report.state.writable ? 'writable' : 'NOT WRITABLE'));
  lines.push(srow('egress', report.egress.note));

  if (report.problems.length) {
    lines.push('');
    lines.push(
      `! ${group(report.problems.length)} ${plural(report.problems.length, 'problem')} — ` +
        'run `deckhq doctor` here for the detail',
    );
  }

  lines.push('');
  lines.push(PITCH);

  return '```\n' + redact(lines.join('\n'), opts) + '\n```\n';
}

/**
 * The hooks row for the share block: the verdict and the delivery evidence,
 * without the port and without an error message.
 * @param {any} h
 * @param {number} now
 */
function describeHooksForShare(h, now) {
  if (h.error) return 'could not be read';
  if (!h.installed) return 'not installed (DeckHQ polls instead)';
  const parts = [h.viaPlugin && h.port == null ? 'installed as a plugin' : 'installed'];
  if (h.listening === false) parts.push('NOTHING LISTENING THERE');
  if (h.eventsSeen != null) {
    parts.push(`${group(h.eventsSeen)} ${plural(h.eventsSeen, 'event')}`);
    if (h.lastEventAt) parts.push(`last ${ago(now - h.lastEventAt)} ago`);
    else parts.push('none yet this run');
  }
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// The capture proof
// ---------------------------------------------------------------------------

/** @param {unknown} s */
function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/**
 * The comparison card: what is running right now beside what is on the floor,
 * on this machine at this moment.
 *
 * WHAT THIS CARD MAY AND MAY NOT CLAIM. An earlier version headlined "DeckHQ
 * sees 61 sessions the agent view cannot", comparing 5 running against 66
 * all-history. `claude agents --json` was then measured on the reference
 * machine and returns every live session, `kind: "interactive"`, including
 * terminal-launched ones in other repositories — it is not blind to them. The
 * claim was literally true and rhetorically dishonest, and a reader who ran
 * the command would have caught us. It is gone.
 *
 * The real difference is persistence, not sight: a view of running processes
 * forgets a session the moment its process exits, and DeckHQ keeps it along
 * with whether it still owes you an answer. So the headline leads with the
 * debt — sessions waiting on the user that are NOT running, which no
 * live-process view lists by construction — and falls back to a bare
 * descriptive count when no daemon is running to supply it, rather than
 * reinstating a softer version of the old claim. docs/DEVIATIONS.md §74.
 *
 * Self-contained on purpose — no web font, no stylesheet, no image, no script.
 * A launch asset that fetches anything is a launch asset that contradicts the
 * thing it is proving (docs/02-ARCHITECTURE.md §9), and system fonts render
 * identically enough at this size.
 *
 * @param {Awaited<ReturnType<typeof collectReport>>} report
 * @param {{width?:number, height?:number, host?:string}} [opts]
 * @returns {string}
 */
export function buildProofHtml(report, opts = {}) {
  const width = opts.width || 1200;
  const height = opts.height || 630;
  const rt =
    report.runtimes.find((r) => r.available && r.finished > 0) ||
    report.runtimes.find((r) => r.available) ||
    report.runtimes[0];

  const name = rt ? rt.label.toLowerCase() : 'runtime';
  const theirs = rt ? group(rt.live) : '0';
  const ours = rt ? group(rt.sessions) : '0';
  const finished = rt ? rt.finished : 0;
  const when = new Date(report.generatedAt).toISOString().slice(0, 16).replace('T', ' ');
  const host = opts.host ?? os.hostname();

  const owed = report.deck.found ? report.deck.waitingNotRunning : null;
  let headline;
  let sub;
  if (owed) {
    headline =
      `${group(owed)} finished ${plural(owed, 'session')} ` +
      `${owed === 1 ? 'is' : 'are'} still waiting on you.`;
    sub = 'The agent view lists none of them.';
    if (report.deck.oldestWaitAt) {
      sub += ` Oldest: ${ago(report.generatedAt - report.deck.oldestWaitAt)}.`;
    }
  } else if (finished > 0) {
    // No daemon to ask, or nothing owed. State the count and stop — no
    // comparative claim at all.
    headline = `${group(finished)} of them have already finished.`;
    sub = report.deck.found ? 'Nothing is waiting on you right now.' : '';
  } else {
    headline = 'Every session on this machine is running right now.';
    sub = '';
  }

  return `<!doctype html>
<meta charset="utf-8">
<title>DeckHQ capture proof</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: ${width}px; height: ${height}px;
    background: #14120F;
    color: #EDE7DD;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 56px 64px;
    -webkit-font-smoothing: antialiased;
  }
  .eyebrow {
    font-size: 20px; letter-spacing: .22em; text-transform: uppercase;
    color: #8A8178; font-weight: 600;
  }
  .cols { display: flex; align-items: stretch; gap: 40px; }
  .col { flex: 1; padding: 28px 32px; border-radius: 18px; background: #1E1B17; border: 1px solid #2E2A24; }
  .col.ours { background: #1B211B; border-color: #33452F; }
  .who { font-size: 24px; color: #B5ACA1; font-variant-ligatures: none; }
  .col.ours .who { color: #9CCB8C; }
  .num { font-size: 132px; line-height: 1.02; font-weight: 800; letter-spacing: -.04em; margin-top: 8px; }
  .col.ours .num { color: #A9E08F; }
  .unit { font-size: 22px; color: #8A8178; margin-top: 6px; }
  .headline { font-size: 40px; font-weight: 700; line-height: 1.22; letter-spacing: -.02em; }
  .sub { font-size: 27px; color: #B5ACA1; margin-top: 10px; line-height: 1.3; }
  .foot { font-size: 19px; color: #6F6860; display: flex; justify-content: space-between; gap: 24px; }
  .mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", monospace; }
</style>
<div class="eyebrow">DeckHQ &middot; capture proof</div>

<div class="cols">
  <div class="col">
    <div class="who mono">${esc(name)} &middot; its own agent view</div>
    <div class="num">${esc(theirs)}</div>
    <div class="unit">sessions running right now</div>
  </div>
  <div class="col ours">
    <div class="who mono">deckhq</div>
    <div class="num">${esc(ours)}</div>
    <div class="unit">sessions on the floor</div>
  </div>
</div>

<div>
  <div class="headline">${esc(headline)}</div>
  ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
</div>

<div class="foot">
  <span>${esc(host)} &middot; ${esc(when)} UTC</span>
  <span class="mono">npx deckhq</span>
</div>
`;
}

/**
 * Write the proof PNG. Best effort by contract: a machine with no Chrome, or
 * a Node too old for the CDP client, prints one sentence and is not a failure.
 * `doctor` must never fail because a screenshot could not be taken.
 *
 * @param {Awaited<ReturnType<typeof collectReport>>} report
 * @param {{outDir?:string, out?:string, write?:(s:string)=>void, now?:number}} [opts]
 * @returns {Promise<{ok:boolean, path:string|null, reason:string|null}>}
 */
export async function captureProof(report, opts = {}) {
  const write = opts.write || ((s) => process.stdout.write(s));
  const chrome = await import('./chrome.mjs');

  if (!chrome.hasWebSocket()) {
    const reason =
      `--capture-proof needs Node 22 or newer (this is ${process.version}); ` +
      'the report above is unaffected.';
    write(`\n  ${reason}\n`);
    return { ok: false, path: null, reason };
  }

  const chromePath = chrome.findChrome();
  if (!chromePath) {
    const reason =
      'no Chrome, Chromium or Edge was found, so no proof image was written. ' +
      'Set CHROME_PATH to the executable and run this again.';
    write(`\n  ${reason}\n`);
    return { ok: false, path: null, reason };
  }

  const stamp = new Date(opts.now ?? report.generatedAt)
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  const outDir = opts.outDir || path.join(DATA_DIR, 'snapshots');
  const outFile = opts.out || path.join(outDir, `capture-proof-${stamp}.png`);

  try {
    await chrome.screenshotHtml({
      html: buildProofHtml(report),
      outFile,
      width: 1200,
      height: 630,
      scale: 2,
      chromePath,
    });
  } catch (err) {
    const reason = `could not write the proof image: ${err?.message || err}`;
    write(`\n  ${reason}\n`);
    return { ok: false, path: null, reason };
  }

  write(`\n  proof           ${outFile}\n`);
  return { ok: true, path: outFile, reason: null };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Run the command. Returns the process exit code rather than calling
 * `process.exit`, so it is directly testable.
 *
 * @param {string[]} [argv] argv after the `doctor` subcommand
 * @param {{write?:(s:string)=>void, collect?:typeof collectReport}} [deps]
 * @returns {Promise<number>}
 */
export async function runDoctor(argv = [], deps = {}) {
  const write = deps.write || ((s) => process.stdout.write(s));
  const collect = deps.collect || collectReport;

  if (argv.includes('--help') || argv.includes('-h')) {
    write(
      [
        'deckhq doctor — what DeckHQ can see on this machine.',
        '',
        'Usage: deckhq doctor [options]',
        '',
        '  --json             emit the same report as a JSON object',
        '  --share            print the report as a fenced block with no paths,',
        '                     project names or machine name in it, ready to paste',
        '  --capture-proof    also write a PNG of the comparison to',
        '                     ~/.deckhq/snapshots/, ready to post',
        '  --port <n>         also look for a running DeckHQ on this port',
        '  --help             this message',
        '',
        'Starts nothing and opens nothing. Makes no outbound network calls.',
        '',
      ].join('\n'),
    );
    return 0;
  }

  const portIndex = argv.indexOf('--port');
  const port = portIndex !== -1 ? Number(argv[portIndex + 1]) || null : null;

  const report = await collect({ port });
  const json = argv.includes('--json');
  const wantProof = argv.includes('--capture-proof');
  const wantShare = argv.includes('--share');

  // Text mode prints the report first and lets the capture add its own line
  // underneath. JSON mode stays exactly one JSON document on stdout, whatever
  // the flags — anything else is unparseable by the scripts this flag exists
  // for, so the capture's progress line is swallowed there.
  //
  // `--share` prints the block and nothing else: it is meant to be selected
  // whole, or piped straight into a clipboard command, and a second copy of
  // the same numbers above it makes both jobs harder. With `--json` it becomes
  // one more field of the single document rather than stdout carrying two
  // formats at once.
  const share = wantShare ? renderShare(report) : null;
  if (!json) write('\n' + (share ?? renderReport(report)));

  const proof = wantProof
    ? await captureProof(report, { write: json ? () => {} : write })
    : { ok: false, path: null, reason: 'not requested' };

  if (json) write(JSON.stringify({ ...report, proof, share }, null, 2) + '\n');
  else write('\n');

  return report.ok ? 0 : 1;
}

export default runDoctor;
