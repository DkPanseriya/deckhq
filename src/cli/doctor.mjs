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
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import * as defaultAdapters from '../adapters/index.mjs';
import { DATA_DIR, STATE_FILE } from '../core/paths.mjs';

/**
 * The same scan bounds the daemon uses (src/core/state-machine.mjs), so
 * "on the floor" is the number the floor would actually show. A doctor that
 * counts differently from the product is worse than no doctor.
 */
export const SCAN_MAX_AGE_DAYS = 36500;
export const SCAN_LIMIT = 5000;

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
 * Hook delivery evidence, read from a DeckHQ daemon already running on this
 * port. The counters live in the daemon's memory, so there is no other place
 * to get them — and if no daemon is running there is nothing to report, which
 * is not an error.
 * @param {number} port
 * @returns {Promise<Map<string, {eventsSeen:number, lastEventAt:number|null}>>}
 */
export async function fetchHookHealth(port) {
  /** @type {Map<string, {eventsSeen:number, lastEventAt:number|null}>} */
  const out = new Map();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/hooks`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return out;
    const body = await res.json();
    for (const entry of body.adapters || []) {
      if (!entry || typeof entry.runtime !== 'string') continue;
      out.set(entry.runtime, {
        eventsSeen: Number(entry.eventsSeen) || 0,
        lastEventAt: typeof entry.lastEventAt === 'number' ? entry.lastEventAt : null,
      });
    }
  } catch {
    // Not a DeckHQ daemon, or not answering. Nothing to add.
  }
  return out;
}

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
     * See docs/DEVIATIONS.md §66.
     */
    version: null,
    sessions: 0,
    projects: 0,
    live: 0,
    liveReported: 0,
    unseenByRuntime: 0,
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

  // The moat, as arithmetic. Clamped at zero: a runtime reporting more live
  // sessions than we have transcripts for (a brand-new session whose file has
  // not been written yet, or a scan bound that excluded one) means we are not
  // ahead, not that we are behind by a negative number.
  row.unseenByRuntime = Math.max(0, row.sessions - row.liveReported);
  return row;
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
    port: null,
    listening: null,
    eventsSeen: null,
    lastEventAt: null,
    error: null,
  };
  if (!row.supported) return row;

  try {
    row.installed = Boolean(await adapter.hooks.installed());
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
 * The whole report, as data. Every external dependency is injectable so the
 * tests can drive a fake registry and a fake machine.
 *
 * @param {{
 *   adapters?: {getAdapters: () => any[]},
 *   stateFile?: string,
 *   dataDir?: string,
 *   probe?: (port:number) => Promise<boolean>,
 *   hookHealth?: (port:number) => Promise<Map<string, {eventsSeen:number, lastEventAt:number|null}>>,
 *   now?: number,
 *   scan?: {maxAgeDays:number, limit:number},
 * }} [opts]
 */
export async function collectReport(opts = {}) {
  const adapters = opts.adapters || defaultAdapters;
  const stateFile = opts.stateFile || STATE_FILE;
  const dataDir = opts.dataDir || DATA_DIR;
  const probe = opts.probe || probeLoopbackPort;
  const hookHealth = opts.hookHealth || fetchHookHealth;
  const now = opts.now ?? Date.now();
  const scan = opts.scan || { maxAgeDays: SCAN_MAX_AGE_DAYS, limit: SCAN_LIMIT };

  const list = adapters.getAdapters();
  const runtimes = await Promise.all(list.map((a) => collectRuntime(a, scan)));
  const hooks = await Promise.all(list.map((a) => collectHooks(a, { probe })));

  // Hook counters live in a running daemon. Ask once, on the first port that
  // has something listening, rather than once per adapter.
  const livePort = hooks.find((h) => h.listening)?.port ?? null;
  if (livePort != null) {
    const health = await hookHealth(livePort);
    for (const row of hooks) {
      // A runtime with no hook mechanism has no delivery evidence to report,
      // and a zero there would read as "installed but silent" rather than
      // "not a thing this runtime does".
      if (!row.supported) continue;
      const found = health.get(row.runtime);
      if (!found) continue;
      row.eventsSeen = found.eventsSeen;
      row.lastEventAt = found.lastEventAt;
    }
  }

  const state = checkState({ stateFile, dataDir });

  /** @type {string[]} */
  const problems = [];
  if (!state.writable) {
    problems.push(
      `state is not writable at ${state.path}${state.error ? ` (${state.error})` : ''}`,
    );
  }
  for (const row of hooks) {
    if (row.installed && row.port != null && row.listening === false) {
      problems.push(
        `${row.label} hooks post to 127.0.0.1:${row.port} and nothing is listening there — ` +
          `start DeckHQ (deckhq --port ${row.port}), or reinstall the hooks from the header`,
      );
    }
    if (row.error) problems.push(`${row.label} hooks could not be read: ${row.error}`);
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
    state,
    // Static and deliberate. The core opens no outbound socket at all
    // (docs/02-ARCHITECTURE.md §9), including from this command: the only
    // connections it makes are to 127.0.0.1.
    egress: { outbound: 0, note: 'none. no outbound sockets.' },
    problems,
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
        'live now',
        `${group(rt.live)}   (${name}'s own agent view reports ${group(rt.liveReported)})`,
      ),
    );
    const floor = `${group(rt.sessions)}`;
    lines.push(
      row(
        'on the floor',
        rt.unseenByRuntime > 0
          ? `${floor}  ← DeckHQ sees ${group(rt.unseenByRuntime)} ` +
              `${plural(rt.unseenByRuntime, 'session')} the agent view cannot`
          : floor,
      ),
    );
    if (rt.error) lines.push(row('', `error: ${rt.error}`));
  }

  const hookRows = report.hooks.filter((h) => h.supported);
  for (const h of hookRows) {
    const label = hookRows.length > 1 ? `hooks (${h.label.toLowerCase()})` : 'hooks';
    lines.push(row(label, describeHooks(h, report.generatedAt)));
  }

  lines.push(
    row(
      'state',
      `${tildify(report.state.path, opts.home)}, ${report.state.writable ? 'writable' : 'NOT WRITABLE'}` +
        (report.state.writable || !report.state.error ? '' : ` (${report.state.error})`),
    ),
  );
  lines.push(row('egress', report.egress.note));

  if (!report.ok) {
    lines.push('');
    for (const problem of report.problems) lines.push(`  ! ${problem}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * @param {any} h
 * @param {number} now
 */
function describeHooks(h, now) {
  if (h.error) return `could not be read: ${h.error}`;
  if (!h.installed) return 'not installed (DeckHQ polls instead)';
  const parts = ['installed'];
  if (h.port != null) parts.push(`port ${h.port}`);
  if (h.listening === false) parts.push('NOTHING LISTENING THERE');
  if (h.eventsSeen != null) {
    parts.push(`${group(h.eventsSeen)} ${plural(h.eventsSeen, 'event')}`);
    if (h.lastEventAt) parts.push(`last ${ago(now - h.lastEventAt)} ago`);
    else parts.push('none yet this run');
  }
  return parts.join(', ');
}

/** @param {number} n @param {string} word */
function plural(n, word) {
  return n === 1 ? word : `${word}s`;
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
 * The comparison card: the runtime's own count beside DeckHQ's, on this
 * machine at this moment.
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
    report.runtimes.find((r) => r.available && r.unseenByRuntime > 0) ||
    report.runtimes.find((r) => r.available) ||
    report.runtimes[0];

  const name = rt ? rt.label.toLowerCase() : 'runtime';
  const theirs = rt ? group(rt.liveReported) : '0';
  const ours = rt ? group(rt.sessions) : '0';
  const unseen = rt ? rt.unseenByRuntime : 0;
  const when = new Date(report.generatedAt).toISOString().slice(0, 16).replace('T', ' ');
  const host = opts.host ?? os.hostname();

  const headline =
    unseen > 0
      ? `DeckHQ sees ${group(unseen)} ${plural(unseen, 'session')} the agent view cannot`
      : `DeckHQ and the agent view agree on this machine right now`;

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
  .headline { font-size: 40px; font-weight: 700; line-height: 1.2; letter-spacing: -.02em; }
  .headline .n { color: #A9E08F; }
  .foot { font-size: 19px; color: #6F6860; display: flex; justify-content: space-between; gap: 24px; }
  .mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", monospace; }
</style>
<div class="eyebrow">DeckHQ &middot; capture proof</div>

<div class="cols">
  <div class="col">
    <div class="who mono">${esc(name)} &middot; its own agent view</div>
    <div class="num">${esc(theirs)}</div>
    <div class="unit">sessions it can see</div>
  </div>
  <div class="col ours">
    <div class="who mono">deckhq</div>
    <div class="num">${esc(ours)}</div>
    <div class="unit">sessions on the floor</div>
  </div>
</div>

<div class="headline">${esc(headline)}</div>

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
        '  --capture-proof    also write a PNG of the comparison to',
        '                     ~/.deckhq/snapshots/, ready to post',
        '  --help             this message',
        '',
        'Starts nothing and opens nothing. Makes no outbound network calls.',
        '',
      ].join('\n'),
    );
    return 0;
  }

  const report = await collect();
  const json = argv.includes('--json');
  const wantProof = argv.includes('--capture-proof');

  // Text mode prints the report first and lets the capture add its own line
  // underneath. JSON mode stays exactly one JSON document on stdout, whatever
  // the flags — anything else is unparseable by the scripts this flag exists
  // for, so the capture's progress line is swallowed there.
  if (!json) write('\n' + renderReport(report));

  const proof = wantProof
    ? await captureProof(report, { write: json ? () => {} : write })
    : { ok: false, path: null, reason: 'not requested' };

  if (json) write(JSON.stringify({ ...report, proof }, null, 2) + '\n');
  else write('\n');

  return report.ok ? 0 : 1;
}

export default runDoctor;
