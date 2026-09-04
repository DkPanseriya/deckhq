/**
 * What the doctor finds out (WP-22 follow-up).
 *
 * Split out of `doctor.mjs` unchanged: the loopback probe, the daemon
 * inspection, the deck read, the state-file check, the per-runtime scan, the
 * pinned terminal and the hook status.
 *
 * Every function here is a read. The doctor reports; it never repairs, and
 * nothing in this file writes anything to disk.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
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
export const DEFAULT_PORT = 4317;

export const PORT_SCAN_SPAN = 10;

/** Column width for the report's label gutter. */
export const LABEL_WIDTH = 16;

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
  // The actor floor a never-run machine gets in the browser (WP-13) is not
  // this machine's work. `doctor` reports what is true here, so it reports
  // zero — the same rule the terminal deck follows in `askDaemon`.
  const agents =
    snapshot?.demo === true ? [] : Array.isArray(snapshot?.agents) ? snapshot.agents : [];
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
export const NO_DECK = {
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
 * @param {{pinnedBin?: string}} [opts] the binary this runtime's setting pins,
 *   when it has one. Only Codex does (`codexBin`, WP-23a).
 */
export async function collectRuntime(adapter, scan, opts = {}) {
  const binOpts = { codexBin: opts.pinnedBin || '' };
  const row = {
    id: adapter.id,
    label: adapter.label,
    available: false,
    /**
     * The runtime's own version string. Null unless the adapter implements the
     * optional `version()` — asking the runtime directly would mean spawning
     * its CLI from outside an adapter, which the architecture forbids, so this
     * row fills itself in only for a runtime whose adapter has grown one. The
     * Codex adapter is the first (WP-23a); see docs/DEVIATIONS.md §72, §136.1.
     */
    version: null,
    /**
     * WP-23a. Which program this runtime's adapter would actually start, and
     * how it found it — `pinned`, `path` or `bundled`. Null for an adapter
     * that does not report one, which is every adapter but Codex today, and
     * `{found:false}` for a machine whose transcripts are readable while the
     * binary is not there. That distinction is the whole of §136.1: `codex`
     * bundled inside the desktop app and off PATH read as "not installed".
     * @type {{found:boolean, source:string|null, path:string|null,
     *         lookedIn:string[], pinProblem:string|null,
     *         shimOnPath:string|null}|null}
     */
    binary: null,
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
    if (typeof adapter.describeBinary === 'function') {
      const b = await adapter.describeBinary(binOpts);
      row.binary = b
        ? {
            found: Boolean(b.found),
            source: b.source || null,
            path: b.path || null,
            lookedIn: Array.isArray(b.lookedIn) ? b.lookedIn : [],
            pinProblem: b.pinProblem || null,
            shimOnPath: b.shimOnPath || null,
          }
        : null;
    }
  } catch {
    row.binary = null; // never fail the report over a row it can do without
  }

  try {
    // Skipped when the binary is known to be missing: `version()` would only
    // resolve null, and a spawn nobody can win is a spawn not worth making.
    if (typeof adapter.version === 'function' && (!row.binary || row.binary.found)) {
      const v = await adapter.version(binOpts);
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
  const pin = (await readSettings(stateFile)).terminal;
  return typeof pin === 'string' && pin.trim() ? pin.trim() : TERMINAL_AUTO;
}

/**
 * The persisted settings, or `{}` for every way a state file can be unusable.
 *
 * Same discipline as `readTerminalPin` above and for the same reason: `doctor`
 * must not construct a `Store`, because a read-only command must not be able
 * to create the state it is reporting on.
 * @param {string} stateFile
 * @returns {Promise<Record<string, any>>}
 */
export async function readSettings(stateFile) {
  try {
    const parsed = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
    const settings = parsed?.settings;
    return settings && typeof settings === 'object' ? settings : {};
  } catch {
    return {};
  }
}

/**
 * Which runtime each binary-pinning setting belongs to (WP-23a).
 *
 * One entry, and it is named here rather than guessed from the key so that
 * `doctor` does not grow a rule like "a setting ending in `Bin`". A second
 * runtime that pins a binary adds a line.
 * @type {Readonly<Record<string, string>>}
 */
export const BINARY_PIN_SETTINGS = Object.freeze({ codex: 'codexBin' });

/**
 * One hooks row per adapter that supports hooks.
 * @param {any} adapter
 * @param {{probe:Function}} deps
 */
export async function collectHooks(adapter, deps) {
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
    /**
     * WP-56. A managed policy that stops these hooks from running, as
     * `{key, file}`, or null. Two settings keys can switch DeckHQ's hooks off
     * over its head, and from every other surface the result is identical to a
     * broken install: the settings file is exactly right and nothing arrives
     * (`docs/DEVIATIONS.md` §86.4, §97.4, §115). Read through an optional
     * adapter method, so a runtime with no such policy simply has none.
     */
    blockedByPolicy: null,
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

  if (row.installed && typeof adapter.hooks.blockedByPolicy === 'function') {
    try {
      const blocked = await adapter.hooks.blockedByPolicy({
        port: row.port ?? undefined,
        viaPlugin: row.viaPlugin,
      });
      row.blockedByPolicy =
        blocked && blocked.key && blocked.file
          ? { key: String(blocked.key), file: String(blocked.file) }
          : null;
    } catch {
      // A policy read that fails leaves the row saying what it said before
      // this check existed. It must never be able to fail the report.
      row.blockedByPolicy = null;
    }
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
export function candidatePorts(hookPorts, explicit, published = null) {
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
 *   publishedPort?: number|null,
 *   now?: number,
 *   scan?: {maxAgeDays:number, limit:number},
 *   terminal?: (opts:any) => Promise<any>,
 *   terminalPin?: string,
 *   settings?: Record<string, any>,
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
  const settings = opts.settings || (await readSettings(stateFile));
  const runtimes = await Promise.all(
    list.map((a) =>
      collectRuntime(a, scan, { pinnedBin: settings[BINARY_PIN_SETTINGS[a.id]] || '' }),
    ),
  );
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

    // A managed policy switching the hooks off is the "looks healthy, delivers
    // nothing" case §75 reserved exit 1 for, and the only one of its class the
    // user cannot diagnose from any other surface: the settings file is right,
    // the port is right, the daemon is up, and no event ever arrives. The row
    // above names the key and the file; this line says exactly what that key
    // takes away, because the two keys do not take away the same thing.
    if (row.blockedByPolicy) {
      problems.push(policyProblem(row));
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
    // WP-23a. Transcripts readable, no program to run: the floor is right and
    // "send" and "resume" cannot work. A NOTE and not a problem — the read
    // path, which is most of the product, is entirely healthy — but it must
    // not be silent, because the sentence it replaces claimed the runtime was
    // not installed at all (`docs/DEVIATIONS.md` §136.1).
    // A `codex.cmd` on PATH that we walked past. Node cannot start a batch
    // shim without a shell, and this adapter will not run one, so the report
    // says which one it used and why rather than looking arbitrary.
    if (row.available && row.binary && row.binary.found && row.binary.shimOnPath) {
      notes.push(
        `${row.label} is on your PATH as ${row.binary.shimOnPath}, a batch shim Windows cannot ` +
          `start without a shell. DeckHQ is using ${row.binary.path} instead.`,
      );
    }
    if (row.available && row.binary && !row.binary.found) {
      if (row.binary.pinProblem) {
        problems.push(
          `${row.label}'s pinned binary ${row.binary.pinProblem} is not a file, so nothing ` +
            'can be sent or resumed. Clear the setting to search PATH and the app bundle again.',
        );
      } else {
        notes.push(
          `${row.label} transcripts are readable, but no ${row.id} binary was found — not on ` +
            `PATH${row.binary.lookedIn.length ? `, and not in ${row.binary.lookedIn.join(' or ')}` : ''}. ` +
            'Sending a turn and resuming in a terminal need one; the floor does not.',
        );
      }
    }
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

/**
 * What one blocking key actually takes away, named exactly.
 *
 * The two keys are not the same size and the report will not pretend they are.
 * `allowManagedHooksOnly` ignores every hook DeckHQ installs, by either route.
 * `allowedHttpHookUrls` reaches only the one `http` entry — WP-19's
 * `PermissionRequest` — and leaves the eight `command` events delivering
 * normally. §72–§73: say only what was checked, at the size it is.
 * @param {any} h
 */
export function policyProblem(h) {
  const { key, file } = h.blockedByPolicy;
  if (key === 'allowedHttpHookUrls') {
    return (
      `${h.label} hooks are installed, but managed settings set allowedHttpHookUrls in ${file} ` +
      `and it does not cover http://127.0.0.1:${h.port}/api/permission, so the PermissionRequest ` +
      'hook does not run and no permission prompt reaches DeckHQ. The other hook events are ' +
      'unaffected. Nothing DeckHQ can do changes this — the allowlist is set by whoever manages ' +
      'this machine.'
    );
  }
  return (
    `${h.label} hooks are installed, but managed settings set ${key} in ${file}, so only the ` +
    "hooks your organisation deploys run and DeckHQ's are ignored. No event reaches it and " +
    'state is being inferred instead. Nothing DeckHQ can do changes this — reinstalling the ' +
    'hooks will not, either.'
  );
}
